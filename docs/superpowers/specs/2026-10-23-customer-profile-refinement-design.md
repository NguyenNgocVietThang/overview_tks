# Cập nhật Chi tiết khách — 23/10/2026

Thiết kế đã được người dùng duyệt qua demo trong chat. Thay thế các mô tả giao diện/quyền sửa quy mô tương ứng của spec 22/10/2026. Trạng thái: mã đã commit trên main; migration 0084 đã áp DB dùng chung (23/10/2026), chưa deploy.

## Giao diện
- Trên: hai cột Thông tin chung / Note. Thông tin chung có Định vị kho, Số lượng kho, Diện tích (text), Đối thủ rộng hết hàng, Hình thức bán hàng chọn nhiều thêm Khác. Text dài xuống dòng; textarea tăng chiều cao cả khi nhập và khi đổi chiều rộng.
- Note: mới nhất ở trên, vùng lịch sử cuộn dọc riêng tối đa 360px; khung soạn nằm ngoài vùng cuộn. Giữ giới hạn một note/khách/ngày và chỉ sửa trong ngày VN.
- Dưới: ba nhóm cạnh nhau Người được sửa / Quản lý đánh giá quy mô / Tiếp khách lần cuối; dropdown người sửa tối đa 260px, quy mô tối đa 220px, nút lưu riêng bên dưới. Màn hình ≤860px xếp dọc.
- Lịch luôn hiện tháng, rộng 276px desktop; ô ngày vuông 36px (44px cảm ứng, lịch 332px nếu đủ chỗ), bo góc. Ngày thường chỉ hiện số; chỉ ngày chọn có viền, ngày tương lai khóa. Giữ Các ngày đã đi và Lưu/Hủy. Cột Tiếp khách lần cuối ngoài bảng chỉ hiển thị ngày, không nút lịch.
- Ảnh thu nhỏ không có nút chuyển. Bấm ảnh mở xem lớn: nút trước/sau, chỉ số ảnh, phím trái/phải; đến đầu/cuối vô hiệu nút, một ảnh ẩn nút. Esc đóng ảnh lớn trước và trả focus về ảnh thu nhỏ.

## Dữ liệu và quyền
- `area`: chuỗi mặc định rỗng, tối đa 500 ký tự; thêm `khac` vào kênh bán, `very_large` vào quy mô.
- Chỉ Quản lý (`customerNotes` + `customerManage`) lưu quy mô qua `PUT /api/business-report/customer-profile/scale`, body `{ key, warehouseScale }`, trả `{ warehouseScale }`.
- PUT thông tin chung nhận `{ key, warehouseLocation, warehouseCount, area, competitor, salesChannels }`; bỏ qua warehouseScale nếu gửi kèm. Hai thao tác upsert chỉ cập nhật nhóm cột tương ứng để không ghi đè nhau.
- Migration `0084_customer_profile_details.sql` bổ sung area, mở rộng hai CHECK, chạy lại được và giữ dữ liệu cũ; không sửa migration 0080. Chưa có migration: giữ cơ chế đọc rỗng/ghi 503 MIGRATION_PENDING hiện hữu.

## Kiểm chứng
Repository/PGlite và route kiểm tra migration, dữ liệu cũ, area 500/501 ký tự, enum mới, quyền và lưu đồng thời. JSDOM kiểm tra form, payload, Note, trạng thái lỗi, gallery/focus, resize. Chrome desktop/mobile dùng dữ liệu giả kiểm tra ba nhóm, ô ngày vuông, Note 360px, text không bị che và không tràn ngang. Không áp DB thật hoặc deploy.
