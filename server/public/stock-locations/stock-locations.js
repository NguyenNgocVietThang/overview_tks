(function () {
  'use strict';
  const PAGE_SIZE = 100;
  const FIELDS = ['code', 'name', 'totalQuantity', 'notes', 'location'];
  const state = {
    hn: { rows: [], query: '', page: 1, loading: false, error: '' },
    sg: { rows: [], query: '', page: 1, loading: false, error: '' }
  };
  let user, activeTab, allowedTabs, requestVersion = 0;

  function normalizeSearch(value) {
    return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function filterRows(rows, query) {
    const needle = normalizeSearch(query);
    return needle ? rows.filter(row => normalizeSearch(row.code).includes(needle) || normalizeSearch(row.name).includes(needle)) : rows;
  }

  function render() {
    const current = state[activeTab];
    const rows = filterRows(current.rows, current.query);
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
      FIELDS.forEach(field => {
        const td = document.createElement('td');
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
    document.getElementById('locationSearch').addEventListener('input', event => {
      state[activeTab].query = event.target.value;
      state[activeTab].page = 1;
      render();
    });
    ['Previous', 'Next'].forEach(direction => {
      document.getElementById('location' + direction).addEventListener('click', () => {
        state[activeTab].page += direction === 'Previous' ? -1 : 1;
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

  window.TKSStockLocations = { init, normalizeSearch, filterRows };
})();
