'use strict';
const defaultRepo = require('./hrEmployeesRepository');
const { normalizePhone } = require('../auth/localUserStore');

function key(value) {
  return String(value || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').replace(/\s+/g, ' ').toUpperCase();
}

const TEXT_FIELDS = ['chucVu', 'soCccd', 'diaChiHienTai', 'nguoiThanQuanHe', 'nguoiThanHoTen', 'nguoiThanSoDienThoai', 'gioiTinh'];
const DATE_FIELDS = ['ngayVaoLam', 'ngaySinh', 'ngayNghiViec'];
const FLAG_FIELDS = ['hoSoDayDu', 'vanTayDaDangKy'];

// Chi dien o con trong cua nhan su co san; gia tri da nhap tren web khong bi file ghi de.
function fillBlanks(current, row) {
  const merged = {};
  TEXT_FIELDS.forEach(f => { merged[f] = String(current[f] || '').trim() ? current[f] : (row[f] || ''); });
  DATE_FIELDS.forEach(f => { merged[f] = current[f] || row[f] || null; });
  FLAG_FIELDS.forEach(f => { merged[f] = Boolean(current[f] || row[f]); });
  return merged;
}

async function importRows(rows, options = {}) {
  const repo = options.repo || defaultRepo;
  const existing = await repo.selectAllActive();
  const result = { total: rows.length, updated: 0, created: 0, unmatched: [], ambiguous: [], failed: [] };
  for (const row of rows) {
    let matches = existing.filter(e => e.branch === row.branch && normalizePhone(row.soDienThoai) && normalizePhone(e.soDienThoai) === normalizePhone(row.soDienThoai));
    if (!matches.length) matches = existing.filter(e => e.branch === row.branch && key(e.hoTen) === key(row.hoTen));
    const item = { branch: row.branch, hoTen: row.hoTen, soDienThoai: row.soDienThoai };
    if (matches.length === 1) {
      await repo.updateExtendedById(matches[0].id, fillBlanks(matches[0], row));
      result.updated += 1;
    } else if (matches.length > 1) {
      result.ambiguous.push(item);
    } else if (options.createMissing !== false && typeof repo.insertEmployee === 'function') {
      try {
        const resigned = Boolean(row.ngayNghiViec) || /^nv$/i.test(String(row.trangThaiNguon || '').trim());
        const created = await repo.insertEmployee({
          branch: row.branch, hoTen: row.hoTen, boPhan: row.boPhan, soDienThoai: row.soDienThoai,
          email: '', telegramId: '', employmentStatus: resigned ? 'resigned' : 'active'
        });
        await repo.updateExtendedById(created.id, row);
        existing.push(created);
        result.created += 1;
      } catch (err) {
        result.failed.push({ ...item, reason: err && err.message ? err.message : 'Không tạo được nhân sự.' });
      }
    } else {
      result.unmatched.push(item);
    }
  }
  return result;
}

module.exports = { importRows };
