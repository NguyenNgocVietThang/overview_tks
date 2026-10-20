'use strict';
// Giới tính chuẩn hiển thị trong form: Nam / Nữ / Khác. File DS nhân sự cũ ghi "NAM"/"NỮ" nên
// hộp chi tiết không chọn được (ô chọn trống, lưu lại thì mất). Giá trị lạ giữ nguyên để không mất dữ liệu.
const LABELS = { NAM: 'Nam', NU: 'Nữ', KHAC: 'Khác' };

function normalizeGender(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return '';
  const key = text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toUpperCase();
  return LABELS[key] || text;
}

module.exports = { normalizeGender };
