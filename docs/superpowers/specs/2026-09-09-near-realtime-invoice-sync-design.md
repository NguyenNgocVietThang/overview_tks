# Đồng bộ hóa đơn gần thời gian thực

## Bối cảnh

Ngày 09/09/2026, hai Apps Script KiotHN và KiotSG ngừng cập nhật hóa đơn vì quota
`UrlFetch` đã cạn. Dữ liệu thực tế cho thấy webhook `invoice.update` đã mang đủ
thông tin hóa đơn và `InvoiceDetails`, nhưng `updateInvoicesFromWebhook()` vẫn
hydrate từng hóa đơn qua KiotViet API. Song song, polling định kỳ tải lại toàn bộ
lịch sử của các bảng không có webhook, làm tăng mạnh số request.

## Các phương án đã cân nhắc

1. Chỉ tăng quota hoặc chờ quota reset: không sửa nguyên nhân và lỗi sẽ lặp lại.
2. Chỉ giảm tần suất trigger: giảm tải nhưng vẫn lãng phí request hydrate và full
   polling.
3. Webhook-first + incremental reconciliation: dùng payload đầy đủ để cập nhật
   ngay, đối soát một cửa sổ thay đổi nhỏ bằng `lastModifiedFrom`, giữ full
   backfill làm công cụ vận hành. Đây là phương án được chọn.

## Thiết kế

### Luồng hóa đơn

- `invoice.update` đi qua queue bền vững như hiện tại.
- Nếu mỗi hóa đơn có mã/ID và mảng `InvoiceDetails`, ghi trực tiếp vào `Hóa đơn`,
  thay chi tiết tương ứng trong `Chi tiết hóa đơn`, rồi cập nhật báo cáo liên quan.
- Chỉ hydrate những payload thực sự thiếu chi tiết. Một batch có thể trộn item đầy
  đủ và item thiếu; chỉ item thiếu mới tiêu `UrlFetch`.
- Dedupe trong batch giữ nguyên để một hóa đơn chỉ được ghi một lần.

### Đối soát incremental

- Thêm tác vụ `syncRecentInvoices_()` chạy mỗi 5 phút.
- Tác vụ lấy hóa đơn thay đổi từ checkpoint gần nhất bằng `lastModifiedFrom`.
- Dùng overlap 10 phút để chống mất bản ghi do lệch đồng hồ hoặc trigger trễ;
  upsert và thay chi tiết là idempotent nên overlap không tạo bản sao.
- Lần đầu không có checkpoint chỉ quét 48 giờ gần nhất, không tải toàn bộ lịch sử.
- Chỉ ghi checkpoint sau khi toàn bộ trang đã được áp dụng thành công.
- Dùng Script Properties làm throttle xuyên chủ sở hữu, nên các trigger do hai
  tài khoản tạo không thực hiện cùng một lượt đối soát.

### Giảm tải polling

- Thay polling toàn lịch sử `returns`, `suppliers`, `purchases` bằng polling
  incremental theo `lastModifiedFrom`.
- Giữ quét nhanh nhập hàng nhưng thu hẹp về incremental, tránh quét lại 7 ngày
  mỗi 5 phút.
- Full backfill hiện có vẫn được giữ nguyên và chỉ chạy thủ công khi cần sửa dữ
  liệu lịch sử.

### Trigger

- `processWebhookQueue`: mỗi phút, làm đường chính cho real-time.
- `syncRecentInvoices_`: mỗi 5 phút, làm lưới an toàn.
- `syncPollingOnly_`: mỗi 15 phút, nhưng chỉ lấy thay đổi mới.
- Setup phải idempotent với trigger thuộc người chạy; throttle bằng Script
  Properties ngăn hai chủ sở hữu cùng tiêu request dù không thể xóa trigger của
  tài khoản khác.

## Xử lý lỗi

- Nếu quota/API lỗi, không tiến checkpoint và giữ queue ở trạng thái có thể retry.
- Không xóa live sheet trước khi có dữ liệu mới.
- Full backfill đang dở không được phép ghi đè các thay đổi mới hơn; sau khi publish
  phải chạy một lượt incremental từ mốc bắt đầu backfill.

## Kiểm thử và tiêu chí hoàn thành

- Payload hóa đơn đầy đủ không gọi `UrlFetchApp.fetchAll`.
- Payload thiếu chi tiết vẫn hydrate và giữ hành vi retry khi API lỗi.
- Incremental invoice dùng đúng `lastModifiedFrom`, overlap và checkpoint.
- Hai lượt trigger gần nhau chỉ cho một lượt gọi API.
- Polling định kỳ không còn bắt đầu từ `currentItem=0` toàn lịch sử.
- Toàn bộ test Apps Script hiện có vẫn qua.
- `clasp push` thành công cho cả script ID KiotHN và KiotSG.

