'use strict';

const { hasFeature } = require('../auth/featureRegistry');
const { ACTIVE_STATUS } = require('../auth/userRepository');
const { isSeniorAdmin } = require('../auth/accountPolicy');
const isSameAccount = (a,b) => !!(a && b && a.id && b.id && String(a.id) === String(b.id));
const appUsers = require('../auth/appUsersRepository');
const { departmentKey } = require('./hrDepartment');
const { normalizeDepartments } = require('./hrApprovalDepartments');
const { normalizeCoSo, BRANCHES, BRANCH_BOTH, branchCodeToLabel } = require('../branch/branches');
const BRANCHES_ALL = [BRANCHES.HANOI, BRANCHES.SAIGON];

function isActiveApprover(user) {
  return !!(user && user.id && !user.isDeleted && user.trangThai === ACTIVE_STATUS && user.hrEmployeeActive !== false && hasFeature(user,'hr.leave.manage'));
}
function matchesApprovalScope(user, request) {
  if (!isActiveApprover(user) || !request) return false;
  const scope = normalizeCoSo(user.assignedCoSo !== undefined ? user.assignedCoSo : user.coSo);
  const branch = normalizeCoSo(request.co_so || request.branch) || branchCodeToLabel(request.branch);
  const department = departmentKey(request.bo_phan);
  return BRANCHES_ALL.includes(branch) && (scope === BRANCH_BOTH || scope === branch) && !!department &&
    Array.isArray(user.leaveApprovalDepartments) && user.leaveApprovalDepartments.some(value => departmentKey(value) === department);
}
function selectApprovers(users, request) {
  const normal = users.filter(user => matchesApprovalScope(user,request));
  if (normal.length) return {users:normal,fallback:false,missing:false};
  const fallback = users.filter(user => isActiveApprover(user) && isSeniorAdmin(user));
  return {users:fallback,fallback:true,missing:fallback.length === 0};
}
function routingWarning(routing) {
  if (routing.missing) return 'Chưa có người duyệt phù hợp hoặc quản trị dự phòng đang hoạt động. Đơn được giữ chờ xử lý.';
  return routing.fallback ? 'Đơn chuyển quản trị cao nhất vì chưa có người duyệt đúng phòng ban và cơ sở.' : '';
}
function createHrLeaveAuthorization({loadUsers=()=>appUsers.selectAllRows()}={}) {
  async function routingFor(request) { return selectApprovers(await loadUsers(),request); }
  async function authorize(user,request) {
    const routing = await routingFor(request);
    const current = routing.users.find(candidate => isSameAccount(candidate,user));
    if (!current) throw Object.assign(new Error('Bạn không có quyền duyệt phòng ban và cơ sở của đơn này.'),{statusCode:403,code:'LEAVE_APPROVAL_FORBIDDEN'});
    return current;
  }
  async function canDecide(user,request) {
    const routing=await routingFor(request); return routing.users.some(candidate=>isSameAccount(candidate,user));
  }
  async function describeRequests(user,requests) {
    const users=await loadUsers();
    return requests.map(request=>{
      const routing=selectApprovers(users,request);
      return {...request,canManage:routing.users.some(candidate=>isSameAccount(candidate,user)),routingWarning:routingWarning(routing)};
    });
  }
  return {authorize,routingFor,canDecide,describeRequests};
}
module.exports={normalizeDepartments,isActiveApprover,matchesApprovalScope,selectApprovers,routingWarning,createHrLeaveAuthorization};
