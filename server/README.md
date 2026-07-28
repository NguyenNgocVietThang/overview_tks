# TOKOSI Dashboard — Node server

Express server that replaces the Google Apps Script backend (`../src/*.gs`)
for deploying the live dashboard on Render. It reads/writes the **same**
Google Sheet the Apps Script project uses, via the Sheets API instead of
`SpreadsheetApp`. The `.gs` files are untouched and can keep running
independently if you still need them.

## 1. One-time setup

### Google service account (so this server can read/write the Sheet)
1. In Google Cloud Console, create a project (or reuse one), enable the
   **Google Sheets API**.
2. Create a **Service Account**, then create a JSON key for it and download it.
3. Open the target Google Sheet → Share → invite the service account's
   `...@...iam.gserviceaccount.com` email as **Editor**.
4. Copy the spreadsheet ID from its URL:
   `https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit`.

### KiotViet credentials
Reuse the `CLIENT_ID` / `CLIENT_SECRET` / `RETAILER` already used in
`../src/config/Config.gs`.

> **Security note:** that file currently has the secret committed in
> plaintext in this repo's git history. Since we're now moving secrets to
> environment variables, it's worth rotating/regenerating the KiotViet API
> credentials in the KiotViet admin panel so the already-exposed one stops
> being valid.

### Local `.env`
```bash
cp .env.example .env
# fill in CLIENT_ID, CLIENT_SECRET, RETAILER, SPREADSHEET_ID,
# GOOGLE_SERVICE_ACCOUNT_JSON (paste the service account JSON key as one line)
npm install
npm start
```
Visit `http://localhost:3000` — it should show the dashboard with real data
from the Sheet. `GET /health` should return `{"status":"ok"}`.

If the Sheet is empty, run a one-time full sync from KiotViet first:
```bash
npm run sync-initial
```

## 2. Deploying on Render — exact values for the "New Web Service" form

| Field | Value |
|---|---|
| Language | Node |
| Branch | `main` |
| Root Directory | `server` |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Instance Type | **Starter** ($7/mo), not Free |

**Why not Free:** Free instances spin down after inactivity. A KiotViet
webhook arriving while the instance is asleep hits a cold start (~30-50s)
and will likely time out before this server gets a chance to queue it,
silently dropping that update. Starter (or higher) stays running.

**Environment variables** (Render dashboard → your service → Environment):
- `CLIENT_ID`
- `CLIENT_SECRET`
- `RETAILER`
- `SPREADSHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_JSON` — the full service account JSON key, one line

`PORT` is set automatically by Render — don't set it yourself.

## 3. After the first deploy: point KiotViet's webhooks at Render

Once the service is live at `https://<your-app>.onrender.com`, register the
webhooks (run this once, from your machine, with the same `.env` as above):
```bash
node kiotviet/webhookAdmin.js register https://<your-app>.onrender.com/webhook
node kiotviet/webhookAdmin.js list   # confirm they're active and pointing at the right URL
```
If you ever need to clear old/stale webhooks first:
```bash
node kiotviet/webhookAdmin.js delete-all
```

## How it maps to the old Apps Script files

| Apps Script | Node equivalent |
|---|---|
| `src/config/Config.gs` | `config.js` (reads env vars instead of hardcoded values) |
| `src/kiotviet/Auth.gs` | `kiotviet/auth.js` |
| `src/kiotviet/SyncInitial.gs` | `kiotviet/syncInitial.js` (`npm run sync-initial`) |
| `src/kiotviet/WebhookAdmin.gs` | `kiotviet/webhookAdmin.js` (CLI) |
| `src/sync/UpdateHandlers.gs` | `sync/updateHandlers.js` |
| `src/sync/WebhookQueue.gs` (`CacheService` + 1-min trigger) | `sync/webhookQueue.js` (in-memory array + `setInterval`) |
| `src/dashboard/DashboardData.gs` | `dashboard/dashboardData.js` |
| `src/dashboard/WebApp.gs` (`doGet`) | `index.js` serving `public/index.html` via `express.static` |
| `src/ui/Dashboard.html` (`google.script.run`) | `public/index.html` (`fetch('/api/dashboard?days=...')`) |
