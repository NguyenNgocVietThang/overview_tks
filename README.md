# TOKOSI Dashboard

Dashboard nội bộ cho hai cơ sở Hà Nội và Sài Gòn.

## Kiến trúc hiện tại

- **Supabase PostgreSQL** là nguồn dữ liệu KiotViet chính cho dashboard: hàng hóa, hóa đơn, đặt hàng, trả hàng, khách hàng, nhà cung cấp, nhập hàng và các bảng tổng hợp.
- Engine `server/kiotvietSync/` đồng bộ KiotViet API vào Supabase bằng webhook/polling phía Node.js.
- Dữ liệu **Trả NCC** không còn đọc từ Google Sheets: người dùng tự upload file Excel xuất trực tiếp từ KiotViet, server nạp vào Postgres `supplier_return_imports` (thay thế toàn bộ theo cơ sở mỗi lần import) và dùng chung pipeline với Hóa đơn/Nhập hàng/Khách trả cho tính năng kiểm tra đứt hàng.
- CN1/CN3/CN7 (công nợ 1/3/7 ngày) được tính từ Supabase và lưu trong `customer_debt_activity_periods`.
- Tài khoản ứng dụng và Telegram ID được lưu trong PostgreSQL `app_users`; không còn tab `Users` hay luồng liên kết Telegram qua Google Sheets.
- Apps Script Kiot HN/SG và module vận chuyển cũ đã được nghỉ hưu hoàn toàn; tính năng tra cứu vòng đời đơn hàng tiếp tục được duy trì qua Google Sheets (`ORDER_LIFECYCLE_SPREADSHEET_ID`).
- Nguồn nhân sự vẫn sử dụng workbook HR riêng khi được cấu hình.
- Tài khoản được phép cả hai cơ sở có thể chọn phạm vi **`Cả hai`** trên thanh điều hướng: báo cáo cộng dồn hai cơ sở, thực thể trùng mã gộp theo mã, giao dịch riêng lẻ giữ `(cơ sở, mã)` kèm nhãn cơ sở. `Cả hai` chỉ là phạm vi xem — cột `branch` trong database vẫn chỉ nhận `hanoi`/`saigon` (xem `server/branch/branches.js`).

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
| `SPREADSHEET_ID`, `SPREADSHEET_ID_SG` | Bắt buộc bởi cấu hình hiện tại, không còn phục vụ `Trả NCC` (đã chuyển sang import Excel) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Quyền Viewer để quản lý vòng đời đơn hàng / HR |
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

Migration `0014_customer_debt_activity_periods.sql` tạo bảng tổng hợp ba kỳ 1/3/7 ngày (CN1/CN3/CN7). Scheduler gọi `customerDebtReportRefresh.js`; dashboard đọc bảng này qua `customerDebtActivityRepository.js`, không đọc Google Sheets.

Migration `0015_app_users_telegram_id.sql` thêm `app_users.telegram_id` để bot có thể liên kết trực tiếp qua Supabase Postgres. Giao diện/API tạo mã liên kết cũ không còn đọc hoặc ghi tab `_HR_TELEGRAM_LINKS`.

## Cập nhật gần nhất

2026-09-22 — chuyển nguồn dữ liệu Trả NCC (kiểm tra đứt hàng) từ tab Google Sheets đọc tay sang người dùng tự upload file Excel xuất trực tiếp từ KiotViet; thêm bảng Postgres `supplier_return_imports` (thay thế toàn bộ theo cơ sở mỗi lần import), gộp vào cùng pipeline Postgres với Hóa đơn/Nhập hàng/Khách trả, loại bỏ hoàn toàn nhánh đọc Sheets riêng cho Trả NCC.

2026-09-21 — bổ sung phạm vi dữ liệu `Cả hai` cho tài khoản phụ trách hai cơ sở (báo cáo, tìm kiếm, xuất Excel, Nhân sự, đứt hàng; ghi trạng thái công nợ cho cả hai cơ sở trong một transaction); bổ sung bộ lọc Cơ sở và Phòng ban cho phân hệ Nhân sự & Nghỉ phép, hỗ trợ xuất Excel theo phạm vi lọc; nâng cấp xuất Excel tùy chọn trường và cấu trúc lại tab báo cáo.
