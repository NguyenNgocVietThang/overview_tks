# Account and Leave Decoupling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `app_users` the only source for role/permissions, workplace branch, department, leave submission identity, schedules, and approval routing while preserving HR-driven account locking on resignation.

**Architecture:** Account administration validates and persists a workplace assignment independently from role and access scope. Leave services, database triggers, schedules, and Telegram authorization consume the account snapshot only; `hr_employee_id` remains a compatibility link for historical HR records and resignation locking, not an authorization or routing input.

**Tech Stack:** Node.js 22, Express, CommonJS, PostgreSQL/PGlite migrations, Vanilla HTML/CSS/JavaScript, `node:test`, JSDOM.

## Global Constraints

- Keep Vanilla JavaScript and the existing Express/CommonJS architecture; add no frontend framework or dependency.
- Role and department are independent. Example: role `Trợ lý`, workplace `Hà Nội`, department `Kế toán` is valid.
- Internal roles require exactly one physical workplace branch (`Hà Nội` or `Sài Gòn`) and one department from that branch's fixed catalog.
- `Khách` stores empty `work_branch`, `bo_phan`, and `leave_approval_departments`.
- Role changes never modify the workplace department, and workplace changes never modify role/permissions.
- No account role, workplace branch, department, schedule, or leave-routing value may be read from or written back to `hr_employees`.
- Preserve the existing `active`/`resigned` automation that locks or unlocks a linked account.
- Do not edit already-applied migrations; add migration `0078_hr_leave_account_identity.sql`.
- Preserve old leave requests, old schedule rows keyed by `employee_id`, decision versions, and immutable submission history.
- Use TDD for every production-code change: write a focused failing test, run it and observe the expected failure, implement minimally, rerun, then commit.
- Update `README.md`, `server/README.md`, `server/db/SCHEMA.md`, `CURRENT.md`, planning/SRS/BRD documents, and Graphify output required by `CLAUDE.md`.

---

## File Structure

### Create

- `server/auth/accountWorkAssignment.js` — validate and canonicalize `workCoSo` + `boPhan` independently from role.
- `server/auth/accountWorkAssignment.test.js` — unit contract for guest/internal assignments and cross-role combinations.
- `server/db/migrations/0078_hr_leave_account_identity.sql` — replace leave snapshot trigger identity/schedule lookup with account identity for leave requests.
- `server/db/accountLeaveIdentityMigration.test.js` — PGlite coverage for the new trigger and legacy compatibility.
- `server/test/frontend/account-work-assignment.test.js` — JSDOM coverage for dependent workplace/department selects and payloads.

### Modify

- `server/auth/appUsersRepository.js` and `.test.js` — persist/expose `workCoSo` and `boPhan` without HR joins.
- `server/auth/localUserStore.js` and `.test.js` — carry workplace fields through create/update.
- `server/auth/adminUserRoutes.js` and `.test.js` — validate workplace fields on create/edit, expose department catalog, stop role-to-HR writeback.
- `server/auth/accountAuditLog.js` and `.test.js` — audit workplace and department with “Bộ phận” terminology.
- `server/auth/featureRegistry.js` and `.test.js` — grant `hr.leave.submit` only when account workplace data is complete.
- `server/auth/effectiveUserResolver.js` and `.test.js` — delete unreachable HR role/department synchronization and retain only hardcoded-admin normalization.
- `server/public/account/index.html` — add workplace and department selectors to create/edit modals; rename approval wording to “Bộ phận”.
- `server/hr/hrLeaveSelfService.js` and `.test.js` — use account identity only and return an accurate eligibility error.
- `server/hr/hrLeaveWorkSchedulesRepository.js` and `.test.js` — account lookup/set/get is the primary schedule interface.
- `server/hr/hrLeaveRoutes.js` and `.test.js` — configure work schedules by account ID while keeping manual absence records HR-based.
- `server/hr/hrLeaveAuthorization.js` and `.test.js` — keep account-only approval matching and update terminology.
- `server/telegram/managerLeaveRuntime.js` and `.test.js` — resolve manager from `app_users` only.
- `server/telegram/managerLeaveStore.js` tests/integration fixtures — load migration 0078 where trigger behavior is exercised.
- Documentation files required by repo policy.

---

## Task 1: Canonical workplace assignment contract

**Files:**

- Create: `server/auth/accountWorkAssignment.js`
- Create: `server/auth/accountWorkAssignment.test.js`

**Interfaces:**

- Input: `normalizeWorkAssignment({ vaiTro, workCoSo, boPhan })`.
- Output: `{ workCoSo: '' | 'Hà Nội' | 'Sài Gòn', boPhan: string }`.
- Errors: `AccountWorkAssignmentError` with `statusCode = 400` and code `WORK_BRANCH_REQUIRED`, `DEPARTMENT_REQUIRED`, or `DEPARTMENT_BRANCH_MISMATCH`.

- [ ] Write failing tests:

```js
test('Trợ lý may belong to Kế toán without changing role', () => {
  assert.deepEqual(normalizeWorkAssignment({ vaiTro: 'Trợ lý', workCoSo: 'Hà Nội', boPhan: 'kế toán' }), {
    workCoSo: 'Hà Nội', boPhan: 'Kế toán'
  });
});
test('internal account requires a physical workplace and matching department', () => {
  assert.throws(() => normalizeWorkAssignment({ vaiTro: 'Trợ lý', workCoSo: '', boPhan: 'Kế toán' }), { code: 'WORK_BRANCH_REQUIRED' });
  assert.throws(() => normalizeWorkAssignment({ vaiTro: 'Trợ lý', workCoSo: 'Hà Nội', boPhan: 'Sale SG' }), { code: 'DEPARTMENT_BRANCH_MISMATCH' });
});
test('guest clears workplace and department', () => {
  assert.deepEqual(normalizeWorkAssignment({ vaiTro: 'Khách', workCoSo: 'Hà Nội', boPhan: 'Kế toán' }), { workCoSo: '', boPhan: '' });
});
```

- [ ] Run `cd server; node --test auth/accountWorkAssignment.test.js` and confirm failure `MODULE_NOT_FOUND`.
- [ ] Implement the module using `normalizeCoSo`, `branchLabelToCode`, and `canonicalDepartment`:

```js
'use strict';
const { normalizeCoSo, branchLabelToCode, BRANCHES } = require('../branch/branches');
const { canonicalDepartment } = require('../hr/hrDepartmentCatalog');
class AccountWorkAssignmentError extends Error {
  constructor(message, code) { super(message); this.statusCode = 400; this.code = code; }
}
function normalizeWorkAssignment({ vaiTro, workCoSo, boPhan } = {}) {
  if (String(vaiTro || '').trim() === 'Khách') return { workCoSo: '', boPhan: '' };
  const branch = normalizeCoSo(workCoSo);
  if (![BRANCHES.HANOI, BRANCHES.SAIGON].includes(branch)) {
    throw new AccountWorkAssignmentError('Vui lòng chọn cơ sở công tác.', 'WORK_BRANCH_REQUIRED');
  }
  if (!String(boPhan || '').trim()) throw new AccountWorkAssignmentError('Vui lòng chọn bộ phận trực thuộc.', 'DEPARTMENT_REQUIRED');
  const department = canonicalDepartment(branchLabelToCode(branch), boPhan);
  if (!department) throw new AccountWorkAssignmentError('Bộ phận không thuộc cơ sở công tác đã chọn.', 'DEPARTMENT_BRANCH_MISMATCH');
  return { workCoSo: branch, boPhan: department };
}
module.exports = { AccountWorkAssignmentError, normalizeWorkAssignment };
```

- [ ] Rerun the focused test and confirm green.
- [ ] Commit: `git add server/auth/accountWorkAssignment.js server/auth/accountWorkAssignment.test.js && git commit -m "feat(account): validate workplace assignment"`.

## Task 2: Persist workplace assignment through repository and store

**Files:**

- Modify: `server/auth/appUsersRepository.test.js`
- Modify: `server/auth/appUsersRepository.js:58-136`
- Modify: `server/auth/localUserStore.test.js`
- Modify: `server/auth/localUserStore.js:387-416,462-487`
- Modify: `server/auth/testHelpers/fakeAppUsersRepository.js`

**Interfaces:**

- `rowToUser(row)` exposes `workCoSo` and `boPhan` from `app_users` only.
- `createUser({ workCoSo, boPhan })` and `updateUser(id, { workCoSo, boPhan })` persist both fields.

- [ ] Extend repository/store tests to create `Trợ lý` with `workCoSo: 'Hà Nội'`, `boPhan: 'Kế toán'`, then update only `boPhan` and assert role remains `Trợ lý`.
- [ ] Run `cd server; node --test auth/appUsersRepository.test.js auth/localUserStore.test.js` and confirm `workCoSo` is missing after create/update.
- [ ] Add `workCoSo` beside `boPhan` in the `newUser` object and normalize it with `normalizeCoSo`; in `updateUser`, preserve or normalize `updates.workCoSo` independently of `coSo`.
- [ ] Ensure the fake repository round-trips these fields, matching real repository semantics.
- [ ] Rerun focused tests and confirm green.
- [ ] Commit: `git add server/auth/appUsersRepository* server/auth/localUserStore* server/auth/testHelpers/fakeAppUsersRepository.js && git commit -m "feat(account): persist workplace and department"`.

## Task 3: Create/edit account API and audit log

**Files:**

- Modify: `server/auth/adminUserRoutes.test.js`
- Modify: `server/auth/adminUserRoutes.js:29-57,194-273,320-569,689-709`
- Modify: `server/auth/accountAuditLog.test.js`
- Modify: `server/auth/accountAuditLog.js:24-37`

**Interfaces:**

- `POST /api/admin/users` accepts `workCoSo` and `boPhan`.
- `PUT /api/admin/users/:id` accepts the same pair and validates the effective pair after applying partial updates.
- `GET /api/admin/users` returns both values.
- `GET /api/admin/permissions/catalog` returns `departmentsByBranch` keyed by `Hà Nội` and `Sài Gòn`.

- [ ] Add failing route tests for:
  - creating `Trợ lý`/Hà Nội/`Kế toán` and receiving assistant permissions without HR linkage;
  - rejecting missing workplace for an internal role;
  - rejecting `Sale SG` under Hà Nội;
  - converting an account to `Khách` and clearing workplace/department/approval departments;
  - changing role while preserving department;
  - changing workplace while requiring a matching department;
  - never calling `employeeDirectory.writeDepartmentForRole` when role changes.
- [ ] Run `cd server; node --test auth/adminUserRoutes.test.js` and confirm the create payload currently drops `workCoSo`/`boPhan` and the old writeback assertion fails.
- [ ] Add `workCoSo` to `publicAdminUser`, call `normalizeWorkAssignment` before create/update, and pass canonical values to `localUserStore`.
- [ ] Remove `hrRoleToSync` and the complete `employeeDirectory.writeDepartmentForRole` call block. Keep contact synchronization and resignation locking untouched.
- [ ] Return the fixed catalog without reading `hr_employees` for account workplace choices:

```js
departmentsByBranch: {
  'Hà Nội': departmentsFor('hanoi'),
  'Sài Gòn': departmentsFor('saigon')
}
```

- [ ] Add audit fields `{ key: 'workCoSo', label: 'Cơ sở công tác' }`, `{ key: 'boPhan', label: 'Bộ phận trực thuộc' }`, and rename the approval label to `Bộ phận được duyệt nghỉ`.
- [ ] Rerun route and audit tests; confirm green.
- [ ] Commit: `git add server/auth/adminUserRoutes* server/auth/accountAuditLog* && git commit -m "feat(account): manage independent workplace assignment"`.

## Task 4: Account modal UI and terminology

**Files:**

- Create: `server/test/frontend/account-work-assignment.test.js`
- Modify: `server/public/account/index.html:716-875,2060-2090,2395-2502`
- Modify: `server/test/frontend/account-protected-manager-ui.test.js`

**Interfaces:**

- New element IDs: `createWorkCoSo`, `createBoPhan`, `editWorkCoSo`, `editBoPhan`.
- Function: `refreshWorkDepartments(branchSelectId, departmentSelectId, selected = '')` reads `permCatalog.departmentsByBranch`.
- Create/edit requests include `{ workCoSo, boPhan }`.

- [ ] Write JSDOM tests asserting:
  - choosing `Hà Nội` renders exactly the eight Hà Nội departments;
  - choosing `Sài Gòn` renders exactly the four Sài Gòn departments and clears an invalid Hà Nội selection;
  - role `Trợ lý` and department `Kế toán` are submitted unchanged;
  - role `Khách` disables/clears workplace and department;
  - labels say `Bộ phận trực thuộc` and `Bộ phận được duyệt nghỉ phép`, with no `Phòng ban` wording in the modal.
- [ ] Run `cd server; node --test test/frontend/account-work-assignment.test.js` and confirm missing element/function failures.
- [ ] Add two dependent selects beneath `Cơ sở mặc định` in both modals. Keep `Cơ sở mặc định` as permission/data scope and label it `Phạm vi phụ trách` to avoid confusion with workplace.
- [ ] Populate department options exclusively from the server catalog; attach `change` listeners to role and workplace selects.
- [ ] Include workplace fields in create/edit JSON payloads and populate them from the selected row during edit.
- [ ] Keep approval department checkboxes separate and show their help text only as approval scope.
- [ ] Rerun the new UI test plus `account-protected-manager-ui.test.js`; confirm green.
- [ ] Commit: `git add server/public/account/index.html server/test/frontend/account-work-assignment.test.js server/test/frontend/account-protected-manager-ui.test.js && git commit -m "feat(account-ui): select workplace and department"`.

## Task 5: Permission eligibility and account self-service

**Files:**

- Modify: `server/auth/featureRegistry.test.js`
- Modify: `server/auth/featureRegistry.js:207-231`
- Modify: `server/hr/hrLeaveSelfService.test.js`
- Modify: `server/hr/hrLeaveSelfService.js:9-42`
- Modify: `server/test/frontend/hr-leave-self-form.test.js`

**Interfaces:**

- `canSubmitOwnLeave(user)` requires active internal account plus a physical `workCoSo` and non-empty `boPhan`; it does not inspect `hrEmployeeActive`.
- Self-service context reads only `app_users` and reports `SELF_LEAVE_WORK_ASSIGNMENT_REQUIRED` when incomplete.

- [ ] Add a failing feature-registry test showing an active `Trợ lý` without workplace data does not receive `hr.leave.submit`, while `Trợ lý`/Hà Nội/`Kế toán` does.
- [ ] Add a failing self-service test that changes the linked HR employee's department/status and proves the account context remains unchanged.
- [ ] Run focused tests and confirm current `canSubmitOwnLeave` incorrectly grants the incomplete account.
- [ ] Update `canSubmitOwnLeave` to validate `workCoSo`/`boPhan` only; update the self-service 403 text and code to mention account workplace assignment, not HR linkage.
- [ ] Update frontend error fixture/copy to `Tài khoản chưa được cấu hình cơ sở công tác và bộ phận.`.
- [ ] Rerun focused tests and confirm green.
- [ ] Commit: `git add server/auth/featureRegistry* server/hr/hrLeaveSelfService* server/test/frontend/hr-leave-self-form.test.js && git commit -m "fix(leave): require account workplace for self service"`.

## Task 6: Account-keyed work schedule administration

**Files:**

- Modify: `server/hr/hrLeaveWorkSchedulesRepository.test.js`
- Modify: `server/hr/hrLeaveWorkSchedulesRepository.js`
- Modify: `server/hr/hrLeaveRoutes.test.js`
- Modify: `server/hr/hrLeaveRoutes.js:495-503`
- Modify: `server/hr/hrLeaveAuthorization.test.js`
- Modify: `server/hr/hrLeaveAuthorization.js`

**Interfaces:**

- `getAccount(userId)` returns `{ id, username, ho_ten, branch, bo_phan }` from active internal `app_users` using `work_branch`/`bo_phan`.
- Add `GET/PUT /api/hr/account-leave-work-schedules/:userId` and call `getScheduleForUser`/`setScheduleForUser`.
- Keep `GET/PUT /api/hr/leave-work-schedules/:employeeId` for manager-created manual-absence HR records only.
- Authorization uses `{ branch: account.branch, bo_phan: account.bo_phan }` through a renamed `authorizeWorkAccount` method.

- [ ] Write failing repository/route tests proving schedule configuration succeeds for an account with no `hr_employee_id` and fails outside the approver's account-based scope.
- [ ] Run `cd server; node --test hr/hrLeaveWorkSchedulesRepository.test.js hr/hrLeaveRoutes.test.js hr/hrLeaveAuthorization.test.js` and confirm no account-keyed administration route exists.
- [ ] Add `getAccount` and the account-keyed routes. Retain the existing employee-keyed routes and repository functions only for historical/manual-absence compatibility.
- [ ] Update authorization wording from “phòng ban” to “bộ phận”.
- [ ] Rerun backend schedule and authorization tests; confirm green.
- [ ] Commit: `git add server/hr/hrLeaveWorkSchedulesRepository* server/hr/hrLeaveRoutes* server/hr/hrLeaveAuthorization* && git commit -m "feat(leave): manage schedules by account"`.

## Task 7: Database trigger migration to account identity

**Files:**

- Create: `server/db/accountLeaveIdentityMigration.test.js`
- Create: `server/db/migrations/0078_hr_leave_account_identity.sql`
- Modify: migration fixtures that explicitly load through 0077.

**Interfaces:**

- For `loai_yeu_cau = 'Xin nghỉ phép'`, the trigger requires an active internal `user_id`, snapshots `work_branch`/`bo_phan`, and loads schedule by `user_id`.
- Telegram requests may resolve `user_id` from an active `hr_telegram_links` row, then follow the same account path.
- Manual absence records continue using the HR employee path because they are HR records created by a manager, not self-service requests.

- [ ] Build a PGlite fixture by applying migrations 0009, 0016, 0038, 0042, 0076, and 0077; add failing tests for:
  - linked account whose HR department differs from account department: request stores account department;
  - account-only request uses account schedule and leaves `hr_employee_id` null;
  - Telegram link resolves account and never reads HR department;
  - incomplete/inactive account is rejected;
  - manual absence with `hr_employee_id` remains valid;
  - history row accepts null `hr_employee_id` and remains immutable.
- [ ] Run `cd server; node --test db/accountLeaveIdentityMigration.test.js` and confirm the 0042 trigger overwrites department from HR.
- [ ] Create migration 0078 with `CREATE OR REPLACE FUNCTION hr_leave_submission_snapshot()`. Preserve calendar normalization, timing calculation, decision resets, and immutable identity-on-edit from 0042. Replace only the identity/schedule section with:

```sql
IF NEW.loai_yeu_cau = 'Xin nghỉ phép' THEN
  IF NEW.user_id IS NULL AND NEW.telegram_chat_id <> '' THEN
    SELECT u.id INTO linked_user
    FROM hr_telegram_links l JOIN app_users u ON u.id = l.user_id
    WHERE l.status = 'linked' AND l.telegram_chat_id = NEW.telegram_chat_id
      AND NOT u.is_deleted AND u.trang_thai = 'Đang hoạt động';
    NEW.user_id := linked_user;
  END IF;
  SELECT u.work_branch, u.bo_phan INTO account_branch, account_department
  FROM app_users u
  WHERE u.id = NEW.user_id AND NOT u.is_deleted
    AND u.trang_thai = 'Đang hoạt động' AND u.vai_tro <> 'Khách'
    AND u.work_branch IN ('hanoi','saigon') AND btrim(u.bo_phan) <> '';
  IF account_branch IS NULL OR account_department IS NULL THEN
    RAISE EXCEPTION 'LEAVE_ACCOUNT_REQUIRED: configure an active account workplace';
  END IF;
  NEW.branch := account_branch;
  NEW.bo_phan := account_department;
  IF TG_OP = 'INSERT' THEN NEW.hr_employee_id := NULL; END IF;
  SELECT * INTO schedule_row FROM hr_leave_work_schedules
  WHERE user_id = NEW.user_id AND work_date = NEW.start_date FOR SHARE;
ELSE
  SELECT e.branch INTO employee_branch FROM hr_employees e
  WHERE e.id = NEW.hr_employee_id AND e.is_active;
  IF employee_branch IS NULL THEN RAISE EXCEPTION 'LEAVE_EMPLOYEE_REQUIRED: active employee required'; END IF;
  NEW.branch := employee_branch;
  IF TG_OP = 'INSERT' THEN SELECT COALESCE(e.bo_phan,'') INTO NEW.bo_phan FROM hr_employees e WHERE e.id = NEW.hr_employee_id; END IF;
  SELECT * INTO schedule_row FROM hr_leave_work_schedules
  WHERE employee_id = NEW.hr_employee_id AND work_date = NEW.start_date FOR SHARE;
END IF;
```

- [ ] Ensure `hr_leave_submission_history()` inserts nullable `hr_employee_id` without any new destructive schema change.
- [ ] Rerun the new migration test and all existing leave migration tests; confirm green.
- [ ] Commit: `git add server/db/migrations/0078_hr_leave_account_identity.sql server/db/accountLeaveIdentityMigration.test.js server/db/*Leave*test.js && git commit -m "feat(db): snapshot leave identity from accounts"`.

## Task 8: Telegram manager authorization from accounts only

**Files:**

- Modify: `server/telegram/managerLeaveRuntime.test.js`
- Modify: `server/telegram/managerLeaveIntegration.test.js`
- Modify: `server/telegram/managerLeaveRuntime.js:28-49`
- Modify: `server/telegram/managerLeaveBot.js` only for wording if tests expose “phòng ban”.

**Interfaces:**

- `resolveManagerFromDb(telegramId)` executes `SELECT u.* FROM app_users u WHERE u.telegram_id = $1 AND NOT u.is_deleted` with no HR join.
- Eligibility and routing use `vai_tro`, `feature_permissions`, `co_so`, and `leave_approval_departments` from the account.

- [ ] Add a failing test with an approver whose linked HR row is inactive/wrong department but whose account is active and correctly scoped; assert Telegram authorization succeeds from account data.
- [ ] Add the inverse test: HR row appears eligible but account lacks `hr.leave.manage`; assert denial.
- [ ] Run `cd server; node --test telegram/managerLeaveRuntime.test.js telegram/managerLeaveIntegration.test.js` and confirm the SQL still joins HR.
- [ ] Remove the join and resolver dependency from `loadManagersFromDb`; use `appUsers.selectAllRows()` directly and retain cache behavior.
- [ ] Rerun tests and confirm green.
- [ ] Commit: `git add server/telegram/managerLeaveRuntime* server/telegram/managerLeaveIntegration.test.js server/telegram/managerLeaveBot.js && git commit -m "fix(telegram): authorize leave managers from accounts"`.

## Task 9: Remove dormant HR-derived role behavior

**Files:**

- Modify: `server/auth/effectiveUserResolver.test.js`
- Modify: `server/auth/effectiveUserResolver.js`
- Modify: `server/auth/employeeRegistrationService.js` tests only where old role inference is asserted.
- Modify: `server/hr/hrEmployeeAdminService.test.js` only to retain resignation lock expectations.

**Interfaces:**

- `resolveUser(inputUser)` may normalize hardcoded admins but otherwise returns account role, access scope, workplace, department, and overrides unchanged without loading the HR directory.
- HR status service may still lock/unlock the linked account but cannot rewrite account role/workplace/department.

- [ ] Replace obsolete resolver tests with failing assertions that HR directory role/department changes do not modify account fields and the directory loader is not called.
- [ ] Run `cd server; node --test auth/effectiveUserResolver.test.js hr/hrEmployeeAdminService.test.js` and confirm legacy expectations fail or unreachable code remains uncovered.
- [ ] Delete unreachable matching/synchronization branches after the current early return; retain hardcoded-admin enforcement and exported errors still used by registration/contact flows.
- [ ] Confirm resignation tests still lock/unlock accounts without changing role, `workCoSo`, `boPhan`, or `featurePermissions`.
- [ ] Rerun focused tests and confirm green.
- [ ] Commit: `git add server/auth/effectiveUserResolver* server/auth/employeeRegistrationService* server/hr/hrEmployeeAdminService.test.js && git commit -m "refactor(auth): remove HR-derived account permissions"`.

## Task 10: Full regression, documentation, and migration readiness

**Files:**

- Modify: `README.md`
- Modify: `server/README.md`
- Modify: `server/db/SCHEMA.md`
- Modify: `CURRENT.md`
- Modify: `docs/04-planning/implementation_plan.md`
- Modify: `docs/02-srs/SRS_Dashboard_GoogleSheets.md`
- Modify: `docs/01-brd/BRD_Dashboard_GoogleSheets.md`
- Modify: generated `graphify-out/` files from `graphify update .`

**Interfaces:** Documentation must state the authoritative sources and the deployment order `0076` → `0077` → `0078` → application code.

- [ ] Run focused account/leave suites:

```powershell
cd server
node --test auth/accountWorkAssignment.test.js auth/appUsersRepository.test.js auth/localUserStore.test.js auth/adminUserRoutes.test.js auth/accountAuditLog.test.js auth/featureRegistry.test.js
node --test hr/hrLeaveSelfService.test.js hr/hrLeaveWorkSchedulesRepository.test.js hr/hrLeaveAuthorization.test.js hr/hrLeaveRoutes.test.js
node --test db/accountHrDecouplingMigration.test.js db/accountLeaveSchedulesMigration.test.js db/accountLeaveIdentityMigration.test.js
node --test telegram/managerLeaveRuntime.test.js telegram/managerLeaveIntegration.test.js
node --test test/frontend/account-work-assignment.test.js test/frontend/account-protected-manager-ui.test.js test/frontend/hr-leave-self-form.test.js
```

- [ ] Run `cd server; npm test` and require a clean exit with no new failures.
- [ ] Run `graphify update .` from the repository root and confirm success.
- [ ] Update all required documents with the final behavior, migration 0078, tests, deployment order, and date `22/10/2026`.
- [ ] Run `git diff --check` and inspect `git status --short` for unrelated files.
- [ ] Run the focused suites once more after documentation/Graphify changes.
- [ ] Commit: `git add README.md server/README.md server/db/SCHEMA.md CURRENT.md docs graphify-out && git commit -m "docs: document account-owned leave routing"`.

## Final Verification Gate

- [ ] Create an account in the UI with role `Trợ lý`, workplace `Hà Nội`, department `Kế toán`; inspect `GET /api/auth/me` and confirm assistant permissions plus `hr.leave.submit`.
- [ ] Submit leave and query the saved request; confirm `user_id` is the account, `hr_employee_id` is null, `branch = hanoi`, and `bo_phan = Kế toán`.
- [ ] Change the linked HR employee department and repeat; confirm the account and request are unchanged.
- [ ] Confirm only an active account with `hr.leave.manage`, matching `co_so`, and `leave_approval_departments` containing `Kế toán` can decide the request through web and Telegram.
- [ ] Mark the linked HR employee `resigned`; confirm the account is locked without changing its role, permissions, workplace, or department.
- [ ] Apply migrations on staging before deploying code; do not point new application code at a database lacking 0078.
