'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');

test('doi Telegram gui cau hoi tiep theo xong moi hoan tat xu ly tin nhan', async () => {
  const telegramModulePath = require.resolve('node-telegram-bot-api');
  const botModulePath = require.resolve('./hrTelegramBot');
  const config = require('../config');
  const store = require('./conversationStore');
  const previousTelegramModule = require.cache[telegramModulePath];
  const previousToken = config.TELEGRAM_BOT_TOKEN;
  const tmpFile = path.join(os.tmpdir(), `tks-hr-bot-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

  let releaseSend;
  class FakeTelegramBot extends EventEmitter {
    onText() {}

    sendMessage() {
      return new Promise(resolve => {
        releaseSend = resolve;
      });
    }
  }

  try {
    require.cache[telegramModulePath] = {
      id: telegramModulePath,
      filename: telegramModulePath,
      loaded: true,
      exports: FakeTelegramBot
    };
    config.TELEGRAM_BOT_TOKEN = 'test-token';
    store.initStore(tmpFile);
    store.setConversation(123, {
      step: 'AWAITING_END_DATE',
      data: {
        startDate: new Date(2026, 7, 22, 0, 0),
        startSession: 'Sáng',
        messageTime: new Date(2026, 7, 21, 16, 0).toISOString()
      }
    });

    delete require.cache[botModulePath];
    const { startHrTelegramBot } = require('./hrTelegramBot');
    const bot = startHrTelegramBot();
    const messageHandler = bot.listeners('message')[0];
    let finished = false;

    const processing = messageHandler({ chat: { id: 123 }, text: '23/08/2026' })
      .then(() => { finished = true; });
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(finished, false, 'khong duoc ket thuc handler khi sendMessage van dang cho');
    releaseSend();
    await processing;
    assert.equal(store.getConversation(123).step, 'AWAITING_END_SESSION');
  } finally {
    config.TELEGRAM_BOT_TOKEN = previousToken;
    store.initStore();
    delete require.cache[botModulePath];
    if (previousTelegramModule) require.cache[telegramModulePath] = previousTelegramModule;
    else delete require.cache[telegramModulePath];
    fs.rmSync(tmpFile, { force: true });
  }
});

test('xu ly tuan tu cac tin nhan den sat nhau trong cung mot chat', async () => {
  const telegramModulePath = require.resolve('node-telegram-bot-api');
  const botModulePath = require.resolve('./hrTelegramBot');
  const config = require('../config');
  const store = require('./conversationStore');
  const previousTelegramModule = require.cache[telegramModulePath];
  const previousToken = config.TELEGRAM_BOT_TOKEN;
  const tmpFile = path.join(os.tmpdir(), `tks-hr-bot-queue-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

  let releaseFirstSend;
  let sendCount = 0;
  class FakeTelegramBot extends EventEmitter {
    onText() {}

    sendMessage() {
      sendCount += 1;
      if (sendCount === 1) {
        return new Promise(resolve => {
          releaseFirstSend = resolve;
        });
      }
      return Promise.resolve();
    }
  }

  try {
    require.cache[telegramModulePath] = {
      id: telegramModulePath,
      filename: telegramModulePath,
      loaded: true,
      exports: FakeTelegramBot
    };
    config.TELEGRAM_BOT_TOKEN = 'test-token';
    store.initStore(tmpFile);
    store.setConversation(456, {
      step: 'AWAITING_REASON',
      data: {
        identity: { hoTen: 'Test User', chucVu: 'NV' },
        link: { telegram_username: '@test', web_username: 'test' },
        messageTime: new Date(2026, 7, 21, 16, 0).toISOString()
      }
    });

    delete require.cache[botModulePath];
    const { startHrTelegramBot } = require('./hrTelegramBot');
    const bot = startHrTelegramBot();
    const messageHandler = bot.listeners('message')[0];

    const reasonProcessing = messageHandler({ chat: { id: 456 }, text: 'Đổi ca' });
    await new Promise(resolve => setImmediate(resolve));
    const dateProcessing = messageHandler({ chat: { id: 456 }, text: '22/08/2026' });
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(sendCount, 1, 'tin nhan thu hai phai cho tin nhan truoc xu ly xong');
    releaseFirstSend();
    await Promise.all([reasonProcessing, dateProcessing]);

    const conversation = store.getConversation(456);
    assert.equal(conversation.step, 'AWAITING_START_SESSION');
    assert.equal(conversation.data.ly_do, 'Đổi ca');
    assert.equal(conversation.data.startDate.getFullYear(), 2026);
    assert.equal(conversation.data.startDate.getMonth(), 7);
    assert.equal(conversation.data.startDate.getDate(), 22);
  } finally {
    config.TELEGRAM_BOT_TOKEN = previousToken;
    store.initStore();
    delete require.cache[botModulePath];
    if (previousTelegramModule) require.cache[telegramModulePath] = previousTelegramModule;
    else delete require.cache[telegramModulePath];
    fs.rmSync(tmpFile, { force: true });
  }
});

test('normalizeSession nhan dang buoi sang va chieu chinh xac', () => {
  const { normalizeSession } = require('./hrTelegramBot').__test__;

  assert.equal(normalizeSession('S\u00e1ng'), 'S\u00e1ng');
  assert.equal(normalizeSession('Chi\u1ec1u'), 'Chi\u1ec1u');
  assert.equal(normalizeSession('sang'), 'S\u00e1ng');
  assert.equal(normalizeSession('chieu'), 'Chi\u1ec1u');
  assert.equal(normalizeSession('SANG'), 'S\u00e1ng');
  assert.equal(normalizeSession('CHIEU'), 'Chi\u1ec1u');
  assert.equal(normalizeSession('s'), 'S\u00e1ng');
  assert.equal(normalizeSession('c'), 'Chi\u1ec1u');
  assert.equal(normalizeSession('am'), 'S\u00e1ng');
  assert.equal(normalizeSession('pm'), 'Chi\u1ec1u');
  assert.equal(normalizeSession('buoi sang'), null);
  assert.equal(normalizeSession(''), null);
  assert.equal(normalizeSession('abc'), null);
});

test('parseVietnameseDate tu choi ngay khong ton tai', () => {
  const { parseVietnameseDate } = require('./hrTelegramBot').__test__;
  assert.equal(parseVietnameseDate('31/02/2026'), null);
  assert.equal(parseVietnameseDate('29/02/2025'), null);
  assert.equal(parseVietnameseDate('29/02/2024').getDate(), 29);
});

test('markProcessed tach message_id theo tung chat', () => {
  const hooks = require('./hrTelegramBot').__test__;
  hooks.clearProcessedMessageIds();
  assert.equal(hooks.markProcessed(100, 7), false);
  assert.equal(hooks.markProcessed(100, 7), true);
  assert.equal(hooks.markProcessed(200, 7), false);
});

test('tom tat hien dung tong buoi va canh bao don gui sau gio bat dau', async () => {
  const hooks = require('./hrTelegramBot').__test__;
  const sent = [];
  const conv = { step: 'AWAITING_HANDOVER', data: {
    identity: { hoTen: 'Test User', chucVu: 'Nhân viên' },
    ly_do: 'Việc gia đình',
    messageTime: new Date(2026, 7, 22, 8, 0).toISOString(),
    startDate: new Date(2026, 7, 22), startSession: 'Sáng',
    endDate: new Date(2026, 7, 22), endSession: 'Chiều',
    tong_buoi_nghi: 2
  } };

  await hooks.handleConversationStep({ sendMessage: async (_chatId, text) => { sent.push(text); } }, 1, conv, 'Nguyễn B');
  assert.equal(conv.data.co_vi_pham, true);
  assert.match(sent[0], /Tổng buổi nghỉ: 2 buổi \(1 ngày\)/);
  assert.match(sent[0], /không hợp lệ/);
  assert.match(sent[0], /07:45/);
});

test('submitLeaveRequest ghi don gui tre voi trang thai Vi pham va schema moi', async () => {
  const botModule = require('./hrTelegramBot');
  const repo = require('../hr/hrLeaveRepository');
  const store = require('./conversationStore');
  const originalCreate = repo.createLeaveRequest;
  const tmpFile = path.join(os.tmpdir(), `tks-hr-bot-submit-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  let received;
  repo.createLeaveRequest = async payload => {
    received = payload;
    return { request_id: 'NP-TEST', ...payload };
  };
  store.initStore(tmpFile);
  store.setConversation(777, { step: 'CONFIRM', data: {} });
  const sent = [];
  const bot = { sendMessage: async (_chatId, text) => { sent.push(text); } };
  const conv = {
    data: {
      link: { telegram_username: '@tester', web_username: 'tester' },
      identity: { hoTen: 'Test User', chucVu: 'Nhân viên' },
      ly_do: 'Việc gia đình',
      messageTime: new Date(2026, 7, 22, 8, 0).toISOString(),
      startDate: new Date(2026, 7, 22),
      startSession: 'Sáng',
      endDate: new Date(2026, 7, 22),
      endSession: 'Chiều',
      tong_buoi_nghi: 2,
      nguoi_ban_giao: 'Nguyễn B',
      co_nghi_gap: true,
      co_vi_pham: true
    }
  };

  try {
    const succeeded = await botModule.__test__.submitLeaveRequest(bot, 777, conv);
    assert.equal(succeeded, true);
    assert.equal(received.thoi_gian_gui, conv.data.messageTime);
    assert.equal(received.thoi_gian_bat_dau, 'Sáng 22/08/2026');
    assert.equal(received.thoi_gian_ket_thuc, 'Chiều 22/08/2026');
    assert.equal(received.tong_buoi_nghi, 2);
    assert.equal(received.trang_thai, repo.LEAVE_STATUS.VIOLATION);
    assert.equal(store.getConversation(777), null);
    assert.match(sent[0], /Vi phạm/);
  } finally {
    repo.createLeaveRequest = originalCreate;
    store.initStore();
    fs.rmSync(tmpFile, { force: true });
  }
});

test('submitLeaveRequest khong tao trung khi Sheet da ghi nhung Telegram gui xac nhan loi', async () => {
  const botModule = require('./hrTelegramBot');
  const repo = require('../hr/hrLeaveRepository');
  const store = require('./conversationStore');
  const originalCreate = repo.createLeaveRequest;
  const tmpFile = path.join(os.tmpdir(), `tks-hr-bot-send-fail-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  let createCount = 0;
  repo.createLeaveRequest = async payload => { createCount += 1; return { request_id: 'NP-WRITTEN', ...payload }; };
  store.initStore(tmpFile);
  const conv = { data: {
    link: { telegram_username: '@tester', web_username: 'tester' },
    identity: { hoTen: 'Test User', chucVu: 'Nhân viên' },
    ly_do: 'Việc gia đình', messageTime: new Date(2026, 7, 21, 8).toISOString(),
    startDate: new Date(2026, 7, 22), startSession: 'Sáng',
    endDate: new Date(2026, 7, 22), endSession: 'Sáng', tong_buoi_nghi: 1,
    nguoi_ban_giao: 'Nguyễn B', co_nghi_gap: false, co_vi_pham: false
  } };
  store.setConversation(778, conv);

  try {
    const succeeded = await botModule.__test__.submitLeaveRequest({ sendMessage: async () => { throw new Error('Telegram down'); } }, 778, conv);
    assert.equal(succeeded, true);
    assert.equal(createCount, 1);
    assert.equal(store.getConversation(778), null, 'da ghi Sheet thi phai dong phien de tranh bam lai tao trung');
  } finally {
    repo.createLeaveRequest = originalCreate;
    store.initStore();
    fs.rmSync(tmpFile, { force: true });
  }
});

test('submitLeaveRequest giu phien khi ghi Sheet that bai de nguoi dung thu lai', async () => {
  const botModule = require('./hrTelegramBot');
  const repo = require('../hr/hrLeaveRepository');
  const store = require('./conversationStore');
  const originalCreate = repo.createLeaveRequest;
  const tmpFile = path.join(os.tmpdir(), `tks-hr-bot-sheet-fail-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  repo.createLeaveRequest = async () => { throw new Error('Sheet down'); };
  const conv = { data: {
    link: { telegram_username: '@tester', web_username: 'tester' },
    identity: { hoTen: 'Test User', chucVu: 'Nhân viên' },
    ly_do: 'Việc gia đình', messageTime: new Date(2026, 7, 21, 8).toISOString(),
    startDate: new Date(2026, 7, 22), startSession: 'Sáng',
    endDate: new Date(2026, 7, 22), endSession: 'Sáng', tong_buoi_nghi: 1,
    nguoi_ban_giao: 'Nguyễn B', co_nghi_gap: false, co_vi_pham: false
  } };
  store.initStore(tmpFile);
  store.setConversation(779, conv);

  try {
    const succeeded = await botModule.__test__.submitLeaveRequest({ sendMessage: async () => {} }, 779, conv);
    assert.equal(succeeded, false);
    assert.ok(store.getConversation(779));
  } finally {
    repo.createLeaveRequest = originalCreate;
    store.initStore();
    fs.rmSync(tmpFile, { force: true });
  }
});

test('computeDurationSessions tra so buoi va loai tru Chu nhat', () => {
  const { computeDurationSessions } = require('../hr/hrLeaveService');

  const d = (y, m, day) => new Date(y, m - 1, day);

  // Thu Bay 22/08/2026 van la ngay lam viec.
  assert.equal(computeDurationSessions(d(2026,8,22), 'S\u00e1ng', d(2026,8,22), 'S\u00e1ng'), 1);

  assert.equal(computeDurationSessions(d(2026,8,22), 'Chi\u1ec1u', d(2026,8,22), 'Chi\u1ec1u'), 1);

  assert.equal(computeDurationSessions(d(2026,8,22), 'S\u00e1ng', d(2026,8,22), 'Chi\u1ec1u'), 2);

  // Chieu - Sang cung ngay: khong hop le
  assert.equal(computeDurationSessions(d(2026,8,22), 'Chi\u1ec1u', d(2026,8,22), 'S\u00e1ng'), null);

  // Chu nhat 23/08 bi loai: Chieu Thu Bay + Sang Thu Hai = 2 buoi.
  assert.equal(computeDurationSessions(d(2026,8,22), 'Chi\u1ec1u', d(2026,8,24), 'S\u00e1ng'), 2);

  assert.equal(computeDurationSessions(d(2026,8,22), 'S\u00e1ng', d(2026,8,24), 'Chi\u1ec1u'), 4);

  // Khoang chi co Chu nhat khong co buoi nghi hop le.
  assert.equal(computeDurationSessions(d(2026,8,23), 'S\u00e1ng', d(2026,8,23), 'Chi\u1ec1u'), 0);

  // 22 -> 25/08 co mot Chu nhat: Thu Bay, Thu Hai, Thu Ba = 6 buoi.
  assert.equal(computeDurationSessions(d(2026,8,22), 'S\u00e1ng', d(2026,8,25), 'Chi\u1ec1u'), 6);

  // Ngay ket thuc truoc ngay bat dau: null
  assert.equal(computeDurationSessions(d(2026,8,25), 'Sáng', d(2026,8,22), 'Chiều'), null);
  assert.equal(computeDurationSessions(null, 'Sáng', d(2026,8,22), 'Chiều'), null);
  assert.equal(computeDurationSessions(d(2026,8,22), 'toi', d(2026,8,22), 'Chiều'), null);
  assert.equal(computeDurationSessions(d(2026,8,22), 'Sáng', d(2026,8,22), 'toi'), null);
});

test('computeSubmissionViolation dung moc 07:45 va 12:30', () => {
  const { computeSubmissionViolation, getSessionStartTime } = require('../hr/hrLeaveService');
  const startDate = new Date(2026, 7, 22);

  assert.equal(getSessionStartTime(startDate, 'Sáng').getHours(), 7);
  assert.equal(getSessionStartTime(startDate, 'Sáng').getMinutes(), 45);
  assert.equal(getSessionStartTime(startDate, 'Chiều').getHours(), 12);
  assert.equal(getSessionStartTime(startDate, 'Chiều').getMinutes(), 30);

  assert.equal(computeSubmissionViolation(new Date(2026, 7, 22, 7, 44), startDate, 'Sáng'), false);
  assert.equal(computeSubmissionViolation(new Date(2026, 7, 22, 7, 45), startDate, 'Sáng'), false);
  assert.equal(computeSubmissionViolation(new Date(2026, 7, 22, 7, 46), startDate, 'Sáng'), true);
  assert.equal(computeSubmissionViolation(new Date(2026, 7, 22, 12, 30), startDate, 'Chiều'), false);
  assert.equal(computeSubmissionViolation(new Date(2026, 7, 22, 12, 31), startDate, 'Chiều'), true);
  assert.equal(computeSubmissionViolation('not-a-date', startDate, 'Sáng'), false);
  assert.equal(getSessionStartTime(null, 'Sáng'), null);
});

test('computeIsUrgent tinh dung voi nguong 10h mac dinh', () => {
  const { computeIsUrgent } = require('../hr/hrLeaveService');

  const startTime = new Date('2026-08-22T08:00:00Z');

  // Nhan tin cach gio nghi 6 tieng (< 10h) => nghi gap (true)
  const msgTime6h = new Date('2026-08-22T02:00:00Z');
  assert.equal(computeIsUrgent(startTime, msgTime6h), true);

  // Nhan tin cach gio nghi 12 tieng (> 10h) => khong nghi gap (false)
  const msgTime12h = new Date('2026-08-21T20:00:00Z');
  assert.equal(computeIsUrgent(startTime, msgTime12h), false);

  // Truyen threshold rieng
  assert.equal(computeIsUrgent(startTime, msgTime12h, 15), true);
  assert.equal(computeIsUrgent(startTime, msgTime6h, 4), false);
});
