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

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatIsoDateInZone(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDaysToIsoDate(isoDate, days) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/**
 * Tinh san bang quy doi tu tuong doi -> ngay cu the bang code thuan (khong
 * goi AI) roi dua thang vao prompt, thay vi bat AI tu cong/tru ngay trong
 * dau. AI lam toan ngay-thang tu nhien ngon rat khong on dinh giua cac model
 * re dang chay song song de lay consensus -- vd hay nham "ngay kia" (+2) voi
 * "ngay mai" (+1) vi ca hai deu la "mot ngay nao do sau hom nay" trong cach
 * model "cam nhan" ngon ngu, du nghia tieng Viet la khac nhau ro rang.
 */
function buildRelativeDateGuide(context) {
  const instant = new Date(context.messageTime);
  if (Number.isNaN(instant.getTime())) return null;
  const todayIso = formatIsoDateInZone(instant, context.timeZone);
  return [
    ['hôm qua', addDaysToIsoDate(todayIso, -1)],
    ['hôm nay', todayIso],
    ['ngày mai', addDaysToIsoDate(todayIso, 1)],
    ['ngày kia', addDaysToIsoDate(todayIso, 2)],
    ['ngày mốt', addDaysToIsoDate(todayIso, 2)]
  ];
}

function normalizeForMatch(value) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

function textHasTerm(normalizedText, normalizedTerm) {
  const pattern = new RegExp(`(?:^|[^a-z0-9À-ỿ])${normalizedTerm}(?:[^a-z0-9À-ỿ]|$)`);
  return pattern.test(normalizedText);
}

// index: 0=Chu nhat...6=Thu 7, cung quy uoc voi Date.prototype.getDay().
const WEEKDAY_TERMS = [
  { index: 0, patterns: ['chu nhat', 'cn'] },
  { index: 1, patterns: ['thu hai', 'thu 2'] },
  { index: 2, patterns: ['thu ba', 'thu 3'] },
  { index: 3, patterns: ['thu tu', 'thu 4'] },
  { index: 4, patterns: ['thu nam', 'thu 5'] },
  { index: 5, patterns: ['thu sau', 'thu 6'] },
  { index: 6, patterns: ['thu bay', 'thu 7'] }
];
const WEEKDAY_LABELS = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];

const WEEK_QUALIFIER_TERMS = [
  { weekOffset: 0, patterns: ['tuan nay'] },
  { weekOffset: 1, patterns: ['tuan sau', 'tuan toi'] },
  { weekOffset: -1, patterns: ['tuan truoc'] }
];

function findMatchedValues(normalizedText, terms, field) {
  const matched = new Set();
  for (const entry of terms) {
    if (entry.patterns.some(pattern => textHasTerm(normalizedText, pattern))) matched.add(entry[field]);
  }
  return matched;
}

function dayOfWeekFromIso(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function weekdayOffsetFromMonday(weekdayIndex) {
  return weekdayIndex === 0 ? 6 : weekdayIndex - 1;
}

function mondayOfWeekIso(todayIso, weekOffset) {
  const daysSinceMonday = (dayOfWeekFromIso(todayIso) + 6) % 7;
  return addDaysToIsoDate(todayIso, weekOffset * 7 - daysSinceMonday);
}

/**
 * weekOffset == null (khong neu "tuan nay/tuan sau/tuan truoc" di kem ten
 * thu): hieu la thu GAN NHAT sap toi tinh ca hom nay (vd nhan tin bat ky ngay
 * nao noi "thu 6" deu la thu 6 sap toi gan nhat, ke ca hom nay neu hom nay
 * dung la thu 6).
 */
function computeWeekdayIso(todayIso, weekdayIndex, weekOffset) {
  if (weekOffset != null) {
    return addDaysToIsoDate(mondayOfWeekIso(todayIso, weekOffset), weekdayOffsetFromMonday(weekdayIndex));
  }
  const daysAhead = (weekdayIndex - dayOfWeekFromIso(todayIso) + 7) % 7;
  return addDaysToIsoDate(todayIso, daysAhead);
}

/**
 * Tinh san lich Thu 2 - CN cua "tuan nay" va "tuan sau" theo moc tham chieu,
 * dua vao prompt de AI tra cuu thay vi tu dem ngay trong dau -- cung 1 ly do
 * bat on nhu buildRelativeDateGuide, ap dung cho cau nhac ten thu (vd "thu 2
 * tuan sau") hoac ca tuan (vd "nghi tuan sau").
 */
function buildWeekGuide(context) {
  const instant = new Date(context.messageTime);
  if (Number.isNaN(instant.getTime())) return null;
  const todayIso = formatIsoDateInZone(instant, context.timeZone);
  return [0, 1].map(weekOffset => ({
    label: weekOffset === 0 ? 'tuần này' : 'tuần sau',
    days: WEEKDAY_LABELS.map((label, index) => [label, computeWeekdayIso(todayIso, index, weekOffset)])
  }));
}

/**
 * Doi chieu van ban voi cac mau cau "map mo" pho bien (tu ngay tuong doi co
 * san, ten thu +/- "tuan nay/tuan sau", hoac ca tuan khong neu thu cu the) de
 * suy ra DUY NHAT 1 dien giai xac dinh bang code. Tra ve null neu van ban
 * nhap nhang -- nhac >= 2 dien giai khac nhau (vd vua "ngay kia" vua "thu 2",
 * hoac 2 ten thu khac nhau) -- de AI tu xu ly nhu cu thay vi code doan sai.
 */
function findDeterministicDateSignal(text, context) {
  const instant = new Date(context.messageTime);
  if (Number.isNaN(instant.getTime())) return null;
  const todayIso = formatIsoDateInZone(instant, context.timeZone);
  const normalizedText = normalizeForMatch(String(text || ''));

  const dateCandidates = new Set();
  for (const [term, isoDate] of buildRelativeDateGuide(context) || []) {
    if (textHasTerm(normalizedText, normalizeForMatch(term))) dateCandidates.add(isoDate);
  }

  const weekdayMatches = findMatchedValues(normalizedText, WEEKDAY_TERMS, 'index');
  const qualifierMatches = findMatchedValues(normalizedText, WEEK_QUALIFIER_TERMS, 'weekOffset');
  const qualifierWeekOffset = qualifierMatches.size === 1 ? [...qualifierMatches][0] : null;

  for (const weekdayIndex of weekdayMatches) {
    dateCandidates.add(computeWeekdayIso(todayIso, weekdayIndex, qualifierWeekOffset));
  }

  let rangeCandidate = null;
  if (weekdayMatches.size === 0 && qualifierMatches.size === 1) {
    const monday = mondayOfWeekIso(todayIso, qualifierWeekOffset);
    rangeCandidate = { start: monday, end: addDaysToIsoDate(monday, 5) };
  }

  const totalSignals = dateCandidates.size + (rangeCandidate ? 1 : 0);
  if (totalSignals !== 1) return null;
  return rangeCandidate ? { type: 'range', ...rangeCandidate } : { type: 'date', date: [...dateCandidates][0] };
}

/**
 * Ghi de start_date/end_date (va ca duration, cho truong hop ca tuan) cua AI
 * bang gia tri tinh san khi van ban chi cho phep suy ra DUY NHAT 1 dien giai
 * khong nhap nhang -- dam bao ket qua on dinh, khong phu thuoc AI co doc dung
 * cac bang quy doi trong prompt hay khong. Xem findDeterministicDateSignal.
 */
function applyRelativeDateOverride(text, context, extraction) {
  if (extraction.intent !== 'leave_request') return extraction;
  const signal = findDeterministicDateSignal(text, context);
  if (!signal) return extraction;

  if (signal.type === 'range') {
    return {
      ...extraction,
      start_date: signal.start,
      start_session: 'Sáng',
      end_date: signal.end,
      end_session: 'Chiều',
      duration_value: null,
      duration_unit: null
    };
  }

  if (!extraction.start_date || signal.date === extraction.start_date) return extraction;
  const sameDayEnd = extraction.end_date === extraction.start_date;
  return {
    ...extraction,
    start_date: signal.date,
    end_date: sameDayEnd ? signal.date : extraction.end_date
  };
}

function buildSystemPrompt(context) {
  const lines = [
    'Bạn trích xuất thông tin xin nghỉ phép có cấu trúc từ tin nhắn tiếng Việt của nhân viên; bạn KHÔNG phê duyệt hay từ chối yêu cầu.',
    `Mốc thời gian tham chiếu chính xác là ${context.messageTime} theo múi giờ ${context.timeZone}.`,
    'Quy đổi các từ tương đối "hôm nay", "ngày mai", "ngày kia"/"ngày mốt" sang định dạng YYYY-MM-DD dựa trên mốc thời gian tham chiếu đó.'
  ];

  const relativeDateGuide = buildRelativeDateGuide(context);
  if (relativeDateGuide) {
    lines.push(
      'Bảng quy đổi CHÍNH XÁC đã tính sẵn cho mốc tham chiếu ở trên -- dùng ĐÚNG các giá trị này khi tin nhắn nhắc đến từ tương ứng, KHÔNG tự cộng/trừ ngày theo cách khác: '
      + relativeDateGuide.map(([term, date]) => `"${term}"=${date}`).join(', ')
      + '. Lưu ý "ngày kia" và "ngày mốt" là ngày SAU "ngày mai" (cách hôm nay 2 ngày), khác với "ngày mai" (cách hôm nay 1 ngày) -- không được nhầm hai từ này với nhau.'
    );
  }

  const weekGuide = buildWeekGuide(context);
  if (weekGuide) {
    lines.push(
      'Bảng NGÀY TRONG TUẦN đã tính sẵn cho "tuần này" và "tuần sau" theo mốc tham chiếu ở trên -- dùng để quy đổi khi tin nhắn nhắc tên thứ (vd "thứ 3", "thứ 6 tuần sau", "chủ nhật tuần này"): '
      + weekGuide.map(week => `${week.label}: ${week.days.map(([label, date]) => `${label}=${date}`).join(', ')}`).join(' | ')
      + '. Nếu tin nhắn chỉ nhắc "tuần sau"/"tuần tới"/"tuần này" mà KHÔNG nêu thứ cụ thể nào, hiểu là nghỉ trọn tuần làm việc từ Thứ 2 đến Thứ 7 của tuần đó (Chủ nhật vốn đã là ngày nghỉ, không tính vào).'
    );
  }

  lines.push(
    'Buổi chỉ nhận giá trị "Sáng", "Chiều", hoặc null. Đơn vị thời lượng chỉ nhận "day", "session", hoặc null.',
    'Khi nhân viên nêu số ngày/buổi nghỉ tính từ hiện tại mà KHÔNG neo vào một ngày cụ thể nào (vd "nghỉ 3 ngày tới", "nghỉ 2 buổi nữa"), hãy để start_date/end_date là null và dùng duration_value/duration_unit -- hệ thống sẽ tự tính chính xác ngày bắt đầu, không tự cộng ngày trong đầu.',
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
  );

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
    return applyRelativeDateOverride(text, context, {
      ...extraction,
      reason: normalizeOptionalString(extraction.reason),
      handover: normalizeOptionalString(extraction.handover)
    });
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', abortFromExternal);
  }
}

module.exports = {
  LeaveAiExtractionError,
  extractLeaveMessage
};
