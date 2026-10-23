# Ghi chú và Tiếp khách lần cuối theo khách hàng

**Cập nhật 23/10/2026:** giao diện và quyền sửa quy mô theo [thiết kế cập nhật](2026-10-23-customer-profile-refinement-design.md); các mô tả ban đầu bên dưới được giữ làm lịch sử.

Ngày: 22/10/2026. Phạm vi và các quyết định (quyền xem, 1 note/khách/ngày, người sửa do Quản lý gán) đã được người dùng chốt trong chat. Trạng thái: đã commit trên `main`, chưa push/deploy; migration `0080` đã áp DB dùng chung (22/10/2026).

## Mục tiêu
Bảng **Doanh số theo khách** (tab Khách hàng, `/reports/#business`) chỉ có số liệu doanh số. Thêm 2 nhóm thông tin nghiệp vụ theo từng khách: **Ghi chú** (Thông tin chung + Note) và **Tiếp khách lần cuối**.

## Giao diện
- Hai cột mới ngay sau Level giá, có `data-column-key` (`notes`, `lastVisit`) nên "Cột hiển thị" hoạt động: **Ghi chú** (112 px, nút Chi tiết kèm số note) và **Tiếp khách lần cuối** (168 px, `dd/mm/yyyy`, chữ mờ `dd/mm/yyyy` khi chưa có; Quản lý có thêm biểu tượng lịch). Chỉ hiện khi `TKSNav.can('reports.business.customerNotes')`. Nút trong ô không mở hộp chi tiết số liệu của dòng.
- Hộp thoại **Chi tiết khách** dùng khung `#docModalBackdrop` + lớp `.dp-*`, CSS riêng tiền tố `.cp-*` trong `public/index.html`; hai cột trên desktop (Thông tin chung | Note), một cột khi ≤ 860 px, ô bấm ≥ 44 px trên cảm ứng, `role="dialog"`, focus trap, trả focus về nút Chi tiết, Esc đóng.
  - **Thông tin chung:** Định vị kho (text), Số lượng kho (số ≥ 0), Quy mô kho (Chưa có / Nhỏ / Vừa / To, mặc định Chưa có), Đối thủ (để ý tem), Hình thức bán hàng (dropdown tick nhiều: Bán sàn, Bán cửa hàng, FB ads, FB live, Sang tay, Kho buôn), lưới ảnh kho (nút tải file hoặc dán Ctrl+V khi hộp đang mở; nén bằng `TKSImageCompress` trước khi tải lên; ảnh tải lười; bấm ảnh phóng to). Chỉ-đọc khi không có quyền sửa.
  - **Note:** khung soạn + nút "Tạo note" (vô hiệu khi hôm nay đã có note, khi đó note hôm nay có nút Sửa); bong bóng mới → cũ kèm ngày giờ (giờ VN) và người viết; note hôm nay có nhãn "Hôm nay – có thể sửa", note ngày cũ chỉ đọc.
  - **Quản lý** (chỉ `canManage`): ô "Người được sửa" (dropdown tick nhiều từ `assignable-users`) và **lịch chọn nhiều ngày** (lưới tháng bắt đầu Thứ Hai, ngày tương lai bị khóa, ngày đã chọn có dấu tích SVG và danh sách chip, ngày lớn nhất đánh dấu "Gần nhất"). Biểu tượng lịch ở cột mở hộp lịch riêng (rộng 440 px).

## Quy tắc nghiệp vụ
- Xem: `reports.business.customerNotes` (Quản lý, Trợ lý, Nhân viên sale; cần `reports.business`; Khách bị chặn).
- Sửa Thông tin chung, ảnh, Note: `reports.business.customerManage` (mặc định chỉ Quản lý) **hoặc** (`customerNotes` **và** có tên trong `customer_editors` của khách đó). Admin cứng nhận mọi quyền qua `resolvePermissions`.
- Tiếp khách lần cuối: chỉ người có `customerManage` sửa; thay cả tập ngày "đã đi" (tối đa 400, không ngày tương lai theo giờ VN); giá trị hiển thị = ngày lớn nhất.
- Gán người sửa: chỉ `customerManage`; chỉ tài khoản đang hoạt động, vai trò nội bộ (không phải Khách); tên chụp lại lúc gán.
- Note: tối đa 1 note / khách / ngày (`UNIQUE (customer_key, note_date)`, ngày theo giờ VN do máy chủ tính); tối đa 2000 ký tự; ai trong danh sách sửa cũng sửa được trong ngày đó, sang ngày sau khóa (409 `NOTE_LOCKED`).
- Ảnh: PNG/JPEG/GIF/WebP theo magic byte, ≤ 5 MB, tối đa 10 ảnh / khách.

## Kỹ thuật
- **Khóa khách** `customer_key = nameKey(tên)` (cùng `key` của hàng bảng; hàng không có id bền). **Hạn chế đã biết:** khách đổi tên thì mất liên kết ghi chú (dữ liệu cũ vẫn nằm trong bảng).
- Không đụng snapshot cache báo cáo: client gọi thêm `GET /api/business-report/customer-meta` (nhẹ, `{ key: { lastVisit, noteCount } }`, lỗi thì bỏ qua) rồi gộp vào hàng theo `r.key`.
- Code: `server/businessReport/customerProfileRepository.js` (`now` inject để test đóng băng ngày VN), `customerProfileRules.js`, 11 route trong `businessReportRoutes.js`; quyền trong `auth/featureRegistry.js`; xuất Excel/HTML bảng khách thêm cột Tiếp khách lần cuối (`businessReportExport.js`, chỉ khi người xuất có `customerNotes`; không xuất note/ảnh).
- Ảnh lưu BYTEA như `hr_rule_document_images` (0061), trả với ETag sha256 và `Cache-Control: private, max-age=31536000, immutable`.
- Migration `0080_customer_notes.sql`: 5 bảng `customer_profiles`, `customer_profile_images`, `customer_notes`, `customer_visit_days`, `customer_editors`; `REVOKE` khỏi `reporting_readonly`. Hợp đồng chi tiết: `server/db/SCHEMA.md`.
- **Thứ tự triển khai:** code chạy được trước migration (đọc trả rỗng, ghi trả 503 `MIGRATION_PENDING`); áp `0080` rồi mới dùng. Không có job nền.

## Ngoài phạm vi
Xuất note/ảnh ra file, lịch sử chỉnh sửa note, xóa note, di chuyển ghi chú khi khách đổi tên, ngày tương lai trong lịch tiếp khách.

## Kiểm chứng
PGlite (migration, repository với `now` đóng băng: trùng note trong ngày → 409, sửa note cũ bị từ chối, thay tập ngày, ảnh sai magic byte / quá cỡ / quá 10 ảnh), route (403 thiếu quyền, người được gán sửa được, người không được gán 403, Quản lý luôn sửa được, 400/404), JSDOM `test/frontend/customer-profile.test.js` và `business-report.test.js` (cột, nút Chi tiết, lịch, dán ảnh, focus trap), xuất file có cột mới, test liệt kê quyền. Kết quả `npm test` toàn bộ: xem kết quả cuối phiên.
