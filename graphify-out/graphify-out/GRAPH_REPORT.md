# Graph Report - graphify-out  (2026-09-25)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 3479 nodes · 7326 edges · 176 communities (167 shown, 8 thin omitted)
- Extraction: 89% EXTRACTED · 11% INFERRED · 0% AMBIGUOUS · INFERRED: 820 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a279c4b8`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- chart.umd.min.js
- an
- n
- e
- va
- debtManagement.js
- exportService.js
- o
- zt
- tn
- ns
- stockout30dScanService.test.js
- a
- notificationRepository.js
- t
- dashboardPgReader.js
- xn
- hrLeaveExportService.js
- debtManagementRoutes.test.js
- createReportKit
- branches.js
- backfill.js
- no
- localUserStore.js
- dashboardData.js
- entityTestUtils.js
- authRoutes.js
- employeeDirectory.js
- exportService.test.js
- Qe
- dashboardRollupRepository.js
- recentStockoutScanService.js
- html2pdf.bundle.min.js
- otpService.js
- stockoutCheckRoutes.js
- featureRegistry.js
- customerProductTopRepository.js
- routes.js
- computeDashboardData
- migrate.integration.test.js
- orderLifecycleService.js
- exportError
- hrLeaveRoutes.js
- hrLeaveRepository.js
- export-ui.test.js
- dashboardData.test.js
- checkpointRepository.js
- reconcileCounts.js
- shared-nav.js
- hrSheetsClient.js
- adminUserRoutes.js
- defaultsForRole
- pageGuard.js
- effectiveUserResolver.js
- exportFieldCatalog.js
- hrEmployeeExportService.js
- scheduler.js
- s
- appUsersRepository.js
- employeeRegistrationService.js
- getDashboardData
- i
- orderLifecycleRoutes.test.js
- stockoutEngine.js
- hrLeaveService.js
- kiotvietWebhookRoutes.js
- contactChangeService.js
- roleChangeRequestRepository.js
- dashboardRollupRefresh.js
- buildCalendar
- exportFieldCatalog.test.js
- stockoutPgSource.js
- hrLeaveRoutes.test.js
- da
- value
- documentEntityFactory.js
- orderLifecycleRepository.js
- authMiddleware.js
- dashboardPermissionFilter.js
- timelineBuilder.js
- loadStockoutEvents
- dashboard-live-updates.test.js
- hr-branch-department-filters.test.js
- package.json
- adminUserRoutes.test.js
- normalizeSearchValue
- cashFlows.js
- authService.js
- roleChangeRequestRoutes.test.js
- getPool
- createKiotVietClient
- preflightCheck.test.js
- productReportRefresh.js
- syncDriverSpecialCases.test.js
- jn
- be
- p
- userWriteRepository.js
- auth-guest-ui.test.js
- createFakeAppUsersRepository
- resolveBranchScope
- debtManagementRoutes.js
- stockoutCheckRoutes.test.js
- index.js
- kiotvietSyncStatusRoutes.js
- syncDriver.js
- dependencies
- orderLifecycleRoutes.js
- order-lifecycle-sort.test.js
- stockout-branch-column.test.js
- authRoutes.test.js
- userRepository.js
- getCachedDashboardSheets
- styleBaselineSnapshot.js
- sheetsClient.js
- branch-switcher.test.js
- roleChangeRequestRoutes.js
- server/config.js
- customerDebtActivityRepository.js
- webhookEventQueue.js
- backfillProgressRepository.js
- kiotvietSyncStatusRoutes.test.js
- table-explorer.js
- debug-route.test.js
- dashboard-section-layout.test.js
- debt-management-ui.test.js
- no-3d-effects.test.js
- notif-bell.test.js
- audit-sheet-columns.js
- jsdom
- loadSourceRowsForItems
- buildCustomerProductRevenueDataset
- customerDebtReportRefresh.js
- scripts
- orderLifecycleHistoryClient.js
- fullSync.integration.test.js
- createTtlSnapshotCache
- featurePermissionsMigration.test.js
- rs
- ye
- orderLifecycleSheetsClient.js
- role-request-ui.test.js
- supplier-return-import-ui.test.js
- table-search-ui.test.js
- setupOrderLifecycleHistorySheet.js
- roleChangeRequestRepository.test.js
- mergeDashboardSheets
- productReportRepository.js
- concurrencyPool.test.js
- content-full-width.test.js
- express
- singleSourceTable
- createFakeHrEmployeesRepository
- initShootingStar
- debtManagementSheetsClient.js
- render-column-audit-report.js
- branchRoutes.test.js
- installStubs
- productLoader.test.js
- hrLeaveTelegramMigration.test.js
- pool.test.js
- pagination.test.js
- orderLifecycleRepository.test.js
- stockout-periods-column.test.js
- table-alignment.test.js
- google-auth-library
- res
- userRepository.test.js
- debtMigration.test.js
- tokenizeHardcodedStyles.js
- res
- res
- res
- categories.test.js
- backfillRangeParam.test.js

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
10. `getPool()` - 39 edges

## Surprising Connections (you probably didn't know these)
- `ai()` --indirect_call--> `c()`  [INFERRED]
  server/public/vendor/chart.umd.min.js → server/public/vendor/html2pdf.bundle.min.js
- `ao()` --indirect_call--> `c()`  [INFERRED]
  server/public/vendor/chart.umd.min.js → server/public/vendor/html2pdf.bundle.min.js
- `e()` --indirect_call--> `cn()`  [INFERRED]
  server/public/vendor/html2pdf.bundle.min.js → server/public/vendor/chart.umd.min.js
- `h()` --indirect_call--> `K()`  [INFERRED]
  server/public/vendor/html2pdf.bundle.min.js → server/public/vendor/chart.umd.min.js
- `e()` --indirect_call--> `ln()`  [INFERRED]
  server/public/vendor/html2pdf.bundle.min.js → server/public/vendor/chart.umd.min.js

## Import Cycles
- None detected.

## Communities (176 total, 8 thin omitted)

### Community 0 - "chart.umd.min.js"
Cohesion: 0.03
Nodes (47): ai(), ao(), average(), cn(), d(), dataset(), destroy(), getCenterPoint() (+39 more)

### Community 1 - "an"
Cohesion: 0.06
Nodes (18): addBox(), addElements(), afterDatasetsUpdate(), an(), configure(), f(), generateLabels(), ke() (+10 more)

### Community 2 - "n"
Cohesion: 0.05
Nodes (31): buildTicks(), ca(), _calculateBarIndexPixels(), Do(), eo(), Fn(), g(), getLabelAndValue() (+23 more)

### Community 3 - "e"
Cohesion: 0.08
Nodes (57): Be(), e(), ae(), at(), br(), bt(), cr(), ct() (+49 more)

### Community 4 - "va"
Cohesion: 0.06
Nodes (14): Ae(), afterDraw(), afterEvent(), Bi(), bo, _calculateBarValuePixels(), Ci(), et() (+6 more)

### Community 5 - "debtManagement.js"
Cohesion: 0.07
Nodes (48): xlsx, ALERT_CODES, amountOrZero(), buildColumnIndex(), buildOperationalNameSet(), buildStatusMap(), buildSummary(), createAlertSignature() (+40 more)

### Community 6 - "exportService.js"
Cohesion: 0.06
Nodes (49): aggregateColumn(), { BRANCHES, BRANCH_BOTH, resolveBranchScope }, buildLogicalRows(), buildSearchDataset(), CHILD_CATEGORY_COLUMNS, columnHasFraction(), createExportWorkbook(), CUSTOMER_PRODUCT_DETAIL_COLUMNS (+41 more)

### Community 7 - "o"
Cohesion: 0.09
Nodes (20): aa(), afterUpdate(), ba, e(), Ee(), gi(), ki(), la() (+12 more)

### Community 8 - "zt"
Cohesion: 0.06
Nodes (14): Bt(), ce(), color(), de, Ft(), Gt(), he(), It() (+6 more)

### Community 9 - "tn"
Cohesion: 0.08
Nodes (7): Cs, fe(), ks(), nn(), os(), sn, tn

### Community 10 - "ns"
Cohesion: 0.07
Nodes (9): As(), beforeUpdate(), initialize(), labelColor(), labelPointStyle(), ns(), rt(), updateRangeFromParsed() (+1 more)

### Community 11 - "stockout30dScanService.test.js"
Cohesion: 0.05
Nodes (23): createJobStore(), crypto, assert, { createJobStore }, test, assert, { createJobStore }, { fakeStockoutSource } (+15 more)

### Community 12 - "a"
Cohesion: 0.06
Nodes (19): a(), determineDataLimits(), Di(), draw(), dt(), getMaxOverflow(), H(), j() (+11 more)

### Community 13 - "notificationRepository.js"
Cohesion: 0.07
Nodes (36): createNotification(), createNotificationForUsers(), crypto, DATA_DIR, DEFAULT_STORE_PATH, deleteAllForUser(), deleteNotification(), ensureDataDir() (+28 more)

### Community 14 - "t"
Cohesion: 0.16
Nodes (42): a(), C(), Dr(), a(), c(), E(), er(), fe() (+34 more)

### Community 15 - "dashboardPgReader.js"
Cohesion: 0.06
Nodes (29): branchLabelToCode(), { BRANCHES, branchLabelToCode, resolveBranchScope }, CONFIG, CORE_EXCLUDED_SHEET_NAMES, CORE_SHEET_NAMES, CORE_TABS, createDashboardPgReader(), readCoreDashboardSheets() (+21 more)

### Community 16 - "xn"
Cohesion: 0.08
Nodes (14): bn(), dn(), ei(), ia(), je(), kn(), on(), pn() (+6 more)

### Community 17 - "hrLeaveExportService.js"
Cohesion: 0.08
Nodes (34): exceljs, applyFullTableBorder(), frozenNoGridlinesView(), HEADER_FONT, TABLE_BORDER, applySort(), { BRANCHES }, branchFilePrefix() (+26 more)

### Community 18 - "debtManagementRoutes.test.js"
Cohesion: 0.06
Nodes (27): assertBranchCode(), BRANCH_CODES, createDebtCollectionStatusRepository(), upsertStatus(), upsertStatusForBranches(), { getPool }, repository, assert (+19 more)

### Community 19 - "createReportKit"
Cohesion: 0.12
Nodes (37): CHART_JS_PATH, createReportKit(), buildSummary(), categoryColumn(), dateColumn(), escapeHtml(), formatCell(), formatMetric() (+29 more)

### Community 20 - "branches.js"
Cohesion: 0.10
Nodes (31): allowedBranches(), BRANCH_CODE_TO_LABEL, BRANCH_LABEL_TO_CODE, BRANCHES, defaultBranch(), isBranchAllowed(), isBranchSelectable(), LEGACY_ALIASES (+23 more)

### Community 21 - "backfill.js"
Cohesion: 0.09
Nodes (25): backfillCashFlowsChunk(), backfillEntity(), { buildBackfillPlan }, buildRunPlan(), defaultProgressRepo, ENTITY_ORDER, loadEntityModules(), main() (+17 more)

### Community 22 - "no"
Cohesion: 0.09
Nodes (11): buildLookupTable(), En, Fo(), _generate(), getDecimalForValue(), _getTimestampsForTable(), init(), initOffsets() (+3 more)

### Community 23 - "localUserStore.js"
Cohesion: 0.11
Nodes (32): appUsersRepository, bcrypt, cache, { createTtlSnapshotCache }, createUser(), crypto, deleteUser(), ensureHardcodedAdminsInDb() (+24 more)

### Community 24 - "dashboardData.js"
Cohesion: 0.06
Nodes (32): { BRANCHES, BRANCH_BOTH, branchLabelToCode, resolveBranchScope }, buildParentCategoryResolver(), CONFIG, CUSTOMER_DIRECTORY_BRANCH_RANK, customerDebtActivityRepository, customerDirectoryCacheByBranch, customerDirectoryRepository, customerProductTopRepository (+24 more)

### Community 25 - "entityTestUtils.js"
Cohesion: 0.07
Nodes (28): { assertSimpleEntity }, entity, test, assert, assertChildReplacement(), assertSimpleEntity(), fakeClient(), { assertChildReplacement } (+20 more)

### Community 26 - "authRoutes.js"
Cohesion: 0.07
Nodes (27): { AUTH_COOKIE_NAME, AUTH_COOKIE_MAX_AGE_MS, requireAuth }, checkAndBumpRateLimit(), CONFIG, contactChangeService, cookieOptions(), { createActiveGuest, activatePendingGuest, updateUserFields }, crypto, { currentBranchFor } (+19 more)

### Community 27 - "employeeDirectory.js"
Cohesion: 0.11
Nodes (29): linkVerifiedGoogleIdentity(), ROLES, { BRANCH_BOTH, branchCodeToLabel }, createEmployeeDirectory(), clearCache(), fetchSnapshot(), getSnapshot(), updateEmployeeContact() (+21 more)

### Community 28 - "exportService.test.js"
Cohesion: 0.07
Nodes (21): assert, catalog, CONFIG, dashboardData, dashboardPgReader, DEBT_HTML_EXPORT, ExcelJS, exportHtmlReport (+13 more)

### Community 29 - "Qe"
Cohesion: 0.18
Nodes (31): be(), Ce(), De(), ar(), de(), ee(), ge(), ie() (+23 more)

### Community 30 - "dashboardRollupRepository.js"
Cohesion: 0.12
Nodes (26): statusLabel(), { BRANCHES, branchLabelToCode, resolveBranchScope }, buildRecentPurchaseOrdersSql(), createDashboardRollupRepository(), getFirstPurchaseDates(), getInvoiceQuantitiesByCode(), getInvoiceRevenueByDay(), getProductSalesBreakdown() (+18 more)

### Community 31 - "recentStockoutScanService.js"
Cohesion: 0.15
Nodes (25): addDaysToDateKey(), { addDaysToDateKey, todayVnDateKey }, assert, test, todayVnDateKey(), loadActiveCandidates(), {
  analyzeStockoutTimeline,
  computeStockoutWindow,
  maxDateKey,
  hasUnreliableZeroOnHand,
  STOCKOUT_DATA_FLOOR_DATE_KEY
}, { loadActiveCandidates: defaultLoadActiveCandidates } (+17 more)

### Community 32 - "html2pdf.bundle.min.js"
Cohesion: 0.08
Nodes (13): Cr(), Er(), He(), Ht(), Ie(), Je(), Nr(), ot() (+5 more)

### Community 33 - "otpService.js"
Cohesion: 0.12
Nodes (23): nodemailer, clearAllOtp(), clearResetOtp(), crypto, deliverOtp(), emailSender, generateResetOtp(), getAvailableChannels() (+15 more)

### Community 34 - "stockoutCheckRoutes.js"
Cohesion: 0.09
Nodes (23): { BRANCH_BOTH }, createChildJobSink(), mergeBranchStockoutResults(), runBothBranchesScan(), assert, { createJobStore }, { runBothBranchesScan, mergeBranchStockoutResults }, test (+15 more)

### Community 35 - "featureRegistry.js"
Cohesion: 0.09
Nodes (25): ALL_ROLES, ALWAYS_ON_KEYS, ANY_REPORTS_FEATURES, FEATURE_BY_KEY, FEATURE_GROUPS, FEATURE_KEYS, FEATURES, hasFeature() (+17 more)

### Community 36 - "customerProductTopRepository.js"
Cohesion: 0.12
Nodes (24): { BRANCHES, BRANCH_BOTH, branchLabelToCode, resolveBranchScope }, buildTopCustomersQuery(), createCustomerProductTopRepository(), findTopCustomersByProducts(), findTopCustomersByRevenueForProduct(), resolveBranchCode(), resolveScope(), customerCodeSql() (+16 more)

### Community 37 - "routes.js"
Cohesion: 0.08
Nodes (25): buildExportErrorBody(), adminUserRoutes, { ANY_REPORTS_FEATURES }, authRoutes, { branchLabelToCode, resolveBranchScope }, branchRoutes, { dashboardRollupEvents }, debtManagementRoutes (+17 more)

### Community 38 - "computeDashboardData"
Cohesion: 0.17
Nodes (26): aggregateCustomerReportRevenueByCode(), aggregateCustomerRevenueFromSheetRows(), attachCustomerRevenue(), buildRevenuePeriod(), buildRevenuePeriodFromRollup(), buildTopCustomersByRevenue(), buildTransactionsReport(), computeCustomerProductRevenue() (+18 more)

### Community 39 - "migrate.integration.test.js"
Cohesion: 0.08
Nodes (19): DEFAULT_MIGRATIONS_DIR, fs, { getPool }, assert, CONFIG, EXPECTED_INTEGER_COLUMNS, EXPECTED_TABLES, { Pool } (+11 more)

### Community 40 - "orderLifecycleService.js"
Cohesion: 0.16
Nodes (22): computeEffectiveStatus(), computeStatus(), exportOrdersByCodes(), findOrder(), findOrdersBulk(), hasValue(), latestOverrideByCode(), listAllOrders() (+14 more)

### Community 41 - "exportError"
Cohesion: 0.17
Nodes (25): acquireExportSlot(), activeColumns(), branchFilePrefix(), buildExportDataset(), buildFixedDataset(), createExport(), createExportHtml(), describeExport() (+17 more)

### Community 42 - "hrLeaveRoutes.js"
Cohesion: 0.09
Nodes (21): { BRANCHES }, broadcastLeaveEvent(), { EventEmitter }, LEAVE_EVENT_TYPES, leaveEvents, authEmployees, authInternal, authManager (+13 more)

### Community 43 - "hrLeaveRepository.js"
Cohesion: 0.15
Nodes (23): boundaryLabel(), { BRANCHES, branchLabelToCode, branchCodeToLabel }, CONFIG, createHrLeaveRepository(), createLeaveRequest(), getLeaveRequestById(), getLeaveRequests(), getUrgentFlagSummary() (+15 more)

### Community 44 - "export-ui.test.js"
Cohesion: 0.11
Nodes (15): assert, createExportDashboard(), harness, exportField(), exportMetadata(), flush(), fs, htmlPath (+7 more)

### Community 45 - "dashboardData.test.js"
Cohesion: 0.09
Nodes (15): AGG_CUSTOMER_HEADER, AGG_DETAIL_HEADER, AGG_INVOICE_HEADER, AGG_PRODUCT_HEADER, assert, BASE_FILTERS, CATEGORY_HEADERS, DETAIL_HEADERS (+7 more)

### Community 46 - "checkpointRepository.js"
Cohesion: 0.09
Nodes (14): createCheckpointRepository(), { getPool }, assert, { createCheckpointRepository }, test, repository, assert, { createCheckpointRepository } (+6 more)

### Community 47 - "reconcileCounts.js"
Cohesion: 0.13
Nodes (17): getConfiguredBranches(), assert, { getConfiguredBranches }, KEYS, test, computeDiff(), fetchKiotVietTotal(), fetchPostgresCount() (+9 more)

### Community 48 - "shared-nav.js"
Cohesion: 0.14
Nodes (21): buildProfileModal(), close(), onKeydown(), showError(), showSuccess(), closeDropdown(), escapeHtml(), formatNotifDate() (+13 more)

### Community 49 - "hrSheetsClient.js"
Cohesion: 0.18
Nodes (21): { BRANCHES }, branchNotConfigured(), columnIndexToLetter(), CONFIG, createHrClient(), fetchHrSheetIds(), getHrSheetGeneration(), hrAppendRow() (+13 more)

### Community 50 - "adminUserRoutes.js"
Cohesion: 0.09
Nodes (19): authManage, authPermissions, authView, bcrypt, contactChangeService, crypto, employeeDirectory, express (+11 more)

### Community 51 - "defaultsForRole"
Cohesion: 0.09
Nodes (17): defaultsForRole(), assert, { defaultsForRole }, fakeCan(), fs, htmlPath, { JSDOM }, path (+9 more)

### Community 52 - "pageGuard.js"
Cohesion: 0.11
Nodes (17): verifyToken(), createPageGuard(), effectiveUserResolver, featureRegistry, isPageRequest(), localUserStore, PUBLIC_EXACT, PUBLIC_PREFIXES (+9 more)

### Community 53 - "effectiveUserResolver.js"
Cohesion: 0.14
Nodes (18): { BRANCH_BOTH }, changedFields(), createEffectiveUserResolver(), findAccountForEmployee(), persistIfChanged(), resolveUser(), defaultResolver, EffectiveUserError (+10 more)

### Community 54 - "exportFieldCatalog.js"
Cohesion: 0.10
Nodes (18): CONFIG, CUSTOMER_FIELDS, INVOICE_FIELDS, LABEL_BY_SHEET_HEADER, labelForSheetHeader(), normalizeHeader(), ORDER_FIELDS, PRODUCT_FIELDS (+10 more)

### Community 55 - "hrEmployeeExportService.js"
Cohesion: 0.12
Nodes (19): departmentKey(), matchesDepartment(), { BRANCHES }, branchFilePrefix(), buildEmployeeDirectoryWorkbook(), COLUMN_WIDTHS, employeeDirectory, ExcelJS (+11 more)

### Community 56 - "scheduler.js"
Cohesion: 0.11
Nodes (20): startServer(), CONFIG, { createKiotVietClient }, createPollingScheduler(), runFastGroupAndRollup(), runGroup(), startPollingScheduler(), fastEntities (+12 more)

### Community 57 - "s"
Cohesion: 0.13
Nodes (20): at(), b(), beforeLayout(), es(), is(), s(), label(), m() (+12 more)

### Community 58 - "appUsersRepository.js"
Cohesion: 0.15
Nodes (19): attachBranch(), { BRANCHES, BRANCH_BOTH, normalizeCoSo, branchCodeToLabel }, CO_SO_FROM_DB, CO_SO_TO_DB, coSoFromDb(), coSoToDb(), { getPool }, insertUser() (+11 more)

### Community 59 - "employeeRegistrationService.js"
Cohesion: 0.13
Nodes (18): bcrypt, createEmployeeRegistrationService(), createChallenge(), getChallenge(), sendOtp(), verifyAndRegister(), crypto, defaultService (+10 more)

### Community 60 - "getDashboardData"
Cohesion: 0.12
Nodes (21): buildDebtManagementForBranch(), dashboardCoreSheetsCacheFor(), dashboardResultCacheKey(), dashboardSourceVersion(), debtManagementSheetsCacheFor(), debtWorkflowCacheFor(), expireDebtManagementCache(), expireSheetsCache() (+13 more)

### Community 61 - "i"
Cohesion: 0.15
Nodes (11): ct(), fs(), ge(), gs(), ms(), ps(), i(), vs() (+3 more)

### Community 62 - "orderLifecycleRoutes.test.js"
Cohesion: 0.10
Nodes (16): assert, { AUTH_COOKIE_NAME }, callRoute(), effectiveUserResolver, fakeRes(), res, getRouteStack(), INTERNAL_ROLES (+8 more)

### Community 63 - "stockoutEngine.js"
Cohesion: 0.15
Nodes (15): addDaysToDateKey(), clipPeriod(), daysBetweenInclusive(), findStockoutPeriods(), summarizeStockoutPeriods(), assert, { findStockoutPeriods, summarizeStockoutPeriods }, test (+7 more)

### Community 64 - "hrLeaveService.js"
Cohesion: 0.12
Nodes (13): { BRANCHES, isBranchAllowed, normalizeCoSo }, computeIsUrgent(), computeSubmissionViolation(), CONFIG, employeeDirectory, formatLeaveBoundary(), formatVietnameseDate(), getBangkokDateHour() (+5 more)

### Community 65 - "kiotvietWebhookRoutes.js"
Cohesion: 0.15
Nodes (15): captureWebhookRawBody(), CONFIG, createKiotVietWebhookRouter(), { createWebhookEventQueue }, createWebhookJsonErrorHandler(), crypto, defaultQueue, express (+7 more)

### Community 66 - "contactChangeService.js"
Cohesion: 0.15
Nodes (16): ContactChangeError, createContactChangeService(), adminChange(), beginChange(), confirmChange(), normalize(), crypto, defaultService (+8 more)

### Community 67 - "roleChangeRequestRepository.js"
Cohesion: 0.18
Nodes (17): createRequest(), crypto, DATA_DIR, DEFAULT_STORE_PATH, ensureDataDir(), ensureLoaded(), fs, getRequestById() (+9 more)

### Community 68 - "dashboardRollupRefresh.js"
Cohesion: 0.15
Nodes (15): dashboardRollupEvents, { EventEmitter }, { dashboardRollupEvents }, { DETAIL_AMOUNT_SQL }, { getConfiguredBranches }, { getPool }, main(), refreshDashboardRollups() (+7 more)

### Community 69 - "buildCalendar"
Cohesion: 0.25
Nodes (17): buildCalendar(), close(), onDocKeyDown(), onDocMouseDown(), open(), position(), render(), dmyFromIso() (+9 more)

### Community 70 - "exportFieldCatalog.test.js"
Cohesion: 0.12
Nodes (15): getSource(), getSourceFields(), allFields(), assert, catalog, CONFIG, EXPECTED_SOURCES, FIELD_TYPES (+7 more)

### Community 71 - "stockoutPgSource.js"
Cohesion: 0.14
Nodes (11): { BRANCHES, branchLabelToCode }, buildMovementsQuery(), createStockoutPgSource(), { getPool }, MOVEMENT_KINDS, MOVEMENT_QUERIES, PRODUCT_CODE_SQL(), REQUIRED_SYNC_ENTITIES (+3 more)

### Community 72 - "hrLeaveRoutes.test.js"
Cohesion: 0.13
Nodes (14): assert, employeeDirectory, fakeRes(), res, getRouteHandler(), { leaveEvents }, MANAGER_BOTH, postLeaveRequest() (+6 more)

### Community 73 - "da"
Cohesion: 0.14
Nodes (13): beforeDatasetDraw(), beforeDatasetsDraw(), beforeDraw(), da(), ea(), fa(), ga(), ha (+5 more)

### Community 74 - "value"
Cohesion: 0.23
Nodes (11): upsertPage(), { value, upsertRows }, { value, createSimpleEntity }, array(), createSimpleEntity(), upsertRows(), value(), upsertPage() (+3 more)

### Community 75 - "documentEntityFactory.js"
Cohesion: 0.15
Nodes (11): createDocumentEntity(), { upsertStaffFromEntity }, { value, array }, { createDocumentEntity, value }, { createDocumentEntity, value }, assert, { assertChildReplacement }, entity (+3 more)

### Community 76 - "orderLifecycleRepository.js"
Cohesion: 0.16
Nodes (16): appendOverride(), buildColumnIndex(), client, CONFIG, generateId(), HEADER_ALIASES, HISTORY_SCHEMA, historyClient (+8 more)

### Community 77 - "authMiddleware.js"
Cohesion: 0.17
Nodes (14): createRequireAuth(), effectiveUserResolver, featureRegistry, localUserStore, readTokenFromRequest(), requireAuth, requireFeature(), requireRole() (+6 more)

### Community 78 - "dashboardPermissionFilter.js"
Cohesion: 0.17
Nodes (13): landingPathFor(), permissionsHave(), allowedSearchEntities(), ALWAYS_KEPT_KEYS, filterDashboardForUser(), { permissionsHave }, SEARCH_ENTITY_FEATURE, SEARCH_VIEW_FEATURE (+5 more)

### Community 79 - "timelineBuilder.js"
Cohesion: 0.26
Nodes (13): { toVnDateKey }, accumulateInvoiceEvents(), accumulatePurchaseOrderEvents(), accumulateReturnEvents(), { addDaysToDateKey }, inDateRange(), isCompletedPurchaseOrder(), pushEvent() (+5 more)

### Community 80 - "loadStockoutEvents"
Cohesion: 0.17
Nodes (14): buildSupplierReturnCoverageWarning(), buildSyncFreshnessWarnings(), loadStockoutEvents(), MOVEMENT_SOURCES, SYNC_ENTITY_LABELS, assert, FRESH_AT, FRESH_SYNC (+6 more)

### Community 81 - "dashboard-live-updates.test.js"
Cohesion: 0.13
Nodes (9): assert, FakeEventSource, fs, html, liveUpdateSource(), path, run(), test (+1 more)

### Community 82 - "hr-branch-department-filters.test.js"
Cohesion: 0.14
Nodes (12): assert, BRANCHES_WITH_BOTH, { defaultsForRole }, EMPLOYEES, fakeCan(), fs, htmlPath, { JSDOM } (+4 more)

### Community 83 - "package.json"
Cohesion: 0.13
Nodes (14): compression, cookie-parser, dotenv, multer, description, devDependencies, dotenv, jsdom (+6 more)

### Community 84 - "adminUserRoutes.test.js"
Cohesion: 0.13
Nodes (9): adminUserRoutes, assert, { createFakeAppUsersRepository }, employeeDirectory, fakeRes(), res, featureRegistry, localUserStore (+1 more)

### Community 85 - "normalizeSearchValue"
Cohesion: 0.25
Nodes (15): assertMultiSearchCodeLimit(), buildSearchFields(), buildSearchIndex(), compactSearchValue(), dedupeCustomerDirectoryRows(), getCustomerDirectory(), getSearchMatchRank(), isVatProductCode() (+7 more)

### Community 86 - "cashFlows.js"
Cohesion: 0.16
Nodes (11): base, assert, entity, test, upsertPage(), { upsertStaffFromEntity }, { value, createSimpleEntity }, assert (+3 more)

### Community 87 - "authService.js"
Cohesion: 0.19
Nodes (12): bcryptjs, jsonwebtoken, bcrypt, comparePassword(), CONFIG, hashPassword(), jwt, signToken() (+4 more)

### Community 88 - "roleChangeRequestRoutes.test.js"
Cohesion: 0.14
Nodes (12): assert, { createFakeAppUsersRepository }, fs, localUserStore, notificationRepo, notificationsDbPath, os, path (+4 more)

### Community 89 - "getPool"
Cohesion: 0.29
Nodes (12): CONFIG, createUnavailablePool(), getPool(), missingDatabaseError(), { Pool }, deactivateById(), { getPool }, insertEmployee() (+4 more)

### Community 90 - "createKiotVietClient"
Cohesion: 0.23
Nodes (12): createKiotVietClient(), authorizedRequest(), fetchAllPages(), fetchJsonWithRetry(), fetchProductOnHand(), getAccessToken(), sleep(), assert (+4 more)

### Community 91 - "preflightCheck.test.js"
Cohesion: 0.27
Nodes (11): compareFieldSets(), compareOldVsRecentInvoice(), estimateAllEntities(), estimateStorageMb(), fetchSampleAndTotal(), main(), parseArgs(), STOP_AFTER_FIRST_PAGE (+3 more)

### Community 92 - "productReportRefresh.js"
Cohesion: 0.22
Nodes (10): BRANCH_CODES, { getPool }, main(), refreshProductReport(), refreshProductReportIfDue(), startProductReportSchedule(), assert, {
  refreshProductReport, refreshProductReportIfDue, startProductReportSchedule, __sql__, __test__
} (+2 more)

### Community 93 - "syncDriverSpecialCases.test.js"
Cohesion: 0.14
Nodes (9): assert, cashFlowsEntity, { createCheckpointRepository }, createFakeSyncPool(), { createSyncDriver }, invoicesEntity, ordersEntity, returnsEntity (+1 more)

### Community 95 - "be"
Cohesion: 0.32
Nodes (14): B(), b(), be(), j(), ue(), v(), y(), gr() (+6 more)

### Community 96 - "p"
Cohesion: 0.26
Nodes (14): d(), ce(), f(), g(), gr(), h(), je(), m() (+6 more)

### Community 97 - "userWriteRepository.js"
Cohesion: 0.17
Nodes (11): freshAuthRoutes(), CONFIG, getClient(), { OAuth2Client }, verifyGoogleIdToken(), activatePendingGuest(), { ACTIVE_STATUS, ROLES, normalizePhone }, createActiveGuest() (+3 more)

### Community 98 - "auth-guest-ui.test.js"
Cohesion: 0.18
Nodes (11): PAGE_FEATURES, assert, { defaultsForRole }, fs, { JSDOM }, loadPageWithSharedStyles(), loadSharedNav(), { PAGE_FEATURES } (+3 more)

### Community 99 - "createFakeAppUsersRepository"
Cohesion: 0.18
Nodes (6): assert, { createFakeAppUsersRepository }, freshStore(), localUserStore, test, createFakeAppUsersRepository()

### Community 100 - "resolveBranchScope"
Cohesion: 0.19
Nodes (11): resolveBranchScope(), { BRANCHES, BRANCH_BOTH, branchLabelToCode, resolveBranchScope }, createCustomerDirectoryRepository(), readCustomerDirectory(), resolveBranchCode(), { getPool }, repository, assert (+3 more)

### Community 101 - "debtManagementRoutes.js"
Cohesion: 0.17
Nodes (11): { BRANCH_BOTH, branchLabelToCode, resolveBranchScope }, branchMiddleware, dashboardData, express, repository, { requireAuth, requireFeature }, router, validatePayload() (+3 more)

### Community 102 - "stockoutCheckRoutes.test.js"
Cohesion: 0.15
Nodes (9): assert, fakeRes(), res, recentStockoutScanService, router, stockout30dScanService, stockout90dScanService, supplierReturnImportService (+1 more)

### Community 103 - "index.js"
Cohesion: 0.15
Nodes (11): app, { captureWebhookRawBody, webhookJsonErrorHandler }, compression, CONFIG, cookieParser, express, localUserStore, { pageGuard } (+3 more)

### Community 104 - "kiotvietSyncStatusRoutes.js"
Cohesion: 0.21
Nodes (12): BRANCHES, BUSINESS_TABLES, CONFIG, createKiotVietSyncStatusRouter(), express, { getPool }, loadBackfillProgress(), loadCounts() (+4 more)

### Community 105 - "syncDriver.js"
Cohesion: 0.21
Nodes (10): checkpointRepository, createSyncDriver(), inTransaction(), pollCashFlows(), pollEntityOnce(), driver, { getPool }, assert (+2 more)

### Community 106 - "dependencies"
Cohesion: 0.15
Nodes (13): dependencies, bcryptjs, compression, cookie-parser, exceljs, express, google-auth-library, googleapis (+5 more)

### Community 107 - "orderLifecycleRoutes.js"
Cohesion: 0.15
Nodes (11): authBulk, authExport, authHistory, authLookup, authOverride, { createLifecycleExportFile }, express, { LIFECYCLE_BRANCH } (+3 more)

### Community 108 - "order-lifecycle-sort.test.js"
Cohesion: 0.18
Nodes (11): assert, { defaultsForRole }, fakeCan(), fs, html, htmlPath, inlineScripts(), { JSDOM } (+3 more)

### Community 109 - "stockout-branch-column.test.js"
Cohesion: 0.15
Nodes (9): assert, fs, indexPath, { JSDOM }, NINETY_BOTH, path, publicDir, RECENT_BOTH (+1 more)

### Community 110 - "authRoutes.test.js"
Cohesion: 0.18
Nodes (9): clearFailedLogins(), assert, { AUTH_COOKIE_NAME }, callRoute(), { comparePassword }, { createFakeAppUsersRepository }, getRouteStack(), localUserStore (+1 more)

### Community 111 - "userRepository.js"
Cohesion: 0.42
Nodes (11): findActiveUserByUsername(), findUserByEmail(), findUserById(), findUserByIdentifier(), findUserByPhone(), findUserByUsername(), getAllUsers(), localUserStore (+3 more)

### Community 112 - "getCachedDashboardSheets"
Cohesion: 0.26
Nodes (12): cacheEntryFor(), emptyCache(), fetchAndCacheDashboardSheets(), getAggregateFullSheets(), getAggregateSearchIndex(), getCachedDashboardSheets(), getCustomerProductRevenueReport(), getFullSheetsForScope() (+4 more)

### Community 113 - "styleBaselineSnapshot.js"
Cohesion: 0.29
Nodes (11): buildVarMap(), compare(), extractBlock(), extractStyleBlock(), fs, main(), parseDeclarations(), parseDeclarationsWithScope() (+3 more)

### Community 114 - "sheetsClient.js"
Cohesion: 0.32
Nodes (10): branchNotConfigured(), CONFIG, createClient(), getMultipleSheetValues(), getValues(), listSheetTitles(), requireSpreadsheetId(), getSheetsApi() (+2 more)

### Community 115 - "branch-switcher.test.js"
Cohesion: 0.20
Nodes (11): assert, { defaultsForRole, resolvePermissions, PAGE_FEATURES }, fs, { JSDOM }, loadNav(), navCode, navPath, path (+3 more)

### Community 116 - "roleChangeRequestRoutes.js"
Cohesion: 0.18
Nodes (9): authManager, express, { hasFeature }, localUserStore, notificationRepo, repo, { requireAuth, requireFeature }, router (+1 more)

### Community 117 - "server/config.js"
Cohesion: 0.18
Nodes (6): CONFIG, LEAVE_STATUS, LEAVE_TYPE, assert, { createHrLeaveRepository, LEAVE_STATUS, LEAVE_TYPE }, test

### Community 118 - "customerDebtActivityRepository.js"
Cohesion: 0.20
Nodes (9): { BRANCHES, branchLabelToCode }, createCustomerDebtActivityRepository(), readOperationalPeriods(), { getPool }, PERIOD_TO_SHEET, repository, assert, { createCustomerDebtActivityRepository } (+1 more)

### Community 119 - "webhookEventQueue.js"
Cohesion: 0.24
Nodes (8): createWebhookEventQueue(), drain(), enqueue(), normalizePayload(), { getPool }, assert, { createWebhookEventQueue }, test

### Community 120 - "backfillProgressRepository.js"
Cohesion: 0.18
Nodes (3): assert, repo, test

### Community 121 - "kiotvietSyncStatusRoutes.test.js"
Cohesion: 0.18
Nodes (5): assert, { createKiotVietSyncStatusRouter }, fakeRes(), r, test

### Community 122 - "table-explorer.js"
Cohesion: 0.35
Nodes (9): filterTableItems(), findTableItemPage(), normalizeTableCode(), normalizeTableSearchText(), parseTableCodes(), tableExplorerApi, assert, {
  normalizeTableSearchText,
  parseTableCodes,
  filterTableItems,
  findTableItemPage
} (+1 more)

### Community 123 - "debug-route.test.js"
Cohesion: 0.18
Nodes (7): assert, fakeRes(), res, poolPath, queries, router, test

### Community 124 - "dashboard-section-layout.test.js"
Cohesion: 0.20
Nodes (8): assert, fs, html, { JSDOM }, path, sectionTitles(), test, view()

### Community 125 - "debt-management-ui.test.js"
Cohesion: 0.20
Nodes (9): assert, createDashboard(), fs, html(), indexPath, { JSDOM }, navPath, path (+1 more)

### Community 126 - "no-3d-effects.test.js"
Cohesion: 0.18
Nodes (7): assert, fs, PAGES, path, publicDir, sharedCssPath, { test }

### Community 127 - "notif-bell.test.js"
Cohesion: 0.18
Nodes (9): assert, { defaultsForRole }, fakeUser(), fs, { JSDOM }, MODULE_PATH, moduleSource, path (+1 more)

### Community 128 - "audit-sheet-columns.js"
Cohesion: 0.27
Nodes (9): columnLetter(), credentials, fs, { google }, main(), normalize(), path, quoteSheet() (+1 more)

### Community 129 - "jsdom"
Cohesion: 0.24
Nodes (9): jsdom, assert, createPage(), fs, inlineScripts(), { JSDOM }, loadHtml(), path (+1 more)

### Community 130 - "loadSourceRowsForItems"
Cohesion: 0.29
Nodes (10): applyTableSearchToDataset(), applyTableSearchToWorksheets(), compositeKey(), filterWorksheetRows(), hasTableSearch(), loadSourceRowsForItems(), mergeEntitySourceRows(), normalizeCode() (+2 more)

### Community 131 - "buildCustomerProductRevenueDataset"
Cohesion: 0.33
Nodes (10): buildCustomerProductRevenueDataset(), buildProductReportDataset(), buildRecentStockoutResultDataset(), buildStockout30dResultDataset(), buildStockout90dResultDataset(), formatStockoutDate(), formatStockoutPeriods(), pickAggregateRows() (+2 more)

### Community 132 - "customerDebtReportRefresh.js"
Cohesion: 0.29
Nodes (8): { getConfiguredBranches }, { getPool }, main(), refreshCustomerDebtReports(), startCustomerDebtReportRefreshSchedule(), assert, { refreshCustomerDebtReports, startCustomerDebtReportRefreshSchedule, __sql__ }, test

### Community 133 - "scripts"
Cohesion: 0.20
Nodes (10): scripts, build, db:migrate, dev, kiotviet-sync:backfill, kiotviet-sync:preflight, kiotviet-sync:reconcile, migrate:user-branches (+2 more)

### Community 134 - "orderLifecycleHistoryClient.js"
Cohesion: 0.38
Nodes (9): appendRow(), CONFIG, getSheetsApi(), getValues(), { google }, invalidateCache(), quoteSheetName(), requireSpreadsheetId() (+1 more)

### Community 135 - "fullSync.integration.test.js"
Cohesion: 0.22
Nodes (5): pg, assert, buildTestPool(), test, TEST_IDS

### Community 136 - "createTtlSnapshotCache"
Cohesion: 0.22
Nodes (5): buildFallbackAdminUser(), buildFallbackThangUser(), createCache(), initStore(), createTtlSnapshotCache()

### Community 137 - "featurePermissionsMigration.test.js"
Cohesion: 0.22
Nodes (7): assert, fs, path, permissionsSql, { ROLES }, roleSql, test

### Community 139 - "ye"
Cohesion: 0.31
Nodes (9): hr(), pr(), rr(), ye(), H(), I(), L(), P() (+1 more)

### Community 140 - "orderLifecycleSheetsClient.js"
Cohesion: 0.33
Nodes (8): CONFIG, getSheetsApi(), getValues(), { google }, quoteSheetName(), requireSpreadsheetId(), sheetCache, spreadsheetNotConfigured()

### Community 141 - "role-request-ui.test.js"
Cohesion: 0.22
Nodes (6): assert, fs, htmlPath, { JSDOM }, path, test

### Community 142 - "supplier-return-import-ui.test.js"
Cohesion: 0.22
Nodes (7): assert, fs, indexPath, { JSDOM }, path, publicDir, test

### Community 143 - "table-search-ui.test.js"
Cohesion: 0.22
Nodes (7): assert, fs, indexPath, { JSDOM }, path, publicDir, test

### Community 144 - "setupOrderLifecycleHistorySheet.js"
Cohesion: 0.32
Nodes (7): googleapis, columnIndexToLetter(), CONFIG, getSheetsApi(), { google }, HEADERS, main()

### Community 145 - "roleChangeRequestRepository.test.js"
Cohesion: 0.25
Nodes (7): assert, fs, os, path, repo, test, testDbPath

### Community 146 - "mergeDashboardSheets"
Cohesion: 0.43
Nodes (8): alignSheetRow(), concatenateSheet(), firstSheetHeaders(), mergeDashboardSheets(), mergeEntityRows(), mergeEntitySheet(), mergeTransactionalSheet(), sheetHeaderIndex()

### Community 147 - "productReportRepository.js"
Cohesion: 0.32
Nodes (6): { getPool }, getProductReport(), mapRow(), assert, { getProductReport, __test__ }, test

### Community 148 - "concurrencyPool.test.js"
Cohesion: 0.29
Nodes (4): runWithConcurrencyLimit(), assert, { runWithConcurrencyLimit }, test

### Community 149 - "content-full-width.test.js"
Cohesion: 0.25
Nodes (6): assert, fs, { JSDOM }, path, publicDir, { test }

### Community 150 - "express"
Cohesion: 0.29
Nodes (5): express, express, repo, { requireAuth }, router

### Community 151 - "singleSourceTable"
Cohesion: 0.43
Nodes (7): BRANCH_ITEM_VALUE(), branchDerivedColumn(), catalogColumn(), derivedColumn(), purchasesTable(), singleSourceTable(), sourceColumns()

### Community 153 - "initShootingStar"
Cohesion: 0.38
Nodes (4): initShootingStar(), handleTrigger(), isInteractiveControl(), spawnStar()

### Community 154 - "debtManagementSheetsClient.js"
Cohesion: 0.33
Nodes (6): { BRANCHES }, client, CONFIG, { createReadOnlyClient }, getDebtManagementSheet(), sourceSheetForBranch()

### Community 155 - "render-column-audit-report.js"
Cohesion: 0.33
Nodes (4): audit, fs, lines, path

### Community 156 - "branchRoutes.test.js"
Cohesion: 0.33
Nodes (3): assert, router, test

### Community 157 - "installStubs"
Cohesion: 0.33
Nodes (6): buildDashboard(), buildRowsBySheet(), deepFreeze(), installStubs(), sourceRow(), withStubs()

### Community 158 - "productLoader.test.js"
Cohesion: 0.33
Nodes (3): assert, { loadActiveCandidates }, test

### Community 159 - "hrLeaveTelegramMigration.test.js"
Cohesion: 0.33
Nodes (5): assert, fs, path, sql, test

### Community 160 - "pool.test.js"
Cohesion: 0.33
Nodes (4): assert, CONFIG_MODULE, POOL_MODULE, test

### Community 161 - "pagination.test.js"
Cohesion: 0.40
Nodes (4): paginate(), assert, { paginate }, test

### Community 162 - "orderLifecycleRepository.test.js"
Cohesion: 0.33
Nodes (5): assert, freshRepository(), HEADERS, HISTORY_HEADERS, test

### Community 163 - "stockout-periods-column.test.js"
Cohesion: 0.33
Nodes (5): assert, fs, html, path, test

### Community 164 - "table-alignment.test.js"
Cohesion: 0.33
Nodes (5): assert, fs, html, path, test

### Community 165 - "google-auth-library"
Cohesion: 0.40
Nodes (4): google-auth-library, assert, freshGoogleAuthService(), test

### Community 167 - "userRepository.test.js"
Cohesion: 0.40
Nodes (4): assert, freshRepository(), test, USERS

### Community 168 - "debtMigration.test.js"
Cohesion: 0.40
Nodes (4): assert, fs, path, test

### Community 169 - "tokenizeHardcodedStyles.js"
Cohesion: 0.50
Nodes (4): countOccurrences(), fs, main(), REPLACEMENTS

### Community 173 - "categories.test.js"
Cohesion: 0.50
Nodes (3): assert, categories, test

## Knowledge Gaps
- **1142 isolated node(s):** `{ BRANCHES, BRANCH_BOTH, branchLabelToCode, resolveBranchScope }`, `{ getPool }`, `repository`, `assert`, `{ createCustomerDirectoryRepository }` (+1137 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1522 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `getPool()` connect `getPool` to `customerDebtReportRefresh.js`, `dashboardPgReader.js`, `debtManagementRoutes.test.js`, `productReportRepository.js`, `backfill.js`, `dashboardRollupRepository.js`, `stockoutCheckRoutes.js`, `customerProductTopRepository.js`, `routes.js`, `migrate.integration.test.js`, `hrLeaveRepository.js`, `checkpointRepository.js`, `reconcileCounts.js`, `scheduler.js`, `appUsersRepository.js`, `dashboardRollupRefresh.js`, `stockoutPgSource.js`, `productReportRefresh.js`, `resolveBranchScope`, `kiotvietSyncStatusRoutes.js`, `syncDriver.js`, `customerDebtActivityRepository.js`, `webhookEventQueue.js`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **Why does `main()` connect `backfill.js` to `getPool`, `createKiotVietClient`, `server/config.js`, `reconcileCounts.js`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `jsdom` connect `jsdom` to `auth-guest-ui.test.js`, `export-ui.test.js`, `order-lifecycle-sort.test.js`, `role-request-ui.test.js`, `stockout-branch-column.test.js`, `dashboard-section-layout.test.js`, `supplier-return-import-ui.test.js`, `hr-branch-department-filters.test.js`, `branch-switcher.test.js`, `package.json`, `content-full-width.test.js`, `defaultsForRole`, `table-search-ui.test.js`, `exportService.test.js`, `debt-management-ui.test.js`, `notif-bell.test.js`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Are the 51 inferred relationships involving `e()` (e.g. with `Dr()` and `Be()`) actually correct?**
  _`e()` has 51 INFERRED edges - model-reasoned connections that need verification._
- **Are the 38 inferred relationships involving `h()` (e.g. with `Be()` and `Gt()`) actually correct?**
  _`h()` has 38 INFERRED edges - model-reasoned connections that need verification._
- **Are the 36 inferred relationships involving `Qe()` (e.g. with `Ye()` and `Z()`) actually correct?**
  _`Qe()` has 36 INFERRED edges - model-reasoned connections that need verification._
- **What connects `{ BRANCHES, BRANCH_BOTH, branchLabelToCode, resolveBranchScope }`, `{ getPool }`, `repository` to the rest of the system?**
  _1142 weakly-connected nodes found - possible documentation gaps or missing edges._