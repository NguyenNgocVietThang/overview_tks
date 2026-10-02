'use strict';

const CONFIG = require('../config');
const appUsers = require('../auth/appUsersRepository');
const { getPool } = require('../db/pool');
const leaveRepoDefault = require('../hr/hrLeaveRepository');
const { createHrLeaveDecisionService } = require('../hr/hrLeaveDecisionService');
const { BRANCHES } = require('../branch/branches');
const { createManagerLeaveStore } = require('./managerLeaveStore');
const { createManagerLeaveBot, isEligibleManager, managerMatchesBranch } = require('./managerLeaveBot');
const { buildManagerLeaveMessage } = require('./managerLeaveMessage');
const { createTelegramApi } = require('./telegramApi');

const BOTH_BRANCHES = [BRANCHES.HANOI, BRANCHES.SAIGON];

function validateManagerTelegramConfig(config) {
  if (!config.HR_MANAGER_TELEGRAM_ENABLED) return false;
  let url;
  try { url = new URL(config.HR_MANAGER_TELEGRAM_WEB_URL); } catch (_) { /* validated below */ }
  if (!config.HR_MANAGER_TELEGRAM_BOT_TOKEN || !/^[A-Za-z0-9_-]{1,256}$/.test(config.HR_MANAGER_TELEGRAM_WEBHOOK_SECRET || '') ||
      !url || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Thiếu hoặc sai cấu hình bot Telegram quản lý: token, webhook secret, URL gốc HTTPS.');
  }
  return true;
}

async function resolveManagerFromDb(telegramId) {
  const { rows } = await getPool().query(`SELECT u.*, e.branch AS hr_branch FROM app_users u
    LEFT JOIN hr_employees e ON e.id = u.hr_employee_id
    WHERE u.telegram_id = $1 AND NOT u.is_deleted`, [String(telegramId)]);
  if (!rows[0]) return null;
  // Bot scope is the manager's assigned DB branch, independent of the web's
  // HR-derived "Cả hai" default. Never mutate accounts while authorizing a bot.
  const user = appUsers.rowToUser(rows[0]);
  return isEligibleManager(user, telegramId) ? user : null;
}

async function loadManagersFromDb({ selectAll = appUsers.selectAllRows, resolve = user => user, logger = console } = {}) {
  const candidates = await selectAll();
  const managers = [];
  for (const candidate of candidates) {
    if (!candidate.telegramId) continue;
    try {
      const user = await resolve(candidate);
      if (isEligibleManager(user, user.telegramId)) managers.push(user);
    } catch (err) {
      logger.error('[Telegram manager] Bỏ qua tài khoản chưa xác minh được quyền:', err.code || 'ACCOUNT_UNAVAILABLE');
    }
  }
  return managers;
}

function createManagerLeaveRuntime({
  store = createManagerLeaveStore(), leaveRepo = leaveRepoDefault,
  telegram, getManager = resolveManagerFromDb, loadManagers = loadManagersFromDb,
  botFactory = createManagerLeaveBot, buildMessage = buildManagerLeaveMessage,
  notifyDecision,
  webUrl = CONFIG.HR_MANAGER_TELEGRAM_WEB_URL, intervalMs = 5000, logger = console
} = {}) {
  const decisionNotifications = createHrLeaveDecisionService({ logger });
  let timer;
  let running = false;
  let requested = false;
  let firstEnabledAt;

  async function executeEffect(effect) {
    if (effect.method === 'notifyDecision') {
      await (notifyDecision || decisionNotifications.notifyDecision)(effect.request, effect.userId, effect.note);
      return;
    }
    if (!['sendMessage', 'answerCallbackQuery', 'editMessageReplyMarkup'].includes(effect.method)) {
      throw new Error('Unsupported Telegram effect');
    }
    if (effect.session) {
      const session = await store.getSession(effect.session.chatId);
      if (!session || session.session_id !== effect.session.sessionId || new Date(session.expires_at).getTime() <= Date.now()) return;
    }
    try {
      const result = await telegram.call(effect.method, effect.params);
      if (effect.session && result && result.message_id) {
        await store.setSessionPrompt(effect.session.chatId, effect.session.sessionId, String(result.message_id));
      }
    } catch (err) {
      // A blocked private chat cannot receive effects. The committed decision
      // and its web notifications must still finish; /start can restore cards.
      if (err.code === 403) return;
      // Callback alerts expire quickly and must never stall durable decisions.
      if (effect.method === 'answerCallbackQuery' && err.code === 400) return;
      if (effect.method === 'editMessageReplyMarkup' && (err.notModified || err.messageMissing)) return;
      throw err;
    }
  }

  async function processUpdate(job) {
    try {
      const effects = await store.handleUpdate(job, async ({ store: transactionStore, leaveRepo: transactionRepo }) => {
        const deferred = [];
        const decisions = createHrLeaveDecisionService({ repo: transactionRepo, logger });
        const bot = botFactory({ store: transactionStore, leaveRepo: transactionRepo, getManager, webUrl,
          decide: async input => {
            const updated = await decisions.decide(input, { notify: false, broadcast: false });
            deferred.push({ method: 'notifyDecision', request: updated, userId: input.user.id, note: updated.ghi_chu_duyet });
            return updated;
          }
        });
        return [...await bot.handleUpdate(job.payload), ...deferred];
      });
      if (!Array.isArray(effects)) return; // Lease was taken by a replacement process.
      for (let i = Number(job.effects_done || 0); i < effects.length; i++) {
        await executeEffect(effects[i]);
        if (await store.completeEffect(job, i + 1) === false) return;
      }
      await store.completeUpdate(job);
    } catch (err) {
      await store.retryUpdate(job, err, err.retryAfter);
      logger.error('[Telegram manager] Sẽ thử lại thao tác:', err.code || 'PROCESSING_FAILED');
    }
  }

  async function processDelivery(job) {
    try {
      const user = await getManager(job.telegram_chat_id);
      const record = await leaveRepo.getLeaveRequestById(job.request_id, BOTH_BRANCHES);
      const authorized = user && String(user.id) === String(job.user_id) && record &&
        managerMatchesBranch(user, record.co_so) && record.loai_yeu_cau === 'Xin nghỉ phép';
      if (!authorized) {
        if (job.message_id) {
          try { await telegram.call('editMessageReplyMarkup', { chat_id: job.telegram_chat_id, message_id: job.message_id, reply_markup: { inline_keyboard: [] } }); }
          catch (err) { if (!err.notModified && !err.messageMissing && err.code !== 403) throw err; }
        }
        await store.finishDelivery(job, { messageId: job.message_id, version: job.desired_version, blocked: true });
        return;
      }
      const payload = { chat_id: job.telegram_chat_id, ...buildMessage(record, { webUrl }) };
      let messageId = job.message_id;
      if (messageId) {
        try { await telegram.call('editMessageText', { ...payload, message_id: messageId }); }
        catch (err) {
          if (err.messageMissing) messageId = null;
          else if (!err.notModified) throw err;
        }
      }
      if (!messageId) messageId = String((await telegram.call('sendMessage', payload)).message_id);
      await store.finishDelivery(job, { messageId, version: record.decision_version });
    } catch (err) {
      await store.retryDelivery(job, err, err.retryAfter);
      logger.error('[Telegram manager] Chưa gửi được thông báo:', err.code || 'DELIVERY_FAILED');
    }
  }

  async function seedBacklog(managers) {
    const lists = await Promise.all(['Chưa duyệt', 'Tạm duyệt'].map(status => leaveRepo.getLeaveRequests({ status }, BOTH_BRANCHES)));
    for (const record of lists.flat()) {
      if (record.loai_yeu_cau !== 'Xin nghỉ phép') continue;
      for (const user of managers) if (managerMatchesBranch(user, record.co_so)) {
        await store.enqueueDelivery({ requestId: record.request_id, userId: user.id, chatId: user.telegramId, version: record.decision_version });
      }
    }
  }

  async function processEvent(job, managers) {
    try {
      const record = await leaveRepo.getLeaveRequestById(job.request_id, BOTH_BRANCHES);
      if (record) {
        await store.queueExistingDeliveries(record.request_id, record.decision_version);
        const isNewRequest = job.event_type === 'CREATE' && new Date(job.created_at).getTime() >= new Date(firstEnabledAt).getTime();
        if (record.loai_yeu_cau === 'Xin nghỉ phép' && (isNewRequest || !['Đã duyệt', 'Từ chối'].includes(record.trang_thai))) {
          for (const user of managers) if (managerMatchesBranch(user, record.co_so)) {
            await store.enqueueDelivery({ requestId: record.request_id, userId: user.id, chatId: user.telegramId, version: record.decision_version });
          }
        }
      }
      await store.completeEvent(job);
    } catch (err) { await store.retryEvent(job, err); }
  }

  async function drain() {
    if (running) { requested = true; return; }
    running = true;
    try {
      if (!firstEnabledAt) firstEnabledAt = await store.activate();
      do {
        requested = false;
        // Claim immediately before processing: a slow Telegram response must
        // not consume the leases of an entire batch waiting behind it.
        for (let i = 0; i < 20; i++) {
          const [job] = await store.claimUpdates(1);
          if (!job) break;
          await processUpdate(job);
        }
        const managers = await loadManagers();
        await seedBacklog(managers);
        for (const job of await store.claimEvents()) await processEvent(job, managers);
        for (let i = 0; i < 20; i++) {
          const [job] = await store.claimDeliveries(1);
          if (!job) break;
          await processDelivery(job);
        }
      } while (requested);
    } catch (err) { logger.error('[Telegram manager] Tác vụ nền tạm dừng:', err.code || 'DB_UNAVAILABLE'); }
    finally { running = false; }
  }
  function start() {
    if (timer) return;
    void drain();
    timer = setInterval(drain, intervalMs);
    timer.unref();
  }
  function stop() { clearInterval(timer); timer = null; }
  return { telegram, store, start, stop, drain, processUpdate, processDelivery };
}

function createConfiguredManagerLeaveRuntime({ logger = console } = {}) {
  try {
    if (!validateManagerTelegramConfig(CONFIG)) return null;
    return createManagerLeaveRuntime({ telegram: createTelegramApi({ token: CONFIG.HR_MANAGER_TELEGRAM_BOT_TOKEN }), intervalMs: CONFIG.HR_MANAGER_TELEGRAM_SCAN_INTERVAL_MS, logger });
  } catch (err) {
    logger.error('[Telegram manager]', err.message);
    return null;
  }
}

let configuredRuntime;
function getConfiguredManagerLeaveRuntime() {
  if (configuredRuntime === undefined) configuredRuntime = createConfiguredManagerLeaveRuntime();
  return configuredRuntime;
}

module.exports = { createManagerLeaveRuntime, createConfiguredManagerLeaveRuntime, getConfiguredManagerLeaveRuntime, validateManagerTelegramConfig, loadManagersFromDb };
