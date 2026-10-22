'use strict';
const { normalizeCoSo, branchLabelToCode, BRANCHES } = require('../branch/branches');
const { canonicalDepartment } = require('../hr/hrDepartmentCatalog');

class AccountWorkAssignmentError extends Error {
  constructor(message, code) { super(message); this.statusCode = 400; this.code = code; }
}
function normalizeWorkAssignment({ vaiTro, workCoSo, boPhan } = {}) {
  if (String(vaiTro || '').trim() === 'Khách' && !workCoSo && !boPhan) return { workCoSo: '', boPhan: '' };
  const branch = normalizeCoSo(workCoSo);
  if (![BRANCHES.HANOI, BRANCHES.SAIGON].includes(branch)) throw new AccountWorkAssignmentError('Vui lòng chọn cơ sở công tác.', 'WORK_BRANCH_REQUIRED');
  if (!String(boPhan || '').trim()) throw new AccountWorkAssignmentError('Vui lòng chọn bộ phận trực thuộc.', 'DEPARTMENT_REQUIRED');
  const department = canonicalDepartment(branchLabelToCode(branch), boPhan);
  if (!department) throw new AccountWorkAssignmentError('Bộ phận không thuộc cơ sở công tác đã chọn.', 'DEPARTMENT_BRANCH_MISMATCH');
  return { workCoSo: branch, boPhan: department };
}
module.exports = { AccountWorkAssignmentError, normalizeWorkAssignment };
