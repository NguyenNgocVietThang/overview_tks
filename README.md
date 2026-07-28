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
| **Lưu trữ dữ liệu** | Google Sheets (3 tab: Hàng hóa, Hóa đơn, Khách hàng) |
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
├── appsscript.json              # Manifest Apps Script (timezone, oauthScopes)
│
├── src/                         # ── GIAI ĐOẠN 1 — Code Apps Script ──
│   ├── config/
│   │   └── Config.gs            # object CONFIG (Client ID/Secret, tên các Sheet)
│   │
│   ├── kiotviet/
│   │   ├── Auth.gs              # getKiotVietToken()
│   │   ├── SyncInitial.gs       # syncAllInitialData, syncProductsInitial,
│   │   │                        #   syncInvoicesInitial, syncCustomersInitial
│   │   └── WebhookAdmin.gs      # registerWebhookProgrammatically,
│   │                            #   registerWebhookWithCorrectUrl,
│   │                            #   listRegisteredWebhooks, checkWebhookStatus,
│   │                            #   deleteAllOldWebhooks
│   │
│   ├── sync/
│   │   ├── UpdateHandlers.gs    # updateProductsFromWebhook,
│   │   │                        #   updateInvoicesFromWebhook,
│   │   │                        #   updateCustomersFromWebhook
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
│       └── Dashboard.html       # Giao diện Web App (Chart.js, dark theme)
│
├── docs/
│   ├── 01-business/
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
clasp push
```

### Bước 4 — Thiết lập lần đầu (chạy thủ công 1 lần)
1. Mở **Apps Script Editor** → chạy `syncAllInitialData()` để tải dữ liệu ban đầu
2. Chạy `deleteAllOldWebhooks()` để xóa webhook cũ (nếu có)
3. Chạy `registerWebhookWithCorrectUrl()` để đăng ký webhook mới
4. Chạy `setupQueueProcessingTrigger()` để tạo trigger xử lý hàng đợi mỗi 1 phút

### Bước 5 — Deploy Web App
1. **Deploy → New deployment → Web App**
2. Execute as: **Me**, Access: **Anyone**
3. Copy URL `/exec` → dán vào `registerWebhookWithCorrectUrl()` nếu cần cập nhật lại

---

## Cách sử dụng

| Hàm | Mục đích | Khi nào chạy |
|---|---|---|
| `syncAllInitialData()` | Tải toàn bộ dữ liệu lần đầu | 1 lần duy nhất khi bắt đầu |
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
| [BRD](docs/01-business/BRD_Dashboard_GoogleSheets.md) | Business Requirements Document |
| [SRS](docs/02-srs/SRS_Dashboard_GoogleSheets.md) | Software Requirements Specification |
| [BPMN](docs/03-process/BPMN_Dashboard_GoogleSheets.md) | Sơ đồ quy trình nghiệp vụ |
| [Implementation Plan](docs/04-planning/implementation_plan.md) | Kế hoạch triển khai chi tiết |

---

## Ghi chú kỹ thuật

> **Thứ tự load file trong GAS**: clasp sắp xếp file theo thứ tự alphabetical của thư mục.  
> `config/` → `dashboard/` → `kiotviet/` → `sync/` → `ui/` → `utils/`  
> Đảm bảo `Config.gs` luôn được khởi tạo trước tất cả các module khác. ✅

> **Tên file HTML**: `src/ui/Dashboard.html` được clasp push lên GAS với tên `Dashboard`.  
> `doGet()` gọi `createHtmlOutputFromFile('Dashboard')` — hoạt động chính xác. ✅

---

*Cập nhật lần cuối: 2026-07-28*
