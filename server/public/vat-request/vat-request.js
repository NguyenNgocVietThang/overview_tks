// Kế toán – ORDER VAT (thay Google Form + sheet ORDER VAT 1).
// Mọi luật quyền / khóa / version nằm ở server (/api/vat-requests); trang chỉ ẩn nút cho tiện.
(function () {
  'use strict';

  const API = '/api/vat-requests';
  const PAGE_SIZE = 100;
  const TODO_STATUSES = ['pending', '3', '4'];
  const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  const dateTimeFormat = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  const FIELD_LABELS = {
    customer_name: 'Khách hàng', customer_code: 'Mã khách', product_code: 'Mã SP', quantity: 'Số lượng',
    unit_price_excl_vat: 'Giá chưa VAT', full_vat: 'Full VAT', sale_note: 'Ghi chú', status: 'KT phản hồi',
    accountant_note: 'KT note cho sale', arrival_date: 'Ngày về'
  };
  const ACTION_LABELS = { create: 'Tạo yêu cầu', delete: 'Xóa yêu cầu', import: 'Nhập từ sheet cũ', update: 'Sửa' };

  const state = {
    user: null, canProcess: false, viewerId: null,
    rows: [], metrics: {}, sales: [], statuses: [], stockStatus: null, truncated: false,
    preset: 'all', saleFilter: '', query: '', from: '', to: '',
    groupByProduct: false, page: 1, selected: new Set(), loading: false, error: '',
    editing: null, requestSeq: 0
  };

  // ---------- Tiện ích ----------
  function $(id) { return document.getElementById(id); }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function fmtNumber(value) { return value === null || value === undefined || value === '' ? '' : numberFormat.format(Number(value)); }
  function fmtDate(iso) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
  }
  function fmtDateTime(iso) { return iso ? dateTimeFormat.format(new Date(iso)).replace(',', '') : ''; }
  function parseNumber(text) {
    const cleaned = String(text ?? '').replace(/,/g, '').replace(/\s/g, '');
    return cleaned === '' ? NaN : Number(cleaned);
  }
  function statusLabel(value) {
    const found = state.statuses.find(s => s.value === value);
    return found ? found.label : value;
  }
  function debounce(fn, ms) {
    let timer;
    return function () { const args = arguments; clearTimeout(timer); timer = setTimeout(() => fn.apply(null, args), ms); };
  }

  async function api(path, options = {}) {
    const response = await fetch(API + path, {
      method: options.method || 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    let data = null;
    try { data = await response.json(); } catch (error) { data = null; }
    if (!response.ok) {
      const error = new Error((data && data.error) || `Lỗi ${response.status}`);
      error.status = response.status;
      error.data = data || {};
      throw error;
    }
    return data;
  }

  function setStatus(message, kind) {
    const status = $('vrStatus');
    status.textContent = message || '';
    status.dataset.kind = kind || '';
  }

  // ---------- Cột ----------
  // Độ rộng mặc định theo tỉ lệ đã chốt (ảnh 20/10/2026, khung ~1800px); khung rộng hơn thì table-controls giãn đều.
  // nowrap: số / mã / ngày không bao giờ xuống dòng giữa chừng — cột phải đủ rộng cho cả giá trị.
  function columns() {
    const list = [];
    if (state.canProcess) list.push({ key: 'select', label: 'Chọn', locked: true, width: 44 });
    list.push(
      { key: 'createdAt', label: 'Thời gian', width: 104, mobileHidden: true },
      { key: 'sale', label: 'Tên Sale', width: 100, mobileHidden: true },
      { key: 'customer', label: 'Khách hàng', width: 110 },
      { key: 'productCode', label: 'Mã SP', width: 110, locked: true, nowrap: true },
      { key: 'productName', label: 'Tên SP', width: 165, mobileHidden: true },
      { key: 'quantity', label: 'Số lượng', width: 84, num: true },
      { key: 'unitPrice', label: 'Giá chưa VAT', width: 96, num: true, mobileHidden: true },
      { key: 'total', label: 'Tổng tiền', width: 104, num: true, mobileHidden: true },
      { key: 'fullVat', label: 'Full VAT', width: 88, mobileHidden: true },
      { key: 'saleNote', label: 'Ghi chú', width: 115, mobileHidden: true },
      { key: 'status', label: 'KT phản hồi', width: state.canProcess ? 150 : 128 },
      { key: 'accountantNote', label: 'KT note cho sale', width: 118, mobileHidden: true },
      { key: 'arrivalDate', label: 'Ngày về', width: state.canProcess ? 132 : 100, mobileHidden: true, nowrap: true },
      { key: 'vatStock', label: 'Tồn VAT', width: 74, num: true, mobileHidden: true },
      { key: 'pendingQty', label: 'SLG tổng cần khai', width: 74, num: true, mobileHidden: true },
      { key: 'incomingQty', label: 'Dự kiến hàng về', width: 74, num: true, mobileHidden: true },
      { key: 'nearestArrival', label: 'Dự kiến ngày về gần nhất', width: 106, mobileHidden: true },
      { key: 'actions', label: 'Thao tác', width: 96, locked: true }
    );
    return list;
  }

  function screenMode() { return window.innerWidth <= 600 ? 'mobile' : 'desktop'; }

  function renderHead() {
    const head = $('vrHeadRow');
    head.innerHTML = columns().map(col => {
      if (col.key === 'select') {
        return '<th scope="col" data-column-key="select" data-default-width="48"><input type="checkbox" id="vrSelectPage" aria-label="Chọn tất cả dòng trên trang"></th>';
      }
      return `<th scope="col" data-column-key="${col.key}" data-default-width="${col.width}"${col.num ? ' class="num"' : ''}>${escapeHtml(col.label)}</th>`;
    }).join('');
    if (window.TKSTables) {
      const mobile = screenMode() === 'mobile';
      window.TKSTables.enhance($('vrTable'), {
        key: 'vat-requests-' + (state.canProcess ? 'kt-' : 'sale-') + screenMode(),
        button: $('vrColumnsButton'),
        columns: columns().map(col => ({ key: col.key, label: col.label, width: col.width, locked: !!col.locked, hidden: mobile && !!col.mobileHidden }))
      });
    }
  }

  // ---------- Ô dữ liệu ----------
  function metricFor(row) { return state.metrics[row.productKey] || null; }

  function cellHtml(col, row) {
    const m = metricFor(row);
    switch (col.key) {
      case 'select':
        return `<input type="checkbox" data-select="${row.id}" aria-label="Chọn yêu cầu ${row.id}"${state.selected.has(row.id) ? ' checked' : ''}>`;
      case 'createdAt': return escapeHtml(fmtDateTime(row.createdAt));
      case 'sale':
        return escapeHtml(row.createdByName || '—') + (row.isLegacy ? ' <span class="vr-tag" title="Nhập từ sheet ORDER VAT 1">cũ</span>' : '');
      case 'customer': return escapeHtml(row.customerName);
      case 'productCode': return `<span class="vr-code" title="${escapeHtml(row.productCode)}">${escapeHtml(row.productCode)}</span>`;
      case 'productName': return escapeHtml(row.productName);
      case 'quantity': return fmtNumber(row.quantity);
      case 'unitPrice': return fmtNumber(row.unitPrice);
      case 'total': return fmtNumber(row.totalAmount);
      case 'fullVat': return row.fullVat ? '<span class="vr-tag vr-tag-strong">Full VAT</span>' : '<span class="vr-muted">Không full VAT</span>';
      case 'saleNote': return escapeHtml(row.saleNote);
      case 'status':
        if (state.canProcess) {
          return `<select class="vr-inline" data-inline="status" data-id="${row.id}" aria-label="Trạng thái yêu cầu ${row.id}">` +
            state.statuses.map(s => `<option value="${s.value}"${s.value === row.status ? ' selected' : ''}>${escapeHtml(s.label)}</option>`).join('') + '</select>';
        }
        return `<span class="vr-badge" data-status="${escapeHtml(row.status)}">${escapeHtml(row.statusLabel)}</span>`;
      case 'accountantNote':
        if (state.canProcess) return `<input class="vr-inline" type="text" maxlength="1000" data-inline="accountantNote" data-id="${row.id}" value="${escapeHtml(row.accountantNote)}" aria-label="KT note yêu cầu ${row.id}">`;
        return escapeHtml(row.accountantNote);
      case 'arrivalDate':
        if (state.canProcess) return `<input class="vr-inline" type="date" data-inline="arrivalDate" data-id="${row.id}" value="${escapeHtml(row.arrivalDate || '')}" aria-label="Ngày về yêu cầu ${row.id}">`;
        return escapeHtml(fmtDate(row.arrivalDate));
      case 'vatStock':
        if (!m || !m.vatStock) return '<span class="vr-muted" title="Chưa khớp mã VAT hoặc chưa đọc được sheet tồn">—</span>';
        return `<button type="button" class="vr-link" data-stock="${escapeHtml(row.productKey)}" title="Xem tồn theo công ty">${fmtNumber(m.vatStock.total)}</button>`;
      case 'pendingQty': return m ? fmtNumber(m.pendingInsertQty) : '';
      case 'incomingQty': return m ? fmtNumber(m.incomingQty) : '';
      case 'nearestArrival':
        if (!m) return '';
        return m.nearestArrivalDate ? escapeHtml(fmtDate(m.nearestArrivalDate)) : `<span class="vr-muted">${escapeHtml(m.nearestArrivalText)}</span>`;
      case 'actions': {
        // Xóa nằm trong hộp sửa; nháy đúp / chuột phải vào dòng cũng mở hộp này.
        const lock = row.isLockedForSale
          ? '<svg class="vr-lock" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" role="img" aria-label="Đã khóa với sale"><title>Đã khóa với sale (kế toán đã xử lý)</title><rect x="4" y="11" width="16" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg>'
          : '';
        const button = row.canEditSale
          ? `<button type="button" class="vr-icon-btn" data-action="edit" data-id="${row.id}">Sửa</button>`
          : `<button type="button" class="vr-icon-btn" data-action="history" data-id="${row.id}">Lịch sử</button>`;
        return `<div class="vr-row-actions">${lock}${button}</div>`;
      }
      default: return '';
    }
  }

  function rowHtml(row, cols) {
    const classes = [row.isLockedForSale ? 'is-locked' : '', row.isMine ? 'is-mine' : ''].filter(Boolean).join(' ');
    const cellClass = col => [col.num ? 'num' : '', col.num || col.nowrap ? 'vr-nowrap' : ''].filter(Boolean).join(' ');
    return `<tr data-id="${row.id}" tabindex="0"${classes ? ` class="${classes}"` : ''} title="Nháy đúp để ${row.canEditSale ? 'sửa' : 'xem lịch sử'}">` +
      cols.map(col => `<td data-field="${col.key}"${cellClass(col) ? ` class="${cellClass(col)}"` : ''}>${cellHtml(col, row)}</td>`).join('') + '</tr>';
  }

  function groupHeaderHtml(key, rows, cols) {
    const first = rows[0];
    const m = state.metrics[key] || {};
    const stock = m.vatStock ? fmtNumber(m.vatStock.total) : '—';
    const arrival = m.nearestArrivalDate ? fmtDate(m.nearestArrivalDate) : (m.nearestArrivalText || '—');
    const pick = state.canProcess ? `<input type="checkbox" data-select-group="${escapeHtml(key)}" aria-label="Chọn cả mã ${escapeHtml(first.productCode)}"> ` : '';
    return `<tr class="vr-group-row"><td colspan="${cols.length}">${pick}<strong>${escapeHtml(first.productCode)}</strong> — ${escapeHtml(first.productName)}` +
      `<span class="vr-group-meta">${rows.length} yêu cầu · Tồn VAT ${stock} · Cần khai ${fmtNumber(m.pendingInsertQty || 0)} · Đang về ${fmtNumber(m.incomingQty || 0)} · Gần nhất ${escapeHtml(arrival)}</span></td></tr>`;
  }

  function visibleRows() {
    if (!state.groupByProduct) return state.rows;
    return state.rows.slice().sort((a, b) => a.productKey.localeCompare(b.productKey, 'vi', { numeric: true }) || (b.createdAt || '').localeCompare(a.createdAt || ''));
  }

  function render() {
    const cols = columns();
    const rows = visibleRows();
    const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    state.page = Math.min(Math.max(1, state.page), pageCount);
    const start = (state.page - 1) * PAGE_SIZE;
    const pageRows = rows.slice(start, start + PAGE_SIZE);
    let html = '';
    if (state.groupByProduct) {
      let current = null;
      let bucket = [];
      const flush = () => { if (bucket.length) html += groupHeaderHtml(current, rows.filter(r => r.productKey === current), cols) + bucket.join(''); bucket = []; };
      for (const row of pageRows) {
        if (row.productKey !== current) { flush(); current = row.productKey; }
        bucket.push(rowHtml(row, cols));
      }
      flush();
    } else {
      html = pageRows.map(row => rowHtml(row, cols)).join('');
    }
    $('vrRows').innerHTML = html;
    $('vrTable').setAttribute('aria-busy', String(state.loading));
    // Chỉ ghi khi có điều cần báo — không xóa thông báo lưu / xung đột vừa hiện.
    if (!state.loading && !state.error) {
      if (!state.rows.length) setStatus('Không có yêu cầu phù hợp.');
      else if (state.truncated) setStatus('Chỉ hiện 5,000 dòng mới nhất — hãy lọc thêm.', 'warn');
    }
    const ready = !state.loading && rows.length > 0;
    $('vrPager').hidden = !ready;
    if (ready) {
      $('vrCount').textContent = `${start + 1}–${Math.min(start + PAGE_SIZE, rows.length)} / ${rows.length} dòng`;
      $('vrPage').textContent = `Trang ${state.page} / ${pageCount}`;
      $('vrFirst').disabled = $('vrPrevious').disabled = state.page === 1;
      $('vrNext').disabled = $('vrLast').disabled = state.page === pageCount;
    }
    const pageSelect = $('vrSelectPage');
    if (pageSelect) pageSelect.checked = pageRows.length > 0 && pageRows.every(r => state.selected.has(r.id));
    renderBulk();
    renderSource();
    if (window.TKSTables) window.TKSTables.refresh($('vrTable'));
    updateScrollButtons();
  }

  function renderSource() {
    const status = state.stockStatus;
    const el = $('vrSource');
    if (!status) { el.textContent = ''; return; }
    if (!status.available) {
      el.textContent = `Không đọc được sheet tồn VAT: ${status.error || 'lỗi không rõ'}. Cột Tồn VAT tạm để trống.`;
      el.dataset.kind = 'error';
      return;
    }
    el.dataset.kind = status.stale ? 'warn' : '';
    el.textContent = `Tồn VAT lấy từ Google Sheets${status.loadedAt ? ', cập nhật lúc ' + fmtDateTime(status.loadedAt) : ''}${status.stale ? ' (bản cũ do sheet đang lỗi)' : ''}. Dự kiến hàng về lấy từ Hàng dự kiến (CONT chưa về).`;
  }

  function renderBulk() {
    const bar = $('vrBulk');
    bar.hidden = !state.canProcess || state.selected.size === 0;
    $('vrBulkCount').textContent = `${state.selected.size} dòng đã chọn`;
  }

  function renderChips() {
    const presets = [
      ...(state.canProcess ? [{ key: 'todo', label: 'Cần xử lý' }] : []),
      { key: 'all', label: 'Tất cả' },
      ...state.statuses.map(s => ({ key: s.value, label: s.label }))
    ];
    $('vrStatusChips').innerHTML = presets.map(p =>
      `<button type="button" class="vr-chip" data-preset="${escapeHtml(p.key)}" aria-pressed="${p.key === state.preset}">${escapeHtml(p.label)}</button>`).join('');
  }

  function renderSaleFilter() {
    const select = $('vrSaleFilter');
    const options = ['<option value="">Tất cả sale</option>', `<option value="me">Của tôi</option>`]
      .concat(state.sales.filter(s => s.id !== state.viewerId).map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name || s.id)}</option>`));
    select.innerHTML = options.join('');
    select.value = state.saleFilter;
  }

  // ---------- Tải dữ liệu ----------
  function filterQuery() {
    const params = new URLSearchParams();
    const statuses = state.preset === 'todo' ? TODO_STATUSES : state.preset === 'all' ? [] : [state.preset];
    if (statuses.length) params.set('status', statuses.join(','));
    const createdBy = state.saleFilter === 'me' ? state.viewerId : state.saleFilter;
    if (createdBy) params.set('createdBy', createdBy);
    if (state.query) params.set('q', state.query);
    if (state.from) params.set('from', state.from);
    if (state.to) params.set('to', state.to);
    const text = params.toString();
    return text ? '?' + text : '';
  }

  async function load() {
    const seq = ++state.requestSeq;
    state.loading = true;
    state.error = '';
    setStatus('Đang tải yêu cầu…');
    render();
    try {
      const data = await api('/' + filterQuery());
      if (seq !== state.requestSeq) return;
      state.rows = data.rows || [];
      state.metrics = data.metrics || {};
      state.sales = data.sales || [];
      state.statuses = data.statuses || state.statuses;
      state.stockStatus = data.stockStatus || null;
      state.truncated = !!data.truncated;
      setStatus('');
      const ids = new Set(state.rows.map(r => r.id));
      state.selected = new Set([...state.selected].filter(id => ids.has(id)));
      renderChips();
      renderSaleFilter();
      fillBulkStatus();
    } catch (error) {
      if (seq !== state.requestSeq) return;
      state.rows = [];
      state.error = error.message;
      setStatus('Không tải được danh sách: ' + error.message, 'error');
    } finally {
      if (seq === state.requestSeq) {
        state.loading = false;
        render();
      }
    }
  }

  function fillBulkStatus() {
    $('vrBulkStatus').innerHTML = '<option value="">— Giữ nguyên —</option>' +
      state.statuses.map(s => `<option value="${s.value}">${escapeHtml(s.label)}</option>`).join('');
  }

  function replaceRow(updated) {
    const index = state.rows.findIndex(r => r.id === updated.id);
    if (index >= 0) state.rows[index] = updated;
  }

  async function refreshMetricsFor(productKey) {
    // Đổi trạng thái 3/4 làm P thay đổi: nạp lại cả danh sách cho số liệu đồng nhất.
    if (productKey) await load();
  }

  // ---------- Sửa nhanh trên dòng (KT) ----------
  async function saveInline(input) {
    const id = Number(input.dataset.id);
    const row = state.rows.find(r => r.id === id);
    if (!row) return;
    const field = input.dataset.inline;
    const value = input.value;
    if ((row[field] ?? '') === value) return;
    input.disabled = true;
    try {
      const updated = await api('/' + id, { method: 'PATCH', body: { version: row.version, [field]: field === 'arrivalDate' ? (value || null) : value } });
      replaceRow(updated);
      if (field === 'status') await refreshMetricsFor(row.productKey);
      else render();
      setStatus(`Đã lưu yêu cầu #${id}.`, 'ok');
    } catch (error) {
      handleSaveError(error, id);
    }
  }

  function handleSaveError(error, id) {
    if (error.status === 409 && error.data.latest) {
      replaceRow(error.data.latest);
      setStatus(error.message, 'warn');
      render();
      return;
    }
    if (error.status === 409 && id) {
      setStatus(error.message, 'warn');
      load();
      return;
    }
    setStatus(error.message, 'error');
    render();
  }

  // ---------- Hàng loạt ----------
  async function applyBulk() {
    const changes = {};
    if ($('vrBulkStatus').value) changes.status = $('vrBulkStatus').value;
    if ($('vrBulkNote').value.trim()) changes.accountantNote = $('vrBulkNote').value.trim();
    if ($('vrBulkDate').value) changes.arrivalDate = $('vrBulkDate').value;
    if (!Object.keys(changes).length) { setStatus('Chọn trạng thái, ghi chú hoặc ngày về để áp dụng.', 'warn'); return; }
    const items = state.rows.filter(r => state.selected.has(r.id)).map(r => ({ id: r.id, version: r.version }));
    $('vrBulkApply').disabled = true;
    try {
      const result = await api('/bulk', { method: 'PATCH', body: { items, changes } });
      state.selected.clear();
      $('vrBulkStatus').value = '';
      $('vrBulkNote').value = '';
      $('vrBulkDate').value = '';
      await load();
      setStatus(`Đã cập nhật ${result.updated} yêu cầu.`, 'ok');
    } catch (error) {
      setStatus(error.message, error.status === 409 ? 'warn' : 'error');
      if (error.status === 409) await load();
    } finally {
      $('vrBulkApply').disabled = false;
    }
  }

  // ---------- Form tạo / sửa (sale) ----------
  const productOptions = new Map();
  const customerOptions = new Map();

  // Hộp sửa có 3 chế độ: 'create' (chỉ form), 'edit' (form + nút "Lịch sử" mở khung chat nổi bên phải + nút Xóa),
  // 'history' (không sửa được nữa: thân modal chỉ còn danh sách lịch sử).
  function setHistoryOpen(open) {
    const dialog = $('vrFormDialog');
    const show = !!open && dialog.dataset.mode === 'edit';
    dialog.dataset.historyOpen = String(show);
    $('vrHistoryToggle').setAttribute('aria-expanded', String(show));
    $('vrChat').hidden = !show;
  }

  function setSaving(saving) {
    state.saving = saving;
    const button = $('vrFormSubmit');
    button.disabled = saving;
    button.classList.toggle('is-loading', saving);
    button.setAttribute('aria-busy', String(saving));
    $('vrFormSubmitLabel').textContent = saving ? (state.editing ? 'Đang lưu…' : 'Đang gửi…') : (state.editing ? 'Lưu thay đổi' : 'Gửi yêu cầu');
  }

  function autosizeNote() {
    const note = $('vrNote');
    note.style.height = 'auto';
    note.style.height = Math.min(Math.max(note.scrollHeight, 44), 160) + 'px';
  }

  function openRequest(row) {
    if (!row) return;
    openForm(row, row.canEditSale ? 'edit' : 'history');
  }

  function openForm(row, mode = row ? 'edit' : 'create') {
    closeMenu();
    state.editing = row || null;
    const dialog = $('vrFormDialog');
    const editable = mode !== 'history';
    dialog.dataset.mode = mode;
    $('vrFormBody').hidden = !editable;
    $('vrHistoryInline').hidden = editable;
    $('vrHistoryToggle').hidden = mode !== 'edit';
    $('vrFormSubmit').hidden = !editable;
    $('vrFormCancel').textContent = editable ? 'Hủy' : 'Đóng';
    $('vrFormDelete').hidden = !(mode === 'edit' && row && row.canDelete);
    setHistoryOpen(false);
    $('vrFormTitle').textContent = !row ? 'Tạo ORDER VAT' : mode === 'history' ? `Lịch sử yêu cầu #${row.id}` : `Sửa yêu cầu #${row.id}`;
    $('vrFormSub').textContent = row ? requestSummary(row) : 'Gửi ORDER VAT cho kế toán.';
    $('vrHistoryTitle').textContent = row ? `Lịch sử yêu cầu #${row.id}` : 'Lịch sử yêu cầu';
    if (row) loadHistory(row.id);
    else { $('vrHistoryCount').textContent = ''; $('vrChatCount').textContent = ''; }
    setSaving(false);
    $('vrProduct').value = row ? row.productCode : '';
    $('vrCustomer').value = row ? row.customerName : '';
    $('vrQuantity').value = row && row.quantity !== null ? fmtNumber(row.quantity) : '';
    $('vrPrice').value = row && row.unitPrice !== null ? fmtNumber(row.unitPrice) : '';
    $('vrFullVat').value = row && row.fullVat ? 'true' : 'false';
    $('vrNote').value = row ? row.saleNote : '';
    $('vrFormError').textContent = '';
    $('vrProductInfo').innerHTML = '';
    ++infoSeq;
    ++priceSeq;
    $('vrPriceSuggestion').innerHTML = '';
    customerOptions.clear();
    if (row && row.customerCode) customerOptions.set(row.customerName, row.customerCode);
    updateTotal();
    showDialog(dialog);
    $('vrFormBody').scrollTop = 0;
    if (!editable) { $('vrFormCancel').focus(); return; }
    autosizeNote();
    if (row) loadProductInfo(row.productCode);
    $('vrProduct').focus();
  }

  function requestSummary(row) {
    const parts = [row.productCode, row.customerName, row.quantity !== null ? `${fmtNumber(row.quantity)} × ${fmtNumber(row.unitPrice) || '—'}` : '', row.statusLabel];
    const text = parts.filter(Boolean).join(' · ');
    return row.isLockedForSale && !row.canEditSale ? `${text} — đã khóa, chỉ xem lịch sử.` : text;
  }

  function historyValue(field, value) {
    if (value === null || value === undefined || value === '') return '(trống)';
    if (field === 'status') return statusLabel(value);
    if (field === 'full_vat') return value === 'true' ? 'Full VAT' : 'Không full VAT';
    if (field === 'arrival_date') return fmtDate(value);
    if (field === 'quantity' || field === 'unit_price_excl_vat') return fmtNumber(value);
    return value;
  }

  // Mỗi sự kiện lịch sử là 1 "tin nhắn": icon + màu nhẹ theo loại (tạo / nhập sheet / trạng thái / sửa trường / xóa).
  const CHAT_ICONS = {
    create: '<path d="M12 5v14M5 12h14"></path>',
    import: '<path d="M12 3v12M7 10l5 5 5-5"></path><path d="M5 21h14"></path>',
    status: '<path d="M20 12 12 20l-9-9V3h8Z"></path><circle cx="7.5" cy="7.5" r="1.2"></circle>',
    edit: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>',
    delete: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"></path>'
  };
  function chatItemHtml(h) {
    const kind = h.field === 'status' ? 'status' : h.field ? 'edit' : (CHAT_ICONS[h.action] ? h.action : 'edit');
    const text = h.field
      ? `${h.field === 'status' ? 'Thay đổi trạng thái' : 'Cập nhật ' + escapeHtml((FIELD_LABELS[h.field] || h.field).toLowerCase())}: ` +
        `<span class="vr-chat-old">${escapeHtml(historyValue(h.field, h.oldValue))}</span> → <b>${escapeHtml(historyValue(h.field, h.newValue))}</b>`
      : escapeHtml(ACTION_LABELS[h.action] || h.action) + (h.action === 'import' && h.newValue ? ` <span class="vr-chat-old">(${escapeHtml(h.newValue)})</span>` : '');
    return `<li class="vr-chat-item" data-kind="${kind}">` +
      `<span class="vr-chat-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${CHAT_ICONS[kind]}</svg></span>` +
      `<div class="vr-chat-bubble"><div class="vr-chat-meta"><b>${escapeHtml(h.changedByName || '—')}</b><time datetime="${escapeHtml(h.changedAt || '')}">${escapeHtml(fmtDateTime(h.changedAt))}</time></div>` +
      `<div class="vr-chat-text">${text}</div></div></li>`;
  }

  let historySeq = 0;
  async function loadHistory(id) {
    const seq = ++historySeq;
    const lists = [$('vrHistoryList'), $('vrHistoryInlineList')];
    const fill = html => lists.forEach(list => { list.innerHTML = html; });
    const count = text => { $('vrHistoryCount').textContent = text; $('vrChatCount').textContent = text; };
    fill('<li class="vr-chat-empty">Đang tải…</li>');
    count('');
    try {
      const data = await api(`/${id}/history`);
      if (seq !== historySeq) return;
      const rows = data.rows || [];
      count(rows.length ? String(rows.length) : '');
      fill(rows.length ? rows.map(chatItemHtml).join('') : '<li class="vr-chat-empty">Chưa có lịch sử.</li>');
    } catch (error) {
      if (seq !== historySeq) return;
      fill(`<li class="vr-chat-empty vr-error-text">${escapeHtml(error.message)}</li>`);
    }
  }

  function updateTotal() {
    const qty = parseNumber($('vrQuantity').value);
    const price = parseNumber($('vrPrice').value);
    $('vrTotal').textContent = Number.isFinite(qty) && Number.isFinite(price) ? fmtNumber(qty * price) + ' ₫' : '—';
  }

  const suggestProducts = debounce(async query => {
    if (!query.trim()) { $('vrProductList').innerHTML = ''; productOptions.clear(); return; }
    try {
      const data = await api('/product-suggest?q=' + encodeURIComponent(query.trim()));
      if (query !== $('vrProduct').value) return;
      productOptions.clear();
      $('vrProductList').innerHTML = (data.results || []).map(p => {
        productOptions.set(p.code.toLowerCase(), p);
        return `<option value="${escapeHtml(p.code)}">${escapeHtml(p.name)}</option>`;
      }).join('');
    } catch (error) { /* gợi ý không bắt buộc */ }
  }, 250);

  const suggestCustomers = debounce(async query => {
    if (query.trim().length < 2) { $('vrCustomerList').innerHTML = ''; customerOptions.clear(); return; }
    try {
      const data = await api('/customer-suggest?q=' + encodeURIComponent(query.trim()) + '&limit=10');
      if (query !== $('vrCustomer').value) return;
      customerOptions.clear();
      $('vrCustomerList').innerHTML = (data.results || []).map(c => {
        if (c.code) customerOptions.set(c.name, c.code);
        const source = c.source === 'order-vat' ? 'Đã dùng trong VAT' : 'KiotViet';
        return `<option value="${escapeHtml(c.name)}" label="${escapeHtml([c.code, source].filter(Boolean).join(' · '))}"></option>`;
      }).join('');
    } catch (error) { /* gợi ý không bắt buộc */ }
  }, 300);

  let infoSeq = 0;
  let priceSeq = 0;
  async function loadPriceSuggestion(code) {
    const target = $('vrPriceSuggestion');
    const seq = ++priceSeq;
    target.innerHTML = code ? '<span class="vr-muted">Đang tìm giá từ yêu cầu VAT gần nhất…</span>' : '';
    if (!code) return;
    try {
      const data = await api('/price-suggest?code=' + encodeURIComponent(code));
      if (seq !== priceSeq) return;
      const recent = data.latestOrder;
      if (!recent || !Number.isFinite(Number(recent.price)) || Number(recent.price) <= 0) {
        target.innerHTML = '<span class="vr-muted">Chưa có giá VAT trước đó cho mã này.</span>';
        return;
      }
      const when = recent.createdAt ? fmtDateTime(recent.createdAt) : 'không rõ ngày';
      target.innerHTML = `<span>Giá từ yêu cầu VAT gần nhất · ${escapeHtml(when)}${recent.customerName ? ' · ' + escapeHtml(recent.customerName) : ''}</span>` +
        `<button type="button" data-price="${Number(recent.price)}">Dùng ${fmtNumber(recent.price)} ₫</button>`;
    } catch (error) {
      if (seq === priceSeq) target.innerHTML = '<span class="vr-muted">Chưa tải được giá tham khảo.</span>';
    }
  }

  async function loadProductInfo(code) {
    const target = $('vrProductInfo');
    const trimmed = String(code || '').trim();
    const seq = ++infoSeq;
    ++priceSeq;
    $('vrPriceSuggestion').innerHTML = '';
    if (!trimmed) { target.innerHTML = ''; return; }
    target.innerHTML = '<span class="vr-muted">Đang tra mã…</span>';
    try {
      const m = await api('/metrics?code=' + encodeURIComponent(trimmed));
      if (seq !== infoSeq) return;
      const arrival = m.nearestArrivalDate ? fmtDate(m.nearestArrivalDate) : (m.nearestArrivalText || '—');
      target.innerHTML = `<strong>${escapeHtml(m.productName)}</strong>` +
        `<span>Tồn VAT: <b>${m.vatStock ? fmtNumber(m.vatStock.total) : '—'}</b></span>` +
        `<span>Đang chờ khai: <b>${fmtNumber(m.pendingInsertQty)}</b></span>` +
        `<span>Dự kiến hàng về: <b>${fmtNumber(m.incomingQty)}</b></span>` +
        `<span>Ngày về gần nhất: <b>${escapeHtml(arrival)}</b></span>`;
      target.dataset.valid = 'true';
      loadPriceSuggestion(trimmed);
    } catch (error) {
      if (seq !== infoSeq) return;
      target.dataset.valid = 'false';
      target.innerHTML = `<span class="vr-error-text">${escapeHtml(error.status === 404 ? 'Không tìm thấy mã SP này.' : error.message)}</span>`;
    }
  }

  function formPayload() {
    const customerName = $('vrCustomer').value.trim();
    return {
      productCode: $('vrProduct').value.trim(),
      customerName,
      customerCode: customerOptions.get(customerName) || null,
      quantity: parseNumber($('vrQuantity').value),
      unitPrice: parseNumber($('vrPrice').value),
      fullVat: $('vrFullVat').value === 'true',
      saleNote: $('vrNote').value.trim()
    };
  }

  function validateForm(payload) {
    if (!payload.productCode) return 'Chưa chọn mã SP.';
    if (!payload.customerName) return 'Chưa nhập khách hàng.';
    if (!Number.isInteger(payload.quantity) || payload.quantity <= 0) return 'Số lượng phải là số nguyên lớn hơn 0.';
    if (!Number.isFinite(payload.unitPrice) || payload.unitPrice <= 0) return 'Giá chưa VAT phải lớn hơn 0.';
    return '';
  }

  async function submitForm(event) {
    event.preventDefault();
    const payload = formPayload();
    const problem = validateForm(payload);
    if (state.saving) return;
    if (problem) { $('vrFormError').textContent = problem; return; }
    $('vrFormError').textContent = '';
    setSaving(true);
    try {
      let message;
      if (state.editing) {
        const row = state.editing;
        const before = { productCode: row.productCode, customerName: row.customerName, customerCode: row.customerCode || null, quantity: row.quantity, unitPrice: row.unitPrice, fullVat: row.fullVat, saleNote: row.saleNote };
        const changes = { version: row.version };
        for (const [key, value] of Object.entries(payload)) if (before[key] !== value) changes[key] = value;
        if (Object.keys(changes).length > 1) await api('/' + row.id, { method: 'PATCH', body: changes });
        message = `Đã lưu yêu cầu #${row.id}.`;
      } else {
        const created = await api('/', { method: 'POST', body: payload });
        message = `Đã gửi yêu cầu #${created.id}.`;
      }
      setSaving(false);
      closeDialog($('vrFormDialog'));
      await load();
      setStatus(message, 'ok');
    } catch (error) {
      if (error.status === 409 && error.data.latest) {
        const latest = error.data.latest;
        replaceRow(latest);
        render();
        if (latest.canEditSale) {
          state.editing = latest;
          $('vrFormError').textContent = 'Yêu cầu vừa được người khác cập nhật. Kiểm tra lại rồi lưu lần nữa.';
          loadHistory(latest.id);
        } else {
          openForm(latest, 'history');
          $('vrFormSub').textContent = 'Yêu cầu vừa bị kế toán khóa, không sửa được nữa. ' + requestSummary(latest);
        }
      } else {
        $('vrFormError').textContent = error.message;
      }
    } finally {
      if (state.saving) setSaving(false);
    }
  }

  // ---------- Hộp thoại ----------
  function showDialog(dialog) {
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
  }
  function closeDialog(dialog) {
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
  }
  function openInfo(title, html) {
    $('vrInfoTitle').textContent = title;
    $('vrInfoBody').innerHTML = html;
    showDialog($('vrInfoDialog'));
  }

  function openHistory(id) {
    const row = state.rows.find(r => r.id === id);
    if (row) openForm(row, 'history');
  }

  // ---------- Menu chuột phải trên dòng ----------
  let menuRowId = null;
  function openMenu(row, x, y) {
    const menu = $('vrRowMenu');
    menuRowId = row.id;
    menu.querySelector('[data-menu="edit"]').hidden = !row.canEditSale;
    menu.hidden = false;
    const { innerWidth, innerHeight } = window;
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(x, innerWidth - rect.width - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, innerHeight - rect.height - 8)) + 'px';
    const first = [...menu.querySelectorAll('button')].find(b => !b.hidden);
    if (first) first.focus();
  }
  function closeMenu() {
    const menu = $('vrRowMenu');
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    menuRowId = null;
  }

  // ---------- Nút cuộn ngang về cột đầu / cột cuối ----------
  function updateScrollButtons() {
    const scroll = $('vrScroll');
    const max = scroll.scrollWidth - scroll.clientWidth;
    $('vrScrollStart').hidden = !(max > 4 && scroll.scrollLeft > 4);
    $('vrScrollEnd').hidden = !(max > 4 && scroll.scrollLeft < max - 4);
  }
  function scrollTableTo(end) {
    const scroll = $('vrScroll');
    const left = end ? scroll.scrollWidth : 0;
    if (typeof scroll.scrollTo === 'function') scroll.scrollTo({ left, behavior: 'smooth' });
    else scroll.scrollLeft = left;
  }

  function openStock(productKey) {
    const m = state.metrics[productKey];
    const row = state.rows.find(r => r.productKey === productKey);
    if (!m || !m.vatStock) return;
    openInfo(`Tồn VAT · ${row ? row.productCode : productKey}`,
      '<table class="vr-mini-table" data-table-controls="off"><thead><tr><th>Công ty</th><th>Mã VAT</th><th class="num">Tồn đầu ngày</th></tr></thead><tbody>' +
      m.vatStock.byCompany.map(c => `<tr><td>${escapeHtml(c.company)}</td><td>${escapeHtml(c.vatCode)}</td><td class="num">${fmtNumber(c.stock)}</td></tr>`).join('') +
      `</tbody><tfoot><tr><th colspan="2">Tổng</th><th class="num">${fmtNumber(m.vatStock.total)}</th></tr></tfoot></table>`);
  }

  // Xóa ngay trong hộp sửa (chỉ hiện khi server cho phép: chủ yêu cầu chưa khóa, hoặc Quản lý).
  async function deleteEditing() {
    const row = state.editing;
    if (!row || !window.confirm(`Xóa yêu cầu #${row.id} (${row.productCode} – ${row.customerName})? Không hoàn tác được.`)) return;
    $('vrFormDelete').disabled = true;
    try {
      await api(`/${row.id}?version=${row.version}`, { method: 'DELETE' });
      closeDialog($('vrFormDialog'));
      await load();
      setStatus(`Đã xóa yêu cầu #${row.id}.`, 'ok');
    } catch (error) {
      if (error.status === 409 && error.data.latest) {
        replaceRow(error.data.latest);
        render();
        openForm(error.data.latest, error.data.latest.canEditSale ? 'edit' : 'history');
        $('vrFormError').textContent = 'Yêu cầu vừa được người khác cập nhật, chưa xóa. Kiểm tra lại rồi thử lại.';
      } else {
        $('vrFormError').textContent = error.message;
      }
    } finally {
      $('vrFormDelete').disabled = false;
    }
  }

  // ---------- Giao diện chung ----------
  function syncTheme() {
    const light = document.documentElement.dataset.theme === 'light';
    $('themeLabel').textContent = light ? 'Dark mode' : 'Light mode';
    $('themeToggle').setAttribute('aria-pressed', String(light));
  }

  function bindEvents() {
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

    $('vrStatusChips').addEventListener('click', event => {
      const chip = event.target.closest('[data-preset]');
      if (!chip) return;
      state.preset = chip.dataset.preset;
      state.page = 1;
      renderChips();
      load();
    });
    $('vrSaleFilter').addEventListener('change', event => { state.saleFilter = event.target.value; state.page = 1; load(); });
    $('vrFrom').addEventListener('change', event => { state.from = event.target.value; state.page = 1; load(); });
    $('vrTo').addEventListener('change', event => { state.to = event.target.value; state.page = 1; load(); });
    const searchLater = debounce(() => { state.page = 1; load(); }, 350);
    $('vrSearch').addEventListener('input', event => { state.query = event.target.value.trim(); searchLater(); });
    $('vrGroupToggle').addEventListener('change', event => { state.groupByProduct = event.target.checked; state.page = 1; render(); });
    $('vrReload').addEventListener('click', () => load());
    $('vrCreate').addEventListener('click', () => openForm(null));

    ['First', 'Previous', 'Next', 'Last'].forEach(direction => {
      $('vr' + direction).addEventListener('click', () => {
        const pageCount = Math.max(1, Math.ceil(state.rows.length / PAGE_SIZE));
        if (direction === 'First') state.page = 1;
        else if (direction === 'Last') state.page = pageCount;
        else state.page += direction === 'Previous' ? -1 : 1;
        render();
        document.querySelector('.vr-scroll').scrollTop = 0;
      });
    });

    const table = $('vrTable');
    table.addEventListener('change', event => {
      const target = event.target;
      if (target.matches('[data-inline]')) { saveInline(target); return; }
      if (target.matches('[data-select]')) {
        const id = Number(target.dataset.select);
        if (target.checked) state.selected.add(id); else state.selected.delete(id);
        render();
        return;
      }
      if (target.matches('[data-select-group]')) {
        state.rows.filter(r => r.productKey === target.dataset.selectGroup).forEach(r => target.checked ? state.selected.add(r.id) : state.selected.delete(r.id));
        render();
        return;
      }
      if (target.id === 'vrSelectPage') {
        const start = (state.page - 1) * PAGE_SIZE;
        visibleRows().slice(start, start + PAGE_SIZE).forEach(r => target.checked ? state.selected.add(r.id) : state.selected.delete(r.id));
        render();
      }
    });
    table.addEventListener('click', event => {
      const stock = event.target.closest('[data-stock]');
      if (stock) { openStock(stock.dataset.stock); return; }
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const id = Number(button.dataset.id);
      if (button.dataset.action === 'edit') openForm(state.rows.find(r => r.id === id), 'edit');
      else if (button.dataset.action === 'history') openHistory(id);
    });
    // Nháy đúp / Enter vào dòng: sửa được thì mở hộp sửa, không thì chỉ lịch sử. Bỏ qua ô nhập sửa nhanh của KT.
    const INTERACTIVE = 'input,select,textarea,button,a,label';
    const rowOf = target => {
      const tr = target.closest('tr[data-id]');
      return tr ? state.rows.find(r => r.id === Number(tr.dataset.id)) : null;
    };
    table.addEventListener('dblclick', event => {
      if (event.target.closest(INTERACTIVE)) return;
      const row = rowOf(event.target);
      if (!row) return;
      if (window.getSelection) window.getSelection().removeAllRanges();
      openRequest(row);
    });
    table.addEventListener('contextmenu', event => {
      if (event.target.closest('input,select,textarea')) return;
      const row = rowOf(event.target);
      if (!row) return;
      event.preventDefault();
      let x = event.clientX, y = event.clientY;
      if (!x && !y) { const rect = event.target.closest('tr').getBoundingClientRect(); x = rect.left + 24; y = rect.top + rect.height / 2; }
      openMenu(row, x, y);
    });
    table.addEventListener('keydown', event => {
      if (event.target.matches('tr[data-id]') && event.key === 'Enter') { event.preventDefault(); openRequest(rowOf(event.target)); }
    });

    const menu = $('vrRowMenu');
    menu.addEventListener('click', event => {
      const item = event.target.closest('[data-menu]');
      if (!item) return;
      const row = state.rows.find(r => r.id === menuRowId);
      closeMenu();
      if (!row) return;
      if (item.dataset.menu === 'edit' && row.canEditSale) openForm(row, 'edit');
      else openForm(row, 'history');
    });
    menu.addEventListener('keydown', event => {
      const items = [...menu.querySelectorAll('button')].filter(b => !b.hidden);
      const index = items.indexOf(document.activeElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
      }
    });
    document.addEventListener('pointerdown', event => { if (!event.target.closest('#vrRowMenu')) closeMenu(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
    window.addEventListener('resize', () => { closeMenu(); updateScrollButtons(); });
    $('vrScroll').addEventListener('scroll', () => { closeMenu(); updateScrollButtons(); }, { passive: true });
    $('vrScrollStart').addEventListener('click', () => scrollTableTo(false));
    $('vrScrollEnd').addEventListener('click', () => scrollTableTo(true));

    $('vrHistoryToggle').addEventListener('click', () => setHistoryOpen($('vrFormDialog').dataset.historyOpen !== 'true'));
    $('vrChatClose').addEventListener('click', () => { setHistoryOpen(false); $('vrHistoryToggle').focus(); });
    $('vrFormClose').addEventListener('click', () => closeDialog($('vrFormDialog')));
    $('vrNote').addEventListener('input', autosizeNote);
    // Esc: đóng khung lịch sử trước, lần nữa mới đóng hộp sửa.
    $('vrFormDialog').addEventListener('cancel', event => {
      if ($('vrFormDialog').dataset.historyOpen === 'true') { event.preventDefault(); setHistoryOpen(false); $('vrHistoryToggle').focus(); }
    });
    $('vrFormDialog').addEventListener('close', () => setHistoryOpen(false));
    $('vrFormDelete').addEventListener('click', deleteEditing);

    $('vrBulkApply').addEventListener('click', applyBulk);
    $('vrBulkClear').addEventListener('click', () => { state.selected.clear(); render(); });

    $('vrProduct').addEventListener('input', event => {
      const value = event.target.value;
      ++infoSeq;
      ++priceSeq;
      $('vrProductInfo').innerHTML = '';
      $('vrPriceSuggestion').innerHTML = '';
      suggestProducts(value);
      if (productOptions.has(value.trim().toLowerCase())) loadProductInfo(value);
    });
    $('vrProduct').addEventListener('change', event => loadProductInfo(event.target.value));
    $('vrCustomer').addEventListener('input', event => suggestCustomers(event.target.value));
    $('vrQuantity').addEventListener('input', updateTotal);
    $('vrPrice').addEventListener('input', updateTotal);
    $('vrPriceSuggestion').addEventListener('click', event => {
      const button = event.target.closest('button[data-price]');
      if (!button) return;
      $('vrPrice').value = fmtNumber(button.dataset.price);
      updateTotal();
      $('vrPrice').focus();
    });
    $('vrForm').addEventListener('submit', submitForm);
    $('vrFormCancel').addEventListener('click', () => closeDialog($('vrFormDialog')));
    $('vrInfoClose').addEventListener('click', () => closeDialog($('vrInfoDialog')));

    if (window.matchMedia) {
      const mobile = window.matchMedia('(max-width: 600px)');
      if (mobile.addEventListener) mobile.addEventListener('change', () => { renderHead(); render(); });
    }
  }

  async function init() {
    syncTheme();
    bindEvents();
    state.user = await window.TKSNav.authGuard();
    state.viewerId = state.user && state.user.id;
    state.canProcess = window.TKSNav.can('accounting.vatRequestProcess');
    window.TKSNav.renderTopSidebar($('sidebar'), 'accounting', state.user);
    // KT mở trang thấy ngay việc cần làm; sale mặc định xem yêu cầu của mình.
    state.preset = state.canProcess ? 'todo' : 'all';
    state.saleFilter = state.canProcess ? '' : 'me';
    $('vrGroupToggleWrap').hidden = !state.canProcess;
    $('vrSub').textContent = state.canProcess
      ? 'Lọc “Cần xử lý” để xem yêu cầu chờ khai; chọn nhiều dòng để đổi trạng thái hàng loạt.'
      : 'Gửi ORDER VAT cho kế toán. Yêu cầu ở trạng thái 0, 1, 2 đã khóa, không sửa được.';
    renderHead();
    await load();
  }

  window.TKSVatRequest = { init, parseNumber, fmtDate };
})();
