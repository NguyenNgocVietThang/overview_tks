(function () {
  'use strict';

  // Kế toán – Nháp VAT: 3 tab (#xu-ly, #tra-cuu, #tao-qr). Thuật toán chạy ở máy chủ
  // (/api/vat-draft); trang chỉ chọn chứng từ / dán dữ liệu, hiển thị và tải file.

  const TABS = ['xu-ly', 'tra-cuu', 'tao-qr'];
  const PAGE_SIZE = 50;
  const SELECTION_KEY = 'tks-vat-draft-selection';
  const MANUAL = '__manual__';
  const GIA_NHAP = 'GIÁ NHÁP\n(Giá bán/(1+%VAT))';
  const NUMERIC = new Set(['SL', 'Giá bán', 'TỒN CÒN NHÁP', GIA_NHAP, '%VAT', 'Thành tiền', 'Tồn nháp được', 'Dòng nhập']);
  const CODE_COLUMNS = new Set(['MÃ SP', 'Mã VAT', 'Mã hóa đơn', 'Mã kiot']);
  const KIND_LABEL = { invoice: 'Hóa đơn', order: 'Đặt hàng' };
  const BRANCH_LABEL = { hanoi: 'Hà Nội', saigon: 'Sài Gòn' };

  const state = {
    user: null,
    tab: 'xu-ly',
    mode: 'docs',
    selection: new Map(),
    list: { page: 1, total: 0, rows: [], loading: false, version: 0 },
    meta: null,
    alloc: null,
    lookup: null,
    qrMode: 'co_vat',
    matchedAccounts: []
  };

  const $ = id => document.getElementById(id);

  // ---------- Tiện ích ----------

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function slug(text) {
    return String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cot';
  }

  const intFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
  const decFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });

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
    let text = typeof value === 'number' ? (column === 'Dòng nhập' ? String(value) : pyFloatRepr(value)) : String(value);
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
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
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
    if (!meta) return;
    const sheets = $('vdSheetsStatus');
    const md = meta.masterData;
    if (md.error) {
      sheets.textContent = '❌ Không tải được Google Sheets: ' + md.error;
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
  }

  async function loadMeta() {
    try {
      state.meta = await api('/meta');
      renderMeta();
      renderAccountSelect();
    } catch (error) {
      $('vdSheetsStatus').textContent = '❌ ' + error.message;
    }
  }

  async function refreshSheets() {
    const button = $('vdRefreshSheets');
    button.disabled = true;
    $('vdSheetsStatus').textContent = '⏳ Đang tải dữ liệu từ Google Sheets…';
    try {
      const { masterData } = await api('/master-data/refresh', { method: 'POST' });
      state.meta = { ...(state.meta || { sync: [] }), masterData };
      renderMeta();
    } catch (error) {
      $('vdSheetsStatus').textContent = '❌ Lỗi cập nhật: ' + error.message;
    } finally {
      button.disabled = false;
    }
  }

  // ---------- Tab / chế độ nhập ----------

  function selectTab(tab) {
    state.tab = TABS.includes(tab) ? tab : 'xu-ly';
    document.querySelectorAll('.vd-tabs [data-vat-draft-tab]').forEach(link => {
      if (link.dataset.vatDraftTab === state.tab) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    $('vdInputPanel').hidden = state.tab === 'tao-qr';
    document.querySelectorAll('[data-tab-section]').forEach(section => {
      const own = section.dataset.tabSection === state.tab;
      const hasResult = section.id === 'vdAllocResult' ? !!state.alloc : section.id === 'vdLookupResult' ? !!state.lookup : true;
      section.hidden = !(own && hasResult);
    });
    document.querySelectorAll('[data-paste-for]').forEach(pane => { pane.hidden = pane.dataset.pasteFor !== state.tab; });
    $('vdRunDocs').textContent = state.tab === 'tra-cuu' ? '🔎 Tra cứu nguồn các chứng từ đã chọn' : '🧾 Xử lý chứng từ đã chọn';
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
    const showBranch = !state.user || !state.user.branch || state.user.branch === 'Cả hai';
    if (loading && !rows.length) body.innerHTML = '<tr class="vd-empty"><td colspan="10">Đang tải chứng từ…</td></tr>';
    else if (!rows.length) body.innerHTML = '<tr class="vd-empty"><td colspan="10">Không có chứng từ nào trong khoảng đã chọn.</td></tr>';
    else {
      body.innerHTML = rows.map(doc => `<tr data-key="${escapeHtml(docKey(doc))}">
        <td><input type="checkbox" aria-label="Chọn ${escapeHtml(doc.code)}"></td>
        <td class="code">${escapeHtml(doc.code)}</td>
        <td>${KIND_LABEL[doc.kind] || ''}</td>
        <td>${showBranch ? BRANCH_LABEL[doc.branch] || doc.branch : BRANCH_LABEL[doc.branch] || ''}</td>
        <td>${escapeHtml(doc.date)}</td>
        <td>${escapeHtml(doc.customerName)}${doc.customerCode ? `<br><span class="vd-muted">${escapeHtml(doc.customerCode)}</span>` : ''}</td>
        <td>${escapeHtml(doc.note)}</td>
        <td>${escapeHtml(doc.status)}${doc.orderCode ? `<br><span class="vd-muted">${escapeHtml(doc.orderCode)}</span>` : ''}</td>
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
      kind: $('vdKind').value, from: $('vdFrom').value, to: $('vdTo').value,
      q: $('vdSearch').value.trim(), page: String(state.list.page), pageSize: String(PAGE_SIZE)
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
      const result = await api('/documents/resolve', { method: 'POST', body: { text } });
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
    const isLookup = state.tab === 'tra-cuu';
    const body = { source };
    if (source === 'documents') body.documents = [...state.selection.values()].map(d => ({ kind: d.kind, branch: d.branch, code: d.code }));
    else body.text = $(isLookup ? 'vdPasteLookup' : 'vdPasteInvoice').value;
    const buttons = ['vdRunDocs', 'vdRunPasteInvoice', 'vdRunPasteLookup'].map($);
    buttons.forEach(b => { b.dataset.wasDisabled = b.disabled; b.disabled = true; });
    setMessage('vdRunError', '⏳ Đang xử lý…');
    try {
      const data = await api(isLookup ? '/lookup' : '/allocate', { method: 'POST', body });
      setMessage('vdRunError', '');
      if (data.masterData && state.meta) { state.meta.masterData = { ...state.meta.masterData, ...data.masterData, error: null }; renderMeta(); }
      if (isLookup) { state.lookup = data; renderLookup(); }
      else { state.alloc = data; renderAlloc(); }
      selectTab(state.tab);
      $(isLookup ? 'vdLookupResult' : 'vdAllocResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    return `<td${CODE_COLUMNS.has(column) ? ' class="code"' : ''}${extra}>${escapeHtml(value)}</td>`;
  }

  function headerHtml(columns, keyPrefix = '') {
    return '<tr>' + columns.map(c => `<th scope="col" data-column-key="${keyPrefix}${slug(c)}"${NUMERIC.has(c) ? ' class="num"' : ''}>${escapeHtml(c)}</th>`).join('') + '</tr>';
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
    const statusIdx = data.columns.indexOf('Trạng thái');
    table.tHead.innerHTML = headerHtml(data.columns);
    $('vdAllocRows').innerHTML = data.rows.map((row, index) => '<tr data-index="' + index + '">' + row.values.map((value, i) => {
      if (i !== statusIdx) return cellHtml(data.columns[i], value);
      const title = row.reason ? ` title="${escapeHtml(row.reason)}"` : '';
      return `<td class="${statusClass(value)}"${title}>${escapeHtml(value)}${row.reason ? `<span class="vd-sr-only"> — ${escapeHtml(row.reason)}</span>` : ''}</td>`;
    }).join('') + '</tr>').join('');
    if (window.TKSTables) window.TKSTables.refresh(table);
    renderQr();
  }

  function orderedRows(tbodyId, rows) {
    // Thứ tự đang hiển thị (sau khi người dùng bấm sắp xếp ở tiêu đề cột).
    return [...$(tbodyId).querySelectorAll('tr[data-index]')].map(tr => rows[Number(tr.dataset.index)]);
  }

  async function exportExcel(view, columns, rows, button) {
    button.disabled = true;
    try {
      const blob = await api('/export', { method: 'POST', body: { view, columns, rows } });
      downloadBlob(blob, view === 'allocation' ? 'ket_qua_xu_ly_hoa_don.xlsx' : view === 'lookup' ? 'tra_cuu_nguon.xlsx' : 'tra_cuu_nguon_can_kiem_tra.xlsx');
    } catch (error) {
      window.alert(error.message);
    } finally {
      button.disabled = false;
    }
  }

  // ---------- QR trong kết quả xử lý ----------

  function accountOptions(selectedKey, { manual = false, starred = [] } = {}) {
    const accounts = (state.meta && state.meta.vietqr.accounts) || [];
    const ordered = starred.map(key => accounts.find(a => a.key === key)).filter(Boolean).concat(accounts.filter(a => !starred.includes(a.key)));
    return (manual ? `<option value="${MANUAL}"${selectedKey === MANUAL ? ' selected' : ''}>✏️ Nhập tài khoản khác...</option>` : '')
      + ordered.map(a => `<option value="${escapeHtml(a.key)}"${a.key === selectedKey ? ' selected' : ''}>${starred.includes(a.key) ? '⭐ ' : ''}${escapeHtml(a.label)}</option>`).join('');
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

  // ---------- Kết quả Tra cứu nguồn ----------

  function renderLookup() {
    const data = state.lookup;
    const issuesBox = $('vdLookupIssuesBox');
    issuesBox.hidden = !data.issues.length;
    $('vdLookupIssuesBanner').textContent = data.issues.length ? `Có ${data.issues.length} dòng chưa tra cứu được.` : '';
    $('vdLookupIssuesRows').innerHTML = data.issues.map((row, index) => '<tr data-index="' + index + '">' + row.map((v, i) => cellHtml(data.issueColumns[i], v)).join('') + '</tr>').join('');
    $('vdLookupBox').hidden = !data.rows.length && !!data.issues.length;
    $('vdLookupEmpty').hidden = !!data.rows.length || !!data.issues.length;
    $('vdLookupRows').innerHTML = data.rows.map((row, index) => '<tr data-index="' + index + '">' + row.map((v, i) => cellHtml(data.columns[i], v)).join('') + '</tr>').join('');
    if (window.TKSTables) { window.TKSTables.refresh($('vdLookupTable')); window.TKSTables.refresh($('vdLookupIssuesTable')); }
  }

  // ---------- Tạo QR (tab 3) ----------

  function renderAccountSelect() {
    const select = $('vdManualAccount');
    const current = select.value || (state.meta && state.meta.vietqr.accounts[0] ? MANUAL : MANUAL);
    select.innerHTML = accountOptions(state.matchedAccounts[0] || current, { manual: true, starred: state.matchedAccounts });
    if (state.meta) $('vdBankCodes').textContent = 'Mã ngân hàng VietQR thường gặp: ' + state.meta.vietqr.commonBankCodes + '.';
    updateManualFields();
  }

  function updateManualFields() {
    const manual = $('vdManualAccount').value === MANUAL;
    $('vdManualFields').hidden = !manual;
    const invalid = manual && !($('vdManualBank').value.trim() && $('vdManualNo').value.trim());
    $('vdManualInvalid').hidden = !invalid;
    $('vdManualGenerate').disabled = invalid;
  }

  async function extractPdfText(file) {
    const pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
    const pages = [];
    for (let p = 1; p <= doc.numPages; p += 1) {
      const content = await (await doc.getPage(p)).getTextContent();
      let text = '';
      let lastY = null;
      for (const item of content.items) {
        const y = item.transform ? item.transform[5] : null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 2 && !text.endsWith('\n')) text += '\n';
        text += item.str;
        if (item.hasEOL) text += '\n';
        lastY = y;
      }
      pages.push(text);
    }
    return pages.join('\n');
  }

  async function onPdfSelected() {
    const file = $('vdPdfInput').files[0];
    const info = $('vdPdfInfo');
    state.matchedAccounts = [];
    if (!file) { info.hidden = true; renderAccountSelect(); return; }
    info.hidden = false;
    info.dataset.tone = '';
    info.textContent = '⏳ Đang đọc hóa đơn…';
    try {
      const text = await extractPdfText(file);
      const parsed = await api('/qr/parse-text', { method: 'POST', body: { text } });
      if (parsed.error) {
        info.dataset.tone = 'warning';
        info.textContent = '⚠️ ' + parsed.error;
      } else {
        if (parsed.totalPayment !== null) $('vdManualAmount').value = formatAmount(parsed.totalPayment);
        state.matchedAccounts = parsed.matchedAccountKeys || [];
        const lines = ['Đơn vị bán hàng: ' + (parsed.sellerName || '(không nhận diện được)')];
        if (parsed.totalPayment !== null) lines.push(`Tổng thanh toán: ${intFormat.format(parsed.totalPayment)}đ (đã điền vào ô Số tiền bên dưới)`);
        lines.push(state.matchedAccounts.length
          ? `Tài khoản gợi ý (⭐): ${state.matchedAccounts.length} tài khoản, đã chọn sẵn tài khoản đầu tiên bên dưới.`
          : 'Tài khoản gợi ý: không tìm thấy tài khoản khớp với đơn vị bán hàng — vui lòng chọn thủ công bên dưới.');
        info.dataset.tone = 'success';
        info.textContent = lines.join('\n');
      }
    } catch (error) {
      info.dataset.tone = 'error';
      info.textContent = '⚠️ Không đọc được file PDF: ' + error.message;
    }
    renderAccountSelect();
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
    $('vdRefreshSheets').addEventListener('click', refreshSheets);
    document.querySelectorAll('[data-input-mode]').forEach(b => b.addEventListener('click', () => selectMode(b.dataset.inputMode)));
    ['vdKind', 'vdFrom', 'vdTo'].forEach(id => $(id).addEventListener('change', () => { state.list.page = 1; loadDocs(); }));
    $('vdSearch').addEventListener('input', scheduleLoadDocs);
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
    $('vdRunPasteLookup').addEventListener('click', () => run('paste'));
    document.querySelectorAll('[data-clear-paste]').forEach(b => b.addEventListener('click', () => {
      $(b.dataset.clearPaste).value = '';
      if (b.dataset.clearPaste === 'vdPasteInvoice') { state.alloc = null; } else { state.lookup = null; }
      selectTab(state.tab);
    }));

    $('vdAllocExcel').addEventListener('click', event => exportExcel('allocation', state.alloc.columns, orderedRows('vdAllocRows', state.alloc.rows).map(r => r.values), event.currentTarget));
    $('vdAllocCsv').addEventListener('click', () => downloadCsv(state.alloc.columns, orderedRows('vdAllocRows', state.alloc.rows).map(r => r.values), 'ket_qua_xu_ly_hoa_don.csv'));
    $('vdLookupExcel').addEventListener('click', event => exportExcel('lookup', state.lookup.columns, orderedRows('vdLookupRows', state.lookup.rows), event.currentTarget));
    $('vdLookupCsv').addEventListener('click', () => downloadCsv(state.lookup.columns, orderedRows('vdLookupRows', state.lookup.rows), 'tra_cuu_nguon.csv'));
    $('vdLookupIssuesExcel').addEventListener('click', event => exportExcel('lookupIssues', state.lookup.issueColumns, state.lookup.issues, event.currentTarget));

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
    bindQrResultActions($('vdManualResult'));
    $('vdQrViewerClose').addEventListener('click', closeQrViewer);
    $('vdQrViewer').addEventListener('click', event => { if (event.target === $('vdQrViewer')) closeQrViewer(); });
    $('vdQrViewerDownload').addEventListener('click', event => downloadQr($('vdQrViewer').dataset.url, $('vdQrViewer').dataset.fileName, event.currentTarget));
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('vdQrViewer').hidden) closeQrViewer(); });

    $('vdPdfInput').addEventListener('change', onPdfSelected);
    $('vdManualAccount').addEventListener('change', updateManualFields);
    ['vdManualBank', 'vdManualNo'].forEach(id => $(id).addEventListener('input', updateManualFields));
    $('vdManualAmount').addEventListener('change', () => { $('vdManualAmount').value = formatAmount(parseAmount($('vdManualAmount').value)); });
    $('vdManualGenerate').addEventListener('click', () => {
      const key = $('vdManualAccount').value;
      generateQr({
        accountKey: key === MANUAL ? undefined : key,
        manual: key === MANUAL ? { bankId: $('vdManualBank').value.trim(), accountNo: $('vdManualNo').value.trim(), accountName: $('vdManualName').value.trim() } : undefined,
        amount: parseAmount($('vdManualAmount').value),
        addInfo: $('vdManualContent').value.trim(),
        resultEl: $('vdManualResult')
      });
    });

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
    $('vdFrom').value = vnDate(-6);
    $('vdTo').value = vnDate(0);
    loadSelection();
    bindEvents();
    selectMode('docs');
    selectTab(window.location.hash.slice(1));
    updateManualFields();
    await Promise.all([loadMeta(), loadDocs()]);
  }

  window.TKSVatDraft = { init, pyFloatRepr, csvCell, formatAmount, parseAmount, slug, state };
})();
