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
| **Lưu trữ dữ liệu** | Google Sheets (9 tab vận hành + 2 báo cáo do hệ thống quản lý; HN1/HN3/HN7 do KiotViet quản lý riêng) |
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
├── .clasp.json                  # Cấu hình clasp (scriptId, rootDir: "src")
├── .claspignore                 # Loại trừ docs/, future-phases/ khỏi clasp push
├── design-system/               # Quy chuẩn giao diện dùng chung
│   └── tks-dashboard/
│       └── MASTER.md            # Token, component và quy tắc thiết kế dashboard
│
├── server/                      # Backend Node.js đọc/ghi Google Sheets
│   ├── jobs/
│   │   └── syncCustomerReport.js # Tác vụ đối soát toàn bộ 2 báo cáo lúc 07:00
│   └── sheets/
│       └── sheetsClient.js      # Đọc dữ liệu Google Sheets cho dashboard
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
│   │   ├── CustomerDebtReport.gs # Chặn ghi HN1/HN3/HN7 và gỡ trigger công nợ cũ
│   │   ├── CustomerReport.gs    # syncCustomerReport, setupCustomerReport,
│   │   │                        #   setupCustomerReportDailyTrigger
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
│   ├── utils/
│   │   └── Helpers.gs           # getCodeRowMap, formatLastRowNumbers, formatDate
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
2. Chạy `setupKiotVietAutoSync()` một lần. Hàm này tự tạo secret, trigger xử lý hàng đợi mỗi 1 phút, trigger polling mỗi 15 phút, gỡ trigger công nợ legacy và đăng ký đủ 9 webhook mà không xóa webhook của hệ thống khác.
3. Tab **Hàng bán theo khách** có đúng 5 cột `Khách hàng`, `Mã hàng`, `Tên hàng`, `SL mua chi tiết`, `Thời gian`; mỗi mặt hàng trong hóa đơn hoàn thành là một dòng và được webhook cập nhật trong khoảng 1 phút. Hai tab báo cáo vẫn được đối soát toàn bộ mỗi ngày sau 07:00. Có thể chạy `setupCustomerReport()` nếu muốn tạo ngay và có thêm trigger riêng. Tab **Báo cáo bán hàng** có đủ 18 cột như file xuất KiotViet.
4. Ba tab **HN1**, **HN3**, **HN7** do KiotViet quản lý. Apps Script không tạo, xóa, ghi dữ liệu, đổi header, bộ lọc, định dạng, kích thước hay bất kỳ thuộc tính cấu trúc nào của ba tab này.

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
| `syncAllInitialData()` | Làm mới 9 sheet vận hành theo schema gọn không có cột JSON và 2 sheet báo cáo do hệ thống quản lý; không chạm HN1/HN3/HN7 | Lần đầu hoặc khi cần full refresh |
| `removeJsonColumnsFromAllSheets()` | Xóa ngay các cột `(JSON)` cũ trên 9 sheet vận hành | Tùy chọn; trigger nền cũng tự chạy một lần sau khi deploy |
| `setupKiotVietAutoSync()` | Bật hoặc khôi phục webhook và trigger an toàn, không tạo trùng | 1 lần sau khi deploy |
| `syncPollingOnly_()` | Làm mới Trả hàng, Nhà cung cấp, Nhập hàng | Tự chạy bởi trigger 15 phút |
| `setupPollingTrigger()` | Bật lịch làm mới 3 sheet không có webhook | 1 lần duy nhất |
| `removePollingTrigger()` | Tắt lịch làm mới 15 phút | Khi bảo trì |
| `syncCustomerReport()` | Làm mới Báo cáo bán hàng 18 cột và chi tiết từng mặt hàng bán theo khách trong 90 ngày | Khi cần cập nhật/đối soát thủ công |
| `syncCustomerProductReport()` | Làm mới Hàng bán theo khách 5 cột (đồng thời làm mới báo cáo tháng) | Khi cần cập nhật thủ công |
| `setupCustomerReport()` | Tạo cả hai báo cáo ngay và bật thêm lịch riêng gần 07:00 | Tùy chọn |
| `setupCustomerReportDailyTrigger()` | Tạo lại lịch cập nhật hai báo cáo hàng ngày gần 07:00 | Khi cần khôi phục lịch |
| `removeCustomerDebtReportDailyTrigger()` | Gỡ trigger công nợ legacy mà không chạm HN1/HN3/HN7 | Sau khi nâng cấp nếu cần kiểm tra thủ công |
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
| [Implementation Plan](docs/04-planning/implementation_plan.md) | Kế hoạch triển khai chi tiết |
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
> của schema cũ một lần sau khi phiên bản mới được deploy. HN1/HN3/HN7 nằm ngoài
> phạm vi quản lý schema của Apps Script và luôn được giữ nguyên như KiotViet cung cấp.


---

*Cập nhật lần cuối: 2026-08-03*
