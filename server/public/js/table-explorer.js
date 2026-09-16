// Các hàm thuần dùng chung cho tìm kiếm bảng ở trình duyệt và lọc dữ liệu khi
// xuất Excel ở Node. Không phụ thuộc DOM để có thể kiểm thử trực tiếp.
function normalizeTableSearchText(value) {
  return String(value === undefined || value === null ? '' : value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLocaleLowerCase('vi-VN')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTableCode(value) {
  return String(value === undefined || value === null ? '' : value)
    .trim()
    .toLocaleLowerCase('vi-VN');
}

function parseTableCodes(value) {
  const seen = new Set();
  return String(value === undefined || value === null ? '' : value)
    .split(/[\s,;]+/)
    .filter(Boolean)
    .filter(function (code) {
      const normalized = normalizeTableCode(code);
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
}

function filterTableItems(items, config, searchState) {
  const list = Array.isArray(items) ? items : [];
  const options = config && typeof config === 'object' ? config : {};
  const state = searchState && typeof searchState === 'object' ? searchState : {};
  const mode = state.mode === 'codes' ? 'codes' : 'normal';
  const query = String(state.query === undefined || state.query === null ? '' : state.query);

  if (mode === 'codes') {
    const requestedCodes = parseTableCodes(query);
    if (!requestedCodes.length || typeof options.code !== 'function') {
      return { items: list, requestedCodes, missingCodes: [] };
    }

    const requestedSet = new Set(requestedCodes.map(normalizeTableCode));
    const foundCodes = new Set();
    const filtered = list.filter(function (item) {
      const code = normalizeTableCode(options.code(item));
      if (!code || !requestedSet.has(code)) return false;
      foundCodes.add(code);
      return true;
    });

    return {
      items: filtered,
      requestedCodes,
      missingCodes: requestedCodes.filter(function (code) { return !foundCodes.has(normalizeTableCode(code)); })
    };
  }

  const normalizedQuery = normalizeTableSearchText(query);
  if (!normalizedQuery || typeof options.searchText !== 'function') {
    return { items: list, requestedCodes: [], missingCodes: [] };
  }

  return {
    items: list.filter(function (item) {
      return normalizeTableSearchText(options.searchText(item)).includes(normalizedQuery);
    }),
    requestedCodes: [],
    missingCodes: []
  };
}

function findTableItemPage(items, identity, identityFn, pageSize) {
  const list = Array.isArray(items) ? items : [];
  if (typeof identityFn !== 'function') return null;
  const normalizedIdentity = normalizeTableCode(identity);
  if (!normalizedIdentity) return null;
  const index = list.findIndex(function (item) {
    return normalizeTableCode(identityFn(item)) === normalizedIdentity;
  });
  if (index < 0) return null;
  const size = Number(pageSize) > 0 ? Math.floor(Number(pageSize)) : (list.length || 1);
  return { index, page: Math.floor(index / size) + 1 };
}

const tableExplorerApi = {
  normalizeTableSearchText,
  parseTableCodes,
  filterTableItems,
  findTableItemPage
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = tableExplorerApi;
}
if (typeof window !== 'undefined') {
  Object.assign(window, tableExplorerApi);
}
