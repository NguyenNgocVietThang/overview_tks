# Gemini One-Message Leave Request Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Telegram leave bot's field-by-field interview with one-message intent extraction through Gemini, deterministic leave-date/session calculation, one confirmation screen, and traceable persistence of the original message in Google Sheets.

**Architecture:** Add a narrow Gemini adapter that returns structured semantic fields, then pass those fields through a pure domain resolver that owns all dates, sessions, duration, and 10-hour defaults. Keep Telegram responsible only for identity/link checks, queueing, confirmation, and submission; keep the Google Sheet repository as the canonical schema mapper. Gemini output is never written directly to Sheets: every value is normalized and validated first.

**Tech Stack:** Node.js CommonJS, native `fetch`, Gemini `generateContent` REST API, `node:test`, node-telegram-bot-api, Google Sheets API.

## Global Constraints

- The user sends one natural-language leave request; the bot must not return to the old field-by-field questionnaire.
- Keep a single `Xác nhận` / `Hủy` confirmation step before writing to Google Sheets so the employee can catch an AI interpretation error.
- Resolve dates in `Asia/Bangkok`, using the Telegram `msg.date` timestamp as the only reference clock.
- `xin nghỉ hôm nay` means `Sáng` through `Chiều` on the message date, even when the message arrives after a session starts; existing violation and urgent flags still apply.
- `xin nghỉ buổi sáng` or `xin nghỉ buổi chiều` without another date means that session on the message date.
- Recognize `hôm nay`, `ngày mai`, `ngày kia`, explicit Vietnamese dates, explicit ranges, session names, number of sessions, number of days, optional reason, and optional handover person.
- For a duration-only request such as `em xin nghỉ 3 ngày`, choose the first session whose configured start time is at least 10 hours after the message time, then allocate 6 consecutive sessions; this preserves the current calendar behavior where every date has two sessions.
- Explicit dates/sessions always take precedence over the duration-only 10-hour default.
- One day equals two sessions; one session equals half a day; all persisted totals remain positive integers in `tong_buoi_nghi`.
- Reason and handover are optional. Missing values persist as empty strings and must not trigger follow-up questions.
- If time information is missing, contradictory, invalid, or low-confidence, do not write a row and do not guess; ask the employee to rewrite one complete sentence and show an example.
- If Gemini is unavailable, times out, or returns malformed JSON, do not write a row; send a retry message and log an error without exposing API keys or raw provider responses to Telegram.
- Preserve command behavior for `/start`, `/lienket`, and `/huy`; `/xinnghi` becomes usage guidance and is no longer required to start a session.
- Preserve per-chat serialization, Telegram message deduplication, late-submission status, urgent flags, realtime events, and retry behavior after Google Sheets failures.
- Add `Tin nhắn` as the final Sheet field so existing column positions and historical rows remain aligned; all current fields remain unchanged.
- Do not run `setupHrSheet.js` against the live spreadsheet during implementation or automated verification.

---

## File Structure

- Create `server/telegram/geminiLeaveExtractor.js`: call Gemini with a strict response schema, parse provider output, and return semantic slots only.
- Create `server/telegram/geminiLeaveExtractor.test.js`: mock `fetch` and cover request shape, clean extraction, timeout/provider failures, fenced JSON, and invalid output.
- Create `server/hr/leaveMessageResolver.js`: deterministically convert extracted slots plus message time into the canonical leave interval.
- Create `server/hr/leaveMessageResolver.test.js`: table-driven tests for relative dates, sessions, explicit ranges, duration-only requests, precedence, timezone boundaries, and validation.
- Modify `server/config.js`: expose optional `GEMINI_API_KEY`, configurable `GEMINI_MODEL`, timeout, timezone, and duration-default notice hours.
- Modify `server/telegram/hrTelegramBot.js`: replace questionnaire orchestration with one-message extraction, validation, confirmation, and unchanged submission semantics.
- Modify `server/telegram/hrTelegramBot.test.js`: replace state-machine expectations with one-message integration tests and assert exact persisted data.
- Modify `server/telegram/conversationStore.js` and `server/telegram/conversationStore.test.js`: persist/revive only the parsed confirmation state needed after restart.
- Modify `server/hr/hrLeaveRepository.js` and `server/hr/hrLeaveRepository.test.js`: append `tin_nhan` to the canonical Sheet record.
- Modify `server/hr/hrLeaveExportService.js`: give the new exported column a readable width.
- Modify `server/scripts/setupHrSheet.js`: write the appended header without moving or deleting existing columns.
- Modify `README.md`, `server/README.md`, and `docs/02-srs/SRS_Dashboard_GoogleSheets.md`: document configuration, grammar, defaults, failure behavior, and schema.

---

### Task 1: Deterministic resolution of extracted leave semantics

**Files:**
- Create: `server/hr/leaveMessageResolver.js`
- Create: `server/hr/leaveMessageResolver.test.js`
- Modify: `server/hr/hrLeaveService.js`

**Interfaces:**
- Consumes: `resolveLeaveMessage(extracted, messageTime, options)` where `extracted` has `{ intent, start_date, start_session, end_date, end_session, duration_value, duration_unit, reason, handover, confidence }`.
- Consumes existing: `computeDurationSessions(Date, Session, Date, Session): number|null` and `getSessionStartTime(Date, Session): Date|null`.
- Produces: `resolveLeaveMessage(...): { startDate: Date, startSession: 'Sáng'|'Chiều', endDate: Date, endSession: 'Sáng'|'Chiều', totalSessions: number, reason: string, handover: string }` or throws `LeaveMessageResolutionError` with a stable `code`.
- Produces: `findFirstSessionAtOrAfter(referenceTime, noticeHours): { date: Date, session: 'Sáng'|'Chiều' }`.

- [ ] **Step 1: Write failing tests for explicit and relative intervals**

```js
test('hom nay khong neu buoi la tron ngay gui tin', () => {
  const result = resolveLeaveMessage({
    intent: 'leave_request', start_date: '2026-08-22', start_session: null,
    end_date: null, end_session: null, duration_value: null, duration_unit: null,
    reason: null, handover: null, confidence: 0.98
  }, '2026-08-22T08:15:00+07:00');
  assert.equal(formatLeaveBoundary(result.startDate, result.startSession), 'Sáng 22/08/2026');
  assert.equal(formatLeaveBoundary(result.endDate, result.endSession), 'Chiều 22/08/2026');
  assert.equal(result.totalSessions, 2);
});

test('buoi sang khong neu ngay mac dinh la ngay gui tin', () => {
  const result = resolveLeaveMessage({
    intent: 'leave_request', start_date: null, start_session: 'Sáng',
    end_date: null, end_session: null, duration_value: null, duration_unit: null,
    reason: '', handover: '', confidence: 0.95
  }, '2026-08-22T23:30:00+07:00');
  assert.equal(formatLeaveBoundary(result.startDate, result.startSession), 'Sáng 22/08/2026');
  assert.equal(formatLeaveBoundary(result.endDate, result.endSession), 'Sáng 22/08/2026');
  assert.equal(result.totalSessions, 1);
});
```

- [ ] **Step 2: Write failing tests for the 10-hour duration-only default and precedence**

```js
test('ba ngay khong neu ngay bat dau tai session dau tien sau du 10 gio', () => {
  const result = resolveLeaveMessage({
    intent: 'leave_request', start_date: null, start_session: null,
    end_date: null, end_session: null, duration_value: 3, duration_unit: 'day',
    reason: 'việc gia đình', handover: null, confidence: 0.99
  }, '2026-08-22T10:00:00+07:00', { noticeHours: 10 });
  assert.equal(formatLeaveBoundary(result.startDate, result.startSession), 'Sáng 23/08/2026');
  assert.equal(formatLeaveBoundary(result.endDate, result.endSession), 'Chiều 25/08/2026');
  assert.equal(result.totalSessions, 6);
});

test('ngay ro rang uu tien hon mac dinh 10 gio', () => {
  const result = resolveLeaveMessage({
    intent: 'leave_request', start_date: '2026-08-22', start_session: 'Chiều',
    end_date: null, end_session: null, duration_value: 2, duration_unit: 'session',
    reason: null, handover: null, confidence: 0.91
  }, '2026-08-22T10:00:00+07:00');
  assert.equal(formatLeaveBoundary(result.startDate, result.startSession), 'Chiều 22/08/2026');
  assert.equal(formatLeaveBoundary(result.endDate, result.endSession), 'Sáng 23/08/2026');
  assert.equal(result.totalSessions, 2);
});
```

- [ ] **Step 3: Write failing validation tests**

```js
assert.throws(
  () => resolveLeaveMessage({ intent: 'other', confidence: 0.99 }, messageTime),
  err => err.code === 'NOT_LEAVE_REQUEST'
);
assert.throws(
  () => resolveLeaveMessage({ intent: 'leave_request', confidence: 0.4 }, messageTime),
  err => err.code === 'LOW_CONFIDENCE'
);
assert.throws(
  () => resolveLeaveMessage({
    intent: 'leave_request', start_date: '2026-02-31', start_session: 'Sáng',
    end_date: null, end_session: null, duration_value: null, duration_unit: null,
    confidence: 0.99
  }, messageTime),
  err => err.code === 'INVALID_DATE'
);
```

- [ ] **Step 4: Run the new resolver tests and verify they fail because the module does not exist**

Run: `node --test hr/leaveMessageResolver.test.js` from `server/`

Expected: FAIL with `Cannot find module './leaveMessageResolver'`.

- [ ] **Step 5: Implement the pure resolver and slot arithmetic**

Implement `SESSION_ORDER = ['Sáng', 'Chiều']`, strict ISO-date parsing, Bangkok date extraction through `Intl.DateTimeFormat(..., { timeZone: 'Asia/Bangkok' })`, and helpers that advance one half-day slot at a time. Resolve in this order: explicit range; explicit start plus duration; explicit start/session only; duration-only default. Convert `day` to `duration_value * 2`, accept `session` only as a positive integer, reject fractional/negative/contradictory intervals, and require `confidence >= 0.75`.

- [ ] **Step 6: Run the focused tests**

Run: `node --test hr/leaveMessageResolver.test.js`

Expected: PASS for today, tomorrow/date values supplied by extraction, same-session, explicit range, duration-only start, cross-midnight slot arithmetic, precedence, invalid date, contradictory range, unsupported unit, and low-confidence cases.

- [ ] **Step 7: Commit the resolver unit**

```bash
git add server/hr/leaveMessageResolver.js server/hr/leaveMessageResolver.test.js server/hr/hrLeaveService.js
git commit -m "feat: resolve leave messages into sessions"
```

### Task 2: Gemini structured extraction adapter

**Files:**
- Create: `server/telegram/geminiLeaveExtractor.js`
- Create: `server/telegram/geminiLeaveExtractor.test.js`
- Modify: `server/config.js`

**Interfaces:**
- Produces: `extractLeaveMessage(text, context, dependencies?): Promise<ExtractedLeaveMessage>`.
- `context` is `{ messageTime: string, timeZone: 'Asia/Bangkok' }`.
- `ExtractedLeaveMessage` is the exact object consumed by Task 1; session values are `Sáng`, `Chiều`, or `null`; unit values are `day`, `session`, or `null`.
- Throws `GeminiExtractionError` with `code` in `GEMINI_NOT_CONFIGURED`, `GEMINI_TIMEOUT`, `GEMINI_PROVIDER_ERROR`, `GEMINI_INVALID_RESPONSE`.

- [ ] **Step 1: Add optional Gemini configuration without reading or logging the secret**

```js
GEMINI_API_KEY: process.env.GEMINI_API_KEY || null,
GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
GEMINI_TIMEOUT_MS: Number(process.env.GEMINI_TIMEOUT_MS) || 10000,
HR_TIME_ZONE: process.env.HR_TIME_ZONE || 'Asia/Bangkok',
HR_DURATION_DEFAULT_NOTICE_HOURS: Number(process.env.HR_DURATION_DEFAULT_NOTICE_HOURS) || 10,
```

- [ ] **Step 2: Write failing adapter tests with injected `fetch`**

```js
test('gui moc thoi gian va yeu cau JSON co schema co dinh', async () => {
  let request;
  const fakeFetch = async (url, options) => {
    request = { url, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(validExtraction) }] } }] }) };
  };
  const result = await extractLeaveMessage('Em xin nghỉ sáng mai vì khám bệnh', {
    messageTime: '2026-08-22T08:00:00+07:00', timeZone: 'Asia/Bangkok'
  }, { fetch: fakeFetch, apiKey: 'test-key', model: 'test-model' });
  assert.match(request.url, /test-model:generateContent/);
  assert.equal(request.body.generationConfig.responseMimeType, 'application/json');
  assert.equal(result.start_date, '2026-08-23');
  assert.equal(result.start_session, 'Sáng');
  assert.equal(result.reason, 'khám bệnh');
});
```

Also test: `GEMINI_NOT_CONFIGURED`; non-2xx response maps to `GEMINI_PROVIDER_ERROR` without provider body in the public message; abort maps to `GEMINI_TIMEOUT`; missing candidates, extra keys, invalid enums, non-number confidence, and malformed JSON map to `GEMINI_INVALID_RESPONSE`.

- [ ] **Step 3: Run the adapter tests and verify the missing module failure**

Run: `node --test telegram/geminiLeaveExtractor.test.js` from `server/`

Expected: FAIL with `Cannot find module './geminiLeaveExtractor'`.

- [ ] **Step 4: Implement the Gemini request with a strict prompt and response schema**

The prompt must say that the model extracts rather than approves requests, receives the exact local reference time, resolves `hôm nay`/`ngày mai`/`ngày kia` to `YYYY-MM-DD`, preserves absent optional fields as `null`, never invents a reason/handover/date, maps full day to null sessions so Task 1 applies defaults, and returns `intent: other` for unrelated chat. Send `generationConfig.responseMimeType = 'application/json'`, `temperature = 0`, and a response schema containing only the interface fields. Parse a plain JSON response and defensively strip one surrounding Markdown fence before `JSON.parse`.

- [ ] **Step 5: Implement timeout and safe errors**

Create an `AbortController`, abort after `GEMINI_TIMEOUT_MS`, clear the timer in `finally`, check `response.ok`, and validate every returned property before returning it. Logs may contain HTTP status and error code but never the API key, request URL with key, or full raw employee message.

- [ ] **Step 6: Run focused tests**

Run: `node --test telegram/geminiLeaveExtractor.test.js`

Expected: PASS, with no real network calls.

- [ ] **Step 7: Commit the adapter unit**

```bash
git add server/config.js server/telegram/geminiLeaveExtractor.js server/telegram/geminiLeaveExtractor.test.js
git commit -m "feat: extract leave intent with Gemini"
```

### Task 3: One-message Telegram flow and confirmation

**Files:**
- Modify: `server/telegram/hrTelegramBot.js`
- Modify: `server/telegram/hrTelegramBot.test.js`
- Modify: `server/telegram/conversationStore.js`
- Modify: `server/telegram/conversationStore.test.js`

**Interfaces:**
- Consumes: `extractLeaveMessage(text, { messageTime, timeZone })` from Task 2.
- Consumes: `resolveLeaveMessage(extracted, messageTime, { noticeHours })` from Task 1.
- Stores only `{ step: 'CONFIRM', data: { link, identity, originalMessage, messageTime, startDate, startSession, endDate, endSession, tong_buoi_nghi, ly_do, nguoi_ban_giao, co_nghi_gap, co_vi_pham } }`.
- Produces the existing `submitLeaveRequest(bot, chatId, conv): Promise<boolean>` behavior plus `tin_nhan` in its repository payload.

- [ ] **Step 1: Replace interview-oriented tests with one-message integration tests**

Use a fake Telegram bot, stub `repo.findLinkByChatId`, `resolveSenderIdentity`, extractor, and resolver, then send:

```js
await messageHandler({
  chat: { id: 456 }, from: { username: 'tester' }, message_id: 91,
  date: 1787364000,
  text: 'Em xin nghỉ buổi sáng ngày mai vì đi khám, bàn giao cho Nguyễn B'
});
assert.equal(store.getConversation(456).step, 'CONFIRM');
assert.equal(store.getConversation(456).data.originalMessage,
  'Em xin nghỉ buổi sáng ngày mai vì đi khám, bàn giao cho Nguyễn B');
assert.match(sent.at(-1).text, /Từ: Sáng/);
assert.match(sent.at(-1).text, /Lý do: đi khám/);
assert.deepEqual(sent.at(-1).options.reply_markup.inline_keyboard[0].map(x => x.callback_data), ['confirm', 'cancel']);
```

Add cases for unlinked chat, unrelated text, incomplete/low-confidence text, Gemini timeout, two near-simultaneous messages in one chat, duplicate `message_id`, and an old confirmation callback pressed twice.

- [ ] **Step 2: Run current Telegram/store tests and capture the intentional failures**

Run: `node --test telegram/hrTelegramBot.test.js telegram/conversationStore.test.js` from `server/`

Expected: FAIL because ordinary messages are ignored without an old questionnaire conversation and because old steps remain.

- [ ] **Step 3: Replace the state machine with a one-message handler**

For every non-command text: enqueue by chat; verify the web-account link and identity; derive `messageTime` from `msg.date`; call extraction and resolution once; compute urgent/violation flags from the resolved start boundary; persist `CONFIRM`; then send one summary. Do not call Gemini for unlinked users. If another valid message arrives while a confirmation exists, replace the pending draft with the newly parsed message so correction is also one message.

- [ ] **Step 4: Change `/xinnghi`, `/start`, and error copy**

`/xinnghi` replies with one example sentence and does not create an `AWAITING_*` state. `/start` explains that a linked employee can send a sentence directly. Resolution errors reply: `Mình chưa xác định chắc thời gian nghỉ. Hãy nhắn lại trong một câu, ví dụ: “Em xin nghỉ sáng mai vì đi khám, bàn giao cho Nguyễn B”.` Provider/timeout errors reply: `Bot chưa phân tích được tin nhắn lúc này. Bạn vui lòng gửi lại sau ít phút.`

- [ ] **Step 5: Keep confirmation and submission idempotency**

Retain callback queueing and deduplication. On confirm, call the repository exactly once, clear the stored conversation only after Sheet success, broadcast the realtime event, and leave the draft intact after Sheet failure. On cancel, clear the draft. Add `tin_nhan: d.originalMessage` to the payload while keeping all existing fields.

- [ ] **Step 6: Simplify conversation revival**

Keep `startDate` and `endDate` revival for a persisted `CONFIRM` draft. Remove tests and branches dedicated only to `AWAITING_REASON`, `AWAITING_START_DATE`, `AWAITING_START_SESSION`, `AWAITING_END_DATE`, `AWAITING_END_SESSION`, and `AWAITING_HANDOVER`; do not remove compatibility revival of `start`/`end` until existing stored sessions have naturally expired or been cleared.

- [ ] **Step 7: Run focused tests**

Run: `node --test telegram/hrTelegramBot.test.js telegram/conversationStore.test.js`

Expected: PASS for one-message parsing, summary, replacement correction, errors, queueing, deduplication, restart revival, Sheet retry, and callback idempotency.

- [ ] **Step 8: Commit the Telegram flow**

```bash
git add server/telegram/hrTelegramBot.js server/telegram/hrTelegramBot.test.js server/telegram/conversationStore.js server/telegram/conversationStore.test.js
git commit -m "feat: accept one-message leave requests"
```

### Task 4: Append the original message to the Sheet schema

**Files:**
- Modify: `server/hr/hrLeaveRepository.js`
- Modify: `server/hr/hrLeaveRepository.test.js`
- Modify: `server/hr/hrLeaveExportService.js`
- Modify: `server/scripts/setupHrSheet.js`

**Interfaces:**
- Extends the canonical record with `tin_nhan: string`.
- Appends exact header `Tin nhắn` and field key `tin_nhan` after existing `updated_at`; no existing field index changes.

- [ ] **Step 1: Write failing repository schema and persistence tests**

```js
assert.equal(repo.LEAVE_SCHEMA_HEADERS.at(-1), 'Tin nhắn');
assert.equal(repo.LEAVE_SCHEMA_FIELD_KEYS.at(-1), 'tin_nhan');

const record = await repo.createLeaveRequest({
  thoi_gian_bat_dau: 'Sáng 23/08/2026',
  thoi_gian_ket_thuc: 'Chiều 23/08/2026',
  tong_buoi_nghi: 2,
  tin_nhan: 'Em xin nghỉ ngày mai vì việc gia đình'
});
assert.equal(record.tin_nhan, 'Em xin nghỉ ngày mai vì việc gia đình');
assert.equal(appendedRow.at(-1), 'Em xin nghỉ ngày mai vì việc gia đình');
```

Also assert that a manual web-created record without `tin_nhan` writes an empty final cell and that every old field key retains its previous index.

- [ ] **Step 2: Run the repository tests and verify failure**

Run: `node --test hr/hrLeaveRepository.test.js` from `server/`

Expected: FAIL because the current schema ends at `updated_at`.

- [ ] **Step 3: Append the field without migrating existing data columns**

Append the header/key in `LEAVE_SCHEMA`, set `tin_nhan: data.tin_nhan || ''` in `createLeaveRequest`, and leave update/read logic generic. Because the field is last, historical rows remain valid and read with an empty message.

- [ ] **Step 4: Update Sheet setup and Excel export**

Keep `setupHrSheet.js` driven by `LEAVE_SCHEMA_HEADERS`; confirm its header range expands by one final column and does not issue `insertDimension`, `deleteDimension`, or row-clearing requests. Add `tin_nhan: 60` to `COLUMN_WIDTHS` in `hrLeaveExportService.js` so exports include the original sentence legibly.

- [ ] **Step 5: Run repository and export tests**

Run: `node --test hr/hrLeaveRepository.test.js dashboard/exportService.test.js`

Expected: PASS and the exported final header/value are `Tin nhắn` and the exact original text.

- [ ] **Step 6: Commit the schema extension**

```bash
git add server/hr/hrLeaveRepository.js server/hr/hrLeaveRepository.test.js server/hr/hrLeaveExportService.js server/scripts/setupHrSheet.js
git commit -m "feat: store original leave message"
```

### Task 5: Documentation and end-to-end verification

**Files:**
- Modify: `README.md`
- Modify: `server/README.md`
- Modify: `docs/02-srs/SRS_Dashboard_GoogleSheets.md`

**Interfaces:**
- Documents environment variables and the exact one-message behavior implemented by Tasks 1-4.

- [ ] **Step 1: Document configuration and deployment**

Add `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_TIMEOUT_MS`, `HR_TIME_ZONE`, and `HR_DURATION_DEFAULT_NOTICE_HOURS` to the environment-variable sections. State that the secret belongs only in local `.env`/deployment secret storage and must never be committed. Document that `TELEGRAM_BOT_ENABLED=true` now requires Gemini configuration for natural-language leave extraction.

- [ ] **Step 2: Document supported examples and precedence**

Include these exact examples and outcomes:

```text
Em xin nghỉ phép hôm nay
=> Sáng hôm nay đến Chiều hôm nay

Em xin nghỉ buổi sáng
=> Sáng hôm nay đến Sáng hôm nay

Em xin nghỉ 3 ngày vì việc gia đình, bàn giao cho Nguyễn B
=> 6 buổi, bắt đầu ở buổi đầu tiên cách thời điểm nhắn ít nhất 10 giờ
```

State that explicit dates/sessions override the 10-hour duration-only default, reason/handover are optional, and ambiguous messages are rejected for rewriting rather than partially questioned.

- [ ] **Step 3: Document the appended Sheet field**

Update the canonical leave schema to include final field `Tin nhắn`/`tin_nhan`, explaining that it stores the unmodified Telegram text for HR comparison and that existing fields and column positions remain unchanged.

- [ ] **Step 4: Run all focused tests together**

Run from `server/`:

```bash
node --test hr/leaveMessageResolver.test.js telegram/geminiLeaveExtractor.test.js telegram/hrTelegramBot.test.js telegram/conversationStore.test.js hr/hrLeaveRepository.test.js dashboard/exportService.test.js
```

Expected: all tests pass with mocked Gemini calls and no Google Sheet mutation.

- [ ] **Step 5: Run the complete suite**

Run: `npm test` from `server/`

Expected: exit code 0; no live Gemini or Google API request is made by tests.

- [ ] **Step 6: Perform static safety checks**

Run from the repository root:

```bash
rg -n "AWAITING_REASON|AWAITING_START_DATE|AWAITING_START_SESSION|AWAITING_END_DATE|AWAITING_END_SESSION|AWAITING_HANDOVER" server/telegram
rg -n "GEMINI_API_KEY=.*[^|]" .env.example README.md server/README.md
git diff --check
```

Expected: the first command finds no active questionnaire flow (only an intentional compatibility comment may remain); documentation contains variable names but no real secret value; `git diff --check` produces no output.

- [ ] **Step 7: Perform a controlled manual smoke test**

In a non-production bot and test HR spreadsheet, send the three documented examples, compare every confirmation field to the message timestamp in `Asia/Bangkok`, confirm one request, and verify exactly one Sheet row with the original sentence in final column `Tin nhắn`. Cancel the other drafts and verify they create no rows. Do not run this step against production.

- [ ] **Step 8: Commit documentation**

```bash
git add README.md server/README.md docs/02-srs/SRS_Dashboard_GoogleSheets.md
git commit -m "docs: describe one-message leave requests"
```

---

## Self-Review Results

- Spec coverage: one-message input, today/morning defaults, relative and explicit dates, day/session quantities, 10-hour duration default, optional reason, optional handover, original-message Sheet field, preserved existing fields, Gemini failure handling, confirmation, and tests are each assigned to a concrete task.
- Placeholder scan: the plan contains no deferred implementation placeholders; every error path, field name, interface, command, and expected test result is specified.
- Type consistency: Task 2 produces exactly the extracted object Task 1 consumes; Task 1's canonical result maps one-to-one into Task 3's confirmation data; Task 3 emits `tin_nhan`, which Task 4 appends to the repository schema.
- Migration safety: `Tin nhắn` is appended, not inserted, so all 22 existing Sheet column positions and historical rows remain intact.
- Scope control: the HR web table and API behavior need no bespoke change because repository objects automatically gain `tin_nhan`; only export width, setup header, and documentation require explicit updates.
