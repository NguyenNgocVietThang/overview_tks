# Webhook-first triệt để + Quota Guard cho KiotHN và KiotSG

## Bối cảnh

Cả hai Apps Script KiotHN và KiotSG cùng báo lỗi `Service invoked too many
times for one day: urlfetch`. Nguyên nhân xác nhận:

1. HN và SG dùng chung một tài khoản Google, nên chung một pool 20.000
   UrlFetch/ngày của Apps Script, dù là hai project độc lập.
2. SG có trigger trùng giữa "Tôi" và "Người dùng khác" — hai tài khoản từng
   chạy `setupKiotVietAutoSync()`/tương đương, nhân đôi tần suất gọi API mà
   không tài khoản nào thấy được trigger của tài khoản kia
   (`ScriptApp.getProjectTriggers()` chỉ thấy trigger của tài khoản đang chạy).
3. `processWebhookQueue()` (trigger mỗi 1 phút) gộp chung xử lý webhook với
   chạy bù báo cáo/công nợ và watchdog trigger, cạnh tranh lock và khó theo
   dõi lúc nào hệ thống tiêu quota cho việc gì.
4. Chỉ Hóa đơn có tối ưu "ghi thẳng nếu đủ dữ liệu, chỉ hydrate khi thiếu"
   (`hydrateIncompleteInvoiceWebhookItems_`); Sản phẩm/Đặt hàng/Khách
   hàng/Nhóm hàng vẫn hydrate mọi item vô điều kiện.
5. Không có cơ chế phát hiện quota cạn và tự tạm dừng — hệ thống chỉ retry
   theo từng lần gọi, nên khi quota cạn, các trigger tiếp tục thử và thất bại
   liên tục cho tới khi Google reset quota theo ngày.

## Các phương án đã cân nhắc

1. Chỉ giảm tần suất trigger: giảm tải nhưng không có cơ chế phản ứng khi
   quota thực sự cạn — vẫn thử gọi API mù quáng mỗi chu kỳ.
2. Chỉ thêm circuit breaker, giữ nguyên tần suất/cấu trúc queue hiện tại:
   không giảm được tổng nhu cầu quota, breaker sẽ trip liên tục.
3. Webhook-first triệt để (tách bạch queue/bảo trì, giảm tần suất polling,
   tổng quát hóa hydrate-skip có cờ, thêm quota circuit breaker). Đây là
   phương án được chọn — kết hợp giảm nhu cầu quota lẫn phản ứng khi vẫn cạn.

## Thiết kế

### Quota Guard (`src-dashboard/kiotviet/QuotaGuard.gs`)

- Đếm UrlFetch uoc luong theo ngày bằng Script Property
  `KIOTVIET_URLFETCH_COUNT_<yyyyMMdd>`. Đây là số đếm **riêng của từng
  project** — HN và SG không thấy được số của nhau dù dùng chung quota thật.
  Ngân sách mặc định `KIOTVIET_URLFETCH_DAILY_BUDGET = 8000` (40% của
  20.000) cố tình bảo thủ, chỉnh qua Script Property khi cần.
- `ensureKiotVietQuotaAvailable_()` được gọi ngay trước mọi lệnh
  `UrlFetchApp.fetch()`/`fetchAll()` thực tế trong toàn bộ codebase
  (`fetchKiotVietJsonWithRetry_`, `getKiotVietToken`,
  `fetchCustomerReportJsonWithRetry_`, `hydrateKiotVietItems_`, các lệnh quản
  trị webhook trong `reconcileKiotVietAutoSyncWebhooks_`,
  `forwardInvoiceWebhookToShipment_`). Nếu đang tạm dừng hoặc đã chạm ngân
  sách, ném lỗi ngay — không tiêu thêm request thật nào.
- `isKiotVietQuotaExceededError_()` nhận diện đúng thông điệp lỗi thật của
  Apps Script (loại lỗi này là **exception khi gọi UrlFetchApp**, không phải
  HTTP status — `muteHttpExceptions` không che được). Khi bắt được, gọi
  `tripKiotVietQuotaBreaker_()`.
- Backoff leo thang trong cùng một ngày: lần trip 1 → 1 giờ, lần 2 → 2 giờ,
  lần 3 trở đi → 3 giờ (không leo vô hạn, không retry liên tục mỗi 5-15 phút).
  Reset khi sang ngày mới (khóa theo ngày).
- `resetKiotVietQuotaBreaker_()` cho phép mở lại cầu dao thủ công khi vận
  hành đã xác nhận quota thật sự hồi phục sớm hơn backoff.

### Tách hàng đợi webhook khỏi bảo trì

- `processWebhookQueue()` (`sync/WebhookQueue.gs`, trigger mỗi 1 phút) **chỉ
  còn** claim và xử lý webhook. Toàn bộ báo cáo/công nợ/migrate schema/watchdog
  trigger chuyển sang `runKiotVietMaintenanceTick_()`
  (`sync/MaintenanceSchedule.gs`), trigger riêng mỗi 15 phút.
- `runKiotVietMaintenanceTick_()` vẫn chạy watchdog/migrate (không tốn
  UrlFetch) ngay cả khi Quota Guard đang tạm dừng; chỉ bỏ qua hai lệnh catch-up
  báo cáo/công nợ (tốn UrlFetch) trong lúc tạm dừng.
- Khi một webhook cần hydrate gặp đúng lỗi liên quan quota (thật hoặc do
  Quota Guard chủ động chặn), `processWebhookQueueGroupWithIsolation_` đánh
  dấu `skipAttemptPenalty: true` — item quay về `PENDING`, số lần thử không
  tăng, không bị đẩy thành `ERROR` chỉ vì trùng lúc quota cạn. Item nào ghi
  thẳng được (đủ dữ liệu, hoặc `stock.update`) vẫn xử lý bình thường trong
  cùng lúc quota đang tạm dừng. Hàng đợi không bao giờ bị xóa/reset trong lúc
  tạm dừng; sau khi backoff hết hạn, trigger tiếp theo tự xử lý lại toàn bộ
  tồn đọng.

### Giảm tần suất trigger (lưới an toàn dự phòng, không phải đường chính)

| Trigger | Trước | Sau |
|---|---|---|
| `processWebhookQueue` | 1 phút | 1 phút (không đổi — đường chính) |
| `runKiotVietMaintenanceTick_` | (nằm trong queue) | 15 phút (mới, tách riêng) |
| `syncRecentInvoices_` / `syncRecentPurchases_` | 5 phút | 60 phút |
| `syncPollingOnly_` (Trả hàng/NCC) | 15 phút | 4 giờ |
| `reconcileKiotVietAutoSyncHealth_` | 1 giờ | 6 giờ |
| Báo cáo khách hàng / công nợ | 06:00, 06:30, 07:00, 15:00 (không đổi) | không đổi |
| Full backfill | Chỉ chạy thủ công (không đổi) | không đổi |

### Hydrate-skip tổng quát, có cờ bật/tắt

- `hydrateIncompleteWebhookItems_(items, schema, isItemComplete)`
  (`sync/UpdateHandlers.gs`) tổng quát hóa
  `hydrateIncompleteInvoiceWebhookItems_`: chỉ hydrate item mà
  `isItemComplete` trả về `false`.
- Tiêu chí "đủ dữ liệu" cho từng bảng (suy đoán cấu trúc payload, **chưa có
  mẫu webhook thật trong repo để đối chiếu** như Hóa đơn):
  - `products`: có mã hàng và mảng `Inventories`/`inventories`.
  - `orders`: có mã đặt hàng và mảng `OrderDetails`/`orderDetails`.
  - `customers`: có mã khách hàng, `Name` và `GroupId`/`GroupName`.
  - `categories`: có mã nhóm hàng và `Name`.
- Vì chưa có mẫu thật để xác nhận, tối ưu này **mặc định tắt** cho cả 4 bảng,
  bật riêng từng bảng qua Script Property `KIOTVIET_HYDRATE_SKIP_ENTITIES`
  (danh sách phân cách dấu phẩy) sau khi vận hành đã soi log
  `_KV_WEBHOOK_QUEUE` thật và xác nhận tiêu chí đúng. Hóa đơn không đổi (giữ
  nguyên hàm `hydrateIncompleteInvoiceWebhookItems_` đã xác nhận qua thực tế).

### Trigger trùng giữa nhiều tài khoản

`ScriptApp.getProjectTriggers()` chỉ thấy/xóa được trigger của tài khoản đang
chạy — đây là giới hạn nền tảng của Apps Script, không sửa được bằng code.
Việc dọn trigger trùng trên SG (giữa "Tôi" và "Người dùng khác") là runbook
thủ công: từng tài khoản từng cài đặt phải tự đăng nhập, mở Apps Script Editor
→ Trình kích hoạt (giao diện này thấy được trigger của mọi chủ sở hữu, khác
API), và xóa bản trùng của chính mình. Xem mục "Trigger trùng khi nhiều tài
khoản từng cài đặt project" trong `README.md` để có danh sách handler cần
kiểm tra và các bước chi tiết.

## Xử lý lỗi

- Nếu quota/API lỗi khi đang chạy incremental polling hoặc hydrate, không
  tiến checkpoint và không ghi dữ liệu thiếu cột — giữ hành vi retry hiện có.
- Webhook cần hydrate gặp lỗi liên quan quota không bị tính vào số lần thử
  (`skipAttemptPenalty`), tránh bị đẩy thành `ERROR` do trùng lúc quota cạn.
- Không xóa/reset hàng đợi webhook trong lúc Quota Guard đang tạm dừng.
- Cờ `KIOTVIET_HYDRATE_SKIP_ENTITIES` mặc định rỗng — không entity nào tự bật
  tối ưu suy đoán khi chưa được xác nhận thủ công.

## Kiểm thử và tiêu chí hoàn thành

- Lịch trigger: `setupPollingTrigger()` cài đúng chu kỳ 60 phút (Hóa
  đơn/Nhập hàng) và 4 giờ (Trả hàng/NCC); `createKiotVietRecoveryTriggers_()`
  cài đúng chu kỳ 6 giờ; `setupMaintenanceTrigger()` cài đúng chu kỳ 15 phút.
- `processWebhookQueue()` không còn gọi bất kỳ hàm báo cáo/công nợ/migrate
  schema nào (test bằng stub-ném-lỗi-nếu-bị-gọi).
- `runKiotVietMaintenanceTick_()` chạy watchdog/migrate ngay cả khi tạm dừng,
  nhưng bỏ qua catch-up báo cáo/công nợ trong lúc đó.
- Payload đầy đủ (theo tiêu chí từng bảng) không gọi `hydrateKiotVietItems_`
  khi cờ hydrate-skip đang bật cho bảng đó; khi cờ tắt, hành vi giữ nguyên
  100% như trước (hydrate toàn bộ).
- Quota circuit breaker: lỗi quota thật/tự tạo trip cầu dao, backoff leo
  thang 1h→2h→3h trong ngày, reset khi sang ngày mới.
- Webhook cần hydrate trong lúc tạm dừng ở lại `PENDING`, số lần thử không
  tăng, hàng đợi không bị xóa; sau khi backoff hết hạn, item được xử lý lại
  bình thường mà không cần thao tác thủ công.
- Không có trigger định kỳ nào trỏ tới các handler backfill
  (`syncAllDataChunked`/`syncAllInitialData`/các `resumeSyncXxxChunk`).
- Toàn bộ test Apps Script hiện có vẫn qua (`npm test` trong `server/`).
