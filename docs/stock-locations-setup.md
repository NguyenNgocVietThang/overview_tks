# Vị trí hàng — cấu hình và nghiệm thu

## Cấu hình nguồn

**Ánh xạ SG đã được xác nhận:** cột nguồn `TỔNG SL đã đi` chính là số lượng hiển thị dưới tên `Tổng SL` trên giao diện. Không cần đổi tên hoặc bổ sung cột trong Google Sheets.

Đặt `STOCK_LOCATIONS_SPREADSHEET_ID=1J5yRJfOjNjzx0akOtog0ro3d5HGPhMTl7LklBWHZPqw` trong môi trường máy chủ và khởi động lại. Biến optional: thiếu cấu hình chỉ làm tính năng trả 503, không làm ngừng dashboard. Không cần migration hoặc thư viện mới.

Chia sẻ [workbook nguồn](https://docs.google.com/spreadsheets/d/1J5yRJfOjNjzx0akOtog0ro3d5HGPhMTl7LklBWHZPqw/edit) cho service account trong `GOOGLE_SERVICE_ACCOUNT_JSON` với quyền **Viewer**. Service account local là `tokosi@tokosi.iam.gserviceaccount.com`; kiểm tra địa chỉ production nếu dùng tài khoản khác. Không cần công khai workbook hoặc quyền Editor.

Sau khi người dùng cấp Viewer ngày 03/10/2026, đã đọc được workbook **SALE + KẾ TOÁN TOKOSI**. Tab HN thực tế có tên `VỊ TRÍ HN`; tên tab được so khớp không phân biệt hoa/thường/khoảng trắng, sử dụng tên thực tế trả về từ Google. Đã xác minh cả hai cơ sở qua service: **HN 11.519 dòng, SG 8.439 dòng** trong lần đọc này (số dòng thay đổi theo nguồn). Mẫu SG `ADN3LYU` có Tổng SL `15`, ghi chú `1tx15`, vị trí `36`; `APTH10` có Tổng SL `40`, vị trí `37`.

Trên máy Windows có proxy TLS, lệnh xác minh có thể cần kho chứng chỉ hệ thống (`node --use-system-ca` nếu runtime hỗ trợ); không tắt xác minh TLS.

## Giao diện và phân quyền

Trang `/stock-locations/#hn|sg` có nhóm sidebar Vị trí hàng riêng. Bộ chọn Hà Nội/Sài Gòn chỉ hiện tab tương ứng; Cả hai hiện hai tab và mặc định HN. Hash không phù hợp tự chuyển về tab hợp lệ. Tab con cũng xuất hiện trên sidebar của các trang khác.

Quyền `stockLocations.view` mặc định cho mọi vai trò nội bộ, áp dụng cả tài khoản cũ/mới. Khách bị chặn dù override có giá trị true; API quản trị từ chối cấp và form vô hiệu hóa lựa chọn. Nhân viên vẫn có thể bị Quản lý thu hồi quyền riêng theo cơ chế hiện tại.

| Trường API / cột bảng | Vị trí HN | Vị trí SG |
|---|---|---|
| `code` / Mã hàng | MÃ SẢN PHẨM | Mã hàng |
| `name` / Tên hàng | TÊN SẢN PHẨM | Tên hàng |
| `totalQuantity` / Tổng SL | TỔNG SL | TỔNG SL đã đi |
| `notes` / Ghi chú hàng hóa | MÔ TẢ | Ghi chú hàng hóa |
| `location` / Vị trí | KHU | Vị trí |

Hàng/cột header được nhận diện theo tên, bỏ qua hoa/thường và khoảng trắng thừa. Giá trị dữ liệu là chuỗi `FORMATTED_VALUE`, giữ mã có số 0 đầu, định dạng số và xuống dòng. Mỗi dòng có mã hoặc tên là một dòng riêng theo thứ tự nguồn, giữ SL = 0/vị trí trống; không gộp mã trùng.

Tìm kiếm chỉ xét mã/tên, không phân biệt hoa/thường/dấu tiếng Việt, lọc toàn bộ dữ liệu trước phân trang 100 dòng. Mỗi tab giữ từ khóa và trang riêng; từ khóa mới về trang 1; dữ liệu mới ít hơn thì chuyển về trang cuối hợp lệ. Không xuất file, sửa dữ liệu, tải định kỳ hoặc lưu Postgres.

## API và lỗi

`GET /api/stock-locations?branch=HN|SG` trả `{ branch: "HN" | "SG", rows: [{ code, name, totalQuantity, notes, location }] }`. Request cần đăng nhập, quyền tính năng, cơ sở yêu cầu thuộc phạm vi bộ chọn; chỉ đọc sheet được yêu cầu. Branch thiếu/không hợp lệ: 400; ngoài phạm vi/thiếu quyền: 403. Thành công trả `Cache-Control: no-store`.

Chỉ gộp lượt đọc đang chạy của cùng workbook/cơ sở; xóa lượt đọc khi hoàn thành hoặc lỗi để lần mở sau đọc mới. Metadata tên sheet dùng cache 5 phút của client chung, giá trị ô không được cache. Mở lại tab đang chọn cũng đọc mới, không có timer.

Lỗi nguồn trả 503 và hiện rõ: `STOCK_LOCATIONS_NOT_CONFIGURED`, `STOCK_LOCATIONS_SHEET_MISSING`, `STOCK_LOCATIONS_HEADERS_MISSING`, `STOCK_LOCATIONS_SOURCE_UNAVAILABLE`. Sheet có header hợp lệ nhưng không có hàng là bảng rỗng; thiếu header là lỗi. Không gửi lỗi Google thô/thông tin xác thực về trình duyệt.

## Kiểm tra triển khai

1. Cấu hình workbook và service account ở máy chủ; restart và kiểm tra HN/SG bằng tài khoản nhân viên.
2. Đối chiếu năm cột với sheet, mã có số 0 đầu, ghi chú xuống dòng, SL = 0 và vị trí trống.
3. Kiểm tra ba chế độ cơ sở, hash, tìm kiếm có/không dấu, trang thứ hai và trạng thái riêng từng tab.
4. Đổi một ô bằng tài khoản có quyền sửa nguồn rồi mở lại tab: ô mới hiển thị; không có lượt tải định kỳ.
5. Khách không có menu, mở URL bị điều hướng, API trả 403; API quản trị từ chối grant với 400.
6. Chạy `npm test` trong `server/`; tests tính năng tại `stockLocations/*.test.js` và `test/frontend/stock-locations.test.js`. Kiểm thử tự động không thay dữ liệu sheet.
