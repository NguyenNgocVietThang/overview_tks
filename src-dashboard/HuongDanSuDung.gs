/* DONATE: MB 5479803260680
===============================================================================
HUONG DAN SU DUNG APPS SCRIPT - DONG BO KIOTVIET -> GOOGLE SHEETS
===============================================================================

File nay chi la tai lieu (khong khai bao ham, khong chay code). Noi dung duoc dat
trong src-dashboard/ de clasp push len va co the doc truc tiep trong Apps Script Editor.

1. PHAM VI
-------------------------------------------------------------------------------
- Apps Script chi dong bo du lieu KiotViet vao Google Sheets.
- Giao dien dashboard chi nam o web that trong server/public/index.html.
- Deployment Apps Script van la Web App de KiotViet POST webhook vao URL /exec.
- Khong co doGet(), khong co HTML dashboard va khong tinh KPI dashboard tai day.
- HN1, HN3, HN7 la bao cao cong no khach hang theo 1/3/7 ngay gan day (tinh ca
  hom nay); Apps Script tu tinh tu du lieu KiotViet va ghi de vao dung cau truc
  cot ma server/dashboard/debtReport.js dang doc (xem kiotviet/CustomerDebtReport.gs).
- Chi dung tab Hang ngung kinh doanh de luu lich su tu truoc toi nay. Tab cu
  Hang ngung KD hom nay se duoc gop/xoa khi chay sync all hoac cau hinh lich.
- Project nay chi gan voi Google Sheets Dashboard (SPREADSHEET_ID tren backend).
- Project Vận chuyển nằm trong src-order-lifecycle/ và có cấu hình clasp riêng.
- KiotViet chi cho mot webhook moi Type: project Dashboard giu invoice.update
  va forward payload sang WEBHOOK_URL cua project Vận chuyển bang shared secret.

2. CAC HAM QUAN TRI CAN CHAY
-------------------------------------------------------------------------------

syncAllDataChunked()
  Khi dung : Khuyen dung khi du lieu KiotViet rat lon (hang chuc/tram nghin don).
  Tac dung : Dong bo toan bo 9 bang theo tung phan doan 5.000 ban ghi, tu dong
             ngat an toan sau 4.5 phut va tu tao trigger 1 phut chay tiep den 100%.
             Tuyet doi tranh loi Timeout 6 phut cua Google Apps Script.

syncProductsChunk() / syncInvoicesChunk() / syncOrdersChunk() ...
  Khi dung : Khi chi muon dong bo phan doan 5.000 ban ghi cho rieng mot bang cu the.
  Tac dung : Tu dong checkpoint, ghi noi tiep vao Sheet va tu dong tao trigger tiep suc.

getSyncProgressSummary()
  Khi dung : Bat cu luc nao muon xem tien do % cua cac bang dang dong bo.
  Tac dung : Tra ve thong tin so dong da keo/tong so dong cua tung bang.

resetAllSyncProgress()
  Khi dung : Khi muon xoa toan bo checkpoint va huy cac trigger tiep suc de sync lai tu 0.

syncAllInitialData()
  Khi dung : Lan cai dat dau tien khi tong du lieu nho (duoi 3.000 - 5.000 ban ghi).
  Tac dung : Lay token, migrate schema neu can, tai lai 9 tab van hanh; cap nhat
             lich su Hang ngung kinh doanh; tao lai 3 tab bao cao khach hang va
             3 tab HN1/HN3/HN7.
  Goi tiep : getKiotVietDataLock_()
             -> migrateKiotVietSheetsIfNeeded_()
             -> getKiotVietToken()
             -> syncCategoriesInitial()/syncProductsInitial()
             -> syncCustomerDebtReports()
             -> syncHangNgungKinhDoanh_()
             -> cac ham syncXxxInitial() con lai
             -> syncCustomerReport()
  Luu y    : Khong dat ham nay lam trigger ngan han. Ham dung khoa ghi chung de
             khong xung dot voi webhook/polling.

setupKiotVietAutoSync()
  Khi dung : Mot lan sau khi deploy, hoac khi doi WEBHOOK_URL/deployment.
  Tac dung : Tao WEBHOOK_SECRET neu thieu; tao trigger queue 1 phut; polling
             15 phut; Hang ngung kinh doanh 07:30; HN1/HN3/HN7 gan 15:00; doi
             chieu va dam bao du 9 webhook do he thong quan ly.
  Goi tiep : migrateKiotVietSheetsIfNeeded_()
             -> getKiotVietToken()
             -> ensureKiotVietWebhookSecret_()
             -> setupQueueProcessingTrigger()
             -> setupPollingTrigger()
             -> setupHangNgungKinhDoanhTrigger_()
             -> setupCustomerDebtReportDailyTrigger()
             -> reconcileKiotVietAutoSyncWebhooks_().
  Luu y    : Ham nay khong tao trigger bao cao khach hang. Neu can cac lich
             06:00, 06:30 va 07:00, chay setupCustomerReport() rieng.

setupCustomerReport()
  Khi dung : Mot lan neu muon Apps Script tu doi soat ba bao cao theo lich rieng.
  Tac dung : Chay syncCustomerReport() ngay de lam moi ca ba bao cao, sau do tao
             ba trigger doc lap: Bao cao ban hang gan 06:00, Hang ban theo khach
             gan 06:30 va Khach theo hang hoa gan 07:00.
  Goi tiep : syncCustomerReport() -> setupCustomerReportDailyTrigger().

syncSalesCustomerReport(), syncCustomerProductReport(), syncCustomerByProductReport()
  Khi dung : Chay tay khi can cap nhat rieng tung tab (Bao cao ban hang gan
             06:00, Hang ban theo khach gan 06:30, Khach theo hang hoa gan 07:00).
  Tac dung : Chay theo phan doan (chunked/resumable) qua runCustomerReportChunkedJob_ -
             moi lan goi toi da ~4.5 phut, luu tien do vao Script Properties va sheet
             an tam. Neu du lieu nhieu, mot lan Run co the CHUA xong (khong bao loi,
             chi la chua toi luot ghi sheet); trigger hang doi 1 phut (processWebhookQueue
             -> syncCustomerReportIfDue_) se tu dong goi lai cho toi khi hoan tat va
             cap nhat LAST_SYNC property. Neu chay tay va muon xong ngay khong doi
             trigger, bam Run nhieu lan lien tiep cho den khi Log hien "HOAN TAT".

setupCustomerDebtReports()
  Khi dung : Mot lan neu muon Apps Script tu dong cap nhat HN1/HN3/HN7 luc 15:00.
  Tac dung : Chay syncCustomerDebtReports() ngay va tao lai trigger hang ngay
             gan 15:00 (dung ScriptApp trigger, gio Asia/Ho_Chi_Minh).
  Goi tiep : syncCustomerDebtReports() -> setupCustomerDebtReportDailyTrigger().

syncCustomerDebtReports()
  Khi dung : Chay tay bat cu luc nao can dong bo ngay lap tuc (khong doi den 15:00).
  Tac dung : Lay du lieu khach hang/hoa don/tra hang/thu-chi 7 ngay gan nhat tu
             KiotViet, tinh cong no dau ky - cuoi ky cho tung khoang 1/3/7 ngay
             (tinh ca hom nay) va ghi de toan bo 3 tab HN1/HN3/HN7.

syncHangNgungKinhDoanh()
  Khi dung : Khi can doi soat rieng lich su hang ngung kinh doanh.
  Tac dung : Cap nhat tab Hang ngung kinh doanh tu toan bo hang dang ngung tren
             KiotViet, giu lai lich su cu va danh dau hang da kinh doanh lai.

cauHinhLichHangNgungKinhDoanh()
  Khi dung : Mot lan sau khi deploy de cap nhat lich su va tao lich 07:30.
  Tac dung : Gop/xoa tab legacy Hang ngung KD hom nay, khoi tao trang thai an va
             tao trigger capNhatHangNgungKinhDoanh().

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
  Khi dung : Khi can tam ngung tu dong cap nhat HN1/HN3/HN7 luc 15:00.
  Tac dung : Go trigger hang ngay; du lieu da ghi trong sheet van giu nguyen,
             chi khong tu cap nhat them cho den khi bat lai.

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
        -> neu SHIPMENT_LIFECYCLE: processShipmentLifecycleWebhookItems_()
           -> upsert Don van chuyen + Chi tiet van chuyen + Lich su trang thai
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
     -> syncKiotVietTableChunk_() cho tung bang trong POLLING_ONLY_CHAIN
        (Tra hang, Nha cung cap, Nhap hang), moi lan toi da ~4.5 phut.
     -> Neu chua xong bang/chuoi: tu tao trigger 1 phut rieng
        (resumePollingOnlyChunk_) de tiep suc, khong doi trigger 15 phut ke tiep.

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
  Tao/kiem tra/doi chieu webhook theo profile; URL dang ky tro toi doPost().

sync/WebhookQueue.gs
  Nhan webhook, queue ben vung, lease/retry va trigger xu ly moi phut.

sync/UpdateHandlers.gs
  Hydrate ban ghi va dieu phoi upsert/xoa cho tung loai webhook.

kiotviet/CustomerReport.gs
  Tao/doi soat Bao cao ban hang, Hang ban theo khach va Khach theo hang hoa;
  quan ly ba trigger doc lap gan 06:00, 06:30, 07:00 va cung cap ham chay tay
  tung bao cao.

kiotviet/CustomerDebtReport.gs
  Tinh va ghi bao cao cong no khach hang HN1/HN3/HN7 (1/3/7 ngay gan day, tinh
  ca hom nay); quan ly trigger hang ngay gan 15:00 va ham chay bu qua queue.

kiotviet/DiscontinuedProducts.gs
  Luu lich su Hang ngung kinh doanh tu truoc toi nay, don tab legacy va quan ly
  trigger cap nhat 07:30 hang ngay.

utils/Helpers.gs
  Khoa ghi chung, chuan hoa ngay/ma va tao dinh dang/dong Hang hoa.

6. CAI DAT VA PHAT HANH
-------------------------------------------------------------------------------
1) Apps Script -> Project Settings -> Script Properties:
   - KIOTVIET_CLIENT_ID
   - KIOTVIET_CLIENT_SECRET
   - KIOTVIET_RETAILER (tùy chọn; tên gian hàng KiotViet nếu khác 'CHbansi')
   - WEBHOOK_URL (bat buoc; URL /exec cua deployment Web App hien tai)
   - SHIPMENT_WEBHOOK_URL va SHIPMENT_WEBHOOK_SECRET trung voi
      WEBHOOK_URL/WEBHOOK_SECRET cua project van chuyen.
2) Tu thu muc goc chay "clasp push --force". Lenh nay dung .clasp.json va chi
   push rootDir src-dashboard/. Project Vận chuyển có hướng dẫn riêng trong
   src-order-lifecycle/HuongDanSuDung.gs.
3) Tao version moi va redeploy Web App. Quyen truy cap phai cho phep KiotViet POST.
4) Sheet tong hop cu: chay syncAllInitialData(), sau do setupKiotVietAutoSync().
5) Neu dung lich bao cao khach hang 06:00, 06:30 va 07:00, chay setupCustomerReport().
6) Xac nhan bang checkWebhookStatus() va getWebhookQueueStatus().
7) Can cap nhat HN1/HN3/HN7 ngay lap tuc (khong doi 15:00): chay tay syncCustomerDebtReports().

7. XU LY LOI
-------------------------------------------------------------------------------
- Queue tang lien tuc: xem cot Loi gan nhat trong _KV_WEBHOOK_QUEUE va muc
  Executions. Sua loi roi chay retryWebhookQueueErrors().
- Khong xoa queue bang tay truoc khi xac nhan du lieu da co trong sheet dich.
- Full sync loi: du lieu cu khong bi xoa trang; sua quota/API roi chay lai.
- Webhook URL thay doi: cap nhat WEBHOOK_URL va chay setupKiotVietAutoSync().
- Trigger dung: tao lai bang setupQueueProcessingTrigger(), setupPollingTrigger(),
  setupCustomerReportDailyTrigger() hoac setupCustomerDebtReportDailyTrigger() tuy loai.
- HN1/HN3/HN7 khong cap nhat: kiem tra trigger bang setupCustomerDebtReportDailyTrigger();
  neu can du lieu ngay, chay tay syncCustomerDebtReports(). Trigger 1 phut (processWebhookQueue)
  cung tu chay bu qua syncCustomerDebtReportsIfDue_() neu sau 15:00 ma chua dong bo.
- Lien he Nguyen Ngoc Viet Thang: 0974089295
===============================================================================
*/
