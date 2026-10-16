'use strict';
const {departmentKey}=require('./hrDepartment');
function normalizeDepartments(values) {
  if (!Array.isArray(values) || values.some(value => typeof value !== 'string')) {
    throw Object.assign(new Error('Danh sách phòng ban phải là mảng chuỗi.'), {statusCode:400,code:'INVALID_APPROVAL_DEPARTMENTS'});
  }
  const seen = new Set();
  return values.map(value => value.normalize('NFC').replace(/\s+/gu,' ').trim()).filter(value => {
    const key = departmentKey(value); if (!key || seen.has(key)) return false; seen.add(key); return true;
  });
}
module.exports={normalizeDepartments};
