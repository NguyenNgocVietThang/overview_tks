# KẾ HOẠCH TRIỂN KHAI — TRẠNG THÁI & LỘ TRÌNH

*(Deployment Status & Roadmap)*

**HỆ THỐNG DASHBOARD NỘI BỘ — TOKOSI**

| **Thông tin**    | **Nội dung**                                                         |
|------------------|----------------------------------------------------------------------|
| Phiên bản tài liệu | 1.5                                                              |
| Ngày tạo         | 27/07/2026                                                           |
| Ngày cập nhật    | 14/08/2026                                                           |
| Tài liệu liên quan | BRD v1.4 · SRS v1.6 · BPMN v1.4 · Debt Spec 2026-08-05 · Cache/Pagination Plans |
| Trạng thái       | Giai đoạn 1 hoàn thành — đang vận hành                               |

---

# 1. Kiến trúc thực tế đã triển khai

```
src/                        ← GAS source code (clasp push)
├── HuongDanSuDung.gs       ← Hướng dẫn hàm và luồng liên kết trên Apps Script
├── config/Config.gs
├── kiotviet/Auth.gs · CustomerDebtReport.gs · CustomerReport.gs · DiscontinuedProducts.gs · SheetSchemas.gs · SyncInitial.gs · WebhookAdmin.gs
├── sync/UpdateHandlers.gs · WebhookQueue.gs
└── utils/Helpers.gs

server/                     ← Node.js/Express backend (Render.com)
├── index.js
├── config.js
├── routes.js
├── jobs/syncCustomerReport.js ← Đối soát 3 báo cáo khách hàng theo lịch 07:00
├── sheets/sheetsClient.js  ← Liệt kê/lọc tab hiện có trước batchGet
├── dashboard/
│   ├── dashboardData.js    ← Thống kê KPI, biểu đồ, tìm kiếm, Result Cache
│   ├── dashboardData.test.js ← Unit test cache/aggregation/search
│   ├── debtReport.js       ← Báo cáo công nợ khách hàng 1/3/7 ngày từ HN1/HN3/HN7
│   ├── exportService.js    ← Registry 16 bảng và tạo file Excel .xlsx
│   └── exportService.test.js ← Unit test xuất Excel
└── public/
    ├── index.html          ← Frontend HTML/CSS/JS (Chart.js, animations, transitions)
    ├── js/
    │   ├── export-ui.test.js ← Unit test giao diện xuất Excel
    │   ├── pagination.js   ← Module phân trang bảng client-side
    │   └── pagination.test.js ← Unit test cho phân trang
    └── vendor/
        └── chart.umd.min.js
```

---

# 2. Giai đoạn 1 — Dashboard Real-Time (ĐÃ HOÀN THÀNH)

## 2.1. Danh sách task đã hoàn thành

| **#** | **Hạng mục**                          | **Nội dung**                                                                                       | **Trạng thái** |
|-------|---------------------------------------|----------------------------------------------------------------------------------------------------|----------------|
| 1     | Phân tích & thiết kế                  | Hoàn thiện BRD v1.4, SRS v1.6, BPMN v1.4; thiết kế kiến trúc kỹ thuật                            | ✅ Hoàn thành  |
| 2     | Apps Script đồng bộ KiotViet          | `src/`: sync đủ trường, webhook 9 event qua queue bền vững, polling 15 phút (Trả hàng/NCC/Nhập hàng) | ✅ Hoàn thành  |
| 3     | GAS Web App (src/)                    | Chỉ nhận `doPost()` từ KiotViet; đã bỏ preview HTML và logic đọc dashboard khỏi Apps Script | ✅ Hoàn thành  |
| 4     | Backend Node.js/Express               | `server/`: liệt kê/lọc tab, `batchGet` tối đa 9 tab, xử lý tab thiếu và tính ngày giờ Việt Nam   | ✅ Hoàn thành  |
| 5     | Frontend HTML/CSS/JS                  | Sidebar, KPI, biểu đồ/bảng, lọc 7/30/90 ngày, refresh tay + nền 10 phút + tải bù khi tab visible | ✅ Hoàn thành  |
| 6     | Triển khai Render.com                 | Deploy lên `tokosi.onrender.com`; cấu hình `SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON`         | ✅ Hoàn thành  |
| 7     | CI/CD                                 | Auto-deploy khi push lên branch `main` của GitHub repo                                             | ✅ Hoàn thành  |
| 8     | Health check & Debug route            | `GET /health` → Render ping; `/api/debug` → kiểm tra kết nối và liệt kê `sheetTabs`                | ✅ Hoàn thành  |
| 9     | Báo cáo công nợ KH 1/3/7 ngày         | `CustomerDebtReport.gs` tự động tính và ghi đè HN1/HN3/HN7; backend `debtReport.js` đọc và hiển thị| ✅ Hoàn thành  |
| 10    | Lịch sử hàng Ngừng kinh doanh | `DiscontinuedProducts.gs` cập nhật toàn bộ lịch sử trong tab `Hàng ngừng kinh doanh` | ✅ Hoàn thành  |
| 11    | Khách theo hàng hóa | `CustomerReport.gs` tổng hợp toàn bộ lịch sử theo 25 cột sản phẩm → khách → hóa đơn, cập nhật gần 07:00 hoặc chạy tay | ✅ Hoàn thành |
| 12    | Xuất Excel theo từng bảng | 16 bảng và kết quả tìm kiếm xuất `.xlsx`, chọn đủ trường Google Sheets, hỗ trợ workbook nhiều worksheet | ✅ Hoàn thành |
| 13    | Result Cache tầng backend | Cache dữ liệu thô 90s + Result Cache theo `(rawDataVersion, filters)`, search index chỉ build lại khi refetch | ✅ Hoàn thành |
| 14    | Phân trang bảng client-side | `pagination.js` phân trang ~200 dòng/trang cho `allProducts` và `lowStock`, loại bỏ lag 3.5s khi mở tab Hàng hóa | ✅ Hoàn thành |
| 15    | Tối ưu Motion & UI Transitions | Áp dụng shared `--ease-out`, chống re-animate biểu đồ khi chuyển tab/poll, transition mượt mà cho search suggestions, surfaces, debt rows | ✅ Hoàn thành |
| 16    | Bộ kiểm thử tự động (21 tests) | 21 unit tests chuẩn `node:test` bao phủ cache, pagination, excel export, multi-code search, customer product top | ✅ Hoàn thành |

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
- **Giao diện mượt mà:** Micro-animations với token chung, chuyển đổi theme mượt mà, không giật lag khi chuyển tab hoặc background polling.

---

# 3. Giai đoạn 2 — Định hướng tiếp theo

| **#** | **Hạng mục**                  | **Mô tả**                                                                             | **Ưu tiên** | **Trạng thái** |
|-------|-------------------------------|--------------------------------------------------------------------------------------|-------------|----------------|
| 1     | Phân quyền người dùng         | Đăng nhập nội bộ, phân quyền Admin/Nhân viên; middleware auth Express                | Cao         | Đang lên kế hoạch |
| 2     | Xuất báo cáo PDF              | Excel theo từng bảng đã hoàn thành; còn lại PDF cho KPI summary và báo cáo in        | Cao         | Đang lên kế hoạch |
| 3     | Nâng cấp UI/UX                | Glassmorphism, counting animation KPI, biểu đồ nâng cao                               | Trung bình  | Một phần hoàn thành (Motion & Transitions ✅) |
| 4     | Theo dõi chu kỳ refresh       | Hiển thị countdown và cho phép cấu hình chu kỳ (logic auto-refresh 10 phút đã có)      | Trung bình  | Đang lên kế hoạch |
| 5     | Cache tầng backend            | In-memory result cache và raw sheets cache 90s đã triển khai (`dashboardData.js`)     | Thấp        | ✅ Đã hoàn thành |
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
> `HuongDanSuDung.gs` → `config/` → `kiotviet/` → `sync/` → `utils/`
> `Config.gs` luôn được khởi tạo trước tất cả module khác. ✅

> **Schema Google Sheets:** Apps Script duy trì 9 tab vận hành, tab lịch sử `Hàng ngừng kinh doanh`, 3 tab báo cáo khách hàng, 3 tab báo cáo công nợ HN1/HN3/HN7 và tab ẩn `_KV_WEBHOOK_QUEUE`. Queue không hết hạn, chỉ xóa sự kiện sau khi ghi thành công và tự retry lỗi. Ba tab `HN1`/`HN3`/`HN7` do `CustomerDebtReport.gs` tự động tính từ dữ liệu KiotViet và ghi đè mỗi ngày gần 15:00 (hoặc chạy tay), được backend `server/dashboard/debtReport.js` đọc để dựng báo cáo công nợ. `src/kiotviet/SheetSchemas.gs` ghi dữ liệu mới trước khi dọn dòng dư để tránh xóa trắng khi cập nhật lỗi.
> `sheetsClient.js` lọc tab hiện có trước `batchGet`, nên tab thiếu chỉ làm rỗng section tương ứng. Khi thay đổi các cột tương thích dashboard vẫn phải cập nhật đồng bộ `SheetSchemas.gs`, `server/config.js` và `server/dashboard/dashboardData.js`.

> **Múi giờ:** Backend cố định `Asia/Ho_Chi_Minh`/UTC+07:00 cho parse ngày, KPI "hôm nay", bucket 7/30/90 ngày và `updatedAt`; không phụ thuộc timezone mặc định của Render.

> **Biến môi trường Render:** `SPREADSHEET_ID` và `GOOGLE_SERVICE_ACCOUNT_JSON` — không commit vào repo.

> **Thông tin xác thực KiotViet:** Apps Script đọc `KIOTVIET_CLIENT_ID` và `KIOTVIET_CLIENT_SECRET` từ Script Properties; tác vụ Node.js đọc `KIOTVIET_CLIENT_ID`, `KIOTVIET_CLIENT_SECRET`, `KIOTVIET_RETAILER` từ biến môi trường. Không hard-code hoặc commit các giá trị này.

---

*— Cập nhật lần cuối: 14/08/2026 —*
