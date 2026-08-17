# TOKOSI Dashboard — Node server

Express server that reads Google Sheets and serves the live TOKOSI dashboard and shipment management system. The operational Sheets (Nhóm hàng, Hàng hóa, Hóa đơn, Chi tiết hóa đơn, Đặt hàng, Trả hàng, Khách hàng, Nhà cung cấp, Nhập hàng) are synced from KiotViet independently by the modular Google Apps Script project in `../src/`. The Express backend reads Sheets via the Sheets API, computes KPIs/charts, manages users/auth (JWT + bcrypt + Google Identity), and powers the 8-state shipment delivery lifecycle system (`VC_*` sheets and Google Drive attachments).

## 1. One-time setup

### Google service account (so this server can read/write Sheets and Drive)
1. In Google Cloud Console, create a project (or reuse one), enable the **Google Sheets API** and **Google Drive API**.
2. Create a **Service Account**, then create a JSON key for it and download it.
3. Open the target Google Sheets (both the dashboard sheet and the VC shipment sheet) -> Share -> invite the service account's `...@...iam.gserviceaccount.com` email as **Editor**.
4. Copy the spreadsheet IDs from their URLs.

### Real-time sync from KiotViet into the Sheet
This is configured in the bound Google Apps Script project:

1. From the repository root, run `clasp push --force`.
2. Run `syncAllInitialData()` once to backfill all 9 operational sheets.
3. Deploy/update the Apps Script Web App.
4. Run `setupWebhookSecret()`, register the 9 webhook event types with `registerWebhookWithCorrectUrl()`, and run `setupQueueProcessingTrigger()`.
5. Run `setupPollingTrigger()` for Trả hàng, Nhà cung cấp, and Nhập hàng.

### Local `.env` & Testing
```bash
cp .env.example .env
# Điền SPREADSHEET_ID, VC_SPREADSHEET_ID, DRIVE_UPLOAD_FOLDER_ID, GOOGLE_SERVICE_ACCOUNT_JSON, JWT_SECRET, GOOGLE_CLIENT_ID
npm install
npm test      # Chạy bộ unit tests (auth/Guest, Google OAuth, shipment lifecycle, State Machine, VC repository, cache, pagination, export, search)
npm start     # Khởi chạy server tại http://localhost:3000
```
Truy cập `http://localhost:3000` — giao diện Live Dashboard tải số liệu thời gian thực từ Google Sheets. `GET /health` trả về `{"status":"ok"}`.

### Quản lý tài khoản người dùng & Khởi tạo Vận chuyển (CLI Scripts)
```bash
# Khởi tạo tab Users và tạo tài khoản Admin mặc định
node scripts/setupUsersSheet.js init

# Tạo tài khoản mới (vai trò: Quản lý | Kế toán | Trưởng kho | Trợ lý | Khách)
node scripts/setupUsersSheet.js add <username> <password> <vaiTro> [hoTen] [email]

# Đổi mật khẩu tài khoản
node scripts/setupUsersSheet.js passwd <username> <new_password>

# Liệt kê tất cả tài khoản
node scripts/setupUsersSheet.js list

# Khởi tạo 6 tab vận chuyển VC_* trên Google Spreadsheet vận chuyển
node scripts/setupVcSheet.js
```

## 2. Các API Endpoints

| Method | Endpoint | Mô tả |
|---|---|---|
| `POST` | `/api/auth/register` | Đăng ký email/mật khẩu, tạo tài khoản `Khách` và tự động cấp cookie JWT. |
| `POST` | `/api/auth/login` | Đăng nhập nội bộ bằng username/password, cấp JWT qua httpOnly cookie `tks_auth`. |
| `POST` | `/api/auth/google` | Đăng nhập bằng Google ID Token; tài khoản mới nhận vai trò `Khách`. |
| `GET` | `/api/auth/google-config` | Trả về `clientId` Google OAuth đã cấu hình. |
| `GET` | `/api/auth/me` | Trả về thông tin người dùng đang đăng nhập từ JWT cookie. |
| `POST` | `/api/auth/logout` | Đăng xuất người dùng, xóa cookie `tks_auth`. |
| `POST` | `/api/shipment/invoice-status` | Tra cứu chính xác tối đa 50 mã hóa đơn (cache 90s). Dành cho Khách và nội bộ. |
| `GET` | `/api/shipment/orders` | Danh sách đơn vận chuyển, hỗ trợ lọc theo trạng thái, luồng, kho, lái xe, ngày. |
| `POST` | `/api/shipment/orders` | Tạo đơn vận chuyển mới từ hóa đơn KiotViet hoặc thủ công. |
| `GET` | `/api/shipment/orders/:id` | Chi tiết vận đơn, danh sách mặt hàng, lịch sử và ảnh chứng từ. |
| `POST` | `/api/shipment/orders/:id/transition` | Chuyển trạng thái vận đơn theo State Machine (8 trạng thái). |
| `POST` | `/api/shipment/orders/:id/assign-driver` | Gán tài xế và mã xe cho đơn vận chuyển. |
| `POST` | `/api/shipment/orders/:id/photos` | Tải lên ảnh chứng từ lưu Google Drive và ghi nhận vào VC_Attachments. |
| `POST` | `/api/shipment/orders/:id/exception` | Báo cáo sự cố phát sinh trong quá trình vận chuyển. |
| `GET` | `/api/shipment/audit` | Báo cáo đối soát cuối ngày lọc đơn thiếu ảnh nhặt, thiếu bill ký hoặc giao trễ. |
| `GET` | `/api/shipment/vehicles` | Danh mục phương tiện và tài xế từ tab VC_Vehicles. |
| `GET` | `/api/dashboard?days={7\|30\|90}` | Trả về toàn bộ KPI, biểu đồ, danh sách top/gần đây kèm Result Cache. |
| `GET` | `/api/search` | Tìm kiếm bản ghi trong tab hiện tại hoặc tìm chính xác nhiều mã (`mode=codes`). |
| `GET` | `/api/customer-product-top` | Tìm top 3 khách hàng mua nhiều nhất cho danh sách tối đa 50 mã sản phẩm. |
| `POST` | `/api/export/fields` | Trả về danh sách worksheet và các trường dữ liệu có thể chọn xuất Excel. |
| `POST` | `/api/export` | Tạo và tải file `.xlsx` theo các trường đã chọn và bộ lọc hiện tại. |
| `GET` | `/health` | Health check endpoint cho Render ping (`{"status":"ok"}`). |
| `GET` | `/api/debug` | Chẩn đoán biến môi trường, kết nối Google Sheets và danh sách tab. |

## 3. Deploying on Render — exact values for the "New Web Service" form

| Field | Value |
|---|---|
| Language | Node |
| Branch | `main` |
| Root Directory | `server` |
| Build Command | `npm install` |
| Start Command | `npm start` |

**Environment variables** (Render dashboard -> your service -> Environment):
- `SPREADSHEET_ID` — Google Spreadsheet ID (Dashboard)
- `VC_SPREADSHEET_ID` — Google Spreadsheet ID (Vận chuyển VC_*)
- `DRIVE_UPLOAD_FOLDER_ID` — Google Drive Folder ID (Lưu ảnh chứng từ)
- `GOOGLE_SERVICE_ACCOUNT_JSON` — The full service account JSON key (one line)
- `JWT_SECRET` — Secret key để ký và xác thực token JWT
- `GOOGLE_CLIENT_ID` — Google OAuth Client ID cho tính năng Google Sign-In (tùy chọn)
- `KIOTVIET_CLIENT_ID` — KiotViet Public API client ID (cho job sync báo cáo)
- `KIOTVIET_CLIENT_SECRET` — KiotViet Public API client secret (cho job sync báo cáo)
- `KIOTVIET_RETAILER` — KiotViet retailer name (cho job sync báo cáo)
