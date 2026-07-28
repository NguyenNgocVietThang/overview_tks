const express = require('express');
const { getDashboardData } = require('./dashboard/dashboardData');
const { enqueue } = require('./sync/webhookQueue');

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

// KiotViet can nhan phan hoi trong <5s — day payload vao hang doi va tra loi ngay.
router.post('/webhook', express.text({ type: '*/*' }), (req, res) => {
  try {
    if (!req.body) {
      return res.status(200).send('No data');
    }
    enqueue(req.body);
    res.status(200).send('QUEUED');
  } catch (err) {
    console.error('Loi khi dua webhook vao hang doi:', err);
    res.status(200).send('ERROR: ' + err.toString());
  }
});

module.exports = router;
