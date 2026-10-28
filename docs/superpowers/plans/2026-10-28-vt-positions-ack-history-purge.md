# VT hàng: "Đã sửa", lịch sử trừ tồn theo mã đơn, xóa lịch sử — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm cờ "Đã sửa" cho dòng VT có cảnh báo, ghi mã đơn làm người sửa cho mọi lần trừ tồn theo đơn, và thêm nút xóa lịch sử VT (theo khoảng ngày, có phân quyền, để lại dấu vết).

**Architecture:** Migration 0099 thêm cột `stock_positions.format_ack`, mở rộng CHECK action của lịch sử, và nới trigger chặn xóa lịch sử (chỉ cho DELETE khi giao dịch đặt `app.history_purge = 'on'`). `stockPositionsService` thêm `acknowledge` và `purgeHistory`; route thêm `POST /:id/ack` và `DELETE /history`; `pickAssignmentsService.confirm` ghi mã đơn làm người sửa. Giao diện `vt-positions` thêm nút trong hộp chi tiết và hộp thoại xóa lịch sử.

**Tech Stack:** Node.js 22/24 (CommonJS), Express, Postgres (test bằng PGlite), HTML/CSS/JS thuần, `node:test` + JSDOM.

## Global Constraints

- CommonJS (`require`/`module.exports`), không thêm framework; giao diện HTML/CSS/JS thuần, hỗ trợ Sáng/Tối, responsive.
- Giờ giấc theo `Asia/Ho_Chi_Minh` (UTC+7); ngày nhập trên giao diện dạng `dd/mm/yyyy`, gửi API dạng `yyyy-mm-dd`.
- Cờ "Đã sửa" giữ mãi, áp cho **mọi** cảnh báo (`multi`, `loose`, `unreadable`, `badnumber`, `unknowncode`).
- Quyền xóa lịch sử: `stockLocationsV2.historyDelete`, mặc định chỉ Quản lý, `requires: 'stockLocationsV2.view'`.
- Sau mỗi lần xóa lịch sử phải ghi 1 dòng `history_purged` (ngoài phạm vi vừa xóa).
- Hộp thoại xóa có đúng câu: "Bạn có chắc chắn muốn xóa? Hãy lưu dữ liệu lịch sử trước khi xóa." Chỉ bấm OK mới xóa.
- Ghi chú code theo phong cách file hiện có (tiếng Việt không dấu trong service/migration, có dấu ở thông báo cho người dùng).
- Commit chỉ `git add` đúng các file của task (working tree còn thay đổi khác chưa commit: `carton.js`, `README.md`… — không được đưa vào).
- Chạy test bằng `cd "d:\Web TKS Dashboard\server"; node --test <đường dẫn file>` (PowerShell) — test file cần đường dẫn cụ thể.

## File Structure

| File | Trách nhiệm |
| --- | --- |
| `server/db/migrations/0099_stock_position_ack_and_history_purge.sql` (mới) | Cột `format_ack`, CHECK action mới, trigger cho phép DELETE khi có cờ purge |
| `server/auth/featureRegistry.js` | Khai báo quyền `stockLocationsV2.historyDelete` |
| `server/stockPositions/stockPositionsService.js` | `shape` (acknowledged/rawWarnings), `acknowledge`, `purgeHistory` |
| `server/stockPositions/stockPositionsHistoryLabels.js` | Nhãn `ack`/`unack`/`history_purged` + tóm tắt cho Excel/lọc |
| `server/stockPositions/stockPositionsRoutes.js` | `POST /:id/ack`, `DELETE /history`, `canDeleteHistory` trong danh sách |
| `server/pickAssignments/pickAssignmentsService.js` | Người sửa tồn = mã đơn trong `confirm` |
| `server/public/vt-positions/{index.html,vt-positions.js,vt-positions.css,vt-detail.css}` | Nút/nhãn Đã sửa, hộp xóa lịch sử |
| `server/test/frontend/vt-positions-ack-purge.test.js` (mới) | Test giao diện cho 2 tính năng |

---

### Task 1: Migration 0099 + quyền `stockLocationsV2.historyDelete`

**Files:**
- Create: `server/db/migrations/0099_stock_position_ack_and_history_purge.sql`
- Modify: `server/auth/featureRegistry.js:120`
- Modify: `server/auth/featureRegistry.test.js:61`
- Modify: `server/auth/adminUserRoutes.test.js:40`

**Interfaces:**
- Produces: cột `stock_positions.format_ack BOOLEAN NOT NULL DEFAULT false`; action mới `ack`, `unack`, `history_purged` hợp lệ trong `stock_position_history`; DELETE lịch sử chỉ qua được khi `current_setting('app.history_purge', true) = 'on'`; quyền `stockLocationsV2.historyDelete`.

- [ ] **Step 1: Viết test quyền (fail)**

Trong `server/auth/featureRegistry.test.js`, ngay sau dòng `assert.equal(defaults.includes('stockLocationsV2.export'), manager, vaiTro);` thêm:

```js
    assert.equal(defaults.includes('stockLocationsV2.historyDelete'), manager, vaiTro);
```

Trong `server/auth/adminUserRoutes.test.js` sửa dòng 40:

```js
  assert.deepEqual(vt, ['stockLocationsV2.edit', 'stockLocationsV2.export', 'stockLocationsV2.historyDelete', 'stockLocationsV2.view']);
```

- [ ] **Step 2: Chạy, thấy fail**

Run: `node --test auth/featureRegistry.test.js auth/adminUserRoutes.test.js`
Expected: FAIL (thiếu `stockLocationsV2.historyDelete`).

- [ ] **Step 3: Thêm quyền**

Trong `server/auth/featureRegistry.js`, sau dòng `stockLocationsV2.export` (dòng 120) thêm:

```js
  { key: 'stockLocationsV2.historyDelete', groupKey: 'stockLocations', label: 'Xóa lịch sử VT Hà Nội / VT Sài Gòn (cần xem VT)', roles: MANAGER_ONLY, requires: 'stockLocationsV2.view' },
```

- [ ] **Step 4: Viết migration**

`server/db/migrations/0099_stock_position_ack_and_history_purge.sql`:

```sql
-- VT Ha Noi / VT Sai Gon (2026-10-28): co "Da sua", hanh dong lich su moi, xoa lich su co kiem soat.
--
-- format_ack: nguoi dung xac nhan canh bao cua dong (moi loai canh bao) da duoc xu ly. Giu mai cho den khi bo tay;
-- sua ghi chu KHONG tu bo co. Canh bao van duoc tinh tu ghi chu (carton.js), co chi doi cach hien thi/dem.
ALTER TABLE stock_positions ADD COLUMN IF NOT EXISTS format_ack BOOLEAN NOT NULL DEFAULT false;

-- ack / unack: bat/tat co Da sua. history_purged: dau vet moi lan xoa lich su (summary = {deleted, from, to}).
ALTER TABLE stock_position_history DROP CONSTRAINT IF EXISTS stock_position_history_action_check;
ALTER TABLE stock_position_history ADD CONSTRAINT stock_position_history_action_check
  CHECK (action IN ('seed', 'create', 'edit', 'delete', 'auto_delete', 'deduct', 'import_replace', 'import_add', 'pick', 'pick_revert', 'ack', 'unack', 'history_purged'));

-- Trigger van chan moi UPDATE; DELETE chi qua duoc khi giao dich dat app.history_purge = 'on'
-- (chi stockPositionsService.purgeHistory dat, bang set_config(..., true) nen chi co hieu luc trong giao dich do).
CREATE OR REPLACE FUNCTION stock_position_history_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.history_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Stock position history is immutable';
END;
$$ LANGUAGE plpgsql;
```

- [ ] **Step 5: Chạy test, thấy pass**

Run: `node --test auth/featureRegistry.test.js auth/adminUserRoutes.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/db/migrations/0099_stock_position_ack_and_history_purge.sql server/auth/featureRegistry.js server/auth/featureRegistry.test.js server/auth/adminUserRoutes.test.js
git commit -m "feat(vt): migration 0099 + quyền stockLocationsV2.historyDelete

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Service `acknowledge` + `shape` (Đã sửa)

**Files:**
- Modify: `server/stockPositions/stockPositionsService.js` (dòng 116, 182-201, `list`/lock/`tx`, thêm `acknowledge`)
- Modify: `server/stockPositions/stockPositionsService.test.js` (fixture dòng ~36 + test mới)

**Interfaces:**
- Consumes: migration 0099 (Task 1).
- Produces: `service.acknowledge(ctx, id, { version, acknowledged: boolean }) -> { row }`; `row.acknowledged: boolean`, `row.rawWarnings: string[]` (cảnh báo gốc), `row.warnings` = `[]` khi đã Đã sửa; lỗi `400 VALIDATION`, `409 NOTHING_TO_ACK`, `409 VERSION_CONFLICT`, `403 BRANCH_OUT_OF_SCOPE`. `tx.ROW_COLUMNS` giữ nguyên danh sách cột cũ (không có `format_ack`) để `pickAssignmentsService` không phụ thuộc migration 0099.

- [ ] **Step 1: Thêm migration vào fixture + viết test (fail)**

Trong `fixture()` của `stockPositionsService.test.js`, ngay sau `await db.exec(migration('0095_stock_positions.sql'));` thêm:

```js
  await db.exec(migration('0099_stock_position_ack_and_history_purge.sql'));
```

Thêm test cuối file:

```js
test('ack: Đã sửa cho dòng có cảnh báo (kể cả Mã SP lạ), giữ khi sửa ghi chú, bỏ đánh dấu, ghi lịch sử, tăng version', async () => {
  const { db, service } = await fixture();
  try {
    const bad = (await service.create(ctx(), 'HN', { code: 'AAA1', notes: 'rác', location: 'A1' })).row;
    assert.deepEqual(bad.warnings, ['unreadable']);
    assert.equal(bad.acknowledged, false);
    const acked = (await service.acknowledge(ctx(), bad.id, { version: bad.version, acknowledged: true })).row;
    assert.equal(acked.acknowledged, true);
    assert.deepEqual(acked.warnings, []);
    assert.deepEqual(acked.rawWarnings, ['unreadable']);
    assert.equal(acked.version, bad.version + 1);
    assert.equal(acked.updatedAt, bad.updatedAt, 'Đã sửa không phải sửa dữ liệu nên không đổi giờ/người cập nhật');
    const edited = (await service.update(ctx(), bad.id, { version: acked.version, notes: 'vẫn rác' })).row;
    assert.equal(edited.acknowledged, true, 'sửa ghi chú không tự bỏ cờ');
    assert.deepEqual(edited.warnings, []);
    assert.deepEqual(edited.rawWarnings, ['unreadable']);
    const unknown = (await service.create(ctx(), 'HN', { code: 'ZZZ9', notes: '1T x 5', location: 'B1' })).row;
    assert.deepEqual(unknown.warnings, ['unknowncode']);
    assert.deepEqual((await service.acknowledge(ctx(), unknown.id, { version: unknown.version, acknowledged: true })).row.warnings, []);
    const back = (await service.acknowledge(ctx(), bad.id, { version: edited.version, acknowledged: false })).row;
    assert.equal(back.acknowledged, false);
    assert.deepEqual(back.warnings, ['unreadable']);
    const log = (await db.query(`SELECT action, actor_name FROM stock_position_history WHERE action IN ('ack', 'unack') ORDER BY id`)).rows;
    assert.deepEqual(log.map(r => [r.action, r.actor_name]), [['ack', 'Quản Lý A'], ['ack', 'Quản Lý A'], ['unack', 'Quản Lý A']]);
    // lặp lại cùng trạng thái: không tăng version, không ghi lịch sử
    assert.equal((await service.acknowledge(ctx(), bad.id, { version: back.version, acknowledged: false })).row.version, back.version);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM stock_position_history WHERE action IN ('ack', 'unack')`)).rows[0].n, 3);
    await assert.rejects(() => service.acknowledge(ctx(), bad.id, { version: back.version, acknowledged: 'yes' }), { statusCode: 400, code: 'VALIDATION' });
    const fine = (await service.create(ctx(), 'HN', { code: 'AAA1', notes: '2T x 10', location: 'C1' })).row;
    await assert.rejects(() => service.acknowledge(ctx(), fine.id, { version: fine.version, acknowledged: true }), { statusCode: 409, code: 'NOTHING_TO_ACK' });
    await assert.rejects(() => service.acknowledge(ctx(), bad.id, { version: 1, acknowledged: true }), { statusCode: 409, code: 'VERSION_CONFLICT' });
    await assert.rejects(() => service.acknowledge(ctx(['SG']), bad.id, { version: back.version, acknowledged: true }), { statusCode: 403, code: 'BRANCH_OUT_OF_SCOPE' });
  } finally { await db.close(); }
});
```

- [ ] **Step 2: Chạy, thấy fail**

Run: `node --test stockPositions/stockPositionsService.test.js`
Expected: test mới FAIL (`service.acknowledge is not a function`); các test cũ vẫn pass.

- [ ] **Step 3: Cài đặt**

Trong `stockPositionsService.js`:

(a) Thay dòng 116 (`const ROW_COLUMNS = ...`) bằng:

```js
const BASE_COLUMNS = 'id, branch, code, name, notes, arrival_date, location, version, updated_by_name, updated_at';
const ROW_COLUMNS = BASE_COLUMNS + ', format_ack';
```

(b) Trong `shape()` thay dòng `warnings: carton.warnings(row.notes, { unknownCode: !product }),` bằng:

```js
      // Cảnh báo gốc tính từ ghi chú; dòng đã "Đã sửa" (format_ack) thì warnings rỗng để không đếm/lọc là cảnh báo.
      acknowledged: Boolean(row.format_ack),
      rawWarnings: rawWarnings,
      warnings: row.format_ack ? [] : rawWarnings,
```

và ngay đầu thân `shape()` (sau `const spec = ...`) thêm:

```js
    const rawWarnings = carton.warnings(row.notes, { unknownCode: !product });
```

(c) Trong khối `tx` ở cuối file đổi `ROW_COLUMNS,` thành `ROW_COLUMNS: BASE_COLUMNS,`.

(d) Thêm hàm sau `remove(...)`:

```js
  // Bat/tat co "Da sua" (xac nhan canh bao). Khong doi du lieu nen khong doi updated_at/nguoi sua cuoi, chi tang version (khoa lac quan).
  async function acknowledge(ctx, id, body = {}) {
    if (typeof body.acknowledged !== 'boolean') throw fail(400, 'VALIDATION', 'Thiếu trạng thái Đã sửa (true/false).', { field: 'acknowledged' });
    const actor = actorOf(ctx);
    return withTransaction(getDb(), async client => {
      const row = await lockRow(client, ctx, id, body.version);
      if (Boolean(row.format_ack) === body.acknowledged) return { row: await shapeOne(client, row) };
      const product = (await loadProducts(client, row.branch, [row.code])).get(row.code);
      const warnings = carton.warnings(row.notes, { unknownCode: !product });
      if (body.acknowledged && !warnings.length) throw fail(409, 'NOTHING_TO_ACK', 'Dòng này không có cảnh báo nên không cần đánh dấu Đã sửa.');
      const { rows } = await client.query(`UPDATE stock_positions SET format_ack = $2, version = version + 1 WHERE id = $1 RETURNING ${ROW_COLUMNS}`, [row.id, body.acknowledged]);
      await writeHistory(client, row.branch, actor, [{ positionId: row.id, code: row.code, location: row.location, action: body.acknowledged ? 'ack' : 'unack', summary: { warnings } }]);
      return { row: await shapeOne(client, rows[0]) };
    });
  }
```

(e) Thêm `acknowledge` vào dòng return `return { list, create, update, deduct, remove, history, historyAll, importFile };` → `return { list, create, update, deduct, remove, acknowledge, history, historyAll, importFile };`.

- [ ] **Step 4: Chạy, thấy pass; rà test cũ**

Run: `node --test stockPositions/stockPositionsService.test.js pickAssignments/pickAssignmentsService.test.js pickAssignments/pickStatusFlow.test.js`
Expected: PASS. Nếu test cũ nào `deepEqual` nguyên một đối tượng dòng (không có `acknowledged`/`rawWarnings`), thêm hai trường này vào giá trị kỳ vọng (`acknowledged: false`, `rawWarnings` = giá trị `warnings` cũ).

- [ ] **Step 5: Commit**

```bash
git add server/stockPositions/stockPositionsService.js server/stockPositions/stockPositionsService.test.js
git commit -m "feat(vt): cờ Đã sửa cho dòng có cảnh báo (service)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Service `purgeHistory` + nhãn lịch sử

**Files:**
- Modify: `server/stockPositions/stockPositionsService.js` (thêm `purgeHistory`, hằng/hàm ngày)
- Modify: `server/stockPositions/stockPositionsHistoryLabels.js`
- Modify: `server/stockPositions/stockPositionsService.test.js`

**Interfaces:**
- Consumes: migration 0099, `tx.writeHistory` nội bộ.
- Produces: `service.purgeHistory(ctx, branch, { from, to }) -> { deleted: number, from: string|null, to: string|null }` (`from`/`to` dạng `yyyy-mm-dd`, bao gồm cả hai đầu, giờ VN; trống = không giới hạn); dòng lịch sử `history_purged` với `summary = { deleted, from, to }`. `ACTION_LABELS` thêm `ack: 'Đánh dấu Đã sửa'`, `unack: 'Bỏ Đã sửa'`, `history_purged: 'Xóa lịch sử'`; `summaryText` hiểu `from`/`to`/`warnings`.

- [ ] **Step 1: Viết test (fail)**

Thêm cuối `stockPositionsService.test.js`:

```js
test('purgeHistory: xóa theo khoảng ngày giờ VN, chỉ cơ sở chỉ định, để lại dòng history_purged, UPDATE vẫn bị chặn', async () => {
  const { db, service } = await fixture();
  try {
    const add = (branch, iso, code) => db.query(`INSERT INTO stock_position_history (branch, created_at, code, action, actor_name) VALUES ($1, $2, $3, 'edit', 'x')`, [branch, iso, code]);
    await add('HN', '2026-10-01T16:59:00Z', 'D1'); // 01/10 23:59 giờ VN
    await add('HN', '2026-10-01T17:00:00Z', 'D2'); // 02/10 00:00
    await add('HN', '2026-10-03T16:59:59Z', 'D3'); // 03/10 23:59:59
    await add('HN', '2026-10-03T17:00:00Z', 'D4'); // 04/10 00:00
    await add('SG', '2026-10-02T05:00:00Z', 'S1');
    const result = await service.purgeHistory(ctx(), 'HN', { from: '2026-10-02', to: '2026-10-03' });
    assert.deepEqual(result, { deleted: 2, from: '2026-10-02', to: '2026-10-03' });
    const left = (await db.query(`SELECT code FROM stock_position_history WHERE code <> '' ORDER BY code`)).rows.map(r => r.code);
    assert.deepEqual(left, ['D1', 'D4', 'S1']);
    const purged = (await db.query(`SELECT branch, actor_name, summary FROM stock_position_history WHERE action = 'history_purged'`)).rows;
    assert.equal(purged.length, 1);
    assert.equal(purged[0].branch, 'HN');
    assert.equal(purged[0].actor_name, 'Quản Lý A');
    assert.deepEqual(purged[0].summary, { deleted: 2, from: '2026-10-02', to: '2026-10-03' });
    // Xóa toàn bộ cơ sở: gồm cả dòng history_purged cũ, rồi để lại 1 dòng mới
    assert.equal((await service.purgeHistory(ctx(), 'HN', {})).deleted, 3);
    const hn = (await db.query(`SELECT action, summary FROM stock_position_history WHERE branch = 'HN'`)).rows;
    assert.deepEqual(hn.map(r => r.action), ['history_purged']);
    assert.deepEqual(hn[0].summary, { deleted: 3, from: null, to: null });
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM stock_position_history WHERE branch = 'SG'`)).rows[0].n, 1);
    // Ngoài hàm purge vẫn bất biến; trong giao dịch có cờ purge thì UPDATE vẫn bị chặn
    await assert.rejects(() => db.query('DELETE FROM stock_position_history'), /immutable/);
    await db.exec(`BEGIN; SELECT set_config('app.history_purge', 'on', true);`);
    await assert.rejects(() => db.query(`UPDATE stock_position_history SET actor_name = 'y'`), /immutable/);
    await db.exec('ROLLBACK');
    await assert.rejects(() => service.purgeHistory(ctx(['SG']), 'HN', {}), { statusCode: 403, code: 'BRANCH_OUT_OF_SCOPE' });
    await assert.rejects(() => service.purgeHistory(ctx(), 'HN', { from: '2026-13-40' }), { statusCode: 400, code: 'VALIDATION' });
    await assert.rejects(() => service.purgeHistory(ctx(), 'HN', { from: '2026-10-05', to: '2026-10-01' }), { statusCode: 400, code: 'VALIDATION' });
    await assert.rejects(() => service.purgeHistory(ctx(), 'XX', {}), { statusCode: 400, code: 'INVALID_BRANCH' });
  } finally { await db.close(); }
});
```

Tạo `server/stockPositions/stockPositionsHistoryLabels.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ACTION_LABELS, summaryText } = require('./stockPositionsHistoryLabels');

test('nhãn + tóm tắt cho ack / unack / history_purged', () => {
  assert.equal(ACTION_LABELS.ack, 'Đánh dấu Đã sửa');
  assert.equal(ACTION_LABELS.unack, 'Bỏ Đã sửa');
  assert.equal(ACTION_LABELS.history_purged, 'Xóa lịch sử');
  assert.equal(summaryText({ warnings: ['unreadable', 'unknowncode'] }), 'Sai định dạng, Mã SP lạ');
  assert.equal(summaryText({ deleted: 5, from: '2026-10-01', to: '2026-10-05' }), 'Xóa 5 · 01/10/2026 – 05/10/2026');
  assert.equal(summaryText({ deleted: 5, from: '2026-10-01', to: null }), 'Xóa 5 · từ 01/10/2026');
  assert.equal(summaryText({ deleted: 5, from: null, to: '2026-10-05' }), 'Xóa 5 · đến 05/10/2026');
  assert.equal(summaryText({ deleted: 5, from: null, to: null }), 'Xóa 5 · toàn bộ');
});
```

- [ ] **Step 2: Chạy, thấy fail**

Run: `node --test stockPositions/stockPositionsService.test.js stockPositions/stockPositionsHistoryLabels.test.js`
Expected: FAIL (`purgeHistory is not a function`, nhãn thiếu).

- [ ] **Step 3: Cài đặt nhãn**

Trong `stockPositionsHistoryLabels.js`: thêm vào `ACTION_LABELS` sau dòng `pick: ..., pick_revert: ...`:

```js
  // 2026-10-28: co Da sua + dau vet xoa lich su (migration 0099).
  ack: 'Đánh dấu Đã sửa', unack: 'Bỏ Đã sửa', history_purged: 'Xóa lịch sử'
```

(nhớ thêm dấu phẩy sau `pick_revert: 'Hoàn tác nhặt hàng'`). Thêm hằng và đổi `summaryText`:

```js
const WARNING_LABELS = Object.freeze({ multi: 'Nhiều quy cách', loose: 'Trừ lẻ', unreadable: 'Sai định dạng', badnumber: 'Số thùng sai', unknowncode: 'Mã SP lạ' });
const vnDate = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
```

Trong `summaryText`, sau dòng `if (summary.rows !== undefined) ...` thêm:

```js
  if ('from' in summary || 'to' in summary) {
    parts.push(summary.from && summary.to ? `${vnDate(summary.from)} – ${vnDate(summary.to)}` : summary.from ? `từ ${vnDate(summary.from)}` : summary.to ? `đến ${vnDate(summary.to)}` : 'toàn bộ');
  }
  if (Array.isArray(summary.warnings)) parts.push(summary.warnings.map(code => WARNING_LABELS[code] || code).join(', '));
```

- [ ] **Step 4: Cài đặt service**

Trong `stockPositionsService.js`, thêm gần các helper đầu file (sau `isoOf`):

```js
// Ngay loc xoa lich su: rong -> null; dung dang yyyy-mm-dd va la ngay that.
function dateParam(value, field) {
  const text = clean(value);
  if (!text) return null;
  const valid = /^\d{4}-\d{2}-\d{2}$/u.test(text) && new Date(text + 'T00:00:00Z').toISOString().slice(0, 10) === text;
  if (!valid) throw fail(400, 'VALIDATION', 'Ngày không hợp lệ (cần dạng yyyy-mm-dd).', { field });
  return text;
}
```

(`new Date('2026-13-40T00:00:00Z')` ném RangeError khi `.toISOString()`; bọc để thành lỗi 400: dùng `const valid = /…/.test(text) && Number.isFinite(Date.parse(text + 'T00:00:00Z')) && new Date(text + 'T00:00:00Z').toISOString().slice(0, 10) === text;`.)

Thêm hàm trong `createStockPositionsService`, sau `historyAll`:

```js
  // Xoa lich su cua MOT co so theo khoang ngay (gio VN, gom ca 2 dau; trong = khong gioi han). Trigger chi cho DELETE khi
  // giao dich dat app.history_purge = 'on'. Xong ghi 1 dong 'history_purged' (nam ngoai pham vi vua xoa) lam dau vet.
  async function purgeHistory(ctx, branch, { from, to } = {}) {
    assertBranch(branch);
    assertScope(ctx, branch);
    const fromDay = dateParam(from, 'from');
    const toDay = dateParam(to, 'to');
    if (fromDay && toDay && fromDay > toDay) throw fail(400, 'VALIDATION', 'Từ ngày phải trước hoặc bằng Đến ngày.', { field: 'from' });
    const actor = actorOf(ctx);
    return withTransaction(getDb(), async client => {
      await lockBranch(client, branch);
      await client.query(`SELECT set_config('app.history_purge', 'on', true)`);
      const { rows } = await client.query(
        `DELETE FROM stock_position_history WHERE branch = $1
           AND ($2::date IS NULL OR created_at >= $2::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
           AND ($3::date IS NULL OR created_at < ($3::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
         RETURNING id`, [branch, fromDay, toDay]);
      await client.query(`SELECT set_config('app.history_purge', 'off', true)`);
      const summary = { deleted: rows.length, from: fromDay, to: toDay };
      await writeHistory(client, branch, actor, [{ action: 'history_purged', summary }]);
      return summary;
    });
  }
```

và thêm `purgeHistory` vào dòng `return {...}` cuối factory.

- [ ] **Step 5: Chạy, thấy pass**

Run: `node --test stockPositions/stockPositionsService.test.js stockPositions/stockPositionsHistoryLabels.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/stockPositions/stockPositionsService.js server/stockPositions/stockPositionsService.test.js server/stockPositions/stockPositionsHistoryLabels.js server/stockPositions/stockPositionsHistoryLabels.test.js
git commit -m "feat(vt): xóa lịch sử theo khoảng ngày + nhãn lịch sử mới

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Route `POST /:id/ack`, `DELETE /history`, `canDeleteHistory`

**Files:**
- Modify: `server/stockPositions/stockPositionsRoutes.js`
- Modify: `server/stockPositions/stockPositionsRoutes.test.js`

**Interfaces:**
- Consumes: `service.acknowledge`, `service.purgeHistory` (Task 2–3), quyền `stockLocationsV2.historyDelete` (Task 1).
- Produces: `POST /api/stock-positions/:id/ack` (body `{version, acknowledged}`, quyền edit) → `{row}`; `DELETE /api/stock-positions/history?branch=&from=&to=` (quyền historyDelete) → `{deleted, from, to}`; `GET /api/stock-positions` trả thêm `canDeleteHistory: boolean`.

- [ ] **Step 1: Viết test (fail)**

Trong `stockPositionsRoutes.test.js`, đổi `start()` để service giả có 2 hàm mới: sau `remove: record('remove'), history: record('history'),` thêm `acknowledge: record('acknowledge'), purgeHistory: record('purgeHistory'),`. Thêm test cuối file:

```js
test('Đã sửa + xóa lịch sử: chuyển tham số, route history không bị /:id nuốt, canDeleteHistory theo quyền', async t => {
  const { base, calls } = await start(t);
  const json = { 'Content-Type': 'application/json' };
  const list = await (await fetch(base + '?branch=HN')).json();
  assert.equal(list.canDeleteHistory, true);
  assert.equal((await fetch(base + '/7/ack', { method: 'POST', headers: json, body: JSON.stringify({ version: 2, acknowledged: true }) })).status, 200);
  assert.equal((await fetch(base + '/history?branch=SG&from=2026-10-01&to=2026-10-05', { method: 'DELETE' })).status, 200);
  assert.equal((await fetch(base + '/history?branch=HN', { method: 'DELETE' })).status, 200);
  assert.deepEqual(calls.map(c => c[0]), ['list', 'acknowledge', 'purgeHistory', 'purgeHistory']);
  assert.deepEqual(calls[1].slice(1), [7, { version: 2, acknowledged: true }]);
  assert.deepEqual(calls[2].slice(1), ['SG', { from: '2026-10-01', to: '2026-10-05' }]);
  assert.deepEqual(calls[3].slice(1), ['HN', { from: undefined, to: undefined }]);
});

test('Quyền: chỉ sửa được Đã sửa khi có edit; chỉ xóa lịch sử khi có historyDelete', async t => {
  const editor = { vaiTro: 'Nhân viên kho', featurePermissions: { 'stockLocationsV2.view': true, 'stockLocationsV2.edit': true } };
  const { base, calls } = await start(t, { user: editor });
  const json = { 'Content-Type': 'application/json' };
  assert.equal((await (await fetch(base + '?branch=HN')).json()).canDeleteHistory, false);
  assert.equal((await fetch(base + '/7/ack', { method: 'POST', headers: json, body: JSON.stringify({ version: 1, acknowledged: true }) })).status, 200);
  assert.equal((await fetch(base + '/history?branch=HN', { method: 'DELETE' })).status, 403);
  const viewer = await start(t, { user: { vaiTro: 'Nhân viên kho', featurePermissions: { 'stockLocationsV2.view': true } } });
  assert.equal((await fetch(viewer.base + '/7/ack', { method: 'POST', headers: json, body: '{}' })).status, 403);
  const granted = await start(t, { user: { vaiTro: 'Nhân viên kho', featurePermissions: { 'stockLocationsV2.view': true, 'stockLocationsV2.historyDelete': true } } });
  assert.equal((await fetch(granted.base + '/history?branch=HN', { method: 'DELETE' })).status, 200);
  assert.deepEqual(calls.map(c => c[0]), ['list', 'acknowledge']);
});
```

- [ ] **Step 2: Chạy, thấy fail**

Run: `node --test stockPositions/stockPositionsRoutes.test.js`
Expected: FAIL (404 / thiếu `canDeleteHistory`).

- [ ] **Step 3: Cài đặt**

Trong `stockPositionsRoutes.js`:

(a) Dòng list: `res.json({ ...result, canEdit: ..., canExport: ... });` thêm `canDeleteHistory: hasFeature(req.user, 'stockLocationsV2.historyDelete')`.

(b) Ngay sau route `GET /api/stock-positions/history/export` (trước `router.post('/api/stock-positions/import'...`) thêm:

```js
  // Xoa lich su cua mot co so theo khoang ngay (yyyy-mm-dd, trong = khong gioi han); quyen rieng stockLocationsV2.historyDelete.
  // Dat TRUOC router.delete('/:id') de khong bi coi 'history' la ma dong.
  router.delete('/api/stock-positions/history', requireFeature('stockLocationsV2.historyDelete'), handle(async (req, res) => {
    res.json(await svc().purgeHistory(ctxOf(req), req.query.branch, { from: req.query.from, to: req.query.to }));
  }));
```

(c) Sau route `POST /:id/deduct` thêm:

```js
  router.post('/api/stock-positions/:id/ack', edit, handle(async (req, res) => {
    res.json(await svc().acknowledge(ctxOf(req), idOf(req), req.body || {}));
  }));
```

- [ ] **Step 4: Chạy, thấy pass**

Run: `node --test stockPositions/stockPositionsRoutes.test.js`
Expected: PASS. Nếu test cũ `deepEqual` nguyên body danh sách, thêm `canDeleteHistory` vào giá trị kỳ vọng.

- [ ] **Step 5: Commit**

```bash
git add server/stockPositions/stockPositionsRoutes.js server/stockPositions/stockPositionsRoutes.test.js
git commit -m "feat(vt): route Đã sửa và xóa lịch sử (quyền historyDelete)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Người sửa = mã đơn khi trừ tồn theo đơn

**Files:**
- Modify: `server/pickAssignments/pickAssignmentsService.js:400-441` (`confirm`)
- Modify: `server/pickAssignments/pickStatusFlow.test.js` (test mới cuối file)

**Interfaces:**
- Consumes: `tx.writeHistory`, `tx.removeRow` (nhận `actor = { id, name }`).
- Produces: `stock_position_history.actor_name = mã đơn` cho `pick` / `auto_delete` trong luồng đơn; `stock_positions.updated_by_name = mã đơn`; `summary.confirmedBy` = tên người bấm (`''` khi job Kiot, `actor.id === null`). `order_pick_history` và `confirmed_by_name` vẫn là người bấm. (Hiện không có đường mã nào ghi `pick_revert` — hủy chỉ áp cho đơn Đang bốc và không đụng tồn — nên không có gì cần đổi cho hoàn tác.)

- [ ] **Step 1: Viết test (fail)**

Thêm cuối `pickStatusFlow.test.js`:

```js
test('trừ tồn theo đơn: người sửa = mã đơn (người bấm tay lẫn job Kiot), tên người bấm nằm trong summary', async () => {
  const { db, service } = await fixture({ orders: { DH001: order(), DH002: order({ orderCode: 'DH002', lines: [lineOf('BBB2', 20)] }) } });
  try {
    await addKiotOrder(db, { code: 'DH002', status: 'Hoàn thành', id: 2, lines: [{ productCode: 'BBB2', quantity: 20 }] });
    const manual = (await service.assign(ctx(), body([{ productCode: 'AAA1', positionId: 1, qty: 250 }]))).assignment;
    await service.confirm(ctx(), manual.id, { version: 1 });
    await service.assign(ctx(), { branch: 'HN', orderCode: 'DH002', allocations: [{ productCode: 'BBB2', positionId: 3, qty: 20 }] });
    await service.reconcileWithKiot();
    const log = (await db.query(`SELECT position_id, actor_name, summary FROM stock_position_history WHERE action = 'pick' ORDER BY id`)).rows;
    assert.deepEqual(log.map(r => [Number(r.position_id), r.actor_name, r.summary.confirmedBy]), [[1, 'DH001', 'Quản Lý A'], [3, 'DH002', '']]);
    const updated = (await db.query(`SELECT updated_by_name FROM stock_positions WHERE id IN (1, 3) ORDER BY id`)).rows.map(r => r.updated_by_name);
    assert.deepEqual(updated, ['DH001', 'DH002']);
    const orderLog = (await db.query(`SELECT order_code, actor_name FROM order_pick_history WHERE action = 'confirm' ORDER BY id`)).rows;
    assert.deepEqual(orderLog.map(r => [r.order_code, r.actor_name]), [['DH001', 'Quản Lý A'], ['DH002', 'Hệ thống (KiotViet)']]);
  } finally { await db.close(); }
});
```

- [ ] **Step 2: Chạy, thấy fail**

Run: `node --test pickAssignments/pickStatusFlow.test.js`
Expected: test mới FAIL (actor đang là người bấm / hệ thống).

- [ ] **Step 3: Cài đặt**

Trong `confirm()`:

Thay `const summary = { orderCode: head.order_code, assignmentId: Number(head.id) };` bằng:

```js
      // Ton that do don hang tru: nguoi sua (lich su VT + cot Nguoi sua cuoi) la MA DON; ten nguoi bam that nam trong summary
      // (rong khi job Kiot tu dong, actor.id === null). order_pick_history van ghi nguoi bam.
      const stockActor = { id: actor.id, name: head.order_code };
      const summary = { orderCode: head.order_code, assignmentId: Number(head.id), confirmedBy: actor.id === null ? '' : actor.name };
```

Trong vòng `for (const job of jobs)` đổi:
- `await removeRow(client, head.branch, actor, row, 'auto_delete', ...)` → dùng `stockActor`.
- `[row.id, result.text, actor.id, actor.name]` (câu UPDATE `stock_positions`) → `[row.id, result.text, stockActor.id, stockActor.name]`.
- `await writeHistory(client, head.branch, actor, [{ ... action: 'pick' ...` → `stockActor`.

Các lệnh cập nhật `order_pick_assignments` / `order_pick_history` giữ `actor`.

- [ ] **Step 4: Chạy, thấy pass**

Run: `node --test pickAssignments/pickStatusFlow.test.js pickAssignments/pickAssignmentsService.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/pickAssignments/pickAssignmentsService.js server/pickAssignments/pickStatusFlow.test.js
git commit -m "feat(vt): trừ tồn theo đơn ghi mã đơn làm người sửa

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Giao diện — "Đã sửa" trong bảng và hộp chi tiết

**Files:**
- Modify: `server/public/vt-positions/vt-positions.js` (dòng 21-27, 48-49, 243-251, 409-419, 716, hàm mới)
- Modify: `server/public/vt-positions/vt-positions.css:57` (thêm `.vt-badge.is-ack`)
- Modify: `server/public/vt-positions/vt-detail.css` (nút Đã sửa)
- Modify: `server/public/vt-positions/index.html` (tăng `?v=` của js/css)
- Create: `server/test/frontend/vt-positions-ack-purge.test.js`

**Interfaces:**
- Consumes: `row.acknowledged`, `row.rawWarnings`, `POST /api/stock-positions/:id/ack` → `{row}` (Task 2/4).
- Produces: hàm nội bộ `rawWarningsOf(row)`, `ackDetail()`; nút `#vtDetailAck` (tạo động trong `#vtDetailWarn`).

- [ ] **Step 1: Viết test giao diện (fail)**

Tạo `server/test/frontend/vt-positions-ack-purge.test.js` (setup rút gọn từ `vt-positions-history.test.js`; Task 7 sẽ thêm test xóa lịch sử vào cùng file):

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { resolvePermissions, PAGE_FEATURES } = require('../../auth/featureRegistry');

const publicDir = path.join(__dirname, '../../public');
const html = fs.readFileSync(path.join(publicDir, 'vt-positions/index.html'), 'utf8');
const code = fs.readFileSync(path.join(publicDir, 'vt-positions/vt-positions.js'), 'utf8');
const nav = fs.readFileSync(path.join(publicDir, 'shared/shared-nav.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const row = (id, extra = {}) => ({ id, code: 'MA' + id, name: 'Hàng ' + id, notes: '2T x 100', arrivalDate: '', location: 'K' + id, quantity: 200, available: 200, held: 0, kiotQuantity: 350, warnings: [], rawWarnings: [], acknowledged: false, updatedByName: 'Quản lý', updatedAt: '2026-10-27T02:30:00.000Z', version: 3, ...extra });
const BAD = (id = 1) => row(id, { notes: 'rác', quantity: null, warnings: ['unreadable'], rawWarnings: ['unreadable'] });

async function setup(t, { rows = [BAD()], canDeleteHistory = true, handlers = {} } = {}) {
  const dom = new JSDOM(html, { url: 'https://tokosi.test/vt-positions/', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const window = dom.window;
  Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true });
  window.matchMedia = () => ({ matches: false, addEventListener() {} });
  window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
  window.eval(fs.readFileSync(path.join(publicDir, 'shared/fuzzy-search.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(publicDir, 'shared/carton.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(publicDir, 'shared/table-controls.js'), 'utf8'));
  window.eval(nav);
  const base = resolvePermissions({ vaiTro: 'Quản lý' });
  const permissions = [...new Set([...base, 'stockLocationsV2.view', 'stockLocationsV2.edit', ...(canDeleteHistory ? ['stockLocationsV2.historyDelete'] : [])])];
  const user = { vaiTro: 'Quản lý', branch: 'Cả hai', permissions, pageFeatures: PAGE_FEATURES };
  window.TKSNav.authGuard = async () => { window.TKSNav.setPermissions(user); return user; };
  const calls = [];
  window.fetch = async (url, options = {}) => {
    const parsed = new URL(url, window.location.href);
    if (parsed.pathname === '/api/me/table-prefs') return json({ tables: {} });
    const method = options.method || 'GET';
    calls.push({ method, path: parsed.pathname, query: parsed.searchParams, body: options.body ? JSON.parse(options.body) : null });
    const custom = handlers[method + ' ' + parsed.pathname];
    if (custom) return custom(parsed, options);
    if (method === 'GET' && parsed.pathname === '/api/stock-positions') return json({ branch: parsed.searchParams.get('branch'), canEdit: true, canExport: true, canDeleteHistory, rows });
    if (method === 'GET' && parsed.pathname === '/api/stock-positions/history') return json({ rows: [], nextBefore: null });
    return json({ error: 'Không có mock' }, 500);
  };
  window.eval(code);
  await window.TKSVtPositions.init();
  return { window, doc: window.document, calls };
}

test('Đã sửa: dòng sai định dạng mở hộp chi tiết có nút, bấm gửi /ack rồi hiện nhãn xanh và dòng rời bộ lọc Cảnh báo', async t => {
  const acked = row(1, { notes: 'rác', quantity: null, warnings: [], rawWarnings: ['unreadable'], acknowledged: true, version: 4 });
  const { doc, calls } = await setup(t, { handlers: { 'POST /api/stock-positions/1/ack': () => json({ row: acked }) } });
  const warnOption = doc.querySelector('#vtWarnFilter option[value="warn"]');
  assert.match(warnOption.textContent, /Cảnh báo \(1\)/);
  doc.querySelector('#vtRows tr[data-id="1"]').click();
  await settle();
  const button = doc.getElementById('vtDetailAck');
  assert.ok(button, 'có nút đánh dấu');
  assert.equal(button.textContent, 'Đánh dấu Đã sửa');
  button.click();
  await settle();
  const post = calls.find(c => c.method === 'POST');
  assert.equal(post.path, '/api/stock-positions/1/ack');
  assert.deepEqual(post.body, { version: 3, acknowledged: true });
  assert.equal(doc.getElementById('vtDetailAck').textContent, 'Bỏ đánh dấu Đã sửa');
  assert.match(doc.querySelector('#vtDetailWarn .vt-badge.is-ack').textContent, /Đã sửa/);
  assert.match(warnOption.textContent, /Cảnh báo \(0\)/);
  const cell = doc.querySelector('#vtRows tr[data-id="1"] td[data-field="notes"] .vt-badge');
  assert.ok(cell.classList.contains('is-ack'));
  assert.equal(doc.querySelector('#vtRows tr[data-id="1"]').classList.contains('vt-warning'), false);
  // bấm lần nữa = bỏ đánh dấu, dùng version mới
  doc.getElementById('vtDetailAck').click();
  await settle();
  assert.deepEqual(calls.filter(c => c.method === 'POST')[1].body, { version: 4, acknowledged: false });
});

test('Đã sửa: dòng không cảnh báo không có nút; chỉ xem thì không có nút', async t => {
  const { doc } = await setup(t, { rows: [row(2)] });
  doc.querySelector('#vtRows tr[data-id="2"]').click();
  await settle();
  assert.equal(doc.getElementById('vtDetailAck'), null);
});
```

- [ ] **Step 2: Chạy, thấy fail**

Run: `node --test test/frontend/vt-positions-ack-purge.test.js`
Expected: FAIL (không có `#vtDetailAck`).

- [ ] **Step 3: Cài đặt JS**

Trong `vt-positions.js`:

(a) Sau `const warningText = ...` (dòng 49) thêm:

```js
  // Cảnh báo gốc (kể cả khi dòng đã "Đã sửa" nên warnings rỗng).
  const rawWarningsOf = row => (Array.isArray(row.rawWarnings) ? row.rawWarnings : warningsOf(row));
  const warningLabel = code => WARNING_LABELS[code] || (window.PickingCarton && window.PickingCarton.WARNING_LABEL[code]) || code;
```

(b) Trong `buildRow`, thay khối `if (field === 'notes' && warnings.length) { ... }` bằng:

```js
      if (field === 'notes' && row.acknowledged === true) {
        // Đã sửa: nhãn xanh, tooltip giữ lý do cảnh báo gốc.
        const badge = document.createElement('span');
        badge.className = 'vt-badge is-ack';
        badge.textContent = 'Đã sửa';
        badge.title = rawWarningsOf(row).map(warningLabel).join(', ');
        td.appendChild(badge);
      } else if (field === 'notes' && warnings.length) {
        // Nhãn chữ kèm tooltip để không chỉ dựa vào màu.
        const badge = document.createElement('span');
        badge.className = 'vt-badge';
        badge.appendChild(svgIcon('vt-badge-icon', WARN_ICON));
        badge.appendChild(document.createTextNode(warningText(row)));
        badge.title = warningText(row);
        td.appendChild(badge);
      }
```

(c) Trong `renderDetailStats`, thay từ dòng `const codes = carton && carton.warnings ...` đến hết hàm (`box.appendChild(badge); }`) bằng:

```js
    const codes = carton && carton.warnings ? carton.warnings(notes) : [];
    if (rawWarningsOf(row).includes('unknowncode')) codes.push('unknowncode');
    const box = $('vtDetailWarn');
    box.replaceChildren();
    const acked = row.acknowledged === true;
    if (codes.length || acked) {
      const text = codes.map(warningLabel).join(', ');
      const badge = document.createElement('span');
      badge.className = 'vt-badge' + (acked ? ' is-ack' : '');
      badge.title = text;
      if (acked) badge.textContent = 'Đã sửa' + (text ? ' · ' + text : '');
      else badge.append(svgIcon('vt-badge-icon', WARN_ICON), document.createTextNode(text));
      box.appendChild(badge);
    }
    if (editable() && (acked || codes.length)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = 'vtDetailAck';
      button.className = 'locations-columns-button vt-detail-ack';
      button.textContent = acked ? 'Bỏ đánh dấu Đã sửa' : 'Đánh dấu Đã sửa';
      button.addEventListener('click', ackDetail);
      box.appendChild(button);
    }
  }

  // Đổi cờ Đã sửa của dòng đang mở; dùng version mới nhất của dòng, cập nhật bảng + hộp chi tiết, tải lại lịch sử dòng.
  async function ackDetail() {
    if (detail.busy || !detail.row || !editable()) return;
    const row = detail.row, tab = detail.tab;
    setDetailError('');
    setDetailBusy(true);
    try {
      const { response, payload } = await request(API + '/' + encodeURIComponent(row.id) + '/ack', jsonOptions('POST', { version: row.version, acknowledged: row.acknowledged !== true }));
      if (!response.ok) {
        if (payload.code === 'VERSION_CONFLICT') await handleFailure(payload);
        else setDetailError(payload.error || 'Không đổi được trạng thái Đã sửa.');
        return;
      }
      applyResult(tab, payload);
      detail.row = payload.row;
      renderDetailStats();
      if (tab === activeTab) render();
      loadDetailHistory(false);
    } finally {
      setDetailBusy(false);
    }
```

(d) Thêm vào `ACTION_LABELS` (dòng 22-26): `ack: 'Đánh dấu Đã sửa', unack: 'Bỏ Đã sửa', history_purged: 'Xóa lịch sử'`; vào `HISTORY_TONES` (dòng 716): `ack: 'green', unack: 'neutral', history_purged: 'red'`.

(e) Trong `historyValue`, trong khối `if (entry.summary && side === 'new')`, trước dòng `if (s.fileName) ...` thêm:

```js
      if ('from' in s || 'to' in s) parts.push(s.from && s.to ? vnDate(s.from) + ' – ' + vnDate(s.to) : s.from ? 'từ ' + vnDate(s.from) : s.to ? 'đến ' + vnDate(s.to) : 'toàn bộ');
      if (Array.isArray(s.warnings)) parts.push(s.warnings.map(warningLabel).join(', '));
```

và định nghĩa trước `historyValue`: `const vnDate = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);`.

- [ ] **Step 4: CSS + cache-busting**

`vt-positions.css` ngay sau dòng 57 (`.vt-badge{...}`):

```css
.vt-badge.is-ack{border-color:color-mix(in srgb,var(--green,#2e9e5b) 60%,transparent);background:color-mix(in srgb,var(--green,#2e9e5b) 12%,transparent);color:var(--green,#2e9e5b)}
```

`vt-detail.css` thêm: `.vt-detail-warn{display:flex;flex-wrap:wrap;align-items:center;gap:8px}` nếu chưa có `display:flex` (giữ `.vt-detail-warn:empty{display:none}`) và `.vt-detail-ack{padding:3px 10px;font-size:12px}`.

`index.html`: tăng `?v=` của `vt-positions.js` (`20261027-8` → `20261028-1`) và của các `<link>` css VT tương ứng.

- [ ] **Step 5: Chạy test giao diện VT, thấy pass**

Run: `node --test test/frontend/vt-positions-ack-purge.test.js test/frontend/vt-positions.test.js test/frontend/vt-positions-detail.test.js test/frontend/vt-positions-history.test.js`
Expected: PASS. Test cũ nào so `textContent` của `#vtDetailWarn` nguyên khối (nay có thêm chữ của nút) thì đổi sang đọc `#vtDetailWarn .vt-badge`.

- [ ] **Step 6: Commit**

```bash
git add server/public/vt-positions server/test/frontend/vt-positions-ack-purge.test.js server/test/frontend/vt-positions-detail.test.js
git commit -m "feat(vt): giao diện Đã sửa trong bảng và hộp chi tiết

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Giao diện — nút và hộp thoại Xóa lịch sử

**Files:**
- Modify: `server/public/vt-positions/index.html` (nút trong `.vt-history-filters`, hộp `vtPurgeDialog`)
- Modify: `server/public/vt-positions/vt-positions.js` (`newState`, `selectTab`, `renderHistory`, `bindDialogs`, hàm mới)
- Modify: `server/public/vt-positions/vt-history.css`
- Modify: `server/test/frontend/vt-positions-ack-purge.test.js`

**Interfaces:**
- Consumes: `DELETE /api/stock-positions/history?branch=&from=&to=` → `{deleted, from, to}`; `canDeleteHistory` trong danh sách (Task 4).
- Produces: `#vtHistoryPurge` (nút), `#vtPurgeDialog` với `#vtPurgeFrom`, `#vtPurgeTo`, `#vtPurgeError`, `#vtPurgeOk`, `#vtPurgeCancel`.

- [ ] **Step 1: Viết test (fail)**

Thêm cuối `vt-positions-ack-purge.test.js`:

```js
const openHistory = async ({ doc }) => { doc.getElementById('vtHistoryButton').click(); await settle(); };
const WARNING_TEXT = 'Bạn có chắc chắn muốn xóa? Hãy lưu dữ liệu lịch sử trước khi xóa.';

test('Xóa lịch sử: chỉ người có quyền thấy nút; hộp thoại có cảnh báo, ngày sai không gọi API, OK mới xóa rồi tải lại', async t => {
  const ui = await setup(t, { handlers: { 'DELETE /api/stock-positions/history': () => json({ deleted: 7, from: '2026-10-01', to: '2026-10-05' }) } });
  const { doc, calls, window } = ui;
  await openHistory(ui);
  const button = doc.getElementById('vtHistoryPurge');
  assert.equal(button.hidden, false);
  button.click();
  const dialog = doc.getElementById('vtPurgeDialog');
  assert.ok(dialog.hasAttribute('open'));
  assert.ok(dialog.textContent.includes(WARNING_TEXT));
  doc.getElementById('vtPurgeFrom').value = '31/02/2026';
  doc.getElementById('vtPurgeOk').click();
  await settle();
  assert.match(doc.getElementById('vtPurgeError').textContent, /dd\/mm\/yyyy/);
  assert.equal(calls.filter(c => c.method === 'DELETE').length, 0);
  doc.getElementById('vtPurgeFrom').value = '05/10/2026';
  doc.getElementById('vtPurgeTo').value = '01/10/2026';
  doc.getElementById('vtPurgeOk').click();
  await settle();
  assert.match(doc.getElementById('vtPurgeError').textContent, /Từ ngày/);
  assert.equal(calls.filter(c => c.method === 'DELETE').length, 0);
  doc.getElementById('vtPurgeFrom').value = '1/10/2026';
  doc.getElementById('vtPurgeTo').value = '05/10/2026';
  const before = calls.filter(c => c.method === 'GET' && c.path === '/api/stock-positions/history').length;
  doc.getElementById('vtPurgeOk').click();
  await settle();
  const del = calls.filter(c => c.method === 'DELETE');
  assert.equal(del.length, 1);
  assert.equal(del[0].query.get('branch'), 'HN');
  assert.equal(del[0].query.get('from'), '2026-10-01');
  assert.equal(del[0].query.get('to'), '2026-10-05');
  assert.equal(dialog.hasAttribute('open'), false);
  assert.equal(calls.filter(c => c.method === 'GET' && c.path === '/api/stock-positions/history').length, before + 1, 'tải lại lịch sử');
  void window;
});

test('Xóa lịch sử: để trống 2 ngày = xóa toàn bộ (không gửi from/to); Hủy không gọi API', async t => {
  const ui = await setup(t, { handlers: { 'DELETE /api/stock-positions/history': () => json({ deleted: 3, from: null, to: null }) } });
  const { doc, calls } = ui;
  await openHistory(ui);
  doc.getElementById('vtHistoryPurge').click();
  doc.getElementById('vtPurgeCancel').click();
  assert.equal(calls.filter(c => c.method === 'DELETE').length, 0);
  doc.getElementById('vtHistoryPurge').click();
  doc.getElementById('vtPurgeOk').click();
  await settle();
  const del = calls.find(c => c.method === 'DELETE');
  assert.equal(del.query.has('from'), false);
  assert.equal(del.query.has('to'), false);
});

test('Xóa lịch sử: không có quyền historyDelete thì ẩn nút', async t => {
  const ui = await setup(t, { canDeleteHistory: false });
  await openHistory(ui);
  assert.equal(ui.doc.getElementById('vtHistoryPurge').hidden, true);
});
```

(Trong `setup`, `canDeleteHistory: false` vừa bỏ quyền trong `permissions` vừa trả `canDeleteHistory: false` từ API — nút ẩn theo cờ API của cơ sở.)

- [ ] **Step 2: Chạy, thấy fail**

Run: `node --test test/frontend/vt-positions-ack-purge.test.js`
Expected: 3 test mới FAIL (không có `#vtHistoryPurge`).

- [ ] **Step 3: HTML**

Trong `index.html`, trong `.vt-history-filters`, sau nút `#vtHistoryExport` thêm:

```html
        <button class="locations-columns-button vt-hist-purge" id="vtHistoryPurge" type="button" hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M9 7V4h6v3M7 7l1 13h8l1-13"></path></svg>
          Xóa lịch sử
        </button>
```

Trước `<script src="/shared/table-controls.js...` thêm hộp thoại:

```html
  <!-- Xóa lịch sử cập nhật -->
  <dialog class="vt-dialog vt-dialog-narrow" id="vtPurgeDialog" aria-labelledby="vtPurgeTitle">
    <div class="dp-head">
      <div class="dp-head-text"><h3 class="dp-title" id="vtPurgeTitle">Xóa lịch sử</h3><p class="dp-subtitle" id="vtPurgeSubtitle"></p></div>
      <button type="button" class="dp-close" data-vt-close aria-label="Đóng">×</button>
    </div>
    <div class="dp-body">
      <p class="vt-purge-warning" role="alert">Bạn có chắc chắn muốn xóa? Hãy lưu dữ liệu lịch sử trước khi xóa.</p>
      <div class="vt-detail-form">
        <label class="vt-field"><span>Từ ngày</span><input id="vtPurgeFrom" type="text" inputmode="numeric" autocomplete="off" placeholder="dd/mm/yyyy"></label>
        <label class="vt-field"><span>Đến ngày</span><input id="vtPurgeTo" type="text" inputmode="numeric" autocomplete="off" placeholder="dd/mm/yyyy"></label>
      </div>
      <p class="vt-form-hint">Để trống cả hai ô để xóa toàn bộ lịch sử của cơ sở này. Dùng nút Xuất Excel trong hộp Lịch sử để lưu trước.</p>
      <p class="vt-form-error" id="vtPurgeError" role="alert"></p>
      <div class="vt-dialog-actions">
        <button type="button" class="locations-columns-button" id="vtPurgeCancel" data-vt-close>Hủy</button>
        <button type="button" class="locations-columns-button vt-primary vt-danger" id="vtPurgeOk">OK</button>
      </div>
    </div>
  </dialog>
```

- [ ] **Step 4: JS**

Trong `vt-positions.js`:

(a) `newState`: thêm `canDeleteHistory: false` vào đối tượng; trong `selectTab` sau `current.canExport = payload.canExport === true;` thêm `current.canDeleteHistory = payload.canDeleteHistory === true;`.

(b) Trong `renderHistory`, sau dòng `$('vtHistoryExport').hidden = ...` thêm:

```js
    $('vtHistoryPurge').hidden = state[history.branch.toLowerCase()].canDeleteHistory !== true;
```

và trong `openHistory` sau dòng `$('vtHistoryExport').hidden = ...` thêm cùng kiểu cho `vtHistoryPurge` (dùng `activeTab`).

(c) Thêm các hàm sau `exportHistory`:

```js
  // dd/mm/yyyy -> yyyy-mm-dd; '' khi để trống; null khi sai định dạng hoặc không phải ngày thật.
  function parseVnDate(text) {
    const value = String(text || '').trim();
    if (!value) return '';
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
    if (!match) return null;
    const day = Number(match[1]), month = Number(match[2]), year = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  }

  function openPurge() {
    $('vtPurgeFrom').value = '';
    $('vtPurgeTo').value = '';
    $('vtPurgeError').textContent = '';
    $('vtPurgeSubtitle').textContent = 'VT ' + (history.branch === 'HN' ? 'Hà Nội' : 'Sài Gòn');
    openDialog($('vtPurgeDialog'));
  }

  // Xóa lịch sử của cơ sở đang xem theo khoảng ngày (trống = toàn bộ); thành công thì đóng hộp và tải lại danh sách lịch sử.
  async function runPurge() {
    const from = parseVnDate($('vtPurgeFrom').value), to = parseVnDate($('vtPurgeTo').value);
    const error = $('vtPurgeError');
    error.textContent = '';
    if (from === null || to === null) { error.textContent = 'Ngày không hợp lệ (cần dạng dd/mm/yyyy).'; return; }
    if (from && to && from > to) { error.textContent = 'Từ ngày phải trước hoặc bằng Đến ngày.'; return; }
    const params = new URLSearchParams({ branch: history.branch });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    $('vtPurgeOk').disabled = true;
    try {
      const { response, payload } = await request(API + '/history?' + params.toString(), { method: 'DELETE' });
      if (!response.ok) { error.textContent = payload.error || 'Không xóa được lịch sử.'; return; }
      closeDialog($('vtPurgeDialog'));
      loadHistory(false);
    } finally {
      $('vtPurgeOk').disabled = false;
    }
  }
```

(d) Trong `bindDialogs` thêm:

```js
    $('vtHistoryPurge').addEventListener('click', openPurge);
    $('vtPurgeOk').addEventListener('click', runPurge);
```

(Nút Hủy và `×` đã đóng nhờ `data-vt-close`; bindDialogs gắn `data-vt-close` cho mọi `.vt-dialog [data-vt-close]`.)

- [ ] **Step 5: CSS**

`vt-history.css` thêm:

```css
.vt-hist-purge{color:var(--red)}
.vt-purge-warning{margin:0 0 12px;padding:10px 12px;border:1px solid color-mix(in srgb,var(--red) 55%,transparent);border-radius:8px;background:color-mix(in srgb,var(--red) 10%,transparent);color:var(--red);font-weight:600}
```

Tăng `?v=` của `vt-positions.js` và css VT trong `index.html` (nếu Task 6 chưa tăng cho file này).

- [ ] **Step 6: Chạy test, thấy pass**

Run: `node --test test/frontend/vt-positions-ack-purge.test.js test/frontend/vt-positions.test.js test/frontend/vt-positions-detail.test.js test/frontend/vt-positions-history.test.js`
Expected: PASS.

- [ ] **Step 7: Xem trên trình duyệt (tùy chọn, theo `reference-tokosi-view-pages-without-login`)** — mở hộp Lịch sử, kiểm tra nút Xóa lịch sử và hộp thoại ở cả Sáng/Tối và màn hình hẹp.

- [ ] **Step 8: Commit**

```bash
git add server/public/vt-positions server/test/frontend/vt-positions-ack-purge.test.js
git commit -m "feat(vt): nút và hộp thoại Xóa lịch sử theo khoảng ngày

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Tài liệu, kiểm tra toàn bộ, đồ thị mã nguồn

**Files:**
- Modify: `README.md`, `server/README.md`, `server/db/SCHEMA.md`, `CURRENT.md`
- Modify: `docs/04-planning/implementation_plan.md`, `docs/02-srs/SRS_Dashboard_GoogleSheets.md`, `docs/01-brd/BRD_Dashboard_GoogleSheets.md` (chỉ nơi đã mô tả VT hàng / `stock_positions`)
- Modify: `docs/superpowers/specs/2026-10-28-vt-positions-ack-history-purge-design.md` (2 chỉnh sửa nhỏ)
- Modify: `C:\Users\BOSS\.claude\projects\D--Web-TKS-Dashboard\memory\project-tokosi-vt-positions.md`

- [ ] **Step 1: Chỉnh spec cho khớp thực tế**

Trong spec: (a) mục 1 "Giao diện" — chỉ còn nút "Đánh dấu Đã sửa / Bỏ đánh dấu" trong **hộp chi tiết** và nhãn xanh "Đã sửa" trong bảng (không biến nhãn trong bảng thành nút, vì bấm dòng đã mở hộp chi tiết); (b) mục 2 — bỏ chữ "hoàn tác" (hiện không có đường mã ghi `pick_revert`).

- [ ] **Step 2: Cập nhật tài liệu (theo kỹ năng `update-file`, `.agents/skills/update-file/SKILL.md`)**

Ghi: migration 0099 (cột `format_ack`, action `ack`/`unack`/`history_purged`, trigger nới DELETE), API mới (`POST /api/stock-positions/:id/ack`, `DELETE /api/stock-positions/history`, trường `canDeleteHistory`, `acknowledged`, `rawWarnings`), quyền `stockLocationsV2.historyDelete`, quy tắc người sửa = mã đơn, test mới; cập nhật ngày ở cuối mỗi tài liệu. Dùng `Grep` tìm `stockLocationsV2` / `stock_positions` trong `docs/` để chỉ sửa chỗ đã có mô tả VT.

- [ ] **Step 3: Chạy toàn bộ test**

Run (PowerShell): `cd "d:\Web TKS Dashboard\server"; npm test`
Expected: 100% xanh. Nếu có test cũ vỡ vì `deepEqual` nguyên đối tượng dòng/danh sách, thêm trường mới vào giá trị kỳ vọng rồi chạy lại.

- [ ] **Step 4: Cập nhật đồ thị mã nguồn**

Run: `cd "d:\Web TKS Dashboard"; graphify update .`

- [ ] **Step 5: Cập nhật `CURRENT.md` và memory**

`CURRENT.md`: ghi tính năng, trạng thái "chưa migrate 0099 / chưa deploy" và việc kế tiếp (người dùng tự chạy `npm run db:migrate` trước deploy; cấp quyền `stockLocationsV2.historyDelete` cho người cần). Cập nhật file memory `project-tokosi-vt-positions.md` (Đã sửa giữ mãi, mọi cảnh báo; người sửa = mã đơn; xóa lịch sử theo ngày + `history_purged`; trigger `app.history_purge`).

- [ ] **Step 6: Commit**

```bash
git add README.md server/README.md server/db/SCHEMA.md CURRENT.md docs graphify-out
git commit -m "docs(vt): cập nhật tài liệu Đã sửa, người sửa theo mã đơn, xóa lịch sử

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

(Lưu ý `README.md`/`CURRENT.md`/`server/README.md` đang có thay đổi chưa commit từ việc khác: dùng `git add -p` để chỉ đưa phần của task này, hoặc báo người dùng nếu lẫn.)

---

## Self-Review (đối chiếu spec)

- Spec 1 (Đã sửa mọi cảnh báo, giữ mãi, API, lịch sử `ack`/`unack`, nhãn): Task 1 (cột + CHECK), Task 2 (service, mọi cảnh báo gồm `unknowncode`), Task 4 (route), Task 6 (giao diện), Task 3 (nhãn Excel).
- Spec 2 (người sửa = mã đơn, `updated_by_name`, `confirmedBy`): Task 5.
- Spec 3 (quyền, API, khoảng ngày giờ VN, trigger, `history_purged`, hộp thoại đúng câu, OK mới xóa): Task 1, 3, 4, 7.
- Kiểm thử + tài liệu: mỗi task có test; Task 8 tài liệu và toàn bộ test.
- Nhất quán tên: `acknowledge`, `purgeHistory`, `acknowledged`, `rawWarnings`, `canDeleteHistory`, `format_ack`, `app.history_purge`, `#vtDetailAck`, `#vtHistoryPurge`, `#vtPurgeDialog` dùng đồng nhất ở mọi task.
