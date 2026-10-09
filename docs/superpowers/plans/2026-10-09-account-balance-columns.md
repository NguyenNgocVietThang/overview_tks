# Account balance columns and group filter

**Goal:** Display STK, Tên tài khoản, Nhóm as separate columns and filter balances by account group.

**Architecture:** Use the existing balance data and client-side rendering. Add a select beside search, populated from loaded account groups. Keep fund selection, monetary values, totals and export behavior.

**Tech stack:** HTML, CSS, JavaScript; Node test runner and jsdom.

### Task 1: Update the balance table

- [x] Update `server/test/frontend/cashbook.test.js` to verify separate cells, independent sorting and group filtering combined with search, including missing groups and no matching rows.
- [x] Run `node --test test/frontend/cashbook.test.js` in `server` and confirm the new expectations fail.
- [x] Modify `server/public/cashbook/index.html`: columns `accountNo,name,accountGroup,balanceHanoi,balanceSaigon,balance`; labels STK, Tên tài khoản, Nhóm; account group select with empty value for all groups and fallback Khác; filter before sorting; refresh options when new summary data arrives. Preserve description as secondary text in the account-name cell and preserve fund selection from the STK button.
- [x] Run frontend cashbook tests, navigation tests and cashbook export tests. Review the diff for unrelated changes.

User approved the layout on 2026-10-09. Implement inline in the current workspace, preserving its existing edits. No dependency, API or database changes are required.

Validation: 47 related tests passed; git diff --check passed.
