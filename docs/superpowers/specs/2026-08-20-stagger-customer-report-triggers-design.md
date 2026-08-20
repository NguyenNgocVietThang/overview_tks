# Thiết kế giãn lịch cập nhật báo cáo Google Sheets

## Mục tiêu

Tách các báo cáo khách hàng đang được cập nhật chung gần 07:00 thành các tác vụ độc lập, cách nhau 30 phút, nhằm giảm nguy cơ vượt thời gian thực thi và bỏ sót cập nhật do giới hạn Google Apps Script.

Lịch mục tiêu theo múi giờ `Asia/Ho_Chi_Minh`:

| Thời gian gần đúng | Sheet |
| --- | --- |
| 06:00 | `Báo cáo bán hàng` |
| 06:30 | `Hàng bán theo khách` |
| 07:00 | `Khách theo hàng hóa` |
| 07:30 | `Hàng ngừng kinh doanh` |
| 15:00 | `HN1`, `HN3`, `HN7` (giữ nguyên) |

Webhook mỗi phút và polling 15 phút cho `Trả hàng`, `Nhà cung cấp`, `Nhập hàng` được giữ nguyên.

## Thiết kế

### Tách tác vụ báo cáo

Tạo ba hàm đồng bộ độc lập trong `CustomerReport.gs`. Mỗi hàm chỉ tải, tổng hợp và ghi dữ liệu cần cho một sheet:

- Báo cáo bán hàng tải hóa đơn, trả hàng và hồ sơ khách hàng.
- Hàng bán theo khách tải hóa đơn trong phạm vi dữ liệu cần thiết và ghi báo cáo 90 ngày.
- Khách theo hàng hóa tải hóa đơn, trả hàng, hồ sơ khách hàng và metadata hàng hóa.

Hàm `syncCustomerReport()` hiện tại vẫn được giữ làm lệnh chạy tay/full sync để cập nhật cả ba sheet trong một lần. Các hàm public hiện có `syncCustomerProductReport()` và `syncCustomerByProductReport()` được đổi sang chỉ cập nhật đúng báo cáo được gọi, thay vì làm mới cả ba sheet.

Mỗi tác vụ dùng script lock để tránh ghi đồng thời. Dữ liệu của sheet chỉ được ghi sau khi tải và tổng hợp thành công; lỗi ở một báo cáo không đánh dấu hai báo cáo còn lại là đã hoàn tất.

### Trigger và trạng thái chạy

Thay một trigger `syncCustomerReport` gần 07:00 bằng ba trigger độc lập gần 06:00, 06:30 và 07:00. Hàm cài đặt trigger phải xóa cả trigger cũ lẫn ba trigger mới hiện có trước khi tạo lại, tránh lịch trùng khi triển khai nhiều lần.

Mỗi báo cáo có thuộc tính `last sync date` riêng. Cơ chế chạy bù từ queue một phút kiểm tra lần lượt các mốc đã đến hạn và chỉ chạy báo cáo chưa thành công trong ngày. Nếu Apps Script hoặc KiotViet tạm lỗi, báo cáo đó được thử lại ở lượt queue sau mà không chạy lại báo cáo đã hoàn tất.

Trigger `Hàng ngừng kinh doanh` được chuyển từ gần 07:00 sang gần 07:30. Nội dung toast và log cài đặt lịch cũng phải phản ánh giờ mới.

Google Apps Script coi `nearMinute()` là thời gian gần đúng, nên khoảng cách thực tế có thể dao động quanh mốc cấu hình. Thiết kế đảm bảo các mốc danh nghĩa cách nhau 30 phút và không dùng lệnh chờ trong một lần thực thi.

### Tương thích và triển khai

- `syncAllInitialData()` tiếp tục gọi `syncCustomerReport()` để tạo đầy đủ ba báo cáo trong lần khởi tạo hoặc chạy tay.
- Webhook `invoice.update` tiếp tục cập nhật gần thời gian thực riêng cho `Hàng bán theo khách`; lịch 06:30 vẫn đối soát toàn bộ báo cáo.
- Các thuộc tính schema hiện tại được giữ và gắn với đúng báo cáo. Thuộc tính ngày đồng bộ chung cũ chỉ dùng cho tương thích chuyển đổi và không được phép làm cả ba tác vụ mới bị bỏ qua.
- Hàm setup hiện có vẫn là điểm vào để cài lại toàn bộ lịch báo cáo, tránh yêu cầu người vận hành gọi nhiều hàm rời rạc.

## Xử lý lỗi

- Không lấy được token, lỗi API hoặc lỗi ghi sheet: ném lỗi, giữ trạng thái chưa hoàn tất và để cơ chế chạy bù thử lại.
- Không lấy được lock: bỏ lượt hiện tại; lượt queue tiếp theo sẽ thử lại.
- Một báo cáo lỗi không ngăn trigger của báo cáo khác chạy ở mốc kế tiếp.
- Việc tạo trigger có tính lặp lại an toàn: luôn dọn các handler liên quan trước khi tạo lịch mới.

## Kiểm thử và tiêu chí hoàn thành

- Kiểm thử tĩnh xác nhận bốn mốc lần lượt là 06:00, 06:30, 07:00 và 07:30, đúng múi giờ Việt Nam.
- Kiểm thử xác nhận không còn trigger báo cáo khách hàng chung gần 07:00 sau khi chạy setup.
- Kiểm thử từng handler chỉ ghi sheet tương ứng.
- Kiểm thử trạng thái ngày độc lập: báo cáo đã thành công không chạy lại, báo cáo lỗi vẫn được chạy bù.
- Chạy bộ test hiện có để bảo đảm webhook hóa đơn vẫn cập nhật `Hàng bán theo khách` và full sync vẫn tạo đủ ba báo cáo.
- Cập nhật hướng dẫn và tài liệu mô tả lịch đồng bộ để khớp với mã nguồn.

