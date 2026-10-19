'use strict';

// "Số tiền viết bằng chữ" tren hoa don -> so (dong). Doc doc lap voi AI de doi chieu
// Tong thanh toan AI doc tu chu so (vd 10.953.056 vs "...chín trăm ba mươi ba nghìn...").

const DIGITS = {
  'không': 0, 'một': 1, 'mốt': 1, 'hai': 2, 'ba': 3, 'bốn': 4, 'tư': 4, 'năm': 5, 'lăm': 5, 'nhăm': 5,
  'sáu': 6, 'bảy': 7, 'bẩy': 7, 'tám': 8, 'chín': 9
};
const SCALES = { 'nghìn': 1e3, 'ngàn': 1e3, 'triệu': 1e6, 'tỷ': 1e9, 'tỉ': 1e9 };
const SKIP = new Set(['linh', 'lẻ', 'và']);
const END = new Set(['đồng', 'chẵn', 'chẳn', 'vnd', 'vnđ']);

/** Chu tieng Viet -> so nguyen; gap tu la (khong chac doc dung) thi tra null. */
function parseVietnameseAmountWords(text) {
  const words = String(text || '').normalize('NFC').toLowerCase()
    .replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  let total = 0;
  let group = 0;
  let pending = null;
  let seen = false;
  for (const word of words) {
    if (END.has(word)) break;
    if (SKIP.has(word)) continue;
    if (word in DIGITS) {
      if (pending !== null) return null; // hai so lien nhau: "ba bốn" -> khong hop le
      pending = DIGITS[word];
    } else if (word === 'mười') {
      if (pending !== null) return null;
      group += 10;
    } else if (word === 'mươi') {
      if (pending === null) return null;
      group += pending * 10;
      pending = null;
    } else if (word === 'trăm') {
      if (pending === null) return null;
      group += pending * 100;
      pending = null;
    } else if (word in SCALES) {
      total += (group + (pending || 0)) * SCALES[word];
      group = 0;
      pending = null;
    } else {
      return null;
    }
    seen = true;
  }
  return seen ? total + group + (pending || 0) : null;
}

module.exports = { parseVietnameseAmountWords };
