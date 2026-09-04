'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractLeaveMessage,
  LeaveAiConsensusError
} = require('./leaveAiConsensusExtractor');

const MODELS = ['model-a', 'model-b', 'model-c', 'model-d', 'model-e'];
const CONTEXT = {
  messageTime: '2026-08-31T08:00:00+07:00',
  timeZone: 'Asia/Bangkok',
  noticeHours: 10
};

function extraction(overrides = {}) {
  return {
    intent: 'leave_request',
    start_date: '2026-09-01',
    start_session: 'Sáng',
    end_date: '2026-09-01',
    end_session: 'Sáng',
    duration_value: null,
    duration_unit: null,
    reason: 'việc cá nhân',
    handover: 'Lan',
    reason_declined: false,
    handover_declined: false,
    confidence: 0.9,
    ...overrides
  };
}

function other(overrides = {}) {
  return extraction({
    intent: 'other',
    start_date: null,
    start_session: null,
    end_date: null,
    end_session: null,
    reason: null,
    handover: null,
    confidence: 0.95,
    ...overrides
  });
}

function noConsensusCode(err) {
  return err instanceof LeaveAiConsensusError && err.code === 'AI_LEAVE_NO_CONSENSUS';
}

test('trả sớm khi hai vote hợp lệ khớp và abort ba request còn lại', async () => {
  const aborted = [];
  const extractOne = async (_text, _context, { model, signal }) => {
    if (model === 'model-a') return extraction({ confidence: 0.91, reason: 'a' });
    if (model === 'model-b') return extraction({ confidence: 0.97, reason: 'b' });
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        aborted.push(model);
        reject(Object.assign(new Error('aborted'), { code: 'AI_LEAVE_ABORTED' }));
      }, { once: true });
    });
  };

  const result = await extractLeaveMessage('xin nghỉ', CONTEXT, { models: MODELS, extractOne });

  assert.equal(result.reason, 'b');
  assert.deepEqual(aborted.sort(), ['model-c', 'model-d', 'model-e']);
});

test('response đến sau tạo cặp khi các response đầu bất đồng', async () => {
  const fixtures = {
    'model-a': extraction({ start_date: '2026-09-01', end_date: '2026-09-01', reason: 'a' }),
    'model-b': extraction({ start_date: '2026-09-02', end_date: '2026-09-02', reason: 'b' }),
    'model-c': extraction({ start_date: '2026-09-01', end_date: '2026-09-01', reason: 'c', confidence: 0.95 })
  };
  const extractOne = async (_text, _context, { model, signal }) => {
    if (fixtures[model]) return fixtures[model];
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  };

  const result = await extractLeaveMessage('xin nghỉ', CONTEXT, { models: MODELS, extractOne });

  assert.equal(result.reason, 'c');
  assert.equal(result.start_date, '2026-09-01');
});

test('confidence cao hơn thắng trong cặp đồng thuận', async () => {
  const extractOne = async (_text, _context, { model, signal }) => {
    if (model === 'model-a') return extraction({ confidence: 0.8, reason: 'confidence thấp hơn' });
    if (model === 'model-b') return extraction({ confidence: 0.99, reason: 'confidence cao hơn' });
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  };

  const result = await extractLeaveMessage('xin nghỉ', CONTEXT, { models: MODELS, extractOne });
  assert.equal(result.reason, 'confidence cao hơn');
});

test('latency thấp hơn thắng khi confidence bằng nhau', async () => {
  const extractOne = async (_text, _context, { model, signal }) => {
    if (model === 'model-a') {
      await new Promise(resolve => setTimeout(resolve, 5));
      return extraction({ reason: 'nhanh' });
    }
    if (model === 'model-b') {
      await new Promise(resolve => setTimeout(resolve, 15));
      return extraction({ reason: 'chậm' });
    }
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  };

  const result = await extractLeaveMessage('xin nghỉ', CONTEXT, { models: MODELS, extractOne });
  assert.equal(result.reason, 'nhanh');
});

test('vote lỗi, confidence thấp và interval mâu thuẫn bị loại', async () => {
  const fixtures = {
    'model-a': extraction({ confidence: 0.6 }),
    'model-b': extraction({ start_date: '2026-09-02', end_date: '2026-09-01' }),
    'model-c': new Error('provider secret'),
    'model-d': extraction({ start_date: '2026-09-03', end_date: '2026-09-03' }),
    'model-e': extraction({ start_date: '2026-09-04', end_date: '2026-09-04' })
  };
  const extractOne = async (_text, _context, { model }) => {
    const fixture = fixtures[model];
    if (fixture instanceof Error) throw fixture;
    return fixture;
  };

  await assert.rejects(
    extractLeaveMessage('xin nghỉ', CONTEXT, { models: MODELS, extractOne }),
    noConsensusCode
  );
});

test('hai vote intent other đồng thuận mà không gọi resolver', async () => {
  let resolverCalls = 0;
  const extractOne = async (_text, _context, { model, signal }) => {
    if (model === 'model-a' || model === 'model-b') return other({ confidence: model === 'model-a' ? 0.9 : 0.96 });
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  };

  const result = await extractLeaveMessage('chào bot', CONTEXT, {
    models: MODELS,
    extractOne,
    resolver() { resolverCalls += 1; throw new Error('không được gọi'); }
  });

  assert.equal(result.intent, 'other');
  assert.equal(result.confidence, 0.96);
  assert.equal(resolverCalls, 0);
});

test('array model rỗng fallback sang AI_LEAVE_API_MODEL đơn', async () => {
  const calls = [];
  const expected = extraction({ reason: 'fallback' });
  const result = await extractLeaveMessage('xin nghỉ', CONTEXT, {
    models: [],
    singleModel: 'fallback-model',
    extractOne: async (_text, _context, dependencies) => {
      calls.push(dependencies.model);
      return expected;
    }
  });

  assert.equal(result, expected);
  assert.deepEqual(calls, ['fallback-model']);
});
