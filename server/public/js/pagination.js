// Cat 1 mang lon thanh tung trang nho, tranh dua hang chuc nghin dong <tr>
// vao DOM cung luc — xem allProductRows/stockRows trong index.html (bang
// "Tat ca ma hang" ~7600 dong khien switchView('products') mat ~3.5s khi
// render toan bo cung luc). Ham thuan, dung chung cho browser (window.paginate)
// va Node test (require truc tiep).
function paginate(items, page, pageSize) {
  const list = Array.isArray(items) ? items : [];
  const size = Number(pageSize) > 0 ? Math.floor(pageSize) : (list.length || 1);
  const totalItems = list.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / size));
  const currentPage = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
  const start = (currentPage - 1) * size;
  return {
    items: list.slice(start, start + size),
    page: currentPage,
    pageSize: size,
    totalPages,
    totalItems
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { paginate };
}
if (typeof window !== 'undefined') {
  window.paginate = paginate;
}
