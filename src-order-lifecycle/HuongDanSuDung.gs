/*
===============================================================================
HUONG DAN APPS SCRIPT — VONG DOI DON HANG / VAN CHUYEN
===============================================================================

Project nay chi gan voi Google Sheets van chuyen (VC_SPREADSHEET_ID tren backend).
Khong push chung vao spreadsheet Dashboard hoac spreadsheet Nhan su.

CAI DAT
1. Dat Script Properties:
   - KIOTVIET_CLIENT_ID
   - KIOTVIET_CLIENT_SECRET
   - KIOTVIET_RETAILER
   - KIOTVIET_SYNC_MODE=SHIPMENT_LIFECYCLE
   - KIOTVIET_SHIPMENT_RELAY_ENABLED=true
   - WEBHOOK_URL va WEBHOOK_SECRET
2. Tu thu muc goc, push bang:
   clasp -P .clasp.order-lifecycle.json -I .claspignore.order-lifecycle push --force
3. Chay syncShipmentLifecycleRecent7Days() de nap bu du lieu gan nhat.
4. Chay setupShipmentLifecycleSync() de tao 6 tab va trigger xu ly queue.

LUONG DU LIEU
- Project Dashboard giu webhook invoice.update cua KiotViet.
- Dashboard forward payload sang WEBHOOK_URL cua project nay.
- doPost() ghi payload vao _KV_WEBHOOK_QUEUE; trigger processWebhookQueue()
  cap nhat 6 tab van chuyen.

CAC NHOM FILE
- config/Config.gs: cau hinh KiotViet va ten 6 tab van chuyen.
- kiotviet/: xac thuc, API adapter va cong cu quan tri webhook.
- shipment/KiotVietLifecycle.gs: schema va dong bo vong doi don hang.
- sync/: Web App doPost(), queue ben vung va hydrate invoice.
- utils/Helpers.gs: tien ich dung chung cua project.
===============================================================================
*/
