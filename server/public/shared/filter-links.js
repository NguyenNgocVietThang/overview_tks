// ==========================================
// FILTER LINKS — bo loc dropdown anh huong lan nhau tren bang du lieu da co san o trinh duyet.
//
// Moi o loc chi con cac gia tri CO DON/DONG khi ket hop voi cac o loc KHAC dang chon (bo chinh no): gia tri nao khong con
// dong nao thi khoa lai (disabled + hidden), tru gia tri dang chon, de khong ai ket hop ra bang rong. Cung quy tac voi
// o loc "Toan bo don hang" (may chu dem facet — orderLifecycleQuery.countFacets) va bo loc Dự kiến hàng về.
//
//   TKSFilterLinks.apply(rows, [
//     { select: <select>, value: row => 'gia tri' | ['nhieu', 'gia tri'], neutral: ['', 'all'] (tuy chon) }, ...
//   ], extraPredicate?)   // extraPredicate(row): dieu kien khac khong phai o loc (tim kiem, cong tac...)
// ==========================================
(function () {
  'use strict';

  function toList(value) {
    if (Array.isArray(value)) return value.map(String);
    return [value === null || value === undefined ? '' : String(value)];
  }

  function apply(rows, defs, extra) {
    const list = Array.isArray(rows) ? rows : [];
    const live = defs.filter(function (def) { return def && def.select; });
    // def.norm (tuy chon): chuan hoa gia tri truoc khi so khop (vd bo dau / hoa thuong cua ten phong ban).
    const norm = function (def, value) { return def.norm ? def.norm(value) : value; };
    const active = live.map(function (def) {
      const value = def.select.value;
      return (def.neutral || ['']).indexOf(value) === -1 ? norm(def, value) : '';
    });
    const base = typeof extra === 'function' ? list.filter(extra) : list;
    const values = live.map(function (def) {
      return base.map(function (row) { return toList(def.value(row)).map(function (value) { return norm(def, value); }); });
    });
    live.forEach(function (def, index) {
      const available = new Set();
      base.forEach(function (row, rowIndex) {
        for (let other = 0; other < live.length; other += 1) {
          if (other === index || !active[other]) continue;
          if (values[other][rowIndex].indexOf(active[other]) === -1) return;
        }
        values[index][rowIndex].forEach(function (value) { available.add(value); });
      });
      const neutral = def.neutral || [''];
      Array.prototype.forEach.call(def.select.options, function (option) {
        if (neutral.indexOf(option.value) !== -1) return;
        const blocked = !available.has(norm(def, option.value)) && option.value !== def.select.value;
        if (option.disabled !== blocked) option.disabled = blocked;
        if (option.hidden !== blocked) option.hidden = blocked;
      });
    });
  }

  const api = { apply: apply };
  if (typeof window !== 'undefined') window.TKSFilterLinks = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
