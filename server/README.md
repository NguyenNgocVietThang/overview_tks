# TOKOSI Dashboard — Node server

Express server that reads three independent Google Sheets sources for Dashboard (`SPREADSHEET_ID`), Shipment (`VC_SPREADSHEET_ID`) and HR (`HR_SPREADSHEET_ID`). KiotViet dashboard data is maintained by `../src-dashboard/`; shipment ingestion is maintained by `../src-order-lifecycle/`. The Express backend reads Sheets via the Sheets API, computes KPIs/charts, manages users/auth (JWT + bcrypt + Google Identity + OTP recovery + Local User Store), and powers the 9-state shipment delivery lifecycle system (`VC_*` sheets and Google Drive attachments).

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
# Điền SPREADSHEET_ID, VC_SPREADSHEET_ID, HR_SPREADSHEET_ID, DRIVE_UPLOAD_FOLDER_ID, GOOGLE_SERVICE_ACCOUNT_JSON, JWT_SECRET, GOOGLE_CLIENT_ID, TELEGRAM_BOT_TOKEN, TELEGRAM_HR_CHAT_ID
npm install
npm test      # Chạy 477 unit tests tự động (HR Leave & Telegram bot, auth/Guest/SĐT, Google OAuth, OTP reset, Admin CRUD, yêu cầu đổi vai trò, chuông thông báo, kiểm tra đứt hàng Excel-KiotViet, shipment lifecycle, State Machine 9 trạng thái, VC repository, cache, pagination, export, search, và 13 frontend test suites trong test/frontend/)
npm start     # Khởi chạy server tại http://localhost:3000 (tự động bật gzip compression và static Cache-Control headers)
```
Truy cập `http://localhost:3000` — giao diện Live Dashboard tải số liệu thời gian thực từ Google Sheets. `GET /health` trả về `{"status":"ok"}`.

### Hiệu năng & Tối ưu hóa Backend
- **Gzip Compression:** Tự động nén toàn bộ HTTP responses (HTML, CSS, JS, JSON API).
- **Static Assets Cache-Control:** Vendor libs (`max-age=86400`), Shared JS/CSS (`max-age=3600`), Images (`max-age=604800`).
- **Short-TTL Cache Vận đơn (`vcSheetsClient.js`):** Cache dữ liệu thô theo sheet 12s + Write-invalidation tự động (tránh rate-limit Google Sheets khi tài xế/điều phối viên poll 25-30s).
- **Batch Writing (`updateOrderItems`):** Gom các thao tác ghi dòng tuần tự thành 1 request `batchUpdate` duy nhất.
- **Request Timeout:** Timeout 15s (`VC_API_TIMEOUT_MS = 15000`) cho mọi kết nối Google Sheets API chống treo request.

### Quản lý tài khoản, Vận chuyển & Phân hệ Nhân sự (CLI Scripts)
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

# Khởi tạo 3 tab nhân sự HR_Leaves, HR_Employees, HR_Policy
node scripts/setupHrSheet.js init
```

## 2. Các API Endpoints

### 2.1. Xác thực & Hồ sơ cá nhân (`/api/auth/*`)
| Method | Endpoint | Quyền | Mô tả |
|---|---|---|---|
| `POST` | `/api/auth/register` | Public | Đăng ký tài khoản `Khách` bằng Email hoặc Số điện thoại, tự động cấp JWT cookie. |
| `POST` | `/api/auth/login` | Public | Đăng nhập nội bộ (username/password), cấp JWT cookie `tks_auth`. Khóa 5 phút nếu sai 5 lần. |
| `POST` | `/api/auth/google` | Public | Đăng nhập bằng Google ID Token; tài khoản mới nhận vai trò `Khách`. |
| `GET` | `/api/auth/google-config` | Public | Trả về `clientId` Google OAuth đã cấu hình. |
| `GET` | `/api/auth/me` | Logged in | Trả về thông tin người dùng đang đăng nhập từ JWT cookie. |
| `PUT` | `/api/auth/profile` | Logged in | Cập nhật họ tên, email hoặc số điện thoại khôi phục (cần xác nhận mật khẩu hiện tại). |
| `POST` | `/api/auth/change-password` | Logged in | Đổi mật khẩu chủ động (yêu cầu mật khẩu cũ). |
| `POST` | `/api/auth/request-reset-otp` | Public | Yêu cầu sinh mã OTP 6 số để khôi phục mật khẩu (hạn dùng 5 phút). |
| `POST` | `/api/auth/verify-reset-otp` | Public | Xác thực mã OTP 6 số và nhận `resetToken` tạm thời (10 phút). |
| `POST` | `/api/auth/reset-password-otp` | Public | Đặt mật khẩu mới bằng `resetToken` sau khi xác thực OTP thành công. |
| `POST` | `/api/auth/logout` | Logged in | Đăng xuất người dùng, xóa cookie `tks_auth`. |

### 2.2. Quản trị người dùng & Phân quyền Admin (`/api/admin/users/*`, `/api/role-requests/*`)
| Method | Endpoint | Quyền | Mô tả |
|---|---|---|---|
| `GET` | `/api/admin/users` | Quản lý | Danh sách tất cả tài khoản người dùng và trạng thái hoạt động. |
| `POST` | `/api/admin/users` | Quản lý | Tạo tài khoản người dùng mới trực tiếp với vai trò chỉ định. |
| `PATCH` | `/api/admin/users/:username` | Quản lý | Cập nhật họ tên, email, SĐT, vai trò hoặc trạng thái (Hoạt động/Khóa). |
| `POST` | `/api/admin/users/:username/reset-password` | Quản lý | Đặt lại mật khẩu mới cho một tài khoản cụ thể. |
| `DELETE` | `/api/admin/users/:username` | Quản lý | Khóa/vô hiệu hóa tài khoản người dùng khỏi hệ thống. |
| `POST` | `/api/role-requests` | Logged in | Gửi yêu cầu xin nâng cấp/thay đổi vai trò tài khoản kèm lý do. |
| `GET` | `/api/role-requests` | Quản lý | Xem danh sách tất cả yêu cầu đổi vai trò của người dùng. |
| `PATCH` | `/api/role-requests/:id/decision` | Quản lý | Duyệt hoặc từ chối yêu cầu đổi vai trò, tự động gửi thông báo. |

### 2.3. Cơ sở (`/api/branch`)
| Method | Endpoint | Quyền | Mô tả |
|---|---|---|---|
| `GET` | `/api/branch` | Logged in | Trả về cơ sở đang chọn (`current`) và danh sách cơ sở được phép (`allowed`). |
| `POST` | `/api/branch` | Logged in (chỉ `coSo = Cả hai`) | Đổi cơ sở đang xem, ghi cookie `tks_branch`. Trả `403 BRANCH_FORBIDDEN` nếu tài khoản không được phép truy cập cơ sở đó. |

### 2.4. Chuông thông báo toàn hệ thống (`/api/notifications/*`)
| Method | Endpoint | Quyền | Mô tả |
|---|---|---|---|
| `GET` | `/api/notifications` | Logged in | Lấy danh sách thông báo của tài khoản hiện tại và số lượng chưa đọc. |
| `PATCH` | `/api/notifications/:id/read` | Logged in | Đánh dấu một thông báo là đã đọc. |
| `POST` | `/api/notifications/read-all` | Logged in | Đánh dấu tất cả thông báo của tài khoản là đã đọc. |
| `DELETE` | `/api/notifications/:id` | Logged in | Xóa một thông báo cụ thể. |
| `DELETE` | `/api/notifications` | Logged in | Xóa tất cả thông báo của tài khoản hiện tại. |

### 2.5. Vận chuyển & Điều phối (`/api/shipment/*`)
| Method | Endpoint | Quyền | Mô tả |
|---|---|---|---|
| `POST` | `/api/shipment/invoice-status` | Logged in | Tra cứu chính xác tối đa 50 mã hóa đơn (cache 90s). Dành cho Khách và nội bộ. |
| `GET` | `/api/shipment/orders` | Nội bộ | Danh sách đơn vận chuyển, hỗ trợ lọc theo trạng thái, luồng, kho, lái xe, ngày. |
| `POST` | `/api/shipment/orders` | Nội bộ | Tạo đơn vận chuyển mới từ hóa đơn KiotViet hoặc thủ công. |
| `GET` | `/api/shipment/orders/:id` | Nội bộ | Chi tiết vận đơn, danh sách mặt hàng, lịch sử và ảnh chứng từ. |
| `POST` | `/api/shipment/orders/:id/transition` | Nội bộ | Chuyển trạng thái vận đơn theo State Machine (9 trạng thái). |
| `POST` | `/api/shipment/orders/:id/assign-driver` | Nội bộ | Gán tài xế và mã xe cho đơn vận chuyển. |
| `POST` | `/api/shipment/orders/:id/photos` | Nội bộ | Tải lên ảnh chứng từ lưu Google Drive và ghi nhận vào VC_Attachments. |
| `POST` | `/api/shipment/orders/:id/exception` | Nội bộ | Báo cáo sự cố phát sinh trong quá trình vận chuyển. |
| `GET` | `/api/shipment/audit` | Nội bộ | Báo cáo đối soát cuối ngày lọc đơn thiếu ảnh nhặt, thiếu bill ký hoặc giao trễ. |
| `GET` | `/api/shipment/vehicles` | Nội bộ | Danh mục phương tiện và tài xế từ tab VC_Vehicles. |

### 2.6. Quản lý Nghỉ phép HR (`/api/hr/*`)
| Method | Endpoint | Quyền | Mô tả |
|---|---|---|---|
| `GET` | `/api/hr/leave-requests` | Nội bộ | Danh sách đơn; `from`/`to` lọc theo `Thời gian gửi`. |
| `GET` | `/api/hr/leave-requests/stream` | Nội bộ | Stream Server-Sent Events (SSE) đồng bộ real-time khi trạng thái đổi hoặc có đơn mới. |
| `POST` | `/api/hr/leave-requests` | Quản lý | Ghi nhận nghỉ thủ công bằng ngày + buổi. |
| `GET` | `/api/hr/leave-requests/:id` | Nội bộ | Xem chi tiết một yêu cầu. |
| `PATCH` | `/api/hr/leave-requests/:id/status` | Quản lý | Cập nhật trạng thái và thông báo kết quả qua Telegram. |
| `POST` | `/api/hr/leave-requests/export` | Nội bộ | Xuất danh sách đang lọc/sắp xếp ra Excel. |
| `GET` | `/api/hr/leave-requests/summary/urgent-flags` | Nội bộ | Tổng hợp số lần nghỉ gấp theo tháng. |
| `POST` | `/api/hr/telegram/link-code` | Nội bộ | Tạo mã liên kết Telegram cho tài khoản hiện tại. |

Schema nghỉ phép dùng `Thời gian gửi`, `Thời gian bắt đầu/kết thúc` dạng `Sáng|Chiều dd/mm/yyyy`, `Tổng buổi nghỉ` và `Tổng ngày nghỉ quy đổi = số buổi / 2`. Đơn gửi sau 07:45 (Sáng) hoặc 12:30 (Chiều) vẫn được lưu với trạng thái `Vi phạm`.

### 2.7. Kiểm tra đứt hàng (`/api/products/stockout-check/*`)
| Method | Endpoint | Quyền | Mô tả |
|---|---|---|---|
| `POST` | `/api/products/stockout-check/validate` | Nội bộ | Đọc và kiểm tra tính hợp lệ của file Excel danh sách sản phẩm tải lên. |
| `POST` | `/api/products/stockout-check/start` | Nội bộ | Khởi chạy tác vụ phân tích đứt hàng đối chiếu dữ liệu KiotViet API nền. |
| `GET` | `/api/products/stockout-check/status/:jobId` | Nội bộ | Kiểm tra tiến độ phân tích đứt hàng theo jobId. |
| `GET` | `/api/products/stockout-check/result/:jobId` | Nội bộ | Lấy kết quả phân tích đứt hàng và dòng thời gian biến động tồn kho. |
| `POST` | `/api/products/stockout-check/export/:jobId` | Nội bộ | Xuất báo cáo kết quả kiểm tra đứt hàng ra file Excel. |
| `POST` | `/api/products/stockout-check/cancel/:jobId` | Nội bộ | Hủy tác vụ kiểm tra đứt hàng đang chạy. |

### 2.8. Dashboard, Tìm kiếm & Tiện ích
| Method | Endpoint | Quyền | Mô tả |
|---|---|---|---|
| `GET` | `/api/dashboard?days={7\|30\|90}` | Nội bộ | Trả về toàn bộ KPI, biểu đồ, danh sách top/gần đây kèm Result Cache. |
| `GET` | `/api/search` | Nội bộ | Tìm kiếm bản ghi trong tab hiện tại hoặc tìm chính xác nhiều mã (`mode=codes`). |
| `GET` | `/api/customer-product-top` | Nội bộ | Tìm top 3 khách hàng mua nhiều nhất cho danh sách tối đa 50 mã sản phẩm. |
| `GET` | `/api/customer-product-revenue?code=&name=` | Nội bộ | Báo cáo doanh thu của một khách hàng theo từng sản phẩm/mã đã mua. |
| `POST` | `/api/export/fields` | Nội bộ | Trả về danh sách worksheet và các trường dữ liệu có thể chọn xuất Excel. |
| `POST` | `/api/export` | Nội bộ | Tạo và tải file `.xlsx` theo các trường đã chọn và bộ lọc hiện tại. |
| `GET` | `/health` | Public | Health check endpoint cho Render ping (`{"status":"ok"}`). |
| `GET` | `/api/debug` | Nội bộ | Chẩn đoán biến môi trường, kết nối Google Sheets và danh sách tab. |

## 3. Deploying on Firebase App Hosting

Firebase App Hosting chạy Express server trên Cloud Run và yêu cầu Firebase project ở gói Blaze.
Cấu hình deploy nằm tại `../firebase.json`, `.firebaserc` và `apphosting.yaml`.

```bash
# Chạy từ thư mục gốc repository sau khi project đã bật Blaze
firebase deploy --only apphosting:tokosi-dashboard
```

Các giá trị nhạy cảm trong `.env` phải được tạo trong Firebase Secret Manager theo
các tên được tham chiếu bởi `apphosting.yaml`; tuyệt đối không commit `.env`.
`maxInstances: 1` được giữ để các cache/job chạy trong bộ nhớ không bị chia giữa
nhiều instance. Telegram bot mặc định tắt trên App Hosting để tránh nhiều tiến
trình polling cùng một bot token.

## 4. Deploying on Render — exact values for the "New Web Service" form

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
- `HR_SPREADSHEET_ID` — Google Spreadsheet ID (Nhân sự HR_*)
- `DRIVE_UPLOAD_FOLDER_ID` — Google Drive Folder ID (Lưu ảnh chứng từ)
- `GOOGLE_SERVICE_ACCOUNT_JSON` — The full service account JSON key (one line)
- `JWT_SECRET` — Secret key để ký và xác thực token JWT
- `GOOGLE_CLIENT_ID` — Google OAuth Client ID cho tính năng Google Sign-In (tùy chọn)
- `TELEGRAM_BOT_TOKEN` — Telegram Bot Token cho bot thông báo & tương tác HR
- `TELEGRAM_HR_CHAT_ID` — Telegram Chat ID nhóm Quản lý/HR nhận thông báo đơn xin nghỉ
- `KIOTVIET_CLIENT_ID` — KiotViet Public API client ID (cho job sync báo cáo)
- `KIOTVIET_CLIENT_SECRET` — KiotViet Public API client secret (cho job sync báo cáo)
- `KIOTVIET_RETAILER` — KiotViet retailer name (cho job sync báo cáo)
