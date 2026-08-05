/*
===============================================================================
HUONG DAN SU DUNG APPS SCRIPT - DONG BO KIOTVIET -> GOOGLE SHEETS
===============================================================================

File nay chi la tai lieu (khong khai bao ham, khong chay code). Noi dung duoc dat
trong src/ de clasp push len va co the doc truc tiep trong Apps Script Editor.

1. PHAM VI
-------------------------------------------------------------------------------
- Apps Script chi dong bo du lieu KiotViet vao Google Sheets.
- Giao dien dashboard chi nam o web that trong server/public/index.html.
- Deployment Apps Script van la Web App de KiotViet POST webhook vao URL /exec.
- Khong co doGet(), khong co HTML dashboard va khong tinh KPI dashboard tai day.
- HN1, HN3, HN7 do KiotViet quan ly; code khong doc/ghi/doi cau truc cac tab nay.

2. CAC HAM QUAN TRI CAN CHAY
-------------------------------------------------------------------------------

syncAllInitialData()
  Khi dung : Lan cai dat dau tien, hoac khi can doi soat toan bo.
  Tac dung : Lay token, migrate schema neu can, tai lai 9 tab van hanh, sau do
             tao lai 2 tab Bao cao ban hang va Hang ban theo khach.
  Goi tiep : getKiotVietDataLock_()
             -> migrateKiotVietSheetsIfNeeded_()
             -> getKiotVietToken()
             -> syncCategoriesInitial()/syncProductsInitial()/...
             -> syncCustomerReport().
  Luu y    : Khong dat ham nay lam trigger ngan han. Ham dung khoa ghi chung de
             khong xung dot voi webhook/polling.

setupKiotVietAutoSync()
  Khi dung : Mot lan sau khi deploy, hoac khi doi WEBHOOK_URL/deployment.
  Tac dung : Tao WEBHOOK_SECRET neu thieu; tao trigger queue 1 phut; tao trigger
             polling 15 phut; go trigger cong no legacy; doi chieu va dam bao du
             9 webhook do he thong quan ly.
  Goi tiep : migrateKiotVietSheetsIfNeeded_()
             -> getKiotVietToken()
             -> ensureKiotVietWebhookSecret_()
             -> setupQueueProcessingTrigger()
             -> setupPollingTrigger()
             -> disableLegacyCustomerDebtReportSync_()
             -> reconcileKiotVietAutoSyncWebhooks_().
  Luu y    : Ham nay khong tao trigger bao cao 07:00. Neu can trigger bao cao,
             chay setupCustomerReport() rieng.

setupCustomerReport()
  Khi dung : Mot lan neu muon Apps Script tu doi soat 2 bao cao luc 07:00.
  Tac dung : Chay syncCustomerReport() ngay va tao lai trigger hang ngay.
  Goi tiep : syncCustomerReport() -> setupCustomerReportDailyTrigger().

checkWebhookStatus()
  Khi dung : Sau cai dat, hoac khi nghi webhook bi mat/ngung hoat dong.
  Tac dung : Lay danh sach webhook KiotViet va ghi trang thai vao Execution log.

getWebhookQueueStatus()
  Khi dung : Kiem tra van hanh hang ngay.
  Tac dung : Dem PENDING, PROCESSING, ERROR trong tab an _KV_WEBHOOK_QUEUE.

retryWebhookQueueErrors()
  Khi dung : Sau khi da sua nguyen nhan loi cua cac dong ERROR.
  Tac dung : Dua ERROR ve PENDING de trigger xu ly lai; khong xoa payload.

setupQueueProcessingTrigger()
  Khi dung : Khi trigger processWebhookQueue bi thieu.
  Tac dung : Xoa trigger trung va tao dung 1 trigger moi chay moi phut.

setupPollingTrigger() / removePollingTrigger()
  Khi dung : Bat/tat dong bo dinh ky 15 phut.
  Tac dung : Trigger chi lam moi Tra hang, Nha cung cap va Nhap hang - ba nguon
             khong co webhook Public API.

removeCustomerDebtReportDailyTrigger()
  Khi dung : Sau khi nang cap tu ban cu neu con trigger cong no.
  Tac dung : Chi go trigger legacy; khong cham vao HN1/HN3/HN7.

Quy uoc: ham co dau gach duoi o cuoi ten (vi du syncPollingOnly_) la ham noi bo;
khong chay tay tru khi dang chan doan va hieu ro dau vao.

3. MOI LIEN KET CAC HAM - LUONG WEBHOOK
-------------------------------------------------------------------------------

KiotViet HTTP POST
  -> doPost(e)                                      [sync/WebhookQueue.gs]
     -> isValidWebhookSecret_(e)
     -> normalizeKiotVietWebhookNotifications_()
     -> ensureWebhookQueueSheet_()
     -> ghi payload vao _KV_WEBHOOK_QUEUE
     -> tra QUEUED chi sau khi ghi thanh cong

Trigger moi phut
  -> processWebhookQueue()
     -> claimWebhookQueueBatch_()                   nhan toi da 50 su kien
     -> processWebhookQueueItem_()
        -> product/stock : updateProductsFromWebhook() hoac deleteProducts...
        -> invoice      : updateInvoicesFromWebhook() hoac deleteInvoices...
        -> order        : updateOrdersFromWebhook()
        -> customer     : updateCustomersFromWebhook() hoac deleteCustomers...
        -> category     : updateCategoriesFromWebhook() hoac deleteCategories...
     -> finalizeWebhookQueueItem_()
        -> thanh cong: xoa su kien
        -> that bai  : tra ve PENDING; sau 10 lan chuyen ERROR va van giu payload

Moi updateXxxFromWebhook()
  -> hydrateKiotVietItems_()                         lay ban ghi day du moi nhat
  -> getKiotVietToken()                              token cache
  -> upsertKiotVietSheetItems_()/delete...()         ghi dung dong theo schema

Rieng hoa don:
  updateInvoicesFromWebhook()
    -> replaceInvoiceDetailsForInvoices_()           cap nhat Chi tiet hoa don
    -> updateCustomerProductReportFromInvoices_()    cap nhat Hang ban theo khach

4. MOI LIEN KET CAC HAM - FULL SYNC VA POLLING
-------------------------------------------------------------------------------

syncAllInitialData()
  -> getKiotVietToken()
  -> tung syncXxxInitial(token)
     -> KIOTVIET_SHEET_SCHEMAS                       khai bao endpoint/header
     -> fetchAllKiotVietPages_()                     phan trang + retry 429/5xx
     -> writeKiotVietSheet_()                        ghi moi truoc, don dong du sau
  -> syncCustomerReport()

Trigger 15 phut
  -> syncPollingOnly_()
     -> getKiotVietDataLock_()
     -> getKiotVietToken()
     -> syncReturnsInitial()
     -> syncSuppliersInitial()
     -> syncPurchasesInitial().

5. VAI TRO TUNG FILE
-------------------------------------------------------------------------------
config/Config.gs
  Ten retailer, ten cac tab va header Hang hoa; duoc moi module dung.

kiotviet/Auth.gs
  getKiotVietToken(): doc KIOTVIET_CLIENT_ID/KIOTVIET_CLIENT_SECRET tu Script
  Properties, lay access token va cache theo han.

kiotviet/SheetSchemas.gs
  Nguon schema trung tam; chuyen object API thanh dong Sheet; fetch/retry; ghi,
  upsert, xoa va migrate an toan.

kiotviet/SyncInitial.gs
  Full sync, cac ham sync tung tab va polling 15 phut.

kiotviet/WebhookAdmin.gs
  Tao/kiem tra/doi chieu webhook; URL dang ky tro toi doPost().

sync/WebhookQueue.gs
  Nhan webhook, queue ben vung, lease/retry va trigger xu ly moi phut.

sync/UpdateHandlers.gs
  Hydrate ban ghi va dieu phoi upsert/xoa cho tung loai webhook.

kiotviet/CustomerReport.gs
  Tao/doi soat Bao cao ban hang va Hang ban theo khach; quan ly trigger 07:00.

kiotviet/CustomerDebtReport.gs
  Compatibility guard chi go trigger cu; bao ve HN1/HN3/HN7.

utils/Helpers.gs
  Khoa ghi chung, chuan hoa ngay/ma va tao dinh dang/dong Hang hoa.

6. CAI DAT VA PHAT HANH
-------------------------------------------------------------------------------
1) Apps Script -> Project Settings -> Script Properties:
   - KIOTVIET_CLIENT_ID
   - KIOTVIET_CLIENT_SECRET
   - WEBHOOK_URL (tuy chon; URL /exec cua deployment neu khac mac dinh)
2) Chay clasp push --force tu thu muc du an.
3) Tao version moi va redeploy Web App. Quyen truy cap phai cho phep KiotViet POST.
4) Lan dau chay syncAllInitialData().
5) Chay setupKiotVietAutoSync().
6) Neu dung trigger bao cao 07:00, chay setupCustomerReport().
7) Xac nhan bang checkWebhookStatus() va getWebhookQueueStatus().

7. XU LY LOI
-------------------------------------------------------------------------------
- Queue tang lien tuc: xem cot Loi gan nhat trong _KV_WEBHOOK_QUEUE va muc
  Executions. Sua loi roi chay retryWebhookQueueErrors().
- Khong xoa queue bang tay truoc khi xac nhan du lieu da co trong sheet dich.
- Full sync loi: du lieu cu khong bi xoa trang; sua quota/API roi chay lai.
- Webhook URL thay doi: cap nhat WEBHOOK_URL va chay setupKiotVietAutoSync().
- Trigger dung: tao lai bang setupQueueProcessingTrigger(), setupPollingTrigger()
  hoac setupCustomerReportDailyTrigger() tuy loai.

===============================================================================
*/
