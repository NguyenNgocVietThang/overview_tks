(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TKSFuzzySearch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Bỏ dấu tiếng Việt, hạ chữ thường, gom khoảng trắng.
  function fold(value) {
    return String(value == null ? '' : value)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd').replace(/Đ/g, 'd')
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function tokens(query) {
    const folded = fold(query);
    return folded ? folded.split(' ') : [];
  }

  // Số từ tối thiểu phải khớp: 1 từ -> 1; 2 từ -> 2; từ 3 từ trở lên -> quá nửa.
  function requiredMatches(count) {
    if (count <= 1) return count;
    return Math.max(2, Math.floor(count / 2) + 1);
  }

  // Điểm khớp: 0 = không hiện. Khớp nhiều từ hơn điểm cao hơn, khớp nguyên cụm cao nhất.
  function score(haystack, query) {
    const words = tokens(query);
    if (!words.length) return 1;
    const text = fold(haystack);
    let matched = 0;
    for (const word of words) if (text.indexOf(word) !== -1) matched += 1;
    if (matched < requiredMatches(words.length)) return 0;
    const phrase = words.join(' ');
    return matched + (text.indexOf(phrase) !== -1 ? words.length + 1 : 0);
  }

  function matches(haystack, query) {
    return score(haystack, query) > 0;
  }

  // Lọc + xếp: khớp nhiều từ trước, giữ thứ tự gốc khi điểm bằng nhau.
  function filter(items, query, getText) {
    const words = tokens(query);
    if (!words.length) return items.slice();
    const pick = typeof getText === 'function' ? getText : function (item) { return item; };
    return items
      .map(function (item, index) { return { item: item, index: index, score: score(pick(item), query) }; })
      .filter(function (entry) { return entry.score > 0; })
      .sort(function (a, b) { return b.score - a.score || a.index - b.index; })
      .map(function (entry) { return entry.item; });
  }

  return { fold: fold, tokens: tokens, requiredMatches: requiredMatches, score: score, matches: matches, filter: filter };
});
