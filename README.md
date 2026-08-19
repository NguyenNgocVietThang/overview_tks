# TKS Dashboard — CHbansi Live Dashboard

Hệ thống dashboard thời gian thực cho cửa hàng CHbansi, đồng bộ dữ liệu từ KiotViet qua Google Apps Script + Google Sheets.

---

## Mục lục

- [Tổng quan](#tổng-quan)
- [Cấu trúc thư mục](#cấu-trúc-thư-mục)
- [Cài đặt & triển khai](#cài-đặt--triển-khai)
- [Cách sử dụng](#cách-sử-dụng)
- [Lộ trình mở rộng](#lộ-trình-mở-rộng)
- [Tài liệu kỹ thuật](#tài-liệu-kỹ-thuật)

---

## Tổng quan

| Hạng mục | Chi tiết |
|---|---|
| **Nền tảng** | Google Apps Script (V8 Runtime) + Node.js/Express Backend |
| **Lưu trữ dữ liệu** | Google Sheets (9 tab vận hành + 7 tab tổng hợp + 6 tab vận chuyển VC_* + tab Users) + Google Drive (Ảnh chứng từ) |
| **Nguồn dữ liệu** | KiotViet Public API & Webhook |
| **Cập nhật** | Webhook + hàng đợi bền vững trên tab ẩn; polling 15 phút cho nguồn không có webhook |
| **Apps Script** | Đồng bộ KiotViet -> Google Sheets; Web App `/exec` nhận HTTP POST; chuyển tiếp webhook vòng đời vận chuyển |
| **Múi giờ** | Asia/Ho_Chi_Minh (GMT+7) |

### Kiến trúc xử lý Webhook

```
KiotViet ──POST──▶ doPost()          ← Xác thực và ghi bền vững
                      │
             _KV_WEBHOOK_QUEUE        ← Tab ẩn, không tự hết hạn
                      │
               ┌── trigger/1 phút ──┐
               ▼                    │
    processWebhookQueue()           │  ← Đọc queue & ghi Sheet
               │                    │
     updateXxxFromWebhook()         └── LockService (tránh race condition)
               │
          Google Sheets
```

---

## Cấu trúc thư mục

```
webtks-dashboard/
├── .agents/                     # Custom agent skills & workflows
│   └── skills/
│       └── update-file/
│           └── SKILL.md         # Quy trình đồng bộ file khi cây thư mục thay đổi
├── .clasp.json                  # Cấu hình clasp (scriptId, rootDir: "src")
├── .claspignore                 # Loại trừ docs/, future-phases/, dev/, server/ khỏi clasp push
├── 3D Design.md                 # Kế hoạch chi tiết triển khai hiệu ứng 3D toàn trang
├── ERD KiotViet.drawio          # Sơ đồ quan hệ thực thể KiotViet
├── Logo.jpg                     # Logo thương hiệu công ty
├── Plan Process Automation.md   # Kế hoạch kiểm soát & tự động hóa quy trình vận chuyển
├── README.md                    # Tài liệu hướng dẫn tổng quan dự án
├── ROLLBACK.md                  # Hướng dẫn tắt & khôi phục nhanh lớp hiệu ứng 3D
│
├── design-system/               # Quy chuẩn giao diện dùng chung
│   └── tks-dashboard/
│       └── MASTER.md            # Token, component và quy tắc thiết kế dashboard
│
├── dev/                         # Giao diện tĩnh thử nghiệm / mock data
│   ├── index.html
│   └── vendor/
│       └── chart.umd.min.js
│
├── server/                      # Backend Node.js đọc/ghi Google Sheets & Web Server
│   ├── auth/                    # JWT, bcrypt, Google Identity, Users cục bộ bảo mật, OTP và phân quyền
│   │   ├── adminUserRoutes.js   # API /api/admin/users (CRUD tài khoản, reset mật khẩu, phân quyền)
│   │   ├── adminUserRoutes.test.js # Unit test routes quản trị người dùng
│   │   ├── authMiddleware.js    # requireAuth, requireRole bọc route
│   │   ├── authMiddleware.test.js # Unit test middleware xác thực
│   │   ├── authRoutes.js        # API /api/auth (login, register, google, me, profile, change-password, logout, reset OTP, lockout)
│   │   ├── authRoutes.test.js   # Unit test routes xác thực
│   │   ├── authService.js       # Xử lý JWT cookie và mật khẩu bcrypt
│   │   ├── authService.test.js  # Unit test auth service
│   │   ├── googleAuthService.js # Xác thực Google ID Token
│   │   ├── googleAuthService.test.js # Unit test Google auth
│   │   ├── localUserStore.js    # Lưu trữ dữ liệu người dùng cục bộ bảo mật (server/data/users.json)
│   │   ├── otpService.js        # Sinh mã xác thực OTP 6 số, che mờ Email/SĐT và kiểm tra thời hạn
│   │   ├── otpService.test.js   # Unit test OTP service
│   │   ├── userRepository.js    # Tầng truy xuất thông tin tài khoản người dùng
│   │   ├── userRepository.test.js # Unit test user repository
│   │   └── userWriteRepository.js # Tầng ghi thông tin người dùng bảo mật
│   ├── dashboard/
│   │   ├── dashboardData.js     # Thống kê tổng quan KPI, biểu đồ, tìm kiếm và Result Cache
│   │   ├── dashboardData.test.js # Unit test dữ liệu dashboard/tìm kiếm/cache
│   │   ├── debtReport.js        # Báo cáo công nợ khách hàng 1/3/7 ngày từ HN1/HN3/HN7
│   │   ├── exportService.js     # Registry 16 bảng và tạo workbook Excel
│   │   └── exportService.test.js # Unit test dữ liệu/file Excel
│   ├── data/
│   │   └── users.json           # Dữ liệu tài khoản người dùng cục bộ (local backup)
│   ├── jobs/
│   │   └── syncCustomerReport.js # Tác vụ đối soát toàn bộ 3 báo cáo lúc 07:00
│   ├── public/                  # Frontend Live Dashboard, Vận chuyển & Quản lý tài khoản
│   │   ├── account/
│   │   │   └── index.html       # Quản lý tài khoản (Hồ sơ cá nhân & Quản trị người dùng)
│   │   ├── index.html           # Live Dashboard (KPI, biểu đồ, phân trang, xuất Excel)
│   │   ├── Logo.jpg             # Logo thương hiệu frontend
│   │   ├── performance-test.html # Trang công cụ kiểm tra & đo lường hiệu năng 3D trực quan
│   │   ├── js/
│   │   │   ├── auth-guest-ui.test.js # Kiểm tra UI đăng ký/Google/tra cứu Khách/Tài khoản
│   │   │   ├── export-ui.test.js # Kiểm tra nút/modal xuất Excel trong giao diện
│   │   │   ├── pagination.js    # Phân trang client-side cho các bảng
│   │   │   ├── pagination.test.js # Unit test cho module phân trang
│   │   │   ├── three-bg.test.js # Kiểm tra hệ thống hạt 3D background và đổi theme
│   │   │   ├── three-buttons.test.js # Kiểm tra hiệu ứng 3D tactile press và ripple nút
│   │   │   ├── three-charts.js  # Biểu đồ doanh thu 3D Three.js cho dashboard
│   │   │   ├── three-css-transforms.test.js # Kiểm tra hiệu ứng 3D CSS perspective cho thẻ/panel
│   │   │   ├── three-infrastructure.test.js # Kiểm tra nạp và khởi tạo thư viện THREE.js r159
│   │   │   ├── three-interactions.test.js # Kiểm tra dynamic hover tilt và button/nav 3D
│   │   │   ├── three-loading.test.js # Kiểm tra 3D rotating loading cube
│   │   │   ├── three-navigation.test.js # Kiểm tra hiệu ứng 3D trượt nổi thanh điều hướng sidebar
│   │   │   └── three-tables.test.js     # Kiểm tra hiệu ứng 3D nổi dòng bảng và animation so le
│   │   ├── login/index.html     # Đăng nhập nội bộ, Google OAuth & Quên mật khẩu OTP
│   │   ├── register/index.html  # Đăng ký tài khoản Khách bằng Email hoặc Số điện thoại
│   │   ├── shared/              # CSS, điều hướng/auth guard, nén ảnh và hiệu ứng 3D dùng chung
│   │   │   ├── image-compress.js # Nén và resize ảnh trước khi upload
│   │   │   ├── shared-nav.js    # Header navigation dùng chung đa trang (3 mục cấp cao)
│   │   │   ├── shared.css       # Style theme và component dùng chung
│   │   │   ├── three-bg.js      # Hệ thống hạt 3D Particle Background toàn trang
│   │   │   ├── three-interactions.js # Bộ xử lý 3D dynamic tilt, 3D navigation, button ripple và table row animation
│   │   │   ├── three-loading.js # 3D rotating loading cube loader
│   │   │   ├── three-memory.js  # Bộ quản lý WebGL context và giải phóng bộ nhớ
│   │   │   ├── three-performance.js # Bộ giám sát FPS và tự động điều chỉnh chất lượng 3D
│   │   │   ├── three-performance.test.js # Unit test cho bộ giám sát hiệu năng
│   │   │   └── three-visibility.js # Bộ điều phối tạm dừng/tiếp tục hiệu ứng khi đổi tab
│   │   ├── shipment/
│   │   │   ├── index.html       # Tra cứu trạng thái hóa đơn cho khách hàng
│   │   │   ├── dispatch/
│   │   │   │   ├── index.html   # Web Desktop: Bảng điều phối vận đơn & Kanban (Kế toán)
│   │   │   │   └── dispatch.js  # Logic điều phối, lọc và cập nhật trạng thái
│   │   │   └── mobile/
│   │   │       ├── index.html   # Mobile Web 1-chạm (Thủ kho & Lái xe)
│   │   │       └── mobile.js    # Camera upload ảnh chứng từ & chuyển trạng thái
│   │   └── vendor/
│   │       ├── chart.umd.min.js # Thư viện biểu đồ 2D Chart.js
│   │       └── three.min.js     # Thư viện đồ họa 3D THREE.js r159 UMD
│   ├── scripts/
│   │   ├── setupUsersSheet.js   # CLI quản lý tài khoản người dùng và khởi tạo sheet Users
│   │   └── setupVcSheet.js      # CLI khởi tạo 6 tab vận chuyển VC_*
│   ├── sheets/
│   │   ├── sheetsClient.js      # Đọc dữ liệu Google Sheets cho dashboard
│   │   └── vcSheetsClient.js    # Đọc/ghi dữ liệu bảng vận chuyển VC_*
│   ├── shipment/
│   │   ├── driveService.js      # Tải ảnh chứng từ lên Google Drive theo ngày/mã đơn
│   │   ├── invoiceStatusService.js # Tra cứu mã/trạng thái, cache 90 giây
│   │   ├── invoiceStatusService.test.js # Unit test tra cứu trạng thái
│   │   ├── orderStateMachine.js # State Machine 9 trạng thái vận đơn & kiểm tra chuyển tiếp
│   │   ├── orderStateMachine.test.js # Unit test State Machine
│   │   ├── shipmentOrderRoutes.js # REST API vận đơn, điều phối, ảnh chứng từ, sự cố, đối soát
│   │   ├── vcOrderRepository.js # Thao tác CRUD 6 tab vận chuyển VC_*
│   │   └── vcOrderRepository.test.js # Unit test repository vận đơn
│   ├── config.js                # Cấu hình môi trường Node.js server
│   ├── index.js                 # Express server entry point
│   └── routes.js                # Định tuyến API endpoint (/api/dashboard/*, /api/auth/*, /api/admin/*, /api/shipment/*)
│
├── src/                         # Giai đoạn 1: Code Apps Script (clasp)
│   ├── appsscript.json          # Manifest Apps Script (timezone, oauthScopes)
│   ├── HuongDanSuDung.gs        # Hướng dẫn hàm và luồng liên kết ngay trên GAS
│   │
│   ├── config/
│   │   └── Config.gs            # object CONFIG (Client ID/Secret, tên các Sheet)
│   │
│   ├── kiotviet/
│   │   ├── Auth.gs              # getKiotVietToken() + cache token theo hạn
│   │   ├── CustomerDebtReport.gs # syncCustomerDebtReports, setupCustomerDebtReports,
│   │   │                        # setupCustomerDebtReportDailyTrigger (HN1/HN3/HN7)
│   │   ├── CustomerReport.gs    # syncCustomerReport, syncCustomerByProductReport,
│   │   │                        # setupCustomerReport, trigger 07:00
│   │   ├── DiscontinuedProducts.gs # syncHangNgungKinhDoanh, lưu lịch sử ngừng kinh doanh
│   │   ├── SheetSchemas.gs      # Schema đủ trường cho 9 sheet, fetch/retry,
│   │   │                        # ghi/upsert/migrate dữ liệu KiotViet
│   │   ├── SyncInitial.gs       # syncAllInitialData, sync 9 sheet vận hành,
│   │   │                        # setupPollingTrigger (15 phút)
│   │   └── WebhookAdmin.gs      # registerWebhookProgrammatically,
│   │                            # registerWebhookWithCorrectUrl,
│   │                            # listRegisteredWebhooks, checkWebhookStatus,
│   │                            # deleteAllOldWebhooks
│   │
│   ├── shipment/
│   │   └── KiotVietLifecycle.gs # Khởi tạo 6 tab vận chuyển, nhận invoice.update,
│   │                            # upsert đơn/chi tiết và backfill 7 ngày
│   │
│   ├── sync/
│   │   ├── UpdateHandlers.gs    # hydrate + update/delete Product, Invoice,
│   │   │                        # Order, Customer, Category
│   │   └── WebhookQueue.gs      # doPost, queue bền vững, retry,
│   │                            # processWebhookQueue, getWebhookQueueStatus
│   │
│   └── utils/
│       └── Helpers.gs           # getCodeRowMap, formatLastRowNumbers, formatDate
│
├── docs/
│   ├── performance-optimization-report.md # Báo cáo tối ưu hóa hiệu năng 3D, FPS & WebGL Memory
│   ├── 01-brd/
│   │   └── BRD_Dashboard_GoogleSheets.md # Yêu cầu nghiệp vụ BRD v1.7
│   ├── 02-srs/
│   │   └── SRS_Dashboard_GoogleSheets.md # Đặc tả kỹ thuật SRS v1.9
│   ├── 03-process/
│   │   ├── BPMN_Dashboard_GoogleSheets.md # Sơ đồ quy trình nghiệp vụ v1.8
│   │   └── bpmn/
│   │       ├── bpmn_1_phaseA.bpmn
│   │       ├── bpmn_2_phaseB.bpmn
│   │       └── bpmn_3_phaseC.bpmn
│   ├── 04-planning/
│   │   └── implementation_plan.md        # Kế hoạch triển khai chi tiết & trạng thái v2.0
│   └── superpowers/
│       ├── plans/
│       │   ├── 2026-08-13-dashboard-result-cache.md
│       │   └── 2026-08-13-dashboard-table-pagination.md
│       └── specs/
│           └── 2026-08-05-debt-dashboard-design.md
│
└── future-phases/               # Khung rỗng cho các giai đoạn sau
    ├── sales-pos/               # Giai đoạn 2: POS bán hàng
    ├── inventory/               # Giai đoạn 3: Quản lý kho nâng cao
    ├── analytics-anomaly/       # Giai đoạn 4: Phát hiện bất thường
    ├── directory/               # Giai đoạn 5: Danh bạ nội bộ
    └── ai-assistant/            # Giai đoạn 6: Chatbot & dự báo AI
```

---

## Cài đặt & triển khai

### Yêu cầu
- [Node.js](https://nodejs.org/) >= 18
- [@google/clasp](https://github.com/google/clasp): `npm install -g @google/clasp`
- Tài khoản Google có quyền truy cập Google Apps Script

### Chạy kiểm thử tự động (Server & Frontend logic)
Thư mục `server/` tích hợp sẵn bộ unit tests (dùng `node:test` chuẩn của Node.js, không cần thư viện ngoài):
```bash
cd server
npm test
```
Bộ test gồm **214 bài kiểm thử tự động** bao phủ toàn diện 100%:
- Xác thực người dùng (JWT httpOnly cookie, mật khẩu bcrypt, Google Identity OAuth, đăng ký bằng Email/SĐT, bảo vệ route RBAC 5 vai trò).
- Quản trị tài khoản Admin (CRUD danh sách người dùng, reset mật khẩu, kích hoạt/khóa tài khoản).
- Khôi phục mật khẩu OTP 6 số (sinh mã, gửi giả lập qua Email/SĐT, giới hạn thử lại, chống brute-force và cơ chế lockout tạm thời 5 phút).
- Quản lý hồ sơ cá nhân và đổi mật khẩu chủ động.
- Tra cứu trạng thái hóa đơn cho khách hàng (`invoiceStatusService.js` với cache 90s).
- State Machine vận đơn 9 trạng thái (`orderStateMachine.js`) và CRUD kho dữ liệu 6 tab vận chuyển (`vcOrderRepository.js`).
- Result Cache tầng backend tối ưu phản hồi tức thì (<10ms).
- Phân trang client-side (`pagination.js`) và module Xuất Excel 16 bảng (`exportService.js`).
- Tìm kiếm nhiều mã chính xác và Top 3 KH theo danh mục sản phẩm.
- Lớp hiệu ứng 3D Three.js: Particle background, card hover tilt, tactile press buttons, 3D navigation, table staggered rows, 3D rotating loading cube, adaptive performance monitor & WebGL memory disposal.

### Bước 1 — Clone & login
```bash
git clone <repo-url>
cd webtks-dashboard
clasp login
```

### Bước 2 — Điền Script ID
Mở `.clasp.json`, thay `<SCRIPT_ID_PLACEHOLDER>` bằng Script ID thật của bạn:
```json
{
  "scriptId": "YOUR_REAL_SCRIPT_ID_HERE",
  "rootDir": "src"
}
```
> Script ID lấy từ: **Apps Script Editor -> Project Settings -> Script ID**

### Bước 3 — Push code lên GAS
```bash
clasp push --force
```

Trong **Apps Script Editor -> Project Settings -> Script Properties**, tạo các thuộc tính:

- `KIOTVIET_CLIENT_ID`: Client ID của KiotViet.
- `KIOTVIET_CLIENT_SECRET`: Client Secret của KiotViet.
- `WEBHOOK_URL`: URL `/exec` của Web App sau khi deploy.

Không lưu các giá trị này trong mã nguồn hoặc commit lên Git.

Lần đầu, tạo version và deployment Web App mới:

```bash
clasp deploy --description "KiotViet auto-sync"
```

Lưu URL `https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec` vào Script Property
`WEBHOOK_URL`. Những lần phát hành sau, tạo version mới rồi cập nhật đúng deployment
đang dùng bằng `clasp redeploy <DEPLOYMENT_ID> -V <VERSION_MOI>`.
Manifest cũng chỉ cho phép chính tài khoản triển khai gọi hàm qua Apps Script
Execution API (`executionApi.access = MYSELF`) để phục vụ kiểm tra và vận hành an toàn.

### Bước 4 — Thiết lập lần đầu (chạy thủ công 1 lần)
1. Kiểm tra đã khai báo `KIOTVIET_CLIENT_ID` và `KIOTVIET_CLIENT_SECRET` trong Script Properties. Chỉ trên dự án sheet tổng hợp cũ, chạy `syncAllInitialData()` để tải dữ liệu ban đầu. Hàm này cũng cập nhật toàn bộ lịch sử vào tab **Hàng ngừng kinh doanh** và dọn tab legacy `Hàng ngừng KD hôm nay` nếu còn tồn tại.
2. Với sheet tổng hợp cũ, chạy `setupKiotVietAutoSync()` một lần. Chế độ mặc định `FULL_DASHBOARD` giữ nguyên trigger queue 1 phút, polling 15 phút, lịch báo cáo và 9 webhook.
3. Với sheet vận chuyển mới, đặt `KIOTVIET_SYNC_MODE=SHIPMENT_LIFECYCLE` và `KIOTVIET_SHIPMENT_RELAY_ENABLED=true`, chạy `syncShipmentLifecycleRecent7Days()` rồi `setupShipmentLifecycleSync()`. Do KiotViet chỉ cho một webhook mỗi Type, project cũ giữ `invoice.update` và chuyển tiếp sự kiện sang Web App mới bằng `SHIPMENT_WEBHOOK_URL` + `SHIPMENT_WEBHOOK_SECRET`.
4. Tab **Hàng bán theo khách** có đúng 5 cột và được webhook cập nhật trong khoảng 1 phút. Tab **Khách theo hàng hóa** có đúng 25 cột như file xuất KiotViet, lấy toàn bộ lịch sử và chỉ làm mới khi chạy tay hoặc gần 07:00. Cả ba báo cáo được đối soát bởi `setupCustomerReport()`; tab **Báo cáo bán hàng** giữ đủ 18 cột.
5. Ba tab **HN1**, **HN3**, **HN7** là báo cáo công nợ khách hàng 1/3/7 ngày gần đây (tính cả hôm nay) do Apps Script tự tính từ dữ liệu KiotViet và ghi đè mỗi ngày gần 15:00, hoặc chạy tay `syncCustomerDebtReports()` bất cứ lúc nào cần cập nhật ngay.

Sau khi bật, thay đổi Hàng hóa, Tồn kho, Khách hàng, Hóa đơn, Đặt hàng và Nhóm hàng
được nhận bằng webhook rồi ghi vào Sheets trong khoảng 1 phút. **Trả hàng**, **Nhà cung
cấp** và **Nhập hàng** được quét dự phòng mỗi 15 phút vì KiotViet không phát webhook
cho ba nhóm này.

### Bước 5 — Deploy Web App
1. **Deploy -> New deployment -> Web App**
2. Execute as: **Me**, Access: **Anyone**
3. Copy URL `/exec` -> lưu vào Script Property `WEBHOOK_URL`

---

## Cách sử dụng

| Hàm | Mục đích | Khi nào chạy |
|---|---|---|
| `syncAllInitialData()` | Làm mới 9 sheet vận hành, lịch sử Hàng ngừng kinh doanh, 3 báo cáo khách hàng và HN1/HN3/HN7; báo cáo công nợ chạy sau khi Hàng hóa đã cập nhật | Lần đầu hoặc khi cần full refresh |
| `syncHangNgungKinhDoanh()` | Nạp các sản phẩm đang ngừng kinh doanh và giữ lịch sử các sản phẩm từng ngừng; không tạo tab theo ngày | Khi cần đối soát thủ công |
| `cauHinhLichHangNgungKinhDoanh()` | Cập nhật toàn bộ lịch sử và tạo lại lịch cập nhật 07:00 hàng ngày | Một lần sau khi deploy |
| `removeJsonColumnsFromAllSheets()` | Xóa ngay các cột `(JSON)` cũ trên 9 sheet vận hành | Tùy chọn; trigger nền cũng tự chạy một lần sau khi deploy |
| `setupKiotVietAutoSync()` | Bật hoặc khôi phục webhook và trigger an toàn, không tạo trùng | 1 lần sau khi deploy |
| `initializeShipmentLifecycleSheets()` | Tạo/kiểm tra đủ 6 tab và header vận chuyển | Khi chuẩn bị sheet mới |
| `syncShipmentLifecycleRecent7Days()` | Nạp hóa đơn 7 ngày gần nhất theo từng trang, tránh chạy full quá quota | Một lần ban đầu hoặc khi đối soát |
| `setupShipmentLifecycleSync()` | Chọn chế độ vòng đời vận chuyển và tạo trigger queue; nhận `invoice.update` chuyển tiếp từ project cũ | Một lần trên dự án sheet mới |
| `syncPollingOnly_()` | Làm mới Trả hàng, Nhà cung cấp, Nhập hàng | Tự chạy bởi trigger 15 phút |
| `setupPollingTrigger()` | Bật lịch làm mới 3 sheet không có webhook | 1 lần duy nhất |
| `removePollingTrigger()` | Tắt lịch làm mới 15 phút | Khi bảo trì |
| `syncCustomerReport()` | Làm mới cả ba báo cáo khách hàng trong một lượt lấy API | Khi cần cập nhật/đối soát thủ công |
| `syncCustomerProductReport()` | Làm mới Hàng bán theo khách 5 cột (đồng thời làm mới hai báo cáo còn lại) | Khi cần cập nhật thủ công |
| `syncCustomerByProductReport()` | Làm mới Khách theo hàng hóa 25 cột, toàn bộ lịch sử (đồng thời làm mới hai báo cáo còn lại) | Khi cần cập nhật thủ công |
| `setupCustomerReport()` | Tạo cả ba báo cáo ngay và bật lịch riêng gần 07:00 | Một lần sau khi deploy |
| `setupCustomerReportDailyTrigger()` | Tạo lại lịch cập nhật ba báo cáo hàng ngày gần 07:00 | Khi cần khôi phục lịch |
| `syncCustomerDebtReports()` | Tính lại công nợ khách hàng 1/3/7 ngày gần đây và ghi đè cả 3 tab HN1/HN3/HN7 | Khi cần cập nhật/đối soát ngay lập tức |
| `setupCustomerDebtReports()` | Tạo báo cáo HN1/HN3/HN7 ngay và bật thêm lịch riêng gần 15:00 | Tùy chọn |
| `setupCustomerDebtReportDailyTrigger()` | Tạo lại lịch cập nhật HN1/HN3/HN7 hàng ngày gần 15:00 | Khi cần khôi phục lịch |
| `removeCustomerDebtReportDailyTrigger()` | Gỡ lịch cập nhật HN1/HN3/HN7 hàng ngày | Khi cần tạm dừng tự động cập nhật |
| `setupQueueProcessingTrigger()` | Tạo trigger 1 phút | 1 lần duy nhất |
| `getWebhookQueueStatus()` | Đếm sự kiện còn chờ trong hàng đợi bền vững | Khi kiểm tra vận hành |
| `retryWebhookQueueErrors()` | Đưa sự kiện lỗi về hàng chờ sau khi đã sửa nguyên nhân | Khi queue có dòng `ERROR` |
| `checkWebhookStatus()` | Kiểm tra webhook đang active | Khi debug |
| `listRegisteredWebhooks()` | Liệt kê webhook đã đăng ký | Khi debug |
| `deleteAllOldWebhooks()` | Xóa toàn bộ webhook cũ | Khi cần đăng ký lại |
| `registerWebhookWithCorrectUrl()` | Đăng ký webhook mới với URL /exec | Sau khi deploy mới |

---

## Hiệu ứng 3D (3D Effects)

Dashboard có lớp hiệu ứng 3D tùy chọn (progressive enhancement) trên cả 7 trang giao diện: `index.html`, `login/`, `register/`, `account/`, `shipment/`, `shipment/dispatch/`, `shipment/mobile/`. Trang vẫn hoạt động đầy đủ nếu lớp này bị tắt hoặc lỗi.

### Thành phần

| File | Vai trò |
|---|---|
| `server/public/vendor/three.min.js` | Thư viện THREE.js r159 (UMD, ~650KB), nguồn cho `window.THREE` |
| `server/public/shared/three-bg.js` | Particle background toàn trang (canvas `.tks-bg-canvas`, tự đổi màu theo theme, tự dừng khi tab ẩn) |
| `server/public/shared/three-interactions.js` | Tilt 3D cho card/KPI theo vị trí chuột, press effect cho button, depth cho nav item — chỉ dùng CSS transform, **không** cần `window.THREE` |
| `server/public/shared/three-loading.js` | 3D loading cube (thuần CSS), auto-upgrade mọi `.loading-veil` |
| `server/public/js/three-charts.js` | Biểu đồ doanh thu 3D (`window.TKSCharts3D.renderRevenue3D`), chỉ dùng ở `index.html` |
| `server/public/shared/three-performance.js` | Theo dõi FPS, tự hạ chất lượng particle khi máy yếu (`window.TKSPerformance`) |
| `server/public/shared/three-memory.js` | Theo dõi & dọn WebGL context/geometry/material để tránh leak (`window.TKSMemory`) |
| `server/public/shared/three-visibility.js` | Trung tâm pause/resume các module 3D khi đổi tab (`window.TKSVisibility`) |

### Thứ tự load

Mỗi trong 7 trang load 3D theo đúng thứ tự sau (bắt buộc — các module sau phụ thuộc module trước):

```html
<!-- Đầu trang, trong <head> — không cần THREE.js -->
<script src="/shared/three-interactions.js"></script>
<script src="/shared/three-loading.js"></script>

<!-- Cuối trang, trước </body> — cần THREE.js load trước -->
<script src="/vendor/three.min.js"></script>
<script src="/shared/three-performance.js"></script>
<script src="/shared/three-memory.js"></script>
<script src="/shared/three-visibility.js"></script>
<script src="/shared/three-bg.js"></script>
<!-- Chỉ index.html: -->
<script src="/js/three-charts.js"></script>
```

### Tắt hiệu ứng

- **Tắt trên 1 trang:** xóa toàn bộ các thẻ `<script src="/shared/three-*.js">`, `<script src="/vendor/three.min.js">` và (nếu có) `<script src="/js/three-charts.js">` khỏi trang đó. Trang hoạt động bình thường — mọi handler 3D tự kiểm tra `window.THREE`/DOM trước khi chạy, không throw lỗi khi thiếu.
- **Tắt toàn site:** lặp lại thao tác trên cho cả 7 trang. Xem hướng dẫn từng bước và lệnh khôi phục bằng git tại [ROLLBACK.md](ROLLBACK.md).

### Hiệu năng & Khả năng tiếp cận

- Particle count tự thích ứng theo thiết bị: 300 (desktop) / 100 (mobile), giảm tiếp xuống 50 nếu FPS thấp (`three-performance.js`, 4 mức chất lượng).
- Tối đa 8 WebGL context được theo dõi và dispose tự động khi rời trang (`three-memory.js`).
- Toàn bộ animation dừng khi tab ẩn (`three-visibility.js`) và khi `prefers-reduced-motion: reduce` được bật.
- Canvas nền trang trí mang `aria-hidden="true"`; canvas biểu đồ 3D mang `role="img"` + `aria-label`; focus indicator (`:focus-visible`) độc lập với transform 3D nên không bị ảnh hưởng.
- Chi tiết đầy đủ: [Performance Optimization Report](docs/performance-optimization-report.md), [3D Design Plan](3D%20Design.md) (Task 12, Task 13).

---

## Cache tĩnh (Static Asset Caching)

Dashboard áp dụng chiến lược Cache-Control rõ ràng cho từng loại file tĩnh:

| Loại file | Cache-Control | Mục đích |
|---|---|---|
| Thư viện vendor (`/vendor/`) | `public, max-age=86400` (1 ngày) | Chart.js, THREE.js thay đổi hiếm khi |
| JS/CSS dùng chung (`/shared/*.js|css`, `/js/*.js`) | `public, max-age=3600` (1 giờ) | Có thể sửa đổi thường xuyên hơn |
| Ảnh (`*.png`, `*.jpg`, `*.svg`, `*.webp`, `*.ico`) | `public, max-age=604800` (7 ngày) | Thay đổi rất hiếm khi |
| HTML (entry points như `index.html`) | Không set custom; dùng ETag revalidation | Luôn kiểm tra phiên bản mới sau deploy |

**Rủi ro:** Sau khi deploy một bugfix khẩn cấp trên JS/CSS core, người dùng có thể vẫn thấy bản code cũ trong tối đa **1 giờ** do trình duyệt cache local.

**Hướng dẫn cho người dùng:** Nếu cần xem bản mới ngay lập tức sau một deploy khẩn cấp, hướng dẫn họ nhấn **Ctrl+F5** (Windows/Linux) hoặc **Cmd+Shift+R** (Mac) để thực hiện hard refresh (bypass cache).

---

## Lộ trình mở rộng

| Giai đoạn | Module | Mô tả |
|---|---|---|
| **1** [Hoan thanh] | `src/` | Dashboard real-time (đang chạy) |
| **2** [Chua bat dau] | `future-phases/sales-pos/` | POS bán hàng tích hợp |
| **3** [Chua bat dau] | `future-phases/inventory/` | Quản lý kho nâng cao, cảnh báo |
| **4** [Chua bat dau] | `future-phases/analytics-anomaly/` | Phát hiện bất thường, fraud detection |
| **5** [Chua bat dau] | `future-phases/directory/` | Danh bạ nhân viên / đối tác |
| **6** [Chua bat dau] | `future-phases/ai-assistant/` | Chatbot tư vấn & dự báo bằng AI |

---

## Tài liệu kỹ thuật

| Tài liệu | Mô tả |
|---|---|
| [BRD](docs/01-brd/BRD_Dashboard_GoogleSheets.md) | Business Requirements Document v1.7 |
| [SRS](docs/02-srs/SRS_Dashboard_GoogleSheets.md) | Software Requirements Specification v1.9 |
| [BPMN](docs/03-process/BPMN_Dashboard_GoogleSheets.md) | Sơ đồ quy trình nghiệp vụ v1.8 |
| [Implementation Plan](docs/04-planning/implementation_plan.md) | Kế hoạch triển khai chi tiết & trạng thái v2.0 |
| [Plan Process Automation](Plan%20Process%20Automation.md) | Kế hoạch kiểm soát & tự động hóa quy trình vận chuyển hàng hóa |
| [3D Design Plan](3D%20Design.md) | Kế hoạch chi tiết thiết kế hiệu ứng 3D toàn bộ 7 trang giao diện |
| [Performance Optimization Report](docs/performance-optimization-report.md) | Báo cáo tối ưu hiệu năng 3D, kiểm thử FPS và quản lý bộ nhớ WebGL |
| [3D Rollback Guide](ROLLBACK.md) | Hướng dẫn tắt/khôi phục lớp hiệu ứng 3D trên từng trang hoặc toàn site |
| [Server Guide](server/README.md) | Hướng dẫn triển khai, kiểm thử và tài liệu API backend Node.js |
| [Design System Master](design-system/tks-dashboard/MASTER.md) | Hệ thống token, component và quy tắc giao diện |
| [Debt Dashboard Spec](docs/superpowers/specs/2026-08-05-debt-dashboard-design.md) | Đặc tả thiết kế module Báo cáo công nợ HN1/HN3/HN7 |
| [Result Cache Plan](docs/superpowers/plans/2026-08-13-dashboard-result-cache.md) | Kế hoạch & chi tiết triển khai Result Cache tầng backend |
| [Pagination Plan](docs/superpowers/plans/2026-08-13-dashboard-table-pagination.md) | Kế hoạch & chi tiết triển khai phân trang bảng client-side |
| [Apps Script Guide](src/HuongDanSuDung.gs) | Hướng dẫn hàm, tác dụng và luồng liên kết; được push lên Apps Script |

---

## Ghi chú kỹ thuật

> **Thứ tự load file trong GAS**: clasp sắp xếp file theo thứ tự alphabetical của thư mục.
> `HuongDanSuDung.gs` -> `config/` -> `kiotviet/` -> `shipment/` -> `sync/` -> `utils/`
> Đảm bảo `Config.gs` luôn được khởi tạo trước tất cả các module khác.

> Apps Script không có `doGet()` hoặc file HTML. Deployment Web App chỉ tồn tại
> để KiotViet gọi `doPost()` qua URL `/exec`.

> **Schema dữ liệu:** 9 sheet vận hành giữ nguyên các cột dashboard ở bên trái và
> chỉ bổ sung các trường KiotViet dạng phẳng đang được sử dụng. Apps Script không
> ghi object/mảng hoặc payload gốc vào cột JSON; trigger nền tự xóa các cột JSON
> của schema cũ một lần sau khi phiên bản mới được deploy. HN1/HN3/HN7 dùng schema
> báo cáo riêng (một dòng cho mỗi giao dịch hoặc mặt hàng trong giao dịch)
> do `CustomerDebtReport.gs` tự quản lý, tách biệt với 9 sheet vận hành.

---

*Cập nhật lần cuối: 18/08/2026*
