# xKiro Five-Model Consensus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gọi song song năm model free xKiro và chỉ đưa extraction vào pipeline nghỉ phép khi có hai kết quả hợp lệ khớp intent cùng khoảng nghỉ đã resolve.

**Architecture:** `leaveAiExtractor` vẫn là adapter một model và nhận thêm signal hủy từ bên ngoài. Module `leaveAiConsensusExtractor` quản lý năm request, biến mỗi extraction thành một vote an toàn qua confidence threshold và resolver, rồi kết thúc sớm khi một khóa có hai vote. Bot chỉ đổi dependency từ extractor đơn sang consensus extractor; repository và schema Sheet không đổi.

**Tech Stack:** Node.js 22, CommonJS, built-in `fetch`/`AbortController`, `node:test`, xKiro OpenAI Chat Completions.

## Global Constraints

- Không log/hiển thị `AI_LEAVE_API_KEY`, Authorization header, nội dung tin nhắn hoặc response thô của AI proxy.
- Không ghi Sheet nếu TIME thiếu/mâu thuẫn hoặc ensemble không đạt một cặp 2/5 khớp nhau.
- Confidence threshold giữ nguyên `0.75`; timeout từng model giữ mặc định `30000` ms.
- Không thay đổi số lần hỏi lại tối đa `3` hoặc vị trí 23 cột của `LEAVE_SCHEMA`.
- Không sửa README/SRS, giao diện web hoặc hai test Postgres ngoài phạm vi.
- Test tự động không gọi xKiro hoặc Google Sheet thật.
- Polling thật chỉ khởi động sau khi xác minh không có instance khác dùng cùng Telegram token.
- Chỉ người dùng Telegram đã liên kết và tự bấm **Xác nhận** mới tạo dòng Sheet thật.

---

### Task 1: Cấu hình danh sách model và hủy request một model

**Files:**
- Modify: `server/config.js`
- Modify: `server/.env.example`
- Modify: `server/telegram/leaveAiExtractor.js`
- Test: `server/telegram/leaveAiExtractor.test.js`

**Interfaces:**
- Produces: `CONFIG.AI_LEAVE_API_MODELS: string[]`.
- Produces: `extractLeaveMessage(text, context, dependencies)` hỗ trợ `dependencies.model` và `dependencies.signal` nhưng giữ nguyên return schema/error codes hiện có.

- [ ] **Step 1: Viết test config và external abort bị fail**

Thêm test extractor truyền `signal` từ `AbortController`, abort sau khi fetch bắt đầu và kỳ vọng `AI_LEAVE_ABORTED`; test phải xác nhận error chỉ có code chuẩn hóa. Thêm test config bằng process con với `AI_LEAVE_API_MODELS` chứa năm tên cách nhau bằng dấu phẩy và kỳ vọng array đã trim/lọc rỗng.

```js
assert.deepEqual(config.AI_LEAVE_API_MODELS, [
  'deepseek/deepseek-v4-pro',
  'deepseek/deepseek-v4-flash',
  'qwen/qwen3-max:free',
  'mistralai/mistral-small-2603',
  'mistralai/mistral-medium-3.5'
]);
await assert.rejects(promise, err => err.code === 'AI_LEAVE_ABORTED');
```

- [ ] **Step 2: Chạy test RED**

Run: `cd server && node --test telegram/leaveAiExtractor.test.js`

Expected: FAIL vì config chưa có array và extractor chưa xử lý external signal.

- [ ] **Step 3: Implement tối thiểu**

Trong config, parse biến danh sách; mặc định dùng đúng năm model đã duyệt. Khi env được đặt thành chuỗi rỗng, trả array rỗng để consensus fallback sang `AI_LEAVE_API_MODEL`.

```js
const DEFAULT_AI_LEAVE_MODELS = [
  'deepseek/deepseek-v4-pro',
  'deepseek/deepseek-v4-flash',
  'qwen/qwen3-max:free',
  'mistralai/mistral-small-2603',
  'mistralai/mistral-medium-3.5'
];
const configuredModels = process.env.AI_LEAVE_API_MODELS;
AI_LEAVE_API_MODELS: configuredModels == null
  ? DEFAULT_AI_LEAVE_MODELS
  : configuredModels.split(',').map(value => value.trim()).filter(Boolean)
```

Extractor phải gắn listener one-shot vào external signal để abort controller nội bộ; trong `finally` xóa listener và timer. Phân biệt external abort (`AI_LEAVE_ABORTED`) với timer abort (`AI_LEAVE_TIMEOUT`) mà không đưa nguyên nhân provider vào error message.

- [ ] **Step 4: Chạy GREEN**

Run: `cd server && node --test telegram/leaveAiExtractor.test.js`

Expected: toàn bộ test extractor pass, không network thật.

- [ ] **Step 5: Commit nếu staging không kéo theo thay đổi ngoài phạm vi**

```powershell
git add -- server/config.js server/.env.example server/telegram/leaveAiExtractor.js server/telegram/leaveAiExtractor.test.js
git commit -m "feat: configure xKiro leave models"
```

Nếu các file chứa thay đổi người dùng chưa thể tách an toàn, không commit và ghi rõ trong handoff.

---

### Task 2: Bộ điều phối quorum 2/5

**Files:**
- Create: `server/telegram/leaveAiConsensusExtractor.js`
- Create: `server/telegram/leaveAiConsensusExtractor.test.js`

**Interfaces:**
- Consumes: `leaveAiExtractor.extractLeaveMessage(text, context, { model, signal })`.
- Consumes: `resolveLeaveMessage(extraction, context.messageTime, { noticeHours: context.noticeHours })`.
- Produces: `extractLeaveMessage(text, context, dependencies = {}): Promise<Extraction>`.
- Produces: `LeaveAiConsensusError` với code `AI_LEAVE_NO_CONSENSUS`.

- [ ] **Step 1: Viết bảng test RED cho quorum**

Fixtures dùng năm model giả và deferred promises. Các case bắt buộc:

```js
test('trả sớm khi hai vote hợp lệ có cùng resolved key');
test('response đến sau tạo cặp khi các response đầu bất đồng');
test('chọn confidence cao hơn trong cặp và latency khi confidence bằng nhau');
test('timeout hoặc schema lỗi không được tính là vote');
test('confidence dưới 0.75 hoặc resolver lỗi không được tính là vote');
test('không có cặp trả AI_LEAVE_NO_CONSENSUS');
test('array model rỗng fallback sang một AI_LEAVE_API_MODEL');
test('intent other cần hai vote other và không gọi resolver');
```

Mỗi assertion dùng literal resolved key; không tính expected bằng helper production. Test early return phải giữ model thứ ba pending và xác nhận signal của ba request còn lại đã abort.

- [ ] **Step 2: Chạy test RED**

Run: `cd server && node --test telegram/leaveAiConsensusExtractor.test.js`

Expected: FAIL vì module chưa tồn tại.

- [ ] **Step 3: Implement vote normalization**

```js
function dateKey(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function buildVote(extraction, context, resolver) {
  if (extraction.confidence < 0.75) return null;
  if (extraction.intent === 'other') return { key: 'other', extraction };
  const resolved = resolver(extraction, context.messageTime, { noticeHours: context.noticeHours });
  return {
    key: JSON.stringify([
      'leave_request', dateKey(resolved.startDate), resolved.startSession,
      dateKey(resolved.endDate), resolved.endSession, resolved.totalSessions
    ]),
    extraction
  };
}
```

- [ ] **Step 4: Implement concurrent quorum**

Khởi tạo một controller/request, attach handlers ngay để không có unhandled rejection. Lưu vote theo key; khi bucket đạt hai phần tử, chọn confidence cao hơn rồi latency thấp hơn, abort controller còn lại và resolve. Khi tất cả request settle mà chưa có cặp, reject bằng error chuẩn hóa. Với một model fallback, delegate trực tiếp extractor để giữ tương thích cũ.

- [ ] **Step 5: Chạy GREEN và scoped regression**

Run: `cd server && node --test telegram/leaveAiConsensusExtractor.test.js telegram/leaveAiExtractor.test.js hr/leaveMessageResolver.test.js`

Expected: tất cả pass, không network thật.

- [ ] **Step 6: Commit file mới**

```powershell
git add -- server/telegram/leaveAiConsensusExtractor.js server/telegram/leaveAiConsensusExtractor.test.js
git commit -m "feat: add xKiro leave consensus"
```

---

### Task 3: Tích hợp consensus vào bot

**Files:**
- Modify: `server/telegram/hrTelegramBot.js`
- Modify: `server/telegram/hrTelegramBot.test.js`

**Interfaces:**
- Consumes: `leaveAiConsensusExtractor.extractLeaveMessage(text, { messageTime, timeZone, noticeHours })`.
- Preserves: pipeline `IDLE -> AWAITING_CLARIFICATION -> CONFIRM`, pending-field behavior, safe callback binding và Sheet write chỉ sau confirm.

- [ ] **Step 1: Đổi test harness sang mock consensus module và viết test RED no-consensus**

Test inject `AI_LEAVE_NO_CONSENSUS`, gửi free text và assert:

```js
assert.equal(h.created.length, 0);
assert.notEqual(h.store.getConversation(chatId)?.step, 'CONFIRM');
assert.match(h.bot.sent.at(-1).text, /chưa có đủ hai model đồng thuận/i);
assert.doesNotMatch(h.bot.sent.at(-1).text, /response|Authorization|sk-xt-/i);
```

- [ ] **Step 2: Chạy test RED**

Run: `cd server && node --test telegram/hrTelegramBot.test.js`

Expected: FAIL vì bot vẫn require extractor đơn và dùng thông báo provider chung.

- [ ] **Step 3: Wire consensus**

Đổi require sang `./leaveAiConsensusExtractor`, truyền thêm `noticeHours: CONFIG.HR_URGENT_NOTICE_HOURS_THRESHOLD`. Trong catch, nhánh code `AI_LEAVE_NO_CONSENSUS` gửi thông báo diễn đạt lại; các lỗi khác giữ thông báo thử lại sau. Log chỉ code chuẩn hóa.

- [ ] **Step 4: Chạy GREEN và toàn bộ scoped suite**

Run:

```powershell
cd server
node --test hr/leaveMessageResolver.test.js telegram/leaveAiExtractor.test.js telegram/leaveAiConsensusExtractor.test.js telegram/hrTelegramBot.test.js hr/hrLeaveRepository.test.js
```

Expected: tất cả pass; không gọi mạng/Sheet thật.

- [ ] **Step 5: Kiểm tra diff**

Run: `git diff --check`

Expected: exit 0. Xác nhận `LEAVE_SCHEMA` vẫn 23 cột, `tin_nhan` ở index cuối và không có secret trong diff.

- [ ] **Step 6: Commit nếu an toàn**

```powershell
git add -- server/telegram/hrTelegramBot.js server/telegram/hrTelegramBot.test.js
git commit -m "feat: use leave model consensus in Telegram bot"
```

Nếu file đang chứa thay đổi chưa commit từ feature trước, không commit trộn và ghi rõ trong handoff.

---

### Task 4: Smoke test xKiro thật, khởi động bot và xác nhận Sheet

**Files:**
- Modify local only: `server/.env` (`AI_LEAVE_API_MODELS`, không thay API key)
- Runtime log: một file tạm ngoài source hoặc trong `C:\tmp`, không commit.

**Interfaces:**
- Consumes: xKiro endpoint/config thật và Telegram token hiện có.
- Produces: bot polling nền; dòng Sheet chỉ do người dùng bấm Confirm.

- [ ] **Step 1: Xác minh config mà không in secret**

Chạy Node chỉ in boolean key configured, số lượng model, model names và timeout; không in `AI_LEAVE_API_KEY`.

- [ ] **Step 2: Smoke test năm model thật**

Gọi đồng thời năm model với câu không nhạy cảm: `Sáng mai em xin nghỉ vì việc cá nhân, bàn giao nhân viên kiểm thử`. Chỉ in mỗi model: status chuẩn hóa, latency, intent, confidence và resolved interval; không in raw response, headers hoặc key.

Expected: xác định model nào hiện còn free/khả dụng. Nếu dưới hai model hợp lệ có cùng resolved key, dừng và báo blocker; không khởi động bot với quorum không thể đạt.

- [ ] **Step 3: Kiểm tra xung đột polling**

Đọc command line các process Node hiện hữu và log bot nếu có, không dừng process không xác định. Nếu phát hiện instance dùng cùng bot, không khởi động instance thứ hai; báo người dùng hoặc tái sử dụng instance đã xác định thuộc workspace.

- [ ] **Step 4: Khởi động bot nền**

Khởi động hidden process từ `server/` với `TELEGRAM_BOT_ENABLED=true` và `KIOTVIET_SYNC_ENABLED=false`, redirect stdout/stderr sang file tạm. Không đưa secret lên command line. Chờ log `Đã khởi động (polling)` và kiểm tra không có Telegram 409 conflict.

- [ ] **Step 5: Người dùng smoke test Telegram**

Yêu cầu người dùng đã liên kết gửi lần lượt một câu đầy đủ và bấm **Xác nhận**. Theo dõi log chỉ cho code/latency/consensus; không hiển thị nội dung hoặc raw response.

- [ ] **Step 6: Xác minh dòng Sheet**

Sau khi người dùng báo đã bấm Confirm, đọc đúng dòng mới trong tab `Yêu cầu nghỉ phép` bằng repository/Sheets client; chỉ báo request id, khoảng nghỉ, tổng buổi, trạng thái và việc cột `Tin nhắn` có dữ liệu. Không in toàn bộ tin nhắn nếu không cần.

- [ ] **Step 7: Final verification**

Chạy lại scoped suite và `git diff --check`. Báo PID/process bot đang chạy, đường dẫn log tạm, model availability/latency an toàn, kết quả quorum và request id Sheet thật.
