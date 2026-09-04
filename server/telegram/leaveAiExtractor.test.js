'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  extractLeaveMessage,
  LeaveAiExtractionError
} = require('./leaveAiExtractor');

const validExtraction = {
  intent: 'leave_request',
  start_date: '2026-08-23',
  start_session: 'Sáng',
  end_date: null,
  end_session: null,
  duration_value: null,
  duration_unit: null,
  reason: 'khám bệnh',
  handover: null,
  reason_declined: false,
  handover_declined: false,
  confidence: 0.98
};

function responseFor(data) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { role: 'assistant', content: JSON.stringify(data) } }]
    })
  };
}

function dependencies(fetch) {
  return { fetch, apiKey: 'test-key', baseUrl: 'https://api.xkiro.com/v1', model: 'test-model', timeoutMs: 20 };
}

function errorCode(code) {
  return err => err instanceof LeaveAiExtractionError && err.code === code;
}

test('config parse danh sách model xKiro từ biến môi trường', () => {
  const models = [
    'deepseek/deepseek-v4-pro',
    'deepseek/deepseek-v4-flash',
    'qwen/qwen3-max:free',
    'mistralai/mistral-small-2603',
    'mistralai/mistral-medium-3.5'
  ];
  const stdout = execFileSync(process.execPath, [
    '-e',
    'process.stdout.write(JSON.stringify(require("./config").AI_LEAVE_API_MODELS))'
  ], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: {
      NODE_ENV: 'production',
      SPREADSHEET_ID: 'test-sheet',
      GOOGLE_SERVICE_ACCOUNT_JSON: '{}',
      JWT_SECRET: 'test-secret',
      DATABASE_URL: 'postgresql://test',
      AI_LEAVE_API_MODELS: ` ${models[0]},${models[1]}, ${models[2]},${models[3]}, ${models[4]} `
    }
  });

  assert.deepEqual(JSON.parse(stdout), models);
});

test('gửi đúng endpoint/hợp đồng xKiro (Bearer, response_format json_object, temperature 0)', async () => {
  let request;
  const fakeFetch = async (url, options) => {
    request = { url, headers: options.headers, body: JSON.parse(options.body) };
    return responseFor(validExtraction);
  };

  const result = await extractLeaveMessage('Em xin nghỉ sáng mai vì khám bệnh', {
    messageTime: '2026-08-22T08:00:00+07:00', timeZone: 'Asia/Bangkok'
  }, dependencies(fakeFetch));

  assert.equal(request.url, 'https://api.xkiro.com/v1/chat/completions');
  assert.equal(request.headers.Authorization, 'Bearer test-key');
  assert.equal(request.body.model, 'test-model');
  assert.equal(request.body.response_format.type, 'json_object');
  assert.equal(request.body.temperature, 0);
  assert.equal(request.body.messages[0].role, 'system');
  assert.equal(request.body.messages[1].role, 'user');
  assert.equal(request.body.messages[1].content, 'Em xin nghỉ sáng mai vì khám bệnh');
  assert.match(request.body.messages[0].content, /2026-08-22T08:00:00\+07:00/);
  assert.equal(result.start_date, '2026-08-23');
  assert.equal(result.start_session, 'Sáng');
  assert.equal(result.reason, 'khám bệnh');
});

test('từ chối khi AI proxy chưa được cấu hình', async () => {
  await assert.rejects(
    extractLeaveMessage('Em xin nghỉ', { messageTime: '2026-08-22T08:00:00+07:00', timeZone: 'Asia/Bangkok' },
      { fetch: async () => responseFor(validExtraction), apiKey: null }),
    errorCode('AI_LEAVE_NOT_CONFIGURED')
  );
});

test('ẩn phản hồi nhà cung cấp khi AI proxy trả lỗi HTTP', async () => {
  await assert.rejects(
    extractLeaveMessage('Tin nhắn riêng tư', { messageTime: '2026-08-22T08:00:00+07:00', timeZone: 'Asia/Bangkok' },
      dependencies(async () => ({ ok: false, status: 429, text: async () => 'provider secret body' }))),
    err => errorCode('AI_LEAVE_PROVIDER_ERROR')(err) && !err.message.includes('provider secret body') && !err.message.includes('Tin nhắn riêng tư')
  );
});

test('chuyển abort thành lỗi hết thời gian', async () => {
  const fakeFetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });

  await assert.rejects(
    extractLeaveMessage('Em xin nghỉ', { messageTime: '2026-08-22T08:00:00+07:00', timeZone: 'Asia/Bangkok' }, dependencies(fakeFetch)),
    errorCode('AI_LEAVE_TIMEOUT')
  );
});

test('external abort được chuẩn hóa riêng với timeout', async () => {
  const controller = new AbortController();
  const fakeFetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('external secret'), { name: 'AbortError' })));
  });
  const promise = extractLeaveMessage(
    'Em xin nghỉ',
    { messageTime: '2026-08-22T08:00:00+07:00', timeZone: 'Asia/Bangkok' },
    { ...dependencies(fakeFetch), signal: controller.signal, timeoutMs: 50 }
  );
  controller.abort();

  await assert.rejects(
    promise,
    err => errorCode('AI_LEAVE_ABORTED')(err) && !err.message.includes('external secret')
  );
});

test('chuyển abort khi đang đọc JSON thành lỗi hết thời gian', async () => {
  const fakeFetch = async (_url, options) => ({
    ok: true,
    json: () => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })
  });

  await assert.rejects(
    extractLeaveMessage('Em xin nghỉ', { messageTime: '2026-08-22T08:00:00+07:00', timeZone: 'Asia/Bangkok' }, dependencies(fakeFetch)),
    errorCode('AI_LEAVE_TIMEOUT')
  );
});

test('từ chối phản hồi thiếu choices', async () => {
  await assert.rejects(
    extractLeaveMessage('Em xin nghỉ', { messageTime: '2026-08-22T08:00:00+07:00', timeZone: 'Asia/Bangkok' },
      dependencies(async () => ({ ok: true, json: async () => ({}) }))),
    errorCode('AI_LEAVE_INVALID_RESPONSE')
  );
});

test('từ chối phản hồi có khóa thừa', async () => {
  await assert.rejects(
    extractLeaveMessage('Em xin nghỉ', { messageTime: '2026-08-22T08:00:00+07:00', timeZone: 'Asia/Bangkok' },
      dependencies(async () => responseFor({ ...validExtraction, extra: true }))),
    errorCode('AI_LEAVE_INVALID_RESPONSE')
  );
});

test('từ chối thiếu reason_declined/handover_declined', async () => {
  const { reason_declined, ...withoutDeclined } = validExtraction;
  await assert.rejects(
    extractLeaveMessage('Em xin nghỉ', { messageTime: '2026-08-22T08:00:00+07:00', timeZone: 'Asia/Bangkok' },
      dependencies(async () => responseFor(withoutDeclined))),
    errorCode('AI_LEAVE_INVALID_RESPONSE')
  );
});

test('từ chối reason_declined không phải boolean', async () => {
  await assert.rejects(
    extractLeaveMessage('Em xin nghỉ', { messageTime: '2026-08-22T08:00:00+07:00', timeZone: 'Asia/Bangkok' },
      dependencies(async () => responseFor({ ...validExtraction, reason_declined: 'true' }))),
    errorCode('AI_LEAVE_INVALID_RESPONSE')
  );
});

test('từ chối enum không hợp lệ', async () => {
  await assert.rejects(
    extractLeaveMessage('Em xin nghỉ', { messageTime: '2026-08-22T08:00:00+07:00', timeZone: 'Asia/Bangkok' },
      dependencies(async () => responseFor({ ...validExtraction, start_session: 'Tối' }))),
    errorCode('AI_LEAVE_INVALID_RESPONSE')
  );
});

test('từ chối confidence không phải số', async () => {
  await assert.rejects(
    extractLeaveMessage('Em xin nghỉ', { messageTime: '2026-08-22T08:00:00+07:00', timeZone: 'Asia/Bangkok' },
      dependencies(async () => responseFor({ ...validExtraction, confidence: '0.98' }))),
    errorCode('AI_LEAVE_INVALID_RESPONSE')
  );
});

test('từ chối ngày lịch không tồn tại', async () => {
  await assert.rejects(
    extractLeaveMessage('Em xin nghỉ', { messageTime: '2026-08-22T08:00:00+07:00', timeZone: 'Asia/Bangkok' },
      dependencies(async () => responseFor({ ...validExtraction, start_date: '2026-02-31' }))),
    errorCode('AI_LEAVE_INVALID_RESPONSE')
  );
});

test('từ chối JSON sai định dạng', async () => {
  await assert.rejects(
    extractLeaveMessage('Em xin nghỉ', { messageTime: '2026-08-22T08:00:00+07:00', timeZone: 'Asia/Bangkok' },
      dependencies(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{not json' } }] }) }))),
    errorCode('AI_LEAVE_INVALID_RESPONSE')
  );
});

test('đọc JSON hợp lệ trong một Markdown fence', async () => {
  const result = await extractLeaveMessage('Em xin nghỉ', { messageTime: '2026-08-22T08:00:00+07:00', timeZone: 'Asia/Bangkok' },
    dependencies(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: `\`\`\`json\n${JSON.stringify(validExtraction)}\n\`\`\`` } }] })
    })));
  assert.deepEqual(result, validExtraction);
});

test('chuẩn hóa chuỗi lý do và bàn giao tùy chọn', async () => {
  const result = await extractLeaveMessage('Em xin nghỉ', { messageTime: '2026-08-22T08:00:00+07:00', timeZone: 'Asia/Bangkok' },
    dependencies(async () => responseFor({ ...validExtraction, reason: '  khám bệnh  ', handover: ' \t ' })));

  assert.equal(result.reason, 'khám bệnh');
  assert.equal(result.handover, null);
});

test('trả intent other với các trường ngữ nghĩa tùy chọn là null', async () => {
  const result = await extractLeaveMessage('Chào cả nhà', { messageTime: '2026-08-22T08:00:00+07:00', timeZone: 'Asia/Bangkok' },
    dependencies(async () => responseFor({
      intent: 'other',
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
      confidence: 0.99
    })));

  assert.equal(result.intent, 'other');
  assert.equal(result.reason, null);
  assert.equal(result.handover, null);
});

test('nhận diện reason_declined/handover_declined khi nhân viên chủ động từ chối cung cấp', async () => {
  const result = await extractLeaveMessage('Em xin nghỉ mai, không có lý do, không cần bàn giao', {
    messageTime: '2026-08-22T08:00:00+07:00', timeZone: 'Asia/Bangkok'
  }, dependencies(async () => responseFor({
    ...validExtraction,
    reason: null,
    handover: null,
    reason_declined: true,
    handover_declined: true
  })));

  assert.equal(result.reason, null);
  assert.equal(result.handover, null);
  assert.equal(result.reason_declined, true);
  assert.equal(result.handover_declined, true);
});
