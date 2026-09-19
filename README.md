# TOKOSI Dashboard

Dashboard nội bộ cho hai cơ sở Hà Nội và Sài Gòn.

## Kiến trúc hiện tại

- **Supabase PostgreSQL** là nguồn dữ liệu KiotViet chính cho dashboard: hàng hóa, hóa đơn, đặt hàng, trả hàng, khách hàng, nhà cung cấp, nhập hàng và các bảng tổng hợp.
- Engine `server/kiotvietSync/` đồng bộ KiotViet API vào Supabase bằng webhook/polling phía Node.js.
- Hai Google Sheets Kiot HN/SG chỉ còn tab **`Trả NCC`**. Đây là dữ liệu nhập thủ công; server chỉ đọc tab này bằng Google Sheets API.
- HN1/HN3/HN7 được tính từ Supabase và lưu trong `customer_debt_activity_periods`.
- Tài khoản ứng dụng được lưu trong PostgreSQL; không còn tab `Users`.
- Apps Script Kiot HN/SG và module vận chuyển đã được nghỉ hưu hoàn toàn.
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
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Quyền Viewer để đọc `Trả NCC` |
| `DEBT_MANAGEMENT_SPREADSHEET_ID` | Workbook công nợ dùng chung |
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
├── index.js
└── routes.js
```

## Dữ liệu công nợ HN1/HN3/HN7

Migration `0014_customer_debt_activity_periods.sql` tạo bảng tổng hợp ba kỳ 1/3/7 ngày. Scheduler gọi `customerDebtReportRefresh.js`; dashboard đọc bảng này qua `customerDebtActivityRepository.js`, không đọc Google Sheets.

## Cập nhật gần nhất

2026-09-19 — chuyển dữ liệu KiotViet sang Supabase, chỉ giữ `Trả NCC` trên Sheets, xóa Apps Script và module vận chuyển.
