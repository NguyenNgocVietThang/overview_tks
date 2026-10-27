(function () {
  'use strict';
  const PAGE_SIZE = 100;
  const API = '/api/stock-positions';
  const BASE_FIELDS = ['code', 'name', 'quantity', 'kiotQuantity', 'notes', 'arrivalDate', 'location', 'updatedByName', 'updatedAt'];
  const LABELS = {
    code: 'Mã hàng', name: 'Tên hàng', quantity: 'SL kho', kiotQuantity: 'SL Kiot', notes: 'Ghi chú số thùng',
    arrivalDate: 'Ngày về', location: 'Vị trí', updatedByName: 'Người cập nhật', updatedAt: 'TG cập nhật', actions: 'Thao tác'
  };
  const EDITABLE = ['notes', 'arrivalDate', 'location'];
  const NUMERIC = ['quantity', 'kiotQuantity'];
  const MOBILE_FIELDS = ['name', 'quantity', 'kiotQuantity', 'location'];
  const WIDTHS = {
    desktop: { code: 120, name: 220, quantity: 90, kiotQuantity: 90, notes: 220, arrivalDate: 110, location: 110, updatedByName: 140, updatedAt: 150, actions: 130 },
    mobile: { code: 100, name: 180, quantity: 70, kiotQuantity: 70, notes: 200, arrivalDate: 100, location: 90, updatedByName: 120, updatedAt: 130, actions: 120 }
  };
  const WARNING_LABELS = { multi: 'Nhiều quy cách', loose: 'Trừ lẻ', unreadable: 'Sai định dạng', badnumber: 'Số thùng sai', unknowncode: 'Mã SP lạ' };
  const ACTION_LABELS = {
    seed: 'Nhập dữ liệu đầu', create: 'Thêm dòng', edit: 'Sửa', delete: 'Xóa dòng', auto_delete: 'Tự xóa (hết hàng)',
    deduct: 'Trừ SL', import_replace: 'Import thay toàn bộ', import_add: 'Import bổ sung'
  };
  const FIELD_LABELS = { code: 'Mã hàng', notes: 'Ghi chú', arrivalDate: 'Ngày về', location: 'Vị trí', quantity: 'Số lượng' };
  const collator = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });
  const QUANTITY_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });
  const newState = () => ({ rows: [], query: '', page: 1, sortField: '', sortDirection: 'asc', loading: false, error: '', onlyWarnings: false, canEdit: null, canExport: false });
  const state = { hn: newState(), sg: newState() };
  let user, activeTab, allowedTabs, requestVersion = 0;
  let screenMode, visibleFields, columnPreferences = {}, canEditPermission = false;
  const importState = { ready: false };
  const history = { rows: [], nextBefore: null, branch: '', version: 0 };

  const $ = id => document.getElementById(id);
  const fields = () => BASE_FIELDS.concat(canEditPermission ? ['actions'] : []);
  const editable = () => canEditPermission && state[activeTab].canEdit !== false;

  function normalizeSearch(value) {
    return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // Cảnh báo do máy chủ tính từ ghi chú (public/shared/carton.js); nhãn lấy từ PickingCarton khi có.
  const warningsOf = row => (Array.isArray(row.warnings) ? row.warnings : []);
  const warningText = row => warningsOf(row).map(code => WARNING_LABELS[code] || (window.PickingCarton && window.PickingCarton.WARNING_LABEL[code]) || code).join(', ');

  function formatNumber(value) {
    return value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? '' : QUANTITY_FORMAT.format(Number(value));
  }

  // Giờ Việt Nam (Asia/Ho_Chi_Minh) dạng dd/MM/yyyy HH:mm.
  function formatTime(iso) {
    const date = new Date(iso);
    if (!iso || Number.isNaN(date.getTime())) return '';
    const parts = {};
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(date).forEach(part => { parts[part.type] = part.value; });
    return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
  }

  function filterRows(rows, query, onlyWarnings) {
    if (onlyWarnings) rows = rows.filter(row => warningsOf(row).length > 0);
    const needle = normalizeSearch(query);
    if (!needle) return rows;
    const text = row => ['code', 'name', 'location'].map(field => row[field]).join(' ');
    if (window.TKSFuzzySearch) return window.TKSFuzzySearch.filter(rows, query, text);
    return rows.filter(row => normalizeSearch(text(row)).includes(needle));
  }

  function sortValue(row, field) {
    if (NUMERIC.includes(field)) { const value = row[field]; return value === null || value === undefined ? null : Number(value); }
    if (field === 'updatedAt') { const time = Date.parse(row.updatedAt); return Number.isNaN(time) ? null : time; }
    return String(row[field] ?? '').trim() || null;
  }

  function sortRows(rows, field, direction) {
    if (!BASE_FIELDS.includes(field)) return rows;
    const numeric = NUMERIC.includes(field) || field === 'updatedAt';
    return rows.slice().sort((a, b) => {
      const left = sortValue(a, field), right = sortValue(b, field);
      if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
      const result = numeric ? left - right : collator.compare(left, right);
      return direction === 'desc' ? -result : result;
    });
  }

  function updateSortHeaders() {
    const current = state[activeTab];
    document.querySelectorAll('[data-sort-field]').forEach(button => {
      const selected = current.sortField === button.dataset.sortField;
      button.closest('th').setAttribute('aria-sort', selected ? current.sortDirection === 'asc' ? 'ascending' : 'descending' : 'none');
      // Chưa sắp ▲▼ · tăng dần ▼ · giảm dần ▲ (như mọi bảng khác).
      button.querySelector('.sort-indicator').textContent = selected ? current.sortDirection === 'asc' ? '▼' : '▲' : '▲▼';
      button.title = selected ? current.sortDirection === 'asc' ? 'Sắp xếp giảm dần' : 'Về thứ tự gốc' : 'Sắp xếp tăng dần';
    });
  }

  function renderColumns() {
    const table = $('vtTable');
    const widths = WIDTHS[screenMode];
    const colgroup = table.querySelector('colgroup');
    const header = table.querySelector('thead tr');
    colgroup.replaceChildren();
    header.replaceChildren();
    table.style.setProperty('--locations-min-width', visibleFields.reduce((sum, field) => sum + widths[field], 0) + 'px');
    fields().forEach(field => {
      const col = document.createElement('col');
      col.style.width = widths[field] + 'px';
      colgroup.appendChild(col);
      const th = document.createElement('th');
      th.scope = 'col';
      th.dataset.field = field;
      th.dataset.columnKey = field;
      th.dataset.defaultWidth = widths[field];
      if (field === 'actions') {
        const label = document.createElement('span');
        label.textContent = LABELS[field];
        th.appendChild(label);
      } else {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'sort-button';
        button.dataset.sortField = field;
        const label = document.createElement('span');
        label.className = 'sort-label';
        label.textContent = LABELS[field];
        const icon = document.createElement('span');
        icon.className = 'sort-indicator';
        icon.setAttribute('aria-hidden', 'true');
        button.append(label, icon);
        th.appendChild(button);
      }
      header.appendChild(th);
    });
    updateSortHeaders();
  }

  function enhanceColumns() {
    if (!window.TKSTables) return;
    const widths = WIDTHS[screenMode];
    window.TKSTables.enhance($('vtTable'), {
      key: 'vt-positions-' + screenMode,
      button: $('vtColumnsButton'),
      columns: fields().map(field => ({ key: field, label: LABELS[field], width: widths[field], locked: field === 'name' || field === 'actions', hidden: !visibleFields.includes(field) })),
      onVisibilityChange: hiddenKeys => {
        visibleFields = fields().filter(field => field === 'name' || field === 'actions' || !hiddenKeys.includes(field));
        columnPreferences[screenMode] = visibleFields.slice();
        for (const current of Object.values(state)) if (!visibleFields.includes(current.sortField)) current.sortField = '';
        render();
      }
    });
  }

  function applyScreenMode(mobile) {
    screenMode = mobile ? 'mobile' : 'desktop';
    const saved = columnPreferences[screenMode];
    const base = Array.isArray(saved) ? fields().filter(field => field === 'name' || saved.includes(field)) : mobile ? MOBILE_FIELDS.slice() : BASE_FIELDS.slice();
    visibleFields = canEditPermission && !base.includes('actions') ? base.concat('actions') : base;
    for (const current of Object.values(state)) if (!visibleFields.includes(current.sortField)) current.sortField = '';
    renderColumns();
    enhanceColumns();
    if (activeTab) render();
  }

  function notify(text, isError) {
    const node = $('vtNotice');
    node.textContent = text || '';
    node.dataset.error = String(!!isError);
  }

  function actionButton(label, action, danger) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'vt-row-button' + (danger ? ' vt-danger' : '');
    button.dataset.action = action;
    button.textContent = label;
    return button;
  }

  function buildRow(row, canEdit) {
    const tr = document.createElement('tr');
    tr.dataset.id = String(row.id);
    const warnings = warningsOf(row);
    if (warnings.length) { tr.className = 'vt-warning'; tr.dataset.warning = warnings.join(' '); }
    fields().forEach(field => {
      const td = document.createElement('td');
      td.dataset.field = field;
      if (field === 'quantity' || field === 'kiotQuantity') td.textContent = formatNumber(row[field]);
      else if (field === 'updatedAt') td.textContent = formatTime(row.updatedAt);
      else if (field === 'actions') {
        if (canEdit) td.append(actionButton('Trừ SL', 'deduct'), actionButton('Xóa', 'delete', true));
      } else td.textContent = String(row[field] ?? '');
      if (canEdit && EDITABLE.includes(field)) {
        td.classList.add('vt-editable');
        td.tabIndex = 0;
        td.title = 'Bấm để sửa';
      }
      if (field === 'notes' && warnings.length) {
        // Nhãn chữ kèm tooltip để không chỉ dựa vào màu.
        const badge = document.createElement('span');
        badge.className = 'vt-badge';
        badge.textContent = warningText(row);
        badge.title = warningText(row);
        td.appendChild(badge);
      }
      tr.appendChild(td);
    });
    return tr;
  }

  function render() {
    const current = state[activeTab];
    const canEdit = editable();
    $('vtAddButton').hidden = !canEdit;
    $('vtImportButton').hidden = !canEdit;
    $('vtExportButton').hidden = state[activeTab].canExport !== true;
    const rows = sortRows(filterRows(current.rows, current.query, current.onlyWarnings), current.sortField, current.sortDirection);
    updateSortHeaders();
    const chip = $('vtWarnFilter');
    chip.textContent = 'Cảnh báo (' + current.rows.filter(row => warningsOf(row).length > 0).length + ')';
    chip.setAttribute('aria-pressed', String(current.onlyWarnings));
    chip.classList.toggle('active', current.onlyWarnings);
    chip.disabled = current.loading || !!current.error;
    const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (!current.loading && !current.error) current.page = Math.min(current.page, pageCount);
    const start = (current.page - 1) * PAGE_SIZE;
    const body = $('vtRows');
    body.replaceChildren();
    const search = $('vtSearch');
    if (search.value !== current.query) search.value = current.query;
    search.disabled = current.loading || !!current.error;
    $('vtTable').setAttribute('aria-busy', String(current.loading));
    const status = $('vtStatus');
    status.dataset.error = String(!!current.error);
    status.textContent = current.loading ? 'Đang tải vị trí hàng…' : current.error ||
      (current.rows.length === 0 ? 'Chưa có dữ liệu vị trí hàng.' : rows.length === 0 ? (current.onlyWarnings ? 'Không có dòng cảnh báo.' : 'Không tìm thấy hàng phù hợp.') : '');
    const ready = !current.loading && !current.error && rows.length > 0;
    $('vtPager').hidden = !ready;
    if (!ready) return;

    const fragment = document.createDocumentFragment();
    rows.slice(start, start + PAGE_SIZE).forEach(row => fragment.appendChild(buildRow(row, canEdit)));
    body.appendChild(fragment);
    if (window.TKSTables) window.TKSTables.refresh($('vtTable'));
    $('vtCount').textContent = `${start + 1}–${Math.min(start + PAGE_SIZE, rows.length)} / ${rows.length} dòng`;
    $('vtPage').textContent = `Trang ${current.page} / ${pageCount}`;
    $('vtPrevious').disabled = current.page === 1;
    $('vtNext').disabled = current.page === pageCount;
    $('vtFirst').disabled = current.page === 1;
    $('vtLast').disabled = current.page === pageCount;
  }

  // ---------- Gọi API ----------
  async function request(path, options) {
    const response = await fetch(path, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, options));
    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  }
  const jsonOptions = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  function applyResult(tab, payload) {
    const rows = state[tab].rows;
    if (payload.deleted) { state[tab].rows = rows.filter(row => String(row.id) !== String(payload.id)); return; }
    if (!payload.row) return;
    const index = rows.findIndex(row => String(row.id) === String(payload.row.id));
    if (index >= 0) rows[index] = payload.row;
    else rows.unshift(payload.row);
  }

  // 409 VERSION_CONFLICT: dòng đã bị người khác sửa → báo và tải lại; lỗi khác → báo tại chỗ.
  async function handleFailure(payload) {
    if (payload.code === 'VERSION_CONFLICT') {
      notify('Dòng đã bị người khác sửa. Đã tải lại dữ liệu mới nhất.', true);
      await selectTab(activeTab);
    } else notify(payload.error || 'Không lưu được thay đổi.', true);
    return false;
  }

  async function patchRow(tab, row, patch, confirmEmpty) {
    notify('');
    const body = Object.assign({ version: row.version }, patch);
    if (confirmEmpty) body.confirmEmpty = true;
    const { response, payload } = await request(API + '/' + encodeURIComponent(row.id), jsonOptions('PATCH', body));
    if (response.ok) { applyResult(tab, payload); return true; }
    // Sửa tay làm hết hàng: hỏi lại rồi gửi lại kèm confirmEmpty.
    if (payload.code === 'WOULD_AUTO_DELETE') {
      if (await confirmBox('Sau khi sửa dòng này hết hàng nên sẽ bị xóa khỏi bảng. Tiếp tục?', 'Xóa dòng')) return patchRow(tab, row, patch, true);
      return false;
    }
    return handleFailure(payload);
  }

  // ---------- Hộp thoại ----------
  function openDialog(dialog) {
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
  }
  function closeDialog(dialog) {
    if (dialog.close) dialog.close(); else dialog.removeAttribute('open');
  }

  function confirmBox(message, okLabel) {
    const dialog = $('vtConfirmDialog');
    return new Promise(resolve => {
      $('vtConfirmMessage').textContent = message;
      $('vtConfirmOk').textContent = okLabel || 'Đồng ý';
      const finish = value => { resolve(value); closeDialog(dialog); };
      $('vtConfirmOk').onclick = () => finish(true);
      $('vtConfirmCancel').onclick = () => finish(false);
      dialog.addEventListener('close', () => resolve(false), { once: true });
      openDialog(dialog);
    });
  }

  function startEdit(td, row, field) {
    if (td.querySelector('input')) return;
    const original = String(row[field] ?? '');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'vt-inline-input';
    input.value = original;
    input.setAttribute('aria-label', LABELS[field]);
    td.replaceChildren(input);
    input.focus();
    const tab = activeTab;
    let finished = false;
    const finish = async save => {
      if (finished) return;
      finished = true;
      const value = input.value.trim();
      if (save && value !== original.trim()) await patchRow(tab, row, { [field]: value });
      if (tab === activeTab) render();
    };
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); finish(true); }
      else if (event.key === 'Escape') { event.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  }

  function openDeduct(row) {
    const form = $('vtDeductForm');
    form.reset();
    $('vtDeductError').textContent = '';
    $('vtDeductSubtitle').textContent = `${row.code} · ${row.location || 'chưa có vị trí'} · hiện có ${formatNumber(row.quantity) || '?'}`;
    form.dataset.rowId = String(row.id);
    openDialog($('vtDeductDialog'));
    form.elements.quantity.focus();
  }

  async function submitDeduct(event) {
    event.preventDefault();
    const form = $('vtDeductForm');
    const tab = activeTab;
    const row = state[tab].rows.find(item => String(item.id) === form.dataset.rowId);
    const quantity = Number(form.elements.quantity.value);
    if (!row) return;
    if (!Number.isInteger(quantity) || quantity <= 0) { $('vtDeductError').textContent = 'Số lượng cần trừ phải là số nguyên dương.'; return; }
    const { response, payload } = await request(API + '/' + encodeURIComponent(row.id) + '/deduct', jsonOptions('POST', { version: row.version, quantity }));
    if (response.ok) {
      applyResult(tab, payload);
      closeDialog($('vtDeductDialog'));
      if (tab === activeTab) render();
    } else if (payload.code === 'VERSION_CONFLICT') {
      closeDialog($('vtDeductDialog'));
      await handleFailure(payload);
    } else $('vtDeductError').textContent = payload.error || 'Không trừ được số lượng.';
  }

  async function deleteRow(row) {
    if (!await confirmBox(`Xóa dòng ${row.code}${row.location ? ' tại ' + row.location : ''}?`, 'Xóa dòng')) return;
    const tab = activeTab;
    notify('');
    const { response, payload } = await request(API + '/' + encodeURIComponent(row.id) + '?version=' + encodeURIComponent(row.version), { method: 'DELETE' });
    if (response.ok) { applyResult(tab, payload.deleted ? payload : { deleted: true, id: row.id }); if (tab === activeTab) render(); }
    else await handleFailure(payload);
  }

  async function submitAdd(event) {
    event.preventDefault();
    const form = $('vtAddForm');
    const tab = activeTab;
    const body = Object.fromEntries(['code', 'notes', 'arrivalDate', 'location'].map(name => [name, form.elements[name].value.trim()]));
    if (!body.code) { $('vtAddError').textContent = 'Vui lòng nhập mã hàng.'; return; }
    const { response, payload } = await request(API + '?branch=' + tab.toUpperCase(), jsonOptions('POST', body));
    if (response.ok) {
      applyResult(tab, payload);
      closeDialog($('vtAddDialog'));
      notify(payload.merged ? 'Đã cộng thêm vào dòng ' + body.code + ' sẵn có ở vị trí này.' : 'Đã thêm dòng ' + body.code + '.');
      if (tab === activeTab) render();
    } else $('vtAddError').textContent = payload.error || 'Không thêm được dòng.';
  }

  // ---------- Import ----------
  const importMode = () => document.querySelector('input[name="vtImportMode"]:checked').value;
  function resetImport() {
    importState.ready = false;
    $('vtImportConfirm').disabled = true;
    $('vtImportResult').replaceChildren();
    $('vtImportError').textContent = '';
  }

  function renderImportResult(payload) {
    const box = $('vtImportResult');
    box.replaceChildren();
    const counts = payload.counts || {};
    const items = [['added', 'Thêm'], ['updated', 'Cập nhật'], ['deleted', 'Xóa'], ['unchanged', 'Không đổi'], ['skippedEmpty', 'Bỏ qua (SL 0/trống)'], ['errors', 'Lỗi']];
    const list = document.createElement('ul');
    list.className = 'vt-import-counts';
    items.forEach(([key, label]) => {
      const li = document.createElement('li');
      li.dataset.count = key;
      const value = document.createElement('b');
      value.textContent = String(counts[key] ?? 0);
      li.append(value, label);
      list.appendChild(li);
    });
    box.appendChild(list);
    const errors = Array.isArray(payload.errors) ? payload.errors : [];
    if (errors.length) {
      const ol = document.createElement('ol');
      ol.className = 'vt-import-errors';
      ol.dataset.importErrors = '';
      errors.forEach(error => {
        const li = document.createElement('li');
        li.value = Number(error.row) || 0;
        li.textContent = `Dòng ${error.row}: ${error.message}`;
        ol.appendChild(li);
      });
      box.appendChild(ol);
      if ((counts.errors || 0) > errors.length) {
        const more = document.createElement('p');
        more.className = 'vt-form-error';
        more.textContent = `… và ${counts.errors - errors.length} lỗi khác.`;
        box.appendChild(more);
      }
    }
  }

  async function runImport(commit) {
    const file = $('vtImportFile').files && $('vtImportFile').files[0];
    $('vtImportError').textContent = '';
    if (!file) { $('vtImportError').textContent = 'Vui lòng chọn file .xlsx, .xls hoặc .csv.'; return null; }
    const tab = activeTab;
    const form = new window.FormData();
    form.append('file', file, file.name);
    const query = `?branch=${tab.toUpperCase()}&mode=${importMode()}&commit=${commit ? 1 : 0}`;
    const { response, payload } = await request(API + '/import' + query, { method: 'POST', body: form });
    if (payload.counts) renderImportResult(payload);
    if (!response.ok) { $('vtImportError').textContent = payload.error || 'Không import được file.'; return null; }
    return { tab, payload };
  }

  async function previewImport() {
    importState.ready = false;
    $('vtImportConfirm').disabled = true;
    const result = await runImport(false);
    if (!result) return;
    importState.ready = (result.payload.counts?.errors || 0) === 0;
    $('vtImportConfirm').disabled = !importState.ready;
    if (!importState.ready) $('vtImportError').textContent = 'File còn lỗi, hãy sửa file rồi xem trước lại.';
  }

  async function confirmImport() {
    if (!importState.ready) return;
    $('vtImportConfirm').disabled = true;
    const result = await runImport(true);
    if (!result) { $('vtImportConfirm').disabled = !importState.ready; return; }
    const counts = result.payload.counts || {};
    closeDialog($('vtImportDialog'));
    notify(`Đã import: thêm ${counts.added || 0}, cập nhật ${counts.updated || 0}, xóa ${counts.deleted || 0}.`);
    importState.ready = false;
    await selectTab(activeTab);
  }

  // ---------- Xuất Excel (toàn bộ dòng của cơ sở đang chọn, tải qua fetch để giữ cookie) ----------
  function exportFileName(disposition, tab) {
    const text = String(disposition || '');
    const utf8 = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(text);
    if (utf8) { try { return decodeURIComponent(utf8[1].trim()); } catch (error) { /* dùng tên thường */ } }
    const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(text);
    return plain ? plain[1].trim() : 'vi-tri-hang-' + tab.toUpperCase() + '.xlsx';
  }

  async function exportExcel() {
    const tab = activeTab;
    notify('');
    $('vtExportButton').disabled = true;
    try {
      const response = await fetch(API + '/export?branch=' + tab.toUpperCase(), { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        notify(payload.error || 'Không xuất được file Excel.', true);
        return;
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = exportFileName(response.headers && response.headers.get && response.headers.get('Content-Disposition'), tab);
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => window.URL.revokeObjectURL(url), 1000);
    } catch (error) {
      notify('Không xuất được file Excel.', true);
    } finally {
      $('vtExportButton').disabled = false;
    }
  }

  // ---------- Lịch sử cập nhật ----------
  function historyValue(entry, side) {
    if (entry.summary && side === 'new') {
      const s = entry.summary, parts = [];
      [['added', 'Thêm'], ['updated', 'Đổi'], ['deleted', 'Xóa'], ['skippedEmpty', 'Bỏ qua']].forEach(([key, label]) => { if (s[key] !== undefined) parts.push(label + ' ' + s[key]); });
      if (s.rows !== undefined) parts.push(s.rows + ' dòng');
      if (s.fileName) parts.push(s.fileName);
      return parts.length ? parts.join(' · ') : JSON.stringify(s);
    }
    return String((side === 'old' ? entry.oldValue : entry.newValue) ?? '');
  }

  function renderHistory() {
    const search = $('vtHistorySearch').value;
    const action = $('vtHistoryAction').value;
    let rows = history.rows.filter(entry => !action || entry.action === action);
    const text = entry => [entry.actorName, entry.code, entry.location, ACTION_LABELS[entry.action], FIELD_LABELS[entry.field] || entry.field, historyValue(entry, 'old'), historyValue(entry, 'new')].join(' ');
    if (search.trim()) rows = window.TKSFuzzySearch ? window.TKSFuzzySearch.filter(rows, search, text) : rows.filter(entry => normalizeSearch(text(entry)).includes(normalizeSearch(search)));
    const body = $('vtHistoryRows');
    body.replaceChildren();
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
      td.className = 'table-note';
      td.textContent = history.rows.length ? 'Không có thay đổi khớp bộ lọc.' : 'Chưa có thay đổi nào.';
      tr.appendChild(td);
      body.appendChild(tr);
    }
    rows.forEach(entry => {
      const tr = document.createElement('tr');
      const cells = [
        formatTime(entry.createdAt), entry.actorName || '—', ACTION_LABELS[entry.action] || entry.action,
        [entry.code, entry.location].filter(Boolean).join(' · '), FIELD_LABELS[entry.field] || entry.field || '',
        historyValue(entry, 'old'), historyValue(entry, 'new')
      ];
      cells.forEach((value, index) => {
        const td = document.createElement('td');
        td.textContent = value;
        if (index === 0) td.className = 'mono';
        if (index === 3) td.className = 'dp-cell-main';
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    $('vtHistorySubtitle').textContent = `${rows.length === history.rows.length ? history.rows.length : rows.length + '/' + history.rows.length} thay đổi đã tải · lưu vĩnh viễn`;
    $('vtHistoryMore').hidden = history.nextBefore === null || history.nextBefore === undefined;
  }

  async function loadHistory(append) {
    const version = ++history.version;
    const before = append && history.nextBefore ? '&before=' + encodeURIComponent(history.nextBefore) : '';
    const { response, payload } = await request(API + '/history?branch=' + history.branch + '&limit=200' + before);
    if (version !== history.version) return;
    if (!response.ok) { $('vtHistorySubtitle').textContent = payload.error || 'Không tải được lịch sử.'; return; }
    history.rows = append ? history.rows.concat(payload.rows || []) : (payload.rows || []);
    history.nextBefore = payload.nextBefore ?? null;
    renderHistory();
  }

  function openHistory() {
    history.rows = [];
    history.nextBefore = null;
    history.branch = activeTab.toUpperCase();
    $('vtHistoryTitle').textContent = 'Lịch sử cập nhật · VT ' + (activeTab === 'hn' ? 'Hà Nội' : 'Sài Gòn');
    $('vtHistorySearch').value = '';
    const select = $('vtHistoryAction');
    if (select.options.length <= 1) Object.entries(ACTION_LABELS).forEach(([value, label]) => select.add(new Option(label, value)));
    select.value = '';
    $('vtHistorySubtitle').textContent = 'Đang tải…';
    $('vtHistoryRows').replaceChildren();
    $('vtHistoryMore').hidden = true;
    openDialog($('vtHistoryDialog'));
    loadHistory(false);
  }

  // ---------- Tải dữ liệu theo tab ----------
  async function selectTab(requested) {
    activeTab = allowedTabs.includes(requested) ? requested : allowedTabs[0];
    if (window.location.hash !== '#' + activeTab) window.history.replaceState(null, '', '#' + activeTab);
    const tab = activeTab;
    document.querySelectorAll('[data-vt-tab]').forEach(link => {
      link.hidden = !allowedTabs.includes(link.dataset.vtTab);
      if (link.dataset.vtTab === tab) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    $('vtTableTitle').textContent = 'VT ' + (tab === 'hn' ? 'Hà Nội' : 'Sài Gòn');
    window.TKSNav.renderTopSidebar($('sidebar'), 'stockLocations', user);
    const current = state[tab];
    current.rows = [];
    current.loading = true;
    current.error = '';
    const version = ++requestVersion;
    render();
    try {
      const { response, payload } = await request(API + '?branch=' + tab.toUpperCase());
      if (version !== requestVersion) return;
      if (!response.ok) throw new Error(payload.error || 'Không tải được vị trí hàng.');
      if (payload.branch !== tab.toUpperCase() || !Array.isArray(payload.rows)) throw new Error('Dữ liệu vị trí hàng không hợp lệ.');
      current.rows = payload.rows;
      current.canEdit = typeof payload.canEdit === 'boolean' ? payload.canEdit : null;
      current.canExport = payload.canExport === true;
    } catch (error) {
      if (version !== requestVersion) return;
      current.error = error.message || 'Lỗi kết nối, vui lòng tải lại trang.';
    } finally {
      if (version === requestVersion) { current.loading = false; render(); }
    }
  }

  function syncTheme() {
    const light = document.documentElement.dataset.theme === 'light';
    $('themeLabel').textContent = light ? 'Dark mode' : 'Light mode';
    const button = $('themeToggle');
    button.setAttribute('aria-label', light ? 'Chuyển sang giao diện tối' : 'Chuyển sang giao diện sáng');
    button.setAttribute('aria-pressed', String(light));
  }

  function bindDialogs() {
    document.querySelectorAll('.vt-dialog [data-vt-close]').forEach(button => {
      button.addEventListener('click', () => closeDialog(button.closest('dialog')));
    });
    $('vtAddButton').addEventListener('click', () => {
      $('vtAddForm').reset();
      $('vtAddError').textContent = '';
      $('vtAddSubtitle').textContent = 'VT ' + (activeTab === 'hn' ? 'Hà Nội' : 'Sài Gòn') + ' · mã hàng đã có trong KiotViet sẽ tự điền tên hàng.';
      openDialog($('vtAddDialog'));
      $('vtAddForm').elements.code.focus();
    });
    $('vtAddForm').addEventListener('submit', submitAdd);
    $('vtDeductForm').addEventListener('submit', submitDeduct);
    $('vtImportButton').addEventListener('click', () => {
      $('vtImportFile').value = '';
      resetImport();
      openDialog($('vtImportDialog'));
    });
    $('vtImportFile').addEventListener('change', resetImport);
    document.querySelectorAll('input[name="vtImportMode"]').forEach(radio => radio.addEventListener('change', resetImport));
    $('vtImportPreview').addEventListener('click', previewImport);
    $('vtImportConfirm').addEventListener('click', confirmImport);
    $('vtExportButton').addEventListener('click', exportExcel);
    $('vtHistoryButton').addEventListener('click', openHistory);
    $('vtHistorySearch').addEventListener('input', renderHistory);
    $('vtHistoryAction').addEventListener('change', renderHistory);
    $('vtHistoryMore').addEventListener('click', () => loadHistory(true));
  }

  function bindTable() {
    const body = $('vtRows');
    body.addEventListener('click', event => {
      const current = state[activeTab];
      const tr = event.target.closest('tr[data-id]');
      if (!tr || !editable()) return;
      const row = current.rows.find(item => String(item.id) === tr.dataset.id);
      if (!row) return;
      const button = event.target.closest('[data-action]');
      if (button) {
        if (button.dataset.action === 'deduct') openDeduct(row);
        else if (button.dataset.action === 'delete') deleteRow(row);
        return;
      }
      const td = event.target.closest('td.vt-editable');
      if (td && !event.target.closest('input')) startEdit(td, row, td.dataset.field);
    });
    body.addEventListener('keydown', event => {
      const td = event.target.closest && event.target.closest('td.vt-editable');
      if (!td || event.target !== td || event.key !== 'Enter' || !editable()) return;
      const row = state[activeTab].rows.find(item => String(item.id) === td.parentElement.dataset.id);
      if (row) startEdit(td, row, td.dataset.field);
    });
  }

  async function init() {
    syncTheme();
    $('themeToggle').addEventListener('click', () => {
      const theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.theme = theme;
      try { localStorage.setItem('tks-dashboard-theme', theme); } catch (error) { /* storage optional */ }
      syncTheme();
    });
    const toggleSidebar = () => {
      const open = $('sidebar').classList.toggle('open');
      $('backdrop').classList.toggle('show', open);
      $('menuBtn').setAttribute('aria-expanded', String(open));
    };
    $('menuBtn').addEventListener('click', toggleSidebar);
    $('backdrop').addEventListener('click', toggleSidebar);
    user = await window.TKSNav.authGuard();
    canEditPermission = !!(window.TKSNav.can && window.TKSNav.can('stockLocationsV2.edit'));
    allowedTabs = user.branch === 'Hà Nội' ? ['hn'] : user.branch === 'Sài Gòn' ? ['sg'] : ['hn', 'sg'];
    const mobileQuery = window.matchMedia ? window.matchMedia('(max-width: 600px)') : null;
    activeTab = allowedTabs.includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : allowedTabs[0];
    applyScreenMode(mobileQuery ? mobileQuery.matches : window.innerWidth <= 600);
    if (mobileQuery) mobileQuery.addEventListener('change', event => applyScreenMode(event.matches));
    bindDialogs();
    bindTable();
    document.querySelector('#vtTable thead').addEventListener('click', event => {
      const button = event.target.closest('[data-sort-field]');
      if (!button) return;
      const current = state[activeTab];
      const field = button.dataset.sortField;
      if (current.sortField !== field) { current.sortField = field; current.sortDirection = 'asc'; }
      else if (current.sortDirection === 'asc') current.sortDirection = 'desc';
      else current.sortField = '';
      current.page = 1;
      render();
      document.querySelector('.locations-scroll').scrollTop = 0;
    });
    $('vtWarnFilter').addEventListener('click', () => {
      const current = state[activeTab];
      current.onlyWarnings = !current.onlyWarnings;
      current.page = 1;
      render();
    });
    $('vtSearch').addEventListener('input', event => {
      state[activeTab].query = event.target.value;
      state[activeTab].page = 1;
      render();
    });
    ['First', 'Previous', 'Next', 'Last'].forEach(direction => {
      $('vt' + direction).addEventListener('click', () => {
        const current = state[activeTab];
        const pageCount = Math.max(1, Math.ceil(filterRows(current.rows, current.query, current.onlyWarnings).length / PAGE_SIZE));
        if (direction === 'First') current.page = 1;
        else if (direction === 'Last') current.page = pageCount;
        else current.page = Math.max(1, Math.min(pageCount, current.page + (direction === 'Previous' ? -1 : 1)));
        render();
        document.querySelector('.locations-scroll').scrollTop = 0;
      });
    });
    // Liên kết tab trong trang và mục VT Hà Nội / VT Sài Gòn ở sidebar (href /vt-positions/#hn|#sg).
    document.addEventListener('click', event => {
      const link = event.target.closest('[data-vt-tab], a[href^="/vt-positions/#"]');
      if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const tab = link.dataset.vtTab || (link.getAttribute('href') || '').split('#')[1];
      if (!allowedTabs.includes(tab)) return;
      event.preventDefault();
      if (window.location.hash === '#' + tab) selectTab(tab);
      else window.location.hash = tab;
    });
    window.addEventListener('hashchange', () => selectTab(window.location.hash.slice(1)));
    await selectTab(window.location.hash.slice(1));
  }

  window.TKSVtPositions = { init, normalizeSearch, filterRows, sortRows, formatTime };
})();
