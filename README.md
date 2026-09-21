# TOKOSI Dashboard

Dashboard nội bộ cho hai cơ sở Hà Nội và Sài Gòn.

## Kiến trúc hiện tại

- **Supabase PostgreSQL** là nguồn dữ liệu KiotViet chính cho dashboard: hàng hóa, hóa đơn, đặt hàng, trả hàng, khách hàng, nhà cung cấp, nhập hàng và các bảng tổng hợp.
- Engine `server/kiotvietSync/` đồng bộ KiotViet API vào Supabase bằng webhook/polling phía Node.js.
- Hai Google Sheets Kiot HN/SG chỉ còn tab **`Trả NCC`**. Đây là dữ liệu nhập thủ công; server chỉ đọc tab này bằng Google Sheets API.
- CN1/CN3/CN7 (công nợ 1/3/7 ngày, trước đây gọi là HN1/HN3/HN7) được tính từ Supabase và lưu trong `customer_debt_activity_periods`.
- Tài khoản ứng dụng và Telegram ID được lưu trong PostgreSQL `app_users`; không còn tab `Users` hay luồng liên kết Telegram qua Google Sheets.
- Apps Script Kiot HN/SG và module vận chuyển cũ đã được nghỉ hưu hoàn toàn; tính năng tra cứu vòng đời đơn hàng tiếp tục được duy trì qua Google Sheets (`ORDER_LIFECYCLE_SPREADSHEET_ID`).
- Nguồn nhân sự vẫn sử dụng workbook HR riêng khi được cấu hình.

## Chạy local

```bash
cd server
npm install
copy .env.example .env
npm run db:migrate
npm test
npm run dev
```

Mở `http://localhost:3000`.

## Biến môi trường chính

| Biến | Mục đích |
|---|---|
| `SUPABASE_DB_URL` | PostgreSQL dùng cho dữ liệu KiotViet, tài khoản và workflow |
| `KIOTVIET_CLIENT_ID`, `KIOTVIET_CLIENT_SECRET`, `KIOTVIET_RETAILER` | KiotViet Hà Nội |
| `KIOTVIET_CLIENT_ID_SG`, `KIOTVIET_CLIENT_SECRET_SG`, `KIOTVIET_RETAILER_SG` | KiotViet Sài Gòn |
| `SPREADSHEET_ID`, `SPREADSHEET_ID_SG` | Hai file Sheets chỉ chứa tab `Trả NCC` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Quyền Viewer để đọc `Trả NCC` và quản lý vòng đời đơn hàng / HR |
| `DEBT_MANAGEMENT_SPREADSHEET_ID` | Workbook công nợ dùng chung |
| `ORDER_LIFECYCLE_SPREADSHEET_ID` | Workbook tra cứu vòng đời đơn hàng (`DonHang_HN`, `DonHang_SG`, `Lịch sử cập nhật`) |
| `HR_SPREADSHEET_ID`, `HR_SPREADSHEET_ID_SG` | Workbook nhân sự |
| `JWT_SECRET` | Ký phiên đăng nhập |

Xem [server/.env.example](server/.env.example) để biết đầy đủ cấu hình.

## Cấu trúc chính

```text
server/
├── auth/                 # Tài khoản và phân quyền PostgreSQL
├── branch/               # Phân tách Hà Nội / Sài Gòn
├── dashboard/            # Tổng hợp dashboard và đọc Trả NCC
├── db/                   # Migration Supabase
├── hr/                   # Nhân sự và nghỉ phép
├── kiotviet/             # KiotViet API client
├── kiotvietSync/         # Webhook, polling, backfill và rollup
├── public/               # Frontend
├── sheets/               # Google Sheets client
├── shipment/             # Tra cứu vòng đời đơn hàng
├── index.js
└── routes.js
```

## Dữ liệu công nợ CN1/CN3/CN7

Migration `0014_customer_debt_activity_periods.sql` tạo bảng tổng hợp ba kỳ 1/3/7 ngày (CN1/CN3/CN7, trước đây gọi là HN1/HN3/HN7). Scheduler gọi `customerDebtReportRefresh.js`; dashboard đọc bảng này qua `customerDebtActivityRepository.js`, không đọc Google Sheets.

Migration `0015_app_users_telegram_id.sql` thêm `app_users.telegram_id` để bot có thể liên kết trực tiếp qua Supabase Postgres. Giao diện/API tạo mã liên kết cũ không còn đọc hoặc ghi tab `_HR_TELEGRAM_LINKS`.

## Cập nhật gần nhất

2026-09-21 — nâng cấp xuất Excel tùy chọn trường dữ liệu, chuyển phần hàng nhập sang tab Nhà cung cấp, giao dịch sang tab Hóa đơn và đồng bộ bộ lọc thời gian.
