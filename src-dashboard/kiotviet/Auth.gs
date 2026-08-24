// ==========================================
// KIOTVIET AUTHENTICATION
// ==========================================

/**
 * Lay access token tu KiotViet OAuth2 (client credentials flow).
 * @returns {string|null} access_token hoac null neu that bai
 */
function getKiotVietToken() {
  const cache = CacheService.getScriptCache();
  const cachedToken = cache.get('KIOTVIET_ACCESS_TOKEN');
  if (cachedToken) return cachedToken;

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
    "muteHttpExceptions": true,
    "timeoutSeconds": 45
  };

  const maxAttempts = 3;
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = UrlFetchApp.fetch(url, options);
      const responseCode = response.getResponseCode();
      const responseText = response.getContentText();
      if (responseCode >= 200 && responseCode < 300) {
        const tokenResult = JSON.parse(responseText);
        const token = tokenResult.access_token;
        if (token) {
          const expiresIn = Number(tokenResult.expires_in) || 3600;
          const cacheSeconds = Math.max(60, Math.min(3300, expiresIn - 60));
          cache.put('KIOTVIET_ACCESS_TOKEN', token, cacheSeconds);
          return token;
        }
        lastError = new Error('KiotViet khong tra ve access_token.');
      } else {
        lastError = new Error('HTTP ' + responseCode + ' tu KiotViet token endpoint.');
        if (responseCode !== 429 && responseCode < 500) break;
      }
    } catch (error) {
      lastError = error;
    }

    if (attempt < maxAttempts) Utilities.sleep(1000 * Math.pow(2, attempt - 1));
  }

  Logger.log('Khong lay duoc KiotViet token: ' +
    (lastError ? lastError.toString() : 'khong ro loi'));
  return null;
}

function clearKiotVietToken() {
  CacheService.getScriptCache().remove('KIOTVIET_ACCESS_TOKEN');
  Logger.log('Đã xóa KIOTVIET_ACCESS_TOKEN khỏi Cache thành công!');
}