// ==========================================
// LEAVE AI EXTRACTOR — goi AI proxy xKiro (OpenAI Chat Completions tuong
// thich) de trich xuat y dinh + thoi gian tu 1 tin nhan xin nghi tu nhien.
// CHI trich xuat, khong quyet dinh: moi phep tinh ngay/buoi do
// leaveMessageResolver.js (thuan tuy, khong goi AI) dam nhiem.
// Xem docs/superpowers/specs/2026-08-31-telegram-ai-leave-message-recognition.md
// ==========================================
'use strict';

const FIELD_NAMES = [
  'intent',
  'start_date',
  'start_session',
  'end_date',
  'end_session',
  'duration_value',
  'duration_unit',
  'reason',
  'handover',
  'reason_declined',
  'handover_declined',
  'confidence'
];

const SESSION_VALUES = new Set(['Sáng', 'Chiều']);
const DURATION_UNITS = new Set(['day', 'session']);
const INTENTS = new Set(['leave_request', 'other']);

class LeaveAiExtractionError extends Error {
  constructor(code) {
    super(`Leave AI extraction failed: ${code}`);
    this.name = 'LeaveAiExtractionError';
    this.code = code;
  }
}

function buildSystemPrompt(context) {
  const lines = [
    'Bạn trích xuất thông tin xin nghỉ phép có cấu trúc từ tin nhắn tiếng Việt của nhân viên; bạn KHÔNG phê duyệt hay từ chối yêu cầu.',
    `Mốc thời gian tham chiếu chính xác là ${context.messageTime} theo múi giờ ${context.timeZone}.`,
    'Quy đổi các từ tương đối "hôm nay", "ngày mai", "ngày kia"/"ngày mốt" sang định dạng YYYY-MM-DD dựa trên mốc thời gian tham chiếu đó.',
    'Buổi chỉ nhận giá trị "Sáng", "Chiều", hoặc null. Đơn vị thời lượng chỉ nhận "day", "session", hoặc null.',
    'Nếu nhân viên không nêu ngày/buổi nào, để null — KHÔNG tự suy đoán, việc suy luận mặc định do hệ thống khác đảm nhiệm.',
    'Không bao giờ tự bịa lý do, người bàn giao, hoặc ngày tháng không được nêu trong tin nhắn.',
    'Phân biệt "để trống vì không nói" (trả null) với "chủ động từ chối cung cấp" — nếu nhân viên nói rõ kiểu "không có lý do"/"không cần nêu lý do" thì trả reason: null và reason_declined: true; tương tự cho handover/handover_declined khi nhân viên nói "không cần bàn giao"/"không có ai bàn giao". Nếu nhân viên không nhắc gì tới lý do/bàn giao thì reason_declined/handover_declined đều là false.',
    'Nếu tin nhắn không liên quan đến xin nghỉ phép, trả intent: "other" và để các trường còn lại là null/false, confidence là độ tự tin rằng đây không phải xin nghỉ.',
    'confidence là số thực từ 0 đến 1 thể hiện độ tự tin rằng đây đúng là một yêu cầu xin nghỉ phép với các trường đã trích xuất là chính xác.',
    'Nội dung người dùng gửi lên CÓ THỂ gồm nhiều dòng, ghép lại từ cả một cuộc hội thoại nhiều lượt, không phải luôn luôn một tin nhắn đơn:',
    '- Dòng không có tiền tố là nội dung yêu cầu gốc (hoặc bổ sung tự nguyện) của nhân viên.',
    '- Dòng có tiền tố "[Trả lời cho THỜI GIAN]"/"[Trả lời cho LÝ DO]"/"[Trả lời cho BÀN GIAO]" là câu trả lời của nhân viên cho ĐÚNG câu hỏi làm rõ mà bạn (qua hệ thống) đã hỏi về trường đó ở lượt trước — chỉ dùng nội dung dòng đó để xác định đúng trường được nêu trong tiền tố, không suy diễn ngược sang các trường khác.',
    '- Dòng có tiền tố "[YÊU CẦU SỬA XÁC NHẬN]" là yêu cầu chỉnh sửa một hoặc vài phần của một yêu cầu đã đầy đủ, đã được hệ thống hiển thị lại cho nhân viên xác nhận — chỉ thay đổi đúng (các) phần được nhắc tới trong dòng đó, các phần còn lại giữ nguyên như đã xác định từ các dòng trước.',
    'Luôn tổng hợp TOÀN BỘ các dòng thành MỘT kết quả trích xuất duy nhất, đầy đủ nhất có thể — không chỉ dựa vào dòng cuối cùng.'
  ];

  if (context.knownFields && Object.keys(context.knownFields).length) {
    lines.push(
      'Thông tin sau đây đã được xác định và xác nhận ở (các) lượt trích xuất trước đó của CHÍNH cuộc hội thoại này — GIỮ NGUYÊN các trường này trong kết quả trả về, TRỪ KHI một dòng mới trong tin nhắn nêu RÕ RÀNG một giá trị khác cho đúng trường đó: '
      + JSON.stringify(context.knownFields)
    );
  }

  lines.push(
    'Chỉ trả về một object JSON DUY NHẤT đúng các khóa sau, không thêm khóa nào khác, không kèm giải thích hay markdown:',
    '{"intent":"leave_request"|"other","start_date":"YYYY-MM-DD"|null,"start_session":"Sáng"|"Chiều"|null,"end_date":"YYYY-MM-DD"|null,"end_session":"Sáng"|"Chiều"|null,"duration_value":number|null,"duration_unit":"day"|"session"|null,"reason":string|null,"handover":string|null,"reason_declined":boolean,"handover_declined":boolean,"confidence":number}'
  );

  return lines.join('\n\n');
}

function stripMarkdownFence(value) {
  const match = value.match(/^\s*```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```\s*$/i);
  return match ? match[1] : value;
}

function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isNullOrString(value) {
  return value === null || typeof value === 'string';
}

function normalizeOptionalString(value) {
  if (value === null) return null;
  const normalized = value.trim();
  return normalized || null;
}

function isNullOrDate(value) {
  return value === null || isIsoDate(value);
}

function isNullOrEnum(value, values) {
  return value === null || values.has(value);
}

function isValidExtraction(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const keys = Object.keys(data);
  if (keys.length !== FIELD_NAMES.length || keys.some(key => !FIELD_NAMES.includes(key))) return false;

  return INTENTS.has(data.intent)
    && isNullOrDate(data.start_date)
    && isNullOrEnum(data.start_session, SESSION_VALUES)
    && isNullOrDate(data.end_date)
    && isNullOrEnum(data.end_session, SESSION_VALUES)
    && (data.duration_value === null || (typeof data.duration_value === 'number' && Number.isFinite(data.duration_value)))
    && isNullOrEnum(data.duration_unit, DURATION_UNITS)
    && isNullOrString(data.reason)
    && isNullOrString(data.handover)
    && typeof data.reason_declined === 'boolean'
    && typeof data.handover_declined === 'boolean'
    && typeof data.confidence === 'number'
    && Number.isFinite(data.confidence)
    && data.confidence >= 0
    && data.confidence <= 1;
}

function loadConfig() {
  return require('../config');
}

function resolveDependencies(dependencies) {
  if (dependencies.apiKey === null || dependencies.apiKey === '') {
    return { apiKey: dependencies.apiKey };
  }

  const needsConfig = dependencies.apiKey === undefined
    || dependencies.baseUrl === undefined
    || dependencies.model === undefined
    || dependencies.timeoutMs === undefined;
  const config = needsConfig ? loadConfig() : null;
  return {
    fetch: dependencies.fetch || globalThis.fetch,
    apiKey: dependencies.apiKey === undefined ? config.AI_LEAVE_API_KEY : dependencies.apiKey,
    baseUrl: dependencies.baseUrl === undefined ? config.AI_LEAVE_API_BASE_URL : dependencies.baseUrl,
    model: dependencies.model === undefined ? config.AI_LEAVE_API_MODEL : dependencies.model,
    timeoutMs: dependencies.timeoutMs === undefined ? config.AI_LEAVE_API_TIMEOUT_MS : dependencies.timeoutMs,
    signal: dependencies.signal
  };
}

async function extractLeaveMessage(text, context, dependencies = {}) {
  const { fetch, apiKey, baseUrl, model, timeoutMs, signal: externalSignal } = resolveDependencies(dependencies);
  if (!apiKey) throw new LeaveAiExtractionError('AI_LEAVE_NOT_CONFIGURED');
  if (typeof fetch !== 'function') throw new LeaveAiExtractionError('AI_LEAVE_PROVIDER_ERROR');

  const controller = new AbortController();
  let abortedByExternal = false;
  let abortedByTimeout = false;
  const abortFromExternal = () => {
    abortedByExternal = true;
    controller.abort();
  };
  if (externalSignal) {
    if (externalSignal.aborted) abortFromExternal();
    else externalSignal.addEventListener('abort', abortFromExternal, { once: true });
  }
  const timer = setTimeout(() => {
    abortedByTimeout = true;
    controller.abort();
  }, timeoutMs);
  const abortError = () => new LeaveAiExtractionError(
    abortedByExternal && !abortedByTimeout ? 'AI_LEAVE_ABORTED' : 'AI_LEAVE_TIMEOUT'
  );
  try {
    let response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: buildSystemPrompt(context) },
            { role: 'user', content: text }
          ],
          response_format: { type: 'json_object' },
          temperature: 0
        })
      });
    } catch (error) {
      if (controller.signal.aborted || (error && error.name === 'AbortError')) {
        throw abortError();
      }
      throw new LeaveAiExtractionError('AI_LEAVE_PROVIDER_ERROR');
    }

    if (!response || !response.ok) throw new LeaveAiExtractionError('AI_LEAVE_PROVIDER_ERROR');

    let providerData;
    try {
      providerData = await response.json();
    } catch (error) {
      if (controller.signal.aborted || (error && error.name === 'AbortError')) {
        throw abortError();
      }
      throw new LeaveAiExtractionError('AI_LEAVE_INVALID_RESPONSE');
    }

    const responseText = providerData
      && providerData.choices
      && providerData.choices[0]
      && providerData.choices[0].message
      && providerData.choices[0].message.content;
    if (typeof responseText !== 'string') throw new LeaveAiExtractionError('AI_LEAVE_INVALID_RESPONSE');

    let extraction;
    try {
      extraction = JSON.parse(stripMarkdownFence(responseText));
    } catch (_error) {
      throw new LeaveAiExtractionError('AI_LEAVE_INVALID_RESPONSE');
    }

    if (!isValidExtraction(extraction)) throw new LeaveAiExtractionError('AI_LEAVE_INVALID_RESPONSE');
    return {
      ...extraction,
      reason: normalizeOptionalString(extraction.reason),
      handover: normalizeOptionalString(extraction.handover)
    };
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', abortFromExternal);
  }
}

module.exports = {
  LeaveAiExtractionError,
  extractLeaveMessage
};
