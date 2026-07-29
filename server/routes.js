const express = require('express');
const { getDashboardData, searchDashboardRecords } = require('./dashboard/dashboardData');

const router = express.Router();

const sheetsClient = require('./sheets/sheetsClient');
const CONFIG = require('./config');

router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Route kiem tra ket noi nhanh — chi xem duoc tren server, KHONG expose secret
router.get('/api/debug', async (req, res) => {
  const checks = {
    SPREADSHEET_ID: !!process.env.SPREADSHEET_ID,
    GOOGLE_SERVICE_ACCOUNT_JSON: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    spreadsheetId: CONFIG.SPREADSHEET_ID ? CONFIG.SPREADSHEET_ID.substring(0, 8) + '...' : null,
    sheetsTest: null,
    sheetsError: null,
    sheetTabs: null,
    sheetTabsError: null,
  };
  try {
    const data = await sheetsClient.getValues(CONFIG.SHEET_INVOICES);
    checks.sheetsTest = `OK — ${data.length} rows tu sheet "${CONFIG.SHEET_INVOICES}"`;
  } catch (e) {
    checks.sheetsError = { message: e.message, googleStatus: e?.response?.status };
  }
  try {
    checks.sheetTabs = await sheetsClient.listSheetTitles();
  } catch (e) {
    checks.sheetTabsError = e.message;
  }
  res.json(checks);
});

router.get('/api/dashboard', async (req, res) => {
  try {
    const data = await getDashboardData(req.query.days);
    res.status(200).json(data);
  } catch (err) {
    const googleStatus = err?.response?.status;
    const googleMessage = err?.response?.data?.error?.message || err?.response?.data;
    console.error('=== LOI /api/dashboard ===');
    console.error('Message:', err.message);
    console.error('Google API status:', googleStatus);
    console.error('Google API message:', JSON.stringify(googleMessage));
    console.error('Stack:', err.stack);
    console.error('=========================');
    res.status(500).json({
      error: 'Khong lay duoc du lieu dashboard.',
      detail: err.message,
      googleStatus,
      googleMessage
    });
  }
});

router.get('/api/search', async (req, res) => {
  try {
    const data = await searchDashboardRecords(req.query.view, req.query.q, req.query.limit);
    res.status(200).json(data);
  } catch (err) {
    const googleStatus = err?.response?.status;
    console.error('=== LOI /api/search ===');
    console.error('Message:', err.message);
    console.error('Google API status:', googleStatus);
    console.error('Stack:', err.stack);
    console.error('=====================');
    res.status(500).json({
      error: 'Khong tim kiem duoc du lieu dashboard.',
      detail: err.message,
      googleStatus
    });
  }
});

module.exports = router;
