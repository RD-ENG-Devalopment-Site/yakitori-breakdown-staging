(function () {
  'use strict';
  const layoutClient = window.LayoutClient;
  document.getElementById('app').hidden = false;
  const products = ['BL 23G R15 (M1)', 'BL 23G R15 (M2)', 'BB SKIN 25G R12', 'Neck Skin 40G R15', 'BB SKIN 35G F15', 'Gizzard 40G S18', 'Gizzard 30G R15'];
  const statuses = { running: 'พร้อมใช้งาน', idle: 'ไม่ใช้งาน', maintenance: 'กำลังบำรุงรักษา', fault: 'ขัดข้อง' };
  const fields = ['machine_name', 'conveyor_name', 'product_name', 'installed_at', 'machine_status', 'last_breakdown_at', 'breakdown_detail'];
  const dates = new Set(['installed_at', 'last_breakdown_at']);
  const rows = [];
  let busy = false, loaded = false;
  const message = document.getElementById('layoutMessage');
  const reload = document.getElementById('reloadLayout');
  const container = document.getElementById('machineRows');
  const selector = document.getElementById('selectedMachine');
  const requested = new URLSearchParams(location.search).get('machine');
  if (['YK-101', 'YK-102', 'YK-103', 'YK-104'].includes(requested)) selector.value = requested;
  let selected = selector.value;
  function announce(text, tone = '') { message.textContent = text; message.dataset.tone = tone; }
  function userError(error) {
    const code = error.code || error.message;
    if (['SECURE_TRANSPORT_NOT_CONFIGURED', 'SAME_ORIGIN_TRANSPORT_REQUIRED', 'INVALID_TRANSPORT_MODE', 'SECURE_HEALTH_REQUIRED', 'BACKEND_UNAVAILABLE', 'TRANSPORT_ERROR', 'INVALID_LAYOUT_FEED', 'INVALID_LAYOUT_REVISION'].includes(code) || error instanceof TypeError) return 'ระบบบันทึกยังไม่พร้อมใช้งาน · กรุณาติดต่อผู้ดูแลระบบ แล้วโหลดข้อมูลล่าสุดอีกครั้ง';
    if (['AUTH_REQUIRED', 'AUTH_EXPIRED', 'OPERATION_ACCOUNT_CHANGED'].includes(code)) return 'การเข้าสู่ระบบหมดอายุหรือเปลี่ยนบัญชี · กรุณาเข้าสู่ระบบด้วยบัญชีเดิมเพื่อตรวจผลคำขอ';
    if (['FORBIDDEN', 'MACHINE_PERMISSION_REQUIRED', 'MACHINE_DENIED', 'PERMISSION_DENIED', 'WRITES_DISABLED'].includes(code)) return 'บัญชีนี้ยังไม่สามารถบันทึกเครื่องที่เลือกได้ · กรุณาติดต่อผู้ดูแลระบบ';
    if (String(code).startsWith('PENDING_STORAGE')) return 'เก็บคำขอที่ยังไม่ยืนยันในเบราว์เซอร์ไม่ได้ · กรุณาเปิดการเก็บข้อมูลของเว็บไซต์ก่อนบันทึก';
    if (code === 'REVISION_CONFLICT') return 'ข้อมูลเครื่องถูกเปลี่ยนจากหน้าอื่น · โหลดข้อมูลล่าสุดก่อนแก้ไขและบันทึกอีกครั้ง';
    if (code === 'REQUEST_CONFLICT') return 'คำขอเดิมไม่ตรงกับข้อมูลที่ส่ง · ตรวจผลคำขอเดิมก่อนบันทึกอีกครั้ง';
    return 'ตรวจข้อมูลและการเชื่อมต่อ แล้วโหลดข้อมูลล่าสุดเพื่อลองอีกครั้ง';
  }
  function option(select, value, label) { select.add(new Option(label, value)); }
  // Unzoned Sheet values and datetime-local inputs explicitly mean Bangkok wall time.
  function canonicalDate(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const wall = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(text);
    if (wall) {
      const [, year, month, day, hour, minute, second = '00', fraction = '0'] = wall;
      const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}.${fraction.padEnd(3, '0')}+07:00`);
      if (!Number.isFinite(date.getTime()) || localDate(date.toISOString()).slice(0, 19) !== `${year}-${month}-${day}T${hour}:${minute}:${second}`) throw new Error('วันเวลาไม่ถูกต้อง');
      return date.toISOString();
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return canonicalDate(text + 'T00:00');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) throw new Error('รูปแบบวันเวลาไม่ถูกต้อง');
    const date = new Date(text);
    if (!Number.isFinite(date.getTime())) throw new Error('วันเวลาไม่ถูกต้อง');
    // Reject impossible dates rather than accepting Date's silent rollover.
    const day = Number(text.slice(8, 10)), month = Number(text.slice(5, 7)), year = Number(text.slice(0, 4));
    if (day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || month < 1 || month > 12 || Number(text.slice(11, 13)) > 23 || Number(text.slice(14, 16)) > 59 || (text[16] === ':' && Number(text.slice(17, 19)) > 59)) throw new Error('วันเวลาไม่ถูกต้อง');
    return date.toISOString();
  }
  function localDate(value) {
    if (!value) return '';
    return new Date(new Date(value).getTime() + 7 * 3600000).toISOString().slice(0, 19);
  }
  function normalized(record, field) {
    const value = String(record?.[field] ?? '');
    if (!dates.has(field)) return value;
    try { return canonicalDate(value); } catch (_) { return value; }
  }
  function draft(row) {
    return Object.fromEntries(fields.map(field => [field, dates.has(field) ? canonicalDate(row.inputs[field].value) : row.inputs[field].value]));
  }
  function dirty(row) {
    return fields.some(field => row.inputs[field].value !== row.baseline?.[field]);
  }
  function updateControls() {
    const capabilities = layoutClient?.getCapabilities?.() || { readable: false, writesEnabled: false, machines: [] };
    reload.disabled = busy; selector.disabled = busy || !loaded;
    container.setAttribute('aria-busy', String(busy));
    rows.forEach(row => {
      row.section.hidden = row.id !== selected;
      const writable = capabilities.writesEnabled && capabilities.machines?.includes(row.id);
      Object.values(row.inputs).forEach(input => { input.disabled = busy || !loaded || !writable || !!row.operation; });
      row.save.disabled = busy || !loaded || !writable || !dirty(row) || row.unconfirmed;
      row.cancel.disabled = busy || !loaded || !dirty(row) || !!row.operation;
      row.check.hidden = row.retry.hidden = !row.operation;
      row.check.disabled = busy || !capabilities.readable;
      row.retry.disabled = busy || !capabilities.writesEnabled;
    });
  }
  for (let n = 1; n <= 4; n++) {
    const section = document.createElement('section');
    section.className = 'machine-row';
    section.innerHTML = `<div class="machine-summary"><div class="machine-heading"><span class="machine-dot"></span><h3>M${n}</h3></div><p class="machine-id">YK-10${n} · ID เครื่อง (แก้ไขไม่ได้)</p><p class="machine-updated">ยังไม่ได้อ่านข้อมูล</p></div><form class="machine-fields" novalidate>
      <label for="nameM${n}">ชื่อเครื่อง<input id="nameM${n}" name="machine_name" required maxlength="200"><span class="field-error" id="nameErrorM${n}"></span></label>
      <label for="conveyorM${n}">ชื่อสายพานของเครื่อง<input id="conveyorM${n}" name="conveyor_name" maxlength="200"></label>
      <label for="productM${n}">สินค้าที่ใช้กับเครื่อง<select id="productM${n}" name="product_name"></select></label>
      <label for="statusM${n}">สถานะเครื่อง<select id="statusM${n}" name="machine_status"></select><span class="field-error"></span></label>
      <label for="installedM${n}">วันเวลาติดตั้ง (Asia/Bangkok · ระดับนาที)<input id="installedM${n}" name="installed_at" type="datetime-local" step="60"><span class="field-error"></span></label>
      <div class="layout-summary-note">สรุป Breakdown เดิมจาก Layout · การแก้ไขส่วนนี้ไม่สร้างหรือปิดเหตุขัดข้องใน Breakdown Records</div>
      <label for="breakdownAtM${n}">วันเวลาขัดข้องในสรุป Layout (Asia/Bangkok · ระดับนาที)<input id="breakdownAtM${n}" name="last_breakdown_at" type="datetime-local" step="60"><span class="field-error"></span></label>
      <label class="wide-field" for="detailM${n}">รายละเอียดสรุป Layout<textarea id="detailM${n}" name="breakdown_detail" rows="4" maxlength="5000"></textarea></label>
      <div class="machine-actions"><button type="submit" class="save-machine">บันทึก M${n}</button><button type="button" class="cancel-machine">ยกเลิกการแก้ไข</button><button type="button" class="check-layout-operation" hidden>ตรวจผลคำขอเดิม</button><button type="button" class="retry-layout-operation" hidden>ส่งคำขอเดิมซ้ำ</button></div>
      <p class="machine-feedback" role="status" aria-live="polite"></p></form>`;
    const row = { id: `YK-10${n}`, section, inputs: {}, baseline: {}, save: section.querySelector('.save-machine'), cancel: section.querySelector('.cancel-machine'), check: section.querySelector('.check-layout-operation'), retry: section.querySelector('.retry-layout-operation'), feedback: section.querySelector('.machine-feedback'), record: null };
    fields.forEach(field => { row.inputs[field] = section.querySelector(`[name="${field}"]`); });
    option(row.inputs.product_name, '', 'ยังไม่กำหนดสินค้า');
    products.forEach(product => option(row.inputs.product_name, product, product));
    Object.entries(statuses).forEach(([value, label]) => option(row.inputs.machine_status, value, label));
    Object.values(row.inputs).forEach(input => input.addEventListener('input', () => {
      input.removeAttribute('aria-invalid');
      const error = input.parentElement.querySelector('.field-error'); if (error) error.textContent = '';
      row.feedback.textContent = row.unconfirmed ? 'ผลการส่งครั้งก่อนยังไม่ยืนยัน กดโหลดข้อมูลล่าสุดเพื่อตรวจสอบก่อนบันทึกอีกครั้ง' : dirty(row) ? 'มีการเปลี่ยนแปลงที่ยังไม่บันทึก' : '';
      row.feedback.dataset.tone = ''; updateControls();
      layoutClient.saveDraft(row.id, Object.fromEntries(fields.map(field => [field, row.inputs[field].value])));
    }));
    section.querySelector('form').addEventListener('submit', event => { event.preventDefault(); save(row); });
    row.cancel.addEventListener('click', () => { if (row.operation) return; apply(row, row.record); layoutClient.clearDraft(row.id); row.feedback.textContent = ''; updateControls(); });
    row.check.addEventListener('click', () => recover(row, false));
    row.retry.addEventListener('click', () => recover(row, true));
    rows.push(row); container.appendChild(section);
  }
  async function read() {
    if (!layoutClient.getCapabilities().readable) await layoutClient.health();
    const result = await layoutClient.readRecords();
    return new Map(result.records.map(record => [record.machine_id, record]));
  }
  function apply(row, record) {
    row.record = record || null;
    const source = record || { machine_name: `Skewer Yakitori Machine ${row.id.slice(-1)}`, machine_status: 'idle' };
    fields.forEach(field => {
      let value = String(source[field] ?? '');
      if (dates.has(field)) {
        try { value = localDate(canonicalDate(value)).slice(0, 16); } catch (_) { value = ''; }
      }
      const input = row.inputs[field];
      if (input.tagName === 'SELECT' && !Array.from(input.options).some(o => o.value === value)) option(input, value, `ค่าเดิม: ${value}`);
      input.value = value;
      input.removeAttribute('aria-invalid');
      const error = input.parentElement.querySelector('.field-error'); if (error) error.textContent = '';
      row.baseline[field] = input.value;
    });
    row.section.querySelector('.machine-dot').dataset.status = source.machine_status;
    row.section.querySelector('.machine-updated').textContent = record ? `อัปเดตจาก Sheet: ${record.updated_at || 'ไม่ระบุเวลา'}` : 'ยังไม่มีข้อมูลใน Sheet · บันทึกเพื่อสร้างข้อมูลเครื่องนี้';
  }
  function validate(row) {
    let first;
    fields.forEach(field => {
      const input = row.inputs[field]; let error = '';
      if (field === 'machine_name' && !input.value.trim()) error = 'กรุณาระบุชื่อเครื่อง';
      if (field === 'machine_status' && !Object.hasOwn(statuses, input.value)) error = 'กรุณาเลือกสถานะที่รองรับ';
      if (dates.has(field)) {
        try { canonicalDate(input.value); if (input.validity.badInput) throw new Error(); } catch (_) { error = 'กรุณาระบุวันเวลาที่ถูกต้อง หรือเว้นว่าง'; }
        if (input.value !== row.baseline[field] && (input.validity.stepMismatch || (input.value.slice(16) && !/^:00(?:\.0+)?$/.test(input.value.slice(16))))) error = 'กรุณาระบุวันเวลาในระดับนาที ไม่ใส่วินาทีหรือเศษวินาที';
      }
      if (input.maxLength > 0 && input.value.length > input.maxLength) error = `ข้อความยาวเกิน ${input.maxLength} ตัวอักษร`;
      const errorNode = input.parentElement.querySelector('.field-error');
      if (errorNode) { errorNode.textContent = error; errorNode.id = `${input.id}Error`; input.setAttribute('aria-describedby', errorNode.id); }
      input.setAttribute('aria-invalid', String(Boolean(error)));
      if (error && !first) first = input;
    });
    if (first) { first.focus(); return false; } return true;
  }
  async function load() {
    if (busy) return;
    if (loaded && rows.some(dirty) && !window.confirm('มีการแก้ไขที่ยังไม่บันทึก โหลดข้อมูลใหม่และยกเลิกการแก้ไขหรือไม่?')) return;
    if (loaded) rows.filter(row => !row.operation).forEach(row => layoutClient.clearDraft(row.id));
    busy = true; updateControls(); announce('กำลังอ่านข้อมูลเครื่องจักร…');
    try {
      const records = await read(); rows.forEach(row => {
        apply(row, records.get(row.id)); row.unconfirmed = false; row.feedback.textContent = '';
        {
          row.operation = layoutClient.pending().find(op => op.payload.machine_id === row.id) || null;
          const savedDraft = layoutClient.loadDraft(row.id);
          if (!row.operation && savedDraft && fields.every(field => typeof savedDraft[field] === 'string')) fields.forEach(field => { row.inputs[field].value = savedDraft[field]; });
          if (row.operation) {
            fields.forEach(field => { row.inputs[field].value = dates.has(field) ? localDate(row.operation.payload[field]).slice(0, 16) : row.operation.payload[field]; });
            row.unconfirmed = true;
            row.feedback.textContent = 'คำขอเดิมยังไม่ยืนยัน · ตรวจผลหรือส่งคำขอเดิมซ้ำด้วย ID เดิม';
          }
        }
      });
      loaded = true; announce('อ่านข้อมูลล่าสุดแล้ว · ' + 'ข้อมูลเครื่องจากระบบบันทึก' + ' · เวลาอ่าน ' + new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }));
    } catch (error) { announce(`อ่านข้อมูลไม่สำเร็จ: ${userError(error)}${loaded ? ' · ข้อมูลที่แสดงเป็นค่าที่อ่านได้ครั้งก่อน' : ''} · กดโหลดข้อมูลล่าสุดเพื่อลองอีกครั้ง`, 'error'); }
    finally { busy = false; updateControls(); }
  }
  async function save(row) {
    if (busy || !loaded || !dirty(row) || row.unconfirmed || !validate(row)) return;
    return saveSecure(row);
  }
  async function applyReceipt(row, result) {
    if (!result.confirmed) {
      row.unconfirmed = result.state !== 'rejected';
      if (result.state === 'rejected') row.operation = null;
      row.feedback.textContent = result.state === 'rejected' ? `คำขอถูกปฏิเสธ: ${userError({ code: result.code })}` : 'ผลคำขอเดิมยังไม่ยืนยัน · ตรวจผลหรือส่งคำขอเดิมซ้ำ';
      row.feedback.dataset.tone = 'error'; return;
    }
    const operation = row.operation;
    const confirmed = { ...operation.payload, revision: result.receipt.revision, updated_at: result.receipt.savedAt };
    row.operation = null; row.unconfirmed = false;
    layoutClient.clearDraft(row.id);
    apply(row, confirmed);
    row.feedback.textContent = 'บันทึกและยืนยันข้อมูลจากระบบแล้ว';
    row.feedback.dataset.requestId = result.requestId;
    row.feedback.dataset.tone = 'success';
  }
  async function saveSecure(row) {
    busy = true; updateControls(); row.feedback.dataset.tone = ''; row.feedback.textContent = 'กำลังตรวจข้อมูลล่าสุดและบันทึก…';
    try {
      const latest = (await read()).get(row.id) || null;
      const expectedRevision = row.record?.revision ?? 0;
      if ((latest?.revision ?? 0) !== expectedRevision) throw new Error('ข้อมูลเครื่องถูกเปลี่ยน กรุณาโหลดข้อมูลล่าสุดก่อนบันทึก');
      const payload = { machine_id: row.id, ...draft(row) };
      row.operation = layoutClient.createOperation(payload, expectedRevision);
      const result = await layoutClient.submit(row.operation);
      await applyReceipt(row, result);
    } catch (error) {
      const pending = layoutClient.pending().find(op => op.payload.machine_id === row.id);
      row.operation = pending || null; row.unconfirmed = !!pending;
      row.feedback.textContent = `${pending ? 'ผลคำขอเดิมยังไม่ยืนยัน' : 'บันทึกไม่สำเร็จ'}: ${userError(error)}`; row.feedback.dataset.tone = 'error';
    } finally { busy = false; updateControls(); }
  }
  async function recover(row, retry) {
    if (busy || !row.operation) return;
    busy = true; updateControls(); row.feedback.textContent = retry ? 'กำลังส่งคำขอเดิมซ้ำ…' : 'กำลังตรวจผลคำขอเดิม…';
    try {
      if (!layoutClient.getCapabilities().readable) await layoutClient.health();
      await applyReceipt(row, retry ? await layoutClient.submit(row.operation) : await layoutClient.status(row.operation.requestId));
    } catch (error) { row.unconfirmed = true; row.feedback.textContent = 'ผลคำขอเดิมยังไม่ยืนยัน: ' + userError(error); row.feedback.dataset.tone = 'error'; }
    finally { busy = false; updateControls(); }
  }
  selector.addEventListener('change', () => {
    const previous = rows.find(row => row.id === selected);
    if (dirty(previous) && !previous.operation && !window.confirm('มีการแก้ไขที่ยังไม่บันทึก ยกเลิกการแก้ไขและเปลี่ยนเครื่องหรือไม่?')) { selector.value = selected; return; }
    if (dirty(previous) && !previous.operation) { apply(previous, previous.record); layoutClient.clearDraft(previous.id); previous.feedback.textContent = ''; }
    selected = selector.value; updateControls();
  });
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (link && (busy || rows.some(dirty)) && !window.confirm('มีงานที่ยังไม่บันทึกหรือกำลังส่งข้อมูล ออกจากหน้านี้หรือไม่?')) event.preventDefault();
  });
  reload.addEventListener('click', load);
  window.addEventListener('beforeunload', event => { if (busy || rows.some(dirty)) { event.preventDefault(); event.returnValue = ''; } });
  updateControls(); load();
})();
