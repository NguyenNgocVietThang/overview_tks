# Graph Report - Web TKS Dashboard  (2026-09-19)

## Corpus Check
- 279 files · ~400,402 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3270 nodes · 6773 edges · 202 communities (172 shown, 21 thin omitted)
- Extraction: 88% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 786 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `0872ffee`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- chart.umd.min.js
- computeDashboardData
- authRoutes.js
- a
- s
- va
- setupOrderLifecycleHistorySheet.js
- ns
- e
- hrLeaveRepository.js
- dashboardData.js
- Phân hệ Quản lý Nghỉ phép HR & Telegram Bot
- o
- localUserStore.js
- roleChangeRequestRepository.js
- routes.js
- notificationRepository.js
- an
- Spec: Bot Telegram nhận dạng tin nhắn xin nghỉ bằng AI
- no
- Roadmap Supabase KiotViet Sync
- o
- n
- entityTestUtils.js
- debtManagement.js
- normalizeText
- authMiddleware.js
- branches.js
- d
- zt
- fullSync.integration.test.js
- hrLeaveRoutes.js
- stockout90dScanService.js
- html2pdf.bundle.min.js
- employeeDirectory.js
- dashboardPgReader.js
- sheetsClient.js
- e
- t
- kiotvietWebhookRoutes.js
- cashFlows.js
- syncDriver.js
- authService.js
- stockout90dScanService.test.js
- backfill.js
- stockoutEventLoader.js
- syncDriverSpecialCases.test.js
- Qe
- customerProductTopRepository.js
- dashboardRollupRepository.js
- debtCollectionStatusRepository.js
- orderLifecycleRoutes.test.js
- kiotvietSyncStatusRoutes.js
- hrSheetsClient.js
- employeeRegistrationService.js
- effectiveUserResolver.js
- tn
- checkpointRepository.js
- server/config.js
- hrLeaveService.js
- shared-nav.js
- getPool
- Thiết kế: Tìm kiếm từng bảng và điều hướng từ biểu đồ
- orderLifecycleService.js
- contactChangeService.js
- hrLeaveExportService.js
- authRoutes.test.js
- buildCalendar
- searchDashboardRecords
- orderLifecycleRoutes.js
- adminUserRoutes.js
- roleChangeRequestRoutes.test.js
- debtManagementRoutes.js
- Skill: Update File — Đồng bộ file khi cấu trúc thư mục thay đổi
- Quản lý công nợ Implementation Plan
- otpService.js
- migrate.integration.test.js
- userRepository.js
- adminUserRoutes.test.js
- sheetTimelineBuilder.js
- reconcileCounts.js
- scheduler.js
- E
- orderLifecycleRepository.js
- package.json
- exportService.test.js
- productLoader.js
- index.js
- handleSubmitRoleRequest
- applyBulkFilters
- BRANCHES
- jn
- dashboardRollupRefresh.js
- invoices.js
- customerDebtActivityRepository.js
- server/branch/branchMiddleware.js (đa cơ sở HN/SG)
- createKiotVietClient
- preflightCheck.js
- scripts
- getCachedDashboardSheets
- webhookEventQueue.js
- recentStockoutScanService.test.js
- dependencies
- table-explorer.js
- debt-management-ui.test.js
- customerDebtReportRefresh.js
- Migrations 0001-0006 (16 tables)
- exportService.js
- recentStockoutScanService.js
- stockoutCheckRoutes.js
- styleBaselineSnapshot.js
- Webhook-first + incremental reconciliation (phương án chọn)
- emailSender.js
- stockoutCheckRoutes.test.js
- backfillProgressRepository.js
- no-3d-effects.test.js
- order-lifecycle-sort.test.js
- audit-sheet-columns.js
- sort-icons.test.js
- main
- renderTable
- Giảm lag TKS Dashboard Implementation Plan
- buildBackfillPlan
- orderLifecycleHistoryClient.js
- branch-switcher.test.js
- createFakeAppUsersRepository
- stockoutEventLoader.test.js
- rs
- orderLifecycleSheetsClient.js
- hr-leave-loading.test.js
- hr-leave-realtime-status.test.js
- notif-bell.test.js
- role-request-ui.test.js
- CHÍNH SÁCH NGHỈ PHÉP (CSNS-NP-01)
- concurrencyPool.test.js
- createTtlSnapshotCache
- auth-guest-ui.test.js
- jsdom
- initShootingStar
- t
- export-ui.test.js
- render-column-audit-report.js
- table-search-ui.test.js
- Kế hoạch triển khai HR Sheet identity
- pool.test.js
- pagination.test.js
- showForgotStep
- orderLifecycleRepository.test.js
- Global Constraints
- stockout-periods-column.test.js
- Register (Khách) Page (/register/)
- Design System Master File — TKS Dashboard
- GET /api/dashboard
- google-auth-library
- handleGoogleCredential
- tokenizeHardcodedStyles.js
- Dashboard Result Cache Implementation Plan
- Ưu tiên API KiotViet, dự phòng Google Sheets theo từng nguồn
- Quy ước branch (hanoi/saigon) là định danh nội bộ
- Circuit breaker backoff leo thang 1h→2h→3h theo ngày
- roleChangeRequestRepository.test.js
- setupHrSheet.js
- 2. Chi tiết chức năng & Quy tắc vận hành
- Báo cáo kiểm kê trước khi xóa cột (KIOT TOKOSI)
- Định hướng mở rộng dài hạn (Giai đoạn 2-8)
- Biến môi trường triển khai Render/Firebase
- backfillRangeParam.test.js
- backfill_progress độc lập hoàn toàn với sync_checkpoints
- createFakeHrEmployeesRepository
- returns.test.js
- Page Design Notes — `index.html` (Dashboard Chính)
- TOKOSI Logo
- cash_flows không có modified_date — dùng cửa sổ startDate/endDate
- line_no là vị trí mảng, không phải ID KiotViet — xóa & chèn lại dòng con
- staff suy luận từ SoldById/CreatedById, quyết định không dùng GET /users ở Phase 1
- TOKOSI logo (red house/store icon with shopping cart, serif wordmark 'TOKOSI')
- bg-dark.jpg (night sky background image)
- bg-light.jpg - light-theme background image: serene dusk/sunrise landscape with a large glowing sun, a streaking meteor/shooting star, layered clouds, silhouetted mountain ridges, and a scattering of small warm lights in the valley; pastel blue-to-orange gradient sky used as a full-bleed hero/backdrop asset for the light UI theme, semantically paired with a dark-theme counterpart (bg-dark.jpg, not present in this chunk)
- sheetsClient.test.js
- Page Design Notes — `404.html`
- Page Design Notes — `account/index.html` (Tài Khoản & Quản Trị Người Dùng)
- Page Design Notes — `humanresources/index.html` (Nhân Sự / Nghỉ Phép)
- Page Design Notes — `login/index.html`
- Page Design Notes — `register/index.html`
- Page Design Notes — `shipment/index.html` (Tra Cứu Vòng Đời Đơn Hàng)
- res
- userRepository.test.js
- applyTableSearchToWorksheets
- debtMigration.test.js
- res
- res
- cashFlows.test.js
- categories.test.js

## God Nodes (most connected - your core abstractions)
1. `e()` - 143 edges
2. `h()` - 116 edges
3. `an()` - 61 edges
4. `ns()` - 55 edges
5. `Qe()` - 49 edges
6. `t()` - 43 edges
7. `s()` - 42 edges
8. `o()` - 40 edges
9. `o()` - 39 edges
10. `a()` - 38 edges

## Surprising Connections (you probably didn't know these)
- `Đồng bộ KiotViet -> Supabase (server/README.md §2.9)` --conceptually_related_to--> `QuotaGuard (src-dashboard/kiotviet/QuotaGuard.gs)`  [INFERRED]
  server/README.md → docs/superpowers/specs/2026-09-11-webhook-first-quota-guard-design.md
- `Đồng bộ KiotViet -> Supabase (server/README.md §2.9)` --conceptually_related_to--> `Webhook-first + incremental reconciliation (phương án chọn)`  [INFERRED]
  server/README.md → docs/superpowers/specs/2026-09-09-near-realtime-invoice-sync-design.md
- `Quy tắc chuẩn hóa dữ liệu API (hóa đơn/nhập hàng/trả hàng)` --conceptually_related_to--> `lastModifiedFrom là tham số incremental chuẩn (đã live-probe xác minh)`  [INFERRED]
  docs/superpowers/specs/2026-09-07-stockout-kiotviet-api-sources-design.md → server/kiotviet/API_ENDPOINTS.md
- `Implementation Plan v2.3` --references--> `server/hr/ (HR Leave Management)`  [EXTRACTED]
  docs/04-planning/implementation_plan.md → README.md
- `Implementation Plan v2.3` --references--> `server/dashboard/stockoutCheck/ (kiểm tra đứt hàng)`  [EXTRACTED]
  docs/04-planning/implementation_plan.md → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Apps Script sync resilience: Quota Guard, Maintenance Schedule, hydrate-skip flag, trigger dedup runbook** — webhook_first_quota_guard_plan_quotaguard_gs, webhook_first_quota_guard_plan_maintenanceschedule_gs, readme_hydrate_skip_flag, readme_trigger_duplication_runbook [EXTRACTED 1.00]
- **Table Pagination Pattern Reused Across Dashboard Optimization Plans** — docs_superpowers_plans_2026_08_13_dashboard_table_pagination, docs_superpowers_plans_2026_08_13_dashboard_table_pagination_tablepagesize, docs_superpowers_plans_2026_08_19_tks_lag_optimization_tablepagesize100 [EXTRACTED 1.00]
- **Pattern subnav tab dùng chung giữa các trang Dashboard** — server_public_account_index_switchaccounttab, server_public_humanresources_index_switchhrsubtab, server_public_shipment_lifecycle_index_switchlcsubtab [EXTRACTED 1.00]
- **Pattern status-select pill + toast dùng chung (Nghỉ phép & Vòng đời đơn hàng)** — server_public_humanresources_index_handlestatusselectchange, server_public_humanresources_index_showtoast, server_public_shipment_lifecycle_index_handlelifecyclestatuschange, server_public_shipment_lifecycle_index_showtoast [EXTRACTED 1.00]
- **CustomerDebtReport.gs as Shared Source for Debt/Payment Reporting** — docs_superpowers_specs_2026_08_05_debt_dashboard_design_customerdebtreportgs, docs_superpowers_specs_2026_09_04_invoice_payments_return_line_items_customerdebtreportgs, docs_superpowers_specs_2026_08_20_stagger_customer_report_triggers_design_hn1hn3hn7 [INFERRED 0.85]
- **HR Telegram Leave Bot Feature Evolution** — docs_superpowers_plans_2026_08_21_hr_leave_days_input, docs_superpowers_plans_2026_08_22_hr_leave_sessions_submission_filter, docs_superpowers_specs_2026_08_22_hr_leave_sessions_and_submission_time_design, docs_superpowers_plans_2026_08_22_gemini_one_message_leave_request, docs_superpowers_specs_2026_08_31_telegram_ai_leave_message_recognition, docs_superpowers_specs_2026_08_31_xkiro_free_model_consensus_design, docs_superpowers_plans_2026_08_31_xkiro_five_model_consensus [INFERRED 0.85]
- **Tiến hóa thiết kế đồng bộ KiotViet (stockout API sources → invoice sync → quota guard)** — docs_superpowers_specs_2026_09_07_stockout_kiotviet_api_sources_design_api_first_fallback_strategy, docs_superpowers_specs_2026_09_09_near_realtime_invoice_sync_design_webhook_first_incremental_reconciliation, docs_superpowers_specs_2026_09_11_webhook_first_quota_guard_design_quotaguard [INFERRED 0.85]
- **Supabase KiotViet sync pipeline: schema, driver, scheduler, checkpoint, backfill** — phase1_plan_supabase_kiotviet_sync_migrations_0001_0006, server_kiotvietsync_syncdriver, server_kiotvietsync_scheduler, server_kiotvietsync_checkpointrepository, server_kiotvietsync_backfill, phase3_plan_supabase_kiotviet_sync_backfill_progress_table [INFERRED 0.90]

## Communities (202 total, 21 thin omitted)

### Community 0 - "chart.umd.min.js"
Cohesion: 0.03
Nodes (56): ai(), beforeDatasetDraw(), beforeDatasetsDraw(), beforeDraw(), _calculateBarIndexPixels(), cn(), da(), destroy() (+48 more)

### Community 1 - "computeDashboardData"
Cohesion: 0.18
Nodes (26): aggregateCustomerReportRevenueByCode(), aggregateCustomerRevenueFromSheetRows(), attachCustomerRevenue(), buildRevenuePeriod(), buildRevenuePeriodFromRollup(), buildTopCustomersByRevenue(), buildTransactionsReport(), computeCustomerProductRevenue() (+18 more)

### Community 2 - "authRoutes.js"
Cohesion: 0.06
Nodes (32): { allowedBranches }, { AUTH_COOKIE_NAME, AUTH_COOKIE_MAX_AGE_MS, requireAuth }, checkAndBumpRateLimit(), CONFIG, contactChangeService, cookieOptions(), { createActiveGuest, activatePendingGuest, updateUserFields }, crypto (+24 more)

### Community 3 - "a"
Cohesion: 0.07
Nodes (30): a(), ao(), average(), dataset(), determineDataLimits(), draw(), getCenterPoint(), Hs (+22 more)

### Community 4 - "s"
Cohesion: 0.07
Nodes (12): bo, _calculateBarValuePixels(), et(), getValueForPixel(), H(), s(), j(), label() (+4 more)

### Community 5 - "va"
Cohesion: 0.08
Nodes (21): Ae(), afterDraw(), afterEvent(), Ee(), f(), gs(), ki(), Le() (+13 more)

### Community 6 - "setupOrderLifecycleHistorySheet.js"
Cohesion: 0.32
Nodes (7): googleapis, columnIndexToLetter(), CONFIG, getSheetsApi(), { google }, HEADERS, main()

### Community 7 - "ns"
Cohesion: 0.07
Nodes (11): at(), beforeUpdate(), getBasePixel(), initialize(), labelColor(), labelPointStyle(), ns(), rt() (+3 more)

### Community 8 - "e"
Cohesion: 0.10
Nodes (50): Be(), e(), at(), br(), bt(), cr(), ct(), dr() (+42 more)

### Community 9 - "hrLeaveRepository.js"
Cohesion: 0.10
Nodes (40): CONFIG, consumeLinkCode(), createLeaveRequest(), createLinkCode(), deleteTelegramSession(), ensureTelegramSessionSheet(), escapeUserEnteredFormula(), extractIsoDateFromBoundary() (+32 more)

### Community 10 - "dashboardData.js"
Cohesion: 0.07
Nodes (43): branchLabelToCode(), { BRANCHES }, { branchLabelToCode }, buildParentCategoryResolver(), CONFIG, customerDebtActivityRepository, customerProductTopRepository, dashboardCoreSheetsCacheByBranch (+35 more)

### Community 12 - "o"
Cohesion: 0.09
Nodes (23): aa(), As(), buildTicks(), Fn(), getMaxOverflow(), Gn(), go(), ha (+15 more)

### Community 13 - "localUserStore.js"
Cohesion: 0.11
Nodes (32): appUsersRepository, bcrypt, cache, { createTtlSnapshotCache }, createUser(), crypto, deleteUser(), ensureHardcodedAdminsInDb() (+24 more)

### Community 14 - "roleChangeRequestRepository.js"
Cohesion: 0.18
Nodes (17): createRequest(), crypto, DATA_DIR, DEFAULT_STORE_PATH, ensureDataDir(), ensureLoaded(), fs, getRequestById() (+9 more)

### Community 15 - "routes.js"
Cohesion: 0.08
Nodes (21): adminUserRoutes, authRoutes, { branchLabelToCode }, branchRoutes, debtManagementRoutes, express, {
  getDashboardData,
  searchDashboardRecords,
  searchTopCustomersByProducts,
  getCustomerProductRevenueReport,
  searchProductRevenueOverview,
  getProductRevenueDetail
}, { getExportFields, createExportWorkbook } (+13 more)

### Community 16 - "notificationRepository.js"
Cohesion: 0.07
Nodes (36): createNotification(), createNotificationForUsers(), crypto, DATA_DIR, DEFAULT_STORE_PATH, deleteAllForUser(), deleteNotification(), ensureDataDir() (+28 more)

### Community 17 - "an"
Cohesion: 0.05
Nodes (26): addBox(), addElements(), afterDatasetsUpdate(), an(), configure(), ct(), dt(), fs() (+18 more)

### Community 18 - "Spec: Bot Telegram nhận dạng tin nhắn xin nghỉ bằng AI"
Cohesion: 0.10
Nodes (27): HR Leave Days Input Implementation Plan, hrLeaveInput.js: parseLeaveStart/parseLeaveDays/formatVietnameseDateTime, hrLeaveRepository.js LEAVE_SCHEMA (20 fields, end-time/hours removed), tong_ngay_nghi (0.5-day-granularity leave duration field), Gemini One-Message Leave Request Implementation Plan, geminiLeaveExtractor.js extractLeaveMessage(), leaveMessageResolver.js resolveLeaveMessage(), tin_nhan Sheet field appended for original leave message (+19 more)

### Community 19 - "no"
Cohesion: 0.06
Nodes (15): b(), beforeLayout(), buildLookupTable(), En, Fo(), _generate(), getDecimalForValue(), _getTimestampsForTable() (+7 more)

### Community 20 - "Roadmap Supabase KiotViet Sync"
Cohesion: 0.07
Nodes (38): BRD Dashboard GoogleSheets v1.9, SRS Dashboard GoogleSheets v2.2/2.3, FR-06: Apps Script Đồng bộ KiotViet tự động, BPMN Dashboard GoogleSheets v2.0, Luồng A: Đồng bộ KiotViet -> Google Sheets, Implementation Plan v2.3, Near-Realtime Invoice Sync Implementation Plan, Checkpointed incremental reconciliation (lastModifiedFrom) (+30 more)

### Community 21 - "o"
Cohesion: 0.16
Nodes (34): a(), C(), a(), ae(), c(), ht(), i(), k() (+26 more)

### Community 22 - "n"
Cohesion: 0.09
Nodes (11): Bi(), ca(), Ci(), Do(), eo(), Fi(), g(), getLabelAndValue() (+3 more)

### Community 23 - "entityTestUtils.js"
Cohesion: 0.10
Nodes (20): { assertSimpleEntity }, entity, test, assert, assertChildReplacement(), assertSimpleEntity(), fakeClient(), { assertChildReplacement } (+12 more)

### Community 24 - "debtManagement.js"
Cohesion: 0.14
Nodes (28): ALERT_CODES, amountOrZero(), buildColumnIndex(), buildOperationalNameSet(), buildStatusMap(), buildSummary(), createAlertSignature(), crypto (+20 more)

### Community 25 - "normalizeText"
Cohesion: 0.19
Nodes (22): aggregateWorksheet(), branchFilePrefix(), buildCustomerProductRevenueDataset(), buildExportDataset(), buildProductRevenueSearchDataset(), buildRecentStockoutResultDataset(), buildSearchDataset(), buildStockout90dResultDataset() (+14 more)

### Community 26 - "authMiddleware.js"
Cohesion: 0.07
Nodes (26): express, createRequireAuth(), effectiveUserResolver, localUserStore, readTokenFromRequest(), requireAuth, requireRole(), assert (+18 more)

### Community 27 - "branches.js"
Cohesion: 0.12
Nodes (25): allowedBranches(), BRANCH_CODE_TO_LABEL, BRANCH_LABEL_TO_CODE, BRANCH_VALUES, defaultBranch(), isBranchAllowed(), LEGACY_ALIASES, assert (+17 more)

### Community 28 - "d"
Cohesion: 0.10
Nodes (4): afterUpdate(), ba, d(), Di()

### Community 29 - "zt"
Cohesion: 0.06
Nodes (14): Bt(), ce(), color(), de, Ft(), Gt(), he(), It() (+6 more)

### Community 30 - "fullSync.integration.test.js"
Cohesion: 0.09
Nodes (14): DEFAULT_MIGRATIONS_DIR, fs, { getPool }, path, runMigrations(), assert, fs, os (+6 more)

### Community 31 - "hrLeaveRoutes.js"
Cohesion: 0.08
Nodes (24): { BRANCHES }, broadcastLeaveEvent(), { EventEmitter }, LEAVE_EVENT_TYPES, leaveEvents, authInternal, authManager, { buildEmployeeDirectoryWorkbook } (+16 more)

### Community 32 - "stockout90dScanService.js"
Cohesion: 0.13
Nodes (25): runRecentStockoutScanJob(), {
  analyzeStockoutTimeline,
  computeStockoutWindow,
  maxDateKey,
  hasUnreliableZeroOnHand,
  STOCKOUT_DATA_FLOOR_DATE_KEY
}, { loadActiveCandidates: defaultLoadActiveCandidates }, { loadStockoutEvents: defaultLoadStockoutEvents }, runStockout90dScanJob(), { todayVnDateKey }, addDaysToDateKey(), clipPeriod() (+17 more)

### Community 33 - "html2pdf.bundle.min.js"
Cohesion: 0.07
Nodes (19): Ye(), Cr(), De(), fe(), he(), ze(), Er(), Ge() (+11 more)

### Community 34 - "employeeDirectory.js"
Cohesion: 0.11
Nodes (30): linkVerifiedGoogleIdentity(), ROLES, branchCodeToLabel(), { BRANCH_BOTH, branchCodeToLabel }, createEmployeeDirectory(), clearCache(), fetchSnapshot(), getSnapshot() (+22 more)

### Community 35 - "dashboardPgReader.js"
Cohesion: 0.08
Nodes (20): { BRANCHES, branchLabelToCode }, CONFIG, CORE_EXCLUDED_SHEET_NAMES, CORE_SHEET_NAMES, CORE_TABS, createDashboardPgReader(), readCoreDashboardSheets(), readDashboardSheets() (+12 more)

### Community 36 - "sheetsClient.js"
Cohesion: 0.21
Nodes (13): { BRANCHES }, branchNotConfigured(), CONFIG, createClient(), getMultipleSheetValues(), getValues(), listSheetTitles(), requireSpreadsheetId() (+5 more)

### Community 37 - "e"
Cohesion: 0.08
Nodes (17): bn(), dn(), e(), ei(), gi(), ia(), je(), mi() (+9 more)

### Community 38 - "t"
Cohesion: 0.17
Nodes (32): B(), Ce(), b(), be(), g(), ge(), j(), lr() (+24 more)

### Community 39 - "kiotvietWebhookRoutes.js"
Cohesion: 0.12
Nodes (13): captureWebhookRawBody(), CONFIG, createKiotVietWebhookRouter(), { createWebhookEventQueue }, createWebhookJsonErrorHandler(), defaultQueue, express, router (+5 more)

### Community 40 - "cashFlows.js"
Cohesion: 0.13
Nodes (19): base, upsertPage(), { upsertStaffFromEntity }, { value, createSimpleEntity }, upsertPage(), { value, upsertRows }, { value, createSimpleEntity }, { upsertStaffFromEntity } (+11 more)

### Community 41 - "syncDriver.js"
Cohesion: 0.15
Nodes (14): required('DATABASE_URL') crash-loop risk, SUPABASE_DB_URL config (fail-soft), fullSync.integration.test.js (Supabase test project), SUPABASE_TEST_DB_URL (isolated from production), checkpointRepository, createSyncDriver(), inTransaction(), pollCashFlows() (+6 more)

### Community 42 - "authService.js"
Cohesion: 0.23
Nodes (10): jsonwebtoken, bcrypt, comparePassword(), CONFIG, hashPassword(), jwt, assert, { hashPassword, comparePassword, signToken, verifyToken } (+2 more)

### Community 43 - "stockout90dScanService.test.js"
Cohesion: 0.08
Nodes (10): createJobStore(), crypto, assert, { createJobStore }, test, assert, CONFIG, { createJobStore } (+2 more)

### Community 44 - "backfill.js"
Cohesion: 0.11
Nodes (19): backfillCashFlowsChunk(), backfillEntity(), { buildBackfillPlan }, buildRunPlan(), defaultProgressRepo, ENTITY_ORDER, loadEntityModules(), main() (+11 more)

### Community 45 - "stockoutEventLoader.js"
Cohesion: 0.17
Nodes (22): mergeEventMaps(), {
  accumulateInvoiceEvents,
  accumulatePurchaseOrderEvents,
  accumulateReturnEvents,
  isCompletedPurchaseOrder
}, CONFIG, isCompletedInvoice(), isCompletedReturn(), loadStockoutEvents(), loadApiSource(), {
  mergeEventMaps,
  buildSupplierReturnEventMapFromSheets,
  findEarliestSheetDateKey
} (+14 more)

### Community 46 - "syncDriverSpecialCases.test.js"
Cohesion: 0.15
Nodes (9): assert, cashFlowsEntity, { createCheckpointRepository }, createFakeSyncPool(), { createSyncDriver }, invoicesEntity, ordersEntity, returnsEntity (+1 more)

### Community 47 - "Qe"
Cohesion: 0.17
Nodes (23): Z(), be(), ar(), de(), ee(), ie(), mr(), ne() (+15 more)

### Community 48 - "customerProductTopRepository.js"
Cohesion: 0.13
Nodes (21): { BRANCHES, branchLabelToCode }, buildTopCustomersQuery(), createCustomerProductTopRepository(), findTopCustomersByProducts(), findTopCustomersByRevenueForProduct(), resolveBranchCode(), customerCodeSql(), customerKeySql() (+13 more)

### Community 49 - "dashboardRollupRepository.js"
Cohesion: 0.13
Nodes (21): statusLabel(), { BRANCHES, branchLabelToCode }, buildRecentPurchaseOrdersSql(), createDashboardRollupRepository(), getFirstPurchaseDates(), getInvoiceQuantitiesByCode(), getInvoiceRevenueByDay(), getProductSalesBreakdown() (+13 more)

### Community 50 - "debtCollectionStatusRepository.js"
Cohesion: 0.09
Nodes (13): createDebtCollectionStatusRepository(), { getPool }, repository, assert, { createDebtCollectionStatusRepository }, test, assert, dashboardData (+5 more)

### Community 51 - "orderLifecycleRoutes.test.js"
Cohesion: 0.09
Nodes (19): signToken(), assert, { AUTH_COOKIE_NAME }, callRoute(), effectiveUserResolver, fakeRes(), res, getRouteStack() (+11 more)

### Community 52 - "kiotvietSyncStatusRoutes.js"
Cohesion: 0.10
Nodes (17): BRANCHES, BUSINESS_TABLES, CONFIG, createKiotVietSyncStatusRouter(), express, { getPool }, loadBackfillProgress(), loadCounts() (+9 more)

### Community 53 - "hrSheetsClient.js"
Cohesion: 0.18
Nodes (21): { BRANCHES }, branchNotConfigured(), columnIndexToLetter(), CONFIG, createHrClient(), fetchHrSheetIds(), getHrSheetGeneration(), hrAppendRow() (+13 more)

### Community 54 - "employeeRegistrationService.js"
Cohesion: 0.13
Nodes (19): bcryptjs, bcrypt, createEmployeeRegistrationService(), createChallenge(), getChallenge(), sendOtp(), verifyAndRegister(), crypto (+11 more)

### Community 55 - "effectiveUserResolver.js"
Cohesion: 0.14
Nodes (18): { BRANCH_BOTH }, changedFields(), createEffectiveUserResolver(), findAccountForEmployee(), persistIfChanged(), resolveUser(), defaultResolver, EffectiveUserError (+10 more)

### Community 56 - "tn"
Cohesion: 0.08
Nodes (5): Cs, nn(), os(), sn, tn

### Community 57 - "checkpointRepository.js"
Cohesion: 0.09
Nodes (15): backfill_progress table, createCheckpointRepository(), { getPool }, assert, { createCheckpointRepository }, test, repository, assert (+7 more)

### Community 58 - "server/config.js"
Cohesion: 0.12
Nodes (13): CONFIG, assert, BASE_FILTERS, CATEGORY_HEADERS, DETAIL_HEADERS, freshDashboardData(), INVOICE_HEADERS, mockCustomerProductRevenueSheets() (+5 more)

### Community 59 - "hrLeaveService.js"
Cohesion: 0.14
Nodes (14): { BRANCHES, isBranchAllowed }, computeDurationSessions(), computeIsUrgent(), computeSubmissionViolation(), CONFIG, formatLeaveBoundary(), formatVietnameseDate(), getBangkokDateHour() (+6 more)

### Community 60 - "shared-nav.js"
Cohesion: 0.16
Nodes (18): buildProfileModal(), close(), onKeydown(), showError(), showSuccess(), closeDropdown(), escapeHtml(), formatNotifDate() (+10 more)

### Community 61 - "getPool"
Cohesion: 0.13
Nodes (27): attachBranch(), { BRANCHES, BRANCH_BOTH, normalizeCoSo, branchCodeToLabel }, CO_SO_FROM_DB, CO_SO_TO_DB, coSoFromDb(), coSoToDb(), { getPool }, insertUser() (+19 more)

### Community 62 - "Thiết kế: Tìm kiếm từng bảng và điều hướng từ biểu đồ"
Cohesion: 0.10
Nodes (19): Backend/export và hồi quy, Bối cảnh, Frontend/JSDOM, Giao diện và hành vi tìm kiếm, Khả năng truy cập, Kiến trúc, Kiểm thử, Mô-đun dùng chung (+11 more)

### Community 63 - "orderLifecycleService.js"
Cohesion: 0.16
Nodes (22): computeEffectiveStatus(), computeStatus(), exportOrdersByCodes(), findOrder(), findOrdersBulk(), hasValue(), latestOverrideByCode(), listAllOrders() (+14 more)

### Community 64 - "contactChangeService.js"
Cohesion: 0.15
Nodes (16): ContactChangeError, createContactChangeService(), adminChange(), beginChange(), confirmChange(), normalize(), crypto, defaultService (+8 more)

### Community 65 - "hrLeaveExportService.js"
Cohesion: 0.07
Nodes (42): exceljs, applyFullTableBorder(), frozenNoGridlinesView(), HEADER_FONT, TABLE_BORDER, { BRANCHES }, branchFilePrefix(), buildEmployeeDirectoryWorkbook() (+34 more)

### Community 66 - "authRoutes.test.js"
Cohesion: 0.12
Nodes (14): clearFailedLogins(), assert, { AUTH_COOKIE_NAME }, callRoute(), { comparePassword }, { createFakeAppUsersRepository }, freshAuthRoutes(), getRouteStack() (+6 more)

### Community 67 - "buildCalendar"
Cohesion: 0.25
Nodes (17): buildCalendar(), close(), onDocKeyDown(), onDocMouseDown(), open(), position(), render(), dmyFromIso() (+9 more)

### Community 68 - "searchDashboardRecords"
Cohesion: 0.24
Nodes (15): assertMultiSearchCodeLimit(), buildSearchFields(), buildSearchIndex(), compactSearchValue(), computeTopCustomersByRevenueForProduct(), getProductRevenueDetail(), getSearchMatchRank(), normalizeSearchValue() (+7 more)

### Community 69 - "orderLifecycleRoutes.js"
Cohesion: 0.13
Nodes (13): authBulk, authLookup, authOverride, { createLifecycleExportFile }, express, { LIFECYCLE_BRANCH }, ORDER_LIFECYCLE_BULK_ROLES, ORDER_LOOKUP_ROLES (+5 more)

### Community 70 - "adminUserRoutes.js"
Cohesion: 0.11
Nodes (16): authManage, authView, bcrypt, contactChangeService, crypto, employeeDirectory, express, localUserStore (+8 more)

### Community 71 - "roleChangeRequestRoutes.test.js"
Cohesion: 0.14
Nodes (12): assert, { createFakeAppUsersRepository }, fs, localUserStore, notificationRepo, notificationsDbPath, os, path (+4 more)

### Community 72 - "debtManagementRoutes.js"
Cohesion: 0.17
Nodes (12): { branchLabelToCode }, branchMiddleware, dashboardData, express, repository, { requireAuth, requireRole }, { ROLES }, router (+4 more)

### Community 73 - "Skill: Update File — Đồng bộ file khi cấu trúc thư mục thay đổi"
Cohesion: 0.33
Nodes (6): .clasp.json / .clasp.saigon.json, .claspignore / .claspignore.saigon, docs/04-planning/implementation_plan.md, README.md (project structure doc), Skill: Update File — Đồng bộ file khi cấu trúc thư mục thay đổi, docs/02-srs/SRS_Dashboard_GoogleSheets.md

### Community 74 - "Quản lý công nợ Implementation Plan"
Cohesion: 0.09
Nodes (26): Stagger Customer Report Triggers Implementation Plan, Stagger triggers 06:00/06:30/07:00/07:30 to reduce Apps Script execution-time risk, syncCustomerByProductReport() handler, syncCustomerProductReport() handler, syncSalesCustomerReport() handler, Acceptance Criteria, Global Constraints, Quản lý công nợ Implementation Plan (+18 more)

### Community 75 - "otpService.js"
Cohesion: 0.21
Nodes (15): clearAllOtp(), clearResetOtp(), crypto, deliverOtp(), emailSender, generateResetOtp(), getAvailableChannels(), maskEmail() (+7 more)

### Community 76 - "migrate.integration.test.js"
Cohesion: 0.17
Nodes (10): pg, assert, CONFIG, EXPECTED_INTEGER_COLUMNS, EXPECTED_TABLES, { Pool }, { runMigrations }, test (+2 more)

### Community 77 - "userRepository.js"
Cohesion: 0.42
Nodes (11): findActiveUserByUsername(), findUserByEmail(), findUserById(), findUserByIdentifier(), findUserByPhone(), findUserByUsername(), getAllUsers(), localUserStore (+3 more)

### Community 78 - "adminUserRoutes.test.js"
Cohesion: 0.15
Nodes (8): adminUserRoutes, assert, { createFakeAppUsersRepository }, employeeDirectory, fakeRes(), res, localUserStore, test

### Community 79 - "sheetTimelineBuilder.js"
Cohesion: 0.23
Nodes (14): accumulateSheetPurchaseReturnEvents(), buildSupplierReturnEventMapFromSheets(), COMPLETED_STOCK_MOVEMENT_STATUSES, CONFIG, findEarliestSheetDateKey(), headerIndexes(), isCompletedStockMovementStatus(), isVatProductCode() (+6 more)

### Community 80 - "reconcileCounts.js"
Cohesion: 0.24
Nodes (10): computeDiff(), fetchKiotVietTotal(), fetchPostgresCount(), formatReportTable(), ORDERS_RETURNS_TOLERANT, reconcileAll(), reconcileEntity(), assert (+2 more)

### Community 81 - "scheduler.js"
Cohesion: 0.11
Nodes (18): startServer(), CONFIG, { createKiotVietClient }, createPollingScheduler(), runGroup(), startPollingScheduler(), fastEntities, { getConfiguredBranches } (+10 more)

### Community 82 - "E"
Cohesion: 0.22
Nodes (18): d(), Dr(), ce(), E(), f(), fr(), gr(), h() (+10 more)

### Community 83 - "orderLifecycleRepository.js"
Cohesion: 0.16
Nodes (16): appendOverride(), buildColumnIndex(), client, CONFIG, generateId(), HEADER_ALIASES, HISTORY_SCHEMA, historyClient (+8 more)

### Community 84 - "package.json"
Cohesion: 0.13
Nodes (14): compression, cookie-parser, dotenv, multer, description, devDependencies, dotenv, jsdom (+6 more)

### Community 85 - "exportService.test.js"
Cohesion: 0.22
Nodes (7): assert, CONFIG, dashboardData, ExcelJS, exportService, FIXED_TABLES, test

### Community 86 - "productLoader.js"
Cohesion: 0.16
Nodes (11): CODE_KEYS, CREATED_DATE_KEYS, loadActiveCandidates(), NAME_KEYS, pickField(), PRODUCTS_QUERY, sumOnHand(), assert (+3 more)

### Community 87 - "index.js"
Cohesion: 0.17
Nodes (10): app, { captureWebhookRawBody, webhookJsonErrorHandler }, compression, CONFIG, cookieParser, express, localUserStore, path (+2 more)

### Community 88 - "handleSubmitRoleRequest"
Cohesion: 0.14
Nodes (10): checkPendingRoleRequest(), handleSaveProfile(), handleSubmitRoleRequest(), parseApiResponse(), showToast(), switchAccountTab(), showToast(), handleLifecycleStatusChange() (+2 more)

### Community 89 - "applyBulkFilters"
Cohesion: 0.18
Nodes (12): parseSearchCodes() (tab Tổng quan), applyBulkFilters(), buildRow(), escapeHtml(), loadBulkOrders(), normalizeSearchText(), openDetailModal(), parseSearchCodes() (+4 more)

### Community 90 - "BRANCHES"
Cohesion: 0.20
Nodes (10): BRANCHES, { BRANCHES }, client, CONFIG, { createReadOnlyClient }, getDebtManagementSheet(), sourceSheetForBranch(), assert (+2 more)

### Community 92 - "dashboardRollupRefresh.js"
Cohesion: 0.23
Nodes (9): { DETAIL_AMOUNT_SQL }, { getConfiguredBranches }, { getPool }, main(), refreshDashboardRollups(), startDashboardRollupSchedule(), assert, {
  refreshDashboardRollups, startDashboardRollupSchedule, DEFAULT_WINDOW_DAYS
} (+1 more)

### Community 93 - "invoices.js"
Cohesion: 0.17
Nodes (8): createDocumentEntity(), { createDocumentEntity, value }, { createDocumentEntity, value }, assert, { assertChildReplacement }, entity, test, { createDocumentEntity, value }

### Community 94 - "customerDebtActivityRepository.js"
Cohesion: 0.20
Nodes (9): { BRANCHES, branchLabelToCode }, createCustomerDebtActivityRepository(), readOperationalPeriods(), { getPool }, PERIOD_TO_SHEET, repository, assert, { createCustomerDebtActivityRepository } (+1 more)

### Community 96 - "createKiotVietClient"
Cohesion: 0.23
Nodes (12): createKiotVietClient(), authorizedRequest(), fetchAllPages(), fetchJsonWithRetry(), fetchProductOnHand(), getAccessToken(), sleep(), assert (+4 more)

### Community 97 - "preflightCheck.js"
Cohesion: 0.27
Nodes (11): compareFieldSets(), compareOldVsRecentInvoice(), estimateAllEntities(), estimateStorageMb(), fetchSampleAndTotal(), main(), parseArgs(), STOP_AFTER_FIRST_PAGE (+3 more)

### Community 98 - "scripts"
Cohesion: 0.18
Nodes (11): scripts, build, db:migrate, dev, kiotviet-sync:backfill, kiotviet-sync:preflight, kiotviet-sync:reconcile, migrate:user-branches (+3 more)

### Community 99 - "getCachedDashboardSheets"
Cohesion: 0.24
Nodes (11): cacheEntryFor(), dashboardSheetsCacheFor(), emptyCache(), expireFullSheetsCache(), expireFullSheetsCacheSoftly(), fetchAndCacheDashboardSheets(), getCachedDashboardSheets(), getCustomerProductRevenueReport() (+3 more)

### Community 100 - "webhookEventQueue.js"
Cohesion: 0.24
Nodes (8): createWebhookEventQueue(), drain(), enqueue(), normalizePayload(), { getPool }, assert, { createWebhookEventQueue }, test

### Community 101 - "recentStockoutScanService.test.js"
Cohesion: 0.17
Nodes (7): assert, CONFIG, { createJobStore }, fetchAllPages(), product(), { runRecentStockoutScanJob }, test

### Community 102 - "dependencies"
Cohesion: 0.17
Nodes (12): dependencies, bcryptjs, compression, cookie-parser, exceljs, express, google-auth-library, googleapis (+4 more)

### Community 103 - "table-explorer.js"
Cohesion: 0.35
Nodes (9): filterTableItems(), findTableItemPage(), normalizeTableCode(), normalizeTableSearchText(), parseTableCodes(), tableExplorerApi, assert, {
  normalizeTableSearchText,
  parseTableCodes,
  filterTableItems,
  findTableItemPage
} (+1 more)

### Community 104 - "debt-management-ui.test.js"
Cohesion: 0.20
Nodes (9): assert, createDashboard(), fs, html(), indexPath, { JSDOM }, navPath, path (+1 more)

### Community 105 - "customerDebtReportRefresh.js"
Cohesion: 0.29
Nodes (8): { getConfiguredBranches }, { getPool }, main(), refreshCustomerDebtReports(), startCustomerDebtReportRefreshSchedule(), assert, { refreshCustomerDebtReports, startCustomerDebtReportRefreshSchedule, __sql__ }, test

### Community 106 - "Migrations 0001-0006 (16 tables)"
Cohesion: 0.33
Nodes (6): (branch, id) composite primary key principle, line_no as part of detail-row PK (unstable, tentative), server/db/migrate.js runner, Migrations 0001-0006 (16 tables), raw JSONB column (no data loss), server/db/SCHEMA.md

### Community 107 - "exportService.js"
Cohesion: 0.11
Nodes (32): { BRANCHES }, buildDebtManagementWorksheet(), buildFixedDataset(), CONFIG, customerRevenueRows(), dashboardData, DEBT_QUEUE_FILTERS, DEBT_SORT_FIELDS (+24 more)

### Community 108 - "recentStockoutScanService.js"
Cohesion: 0.21
Nodes (9): addDaysToDateKey(), { addDaysToDateKey, todayVnDateKey }, assert, test, todayVnDateKey(), {
  analyzeStockoutTimeline,
  computeStockoutWindow,
  maxDateKey,
  hasUnreliableZeroOnHand,
  STOCKOUT_DATA_FLOOR_DATE_KEY
}, { loadActiveCandidates: defaultLoadActiveCandidates }, { loadStockoutEvents: defaultLoadStockoutEvents } (+1 more)

### Community 109 - "stockoutCheckRoutes.js"
Cohesion: 0.17
Nodes (9): { BRANCHES }, { createJobStore }, { createKiotVietClient }, express, jobStore, recentStockoutScanService, router, sheetsClient (+1 more)

### Community 110 - "styleBaselineSnapshot.js"
Cohesion: 0.29
Nodes (11): buildVarMap(), compare(), extractBlock(), extractStyleBlock(), fs, main(), parseDeclarations(), parseDeclarationsWithScope() (+3 more)

### Community 111 - "Webhook-first + incremental reconciliation (phương án chọn)"
Cohesion: 0.18
Nodes (11): hydrateIncompleteInvoiceWebhookItems_ — chỉ hydrate payload thiếu chi tiết, processWebhookQueue trigger (mỗi 1 phút), syncRecentInvoices_() — đối soát incremental mỗi 5 phút, Nguyên nhân cạn quota UrlFetch 09/09/2026, Webhook-first + incremental reconciliation (phương án chọn), ensureKiotVietQuotaAvailable_() — chặn trước mọi UrlFetch thật, hydrateIncompleteWebhookItems_() — hydrate-skip tổng quát có cờ bật/tắt, QuotaGuard (src-dashboard/kiotviet/QuotaGuard.gs) (+3 more)

### Community 112 - "emailSender.js"
Cohesion: 0.24
Nodes (8): nodemailer, CONFIG, getTransporter(), isConfigured(), nodemailer, otpEmailHtml(), sendOtpEmail(), emailSender

### Community 113 - "stockoutCheckRoutes.test.js"
Cohesion: 0.18
Nodes (7): assert, fakeRes(), res, recentStockoutScanService, router, stockout90dScanService, test

### Community 114 - "backfillProgressRepository.js"
Cohesion: 0.18
Nodes (3): assert, repo, test

### Community 115 - "no-3d-effects.test.js"
Cohesion: 0.18
Nodes (7): assert, fs, PAGES, path, publicDir, sharedCssPath, { test }

### Community 116 - "order-lifecycle-sort.test.js"
Cohesion: 0.20
Nodes (9): assert, fs, html, htmlPath, inlineScripts(), { JSDOM }, path, renderLifecycleTable() (+1 more)

### Community 117 - "audit-sheet-columns.js"
Cohesion: 0.27
Nodes (9): columnLetter(), credentials, fs, { google }, main(), normalize(), path, quoteSheet() (+1 more)

### Community 118 - "sort-icons.test.js"
Cohesion: 0.28
Nodes (8): assert, createPage(), fs, inlineScripts(), { JSDOM }, loadHtml(), path, test

### Community 119 - "main"
Cohesion: 0.24
Nodes (7): getConfiguredBranches(), assert, { getConfiguredBranches }, KEYS, test, main(), parseArgs()

### Community 120 - "renderTable"
Cohesion: 0.24
Nodes (4): loadLeaveRequests(), loadUrgentSummary(), parseApiResponse(), renderTable()

### Community 121 - "Giảm lag TKS Dashboard Implementation Plan"
Cohesion: 0.31
Nodes (9): Dashboard Table Pagination Implementation Plan, paginate(items, page, pageSize) helper, renderPaginatedRows() DOM render helper, TABLE_PAGE_SIZE=200 constant (avoids full-list DOM render freeze), Giảm lag TKS Dashboard Implementation Plan, Gzip compression + Cache-Control middleware, TABLE_PAGE_SIZE lowered 200->100 across 13 dashboard tables, updateOrderItems batched via vcBatchUpdate (+1 more)

### Community 122 - "buildBackfillPlan"
Cohesion: 0.31
Nodes (7): 3 chunk strategies by entity type, buildBackfillPlan(), monthKey(), startOfMonthUtc(), assert, { buildBackfillPlan }, test

### Community 123 - "orderLifecycleHistoryClient.js"
Cohesion: 0.38
Nodes (9): appendRow(), CONFIG, getSheetsApi(), getValues(), { google }, invalidateCache(), quoteSheetName(), requireSpreadsheetId() (+1 more)

### Community 124 - "branch-switcher.test.js"
Cohesion: 0.22
Nodes (9): assert, fs, { JSDOM }, loadNav(), navCode, navPath, path, renderFor() (+1 more)

### Community 125 - "createFakeAppUsersRepository"
Cohesion: 0.18
Nodes (6): assert, { createFakeAppUsersRepository }, freshStore(), localUserStore, test, createFakeAppUsersRepository()

### Community 126 - "stockoutEventLoader.test.js"
Cohesion: 0.28
Nodes (7): assert, CONFIG, { loadStockoutEvents }, makeClient(), makeDeps(), makeSheetsClient(), test

### Community 128 - "orderLifecycleSheetsClient.js"
Cohesion: 0.33
Nodes (8): CONFIG, getSheetsApi(), getValues(), { google }, quoteSheetName(), requireSpreadsheetId(), sheetCache, spreadsheetNotConfigured()

### Community 129 - "hr-leave-loading.test.js"
Cohesion: 0.22
Nodes (6): assert, fs, htmlPath, { JSDOM }, path, test

### Community 130 - "hr-leave-realtime-status.test.js"
Cohesion: 0.22
Nodes (6): assert, fs, htmlPath, { JSDOM }, path, test

### Community 131 - "notif-bell.test.js"
Cohesion: 0.22
Nodes (7): assert, fs, { JSDOM }, MODULE_PATH, moduleSource, path, test

### Community 132 - "role-request-ui.test.js"
Cohesion: 0.22
Nodes (6): assert, fs, htmlPath, { JSDOM }, path, test

### Community 133 - "CHÍNH SÁCH NGHỈ PHÉP (CSNS-NP-01)"
Cohesion: 0.32
Nodes (8): CHÍNH SÁCH NGHỈ PHÉP (CSNS-NP-01), Bộ luật Lao động (VBHN 18/2026), Luật Bảo hiểm xã hội số 41/2024/QH15, Nghị định số 145/2020/NĐ-CP, Nghỉ khẩn cấp và tạm chấp thuận (Điều 9), Nghỉ phép năm (Điều 6), Telegram HR leave AI spec (liên hệ chính sách nghỉ phép), Thưởng phép chưa sử dụng cuối năm

### Community 134 - "concurrencyPool.test.js"
Cohesion: 0.29
Nodes (4): runWithConcurrencyLimit(), assert, { runWithConcurrencyLimit }, test

### Community 135 - "createTtlSnapshotCache"
Cohesion: 0.22
Nodes (5): buildFallbackAdminUser(), buildFallbackThangUser(), createCache(), initStore(), createTtlSnapshotCache()

### Community 136 - "auth-guest-ui.test.js"
Cohesion: 0.22
Nodes (7): assert, fs, { JSDOM }, loadPageWithSharedStyles(), path, readPublic(), test

### Community 137 - "jsdom"
Cohesion: 0.22
Nodes (7): jsdom, assert, fs, { JSDOM }, path, publicDir, { test }

### Community 138 - "initShootingStar"
Cohesion: 0.38
Nodes (4): initShootingStar(), handleTrigger(), isInteractiveControl(), spawnStar()

### Community 139 - "t"
Cohesion: 0.38
Nodes (6): t(), ye(), H(), L(), P(), T()

### Community 140 - "export-ui.test.js"
Cohesion: 0.29
Nodes (5): assert, fs, htmlPath, path, test

### Community 141 - "render-column-audit-report.js"
Cohesion: 0.33
Nodes (4): audit, fs, lines, path

### Community 142 - "table-search-ui.test.js"
Cohesion: 0.22
Nodes (7): assert, fs, indexPath, { JSDOM }, path, publicDir, test

### Community 143 - "Kế hoạch triển khai HR Sheet identity"
Cohesion: 0.40
Nodes (6): Kế hoạch triển khai HR Sheet identity, employeeDirectory.js / effectiveUserResolver.js identity resolution, Telegram User ID linking via _HR_TELEGRAM_LINKS, Thiết kế đồng bộ danh tính và phân quyền từ HR Sheet, HR_IDENTITY_CONFLICT / hr_removed safety rules preventing duplicate accounts and silent deletion, Department-to-role mapping rules (Quản lý/Kế toán/Trưởng kho/...)

### Community 144 - "pool.test.js"
Cohesion: 0.33
Nodes (4): assert, CONFIG_MODULE, POOL_MODULE, test

### Community 145 - "pagination.test.js"
Cohesion: 0.40
Nodes (4): paginate(), assert, { paginate }, test

### Community 147 - "orderLifecycleRepository.test.js"
Cohesion: 0.33
Nodes (5): assert, freshRepository(), HEADERS, HISTORY_HEADERS, test

### Community 148 - "Global Constraints"
Cohesion: 0.25
Nodes (7): Dashboard Table Search and Chart Navigation Implementation Plan, Global Constraints, Task 1: Pure table-search engine, Task 2: Whole-dataset search controls for all dashboard tables, Task 3: Chart-to-row navigation, Task 4: Export the currently searched dataset, Task 5: Full regression and acceptance verification

### Community 149 - "stockout-periods-column.test.js"
Cohesion: 0.33
Nodes (5): assert, fs, html, path, test

### Community 150 - "Register (Khách) Page (/register/)"
Cohesion: 0.40
Nodes (5): POST /api/auth/register, Register (Khách) Page (/register/), 404 Not Found Page, /shared/shared.css, /shared/shooting-star.js

### Community 151 - "Design System Master File — TKS Dashboard"
Cohesion: 0.40
Nodes (5): Design System Master File — TKS Dashboard, Anti-Patterns (không dùng emoji icon, plain colors, layout-shifting hover), Color System tokens (Dark Mode Obsidian Slate / Light Mode), Ràng buộc hiệu năng giao diện (mục 7 — cấm 3D transforms), Typography (Be Vietnam Pro / Inter / IBM Plex Mono)

### Community 152 - "GET /api/dashboard"
Cohesion: 0.40
Nodes (5): KPI Dashboard TOKOSI, Result Cache (KPI/biểu đồ), GET /api/dashboard, FR-01: Đọc dữ liệu Google Sheets & Caching, Luồng B: Sử dụng Dashboard & Tiện ích

### Community 153 - "google-auth-library"
Cohesion: 0.40
Nodes (4): google-auth-library, assert, freshGoogleAuthService(), test

### Community 155 - "tokenizeHardcodedStyles.js"
Cohesion: 0.50
Nodes (4): countOccurrences(), fs, main(), REPLACEMENTS

### Community 156 - "Dashboard Result Cache Implementation Plan"
Cohesion: 0.83
Nodes (4): Dashboard Result Cache Implementation Plan, computeDashboardData(sheets, filters, now), dashboardSheetsCache (raw Sheets cache with version counter), rememberSearchSheets search-index rebuild fix

### Community 157 - "Ưu tiên API KiotViet, dự phòng Google Sheets theo từng nguồn"
Cohesion: 0.50
Nodes (4): Ưu tiên API KiotViet, dự phòng Google Sheets theo từng nguồn, Fallback độc lập theo từng nguồn (không trộn API/Sheet), Bộ tải biến động dùng chung (stockout event loader), Metadata sources/warnings trong kết quả job

### Community 158 - "Quy ước branch (hanoi/saigon) là định danh nội bộ"
Cohesion: 0.50
Nodes (4): Quy tắc chuẩn hóa dữ liệu API (hóa đơn/nhập hàng/trả hàng), Quy ước branch (hanoi/saigon) là định danh nội bộ, lastModifiedFrom là tham số incremental chuẩn (đã live-probe xác minh), Yêu cầu source-driven: entity sync module phải trỏ về API_ENDPOINTS.md

### Community 159 - "Circuit breaker backoff leo thang 1h→2h→3h theo ngày"
Cohesion: 0.50
Nodes (3): Trigger trùng giữa nhiều tài khoản (giới hạn nền tảng Apps Script), isKiotVietQuotaExceededError_() — nhận diện lỗi quota thật, Circuit breaker backoff leo thang 1h→2h→3h theo ngày

### Community 160 - "roleChangeRequestRepository.test.js"
Cohesion: 0.25
Nodes (7): assert, fs, os, path, repo, test, testDbPath

### Community 161 - "setupHrSheet.js"
Cohesion: 0.32
Nodes (7): columnIndexToLetter(), CONFIG, getSheetsApi(), { google }, HR_SCHEMAS, {
  LEAVE_SCHEMA_HEADERS, LEAVE_SCHEMA_FIELD_KEYS,
  SESSION_SCHEMA_HEADERS, SESSION_SCHEMA_FIELD_KEYS
}, main()

### Community 162 - "2. Chi tiết chức năng & Quy tắc vận hành"
Cohesion: 0.29
Nodes (6): 1. Cây thư mục tổng quan (Directory Tree), 2. Chi tiết chức năng & Quy tắc vận hành, A. Tầng điều khiển trung tâm (Root Directory), B. Tầng dự án đang thực hiện (`PROJECTS/`), C. Tầng lưu trữ lịch sử (`ARCHIVE/`), HỆ THỐNG CẤU TRÚC THƯ MỤC CLAUDE WORKSPACE

### Community 163 - "Báo cáo kiểm kê trước khi xóa cột (KIOT TOKOSI)"
Cohesion: 0.67
Nodes (3): Báo cáo kiểm kê trước khi xóa cột (KIOT TOKOSI), dashboardData chuyển từ index cố định sang tên header, Cột chỉ dùng cho schema/bộ dựng dòng sync (đã gỡ đồng bộ)

### Community 173 - "returns.test.js"
Cohesion: 0.29
Nodes (5): { createDocumentEntity, value }, assert, { assertChildReplacement }, entity, test

### Community 174 - "Page Design Notes — `index.html` (Dashboard Chính)"
Cohesion: 0.33
Nodes (5): Component đặc thù của trang (đã chuẩn hoá vào MASTER §5), Nợ thiết kế riêng của trang (xem MASTER §12 để biết đầy đủ), Page Design Notes — `index.html` (Dashboard Chính), Token cục bộ cần lưu ý (KHÔNG lặp lại ở trang mới), Vai trò trang

### Community 187 - "sheetsClient.test.js"
Cohesion: 0.33
Nodes (5): assert, { BRANCHES }, CONFIG, sheetsClient, test

### Community 188 - "Page Design Notes — `404.html`"
Cohesion: 0.40
Nodes (4): Component đặc thù của trang, Nợ thiết kế riêng của trang, Page Design Notes — `404.html`, Vai trò trang

### Community 189 - "Page Design Notes — `account/index.html` (Tài Khoản & Quản Trị Người Dùng)"
Cohesion: 0.40
Nodes (4): Component đặc thù của trang, Nợ thiết kế riêng của trang (ưu tiên xử lý khi chạm vào file này), Page Design Notes — `account/index.html` (Tài Khoản & Quản Trị Người Dùng), Vai trò trang

### Community 190 - "Page Design Notes — `humanresources/index.html` (Nhân Sự / Nghỉ Phép)"
Cohesion: 0.40
Nodes (4): Component đặc thù của trang, Nợ thiết kế riêng của trang, Page Design Notes — `humanresources/index.html` (Nhân Sự / Nghỉ Phép), Vai trò trang

### Community 191 - "Page Design Notes — `login/index.html`"
Cohesion: 0.40
Nodes (4): Component đặc thù của trang, Nợ thiết kế riêng của trang, Page Design Notes — `login/index.html`, Vai trò trang

### Community 192 - "Page Design Notes — `register/index.html`"
Cohesion: 0.40
Nodes (4): Component đặc thù của trang, Nợ thiết kế riêng của trang, Page Design Notes — `register/index.html`, Vai trò trang

### Community 193 - "Page Design Notes — `shipment/index.html` (Tra Cứu Vòng Đời Đơn Hàng)"
Cohesion: 0.40
Nodes (4): Component đặc thù của trang, Nợ thiết kế riêng của trang, Page Design Notes — `shipment/index.html` (Tra Cứu Vòng Đời Đơn Hàng), Vai trò trang

### Community 195 - "userRepository.test.js"
Cohesion: 0.40
Nodes (4): assert, freshRepository(), test, USERS

### Community 196 - "applyTableSearchToWorksheets"
Cohesion: 0.70
Nodes (5): applyTableSearchToDataset(), applyTableSearchToWorksheets(), filterWorksheetRows(), findWorksheetCodeColumn(), hasTableSearch()

### Community 197 - "debtMigration.test.js"
Cohesion: 0.40
Nodes (4): assert, fs, path, test

### Community 200 - "cashFlows.test.js"
Cohesion: 0.50
Nodes (3): assert, entity, test

### Community 201 - "categories.test.js"
Cohesion: 0.50
Nodes (3): assert, categories, test

## Ambiguous Edges - Review These
- `server/db/migrate.js runner` → `Migrations 0001-0006 (16 tables)`  [AMBIGUOUS]
  docs/04-planning/2026-09-14-phase1-plan-supabase-kiotviet-sync.md · relation: calls
- `Stub webhook endpoint POST /api/kiotviet/webhook` → `GET /api/internal/kiotviet-sync/status`  [AMBIGUOUS]
  docs/04-planning/2026-09-14-phase0-plan-supabase-kiotviet-sync.md · relation: conceptually_related_to
- `Webhook-first + Polling reconciliation (Supabase sync)` → `Webhook-first + Polling reconciliation (Supabase sync)`  [AMBIGUOUS]
  docs/04-planning/2026-09-14-roadmap-supabase-kiotviet-sync.md · relation: references

## Knowledge Gaps
- **998 isolated node(s):** `fs`, `path`, `{ google }`, `credentials`, `requested` (+993 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1373 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **21 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `server/db/migrate.js runner` and `Migrations 0001-0006 (16 tables)`?**
  _Edge tagged AMBIGUOUS (relation: calls) - confidence is low._
- **What is the exact relationship between `Stub webhook endpoint POST /api/kiotviet/webhook` and `GET /api/internal/kiotviet-sync/status`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Webhook-first + Polling reconciliation (Supabase sync)` and `Webhook-first + Polling reconciliation (Supabase sync)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **Why does `jsdom` connect `jsdom` to `hr-leave-loading.test.js`, `hr-leave-realtime-status.test.js`, `notif-bell.test.js`, `role-request-ui.test.js`, `auth-guest-ui.test.js`, `debt-management-ui.test.js`, `table-search-ui.test.js`, `package.json`, `order-lifecycle-sort.test.js`, `sort-icons.test.js`, `branch-switcher.test.js`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Why does `express` connect `authMiddleware.js` to `authRoutes.js`, `orderLifecycleRoutes.js`, `adminUserRoutes.js`, `kiotvietWebhookRoutes.js`, `debtManagementRoutes.js`, `stockoutCheckRoutes.js`, `routes.js`, `kiotvietSyncStatusRoutes.js`, `package.json`, `index.js`, `branches.js`, `hrLeaveRoutes.js`?**
  _High betweenness centrality (0.034) - this node is a cross-community bridge._
- **Why does `getPool()` connect `getPool` to `dashboardPgReader.js`, `webhookEventQueue.js`, `customerDebtReportRefresh.js`, `syncDriver.js`, `backfill.js`, `routes.js`, `customerProductTopRepository.js`, `dashboardRollupRepository.js`, `debtCollectionStatusRepository.js`, `scheduler.js`, `kiotvietSyncStatusRoutes.js`, `main`, `fullSync.integration.test.js`, `checkpointRepository.js`, `dashboardRollupRefresh.js`, `customerDebtActivityRepository.js`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Are the 51 inferred relationships involving `e()` (e.g. with `Dr()` and `Be()`) actually correct?**
  _`e()` has 51 INFERRED edges - model-reasoned connections that need verification._