# KẾ HOẠCH TRIỂN KHAI — TRẠNG THÁI & LỘ TRÌNH

*(Deployment Status & Roadmap)*

**HỆ THỐNG DASHBOARD NỘI BỘ — TOKOSI**

| **Thông tin**    | **Nội dung**                                                         |
|------------------|----------------------------------------------------------------------|
| Phiên bản tài liệu | 1.2                                                              |
| Ngày tạo         | 27/07/2026                                                           |
| Ngày cập nhật    | 29/07/2026                                                           |
| Tài liệu liên quan | BRD v1.2 · SRS v1.2 · BPMN v1.2                                 |
| Trạng thái       | Giai đoạn 1 hoàn thành — đang vận hành                               |

---

# 1. Kiến trúc thực tế đã triển khai

```
appsscript/
└── KiotVietExport.gs       ← Bản legacy một file, chỉ giữ để tham khảo

src/                        ← GAS source code (clasp push)
├── config/Config.gs
├── kiotviet/Auth.gs · CustomerDebtReport.gs · CustomerReport.gs · SheetSchemas.gs · SyncInitial.gs · WebhookAdmin.gs
├── sync/UpdateHandlers.gs · WebhookQueue.gs
├── dashboard/WebApp.gs · DashboardData.gs
├── ui/Dashboard.html
└── utils/Helpers.gs

server/                     ← Node.js/Express backend (Render.com)
├── index.js
├── config.js
├── routes.js
├── jobs/syncCustomerReport.js ← Đồng bộ 2 báo cáo khách hàng theo lịch 07:00
├── sheets/sheetsClient.js  ← Liệt kê/lọc tab hiện có trước batchGet
└── dashboard/dashboardData.js ← Tính ngày giờ theo Asia/Ho_Chi_Minh

server/public/
└── index.html              ← Frontend HTML/CSS/JS (Chart.js)
```

---

# 2. Giai đoạn 1 — Dashboard Real-Time (ĐÃ HOÀN THÀNH)

## 2.1. Danh sách task đã hoàn thành

| **#** | **Hạng mục**                          | **Nội dung**                                                                                       | **Trạng thái** |
|-------|---------------------------------------|----------------------------------------------------------------------------------------------------|----------------|
| 1     | Phân tích & thiết kế                  | Hoàn thiện BRD v1.2, SRS v1.2, BPMN v1.2; thiết kế kiến trúc kỹ thuật                            | ✅ Hoàn thành  |
| 2     | Apps Script đồng bộ KiotViet          | `src/`: sync đủ trường cho 9 sheet, webhook 9 event, polling 5 phút (Trả hàng/NCC/Nhập hàng)       | ✅ Hoàn thành  |
| 3     | GAS Web App (src/)                    | Multi-file GAS: Auth, SheetSchemas, CustomerDebtReport (guard bảo vệ HN1/HN3/HN7), CustomerReport, SyncInitial, WebhookAdmin, UpdateHandlers, WebhookQueue, DashboardData, WebApp | ✅ Hoàn thành  |
| 4     | Backend Node.js/Express               | `server/`: liệt kê/lọc tab, `batchGet` tối đa 9 tab, xử lý tab thiếu và tính ngày giờ Việt Nam   | ✅ Hoàn thành  |
| 5     | Frontend HTML/CSS/JS                  | Sidebar, KPI, biểu đồ/bảng, lọc 7/30/90 ngày, refresh tay + nền 10 phút + tải bù khi tab visible | ✅ Hoàn thành  |
| 6     | Triển khai Render.com                 | Deploy lên `tokosi.onrender.com`; cấu hình `SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON`         | ✅ Hoàn thành  |
| 7     | CI/CD                                 | Auto-deploy khi push lên branch `main` của GitHub repo                                             | ✅ Hoàn thành  |
| 8     | Health check & Debug route            | `GET /health` → Render ping; `/api/debug` → kiểm tra kết nối và liệt kê `sheetTabs`                | ✅ Hoàn thành  |

## 2.2. Tính năng đã vận hành

- **KPI Dashboard:** Doanh thu hôm nay, hóa đơn, tồn kho, công nợ KH/NCC, đặt hàng, trả hàng, nhập hàng
- **Biểu đồ doanh thu theo ngày:** bộ lọc 7 / 30 / 90 ngày
- **Bảng chi tiết:** Top 10 sản phẩm bán chạy, hàng đã hết, Top 8 công nợ, 8 bản ghi gần nhất (HĐ, đặt hàng, trả hàng, nhập hàng)
- **Đồng bộ tự động:** Webhook KiotViet (9 event) + Polling 5 phút (Trả hàng/NCC/Nhập hàng)
- **Schema gọn:** giữ cột dashboard ở bên trái và các trường Public API dạng phẳng đang dùng ở bên phải; không lưu cột JSON/payload gốc
- **Làm mới dashboard:** nút Refresh; tự tải nền mỗi 10 phút; tải bù khi quay lại tab đã ẩn quá 10 phút
- **Khả năng chịu lỗi tab nguồn:** tab thiếu/đổi tên trả dữ liệu rỗng cho section tương ứng thay vì làm lỗi toàn dashboard
- **Nhất quán thời gian:** KPI hôm nay, chuỗi ngày và `updatedAt` theo Asia/Ho_Chi_Minh

---

# 3. Giai đoạn 2 — Định hướng tiếp theo

| **#** | **Hạng mục**                  | **Mô tả**                                                                             | **Ưu tiên** |
|-------|-------------------------------|--------------------------------------------------------------------------------------|-------------|
| 1     | Phân quyền người dùng         | Đăng nhập nội bộ, phân quyền Admin/Nhân viên; middleware auth Express                | Cao         |
| 2     | Xuất báo cáo PDF/Excel        | Export KPI summary, bảng hóa đơn, tồn kho theo kỳ                                   | Cao         |
| 3     | Nâng cấp UI/UX                | Dark theme nâng cao, glassmorphism, micro-animations, counting animation KPI          | Trung bình  |
| 4     | Theo dõi chu kỳ refresh       | Hiển thị countdown và cho phép cấu hình chu kỳ (logic auto-refresh 10 phút đã có)      | Trung bình  |
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

> **Schema Google Sheets:** Apps Script duy trì 9 tab vận hành, tab `Báo cáo bán hàng` 18 cột theo từng giao dịch trong tháng hiện tại và tab `Hàng bán theo khách` đúng 5 cột chi tiết hàng bán trong 90 ngày. Webhook hóa đơn cập nhật `Hàng bán theo khách` theo chu kỳ hàng đợi 1 phút; lượt 07:00 đối soát hai báo cáo. Ba tab `HN1`/`HN3`/`HN7` do KiotViet quản lý: Apps Script không tạo, ghi, xóa, định dạng hoặc thay đổi cấu trúc; module CustomerDebtReport chỉ là guard gỡ trigger legacy. `src/kiotviet/SheetSchemas.gs` giữ cột dashboard ở bên trái, chỉ nối các trường KiotViet dạng phẳng đang dùng và tự xóa cột JSON cũ qua trigger nền. Backend dashboard chỉ đọc 9 tab vận hành và dùng `Nhóm hàng` để gom tồn kho theo nhóm cha.
> `sheetsClient.js` lọc tab hiện có trước `batchGet`, nên tab thiếu chỉ làm rỗng section tương ứng. Khi thay đổi các cột tương thích dashboard vẫn phải cập nhật đồng bộ `SheetSchemas.gs`, `server/config.js` và `server/dashboard/dashboardData.js`.

> **Múi giờ:** Backend cố định `Asia/Ho_Chi_Minh`/UTC+07:00 cho parse ngày, KPI "hôm nay", bucket 7/30/90 ngày và `updatedAt`; không phụ thuộc timezone mặc định của Render.

> **Biến môi trường Render:** `SPREADSHEET_ID` và `GOOGLE_SERVICE_ACCOUNT_JSON` — không commit vào repo.

> **Thông tin xác thực KiotViet:** Apps Script đọc `KIOTVIET_CLIENT_ID` và `KIOTVIET_CLIENT_SECRET` từ Script Properties; tác vụ Node.js đọc `KIOTVIET_CLIENT_ID`, `KIOTVIET_CLIENT_SECRET`, `KIOTVIET_RETAILER` từ biến môi trường. Không hard-code hoặc commit các giá trị này.

---

*— Cập nhật lần cuối: 30/07/2026 —*
