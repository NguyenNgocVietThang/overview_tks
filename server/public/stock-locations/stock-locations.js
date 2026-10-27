(function () {
  'use strict';
  const PAGE_SIZE = 100;
  const FIELDS = ['code', 'name', 'totalQuantity', 'notes', 'arrivalDate', 'location'];
  const LABELS = { code: 'Mã hàng', name: 'Tên hàng', totalQuantity: 'Tổng SL', notes: 'Ghi chú hàng hóa', arrivalDate: 'Ngày về', location: 'Vị trí' };
  const MOBILE_FIELDS = ['name', 'totalQuantity', 'location'];
  const collator = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });
  const state = {
    hn: { rows: [], query: '', page: 1, sortField: '', sortDirection: 'asc', loading: false, error: '', onlyWarnings: false },
    sg: { rows: [], query: '', page: 1, sortField: '', sortDirection: 'asc', loading: false, error: '', onlyWarnings: false }
  };
  let user, activeTab, allowedTabs, requestVersion = 0;
  let screenMode, visibleFields, columnPreferences = {};

  function normalizeSearch(value) {
    return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /* SL và cảnh báo do máy chủ tính từ ghi chú (public/shared/carton.js): row.quantity (null = ghi chú sai định dạng, không tính được SL)
     và row.warnings (multi, loose, unreadable, badnumber). Dữ liệu cũ không có hai trường này thì dùng TỔNG SL của Sheets. */
  const WARNING_LABELS = { multi: 'Nhiều quy cách', loose: 'Có phần trừ lẻ', unreadable: 'Ghi chú sai định dạng', badnumber: 'Số thùng và SL/thùng phải là số nguyên dương' };
  const warningsOf = row => (Array.isArray(row.warnings) ? row.warnings : []);
  const warningText = row => warningsOf(row).map(code => (window.PickingCarton && window.PickingCarton.WARNING_LABEL[code]) || WARNING_LABELS[code] || code).join(', ');
  const quantityOf = row => ('quantity' in row ? row.quantity : quantityNumber(row.totalQuantity));
  const QUANTITY_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });

  function filterRows(rows, query, onlyWarnings) {
    if (onlyWarnings) rows = rows.filter(row => warningsOf(row).length > 0);
    const needle = normalizeSearch(query);
    if (!needle) return rows;
    const text = row => ['code', 'name', 'location'].map(field => row[field]).join(' ');
    // Tìm gần đúng (bỏ dấu, nhiều từ), khớp nhiều từ xếp trước; dự phòng khi thiếu helper dùng chung.
    if (window.TKSFuzzySearch) return window.TKSFuzzySearch.filter(rows, query, text);
    return rows.filter(row => normalizeSearch(text(row)).includes(needle));
  }

  function quantityNumber(value) {
    let text = String(value ?? '').replace(/\s/g, '').replace(/−/g, '-');
    if (!text) return null;
    if (text.includes('.') && text.includes(',')) {
      text = text.lastIndexOf(',') > text.lastIndexOf('.') ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
    } else if (/^[+-]?\d{1,3}(?:\.\d{3})+$/.test(text)) {
      text = text.replace(/\./g, '');
    } else {
      text = text.replace(',', '.');
    }
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }

  function sortRows(rows, field, direction) {
    if (!FIELDS.includes(field)) return rows;
    return rows.slice().sort((a, b) => {
      const left = field === 'totalQuantity' ? quantityOf(a) : String(a[field] ?? '').trim() || null;
      const right = field === 'totalQuantity' ? quantityOf(b) : String(b[field] ?? '').trim() || null;
      if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
      const result = field === 'totalQuantity' ? left - right : collator.compare(left, right);
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
    const table = document.getElementById('locationTable');

    const widths = screenMode === 'mobile' ? { code: 100, name: 180, totalQuantity: 70, notes: 220, arrivalDate: 110, location: 90 } : { code: 130, name: 240, totalQuantity: 90, notes: 260, arrivalDate: 120, location: 130 };

    const colgroup = table.querySelector('colgroup');
    const header = table.querySelector('thead tr');
    colgroup.replaceChildren();
    header.replaceChildren();
    table.style.setProperty('--locations-min-width', visibleFields.reduce((sum, field) => sum + widths[field], 0) + 'px');
    FIELDS.forEach(field => {
      const col = document.createElement('col');
      col.style.width = widths[field] + 'px';
      colgroup.appendChild(col);
      const th = document.createElement('th');
      th.scope = 'col';
      th.dataset.field = field;
      th.dataset.columnKey = field;
      th.dataset.defaultWidth = widths[field];
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
      header.appendChild(th);
    });
    updateSortHeaders();
  }

  function enhanceColumns() {
    if (!window.TKSTables) return;
    const table = document.getElementById('locationTable');
    const widths = screenMode === 'mobile' ? { code: 100, name: 180, totalQuantity: 70, notes: 220, arrivalDate: 110, location: 90 } : { code: 130, name: 240, totalQuantity: 90, notes: 260, arrivalDate: 120, location: 130 };
    window.TKSTables.enhance(table, {
      key: 'stock-locations-' + screenMode,
      button: document.getElementById('locationColumnsButton'),
      columns: FIELDS.map(field => ({ key: field, label: LABELS[field], width: widths[field], locked: field === 'name', hidden: !visibleFields.includes(field) })),
      onVisibilityChange: hiddenKeys => {
        visibleFields = FIELDS.filter(field => field === 'name' || !hiddenKeys.includes(field));
        columnPreferences[screenMode] = visibleFields.slice();
        for (const current of Object.values(state)) if (!visibleFields.includes(current.sortField)) current.sortField = '';
        render();
      }
    });
  }

  function applyScreenMode(mobile) {
    screenMode = mobile ? 'mobile' : 'desktop';
    const saved = columnPreferences[screenMode];
    visibleFields = Array.isArray(saved) ? FIELDS.filter(field => field === 'name' || saved.includes(field)) : mobile ? MOBILE_FIELDS.slice() : FIELDS.slice();
    for (const current of Object.values(state)) if (!visibleFields.includes(current.sortField)) current.sortField = '';
    renderColumns();
    enhanceColumns();
    if (activeTab) render();
  }

  function render() {
    const current = state[activeTab];
    const rows = sortRows(filterRows(current.rows, current.query, current.onlyWarnings), current.sortField, current.sortDirection);
    updateSortHeaders();
    const chip = document.getElementById('locationWarnFilter');
    chip.textContent = 'Cảnh báo (' + current.rows.filter(row => warningsOf(row).length > 0).length + ')';
    chip.setAttribute('aria-pressed', String(current.onlyWarnings));
    chip.classList.toggle('active', current.onlyWarnings);
    chip.disabled = current.loading || !!current.error;
    const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (!current.loading && !current.error) current.page = Math.min(current.page, pageCount);
    const start = (current.page - 1) * PAGE_SIZE;
    const body = document.getElementById('locationRows');
    body.replaceChildren();
    const search = document.getElementById('locationSearch');
    search.value = current.query;
    search.disabled = current.loading || !!current.error;
    document.getElementById('locationTable').setAttribute('aria-busy', String(current.loading));
    const status = document.getElementById('locationStatus');
    status.dataset.error = String(!!current.error);
    status.textContent = current.loading ? 'Đang tải vị trí hàng…' : current.error ||
      (current.rows.length === 0 ? 'Chưa có dữ liệu vị trí hàng.' : rows.length === 0 ? (current.onlyWarnings ? 'Không có dòng cảnh báo.' : 'Không tìm thấy hàng phù hợp.') : '');
    const ready = !current.loading && !current.error && rows.length > 0;
    document.getElementById('locationPager').hidden = !ready;
    if (!ready) return;

    const fragment = document.createDocumentFragment();
    rows.slice(start, start + PAGE_SIZE).forEach(row => {
      const tr = document.createElement('tr');
      const warnings = warningsOf(row);
      if (warnings.length) { tr.className = 'locations-warning'; tr.dataset.warning = warnings.join(' '); }
      FIELDS.forEach(field => {
        const td = document.createElement('td');
        td.dataset.field = field;
        if (field === 'totalQuantity') {
          const quantity = quantityOf(row);
          td.textContent = 'quantity' in row ? (quantity === null ? '' : QUANTITY_FORMAT.format(quantity)) : String(row[field] ?? '');
        } else td.textContent = String(row[field] ?? '');
        if (field === 'notes' && warnings.length) {
          // Nhãn chữ kèm tooltip để không chỉ dựa vào màu.
          const badge = document.createElement('span');
          badge.className = 'locations-badge';
          badge.textContent = warningText(row);
          badge.title = warningText(row);
          td.appendChild(badge);
        }
        tr.appendChild(td);
      });
      fragment.appendChild(tr);
    });
    body.appendChild(fragment);
    if (window.TKSTables) window.TKSTables.refresh(document.getElementById('locationTable'));
    document.getElementById('locationCount').textContent = `${start + 1}–${Math.min(start + PAGE_SIZE, rows.length)} / ${rows.length} dòng`;
    document.getElementById('locationPage').textContent = `Trang ${current.page} / ${pageCount}`;
    document.getElementById('locationPrevious').disabled = current.page === 1;
    document.getElementById('locationNext').disabled = current.page === pageCount;
    document.getElementById('locationFirst').disabled = current.page === 1;
    document.getElementById('locationLast').disabled = current.page === pageCount;
  }

  async function selectTab(requested) {
    activeTab = allowedTabs.includes(requested) ? requested : allowedTabs[0];
    if (window.location.hash !== '#' + activeTab) window.history.replaceState(null, '', '#' + activeTab);
    const tab = activeTab;
    document.querySelectorAll('[data-location-tab]').forEach(link => {
      link.hidden = !allowedTabs.includes(link.dataset.locationTab);
      if (link.dataset.locationTab === tab) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    document.getElementById('locationTableTitle').textContent = 'Vị trí ' + tab.toUpperCase();
    window.TKSNav.renderTopSidebar(document.getElementById('sidebar'), 'stockLocations', user);
    const current = state[tab];
    current.rows = [];
    current.loading = true;
    current.error = '';
    const version = ++requestVersion;
    render();
    try {
      const response = await fetch('/api/stock-locations?branch=' + tab.toUpperCase(), { credentials: 'same-origin', cache: 'no-store' });
      const payload = await response.json();
      if (version !== requestVersion) return;
      if (!response.ok) throw new Error(payload.error || 'Không tải được vị trí hàng.');
      if (payload.branch !== tab.toUpperCase() || !Array.isArray(payload.rows)) throw new Error('Dữ liệu vị trí hàng không hợp lệ.');
      current.rows = payload.rows;
    } catch (error) {
      if (version !== requestVersion) return;
      current.error = error.message || 'Lỗi kết nối, vui lòng tải lại trang.';
    } finally {
      if (version === requestVersion) { current.loading = false; render(); }
    }
  }

  function syncTheme() {
    const light = document.documentElement.dataset.theme === 'light';
    document.getElementById('themeLabel').textContent = light ? 'Dark mode' : 'Light mode';
    const button = document.getElementById('themeToggle');
    button.setAttribute('aria-label', light ? 'Chuyển sang giao diện tối' : 'Chuyển sang giao diện sáng');
    button.setAttribute('aria-pressed', String(light));
  }

  async function init() {
    syncTheme();
    document.getElementById('themeToggle').addEventListener('click', () => {
      const theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.theme = theme;
      try { localStorage.setItem('tks-dashboard-theme', theme); } catch (error) { /* storage optional */ }
      syncTheme();
    });
    const toggleSidebar = () => {
      const open = document.getElementById('sidebar').classList.toggle('open');
      document.getElementById('backdrop').classList.toggle('show', open);
      document.getElementById('menuBtn').setAttribute('aria-expanded', String(open));
    };
    document.getElementById('menuBtn').addEventListener('click', toggleSidebar);
    document.getElementById('backdrop').addEventListener('click', toggleSidebar);
    user = await window.TKSNav.authGuard();
    allowedTabs = user.branch === 'Hà Nội' ? ['hn'] : user.branch === 'Sài Gòn' ? ['sg'] : ['hn', 'sg'];
    const mobileQuery = window.matchMedia ? window.matchMedia('(max-width: 600px)') : null;
    // Set the first tab before rendering column sort indicators.
    activeTab = allowedTabs.includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : allowedTabs[0];
    applyScreenMode(mobileQuery ? mobileQuery.matches : window.innerWidth <= 600);
    if (mobileQuery) mobileQuery.addEventListener('change', event => applyScreenMode(event.matches));
    document.querySelector('#locationTable thead').addEventListener('click', event => {
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
    document.getElementById('locationWarnFilter').addEventListener('click', () => {
      const current = state[activeTab];
      current.onlyWarnings = !current.onlyWarnings;
      current.page = 1;
      render();
    });
    document.getElementById('locationSearch').addEventListener('input', event => {
      state[activeTab].query = event.target.value;
      state[activeTab].page = 1;
      render();
    });
    ['First', 'Previous', 'Next', 'Last'].forEach(direction => {
      document.getElementById('location' + direction).addEventListener('click', () => {
        const current = state[activeTab];
        const pageCount = Math.max(1, Math.ceil(filterRows(current.rows, current.query, current.onlyWarnings).length / PAGE_SIZE));
        if (direction === 'First') current.page = 1;
        else if (direction === 'Last') current.page = pageCount;
        else current.page = Math.max(1, Math.min(pageCount, current.page + (direction === 'Previous' ? -1 : 1)));
        render();
        document.querySelector('.locations-scroll').scrollTop = 0;
      });
    });
    document.addEventListener('click', event => {
      const link = event.target.closest('[data-location-tab], [data-stock-location-tab]');
      if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const tab = link.dataset.locationTab || link.dataset.stockLocationTab;
      if (!allowedTabs.includes(tab)) return;
      event.preventDefault();
      if (window.location.hash === '#' + tab) selectTab(tab);
      else window.location.hash = tab;
    });
    window.addEventListener('hashchange', () => selectTab(window.location.hash.slice(1)));
    await selectTab(window.location.hash.slice(1));
  }

  window.TKSStockLocations = { init, normalizeSearch, filterRows, sortRows };
})();
