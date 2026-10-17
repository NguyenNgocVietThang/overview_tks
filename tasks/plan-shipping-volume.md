# Kế hoạch: Thể tích (m³) và giá cước nhà xe trong hộp chi tiết đơn (Vòng đời đơn hàng)

## Context

Hộp chi tiết đơn ở tab Vòng đời đơn hàng đã có bảng "Hàng hóa trong đơn" (mã hàng, SL đặt, giá…). Nhân viên đang tính thể tích và cước vận chuyển thủ công trong Google Sheets (sheet "Hoa" tra từ sheet "CÂN ĐO"). Mục tiêu: hộp chi tiết tự tính m³, kg, số thùng và giá cước, theo nhà xe do người dùng chọn (Đức Mạnh / Việt Linh), dữ liệu kích thước đọc trực tiếp từ sheet "CÂN ĐO" khi mở hộp.

Workbook nguồn: `1J5yRJfOjNjzx0akOtog0ro3d5HGPhMTl7LklBWHZPqw` (trùng workbook Vị trí hàng, đã chia sẻ cho service account, đọc được bằng `createReadOnlyClient`).

## Công thức đã đọc từ sheet

**Sheet "CÂN ĐO"** (hàng 1 là tiêu đề, khoảng 4.970 hàng), cột dùng:
A = Mã SP, D = SL/thùng, E = cân nặng (kg/thùng), F/G/H = Dài/Rộng/Cao (cm).

**Sheet "Hoa"** (tra theo mã hàng, `XLOOKUP` lấy hàng khớp đầu tiên, không phân biệt hoa/thường):
- Số thùng = làm tròn(SL / SL-mỗi-thùng).
- M³ mỗi thùng = D×R×C / 1.000.000. M³ mỗi cái = M³ thùng / SL-mỗi-thùng.
- kg mỗi cái = kg thùng / SL-mỗi-thùng.
- Tổng M³ = Σ SL × M³ mỗi cái. Tổng KG = Σ SL × kg mỗi cái.

**Giá cước** (người dùng chốt bản dùng):
- **Đức Mạnh** (550.000đ/m³, 1.833đ/kg, tối thiểu 350.000đ, không phụ thu): cước = max(350.000, m³×550.000, kg×1.833). *(Cập nhật 17/10/2026; trước đây kg×1.330 và ngưỡng 350k bỏ qua cân.)*
- **Việt Linh** (465.000đ/m³, 1.550đ/kg): cước = max(thể tích, kg×1.550), thể tích tính m³×465.000 (m³ ≤ 0,6 thì 500.000). Phụ thu 200.000 khi m³ < 2. Tick "Giao ra chành": +490.000 giao ra chành +70.000 vé chành. *(Cập nhật 17/10/2026.)*
- Không áp dụng "giao ra chành 490k + vé chành 70k" và nhà xe Liên Việt (chỉ là ghi chú trong sheet, người dùng không yêu cầu).

**Lưu ý:** công thức giá cước trong sheet "Hoa" đang trỏ vào ô trống (T3, T4, M9, M19), tức sheet đã lệch hàng. Plan dùng đúng ý nghĩa nghiệp vụ ở trên, không phụ thuộc vị trí ô của "Hoa".

## Quyết định đã chốt với người dùng

- Việt Linh dùng công thức 465k/m³ (không dùng bản max(kg×1330, m³×440k)).
- Thể tích tính theo **SL đặt** của từng dòng.
- Có mã hàng chưa có trong "CÂN ĐO" (hoặc thiếu D/R/C/SL-thùng): **không tính giá cước**, chỉ cảnh báo liệt kê mã thiếu.
- Hiển thị trong hộp chi tiết: dropdown Đức Mạnh / Việt Linh, thêm cột thể tích cho từng mặt hàng, phần tổng thể tích, ghi chú theo nhà xe đã chọn, bảng tính giá cước.
- Mặc định dropdown: Đức Mạnh. Chưa giới hạn quyền ngoài quyền xem hộp chi tiết hiện có (xem lại ở bước duyệt nếu muốn chỉ Quản lý).

## Thiết kế

1. **Backend, đọc sheet**: module mới `server/shipment/measureSheet.js`. Dùng `createReadOnlyClient(getSpreadsheetId, 'Cân đo')`, đọc `CÂN ĐO` (`UNFORMATTED_VALUE`), chỉ số cột tìm theo tiêu đề (cùng cách `stockLocationsService` chuẩn hóa tiêu đề), chỉ tính m³/kg từ D, E, F, G, H bằng JS (không đọc cột công thức). Bảng tra `Map` theo mã chuẩn hóa (trim, hoa/thường), giữ hàng đầu tiên khi trùng. "Thời gian thực" = đọc lại khi mở hộp, có cache ngắn (30 giây) và gộp request đang chạy để không đốt quota Sheets.
2. **Backend, công thức**: module thuần `server/shipment/freightCalculator.js`, hằng số giá đặt ở một chỗ (đổi giá chỉ sửa một nơi). Trả đủ cho cả hai nhà xe cùng lúc để dropdown đổi tức thì ở client.
3. **Backend, API**: mở rộng `readOrderDetail` trong `kiotOrdersRepository.js` (đã trả `lines`), thêm `measure` (mỗi dòng: `m3`, `kg`, `cartons`, `status: ok|missing`) và `freight` (tổng m³/kg/thùng, mã thiếu, `carriers.DM` / `carriers.VL` gồm các bước tính). Bỏ qua dòng dịch vụ/VAT. Nếu đọc sheet lỗi thì fail-soft: `freight.unavailable = true` kèm thông báo, hộp chi tiết vẫn hiện bình thường. Không cần migration.
4. **Frontend**, `server/public/shipment/lifecycle/index.html` (hàm `renderKiotLines`, dùng khung `.dp-*` chung): thêm cột "M³" vào bảng hàng hóa, khối "Thể tích & cước vận chuyển" (dropdown, tổng m³/kg/thùng, ghi chú theo nhà xe, bảng tính cước từng bước), giữ giao diện Sáng/Tối và responsive. Dropdown nhớ lựa chọn trong `localStorage` (bọc try/catch).

## Tasks

Tiêu chí chung: `npm test` trong `server/` xanh, không đổi hành vi của các cột hiện có.

### Task 1: Công thức giá cước (Small)
- Tạo `freightCalculator.js` + test: Đức Mạnh (≤350k, trên ngưỡng, nhánh kg×1330 thắng), Việt Linh (≤0,6 m³ = 500k, >0,6, phụ thu <2 m³, đúng 2 m³ không phụ thu), m³ = 0 → không có cước.
- Xác minh: `node --test freightCalculator.test.js`.
- File: `server/shipment/freightCalculator.js` + test.

### Task 2: Đọc & tra sheet CÂN ĐO (Small)
- Tạo `measureSheet.js` + test (client giả): tìm cột theo tiêu đề, lấy hàng đầu khi trùng mã, không phân biệt hoa/thường, hàng thiếu D/R/C/SL-thùng đánh dấu missing, cache TTL + gộp request đang chạy, lỗi Google → lỗi 503 gọn.
- Thêm `SHIPPING_MEASURE_SPREADSHEET_ID` (mặc định = id Vị trí hàng) và tên sheet vào `config.js` và `.env.example`.
- File: `server/shipment/measureSheet.js` + test, `server/config.js`, `server/.env.example`.

### Task 3: Gắn vào order-detail (Medium) — phụ thuộc 1, 2
- Mở rộng `readOrderDetail`: `lines[].measure` và `freight`; test với Kiot repo giả và sheet giả: đơn đủ dữ liệu, đơn có mã thiếu (không có cước), sheet lỗi (fail-soft), dòng dịch vụ bị bỏ.
- File: `server/shipment/kiotOrdersRepository.js` + test, `server/shipment/orderLifecycleRoutes.test.js`.

**Checkpoint A:** test backend xanh; gọi thử `order-detail` với một đơn thật cho kết quả m³ khớp sheet "Hoa" làm tay (đối chiếu 2–3 đơn).

### Task 4: Giao diện hộp chi tiết (Medium) — phụ thuộc 3
- Dropdown, cột M³, khối tổng, ghi chú, bảng tính cước, cảnh báo mã thiếu; giao diện Sáng/Tối và di động.
- Xác minh bằng harness xem trang không cần đăng nhập (xem memory `reference-tokosi-view-pages-without-login`) và đổi dropdown, chụp ảnh.
- File: `server/public/shipment/lifecycle/index.html` (+ `shared/detail-panel.css` nếu cần class mới).

### Task 5: Đồng bộ tài liệu & kiểm tra cuối (Small)
- Cập nhật `README.md`, `server/README.md` (API + biến môi trường), SRS/BRD, `CURRENT.md`, ngày cập nhật; `npm test`; `graphify update .`.

**Checkpoint B:** toàn bộ test xanh, người dùng xem thử trên đơn thật rồi mới commit.

## Rủi ro

| Rủi ro | Mức | Cách xử lý |
|---|---|---|
| Sheet "CÂN ĐO" đổi tên tab/cột | Trung bình | Tìm theo tiêu đề, lỗi báo rõ, hộp chi tiết vẫn dùng được |
| Nhiều người mở hộp liên tục làm chạm quota Sheets | Thấp | Cache 30 giây + gộp request |
| Mã trùng trong CÂN ĐO (cột "Trùng" tồn tại) | Thấp | Lấy hàng đầu như XLOOKUP của sheet |
| Giá nhà xe đổi | Thấp | Hằng số ở một chỗ trong `freightCalculator.js` |

## Việc dở của đợt khác

`tasks/plan.md` và `tasks/todo.md` còn việc chưa xong của đợt vá đổi email (5 mục chưa tick), nên khi duyệt kế hoạch này tôi lưu bản chi tiết ở `tasks/plan-shipping-volume.md` và `tasks/todo-shipping-volume.md`, không ghi đè.

## Kiểm chứng end-to-end

1. `cd server && npm test` toàn bộ xanh.
2. Chạy harness, mở một đơn thật có dòng hàng, so m³/kg/cước với sheet "Hoa" làm tay cho cả Đức Mạnh và Việt Linh.
3. Đơn có mã thiếu trong CÂN ĐO: hiện cảnh báo, không có giá cước.
4. Tắt quyền đọc sheet (hoặc sai id): hộp chi tiết vẫn hiện, khối cước báo không khả dụng.
5. Kiểm tra Sáng/Tối và màn hình điện thoại.
