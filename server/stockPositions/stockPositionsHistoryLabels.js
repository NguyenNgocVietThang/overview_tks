'use strict';

// Nhan tieng Viet cua lich su VT Ha Noi / VT Sai Gon, dung chung cho loc tu khoa va xuat Excel (khop public/vt-positions/vt-positions.js).
const ACTION_LABELS = Object.freeze({
  seed: 'Nhập dữ liệu đầu', create: 'Thêm dòng', edit: 'Sửa', delete: 'Xóa dòng', auto_delete: 'Tự xóa (hết hàng)',
  deduct: 'Trừ SL', import_replace: 'Import thay toàn bộ', import_add: 'Import bổ sung',
  // Nhat hang theo don (Vong doi don hang, migration 0096): tru thung khi Xac nhan nhat / hoan tac khi Huy nhat.
  pick: 'Nhặt hàng theo đơn', pick_revert: 'Hoàn tác nhặt hàng'
});
const FIELD_LABELS = Object.freeze({ code: 'Mã hàng', notes: 'Ghi chú', arrivalDate: 'Ngày về', location: 'Vị trí', quantity: 'Số lượng' });
const SUMMARY_KEYS = Object.freeze([['added', 'Thêm'], ['updated', 'Đổi'], ['deleted', 'Xóa'], ['skippedEmpty', 'Bỏ qua']]);

// Tom tat dong import (cot "Tom tat"): "Them 3 · Doi 1 · 12 dong · file.xlsx".
function summaryText(summary) {
  if (!summary || typeof summary !== 'object') return '';
  const parts = [];
  for (const [key, label] of SUMMARY_KEYS) if (summary[key] !== undefined) parts.push(`${label} ${summary[key]}`);
  if (summary.rows !== undefined) parts.push(`${summary.rows} dòng`);
  if (summary.fileName) parts.push(summary.fileName);
  return parts.length ? parts.join(' · ') : JSON.stringify(summary);
}

module.exports = { ACTION_LABELS, FIELD_LABELS, summaryText };
