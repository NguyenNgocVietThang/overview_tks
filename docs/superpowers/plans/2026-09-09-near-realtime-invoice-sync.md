# Near-Realtime Invoice Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep invoice and invoice-detail sheets within roughly five minutes of KiotViet while avoiding the UrlFetch quota exhaustion caused by repeated full backfills and duplicate detail hydration.

**Architecture:** Treat complete invoice webhook payloads as the primary data path and hydrate only incomplete payloads. Add checkpointed `lastModifiedFrom` reconciliation for invoices and the polling-only tables, protected by script-wide leases so triggers owned by different users do not repeat the same fetch window. Leave historical backfill available as an explicit maintenance operation, but remove it from automatic recovery and queue ticks.

**Tech Stack:** Google Apps Script V8, KiotViet REST API, Google Sheets, Node.js built-in test runner, clasp.

## Global Constraints

- Preserve all existing live-sheet schemas and public handler names.
- Never advance an incremental checkpoint after a failed fetch or write.
- Use `ScriptLock`/Script Properties for coordination across trigger owners.
- Do not modify unrelated dirty worktree files.
- Push the same `src-dashboard` build to both configured Apps Script projects.

---

### Task 1: Webhook fast path and cross-owner locking

**Files:**
- Modify: `server/test/apps-script-sync.test.js`
- Modify: `src-dashboard/sync/UpdateHandlers.gs`
- Modify: `src-dashboard/utils/Helpers.gs`

**Interfaces:**
- Consumes: `updateInvoicesFromWebhook(items)`, `hydrateKiotVietItems_(items, schema)`.
- Produces: `hydrateIncompleteInvoiceWebhookItems_(items, schema)` and script-wide invoice/data locks.

- [ ] **Step 1: Write failing tests**

Add tests proving a payload with `code` and an `InvoiceDetails` array is written without requesting a token, while incomplete invoices alone are passed to hydration and merged back into input order. Add a lock test proving the fallback is `getScriptLock()` rather than `getUserLock()`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test --test-name-pattern="complete invoice webhook|incomplete invoice webhook|script-wide lock" server/test/apps-script-sync.test.js`

Expected: FAIL because complete payloads still invoke `hydrateKiotVietItems_` and invoice locking is user-scoped.

- [ ] **Step 3: Implement the minimal webhook fast path**

Classify an invoice as complete only when it has a non-empty `code` and an array-valued `InvoiceDetails`. Hydrate the remaining records, then restore the original order before calling the existing invoice, detail, and customer-report writers. Change data and invoice locks to use document lock when available and script lock otherwise.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the command from Step 2 and confirm every selected test passes.

### Task 2: Checkpointed incremental reconciliation

**Files:**
- Modify: `server/test/apps-script-sync.test.js`
- Modify: `src-dashboard/kiotviet/SyncInitial.gs`

**Interfaces:**
- Produces: `syncRecentInvoices_(now)`, `syncRecentPurchases_(now)`, `syncPollingOnly_(now)`, and a shared incremental-table helper.
- State: script properties storing the last successful checkpoint and the most recent start lease for each table.

- [ ] **Step 1: Write failing reconciliation tests**

Cover: an initial 48-hour invoice window; a ten-minute overlap on later runs; `lastModifiedFrom` query construction; checkpoint advancement only after successful writes; a four-minute cross-owner throttle; and incremental updates for returns, suppliers, and purchases without `syncKiotVietTableChunk_`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test --test-name-pattern="incremental invoice|incremental polling|checkpoint|cross-owner throttle" server/test/apps-script-sync.test.js`

Expected: FAIL because the invoice reconciler and checkpoint state do not exist and polling still performs historical chunks.

- [ ] **Step 3: Implement the shared incremental helper**

Under a script-wide lock, reject runs started within four minutes of the prior start. Compute the start boundary from `(checkpoint - 10 minutes)` or `(now - 48 hours)`, fetch all pages using `lastModifiedFrom`, dispatch to the table-specific writer, and save the run-start timestamp only after a successful write.

- [ ] **Step 4: Replace automatic historical polling**

Make `syncPollingOnly_` reconcile returns and suppliers incrementally, keep purchases incremental, and add `syncRecentInvoices_`. Remove legacy polling resume-state restoration while retaining explicit full-sync functions for maintenance.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the command from Step 2 and confirm every selected test passes.

### Task 3: Trigger and recovery policy

**Files:**
- Modify: `server/test/apps-script-sync.test.js`
- Modify: `src-dashboard/kiotviet/SyncInitial.gs`
- Modify: `src-dashboard/kiotviet/WebhookAdmin.gs`
- Modify: `src-dashboard/sync/WebhookQueue.gs`

**Interfaces:**
- Consumes: the incremental functions from Task 2.
- Produces: idempotent current-owner schedules: invoices every five minutes, purchases every five minutes, returns/suppliers every fifteen minutes, and webhook health hourly.

- [ ] **Step 1: Update tests to the new recovery contract**

Assert that polling setup installs/removes all three incremental handlers, queue processing no longer resurrects invoice backfill, and webhook recovery no longer creates daily or one-shot full invoice backfills.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test --test-name-pattern="polling trigger|queue tick|recovery trigger|full backfill" server/test/apps-script-sync.test.js`

Expected: FAIL against the old automatic-backfill behavior.

- [ ] **Step 3: Implement trigger changes**

Schedule `syncRecentInvoices_` every five minutes, preserve the incremental purchase and polling schedules, remove all matching current-owner handlers before creation, and clear obsolete polling resume state. Make `reconcileInvoicesDaily_` call incremental reconciliation for compatibility, and remove its daily/one-shot creation from recovery setup.

- [ ] **Step 4: Stop stale automatic backfill resumption**

Remove `ensureInvoicesBackfillResumeTrigger_()` from the queue tick. Keep explicit historical backfill callable manually, and ensure a completed historical publish clears the invoice incremental checkpoint so the next reconciliation overlaps current changes.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the command from Step 2 and confirm every selected test passes.

### Task 4: Documentation and complete verification

**Files:**
- Modify: `README.md`
- Modify: `docs/SRS.md` if the sync architecture is documented there
- Modify: `implementation_plan.md` if operational sync behavior is documented there
- Test: `server/test/apps-script-sync.test.js`
- Test: `server/test/apps-script-report-schedule.test.js`

**Interfaces:**
- Produces: operator-facing documentation that identifies webhook-first sync, incremental safety net, checkpoints, and manual-only backfill.

- [ ] **Step 1: Update relevant documentation**

Describe the new schedules, fallback windows, quota rationale, and the fact that installable triggers belonging to another Google account must be removed by that owner if they are no longer needed.

- [ ] **Step 2: Run Apps Script tests**

Run: `node --test server/test/apps-script-sync.test.js server/test/apps-script-report-schedule.test.js`

Expected: PASS with zero failures.

- [ ] **Step 3: Inspect the diff and repository status**

Run: `git diff --check`, `git diff -- src-dashboard server/test/apps-script-sync.test.js README.md docs/SRS.md implementation_plan.md`, and `git status --short`. Confirm no unrelated dirty files are included.

### Task 5: Deploy both Apps Script projects

**Files:**
- Read: `.clasp.json`
- Read: `.clasp.saigon.json`
- Deploy: `src-dashboard/**`

**Interfaces:**
- HN script ID: `1obGtNLSrjEXJ0c5u1zYfZk4yTRIT28vR22q-8AD0lHAZDROqx74oUkwN`.
- SG script ID: `1VdxaNoiqzFwM4ZsVp3sY7SWjvarMq6xqhSp_U12iPRqa8-auuMh_bvOm`.

- [ ] **Step 1: Confirm clasp CLI syntax and upload set**

Run `clasp --help` and `clasp status` with each project configuration. Confirm only the intended `src-dashboard` files are included.

- [ ] **Step 2: Push HN**

Run clasp push using `.clasp.json` and require a successful upload response.

- [ ] **Step 3: Push SG**

Run clasp push using `.clasp.saigon.json` and require a successful upload response.

- [ ] **Step 4: Verify both remote projects**

Run a read-only clasp status/version check for each project and confirm both point to the expected script IDs with no local source omitted.
