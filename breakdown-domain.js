(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.BreakdownDomain = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const stations = ['M1', 'M2', 'M3', 'M4'];
    const machineId = station => stations.includes(station) ? 'YK-10' + (stations.indexOf(station) + 1) : '';
    function stationOf(record) {
        const station = String(record.station || '').toUpperCase();
        if (stations.includes(station)) return station;
        const index = ['YK-101', 'YK-102', 'YK-103', 'YK-104'].indexOf(record.machineId);
        if (index >= 0) return stations[index];
        const match = String(record.machineArea || '').toUpperCase().match(/\bM[1-4]\b/);
        return match ? match[0] : '';
    }
    function normalize(record) {
        const r = Object.assign({}, record);
        r.eventId = String(r.eventId || r.breakdownId || '');
        r.station = stationOf(r);
        r.machineId = machineId(r.station);
        r.breakdownStatus = ['Open', 'Monitoring', 'Closed'].includes(r.breakdownStatus || r.status) ? (r.breakdownStatus || r.status) : 'Unknown';
        r.symptom = String(r.symptom || r.rootCause || '');
        r.timeQuality = r.startedAt ? 'canonical' : 'legacy_incomplete';
        r.revision = Number.isInteger(Number(r.revision)) && Number(r.revision) > 0 ? Number(r.revision) : null;
        return r;
    }
    function duration(record, now = Date.now()) {
        const start = Date.parse(record.startedAt || '');
        const restored = Date.parse(record.restoredAt || '');
        return {
            durationMin: Number.isFinite(start) && Number.isFinite(restored) && restored >= start ? (restored - start) / 60000 : null,
            elapsedDowntimeMin: Number.isFinite(start) && !record.restoredAt && now >= start ? (now - start) / 60000 : null
        };
    }
    const active = r => !r.voidedAt && r.isHistorical !== true && r.isHistorical !== 'true' && r.isMachineStop !== false && r.isMachineFailure !== false && ['Open', 'Monitoring'].includes(r.breakdownStatus || r.status);
    function eventTime(r) {
        const n = Date.parse(r.startedAt || r.updatedAt || r.createdAt || '');
        return Number.isFinite(n) ? n : 0;
    }
    function activeForMachine(records, station) {
        return records.map(normalize).filter(r => r.station === station && active(r)).sort((a, b) => (a.breakdownStatus === 'Open' ? 0 : 1) - (b.breakdownStatus === 'Open' ? 0 : 1) || eventTime(b) - eventTime(a) || (b.revision || 0) - (a.revision || 0));
    }
    function machineState(records, station) {
        const candidates = records.map(normalize).filter(r => r.station === station && !r.voidedAt && r.isHistorical !== true && r.isHistorical !== 'true' && r.isMachineStop !== false && r.isMachineFailure !== false).sort((a, b) => eventTime(b) - eventTime(a));
        const actives = activeForMachine(candidates, station);
        return { station, active: actives, latest: actives[0] || candidates[0] || null, activeCount: actives.length };
    }
    function canonical(value) {
        if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
        if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
        return JSON.stringify(value);
    }
    function formatTime(value) {
        const time = Date.parse(value || '');
        return Number.isFinite(time) ? new Date(time).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : '—';
    }
    return { stations, machineId, stationOf, normalize, duration, active, activeForMachine, machineState, eventTime, canonical, formatTime };
});
