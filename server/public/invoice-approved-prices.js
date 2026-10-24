/* Tab Hóa đơn — mục 2 "Bảng giá duyệt" (API /api/invoice-approved-prices).
   Giá Quản lý đã duyệt riêng cho (cơ sở, khách, mã hàng): khi Kiểm tra giá bán tính sai giá, giá duyệt THAY giá min của hóa đơn
   có ngày bán ≥ Ngày duyệt. Xem theo reports.invoices.approvedPrice (mặc định chỉ Quản lý, ẩn với người khác); Tạo / Sửa / Xóa theo reports.invoices.approvedPrice.manage.
   Lọc (Người duyệt, Ngày duyệt Từ–Đến), sắp xếp mọi cột và phân trang đều ở máy chủ; Xuất Excel đúng tập đang lọc + thứ tự sort.
   Khách / mã SP chỉ chọn được từ gợi ý KiotViet của cơ sở (lưu theo id nên Kiot đổi tên thì bảng tự cập nhật). */
(function () {
  'use strict';

  const API = '/api/invoice-approved-prices';
  const FEATURE_VIEW = 'reports.invoices.approvedPrice';
  const FEATURE_MANAGE = 'reports.invoices.approvedPrice.manage';
  const APPROVERS = ['Anh Quân', 'Anh Duy', 'Anh Duy Khánh'];
  const BRANCHES = [['hanoi', 'Hà Nội'], ['saigon', 'Sài Gòn']];
  const COLUMN_COUNT = 8;

  const state = {
    data: null, error: '', loading: false, seq: 0, loadedAt: 0, initialized: false,
    filters: { approver: '', from: '', to: '' }, sort: '', dir: 'asc', page: 1, pageSize: 50
  };

  const $ = id => document.getElementById(id);
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const can = key => !!(window.TKSNav && typeof window.TKSNav.can === 'function' && window.TKSNav.can(key));
  const NUMBER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });
  const isBlank = v => v === null || v === undefined || v === '';
  const fmtPrice = v => (isBlank(v) || !Number.isFinite(Number(v)) ? '—' : NUMBER.format(Number(v)));
  const fmtDay = v => { const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + '/' + m[2] + '/' + m[1] : (v ? String(v) : '—'); };
  const todayVn = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const toast = (message, type) => { if (typeof window.showToast === 'function') window.showToast(message, type); };
  const canManage = () => can(FEATURE_MANAGE);

  async function readJson(res) {
    if (res.status === 401) {
      window.location.href = '/login/?next=' + encodeURIComponent(location.pathname + location.search + location.hash);
      throw new Error('Phiên đăng nhập đã hết hạn.');
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error((body && body.error) || 'HTTP ' + res.status), { status: res.status, body: body });
    return body;
  }

  // ---------- bảng ----------
  function queryString(extra) {
    const params = new URLSearchParams();
    Object.keys(state.filters).forEach(k => { if (state.filters[k]) params.set(k, state.filters[k]); });
    if (state.sort) { params.set('sort', state.sort); params.set('dir', state.dir); }
    Object.keys(extra || {}).forEach(k => params.set(k, extra[k]));
    return params.toString();
  }

  function noteRow(message) {
    return '<tr><td colspan="' + COLUMN_COUNT + '" class="table-note">' + escape(message) + '</td></tr>';
  }

  function rowHtml(r) {
    const manage = canManage();
    const customer = r.customerMissing
      ? '<span class="approved-price-missing">(khách không còn trên KiotViet)</span>'
      : escape(r.customerName) + (r.customerCode ? ' <span class="muted">· ' + escape(r.customerCode) + '</span>' : '');
    const actions = manage
      ? '<div class="approved-price-actions">' +
        '<button type="button" class="btn-secondary price-audit-btn" data-action="edit">Sửa</button>' +
        '<button type="button" class="btn-secondary price-audit-btn approved-price-btn-danger" data-action="delete">Xóa</button></div>'
      : '<span class="muted">—</span>';
    return '<tr data-id="' + escape(r.id) + '">' +
      '<td class="name-cell price-audit-wrap">' + customer + '</td>' +
      '<td>' + escape(r.branchLabel) + '</td>' +
      '<td class="mono">' + escape(r.productCode || '—') + '</td>' +
      '<td class="name-cell price-audit-wrap">' + escape(r.productName || '—') + '</td>' +
      '<td class="mono col-num">' + escape(fmtPrice(r.approvedPrice)) + '</td>' +
      '<td>' + escape(r.approver) + '</td>' +
      '<td class="mono">' + escape(fmtDay(r.approvedOn)) + '</td>' +
      '<td>' + actions + '</td></tr>';
  }

  function totalPages() {
    const d = state.data;
    return d && d.totalRows ? Math.max(1, Math.ceil(Number(d.totalRows) / state.pageSize)) : 1;
  }

  // Chỉ số theo mục (cùng bộ lọc với bảng, tính ở máy chủ trên toàn tập đã lọc).
  function renderKpis() {
    const box = $('approvedPriceKpis');
    const k = state.data && state.data.kpis;
    if (!k) { box.innerHTML = ''; return; }
    const card = (label, value, accent, sub) => '<div class="kpi-card col-3 accent-' + accent + '"><div class="eyebrow">' + escape(label) +
      '</div><div class="value">' + escape(value) + '</div>' + (sub ? '<div class="sub">' + escape(sub) + '</div>' : '') + '</div>';
    box.innerHTML =
      card('Bản ghi giá duyệt', NUMBER.format(Number(k.records) || 0), 'blue', 'theo bộ lọc hiện tại') +
      card('Khách có giá duyệt', NUMBER.format(Number(k.customers) || 0), 'green', 'tính theo từng cơ sở') +
      card('Mã SP có giá duyệt', NUMBER.format(Number(k.products) || 0), 'amber', 'tính theo từng cơ sở') +
      card('Duyệt gần nhất', k.latestApprovedOn ? fmtDay(k.latestApprovedOn) : '—', 'blue');
  }

  function render() {
    const d = state.data;
    renderKpis();
    const body = $('approvedPriceRows');
    if (state.error) body.innerHTML = noteRow(state.error);
    else if (!d) body.innerHTML = noteRow('Đang tải...');
    else body.innerHTML = d.rows.length ? d.rows.map(rowHtml).join('')
      : noteRow(state.filters.approver || state.filters.from || state.filters.to ? 'Không có bản ghi nào khớp bộ lọc.' : 'Chưa có bản ghi giá duyệt nào.');
    const total = d ? Number(d.totalRows) || 0 : 0;
    $('tagApprovedPrice').textContent = d ? NUMBER.format(total) + ' bản ghi' : '—';
    $('approvedPricePagination').hidden = !d || total === 0;
    $('approvedPricePageLabel').textContent = 'Trang ' + state.page + '/' + totalPages();
    $('approvedPriceFirstPage').disabled = $('approvedPricePrevPage').disabled = state.page <= 1;
    $('approvedPriceNextPage').disabled = $('approvedPriceLastPage').disabled = state.page >= totalPages();
    $('approvedPriceCreateButton').hidden = !canManage();
    $('approvedPriceExportButton').hidden = !can('reports.export');
    ['approver', 'from', 'to'].forEach(name => {
      const el = $(name === 'approver' ? 'approvedPriceApproverFilter' : name === 'from' ? 'approvedPriceFrom' : 'approvedPriceTo');
      if (el.value !== state.filters[name]) el.value = state.filters[name];
    });
  }

  async function fetchPage() {
    const seq = ++state.seq;
    state.loading = true;
    try {
      const data = await readJson(await fetch(API + '?' + queryString({ page: state.page, pageSize: state.pageSize }), { credentials: 'same-origin' }));
      if (seq !== state.seq) return;
      state.data = data;
      state.error = '';
      state.loadedAt = Date.now();
      // Trang hiện tại vượt quá số trang mới (vd vừa xóa bản ghi cuối của trang) → về trang cuối.
      if (!data.rows.length && state.page > 1 && Number(data.totalRows) > 0) { state.page = totalPages(); return fetchPage(); }
    } catch (err) {
      if (seq !== state.seq) return;
      console.error('Không tải được bảng Giá duyệt:', err);
      state.error = err.status === 400 ? 'Bộ lọc không hợp lệ: ' + err.message
        : (err.status === 503 && err.body && err.body.code === 'NOT_MIGRATED') ? err.message
          : (err.message && err.status < 500 ? err.message : 'Không tải được bảng Giá duyệt.');
    } finally {
      if (seq === state.seq) { state.loading = false; render(); }
    }
  }

  // ---------- sắp xếp theo cột (ở máy chủ) ----------
  const SORT_GLYPH = { none: '▲▼', ascending: '▼', descending: '▲' };
  function paintSortHeaders() {
    document.querySelectorAll('#approvedPriceHead th.sortable').forEach(th => {
      const active = state.sort === th.dataset.sort;
      const mode = active ? (state.dir === 'desc' ? 'descending' : 'ascending') : 'none';
      th.setAttribute('aria-sort', mode);
      th.classList.toggle('sort-active', active);
      const ind = th.querySelector('.sort-indicator');
      if (ind && ind.textContent !== SORT_GLYPH[mode]) ind.textContent = SORT_GLYPH[mode];
    });
  }

  function onSortClick(event) {
    const th = event.target.closest('th.sortable');
    if (!th) return;
    const key = th.dataset.sort;
    // Lần 1 tăng dần, lần 2 giảm dần, lần 3 bỏ sắp xếp (mặc định: Ngày duyệt mới nhất trước).
    if (state.sort !== key) { state.sort = key; state.dir = 'asc'; }
    else if (state.dir === 'asc') state.dir = 'desc';
    else { state.sort = ''; state.dir = 'asc'; }
    state.page = 1;
    paintSortHeaders();
    fetchPage();
  }

  function applyFilter(name, value) {
    if (state.filters[name] === value) return;
    state.filters[name] = value;
    state.page = 1;
    fetchPage();
  }

  // ---------- xuất Excel (đúng bộ lọc + sort đang dùng, toàn bộ tập, không phân trang) ----------
  async function exportExcel() {
    const button = $('approvedPriceExportButton');
    button.disabled = true;
    try {
      const res = await fetch(API + '/export?' + queryString(), { credentials: 'same-origin' });
      if (res.status === 401) { await readJson(res); return; }
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) || {}).error || 'Không xuất được file.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'TKS_Gia_duyet.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      toast(err.message || 'Không xuất được file.', 'error');
    } finally {
      button.disabled = false;
    }
  }

  // ---------- hộp Tạo / Sửa ----------
  function recalcMessage(recalc) {
    if (!recalc) return '';
    switch (recalc.status) {
      case 'applied': return ' Đã tính lại ' + NUMBER.format(recalc.recomputedLines || 0) + ' dòng Kiểm tra giá bán (' + NUMBER.format(recalc.resultChangedLines || 0) + ' dòng đổi kết quả).';
      case 'not_published': return ' Kiểm tra giá bán chưa có dữ liệu; giá duyệt sẽ áp ở lượt chạy đầu tiên.';
      case 'busy': return ' Kiểm tra giá bán đang chạy; giá duyệt sẽ áp ở lượt chạy sau (hoặc chạy lại tính lại).';
      case 'failed': return ' ' + (recalc.message || 'Chưa tính lại được Kiểm tra giá bán; giá duyệt sẽ áp ở lượt chạy sau.');
      default: return '';
    }
  }

  // Ô chọn có gợi ý: gõ để tìm trong KiotViet của cơ sở đang chọn; chỉ giá trị chọn từ danh sách mới được lưu.
  function createPicker(field, { kind, getBranch, onPick, onClear }) {
    const input = field.querySelector('input');
    const list = field.querySelector('.approved-price-suggest');
    let timer = null;
    let seq = 0;
    let items = [];
    let active = -1;
    const picker = { id: '', label: '' };

    function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; }
    function paintActive() {
      Array.from(list.children).forEach((li, i) => li.setAttribute('aria-selected', i === active ? 'true' : 'false'));
    }
    function choose(item) {
      picker.id = item.id;
      picker.label = kind === 'customer' ? item.name + (item.code ? ' (' + item.code + ')' : '') : item.code;
      input.value = picker.label;
      field.classList.add('is-picked');
      close();
      onPick(item);
    }
    function clearSelection() {
      if (!picker.id) return;
      picker.id = '';
      picker.label = '';
      field.classList.remove('is-picked');
      onClear();
    }
    function show(results, message) {
      items = results;
      list.innerHTML = results.length
        ? results.map((r, i) => '<li role="option" data-i="' + i + '" aria-selected="false"><span>' + escape(r.name) + '</span><span class="code">' + escape(r.code) + '</span></li>').join('')
        : '<li class="empty">' + escape(message || 'Không có kết quả trong danh sách KiotViet') + '</li>';
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      active = -1;
    }
    async function search() {
      const q = input.value.trim();
      const mine = ++seq;
      if (!q) { close(); return; }
      try {
        const res = await readJson(await fetch(API + '/' + kind + '-suggest?' + new URLSearchParams({ branch: getBranch(), q: q, limit: '20' }), { credentials: 'same-origin' }));
        if (mine === seq) show(res.results || []);
      } catch (err) {
        if (mine === seq) show([], err.message || 'Không tải được gợi ý');
      }
    }
    input.addEventListener('input', () => {
      clearSelection();
      clearTimeout(timer);
      timer = setTimeout(search, 250);
    });
    input.addEventListener('focus', () => { if (input.value.trim() && !picker.id) search(); });
    input.addEventListener('keydown', event => {
      if (list.hidden || !items.length) return;
      if (event.key === 'ArrowDown') { event.preventDefault(); active = (active + 1) % items.length; paintActive(); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); active = (active - 1 + items.length) % items.length; paintActive(); }
      else if (event.key === 'Enter' && active >= 0) { event.preventDefault(); choose(items[active]); }
      else if (event.key === 'Escape') { event.stopPropagation(); close(); }
    });
    // mousedown (trước blur) để chọn được mục kể cả khi ô nhập mất focus.
    list.addEventListener('mousedown', event => {
      const li = event.target.closest('li[data-i]');
      if (!li) return;
      event.preventDefault();
      choose(items[Number(li.dataset.i)]);
    });
    input.addEventListener('blur', () => setTimeout(close, 120));
    picker.set = item => { if (item) choose(item); else { clearSelection(); input.value = ''; } };
    picker.reset = () => { clearSelection(); input.value = ''; close(); };
    return picker;
  }

  function fieldHtml(id, label, control, hint) {
    return '<div class="approved-price-field" id="' + id + 'Field"><label for="' + id + '">' + escape(label) + '</label>' + control +
      (hint ? '<p class="approved-price-hint">' + escape(hint) + '</p>' : '') + '</div>';
  }
  const pickerControl = (id, placeholder) => '<input id="' + id + '" type="text" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="' + id + 'List" placeholder="' + escape(placeholder) + '" maxlength="100">' +
    '<ul class="approved-price-suggest" id="' + id + 'List" role="listbox" hidden></ul>';

  function openEditor(row) {
    if (!canManage()) return;
    let dialog = $('approvedPriceDialog');
    if (dialog) dialog.remove();
    dialog = document.createElement('dialog');
    dialog.id = 'approvedPriceDialog';
    dialog.className = 'approved-price-dialog';
    dialog.setAttribute('aria-labelledby', 'approvedPriceDialogTitle');
    const approvers = (state.data && state.data.options && state.data.options.approvers) || APPROVERS;
    const approverOptions = ['<option value="">Chọn người duyệt</option>'].concat(approvers.map(a => '<option value="' + escape(a) + '"' + (row && row.approver === a ? ' selected' : '') + '>' + escape(a) + '</option>')).join('');
    const branchOptions = BRANCHES.map(b => '<option value="' + b[0] + '"' + ((row ? row.branch : 'hanoi') === b[0] ? ' selected' : '') + '>' + b[1] + '</option>').join('');
    dialog.innerHTML =
      '<div class="approved-price-dialog-head"><h2 id="approvedPriceDialogTitle">' + (row ? 'Sửa bản ghi giá duyệt' : 'Tạo bản ghi giá duyệt') + '</h2>' +
      '<button type="button" class="btn-secondary price-audit-btn" data-close aria-label="Đóng">Đóng</button></div>' +
      '<div class="approved-price-dialog-body"><form class="approved-price-form" novalidate>' +
      fieldHtml('apBranch', 'Cơ sở', '<select id="apBranch">' + branchOptions + '</select>') +
      fieldHtml('apCustomer', 'Khách hàng', pickerControl('apCustomer', 'Gõ tên hoặc mã khách trên KiotViet'), 'Chọn từ danh sách gợi ý của cơ sở này.') +
      fieldHtml('apProductCode', 'Mã SP', pickerControl('apProductCode', 'Gõ mã hoặc tên sản phẩm')) +
      fieldHtml('apProductName', 'Tên SP', '<input id="apProductName" type="text" readonly tabindex="-1" placeholder="Tự điền theo mã SP trên KiotViet">') +
      fieldHtml('apPrice', 'Giá duyệt', '<input id="apPrice" type="number" inputmode="decimal" min="0" step="any" placeholder="Đơn giá / chiếc" value="' + escape(row ? row.approvedPrice : '') + '">', 'Thay giá min khi kiểm tra giá; coi là giá cuối đã gồm VAT / cước.') +
      fieldHtml('apApprover', 'Người duyệt', '<select id="apApprover">' + approverOptions + '</select>') +
      fieldHtml('apDate', 'Ngày duyệt', '<input id="apDate" type="date" value="' + escape(row ? row.approvedOn : todayVn()) + '">', 'Chỉ áp cho hóa đơn có ngày bán từ ngày này trở đi.') +
      '<p class="approved-price-error" id="apError" role="alert"></p>' +
      '<div class="approved-price-form-actions"><button type="button" class="btn-secondary price-audit-btn" data-close>Hủy</button>' +
      '<button type="submit" class="btn-primary price-audit-btn" id="apSubmit">' + (row ? 'Lưu thay đổi' : 'Tạo bản ghi') + '</button></div>' +
      '</form></div>';
    document.body.appendChild(dialog);
    // Ô ngày hiển thị dd/mm/yyyy như mọi trang (dateInput.js; value vẫn là ISO yyyy-mm-dd).
    if (window.TKSDateInput && typeof window.TKSDateInput.enhanceAll === 'function') window.TKSDateInput.enhanceAll(dialog);
    const q = id => dialog.querySelector('#' + id);
    const branchSel = q('apBranch');
    const productName = q('apProductName');
    const customer = createPicker(q('apCustomerField'), { kind: 'customer', getBranch: () => branchSel.value, onPick() {}, onClear() {} });
    const productPicker = createPicker(q('apProductCodeField'), {
      kind: 'product', getBranch: () => branchSel.value,
      onPick(item) { productName.value = item.name; },
      onClear() { productName.value = ''; }
    });
    if (row) {
      customer.set({ id: row.customerId, name: row.customerName, code: row.customerCode });
      productPicker.set({ id: row.productId, name: row.productName, code: row.productCode });
    }
    // Đổi cơ sở: khách / SP của cơ sở cũ không còn hợp lệ → xóa lựa chọn.
    branchSel.addEventListener('change', () => { customer.reset(); productPicker.reset(); productName.value = ''; });
    dialog.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => dialog.close()));
    dialog.addEventListener('close', () => dialog.remove());

    const err = q('apError');
    const submit = q('apSubmit');
    dialog.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault();
      err.textContent = '';
      const price = q('apPrice').value.trim();
      const body = {
        branch: branchSel.value, customerId: customer.id, productId: productPicker.id,
        approvedPrice: price, approver: q('apApprover').value, approvedOn: q('apDate').value
      };
      if (!customer.id) { err.textContent = 'Chọn khách hàng từ danh sách gợi ý (khách phải có trên KiotViet).'; q('apCustomer').focus(); return; }
      if (!productPicker.id) { err.textContent = 'Chọn mã SP từ danh sách gợi ý (mã phải có trên KiotViet).'; q('apProductCode').focus(); return; }
      if (!price || !(Number(price) > 0)) { err.textContent = 'Nhập giá duyệt lớn hơn 0.'; q('apPrice').focus(); return; }
      if (!body.approver) { err.textContent = 'Chọn người duyệt.'; q('apApprover').focus(); return; }
      if (!body.approvedOn) { err.textContent = 'Chọn ngày duyệt.'; q('apDate').focus(); return; }
      if (row) body.expectedVersion = row.version;
      submit.disabled = true;
      submit.textContent = 'Đang lưu…';
      try {
        const out = await readJson(await fetch(row ? API + '/' + encodeURIComponent(row.id) : API, {
          method: row ? 'PUT' : 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        }));
        dialog.close();
        toast((row ? 'Đã lưu bản ghi giá duyệt.' : 'Đã tạo bản ghi giá duyệt.') + recalcMessage(out.recalc), 'success');
        afterWrite(out.recalc);
      } catch (e) {
        err.textContent = e.status === 409 && e.body && e.body.code === 'VERSION_CONFLICT'
          ? 'Bản ghi vừa được người khác cập nhật. Hãy đóng hộp này và mở lại để xem bản mới nhất.'
          : (e.message || 'Không lưu được bản ghi.');
        if (e.status === 409) fetchPage();
        submit.disabled = false;
        submit.textContent = row ? 'Lưu thay đổi' : 'Tạo bản ghi';
      }
    });
    dialog.showModal();
    q(row ? 'apPrice' : 'apCustomer').focus();
  }

  // Sau khi ghi: nạp lại bảng này, và bảng Kiểm tra giá bán nếu đã tính lại các dòng của nó.
  function afterWrite(recalc) {
    fetchPage();
    if (recalc && recalc.status === 'applied' && window.TKSPriceAudit && typeof window.TKSPriceAudit.load === 'function') window.TKSPriceAudit.load(true);
  }

  async function remove(row) {
    if (!canManage()) return;
    const label = (row.customerName || '(khách không còn trên KiotViet)') + ' · ' + (row.productCode || '—') + ' · ' + fmtPrice(row.approvedPrice) + ' · ' + fmtDay(row.approvedOn);
    if (!window.confirm('Xóa bản ghi giá duyệt?\n' + label + '\n\nCác dòng Kiểm tra giá bán liên quan sẽ được tính lại theo giá min thông thường.')) return;
    try {
      const out = await readJson(await fetch(API + '/' + encodeURIComponent(row.id) + '?expectedVersion=' + encodeURIComponent(row.version), { method: 'DELETE', credentials: 'same-origin' }));
      toast('Đã xóa bản ghi giá duyệt.' + recalcMessage(out.recalc), 'success');
      afterWrite(out.recalc);
    } catch (err) {
      toast(err.status === 409 ? 'Bản ghi vừa được người khác cập nhật; bảng đã được tải lại, hãy kiểm tra rồi xóa lại.' : (err.message || 'Không xóa được bản ghi.'), 'error');
      if (err.status === 409 || err.status === 404) fetchPage();
    }
  }

  function onRowsClick(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const tr = button.closest('tr[data-id]');
    const row = tr && state.data && state.data.rows.find(r => String(r.id) === tr.dataset.id);
    if (!row) return;
    if (button.dataset.action === 'edit') openEditor(row);
    else if (button.dataset.action === 'delete') remove(row);
  }

  function init() {
    if (state.initialized) return;
    state.initialized = true;
    $('approvedPriceHead').addEventListener('click', onSortClick);
    paintSortHeaders();
    $('approvedPriceApproverFilter').addEventListener('change', e => applyFilter('approver', e.target.value));
    $('approvedPriceFrom').addEventListener('change', e => applyFilter('from', e.target.value));
    $('approvedPriceTo').addEventListener('change', e => applyFilter('to', e.target.value));
    $('approvedPriceClearFilters').addEventListener('click', () => {
      if (!state.filters.approver && !state.filters.from && !state.filters.to) return;
      state.filters = { approver: '', from: '', to: '' };
      state.page = 1;
      fetchPage();
    });
    $('approvedPricePageSize').addEventListener('change', e => { state.pageSize = Number(e.target.value) || 50; state.page = 1; fetchPage(); });
    const go = page => () => {
      const target = Math.min(Math.max(1, page()), totalPages());
      if (target === state.page) return;
      state.page = target;
      fetchPage();
    };
    $('approvedPriceFirstPage').addEventListener('click', go(() => 1));
    $('approvedPricePrevPage').addEventListener('click', go(() => state.page - 1));
    $('approvedPriceNextPage').addEventListener('click', go(() => state.page + 1));
    $('approvedPriceLastPage').addEventListener('click', go(() => totalPages()));
    $('approvedPriceCreateButton').addEventListener('click', () => openEditor(null));
    $('approvedPriceExportButton').addEventListener('click', exportExcel);
    $('approvedPriceRows').addEventListener('click', onRowsClick);
  }

  /** Mở tab Hóa đơn: tải nếu có quyền xem và dữ liệu đã cũ hơn 60 giây (force = luôn tải). */
  function load(force) {
    const section = $('approvedPriceSection');
    if (!section) return Promise.resolve();
    // Không có quyền xem: GỠ HẲN mục khỏi trang (không chỉ ẩn) — bảng này chỉ Quản lý thấy theo mặc định.
    if (!can(FEATURE_VIEW)) { section.remove(); return Promise.resolve(); }
    section.hidden = false;
    init();
    if (!force && (state.loading || Date.now() - state.loadedAt < 60000)) return Promise.resolve();
    return fetchPage();
  }

  window.TKSApprovedPrices = { load };
})();
