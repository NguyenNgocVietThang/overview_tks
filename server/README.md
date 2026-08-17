# TOKOSI Dashboard — Node server

Express server that reads a Google Sheet and serves the live TOKOSI
dashboard. The Sheet itself (9 tabs: Nhóm hàng, Hàng hóa, Hóa đơn, Chi tiết
hóa đơn, Đặt hàng, Trả hàng, Khách hàng, Nhà cung cấp, Nhập hàng) is synced
from KiotViet **independently**, by the modular Google Apps Script project in
`../src/`, which runs inside that Sheet (webhook + 5-minute polling trigger).
The Express dashboard path only reads the Sheet via the Sheets API and computes
KPIs/charts. The optional `npm run sync:customer-report` job is the exception:
it reads KiotViet directly and rewrites the two report tabs, including all 18
columns of `Báo cáo bán hàng` and the five-column, per-product-line
`Hàng bán theo khách` report. Apps Script invoice webhooks keep the latter
updated within the one-minute queue cycle.

## 1. One-time setup

### Google service account (so this server can read the Sheet)
1. In Google Cloud Console, create a project (or reuse one), enable the
   **Google Sheets API**.
2. Create a **Service Account**, then create a JSON key for it and download it.
3. Open the target Google Sheet (the one the Apps Script project is bound to) →
   Share → invite the service account's `...@...iam.gserviceaccount.com`
   email as **Viewer** for the dashboard, or **Editor** if you will run
   `npm run sync:customer-report` to rewrite the report tabs.
4. Copy the spreadsheet ID from its URL:
   `https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit`.

### Real-time sync from KiotViet into the Sheet
This is configured in the bound Google Apps Script project:

1. From the repository root, run `clasp push --force`.
2. Run `syncAllInitialData()` once to backfill all 9 operational sheets.
3. Deploy/update the Apps Script Web App.
4. Run `setupWebhookSecret()`, register the 9 webhook event types with
   `registerWebhookWithCorrectUrl()`, and run `setupQueueProcessingTrigger()`.
5. Run `setupPollingTrigger()` for Trả hàng, Nhà cung cấp, and Nhập hàng,
   because KiotViet does not publish webhook events for those three groups.

### Local `.env` & Testing
```bash
cp .env.example .env
# Điền SPREADSHEET_ID, GOOGLE_SERVICE_ACCOUNT_JSON, JWT_SECRET, GOOGLE_CLIENT_ID và các biến KIOTVIET_*
npm install
npm test      # Chạy 74 unit tests (auth/Guest, Google OAuth, shipment, cache, pagination, export, search)
npm start     # Khởi chạy server tại http://localhost:3000
```
Truy cập `http://localhost:3000` — giao diện Live Dashboard tải số liệu thời gian thực từ Google Sheets. `GET /health` trả về `{"status":"ok"}`. Giao diện tự động làm mới sau mỗi 10 phút hoặc bấm nút "Làm mới".

### Quản lý tài khoản người dùng (CLI Script)
Để khởi tạo tab `Users` và quản trị người dùng nội bộ trong Google Spreadsheet:
```bash
# Khởi tạo tab Users và tạo tài khoản Admin mặc định
node scripts/setupUsersSheet.js init

# Tạo tài khoản mới (vai trò: Quản lý | Kế toán | Trưởng kho | Trợ lý | Khách)
node scripts/setupUsersSheet.js add <username> <password> <vaiTro> [hoTen] [email]

# Đổi mật khẩu tài khoản
node scripts/setupUsersSheet.js passwd <username> <new_password>

# Liệt kê tất cả tài khoản
node scripts/setupUsersSheet.js list
```

## 2. Các API Endpoints

| Method | Endpoint | Mô tả |
|---|---|---|
| `POST` | `/api/auth/register` | Đăng ký email/mật khẩu, tạo tài khoản `Khách` và tự động đăng nhập (cấp cookie JWT). |
| `POST` | `/api/auth/login` | Đăng nhập nội bộ bằng username/password, cấp JWT qua httpOnly cookie `tks_auth`. |
| `POST` | `/api/auth/google` | Đăng nhập bằng Google ID Token; email mới nhận vai trò `Khách`, tài khoản nội bộ giữ quyền hiện có. |
| `GET` | `/api/auth/google-config` | Trả về `clientId` Google OAuth đã cấu hình để frontend hiển thị nút Google Sign-In. |
| `GET` | `/api/auth/me` | Trả về thông tin người dùng đang đăng nhập từ JWT cookie. |
| `POST` | `/api/auth/logout` | Đăng xuất người dùng, xóa cookie `tks_auth`. |
| `POST` | `/api/shipment/invoice-status` | Tra cứu chính xác tối đa 50 mã hóa đơn, chỉ trả mã và trạng thái (cache 90s). Dành cho Khách và nội bộ. |
| `GET` | `/api/dashboard?days={7\|30\|90}` | Trả về toàn bộ KPI, biểu đồ, danh sách top/gần đây. Tích hợp cache thô Sheets 90s và Result Cache theo `(rawDataVersion, filters)` giúp chuyển tab và lọc thời gian phản hồi tức thì (<10ms). |
| `GET` | `/api/search` | Tìm kiếm bản ghi trong phạm vi tab hiện tại. Hỗ trợ tìm từ khóa thông thường hoặc tìm chính xác nhiều mã cùng lúc (`mode=codes`, tối đa 50 mã). |
| `GET` | `/api/customer-product-top` | Tìm top 3 khách hàng mua nhiều nhất cho danh sách tối đa 50 mã sản phẩm từ sheet `Khách theo hàng hóa`, áp dụng bộ lọc thời gian. |
| `POST` | `/api/export/fields` | Trả về danh sách worksheet và các trường dữ liệu có thể chọn xuất cho bảng hoặc kết quả tìm kiếm tương ứng. |
| `POST` | `/api/export` | Tạo và tải file `.xlsx` theo các trường đã chọn, giữ bộ lọc hiện tại, hỗ trợ định dạng ngày, text mã/SĐT, cố định tiêu đề và AutoFilter. |
| `GET` | `/health` | Health check endpoint cho Render ping giữ instance hoạt động (`{"status":"ok"}`). |
| `GET` | `/api/debug` | Chẩn đoán biến môi trường, kết nối Google Sheets và liệt kê các tab hiện có. |

Các API dashboard, search, export và debug chỉ cho bốn vai trò nội bộ (`Quản lý`, `Kế toán`, `Trưởng kho`, `Trợ lý`). Vai trò `Khách` chỉ truy cập trang/API Quản lý vận chuyển (`/shipment/` và `/api/shipment/invoice-status`).

### Cải tiến hiệu năng & UX
- **Result Cache:** Tách hàm tính toán thuần túy `computeDashboardData()` và cache kết quả theo `(rawDataVersion, filters)`. Index tìm kiếm chỉ được build lại khi Sheets được fetch mới.
- **Phân trang bảng client-side (`pagination.js`):** Tối ưu 2 bảng lớn (`allProducts` và `lowStock`) hiển thị ~200 dòng/trang kèm nút phân trang Trước/Sau, khắc phục hoàn toàn tình trạng đơ giao diện khi chuyển tab Hàng hóa.
- **Xuất Excel (16 bảng):** Mỗi bảng có nút Xuất Excel riêng; xuất nhiều worksheet cho Nhập hàng / Công nợ và kết quả tìm kiếm đa nguồn.
- **Bảo mật & Phân quyền (Auth):** Cookie JWT `httpOnly`, mật khẩu băm bcrypt 10 rounds, xác minh Google ID token trực tiếp qua API Google.

## 3. Deploying on Render — exact values for the "New Web Service" form

| Field | Value |
|---|---|
| Language | Node |
| Branch | `main` |
| Root Directory | `server` |
| Build Command | `npm install` |
| Start Command | `npm start` |

**Environment variables** (Render dashboard → your service → Environment):
- `SPREADSHEET_ID` — Google Spreadsheet ID
- `GOOGLE_SERVICE_ACCOUNT_JSON` — The full service account JSON key (one line)
- `JWT_SECRET` — Secret key để ký và xác thực token JWT
- `GOOGLE_CLIENT_ID` — Google OAuth Client ID cho tính năng Google Sign-In (tùy chọn)
- `KIOTVIET_CLIENT_ID` — KiotViet Public API client ID (cho job sync báo cáo)
- `KIOTVIET_CLIENT_SECRET` — KiotViet Public API client secret (cho job sync báo cáo)
- `KIOTVIET_RETAILER` — KiotViet retailer name (cho job sync báo cáo)

`PORT` is set automatically by Render — don't set it yourself.
