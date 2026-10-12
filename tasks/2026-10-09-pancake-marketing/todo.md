# Checklist triển khai Pancake Marketing

Cập nhật 09/10/2026. Kế hoạch: [plan.md](plan.md).

## T1 — Xác minh kết nối và tính tương đương nguồn

Trạng thái: T1–T2 đạt; migration 0044 đã áp trên PostgreSQL, đang triển khai nhập lịch sử T3.

- [x] Đọc ba workbook Marketing, cấu trúc THÔ/CHUẨN/CHECK/BC tháng/ADS và bảng Tên.
- [x] Đối chiếu sáu page và ID trực tiếp từ Pancake Dashboard.
- [x] Chốt bộ lọc sao lưu và toàn bộ quy tắc nghiệp vụ với người dùng.
- [x] Kiểm tra cấu hình local: chưa có biến môi trường Pancake.
- [x] Kiểm tra Hữu Nghị: chưa có Public API token; không tạo/đổi token trong giai đoạn lập kế hoạch.
- [x] Người dùng cho phép tạo token cả sáu page; đã lưu đủ sáu token trong server/.env (không theo dõi Git).
- [x] Kiểm tra đọc API có xác thực cho sáu page; Dương Nội cần lọc riêng INBOX/COMMENT.
- [x] Đọc API có xác thực và xác minh endpoint, trường dữ liệu, thứ tự, phân trang, bộ lọc.
- [x] Đối chiếu một file sao lưu đã có; ghi bằng chứng đã che dữ liệu nhạy cảm.
- [x] Cổng nghiệm thu T1 đạt trước khi triển khai T2–T7.

Xác minh: kiểm tra dữ liệu thật, không sử dụng fixture giả để thay kết quả đối soát. Không gửi tin nhắn, thay thẻ, đánh dấu đã đọc hoặc bật webhook. Nếu thiếu dữ liệu, dừng để sửa phương án kết nối theo yêu cầu kế hoạch.

## T2 — Lưu dữ liệu PostgreSQL (phụ thuộc T1)

- [x] Lưu sáu page, bản ghi nguồn, đợt đồng bộ, ngày ghi nhận, ánh xạ nhân viên, BC tháng và lịch sử sửa.
- [x] Kiểm thử nguồn gốc, thứ tự, ràng buộc chống trùng và phiên bản sửa (13 SQL tests; 41 Marketing tests, review độc lập đạt).

## T3 — Nhập lịch sử Sheets (phụ thuộc T2)

- [ ] Nhập sáu THÔ, Tên và BC tháng; giữ ngày ghi nhận, tháng báo cáo và thứ tự.
- [ ] Đối chiếu CHUẨN/CHECK; không ghi nhận lịch sử là số mới ngày chuyển đổi.

## T4 — Đồng bộ 23:55 Việt Nam (phụ thuộc T1–T3)

- [ ] Job nền, chỉ sáu page Facebook; chống chạy trùng và nạp lại cùng bản ghi.
- [ ] Lỗi từng page giữ dữ liệu cũ; có thời điểm thành công và lỗi an toàn.
- [ ] Kiểm thử retry, nửa đêm/cuối tháng và ngày ghi nhận bất biến khi chạy lại.

## T5 — SĐT và KPI từ PostgreSQL (phụ thuộc T3–T4)

- [ ] Giữ công thức, bộ lọc/chi tiết/xuất file, tính lại tháng cũ.
- [ ] Kiểm thử cùng SĐT khác page, nhiều tên một người, người trống/chưa ánh xạ và tỷ lệ mẫu số 0.

## T6 — BC tháng nhập web (phụ thuộc T2–T3)

- [ ] Quản lý tạo/sửa, chọn khách KiotViet; tháng báo cáo riêng ngày chốt.
- [ ] Nhật ký chỉnh sửa, kiểm tra phiên bản; API chặn Marketing ghi.
- [ ] Kiểm thử doanh số, quyền, xung đột và nhập lịch sử.

## T7 — Nghiệm thu và chuyển nguồn (phụ thuộc T4–T6)

- [ ] Ít nhất ba đợt hằng ngày đối soát sáu page.
- [ ] Công tắc quay nguồn cũ; ADS vẫn đọc Sheets gồm Quảng Châu.
- [ ] Kiểm tra Excel/HTML, điện thoại, bộ kiểm thử dự án và cập nhật tài liệu thực sự bị ảnh hưởng.

Migration 0044 áp sau T1 và review T2. Job, nhập lịch sử và chuyển nguồn đang triển khai; nguồn chính thức giữ Sheets trong nghiệm thu.
