# KẾ HOẠCH TRIỂN KHAI — TRẠNG THÁI & LỘ TRÌNH

*(Deployment Status & Roadmap)*

**HỆ THỐNG DASHBOARD NỘI BỘ — TOKOSI**

| **Thông tin**    | **Nội dung**                                                         |
|------------------|----------------------------------------------------------------------|
| Phiên bản tài liệu | 2.2                                                              |
| Ngày tạo         | 27/07/2026                                                           |
| Ngày cập nhật    | 24/08/2026                                                           |
| Tài liệu liên quan | BRD v1.8 · SRS v2.1 · BPMN v1.9 · CSNS-NP-01 (Chính sách nghỉ phép) · Debt Spec 2026-08-05 · Cache/Pagination Plans · Lag Optimization Plan · Stagger Triggers Plan · Plan Process Automation · 3D Design · Performance Optimization Report · ROLLBACK |
| Trạng thái       | Giai đoạn 1 (Dashboard, Vận chuyển, Auth, 3D, Performance) & Phân hệ Quản lý Nghỉ phép HR + Telegram Bot hoàn thành — đang vận hành |

---

# 1. Kiến trúc thực tế đã triển khai

```
src-dashboard/              ← GAS project riêng cho Google Sheets Dashboard
├── HuongDanSuDung.gs · config/Config.gs · utils/Helpers.gs
├── kiotviet/Auth.gs · CustomerDebtReport.gs · CustomerReport.gs · DiscontinuedProducts.gs · SheetSchemas.gs · SyncInitial.gs · WebhookAdmin.gs
└── sync/UpdateHandlers.gs · WebhookQueue.gs

src-order-lifecycle/        ← GAS project riêng cho Google Sheets Vận chuyển
├── HuongDanSuDung.gs · config/Config.gs · utils/Helpers.gs
├── kiotviet/Auth.gs · SheetSchemas.gs · WebhookAdmin.gs
├── shipment/KiotVietLifecycle.gs
└── sync/UpdateHandlers.gs · WebhookQueue.gs

server/                     ← Node.js/Express backend (Render.com)
├── index.js                ← Express entry point (Gzip compression, static Cache-Control headers)
├── config.js
├── routes.js               ← Định tuyến API (/api/dashboard/*, /api/auth/*, /api/admin/*, /api/shipment/*, /api/hr/*)
├── auth/                   ← Xác thực JWT cookie, bcrypt, Google OAuth, OTP, Local User Store & phân quyền RBAC
│   ├── adminUserRoutes.js · adminUserRoutes.test.js ← API quản trị người dùng Admin (/api/admin/users)
│   ├── authMiddleware.js · authMiddleware.test.js   ← requireAuth, requireRole
│   ├── authRoutes.js · authRoutes.test.js           ← /api/auth/* (login, register, google, profile, otp reset)
│   ├── authService.js · authService.test.js         ← JWT httpOnly cookie & bcrypt
│   ├── googleAuthService.js · googleAuthService.test.js
│   ├── localUserStore.js                            ← Lưu trữ dữ liệu người dùng cục bộ bảo mật
│   ├── otpService.js · otpService.test.js           ← OTP 6 số, mask email/phone, chống brute-force
│   ├── userRepository.js · userRepository.test.js
│   └── userWriteRepository.js
├── dashboard/
│   ├── dashboardData.js    ← Thống kê KPI, biểu đồ, tìm kiếm, Result Cache (90s)
│   ├── dashboardData.test.js ← Unit test cache/aggregation/search
│   ├── debtReport.js       ← Báo cáo công nợ khách hàng 1/3/7 ngày từ HN1/HN3/HN7
│   ├── exportService.js    ← Registry 16 bảng và tạo file Excel .xlsx
│   └── exportService.test.js ← Unit test xuất Excel
├── data/
│   └── users.json          ← Backup dữ liệu tài khoản người dùng cục bộ
├── hr/                     ← Phân hệ Quản lý Nghỉ phép Nhân sự (HR Leave Management)
│   ├── hrLeaveExportService.js ← Xuất báo cáo ngày nghỉ phép Excel
│   ├── hrLeaveRepository.js   ← CRUD Google Sheets HR_Leaves
│   ├── hrLeaveRoutes.js       ← REST API /api/hr/leave/* (nộp đơn, tra cứu, duyệt/từ chối, xuất Excel)
│   └── hrLeaveService.js      ← Nghiệp vụ tính hạn mức, trừ ngày phép và quản lý trạng thái
├── jobs/syncCustomerReport.js ← Đối soát 3 báo cáo khách hàng theo lịch 07:00
├── scripts/
│   ├── setupHrSheet.js     ← CLI khởi tạo 3 tab HR_Leaves, HR_Employees, HR_Policy
│   ├── setupUsersSheet.js  ← CLI quản lý tài khoản người dùng và sheet Users
│   ├── setupVcSheet.js     ← CLI khởi tạo 6 tab vận chuyển VC_*
│   ├── styleBaselineSnapshot.js ← Snapshot baseline styles UI
│   └── tokenizeHardcodedStyles.js ← Chuẩn hóa token styles dùng chung
├── shipment/
│   ├── driveService.js     ← Tải ảnh chứng từ lên Google Drive theo ngày/mã đơn
│   ├── invoiceStatusService.js ← Tra cứu mã/trạng thái hóa đơn, cache 90s
│   ├── invoiceStatusService.test.js
│   ├── orderStateMachine.js ← State Machine 9 trạng thái vận đơn & kiểm tra chuyển tiếp
│   ├── orderStateMachine.test.js
│   ├── shipmentOrderRoutes.js ← REST API vận đơn, điều phối, ảnh chứng từ, sự cố, đối soát
│   ├── vcOrderRepository.js ← Thao tác CRUD 6 tab vận chuyển VC_* (batchUpdate updateOrderItems)
│   └── vcOrderRepository.test.js
├── sheets/
│   ├── hrSheetsClient.js   ← Đọc/ghi dữ liệu HR_Leaves, HR_Employees, HR_Policy
│   ├── sheetsClient.js     ← Đọc dữ liệu Google Sheets cho dashboard (cache 90s, timeout 15s)
│   └── vcSheetsClient.js   ← Đọc/ghi dữ liệu VC_* (cache theo sheet 12s, write invalidation, timeout 15s)
├── telegram/               ← Tích hợp Telegram Bot tương tác HR & thông báo
│   ├── conversationStore.js · conversationStore.test.js ← Quản lý hội thoại đa bước của bot
│   ├── hrTelegramBot.js · hrTelegramBot.test.js ← Bot nộp đơn xin nghỉ, tra cứu ngày phép, thông báo duyệt đơn
├── test/
│   ├── apps-script-sync.test.js ← Hồi quy URL webhook stale và typed-column Google Sheets
│   └── frontend/           ← Bộ unit test frontend logic & 3D
│       ├── auth-guest-ui.test.js · export-ui.test.js · pagination.test.js
│       ├── three-bg.test.js · three-buttons.test.js · three-css-transforms.test.js
│       ├── three-infrastructure.test.js · three-interactions.test.js · three-loading.test.js
│       ├── three-navigation.test.js · three-performance.test.js · three-tables.test.js
└── public/
    ├── 404.html            ← Trang lỗi 404 tùy biến
    ├── index.html          ← Frontend Live Dashboard (KPI, biểu đồ, 13 bảng phân trang 100 dòng, xuất Excel)
    ├── Logo.jpg            # Logo thương hiệu frontend
    ├── performance-test.html # Trang công cụ kiểm tra & đo lường hiệu năng 3D trực quan
    ├── account/
    │   └── index.html      ← Quản lý tài khoản (Hồ sơ cá nhân & Quản trị người dùng)
    ├── humanresources/
    │   └── index.html      ← Cổng thông tin nhân sự (Nộp đơn nghỉ phép, tra cứu số dư, duyệt đơn)
    ├── js/
    │   └── pagination.js   ← Module phân trang bảng client-side (renderPaginatedRows)
    ├── login/index.html    ← Giao diện đăng nhập nội bộ, Google Sign-In, OTP Reset (tải nhẹ, không 3D)
    ├── register/index.html ← Giao diện đăng ký tài khoản Khách (tải nhẹ, không 3D)
    ├── shared/             ← shared-nav.js, shared.css, image-compress.js dùng chung
    │   ├── three-bg.js     ← Hệ thống hạt 3D Particle Background toàn trang
    │   ├── three-interactions.js ← Bộ xử lý 3D dynamic tilt (rAF throttle), 3D navigation và tactile buttons
    │   ├── three-loading.js ← 3D rotating loading cube loader
    │   ├── three-memory.js ← Bộ quản lý WebGL context và giải phóng bộ nhớ
    │   ├── three-performance.js ← Bộ giám sát FPS và tự động điều chỉnh chất lượng 3D
    │   └── three-visibility.js ← Bộ điều phối tạm dừng/tiếp tục hiệu ứng khi đổi tab
    ├── shipment/
    │   ├── index.html      ← Giao diện tra cứu trạng thái vận chuyển (Khách)
    │   ├── dispatch/       ← Giao diện Web Desktop: Bảng điều phối vận đơn (Kế toán/Quản lý)
    │   └── mobile/         ← Giao diện Mobile Web 1-chạm (Thủ kho & Lái xe)
    └── vendor/
        ├── chart.umd.min.js
        └── three.min.js    ← Thư viện đồ họa 3D THREE.js r159 UMD
```

---

# 2. Giai đoạn 1 — Dashboard Real-Time & Tối ưu hóa hiệu năng (ĐÃ HOÀN THÀNH)

## 2.1. Danh sách task đã hoàn thành

| **#** | **Hạng mục**                          | **Nội dung**                                                                                       | **Trạng thái** |
|-------|---------------------------------------|----------------------------------------------------------------------------------------------------|----------------|
| 1     | Phân tích & thiết kế                  | Hoàn thiện BRD v1.8, SRS v2.1, BPMN v1.9; thiết kế kiến trúc kỹ thuật                            | [Hoan thanh]   |
| 2     | Apps Script đồng bộ KiotViet          | `src-dashboard/`: sync đủ trường, webhook 9 event qua queue bền vững, polling 15 phút (Trả hàng/NCC/Nhập hàng) | [Hoan thanh]   |
| 3     | GAS Web Apps tách theo Sheet          | `src-dashboard/` và `src-order-lifecycle/` chỉ nhận `doPost()`, mỗi project có rootDir/manifest riêng | [Hoan thanh]   |
| 4     | Backend Node.js/Express               | `server/`: liệt kê/lọc tab, `batchGet` tối đa 9 tab, xử lý tab thiếu và tính ngày giờ Việt Nam   | [Hoan thanh]   |
| 5     | Frontend HTML/CSS/JS                  | Sidebar, KPI, biểu đồ/bảng, lọc 7/30/90 ngày, refresh tay + nền 10 phút + tải bù khi tab visible | [Hoan thanh]   |
| 6     | Triển khai Render.com                 | Deploy lên `tokosi.onrender.com`; cấu hình `SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON`         | [Hoan thanh]   |
| 7     | CI/CD                                 | Auto-deploy khi push lên branch `main` của GitHub repo                                             | [Hoan thanh]   |
| 8     | Health check & Debug route            | `GET /health` -> Render ping; `/api/debug` -> kiểm tra kết nối và liệt kê `sheetTabs`             | [Hoan thanh]   |
| 9     | Báo cáo công nợ KH 1/3/7 ngày         | `CustomerDebtReport.gs` tự động tính và ghi đè HN1/HN3/HN7; backend `debtReport.js` đọc và hiển thị| [Hoan thanh]   |
| 10    | Lịch sử hàng Ngừng kinh doanh | `DiscontinuedProducts.gs` cập nhật toàn bộ lịch sử trong tab `Hàng ngừng kinh doanh` | [Hoan thanh]   |
| 11    | Khách theo hàng hóa | `CustomerReport.gs` tổng hợp toàn bộ lịch sử theo 25 cột sản phẩm -> khách -> hóa đơn, cập nhật gần 07:00 hoặc chạy tay | [Hoan thanh] |
| 12    | Xuất Excel theo từng bảng | 16 bảng và kết quả tìm kiếm xuất `.xlsx`, chọn đủ trường Google Sheets, hỗ trợ workbook nhiều worksheet | [Hoan thanh] |
| 13    | Result Cache tầng backend | Cache dữ liệu thô 90s + Result Cache theo `(rawDataVersion, filters)`, search index chỉ build lại khi refetch | [Hoan thanh] |
| 14    | Phân trang bảng client-side | `pagination.js` phân trang ~200 dòng/trang cho `allProducts` và `lowStock`, loại bỏ lag 3.5s khi mở tab Hàng hóa | [Hoan thanh] |
| 15    | Tối ưu Motion & UI Transitions | Áp dụng shared `--ease-out`, chống re-animate biểu đồ khi chuyển tab/poll, transition mượt mà cho search suggestions, surfaces, debt rows | [Hoan thanh] |
| 16    | Lớp hiệu ứng 3D Progressive Layer | Tích hợp Three.js r159 particle background, card 3D tilt, tactile buttons, 3D navigation, table staggered rows, 3D loading cube, adaptive performance monitor & memory disposal trên các trang chính | [Hoan thanh] |
| 17    | Bộ kiểm thử tự động | Bộ **324 unit tests** chuẩn `node:test` bao phủ HR leave, Telegram bot, conversation store, Apps Script sync, auth/Guest/SĐT, Admin CRUD, OTP reset, tra cứu vận chuyển, State Machine 9 trạng thái, Repository VC, cache, pagination, excel export, và frontend | [Hoan thanh] |
| 18    | Tối ưu hóa hiệu năng & Giảm lag (4 Phase) | (1) Gzip compression, Cache-Control static assets, script defer, fonts preconnect, gỡ 3D login/register; (2) rAF throttle `onCardHover`, scoped `TKS3D.refresh()`; (3) Phân trang 100 dòng/trang cho toàn bộ 13 bảng dữ liệu + lazy debt detail; (4) Backend cache 12s theo sheet `vcSheetsClient.js` kèm write invalidation, `vcBatchUpdate` cho `updateOrderItems`, 15s timeout cho Google Sheets API | [Hoan thanh] |
| 19    | Phân hệ Quản lý Nghỉ phép HR & Telegram Bot | Nghỉ theo Sáng/Chiều, quy đổi số buổi/2, lọc theo thời gian gửi và ghi trạng thái `Vi phạm` khi gửi sau 07:45/12:30; đồng bộ Google Sheet, REST API, `/humanresources/`, Excel và Telegram Bot | [Hoan thanh] |

## 2.2. Tính năng đã vận hành

- **KPI Dashboard:** Doanh thu hôm nay, hóa đơn, tồn kho, công nợ KH/NCC, đặt hàng, trả hàng, nhập hàng.
- **Biểu đồ doanh thu theo ngày:** bộ lọc 7 / 30 / 90 ngày, biểu đồ cơ cấu tồn kho, số lượng/doanh thu theo nhóm cha & nhóm con.
- **Bảng chi tiết & Phân trang toàn diện (100 dòng/trang):** Áp dụng phân trang client-side (`renderPaginatedRows`) cho toàn bộ 13 bảng dữ liệu.
- **Lazy-Render chi tiết công nợ:** Chỉ dựng DOM chi tiết giao dịch khi khách hàng bấm mở rộng dòng.
- **Báo cáo công nợ KH 1/3/7 ngày:** Tự động tính toán từ KiotViet qua `CustomerDebtReport.gs`, ghi vào 3 tab HN1/HN3/HN7 và hiển thị trực quan qua `debtReport.js`.
- **Theo dõi hàng Ngừng kinh doanh:** Duy trì lịch sử từ trước tới nay trong một tab duy nhất qua `DiscontinuedProducts.gs`.
- **Đồng bộ tự động:** Webhook KiotViet (9 event) qua tab queue ẩn + polling 15 phút (Trả hàng/NCC/Nhập hàng).
- **Backend Result Cache:** Phản hồi tức thì (<10ms) cho các lượt chuyển tab, thay đổi bộ lọc hoặc mở nhiều tab trình duyệt khi dữ liệu Sheets chưa đổi.
- **Bảo vệ Quota Google Sheets API cho Vận đơn:** Bộ nhớ đệm ngắn hạn 12s theo sheet trong `vcSheetsClient.js` chống nghẽn khi nhiều tài xế/điều phối viên poll đồng thời, kết hợp cơ chế xóa cache chủ động khi ghi dữ liệu và batch write qua `vcBatchUpdate`.
- **Giao tiếp mạng tối ưu (Network Delivery):** Gzip compression toàn diện, Cache-Control static headers, non-blocking script defer và Google Fonts preconnect.
- **Tìm kiếm nâng cao:** Hỗ trợ tìm kiếm từ khóa thông thường, tìm chính xác tối đa 50 mã (`mode=codes`), và tìm Top 3 khách hàng theo danh sách mã sản phẩm từ `Khách theo hàng hóa`.
- **Xuất Excel (16 bảng & HR Leave):** Nút riêng cho từng bảng, tùy chọn trường từ Google Sheets, hỗ trợ xuất báo cáo nghỉ phép nhân sự đa kỳ.
- **Lớp hiệu ứng 3D Visual & Hiệu năng cao:** Hệ thống hạt 3D Particle Background tự động đổi màu theo theme, card 3D tilt xoay nhẹ theo vị trí chuột với rAF gating & cached rect, 3D rotating cube loader, tự động giảm tải xuống 30fps/50 particles khi máy yếu (`three-performance.js`), quản lý thu hồi bộ nhớ WebGL (`three-memory.js`), và tạm dừng animation khi chuyển tab (`three-visibility.js`).
- **Phân hệ Quản lý Nghỉ phép HR & Telegram Bot:** Nhân viên nộp đơn xin nghỉ và tra cứu số dư ngày phép trên Cổng thông tin `/humanresources/` hoặc qua Telegram Bot 24/7; Quản lý/HR duyệt đơn trực tiếp trên Web và gửi thông báo tự động qua Telegram; xuất báo cáo đối soát công phép Excel.

---

# 3. Giai đoạn 2 — Định hướng tiếp theo

| **#** | **Hạng mục**                  | **Mô tả**                                                                             | **Ưu tiên** | **Trạng thái** |
|-------|-------------------------------|--------------------------------------------------------------------------------------|-------------|----------------|
| 1     | Phân quyền & Quản lý User     | Đăng nhập nội bộ (JWT httpOnly cookie + bcrypt), phân quyền 5 vai trò, Quản trị người dùng Admin (`/account`), Khôi phục OTP | Cao | [Hoan thanh] (Phase 0) |
| 2     | Xuất báo cáo PDF              | Excel theo từng bảng đã hoàn thành; còn lại PDF cho KPI summary và báo cáo in        | Cao         | Đang lên kế hoạch |
| 3     | Nâng cấp UI/UX & Hiệu ứng 3D  | Triển khai lớp hiệu ứng 3D toàn diện các trang giao diện theo `3D Design.md` & `docs/performance-optimization-report.md` | Cao | [Hoan thanh] |
| 4     | Phân hệ Nghỉ phép HR & Bot    | Quản lý ngày phép, số dư phép, nộp đơn qua Web & Bot Telegram, duyệt đơn và xuất báo cáo | Cao | [Hoan thanh] |
| 5     | Theo dõi chu kỳ refresh       | Hiển thị countdown và cho phép cấu hình chu kỳ (logic auto-refresh 10 phút đã có)      | Trung bình  | Đang lên kế hoạch |
| 6     | Cache tầng backend            | In-memory result cache và raw sheets cache 90s đã triển khai (`dashboardData.js`)     | Thấp        | [Hoan thanh] |
| 7     | Cảnh báo tồn kho              | Notification khi tồn kho dưới ngưỡng cấu hình                                        | Thấp        | Đang lên kế hoạch |

---

# 4. Lộ trình dài hạn (sau Giai đoạn 2)

| **Giai đoạn** | **Module**                        | **Mô tả ngắn**                                              |
|---------------|-----------------------------------|-------------------------------------------------------------|
| 3             | `future-phases/sales-pos/`        | POS bán hàng tích hợp                                       |
| 4             | `future-phases/inventory/`        | Quản lý kho nâng cao, kiểm kê đa chi nhánh                  |
| 5             | `future-phases/analytics-anomaly/`| Phát hiện bất thường, dự đoán nhu cầu nhập hàng             |
| 6             | `future-phases/directory/`        | Danh bạ nhân viên & sơ đồ tổ chức                           |
| 7             | `future-phases/ai-assistant/`     | Chatbot hỏi-đáp số liệu bằng ngôn ngữ tự nhiên              |
| 8             | —                                 | Thay thế hoàn toàn KiotViet                                 |

---

# 5. Ghi chú kỹ thuật quan trọng

> **Thứ tự load file GAS:** Dashboard dùng `HuongDanSuDung.gs -> config/ -> kiotviet/ -> sync/ -> utils/`; Vận chuyển thêm `shipment/` trước `sync/`. `Config.gs` luôn được khởi tạo trước các module nghiệp vụ.

> **Schema Google Sheets:** `src-dashboard/` duy trì 9 tab vận hành, lịch sử và báo cáo; `src-order-lifecycle/` duy trì 6 tab vận chuyển và queue riêng. Ba nguồn Dashboard, Vận chuyển và Nhân sự dùng ba spreadsheet độc lập; HR được backend quản lý qua `HR_SPREADSHEET_ID`.

> **Múi giờ:** Backend cố định `Asia/Ho_Chi_Minh`/UTC+07:00 cho parse ngày, KPI "hôm nay", bucket 7/30/90 ngày và `updatedAt`; không phụ thuộc timezone mặc định của Render.

> **Biến môi trường Render:** `SPREADSHEET_ID`, `VC_SPREADSHEET_ID`, `HR_SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `JWT_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_HR_CHAT_ID` — không commit vào repo.

---

# 6. Giai đoạn 3 — "Quản lý vận chuyển" (kế hoạch chi tiết: `Plan Process Automation.md`)

Toàn bộ các tab dashboard hiện có được gộp vào 1 mục menu cha **"Báo cáo tổng hợp"**; tính năng theo dõi/tự động hóa quy trình vận chuyển nằm ở mục **"Quản lý vận chuyển"** ngang hàng; phân hệ nhân sự nằm ở mục **"Nhân sự"** (`/humanresources/`); mục **"Quản lý tài khoản"** (`/account/`) phục vụ cập nhật hồ sơ, đổi mật khẩu và quản trị người dùng. Kiến trúc giữ nguyên Google Sheets + Node/Express + Render hiện có.

| Phase | Nội dung | Trạng thái |
|---|---|---|
| **0 — Nền tảng Auth & Tài khoản** | JWT httpOnly cookie + bcrypt; đăng nhập nội bộ, Google Identity và form đăng ký riêng (Email/SĐT); vai trò `Khách` hoạt động ngay chỉ được vào Quản lý vận chuyển; bốn vai trò nội bộ giữ quyền dashboard; tab `Users`, Local Store bảo mật, OTP reset mật khẩu, giao diện `/account/` và công cụ quản trị Admin | [Hoan thanh] |
| **0.5 — Tra cứu vận chuyển cho Khách** | `POST /api/shipment/invoice-status` khớp chính xác tối đa 50 mã từ sheet `Hóa đơn`, chỉ trả mã/trạng thái và cache 90 giây; trang `/shipment/` mặc định trống, menu/redirect theo vai trò | [Hoan thanh] |
| **1 — MVP Vận chuyển Web-First (Kế hoạch thay thế)** | Spreadsheet vận chuyển riêng (`VC_Orders`/`VC_OrderItems`/`VC_StatusHistory`/`VC_Attachments`/`VC_Exceptions`/`VC_Vehicles`), State Machine 4 luồng 9 trạng thái, Web Desktop Điều phối (Kế toán) & Mobile Web 1-chạm (Kho & Lái xe chụp ảnh lưu Drive), Báo cáo Đối soát cuối ngày tự động | [Hoan thanh] |
| **2 — Tự động hóa Bot Telegram & OCR (Khi chuẩn bị đủ bot)** | Bot Telegram nghe 9 nhóm gọi webhook vào API Phase 1, OCR bill ký nhận (Vision API), quy tắc tự động hoàn thành đơn hoặc chuyển hàng đợi soát thủ công | [Giai doan tiep theo] |
| **3 — Vận hành nâng cao & Mở rộng** | KPI dashboard vận chuyển chuyên sâu, quản lý xe/tài xế & phân bổ tuyến, module cước phí | [Tuong lai] |

---

*Cập nhật lần cuối: 22/08/2026*
