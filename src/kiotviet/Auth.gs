// ==========================================
// KIOTVIET AUTHENTICATION
// ==========================================

/**
 * Lay access token tu KiotViet OAuth2 (client credentials flow).
 * @returns {string|null} access_token hoac null neu that bai
 */
function getKiotVietToken() {
  const properties = PropertiesService.getScriptProperties();
  const clientId = properties.getProperty('KIOTVIET_CLIENT_ID');
  const clientSecret = properties.getProperty('KIOTVIET_CLIENT_SECRET');
  if (!clientId || !clientSecret) {
    throw new Error(
      'Thiếu KIOTVIET_CLIENT_ID hoặc KIOTVIET_CLIENT_SECRET trong Apps Script Properties.'
    );
  }

  const url = "https://id.kiotviet.vn/connect/token";
  const payload = {
    "scopes": "PublicApi.Access",
    "grant_type": "client_credentials",
    "client_id": clientId,
    "client_secret": clientSecret
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
