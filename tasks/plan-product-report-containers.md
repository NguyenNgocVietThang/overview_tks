# Bổ sung “Hàng dự kiến” vào Báo cáo hàng hóa

Ngày chốt: 15/10/2026. Người dùng đã xác nhận yêu cầu và cho phép triển khai.

## 1. Mục tiêu và hợp đồng nghiệp vụ

Nguồn chỉ đọc: workbook `1T233BdyYBxgSUhR2CwVn2CChgK6Z8OmY8f_s4LalmbE`, các sheet theo thứ tự YIWU, VK-DUNG, HÀ BẮC, SD, GDONG, KHÁC.

- Giữ danh sách mã hiện hành và quy tắc loại mã ngừng kinh doanh.
- Thêm Chưa bốc, Đã bốc trước Tồn HN/Tồn SG, tính chung công ty.
- Chưa bốc cộng O trong CONT trạng thái 1/2; Đã bốc cộng O trong CONT trạng thái 3. Không cộng 4/5.
- Có snapshot nhưng không có hàng: 0. Chưa có snapshot: —.
- Khớp mã bằng trim và không phân biệt hoa/thường; giữ số 0 đầu, dấu gạch, khoảng trắng bên trong.
- Hộp thoại có hai phần đồng thời: Doanh số theo khách ở trên (giữ biểu đồ), Hàng dự kiến ở dưới. Không làm hai tab.
- Giữ từng dòng gốc, không gộp/loại trùng. CONT cùng tên ở các sheet là khối riêng; không hiện sheet nguồn trên bảng.
- Quyền thường xem mọi dòng của mã thuộc 1/2/3: Tên CONT (A dòng CONT), Trạng thái (B), Ngày về (C), Màu sắc (E dòng hàng), Ghi chú sale (F), Tổng số lượng (O).
- Quyền `reports.overview.containers.full`, phụ thuộc Tổng quan, mặc định Quản lý, được ghi đè theo tài khoản: xem ngay 1–5 và đủ 11 cột như ảnh: thêm Người đặt (H), Ngày lên list (L), Số cái/kiện (M), Số kiện (N), Giá hàng về VN (X).
- Giữ nguyên văn bản ngày về; thông tin tùy chọn trống hiện —. Không suy đoán năm/khoảng ngày/cảnh báo trễ.
- Xuất tổng hợp Excel/HTML thêm hai cột số lượng, đúng thứ tự và snapshot web; chưa xuất chi tiết CONT. Giữ quyền xuất hiện hành.

## 2. Parser và snapshot

Đọc A:X với số gốc và giá trị hiển thị cho ngày/văn bản. Không ghi nguồn, không Apps Script.

1. Bỏ dữ liệu trước CONT đầu; nhận CONT từ đầu cột A sau trim, không phân biệt hoa/thường, phải là từ độc lập.
2. CONT mới đóng CONT cũ; lấy A/B/C dòng đánh dấu. Trạng thái nhận số đầu 1–5, gồm `2.Chưa bốc` và `2. Chưa bốc`.
3. Trạng thái ngoài 1–5/trống: bỏ khối, cảnh báo sheet/dòng cho quyền đầy đủ.
4. A bằng END sau trim, không phân biệt hoa/thường: dừng sheet; bỏ dữ liệu sau END.
5. 20 dòng liên tiếp A:X trống đóng CONT; vẫn quét CONT phía dưới. Bỏ dòng sản phẩm cho tới CONT mới. 19 dòng chưa đóng; ghi chú hoặc số 0 ngắt chuỗi trống. Công thức hiển thị rỗng tính là trống.
6. EOF đóng khối cuối; không bỏ dữ liệu vì Sheets API cắt các dòng rỗng cuối.
7. Bỏ tiêu đề lặp. Chỉ dùng O, không dự phòng M×N. O phải hữu hạn, không âm; chấp nhận 0/thập phân. O trống/lỗi/không chuyển được thành số/âm: bỏ dòng cả tổng và chi tiết, cảnh báo quản lý.
8. M/N/X lỗi không làm mất dòng có O hợp lệ, giá trị riêng hiện —. Lưu định danh nội bộ sheet+dòng CONT+dòng sản phẩm.

PostgreSQL lưu snapshot hiện hành và metadata. Các số lượng/giá là NUMERIC. Lưu cả 4/5 phục vụ quản lý, không xây lịch sử nhiều snapshot.

- Đọc đủ 6 sheet mới công bố bằng transaction thay dữ liệu + metadata nguyên tử.
- Một sheet lỗi: giữ toàn bộ snapshot cũ và ghi lỗi kỳ đọc. Lỗi từng dòng/khối xử lý như trên.
- Chu kỳ cố định 7.200.000 ms, độc lập KiotViet. Khởi động đọc nếu chưa có hoặc lần thành công quá 2 tiếng; lỗi thử lại kỳ sau.
- Khóa PostgreSQL dùng chung chống chạy chồng nhiều tiến trình; restart vẫn còn snapshot.
- Cấu hình `PRODUCT_CONTAINER_SPREADSHEET_ID`. Kiểm tra quyền đọc của service account; connector cá nhân đọc được chưa chứng minh service account đọc được.

## 3. API và giao diện

- GET /api/product-report: thêm unloadedQty, loadedQty mỗi dòng, containerSync riêng; giữ computedAt và các số liệu cũ.
- GET /api/product-report/containers?code=: thiếu mã 400, ngoài danh sách hiện hành 404; quyền backend lọc trạng thái và whitelist trường. Chưa có snapshot trả chưa sẵn sàng; không cho query tự nâng quyền.
- GET /api/product-report/containers/meta: chỉ đọc metadata DB, không gọi Sheets.
- Metadata có version, available, lastSuccessAt, lastAttemptAt, stale và lỗi công khai đã làm sạch. Cảnh báo sheet/dòng chỉ cho quyền đầy đủ.
- Hai cột hỗ trợ sort số, ẩn/hiện, kéo rộng; cập nhật colspan/tải/rỗng/lỗi.
- Hiện thời điểm CONT riêng doanh số. Lỗi cập nhật vẫn hiện số cũ kèm thông báo.
- Kiểm tra metadata mỗi 60s khi Tổng quan hiển thị và khi quay lại trang; version mới mới tải dữ liệu; giữ tìm kiếm/sort/trang.
- Hai phần modal tải/lỗi độc lập; giữ chống phản hồi cũ khi đóng/đổi mã, bàn phím/focus, Light/Dark/mobile.
- Chi tiết giữ thứ tự sheet rồi dòng nguồn. Không có dữ liệu hiện thông báo rỗng.
- Xuất số dạng số, null để trống, kèm thời điểm/cảnh báo cũ hoặc chưa sẵn sàng. Không xuất giá/chi tiết trong tổng hợp.

## 4. Thực hiện và kiểm chứng

- [x] Kiểm tra Git/quy định, giữ thay đổi ngoài phạm vi; lưu kế hoạch và prompt.
- [x] Migration 0053, bảng snapshot/metadata/chỉ mục mã; đã kiểm tra bằng PGlite cục bộ và áp DB dùng chung lúc 16:26 ngày 15/10/2026.
- [x] Parser thuần và kiểm thử ranh giới, số lượng, mã.
- [x] Client readonly, transaction, khóa và scheduler 2 tiếng.
- [x] Quyền, API và kiểm thử bảo vệ dữ liệu.
- [x] Hai cột và modal hai phần, cập nhật theo version.
- [x] Excel/HTML đồng nhất web.
- [x] Kiểm thử liên quan, Chrome thật và đối chiếu hai mã từ dữ liệu Sheets thật trên hệ thống kiểm tra cục bộ.
- [x] Kiểm thử toàn bộ cuối `npm test -- --test-concurrency=4`: 2.463 đạt, 3 bỏ qua, 0 lỗi (2.466 tổng), exit 0.
- [x] Đồng bộ tài liệu theo update-file, đồ thị mã nguồn, báo migration/cấu hình/giới hạn. Không tự áp migration DB dùng chung, push/deploy.

Ca bắt buộc: trước CONT/tiêu đề/sau END; đóng khối mới; 19/20 dòng trống; ghi chú/0 ngắt trống; O khác M×N; O lỗi không dự phòng; mã/dòng/CONT trùng; giữ 0 đầu; cộng mẫu 1=100,2=50,3=30,4=20,5=10 => 150/30. Một sheet lỗi/transaction lỗi giữ cũ; restart/chưa đến hạn; hai tiến trình; thành công rỗng khác chưa từng thành công. Sale không nhận cột hạn chế/4/5/cảnh báo nguồn; quyền đầy đủ đủ 11 cột và 1–5; cấp/thu hồi; modal độc lập; response mã cũ; đổi cơ sở không đổi CONT; xuất khớp web.

Nghiệm thu: ít nhất một mã nhiều CONT và một mã nhiều sheet, đối chiếu từng O với tổng; tài khoản thường và đầy đủ cùng mã. Log thời gian/số dòng hợp lệ-bỏ theo sheet/kết quả; không log toàn bộ ghi chú/giá.

## 5. Prompt triển khai cụ thể

```text
Triển khai tính năng “Hàng dự kiến” cho Báo cáo hàng hóa trong tab Tổng quan tại D:\Web TKS Dashboard.
Đọc tasks/plan-product-report-containers.md, coi các quyết định nghiệp vụ là đã được người dùng xác nhận.
Đọc quy định dự án, MEMORY.md, CURRENT.md và git status. Giữ nguyên thay đổi ngoài phạm vi.
Dùng Node.js/Express/CommonJS, PostgreSQL NUMERIC, frontend Vanilla; không thêm framework, không Apps Script, không ghi Sheets.
Nguồn: workbook 1T233BdyYBxgSUhR2CwVn2CChgK6Z8OmY8f_s4LalmbE, đúng 6 sheet YIWU, VK-DUNG, HÀ BẮC, SD, GDONG, KHÁC.
Giữ danh sách mã hiện hành. Thêm Chưa bốc/Đã bốc trước Tồn HN/Tồn SG, cộng O theo trạng thái 1/2 và 3, tổng chung công ty; loại 4/5 khỏi tổng.
Parser CONT A/B/C, END dừng sheet, 20 dòng A:X trống đóng khối nhưng tìm CONT tiếp. Không M×N. Bỏ CONT trạng thái lạ/dòng O lỗi; giữ từng dòng, chuẩn hóa nhẹ mã.
Modal gồm Doanh số theo khách và Hàng dự kiến cùng hiển thị, không hai tab. Backend whitelist 6 cột/1–3 cho quyền thường; quyền reports.overview.containers.full mặc định Quản lý được 11 cột/1–5.
Snapshot PostgreSQL độc lập doanh số, đọc đủ 6 sheet mỗi 2 tiếng, một sheet lỗi giữ toàn bộ bản cũ; metadata và khóa chống chồng. Thêm 2 cột vào xuất Excel/HTML qua cùng repository; chưa xuất chi tiết.
Tích hợp productReportRepository, /api/product-report, modal chung/frontend, featureRegistry, exportService/exportFieldCatalog, client readonly và vòng đời server.
Kiểm thử parser, transaction/scheduler, quyền API, frontend và xuất; npm test toàn server, browser thật, đối chiếu >=2 mã thật. Báo chính xác việc đã/chưa kiểm tra.
Áp dụng update-file và cập nhật tài liệu. Không tự áp migration DB dùng chung, push/deploy.
Đầu ra: thay đổi, kết quả kiểm thử/đối chiếu, migration/cấu hình và giới hạn còn lại.
```

## 6. Bằng chứng kiểm chứng — 15/10/2026

- Service account của ứng dụng đã đọc thành công đủ 6 sheet thật: **11.589 dòng hợp lệ**, **17 cảnh báo** dòng/khối bị bỏ theo quy tắc. Không ghi workbook.
- PGlite cục bộ đã áp migration 0053 và chạy engine đồng bộ thật, nạp đủ 11.589 dòng snapshot. DB dùng chung không bị thay đổi; điều kiện mã được phép trong báo cáo dùng fixture danh mục cục bộ để kiểm tra tích hợp, chưa phải nghiệm thu website đang triển khai.
- **OTD10N:** Chưa bốc **11.880**, Đã bốc **0**; đối chiếu O tại YIWU dòng 52 = 6.000, VK-DUNG dòng 37 = 1.080, KHÁC dòng 83 = 4.800. Mã xuất hiện nhiều CONT và nhiều sheet.
- **TRHB500:** Chưa bốc **2.250**, Đã bốc **300**; YIWU dòng 75 = 650, 183 = 1.000, 297 = 200, 300 = 400; dòng 605 trạng thái 3 = 300. Tổng repository và giao diện Chrome khớp nguồn.
- Chrome headless thật: cùng mã OTD10N, Quản lý ở Light có **11 cột/20 dòng**, Sale ở Dark có **6 cột/3 dòng**. Kiểm tra desktop 1600×1050 và mobile 390×844: **0 lỗi trang**.
- Kiểm thử toàn bộ cuối sau tất cả thay đổi: **2.463 đạt, 3 bỏ qua, 0 lỗi (2.466 tổng)**, `npm test -- --test-concurrency=4`, exit 0. Có kiểm thử rollback SQL thật, thu hồi SELECT mặc định, scheduler theo mốc bền vững và trả focus sau snapshot mới.
- Graphify đã cập nhật sau thay đổi code cuối: **7.195 nút, 14.257 cạnh, 400 cộng đồng**.
- Chưa áp migration DB dùng chung, chưa cấu hình/khởi tạo snapshot trên website đang triển khai, chưa push/deploy. Khi được phép triển khai cần migration, cấu hình nguồn và xác nhận snapshot đầu trên DB đích.

## 7. Áp migration DB đích — 15/10/2026, 16:26 (Asia/Ho_Chi_Minh)

Người dùng đã yêu cầu áp migration. Đã chạy đúng `0053_product_containers.sql` trong transaction và ghi `schema_migrations` (UTC 2026-10-15T09:26:47.586Z). Xác minh hai bảng tồn tại, 24 cột tổng cộng, quantity NUMERIC, singleton đúng một dòng, reporting_readonly không có SELECT trên cả hai bảng. Chưa chạy đồng bộ đầu tiên: version/last_success_at vẫn null. Không push/deploy.

## 8. Kích hoạt và đồng bộ DB thật — 15/10/2026, 16:51 VN

Sửa thiếu cấu hình PRODUCT_CONTAINER_SPREADSHEET_ID trong server/.env. Đã đọc đủ 6 sheet và công bố snapshot 20bbcbed-78de-4193-890a-3855dfa3aa7c vào DB dùng chung: 11.592 dòng, 17 cảnh báo, 4.112 mã báo cáo/1.244 mã có hàng 1–3. OTD10N 11.880 chưa bốc/0 đã bốc; TRHB500 2.250/300. Đã restart Node dashboard localhost:3000 để nạp cấu hình và lịch nền. Xác minh HTTP đáp ứng/giữ xác thực, available=true/stale=false/lastError=null, lần kiểm tra đồng bộ sau trả not-due và hẹn 18:51 VN. Không push/deploy từ xa.
