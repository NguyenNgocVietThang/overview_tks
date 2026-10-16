# Danh sách việc: vá đổi email + dọn BE/FE (2026-10-05)

**Trạng thái 2026-10-09:** T1–T15 đã làm và commit trên main (toàn bộ test auth & dọn dẹp đều đạt). Các hạng mục tiếp nối sau đó bao gồm Báo cáo kinh doanh (migration 0036-0037), Báo cáo Marketing (kết nối KiotViet & sửa ngược Sheets), Sổ quỹ (0033-0035), Lịch làm việc & Hạn đăng ký nghỉ phép (0038, 0042), Trạng thái nhân sự & Phúc lợi (0039, 0041), Lịch sử tài khoản (0040) và Table controls dùng chung đều đã hoàn thiện và cập nhật đồng bộ.

Thiết kế, rủi ro và quyết định đã chốt: xem [plan.md](plan.md).
Lệnh test (chạy trong `server/`; `node --test` cần glob):
`node --max-old-space-size=4096 --test "auth/**/*.test.js"`, đổi glob theo thư mục. Chạy cả bộ: `npm test`.

---

## Giai đoạn 1: Vá bảo mật (commit + deploy riêng)

### T0: Kiểm tra DB đã bị khai thác chưa (chỉ đọc)
**Mô tả:** Soạn câu SQL chỉ đọc, tìm TK có dấu hiệu bị gắn sai nhân sự: `app_users.email` khác `hr_employees.email` của dòng `hr_employee_id`; `role_source='sheet'` mà vai trò khác `sheetVaiTro` của dòng đang gắn; TK `hrManaged` có SĐT rỗng; nhiều TK cùng khớp một nhân sự.
**Tiêu chí:**
- [x] Có file SQL trong scratchpad/`tasks/`, chỉ `SELECT`
- [ ] Người dùng chạy và báo kết quả. Nếu có TK nghi vấn, Quản lý xử lý tay trước khi deploy T1
**Xác minh:** người dùng xác nhận kết quả
**Phụ thuộc:** không · **File:** `tasks/audit-hr-binding.sql` · **Cỡ:** XS

### T1: Resolver không gắn lại TK sang nhân sự khác
**Mô tả:** Trong `resolveUser`, nếu `user.hrManaged` và `user.hrRowIndex` đã có mà nhân sự khớp được có `rowIndex` khác, thì không dùng dòng mới: giữ nguyên vai trò/cơ sở/email, `console.warn` kèm id TK và hai rowIndex. Cũng không để TK đó gây `HR_IDENTITY_CONFLICT` cho TK thật của nhân sự kia (trong `findAccountForEmployee`, ưu tiên TK có `hrRowIndex` trùng `employee.rowIndex`).
**Tiêu chí:**
- [x] Test: TK Sale (`hrRowIndex=A`) đổi email sang email Quản lý (`rowIndex=B`) → vẫn là Sale, `hrRowIndex` vẫn là A
- [x] Test: TK Quản lý thật (`hrRowIndex=B`) vẫn resolve bình thường khi có TK khác trùng email (hết DoS)
- [x] Test: TK mới chưa gắn khớp lần đầu vẫn gắn như cũ; Quản lý đổi email qua `adminChange` vẫn giữ ràng buộc
**Xác minh:** `node --test "auth/**/*.test.js"`
**Phụ thuộc:** không · **File:** `server/auth/effectiveUserResolver.js`, `server/auth/effectiveUserResolver.test.js` · **Cỡ:** S

### T2: `POST /api/auth/profile` không đổi email
**Mô tả:** Email gửi lên khác email hiện tại (không phân biệt hoa thường): TK `hrManaged` → 403 `EMAIL_CHANGE_LOCKED` ("Liên hệ Quản lý để đổi email"); TK thường → 409 `EMAIL_CHANGE_REQUIRES_OTP`. Bỏ `email` khỏi `fields` ghi xuống. Bỏ trường `email` hoặc gửi đúng email cũ vẫn lưu được họ tên/Telegram.
**Tiêu chí:**
- [x] Test hai mã lỗi trên; DB không đổi email
- [x] Test: đổi họ tên với email giữ nguyên/không gửi vẫn 200
**Xác minh:** `node --test "auth/**/*.test.js"`
**Phụ thuộc:** không · **File:** `server/auth/authRoutes.js`, `server/auth/authRoutes.test.js`, `server/auth/profileTelegram.test.js` · **Cỡ:** S

### T3: `contact-change` dành cho TK không gắn nhân sự
**Mô tả:** Đảo điều kiện: `beginChange`/`confirmChange` từ chối TK `hrManaged` (403 `EMAIL_CHANGE_LOCKED`) và nhận TK thường. `confirmChange` chỉ ghi `app_users` (`email`, `verifiedEmail: true`), không đụng `hr_employees`. Giữ kiểm trùng email/username với TK khác. `adminChange` giữ nguyên cho TK HR.
**Tiêu chí:**
- [x] Test: TK Khách xin OTP → xác minh → email đổi, `verifiedEmail=true`
- [x] Test: TK HR gọi `contact-change` → 403; OTP sai/hết hạn → lỗi, email không đổi
- [x] Test: route `/verify` vẫn ký lại cookie với user đã resolve
**Xác minh:** `node --test "auth/**/*.test.js"`
**Phụ thuộc:** không · **File:** `server/auth/contactChangeService.js`, `server/auth/contactChangeService.test.js`, `server/auth/authRoutes.test.js` · **Cỡ:** S

### T4: Form hồ sơ: email chỉ đọc (HR) / đổi qua OTP (TK thường)
**Mô tả:** Trong `public/account/index.html`: TK `hrManaged` (lấy từ `/api/auth/profile`, thêm cờ vào `publicProfile` nếu thiếu) → ô email `readonly` kèm gợi ý "Liên hệ Quản lý". TK thường → nút "Đổi email" mở hộp nhập email mới → `contact-change` → nhập OTP → `contact-change/verify`. `handleSaveProfile` không gửi `email` nữa.
**Tiêu chí:**
- [x] HR: không có cách nào gửi email mới từ form
- [x] TK thường: luồng OTP chạy hết vòng, hiển thị lỗi cooldown (`waitSeconds`)
- [x] Test frontend trích code từ HTML (theo quy ước dự án) phủ hai nhánh
**Xác minh:** `node --test "test/frontend/*.test.js"`; xem trên preview bằng harness không đăng nhập (memory `reference-tokosi-view-pages-without-login`), chụp cả hai loại TK
**Phụ thuộc:** T2, T3 · **File:** `server/public/account/index.html`, `server/auth/authRoutes.js` (publicProfile), `server/test/frontend/profile-telegram.test.js` (+ có thể thêm `profile-email-change.test.js`) · **Cỡ:** M

### T5: `POST /api/auth/recovery` bỏ trường SĐT
**Mô tả:** Xóa nhánh `soDienThoai` (đọc, kiểm, kiểm trùng, ghi). Body có `soDienThoai` thì bỏ qua (hoặc 400, chọn 400 để lộ lỗi sớm). Sửa docblock.
**Tiêu chí:**
- [x] Test: gửi `soDienThoai: ""` hoặc số khác → SĐT trong DB không đổi
- [x] Test: đổi email khôi phục vẫn chạy
**Xác minh:** `node --test "auth/**/*.test.js"`
**Phụ thuộc:** không · **File:** `server/auth/authRoutes.js`, `server/auth/authRoutes.test.js` · **Cỡ:** XS

### T6: Sửa lỗi Quản lý đổi SĐT TK nhân sự
**Mô tả:** `contactChangeService.normalize` chỉ nhận `'email'`, nên `adminChange(…, 'phone', …)` từ `adminUserRoutes.js:280` luôn lỗi 400. Thêm nhánh `phone` (chuẩn hóa như `normalizePhone`, kiểm trùng SĐT với TK khác), `adminChange` ghi `soDienThoai` (và `verifiedPhone`) thay vì luôn ghi `email`. Kiểm `employeeDirectory.updateEmployeeContact` có nhận `'phone'` không.
**Tiêu chí:**
- [x] Test: Quản lý đổi SĐT TK HR → `app_users` và `hr_employees` cùng cập nhật, ràng buộc `hrRowIndex` không đổi
- [x] Test: SĐT trùng TK khác → 409
**Xác minh:** `node --test "auth/**/*.test.js"`
**Phụ thuộc:** không (nên xong cùng T5) · **File:** `server/auth/contactChangeService.js`, `server/auth/contactChangeService.test.js`, `server/auth/adminUserRoutes.test.js` · **Cỡ:** S

## Checkpoint 1: Bảo mật
- [x] `npm test` xanh
- [x] Bốn kịch bản khai thác trong plan.md (chiếm vai trò qua HR, qua Khách có `verifiedEmail`, xóa SĐT qua recovery, DoS Quản lý) đều có test và đều bị chặn
- [ ] Người dùng duyệt diff → commit riêng → deploy (không cần migration)

---

## Giai đoạn 2: Gỡ API không còn giao diện

### T7: Gỡ `/api/search` + export `search.results`
**Mô tả:** Xóa route trong `routes.js`, hàm tương ứng ở `dashboardData.js`/`dashboardPgReader.js`, nhánh ở `dashboardPermissionFilter.js`, khóa quyền ở `featureRegistry.js` (nếu chỉ dùng cho search), export `search.results` ở `exportService.js`, cùng test liên quan.
**Tiêu chí:**
- [x] `grep -rn "api/search\|search.results"` trong `server/` (trừ node_modules) không còn kết quả
- [x] Quyền đã lưu có khóa cũ vẫn resolve được, không lỗi
**Xác minh:** `npm test`
**Phụ thuộc:** Checkpoint 1 · **File:** `server/routes.js`, `server/dashboard/{dashboardData,dashboardPgReader,dashboardPermissionFilter,exportService}.js`, `server/auth/featureRegistry.js` + test · **Cỡ:** M

### T8: Gỡ `/api/customer-product-top`
**Mô tả:** Xóa route, hàm dữ liệu chỉ phục vụ nó, sửa `test/overview-endpoints-access.test.js`.
**Tiêu chí:**
- [x] Không còn tham chiếu; truy vấn SQL riêng (nếu có) bị xóa
**Xác minh:** `npm test`
**Phụ thuộc:** T7 (cùng đụng `routes.js`/`dashboardData.js`) · **File:** `server/routes.js`, `server/dashboard/dashboardData.js`, `server/test/overview-endpoints-access.test.js` · **Cỡ:** S

### T9: Gỡ đăng ký OTP, `link-status`, `lifecycle/lookup`
**Mô tả:** Xóa `POST /api/auth/register/{channels,send-otp,verify}` và phần `employeeRegistrationService` chỉ chúng dùng (giữ phần mà `POST /api/auth/register`/resolver còn gọi). Xóa `GET /api/hr/telegram/link-status` và `POST /api/shipment/lifecycle/lookup`. Đọc kỹ `hr-leave-loading.test.js`/`hr-leave-realtime-status.test.js`: nếu chúng khẳng định FE *không* gọi link-status thì giữ test đó.
**Tiêu chí:**
- [x] Không còn route; code chết trong service đi kèm bị xóa
- [x] Đăng ký thường, đăng nhập, Telegram bot liên kết vẫn chạy (test hiện có xanh)
**Xác minh:** `npm test`
**Phụ thuộc:** Checkpoint 1 (cùng đụng `authRoutes.js`) · **File:** `server/auth/authRoutes.js`, `server/auth/employeeRegistrationService.js`, `server/hr/hrLeaveRoutes.js`, `server/shipment/orderLifecycleRoutes.js` + test · **Cỡ:** M

---

## Giai đoạn 3: Gỡ trường BE thừa + nhánh FE cũ

Quy tắc chung: trước khi xóa mỗi trường, grep toàn `server/` (kể cả `exportService.js`, `telegram/`, `dashboardViews.js`, `dashboardPermissionFilter.js`). Chỉ xóa *đầu ra* và phép tính chỉ phục vụ đầu ra đó. Sửa test frontend đang dựng dữ liệu giả có các trường này.

### T10: Tổng quan: bỏ KPI "hôm nay", `activeProducts`, `inventoryValueCategoryCount`, bộ lọc `ov*`
**Tiêu chí:**
- [x] `kpi.revenueToday/invoicesToday/cancelledToday/activeProducts/inventoryValueCategoryCount` không còn trong payload và view
- [x] `parseFilterSpec(req.query, 'ov', …)` bị bỏ; tab Tổng quan vẫn lọc theo `in*`
- [x] Không còn truy vấn "hôm nay" thừa
**Xác minh:** `npm test`; preview tab Tổng quan
**Phụ thuộc:** T8 · **File:** `server/dashboard/{dashboardData,dashboardViews}.js`, `server/routes.js` + test · **Cỡ:** M

### T11: Hóa đơn: bỏ `returnsCount`, `totalReturns`, `periodGrossRevenue` khỏi đầu ra
**Tiêu chí:**
- [x] Ba trường không còn trong payload
- [x] Doanh thu/Thực thu/Giảm giá/Số giao dịch giữ nguyên số (test so sánh trước/sau trên cùng dữ liệu giả)
**Xác minh:** `npm test`; preview tab Hóa đơn (4 thẻ)
**Phụ thuộc:** không (sau T10 nếu cùng đụng một hàm) · **File:** `server/dashboard/dashboardData.js` + test · **Cỡ:** S

### T12: Hàng hóa/tồn kho: bỏ `stockByCategory`, `stockValueByCategory`, `newlyImported.{topByRevenue,salesByCategory,countByCategory}`
**Tiêu chí:**
- [x] Trường không còn trong payload/view/permission filter
- [x] Bảng Hàng mới nhập, Cơ cấu tồn kho, export `products.inventory` vẫn đúng
**Xác minh:** `npm test`; preview tab Hàng hóa
**Phụ thuộc:** không · **File:** `server/dashboard/{dashboardData,dashboardViews,dashboardPermissionFilter}.js` + test · **Cỡ:** M

### T13: FE: bỏ nhánh `d.topSellingProducts`, `d.days`
**Mô tả:** `public/index.html:6685` chỉ đọc `productsData.topSellingProducts`; dòng 7671/7791 chỉ dùng `d.filters.invoices.label`, fallback `state.days`. Lưu ý `products.topSellingProducts` BE **vẫn trả** và export vẫn dùng: không gỡ.
**Tiêu chí:**
- [x] Không còn `d.topSellingProducts`, `d.days` trong `index.html`
**Xác minh:** `node --test "test/frontend/*.test.js"`; preview
**Phụ thuộc:** T10–T12 · **File:** `server/public/index.html` + test frontend · **Cỡ:** XS

## Checkpoint 2: Dọn dẹp
- [x] `npm test` xanh
- [ ] Preview: Tổng quan, Hóa đơn, Hàng hóa, Khách hàng không lỗi console, số khớp trước khi sửa
- [ ] Thử từng export Excel/HTML còn lại
- [x] Người dùng duyệt → commit

---

## Giai đoạn 4: Hoàn thiện

### T14: Dropdown "Toàn bộ đơn hàng" thêm "Sự cố", "Đã hủy"
**Mô tả:** Thêm `EXCEPTION`/`CANCELLED` vào `#bulkStatusFilter` (`public/shipment/lifecycle/index.html:438`), nhãn giống `#historyStatusFilter`. Kiểm `enhanceSelect` tự nhận option mới.
**Tiêu chí:**
- [x] Chọn hai trạng thái lọc đúng (BE đã hỗ trợ)
**Xác minh:** `node --test "test/frontend/order-lifecycle*.test.js"`; preview
**Phụ thuộc:** không (làm lúc nào cũng được) · **File:** `server/public/shipment/lifecycle/index.html`, `server/test/frontend/order-lifecycle-kiot.test.js` · **Cỡ:** XS

### T15: Tài liệu + memory
**Tiêu chí:**
- [x] README: bỏ endpoint đăng ký OTP, search, customer-product-top, link-status, lookup; mô tả quy tắc đổi email/SĐT mới
- [x] SRS/BRD: mục hồ sơ/tài khoản theo quyết định mới; kiểm lại bản sửa trước (4 thẻ Hóa đơn, không có KPI hôm nay)
- [x] Cập nhật memory (auth & phân quyền, frontend) + ghi rõ trạng thái deploy
**Xác minh:** grep tài liệu không còn tên endpoint/trường đã gỡ
**Phụ thuộc:** tất cả · **File:** `README.md`, `docs/01-brd/*`, `docs/02-srs/*`, memory · **Cỡ:** S

## Checkpoint 3: Hoàn tất
- [x] Mọi tiêu chí đạt, `npm test` xanh
- [ ] Sẵn sàng review / deploy đợt 2
