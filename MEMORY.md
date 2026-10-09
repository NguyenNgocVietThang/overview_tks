# MEMORY: BỘ NHỚ DÀI HẠN DỰ ÁN TOKOSI DASHBOARD

> **Thời hạn giá trị:** Ít nhất 3 tháng (Q4/2026 – Q1/2027).  
> **Cập nhật gần nhất:** 09/10/2026.  
> **Quy tắc:** Chỉ lưu trữ các nguyên tắc cốt lõi, kiến trúc bất biến, quy ước chuẩn hóa và bài học kinh nghiệm dài hạn. Không ghi deadline ngắn hạn hay task vụn vặt vào file này.

---

## 1. Hồ sơ dự án (Project Profile)

- **Tên dự án:** TOKOSI Dashboard (Web TKS Dashboard).
- **Mục đích:** Hệ thống điều hành & báo cáo nội bộ tập trung cho 2 cơ sở phân phối sỉ: **Hà Nội (HN)** và **Sài Gòn (SG)**.
- **Công nghệ nền tảng:**
  - **Backend:** Node.js (v22/v24), Express REST API.
  - **Database:** Supabase PostgreSQL (Production / Staging), PGlite (Unit / Integration testing cục bộ).
  - **Frontend:** Vanilla HTML5, CSS3 (Design token, CSS variables, Dark/Light theme, responsive), Vanilla JavaScript (không dùng Tailwind, React, Vue).
  - **Dữ liệu nguồn:**
    - KiotViet API (bán hàng, kho, khách hàng, hóa đơn, thu chi) đồng bộ qua Node.js engine (`server/kiotvietSync/`).
    - Google Sheets API (chỉ đọc cho Bảng Công nợ, Vị trí hàng, Báo cáo Marketing; đọc/ghi tab `Lịch sử cập nhật` Vòng đời đơn hàng và sửa trực tiếp Khách mới/Ghi chú của Báo cáo Marketing).
  - **Bot & Thông báo:** Telegram Bot quản lý duyệt nghỉ phép (`server/telegram/`), Server-Sent Events (SSE) phát sóng thời gian thực cho trình duyệt.

---

## 2. Nguyên tắc kiến trúc & Quy tắc bất biến (Do's & Don'ts)

### 2.1. Quy ước cơ sở & dữ liệu
- **`branch` chỉ có 2 giá trị:** `hanoi` và `saigon` trong Postgres. Khóa chính của mọi bảng nghiệp vụ KiotViet luôn bắt đầu bằng `(branch, id)`.
- **`Cả hai` (`both` / rỗng) chỉ là phạm vi xem trên UI:** Không có cơ sở `both` trong database. Khi chọn `Cả hai`, server ghép kết quả hoặc hiển thị từng dòng riêng theo từng cơ sở.
- **Tiền tệ & số lượng luôn dùng `NUMERIC`:** Đã chuyển đổi từ `BIGINT`/`INTEGER` ở migration `0012`. KiotViet có giá lẻ xu và số lượng cân nặng thập phân (ví dụ `7.5`).
- **Múi giờ chuẩn:** Toàn bộ hệ thống quy chuẩn theo **`Asia/Ho_Chi_Minh` (UTC+7)** cho ngày hôm nay, bucket ngày và mốc báo cáo, độc lập với timezone của máy chủ Render.
- **TUYỆT ĐỐI KHÔNG CÒN APPS SCRIPT:** Toàn bộ Google Apps Script cũ (`src-dashboard`, `.clasp.json`) đã bị xóa và nghỉ hưu hoàn toàn; không bao giờ tạo lại hay phụ thuộc vào Apps Script.

### 2.2. Tài khoản, Bảo mật & Phân quyền
- **Khóa tự đăng ký tài khoản:** Tự đăng ký (`/register`, OTP nhân sự, tạo Khách tự động qua Google) bị khóa từ 2026-10-03 (`ALLOW_SELF_REGISTRATION=false`). Mọi tài khoản mới do Quản lý tạo tại `/account/#users`.
- **Bảo vệ tài khoản Quản lý cấp cao:** Quản lý thường không được sửa thông tin, đặt lại mật khẩu, hạ vai trò hay xóa Quản lý khác. Chỉ Admin cứng (`HARDCODED_ADMINS`) mới có toàn quyền (`accountPolicy.checkProtectedManager`).
- **Phân quyền theo tính năng (`featureRegistry.js`):** Quyền mặc định theo vai trò kết hợp cờ ghi đè từng tài khoản (`app_users.feature_permissions JSONB`). Mọi quyền con phụ thuộc quyền cha thông qua `requires`.
- **Bảo mật hồ sơ cá nhân:** Người dùng thường không tự đổi email/SĐT qua form hồ sơ. Đổi email tài khoản thường phải xác minh qua OTP gửi tới email mới; tài khoản nhân sự chỉ Quản lý mới được đổi.
- **Nhật ký chỉnh sửa tài khoản (`account_audit_log`):** Mọi thao tác quản trị tài khoản được ghi nhận bất biến (migration `0040`), thu hồi `SELECT` khỏi role báo cáo.

### 2.3. Nhân sự & Nghỉ phép
- **Trạng thái nhân sự (`employment_status`):** Tách biệt trạng thái làm việc `active` (Đang làm việc) và `resigned` (Đã nghỉ việc) khỏi xóa mềm `is_active` (migration `0041`). Chuyển sang `resigned` tự động khóa tài khoản liên kết (`lock_reason = 'hr_resigned'`); chuyển lại `active` tự động mở khóa.
- **Lịch làm việc & Hạn nộp đơn:** Giờ làm việc cố định toàn công ty là sáng **07:45** và chiều **12:30** (`hr_leave_work_schedules`, migration `0038`). Đơn tự động phân loại `timing_status` (`Đúng hạn`, `Xin muộn`, `Vi phạm`).
- **Tài khoản nội bộ chưa gắn nhân sự gửi đơn:** Mọi tài khoản nội bộ hoạt động (trừ Khách) dù chưa liên kết `hr_employee_id` vẫn được phép gửi đơn nghỉ web (migration `0042`).
- **Bot quản lý nghỉ phép:** Chạy webhook trong Express với secret header; gửi thông báo duyệt/từ chối kèm Mini App lý do; chống tranh chấp bằng `decision_version`.

### 2.4. Sổ quỹ & Báo cáo
- **Sổ quỹ (`/cashbook/`):** Tồn quỹ = tổng phiếu thu trừ phiếu chi chưa hủy; gom quỹ ngân hàng HN + SG cùng số tài khoản; phân loại theo 5 nhóm tài khoản (`account_balance_groups`). Không dùng cache; kiểm tra revision tự động mỗi 15 giây khi tab đang xem.
- **Báo cáo kinh doanh (`/reports/#business`):** Doanh số tháng = Hóa đơn Hoàn thành − Phiếu trả Đã trả (giờ VN). Tháng đã qua chốt cứng vào `business_monthly_*` (migration `0036`); tháng hiện tại tính live SQL; sale đi theo nhóm khách hàng hiện tại; team nạp từ `sale_teams` (migration `0037`).
- **Báo cáo Marketing (`/reports/#marketing`):** Đọc 3 workbook Google Sheets, đối chiếu doanh số KiotViet theo tên khách hàng; hỗ trợ sửa trực tiếp Khách mới / Ghi chú ngược lại Sheets và xuất file XLSX/HTML.
- **Hàng hóa & Tồn kho:** "Tồn có thể bán" = Tồn thực tế − Đặt hàng Phiếu tạm (không cộng hàng đang vận chuyển). Ẩn đơn giá và giá trị tồn đối với nhân viên không có quyền `reports.products.cost`.

---

## 3. Bản đồ Migration Cơ sở dữ liệu (0001 – 0042)

| Dải Migration | Phân hệ & Nội dung chính |
|---|---|
| `0001–0008` | Dữ liệu nền KiotViet: nhóm hàng, hàng hóa, hóa đơn, đơn hàng, trả hàng, nhập hàng, thu chi, webhook raw, backfill. |
| `0009–0012` | Tài khoản `app_users`, nhân sự `hr_employees`, role `reporting_readonly`, trạng thái thu nợ, chuẩn hóa tiền `NUMERIC`. |
| `0013–0015` | Rollup dashboard, công nợ `customer_debt_activity_periods` (CN1/CN3/CN7), `app_users.telegram_id`. |
| `0016–0017` | 3 bảng nghỉ phép & bot Telegram, `supplier_return_imports` (Trả NCC upload Excel). |
| `0018–0021` | `product_report`, vai trò `Nhân viên marketing`, phân quyền `feature_permissions JSONB`, index ngày. |
| `0022–0025` | `customer_invoice_lines_90d`, `product_report_customers`, phiếu đặt hàng nhập `order_suppliers`, `inventory_value_snapshots`. |
| `0026–0028` | Gỡ `suppliers`/`daily_purchase_summary`, tài liệu quy định `hr_rule_documents`, index đơn phiếu tạm `idx_orders_phieu_tam`. |
| `0029–0031` | Bot Telegram quản lý nghỉ phép (`decision_version`), gỡ `Tạm duyệt`, phạm vi duyệt phòng ban & card Telegram. |
| `0032–0035` | Chuẩn hóa bộ phận, Sổ quỹ (`cash_book_accounts`, `cash_book_checkpoints`, `cash_book_account_banks`, `source_missing_at`). |
| `0036–0037` | Báo cáo kinh doanh tháng chốt cứng (`business_monthly_*`), bảng phân chia Team sale `sale_teams`. |
| `0038–0040` | Lịch làm việc & hạn nộp nghỉ phép (`hr_leave_work_schedules`, `hr_leave_submissions`), tài liệu Phúc lợi `phuc-loi`, `account_audit_log`. |
| `0041–0042` | Trạng thái nhân sự `employment_status` (`active`/`resigned`), đơn nghỉ phép cho tài khoản nội bộ chưa gắn nhân sự (`hr_employee_id` nullable). |

---

## 4. Quy ước Frontend & Trải nghiệm người dùng (UI Standards)

1. **Điều khiển bảng dùng chung (`public/shared/table-controls.js`):**
   - Nút **Cột hiển thị** mở menu chọn cột, lưu tùy chọn trong phiên.
   - Tay kéo chỉnh độ rộng cột ở mép phải tiêu đề, nội dung dài xuống dòng.
   - Ô tìm kiếm tích hợp nút xóa nhanh (`search-clear`).
   - Phân trang chuẩn 100 dòng/trang, hỗ trợ chuyển trang mượt mà.
   - Tắt điều khiển cột đối với các bảng quy định/chính sách tĩnh.
2. **Không dùng framework nặng:** Giữ thuần JavaScript và CSS variables để tối đa tốc độ tải trang và phản hồi dưới 100ms.
3. **Thẩm mỹ cao cấp:** Màu sắc hài hòa theo bảng màu định sẵn trong `shared.css`, hỗ trợ cả giao diện Sáng và Tối, responsive hoàn chỉnh trên thiết bị di động.
