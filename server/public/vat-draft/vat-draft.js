(function () {
  'use strict';

  // Kế toán – Nháp VAT: 2 tab (#xu-ly, #tao-qr). Thuật toán chạy ở máy chủ
  // (/api/vat-draft); trang chỉ chọn chứng từ / dán dữ liệu, hiển thị và tải file.
  // Tài khoản chỉ có quyền Tạo QR (accounting.qr, mặc định Nhân viên sale) chỉ thấy tab Tạo QR.

  const TABS = ['xu-ly', 'tao-qr'];
  const PAGE_SIZE = 50;
  const SELECTION_KEY = 'tks-vat-draft-selection';
  const MANUAL = '__manual__';
  const GIA_NHAP = 'GIÁ NHÁP\n(Giá bán/(1+%VAT))';
  const NUMERIC = new Set(['SL', 'Giá bán', 'TỒN CÒN NHÁP', GIA_NHAP, '%VAT', 'Thành tiền']);
  const CODE_COLUMNS = new Set(['MÃ SP', 'Mã VAT', 'Mã hóa đơn']);
  const KIND_LABEL = { invoice: 'Hóa đơn', order: 'Đặt hàng' };
  const BRANCH_LABEL = { hanoi: 'Hà Nội', saigon: 'Sài Gòn' };

  const state = {
    user: null,
    canProcess: true,
    tab: 'xu-ly',
    mode: 'docs',
    selection: new Map(),
    list: { page: 1, total: 0, rows: [], loading: false, version: 0, sort: '', dir: 'asc' },
    meta: null,
    alloc: null,
    qrMode: 'co_vat',
    matchedAccounts: [],
    invoiceBusy: false,
    invoiceThumbUrl: null,
    invoiceViewerReturn: null,
    qr: { status: 'idle' },
    manualTouched: false,
    copiedQrDims: null
  };

  const $ = id => document.getElementById(id);

  // ---------- Tiện ích ----------

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function slug(text) {
    return String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cot';
  }

  // Tien / gia / so luong: dau PHAY ngan hang nghin (115,200,000), dau cham thap phan — nhu app cu.
  const intFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const decFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

  function formatNumber(column, value) {
    if (value === null || value === undefined || value === '') return '';
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value);
    if (column === '%VAT') return intFormat.format(number) + '%';
    if (column === 'SL' || column === 'Tồn nháp được' || column === 'TỒN CÒN NHÁP') return decFormat.format(number);
    return intFormat.format(number);
  }

  function formatAmount(value) {
    return intFormat.format(Math.max(Math.trunc(Number(value) || 0), 0)) + ' đ';
  }

  function parseAmount(text) {
    const digits = String(text || '').replace(/[^\d]/g, '');
    return digits ? Number(digits) : 0;
  }

  /** repr(float) của Python — CSV giữ đúng định dạng file của app cũ (pandas to_csv). */
  function pyFloatRepr(x) {
    if (Number.isNaN(x)) return 'nan';
    if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf';
    if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
    const [mantissa, expText] = Math.abs(x).toExponential().split('e');
    const digits = mantissa.replace('.', '');
    const exponent = Number(expText);
    const decpt = exponent + 1;
    const sign = x < 0 ? '-' : '';
    if (decpt <= -4 || decpt > 16) {
      return `${sign}${digits[0]}${digits.length > 1 ? '.' + digits.slice(1) : ''}e${exponent < 0 ? '-' : '+'}${String(Math.abs(exponent)).padStart(2, '0')}`;
    }
    if (decpt <= 0) return `${sign}0.${'0'.repeat(-decpt)}${digits}`;
    if (decpt >= digits.length) return `${sign}${digits}${'0'.repeat(decpt - digits.length)}.0`;
    return `${sign}${digits.slice(0, decpt)}.${digits.slice(decpt)}`;
  }

  function csvCell(column, value) {
    if (value === null || value === undefined || value === '') return '';
    let text = typeof value === 'number' ? pyFloatRepr(value) : String(value);
    if (/[",\r\n]/.test(text)) text = '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadCsv(columns, rows, fileName) {
    const lines = [columns.map(c => csvCell(c, c)).join(',')]
      .concat(rows.map(values => values.map((v, i) => csvCell(columns[i], v)).join(',')));
    downloadBlob(new Blob(['\ufeff' + lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' }), fileName);
  }

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch('/api/vat-draft' + path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined || body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined || body instanceof FormData ? body : JSON.stringify(body)
    });
    if (res.status === 401) { window.location.href = '/login/'; throw new Error('Phiên đăng nhập đã hết hạn.'); }
    const type = res.headers.get('content-type') || '';
    if (!res.ok) {
      const data = type.includes('json') ? await res.json().catch(() => ({})) : {};
      throw new Error(data.error || 'Không kết nối được máy chủ, vui lòng thử lại.');
    }
    return type.includes('json') ? res.json() : res.blob();
  }

  function vnDate(offsetDays = 0) {
    const date = new Date(Date.now() + offsetDays * 86400000);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }

  function vnTime(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric', hourCycle: 'h23' });
  }

  function setMessage(id, text, tone) {
    const el = $(id);
    el.textContent = text || '';
    el.classList.toggle('vd-error', tone === 'error');
    el.classList.toggle('vd-warning', tone === 'warning');
  }

  // ---------- Trạng thái nguồn dữ liệu ----------

  function renderMeta() {
    const meta = state.meta;
    if (!meta || !meta.masterData) return;
    const sheets = $('vdSheetsStatus');
    const md = meta.masterData;
    if (md.error) {
      sheets.textContent = 'Không tải được Google Sheets: ' + md.error;
      sheets.dataset.tone = 'error';
    } else {
      sheets.textContent = `Dữ liệu Google Sheets (Gộp VAT ${intFormat.format(md.stockRows)} dòng · Khớp mã ${intFormat.format(md.mappingRows)} dòng) cập nhật lúc ${vnTime(md.loadedAt)}${md.stale ? ' — ⚠️ đang dùng bản cũ vì tải lại thất bại' : ''}`;
      sheets.dataset.tone = md.stale ? 'warning' : '';
    }
    const times = (meta.sync || []).map(s => s.syncedAt && Date.parse(s.syncedAt)).filter(Boolean);
    const sync = $('vdSyncStatus');
    if (times.length) {
      const oldest = Math.min(...times);
      const late = Date.now() - oldest > 20 * 60000;
      sync.textContent = `· KiotViet đồng bộ lúc ${vnTime(new Date(oldest).toISOString())}${late ? ' — ⚠️ đã hơn 20 phút, chứng từ mới có thể chưa có' : ''}`;
      sync.dataset.tone = late ? 'warning' : '';
    } else {
      sync.textContent = '';
    }
    const late = sync.dataset.tone === 'warning';
    setStatusPill(md.error ? 'error' : md.stale || late ? 'warning' : 'ok',
      md.error ? 'Lỗi tải Google Sheets' : `Dữ liệu cập nhật ${vnTime(md.loadedAt)}${md.stale || late ? ' · cần kiểm tra' : ''}`);
  }

  function setStatusPill(tone, text) {
    $('vdSourceBar').dataset.tone = tone;
    $('vdStatusSummary').textContent = text;
  }

  async function loadMeta() {
    try {
      state.meta = await api('/meta');
      renderMeta();
      renderAccountSelect();
    } catch (error) {
      $('vdSheetsStatus').textContent = error.message;
      setStatusPill('error', 'Không tải được dữ liệu');
    }
  }

  async function refreshSheets() {
    const button = $('vdRefreshSheets');
    button.disabled = true;
    $('vdSheetsStatus').textContent = 'Đang tải dữ liệu từ Google Sheets…';
    setStatusPill('', 'Đang cập nhật…');
    try {
      const { masterData } = await api('/master-data/refresh', { method: 'POST' });
      state.meta = { ...(state.meta || { sync: [] }), masterData };
      renderMeta();
    } catch (error) {
      $('vdSheetsStatus').textContent = 'Lỗi cập nhật: ' + error.message;
      setStatusPill('error', 'Lỗi cập nhật dữ liệu');
    } finally {
      button.disabled = false;
    }
  }

  // ---------- Tab / chế độ nhập ----------

  function selectTab(tab) {
    state.tab = !state.canProcess ? 'tao-qr' : TABS.includes(tab) ? tab : 'xu-ly';
    document.querySelectorAll('.vd-tabs [data-vat-draft-tab]').forEach(link => {
      if (link.dataset.vatDraftTab === state.tab) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    $('vdInputPanel').hidden = state.tab === 'tao-qr';
    // Sheets/KiotViet chi phuc vu Xu ly hoa don; sale (khong co quyen) da an tu luc khoi tao.
    if (state.canProcess) $('vdSourceBar').hidden = state.tab === 'tao-qr';
    document.querySelectorAll('[data-tab-section]').forEach(section => {
      const own = section.dataset.tabSection === state.tab;
      const hasResult = section.id === 'vdAllocResult' ? !!state.alloc : true;
      section.hidden = !(own && hasResult);
    });
    setMessage('vdRunError', '');
    const sidebar = $('sidebar');
    if (window.TKSNav && sidebar && state.user) window.TKSNav.renderTopSidebar(sidebar, 'accounting', state.user);
  }

  function selectMode(mode) {
    state.mode = mode === 'paste' ? 'paste' : 'docs';
    document.querySelectorAll('[data-input-mode]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.inputMode === state.mode)));
    $('vdDocsPane').hidden = state.mode !== 'docs';
    $('vdPastePane').hidden = state.mode !== 'paste';
    setMessage('vdRunError', '');
  }

  // ---------- Chọn chứng từ ----------

  const docKey = doc => `${doc.kind}:${doc.branch}:${doc.code}`;

  function saveSelection() {
    try { sessionStorage.setItem(SELECTION_KEY, JSON.stringify([...state.selection.values()])); } catch (error) { /* tùy chọn */ }
  }

  function loadSelection() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(SELECTION_KEY) || '[]');
      if (Array.isArray(saved)) saved.forEach(doc => { if (doc && doc.code && doc.kind && doc.branch) state.selection.set(docKey(doc), doc); });
    } catch (error) { /* tùy chọn */ }
  }

  function toggleDoc(doc, selected) {
    const key = docKey(doc);
    if (selected) {
      const sameCode = [...state.selection.values()].find(d => d.code === doc.code && d.branch !== doc.branch);
      if (sameCode) {
        setMessage('vdCodesMessage', `Mã ${doc.code} đã được chọn ở cơ sở ${BRANCH_LABEL[sameCode.branch]} — mỗi lần xử lý chỉ chọn một trong hai.`, 'warning');
        return false;
      }
      state.selection.set(key, { kind: doc.kind, branch: doc.branch, code: doc.code, customerName: doc.customerName || '', warning: doc.warning || '' });
    } else {
      state.selection.delete(key);
    }
    saveSelection();
    return true;
  }

  function renderSelection() {
    const docs = [...state.selection.values()];
    $('vdSelectedCount').textContent = docs.length ? `Đã chọn ${docs.length} chứng từ` : 'Chưa chọn chứng từ nào';
    $('vdClearSelection').hidden = !docs.length;
    $('vdRunDocs').disabled = !docs.length;
    $('vdChips').innerHTML = docs.map(doc => `<li${doc.warning ? ' data-warning title="' + escapeHtml(doc.warning) + '"' : ''}>
      <span>${escapeHtml(doc.code)}${doc.branch === 'saigon' ? ' · SG' : ''}</span>
      <button type="button" data-remove="${escapeHtml(docKey(doc))}" aria-label="Bỏ chọn ${escapeHtml(doc.code)}">×</button></li>`).join('');
    document.querySelectorAll('#vdDocsRows tr[data-key]').forEach(row => {
      const selected = state.selection.has(row.dataset.key);
      row.dataset.selected = String(selected);
      const box = row.querySelector('input[type="checkbox"]');
      if (box) box.checked = selected;
    });
    const boxes = [...document.querySelectorAll('#vdDocsRows input[type="checkbox"]')];
    $('vdSelectPage').checked = boxes.length > 0 && boxes.every(box => box.checked);
  }

  function renderDocs() {
    const { rows, total, page, loading } = state.list;
    const body = $('vdDocsRows');
    // Moi o 1 dong (cat "…"), noi dung day du trong title khi re chuot.
    const cell = (text, cls = '') => `<td${cls ? ` class="${cls}"` : ''} title="${escapeHtml(text)}">${escapeHtml(text)}</td>`;
    if (loading && !rows.length) body.innerHTML = '<tr class="vd-empty"><td colspan="10">Đang tải chứng từ…</td></tr>';
    else if (!rows.length) body.innerHTML = '<tr class="vd-empty"><td colspan="10">Không có chứng từ nào trong khoảng đã chọn.</td></tr>';
    else {
      body.innerHTML = rows.map(doc => `<tr data-key="${escapeHtml(docKey(doc))}">
        <td><input type="checkbox" aria-label="Chọn ${escapeHtml(doc.code)}"></td>
        ${cell(doc.code, 'code')}
        ${cell(KIND_LABEL[doc.kind] || '')}
        ${cell(BRANCH_LABEL[doc.branch] || doc.branch)}
        ${cell(doc.date)}
        ${cell(doc.customerName + (doc.customerCode ? ' · ' + doc.customerCode : ''))}
        ${cell(doc.note)}
        ${cell(doc.status + (doc.orderCode ? ' · ' + doc.orderCode : ''))}
        <td class="num">${intFormat.format(doc.lineCount || 0)}</td>
        <td class="num">${intFormat.format(doc.total || 0)}</td></tr>`).join('');
    }
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    $('vdDocsCount').textContent = total ? `${intFormat.format(total)} chứng từ` : '';
    $('vdDocsPage').textContent = `Trang ${page}/${pages}`;
    $('vdDocsPrev').disabled = page <= 1;
    $('vdDocsNext').disabled = page >= pages;
    renderSelection();
  }

  async function loadDocs() {
    const version = ++state.list.version;
    state.list.loading = true;
    renderDocs();
    const params = new URLSearchParams({
      kind: $('vdKind').value, branch: $('vdBranch').value, from: $('vdFrom').value, to: $('vdTo').value,
      q: $('vdSearch').value.trim(), page: String(state.list.page), pageSize: String(PAGE_SIZE),
      sort: state.list.sort, dir: state.list.dir
    });
    try {
      const data = await api('/documents?' + params);
      if (version !== state.list.version) return;
      Object.assign(state.list, { rows: data.rows, total: data.total, page: data.page, loading: false });
      setMessage('vdCodesMessage', '');
    } catch (error) {
      if (version !== state.list.version) return;
      Object.assign(state.list, { rows: [], total: 0, loading: false });
      setMessage('vdCodesMessage', error.message, 'error');
    }
    renderDocs();
  }

  let searchTimer;
  function scheduleLoadDocs() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.list.page = 1; loadDocs(); }, 300);
  }

  async function addCodes() {
    const text = $('vdCodesInput').value;
    if (!text.trim()) { setMessage('vdCodesMessage', 'Hãy dán ít nhất một mã chứng từ.', 'warning'); return; }
    $('vdAddCodes').disabled = true;
    try {
      const result = await api('/documents/resolve?branch=' + encodeURIComponent($('vdBranch').value), { method: 'POST', body: { text } });
      const messages = [];
      let added = 0;
      for (const doc of result.found) {
        if (!doc.selectable) { messages.push(`${doc.code}: ${doc.warning}`); continue; }
        if (toggleDoc(doc, true)) added += 1;
        if (doc.warning) messages.push(`${doc.code}: ${doc.warning}`);
      }
      if (added) messages.unshift(`Đã thêm ${added} chứng từ.`);
      if (result.notFound.length) messages.push(`Không tìm thấy: ${result.notFound.join(', ')} (có thể chưa đồng bộ ~7 phút, hoặc trước 05/02/2026).`);
      if (result.ambiguous.length) messages.push(`Có ở cả Hà Nội lẫn Sài Gòn, hãy chọn trong bảng: ${result.ambiguous.map(a => a.code).join(', ')}.`);
      if (result.invalid && result.invalid.length) messages.push(`Không phải mã HD/DH: ${result.invalid.join(', ')}.`);
      if (result.truncated) messages.push('Chỉ nhận tối đa 300 mã mỗi lần.');
      setMessage('vdCodesMessage', messages.join('\n'), result.notFound.length || result.ambiguous.length ? 'warning' : '');
      if (added) $('vdCodesInput').value = '';
      renderSelection();
    } catch (error) {
      setMessage('vdCodesMessage', error.message, 'error');
    } finally {
      $('vdAddCodes').disabled = false;
    }
  }

  // ---------- Chạy xử lý ----------

  async function run(source) {
    const body = { source };
    if (source === 'documents') body.documents = [...state.selection.values()].map(d => ({ kind: d.kind, branch: d.branch, code: d.code }));
    else body.text = $('vdPasteInvoice').value;
    const buttons = ['vdRunDocs', 'vdRunPasteInvoice'].map($);
    buttons.forEach(b => { b.dataset.wasDisabled = b.disabled; b.disabled = true; });
    setMessage('vdRunError', '⏳ Đang xử lý…');
    try {
      const data = await api('/allocate', { method: 'POST', body });
      setMessage('vdRunError', '');
      if (data.masterData && state.meta) { state.meta.masterData = { ...state.meta.masterData, ...data.masterData, error: null }; renderMeta(); }
      state.alloc = data;
      renderAlloc();
      selectTab(state.tab);
      $('vdAllocResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      setMessage('vdRunError', error.message, 'error');
    } finally {
      buttons.forEach(b => { b.disabled = b.dataset.wasDisabled === 'true'; });
      renderSelection();
    }
  }

  // ---------- Kết quả Xử lý hóa đơn ----------

  function statusClass(status) {
    return status === 'OK' ? 'vd-status-ok' : status === 'Thiếu tồn' ? 'vd-status-shortage' : status === 'Không có mã' ? 'vd-status-missing' : '';
  }

  function cellHtml(column, value, extra = '') {
    if (NUMERIC.has(column)) {
      const sortValue = value === null || value === undefined || value === '' ? '' : ` data-sort-value="${Number(value)}"`;
      const title = column === GIA_NHAP && value !== null && value !== undefined && value !== '' ? ` title="${escapeHtml(decFormat.format(Number(value)))}"` : '';
      return `<td class="num"${sortValue}${title}>${escapeHtml(formatNumber(column, value))}</td>`;
    }
    // Moi o 1 dong (cat "…"); noi dung day du hien khi re chuot.
    const text = value === null || value === undefined ? '' : String(value);
    return `<td${CODE_COLUMNS.has(column) ? ' class="code"' : ''}${extra || (text ? ` title="${escapeHtml(text)}"` : '')}>${escapeHtml(text)}</td>`;
  }

  // Do rong mac dinh gon nhu bang cua app cu; nguoi dung van keo rong duoc.
  const COLUMN_WIDTHS = {
    'Trạng thái': 96, 'MÃ SP': 88, 'TÊN SP': 170, 'Mã VAT': 84, 'TÊN VAT': 170, 'Mã hóa đơn': 96,
    'Ghi chú hàng hóa': 150, 'Ghi chú tổng': 150, 'NGUỒN': 84, 'TỒN CÒN NHÁP': 96, 'Giá bán': 84,
    'TÊN KẾ TOÁN': 180, 'ĐVT': 64, 'SL': 72, [GIA_NHAP]: 96, '%VAT': 64, 'Thành tiền': 108
  };
  const headerLabel = column => column === GIA_NHAP ? 'GIÁ NHÁP (Giá bán/(1+%VAT))' : column;

  function headerHtml(columns, keyPrefix = '') {
    return '<tr>' + columns.map(c => `<th scope="col" data-column-key="${keyPrefix}${slug(c)}" data-default-width="${COLUMN_WIDTHS[c] || 120}" title="${escapeHtml(headerLabel(c))}"${NUMERIC.has(c) ? ' class="num"' : ''}>${escapeHtml(headerLabel(c))}</th>`).join('') + '</tr>';
  }

  // Nut sap xep o tieu de theo quy uoc chung (shared.css): chua sap ▲▼ · tang dan ▼ · giam dan ▲.
  const SORT_GLYPH = { none: '▲▼', asc: '▼', desc: '▲' };
  function sortButtonHtml(field, label, dir) {
    const state = dir === 'asc' || dir === 'desc' ? dir : 'none';
    const action = state === 'asc' ? 'Sắp xếp giảm dần' : state === 'desc' ? 'Bỏ sắp xếp' : 'Sắp xếp tăng dần';
    return `<button type="button" class="sort-button" data-sort-field="${escapeHtml(field)}" title="${action} theo ${escapeHtml(label)}" aria-label="${action} theo cột ${escapeHtml(label)}"><span class="sort-label">${escapeHtml(label)}</span><span class="sort-indicator" aria-hidden="true">${SORT_GLYPH[state]}</span></button>`;
  }
  const nextDir = (active, dir) => (!active ? 'asc' : dir === 'asc' ? 'desc' : '');

  /** Gan nut sap xep vao tieu de bang chon chung tu (sap xep o may chu, tren toan bo ket qua). */
  function renderDocsHeader() {
    document.querySelectorAll('#vdDocsTable thead th[data-column-key]').forEach(th => {
      const field = th.dataset.columnKey;
      if (field === 'select') return;
      const label = th.dataset.label || th.textContent.trim();
      th.dataset.label = label;
      const dir = state.list.sort === field ? state.list.dir : '';
      const resizer = th.querySelector(':scope > .tks-column-resizer');
      th.innerHTML = sortButtonHtml(field, label, dir);
      if (resizer) th.appendChild(resizer);
      th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none');
    });
  }

  // ---- Sap xep 2 cap nhu app cu (pandas sort_values kind="stable", o trong luon cuoi) ----
  const NO_SORT = '';

  function compareValues(a, b) {
    const emptyA = a === null || a === undefined || (typeof a === 'number' && Number.isNaN(a));
    const emptyB = b === null || b === undefined || (typeof b === 'number' && Number.isNaN(b));
    if (emptyA || emptyB) return emptyA === emptyB ? 0 : null; // null = o trong, xu ly rieng
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    const x = String(a);
    const y = String(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }

  function sortKeys() {
    const keys = [];
    const primary = $('vdSortPrimary').value;
    const secondary = $('vdSortSecondary').value;
    if (primary !== NO_SORT) {
      keys.push({ column: primary, dir: $('vdSortPrimaryDir').value });
      if (secondary !== NO_SORT && secondary !== primary) keys.push({ column: secondary, dir: $('vdSortSecondaryDir').value });
    }
    return keys;
  }

  function sortedAllocIndexes() {
    const data = state.alloc;
    const indexes = data.rows.map((_, i) => i);
    const keys = sortKeys().map(k => ({ ...k, idx: data.columns.indexOf(k.column) })).filter(k => k.idx >= 0);
    if (!keys.length) return indexes;
    return indexes.sort((i, j) => {
      for (const key of keys) {
        const a = data.rows[i].values[key.idx];
        const b = data.rows[j].values[key.idx];
        const result = compareValues(a, b);
        if (result === null) {
          const emptyA = a === null || a === undefined || Number.isNaN(a);
          return emptyA ? 1 : -1; // o trong cuoi ca 2 chieu (na_position="last")
        }
        if (result) return key.dir === 'desc' ? -result : result;
      }
      return i - j;
    });
  }

  function renderSortOptions() {
    const columns = state.alloc.columns;
    const options = `<option value="${NO_SORT}">(Không sắp xếp)</option>` + columns.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(headerLabel(c))}</option>`).join('');
    ['vdSortPrimary', 'vdSortSecondary'].forEach(id => {
      const select = $(id);
      const keep = select.value;
      select.innerHTML = options;
      select.value = columns.includes(keep) ? keep : NO_SORT;
    });
  }

  function renderAllocRows() {
    const data = state.alloc;
    const statusIdx = data.columns.indexOf('Trạng thái');
    const keys = sortKeys();
    $('vdSortNote').textContent = keys.length
      ? 'ℹ️ Đang sắp xếp theo cột đã chọn — các dòng cùng Mã hóa đơn có thể không còn liền kề.'
      : $('vdSortSecondary').value !== NO_SORT ? '⚠️ Chọn cột sắp xếp chính trước khi chọn cột sắp xếp phụ.' : '';
    // Tieu de bang the hien cot sap xep CHINH (dong bo voi o chon).
    const primary = $('vdSortPrimary').value;
    document.querySelectorAll('#vdAllocTable thead th[data-column-key]').forEach((th, i) => {
      const column = data.columns[i];
      if (!column) return;
      const dir = primary === column ? $('vdSortPrimaryDir').value : '';
      const resizer = th.querySelector(':scope > .tks-column-resizer');
      th.innerHTML = sortButtonHtml(column, headerLabel(column), dir);
      if (resizer) th.appendChild(resizer);
      th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none');
    });
    $('vdAllocRows').innerHTML = sortedAllocIndexes().map(index => {
      const row = data.rows[index];
      return '<tr data-index="' + index + '">' + row.values.map((value, i) => {
        if (i !== statusIdx) return cellHtml(data.columns[i], value);
        const title = ` title="${escapeHtml(row.reason || value)}"`;
        return `<td class="${statusClass(value)}"${title}>${escapeHtml(value)}${row.reason ? `<span class="vd-sr-only"> — ${escapeHtml(row.reason)}</span>` : ''}</td>`;
      }).join('') + '</tr>';
    }).join('');
  }

  function renderAlloc() {
    const data = state.alloc;
    const m = data.metrics;
    $('vdMetricInput').textContent = intFormat.format(m.inputCount);
    $('vdMetricOk').textContent = intFormat.format(m.okProducts);
    $('vdMetricShortage').textContent = intFormat.format(m.shortageProducts);
    $('vdMetricMissing').textContent = intFormat.format(m.missingCount);
    const banner = $('vdAllocBanner');
    if (data.rows.length) {
      const parts = [`${m.okProducts} OK`];
      if (m.shortageProducts) parts.push(`${m.shortageProducts} thiếu tồn`);
      if (m.missingCount) parts.push(`${m.missingCount} không có mã`);
      banner.textContent = parts.join(' · ');
      banner.dataset.tone = m.shortageProducts || m.missingCount ? 'warning' : 'success';
    } else {
      banner.textContent = 'Chưa có sản phẩm nào để hiển thị.';
      banner.dataset.tone = '';
    }
    const table = $('vdAllocTable');
    table.tHead.innerHTML = headerHtml(data.columns);
    renderSortOptions();
    renderAllocRows();
    if (window.TKSTables) window.TKSTables.refresh(table);
    renderQr();
  }

  function orderedRows(tbodyId, rows) {
    // Thứ tự đang hiển thị (sau khi sắp xếp).
    return [...$(tbodyId).querySelectorAll('tr[data-index]')].map(tr => rows[Number(tr.dataset.index)]);
  }

  async function exportExcel(view, columns, rows, button) {
    button.disabled = true;
    try {
      const blob = await api('/export', { method: 'POST', body: { view, columns, rows } });
      downloadBlob(blob, 'ket_qua_xu_ly_hoa_don.xlsx');
    } catch (error) {
      window.alert(error.message);
    } finally {
      button.disabled = false;
    }
  }

  // ---------- QR trong kết quả xử lý ----------

  function accountOptions(selectedKey, { manual = false, starred = [], placeholder = false } = {}) {
    const accounts = (state.meta && state.meta.vietqr.accounts) || [];
    const option = (a, star) => `<option value="${escapeHtml(a.key)}"${a.key === selectedKey ? ' selected' : ''}>${star ? '★ ' : ''}${escapeHtml(a.label)}</option>`;
    const group = (label, list, star) => (list.length ? `<optgroup label="${label}">${list.map(a => option(a, star)).join('')}</optgroup>` : '');
    const suggested = starred.map(key => accounts.find(a => a.key === key)).filter(Boolean);
    const rest = accounts.filter(a => !starred.includes(a.key));
    return (placeholder ? `<option value=""${selectedKey ? '' : ' selected'}>— Chọn tài khoản nhận tiền —</option>` : '')
      + group('Gợi ý từ hóa đơn', suggested, true)
      + group('Tài khoản công ty', rest.filter(a => (a.group || 'company') === 'company'), false)
      + group('Tài khoản cá nhân', rest.filter(a => a.group === 'personal'), false)
      + (manual ? `<optgroup label="Khác"><option value="${MANUAL}"${selectedKey === MANUAL ? ' selected' : ''}>Tài khoản khác (nhập tay)…</option></optgroup>` : '');
  }

  function qrCardHtml(id, title, amount, accountKey, warning) {
    return `<div class="vd-qr-card" data-qr-card="${id}">
      <h5>${escapeHtml(title)}</h5>
      ${warning ? '<p class="vd-message vd-warning">⚠️ Một số dòng thiếu Giá bán/Giá nhập, số tiền QR có thể chưa đầy đủ.</p>' : ''}
      <label>Tài khoản nhận tiền <select data-qr-account>${accountOptions(accountKey)}</select></label>
      <label>Số tiền <input type="text" class="vd-input" data-qr-amount inputmode="numeric" value="${escapeHtml(formatAmount(amount))}"></label>
      <button class="btn-primary" type="button" data-qr-generate>🔲 Tạo mã QR — ${escapeHtml(intFormat.format(amount))}đ</button>
      <div class="vd-qr-result" data-qr-result hidden></div>
    </div>`;
  }

  function renderQr() {
    const qr = state.alloc && state.alloc.qr;
    $('vdQr').hidden = !qr;
    if (!qr) return;
    const transfer = $('vdTransfer');
    transfer.value = qr.transferContent;
    $('vdTransferHint').hidden = !!qr.transferContent.trim();
    document.querySelectorAll('[data-qr-mode]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.qrMode === state.qrMode)));
    if (state.qrMode === 'co_vat') {
      $('vdQrModeHint').textContent = 'Mỗi nguồn dùng một mã QR riêng, số tiền tính theo Giá nhập (trước VAT). Chọn tài khoản nhận tiền cho từng nguồn bên dưới.';
      $('vdQrCards').innerHTML = qr.bySource.map((s, i) => qrCardHtml('src' + i, 'Nguồn: ' + s.nguon, s.defaultAmount, s.defaultAccountKey, s.thieuDonGia)).join('');
      $('vdQrCards').dataset.captions = JSON.stringify(qr.bySource.map(s => s.nguon));
    } else {
      $('vdQrModeHint').textContent = 'Gộp toàn bộ các nguồn thành 1 QR duy nhất, số tiền tính theo Giá bán (đã gồm VAT).';
      $('vdQrCards').innerHTML = qrCardHtml('total', 'Tất cả nguồn', qr.total.defaultAmount, qr.total.defaultAccountKey, qr.total.thieuDonGia);
      $('vdQrCards').dataset.captions = JSON.stringify(['Tất cả nguồn']);
    }
  }

  async function generateQr({ accountKey, manual, amount, addInfo, resultEl, caption }) {
    resultEl.hidden = false;
    resultEl.textContent = '⏳ Đang tạo mã QR…';
    try {
      const data = await api('/qr/url', { method: 'POST', body: { accountKey, manual, amount: String(amount), addInfo } });
      const label = caption || data.accountLabel;
      const text = `${label} — ${intFormat.format(data.amount)}đ${data.addInfo && !caption ? ' — ' + data.addInfo : ''}`;
      resultEl.innerHTML = `<figure class="vd-qr-result">
        <button type="button" class="vd-qr-zoom" data-qr-zoom title="Bấm để phóng to"><img src="${escapeHtml(data.url)}" alt="Mã QR chuyển khoản ${escapeHtml(intFormat.format(data.amount))}đ"></button>
        <figcaption>${escapeHtml(text)}</figcaption>
        <button type="button" class="btn-secondary vd-small-btn" data-qr-download>⬇️ Tải mã QR</button></figure>`;
      const figure = resultEl.querySelector('figure');
      figure.dataset.url = data.url;
      figure.dataset.caption = text;
      figure.dataset.fileName = `QR_${slug(label)}_${data.amount}.png`;
    } catch (error) {
      resultEl.innerHTML = `<p class="vd-message vd-error">${escapeHtml(error.message)}</p>`;
    }
  }

  function openQrViewer(figure) {
    const viewer = $('vdQrViewer');
    $('vdQrViewerImg').src = figure.dataset.url;
    $('vdQrViewerCaption').textContent = figure.dataset.caption || '';
    viewer.dataset.url = figure.dataset.url;
    viewer.dataset.fileName = figure.dataset.fileName;
    viewer.hidden = false;
    $('vdQrViewerClose').focus();
  }

  function closeQrViewer() {
    $('vdQrViewer').hidden = true;
  }

  async function downloadQr(url, fileName, button) {
    if (button) button.disabled = true;
    try {
      // Ảnh nằm ở img.vietqr.io: tải về dạng blob để lưu đúng tên file PNG.
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) throw new Error('fetch');
      downloadBlob(await res.blob(), fileName || 'ma_qr.png');
    } catch (error) {
      // Máy chủ ảnh chặn tải trực tiếp thì mở ảnh ở tab mới để người dùng lưu.
      window.open(url, '_blank', 'noopener');
    } finally {
      if (button) button.disabled = false;
    }
  }

  function bindQrResultActions(container) {
    container.addEventListener('click', event => {
      const figure = event.target.closest('figure.vd-qr-result');
      if (!figure || !figure.dataset.url) return;
      if (event.target.closest('[data-qr-zoom]')) openQrViewer(figure);
      else if (event.target.closest('[data-qr-download]')) downloadQr(figure.dataset.url, figure.dataset.fileName, event.target.closest('button'));
    });
  }

  // ---------- Tạo QR (tab 2) ----------

  function accountByKey(key) {
    return ((state.meta && state.meta.vietqr.accounts) || []).find(a => a.key === key) || null;
  }

  /** O Số tiền tab Tao QR: chi so (don vi "đ" o ben phai o), 0 = de trong. */
  function formatAmountPlain(value) {
    const amount = Math.max(Math.trunc(Number(value) || 0), 0);
    return amount > 0 ? intFormat.format(amount) : '';
  }

  function amountWords(value) {
    return window.TKSVndWords ? window.TKSVndWords.toVietnameseWords(value) : '';
  }

  function renderAccountSelect() {
    const select = $('vdManualAccount');
    select.innerHTML = accountOptions(state.matchedAccounts[0] || select.value || '', { manual: true, placeholder: true, starred: state.matchedAccounts });
    if (state.meta) $('vdBankCodes').textContent = 'Mã ngân hàng VietQR thường gặp: ' + state.meta.vietqr.commonBankCodes + '.';
    updateManualFields();
  }

  /** Cung quy tac voi may chu (vietqr.isValidManualField): 2-25 chu/so. */
  function manualFieldsValid() {
    const ok = value => /^[A-Za-z0-9]{2,25}$/.test(String(value || '').trim());
    return ok($('vdManualBank').value) && ok($('vdManualNo').value);
  }

  function updateManualFields() {
    const manual = $('vdManualAccount').value === MANUAL;
    $('vdManualFields').hidden = !manual;
    // Chi bao loi sau khi nguoi dung da roi o / bam tao — khong bao loi truoc khi thao tac.
    $('vdManualInvalid').hidden = !(manual && state.manualTouched && !manualFieldsValid());
    const account = manual ? null : accountByKey($('vdManualAccount').value);
    const detail = $('vdAccountDetail');
    detail.hidden = !account;
    if (account) {
      detail.innerHTML = account.accountNo
        ? `<strong>${escapeHtml(account.accountName || account.label)}</strong><br>${escapeHtml(account.bankId)} · ${escapeHtml(account.accountNo)}`
        : escapeHtml(account.label);
    }
    refreshQrPanel();
  }

  /** Gia tri form Tao QR + ly do chua tao duoc; key dung de biet QR da tao con dung voi form khong. */
  function qrFormValues() {
    const key = $('vdManualAccount').value;
    const manual = key === MANUAL;
    const values = {
      accountKey: manual || !key ? undefined : key,
      manual: manual ? { bankId: $('vdManualBank').value.trim(), accountNo: $('vdManualNo').value.trim(), accountName: $('vdManualName').value.trim() } : undefined,
      amount: parseAmount($('vdManualAmount').value),
      addInfo: $('vdManualContent').value.trim(),
      reason: ''
    };
    if (!key) values.reason = 'Chọn tài khoản nhận tiền để tạo QR.';
    else if (manual && !manualFieldsValid()) values.reason = 'Nhập đủ Mã ngân hàng và Số tài khoản.';
    values.key = JSON.stringify([key, values.manual || null, values.amount, values.addInfo]);
    return values;
  }

  function qrPanelState(values) {
    if (state.invoiceBusy) return 'reading';
    const qr = state.qr;
    if (qr.status === 'busy') return 'busy';
    if (qr.status === 'done') return qr.key === values.key ? 'success' : 'stale';
    if (qr.status === 'error' && qr.key === values.key) return 'error';
    if (!$('vdAmountConfirm').hidden) return 'confirm';
    return values.reason ? 'empty' : 'ready';
  }

  const QR_BADGES = {
    empty: 'Chưa đủ thông tin', reading: 'Đang đọc hóa đơn', busy: 'Đang tạo…', ready: 'Sẵn sàng tạo',
    confirm: 'Chờ xác nhận số tiền', success: 'Đã tạo', stale: 'Thông tin đã đổi', error: 'Lỗi tạo QR'
  };

  function setSummary(id, text, emptyText = '—') {
    const el = $(id);
    el.textContent = text || emptyText;
    el.classList.toggle('is-empty', !text);
  }

  function updateSteps(values, panelState) {
    const done = {
      source: !!$('vdManualAccount').value && !values.reason,
      amount: values.amount > 0 && panelState !== 'confirm',
      create: panelState === 'success'
    };
    let currentSet = false;
    document.querySelectorAll('#vdQrSteps li').forEach(li => {
      if (done[li.dataset.step]) li.dataset.status = 'done';
      else if (!currentSet) { li.dataset.status = 'current'; currentSet = true; }
      else delete li.dataset.status;
    });
  }

  /** Dong bo bang QR ben phai voi form: trang thai, tom tat noi dung QR, nut chinh. */
  function refreshQrPanel() {
    const values = qrFormValues();
    const panelState = qrPanelState(values);
    $('vdQrPanel').dataset.state = panelState;
    $('vdQrBadge').textContent = QR_BADGES[panelState];

    const account = values.accountKey ? accountByKey(values.accountKey) : null;
    const name = values.manual ? values.manual.accountName : account ? (account.accountName || account.label) : '';
    const bank = values.manual ? [values.manual.bankId, values.manual.accountNo].filter(Boolean).join(' · ')
      : account ? (account.accountNo ? `${account.bankId} · ${account.accountNo}` : account.label) : '';
    setSummary('vdSumName', name);
    setSummary('vdSumBank', bank);
    setSummary('vdSumAmount', values.amount > 0 ? intFormat.format(values.amount) + ' đ' : '', 'Người chuyển tự nhập');
    $('vdSumWords').textContent = amountWords(values.amount);
    setSummary('vdSumContent', values.addInfo, 'Trống');
    $('vdAmountWords').textContent = values.amount > 0 ? amountWords(values.amount) : 'Để trống: người chuyển tự nhập số tiền.';

    $('vdQrPlaceholder').hidden = !['empty', 'ready', 'confirm'].includes(panelState);
    $('vdQrLoading').hidden = !['reading', 'busy'].includes(panelState);
    $('vdQrLoadingText').textContent = panelState === 'reading' ? 'AI đang đọc hóa đơn…' : 'Đang tạo mã QR…';
    $('vdManualResult').hidden = !['success', 'stale'].includes(panelState);
    const stale = $('vdManualResult').querySelector('.vd-qr-stale');
    if (stale) stale.hidden = panelState !== 'stale';
    $('vdQrError').hidden = panelState !== 'error';
    $('vdQrError').textContent = panelState === 'error' ? state.qr.error : '';
    updateSteps(values, panelState);

    $('vdQrCta').hidden = panelState === 'success';
    $('vdQrActions').hidden = panelState !== 'success';
    $('vdGenerateLabel').textContent = panelState === 'stale' ? 'Tạo lại mã QR'
      : panelState === 'confirm' ? 'Xác nhận số tiền & tạo QR' : 'Tạo mã QR';
    $('vdManualGenerate').disabled = !!values.reason || panelState === 'reading' || panelState === 'busy';
    $('vdQrBlocker').textContent = values.reason
      || (panelState === 'stale' ? 'Tài khoản / số tiền / nội dung đã thay đổi — mã QR cũ không còn đúng.' : '')
      || (panelState === 'confirm' ? 'Chọn số tiền đúng ở mục Xác nhận số tiền.' : '')
      || (panelState === 'ready' && values.amount <= 0 ? 'Chưa có số tiền — mã QR để người chuyển tự nhập.' : '');
  }

  async function generateManualQr() {
    const values = qrFormValues();
    if (values.reason) {
      state.manualTouched = true;
      updateManualFields();
      ($('vdManualAccount').value === MANUAL ? $('vdManualBank') : $('vdManualAccount')).focus();
      return;
    }
    if (state.invoiceBusy || state.qr.status === 'busy') return;
    hideAmountConfirm();
    $('vdManualAmount').classList.remove('vd-input--check');
    $('vdQrActionMsg').textContent = '';
    state.qr = { status: 'busy', key: values.key };
    refreshQrPanel();
    try {
      const data = await api('/qr/url', { method: 'POST', body: { accountKey: values.accountKey, manual: values.manual, amount: String(values.amount), addInfo: values.addInfo } });
      const label = data.accountLabel;
      state.qr = {
        status: 'done', key: values.key, url: data.url,
        caption: `${label} — ${intFormat.format(data.amount)}đ${data.addInfo ? ' — ' + data.addInfo : ''}`,
        fileName: `QR_${slug(label)}_${data.amount}.png`
      };
      $('vdManualResult').innerHTML = `<figure class="vd-qr-figure">
        <button type="button" class="vd-qr-zoom" data-qr-zoom title="Bấm để phóng to"><img src="${escapeHtml(data.url)}" alt="Mã QR chuyển khoản ${escapeHtml(intFormat.format(data.amount))}đ cho ${escapeHtml(label)}"></button>
        <div class="vd-qr-stale" hidden>Thông tin đã thay đổi —<br>bấm “Tạo lại mã QR”</div>
      </figure>`;
    } catch (error) {
      state.qr = { status: 'error', key: values.key, error: error.message };
    }
    refreshQrPanel();
    if (state.qr.status === 'done') {
      if (window.matchMedia && window.matchMedia('(max-width: 900px)').matches) $('vdQrPanel').scrollIntoView({ block: 'start' });
      $('vdQrDownload').focus({ preventScroll: true });
    }
  }

  function openManualQrViewer() {
    if (state.qr.url) openQrViewer({ dataset: { url: state.qr.url, caption: state.qr.caption, fileName: state.qr.fileName } });
  }

  function showQrActionMessage(tone, text) {
    const msg = $('vdQrActionMsg');
    msg.dataset.tone = tone;
    msg.textContent = text;
  }

  /** Sao chep anh QR vao clipboard (img.vietqr.io cho phep CORS) de dan thang vao Zalo / email. */
  async function copyQrImage() {
    if (!state.qr.url) return;
    try {
      if (!navigator.clipboard || !window.ClipboardItem) throw new Error('unsupported');
      const blob = fetch(state.qr.url, { mode: 'cors' })
        .then(res => { if (!res.ok) throw new Error('fetch'); return res.blob(); })
        .then(data => (data.type === 'image/png' ? data : new Blob([data], { type: 'image/png' })));
      await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
      // Nho kich thuoc anh vua chep: lo tay Ctrl+V lai tren trang thi khong gui QR cho AI doc nhu hoa don.
      const img = $('vdManualResult').querySelector('img');
      state.copiedQrDims = img && img.naturalWidth ? [img.naturalWidth, img.naturalHeight] : null;
      showQrActionMessage('', 'Đã sao chép ảnh QR — dán (Ctrl+V) vào Zalo / email để gửi khách.');
    } catch (error) {
      showQrActionMessage('error', 'Trình duyệt không cho sao chép ảnh — dùng “Tải mã QR”.');
    }
  }

  async function isCopiedQrImage(file) {
    const dims = state.copiedQrDims;
    if (!dims || !window.createImageBitmap) return false;
    try {
      const bitmap = await createImageBitmap(file);
      const same = bitmap.width === dims[0] && bitmap.height === dims[1];
      bitmap.close();
      return same;
    } catch (error) {
      return false;
    }
  }

  /** Bat dau hoa don / QR tiep theo: xoa anh, so tien, tai khoan, noi dung, QR. */
  function startNewQr() {
    if (state.invoiceBusy) return;
    $('vdManualContent').value = '';
    if (!$('vdInvoiceCard').hidden) removeInvoice();
    else {
      $('vdInvoiceInfo').hidden = true;
      resetInvoiceResult();
      $('vdInvoiceDrop').focus();
    }
  }

  const MAX_INVOICE_SIDE = 2000;

  function canvasToJpeg(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('toBlob'))), 'image/jpeg', 0.85));
  }

  function whiteCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return { canvas, ctx };
  }

  /** PDF: trang dau (ten don vi ban) + trang cuoi (tong thanh toan) dat canh nhau thanh 1 anh. */
  async function pdfToCanvas(file) {
    const pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
    const pageNumbers = doc.numPages > 1 ? [1, doc.numPages] : [1];
    const rendered = [];
    for (const number of pageNumbers) {
      const page = await doc.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(3, 1600 / base.height) });
      const { canvas, ctx } = whiteCanvas(viewport.width, viewport.height);
      // intent 'print': pdf.js khong cho requestAnimationFrame -> van render khi tab dang an.
      await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise;
      rendered.push(canvas);
    }
    const sheet = whiteCanvas(rendered.reduce((sum, c) => sum + c.width, 0), Math.max(...rendered.map(c => c.height)));
    let x = 0;
    for (const c of rendered) { sheet.ctx.drawImage(c, x, 0); x += c.width; }
    return sheet.canvas;
  }

  /** Anh/PDF hoa don -> JPEG canh dai <= 2000px (giam dung luong gui len may chu va AI). */
  async function invoiceFileToJpeg(file) {
    try {
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return await canvasToJpeg(await pdfToCanvas(file));
      const bitmap = await createImageBitmap(file);
      try {
        const scale = Math.min(1, MAX_INVOICE_SIDE / Math.max(bitmap.width, bitmap.height));
        const { canvas, ctx } = whiteCanvas(bitmap.width * scale, bitmap.height * scale);
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return await canvasToJpeg(canvas);
      } finally {
        bitmap.close();
      }
    } catch (error) {
      throw new Error('Không mở được file — chỉ nhận ảnh JPG, PNG, WebP hoặc file PDF.');
    }
  }

  /** Xoa so tien / tai khoan / QR / o xac nhan cua hoa don truoc: tranh tao QR nham. */
  function resetInvoiceResult() {
    state.matchedAccounts = [];
    state.qr = { status: 'idle' };
    state.manualTouched = false;
    $('vdManualAmount').value = '';
    $('vdManualAmount').classList.remove('vd-input--check');
    $('vdManualAccount').value = '';
    $('vdManualResult').innerHTML = '';
    $('vdAmountAi').hidden = true;
    $('vdAccountAi').hidden = true;
    hideAmountConfirm();
    renderAccountSelect();
  }

  /** name = null -> quay ve vung dan; blob = null -> the chua co anh (PDF dang render). */
  function setInvoicePreview(blob, name) {
    if (state.invoiceThumbUrl) URL.revokeObjectURL(state.invoiceThumbUrl);
    state.invoiceThumbUrl = blob ? URL.createObjectURL(blob) : null;
    const thumb = $('vdInvoiceThumb');
    if (blob) thumb.src = state.invoiceThumbUrl;
    else thumb.removeAttribute('src');
    $('vdInvoiceThumbBtn').hidden = !blob;
    $('vdInvoiceView').hidden = !blob;
    $('vdInvoiceName').textContent = name || '';
    $('vdInvoiceCard').hidden = !name;
    $('vdInvoiceDrop').hidden = !!name;
  }

  function setInvoiceStatus(text) {
    $('vdInvoiceStatusText').textContent = text;
    $('vdInvoiceStatus').hidden = !text;
  }

  /** Anh trong clipboard (chup man hinh / Copy image) -> File, khong co thi null. */
  function clipboardImage(event) {
    const items = event.clipboardData ? Array.from(event.clipboardData.items || []) : [];
    const item = items.find(i => i.kind === 'file' && /^image\//.test(i.type));
    return item ? item.getAsFile() : null;
  }

  const ICON_WARN = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/></svg>';
  const ICON_INFO = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-5M12 8h.01"/></svg>';

  function calloutHtml(tone, text, note = '') {
    return `<li class="vd-callout vd-callout--${tone}"${note ? ` data-note="${note}"` : ''}>${tone === 'info' ? ICON_INFO : ICON_WARN}<span>${escapeHtml(text)}</span></li>`;
  }

  /** Thong bao 1 dong (loi / nhac) o vung ket qua hoa don. */
  function showInvoiceInfo(tone, text) {
    const info = $('vdInvoiceInfo');
    info.hidden = false;
    info.dataset.tone = tone;
    info.innerHTML = `<ul class="vd-callouts">${calloutHtml(tone === 'success' ? 'info' : tone, String(text).replace(/^⚠️\s*/, ''))}</ul>`;
  }

  /** Ket qua AI: Cong ty ban / Tong thanh toan (+ trang thai doi chieu) / Tai khoan goi y + cac canh bao rieng. */
  function renderAiResult(parsed, { autoGenerate, needConfirm }) {
    const info = $('vdInvoiceInfo');
    const matched = state.matchedAccounts.map(accountByKey).filter(Boolean);
    const pill = parsed.totalPayment === null ? ''
      : parsed.amountStatus === 'ok' ? '<span class="vd-pill vd-pill--ok">Đã đối chiếu</span>'
        : parsed.amountStatus === 'corrected' ? '<span class="vd-pill vd-pill--warn">Đã sửa theo số bằng chữ</span>'
          : '<span class="vd-pill vd-pill--warn">Cần xác nhận</span>';
    const notes = (parsed.warnings || []).map(warning => calloutHtml('warning', warning));
    if (!matched.length) notes.push(calloutHtml('warning', 'Không có tài khoản khớp với công ty bán — chọn tài khoản nhận tiền ở bên dưới.'));
    if (needConfirm) notes.push(calloutHtml('warning', 'Chưa tạo QR: xác nhận số tiền ở mục bên dưới.', 'confirm'));
    else if (autoGenerate) notes.push(calloutHtml('info', 'Đã chọn tài khoản và tạo mã QR — kiểm tra lại trước khi gửi khách.'));
    info.dataset.tone = notes.length && !autoGenerate ? 'warning' : 'success';
    info.innerHTML = `<dl class="vd-ai-grid">
      <div><dt>Công ty bán</dt><dd>${escapeHtml(parsed.sellerName || 'Không nhận diện được')}</dd></div>
      <div><dt>Tổng thanh toán</dt><dd class="num">${parsed.totalPayment !== null ? escapeHtml(intFormat.format(parsed.totalPayment)) + ' đ' : 'Không đọc được'}</dd>${pill ? `<dd>${pill}</dd>` : ''}</div>
      <div><dt>Tài khoản gợi ý</dt><dd>${matched.length ? matched.map(a => escapeHtml(String(a.label).split(' — ')[0])).join(', ') : 'Không khớp'}</dd></div>
    </dl>${notes.length ? `<ul class="vd-callouts">${notes.join('')}</ul>` : ''}`;
    info.hidden = false;
  }

  function removeInvoice() {
    if (state.invoiceBusy) return;
    setInvoicePreview(null, null);
    setInvoiceStatus('');
    $('vdInvoiceInfo').hidden = true;
    resetInvoiceResult();
    $('vdInvoiceDrop').focus();
  }

  function openInvoiceViewer() {
    if (!state.invoiceThumbUrl) return;
    state.invoiceViewerReturn = document.activeElement;
    $('vdInvoiceViewerImg').src = state.invoiceThumbUrl;
    $('vdInvoiceViewerScroll').classList.remove('is-zoomed');
    $('vdInvoiceViewer').hidden = false;
    $('vdInvoiceViewerClose').focus();
  }

  function closeInvoiceViewer() {
    $('vdInvoiceViewer').hidden = true;
    const back = state.invoiceViewerReturn;
    state.invoiceViewerReturn = null;
    if (back && document.contains(back)) back.focus();
  }

  function hideAmountConfirm() {
    $('vdAmountConfirm').hidden = true;
    $('vdAmountOptions').innerHTML = '';
    const note = $('vdInvoiceInfo').querySelector('[data-note="confirm"]');
    if (note) note.remove();
  }

  /** So tien chua chac (AI doc lech / khong doi chieu duoc): cho chon 1 trong cac so doc tren hoa don. */
  function showAmountConfirm(parsed) {
    const sources = parsed.amountSources || {};
    const groups = new Map();
    const add = (value, label, words) => {
      if (!(value > 0)) return;
      const group = groups.get(value) || { labels: [], words: false };
      group.labels.push(label);
      group.words = group.words || words;
      groups.set(value, group);
    };
    add(sources.aiTotal, 'Tổng cộng tiền thanh toán (AI đọc chữ số)', false);
    add(sources.subtotalPlusVat, 'Cộng tiền hàng + Tiền thuế GTGT', false);
    add(sources.words, 'Số tiền viết bằng chữ', true);
    if (!groups.size) return false;
    $('vdAmountConfirmHint').textContent = parsed.amountStatus === 'corrected'
      ? 'Số AI đọc ở dòng Tổng thanh toán khác với Cộng tiền hàng + Thuế và Số tiền bằng chữ. Đã chọn sẵn số khớp nhiều nguồn hơn — đối chiếu với ảnh hóa đơn rồi xác nhận.'
      : 'Không đối chiếu được số tiền AI đọc. Đối chiếu với ảnh hóa đơn, chọn số đúng (hoặc sửa ở ô Số tiền) rồi xác nhận.';
    $('vdAmountOptions').innerHTML = Array.from(groups.entries())
      .sort((a, b) => b[1].labels.length - a[1].labels.length)
      .map(([value, group]) => `<label class="vd-amount-option">
        <input type="radio" name="vdAmountPick" value="${value}"${value === parsed.totalPayment ? ' checked' : ''}>
        <span class="vd-amount-option-body">
          <span class="vd-amount-value">${escapeHtml(intFormat.format(value))} đ</span>
          <span class="vd-amount-source">${group.labels.map(escapeHtml).join(' · ')}</span>
          ${group.words && sources.wordsText ? `<span class="vd-amount-words">“${escapeHtml(sources.wordsText)}”</span>` : ''}
        </span>
      </label>`).join('');
    $('vdAmountConfirm').hidden = false;
    return true;
  }

  function confirmAmount() {
    if (parseAmount($('vdManualAmount').value) <= 0) { $('vdManualAmount').focus(); return; }
    hideAmountConfirm();
    $('vdManualAmount').classList.remove('vd-input--check');
    generateManualQr(); // thieu tai khoan thi generateManualQr dua focus ve o tai khoan
  }

  /** Mot duong xu ly chung cho dan (Ctrl+V), keo tha va chon file. */
  async function onInvoiceFile(file, name) {
    if (!file || state.invoiceBusy) return;
    state.invoiceBusy = true;
    const input = $('vdInvoiceInput');
    const card = $('vdInvoiceCard');
    const info = $('vdInvoiceInfo');
    const label = name || file.name || 'Ảnh hóa đơn';
    const isImage = /^image\//.test(file.type);
    resetInvoiceResult();
    info.hidden = true;
    setInvoicePreview(isImage ? file : null, label);
    setInvoiceStatus('AI đang đọc hóa đơn… (thường mất 5–20 giây)');
    card.setAttribute('aria-busy', 'true');
    input.disabled = true;
    $('vdInvoiceRemove').disabled = true;
    let autoGenerate = false;
    let needConfirm = false;
    let parsed = null;
    try {
      const jpeg = await invoiceFileToJpeg(file);
      if (!isImage) setInvoicePreview(jpeg, label);
      const form = new FormData();
      form.append('file', jpeg, 'hoa-don.jpg');
      parsed = await api('/qr/parse-image', { method: 'POST', body: form });
      if (parsed.error) {
        showInvoiceInfo('warning', '⚠️ ' + parsed.error);
      } else {
        if (parsed.totalPayment !== null) $('vdManualAmount').value = formatAmountPlain(parsed.totalPayment);
        $('vdAmountAi').hidden = parsed.totalPayment === null;
        state.matchedAccounts = parsed.matchedAccountKeys || [];
        // Chi tu tao QR khi so tien da doi chieu duoc; con lai bat nguoi dung xac nhan.
        needConfirm = parsed.totalPayment !== null && parsed.amountStatus !== 'ok';
        autoGenerate = state.matchedAccounts.length > 0 && parsed.totalPayment > 0 && !needConfirm;
        renderAiResult(parsed, { autoGenerate, needConfirm });
      }
    } catch (error) {
      // Khong mo duoc file -> quay ve vung dan; loi AI -> giu anh de thu lai / xoa.
      if (!state.invoiceThumbUrl) setInvoicePreview(null, null);
      showInvoiceInfo('error', '⚠️ ' + error.message);
    } finally {
      setInvoiceStatus('');
      card.removeAttribute('aria-busy');
      input.disabled = false;
      input.value = ''; // chon lai cung file van chay
      $('vdInvoiceRemove').disabled = false;
      state.invoiceBusy = false;
    }
    $('vdAccountAi').hidden = !state.matchedAccounts.length;
    renderAccountSelect();
    if (needConfirm && showAmountConfirm(parsed)) {
      $('vdManualAmount').classList.add('vd-input--check');
      refreshQrPanel();
      const picked = document.querySelector('input[name="vdAmountPick"]:checked') || document.querySelector('input[name="vdAmountPick"]');
      $('vdAmountConfirm').scrollIntoView({ block: 'nearest' });
      if (picked) picked.focus({ preventScroll: true });
    }
    if (autoGenerate) generateManualQr();
  }

  function bindInvoiceDrop() {
    const drop = $('vdInvoiceDrop');
    const card = $('vdInvoiceCard');
    const input = $('vdInvoiceInput');
    const qrPageOpen = () => !$('vdQrPage').hidden;
    const hasFiles = event => !!event.dataTransfer && Array.from(event.dataTransfer.types || []).includes('Files');
    const openPicker = () => { if (!state.invoiceBusy) input.click(); };

    input.addEventListener('change', () => onInvoiceFile(input.files[0]));
    drop.addEventListener('click', openPicker);
    drop.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openPicker(); }
    });
    [drop, card].forEach(zone => {
      zone.addEventListener('dragenter', event => { if (hasFiles(event)) zone.classList.add('is-dragover'); });
      zone.addEventListener('dragleave', event => { if (!zone.contains(event.relatedTarget)) zone.classList.remove('is-dragover'); });
    });
    // Tha file o bat ky dau tren tab Tao QR cung nhan (tranh trinh duyet mo anh, roi khoi trang).
    document.addEventListener('dragover', event => { if (qrPageOpen() && hasFiles(event)) event.preventDefault(); });
    document.addEventListener('drop', event => {
      if (!qrPageOpen() || !hasFiles(event)) return;
      event.preventDefault();
      drop.classList.remove('is-dragover');
      card.classList.remove('is-dragover');
      onInvoiceFile(event.dataTransfer.files[0]);
    });
    // Ctrl+V o bat ky dau tren tab Tao QR (thay anh dang co); dan chu vao o nhap van binh thuong.
    document.addEventListener('paste', async event => {
      if (!qrPageOpen() || !$('vdInvoiceViewer').hidden) return;
      const file = clipboardImage(event);
      if (file) {
        event.preventDefault();
        if (await isCopiedQrImage(file)) {
          showQrActionMessage('', 'Ảnh vừa dán là mã QR đã sao chép (không phải hóa đơn) nên không đọc lại.');
          return;
        }
        onInvoiceFile(file, 'Ảnh dán từ clipboard');
      } else if (document.activeElement === drop) {
        showInvoiceInfo('warning', '⚠️ Clipboard chưa có ảnh — chụp màn hình hoặc Sao chép ảnh hóa đơn rồi bấm Ctrl+V lại.');
      }
    });

    $('vdInvoiceThumbBtn').addEventListener('click', openInvoiceViewer);
    $('vdInvoiceView').addEventListener('click', openInvoiceViewer);
    $('vdInvoiceRemove').addEventListener('click', removeInvoice);
    $('vdInvoiceViewerClose').addEventListener('click', closeInvoiceViewer);
    $('vdInvoiceViewer').addEventListener('click', event => { if (event.target === $('vdInvoiceViewer')) closeInvoiceViewer(); });
    $('vdInvoiceViewerImg').addEventListener('click', () => $('vdInvoiceViewerScroll').classList.toggle('is-zoomed'));
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('vdInvoiceViewer').hidden) closeInvoiceViewer(); });

    $('vdAmountOptions').addEventListener('change', event => {
      if (event.target.name === 'vdAmountPick') {
        $('vdManualAmount').value = formatAmountPlain(Number(event.target.value));
        refreshQrPanel();
      }
    });
    // Sua tay o Số tiền = so khac: bo chon cac phuong an.
    $('vdManualAmount').addEventListener('input', () => {
      document.querySelectorAll('input[name="vdAmountPick"]').forEach(radio => { radio.checked = false; });
    });
    $('vdAmountConfirmOk').addEventListener('click', confirmAmount);
    $('vdAmountConfirmView').addEventListener('click', openInvoiceViewer);
  }

  // ---------- Khởi tạo ----------

  function syncTheme() {
    const light = document.documentElement.dataset.theme === 'light';
    $('themeLabel').textContent = light ? 'Dark mode' : 'Light mode';
    const button = $('themeToggle');
    button.setAttribute('aria-label', light ? 'Chuyển sang giao diện tối' : 'Chuyển sang giao diện sáng');
    button.setAttribute('aria-pressed', String(light));
  }

  function bindEvents() {
    if (window.TKSCellSelect) window.TKSCellSelect.init([$('vdAllocTable')]);
    $('vdRefreshSheets').addEventListener('click', refreshSheets);
    document.querySelectorAll('[data-input-mode]').forEach(b => b.addEventListener('click', () => selectMode(b.dataset.inputMode)));
    ['vdSortPrimary', 'vdSortPrimaryDir', 'vdSortSecondary', 'vdSortSecondaryDir'].forEach(id => $(id).addEventListener('change', () => { if (state.alloc) renderAllocRows(); }));
    ['vdKind', 'vdBranch', 'vdFrom', 'vdTo'].forEach(id => $(id).addEventListener('change', () => { state.list.page = 1; loadDocs(); }));
    $('vdSearch').addEventListener('input', scheduleLoadDocs);
    $('vdDocsTable').tHead.addEventListener('click', event => {
      const button = event.target.closest('[data-sort-field]');
      if (!button) return;
      const field = button.dataset.sortField;
      const dir = nextDir(state.list.sort === field, state.list.dir);
      state.list.sort = dir ? field : '';
      state.list.dir = dir || 'asc';
      state.list.page = 1;
      renderDocsHeader();
      loadDocs();
    });
    $('vdAllocTable').tHead.addEventListener('click', event => {
      const button = event.target.closest('[data-sort-field]');
      if (!button || !state.alloc) return;
      const column = button.dataset.sortField;
      const active = $('vdSortPrimary').value === column;
      const dir = nextDir(active, $('vdSortPrimaryDir').value);
      $('vdSortPrimary').value = dir ? column : NO_SORT;
      if (dir) $('vdSortPrimaryDir').value = dir;
      renderAllocRows();
    });
    $('vdDocsPrev').addEventListener('click', () => { state.list.page = Math.max(1, state.list.page - 1); loadDocs(); });
    $('vdDocsNext').addEventListener('click', () => { state.list.page += 1; loadDocs(); });
    $('vdAddCodes').addEventListener('click', addCodes);
    $('vdDocsRows').addEventListener('click', event => {
      const row = event.target.closest('tr[data-key]');
      if (!row) return;
      const doc = state.list.rows.find(d => docKey(d) === row.dataset.key);
      if (!doc) return;
      const box = row.querySelector('input[type="checkbox"]');
      const selected = event.target === box ? box.checked : !state.selection.has(row.dataset.key);
      toggleDoc(doc, selected);
      renderSelection();
    });
    $('vdSelectPage').addEventListener('change', event => {
      state.list.rows.forEach(doc => toggleDoc(doc, event.target.checked));
      renderSelection();
    });
    $('vdChips').addEventListener('click', event => {
      const button = event.target.closest('[data-remove]');
      if (!button) return;
      state.selection.delete(button.dataset.remove);
      saveSelection();
      renderSelection();
    });
    $('vdClearSelection').addEventListener('click', () => { state.selection.clear(); saveSelection(); renderSelection(); });
    $('vdRunDocs').addEventListener('click', () => run('documents'));
    $('vdRunPasteInvoice').addEventListener('click', () => run('paste'));
    document.querySelectorAll('[data-clear-paste]').forEach(b => b.addEventListener('click', () => {
      $(b.dataset.clearPaste).value = '';
      state.alloc = null;
      selectTab(state.tab);
    }));

    $('vdAllocExcel').addEventListener('click', event => exportExcel('allocation', state.alloc.columns, orderedRows('vdAllocRows', state.alloc.rows).map(r => r.values), event.currentTarget));
    $('vdAllocCsv').addEventListener('click', () => downloadCsv(state.alloc.columns, orderedRows('vdAllocRows', state.alloc.rows).map(r => r.values), 'ket_qua_xu_ly_hoa_don.csv'));

    document.querySelectorAll('[data-qr-mode]').forEach(b => b.addEventListener('click', () => { state.qrMode = b.dataset.qrMode; renderQr(); }));
    $('vdTransfer').addEventListener('input', () => { $('vdTransferHint').hidden = !!$('vdTransfer').value.trim(); });
    $('vdQrCards').addEventListener('change', event => {
      if (!event.target.matches('[data-qr-amount]')) return;
      event.target.value = formatAmount(parseAmount(event.target.value));
    });
    $('vdQrCards').addEventListener('input', event => {
      if (!event.target.matches('[data-qr-amount]')) return;
      const card = event.target.closest('[data-qr-card]');
      card.querySelector('[data-qr-generate]').textContent = `🔲 Tạo mã QR — ${intFormat.format(parseAmount(event.target.value))}đ`;
    });
    $('vdQrCards').addEventListener('click', event => {
      const button = event.target.closest('[data-qr-generate]');
      if (!button) return;
      const card = button.closest('[data-qr-card]');
      const index = [...$('vdQrCards').children].indexOf(card);
      const captions = JSON.parse($('vdQrCards').dataset.captions || '[]');
      generateQr({
        accountKey: card.querySelector('[data-qr-account]').value,
        amount: parseAmount(card.querySelector('[data-qr-amount]').value),
        addInfo: $('vdTransfer').value.trim(),
        resultEl: card.querySelector('[data-qr-result]'),
        caption: captions[index]
      });
    });

    bindQrResultActions($('vdQrCards'));
    $('vdManualResult').addEventListener('click', event => { if (event.target.closest('[data-qr-zoom]')) openManualQrViewer(); });
    $('vdQrViewerClose').addEventListener('click', closeQrViewer);
    $('vdQrViewer').addEventListener('click', event => { if (event.target === $('vdQrViewer')) closeQrViewer(); });
    $('vdQrViewerDownload').addEventListener('click', event => downloadQr($('vdQrViewer').dataset.url, $('vdQrViewer').dataset.fileName, event.currentTarget));
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('vdQrViewer').hidden) closeQrViewer(); });

    bindInvoiceDrop();
    // O trang thai du lieu (details): dong khi bam ra ngoai hoac Esc.
    document.addEventListener('click', event => { if ($('vdSourceBar').open && !$('vdSourceBar').contains(event.target)) $('vdSourceBar').open = false; });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && $('vdSourceBar').open) $('vdSourceBar').open = false; });
    $('vdManualAccount').addEventListener('change', () => { $('vdAccountAi').hidden = true; updateManualFields(); });
    ['vdManualBank', 'vdManualNo', 'vdManualName'].forEach(id => $(id).addEventListener('input', updateManualFields));
    ['vdManualBank', 'vdManualNo'].forEach(id => $(id).addEventListener('blur', () => { state.manualTouched = true; updateManualFields(); }));
    $('vdManualAmount').addEventListener('input', () => {
      $('vdManualAmount').classList.remove('vd-input--check');
      $('vdAmountAi').hidden = true;
      refreshQrPanel();
    });
    $('vdManualAmount').addEventListener('change', () => {
      $('vdManualAmount').value = formatAmountPlain(parseAmount($('vdManualAmount').value));
      refreshQrPanel();
    });
    $('vdManualContent').addEventListener('input', refreshQrPanel);
    $('vdManualGenerate').addEventListener('click', generateManualQr);
    // Enter trong o nhap = tao QR ngay (nhap lien tuc khong can chuot); o radio xac nhan so tien: Enter = xac nhan.
    $('vdQrForm').addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.isComposing || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
      const target = event.target;
      if (target.name === 'vdAmountPick') { event.preventDefault(); confirmAmount(); return; }
      if (target.tagName !== 'INPUT') return;
      event.preventDefault();
      if (target.id === 'vdManualAmount') target.value = formatAmountPlain(parseAmount(target.value));
      generateManualQr();
    });
    $('vdQrDownload').addEventListener('click', event => downloadQr(state.qr.url, state.qr.fileName, event.currentTarget));
    $('vdQrCopy').addEventListener('click', copyQrImage);
    $('vdQrZoom').addEventListener('click', openManualQrViewer);
    $('vdQrNew').addEventListener('click', startNewQr);

    document.addEventListener('click', event => {
      const link = event.target.closest('a[data-vat-draft-tab]');
      if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      if (window.location.pathname.replace(/\/index\.html$/, '/') !== '/vat-draft/') return;
      event.preventDefault();
      if (window.location.hash === '#' + link.dataset.vatDraftTab) selectTab(link.dataset.vatDraftTab);
      else window.location.hash = link.dataset.vatDraftTab;
    });
    window.addEventListener('hashchange', () => selectTab(window.location.hash.slice(1)));
  }

  async function init() {
    syncTheme();
    $('themeToggle').addEventListener('click', () => {
      const theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.theme = theme;
      try { localStorage.setItem('tks-dashboard-theme', theme); } catch (error) { /* tùy chọn */ }
      syncTheme();
    });
    const toggleSidebar = () => {
      const open = $('sidebar').classList.toggle('open');
      $('backdrop').classList.toggle('show', open);
      $('menuBtn').setAttribute('aria-expanded', String(open));
    };
    $('menuBtn').addEventListener('click', toggleSidebar);
    $('backdrop').addEventListener('click', toggleSidebar);

    state.user = await window.TKSNav.authGuard();
    state.canProcess = window.TKSNav.can('accounting.vatDraft');
    if (!state.canProcess) {
      // Chi co quyen Tao QR: an trang thai Sheets/KiotViet + thanh tab, khong tai danh sach chung tu.
      document.querySelectorAll('[data-requires-processing]').forEach(el => { el.hidden = true; });
      $('vdTitle').textContent = 'Tạo QR chuyển khoản';
    }
    // Bo loc Co so mac dinh theo co so dang chon o header.
    $('vdBranch').value = state.user && state.user.branch === 'Hà Nội' ? 'hanoi' : state.user && state.user.branch === 'Sài Gòn' ? 'saigon' : 'all';
    $('vdFrom').value = vnDate(-6);
    $('vdTo').value = vnDate(0);
    loadSelection();
    renderDocsHeader();
    bindEvents();
    selectMode('docs');
    selectTab(window.location.hash.slice(1));
    updateManualFields();
    await Promise.all([loadMeta(), state.canProcess ? loadDocs() : null]);
  }

  window.TKSVatDraft = { init, pyFloatRepr, csvCell, formatAmount, parseAmount, slug, state };
})();
