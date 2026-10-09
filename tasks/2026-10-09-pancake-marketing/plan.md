# Tự động hóa báo cáo Marketing từ Pancake

Ngày: 09/10/2026 (Asia/Ho_Chi_Minh). Kế hoạch đã được người dùng yêu cầu triển khai.

## Quyết định nghiệp vụ

- Thu thập sáu Fanpage Facebook; loại Zalo:

| Nhóm | Facebook Page ID |
|---|---|
| Hữu Nghị | 1184366971419195 |
| Tân Thanh | 1144127138790204 |
| Bắc Lãm | 430840296781378 |
| Phú Lương | 1094883173717378 |
| HN–SG | 1222318524308489 |
| Dương Nội | 1387564787764418 |

- Đồng bộ nền mỗi ngày lúc 23:55, giờ Việt Nam, độc lập với việc mở dashboard.
- Thay nguồn Sheets cho SĐT, tỷ lệ nhận số và BC tháng; chi phí ADS tiếp tục đọc Sheets, gồm khối Quảng Châu.
- Nhập lịch sử Sheets một lần trước khi chuyển nguồn. Không ghi nhận lịch sử là dữ liệu mới của ngày chuyển đổi.
- Chỉ Quản lý được tạo/sửa BC tháng; doanh số tiếp tục lấy KiotViet.
- Các tháng cũ luôn tính lại khi dữ liệu hoặc ánh xạ liên quan thay đổi.

## Quy tắc dữ liệu

- Đối chiếu với Thống kê → Sao lưu → Tin nhắn từ hội thoại: Bình luận + Hộp thư + Có số điện thoại; bỏ Tin nhắn gửi bởi trang.
- Lưu riêng Tạo lúc và ngày ghi nhận báo cáo. Dữ liệu mới ghi nhận theo ngày đồng bộ thành công; lịch sử giữ Ngày lên/Ngày.
- Mỗi SĐT có một dòng trong từng page. Lấy nhân viên lần đầu từ bản ghi đầu và hiện tại từ bản ghi cuối theo thứ tự nguồn.
- Khác nhân viên mới tính chào lại; ngày chào lại chỉ có khi ngày đầu/cuối khác nhau. Quy đổi = lần đầu + chào lại / 5.
- Ánh xạ tên Pancake sang tên báo cáo sau khi xác định người đầu/cuối, gồm nhiều tên thuộc cùng một nhân viên.
- Tỷ lệ chốt = khách chốt / tổng quy đổi tương ứng; mẫu số bằng 0 hiển thị —. Không cộng tỷ lệ riêng lẻ.
- BC tháng nhập sale, khách KiotViet, SĐT, page, tình trạng, nguồn data, ngày chốt, Khách mới và ghi chú. Lưu tháng báo cáo riêng với ngày chốt.
- SĐT thiếu nhân viên hoặc chưa ánh xạ vẫn lưu và hiển thị, không tự gán.

## Thứ tự triển khai và cổng nghiệm thu

1. Xác minh Public API bằng dữ liệu thật và một file sao lưu đã có: trường dữ liệu, bộ lọc, thứ tự, phân trang, phạm vi Facebook và chống lấy trùng. Nếu API thiếu dữ liệu, dừng để sửa phương án kết nối trước khi xây tiếp.
2. Lưu PostgreSQL: page, bản ghi nguồn, đợt đồng bộ, ngày ghi nhận, ánh xạ nhân viên, BC tháng và lịch sử sửa.
3. Nhập sáu tab THÔ, bảng Tên và BC tháng; đối chiếu CHUẨN/CHECK, liệt kê chênh lệch. Giữ thứ tự, ngày lịch sử và nguồn gốc.
4. Đồng bộ hằng ngày trong backend: chống chạy trùng, nạp lại không đổi ngày ghi nhận; trạng thái riêng từng page; lỗi giữ dữ liệu cũ.
5. Chuyển SĐT/KPI sang nguồn mới: giữ bộ lọc, chi tiết, xuất file và tính lại tháng cũ; tổng truy được xuống từng dòng.
6. Nhập BC tháng trên web: chỉ Quản lý, chọn khách KiotViet, lưu lịch sử, kiểm tra phiên bản chống sửa đè.
7. Đối soát ít nhất ba đợt hằng ngày trên sáu page trước chuyển nguồn chính thức; giữ công tắc quay về nguồn cũ trong nghiệm thu.

## API và kiểm thử

- Giữ API đọc /api/marketing-report/*; bổ sung tháng/năm và trạng thái đồng bộ từng page.
- Ghi BC tháng sử dụng ID bản ghi và phiên bản chỉnh sửa thay cho địa chỉ ô Sheets.
- Kiểm thử cùng SĐT ở hai page, cùng/khác nhân viên, nhiều tên một người, thiếu nhân viên, chạy lại, lỗi một page, qua nửa đêm/cuối tháng.
- Tạo 27/9 và ghi nhận 1/10 phải vào KPI tháng 10. Dữ liệu mới có thể thay đổi tháng cũ.
- Kiểm tra nhập lịch sử, quyền API/UI, doanh số KiotViet, Excel/HTML, điện thoại và ADS giữ Sheets.

## Vận hành

- Sau 23:55, dữ liệu phát sinh được ghi nhận ở lần chạy tiếp theo.
- Token chỉ lưu phía máy chủ, không commit hoặc đưa ra frontend. Không cần webhook.
- Checklist: [todo.md](todo.md). Bằng chứng xác minh: [verification.md](verification.md).
- Không ghi đè tasks/plan.md hoặc tasks/todo.md hiện có, không sửa thay đổi ngoài phạm vi.
