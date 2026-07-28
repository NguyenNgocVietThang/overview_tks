// ==========================================
// KIOTVIET AUTHENTICATION
// ==========================================

/**
 * Lay access token tu KiotViet OAuth2 (client credentials flow).
 * @returns {string|null} access_token hoac null neu that bai
 */
function getKiotVietToken() {
  const url = "https://id.kiotviet.vn/connect/token";
  const payload = {
    "scopes": "PublicApi.Access",
    "grant_type": "client_credentials",
    "client_id": CONFIG.CLIENT_ID,
    "client_secret": CONFIG.CLIENT_SECRET
  };
  const options = {
    "method": "post",
    "contentType": "application/x-www-form-urlencoded",
    "payload": payload,
    "muteHttpExceptions": true
  };
  try {
    const response = UrlFetchApp.fetch(url, options);
    return JSON.parse(response.getContentText()).access_token || null;
  } catch (e) { return null; }
}
