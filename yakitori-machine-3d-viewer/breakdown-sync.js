(function () {
    'use strict';

    let lastGood = null;
    let inFlight = false;
    let timer = null;
    let failures = 0;
    const MACHINES = ['M1', 'M2', 'M3', 'M4'];
    const REFRESH_INTERVAL_MS = 60 * 1000;

    function getMachineCode(record) {
        const station = String(record?.station || '').trim().toUpperCase();
        if (MACHINES.includes(station)) return station;

        const text = [record?.machineArea, record?.machine, record?.conveyorPosition]
            .filter(Boolean)
            .join(' ')
            .toUpperCase();
        const match = text.match(/\bM([1-4])\b/);
        return match ? `M${match[1]}` : '';
    }

    function getEventTime(record) {
        const created = Date.parse(record?.startedAt || record?.updatedAt || record?.createdAt || '');
        if (Number.isFinite(created)) return created;

        const local = Date.parse(`${record?.breakdownDate || ''}T${record?.startTime || '00:00'}`);
        return Number.isFinite(local) ? local : 0;
    }

    function formatEventTime(record) {
        const date = new Date(getEventTime(record));
        if (!Number.isFinite(date.getTime()) || date.getTime() === 0) return '-';
        return date.toLocaleString('th-TH', {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok'
        });
    }

    function normalizeStatus(record) {
        const value = String(record?.breakdownStatus || record?.status || 'Open').trim().toLowerCase();
        if (value === 'closed') return 'closed';
        if (value === 'monitoring') return 'monitoring';
        return value === 'open' ? 'open' : 'unknown';
    }

    async function readBreakdowns() {
        try {
            const url = window.YakitoriRuntime.buildApiUrl('MachineBreakdownLog', { action: 'read_breakdown', ts: Date.now() });
            const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const payload = await response.json();
            if (window.BREAKDOWN_SUPABASE?.environment === 'staging' && payload.environment !== 'staging') throw new Error('Environment mismatch');
            if (payload.status !== 'success' || !Array.isArray(payload._records)) throw new Error('Invalid breakdown feed');
            lastGood = { records: payload._records, source: 'Google Sheet', asOf: payload.asOf || new Date().toISOString() };
            failures = 0;
            return { ...lastGood, stale: false };
        } catch (_) {
            failures++;
            return { records: lastGood?.records || [], source: lastGood ? 'ข้อมูลเก่า — อ่านล่าสุดไม่สำเร็จ' : 'อ่านข้อมูลไม่ได้', asOf: lastGood?.asOf, stale: true };
        }
    }

    function latestByMachine(records) {
        const result = Object.fromEntries(MACHINES.map(machine => [machine, null]));
        records.forEach(record => {
            if (record.voidedAt || record.isHistorical === true || record.isHistorical === 'true' || record.isMachineStop === false || record.isMachineFailure === false) return;
            const machine = getMachineCode(record);
            if (!machine) return;
            const current = result[machine];
            const priority = r => !r ? 9 : normalizeStatus(r) === 'open' ? 0 : normalizeStatus(r) === 'monitoring' ? 1 : 2;
            if (!current || priority(record) < priority(current) || (priority(record) === priority(current) && getEventTime(record) > getEventTime(current))) {
                result[machine] = record;
            }
        });
        return result;
    }

    function injectStyles() {
        if (document.getElementById('breakdown-sync-style')) return;
        const style = document.createElement('style');
        style.id = 'breakdown-sync-style';
        style.textContent = `
            .machine-marker.bd-open { background:#cf334f !important; border-color:#ff91a4 !important; box-shadow:0 0 0 3px rgba(241,65,108,.24),0 0 18px rgba(241,65,108,.82) !important; }
            .machine-marker.bd-monitoring { background:#b58000 !important; border-color:#ffe07a !important; box-shadow:0 0 0 3px rgba(255,199,0,.22),0 0 18px rgba(255,199,0,.7) !important; }
            .machine-marker.bd-closed { background:#177a59 !important; border-color:#7bf0be !important; }
            .breakdown-status-panel { position:absolute; left:18px; bottom:18px; z-index:7; width:min(330px,calc(100% - 36px)); padding:12px; border:1px solid rgba(150,177,210,.24); border-radius:12px; background:rgba(15,22,36,.9); backdrop-filter:blur(12px); color:#e9f3ff; font:12px/1.35 Inter,system-ui,sans-serif; }
            .breakdown-status-panel__head { display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:9px; color:#9fc3ff; }
            .breakdown-status-panel__head button { border:0; background:transparent; color:#a8c9ff; font:inherit; cursor:pointer; }
            .breakdown-status-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:7px; }
            .breakdown-status-card { appearance:none; width:100%; padding:9px; border:1px solid #2c425c; border-radius:8px; background:#172337; color:inherit; text-align:left; cursor:pointer; }
            .breakdown-status-card:hover { border-color:#7baeff; }
            .breakdown-status-card strong { display:block; font-size:13px; }
            .breakdown-status-card span { display:block; margin-top:3px; color:#aec0d5; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            .breakdown-status-card em { display:inline-block; margin-top:5px; padding:2px 5px; border-radius:999px; background:#2b3c52; color:#bcd0e7; font-style:normal; font-size:10px; }
            .breakdown-status-card.status-open em { background:rgba(241,65,108,.2); color:#ff9eb2; }
            .breakdown-status-card.status-monitoring em { background:rgba(255,199,0,.18); color:#ffe17d; }
            .breakdown-status-card.status-closed em { background:rgba(80,205,137,.18); color:#8bf2bb; }
        `;
        document.head.appendChild(style);
    }

    function statusLabel(status) {
        return { open: 'Breakdown เปิดอยู่', monitoring: 'ทดลองเดิน/เฝ้าติดตาม', closed: 'ประวัติปิดงานแล้ว' }[status] || 'สถานะไม่ทราบ';
    }

    function decorateMarkers(latest) {
        document.querySelectorAll('.machine-marker').forEach(marker => {
            const machine = String(marker.textContent || '').trim().toUpperCase();
            if (!MACHINES.includes(machine)) return;
            marker.classList.remove('bd-open', 'bd-monitoring', 'bd-closed');
            const record = latest[machine];
            if (!record) {
                delete marker.dataset.breakdownStatus;
                marker.title = `${machine}: ไม่มีรายการ Breakdown`;
                return;
            }
            const status = normalizeStatus(record);
            // Keep the core layout/installation dot untouched; incident state has a separate panel.
            marker.dataset.breakdownStatus = status;
            marker.title = `${machine}: ${statusLabel(status)} — ${record.symptom || record.rootCause || record.eventType || 'Breakdown'}`;
        });
    }

    function selectMachine(machine) {
        const buttons = Array.from(document.querySelectorAll('.machine-marker'));
        const marker = buttons.find(button => String(button.textContent || '').trim().toUpperCase() === machine);
        marker?.click();
    }

    function renderPanel(latest, source, stale, asOf) {
        const stage = document.querySelector('.viewer-stage');
        if (!stage) return;
        let panel = document.getElementById('breakdown-status-panel');
        if (!panel) {
            panel = document.createElement('section');
            panel.id = 'breakdown-status-panel';
            panel.className = 'breakdown-status-panel';
            stage.appendChild(panel);
        }

        panel.replaceChildren();
        const node = (tag, text, className) => { const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el; };
        const head = node('div', '', 'breakdown-status-panel__head');
        head.appendChild(node('strong', 'สถานะ Machine Breakdown'));
        const retry = node('button', 'รีเฟรช'); retry.type = 'button'; retry.id = 'breakdown-refresh'; retry.addEventListener('click', refresh); head.appendChild(retry);
        panel.appendChild(head);
        const grid = node('div', '', 'breakdown-status-grid');
        MACHINES.forEach(machine => {
            const record = latest[machine];
            const status = record ? normalizeStatus(record) : 'none';
            const button = node('button', '', 'breakdown-status-card status-' + status); button.type = 'button'; button.dataset.breakdownMachine = machine;
            button.appendChild(node('strong', machine));
            button.appendChild(node('span', record ? record.symptom || record.rootCause || record.eventType || 'Breakdown' : stale ? 'ข้อมูลไม่พร้อมใช้งาน' : 'ไม่มีเหตุที่เปิดอยู่'));
            button.appendChild(node('em', record ? statusLabel(status) + ' · ' + formatEventTime(record) : stale ? 'Unavailable' : 'ไม่มีเหตุที่เปิดอยู่'));
            button.addEventListener('click', () => selectMachine(machine)); grid.appendChild(button);
        });
        panel.appendChild(grid);
        const info = node('div', 'แหล่งข้อมูล: ' + source + (asOf ? ' · ' + new Date(asOf).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : '') + ' · สถานะติดตั้งแสดงที่จุดสีของเครื่อง');
        info.style.marginTop = '8px'; panel.appendChild(info);
    }

    async function refresh() {
        if (inFlight || document.hidden) return;
        inFlight = true;
        try {
            const { records, source, stale, asOf } = await readBreakdowns();
            const latest = latestByMachine(records);
            renderPanel(latest, source, stale, asOf);
            decorateMarkers(latest);
        } finally {
            inFlight = false;
            clearTimeout(timer);
            if (!document.hidden) timer = window.setTimeout(refresh, REFRESH_INTERVAL_MS * Math.min(4, Math.pow(2, failures)));
        }
    }

    function start() {
        injectStyles();
        refresh();
        document.addEventListener('visibilitychange', () => { clearTimeout(timer); if (!document.hidden) refresh(); });
        window.addEventListener('pagehide', () => clearTimeout(timer));
    }

    window.addEventListener('load', start, { once: true });
})();
