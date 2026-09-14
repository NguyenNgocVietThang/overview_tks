'use strict';

function getConfiguredBranches({ warn = console.warn } = {}) {
  const definitions = [
    {
      branch: 'hanoi',
      clientId: process.env.KIOTVIET_CLIENT_ID,
      clientSecret: process.env.KIOTVIET_CLIENT_SECRET,
      retailer: process.env.KIOTVIET_RETAILER
    },
    {
      branch: 'saigon',
      clientId: process.env.KIOTVIET_CLIENT_ID_SG || process.env.KIOTVIET_CLIENT_ID,
      clientSecret: process.env.KIOTVIET_CLIENT_SECRET_SG || process.env.KIOTVIET_CLIENT_SECRET,
      retailer: process.env.KIOTVIET_RETAILER_SG
    }
  ];

  return definitions.filter((item) => {
    const missing = ['clientId', 'clientSecret', 'retailer'].filter((key) => !item[key]);
    if (missing.length) {
      warn(`[KiotViet Sync] Bỏ qua ${item.branch}: thiếu ${missing.join(', ')}.`);
      return false;
    }
    return true;
  });
}

module.exports = { getConfiguredBranches };
