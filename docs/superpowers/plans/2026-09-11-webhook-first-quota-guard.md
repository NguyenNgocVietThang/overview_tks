# Webhook-first + Quota Guard Implementation Plan

> Companion to `docs/superpowers/specs/2026-09-11-webhook-first-quota-guard-design.md`.
> Tasks 0-6 were implemented and tested in this session (`npm test` in `server/`
> is green except one pre-existing, unrelated failure in
> `test/frontend/hr-leave-loading.test.js` that also fails on unmodified `main`).
> Task 7 (deploy) was intentionally NOT executed — see Global Constraints.

**Goal:** Reduce daily UrlFetch usage on both KiotHN and KiotSG (which share
one Google account's 20,000/day quota), decouple webhook processing from
maintenance work, and add a circuit breaker so a quota exhaustion event
degrades gracefully instead of stalling the whole sync until the next day.

**Tech Stack:** Google Apps Script V8, KiotViet REST API, Google Sheets,
Node.js built-in test runner, clasp.

## Global Constraints

- No `clasp push` and no calling any `setup*Trigger()` /
  `stopAllKiotVietTriggers()` against the live HN or SG projects during this
  session — code + tests only, pending human review.
- Preserve all existing live-sheet schemas and public handler names.
- Never advance an incremental checkpoint after a failed fetch or write.
- Invoice hydrate-skip behavior (`hydrateIncompleteInvoiceWebhookItems_`)
  stays untouched — it's already confirmed correct against real traffic.
- New hydrate-skip behavior for products/orders/customers/categories must
  default to OFF (`KIOTVIET_HYDRATE_SKIP_ENTITIES` empty) so no behavior
  changes until an operator explicitly opts in per entity.

## Status

- [x] Task 0 — Regression test: full backfill stays manual-only.
- [x] Task 1 — `QuotaGuard.gs`: usage counter, budget check, real-error
      detection, trip/backoff escalation, pause check.
- [x] Task 2a — Wrap single-call UrlFetch sites (`fetchKiotVietJsonWithRetry_`,
      `getKiotVietToken`, `fetchCustomerReportJsonWithRetry_`).
- [x] Task 2b — Wrap batch/admin UrlFetch sites (`hydrateKiotVietItems_`,
      `reconcileKiotVietAutoSyncWebhooks_`, `forwardInvoiceWebhookToShipment_`).
- [x] Task 3 — New `MaintenanceSchedule.gs` (`runKiotVietMaintenanceTick_`,
      15-minute trigger); stripped maintenance block out of
      `processWebhookQueue()`; wired into `setupKiotVietAutoSync()`.
- [x] Task 4 — Quota-pause defers hydrate-needing webhook items with
      `skipAttemptPenalty` instead of counting them as failed attempts.
- [x] Task 5 — Reduced polling/health-check trigger frequencies
      (invoices/purchases → 60 min, returns/suppliers → 4h, webhook health → 6h).
- [x] Task 6 — Generic `hydrateIncompleteWebhookItems_` + per-entity flag
      `KIOTVIET_HYDRATE_SKIP_ENTITIES`, default off.
- [x] Task 7 (docs) — README.md, `HuongDanSuDung.gs`, this spec/plan pair
      updated; cross-account duplicate-trigger runbook added to README.md.
- [ ] Task 8 (deploy, out of scope for this session) — see "Next steps".

## Files touched

- New: `src-dashboard/kiotviet/QuotaGuard.gs`
- New: `src-dashboard/sync/MaintenanceSchedule.gs`
- New: `server/test/apps-script-quota-guard.test.js`
- Modified: `src-dashboard/kiotviet/SheetSchemas.gs`, `Auth.gs`,
  `CustomerReport.gs`, `WebhookAdmin.gs`, `SyncInitial.gs`
- Modified: `src-dashboard/sync/WebhookQueue.gs`, `UpdateHandlers.gs`
- Modified: `server/test/apps-script-sync.test.js`
- Modified: `README.md`, `src-dashboard/HuongDanSuDung.gs`

## Verification performed

- `cd server && npm test` — 768 tests, 767 pass; the one failure
  (`test/frontend/hr-leave-loading.test.js`) is a pre-existing wall-clock-
  dependent date assertion unrelated to this work, confirmed failing
  identically on unmodified `main` via `git stash`.
- Manually traced `processWebhookQueue()` diff to confirm it no longer
  references `syncCustomerReportIfDue_`/`syncCustomerDebtReportsIfDue_`/
  `migrateKiotVietSheetsIfNeeded_`.
- Manually traced that `KIOTVIET_HYDRATE_SKIP_ENTITIES` defaults to empty in
  every test and in the source (`isKiotVietHydrateSkipEnabled_` returns
  `false` when the property is unset).

## Next steps (after human review/approval — not done in this session)

1. `clasp push` for both `.clasp.json` (KiotHN) and `.clasp.saigon.json` (KiotSG).
2. Manually clean up SG's duplicate cross-account triggers per the runbook in
   `README.md` ("Trigger trùng khi nhiều tài khoản từng cài đặt project") —
   this requires logging into each Google account that ever ran
   `setupKiotVietAutoSync()` on that project and removing its triggers via the
   Apps Script Editor's "Triggers" page (not via code — the API can't see
   another account's triggers).
3. Run `setupKiotVietAutoSync()` on each project once cleanup is confirmed,
   to install the new trigger set (1-min queue, 15-min maintenance, 60-min
   invoice/purchase polling, 4-hour returns/suppliers polling, 6-hour webhook
   health check).
4. Monitor `KIOTVIET_URLFETCH_COUNT_<yyyyMMdd>` and
   `KIOTVIET_QUOTA_PAUSE_UNTIL` Script Properties on both projects for the
   first few days to validate the default 8000/day budget is reasonable for
   each project's actual share of traffic; adjust
   `KIOTVIET_URLFETCH_DAILY_BUDGET` if needed (no redeploy required).
5. Before enabling `KIOTVIET_HYDRATE_SKIP_ENTITIES` for any of
   products/orders/customers/categories in production, inspect a sample of
   real webhook payloads in `_KV_WEBHOOK_QUEUE` for that entity to confirm the
   completeness heuristic in `UpdateHandlers.gs`
   (`isComplete*WebhookItem_`) matches what KiotViet actually sends.
