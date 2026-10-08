(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LayoutDomain = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const machineIds = ['YK-101', 'YK-102', 'YK-103', 'YK-104'];
  const fields = ['machine_name', 'conveyor_name', 'product_name', 'installed_at', 'machine_status', 'last_breakdown_at', 'breakdown_detail'];
  const action = 'upsert_machine_layout', route = 'MachineLayout_DataLog';
  function fail(code) { throw Object.assign(new Error(code), { code }); }
  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
    return JSON.stringify(value);
  }
  function minuteDate(value) {
    if (typeof value !== 'string') fail('INVALID_DATE');
    if (!value) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) value += 'T00:00';
    const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
    if (!match) fail('INVALID_DATE');
    const [, y, m, d, h, min, sec = '00', fraction = '0', zone = '+07:00'] = match;
    const year = Number(y), month = Number(m), day = Number(d);
    if (year < 100 || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || Number(h) > 23 || Number(min) > 59) fail('INVALID_DATE');
    if (Number(sec) !== 0 || Number(fraction) !== 0) fail('DATE_MINUTE_PRECISION_REQUIRED');
    const date = new Date(`${y}-${m}-${d}T${h}:${min}:00${zone}`);
    if (!Number.isFinite(date.getTime())) fail('INVALID_DATE');
    return date.toISOString();
  }
  function validatePayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('INVALID_PAYLOAD');
    const allowed = ['machine_id', ...fields];
    if (Object.keys(payload).some(key => !allowed.includes(key)) || allowed.some(key => !Object.prototype.hasOwnProperty.call(payload, key))) fail('INVALID_PAYLOAD_FIELDS');
    if (!machineIds.includes(payload.machine_id)) fail('INVALID_MACHINE_ID');
    const result = { machine_id: payload.machine_id };
    const limits = { machine_name: 200, conveyor_name: 200, product_name: 200, machine_status: 32, breakdown_detail: 5000 };
    fields.forEach(field => {
      if (typeof payload[field] !== 'string' || /\u0000/.test(payload[field])) fail('INVALID_' + field.toUpperCase());
      if (limits[field] && payload[field].length > limits[field]) fail('INVALID_' + field.toUpperCase());
      result[field] = ['installed_at', 'last_breakdown_at'].includes(field) ? minuteDate(payload[field]) : payload[field];
    });
    if (!result.machine_name.trim()) fail('MACHINE_NAME_REQUIRED');
    if (!['running', 'idle', 'maintenance', 'fault'].includes(result.machine_status)) fail('INVALID_MACHINE_STATUS');
    return result;
  }
  function validateOperation(operation) {
    if (!operation || operation.protocolVersion !== 3 || operation.action !== action || !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(operation.requestId || '') || !Number.isSafeInteger(operation.expectedRevision) || operation.expectedRevision < 0) fail('INVALID_OPERATION');
    return { protocolVersion: 3, requestId: operation.requestId, action, payload: validatePayload(operation.payload), expectedRevision: operation.expectedRevision };
  }
  function hashInput(operation) {
    const op = validateOperation(operation);
    return canonical({ action: op.action, expectedRevision: op.expectedRevision, payload: op.payload });
  }
  return { machineIds, fields, action, route, canonical, minuteDate, validatePayload, normalizePayload: validatePayload, validateOperation, hashInput };
});
