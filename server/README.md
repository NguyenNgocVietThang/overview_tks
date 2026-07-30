# TOKOSI Dashboard — Node server

Express server that reads a Google Sheet and serves the live TOKOSI
dashboard. The Sheet itself (9 tabs: Nhóm hàng, Hàng hóa, Hóa đơn, Chi tiết
hóa đơn, Đặt hàng, Trả hàng, Khách hàng, Nhà cung cấp, Nhập hàng) is synced
from KiotViet **independently**, by the Google Apps Script project in
`../appsscript/KiotVietExport.gs`, which runs inside that Sheet (webhook +
30-minute polling triggers). This server does not talk to the KiotViet API
at all — it only reads the Sheet via the Sheets API and computes the
dashboard's KPIs/charts.

## 1. One-time setup

### Google service account (so this server can read the Sheet)
1. In Google Cloud Console, create a project (or reuse one), enable the
   **Google Sheets API**.
2. Create a **Service Account**, then create a JSON key for it and download it.
3. Open the target Google Sheet (the one `KiotVietExport.gs` is bound to) →
   Share → invite the service account's `...@...iam.gserviceaccount.com`
   email as **Viewer** (read-only is enough; this server never writes).
4. Copy the spreadsheet ID from its URL:
   `https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit`.

### Real-time sync from KiotViet into the Sheet
This is configured from inside the Google Sheet itself, not from this
server. In the Sheet: Extensions → Apps Script → paste
`../appsscript/KiotVietExport.gs` → reload the Sheet → use the **KiotViet**
menu:
- **"Bật cập nhật real-time (đăng ký Webhook)"** — deploy the Apps Script as
  a Web App first (Deploy → New deployment → Web app, Execute as: Me, Who
  has access: Anyone), then paste the deployment URL here.
- **"Bật lịch tự động 30 phút"** — for the tables KiotViet has no webhook for
  (Trả hàng, Nhà cung cấp, Nhập hàng, Nhóm hàng).

If "Hóa đơn" / "Chi tiết hóa đơn" / "Đặt hàng" / "Trả hàng" are empty, run
**"Bán hàng (Hóa đơn, Đặt hàng, Trả hàng)"** from the same menu once to
backfill them.

### Local `.env`
```bash
cp .env.example .env
# fill in SPREADSHEET_ID, GOOGLE_SERVICE_ACCOUNT_JSON and KIOTVIET_* variables
npm install
npm start
```
Visit `http://localhost:3000` — it should show the dashboard with real data
from the Sheet. `GET /health` should return `{"status":"ok"}`. The page
auto-refreshes every 5 minutes, plus a manual "Làm mới" button.

## 2. Deploying on Render — exact values for the "New Web Service" form

| Field | Value |
|---|---|
| Language | Node |
| Branch | `main` |
| Root Directory | `server` |
| Build Command | `npm install` |
| Start Command | `npm start` |

**Environment variables** (Render dashboard → your service → Environment):
- `SPREADSHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_JSON` — the full service account JSON key, one line
- `KIOTVIET_CLIENT_ID` — KiotViet Public API client ID
- `KIOTVIET_CLIENT_SECRET` — KiotViet Public API client secret
- `KIOTVIET_RETAILER` — KiotViet retailer name

`PORT` is set automatically by Render — don't set it yourself.
