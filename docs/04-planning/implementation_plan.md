# KẾ HOẠCH TRIỂN KHAI — TRẠNG THÁI & LỘ TRÌNH

*(Deployment Status & Roadmap)*

**HỆ THỐNG DASHBOARD NỘI BỘ — TOKOSI**

| **Thông tin**    | **Nội dung**                                                         |
|------------------|----------------------------------------------------------------------|
| Phiên bản tài liệu | 2.0                                                              |
| Ngày tạo         | 27/07/2026                                                           |
| Ngày cập nhật    | 18/08/2026                                                           |
| Tài liệu liên quan | BRD v1.7 · SRS v1.9 · BPMN v1.8 · Debt Spec 2026-08-05 · Cache/Pagination Plans · Plan Process Automation · 3D Design · Performance Optimization Report · ROLLBACK |
| Trạng thái       | Giai đoạn 1, Phase 0/0.5/1 & Lớp hiệu ứng 3D hoàn thành — đang vận hành |

---

# 1. Kiến trúc thực tế đã triển khai

```
src/                        ← GAS source code (clasp push)
├── HuongDanSuDung.gs       ← Hướng dẫn hàm và luồng liên kết trên Apps Script
├── config/Config.gs
├── kiotviet/Auth.gs · CustomerDebtReport.gs · CustomerReport.gs · DiscontinuedProducts.gs · SheetSchemas.gs · SyncInitial.gs · WebhookAdmin.gs
├── shipment/KiotVietLifecycle.gs ← Vòng đời 6 tab vận chuyển và chuyển tiếp webhook
├── sync/UpdateHandlers.gs · WebhookQueue.gs
└── utils/Helpers.gs

server/                     ← Node.js/Express backend (Render.com)
├── index.js
├── config.js
├── routes.js
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
│   ├── dashboardData.js    ← Thống kê KPI, biểu đồ, tìm kiếm, Result Cache
│   ├── dashboardData.test.js ← Unit test cache/aggregation/search
│   ├── debtReport.js       ← Báo cáo công nợ khách hàng 1/3/7 ngày từ HN1/HN3/HN7
│   ├── exportService.js    ← Registry 16 bảng và tạo file Excel .xlsx
│   └── exportService.test.js ← Unit test xuất Excel
├── data/
│   └── users.json          ← Backup dữ liệu tài khoản người dùng cục bộ
├── jobs/syncCustomerReport.js ← Đối soát 3 báo cáo khách hàng theo lịch 07:00
├── scripts/
│   ├── setupUsersSheet.js  ← CLI quản lý tài khoản người dùng và sheet Users
│   └── setupVcSheet.js     ← CLI khởi tạo 6 tab vận chuyển VC_*
├── shipment/
│   ├── driveService.js     ← Tải ảnh chứng từ lên Google Drive theo ngày/mã đơn
│   ├── invoiceStatusService.js ← Tra cứu mã/trạng thái hóa đơn, cache 90s
│   ├── invoiceStatusService.test.js
│   ├── orderStateMachine.js ← State Machine 9 trạng thái vận đơn & kiểm tra chuyển tiếp
│   ├── orderStateMachine.test.js
│   ├── shipmentOrderRoutes.js ← REST API vận đơn, điều phối, ảnh chứng từ, sự cố, đối soát
│   ├── vcOrderRepository.js ← Thao tác CRUD 6 tab vận chuyển VC_*
│   └── vcOrderRepository.test.js
├── sheets/
│   ├── sheetsClient.js     ← Đọc dữ liệu Google Sheets cho dashboard
│   └── vcSheetsClient.js   ← Đọc/ghi dữ liệu bảng vận chuyển VC_*
└── public/
    ├── index.html          ← Frontend Live Dashboard (KPI, biểu đồ, tìm kiếm, xuất Excel)
    ├── Logo.jpg            # Logo thương hiệu frontend
    ├── performance-test.html # Trang công cụ kiểm tra & đo lường hiệu năng 3D trực quan
    ├── account/
    │   └── index.html      ← Quản lý tài khoản (Hồ sơ cá nhân & Quản trị người dùng)
    ├── js/
    │   ├── auth-guest-ui.test.js ← Kiểm tra UI đăng ký/Google/tra cứu Khách/Tài khoản
    │   ├── export-ui.test.js ← Unit test giao diện xuất Excel
    │   ├── pagination.js   ← Module phân trang bảng client-side
    │   ├── pagination.test.js ← Unit test cho phân trang
    │   ├── three-bg.test.js ← Kiểm tra hệ thống hạt 3D background và đổi theme
    │   ├── three-buttons.test.js ← Kiểm tra hiệu ứng 3D tactile press và ripple nút
    │   ├── three-charts.js ← Biểu đồ doanh thu 3D Three.js cho dashboard
    │   ├── three-css-transforms.test.js ← Kiểm tra hiệu ứng 3D CSS perspective cho thẻ/panel
    │   ├── three-infrastructure.test.js ← Kiểm tra nạp và khởi tạo thư viện THREE.js r159
    │   ├── three-interactions.test.js ← Kiểm tra dynamic hover tilt và button/nav 3D
    │   ├── three-loading.test.js ← Kiểm tra 3D rotating loading cube
    │   ├── three-navigation.test.js ← Kiểm tra hiệu ứng 3D trượt nổi thanh điều hướng sidebar
    │   └── three-tables.test.js ← Kiểm tra hiệu ứng 3D nổi dòng bảng và animation so le
    ├── login/index.html    ← Giao diện đăng nhập nội bộ, Google Sign-In, OTP Reset & Lockout
    ├── register/index.html ← Giao diện đăng ký tài khoản Khách (Email / Số điện thoại)
    ├── shared/             ← shared-nav.js, shared.css, image-compress.js dùng chung
    │   ├── three-bg.js     ← Hệ thống hạt 3D Particle Background toàn trang
    │   ├── three-interactions.js ← Bộ xử lý 3D dynamic tilt, 3D navigation, button ripple và table row animation
    │   ├── three-loading.js ← 3D rotating loading cube loader
    │   ├── three-memory.js ← Bộ quản lý WebGL context và giải phóng bộ nhớ
    │   ├── three-performance.js ← Bộ giám sát FPS và tự động điều chỉnh chất lượng 3D
    │   ├── three-performance.test.js ← Unit test cho bộ giám sát hiệu năng
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

# 2. Giai đoạn 1 — Dashboard Real-Time & Lớp hiệu ứng 3D (ĐÃ HOÀN THÀNH)

## 2.1. Danh sách task đã hoàn thành

| **#** | **Hạng mục**                          | **Nội dung**                                                                                       | **Trạng thái** |
|-------|---------------------------------------|----------------------------------------------------------------------------------------------------|----------------|
| 1     | Phân tích & thiết kế                  | Hoàn thiện BRD v1.7, SRS v1.9, BPMN v1.8; thiết kế kiến trúc kỹ thuật                            | [Hoan thanh]   |
| 2     | Apps Script đồng bộ KiotViet          | `src/`: sync đủ trường, webhook 9 event qua queue bền vững, polling 15 phút (Trả hàng/NCC/Nhập hàng) | [Hoan thanh]   |
| 3     | GAS Web App (src/)                    | Chỉ nhận `doPost()` từ KiotViet; đã bỏ preview HTML và logic đọc dashboard khỏi Apps Script | [Hoan thanh]   |
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
| 16    | Lớp hiệu ứng 3D Progressive Layer | Tích hợp Three.js r159 particle background, card 3D tilt, tactile buttons, 3D navigation, table staggered rows, 3D loading cube, adaptive performance monitor & memory disposal trên cả 7 trang | [Hoan thanh] |
| 17    | Bộ kiểm thử tự động | Bộ **214 unit tests** chuẩn `node:test` bao phủ auth/Guest/SĐT, Admin CRUD, OTP reset, tra cứu vận chuyển, State Machine 9 trạng thái, Repository VC, cache, pagination, excel export, và 10 test suites 3D | [Hoan thanh] |

## 2.2. Tính năng đã vận hành

- **KPI Dashboard:** Doanh thu hôm nay, hóa đơn, tồn kho, công nợ KH/NCC, đặt hàng, trả hàng, nhập hàng.
- **Biểu đồ doanh thu theo ngày:** bộ lọc 7 / 30 / 90 ngày, biểu đồ cơ cấu tồn kho, số lượng/doanh thu theo nhóm cha & nhóm con.
- **Bảng chi tiết & Phân trang:** Top 10 sản phẩm bán chạy, hàng đã hết (phân trang), tất cả mã hàng (phân trang), Top 8 công nợ, bản ghi gần nhất.
- **Báo cáo công nợ KH 1/3/7 ngày:** Tự động tính toán từ KiotViet qua `CustomerDebtReport.gs`, ghi vào 3 tab HN1/HN3/HN7 và hiển thị trực quan qua `debtReport.js`.
- **Theo dõi hàng Ngừng kinh doanh:** Duy trì lịch sử từ trước tới nay trong một tab duy nhất qua `DiscontinuedProducts.gs`.
- **Đồng bộ tự động:** Webhook KiotViet (9 event) qua tab queue ẩn + polling 15 phút (Trả hàng/NCC/Nhập hàng).
- **Backend Result Cache:** Phản hồi tức thì (<10ms) cho các lượt chuyển tab, thay đổi bộ lọc hoặc mở nhiều tab trình duyệt khi dữ liệu Sheets chưa đổi.
- **Tìm kiếm nâng cao:** Hỗ trợ tìm kiếm từ khóa thông thường, tìm chính xác tối đa 50 mã (`mode=codes`), và tìm Top 3 khách hàng theo danh sách mã sản phẩm từ `Khách theo hàng hóa`.
- **Xuất Excel (16 bảng):** Nút riêng cho từng bảng, tùy chọn trường từ Google Sheets, giữ bộ lọc hiện tại, hỗ trợ xuất tổng hợp + chi tiết và kết quả tìm kiếm đa nguồn.
- **Lớp hiệu ứng 3D Visual & Hiệu năng cao:** Hệ thống hạt 3D Particle Background tự động đổi màu theo theme, card 3D tilt xoay nhẹ theo vị trí chuột, 3D rotating cube loader, biểu đồ 3D Three.js, tự động giảm tải xuống 30fps/50 particles khi máy yếu (`three-performance.js`), quản lý thu hồi bộ nhớ WebGL (`three-memory.js`), và tạm dừng animation khi chuyển tab (`three-visibility.js`).
- **Giao diện mượt mà & Tiếp cận (A11y):** Tôn trọng tuyệt đối `prefers-reduced-motion: reduce`, đảm bảo độ tương phản WCAG AA, focus indicators `:focus-visible` độc lập.

---

# 3. Giai đoạn 2 — Định hướng tiếp theo

| **#** | **Hạng mục**                  | **Mô tả**                                                                             | **Ưu tiên** | **Trạng thái** |
|-------|-------------------------------|--------------------------------------------------------------------------------------|-------------|----------------|
| 1     | Phân quyền & Quản lý User     | Đăng nhập nội bộ (JWT httpOnly cookie + bcrypt), phân quyền 5 vai trò, Quản trị người dùng Admin (`/account`), Khôi phục OTP | Cao | [Hoan thanh] (Phase 0) |
| 2     | Xuất báo cáo PDF              | Excel theo từng bảng đã hoàn thành; còn lại PDF cho KPI summary và báo cáo in        | Cao         | Đang lên kế hoạch |
| 3     | Nâng cấp UI/UX & Hiệu ứng 3D  | Triển khai lớp hiệu ứng 3D toàn diện 7 trang giao diện theo `3D Design.md` & `docs/performance-optimization-report.md` | Cao | [Hoan thanh] |
| 4     | Theo dõi chu kỳ refresh       | Hiển thị countdown và cho phép cấu hình chu kỳ (logic auto-refresh 10 phút đã có)      | Trung bình  | Đang lên kế hoạch |
| 5     | Cache tầng backend            | In-memory result cache và raw sheets cache 90s đã triển khai (`dashboardData.js`)     | Thấp        | [Hoan thanh] |
| 6     | Cảnh báo tồn kho              | Notification khi tồn kho dưới ngưỡng cấu hình                                        | Thấp        | Đang lên kế hoạch |

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

> **Thứ tự load file GAS (src/):** clasp sắp xếp alphabetical theo thư mục:
> `HuongDanSuDung.gs` -> `config/` -> `kiotviet/` -> `shipment/` -> `sync/` -> `utils/`
> `Config.gs` luôn được khởi tạo trước tất cả module khác.

> **Schema Google Sheets:** Apps Script duy trì 9 tab vận hành, tab lịch sử `Hàng ngừng kinh doanh`, 3 tab báo cáo khách hàng, 3 tab báo cáo công nợ HN1/HN3/HN7, 6 tab vận chuyển `VC_*` và tab ẩn `_KV_WEBHOOK_QUEUE`. Queue không hết hạn, chỉ xóa sự kiện sau khi ghi thành công và tự retry lỗi. Ba tab `HN1`/`HN3`/`HN7` do `CustomerDebtReport.gs` tự động tính từ dữ liệu KiotViet và ghi đè mỗi ngày gần 15:00 (hoặc chạy tay), được backend `server/dashboard/debtReport.js` đọc để dựng báo cáo công nợ. `src/kiotviet/SheetSchemas.gs` ghi dữ liệu mới trước khi dọn dòng dư để tránh xóa trắng khi cập nhật lỗi.
> `sheetsClient.js` lọc tab hiện có trước `batchGet`, nên tab thiếu chỉ làm rỗng section tương ứng. Khi thay đổi các cột tương thích dashboard vẫn phải cập nhật đồng bộ `SheetSchemas.gs`, `server/config.js` và `server/dashboard/dashboardData.js`.

> **Múi giờ:** Backend cố định `Asia/Ho_Chi_Minh`/UTC+07:00 cho parse ngày, KPI "hôm nay", bucket 7/30/90 ngày và `updatedAt`; không phụ thuộc timezone mặc định của Render.

> **Biến môi trường Render:** `SPREADSHEET_ID`, `VC_SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `JWT_SECRET` — không commit vào repo.

> **Thông tin xác thực KiotViet:** Apps Script đọc `KIOTVIET_CLIENT_ID` và `KIOTVIET_CLIENT_SECRET` từ Script Properties; tác vụ Node.js đọc `KIOTVIET_CLIENT_ID`, `KIOTVIET_CLIENT_SECRET`, `KIOTVIET_RETAILER` từ biến môi trường. Không hard-code hoặc commit các giá trị này.

---

# 6. Giai đoạn 3 — "Quản lý vận chuyển" (kế hoạch chi tiết: `Plan Process Automation.md`)

Toàn bộ 6 tab dashboard hiện có (Tổng quan/Hàng hóa/Hóa đơn/Khách hàng/Nhà cung cấp/Công nợ) được gộp vào 1 mục menu cha **"Báo cáo tổng hợp"**; tính năng theo dõi/tự động hóa quy trình vận chuyển (4 luồng giao hàng, giao diện Web Portal 1-chạm thay thế khi chưa đủ bot Telegram, bot Telegram 9 nhóm chat tương lai, OCR, KPI vận chuyển) nằm ở mục **"Quản lý vận chuyển"** ngang hàng. Mục **"Quản lý tài khoản"** (`/account/`) phục vụ cập nhật hồ sơ, đổi mật khẩu và quản trị người dùng. Kiến trúc giữ nguyên Google Sheets + Node/Express + Render hiện có.

| Phase | Nội dung | Trạng thái |
|---|---|---|
| **0 — Nền tảng Auth & Tài khoản** | JWT httpOnly cookie + bcrypt; đăng nhập nội bộ, Google Identity và form đăng ký riêng (Email/SĐT); vai trò `Khách` hoạt động ngay chỉ được vào Quản lý vận chuyển; bốn vai trò nội bộ giữ quyền dashboard; tab `Users`, Local Store bảo mật, OTP reset mật khẩu, giao diện `/account/` và công cụ quản trị Admin | [Hoan thanh] |
| **0.5 — Tra cứu vận chuyển cho Khách** | `POST /api/shipment/invoice-status` khớp chính xác tối đa 50 mã từ sheet `Hóa đơn`, chỉ trả mã/trạng thái và cache 90 giây; trang `/shipment/` mặc định trống, menu/redirect theo vai trò | [Hoan thanh] |
| **1 — MVP Vận chuyển Web-First (Kế hoạch thay thế)** | Spreadsheet vận chuyển riêng (`VC_Orders`/`VC_OrderItems`/`VC_StatusHistory`/`VC_Attachments`/`VC_Exceptions`/`VC_Vehicles`), State Machine 4 luồng 9 trạng thái, Web Desktop Điều phối (Kế toán) & Mobile Web 1-chạm (Kho & Lái xe chụp ảnh lưu Drive), Báo cáo Đối soát cuối ngày tự động | [Hoan thanh] |
| **2 — Tự động hóa Bot Telegram & OCR (Khi chuẩn bị đủ bot)** | Bot Telegram nghe 9 nhóm gọi webhook vào API Phase 1, OCR bill ký nhận (Vision API), quy tắc tự động hoàn thành đơn hoặc chuyển hàng đợi soát thủ công | [Giai doan tiep theo] |
| **3 — Vận hành nâng cao & Mở rộng** | KPI dashboard vận chuyển chuyên sâu, quản lý xe/tài xế & phân bổ tuyến, module cước phí | [Tuong lai] |

> **Lưu ý kiến trúc:** tab `Users` đặt trong spreadsheet KiotViet hiện có kết hợp cùng bộ lưu trữ cục bộ bảo mật (`server/data/users.json`), giúp hệ thống luôn hoạt động ổn định và bảo vệ tài khoản người dùng an toàn.

---

*Cập nhật lần cuối: 18/08/2026*
