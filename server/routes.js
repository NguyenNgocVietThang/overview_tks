const express = require('express');
const { getDashboardData } = require('./dashboard/dashboardData');

const router = express.Router();

router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

router.get('/api/dashboard', async (req, res) => {
  try {
    const data = await getDashboardData(req.query.days);
    res.status(200).json(data);
  } catch (err) {
    console.error('Loi lay du lieu dashboard:', err);
    res.status(500).json({ error: 'Khong lay duoc du lieu dashboard.' });
  }
});

module.exports = router;
