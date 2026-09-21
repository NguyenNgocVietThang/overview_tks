// ==========================================
// HR DEPARTMENT — khoa so sanh "phong ban" (cot BO PHAN cua hr_employees) dung
// chung cho loc danh sach nghi phep va danh sach nhan su, de "KHO", "Kho " va
// "kho" khop nhau. Ban sao phia trinh duyet: departmentKey() trong
// public/humanresources/index.html — sua o day thi phai sua ca do.
// ==========================================
'use strict';

function departmentKey(value) {
  return String(value == null ? '' : value)
    .normalize('NFC')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase('vi-VN');
}

function matchesDepartment(value, wanted) {
  const key = departmentKey(wanted);
  return !key || departmentKey(value) === key;
}

module.exports = { departmentKey, matchesDepartment };
