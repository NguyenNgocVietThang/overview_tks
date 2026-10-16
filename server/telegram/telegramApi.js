'use strict';

function createTelegramApi({ token, fetch: fetchImpl = globalThis.fetch, timeoutMs = 10000 } = {}) {
  if (!token) throw new Error('Thiếu token bot Telegram quản lý.');
  async function call(method, params) {
    // Never propagate fetch errors: their URL may contain the bot token.
    let response;
    let data;
    try {
      response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params), signal: AbortSignal.timeout(timeoutMs)
      });
      data = await response.json();
    } catch (_) {
      const err = new Error('Không thể kết nối Telegram.');
      err.code = 'TELEGRAM_UNAVAILABLE';
      throw err;
    }
    if (!response.ok || !data.ok) {
      const err = new Error('Telegram từ chối yêu cầu.');
      err.code = Number(data.error_code) || response.status || 'TELEGRAM_ERROR';
      err.retryAfter = Number(data.parameters && data.parameters.retry_after) || undefined;
      err.notModified = /message is not modified/i.test(data.description || '');
      err.messageMissing = /message to edit not found/i.test(data.description || '');
      throw err;
    }
    return data.result;
  }
  return { call };
}

module.exports = { createTelegramApi };
