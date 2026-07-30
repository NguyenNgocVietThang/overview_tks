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
| **Lưu trữ dữ liệu** | Google Sheets (các tab vận hành + Báo cáo bán hàng tháng này + Hàng bán theo khách 90 ngày) |
| **Nguồn dữ liệu** | KiotViet Public API |
| **Cập nhật** | Real-time qua Webhook + hàng đợi CacheService |
| **Giao diện** | Web App HTML/CSS/JS (Chart.js) |
| **Múi giờ** | Asia/Ho_Chi_Minh (GMT+7) |

### Kiến trúc xử lý Webhook

```
KiotViet ──POST──▶ doPost()          ← Nhận & queue ngay (< 100ms)
                      │
                 CacheService         ← Lưu tạm payload 6 tiếng
                      │
              ┌── trigger/1 phút ──┐
              ▼                    │
   processWebhookQueue()           │  ← Đọc queue & ghi Sheet
              │                    │
    updateXxxFromWebhook()         └── LockService (tránh race condition)
              │
         Google Sheets
              │
         getDashboardData()  ◀── Dashboard Web App
```

---

## Cấu trúc thư mục

```
webtks-dashboard/
├── .clasp.json                  # Cấu hình clasp (scriptId, rootDir: "src")
├── .claspignore                 # Loại trừ docs/, future-phases/ khỏi clasp push
├── appsscript/                  # Bản đơn file cũ để tham khảo (không được clasp push)
│   └── KiotVietExport.gs        # Luồng legacy; mã triển khai chính nằm trong src/
│
├── design-system/               # Quy chuẩn giao diện dùng chung
│   └── tks-dashboard/
│       └── MASTER.md            # Token, component và quy tắc thiết kế dashboard
│
├── server/                      # Backend Node.js đọc/ghi Google Sheets
│   ├── jobs/
│   │   └── syncCustomerReport.js # Tác vụ cập nhật 2 báo cáo khách hàng lúc 07:00
│   └── sheets/
│       └── sheetsClient.js      # Đọc dữ liệu Google Sheets cho dashboard
│
├── src/                         # ── GIAI ĐOẠN 1 — Code Apps Script (clasp) ──
│   ├── appsscript.json          # Manifest Apps Script (timezone, oauthScopes)
│   │
│   ├── config/
│   │   └── Config.gs            # object CONFIG (Client ID/Secret, tên các Sheet)
│   │
│   ├── kiotviet/
│   │   ├── Auth.gs              # getKiotVietToken()
│   │   ├── CustomerReport.gs    # syncCustomerReport, setupCustomerReport,
│   │   │                        #   setupCustomerReportDailyTrigger
│   │   ├── SheetSchemas.gs      # Schema đủ trường cho 9 sheet, fetch/retry,
│   │   │                        #   ghi/upsert/migrate dữ liệu KiotViet
│   │   ├── SyncInitial.gs       # syncAllInitialData, sync 9 sheet vận hành,
│   │   │                        #   setupPollingTrigger (5 phút)
│   │   └── WebhookAdmin.gs      # registerWebhookProgrammatically,
│   │                            #   registerWebhookWithCorrectUrl,
│   │                            #   listRegisteredWebhooks, checkWebhookStatus,
│   │                            #   deleteAllOldWebhooks
│   │
│   ├── sync/
│   │   ├── UpdateHandlers.gs    # hydrate + update/delete Product, Invoice,
│   │   │                        #   Order, Customer, Category
│   │   └── WebhookQueue.gs      # doPost, processWebhookQueue,
│   │                            #   setupQueueProcessingTrigger
│   │
│   ├── dashboard/
│   │   ├── WebApp.gs            # doGet()
│   │   └── DashboardData.gs     # getDashboardData()
│   │
│   ├── utils/
│   │   └── Helpers.gs           # getCodeRowMap, formatLastRowNumbers, formatDate
│   │
│   └── ui/
│       └── Dashboard.html       # Giao diện Web App (Chart.js, dark/light mode)
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
│   └── 04-planning/
│       └── implementation_plan.md
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
- [Node.js](https://nodejs.org/) ≥ 16
- [@google/clasp](https://github.com/google/clasp): `npm install -g @google/clasp`
- Tài khoản Google có quyền truy cập Google Apps Script

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
1. Kiểm tra đã khai báo `KIOTVIET_CLIENT_ID` và `KIOTVIET_CLIENT_SECRET` trong Script Properties, sau đó chạy `syncAllInitialData()` để tải dữ liệu ban đầu
2. Chạy `setupKiotVietAutoSync()` một lần. Hàm này tự tạo secret, trigger xử lý hàng đợi mỗi 1 phút, trigger polling mỗi 5 phút và đăng ký đủ 9 webhook mà không xóa webhook của hệ thống khác.
3. Hai tab **Báo cáo bán hàng** và **Hàng bán theo khách** sẽ tự được làm mới mỗi ngày sau 07:00 qua trigger hàng đợi. Có thể chạy `setupCustomerReport()` nếu muốn tạo ngay và có thêm trigger riêng.

Sau khi bật, thay đổi Hàng hóa, Tồn kho, Khách hàng, Hóa đơn, Đặt hàng và Nhóm hàng
được nhận bằng webhook rồi ghi vào Sheets trong khoảng 1 phút. **Trả hàng**, **Nhà cung
cấp** và **Nhập hàng** được quét dự phòng mỗi 5 phút vì KiotViet không phát webhook
cho ba nhóm này.

### Bước 5 — Deploy Web App
1. **Deploy → New deployment → Web App**
2. Execute as: **Me**, Access: **Anyone**
3. Copy URL `/exec` → dán vào `registerWebhookWithCorrectUrl()` nếu cần cập nhật lại

---

## Cách sử dụng

| Hàm | Mục đích | Khi nào chạy |
|---|---|---|
| `syncAllInitialData()` | Tải đủ trường Public API vào 9 sheet vận hành và làm mới 2 sheet báo cáo | Lần đầu hoặc khi cần full refresh |
| `setupKiotVietAutoSync()` | Bật hoặc khôi phục webhook và trigger an toàn, không tạo trùng | 1 lần sau khi deploy |
| `syncPollingOnly_()` | Làm mới Trả hàng, Nhà cung cấp, Nhập hàng | Tự chạy bởi trigger 5 phút |
| `setupPollingTrigger()` | Bật lịch làm mới 3 sheet không có webhook | 1 lần duy nhất |
| `removePollingTrigger()` | Tắt lịch làm mới 5 phút | Khi bảo trì |
| `syncCustomerReport()` | Làm mới Báo cáo bán hàng tháng này và Hàng bán theo khách 90 ngày | Khi cần cập nhật thủ công |
| `syncCustomerProductReport()` | Làm mới Hàng bán theo khách 90 ngày (đồng thời làm mới báo cáo tháng) | Khi cần cập nhật thủ công |
| `setupCustomerReport()` | Tạo cả hai báo cáo ngay và bật thêm lịch riêng gần 07:00 | Tùy chọn |
| `setupCustomerReportDailyTrigger()` | Tạo lại lịch cập nhật hai báo cáo hàng ngày gần 07:00 | Khi cần khôi phục lịch |
| `setupQueueProcessingTrigger()` | Tạo trigger 1 phút | 1 lần duy nhất |
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
| [Implementation Plan](docs/04-planning/implementation_plan.md) | Kế hoạch triển khai chi tiết |

---

## Ghi chú kỹ thuật

> **Thứ tự load file trong GAS**: clasp sắp xếp file theo thứ tự alphabetical của thư mục.  
> `config/` → `dashboard/` → `kiotviet/` → `sync/` → `ui/` → `utils/`  
> Đảm bảo `Config.gs` luôn được khởi tạo trước tất cả các module khác. ✅

> **Tên file HTML**: `src/ui/Dashboard.html` được clasp push lên GAS với tên `ui/Dashboard`.  
> `doGet()` gọi `createHtmlOutputFromFile('ui/Dashboard')` — khớp đúng đường dẫn. ✅

> **Schema dữ liệu:** 9 sheet vận hành giữ nguyên các cột dashboard ở bên trái và
> bổ sung toàn bộ trường KiotViet ở bên phải. Object/mảng được lưu dưới dạng JSON;
> cột `Dữ liệu KiotViet (JSON)` giữ payload gốc để không mất trường mới từ API.


---

*Cập nhật lần cuối: 2026-07-30*
