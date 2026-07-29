# KẾ HOẠCH TRIỂN KHAI — TRẠNG THÁI & LỘ TRÌNH

*(Deployment Status & Roadmap)*

**HỆ THỐNG DASHBOARD NỘI BỘ — TOKOSI**

| **Thông tin**    | **Nội dung**                                                         |
|------------------|----------------------------------------------------------------------|
| Phiên bản tài liệu | 1.1                                                              |
| Ngày tạo         | 27/07/2026                                                           |
| Ngày cập nhật    | 29/07/2026                                                           |
| Tài liệu liên quan | BRD v1.1 · SRS v1.1 · BPMN v1.1                                 |
| Trạng thái       | Giai đoạn 1 hoàn thành — đang vận hành                               |

---

# 1. Kiến trúc thực tế đã triển khai

```
appsscript/
└── KiotVietExport.gs       ← Đồng bộ KiotViet → Google Sheets (webhook + polling 5 phút)

src/                        ← GAS source code (clasp push)
├── config/Config.gs
├── kiotviet/Auth.gs · SyncInitial.gs · WebhookAdmin.gs
├── sync/UpdateHandlers.gs · WebhookQueue.gs
├── dashboard/WebApp.gs · DashboardData.gs
├── ui/Dashboard.html
└── utils/Helpers.gs

server/                     ← Node.js/Express backend (Render.com)
├── index.js
├── config.js
├── routes.js
├── sheets/sheetsClient.js
└── dashboard/dashboardData.js

server/public/
└── index.html              ← Frontend HTML/CSS/JS (Chart.js)
```

---

# 2. Giai đoạn 1 — Dashboard Real-Time (ĐÃ HOÀN THÀNH)

## 2.1. Danh sách task đã hoàn thành

| **#** | **Hạng mục**                          | **Nội dung**                                                                                       | **Trạng thái** |
|-------|---------------------------------------|----------------------------------------------------------------------------------------------------|----------------|
| 1     | Phân tích & thiết kế                  | Hoàn thiện BRD v1.1, SRS v1.1, BPMN v1.1; thiết kế kiến trúc kỹ thuật                            | ✅ Hoàn thành  |
| 2     | Apps Script đồng bộ KiotViet          | `appsscript/KiotVietExport.gs`: sync full, webhook 9 event, polling 5 phút (Trả hàng/NCC/Nhập hàng) | ✅ Hoàn thành  |
| 3     | GAS Web App (src/)                    | Multi-file GAS: Auth, SyncInitial, WebhookAdmin, UpdateHandlers, WebhookQueue, DashboardData, WebApp | ✅ Hoàn thành  |
| 4     | Backend Node.js/Express               | `server/`: API `GET /api/dashboard?days=`, `batchGet` 8 sheet, tính KPI & dữ liệu biểu đồ        | ✅ Hoàn thành  |
| 5     | Frontend HTML/CSS/JS                  | `server/public/index.html`: Sidebar, KPI cards, biểu đồ doanh thu (Chart.js), bảng chi tiết, bộ lọc 7/30/90 ngày | ✅ Hoàn thành  |
| 6     | Triển khai Render.com                 | Deploy lên `tokosi.onrender.com`; cấu hình `SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON`         | ✅ Hoàn thành  |
| 7     | CI/CD                                 | Auto-deploy khi push lên branch `main` của GitHub repo                                             | ✅ Hoàn thành  |
| 8     | Health check & Debug route            | `GET /health` → Render ping; `GET /api/debug` → kiểm tra biến môi trường & kết nối Sheets         | ✅ Hoàn thành  |

## 2.2. Tính năng đã vận hành

- **KPI Dashboard:** Doanh thu hôm nay, hóa đơn, tồn kho, công nợ KH/NCC, đặt hàng, trả hàng, nhập hàng
- **Biểu đồ doanh thu theo ngày:** bộ lọc 7 / 30 / 90 ngày
- **Bảng chi tiết:** Top 10 sản phẩm bán chạy, hàng tồn thấp, Top 8 công nợ, 8 bản ghi gần nhất (HĐ, đặt hàng, trả hàng, nhập hàng)
- **Đồng bộ tự động:** Webhook KiotViet (9 event) + Polling 5 phút (Trả hàng/NCC/Nhập hàng)
- **Làm mới thủ công:** nút Refresh gọi lại API, hiển thị timestamp cập nhật

---

# 3. Giai đoạn 2 — Định hướng tiếp theo

| **#** | **Hạng mục**                  | **Mô tả**                                                                             | **Ưu tiên** |
|-------|-------------------------------|--------------------------------------------------------------------------------------|-------------|
| 1     | Phân quyền người dùng         | Đăng nhập nội bộ, phân quyền Admin/Nhân viên; middleware auth Express                | Cao         |
| 2     | Xuất báo cáo PDF/Excel        | Export KPI summary, bảng hóa đơn, tồn kho theo kỳ                                   | Cao         |
| 3     | Nâng cấp UI/UX                | Dark theme nâng cao, glassmorphism, micro-animations, counting animation KPI          | Trung bình  |
| 4     | Auto-refresh                  | Tự động gọi lại API mỗi N giây (countdown indicator)                                 | Trung bình  |
| 5     | Cache tầng backend            | Redis hoặc in-memory cache để giảm số lần gọi Google Sheets API khi traffic cao       | Thấp        |
| 6     | Cảnh báo tồn kho              | Notification khi tồn kho dưới ngưỡng cấu hình                                        | Thấp        |

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
> `config/` → `dashboard/` → `kiotviet/` → `sync/` → `ui/` → `utils/`  
> `Config.gs` luôn được khởi tạo trước tất cả module khác. ✅

> **Schema 8 sheet cố định:** Tên sheet và thứ tự cột do `KiotVietExport.gs` duy trì.
> Khi thay đổi schema phải cập nhật đồng bộ cả `appsscript/KiotVietExport.gs` và `server/dashboard/dashboardData.js`.

> **Biến môi trường Render:** `SPREADSHEET_ID` và `GOOGLE_SERVICE_ACCOUNT_JSON` — không commit vào repo.

---

*— Cập nhật lần cuối: 29/07/2026 —*
