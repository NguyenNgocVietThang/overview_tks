// ==========================================
// KIOTVIET AUTHENTICATION
// ==========================================
const CONFIG = require('../config');

/**
 * Lay access token tu KiotViet OAuth2 (client credentials flow).
 * @returns {Promise<string|null>} access_token hoac null neu that bai
 */
async function getKiotVietToken() {
  const url = 'https://id.kiotviet.vn/connect/token';
  const body = new URLSearchParams({
    scopes: 'PublicApi.Access',
    grant_type: 'client_credentials',
    client_id: CONFIG.CLIENT_ID,
    client_secret: CONFIG.CLIENT_SECRET
  });
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    const data = await response.json();
    return data.access_token || null;
  } catch (e) {
    return null;
  }
}

module.exports = { getKiotVietToken };
