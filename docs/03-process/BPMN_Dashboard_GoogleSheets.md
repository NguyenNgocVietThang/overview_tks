# TÀI LIỆU SƠ ĐỒ QUY TRÌNH NGHIỆP VỤ

*(Business Process Model and Notation – BPMN)*

**HỆ THỐNG DASHBOARD NỘI BỘ — TOKOSI**

| **Thông tin**      | **Nội dung**                                                         |
|--------------------|----------------------------------------------------------------------|
| Tên dự án          | Hệ thống Dashboard nội bộ TOKOSI                                    |
| Phiên bản          | 2.1                                                                  |
| Ngày tạo           | 27/07/2026                                                           |
| Ngày cập nhật      | 19/09/2026                                                           |
| Tài liệu liên quan | BRD v2.0 · SRS v2.5 · Implementation Plan v2.4 · CSNS-NP-01 · Design System MASTER |
| Trạng thái         | Đang vận hành (Supabase PostgreSQL, Quản lý công nợ CN1/CN3/CN7, HR Leave, Vòng đời đơn hàng, 711 unit tests) |

---

# 1. Giới thiệu

Tài liệu này mô tả chi tiết các luồng quy trình vận hành của Hệ thống Website Dashboard TOKOSI theo chuẩn BPMN 2.0 (mô tả dưới dạng text diagram và bảng bước chi tiết).

Tài liệu này mô tả 5 luồng chính:
- **Luồng A:** Đồng bộ dữ liệu KiotViet -> Supabase PostgreSQL qua Node.js Sync Engine (Webhook + Polling đối soát).
- **Luồng B:** Người dùng sử dụng Dashboard & Tiện ích (đọc từ Supabase PostgreSQL, đối chiếu CN1/CN3/CN7, đọc Trả NCC Sheets, Result Cache, Phân trang, Xuất Excel).
- **Luồng C:** Cấu hình và triển khai hệ thống (Render.com + Supabase PostgreSQL migrations).
- **Luồng D:** Xác thực, Quản lý tài khoản & Khôi phục mật khẩu OTP (PostgreSQL `app_users`).
- **Luồng E:** Đăng ký, Phê duyệt Nghỉ phép Nhân sự & Tương tác Telegram Bot.

---

# 2. Bể và làn quy trình (Pools & Lanes)

| **Vai trò (Lane)**         | **Mô tả trách nhiệm**                                                                                                           |
|----------------------------|---------------------------------------------------------------------------------------------------------------------------------|
| KiotViet POS / Public API  | Phần mềm quản lý bán hàng: phát sinh thay đổi dữ liệu, gửi webhook POST JSON đến Webhook endpoint server hoặc phục vụ polling GET. |
| Node.js Sync Engine        | Engine `server/kiotvietSync/` chạy trên server: nhận webhook vào hàng đợi nền, lập lịch polling đối soát và tổng hợp CN1/CN3/CN7. |
| Supabase PostgreSQL        | Cơ sở dữ liệu trung tâm: lưu trữ dữ liệu KiotViet, tài khoản `app_users`, trạng thái công nợ và `customer_debt_activity_periods` (CN1/CN3/CN7). |
| Google Sheets              | Nguồn dữ liệu bổ trợ: chỉ đọc tab `Trả NCC` trên file Kiot HN/SG; lưu trữ Bảng Công nợ, Vòng đời đơn hàng (`DonHang_*`) và `HR_Leaves`. |
| Backend (Node.js/Express)  | Server trên Render.com: quản lý Result Cache, đọc PostgreSQL qua `dashboardPgReader.js`, đọc Sheets qua Service Account, tính KPI, xác thực JWT/bcrypt/OTP, tạo file Excel và phục vụ REST API. |
| Người dùng / Frontend      | Truy cập Web Dashboard: tương tác KPI, chuyển tab tức thì (<10ms), phân trang, quản lý tài khoản `/account/`, tra cứu vòng đời đơn hàng và tải file Excel. |

---

# 3. Chú giải ký hiệu sử dụng

| **Ký hiệu văn bản**     | **Ý nghĩa**                                                                              |
|-------------------------|------------------------------------------------------------------------------------------|
| [Start]                 | Sự kiện Bắt đầu (Start Event) — điểm khởi phát của một luồng quy trình.                  |
| [End]                   | Sự kiện Kết thúc (End Event) — điểm hoàn tất một nhánh/luồng.                            |
| [Event]                 | Sự kiện trung gian / mốc quan trọng.                                                     |
| [Task]                  | Hoạt động / Tác vụ (Task) — một bước xử lý cụ thể.                                       |
| [Decision]              | Cổng quyết định loại trừ (Exclusive Gateway) — rẽ nhánh theo điều kiện, đi đúng 1 nhánh. |
| ->                      | Luồng tuần tự chính (Sequence Flow).                                                     |
| -->                     | Luồng ngoại lệ / vòng lặp / kích hoạt theo sự kiện bất đồng bộ.                         |
| [Lane]                  | Đại diện cho 1 vai trò/tác nhân.                                                         |

---

# 4. Sơ đồ tổng quan

```
Luồng A (liên tục, nền):  KiotViet -> Node.js Sync Engine -> Supabase PostgreSQL
                                            ^ (5-15 phút đối soát; Rollup mỗi 5 phút; CN1/CN3/CN7 mỗi ngày)

Luồng B (theo yêu cầu):   Người dùng -> Frontend -> Backend (Result Cache) -> Supabase PostgreSQL / Google Sheets (Trả NCC)
                                            |
                                       Hiển thị Dashboard / Quản lý công nợ (CN1/CN3/CN7) / Xuất Excel / Phân trang

Luồng C (một lần):        IT Admin cấu hình Render env vars + Supabase PostgreSQL migration (npm run db:migrate)

Luồng D (theo sự kiện):   Người dùng / Admin -> Đăng nhập / Đăng ký SĐT / Đổi MK / OTP Reset / Quản trị app_users
```

Luồng A chạy hoàn toàn độc lập với Luồng B. Backend (Luồng B) đọc trực tiếp từ PostgreSQL và Google Sheets (Trả NCC) theo yêu cầu của frontend.

---

# 5. Luồng A — Đồng bộ KiotViet -> Supabase PostgreSQL (Node.js Sync Engine)

Luồng này chạy liên tục và tự động, không phụ thuộc vào người dùng web dashboard.

```
[A0] [Start] KiotViet phát sinh thay đổi dữ liệu (sản phẩm, hóa đơn, đơn hàng, khách hàng...)
         |
[A1] [Task] KiotViet gửi POST JSON đến endpoint /api/internal/kiotviet-sync/webhook
         |
[A2] [Task] Server phản hồi HTTP 200 tức thì và đưa payload vào hàng đợi nền `webhookEventQueue.js`
         |
[A3] [Task] Worker nền lấy sự kiện từ hàng đợi, upsert/delete vào Supabase PostgreSQL
         |
[A4] [Decision] Thành công?
     |-- Có -> Hoàn tất xử lý sự kiện
     `-- Không -> Ghi log lỗi, chuyển tiếp để đối soát polling bắt bù

--- SONG SONG: Polling đối soát & Rollup định kỳ ---
[A5] [Start] Scheduler kích hoạt:
         |-- Mỗi 5 phút: dashboardRollupRefresh.js tổng hợp 4 bảng rollup theo ngày
         |-- Mỗi 5-15 phút: syncDriver.js polling đối soát theo lastModifiedFrom
         `-- Gần 15:00 hàng ngày: customerDebtReportRefresh.js tổng hợp CN1/CN3/CN7 vào customer_debt_activity_periods
         |
[A6] [End] Kết thúc chu kỳ — Database luôn sẵn sàng dữ liệu mới nhất
```

| **Bước** | **Vai trò**           | **Mô tả**                                                                                           | **Tham chiếu** |
|----------|-----------------------|-----------------------------------------------------------------------------------------------------|----------------|
| A0       | KiotViet              | Sự kiện bắt đầu: dữ liệu thay đổi trên KiotViet (bán hàng, nhập hàng, cập nhật tồn kho...).        | —              |
| A1       | KiotViet              | Gửi POST JSON đến webhook endpoint của server trên Render.                                          | FR-06.2        |
| A2       | Server Webhook Queue  | Trả HTTP 200 ngay lập tức, lưu payload vào hàng đợi nền tránh timeout.                             | FR-06.2        |
| A3–A4    | Sync Driver           | Ghi nhận và đồng bộ bản ghi vào Supabase PostgreSQL tương ứng.                                     | FR-06.1, FR-06.2 |
| A5       | Scheduler             | Polling đối soát dữ liệu và tổng hợp bảng rollup, bảng công nợ CN1/CN3/CN7.                         | FR-06.3, FR-06.6, FR-06.12 |
| A6       | —                     | Dữ liệu sẵn sàng phục vụ Dashboard.                                                                 | —              |

---

# 6. Luồng B — Sử dụng Dashboard & Tiện ích (Result Cache, Phân trang, Xuất Excel)

Luồng này xảy ra mỗi khi người dùng truy cập hoặc tương tác với Dashboard.

```
[B0] [Start] Người dùng mở trình duyệt, truy cập Dashboard
         |
[B1] [Task] Frontend (index.html) load xong, tự động gọi GET /api/dashboard?days=30
         |
[B2] [Decision] Backend kiểm tra Result Cache:
     | Có cache hợp lệ cho key (rawDataVersion, filters)?
     |-- [B2-Hit] Có (Cache Hit) -> Trả ngay JSON đã tính toán (<10ms) -> chuyển đến B6
     `-- [B2-Miss] Không (Cache Miss) -> Đọc dữ liệu từ Supabase PostgreSQL qua dashboardPgReader.js & Trả NCC từ Sheets:
            - Đọc 9 bảng thực thể và 4 bảng rollup từ PostgreSQL
            - Đọc tab Trả NCC từ Google Sheets API (cache thô 90s)
            - Đọc CN1/CN3/CN7 từ customer_debt_activity_periods qua customerDebtActivityRepository.js
            - Đọc Bảng Công nợ từ debtManagementSheetsClient.js
                    |
[B3] [Decision] Cổng quyết định: Đọc dữ liệu thành công?
     |-- Thất bại ->
     |   [B3-No] [Task] Backend log chi tiết lỗi và trả HTTP 500 JSON
     |   [B3-No] [Task] Frontend hiển thị thông báo lỗi cho người dùng [End]
     `-- Thành công ->
         [B4] [Task] Backend tính toán `computeDashboardData()`:
              - Tính KPI, revenueByDay, Top sản phẩm, Quản lý công nợ (đối chiếu CN1/CN3/CN7)...
              - Lưu kết quả vào `dashboardResultCache`
                    |
[B5] [Task] Backend trả HTTP 200 JSON toàn bộ dữ liệu
         |
[B6] [Task] Frontend render:
     - KPI cards (doanh thu, tồn kho, công nợ...)
     - Biểu đồ doanh thu theo ngày (Chart.js 2D)
     - Màn hình Quản lý công nợ (lọc, tìm, đối chiếu CN1/CN3/CN7)
     - Bảng dữ liệu có phân trang (`pagination.js`)
     - Hiển thị updatedAt theo giờ Việt Nam
         |
[B7] [Event] Dashboard sẵn sàng sử dụng
```

**Xử lý lỗi & Tự phục hồi trong Luồng B:**
- Nếu Supabase PostgreSQL gặp sự cố tạm thời: trả HTTP 500 kèm thông báo lỗi rõ ràng.
- Nếu Google Sheets API (tab Trả NCC) bị lỗi hạn mức/timeout: trả dữ liệu với phần Trả NCC rỗng hoặc cache cũ có kiểm soát.
- Result Cache tự động giải phóng bộ nhớ khi quá hạn hoặc khi có dữ liệu mới.

---

## 6.1. Tương tác Lọc thời gian & Làm mới

```
--- Lọc thời gian ---
[B8] [Task] Người dùng click 7 / 30 / 90 ngày
         |
[B9] [Task] Frontend gọi GET /api/dashboard?days={7|30|90} -> Backend kiểm tra Result Cache (phản hồi tức thì nếu raw data chưa đổi)

--- Làm mới dữ liệu ---
[B10] [Task] Người dùng nhấn nút "Làm mới"
          |
[B11] [Task] Frontend gọi GET /api/dashboard?days={current_days} (ép fetch mới nếu qua 90s)

--- Làm mới tự động ---
[B12] [Start] Bộ hẹn giờ đạt 10 phút
          |
[B13] [Task] Frontend gọi lại API ở chế độ nền; chỉ render lại khi dữ liệu nghiệp vụ đổi
```

---

## 6.2. Luồng Xuất Excel (16 Bảng & Tìm kiếm)

```
[B14] [Task] Người dùng click nút "Xuất Excel" trên một bảng dữ liệu hoặc kết quả tìm kiếm
          |
[B15] [Task] Frontend gọi POST /api/export/fields với tableKey tương ứng
          |
[B16] [Task] Backend trả danh sách worksheets và fields có thể chọn
          |
[B17] [Task] Frontend mở Modal chọn trường (mặc định chọn tất cả)
          |
[B18] [Task] Người dùng xác nhận chọn trường và click "Tải file Excel"
          |
[B19] [Task] Frontend gọi POST /api/export kèm selectedFields và filterContext
          |
[B20] [Task] Backend exportService.js đọc dữ liệu từ Sheets, tạo file .xlsx:
      - Áp dụng bộ lọc hiện tại
      - Đóng băng hàng tiêu đề (Freeze pane)
      - Bật AutoFilter
      - Ép kiểu text cho mã hàng, mã HĐ, số điện thoại
          |
[B21] [End] Trình duyệt tải về file .xlsx hoàn chỉnh
```

---

## 6.3. Luồng Tìm kiếm nâng cao

```
[B22] [Task] Người dùng nhập vào thanh tìm kiếm:
      |-- Chế độ thường: Tìm theo từ khóa (mã, tên, SĐT...) -> GET /api/search?q=...
      |-- Chế độ nhiều mã: Nhập tối đa 50 mã phân tách khoảng trắng -> GET /api/search?q=...&mode=codes
      `-- Chế độ Top KH theo SP (tab Khách hàng): Nhập danh sách mã -> GET /api/customer-product-top?q=...
          |
[B23] [Task] Backend tìm kiếm và trả kết quả chính xác theo thứ tự nhập
          |
[B24] [Task] Frontend hiển thị dropdown gợi ý mượt mà hoặc bảng kết quả
```

| **Bước** | **Vai trò**    | **Mô tả**                                                                                           | **Tham chiếu**      |
|----------|----------------|-----------------------------------------------------------------------------------------------------|---------------------|
| B0       | Người dùng     | Mở URL Web Dashboard.                                                                               | —                   |
| B1       | Frontend       | Tự động gọi API khi page load xong, mặc định days=30.                                               | FR-04.1             |
| B2       | Backend        | Kiểm tra Result Cache theo `(rawDataVersion, filters)`; phục vụ <10ms nếu hit.                      | FR-01.7, NFR-01     |
| B3–B5    | Backend        | Đọc Supabase PostgreSQL & tab Trả NCC Google Sheets, tính KPI qua `computeDashboardData`, lưu cache. | FR-01.x, FR-02.x    |
| B6       | Frontend       | Render giao diện với Chart.js animation gating, phân trang client-side (`pagination.js`).           | FR-07.x, FR-07.13   |
| B8–B9    | Người dùng     | Đổi bộ lọc thời gian -> gọi API với days mới (phản hồi tức thì nhờ cache).                           | FR-04.1, FR-04.3    |
| B14–B21  | Người dùng/Dev | Quy trình mở modal chọn trường và xuất workbook `.xlsx` 16 bảng / tìm kiếm.                          | FR-07.10 -> FR-07.12|
| B22–B24  | Người dùng/Dev | Tìm kiếm thông thường, tìm nhiều mã và Top 3 KH theo danh mục sản phẩm.                            | FR-07.8, FR-07.9    |

---

# 7. Luồng C — Thiết lập hệ thống (một lần)

Luồng này do IT Admin thực hiện khi triển khai lần đầu hoặc khi cần cấu hình lại.

```
[C0] [Start] Bắt đầu: cần triển khai/cấu hình lại hệ thống

--- Phần 1: Cấu hình Render.com & Supabase PostgreSQL ---
[C1] [Task] IT Admin tạo/cập nhật Web Service trên Render.com và Database trên Supabase
[C2] [Task] Cấu hình biến môi trường:
     - SUPABASE_DATABASE_URL = {PostgreSQL Connection URI}
     - SPREADSHEET_ID = {ID của Google Spreadsheet Dashboard (đọc tab Trả NCC)}
     - ORDER_LIFECYCLE_SPREADSHEET_ID = {ID của Google Spreadsheet Vòng đời đơn hàng}
     - HR_SPREADSHEET_ID = {ID của Google Spreadsheet Nhân sự}
     - GOOGLE_SERVICE_ACCOUNT_JSON = {nội dung JSON của Service Account key}
     - JWT_SECRET = {Secret key JWT}
     - KIOTVIET_CLIENT_ID, KIOTVIET_CLIENT_SECRET, KIOTVIET_RETAILER
[C3] [Task] Render tự động deploy từ GitHub branch main (chạy `npm install` và `npm test` với 711 tests)
[C4] [Decision] Deploy thành công?
     |-- Không -> kiểm tra logs Render -> quay lại C1
     `-- Có ->
[C5] [Task] Chạy migration database Supabase: `npm run db:migrate` (0001 -> 0014)
[C6] [Decision] Kết nối Database và Google Sheets OK?
     |-- Không -> kiểm tra URI PostgreSQL hoặc quyền Service Account -> quay lại C2/C5
     `-- Có ->

--- Phần 2: Cấu hình Webhook & Đồng bộ KiotViet ---
[C7] [Task] Đăng ký Webhook KiotViet trỏ về Node.js Sync Engine trên Render
[C8] [Task] Khởi chạy sync ban đầu / scheduler đối soát nền (5-15 phút) và tổng hợp CN1/CN3/CN7
[C9] [Task] Khởi tạo tài khoản quản trị hệ thống trong bảng PostgreSQL `app_users`
[C10] [End] Hệ thống đã cấu hình hoàn chỉnh, sẵn sàng vận hành
```

| **Bước** | **Vai trò**  | **Mô tả**                                                                                       | **Tham chiếu** |
|----------|--------------|-------------------------------------------------------------------------------------------------|----------------|
| C0       | IT Admin     | Sự kiện bắt đầu: triển khai lần đầu hoặc cấu hình lại.                                          | —              |
| C1–C2    | IT Admin     | Cấu hình Web Service, Supabase PostgreSQL và biến môi trường trên Render.com.                   | NFR-03, FR-01.3|
| C3–C4    | Render.com   | Auto-deploy từ GitHub, chạy bộ test tự động (711 tests) và kiểm tra kết quả deploy.            | NFR-02, NFR-12 |
| C5–C6    | IT Admin     | Chạy migration PostgreSQL `0001` - `0014`, kiểm tra kết nối Supabase và Sheets.                 | FR-06.1, FR-07.5 |
| C7–C8    | IT Admin/Sys | Đăng ký webhook KiotViet, chạy sync ban đầu và bật scheduler định kỳ (kèm rollup, CN1/CN3/CN7).| FR-06.2, FR-06.3 |
| C9       | IT Admin     | Tạo tài khoản quản trị đầu tiên trong bảng `app_users`.                                         | FR-08.1        |
| C10      | —            | Hệ thống sẵn sàng vận hành đầy đủ.                                                              | —              |

---

# 8. Luồng D — Xác thực, Quản lý tài khoản & Khôi phục mật khẩu OTP

```
--- Nhánh D1: Đăng nhập nội bộ & Lockout 5 phút ---
[D1.1] Người dùng nhập username & mật khẩu -> POST /api/auth/login
       |-- Đúng mật khẩu -> Cấp JWT httpOnly cookie `tks_auth`, reset bộ đếm sai -> [Đăng nhập thành công]
       `-- Sai mật khẩu -> Tăng bộ đếm sai:
             |-- < 5 lần -> Thông báo sai mật khẩu (còn N lần thử)
             `-- >= 5 lần -> Kích hoạt Lockout 5 phút, trả thời gian đếm ngược

--- Nhánh D2: Khôi phục mật khẩu bằng OTP 6 số ---
[D2.1] Người dùng click "Quên mật khẩu?" -> Nhập username/email -> POST /api/auth/request-reset-otp
[D2.2] Backend sinh mã OTP 6 số (hạn 5 phút), che mờ Email/SĐT (`user***@...`)
[D2.3] Người dùng nhập mã OTP nhận được -> POST /api/auth/verify-reset-otp
       |-- Mã đúng -> Nhận `resetToken` tạm thời (10 phút)
       `-- Mã sai -> Báo lỗi (tối đa 3 lần thử)
[D2.4] Người dùng nhập mật khẩu mới -> POST /api/auth/reset-password-otp -> [Cập nhật mật khẩu thành công]

--- Nhánh D3: Quản lý hồ sơ & Quản trị người dùng (/account/) ---
[D3.1] Người dùng đăng nhập vào /account/ -> Xem thông tin cá nhân, cập nhật SĐT khôi phục hoặc đổi mật khẩu
[D3.2] Người dùng vai trò `Quản lý` -> Mở tab "Quản trị người dùng" -> Xem danh sách, tạo tài khoản mới, phân vai trò, đặt lại mật khẩu hoặc khóa tài khoản
```

---

# 8b. Luồng E — Đăng ký, Phê duyệt Nghỉ phép Nhân sự & Telegram Bot

```
--- Nhánh E1: Nộp đơn xin nghỉ phép qua Web Portal (/humanresources/) ---
[E1.1] Nhân viên mở /humanresources/ -> Kiểm tra số dư ngày phép (GET /api/hr/leave/balance)
[E1.2] Nhân viên điền form nộp đơn (loại nghỉ, từ ngày - đến ngày, số giờ/ngày, lý do) -> POST /api/hr/leave/requests
[E1.3] Backend xác thực dữ liệu, ghi nhận đơn vào tab `HR_Leaves` ở trạng thái PENDING
[E1.4] Telegram Bot tự động gửi thông báo đến nhóm Quản lý/HR kèm nút bấm hoặc thông tin duyệt đơn

--- Nhánh E2: Tương tác qua Telegram Bot (hrTelegramBot.js) ---
[E2.1] Nhân viên gửi tin nhắn /start hoặc /nghiphep đến Telegram Bot
[E2.2] Bot đối soát tài khoản qua conversationStore -> Hướng dẫn nhân viên chọn loại nghỉ và thời gian
[E2.3] Nhân viên xác nhận -> Bot gọi API nội bộ tạo đơn nghỉ phép và phản hồi mã đơn

--- Nhánh E3: Phê duyệt đơn & Xuất báo cáo (Quản lý / HR) ---
[E3.1] Quản lý mở Cổng thông tin duyệt đơn (GET /api/hr/leave/admin/requests)
[E3.2] Quản lý duyệt (POST .../approve) hoặc từ chối kèm lý do (POST .../reject)
[E3.3] Backend cập nhật trạng thái đơn, tính toán trừ số dư ngày phép trong năm
[E3.4] Telegram Bot gửi thông báo kết quả tức thì đến nhân viên
[E3.5] HR xuất báo cáo đối soát ngày nghỉ phép ra file Excel .xlsx (GET /api/hr/leave/export)
```

---

# 9. Truy vết yêu cầu

Mỗi bước trong các luồng đã được gắn mã yêu cầu chức năng/phi chức năng (FR-xx / NFR-xx) tương ứng với SRS v2.1 mục 3 và mục 4, giúp truy vết đầy đủ hai chiều giữa mô hình quy trình (BPMN) và đặc tả kỹ thuật (SRS).

| **Luồng** | **Yêu cầu SRS bao phủ**                      |
|-----------|----------------------------------------------|
| Luồng A   | FR-06.1 -> FR-06.14, NFR-09                   |
| Luồng B   | FR-01.1 -> FR-01.7, FR-02.x, FR-03.x, FR-04.x, FR-05.x, FR-07.1 -> FR-07.14, NFR-01, NFR-03, NFR-10, NFR-11 |
| Luồng C   | FR-01.3, FR-06.4, FR-07.5, NFR-02, NFR-03, NFR-12 |
| Luồng D   | FR-08.1 -> FR-08.7, NFR-03, NFR-12           |
| Luồng E   | CSNS-NP-01, HR Leave APIs, Telegram Bot, NFR-01, NFR-03 |

---

# 10. Ghi chú & khuyến nghị

- **Điểm mấu chốt:** Node.js Sync Engine (Luồng A) nhận webhook và đối soát polling trực tiếp từ KiotViet API vào Supabase PostgreSQL, thay thế hoàn toàn Apps Script. Tab "Trả NCC" duy trì trên Google Sheets. Tích hợp Result Cache giúp việc chuyển tab và đổi bộ lọc diễn ra tức thì (<10ms).
- **Phân tích công nợ chuyên sâu:** Dữ liệu CN1/CN3/CN7 được tổng hợp tự động vào bảng `customer_debt_activity_periods` định kỳ, phục vụ đối soát và cảnh báo công nợ khách hàng chưa thu theo chi nhánh.
- **Bảo mật đăng nhập & Tài khoản:** Xác thực JWT cookie kết hợp bảng PostgreSQL `app_users`; cơ chế lockout 5 phút ngăn chặn brute-force; mã OTP 6 số hết hạn sau 5 phút đảm bảo an toàn quy trình khôi phục tài khoản.
- **Phân hệ HR & Vòng đời đơn hàng:** Vòng đời đơn hàng đọc trực tiếp từ `ORDER_LIFECYCLE_SPREADSHEET_ID`; phân hệ HR Leave phối hợp linh hoạt giữa Web Portal và Telegram Bot lưu trữ trên Google Sheets `HR_Leaves`.
- **Khả năng suy giảm có kiểm soát:** Một bảng hoặc tab nguồn bị lỗi tạm thời chỉ làm rỗng section tương ứng, không làm sập toàn bộ Dashboard.
- **Nhất quán thời gian:** Backend xử lý ngày và `updatedAt` theo Asia/Ho_Chi_Minh.
- **Kiểm thử liên tục:** Trước khi commit hoặc deploy, luôn chạy `npm test` tại `server/` để kiểm tra toàn bộ **711 bài kiểm thử tự động**.

---

*Hết tài liệu BPMN v2.1*
