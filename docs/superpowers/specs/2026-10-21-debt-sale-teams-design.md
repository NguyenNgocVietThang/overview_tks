# Nhóm sale trong tab Công nợ

Ngày: 21/10/2026. Phạm vi và phương án đã được người dùng đồng ý trong chat.

- Ba bảng chính: Kiểm tra công nợ, Thưởng/phạt sale theo công nợ, Quản lý công nợ.
- Thêm cột Nhóm sale cạnh Sale và dropdown lọc độc lập, kết hợp các bộ lọc hiện có.
- Nhóm là team đang quản lý trong tab Khách hàng, tra bảng `sale_teams` bằng chuẩn tên `businessMonths.nameKey`; thiếu nhóm hiển thị `Chưa có team`.
- Tra nhóm sau cache/bản chốt, không sao chép cột vào bảng công nợ. Đổi nhóm tăng version Công nợ và phát sự kiện cập nhật; không đổi số tiền/hạng đã chốt.
- Excel và HTML cùng có cột nhóm và dùng bộ lọc nhóm đang chọn. HTML tổng hợp theo nhóm từ các dòng được xuất; thay đổi tìm kiếm trong HTML tính lại biểu đồ trên các dòng hiện tại.
- Biểu đồ HTML: nợ hiện tại/nợ quá hạn cho bảng khách; phạt phải nộp/thưởng cho bảng thưởng/phạt. Không phân bổ lại quỹ hoặc xếp hạng khi lọc.
- Ngoài phạm vi: bảng chi tiết, sửa nhóm tại Công nợ, thay đổi công thức tiền, migration DB, triển khai production.

Kiểm chứng: PGlite đổi team khi giữ nguyên cached rows và finalized rewards; JSDOM lọc cả ba bảng, context xuất, tổng tiền; nạp ExcelJS và chạy HTML tự chứa để xác minh file xuất; toàn bộ unit tests và diff check.
