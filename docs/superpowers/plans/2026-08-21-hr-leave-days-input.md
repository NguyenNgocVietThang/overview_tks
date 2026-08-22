# HR Leave Days Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chuyển quy trình xin nghỉ từ “thời gian bắt đầu + thời gian kết thúc + tổng giờ” sang “thời gian bắt đầu + số ngày nghỉ”, đồng thời tự nhận diện định dạng ngày giờ tiếng Việt và chuẩn hóa số ngày theo đơn vị 0,5 ngày trên bot, API, Google Sheets và web.

**Architecture:** Tách việc chuẩn hóa đầu vào thành module nghiệp vụ thuần để bot và API dùng chung. Dữ liệu bền vững chỉ còn `thoi_gian_bat_dau` dạng ISO và `tong_ngay_nghi` dạng số; hai field `thoi_gian_ket_thuc`, `tong_gio_nghi` bị xóa khỏi schema, export và giao diện. Script setup HR thực hiện migration idempotent theo tên header, xóa hai cột cũ từ phải sang trái để không làm lệch dữ liệu còn lại.

**Tech Stack:** Node.js CommonJS, `node:test`, Express, Telegram Bot API, Google Sheets API v4, HTML/CSS/JavaScript thuần, ExcelJS, JSDOM.

## Global Constraints

- Bot chấp nhận tối thiểu `22/6/2026 8h30`, `22/06/2026 08:30`, `22/6/2026 8h` và định dạng ISO đang được hỗ trợ.
- Bot luôn hiển thị lại thời gian đã chuẩn hóa theo `dd/mm/yyyy HH:mm`, ví dụ `22/06/2026 08:30`.
- Ngày giờ không tồn tại như `31/02/2026 08:30`, giờ ngoài `00–23`, phút ngoài `00–59` phải bị từ chối, không được để JavaScript tự cuộn sang ngày khác.
- Số ngày chấp nhận cả dấu chấm và dấu phẩy thập phân: `2.5` và `2,5` cùng được lưu thành số `2.5`.
- Số ngày phải lớn hơn 0 và là bội số của `0.5`; từ chối `0`, số âm, `1.2`, chuỗi lẫn chữ và giá trị không hữu hạn.
- Không suy ra thời gian kết thúc và không quy đổi qua số giờ.
- Giữ nguyên logic cờ nghỉ gấp dựa trên `thoi_gian_bat_dau` và `thoi_gian_nhan`.
- Hai cột bị xóa khỏi Google Sheets là `Thời gian kết thúc nghỉ` và `Tổng giờ nghỉ`; phải giữ nguyên dữ liệu của cột `Tổng ngày nghỉ (quy đổi)` hiện có.
- Không ghi đè các thay đổi chưa commit hiện có trong `server/telegram/hrTelegramBot.js`, `server/public/humanresources/index.html` và các tài liệu liên quan.

---

## File Structure

- Create `server/hr/hrLeaveInput.js`: parser/normalizer thuần cho ngày giờ và số ngày.
- Create `server/hr/hrLeaveInput.test.js`: kiểm thử biên cho mọi định dạng và quy tắc 0,5 ngày.
- Modify `server/hr/hrLeaveService.js`: bỏ hàm tính tổng giờ và chỉ giữ nghiệp vụ còn sử dụng.
- Modify `server/telegram/hrTelegramBot.js`: đổi state hỏi thời gian kết thúc thành state hỏi số ngày và lưu payload mới.
- Modify `server/telegram/hrTelegramBot.test.js`: kiểm thử hội thoại, chuẩn hóa, lỗi nhập và payload gửi repository.
- Modify `server/hr/hrLeaveRepository.js`: schema và record chỉ dùng `tong_ngay_nghi`.
- Modify `server/hr/hrLeaveRoutes.js`: API nhận/kiểm tra `tong_ngay_nghi`, không nhận hai field cũ.
- Create `server/hr/hrLeaveRepository.test.js`: kiểm thử ánh xạ record theo schema mới bằng mock Sheets client.
- Create `server/hr/hrLeaveRoutes.test.js`: kiểm thử API quản lý nhập số ngày hợp lệ/không hợp lệ.
- Modify `server/hr/hrLeaveExportService.js`: bỏ hai cột khỏi workbook và hỗ trợ sort theo tổng ngày.
- Modify `server/dashboard/exportService.test.js` hoặc create `server/hr/hrLeaveExportService.test.js`: xác nhận workbook không còn hai header cũ.
- Modify `server/scripts/setupHrSheet.js`: schema 20 cột và migration xóa đúng hai cột cũ theo header.
- Create `server/scripts/setupHrSheet.test.js`: kiểm thử tính toán yêu cầu `deleteDimension` theo header mà không gọi Google API thật.
- Modify `server/public/humanresources/index.html`: form, bảng, render và sort dùng số ngày.
- Modify `server/test/frontend/hr-leave-loading.test.js`: kiểm thử DOM/payload của form và bảng mới.
- Modify `CHINH-SACH-NGHI-PHEP.md`, `README.md`, `server/README.md`: cập nhật quy ước nhập và mô hình dữ liệu thực tế.

### Task 1: Shared input normalization

**Files:**
- Create: `server/hr/hrLeaveInput.js`
- Create: `server/hr/hrLeaveInput.test.js`
- Modify: `server/hr/hrLeaveService.js`

**Interfaces:**
- Produces: `parseLeaveStart(value): Date|null`, `formatVietnameseDateTime(date): string`, `parseLeaveDays(value): number|null`.
- Consumes: không phụ thuộc Telegram, Express hoặc Google Sheets.

- [ ] **Step 1: Write failing parser tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLeaveStart, formatVietnameseDateTime, parseLeaveDays } = require('./hrLeaveInput');

test('chuẩn hóa ngày giờ tiếng Việt có h', () => {
  const value = parseLeaveStart('22/6/2026 8h30');
  assert.equal(formatVietnameseDateTime(value), '22/06/2026 08:30');
});

test('chấp nhận phút bằng 00 khi chỉ nhập giờ', () => {
  assert.equal(formatVietnameseDateTime(parseLeaveStart('22/6/2026 8h')), '22/06/2026 08:00');
});

test('chấp nhận định dạng dấu hai chấm và ISO', () => {
  assert.equal(formatVietnameseDateTime(parseLeaveStart('22/06/2026 08:30')), '22/06/2026 08:30');
  assert.ok(parseLeaveStart('2026-06-22T01:30:00.000Z') instanceof Date);
});

test('từ chối ngày giờ không tồn tại', () => {
  assert.equal(parseLeaveStart('31/02/2026 08:30'), null);
  assert.equal(parseLeaveStart('22/06/2026 24:00'), null);
  assert.equal(parseLeaveStart('22/06/2026 08:60'), null);
});

test('chuẩn hóa số ngày dùng dấu chấm hoặc dấu phẩy', () => {
  assert.equal(parseLeaveDays('2.5'), 2.5);
  assert.equal(parseLeaveDays('2,5'), 2.5);
  assert.equal(parseLeaveDays('3'), 3);
  assert.equal(parseLeaveDays(0.5), 0.5);
});

test('chỉ nhận số ngày dương theo bước 0.5', () => {
  for (const value of ['0', '-0.5', '1.2', '2 ngày', '', 'Infinity']) {
    assert.equal(parseLeaveDays(value), null, value);
  }
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `cd server && node --test hr/hrLeaveInput.test.js`

Expected: FAIL vì `hrLeaveInput.js` chưa tồn tại.

- [ ] **Step 3: Implement strict normalization**

```js
'use strict';

function parseLeaveStart(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2})(?::|h)(\d{1,2})?$/i);
  if (match) {
    const [, dayText, monthText, yearText, hourText, minuteText] = match;
    const day = Number(dayText);
    const month = Number(monthText);
    const year = Number(yearText);
    const hour = Number(hourText);
    const minute = minuteText == null ? 0 : Number(minuteText);
    if (month < 1 || month > 12 || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    const date = new Date(year, month - 1, day, hour, minute, 0, 0);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date;
  }
  const isoDate = new Date(text);
  return text && Number.isFinite(isoDate.getTime()) ? isoDate : null;
}

function formatVietnameseDateTime(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseLeaveDays(value) {
  const text = String(value == null ? '' : value).trim().replace(',', '.');
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const days = Number(text);
  if (!Number.isFinite(days) || days <= 0 || !Number.isInteger(days * 2)) return null;
  return days;
}

module.exports = { parseLeaveStart, formatVietnameseDateTime, parseLeaveDays };
```

- [ ] **Step 4: Remove `computeDurationHours` from `hrLeaveService.js` and its exports**

Keep `computeIsUrgent`, `resolveSenderIdentity`, and `resolveApproverName` unchanged. Search for all consumers before deleting:

Run: `rg -n "computeDurationHours" server`

Expected after Tasks 1–2: no matches.

- [ ] **Step 5: Run the focused tests**

Run: `cd server && node --test hr/hrLeaveInput.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/hr/hrLeaveInput.js server/hr/hrLeaveInput.test.js server/hr/hrLeaveService.js
git commit -m "feat: normalize HR leave date and day inputs"
```

### Task 2: Telegram conversation uses leave days

**Files:**
- Modify: `server/telegram/hrTelegramBot.js`
- Modify: `server/telegram/hrTelegramBot.test.js`

**Interfaces:**
- Consumes: `parseLeaveStart`, `formatVietnameseDateTime`, `parseLeaveDays` from Task 1.
- Produces: conversation data `{ start: Date, tong_ngay_nghi: number }` and repository payload without end time/hour fields.

- [ ] **Step 1: Add failing bot tests for normalization and state changes**

Extend the existing fake-bot harness with these assertions:

```js
store.setConversation(123, { step: 'AWAITING_START', data: { messageTime: new Date().toISOString() } });
await messageHandler({ chat: { id: 123 }, text: '22/6/2026 8h30' });
let conversation = store.getConversation(123);
assert.equal(conversation.step, 'AWAITING_DAYS');
assert.equal(conversation.data.start.getHours(), 8);
assert.match(sentMessages.at(-1).text, /bao nhiêu ngày/i);

await messageHandler({ chat: { id: 123 }, text: '2,5' });
conversation = store.getConversation(123);
assert.equal(conversation.step, 'AWAITING_HANDOVER');
assert.equal(conversation.data.tong_ngay_nghi, 2.5);
```

Also assert that `1.2` keeps the conversation at `AWAITING_DAYS` and returns a message containing `bội của 0,5 ngày`.

- [ ] **Step 2: Run the focused bot tests and verify failure**

Run: `cd server && node --test telegram/hrTelegramBot.test.js`

Expected: FAIL because the current state is `AWAITING_END` and the bot still calculates hours.

- [ ] **Step 3: Replace the end-time state with the days state**

Apply these exact state/data changes:

```js
const { computeIsUrgent, resolveSenderIdentity } = require('../hr/hrLeaveService');
const { parseLeaveStart, formatVietnameseDateTime, parseLeaveDays } = require('../hr/hrLeaveInput');

const STEP = Object.freeze({
  AWAITING_REASON: 'AWAITING_REASON',
  AWAITING_START: 'AWAITING_START',
  AWAITING_DAYS: 'AWAITING_DAYS',
  AWAITING_HANDOVER: 'AWAITING_HANDOVER',
  CONFIRM: 'CONFIRM'
});
```

At `AWAITING_START`, ask `Bạn nghỉ bao nhiêu ngày? (vd: 1, 2, 2.5 hoặc 2,5; đơn vị 0,5 ngày)` after parsing successfully. At `AWAITING_DAYS`, call `parseLeaveDays(text)` and keep the same state on invalid input.

- [ ] **Step 4: Update confirmation and persistence payload**

Confirmation must contain:

```js
`- Bắt đầu: ${formatVietnameseDateTime(d.start)}\n` +
`- Số ngày nghỉ: ${String(d.tong_ngay_nghi).replace('.', ',')} ngày\n`
```

Repository payload must contain:

```js
thoi_gian_bat_dau: d.start.toISOString(),
tong_ngay_nghi: d.tong_ngay_nghi,
```

Delete `thoi_gian_ket_thuc`, `tong_gio_nghi`, the local date parser/formatter, and all end-time calculation branches.

- [ ] **Step 5: Add a submission payload regression test**

Mock `repo.createLeaveRequest`, trigger confirm, and assert:

```js
assert.equal(createdPayload.tong_ngay_nghi, 2.5);
assert.equal(Object.hasOwn(createdPayload, 'thoi_gian_ket_thuc'), false);
assert.equal(Object.hasOwn(createdPayload, 'tong_gio_nghi'), false);
```

- [ ] **Step 6: Run bot and store tests**

Run: `cd server && node --test telegram/hrTelegramBot.test.js telegram/conversationStore.test.js`

Expected: PASS, including the existing sequential-message tests after changing their expected state to `AWAITING_DAYS`.

- [ ] **Step 7: Commit**

```bash
git add server/telegram/hrTelegramBot.js server/telegram/hrTelegramBot.test.js
git commit -m "feat: collect leave duration in half days"
```

### Task 3: Persist and validate the new schema

**Files:**
- Modify: `server/hr/hrLeaveRepository.js`
- Modify: `server/hr/hrLeaveRoutes.js`
- Create: `server/hr/hrLeaveRepository.test.js`
- Create: `server/hr/hrLeaveRoutes.test.js`

**Interfaces:**
- Consumes: `parseLeaveDays(value)` from Task 1.
- Produces: API/repository records containing `thoi_gian_bat_dau` and numeric `tong_ngay_nghi`; schema has 20 fields.

- [ ] **Step 1: Write failing schema/record tests**

Mock `../sheets/hrSheetsClient`, call `createLeaveRequest`, and assert:

```js
assert.equal(repo.LEAVE_SCHEMA_HEADERS.includes('Thời gian kết thúc nghỉ'), false);
assert.equal(repo.LEAVE_SCHEMA_HEADERS.includes('Tổng giờ nghỉ'), false);
assert.equal(repo.LEAVE_SCHEMA_FIELD_KEYS.includes('thoi_gian_ket_thuc'), false);
assert.equal(repo.LEAVE_SCHEMA_FIELD_KEYS.includes('tong_gio_nghi'), false);
assert.equal(repo.LEAVE_SCHEMA_FIELD_KEYS.length, 20);
assert.equal(appendedRow[repo.LEAVE_SCHEMA_FIELD_KEYS.indexOf('tong_ngay_nghi')], 2.5);
```

- [ ] **Step 2: Write failing route validation tests**

Using the project’s Express/auth test pattern, assert that manager POST requests behave as follows:

```js
{ ho_ten: 'Nguyễn A', ly_do: 'Việc riêng', thoi_gian_bat_dau: '2026-06-22T01:30:00.000Z', tong_ngay_nghi: '2,5', co_tu_y_nghi: true }
// => 201 and request.tong_ngay_nghi === 2.5

{ ho_ten: 'Nguyễn A', ly_do: 'Việc riêng', thoi_gian_bat_dau: 'invalid', tong_ngay_nghi: '1.2', co_tu_y_nghi: true }
// => 400 with code INVALID_REQUEST
```

- [ ] **Step 3: Run focused tests and verify failure**

Run: `cd server && node --test hr/hrLeaveRepository.test.js hr/hrLeaveRoutes.test.js`

Expected: FAIL because schema/routes still use end time and hours.

- [ ] **Step 4: Change repository schema and record mapping**

The schema segment becomes:

```js
headers: [
  // first ten unchanged headers,
  'Thời gian nhắn', 'Thời gian bắt đầu nghỉ', 'Tổng ngày nghỉ', 'Người bàn giao',
  // approval/audit headers unchanged
],
fieldKeys: [
  // first ten unchanged keys,
  'thoi_gian_nhan', 'thoi_gian_bat_dau', 'tong_ngay_nghi', 'nguoi_ban_giao',
  // approval/audit keys unchanged
]
```

In `createLeaveRequest`, persist `tong_ngay_nghi: data.tong_ngay_nghi` directly. Do not derive it from hours. The repository must reject a missing/invalid duration with `HrError('Số ngày nghỉ phải là số dương và là bội của 0,5 ngày.', 400, 'INVALID_LEAVE_DAYS')` so Telegram and future callers cannot bypass validation.

- [ ] **Step 5: Change POST route contract**

Destructure `thoi_gian_bat_dau`, `tong_ngay_nghi`, `nguoi_ban_giao`; remove `thoi_gian_ket_thuc` and `tong_gio_nghi`. Normalize duration through `parseLeaveDays`, validate start with `parseLeaveStart`, and pass an ISO start plus numeric days to the repository.

Return HTTP 400 with stable codes:

```js
{ error: 'Thời gian bắt đầu nghỉ không hợp lệ.', code: 'INVALID_LEAVE_START' }
{ error: 'Số ngày nghỉ phải là số dương và là bội của 0,5 ngày.', code: 'INVALID_LEAVE_DAYS' }
```

- [ ] **Step 6: Run repository and route tests**

Run: `cd server && node --test hr/hrLeaveRepository.test.js hr/hrLeaveRoutes.test.js`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/hr/hrLeaveRepository.js server/hr/hrLeaveRoutes.js server/hr/hrLeaveRepository.test.js server/hr/hrLeaveRoutes.test.js
git commit -m "refactor: store HR leave duration as days"
```

### Task 4: Migrate Google Sheets and Excel export

**Files:**
- Modify: `server/scripts/setupHrSheet.js`
- Create: `server/scripts/setupHrSheet.test.js`
- Modify: `server/hr/hrLeaveExportService.js`
- Create: `server/hr/hrLeaveExportService.test.js`

**Interfaces:**
- Consumes: the 20-field schema from Task 3.
- Produces: idempotent migration deleting deprecated Sheet columns and Excel workbooks with only the new schema.

- [ ] **Step 1: Extract and test migration request calculation**

Export a pure helper and test deleting by header name in descending index order:

```js
const oldHeaders = [
  'Mã yêu cầu', 'Telegram chat_id', 'Telegram username', 'Tài khoản web',
  'Họ tên', 'Chức vụ', 'Lý do nghỉ', 'Loại yêu cầu', 'Thời gian nhắn',
  'Thời gian bắt đầu nghỉ', 'Thời gian kết thúc nghỉ', 'Tổng giờ nghỉ',
  'Tổng ngày nghỉ (quy đổi)', 'Người bàn giao'
];
const requests = buildDeprecatedColumnDeletes(77, oldHeaders);
assert.deepEqual(requests.map(r => r.deleteDimension.range.startIndex), [11, 10]);
assert.deepEqual(buildDeprecatedColumnDeletes(77, ['Mã yêu cầu', 'Tổng ngày nghỉ']), []);
```

Indices are zero-based: delete old L (`11`) before old K (`10`) so old M (`Tổng ngày nghỉ`) shifts safely into K.

- [ ] **Step 2: Add migration to setup flow**

Before writing the new header row, read row 1 of the leave sheet, build `deleteDimension` requests for the exact deprecated headers, execute them once, then write the 20 new headers. Do not delete based only on fixed K/L positions. Rename `Tổng ngày nghỉ (quy đổi)` to `Tổng ngày nghỉ` when the header row is rewritten.

Refactor script entry so tests can import helpers without connecting to Google:

```js
if (require.main === module) {
  main().catch(handleFatalError);
}

module.exports = { buildDeprecatedColumnDeletes };
```

- [ ] **Step 3: Update export and add workbook regression test**

Remove width definitions for `thoi_gian_ket_thuc` and `tong_gio_nghi`. Build a workbook from a fixture and assert its header row does not contain the two removed labels, contains `Tổng ngày nghỉ`, and the corresponding cell is numeric `2.5`.

- [ ] **Step 4: Run focused tests**

Run: `cd server && node --test scripts/setupHrSheet.test.js hr/hrLeaveExportService.test.js`

Expected: PASS without any Google network call.

- [ ] **Step 5: Preview and apply the live migration deliberately**

Before execution, back up or duplicate the HR spreadsheet tab. Print the detected deprecated headers and target indices, then run:

Run: `cd server && npm run setup:hr-sheet`

Expected: exactly `Thời gian kết thúc nghỉ` and `Tổng giờ nghỉ` are removed; `Tổng ngày nghỉ` remains populated on existing rows; the sheet has 20 columns in application order.

This live command mutates Google Sheets and must only be run when the implementer has the configured service-account credentials and authorization to change the production spreadsheet.

- [ ] **Step 6: Commit**

```bash
git add server/scripts/setupHrSheet.js server/scripts/setupHrSheet.test.js server/hr/hrLeaveExportService.js server/hr/hrLeaveExportService.test.js
git commit -m "feat: migrate HR sheet to leave days schema"
```

### Task 5: Align the HR web interface

**Files:**
- Modify: `server/public/humanresources/index.html`
- Modify: `server/test/frontend/hr-leave-loading.test.js`

**Interfaces:**
- Consumes: POST contract `{ thoi_gian_bat_dau, tong_ngay_nghi }` and list records from Task 3.
- Produces: a form and table with no end-time/hour fields.

- [ ] **Step 1: Add failing DOM and payload tests**

Assert after loading the page:

```js
assert.equal(window.document.getElementById('maEnd'), null);
assert.ok(window.document.getElementById('maDays'));
assert.equal(window.document.getElementById('maDays').getAttribute('step'), '0.5');
assert.doesNotMatch(window.document.querySelector('#leaveTable thead').textContent, /Tổng giờ/);
assert.match(window.document.querySelector('#leaveTable thead').textContent, /Tổng ngày nghỉ/);
```

Submit with `maDays.value = '2.5'` and assert request JSON has `tong_ngay_nghi: 2.5` and no `thoi_gian_ket_thuc`/`tong_gio_nghi` keys.

- [ ] **Step 2: Run frontend test and verify failure**

Run: `cd server && node --test test/frontend/hr-leave-loading.test.js`

Expected: FAIL because the old end-time and total-hour elements still exist.

- [ ] **Step 3: Replace the form field**

Replace `maEnd` with:

```html
<div class="form-group">
  <label for="maDays">Số ngày nghỉ *</label>
  <input type="number" id="maDays" class="form-control" min="0.5" step="0.5" required placeholder="Ví dụ: 2,5">
  <small class="form-hint">Đơn vị nghỉ là bội của 0,5 ngày.</small>
</div>
```

The browser number input posts `Number(maDays.value)`. Backend validation remains authoritative.

- [ ] **Step 4: Update table rendering and sorting**

Change headers to separate `Bắt đầu nghỉ` and `Tổng ngày nghỉ`. Render:

```js
<td data-sort-value="${new Date(r.thoi_gian_bat_dau).getTime() || ''}">${formatDateTime(r.thoi_gian_bat_dau)}</td>
<td data-sort-value="${Number(r.tong_ngay_nghi) || ''}">${fmtSoNgay(r.tong_ngay_nghi)} ngày</td>
```

Update `colspan` from 9 to 8 where appropriate and update `SORT_FIELD_BY_COLUMN` to:

```js
['request_id', 'ho_ten', 'ly_do', 'thoi_gian_bat_dau', 'tong_ngay_nghi', 'nguoi_ban_giao', 'trang_thai', 'nguoi_duyet']
```

- [ ] **Step 5: Run frontend tests**

Run: `cd server && node --test test/frontend/hr-leave-loading.test.js test/frontend/export-ui.test.js`

Expected: PASS.

- [ ] **Step 6: Manually verify web behavior**

As a manager, open `/humanresources/`, create a manual record with start `22/06/2026 08:30` through the native date-time control and duration `2.5`. Verify the list shows one start time and `2,5 ngày`, filtering still uses the start date, sorting by total days is numeric, and exported Excel matches the visible schema.

- [ ] **Step 7: Commit**

```bash
git add server/public/humanresources/index.html server/test/frontend/hr-leave-loading.test.js
git commit -m "feat: show HR leave duration in days"
```

### Task 6: Documentation and full verification

**Files:**
- Modify: `CHINH-SACH-NGHI-PHEP.md`
- Modify: `README.md`
- Modify: `server/README.md`

**Interfaces:**
- Consumes: final bot/API/Sheets/web behavior from Tasks 1–5.
- Produces: operating instructions matching the released implementation.

- [ ] **Step 1: Document the exact bot conversation contract**

Add an example:

```text
Thời gian bắt đầu: 22/6/2026 8h30
Bot chuẩn hóa: 22/06/2026 08:30
Số ngày nghỉ: 2,5
Giá trị lưu: 2.5 ngày
```

State that duration is positive and increments by 0.5 day; no end time or total-hour conversion is stored.

- [ ] **Step 2: Update Sheet and API documentation**

List only `thoi_gian_bat_dau` and `tong_ngay_nghi` for duration data. Remove references to the two deleted columns/end-time payload fields wherever they describe current behavior.

- [ ] **Step 3: Run a repository-wide stale-reference scan**

Run:

```bash
rg -n "thoi_gian_ket_thuc|tong_gio_nghi|Thời gian kết thúc nghỉ|Tổng giờ nghỉ|computeDurationHours" server README.md CHINH-SACH-NGHI-PHEP.md
```

Expected: no active-code or current-documentation references. Historical migration constants/tests may mention the old header names intentionally.

- [ ] **Step 4: Run the complete automated suite**

Run: `cd server && npm test`

Expected: all tests PASS with no unhandled rejection or Google network access.

- [ ] **Step 5: Run the end-to-end acceptance checklist**

- Bot input `22/6/2026 8h30` is confirmed as `22/06/2026 08:30`.
- Bot input `2,5` is confirmed and stored as numeric `2.5`.
- Bot rejects `31/02/2026 08:30` and `1.2` without advancing the conversation.
- Telegram record, manual web record, list table, charts and Excel export all use `tong_ngay_nghi` consistently.
- Google Sheet no longer contains the two deprecated columns and retains historical total-day values.
- Urgent-leave flag and approval/Telegram notification flows still work.

- [ ] **Step 6: Commit**

```bash
git add CHINH-SACH-NGHI-PHEP.md README.md server/README.md
git commit -m "docs: update HR leave duration workflow"
```

## Self-Review

- Spec coverage: date/time recognition, normalized display, comma/dot days, 0.5-day validation, removal of hour calculation, deletion of two Sheet fields, web parity, export, migration and regression tests are each mapped to a task.
- Placeholder scan: no deferred implementation markers or undefined “handle similarly” steps remain.
- Type consistency: `parseLeaveStart` returns `Date|null`; `parseLeaveDays` returns `number|null`; all persisted/API/UI values use `tong_ngay_nghi: number`; removed fields never appear in new runtime payloads.
- Migration safety: deletion is based on exact old headers and descending indices, preserving the old total-day data while shifting it into the new schema position.
