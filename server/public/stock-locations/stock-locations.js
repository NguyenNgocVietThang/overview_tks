(function () {
  'use strict';
  const PAGE_SIZE = 100;
  const FIELDS = ['code', 'name', 'totalQuantity', 'notes', 'location'];
  const LABELS = { code: 'Mã hàng', name: 'Tên hàng', totalQuantity: 'Tổng SL', notes: 'Ghi chú hàng hóa', location: 'Vị trí' };
  const COLUMN_STORAGE_KEY = 'tks-stock-locations-columns-v1';
  const MOBILE_FIELDS = ['name', 'totalQuantity', 'location'];
  const collator = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });
  const state = {
    hn: { rows: [], query: '', page: 1, sortField: '', sortDirection: 'asc', loading: false, error: '' },
    sg: { rows: [], query: '', page: 1, sortField: '', sortDirection: 'asc', loading: false, error: '' }
  };
  let user, activeTab, allowedTabs, requestVersion = 0;
  let screenMode, visibleFields, columnPreferences = {};

  function normalizeSearch(value) {
    return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function filterRows(rows, query) {
    const needle = normalizeSearch(query);
    return needle ? rows.filter(row => ['code', 'name', 'location'].some(field => normalizeSearch(row[field]).includes(needle))) : rows;
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
      const left = field === 'totalQuantity' ? quantityNumber(a[field]) : String(a[field] ?? '').trim() || null;
      const right = field === 'totalQuantity' ? quantityNumber(b[field]) : String(b[field] ?? '').trim() || null;
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
      button.querySelector('.locations-sort-icon').textContent = selected ? current.sortDirection === 'asc' ? '↑' : '↓' : '↕';
      button.title = selected ? current.sortDirection === 'asc' ? 'Sắp xếp giảm dần' : 'Về thứ tự gốc' : 'Sắp xếp tăng dần';
    });
  }

  function renderColumns() {
    const table = document.getElementById('locationTable');
    const weights = { code: 15, name: 30, totalQuantity: 10, notes: 30, location: 15 };
    const widths = screenMode === 'mobile' ? { code: 100, name: 180, totalQuantity: 70, notes: 220, location: 90 } : { code: 130, name: 240, totalQuantity: 90, notes: 260, location: 130 };
    const totalWeight = visibleFields.reduce((sum, field) => sum + weights[field], 0);
    const colgroup = table.querySelector('colgroup');
    const header = table.querySelector('thead tr');
    colgroup.replaceChildren();
    header.replaceChildren();
    table.style.setProperty('--locations-min-width', visibleFields.reduce((sum, field) => sum + widths[field], 0) + 'px');
    visibleFields.forEach(field => {
      const col = document.createElement('col');
      col.style.width = (weights[field] / totalWeight * 100) + '%';
      colgroup.appendChild(col);
      const th = document.createElement('th');
      th.scope = 'col';
      th.dataset.field = field;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'locations-sort-button';
      button.dataset.sortField = field;
      const label = document.createElement('span');
      label.textContent = LABELS[field];
      const icon = document.createElement('span');
      icon.className = 'locations-sort-icon';
      icon.setAttribute('aria-hidden', 'true');
      button.append(label, icon);
      th.appendChild(button);
      header.appendChild(th);
    });
    updateSortHeaders();
  }

  function renderColumnChoices() {
    const list = document.getElementById('locationColumnsList');
    list.replaceChildren();
    FIELDS.forEach(field => {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.columnField = field;
      checkbox.checked = visibleFields.includes(field);
      checkbox.disabled = field === 'name';
      const text = document.createElement('span');
      text.textContent = LABELS[field] + (field === 'name' ? ' (luôn hiện)' : '');
      label.append(checkbox, text);
      list.appendChild(label);
    });
  }

  function setVisibleFields(fields) {
    visibleFields = FIELDS.filter(field => field === 'name' || fields.includes(field));
    columnPreferences[screenMode] = visibleFields;
    try { localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(columnPreferences)); } catch (error) { /* storage optional */ }
    // A hidden sort column must not keep silently controlling row order.
    for (const current of Object.values(state)) if (!visibleFields.includes(current.sortField)) current.sortField = '';
    renderColumns();
    renderColumnChoices();
    render();
  }

  function applyScreenMode(mobile) {
    screenMode = mobile ? 'mobile' : 'desktop';
    const saved = columnPreferences[screenMode];
    visibleFields = Array.isArray(saved) ? FIELDS.filter(field => field === 'name' || saved.includes(field)) : mobile ? MOBILE_FIELDS.slice() : FIELDS.slice();
    for (const current of Object.values(state)) if (!visibleFields.includes(current.sortField)) current.sortField = '';
    renderColumns();
    renderColumnChoices();
    if (activeTab) render();
  }

  function render() {
    const current = state[activeTab];
    const rows = sortRows(filterRows(current.rows, current.query), current.sortField, current.sortDirection);
    updateSortHeaders();
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
      (current.rows.length === 0 ? 'Chưa có dữ liệu vị trí hàng.' : rows.length === 0 ? 'Không tìm thấy hàng phù hợp.' : '');
    const ready = !current.loading && !current.error && rows.length > 0;
    document.getElementById('locationPager').hidden = !ready;
    if (!ready) return;

    const fragment = document.createDocumentFragment();
    rows.slice(start, start + PAGE_SIZE).forEach(row => {
      const tr = document.createElement('tr');
      visibleFields.forEach(field => {
        const td = document.createElement('td');
        td.dataset.field = field;
        td.textContent = String(row[field] ?? '');
        tr.appendChild(td);
      });
      fragment.appendChild(tr);
    });
    body.appendChild(fragment);
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
    try {
      const saved = JSON.parse(localStorage.getItem(COLUMN_STORAGE_KEY));
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) columnPreferences = saved;
    } catch (error) { /* use defaults for unavailable or invalid storage */ }
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
    const dialog = document.getElementById('locationColumnsDialog');
    const columnButton = document.getElementById('locationColumnsButton');
    columnButton.addEventListener('click', () => { dialog.showModal(); columnButton.setAttribute('aria-expanded', 'true'); });
    document.getElementById('locationColumnsClose').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => { columnButton.setAttribute('aria-expanded', 'false'); columnButton.focus(); });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    });
    document.getElementById('locationColumnsList').addEventListener('change', event => {
      const field = event.target.dataset.columnField;
      if (!FIELDS.includes(field) || field === 'name') return;
      const fields = event.target.checked ? visibleFields.concat(field) : visibleFields.filter(value => value !== field);
      setVisibleFields(fields);
      document.querySelector(`[data-column-field="${field}"]`).focus();
    });
    document.getElementById('locationColumnsAll').addEventListener('click', () => setVisibleFields(FIELDS));
    document.getElementById('locationColumnsReset').addEventListener('click', () => setVisibleFields(screenMode === 'mobile' ? MOBILE_FIELDS : FIELDS));
    document.getElementById('locationSearch').addEventListener('input', event => {
      state[activeTab].query = event.target.value;
      state[activeTab].page = 1;
      render();
    });
    ['First', 'Previous', 'Next', 'Last'].forEach(direction => {
      document.getElementById('location' + direction).addEventListener('click', () => {
        const current = state[activeTab];
        const pageCount = Math.max(1, Math.ceil(filterRows(current.rows, current.query).length / PAGE_SIZE));
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
