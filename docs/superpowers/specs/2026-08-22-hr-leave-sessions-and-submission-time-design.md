# Thiết kế nghỉ phép theo buổi và thời gian gửi

## Mục tiêu

Thay hoàn toàn mô hình nghỉ theo giờ bằng mô hình Sáng/Chiều, đồng bộ dữ liệu giữa Telegram Bot, Google Sheet, API, xuất Excel và tab Nghỉ phép trên web. Danh sách web hiển thị thời gian gửi và bộ lọc ngày lọc theo chính trường này.

## Schema Google Sheet

Tab yêu cầu nghỉ phép bỏ hai cột `Tổng giờ nghỉ` và mô hình ngày giờ cũ. Các trường nghiệp vụ mới là:

- `Thời gian gửi`: thời điểm bot nhận lệnh `/xinnghi`, lưu dạng ISO để lọc và sắp xếp ổn định; web định dạng lại theo múi giờ người dùng.
- `Thời gian bắt đầu`: chuỗi `Sáng dd/mm/yyyy` hoặc `Chiều dd/mm/yyyy`.
- `Thời gian kết thúc`: chuỗi `Sáng dd/mm/yyyy` hoặc `Chiều dd/mm/yyyy`.
- `Tổng buổi nghỉ`: số buổi nguyên từ đầu buổi bắt đầu đến cuối buổi kết thúc.
- `Tổng ngày nghỉ quy đổi`: `Tổng buổi nghỉ / 2`.

Các cột nhận dạng người gửi, lý do, bàn giao, phê duyệt, cờ nghỉ gấp, cờ tự ý nghỉ và audit vẫn được giữ. Script `setupHrSheet.js` sử dụng đúng schema mới; việc chạy chế độ reset trên Google Sheet thật là thao tác phá hủy riêng và không nằm trong lần sửa code này.

## Tính số buổi

`computeDurationSessions(startDate, startSession, endDate, endSession)` trả về số **buổi**, không trả về số ngày.

- Mỗi ngày có hai buổi: Sáng và Chiều.
- Khoảng tính bao gồm từ đầu buổi bắt đầu đến cuối buổi kết thúc.
- Ngày kết thúc trước ngày bắt đầu hoặc Chiều → Sáng trong cùng ngày là không hợp lệ (trả về `null`).
- Số ngày quy đổi luôn bằng số buổi chia 2.

Ví dụ:

- Sáng → Sáng cùng ngày: 1 buổi (0,5 ngày).
- Chiều → Chiều cùng ngày: 1 buổi (0,5 ngày).
- Sáng → Chiều cùng ngày: 2 buổi (1 ngày).
- Chiều hôm trước → Sáng hôm sau: 2 buổi (1 ngày).
- Sáng hôm trước → Chiều hôm sau: 4 buổi (2 ngày).
- Chiều hôm nay → Sáng 2 ngày sau: 4 buổi (2 ngày).
- Sáng 22/08/2026 → Chiều 25/08/2026: 8 buổi (4 ngày).

## Luồng Telegram

Bot dùng các bước `AWAITING_START_DATE`, `AWAITING_START_SESSION`, `AWAITING_END_DATE`, `AWAITING_END_SESSION`. Ngày kết thúc để trống hoặc nhập `-` sẽ dùng ngày bắt đầu. `normalizeSession` chấp nhận các biến thể không dấu, viết tắt và tiếng Anh đã thống nhất.

Deduplicate dùng khóa ghép `chatId:messageId`, vì `message_id` chỉ đơn điệu trong từng chat. Bộ nhớ deduplicate có giới hạn để không tăng vô hạn. Lệnh slash do `onText` xử lý không được đi tiếp vào handler hội thoại chung; tin nhắn thường được xếp hàng theo từng chat để hai câu trả lời đến gần nhau không ghi đè trạng thái.

Mốc bắt đầu quy ước:

- Sáng: 07:45 ngày bắt đầu.
- Chiều: 12:30 ngày bắt đầu.

`Thời gian gửi` là thời điểm bot nhận `/xinnghi`, không phải thời điểm nhấn nút xác nhận. Nếu thời gian gửi **sau** mốc bắt đầu (bằng mốc vẫn hợp lệ), bot đánh dấu đơn không hợp lệ, hiển thị cảnh báo rõ trong phần tóm tắt nhưng vẫn giữ nút gửi. Khi người dùng xác nhận gửi, đơn vẫn được ghi Google Sheet với trạng thái `Vi phạm`. Đơn hợp lệ dùng trạng thái `Chờ duyệt` như hiện tại.

Tóm tắt xác nhận hiển thị:

```text
- Từ: Sáng 22/08/2026
- Đến: Chiều 25/08/2026
- Tổng buổi nghỉ: 8 buổi (4 ngày)
```

Nếu vi phạm thời điểm gửi, tóm tắt thêm cảnh báo và giải thích mốc 07:45/12:30 tương ứng.

## API, web và xuất Excel

- Repository thay `thoi_gian_nhan`, `tong_gio_nghi` bằng `thoi_gian_gui`, `tong_buoi_nghi`; `tong_ngay_nghi` được suy ra từ số buổi tại server.
- `GET /api/hr/leave-requests?from=&to=` lọc theo ngày của `thoi_gian_gui`, bao gồm cả hai đầu khoảng.
- Export Excel truyền cùng bộ lọc và xuất schema mới.
- Bảng web thêm cột `Thời gian gửi`; giá trị được định dạng ngày giờ dễ đọc.
- Nhãn bộ lọc nói rõ lọc theo thời gian gửi và mặc định 3 ngày gần đây.
- Form quản lý nhập tay dùng ngày + buổi, không còn trường giờ; server tự tính số buổi và áp dụng loại trừ Chủ nhật.
- Trạng thái `Vi phạm` có badge riêng và không hiển thị hành động duyệt/từ chối như đơn `Chờ duyệt`.

## Khôi phục hội thoại và lỗi đầu vào

`conversationStore.reviveDates` phục hồi `startDate` và `endDate` từ ISO thành `Date`, đồng thời giữ hỗ trợ `start`/`end` cũ để phiên đang dở không gây lỗi trong giai đoạn triển khai.

Parser ngày kiểm tra ngày lịch thực tế, nên các giá trị như `31/02/2026` bị từ chối. Lỗi gửi Telegram không làm mất trạng thái đã nhập; lỗi ghi Sheet được báo cho người dùng và cho phép thử xác nhận lại.

## Kiểm thử

- Unit test bảng trường hợp tính buổi: Sáng-Sáng, Chiều-Chiều, Sáng-Chiều cùng ngày, Chiều hôm trước - Sáng hôm sau, nhiều ngày liên tiếp và các trường hợp đầu vào không hợp lệ.
- Unit test mốc 07:45/12:30, gồm trước, bằng và sau mốc; xác nhận trạng thái `Vi phạm` vẫn được ghi.
- Test parser ngày, chuẩn hóa buổi, deduplicate giữa `onText` và handler `message`, và queue theo chat.
- Test khôi phục `startDate`/`endDate` sau khi reload store.
- Test repository schema, lọc theo `thoi_gian_gui`, route nhập tay và export.
- Test DOM cho cột thời gian gửi, URL bộ lọc và trạng thái `Vi phạm`.

## Ngoài phạm vi

- Không tự chạy reset hoặc xóa dữ liệu trên Google Sheet thật.
- Không chuyển đổi lịch sử dữ liệu theo giờ sang dữ liệu theo buổi.
