# HR Leave Sessions and Submission Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hour-based HR leave data with morning/afternoon sessions, exclude Sundays, flag late submissions, and filter the HR web list by submission time.

**Architecture:** Keep calendar/session rules in `hrLeaveService.js`, persistence/schema rules in `hrLeaveRepository.js`, and Telegram conversation orchestration in `hrTelegramBot.js`. The Sheet, API, export, manual-entry UI, and list UI use one canonical record shape: formatted leave boundaries, integer session count, converted day count, and ISO submission time.

**Tech Stack:** Node.js CommonJS, `node:test`, Express, Google Sheets API, node-telegram-bot-api, jsdom, ExcelJS, vanilla HTML/JavaScript.

## Global Constraints

- Morning begins at 07:45 and afternoon begins at 12:30 local server time.
- A submission is late only when submission time is strictly after the selected start boundary.
- Late submissions are still persisted with status `Vi phạm`.
- Sundays contribute zero sessions; Saturdays remain working days.
- A leave range containing no payable sessions is invalid.
- Sheet leave boundaries are stored as `<Buổi> dd/mm/yyyy`.
- `tong_ngay_nghi` is always `tong_buoi_nghi / 2`.
- Do not reset or mutate the live Google Sheet as part of implementation or verification.

---

### Task 1: Calendar/session domain rules

**Files:**
- Modify: `server/hr/hrLeaveService.js`
- Test: `server/telegram/hrTelegramBot.test.js`

**Interfaces:**
- Produces: `computeDurationSessions(Date, 'Sáng'|'Chiều', Date, 'Sáng'|'Chiều'): number|null`
- Produces: `getSessionStartTime(Date, 'Sáng'|'Chiều'): Date|null`
- Produces: `computeSubmissionViolation(Date|string, Date, 'Sáng'|'Chiều'): boolean`

- [ ] Add literal table tests for normal days, Sunday exclusion, Sunday-only zero, invalid order, and invalid session labels.
- [ ] Run `node --test telegram/hrTelegramBot.test.js` from `server/` and verify failures show the current day-valued implementation.
- [ ] Implement inclusive slot counting while skipping dates whose `getDay() === 0`, plus 07:45/12:30 boundary helpers.
- [ ] Re-run the focused test and confirm all domain cases pass.

### Task 2: Canonical Sheet repository and API schema

**Files:**
- Modify: `server/hr/hrLeaveRepository.js`
- Modify: `server/hr/hrLeaveRoutes.js`
- Modify: `server/hr/hrLeaveExportService.js`
- Modify: `server/scripts/setupHrSheet.js`
- Create: `server/hr/hrLeaveRepository.test.js`
- Create: `server/hr/hrLeaveRoutes.test.js`

**Interfaces:**
- Consumes: `computeDurationSessions(...)` and formatted boundary inputs from the manual route.
- Produces record keys: `thoi_gian_gui`, `thoi_gian_bat_dau`, `thoi_gian_ket_thuc`, `tong_buoi_nghi`, `tong_ngay_nghi`.
- Adds `LEAVE_STATUS.VIOLATION = 'Vi phạm'`.

- [ ] Add repository tests asserting the exact new headers/field keys, derived day count, violation status acceptance, sorting, and inclusive filtering by `thoi_gian_gui`.
- [ ] Add route tests for date/session manual input, Sunday exclusion, and invalid zero-session ranges.
- [ ] Run the focused tests and verify failures reference old `thoi_gian_nhan`/`tong_gio_nghi` behavior.
- [ ] Replace the schema and record builder, filter on submission time, and update urgent-summary date parsing for formatted leave boundaries.
- [ ] Validate/format manual route input and derive totals server-side.
- [ ] Update export widths and setup headers to the canonical schema.
- [ ] Re-run repository/route tests and confirm they pass.

### Task 3: Telegram state machine, deduplication, and violation persistence

**Files:**
- Modify: `server/telegram/hrTelegramBot.js`
- Modify: `server/telegram/hrTelegramBot.test.js`
- Modify: `server/telegram/conversationStore.test.js`

**Interfaces:**
- Consumes: domain helpers and `repo.LEAVE_STATUS.VIOLATION`.
- Produces Sheet payload using `thoi_gian_gui`, formatted start/end strings, integer `tong_buoi_nghi`, and computed status.

- [ ] Add tests that exercise real exported parsers/helpers, reject impossible calendar dates, restore both new Date fields after reload, isolate duplicate IDs by chat, and persist a confirmed late request as `Vi phạm`.
- [ ] Run focused Telegram/store tests and verify the new assertions fail for the expected missing behavior.
- [ ] Change dedup keys to `chatId:messageId`, apply them at command/message boundaries, preserve per-chat queueing, and export narrow test hooks.
- [ ] Fix date validation, Sunday-only response, summary totals, submission warning, formatted Sheet payload, callback retry semantics, and only clear the conversation after successful persistence.
- [ ] Re-run focused Telegram/store tests and confirm they pass.

### Task 4: HR web table, submission-time filter, and manual form

**Files:**
- Modify: `server/public/humanresources/index.html`
- Modify: `server/test/frontend/hr-leave-loading.test.js`

**Interfaces:**
- Consumes canonical API fields from Task 2.
- Sends manual payload fields `start_date`, `start_session`, `end_date`, `end_session`.

- [ ] Add jsdom assertions for a `Thời gian gửi` column, session/day cells, `Vi phạm` badge/no actions, filter query construction, and date/session manual controls.
- [ ] Run `node --test test/frontend/hr-leave-loading.test.js` and verify it fails against the hour-based markup.
- [ ] Update table headers, colspans, status options/classes, rendering, sorting, and filter label.
- [ ] Replace manual datetime inputs with date/session controls and send the new payload.
- [ ] Keep charts based on leave start dates by parsing the `Buổi dd/mm/yyyy` format, while list filters remain based on submission time.
- [ ] Re-run frontend tests and confirm they pass.

### Task 5: Documentation synchronization and full verification

**Files:**
- Modify: `README.md`
- Modify: `server/README.md`
- Modify: `docs/02-srs/SRS_Dashboard_GoogleSheets.md`
- Modify: `docs/04-planning/implementation_plan.md`

**Interfaces:**
- Documents the canonical schema, filter meaning, Sunday rule, and violation behavior.

- [ ] Update project documentation without overwriting unrelated working-tree edits.
- [ ] Run `npm test` from `server/` and fix only regressions caused by this feature.
- [ ] Run `git diff --check` and inspect the scoped diff for old hour-schema references.
- [ ] Confirm no live Sheet setup/reset command was run.
