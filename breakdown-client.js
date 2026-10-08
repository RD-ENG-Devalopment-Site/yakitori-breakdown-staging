(function (root) {
    'use strict';
    const domain = root.BreakdownDomain;
    const apiUrl = root.BREAKDOWN_API_URL || root.YakitoriRuntime?.CONFIG?.appsScriptUrl || 'https://script.google.com/macros/s/AKfycbzCP20irjQdA65MEQXeB4KW8kkvmYRMJYbL8Zm1IdklPpKvvmTIIFcx0Zs_pm3Nwyel/exec';
    let capabilities = { writesEnabled: false, readable: false, protocol: null, reason: 'NOT_CHECKED' };
    let account = 'read-only';
    const operations = new Map();
    function error(code, message) { return Object.assign(new Error(message || code), { code }); }
    async function publicRead(action, params = {}) {
        // Staging resolves the pinned target or fails closed, including after
        // authenticated health fails. No fallback to the production constant.
        const selected = root.BREAKDOWN_SUPABASE;
        const target = selected?.environment === 'staging' ? root.YakitoriRuntime?.apiEndpoint?.() : apiUrl;
        if (selected?.environment === 'staging' && !target) throw error('STAGING_CONFIG_REQUIRED');
        const url = new URL(target);
        url.searchParams.set('page', 'api'); url.searchParams.set('action', action);
        if (action === 'read_breakdown') url.searchParams.set('sheet', 'MachineBreakdownLog');
        Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) throw error('READ_FAILED', 'HTTP ' + response.status);
        const data = await response.json();
        if (selected?.environment === 'staging' && data.environment !== 'staging') throw error('ENVIRONMENT_MISMATCH');
        if (data.status !== 'success') throw error(data.code || 'READ_FAILED', data.message);
        return data;
    }
    const sameOrigin = {
        async request(action, body, params = {}) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000);
            let response;
            const query = new URLSearchParams({ action, ...params });
            try {
                response = await fetch('/api/breakdown?' + query, {
                    method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
                    headers: body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': sameOrigin.csrf || '' } : {},
                    signal: controller.signal,
                    ...(body ? { body: JSON.stringify(body) } : {})
                });
            } catch (_) { throw error('BACKEND_UNAVAILABLE', 'Recording Portal API unavailable'); }
            finally { clearTimeout(timeout); }
            if (response.status === 401 || response.status === 403) capabilities.writesEnabled = false;
            if (!response.ok) {
                const failure = await response.json().catch(() => null);
                if (['submit', 'status'].includes(action) && failure?.state === 'rejected') return failure;
                const code = failure?.code || (response.status === 401 ? 'AUTH_REQUIRED' : response.status === 403 ? 'FORBIDDEN' : response.status === 404 ? 'BACKEND_UNAVAILABLE' : 'TRANSPORT_ERROR');
                throw error(code, failure?.message || 'HTTP ' + response.status);
            }
            return response.json();
        },
        async health() { const data = await sameOrigin.request('health'); sameOrigin.csrf = data.session?.csrfToken || ''; return data; },
        submit: operation => sameOrigin.request('submit', operation),
        status: requestId => sameOrigin.request('status', { requestId }),
        readRecords: () => sameOrigin.request('read_breakdown'),
        readEvent: id => sameOrigin.request('read_breakdown_event', null, { eventId: id })
    };
    const adapter = () => capabilities.readable ? (root.BREAKDOWN_TRANSPORT || sameOrigin) : null;
    async function health() {
        let transport = root.BREAKDOWN_TRANSPORT || sameOrigin;
        let data, transportFailure = '';
        try { data = await transport.health(); }
        catch (failure) { transportFailure = failure?.code || 'BACKEND_UNAVAILABLE'; transport = null; data = await publicRead('read_health'); }
        account = typeof data.session?.subject === 'string' ? data.session.subject : 'read-only';
        capabilities = {
            protocol: data.writeProtocolVersion,
            readable: !!(transport && data.session?.authenticated === true && data.readableTransport === true && (transport !== sameOrigin || sameOrigin.csrf)),
            writesEnabled: false,
            reason: '',
            roles: Array.isArray(data.session?.roles) ? data.session.roles.slice() : [],
            stations: Array.isArray(data.session?.stations) ? data.session.stations.slice() : []
        };
        capabilities.writesEnabled = data.writeProtocolVersion === 2 && data.breakdownWritesEnabled === true && capabilities.readable;
        if (!capabilities.writesEnabled) capabilities.reason = transportFailure
            || (data.session?.authenticated !== true ? 'AUTH_REQUIRED'
                : data.writeProtocolVersion !== 2 ? 'PROTOCOL_UNAVAILABLE'
                    : data.breakdownWritesEnabled !== true ? 'WRITES_DISABLED'
                        : 'TRANSPORT_UNAVAILABLE');
        operations.clear();
        const pending = loadDraft('pending-operations');
        if (capabilities.readable && Array.isArray(pending)) pending.forEach(operation => operations.set(operation.requestId, { operation, account }));
        return getCapabilities();
    }
    function getCapabilities() { return Object.assign({}, capabilities); }
    async function readRecords() {
        const data = adapter()?.readRecords ? await adapter().readRecords() : await publicRead('read_breakdown');
        if (data.status !== 'success' || !Array.isArray(data._records)) throw error('INVALID_FEED', 'Invalid breakdown feed');
        return { records: data._records.map(domain.normalize), asOf: data.asOf || new Date().toISOString(), stale: false };
    }
    async function readEvent(id) {
        if (adapter()?.readEvent) {
            const data = await adapter().readEvent(id);
            if (data.code === 'NOT_FOUND') return { record: null };
            if (data.status !== 'success') throw error(data.code || 'READ_FAILED', data.message);
            return { record: data.record ? domain.normalize(data.record) : null, audit: data.audit || [] };
        }
        const result = await readRecords();
        return { record: result.records.find(r => r.eventId === id) || null, audit: [] };
    }
    function createOperation(action, payload, expectedRevision) {
        const op = { protocolVersion: 2, requestId: root.crypto.randomUUID(), action, payload: JSON.parse(JSON.stringify(payload)) };
        if (expectedRevision !== undefined) op.expectedRevision = expectedRevision;
        return op;
    }
    async function hash(operation) {
        const canonical = domain.canonical({ action: operation.action, expectedRevision: operation.expectedRevision ?? null, payload: operation.payload });
        const digest = await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
        return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    }
    async function confirm(operation, response) {
        const receipt = response.receipt || response;
        const record = response.record;
        const valid = receipt.protocolVersion === 2
            && receipt.requestId === operation.requestId
            && receipt.action === operation.action
            && receipt.payloadHash === await hash(operation)
            && typeof receipt.recordId === 'string' && receipt.recordId.length > 0
            && Number.isInteger(receipt.revision) && receipt.revision > 0
            && Number.isFinite(Date.parse(receipt.savedAt || ''))
            && (!operation.payload.eventId || receipt.recordId === operation.payload.eventId)
            && (operation.action !== 'record_breakdown' || receipt.revision === 1)
            && (operation.expectedRevision === undefined || receipt.revision === operation.expectedRevision + 1)
            && (!record || (record.eventId === receipt.recordId && Number(record.revision) === receipt.revision));
        if (receipt.state === 'saved' && valid) return { ...response, ...receipt, record: record ? domain.normalize(record) : null, ok: true, confirmed: true };
        return { ...response, requestId: operation.requestId, state: ['rejected', 'pending'].includes(receipt.state) ? receipt.state : 'unknown', ok: false, confirmed: false };
    }
    async function submit(operation) {
        if (!capabilities.writesEnabled || !adapter()?.submit) return { ok: false, confirmed: false, state: 'rejected', code: 'WRITES_DISABLED', requestId: operation.requestId };
        operations.set(operation.requestId, { operation, account });
        if (!persistOperations()) return { ok: false, confirmed: false, state: 'rejected', code: 'DRAFT_STORAGE_UNAVAILABLE', requestId: operation.requestId };
        try { const result = await confirm(operation, await adapter().submit(operation)); if (result.confirmed || result.state === 'rejected') { operations.delete(operation.requestId); persistOperations(); } return result; }
        catch (e) { return { ok: false, confirmed: false, state: 'unknown', code: e.code || 'TRANSPORT_ERROR', requestId: operation.requestId }; }
    }
    async function mutate(action, payload, expectedRevision) {
        const fingerprint = domain.canonical({ action, payload, expectedRevision: expectedRevision ?? null });
        const old = [...operations.values()].find(v => v.account === account && domain.canonical({ action: v.operation.action, payload: v.operation.payload, expectedRevision: v.operation.expectedRevision ?? null }) === fingerprint);
        return submit(old?.operation || createOperation(action, payload, expectedRevision));
    }
    async function status(requestId, operation) {
        if (operation && operation.requestId === requestId && capabilities.readable) { operations.set(requestId, { operation, account }); persistOperations(); }
        const saved = operations.get(requestId);
        if (!saved || saved.account !== account || !adapter()?.status || !capabilities.readable) throw error('STATUS_UNAVAILABLE');
        const response = await adapter().status(requestId);
        // Rejection of a status-query envelope does not prove the original write was rejected.
        const result = response.status === 'error' || (response.state === 'rejected' && response.requestId !== requestId)
            ? { ...response, requestId, state: 'unknown', ok: false, confirmed: false }
            : await confirm(saved.operation, response);
        if (result.confirmed || result.state === 'rejected') { operations.delete(requestId); persistOperations(); }
        return result;
    }
    function persistOperations() { return saveDraft('pending-operations', [...operations.values()].filter(v => v.account === account).map(v => v.operation)); }
    function storageKey(key) { return 'breakdown-v2-draft:' + account + ':' + key; }
    function saveDraft(key, data) { try { localStorage.setItem(storageKey(key), JSON.stringify(data)); return true; } catch (_) { return false; } }
    function loadDraft(key) { try { return JSON.parse(localStorage.getItem(storageKey(key)) || 'null'); } catch (_) { return null; } }
    function clearDraft(key) { try { localStorage.removeItem(storageKey(key)); } catch (_) {} }
    root.BreakdownClient = { health, getCapabilities, readRecords, readEvent, createOperation, submit, mutate, status, saveDraft, loadDraft, clearDraft };
})(typeof window !== 'undefined' ? window : globalThis);
