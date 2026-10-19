'use strict';

// So tien (dong) -> chu tieng Viet, hien duoi o Số tiền de ke toan doi chieu voi dong
// "Số tiền viết bằng chữ" tren hoa don (thieu/thua 1 so 0 nhin ra ngay).
// Dung chung trinh duyet (window.TKSVndWords) va Node (test khu hoi voi vatDraft/amountWords.js).
(function (root) {
  const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
  const SCALES = ['', 'nghìn', 'triệu', 'tỷ'];

  /** 0..999; full = nhom khong dung dau (doc "không trăm", "lẻ"). */
  function readGroup(value, full) {
    const hundreds = Math.floor(value / 100);
    const tens = Math.floor((value % 100) / 10);
    const units = value % 10;
    const words = [];
    if (hundreds > 0 || full) words.push(DIGITS[hundreds], 'trăm');
    if (tens > 1) {
      words.push(DIGITS[tens], 'mươi');
      if (units === 1) words.push('mốt');
      else if (units === 4) words.push('tư');
      else if (units === 5) words.push('lăm');
      else if (units > 0) words.push(DIGITS[units]);
    } else if (tens === 1) {
      words.push('mười');
      if (units === 5) words.push('lăm');
      else if (units > 0) words.push(DIGITS[units]);
    } else if (units > 0) {
      if (hundreds > 0 || full) words.push('lẻ');
      words.push(DIGITS[units]);
    }
    return words;
  }

  /** 10933056 -> "Mười triệu chín trăm ba mươi ba nghìn không trăm năm mươi sáu đồng". */
  function toVietnameseWords(amount) {
    let value = Math.trunc(Number(amount));
    if (!Number.isFinite(value) || value <= 0) return '';
    if (value >= 1e15) return '';
    // Tach nhom 3 chu so tu phai sang; tren nghin ty doc lap "nghìn tỷ".
    const groups = [];
    while (value > 0) { groups.push(value % 1000); value = Math.floor(value / 1000); }
    const words = [];
    for (let i = groups.length - 1; i >= 0; i -= 1) {
      if (groups[i] === 0) continue;
      words.push(...readGroup(groups[i], i < groups.length - 1));
      const scale = i === 4 ? 'nghìn tỷ' : SCALES[i];
      if (scale) words.push(scale);
    }
    const text = words.join(' ') + ' đồng';
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  const api = { toVietnameseWords };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TKSVndWords = api;
})(typeof window !== 'undefined' ? window : this);
