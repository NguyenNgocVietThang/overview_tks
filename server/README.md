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

### Local `.env`
```bash
cp .env.example .env
# fill in SPREADSHEET_ID, GOOGLE_SERVICE_ACCOUNT_JSON and KIOTVIET_* variables
npm install
npm start
```
Visit `http://localhost:3000` — it should show the dashboard with real data
from the Sheet. `GET /health` should return `{"status":"ok"}`. The page
auto-refreshes every 10 minutes, plus a manual "Làm mới" button.

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
