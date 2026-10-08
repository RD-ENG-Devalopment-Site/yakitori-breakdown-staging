(function () {
    'use strict';
    const client = window.BreakdownClient, domain = window.BreakdownDomain;
    const page = document.body.dataset.breakdownPage;
    const $ = id => document.getElementById(id);
    const products = { BL23G_M1:'BL 23G R15 (M1)', BL23G_M2:'BL 23G R15 (M2)', BBSKINR12:'BB SKIN 25G R12', NECKSKINR15:'Neck Skin 40G R15', BBSKINF15:'BB SKIN 35G F15', GZ40G:'Gizzard 40G S18', GZ30G:'Gizzard 30G R15' };
    let records = [], current = null, operation = null, busy = false, layouts = new Map(), readSequence = 0;
    const draftKey = page === 'detail' ? 'detail:' + new URLSearchParams(location.search).get('id') : 'report';
    function element(tag, text) { const node = document.createElement(tag); if (text !== undefined) node.textContent = String(text ?? '—'); return node; }
    function message(text, tone = 'info') { $('feedback').textContent = text; $('feedback').dataset.tone = tone; }
    function values(form) { return Object.fromEntries(new FormData(form)); }
    function setValues(form, data) { Object.entries(data || {}).forEach(([key,value]) => { const field = form.elements.namedItem(key); if (!field || field.disabled) return; if (field.type === 'checkbox') field.checked = !!value; else field.value = value ?? ''; }); }
    function iso(value) { return value ? new Date(value + ':00+07:00').toISOString() : ''; }
    function localTime(value) { if (!value || !Number.isFinite(Date.parse(value))) return ''; return new Date(Date.parse(value) + 7*3600000).toISOString().slice(0,16); }
    function downtime(record) { const time = domain.duration(record); return time.durationMin !== null ? time.durationMin.toFixed(1) + ' min' : time.elapsedDowntimeMin !== null ? time.elapsedDowntimeMin.toFixed(1) + ' min (กำลังหยุด)' : 'ไม่ทราบเวลา'; }
    function detailLink(record) { const a = element('a','เปิดใบงาน'); a.href = 'MachineBreakdownEventDetail.html?id=' + encodeURIComponent(record.eventId); return a; }
    function draft(form) { const saved = client.saveDraft(draftKey,{ values:values(form),operation }); if (!saved) message('เก็บร่างไม่ได้: พื้นที่ browser ไม่พร้อมใช้งาน กรุณาคงหน้านี้ไว้','error'); return saved; }
    function permitted(action,station) {
        const caps = client.getCapabilities(), roles = caps.roles || [], stations = caps.stations || [];
        const allowed = {record_breakdown:['breakdownReporter','breakdownEditor','breakdownAdmin'],update_breakdown:['breakdownEditor','breakdownAdmin'],close_breakdown:['breakdownApprover','breakdownAdmin'],correct_breakdown:['breakdownAdmin']}[action] || [];
        return caps.writesEnabled && allowed.some(role => roles.includes(role)) && (stations.includes('*') || stations.includes(station));
    }
    function gates() {
        const enabled = client.getCapabilities().writesEnabled && !busy && !operation;
        if ($('saveReport')) $('saveReport').disabled = !enabled || !permitted('record_breakdown',$('breakdownForm').elements.station.value) || !layouts.get(domain.machineId($('breakdownForm').elements.station.value));
        document.querySelectorAll('[data-action]').forEach(button => {
            const state = current?.breakdownStatus, action = button.dataset.action;
            const canonicalTime = !!current?.startedAt && Number.isFinite(Date.parse(current.startedAt)) && current.timeQuality !== 'legacy_incomplete';
            const allowed = current?.revision && !current?.voidedAt && (action === 'correct' || action === 'void' || (canonicalTime && ((state === 'Open' && ['assign','repair','update','monitor'].includes(action)) || (state === 'Monitoring' && ['update','close'].includes(action)))));
            const apiAction = action === 'close' ? 'close_breakdown' : ['correct','void'].includes(action) ? 'correct_breakdown' : 'update_breakdown';
            button.disabled = !enabled || !allowed || !permitted(apiAction,current?.station);
        });
        if ($('checkReceipt')) $('checkReceipt').hidden = !operation;
        if ($('retryOperation')) $('retryOperation').hidden = !operation;
        if ($('checkReceipt')) $('checkReceipt').disabled = busy;
        if ($('retryOperation')) $('retryOperation').disabled = busy || !client.getCapabilities().writesEnabled;
    }
    async function receipt(result,form) {
        if (result.ok === true && result.confirmed === true && result.state === 'saved') {
            operation = null; client.clearDraft(draftKey);
            message('ยืนยันบันทึกแล้ว: ' + result.recordId + ' · revision ' + result.revision,'success');
            if (page === 'log') { form.reset(); form.elements.startedAt.value = localTime(new Date().toISOString()); selectMachine(form.elements.station.value); await loadRecords(); message('ยืนยันบันทึกแล้ว: ' + result.recordId + ' · revision ' + result.revision,'success'); const link = detailLink({eventId:result.recordId}); $('feedback').append(' ',link); }
            else await loadDetail();
        } else {
            message(result.state === 'rejected' ? 'ระบบไม่รับคำขอ: ' + (result.code || result.message || 'ตรวจข้อมูลหรือสิทธิ์') : 'ยังยืนยันผลไม่ได้ ร่างและ Request ID เดิมยังอยู่ ตรวจผลก่อนส่งรายการใหม่','error');
            if (result.state === 'rejected') operation = null;
            draft(form);
        }
    }
    async function submit(action,payload,revision,form) {
        if (busy || operation || !permitted(action,payload.station || current?.station)) return;
        operation = client.createOperation(action,payload,revision); if (!draft(form)) { operation = null; gates(); return; } busy = true; gates(); message('กำลังส่งคำขอ — ยังไม่ยืนยันบันทึก');
        try { await receipt(await client.submit(operation),form); } catch (error) { message('ยังยืนยันผลไม่ได้: ' + error.message,'error'); }
        finally { busy = false; gates(); }
    }
    function bindRecovery(form) {
        $('checkReceipt').addEventListener('click', async () => { if (!operation || busy) return; busy = true; gates(); try { await receipt(await client.status(operation.requestId,operation),form); } catch (e) { message('ตรวจผลไม่ได้: ' + e.message + ' · คง Request ID เดิมไว้','error'); } finally { busy = false; gates(); } });
        $('retryOperation').addEventListener('click', async () => { if (!operation || busy) return; busy = true; gates(); try { await receipt(await client.submit(operation),form); } finally { busy = false; gates(); } });
    }
    function selectMachine(station) {
        const form = $('breakdownForm'); form.elements.station.value = station;
        const record = layouts.get(domain.machineId(station));
        const code = record ? Object.keys(products).find(key => key === record.product_name || products[key] === record.product_name) : '';
        form.elements.productLine.value = code || '';
        document.querySelectorAll('[data-machine]').forEach(button => { const selected = button.dataset.machine === station; button.setAttribute('aria-pressed',String(selected)); button.closest('[data-machine-card]').classList.toggle('is-selected',selected); });
        gates();
    }
    async function loadLayout() {
        try {
            let data;
            if (window.BREAKDOWN_TRANSPORT?.readLayout && client.getCapabilities().readable) {
                data = await window.BREAKDOWN_TRANSPORT.readLayout();
            } else {
                const response = await fetch(window.YakitoriRuntime.buildApiUrl('MachineLayout_DataLog',{action:'read_machine_layout',ts:Date.now()}),{cache:'no-store'});
                if (!response.ok) throw new Error('Invalid Configuration feed');
                data = await response.json();
            }
            if (data.status !== 'success' || !Array.isArray(data.records)) throw new Error('Invalid Configuration feed');
            if (window.BREAKDOWN_SUPABASE?.environment === 'staging' && data.environment !== 'staging') throw new Error('Configuration environment mismatch');
            layouts = new Map(data.records.map(record => [record.machine_id,record]));
            domain.stations.forEach(station => {
                const record = layouts.get(domain.machineId(station)), status = record?.machine_status;
                const product = document.querySelector('[data-machine-product="' + station + '"]'), label = document.querySelector('[data-machine-status="' + station + '"]'), dot = document.querySelector('[data-machine-dot="' + station + '"]');
                product.textContent = record?.product_name || 'ไม่ทราบสินค้า'; label.textContent = ({running:'พร้อมใช้งาน',maintenance:'กำลังบำรุงรักษา',idle:'ยังไม่ติดตั้ง / ไม่ใช้งาน',fault:'ขัดข้อง'})[status] || 'ไม่ทราบสถานะ';
                dot.className = 'machine-status-dot ' + (({running:'status-ready',maintenance:'status-maintenance',idle:'status-not-installed',fault:'status-fault'})[status] || '');
            });
            selectMachine($('breakdownForm').elements.station.value);
        } catch (e) { layouts = new Map(); message('อ่าน Configuration ล่าสุดไม่ได้ กรุณาลองใหม่ สถานะที่แสดงอาจเป็นข้อมูลเก่า','error'); gates(); }
    }
    async function loadRecords() {
        const sequence = ++readSequence;
        try { const result = await client.readRecords(); if (sequence !== readSequence) return; records = result.records; message('อ่านข้อมูลยืนยันล่าสุด · ' + domain.formatTime(result.asOf)); if (page === 'events') renderEvents(); else renderHistory(); }
        catch (e) { message('อ่านข้อมูลไม่ได้: ' + e.message + (records.length ? ' · แสดงข้อมูลเดิม (stale)' : ' · ยังไม่มีข้อมูลยืนยัน'),'error'); }
    }
    function renderHistory() { const host = $('breakdownHistory'); host.replaceChildren(); if (!records.length) host.append(element('p','ยังไม่มีเหตุการณ์ที่ยืนยันจากระบบ')); records.slice(0,10).forEach(record => { const p = element('p',record.eventId + ' · ' + record.station + ' · ' + record.breakdownStatus + ' · ' + record.symptom + ' '); p.append(detailLink(record)); host.append(p); }); }
    function renderEvents() {
        const filters = values($('filters')), search = (filters.search || '').toLocaleLowerCase();
        const filtered = records.filter(record => ['station','productCode','shift'].every(key => !filters[key] || String(record[key] || (key === 'productCode' ? record.productLine || record.line : '')) === filters[key]) && (!filters.breakdownStatus || (filters.breakdownStatus === 'Voided' ? !!record.voidedAt : !record.voidedAt && record.breakdownStatus === filters.breakdownStatus)) && (!filters.from || localTime(record.startedAt).slice(0,10) >= filters.from) && (!filters.to || (localTime(record.startedAt).slice(0,10) && localTime(record.startedAt).slice(0,10) <= filters.to)) && [record.eventId,record.symptom,record.owner,record.component].join(' ').toLocaleLowerCase().includes(search));
        $('eventsCountLabel').textContent = filtered.length + ' / ' + records.length + ' events';
        const body = $('eventsTableBody'); body.replaceChildren();
        filtered.forEach(record => { const tr = element('tr'); [record.eventId,[record.station,record.productNameSnapshot || products[record.productCode || record.productLine || record.line],record.shift].filter(Boolean).join(' / '),domain.formatTime(record.startedAt),record.voidedAt ? 'Voided' : record.breakdownStatus + ' / ' + (record.repairStage || '—'),record.symptom,downtime(record)].forEach(value => tr.append(element('td',value))); const cell = element('td'); if (record.eventId) cell.append(detailLink(record)); tr.append(cell); body.append(tr); });
        if (!filtered.length) { const cell = element('td',records.length ? 'ไม่พบรายการตามตัวกรอง' : 'ไม่มีเหตุการณ์ในข้อมูลยืนยันล่าสุด'); cell.colSpan = 7; const row = element('tr'); row.append(cell); body.append(row); }
    }
    async function loadDetail() {
        const id = new URLSearchParams(location.search).get('id');
        try {
            const result = id ? await client.readEvent(id) : {record:null}; current = result.record;
            if (!current || current.eventId !== id) { $('emptyState').hidden = false; $('detailApp').hidden = true; current = null; gates(); return; }
            $('emptyState').hidden = true; $('detailApp').hidden = false; $('metricId').textContent = current.eventId;
            $('legacyWarning').hidden = current.timeQuality !== 'legacy_incomplete' && Number.isFinite(Date.parse(current.startedAt || ''));
            const grid = $('incidentDetailGrid'); grid.replaceChildren();
            const fields = [['เครื่อง',current.station],['สินค้า ณ เหตุการณ์',current.productNameSnapshot || products[current.productCode || current.productLine || current.line]],['กะ',current.shift],['สถานะ',current.voidedAt ? 'Voided' : current.breakdownStatus + ' / ' + (current.repairStage || '—')],['Revision',current.revision],['เริ่มหยุด',domain.formatTime(current.startedAt)],['คืนเครื่อง',domain.formatTime(current.restoredAt)],['ปิดงาน',domain.formatTime(current.closedAt)],['Downtime',downtime(current)],['อาการ',current.symptom],['สาเหตุ',current.confirmedRootCause],['วิธีแก้ไข',current.actionTaken],['ผู้รับผิดชอบ',current.owner],['ผลตรวจรับ',current.verificationResult],['เหตุผลยกเลิก',current.voidReason]];
            fields.forEach(([title,value]) => { const div = element('div'); div.append(element('dt',title),element('dd',value || '—')); grid.append(div); });
            const timeline = $('detailTimeline'); timeline.replaceChildren(); (result.audit || []).forEach(entry => timeline.append(element('li',[entry.revision,entry.action,domain.formatTime(entry.timestamp || entry.createdAt),entry.reason].filter(Boolean).join(' · '))));
            $('auditState').textContent = result.audit?.length ? '' : 'ไม่มีประวัติ audit ที่ช่องทางอ่านนี้เปิดเผย';
            if (!operation) { const editable = {...current}; ['assignedAt','repairStartedAt','restoredAt','verifiedAt'].forEach(key => editable[key] = localTime(current[key])); setValues($('workflowForm'),editable); }
            gates();
        } catch (e) { message('อ่านใบงานไม่ได้: ' + e.message + (current ? ' · ข้อมูลที่แสดงเป็นข้อมูลเดิม' : ''),'error'); gates(); }
    }
    function workflow(action) {
        const form = $('workflowForm'), data = values(form), payload = {eventId:current.eventId};
        ['owner','confirmedRootCause','actionTaken','verifiedBy','verificationResult','causePendingReason'].forEach(key => { if (data[key]) payload[key] = data[key]; });
        ['assignedAt','repairStartedAt','restoredAt','verifiedAt'].forEach(key => { if (data[key]) payload[key] = iso(data[key]); });
        payload.causePending = form.elements.causePending.checked;
        let apiAction = 'update_breakdown';
        if (action === 'assign') { if (!data.owner || !data.assignedAt) return message('ระบุผู้รับผิดชอบและเวลาเข้ารับงาน','error'); payload.repairStage = 'Assigned'; }
        if (action === 'repair') { if (!data.repairStartedAt) return message('ระบุเวลาเริ่มซ่อม','error'); payload.repairStage = 'Repairing'; payload.breakdownStatus = 'Open'; }
        if (action === 'monitor') { if (!data.restoredAt || !data.actionTaken) return message('ระบุวันเวลาคืนเครื่องและวิธีแก้ไข','error'); payload.breakdownStatus = 'Monitoring'; }
        if (action === 'close') { if (!data.owner || !data.restoredAt || !data.actionTaken || !data.verifiedBy || !data.verifiedAt || !data.verificationResult || (!data.confirmedRootCause && !(payload.causePending && data.causePendingReason))) return message('ข้อมูลปิดงานไม่ครบ: ผู้รับผิดชอบ คืนเครื่อง วิธีแก้ไข ผู้ตรวจรับ เวลาตรวจ ผลตรวจ และสาเหตุ/เหตุผลรอตรวจ','error'); apiAction = 'close_breakdown'; }
        if (action === 'correct' || action === 'void') { apiAction = 'correct_breakdown'; if (action === 'void') { if (!data.voidReason) return message('ระบุเหตุผลยกเลิก','error'); payload.voidReason = data.voidReason; payload.voidedAt = new Date().toISOString(); payload.correctionReason = data.voidReason; } else { if (!data.correctionReason) return message('ระบุเหตุผลแก้ไข','error'); payload.correctionReason = data.correctionReason; } }
        submit(apiAction,payload,current.revision,form);
    }
    function transportMessage(caps) {
        if (caps.writesEnabled) return 'ช่องทางบันทึกพร้อม — backend ตรวจตัวตน สิทธิ์ และ receipt';
        return ({
            AUTH_REQUIRED: 'ยังไม่ได้เข้าสู่ระบบ Recording Portal — หน้านี้อ่านข้อมูลและเก็บร่างได้ แต่ยังส่งแจ้งเหตุไม่ได้',
            FORBIDDEN: 'บัญชีนี้ไม่มีสิทธิ์ใช้งาน Machine Breakdown — ติดต่อผู้ดูแลสิทธิ์',
            WRITES_DISABLED: 'ระบบบันทึกถูกปิดชั่วคราวโดยผู้ดูแล — เก็บร่างได้และรอตรวจสถานะระบบ',
            PROTOCOL_UNAVAILABLE: 'GAS ที่ใช้งานอยู่ยังไม่รองรับการยืนยันผลบันทึกรุ่นใหม่ — ยังส่งข้อมูลไม่ได้',
            TRANSPORT_UNAVAILABLE: 'ช่องทางยืนยันผลบันทึกยังไม่พร้อม — เก็บร่างได้ แต่ยังส่งข้อมูลไม่ได้',
            BACKEND_UNAVAILABLE: 'หน้านี้เป็นโหมดอ่านอย่างเดียว — Recording Portal/API ยังไม่พร้อมใช้งาน จึงส่งแจ้งเหตุไม่ได้'
        })[caps.reason] || 'Read-only: ยังไม่มีช่องทางยืนยันตัวตนและ receipt ที่พร้อมเขียน เก็บร่างได้ แต่ยังไม่ส่งข้อมูล';
    }
    async function init() {
        try { await client.health(); } catch (e) { message('ตรวจช่องทางบันทึกไม่ได้: ' + e.message,'error'); }
        const caps = client.getCapabilities(); $('transportState').textContent = transportMessage(caps);
        if (page === 'events') { $('filters').addEventListener('input',renderEvents); $('filters').addEventListener('submit',event => event.preventDefault()); $('reloadEvents').addEventListener('click',loadRecords); await loadRecords(); return; }
        const form = page === 'log' ? $('breakdownForm') : $('workflowForm');
        const saved = client.loadDraft(draftKey); if (saved) { setValues(form,saved.values); operation = saved.operation || null; if (operation && client.restoreOperation) client.restoreOperation(operation); message('คืนร่างเดิมแล้ว — ร่างยังไม่ใช่ข้อมูลยืนยัน'); }
        bindRecovery(form); form.addEventListener('input',() => draft(form));
        if (page === 'log') {
            form.elements.symptom.required = true;
            if (!form.elements.startedAt.value) form.elements.startedAt.value = localTime(new Date().toISOString());
            document.querySelectorAll('[data-machine]').forEach(button => button.addEventListener('click',() => { selectMachine(button.dataset.machine); draft(form); }));
            $('reloadLayout').addEventListener('click',loadLayout);
            $('saveDraft').addEventListener('click',() => { if (draft(form)) message('เก็บร่างใน browser แล้ว — ยังไม่ส่งข้อมูล'); });
            form.addEventListener('submit',event => {
                event.preventDefault(); if (!form.reportValidity()) return;
                const data = values(form), layout = layouts.get(domain.machineId(data.station)), productCode = form.elements.productLine.value;
                if (!layout || !productCode) return message('Configuration ไม่มีสินค้าที่รู้จักสำหรับเครื่องนี้ กรุณาตรวจการตั้งค่า','error');
                const active = domain.activeForMachine(records,data.station);
                const machineFailure = data.eventType === 'Machine';
                const stopping = machineFailure && active.find(record => record.breakdownStatus === 'Open' && !record.restoredAt && record.isMachineStop !== false && record.isHistorical !== true);
                if (stopping) { message('เครื่องนี้มีเหตุหยุดเปิดอยู่ กรุณาอัปเดตเหตุเดิม','error'); $('feedback').append(' ',detailLink(stopping)); return; }
                const payload = {station:data.station,machineId:domain.machineId(data.station),productCode,productNameSnapshot:layout.product_name,layoutSnapshotSource:'configuration',layoutRevisionSnapshot:layout.revision || layout.updated_at || '',startedAt:iso(data.startedAt),shift:data.shift,eventType:data.eventType,stopCategory:data.eventType,isMachineStop:machineFailure,symptom:data.symptom,component:data.component,severity:data.severity,note:data.note};
                const restored = machineFailure && active.find(record => record.restoredAt && record.isMachineFailure !== false && ['Machine','machine_failure','Machine Failure','Mechanical'].includes(record.stopCategory || record.eventType));
                if (restored) payload.relatedEventId = restored.eventId;
                submit('record_breakdown',payload,undefined,form);
            });
            await Promise.all([loadLayout(),loadRecords()]);
        } else { form.addEventListener('submit',event => event.preventDefault()); document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click',() => workflow(button.dataset.action))); $('reloadDetail').addEventListener('click',loadDetail); await loadDetail(); }
        gates();
    }
    init().catch(error => message('เปิด workflow ไม่ได้: ' + error.message,'error'));
})();
