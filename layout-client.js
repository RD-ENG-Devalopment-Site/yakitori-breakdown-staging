(function (root) {
  'use strict';
  const domain = root.LayoutDomain;
  const mode = root.LAYOUT_TRANSPORT_MODE === undefined ? 'secure' : root.LAYOUT_TRANSPORT_MODE;
  let capabilities = { mode, readable: false, writesEnabled: false }, account = '', csrf = '';
  const operations = new Map();
  const owners = new Map();
  const error = code => Object.assign(new Error(code), { code });
  function secure() { return mode === 'secure'; }
  function endpoint() {
    if (!secure() || typeof root.LAYOUT_API_URL !== 'string' || !root.LAYOUT_API_URL) throw error('SECURE_TRANSPORT_NOT_CONFIGURED');
    const url = new URL(root.LAYOUT_API_URL, root.location.href);
    if (url.origin !== root.location.origin || url.username || url.password || url.hash) throw error('SAME_ORIGIN_TRANSPORT_REQUIRED');
    return url;
  }
  async function request(action, body, params = {}) {
    const url = endpoint(); url.searchParams.set('action', action);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    const response = await root.fetch(url.toString(), {
      method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      signal: root.AbortSignal.timeout(20000),
      headers: body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {},
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const data = await response.json();
    if (response.status === 401 || response.status === 403) { capabilities.writesEnabled = capabilities.readable = false; }
    if (!response.ok && !(['submit', 'status'].includes(action) && data.state === 'rejected')) throw error(data.code || 'TRANSPORT_ERROR');
    return data;
  }
  function key() { if (!account) throw error('ACCOUNT_UNAVAILABLE'); return 'layout-v3-pending:' + account; }
  function persist() { try { root.localStorage.setItem(key(), JSON.stringify([...operations.values()])); return true; } catch (_) { return false; } }
  async function health() {
    capabilities = { mode, readable: false, writesEnabled: false }; csrf = '';
    if (!secure()) throw error('INVALID_TRANSPORT_MODE');
    const data = await request('health');
    const expiresAt = new Date(data.session?.expiresAt).getTime();
    if (data.layoutWriteProtocolVersion !== 3 || data.readableTransport !== true || data.session?.authenticated !== true || typeof data.session.subject !== 'string' || !data.session.subject || typeof data.session.csrfToken !== 'string' || !data.session.csrfToken || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw error('SECURE_HEALTH_REQUIRED');
    account = data.session.subject; csrf = data.session.csrfToken;
    operations.clear();
    capabilities = { mode, protocolVersion: 3, readable: true, writesEnabled: data.layoutWritesEnabled === true, account, expiresAt, roles: Array.isArray(data.session.roles) ? data.session.roles.slice() : [], machines: Array.isArray(data.session.machines) ? data.session.machines.slice() : [] };
    try {
      const pending = JSON.parse(root.localStorage.getItem(key()) || '[]');
      if (!Array.isArray(pending)) throw error('INVALID_PENDING_OPERATIONS');
      pending.forEach(operation => { const op = domain.validateOperation(operation); operations.set(op.requestId, op); owners.set(op.requestId, account); });
    } catch (_) { capabilities.writesEnabled = false; throw error('PENDING_STORAGE_INVALID'); }
    return getCapabilities();
  }
  function getCapabilities() { return { ...capabilities }; }
  function pending() { return [...operations.values()].map(op => JSON.parse(JSON.stringify(op))); }
  function draftKey(machineId) { if (!account || !domain.machineIds.includes(machineId)) throw error('DRAFT_ACCOUNT_REQUIRED'); return 'layout-v3-draft:' + account + ':' + machineId; }
  function saveDraft(machineId, value) { try { root.localStorage.setItem(draftKey(machineId), JSON.stringify(value)); return true; } catch (_) { return false; } }
  function loadDraft(machineId) { try { return JSON.parse(root.localStorage.getItem(draftKey(machineId)) || 'null'); } catch (_) { return null; } }
  function clearDraft(machineId) { try { root.localStorage.removeItem(draftKey(machineId)); } catch (_) {} }
  async function readRecords(machineId) {
    if (!capabilities.readable) throw error('SECURE_HEALTH_REQUIRED');
    if (machineId !== undefined && !domain.machineIds.includes(machineId)) throw error('INVALID_MACHINE_ID');
    const ids = machineId ? [machineId] : capabilities.machines.filter(id => domain.machineIds.includes(id));
    if (!ids.length) throw error('MACHINE_PERMISSION_REQUIRED');
    const feeds = await Promise.all(ids.map(id => request('read_layout_editor', null, { machine_id: id })));
    if (feeds.some(data => data.status !== 'success' || !Array.isArray(data.records))) throw error('INVALID_LAYOUT_FEED');
    const data = { status: 'success', records: feeds.flatMap(feed => feed.records) };
    if (data.status !== 'success' || !Array.isArray(data.records)) throw error('INVALID_LAYOUT_FEED');
    const seen = new Set();
    data.records.forEach(record => {
      if (!domain.machineIds.includes(record.machine_id) || seen.has(record.machine_id) || !Number.isSafeInteger(record.revision) || record.revision < 1) throw error('INVALID_LAYOUT_REVISION');
      seen.add(record.machine_id);
      domain.validatePayload(Object.fromEntries(['machine_id', ...domain.fields].map(field => [field, record[field]])));
    });
    return data;
  }
  function createOperation(payload, expectedRevision) {
    if (!capabilities.readable || !account) throw error('SECURE_HEALTH_REQUIRED');
    const op = domain.validateOperation({ protocolVersion: 3, requestId: root.crypto.randomUUID(), action: domain.action, payload, expectedRevision });
    owners.set(op.requestId, account); return op;
  }
  async function hash(operation) {
    const digest = await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(domain.hashInput(operation)));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  async function confirm(operation, response) {
    const receipt = response.receipt || response;
    const valid = receipt.protocolVersion === 3 && receipt.actor === account && receipt.requestId === operation.requestId && receipt.action === domain.action && receipt.route === domain.route && receipt.payloadHash === await hash(operation) && receipt.recordId === operation.payload.machine_id && receipt.revision === operation.expectedRevision + 1 && Number.isFinite(Date.parse(receipt.savedAt || ''));
    if (valid && (receipt.state === 'saved' || receipt.status === 'confirmed')) return { ...response, receipt, requestId: operation.requestId, state: 'saved', confirmed: true, ok: true };
    // Only an operation-scoped terminal rejection resolves uncertainty.
    const terminal = ['INVALID_REQUEST', 'AUTH_REQUIRED', 'AUTH_EXPIRED', 'FORBIDDEN', 'WRITES_DISABLED', 'STORAGE_REQUIRED', 'VALIDATION', 'REVISION_CONFLICT', 'REQUEST_CONFLICT', 'PAYLOAD_TOO_LARGE', 'SCHEMA_REQUIRED', 'INVALID_ROUTE', 'NOT_FOUND'];
    const boundRejection = receipt.protocolVersion === 3 && receipt.actor === account && receipt.requestId === operation.requestId && receipt.action === domain.action && receipt.route === domain.route && receipt.payloadHash === await hash(operation) && receipt.recordId === operation.payload.machine_id && receipt.expectedRevision === operation.expectedRevision;
    if (boundRejection && receipt.state === 'rejected' && terminal.includes(receipt.code)) return { ...response, requestId: operation.requestId, state: 'rejected', confirmed: false, ok: false };
    return { ...response, requestId: operation.requestId, state: receipt.state === 'pending' ? 'pending' : 'unknown', confirmed: false, ok: false };
  }
  function remember(operation) {
    const op = domain.validateOperation(operation);
    const existing = operations.get(op.requestId);
    if (existing && domain.canonical(existing) !== domain.canonical(op)) throw error('REQUEST_ID_CONFLICT');
    const other = [...operations.values()].find(value => value.payload.machine_id === op.payload.machine_id && value.requestId !== op.requestId);
    if (other) throw error('MACHINE_OPERATION_PENDING');
    operations.set(op.requestId, op);
    if (!persist()) throw error('PENDING_STORAGE_UNAVAILABLE');
    return op;
  }
  async function settle(operation, response) {
    const result = await confirm(operation, response);
    if (result.confirmed || result.state === 'rejected') { operations.delete(operation.requestId); persist(); }
    return result;
  }
  async function submit(operation) {
    await health(); // Bind every mutation to the current server session, never the browser gate.
    if (!capabilities.writesEnabled) throw error('WRITES_DISABLED');
    if (!capabilities.machines.includes(operation.payload.machine_id)) throw error('MACHINE_PERMISSION_REQUIRED');
    if (owners.get(operation.requestId) !== account) throw error('OPERATION_ACCOUNT_CHANGED');
    const op = remember(operation);
    try { return await settle(op, await request('submit', op)); }
    catch (e) { return { requestId: op.requestId, state: 'unknown', confirmed: false, ok: false, code: e.code || 'TRANSPORT_ERROR' }; }
  }
  async function status(requestId) {
    await health();
    if (!capabilities.readable) throw error('SECURE_HEALTH_REQUIRED');
    const op = operations.get(requestId);
    if (!op) throw error('STATUS_UNAVAILABLE');
    try {
      const response = await request('status', { requestId, machine_id: op.payload.machine_id });
      if (response.status === 'error') return { ...response, requestId, state: 'unknown', confirmed: false, ok: false };
      return await settle(op, response);
    }
    catch (e) { return { requestId, state: 'unknown', confirmed: false, ok: false, code: e.code || 'TRANSPORT_ERROR' }; }
  }
  root.LayoutClient = { mode, isSecure: secure, health, getCapabilities, readRecords, createOperation, hash, submit, status, pending, saveDraft, loadDraft, clearDraft };
})(typeof window !== 'undefined' ? window : globalThis);
