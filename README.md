# TKS Dashboard — CHbansi Live Dashboard

Hệ thống dashboard **thời gian thực** cho cửa hàng **CHbansi**, đồng bộ dữ liệu từ [KiotViet](https://www.kiotviet.vn/) qua Google Apps Script + Google Sheets.

---

## 📋 Mục lục

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
| **Nền tảng** | Google Apps Script (V8 Runtime) |
| **Lưu trữ dữ liệu** | Google Sheets (9 tab vận hành + 7 tab tổng hợp: Báo cáo bán hàng, Hàng bán theo khách, Khách theo hàng hóa, Hàng ngừng kinh doanh, HN1, HN3, HN7) |
| **Nguồn dữ liệu** | KiotViet Public API |
| **Cập nhật** | Webhook + hàng đợi bền vững trên tab ẩn; polling 15 phút cho nguồn không có webhook |
| **Apps Script** | Chỉ đồng bộ KiotViet → Google Sheets; Web App `/exec` chỉ nhận HTTP POST |
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
├── design-system/               # Quy chuẩn giao diện dùng chung
│   └── tks-dashboard/
│       └── MASTER.md            # Token, component và quy tắc thiết kế dashboard
│
├── dev/                         # Giao diện tĩnh thử nghiệm / mock data
│   ├── index.html
│   └── vendor/
│       └── chart.umd.min.js
│
├── plans/                       # Các kế hoạch nâng cấp UI/UX chi tiết
│   ├── 001-stop-chart-reanimate-on-tab-switch-and-poll.md
│   ├── 002-shared-easing-tokens-for-entrances.md
│   ├── 003-search-suggestions-dropdown-transition.md
│   ├── 004-theme-toggle-surface-transitions.md
│   ├── 005-debt-row-detail-fade-in.md
│   └── README.md
│
├── server/                      # Backend Node.js đọc/ghi Google Sheets & Web Server
│   ├── dashboard/
│   │   ├── dashboardData.js     # Thống kê tổng quan KPI, biểu đồ và tìm kiếm
│   │   ├── dashboardData.test.js # Unit test dữ liệu dashboard/tìm kiếm/cache
│   │   ├── debtReport.js        # Báo cáo công nợ khách hàng 1/3/7 ngày từ HN1/HN3/HN7
│   │   ├── exportService.js     # Registry 16 bảng và tạo workbook Excel
│   │   └── exportService.test.js # Unit test dữ liệu/file Excel
│   ├── jobs/
│   │   └── syncCustomerReport.js # Tác vụ đối soát toàn bộ 3 báo cáo lúc 07:00
│   ├── public/                  # Frontend Live Dashboard
│   │   ├── index.html
│   │   ├── js/
│   │   │   ├── export-ui.test.js # Kiểm tra nút/modal xuất Excel trong giao diện
│   │   │   ├── pagination.js    # Phân trang client-side cho các bảng
│   │   │   └── pagination.test.js # Unit test cho module phân trang
│   │   └── vendor/
│   │       └── chart.umd.min.js
│   ├── sheets/
│   │   └── sheetsClient.js      # Đọc dữ liệu Google Sheets cho dashboard
│   ├── config.js                # Cấu hình môi trường Node.js server
│   ├── index.js                 # Express server entry point
│   └── routes.js                # Định tuyến API endpoint (/api/dashboard/summary, etc.)
│
├── src/                         # ── GIAI ĐOẠN 1 — Code Apps Script (clasp) ──
│   ├── appsscript.json          # Manifest Apps Script (timezone, oauthScopes)
│   ├── HuongDanSuDung.gs        # Hướng dẫn hàm và luồng liên kết ngay trên GAS
│   │
│   ├── config/
│   │   └── Config.gs            # object CONFIG (Client ID/Secret, tên các Sheet)
│   │
│   ├── kiotviet/
│   │   ├── Auth.gs              # getKiotVietToken() + cache token theo hạn
│   │   ├── CustomerDebtReport.gs # syncCustomerDebtReports, setupCustomerDebtReports,
│   │   │                        #   setupCustomerDebtReportDailyTrigger (HN1/HN3/HN7)
│   │   ├── CustomerReport.gs    # syncCustomerReport, syncCustomerByProductReport,
│   │   │                        #   setupCustomerReport, trigger 07:00
│   │   ├── DiscontinuedProducts.gs # syncHangNgungKinhDoanh, lưu lịch sử ngừng kinh doanh
│   │   ├── SheetSchemas.gs      # Schema đủ trường cho 9 sheet, fetch/retry,
│   │   │                        #   ghi/upsert/migrate dữ liệu KiotViet
│   │   ├── SyncInitial.gs       # syncAllInitialData, sync 9 sheet vận hành,
│   │   │                        #   setupPollingTrigger (15 phút)
│   │   └── WebhookAdmin.gs      # registerWebhookProgrammatically,
│   │                            #   registerWebhookWithCorrectUrl,
│   │                            #   listRegisteredWebhooks, checkWebhookStatus,
│   │                            #   deleteAllOldWebhooks
│   │
│   ├── sync/
│   │   ├── UpdateHandlers.gs    # hydrate + update/delete Product, Invoice,
│   │   │                        #   Order, Customer, Category
│   │   └── WebhookQueue.gs      # doPost, queue bền vững, retry,
│   │                            #   processWebhookQueue, getWebhookQueueStatus
│   │
│   └── utils/
│       └── Helpers.gs           # getCodeRowMap, formatLastRowNumbers, formatDate
│
├── docs/
│   ├── 01-brd/
│   │   └── BRD_Dashboard_GoogleSheets.md
│   ├── 02-srs/
│   │   └── SRS_Dashboard_GoogleSheets.md
│   ├── 03-process/
│   │   ├── BPMN_Dashboard_GoogleSheets.md
│   │   └── bpmn/
│   │       ├── bpmn_1_phaseA.bpmn
│   │       ├── bpmn_2_phaseB.bpmn
│   │       └── bpmn_3_phaseC.bpmn
│   ├── 04-planning/
│   │   └── implementation_plan.md
│   └── superpowers/
│       ├── plans/
│       │   ├── 2026-08-13-dashboard-result-cache.md
│       │   └── 2026-08-13-dashboard-table-pagination.md
│       └── specs/
│           └── 2026-08-05-debt-dashboard-design.md
│
└── future-phases/               # ── Khung rỗng cho các giai đoạn sau ──
    ├── sales-pos/               # Giai đoạn 2: POS bán hàng
    ├── inventory/               # Giai đoạn 3: Quản lý kho nâng cao
    ├── analytics-anomaly/       # Giai đoạn 4: Phát hiện bất thường
    ├── directory/               # Giai đoạn 5: Danh bạ nội bộ
    └── ai-assistant/            # Giai đoạn 6: Chatbot & dự báo AI
```

---

## Cài đặt & triển khai

### Yêu cầu
- [Node.js](https://nodejs.org/) ≥ 18
- [@google/clasp](https://github.com/google/clasp): `npm install -g @google/clasp`
- Tài khoản Google có quyền truy cập Google Apps Script

### Chạy kiểm thử tự động (Server & Frontend logic)
Thư mục `server/` tích hợp sẵn 21 unit tests (dùng `node:test` chuẩn của Node.js, không cần thư viện ngoài):
```bash
cd server
npm test
```
Bộ test bao gồm: kiểm thử Result Cache backend, phân trang client-side (`pagination.js`), đăng ký & tạo file Xuất Excel 16 bảng (`exportService.js`), tìm kiếm nhiều mã và Top 3 KH theo sản phẩm.

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
> Script ID lấy từ: **Apps Script Editor → Project Settings → Script ID**

### Bước 3 — Push code lên GAS
```bash
clasp push --force
```

Trong **Apps Script Editor → Project Settings → Script Properties**, tạo hai thuộc tính:

- `KIOTVIET_CLIENT_ID`: Client ID của KiotViet.
- `KIOTVIET_CLIENT_SECRET`: Client Secret của KiotViet.

Không lưu hai giá trị này trong mã nguồn hoặc commit lên Git.

Mỗi lần phát hành, luôn tạo phiên bản mới và cập nhật deployment Web App hiện tại
thay vì chỉ dừng ở bản HEAD:

```bash
clasp version "Mô tả phiên bản"
clasp redeploy AKfycby99mhJo_-EZPl4VBdtjxf2HI9A_x5MSgGX0yk2UjhkCV_o3DvfjJNf6HoZG5zAWw2clA -V <VERSION_MỚI>
```

Deployment ID được giữ nguyên nên URL Web App không đổi; chỉ số phiên bản tăng sau
mỗi lần phát hành.

### Bước 4 — Thiết lập lần đầu (chạy thủ công 1 lần)
1. Kiểm tra đã khai báo `KIOTVIET_CLIENT_ID` và `KIOTVIET_CLIENT_SECRET` trong Script Properties, sau đó chạy `syncAllInitialData()` để tải dữ liệu ban đầu. Hàm này cũng cập nhật toàn bộ lịch sử vào tab **Hàng ngừng kinh doanh** và dọn tab legacy `Hàng ngừng KD hôm nay` nếu còn tồn tại.
2. Chạy `setupKiotVietAutoSync()` một lần. Hàm này tự tạo secret, trigger xử lý hàng đợi mỗi 1 phút, polling mỗi 15 phút, cập nhật **Hàng ngừng kinh doanh** lúc 07:00, cập nhật HN1/HN3/HN7 gần 15:00 và đăng ký đủ 9 webhook mà không xóa webhook của hệ thống khác.
3. Tab **Hàng bán theo khách** có đúng 5 cột và được webhook cập nhật trong khoảng 1 phút. Tab **Khách theo hàng hóa** có đúng 25 cột như file xuất KiotViet, lấy toàn bộ lịch sử và chỉ làm mới khi chạy tay hoặc gần 07:00. Cả ba báo cáo được đối soát bởi `setupCustomerReport()`; tab **Báo cáo bán hàng** giữ đủ 18 cột.
4. Ba tab **HN1**, **HN3**, **HN7** là báo cáo công nợ khách hàng 1/3/7 ngày gần đây (tính cả hôm nay) do Apps Script tự tính từ dữ liệu KiotViet và ghi đè mỗi ngày gần 15:00, hoặc chạy tay `syncCustomerDebtReports()` bất cứ lúc nào cần cập nhật ngay.

Sau khi bật, thay đổi Hàng hóa, Tồn kho, Khách hàng, Hóa đơn, Đặt hàng và Nhóm hàng
được nhận bằng webhook rồi ghi vào Sheets trong khoảng 1 phút. **Trả hàng**, **Nhà cung
cấp** và **Nhập hàng** được quét dự phòng mỗi 15 phút vì KiotViet không phát webhook
cho ba nhóm này.

### Bước 5 — Deploy Web App
1. **Deploy → New deployment → Web App**
2. Execute as: **Me**, Access: **Anyone**
3. Copy URL `/exec` → dán vào `registerWebhookWithCorrectUrl()` nếu cần cập nhật lại

---

## Cách sử dụng

| Hàm | Mục đích | Khi nào chạy |
|---|---|---|
| `syncAllInitialData()` | Làm mới 9 sheet vận hành, lịch sử Hàng ngừng kinh doanh, 3 báo cáo khách hàng và HN1/HN3/HN7; báo cáo công nợ chạy sau khi Hàng hóa đã cập nhật | Lần đầu hoặc khi cần full refresh |
| `syncHangNgungKinhDoanh()` | Nạp các sản phẩm đang ngừng kinh doanh và giữ lịch sử các sản phẩm từng ngừng; không tạo tab theo ngày | Khi cần đối soát thủ công |
| `cauHinhLichHangNgungKinhDoanh()` | Cập nhật toàn bộ lịch sử và tạo lại lịch cập nhật 07:00 hàng ngày | Một lần sau khi deploy |
| `removeJsonColumnsFromAllSheets()` | Xóa ngay các cột `(JSON)` cũ trên 9 sheet vận hành | Tùy chọn; trigger nền cũng tự chạy một lần sau khi deploy |
| `setupKiotVietAutoSync()` | Bật hoặc khôi phục webhook và trigger an toàn, không tạo trùng | 1 lần sau khi deploy |
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

## Lộ trình mở rộng

| Giai đoạn | Module | Mô tả |
|---|---|---|
| **1** ✅ | `src/` | Dashboard real-time (đang chạy) |
| **2** 🔲 | `future-phases/sales-pos/` | POS bán hàng tích hợp |
| **3** 🔲 | `future-phases/inventory/` | Quản lý kho nâng cao, cảnh báo |
| **4** 🔲 | `future-phases/analytics-anomaly/` | Phát hiện bất thường, fraud detection |
| **5** 🔲 | `future-phases/directory/` | Danh bạ nhân viên / đối tác |
| **6** 🔲 | `future-phases/ai-assistant/` | Chatbot tư vấn & dự báo bằng AI |

---

## Tài liệu kỹ thuật

| Tài liệu | Mô tả |
|---|---|
| [BRD](docs/01-brd/BRD_Dashboard_GoogleSheets.md) | Business Requirements Document |
| [SRS](docs/02-srs/SRS_Dashboard_GoogleSheets.md) | Software Requirements Specification |
| [BPMN](docs/03-process/BPMN_Dashboard_GoogleSheets.md) | Sơ đồ quy trình nghiệp vụ |
| [Implementation Plan](docs/04-planning/implementation_plan.md) | Kế hoạch triển khai chi tiết & trạng thái |
| [Design System Master](design-system/tks-dashboard/MASTER.md) | Hệ thống token, component và quy tắc giao diện |
| [Debt Dashboard Spec](docs/superpowers/specs/2026-08-05-debt-dashboard-design.md) | Đặc tả thiết kế module Báo cáo công nợ HN1/HN3/HN7 |
| [Result Cache Plan](docs/superpowers/plans/2026-08-13-dashboard-result-cache.md) | Kế hoạch & chi tiết triển khai Result Cache tầng backend |
| [Pagination Plan](docs/superpowers/plans/2026-08-13-dashboard-table-pagination.md) | Kế hoạch & chi tiết triển khai phân trang bảng client-side |
| [Animation Plans](plans/README.md) | Kế hoạch chi tiết 5 cải tiến motion/transitions cho giao diện |
| [Apps Script Guide](src/HuongDanSuDung.gs) | Hướng dẫn hàm, tác dụng và luồng liên kết; được push lên Apps Script |

---

## Ghi chú kỹ thuật

> **Thứ tự load file trong GAS**: clasp sắp xếp file theo thứ tự alphabetical của thư mục.  
> `HuongDanSuDung.gs` → `config/` → `kiotviet/` → `sync/` → `utils/`
> Đảm bảo `Config.gs` luôn được khởi tạo trước tất cả các module khác. ✅

> Apps Script không có `doGet()` hoặc file HTML. Deployment Web App chỉ tồn tại
> để KiotViet gọi `doPost()` qua URL `/exec`.

> **Schema dữ liệu:** 9 sheet vận hành giữ nguyên các cột dashboard ở bên trái và
> chỉ bổ sung các trường KiotViet dạng phẳng đang được sử dụng. Apps Script không
> ghi object/mảng hoặc payload gốc vào cột JSON; trigger nền tự xóa các cột JSON
> của schema cũ một lần sau khi phiên bản mới được deploy. HN1/HN3/HN7 dùng schema
> báo cáo riêng (một dòng cho mỗi giao dịch hoặc mặt hàng trong giao dịch)
> do `CustomerDebtReport.gs` tự quản lý, tách biệt với 9 sheet vận hành.


---

*Cập nhật lần cuối: 2026-08-14*
