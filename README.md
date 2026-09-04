# TKS Dashboard

Hệ thống dashboard thời gian thực cho cửa hàng CHhanoi và CHsaigon, đồng bộ dữ liệu từ KiotViet qua Google Apps Script + Google Sheets.

---

## Mục lục

- [Tổng quan](#tổng-quan)
- [Cấu trúc thư mục](#cấu-trúc-thư-mục)
- [Cài đặt & triển khai](#cài-đặt--triển-khai)
- [Cấu hình đa cơ sở (Hà Nội / Sài Gòn)](#cấu-hình-đa-cơ-sở-hà-nội--sài-gòn)
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
               ┌── trigger/5 phút ──┐
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
├── .clasp.json                  # Project KiotHN / Dashboard (rootDir: "src-dashboard")
├── .clasp.saigon.json           # Project KiotSG (rootDir: "src-dashboard", dùng chung code với KiotHN)
├── .claspignore                 # Ignore profile cho project KiotHN / Dashboard
├── .claspignore.saigon          # Ignore profile cho project KiotSG
├── .firebaserc                  # Firebase project mặc định: tokosi-a02e0
├── CHINH-SACH-NGHI-PHEP.md      # Quy định & chính sách quản lý nghỉ phép nhân sự (CSNS-NP-01)
├── ERD KiotViet.drawio          # Sơ đồ quan hệ thực thể KiotViet
├── firebase.json                # Liên kết source server/ với Firebase App Hosting
├── Logo.jpg                     # Logo thương hiệu công ty
├── Plan Process Automation.md   # Kế hoạch kiểm soát & tự động hóa quy trình vận chuyển
├── README.md                    # Tài liệu hướng dẫn tổng quan dự án
│
├── design-system/               # Quy chuẩn giao diện dùng chung
│   └── tks-dashboard/
│       └── MASTER.md            # Token, component và quy tắc thiết kế dashboard
│
├── dev/                         # Giao diện tĩnh thử nghiệm / mock data
│   ├── baseline-check.js        # Script kiểm tra độ tương thích style baseline
│   ├── baseline.json            # Snapshot baseline các class và token UI
│   ├── index.html
│   └── vendor/
│       └── chart.umd.min.js
│
├── server/                      # Backend Node.js đọc/ghi Google Sheets & Web Server
│   ├── apphosting.yaml          # Runtime, tài nguyên và Secret Manager cho Firebase App Hosting
│   ├── auth/                    # JWT, bcrypt, Google Identity, Users cục bộ bảo mật, OTP, phân quyền & đổi vai trò
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
│   │   ├── roleChangeRequestRepository.js # Kho lưu trữ yêu cầu đổi vai trò của người dùng
│   │   ├── roleChangeRequestRoutes.js # API /api/role-requests (tạo yêu cầu, duyệt/từ chối vai trò)
│   │   ├── userRepository.js    # Tầng truy xuất thông tin tài khoản người dùng
│   │   ├── userRepository.test.js # Unit test user repository
│   │   └── userWriteRepository.js # Tầng ghi thông tin người dùng bảo mật
│   ├── branch/                  # Phân quyền và xác định cơ sở (Hà Nội / Sài Gòn) theo request
│   │   ├── branchMiddleware.js  # Middleware gắn req.branch, chặn tài khoản chưa gán cơ sở
│   │   ├── branchMiddleware.test.js # Unit test middleware phân quyền cơ sở
│   │   ├── branchRoutes.js      # API danh sách cơ sở khả dụng cho tài khoản hiện tại
│   │   ├── branches.js          # Chuẩn hóa coSo, tra cứu cấu hình theo cơ sở
│   │   └── branches.test.js     # Unit test chuẩn hóa và tra cứu cơ sở
│   ├── dashboard/
│   │   ├── dashboardData.js     # Thống kê tổng quan KPI, biểu đồ, tìm kiếm và Result Cache
│   │   ├── dashboardData.test.js # Unit test dữ liệu dashboard/tìm kiếm/cache
│   │   ├── debtReport.js        # Báo cáo công nợ khách hàng 1/3/7 ngày từ HN1/HN3/HN7
│   │   ├── exportService.js     # Registry 16 bảng và tạo workbook Excel
│   │   ├── exportService.test.js # Unit test dữ liệu/file Excel
│   │   └── stockoutCheck/       # Kiểm tra đứt hàng đối chiếu file Excel với KiotViet API
│   │       ├── concurrencyPool.js # Quản lý hàng đợi tải đồng thời có giới hạn
│   │       ├── concurrencyPool.test.js
│   │       ├── excelParser.js   # Đọc và phân tích file Excel danh sách sản phẩm
│   │       ├── excelParser.test.js
│   │       ├── jobManager.js    # Quản lý vòng đời tác vụ kiểm tra bất đồng bộ
│   │       ├── jobManager.test.js
│   │       ├── kiotVietClient.js # Giao tiếp KiotViet API lấy chi tiết tồn/giao dịch
│   │       ├── kiotVietClient.test.js
│   │       ├── productCodeValidator.js # Xác thực mã sản phẩm hợp lệ
│   │       ├── productCodeValidator.test.js
│   │       ├── stockoutAnalyzer.js # Phân tích nguyên nhân và mốc đứt hàng
│   │       ├── stockoutAnalyzer.test.js
│   │       ├── stockoutCheckRoutes.js # API /api/products/stockout-check/*
│   │       ├── stockoutCheckRoutes.test.js
│   │       ├── stockoutCheckService.js # Điều phối toàn bộ quy trình kiểm tra đứt hàng
│   │       ├── stockoutCheckService.test.js
│   │       ├── timelineBuilder.js # Xây dựng dòng thời gian biến động tồn kho
│   │       └── timelineBuilder.test.js
│   ├── data/
│   │   ├── notifications.json   # Lưu trữ thông báo hệ thống cục bộ
│   │   ├── roleChangeRequests.json # Lưu trữ yêu cầu đổi vai trò cục bộ
│   │   ├── users.json           # Dữ liệu tài khoản người dùng cục bộ (local backup)
│   │   └── users.json.example   # Bản mẫu cấu trúc dữ liệu người dùng
│   ├── hr/                      # Phân hệ Quản lý Nghỉ phép Nhân sự (HR Leave Management)
│   │   ├── hrLeaveEvents.js     # EventEmitter singleton phát sự kiện SSE cập nhật realtime cho đơn nghỉ phép
│   │   ├── hrLeaveExportService.js # Xuất báo cáo danh sách ngày nghỉ phép nhân sự ra Excel
│   │   ├── hrLeaveRepository.js # Tầng truy xuất dữ liệu ngày phép từ Google Sheets HR_Leaves
│   │   ├── hrLeaveRepository.test.js # Unit test schema, quy đổi và lọc theo thời gian gửi
│   │   ├── hrLeaveRoutes.js     # API /api/hr/leave/* (nộp đơn, tra cứu số dư, duyệt/từ chối, stream SSE, xuất báo cáo)
│   │   ├── hrLeaveRoutes.test.js # Unit test API nhập nghỉ theo ngày/buổi
│   │   └── hrLeaveService.js    # Tính buổi nghỉ theo Sáng/Chiều và kiểm tra mốc gửi 07:45/12:30
│   ├── jobs/
│   │   └── syncCustomerReport.js # Tác vụ đối soát từng báo cáo lúc 06:00, 06:30, 07:00
│   ├── notifications/           # Hệ thống thông báo dùng chung toàn hệ thống
│   │   ├── notificationRepository.js # CRUD thông báo trong server/data/notifications.json
│   │   ├── notificationRepository.test.js
│   │   ├── notificationRoutes.js # API /api/notifications/* (chuông thông báo, đọc, xóa)
│   │   └── notificationRoutes.test.js
│   ├── public/                  # Frontend Live Dashboard, Vận chuyển & Quản lý tài khoản
│   │   ├── 404.html             # Trang lỗi 404 tùy biến giao diện
│   │   ├── account/
│   │   │   └── index.html       # Quản lý tài khoản (Hồ sơ cá nhân, Đổi vai trò & Quản trị người dùng)
│   │   ├── humanresources/
│   │   │   └── index.html       # Cổng thông tin nhân sự: nộp đơn nghỉ phép, tra cứu ngày phép & phê duyệt
│   │   ├── index.html           # Live Dashboard (KPI, biểu đồ, phân trang, xuất Excel)
│   │   ├── Logo.jpg             # Logo thương hiệu frontend
│   │   ├── js/
│   │   │   └── pagination.js    # Phân trang client-side cho các bảng
│   │   ├── login/index.html     # Đăng nhập nội bộ, Google OAuth & Quên mật khẩu OTP
│   │   ├── register/index.html  # Đăng ký tài khoản Khách bằng Email hoặc Số điện thoại
│   │   ├── shared/              # CSS, điều hướng/auth guard, chuông thông báo và nén ảnh
│   │   │   ├── image-compress.js # Nén và resize ảnh trước khi upload
│   │   │   ├── shared-nav.js    # Header navigation dùng chung đa trang (Báo cáo, Vận chuyển, Nhân sự, Tài khoản, Chuông thông báo)
│   │   │   └── shared.css       # Style theme và component dùng chung
│   │   ├── shipment/
│   │   │   ├── index.html       # Tra cứu trạng thái hóa đơn cho khách hàng
│   │   │   ├── dispatch/
│   │   │   │   ├── index.html   # Web Desktop: Bảng điều phối vận đơn & Kanban (Kế toán)
│   │   │   │   └── dispatch.js  # Logic điều phối, lọc và cập nhật trạng thái
│   │   │   └── mobile/
│   │   │       ├── index.html   # Mobile Web 1-chạm (Thủ kho & Lái xe)
│   │   │       └── mobile.js    # Camera upload ảnh chứng từ & chuyển trạng thái
│   │   └── vendor/
│   │       └── chart.umd.min.js # Thư viện biểu đồ Chart.js
│   ├── scripts/
│   │   ├── setupHrSheet.js      # CLI khởi tạo 3 tab HR_Leaves, HR_Employees, HR_Policy
│   │   ├── setupUsersSheet.js   # CLI quản lý tài khoản người dùng và khởi tạo sheet Users
│   │   ├── setupVcSheet.js      # CLI khởi tạo 6 tab vận chuyển VC_*
│   │   ├── styleBaselineSnapshot.js # Chụp snapshot token CSS giao diện
│   │   └── tokenizeHardcodedStyles.js # Tiện ích chuẩn hóa token style dùng chung
│   ├── sheets/
│   │   ├── hrSheetsClient.js    # Đọc/ghi dữ liệu bảng nhân sự HR_Leaves, HR_Employees, HR_Policy
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
│   ├── telegram/                # Tích hợp Telegram Bot tương tác HR & thông báo
│   │   ├── conversationStore.js # Quản lý hội thoại đa bước của người dùng với Telegram Bot
│   │   ├── conversationStore.test.js # Unit test lưu trữ hội thoại bot
│   │   ├── hrTelegramBot.js     # Telegram Bot nộp đơn xin nghỉ, tra cứu số dư phép, thông báo duyệt đơn
│   │   └── hrTelegramBot.test.js # Unit test HR Telegram Bot
│   ├── test/
│   │   ├── apps-script-sync.test.js # Hồi quy URL webhook stale và typed-column Google Sheets
│   │   ├── apps-script-report-schedule.test.js # Unit test lịch phân bổ đồng bộ báo cáo
│   │   └── frontend/            # Unit test giao diện, chuông thông báo, đổi vai trò, phân trang và chống tái xuất hiện hiệu ứng 3D
│   ├── config.js                # Cấu hình môi trường Node.js server
│   ├── index.js                 # Express server entry point
│   ├── package.json             # Dependencies, Node 22 và lệnh build/start
│   └── routes.js                # Định tuyến API endpoint (/api/dashboard/*, /api/auth/*, /api/admin/*, /api/branch, /api/shipment/*, /api/hr/*, /api/notifications/*, /api/role-requests/*, /api/products/stockout-check/*, /api/customer-product-revenue)
│
├── src-dashboard/               # Apps Script riêng cho Google Sheets Dashboard
│   ├── appsscript.json          # Manifest Apps Script Dashboard
│   ├── HuongDanSuDung.gs        # Hướng dẫn syncAllDataChunked(), setupKiotVietAutoSync()
│   ├── config/Config.gs         # CONFIG, getKiotVietSyncMode_()
│   ├── kiotviet/
│   │   ├── ArchiveOldData.gs    # previewArchiveOldKiotVietData(), archiveOldKiotVietData()
│   │   ├── Auth.gs              # getKiotVietToken(), clearKiotVietToken()
│   │   ├── CustomerDebtReport.gs # syncCustomerDebtReports(), setupCustomerDebtReports()
│   │   ├── CustomerReport.gs    # syncCustomerReport(), syncSalesCustomerReport(),
│   │   │                        # syncCustomerProductReport(), syncCustomerByProductReport(),
│   │   │                        # setupCustomerReportDailyTrigger() (06:00/06:30/07:00)
│   │   ├── SheetSchemas.gs      # migrateKiotVietSheetsIfNeeded_(), syncKiotVietTableChunk_()
│   │   ├── SyncInitial.gs       # syncAllInitialData(), setupPollingTrigger()
│   │   └── WebhookAdmin.gs      # setupKiotVietAutoSync(), checkWebhookStatus()
│   ├── sync/
│   │   ├── UpdateHandlers.gs    # updateProductsFromWebhook(), updateInvoicesFromWebhook()
│   │   └── WebhookQueue.gs      # doPost(), processWebhookQueue(), forwardInvoiceWebhookToShipment_()
│   └── utils/Helpers.gs         # getKiotVietDataLock_(), formatDate()
│
├── docs/
│   ├── manual-test-batch-update-order-items.md # Hướng dẫn kiểm thử production cập nhật hàng loạt đơn vận chuyển
│   ├── 01-brd/
│   │   └── BRD_Dashboard_GoogleSheets.md # Yêu cầu nghiệp vụ BRD v1.9
│   ├── 02-srs/
│   │   └── SRS_Dashboard_GoogleSheets.md # Đặc tả kỹ thuật SRS v2.2
│   ├── 03-process/
│   │   ├── BPMN_Dashboard_GoogleSheets.md # Sơ đồ quy trình nghiệp vụ v2.0
│   │   └── bpmn/
│   │       ├── bpmn_1_phaseA.bpmn
│   │       ├── bpmn_2_phaseB.bpmn
│   │       └── bpmn_3_phaseC.bpmn
│   ├── 04-planning/
│   │   └── implementation_plan.md        # Kế hoạch triển khai chi tiết & trạng thái v2.3
│   └── superpowers/
│       ├── plans/
│       │   ├── 2026-08-13-dashboard-result-cache.md
│       │   ├── 2026-08-13-dashboard-table-pagination.md
│       │   ├── 2026-08-19-tks-lag-optimization.md
│       │   ├── 2026-08-20-stagger-customer-report-triggers.md
│       │   ├── 2026-08-21-hr-leave-days-input.md
│       │   ├── 2026-08-22-gemini-one-message-leave-request.md
│       │   └── 2026-08-22-hr-leave-sessions-submission-filter.md
│       └── specs/
│           ├── 2026-08-05-debt-dashboard-design.md
│           ├── 2026-08-20-stagger-customer-report-triggers-design.md
│           └── 2026-08-22-hr-leave-sessions-and-submission-time-design.md
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
Bộ test hiện gồm **477 bài kiểm thử tự động** (13 test suite):
- Phân hệ Quản lý Nghỉ phép HR & Telegram Bot (`hrLeaveRoutes.js`, `hrLeaveService.js`, `hrLeaveExportService.js`, `hrTelegramBot.js`, `conversationStore.js`).
- Xác thực người dùng (JWT httpOnly cookie, mật khẩu bcrypt, Google Identity OAuth, đăng ký bằng Email/SĐT, bảo vệ route RBAC 5 vai trò).
- Quản trị tài khoản Admin (CRUD danh sách người dùng, reset mật khẩu, kích hoạt/khóa tài khoản, xuất báo cáo).
- Yêu cầu đổi vai trò người dùng (`roleChangeRequestRoutes.js`) & Chuông thông báo toàn hệ thống (`notificationRoutes.js`, `notif-bell.test.js`).
- Khôi phục mật khẩu OTP 6 số (sinh mã, gửi giả lập qua Email/SĐT, giới hạn thử lại, chống brute-force và cơ chế lockout tạm thời 5 phút).
- Quản lý hồ sơ cá nhân và đổi mật khẩu chủ động.
- Kiểm tra đứt hàng đối chiếu Excel với KiotViet API (`stockoutCheckService.js`, `excelParser.js`, `timelineBuilder.js`, `stockoutAnalyzer.js`, `concurrencyPool.js`).
- Tra cứu trạng thái hóa đơn cho khách hàng (`invoiceStatusService.js` với cache 90s).
- State Machine vận đơn 9 trạng thái (`orderStateMachine.js`) và CRUD kho dữ liệu 6 tab vận chuyển (`vcOrderRepository.js`).
- Result Cache tầng backend tối ưu phản hồi tức thì (<10ms).
- Phân trang client-side (`pagination.js`) và module Xuất Excel 16 bảng (`exportService.js`).
- Tìm kiếm nhiều mã chính xác và Top 3 KH theo danh mục sản phẩm.
- Phân quyền theo cơ sở (`branches.js`, `branchMiddleware.js`): chuẩn hóa `coSo`, chặn tài khoản chưa gán cơ sở, chống giả mạo cookie `tks_branch`, cách ly cache dữ liệu giữa hai cơ sở, và nút chọn cơ sở trên thanh điều hướng (`branch-switcher.test.js`).

### Bước 1 — Clone & login
```bash
git clone <repo-url>
cd webtks-dashboard
clasp login
```

### Bước 2 — Điền Script ID
Mỗi Google Sheets dùng một Apps Script project riêng. Cấu hình KiotHN/Dashboard nằm
trong `.clasp.json`; cấu hình KiotSG (cửa hàng Sài Gòn, dùng chung code `src-dashboard/`
với KiotHN) nằm trong `.clasp.saigon.json`:
```json
{
  "scriptId": "YOUR_REAL_SCRIPT_ID_HERE",
  "rootDir": "src-dashboard"
}
```
> Script ID lấy từ: **Apps Script Editor -> Project Settings -> Script ID**

### Bước 3 — Push code lên GAS
```bash
# KiotHN / Dashboard
clasp push --force

# KiotSG (cửa hàng Sài Gòn — dùng chung code src-dashboard/ với KiotHN)
clasp -P .clasp.saigon.json -I .claspignore.saigon push --force
```

Trong **Apps Script Editor -> Project Settings -> Script Properties**, tạo các thuộc tính
(mỗi project — KiotHN, KiotSG — có bộ Script Properties độc lập, không
dùng chung, không đọc/ghi chéo project khác):

- `KIOTVIET_CLIENT_ID`: Client ID của KiotViet (riêng theo từng cửa hàng).
- `KIOTVIET_CLIENT_SECRET`: Client Secret của KiotViet (riêng theo từng cửa hàng).
- `KIOTVIET_RETAILER`: bắt buộc khai báo (không còn fallback ngầm) — `CHhanoi` cho
  project KiotHN, `CHsaigon` cho project KiotSG.
- `WEBHOOK_URL`: URL `/exec` của Web App sau khi deploy — của đúng project đó.

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
1. Kiểm tra đã khai báo `KIOTVIET_CLIENT_ID` và `KIOTVIET_CLIENT_SECRET` trong Script Properties. Chỉ trên dự án sheet tổng hợp cũ, chạy `syncAllInitialData()` để tải dữ liệu ban đầu.
2. Với sheet tổng hợp cũ, chạy `setupKiotVietAutoSync()` một lần. Chế độ mặc định `FULL_DASHBOARD` tạo queue 5 phút, polling chính 15 phút, ba lịch báo cáo 06:00/06:30/07:00, công nợ 15:00 và 9 webhook. Nếu một lượt polling nặng chưa xong, trigger tiếp sức chờ 5 phút để giảm tải; checkpoint bảo đảm không bỏ trang dữ liệu.
3. Không dùng spreadsheet/profile `COMBINED`; Dashboard, Vận chuyển và Nhân sự phải trỏ đến ba Google Sheets độc lập. Project KiotSG (cửa hàng Sài Gòn) là một Google Sheet + Apps Script project độc lập thứ tư, dùng chung code `src-dashboard/` với KiotHN nhưng cấu hình/deploy riêng theo `.clasp.saigon.json` — xem chi tiết ở `src-dashboard/HuongDanSuDung.gs` mục "6b. CAI DAT PROJECT KIOTSG".
4. `setupKiotVietAutoSync()` đã cài ba lịch báo cáo độc lập. Chỉ chạy `setupCustomerReport()` khi muốn làm mới ngay cả ba báo cáo: **Báo cáo bán hàng** gần **06:00**; **Hàng bán theo khách** được webhook cập nhật trong khoảng 5 phút và đối soát gần **06:30**; **Khách theo hàng hóa** gần **07:00**. Ba tab lần lượt giữ đủ 18, 5 và 25 cột.
5. Ba tab **HN1**, **HN3**, **HN7** là báo cáo công nợ khách hàng 1/3/7 ngày gần đây (tính cả hôm nay) do Apps Script tự tính từ dữ liệu KiotViet và ghi đè mỗi ngày gần 15:00, hoặc chạy tay `syncCustomerDebtReports()` bất cứ lúc nào cần cập nhật ngay.

Sau khi bật, thay đổi Hàng hóa, Tồn kho, Khách hàng, Hóa đơn, Đặt hàng và Nhóm hàng
được nhận bằng webhook rồi ghi vào Sheets trong khoảng 5 phút. **Trả hàng**, **Nhà cung
cấp** và **Nhập hàng** được quét dự phòng mỗi 15 phút vì KiotViet không phát webhook
cho ba nhóm này.

### Bước 5 — Deploy Web App
1. **Deploy -> New deployment -> Web App**
2. Execute as: **Me**, Access: **Anyone**
3. Copy URL `/exec` -> lưu vào Script Property `WEBHOOK_URL`

---

## Cấu hình đa cơ sở (Hà Nội / Sài Gòn)

Toàn bộ tính năng của web giống hệt nhau ở hai cơ sở; chỉ **nguồn dữ liệu** là khác.
Mỗi request dữ liệu đều đi qua `server/branch/branchMiddleware.js` để xác định
`req.branch`, rồi đọc/ghi đúng spreadsheet của cơ sở đó.

### Biến môi trường

| Biến | Cơ sở | Bắt buộc | Dùng cho |
|---|---|---|---|
| `SPREADSHEET_ID` | Hà Nội | Có | Báo cáo tổng hợp |
| `SPREADSHEET_ID_SG` | Sài Gòn | Không | Báo cáo tổng hợp |
| `VC_SPREADSHEET_ID` / `VC_SPREADSHEET_ID_SG` | HN / SG | Không | Quản lý vận chuyển |
| `VC_DRIVE_FOLDER_ID` / `VC_DRIVE_FOLDER_ID_SG` | HN / SG | Không | Ảnh chứng từ vận chuyển |
| `HR_SPREADSHEET_ID` / `HR_SPREADSHEET_ID_SG` | HN / SG | Không | Quản lý nhân sự |
| `KIOTVIET_RETAILER` / `KIOTVIET_RETAILER_SG` | HN / SG | Không | Kiểm tra đứt hàng |

Tên tab bên trong hai spreadsheet **giống hệt nhau** — chỉ khác spreadsheet ID.
Thiếu biến của cơ sở nào thì tab tương ứng ở cơ sở đó trả `503 BRANCH_NOT_CONFIGURED`
và giao diện hiện "Cơ sở này chưa được cấu hình nguồn dữ liệu" — server vẫn chạy bình thường.

### Phân quyền theo cơ sở

Trường **"Cơ sở phụ trách"** (`coSo`) của tài khoản nhận đúng 3 giá trị: `Hà Nội`,
`Sài Gòn`, `Cả hai` (hoặc để trống).

- Tài khoản 1 cơ sở: chỉ xem được dữ liệu cơ sở đó, không có nút chuyển cơ sở.
- Tài khoản `Cả hai`: có ô chọn cơ sở ở đầu thanh điều hướng; đổi cơ sở → tải lại trang.
- Tài khoản **chưa gán cơ sở**: mọi API dữ liệu trả `403 BRANCH_UNASSIGNED`; Quản lý
  phải gán cơ sở trong *Quản lý tài khoản → Quản lý người dùng*. Tài khoản vẫn vào
  được `/account/` để xem hồ sơ.

Cookie `tks_branch` chỉ là **gợi ý** về cơ sở đang xem: server luôn đối chiếu lại với
`coSo` trong JWT ở mỗi request, nên sửa cookie bằng tay không xem được dữ liệu cơ sở
khác — chỉ bị rơi về cơ sở hợp lệ. Ranh giới bảo mật nằm ở middleware, không phải ở
thanh điều hướng phía client.

Tab **"Quản lý tài khoản" dùng chung** cho cả hai cơ sở (`/api/auth/*`,
`/api/admin/users/*`, `/api/role-requests/*`, `/api/notifications/*` không gắn
middleware cơ sở).

### Chuyển đổi dữ liệu tài khoản cũ

Dữ liệu cũ dùng **tên kho** làm giá trị cơ sở. Chạy một lần sau khi deploy:

```bash
cd server && npm run migrate:user-branches
```

Script đổi `An Khánh → Hà Nội`, `Tân Phú → Sài Gòn`, idempotent (chạy lại không đổi gì)
và in ra danh sách tài khoản có giá trị không hợp lệ cần Quản lý gán lại.

> **Lưu ý:** tên **kho** `An Khánh` / `Tân Phú` trong `orderStateMachine.js` là khái
> niệm khác (kho xuất hàng của luồng giao hàng) và **giữ nguyên**, không đổi tên.

### Giới hạn hiện tại

- Bot Telegram xin nghỉ phép (`hrTelegramBot.js`) hiện chỉ phục vụ cơ sở Hà Nội — sẽ
  mở rộng khi có `HR_SPREADSHEET_ID_SG`.
- Nguồn Vận chuyển / Nhân sự của Sài Gòn chưa được cấp; chỉ cần điền biến môi trường
  tương ứng là hai tab đó hoạt động ngay, không phải sửa code.

---

## Cách sử dụng

| Hàm | Mục đích | Khi nào chạy |
|---|---|---|
| `syncAllInitialData()` | Làm mới 9 sheet vận hành, 3 báo cáo khách hàng và HN1/HN3/HN7; báo cáo công nợ chạy sau khi Hàng hóa đã cập nhật | Lần đầu hoặc khi cần full refresh |
| `restartInvoicesBackfill()` | Reset riêng checkpoint Hóa đơn, tải Hóa đơn và Chi tiết hóa đơn vào staging rồi công bố đồng bộ; không ảnh hưởng checkpoint bảng khác | Khi Hóa đơn hoặc Chi tiết hóa đơn bị thiếu dữ liệu |
| `removeJsonColumnsFromAllSheets()` | Xóa ngay các cột `(JSON)` cũ trên 9 sheet vận hành | Tùy chọn; trigger nền cũng tự chạy một lần sau khi deploy |
| `setupKiotVietAutoSync()` | Bật hoặc khôi phục 9 webhook và toàn bộ 6 trigger định kỳ của Dashboard, không tạo trùng | 1 lần sau khi deploy |
| `initializeShipmentLifecycleSheets()` | Tạo/kiểm tra đủ 6 tab và header vận chuyển | Khi chuẩn bị sheet mới |
| `syncShipmentLifecycleRecent7Days()` | Nạp hóa đơn 7 ngày gần nhất theo từng trang, tránh chạy full quá quota | Một lần ban đầu hoặc khi đối soát |
| `setupShipmentLifecycleSync()` | Chọn chế độ vòng đời vận chuyển và tạo trigger queue; nhận `invoice.update` chuyển tiếp từ project cũ | Một lần trên dự án sheet mới |
| `setupCombinedKiotVietSync()` | Chọn chế độ dùng chung; bật 9 webhook, polling/báo cáo và cập nhật cả dashboard lẫn vận chuyển | Một lần trên spreadsheet chứa cả hai nhóm tab |
| `syncPollingOnly_()` | Làm mới Trả hàng, Nhà cung cấp, Nhập hàng; lượt tiếp sức nặng chờ 5 phút và tiếp tục từ checkpoint | Tự chạy bởi trigger 15 phút |
| `setupPollingTrigger()` | Bật lịch làm mới 3 sheet không có webhook | 1 lần duy nhất |
| `removePollingTrigger()` | Tắt lịch làm mới 15 phút | Khi bảo trì |
| `syncCustomerReport()` | Làm mới cả ba báo cáo khách hàng trong một lượt lấy API | Khi cần cập nhật/đối soát thủ công |
| `syncSalesCustomerReport()` | Làm mới riêng Báo cáo bán hàng 18 cột | Khi cần cập nhật thủ công một sheet |
| `syncCustomerProductReport()` | Làm mới riêng Hàng bán theo khách 5 cột | Khi cần cập nhật thủ công một sheet |
| `syncCustomerByProductReport()` | Làm mới riêng Khách theo hàng hóa 25 cột, toàn bộ lịch sử | Khi cần cập nhật thủ công một sheet |
| `setupCustomerReport()` | Làm mới ngay cả ba báo cáo và bật ba lịch độc lập gần 06:00, 06:30, 07:00 | Một lần sau khi deploy |
| `setupCustomerReportDailyTrigger()` | Cài ba trigger: Báo cáo bán hàng 06:00, Hàng bán theo khách 06:30, Khách theo hàng hóa 07:00 | Khi cần khôi phục lịch |
| `syncCustomerDebtReports()` | Tính lại công nợ khách hàng 1/3/7 ngày gần đây và ghi đè cả 3 tab HN1/HN3/HN7 | Khi cần cập nhật/đối soát ngay lập tức |
| `setupCustomerDebtReports()` | Tạo báo cáo HN1/HN3/HN7 ngay và bật thêm lịch riêng gần 15:00 | Tùy chọn |
| `setupCustomerDebtReportDailyTrigger()` | Tạo lại lịch cập nhật HN1/HN3/HN7 hàng ngày gần 15:00 | Khi cần khôi phục lịch |
| `removeCustomerDebtReportDailyTrigger()` | Gỡ lịch cập nhật HN1/HN3/HN7 hàng ngày | Khi cần tạm dừng tự động cập nhật |
| `setupQueueProcessingTrigger()` | Tạo trigger 5 phút | 1 lần duy nhất |
| `getWebhookQueueStatus()` | Đếm sự kiện còn chờ trong hàng đợi bền vững | Khi kiểm tra vận hành |
| `retryWebhookQueueErrors()` | Đưa sự kiện lỗi về hàng chờ sau khi đã sửa nguyên nhân | Khi queue có dòng `ERROR` |
| `checkWebhookStatus()` | Kiểm tra webhook đang active | Khi debug |
| `listRegisteredWebhooks()` | Liệt kê webhook đã đăng ký | Khi debug |
| `deleteAllOldWebhooks()` | Xóa toàn bộ webhook cũ | Khi cần đăng ký lại |
| `registerWebhookWithCorrectUrl()` | Đăng ký webhook mới với URL /exec | Sau khi deploy mới |

---

## Hiệu năng frontend (Frontend Performance)

Dashboard từng có một lớp hiệu ứng 3D (Three.js particle background, card tilt, 3D loading cube).
**Lớp này đã được gỡ bỏ hoàn toàn** vì làm dashboard giật nặng trên máy cấu hình phổ thông —
không phải tắt bằng cờ cấu hình, mà xóa hẳn khỏi mã nguồn.

### Đã gỡ bỏ

| Thành phần | Ghi chú |
|---|---|
| `vendor/three.min.js` | ~650KB tải trên 7 trang, chỉ để vẽ nền trang trí |
| `shared/three-bg.js` | Particle field WebGL chạy vòng lặp `requestAnimationFrame` liên tục |
| `shared/three-interactions.js` | Gắn listener hover lên **từng dòng bảng**, từng card, từng nút |
| `shared/three-loading.js` | CSS-3D cube loader — thay bằng spinner tĩnh trong `shared.css` |
| `shared/three-{performance,memory,visibility}.js` | Hạ tầng giám sát FPS/WebGL, không còn đối tượng để giám sát |
| `performance-test.html` | Trang đo FPS của lớp 3D |

### Quy tắc cần giữ

Ba thứ dưới đây là nguyên nhân giật chính. Đừng đưa lại:

1. **Không dùng `transform-style: preserve-3d`, `perspective`, `translateZ`, `rotateX/Y` trong CSS.**
   Mỗi khai báo này đẩy phần tử thành một compositor layer riêng. Rule cũ `tbody tr { transform-style: preserve-3d }`
   áp lên **mọi dòng bảng** (100 dòng/trang) là thủ phạm nặng nhất.
2. **Không dùng `background-attachment: fixed`.** Nền trang được vẽ một lần vào lớp `body::before`
   (`position: fixed; z-index: -1`). Dùng `fixed` khiến trình duyệt vẽ lại toàn bộ viewport — gồm cả
   việc scale lại ảnh nền cover — trên **mỗi frame cuộn**.
3. **Không dùng `backdrop-filter` trên `.loading-veil`.** Veil hiện lên ở mỗi lần auto-refresh;
   blur toàn màn hình ở đó là chi phí lặp lại.

Hover/focus vẫn có phản hồi thị giác — chỉ dùng `box-shadow` + `border-color` + `background-color` (2D, rẻ).

Các quy tắc trên được khóa lại bằng test: [`server/test/frontend/no-3d-effects.test.js`](server/test/frontend/no-3d-effects.test.js).
Test sẽ fail nếu bất kỳ file/CSS/class nào của lớp 3D quay lại, hoặc nếu các sửa lỗi cuộn ở trên bị hoàn tác.

### Tối ưu khác đang áp dụng

- Font: chỉ tải 3 họ thực dùng (Be Vietnam Pro, Inter, IBM Plex Mono) qua `<link>` + `preconnect`
  trên từng trang — **không** dùng `@import` trong `shared.css` (nó nối tiếp 2 round-trip chặn render).
- `chart.umd.min.js` và `shared-nav.js` đặt cuối `<body>`, không đặt trong `<head>`.
  Không đặt `defer` được vì script inline phía dưới dùng `Chart`/`TKSNav` ở top level.
- Sắp xếp bảng gom vào `DocumentFragment` rồi gắn một lần, và chỉ sắp xếp lại đúng bảng vừa render.
- Format số dùng instance `Intl.NumberFormat` tái sử dụng (`fmtNumber`/`fmtMoney`) thay cho
  `toLocaleString('vi-VN')` gọi lặp hàng nghìn lần mỗi lần render bảng.

---

## Cache tĩnh (Static Asset Caching)

Dashboard áp dụng chiến lược Cache-Control rõ ràng cho từng loại file tĩnh:

| Loại file | Cache-Control | Mục đích |
|---|---|---|
| Thư viện vendor (`/vendor/`) | `public, max-age=86400` (1 ngày) | Chart.js thay đổi hiếm khi |
| JS/CSS dùng chung (`/shared/*.js|css`, `/js/*.js`) | `public, max-age=3600` (1 giờ) | Có thể sửa đổi thường xuyên hơn |
| Ảnh (`*.png`, `*.jpg`, `*.svg`, `*.webp`, `*.ico`) | `public, max-age=604800` (7 ngày) | Thay đổi rất hiếm khi |
| HTML (entry points như `index.html`) | Không set custom; dùng ETag revalidation | Luôn kiểm tra phiên bản mới sau deploy |

**Rủi ro:** Sau khi deploy một bugfix khẩn cấp trên JS/CSS core, người dùng có thể vẫn thấy bản code cũ trong tối đa **1 giờ** do trình duyệt cache local.

**Hướng dẫn cho người dùng:** Nếu cần xem bản mới ngay lập tức sau một deploy khẩn cấp, hướng dẫn họ nhấn **Ctrl+F5** (Windows/Linux) hoặc **Cmd+Shift+R** (Mac) để thực hiện hard refresh (bypass cache).

---

## Lộ trình mở rộng

| Giai đoạn | Module | Mô tả |
|---|---|---|
| **1** [Hoan thanh] | `src-dashboard/` | Apps Script đồng bộ KiotViet cho Google Sheets Dashboard |
| **2** [Chua bat dau] | `future-phases/sales-pos/` | POS bán hàng tích hợp |
| **3** [Chua bat dau] | `future-phases/inventory/` | Quản lý kho nâng cao, cảnh báo |
| **4** [Chua bat dau] | `future-phases/analytics-anomaly/` | Phát hiện bất thường, fraud detection |
| **5** [Chua bat dau] | `future-phases/directory/` | Danh bạ nhân viên / đối tác |
| **6** [Chua bat dau] | `future-phases/ai-assistant/` | Chatbot tư vấn & dự báo bằng AI |

---

## Tài liệu kỹ thuật

| Tài liệu | Mô tả |
|---|---|
| [BRD](docs/01-brd/BRD_Dashboard_GoogleSheets.md) | Business Requirements Document v1.9 |
| [SRS](docs/02-srs/SRS_Dashboard_GoogleSheets.md) | Software Requirements Specification v2.2 |
| [BPMN](docs/03-process/BPMN_Dashboard_GoogleSheets.md) | Sơ đồ quy trình nghiệp vụ v2.0 |
| [Implementation Plan](docs/04-planning/implementation_plan.md) | Kế hoạch triển khai chi tiết & trạng thái v2.3 |
| [Chính sách nghỉ phép](CHINH-SACH-NGHI-PHEP.md) | Quy định & chính sách quản lý nghỉ phép nhân sự (CSNS-NP-01) |
| [Plan Process Automation](Plan%20Process%20Automation.md) | Kế hoạch kiểm soát & tự động hóa quy trình vận chuyển hàng hóa |
| [Manual Test Batch Update](docs/manual-test-batch-update-order-items.md) | Hướng dẫn kiểm thử production cập nhật hàng loạt đơn vận chuyển |
| [Lag Optimization Plan](docs/superpowers/plans/2026-08-19-tks-lag-optimization.md) | Kế hoạch tối ưu hóa toàn diện hiệu năng và chống lag 4 Phase |
| [Stagger Report Schedules](docs/superpowers/plans/2026-08-20-stagger-customer-report-triggers.md) | Kế hoạch phân bổ lịch đồng bộ báo cáo Apps Script |
| [No-3D Regression Tests](server/test/frontend/no-3d-effects.test.js) | Test khóa việc gỡ bỏ lớp 3D và các sửa lỗi hiệu năng cuộn — xem mục "Hiệu năng frontend" |
| [Server Guide](server/README.md) | Hướng dẫn triển khai, kiểm thử và tài liệu API backend Node.js |
| [Design System Master](design-system/tks-dashboard/MASTER.md) | Hệ thống token, component và quy tắc giao diện |
| [Debt Dashboard Spec](docs/superpowers/specs/2026-08-05-debt-dashboard-design.md) | Đặc tả thiết kế module Báo cáo công nợ HN1/HN3/HN7 |
| [HR Leave Sessions Spec](docs/superpowers/specs/2026-08-22-hr-leave-sessions-and-submission-time-design.md) | Đặc tả nghỉ phép theo buổi, thời gian gửi và trạng thái vi phạm |
| [HR Leave Sessions Plan](docs/superpowers/plans/2026-08-22-hr-leave-sessions-submission-filter.md) | Kế hoạch triển khai đồng bộ Bot, Google Sheet, API và giao diện HR |
| [Result Cache Plan](docs/superpowers/plans/2026-08-13-dashboard-result-cache.md) | Kế hoạch & chi tiết triển khai Result Cache tầng backend |
| [Pagination Plan](docs/superpowers/plans/2026-08-13-dashboard-table-pagination.md) | Kế hoạch & chi tiết triển khai phân trang bảng client-side |
| [Dashboard Apps Script Guide](src-dashboard/HuongDanSuDung.gs) | Hướng dẫn đồng bộ Google Sheets Dashboard |

---

## Ghi chú kỹ thuật

> **Project GAS Dashboard** load `HuongDanSuDung.gs -> config/ -> kiotviet/ -> sync/ -> utils/`,
> dùng chung cho KiotHN và KiotSG (khác `rootDir`/manifest/ignore profile theo từng project).
> `Config.gs` luôn được khởi tạo trước các module nghiệp vụ.

> Apps Script không có `doGet()` hoặc file HTML. Deployment Web App chỉ tồn tại
> để KiotViet gọi `doPost()` qua URL `/exec`.

> **Schema dữ liệu:** 9 sheet vận hành giữ nguyên các cột dashboard ở bên trái và
> chỉ bổ sung các trường KiotViet dạng phẳng đang được sử dụng. Apps Script không
> ghi object/mảng hoặc payload gốc vào cột JSON; trigger nền tự xóa các cột JSON
> của schema cũ một lần sau khi phiên bản mới được deploy. HN1/HN3/HN7 dùng schema
> báo cáo riêng (một dòng cho mỗi giao dịch hoặc mặt hàng trong giao dịch)
> do `CustomerDebtReport.gs` tự quản lý, tách biệt với 9 sheet vận hành.

---

*Cập nhật lần cuối: 29/08/2026*
