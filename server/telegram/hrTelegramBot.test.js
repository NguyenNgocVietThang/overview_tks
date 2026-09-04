'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');

const telegramModulePath = require.resolve('node-telegram-bot-api');
const botModulePath = require.resolve('./hrTelegramBot');
const repoPath = require.resolve('../hr/hrLeaveRepository');
const hrLeaveServicePath = require.resolve('../hr/hrLeaveService');
const extractorPath = require.resolve('./leaveAiExtractor');
const consensusExtractorPath = require.resolve('./leaveAiConsensusExtractor');
const telegramIdentityServicePath = require.resolve('./telegramIdentityService');

const MESSAGE_TIME_SECONDS = Math.floor(new Date('2026-08-22T08:00:00+07:00').getTime() / 1000);

test('không khởi động bot Telegram ở máy local nếu chưa bật rõ ràng', () => {
  const isEnabled = require('./hrTelegramBot').isTelegramBotRuntimeEnabled;

  assert.equal(isEnabled?.({}), false);
  assert.equal(isEnabled?.({ TELEGRAM_BOT_ENABLED: 'true' }), true);
  assert.equal(isEnabled?.({ RENDER: 'true' }), true);
  assert.equal(isEnabled?.({ RENDER: 'true', TELEGRAM_BOT_ENABLED: 'false' }), false);
});

test('dừng polling khi Telegram báo 409 do có bot instance khác', async () => {
  const h = setupHarness();
  try {
    h.bot.emit('polling_error', Object.assign(
      new Error('ETELEGRAM: 409 Conflict: terminated by other getUpdates request'),
      { code: 'ETELEGRAM', response: { statusCode: 409 } }
    ));
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(h.bot.pollingStopped, true);
  } finally {
    h.teardown();
  }
});

class FakeTelegramBot extends EventEmitter {
  constructor(token, options) {
    super();
    this.token = token;
    this.options = options;
    this.sent = [];
    this.textHandlers = [];
    this.pollingStopped = false;
  }

  onText(regex, handler) {
    this.textHandlers.push({ regex, handler });
  }

  sendMessage(chatId, text, options) {
    this.sent.push({ chatId, text, options });
    return Promise.resolve({ message_id: this.sent.length });
  }

  answerCallbackQuery() {
    return Promise.resolve();
  }

  editMessageReplyMarkup() {
    return Promise.resolve();
  }

  stopPolling() {
    this.pollingStopped = true;
    return Promise.resolve();
  }

  async triggerText(command, { chatId, from }) {
    const entry = this.textHandlers.find(h => h.regex.test(command));
    if (!entry) throw new Error(`Không có handler đăng ký cho "${command}"`);
    await entry.handler({ chat: { id: chatId }, message_id: Math.floor(Math.random() * 1e9), from }, command.match(entry.regex));
  }
}

function extraction(overrides = {}) {
  return {
    intent: 'leave_request',
    start_date: null,
    start_session: null,
    end_date: null,
    end_session: null,
    duration_value: null,
    duration_unit: null,
    reason: null,
    handover: null,
    reason_declined: false,
    handover_declined: false,
    confidence: 0.95,
    ...overrides
  };
}

function setupHarness({
  link = { web_username: 'test', telegram_username: '@test' },
  identity = { hoTen: 'Test User', chucVu: 'NV · Hà Nội' },
  autoIdentity = null
} = {}) {
  const previousTelegramModule = require.cache[telegramModulePath];
  const previousRepoModule = require.cache[repoPath];
  const previousServiceModule = require.cache[hrLeaveServicePath];
  const previousExtractorModule = require.cache[extractorPath];
  const previousConsensusExtractorModule = require.cache[consensusExtractorPath];
  const previousTelegramIdentityService = require.cache[telegramIdentityServicePath];
  const config = require('../config');
  const previousToken = config.TELEGRAM_BOT_TOKEN;
  const tmpFile = path.join(os.tmpdir(), `tks-hr-bot-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

  const realRepo = require('../hr/hrLeaveRepository');
  const realService = require('../hr/hrLeaveService');

  const created = [];
  const createdBranches = [];
  let linkResult = link;
  const repoStub = {
    ...realRepo,
    findLinkByChatId: async () => linkResult,
    createLeaveRequest: async (data, branch) => {
      created.push(data);
      createdBranches.push(branch);
      return { ...data, request_id: 'NP-TEST-0001' };
    }
  };
  const serviceStub = {
    ...realService,
    resolveSenderIdentity: async () => identity
  };

  const extractionQueue = [];
  let extractionCalls = 0;
  class FakeExtractionError extends Error {
    constructor(code) {
      super(code);
      this.code = code;
    }
  }
  const extractorStub = {
    LeaveAiExtractionError: FakeExtractionError,
    extractLeaveMessage: async (...args) => {
      extractionCalls += 1;
      const next = extractionQueue.shift();
      if (!next) throw new Error(`Chưa có fixture cho lần gọi extractLeaveMessage thứ ${extractionCalls}`);
      if (next.throw) throw next.throw;
      if (next.fn) return next.fn(...args);
      return next.value;
    }
  };

  require.cache[telegramModulePath] = { id: telegramModulePath, filename: telegramModulePath, loaded: true, exports: FakeTelegramBot };
  require.cache[repoPath] = { id: repoPath, filename: repoPath, loaded: true, exports: repoStub };
  require.cache[hrLeaveServicePath] = { id: hrLeaveServicePath, filename: hrLeaveServicePath, loaded: true, exports: serviceStub };
  require.cache[extractorPath] = { id: extractorPath, filename: extractorPath, loaded: true, exports: extractorStub };
  require.cache[consensusExtractorPath] = {
    id: consensusExtractorPath,
    filename: consensusExtractorPath,
    loaded: true,
    exports: extractorStub
  };
  require.cache[telegramIdentityServicePath] = {
    id: telegramIdentityServicePath,
    filename: telegramIdentityServicePath,
    loaded: true,
    exports: { resolveChat: async () => autoIdentity || { status: 'not_found' } }
  };

  config.TELEGRAM_BOT_TOKEN = 'test-token';
  const store = require('./conversationStore');
  store.initStore(tmpFile);

  delete require.cache[botModulePath];
  const { startHrTelegramBot } = require('./hrTelegramBot');
  const bot = startHrTelegramBot();

  return {
    bot,
    store,
    created,
    createdBranches,
    setLink(value) { linkResult = value; },
    queueExtraction(value) { extractionQueue.push({ value }); },
    queueExtractionAsync(fn) { extractionQueue.push({ fn }); },
    queueExtractionError(err) { extractionQueue.push({ throw: err }); },
    getExtractionCalls() { return extractionCalls; },
    async sendText(chatId, text, overrides = {}) {
      const messageHandler = bot.listeners('message')[0];
      await messageHandler({
        chat: { id: chatId },
        from: { username: 'tester' },
        message_id: Math.floor(Math.random() * 1e9),
        date: MESSAGE_TIME_SECONDS,
        text,
        ...overrides
      });
    },
    async pressButton(chatId, data, messageId = bot.sent.length) {
      const callbackHandler = bot.listeners('callback_query')[0];
      await callbackHandler({ id: `cb-${Math.random()}`, data, from: { id: chatId }, message: { chat: { id: chatId }, message_id: messageId } });
    },
    teardown() {
      config.TELEGRAM_BOT_TOKEN = previousToken;
      store.initStore();
      delete require.cache[botModulePath];
      if (previousTelegramModule) require.cache[telegramModulePath] = previousTelegramModule;
      else delete require.cache[telegramModulePath];
      if (previousRepoModule) require.cache[repoPath] = previousRepoModule;
      else delete require.cache[repoPath];
      if (previousServiceModule) require.cache[hrLeaveServicePath] = previousServiceModule;
      else delete require.cache[hrLeaveServicePath];
      if (previousExtractorModule) require.cache[extractorPath] = previousExtractorModule;
      else delete require.cache[extractorPath];
      if (previousConsensusExtractorModule) require.cache[consensusExtractorPath] = previousConsensusExtractorModule;
      else delete require.cache[consensusExtractorPath];
      if (previousTelegramIdentityService) require.cache[telegramIdentityServicePath] = previousTelegramIdentityService;
      else delete require.cache[telegramIdentityServicePath];
      fs.rmSync(tmpFile, { force: true });
    }
  };
}

test('ID Telegram trong danh sách HR tự liên kết và định tuyến đơn về HR home', async () => {
  const h = setupHarness({
    link: null,
    autoIdentity: {
      status: 'linked',
      sourceBranch: 'Sài Gòn',
      link: { user_id: 'u1', web_username: 'a@example.com', telegram_username: '@a', telegram_chat_id: '900' },
      user: { id: 'u1', username: 'a@example.com' }
    },
    identity: { hoTen: 'A', chucVu: 'Kế toán' }
  });
  try {
    h.queueExtraction(extraction({
      start_date: '2026-08-23', start_session: 'Sáng', end_date: '2026-08-23', end_session: 'Sáng',
      reason: 'khám bệnh', handover: 'B'
    }));
    await h.sendText(900, 'Em xin nghỉ sáng mai vì khám bệnh, bàn giao B');
    await h.pressButton(900, 'confirm');
    assert.equal(h.createdBranches[0], 'Sài Gòn');
    assert.equal(h.created[0].web_username, 'a@example.com');
  } finally {
    h.teardown();
  }
});

test('một tin nhắn đủ thông tin -> CONFIRM ngay, tóm tắt đúng nội dung', async () => {
  const h = setupHarness();
  try {
    h.queueExtraction(extraction({
      start_date: '2026-08-23', start_session: 'Sáng', end_date: '2026-08-23', end_session: 'Sáng',
      reason: 'khám bệnh', handover: 'Nguyễn B'
    }));
    await h.sendText(100, 'Em xin nghỉ sáng mai vì khám bệnh, bàn giao cho Nguyễn B');

    const conv = h.store.getConversation(100);
    assert.equal(conv.step, 'CONFIRM');
    const sent = h.bot.sent.at(-1);
    assert.match(sent.text, /Từ: Sáng 23\/08\/2026/);
    assert.match(sent.text, /Đến: Sáng 23\/08\/2026/);
    assert.match(sent.text, /Lý do: khám bệnh/);
    assert.match(sent.text, /Người bàn giao: Nguyễn B/);
    assert.deepEqual(sent.options.reply_markup.inline_keyboard[0].map(b => b.callback_data), ['confirm', 'cancel']);
  } finally {
    h.teardown();
  }
});

test('cờ vi phạm dùng giờ Bangkok, không phụ thuộc timezone của host', async () => {
  const previousTimeZone = process.env.TZ;
  process.env.TZ = 'UTC';
  const h = setupHarness();
  try {
    h.queueExtraction(extraction({
      start_date: '2026-08-22', start_session: 'Sáng', end_date: '2026-08-22', end_session: 'Sáng',
      reason: 'khám bệnh', handover: 'Nguyễn B'
    }));
    await h.sendText(115, 'Em xin nghỉ sáng nay vì khám bệnh, bàn giao Nguyễn B');

    assert.equal(h.store.getConversation(115).data.resolved.coViPham, true);
  } finally {
    h.teardown();
    if (previousTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimeZone;
  }
});

test('thiếu buổi -> mặc định nghỉ trọn ngày, không hỏi thêm', async () => {
  const h = setupHarness();
  try {
    h.queueExtraction(extraction({ start_date: '2026-08-23', reason: 'việc gia đình', handover: 'Nguyễn C' }));
    await h.sendText(101, 'Em xin nghỉ ngày mai ạ vì việc gia đình, bàn giao Nguyễn C');

    assert.equal(h.store.getConversation(101).step, 'CONFIRM');
    assert.equal(h.bot.sent.length, 1, 'chỉ 1 tin nhắn — màn hình xác nhận, không hỏi thêm về buổi');
    assert.match(h.bot.sent[0].text, /mặc định: nghỉ trọn ngày/);
  } finally {
    h.teardown();
  }
});

test('khoảng ngày thiếu buổi ghi rõ hai biên mặc định trong màn hình xác nhận', async () => {
  const h = setupHarness();
  try {
    h.queueExtraction(extraction({
      start_date: '2026-08-23', end_date: '2026-08-24', reason: 'việc gia đình', handover: 'Nguyễn C'
    }));
    await h.sendText(117, 'Em xin nghỉ từ mai đến ngày kia vì việc gia đình, bàn giao Nguyễn C');

    assert.match(h.bot.sent.at(-1).text, /mặc định: bắt đầu buổi Sáng, kết thúc buổi Chiều/);
  } finally {
    h.teardown();
  }
});

test('ngày bắt đầu kèm thời lượng không bị ghi chú sai là nghỉ trọn ngày', async () => {
  const h = setupHarness();
  try {
    h.queueExtraction(extraction({
      start_date: '2026-08-23', duration_value: 3, duration_unit: 'session',
      reason: 'việc gia đình', handover: 'Nguyễn C'
    }));
    await h.sendText(118, 'Em xin nghỉ 3 buổi từ ngày mai vì việc gia đình, bàn giao Nguyễn C');

    assert.match(h.bot.sent.at(-1).text, /mặc định: bắt đầu buổi Sáng/);
    assert.doesNotMatch(h.bot.sent.at(-1).text, /mặc định: nghỉ trọn ngày/);
  } finally {
    h.teardown();
  }
});

test('thiếu hoàn toàn thời gian -> hỏi đúng 1 câu về thời gian', async () => {
  const h = setupHarness();
  try {
    h.queueExtraction(extraction({ reason: 'việc gia đình', handover: 'Nguyễn C' }));
    await h.sendText(102, 'Em xin nghỉ ạ');

    const conv = h.store.getConversation(102);
    assert.equal(conv.step, 'AWAITING_CLARIFICATION');
    assert.equal(conv.data.askCounts.TIME, 1);
    assert.equal(h.bot.sent.length, 1);
    assert.match(h.bot.sent[0].text, /chưa xác định chắc thời gian/);
  } finally {
    h.teardown();
  }
});

test('trả lời "không có" cho lý do/bàn giao lưu rỗng, không hỏi lại; các tin nhắn gộp vào 1 draft', async () => {
  const h = setupHarness();
  try {
    h.queueExtraction(extraction({ start_date: '2026-08-23', start_session: 'Sáng', end_date: '2026-08-23', end_session: 'Sáng' }));
    await h.sendText(103, 'Em xin nghỉ sáng mai');
    assert.equal(h.store.getConversation(103).step, 'AWAITING_CLARIFICATION');
    assert.match(h.bot.sent.at(-1).text, /Lý do nghỉ là gì/);

    h.queueExtraction(extraction({
      start_date: '2026-08-23', start_session: 'Sáng', end_date: '2026-08-23', end_session: 'Sáng', reason_declined: true
    }));
    await h.sendText(103, 'không có');
    assert.match(h.bot.sent.at(-1).text, /Người bàn giao công việc là ai/);

    h.queueExtraction(extraction({
      start_date: '2026-08-23', start_session: 'Sáng', end_date: '2026-08-23', end_session: 'Sáng',
      reason_declined: true, handover_declined: true
    }));
    await h.sendText(103, 'không cần');

    const conv = h.store.getConversation(103);
    assert.equal(conv.step, 'CONFIRM');
    assert.deepEqual(conv.data.messages, ['Em xin nghỉ sáng mai', 'không có', 'không cần']);
    assert.match(h.bot.sent.at(-1).text, /Lý do: không có/);
    assert.match(h.bot.sent.at(-1).text, /Người bàn giao: không có/);
  } finally {
    h.teardown();
  }
});

test('câu trả lời trần "không có" được áp vào đúng nhóm bot đang hỏi', async () => {
  const h = setupHarness();
  try {
    const intervalOnly = extraction({
      start_date: '2026-08-23', start_session: 'Sáng', end_date: '2026-08-23', end_session: 'Sáng'
    });
    h.queueExtraction(intervalOnly);
    await h.sendText(116, 'Em xin nghỉ sáng mai');
    assert.equal(h.store.getConversation(116).data.pendingField, 'REASON');

    h.queueExtraction(intervalOnly);
    await h.sendText(116, 'không có');
    assert.equal(h.store.getConversation(116).data.pendingField, 'HANDOVER');
    assert.match(h.bot.sent.at(-1).text, /Người bàn giao/);

    h.queueExtraction(intervalOnly);
    await h.sendText(116, 'không có');
    assert.equal(h.store.getConversation(116).step, 'CONFIRM');
    assert.match(h.bot.sent.at(-1).text, /Lý do: không có/);
    assert.match(h.bot.sent.at(-1).text, /Người bàn giao: không có/);
  } finally {
    h.teardown();
  }
});

test('giá trị tường minh mới thay thế câu trả lời từ chối trước đó', async () => {
  const h = setupHarness();
  try {
    const intervalOnly = extraction({
      start_date: '2026-08-23', start_session: 'Sáng', end_date: '2026-08-23', end_session: 'Sáng'
    });
    h.queueExtraction(intervalOnly);
    await h.sendText(119, 'Em xin nghỉ sáng mai');

    h.queueExtraction(intervalOnly);
    await h.sendText(119, 'không có');

    h.queueExtraction(extraction({
      start_date: '2026-08-23', start_session: 'Sáng', end_date: '2026-08-23', end_session: 'Sáng',
      reason: 'khám bệnh', handover: 'Lan'
    }));
    await h.sendText(119, 'Thực ra lý do là khám bệnh, em bàn giao cho Lan');

    assert.equal(h.store.getConversation(119).step, 'CONFIRM');
    assert.match(h.bot.sent.at(-1).text, /Lý do: khám bệnh/);
    assert.match(h.bot.sent.at(-1).text, /Người bàn giao: Lan/);
  } finally {
    h.teardown();
  }
});

test('tin nhắn tự do khi đang CONFIRM thay thế bản nháp cũ (không tạo luồng song song)', async () => {
  const h = setupHarness();
  try {
    h.queueExtraction(extraction({
      start_date: '2026-08-23', start_session: 'Sáng', end_date: '2026-08-23', end_session: 'Sáng',
      reason: 'khám bệnh', handover: 'Nguyễn B'
    }));
    await h.sendText(104, 'Em xin nghỉ sáng mai vì khám bệnh, bàn giao Nguyễn B');
    assert.equal(h.store.getConversation(104).step, 'CONFIRM');

    h.queueExtraction(extraction({
      start_date: '2026-08-24', start_session: 'Chiều', end_date: '2026-08-24', end_session: 'Chiều',
      reason: 'khám răng', handover: 'Nguyễn D'
    }));
    await h.sendText(104, 'À quên, em xin nghỉ chiều ngày kia vì khám răng, bàn giao Nguyễn D');

    const conv = h.store.getConversation(104);
    assert.equal(conv.step, 'CONFIRM');
    assert.deepEqual(conv.data.messages, ['À quên, em xin nghỉ chiều ngày kia vì khám răng, bàn giao Nguyễn D']);
    assert.match(h.bot.sent.at(-1).text, /Lý do: khám răng/);
  } finally {
    h.teardown();
  }
});

test('nút xác nhận của draft cũ không thể gửi draft thay thế mới', async () => {
  const h = setupHarness();
  try {
    h.queueExtraction(extraction({
      start_date: '2026-08-23', start_session: 'Sáng', end_date: '2026-08-23', end_session: 'Sáng',
      reason: 'khám bệnh', handover: 'Nguyễn B'
    }));
    await h.sendText(113, 'Em xin nghỉ sáng mai vì khám bệnh, bàn giao Nguyễn B');

    h.queueExtraction(extraction({
      start_date: '2026-08-24', start_session: 'Chiều', end_date: '2026-08-24', end_session: 'Chiều',
      reason: 'khám răng', handover: 'Nguyễn D'
    }));
    await h.sendText(113, 'À quên, em xin nghỉ chiều ngày kia vì khám răng, bàn giao Nguyễn D');
    await h.pressButton(113, 'confirm', 1);

    assert.equal(h.created.length, 0);
    assert.equal(h.store.getConversation(113).step, 'CONFIRM');
  } finally {
    h.teardown();
  }
});

test('tin nhắn thay thế draft CONFIRM vô hiệu hóa nút cũ dù AI proxy lỗi', async () => {
  const h = setupHarness();
  try {
    h.queueExtraction(extraction({
      start_date: '2026-08-23', start_session: 'Sáng', end_date: '2026-08-23', end_session: 'Sáng',
      reason: 'khám bệnh', handover: 'Nguyễn B'
    }));
    await h.sendText(112, 'Em xin nghỉ sáng mai vì khám bệnh, bàn giao Nguyễn B');
    assert.equal(h.store.getConversation(112).step, 'CONFIRM');

    h.queueExtractionError(Object.assign(new Error('AI_LEAVE_PROVIDER_ERROR'), { code: 'AI_LEAVE_PROVIDER_ERROR' }));
    await h.sendText(112, 'À quên, em muốn đổi thời gian nghỉ');
    await h.pressButton(112, 'confirm');

    assert.equal(h.created.length, 0);
    assert.equal(h.store.getConversation(112), null);
  } finally {
    h.teardown();
  }
});

test('lỗi AI proxy -> không ghi Sheet, thông báo thử lại sau, không lộ chi tiết provider', async () => {
  const h = setupHarness();
  try {
    h.queueExtractionError(Object.assign(new Error('AI_LEAVE_PROVIDER_ERROR'), { code: 'AI_LEAVE_PROVIDER_ERROR' }));
    await h.sendText(105, 'Em xin nghỉ sáng mai');

    assert.equal(h.created.length, 0);
    assert.equal(h.bot.sent.length, 1);
    assert.match(h.bot.sent[0].text, /gửi lại sau ít phút/);
    assert.doesNotMatch(h.bot.sent[0].text, /sk-xt-|api\.xkiro\.com|AI_LEAVE_PROVIDER_ERROR/);
  } finally {
    h.teardown();
  }
});

test('không có cặp model đồng thuận -> không CONFIRM/ghi Sheet và yêu cầu diễn đạt lại', async () => {
  const h = setupHarness();
  try {
    h.queueExtractionError(Object.assign(new Error('AI_LEAVE_NO_CONSENSUS'), { code: 'AI_LEAVE_NO_CONSENSUS' }));
    await h.sendText(121, 'Em xin nghỉ sáng mai');

    assert.equal(h.created.length, 0);
    assert.notEqual(h.store.getConversation(121)?.step, 'CONFIRM');
    assert.match(h.bot.sent.at(-1).text, /chưa có đủ hai model đồng thuận/i);
    assert.doesNotMatch(h.bot.sent.at(-1).text, /response|Authorization|sk-xt-|AI_LEAVE_NO_CONSENSUS/i);
  } finally {
    h.teardown();
  }
});

test('lỗi AI khi xử lý tin làm rõ không làm mất tin khỏi lịch sử draft', async () => {
  const h = setupHarness();
  try {
    h.queueExtraction(extraction({
      start_date: '2026-08-23', start_session: 'Sáng', end_date: '2026-08-23', end_session: 'Sáng',
      handover: 'Nguyễn B'
    }));
    await h.sendText(114, 'Em xin nghỉ sáng mai, bàn giao Nguyễn B');
    assert.equal(h.store.getConversation(114).step, 'AWAITING_CLARIFICATION');

    h.queueExtractionError(Object.assign(new Error('AI_LEAVE_PROVIDER_ERROR'), { code: 'AI_LEAVE_PROVIDER_ERROR' }));
    await h.sendText(114, 'Lý do là khám bệnh');

    assert.deepEqual(h.store.getConversation(114).data.messages, [
      'Em xin nghỉ sáng mai, bàn giao Nguyễn B',
      'Lý do là khám bệnh'
    ]);
    assert.equal(h.created.length, 0);
  } finally {
    h.teardown();
  }
});

test('hỏi lại quá 3 lần cùng 1 nhóm -> dừng hỏi, gợi ý /huy', async () => {
  const h = setupHarness();
  try {
    for (let i = 0; i < 4; i += 1) {
      h.queueExtraction(extraction());
      await h.sendText(106, `lần ${i}`);
    }
    const conv = h.store.getConversation(106);
    assert.equal(conv.step, 'AWAITING_CLARIFICATION');
    assert.equal(conv.data.askCounts.TIME, 4);
    assert.match(h.bot.sent.at(-1).text, /gõ \/huy/);
  } finally {
    h.teardown();
  }
});

test('bộ đếm hỏi lại reset khi nhóm cần làm rõ thay đổi', async () => {
  const h = setupHarness();
  try {
    h.queueExtraction(extraction());
    await h.sendText(120, 'Em xin nghỉ');
    h.queueExtraction(extraction());
    await h.sendText(120, 'chưa rõ ngày');
    assert.equal(h.store.getConversation(120).data.askCounts.TIME, 2);

    h.queueExtraction(extraction({
      start_date: '2026-08-23', reason: null, handover: 'Lan'
    }));
    await h.sendText(120, 'ngày mai');
    assert.equal(h.store.getConversation(120).data.pendingField, 'REASON');

    h.queueExtraction(extraction());
    await h.sendText(120, 'em chưa có lý do');
    assert.equal(h.store.getConversation(120).data.pendingField, 'TIME');
    assert.equal(h.store.getConversation(120).data.askCounts.TIME, 1);
  } finally {
    h.teardown();
  }
});

test('chưa liên kết tài khoản -> báo hướng dẫn liên kết, không gọi AI', async () => {
  const h = setupHarness({ link: null });
  try {
    await h.sendText(107, 'Em xin nghỉ sáng mai');
    assert.equal(h.getExtractionCalls(), 0);
    assert.match(h.bot.sent[0].text, /chưa liên kết tài khoản/i);
  } finally {
    h.teardown();
  }
});

test('xác nhận -> ghi Sheet với tin_nhan nối các tin nhắn, đúng field, xóa draft', async () => {
  const h = setupHarness();
  try {
    h.queueExtraction(extraction({ start_date: '2026-08-23', start_session: 'Sáng', end_date: '2026-08-23', end_session: 'Sáng' }));
    await h.sendText(108, 'Em xin nghỉ sáng mai');
    h.queueExtraction(extraction({
      start_date: '2026-08-23', start_session: 'Sáng', end_date: '2026-08-23', end_session: 'Sáng', reason_declined: true
    }));
    await h.sendText(108, 'không có');
    h.queueExtraction(extraction({
      start_date: '2026-08-23', start_session: 'Sáng', end_date: '2026-08-23', end_session: 'Sáng',
      reason_declined: true, handover_declined: true
    }));
    await h.sendText(108, 'không cần');

    assert.equal(h.store.getConversation(108).step, 'CONFIRM');
    await h.pressButton(108, 'confirm');

    assert.equal(h.created.length, 1);
    assert.equal(h.created[0].tin_nhan, 'Em xin nghỉ sáng mai | không có | không cần');
    assert.equal(h.created[0].tong_buoi_nghi, 1);
    assert.equal(h.created[0].ly_do, '');
    assert.equal(h.created[0].nguoi_ban_giao, '');
    assert.equal(h.store.getConversation(108), null);
  } finally {
    h.teardown();
  }
});

test('xử lý tuần tự các tin nhắn đến sát nhau trong cùng một chat', async () => {
  const h = setupHarness();
  try {
    let releaseFirst;
    const firstGate = new Promise(resolve => { releaseFirst = resolve; });
    h.queueExtractionAsync(async () => {
      await firstGate;
      return extraction({
        start_date: '2026-08-23', start_session: 'Sáng', end_date: '2026-08-23', end_session: 'Sáng',
        reason: 'a', handover: 'b'
      });
    });
    h.queueExtraction(extraction({
      start_date: '2026-08-24', start_session: 'Chiều', end_date: '2026-08-24', end_session: 'Chiều',
      reason: 'c', handover: 'd'
    }));

    const p1 = h.sendText(111, 'tin 1');
    await new Promise(resolve => setImmediate(resolve));
    const p2 = h.sendText(111, 'tin 2');
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(h.bot.sent.length, 0, 'chưa gửi gì vì tin 1 còn đang chờ AI');

    releaseFirst();
    await p1;
    await p2;

    assert.equal(h.bot.sent.length, 2);
  } finally {
    h.teardown();
  }
});

test('/xinnghi chỉ gửi hướng dẫn ví dụ câu, không tạo trạng thái hội thoại', async () => {
  const h = setupHarness();
  try {
    await h.bot.triggerText('/xinnghi', { chatId: 109 });
    assert.equal(h.store.getConversation(109), null);
    assert.match(h.bot.sent[0].text, /gõ một câu tự nhiên/);
  } finally {
    h.teardown();
  }
});

test('/start hướng dẫn ví dụ câu tự nhiên thay vì yêu cầu gõ /xinnghi trước', async () => {
  const h = setupHarness();
  try {
    await h.bot.triggerText('/start', { chatId: 110 });
    assert.match(h.bot.sent[0].text, /gõ một câu tự nhiên để xin nghỉ, ví dụ/);
  } finally {
    h.teardown();
  }
});
