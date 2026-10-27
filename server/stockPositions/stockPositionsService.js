'use strict';

// Co so du lieu Vi tri hang moi ("VT Ha Noi" / "VT Sai Gon", migration 0095).
// SL kho + canh bao KHONG luu: luon tinh tu ghi chu bang public/shared/carton.js. Ten SP + SL KiotViet doc theo ma tu `products`.
// Moi thao tac ghi chay trong 1 giao dich co khoa advisory theo co so, kem ban ghi stock_position_history cung giao dich.
const { getPool } = require('../db/pool');
const carton = require('../public/shared/carton.js');
const { stripTelegramId } = require('../dashboard/saleName');
const { parseImportWorkbook } = require('./stockPositionsImport');

const BRANCH_CODES = Object.freeze(['HN', 'SG']);
const DB_BRANCH = Object.freeze({ HN: 'hanoi', SG: 'saigon' });
const PRODUCT_TTL_MS = 60 * 1000; // SL KiotViet co the cham vai phut (giam tai doc products.raw)
const MAX = Object.freeze({ code: 60, notes: 500, arrivalDate: 60, location: 100 });
const HISTORY_MAX = 1000;
const ERROR_LIMIT = 50;
const MODES = Object.freeze(['replace', 'add']);

function fail(statusCode, code, message, extra = {}) {
  return Object.assign(new Error(message), { statusCode, code }, extra);
}

const clean = value => String(value ?? '').replace(/\s+/gu, ' ').trim();
const lower = value => clean(value).toLocaleLowerCase('vi');
const keyOf = (code, location) => `${lower(code)}|${lower(location)}`;
const isoOf = value => (value instanceof Date ? value : new Date(value)).toISOString();

function assertBranch(branch) {
  if (!BRANCH_CODES.includes(branch)) throw fail(400, 'INVALID_BRANCH', 'Cơ sở phải là HN hoặc SG.');
  return branch;
}

function assertScope(ctx, branch) {
  if (ctx.scope && !ctx.scope.includes(branch)) throw fail(403, 'BRANCH_OUT_OF_SCOPE', 'Cơ sở yêu cầu không thuộc phạm vi đang chọn.');
}

function actorOf(ctx) {
  const user = ctx.user || {};
  return { id: user.id === undefined || user.id === null ? null : String(user.id), name: stripTelegramId(user.hoTen || user.username || '') };
}

function textField(body, field, label) {
  const value = clean(body[field]);
  if (value.length > MAX[field]) throw fail(400, 'VALIDATION', `${label} tối đa ${MAX[field]} ký tự.`, { field });
  return value;
}

function validNotes(body) {
  const notes = carton.normalizeNote(body.notes);
  if (notes.length > MAX.notes) throw fail(400, 'VALIDATION', `Ghi chú tối đa ${MAX.notes} ký tự.`, { field: 'notes' });
  return notes;
}

// Ghi chu doc duoc nhung tong bang 0 (rong, "Het hang", "1Tx50 - 50") = het hang => tu xoa dong.
const isEmptyNote = notes => { const spec = carton.parseSpec(notes); return Boolean(spec && spec.quantity === 0); };

// Cong don 2 ghi chu (import "Bo sung them SL"): gop quy cach, cong phan tru le. null neu mot ben sai dinh dang.
function mergeNotes(current, added) {
  const a = carton.parseSpec(current);
  const b = carton.parseSpec(added);
  if (!a || !b) return null;
  const terms = [...a.terms, ...b.terms];
  if (!terms.length) return '';
  const loose = a.loose + b.loose;
  const text = terms.map(t => t.cartons + 'T x ' + t.perCarton + (t.suffix || '')).join(' + ') + (loose > 0 ? ' - ' + loose : '');
  return carton.normalizeNote(text);
}

async function withTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

const lockBranch = (client, branch) => client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['stock_positions:' + branch]);

const ON_HAND_SQL = `
  SELECT p.code, p.name, COALESCE(SUM((inv->>'onHand')::numeric), 0)::float8 AS on_hand
  FROM products p
  LEFT JOIN LATERAL jsonb_array_elements(COALESCE(p.raw->'inventories', '[]'::jsonb)) inv ON true
  WHERE p.branch = $1 AND p.code = ANY($2::text[])
  GROUP BY p.code, p.name`;

// Tra khong phan biet hoa/thuong de chuan hoa ma nhap tay / import ve ma KiotViet (khong dung duoc index nen chi goi luc ghi).
const RESOLVE_SQL = `SELECT code, name FROM products WHERE branch = $1 AND lower(code) = ANY($2::text[])`;

const ROW_COLUMNS = 'id, branch, code, name, notes, arrival_date, location, version, updated_by_name, updated_at';

function createStockPositionsService({ getDb = getPool, now = () => Date.now() } = {}) {
  const productCache = new Map(); // nhanh -> Map(code -> {at, product|null})

  async function loadProducts(db, branch, codes) {
    const cache = productCache.get(branch) || productCache.set(branch, new Map()).get(branch);
    const stale = [...new Set(codes)].filter(code => {
      const hit = cache.get(code);
      return !hit || now() - hit.at > PRODUCT_TTL_MS;
    });
    if (stale.length) {
      const found = new Map();
      try {
        for (const row of (await db.query(ON_HAND_SQL, [DB_BRANCH[branch], stale])).rows) found.set(row.code, { name: row.name, onHand: Number(row.on_hand) });
      } catch (error) {
        console.error('[StockPositions] products lookup failed:', error.code || error.message);
        return new Map(); // khong tra duoc SL Kiot: de trong, khong lam hong bang
      }
      for (const code of stale) cache.set(code, { at: now(), product: found.get(code) || null });
    }
    return new Map(codes.map(code => [code, cache.get(code)?.product || null]));
  }

  async function resolveCodes(db, branch, codes) {
    const keys = [...new Set(codes.map(lower).filter(Boolean))];
    const map = new Map();
    if (!keys.length) return map;
    for (const row of (await db.query(RESOLVE_SQL, [DB_BRANCH[branch], keys])).rows) map.set(lower(row.code), { code: row.code, name: row.name });
    return map;
  }

  function shape(row, product) {
    const spec = carton.parseSpec(row.notes);
    return {
      id: Number(row.id),
      code: row.code,
      name: (product && product.name) || row.name,
      notes: row.notes,
      arrivalDate: row.arrival_date,
      location: row.location,
      quantity: spec ? spec.quantity : null,
      kiotQuantity: product ? product.onHand : null,
      warnings: carton.warnings(row.notes, { unknownCode: !product }),
      updatedByName: row.updated_by_name,
      updatedAt: isoOf(row.updated_at),
      version: row.version
    };
  }

  async function shapeOne(db, row) {
    const product = (await loadProducts(db, row.branch, [row.code])).get(row.code);
    return shape(row, product);
  }

  async function list(ctx, branch) {
    assertBranch(branch);
    assertScope(ctx, branch);
    const db = getDb();
    const rows = (await db.query(`SELECT ${ROW_COLUMNS} FROM stock_positions WHERE branch = $1 ORDER BY id`, [branch])).rows;
    const products = await loadProducts(db, branch, rows.map(row => row.code));
    return { branch, rows: rows.map(row => shape(row, products.get(row.code))) };
  }

  const historySql = `INSERT INTO stock_position_history (branch, position_id, code, location, action, field, old_value, new_value, summary, actor_user_id, actor_name)
    SELECT $1, t.position_id, t.code, t.location, t.action, t.field, t.old_value, t.new_value, t.summary::jsonb, $2, $3
    FROM unnest($4::bigint[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[], $11::text[])
      AS t(position_id, code, location, action, field, old_value, new_value, summary)`;

  // entries: [{positionId, code, location, action, field, oldValue, newValue, summary}]
  async function writeHistory(client, branch, actor, entries) {
    if (!entries.length) return;
    const col = pick => entries.map(pick);
    await client.query(historySql, [branch, actor.id, actor.name,
      col(e => e.positionId ?? null), col(e => e.code ?? ''), col(e => e.location ?? ''), col(e => e.action),
      col(e => e.field ?? null), col(e => e.oldValue ?? null), col(e => e.newValue ?? null),
      col(e => (e.summary === undefined ? null : JSON.stringify(e.summary)))]);
  }

  const FIELD_COLUMN = { notes: 'notes', arrivalDate: 'arrival_date', location: 'location' };
  const fieldChanges = (row, next) => ['notes', 'arrivalDate', 'location']
    .filter(field => next[field] !== undefined && next[field] !== row[FIELD_COLUMN[field]])
    .map(field => ({ field, oldValue: row[FIELD_COLUMN[field]], newValue: next[field] }));

  // Dong da co cung (ma, vi tri) (khong phan biet hoa/thuong); exceptId bo qua chinh dong dang sua.
  async function findSamePosition(client, branch, code, location, exceptId = null) {
    const { rows } = await client.query(
      `SELECT ${ROW_COLUMNS} FROM stock_positions WHERE branch = $1 AND lower(btrim(code)) = $2 AND lower(btrim(location)) = $3
         AND ($4::bigint IS NULL OR id <> $4) ORDER BY id LIMIT 1 FOR UPDATE`,
      [branch, lower(code), lower(location), exceptId]);
    return rows[0] || null;
  }

  async function create(ctx, branch, body = {}) {
    assertBranch(branch);
    assertScope(ctx, branch);
    const code = textField(body, 'code', 'Mã hàng');
    if (!code) throw fail(400, 'VALIDATION', 'Vui lòng nhập mã hàng.', { field: 'code' });
    const notes = validNotes(body);
    if (isEmptyNote(notes)) throw fail(400, 'VALIDATION', 'Ghi chú phải có số lượng lớn hơn 0.', { field: 'notes' });
    const arrivalDate = textField(body, 'arrivalDate', 'Ngày về');
    const location = textField(body, 'location', 'Vị trí');
    const actor = actorOf(ctx);
    const db = getDb();
    let merged = false;
    const id = await withTransaction(db, async client => {
      await lockBranch(client, branch);
      const product = (await resolveCodes(client, branch, [code])).get(lower(code));
      const finalCode = product ? product.code : code;
      // Da co dong cung ma + vi tri: tu cong ghi chu vao dong do (Ngay ve lay theo lan nhap moi neu co).
      const same = await findSamePosition(client, branch, finalCode, location);
      if (same) {
        const added = mergeNotes(same.notes, notes);
        if (added === null) throw fail(400, 'VALIDATION', 'Ghi chú sai định dạng nên không cộng được vào dòng sẵn có. Hãy sửa lại ghi chú.', { field: 'notes' });
        const nextDate = arrivalDate || same.arrival_date;
        await client.query(
          `UPDATE stock_positions SET notes = $2, arrival_date = $3, version = version + 1, updated_by_user_id = $4, updated_by_name = $5, updated_at = now() WHERE id = $1`,
          [same.id, added, nextDate, actor.id, actor.name]);
        const changes = fieldChanges(same, { notes: added, arrivalDate: nextDate });
        await writeHistory(client, branch, actor, changes.map(change => ({ positionId: same.id, code: same.code, location: same.location, action: 'edit', ...change, summary: { merged: true, added: notes } })));
        merged = true;
        return same.id;
      }
      const { rows } = await client.query(
        `INSERT INTO stock_positions (branch, code, name, notes, arrival_date, location, updated_by_user_id, updated_by_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [branch, finalCode, product ? product.name : '', notes, arrivalDate, location, actor.id, actor.name]);
      await writeHistory(client, branch, actor, [{ positionId: rows[0].id, code: finalCode, location, action: 'create', newValue: notes, summary: { notes, arrivalDate, location } }]);
      return rows[0].id;
    });
    productCache.get(branch)?.delete(clean(code));
    const row = (await db.query(`SELECT ${ROW_COLUMNS} FROM stock_positions WHERE id = $1`, [id])).rows[0];
    return { row: await shapeOne(db, row), merged };
  }

  // Doc 1 dong de sua (khoa dong), kiem tra pham vi co so + version.
  async function lockRow(client, ctx, id, version) {
    if (!Number.isInteger(id) || id < 1) throw fail(400, 'VALIDATION', 'Mã dòng không hợp lệ.');
    const head = (await client.query('SELECT branch FROM stock_positions WHERE id = $1', [id])).rows[0];
    if (!head) throw fail(404, 'NOT_FOUND', 'Không tìm thấy dòng vị trí (có thể đã bị xóa).');
    assertScope(ctx, head.branch);
    await lockBranch(client, head.branch);
    const row = (await client.query(`SELECT ${ROW_COLUMNS} FROM stock_positions WHERE id = $1 FOR UPDATE`, [id])).rows[0];
    if (!row) throw fail(404, 'NOT_FOUND', 'Không tìm thấy dòng vị trí (có thể đã bị xóa).');
    if (version !== undefined && version !== null && Number(version) !== row.version) {
      throw fail(409, 'VERSION_CONFLICT', 'Dòng đã bị người khác sửa. Dữ liệu mới nhất đã được tải lại.', { latest: await shapeOne(client, row) });
    }
    return row;
  }

  async function removeRow(client, branch, actor, row, action, extra = {}) {
    await client.query('DELETE FROM stock_positions WHERE id = $1', [row.id]);
    await writeHistory(client, branch, actor, [{ positionId: row.id, code: row.code, location: row.location, action, field: 'notes', oldValue: row.notes, newValue: extra.newValue ?? null, summary: extra.summary }]);
  }

  async function update(ctx, id, body = {}) {
    const actor = actorOf(ctx);
    const db = getDb();
    return withTransaction(db, async client => {
      const row = await lockRow(client, ctx, id, body.version);
      const next = {};
      if (body.notes !== undefined) next.notes = validNotes(body);
      if (body.arrivalDate !== undefined) next.arrivalDate = textField(body, 'arrivalDate', 'Ngày về');
      if (body.location !== undefined) next.location = textField(body, 'location', 'Vị trí');
      const changes = fieldChanges(row, next);
      if (!changes.length) return { row: await shapeOne(client, row) };
      const merged = { notes: next.notes ?? row.notes, arrivalDate: next.arrivalDate ?? row.arrival_date, location: next.location ?? row.location };
      if (next.location !== undefined && await findSamePosition(client, row.branch, row.code, merged.location, row.id)) {
        throw fail(409, 'DUPLICATE_POSITION', 'Mã hàng này đã có ở vị trí đó. Hãy dùng Thêm dòng để cộng vào dòng sẵn có.', { field: 'location' });
      }
      if (next.notes !== undefined && isEmptyNote(merged.notes)) {
        if (!body.confirmEmpty) throw fail(409, 'WOULD_AUTO_DELETE', 'Số lượng về 0 nên dòng sẽ bị xóa. Xác nhận để tiếp tục.');
        await removeRow(client, row.branch, actor, row, 'auto_delete', { newValue: merged.notes });
        return { deleted: true, id: Number(row.id) };
      }
      const { rows } = await client.query(
        `UPDATE stock_positions SET notes = $2, arrival_date = $3, location = $4, version = version + 1,
           updated_by_user_id = $5, updated_by_name = $6, updated_at = now() WHERE id = $1 RETURNING ${ROW_COLUMNS}`,
        [row.id, merged.notes, merged.arrivalDate, merged.location, actor.id, actor.name]);
      await writeHistory(client, row.branch, actor, changes.map(change => ({ positionId: row.id, code: row.code, location: merged.location, action: 'edit', ...change })));
      return { row: await shapeOne(client, rows[0]) };
    });
  }

  // Tru SL (vd 3T x 100 tru 200 -> 1T x 100). Ve 0 thi tu xoa dong. Dung cho luong nhat hang ve sau.
  async function deduct(ctx, id, body = {}) {
    const quantity = Number(body.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) throw fail(400, 'VALIDATION', 'Số lượng trừ phải lớn hơn 0.', { field: 'quantity' });
    const actor = actorOf(ctx);
    return withTransaction(getDb(), async client => {
      const row = await lockRow(client, ctx, id, body.version);
      const spec = carton.parseSpec(row.notes);
      if (!spec || spec.empty) throw fail(400, 'NOT_DEDUCTIBLE', 'Ghi chú không đọc được hoặc đã hết hàng nên không trừ được.');
      const result = carton.deduct(spec, quantity);
      if (!result) throw fail(400, 'VALIDATION', 'Số lượng trừ vượt quá số lượng hiện có (' + spec.quantity + ').', { field: 'quantity' });
      if (isEmptyNote(result.text)) {
        await removeRow(client, row.branch, actor, row, 'auto_delete', { newValue: result.text, summary: { deducted: quantity } });
        return { deleted: true, id: Number(row.id) };
      }
      const { rows } = await client.query(
        `UPDATE stock_positions SET notes = $2, version = version + 1, updated_by_user_id = $3, updated_by_name = $4, updated_at = now()
         WHERE id = $1 RETURNING ${ROW_COLUMNS}`, [row.id, result.text, actor.id, actor.name]);
      await writeHistory(client, row.branch, actor, [{ positionId: row.id, code: row.code, location: row.location, action: 'deduct', field: 'notes', oldValue: row.notes, newValue: result.text, summary: { deducted: quantity } }]);
      return { row: await shapeOne(client, rows[0]) };
    });
  }

  async function remove(ctx, id, version) {
    const actor = actorOf(ctx);
    return withTransaction(getDb(), async client => {
      const row = await lockRow(client, ctx, id, version);
      await removeRow(client, row.branch, actor, row, 'delete');
      return { deleted: true, id: Number(row.id) };
    });
  }

  async function history(ctx, branch, { limit, before } = {}) {
    assertBranch(branch);
    assertScope(ctx, branch);
    const size = Math.min(HISTORY_MAX, Math.max(1, Number.parseInt(limit, 10) || 200));
    const beforeId = Number.parseInt(before, 10);
    const { rows } = await getDb().query(
      `SELECT id, created_at, branch, position_id, code, location, action, field, old_value, new_value, summary, actor_name
       FROM stock_position_history WHERE branch = $1 AND ($2::bigint IS NULL OR id < $2) ORDER BY id DESC LIMIT $3`,
      [branch, Number.isInteger(beforeId) && beforeId > 0 ? beforeId : null, size]);
    return {
      rows: rows.map(r => ({
        id: Number(r.id), createdAt: isoOf(r.created_at), branch: r.branch, positionId: r.position_id === null ? null : Number(r.position_id),
        code: r.code, location: r.location, action: r.action, field: r.field, oldValue: r.old_value, newValue: r.new_value, summary: r.summary, actorName: r.actor_name
      })),
      nextBefore: rows.length === size ? Number(rows[rows.length - 1].id) : null
    };
  }

  // ---- Import file Excel/CSV (4 cot: Ma hang, Ghi chu, Ngay ve, Vi tri) ----

  // Thuan tuy: tu dong file + dong hien co + bang tra ma -> ke hoach them/doi/xoa/loi.
  function planImport(mode, fileRows, existing, resolved) {
    const errors = [];
    const adds = [];
    const updates = [];
    const unchangedIds = [];
    let skippedEmpty = 0;
    const byKey = new Map();
    for (const row of existing) if (!byKey.has(keyOf(row.code, row.location))) byKey.set(keyOf(row.code, row.location), row);
    const entries = new Map(); // (ma, vi tri) -> dong da gop (dong trung trong file tu cong ghi chu)
    const touched = new Set();
    for (const line of fileRows) {
      const code = clean(line.code);
      if (!code) { errors.push({ row: line.row, message: 'Thiếu mã hàng.' }); continue; }
      const location = clean(line.location);
      const notes = carton.normalizeNote(line.notes);
      if (notes.length > MAX.notes || code.length > MAX.code || location.length > MAX.location || clean(line.arrivalDate).length > MAX.arrivalDate) {
        errors.push({ row: line.row, message: 'Dữ liệu quá dài (mã ≤ 60, ghi chú ≤ 500, ngày về ≤ 60, vị trí ≤ 100 ký tự).' }); continue;
      }
      const spec = carton.parseSpec(notes);
      if (!spec) { errors.push({ row: line.row, message: `Ghi chú "${notes}" sai định dạng (cần dạng 3T x 100, nối nhiều quy cách bằng +).` }); continue; }
      if (spec.quantity === 0) { skippedEmpty += 1; continue; }
      const product = resolved.get(lower(code));
      const finalCode = product ? product.code : code;
      const key = keyOf(finalCode, location);
      const arrivalDate = clean(line.arrivalDate);
      const earlier = entries.get(key);
      if (earlier) {
        const sum = mergeNotes(earlier.notes, notes);
        if (sum === null) { errors.push({ row: line.row, message: `Ghi chú dòng ${earlier.row} sai định dạng, không cộng được dòng trùng này.` }); continue; }
        earlier.notes = sum;
        earlier.arrivalDate = arrivalDate || earlier.arrivalDate;
        continue;
      }
      entries.set(key, { row: line.row, code: finalCode, name: product ? product.name : '', notes, arrivalDate, location });
    }
    for (const entry of entries.values()) {
      const { row, notes, arrivalDate, location } = entry;
      const current = byKey.get(keyOf(entry.code, location));
      if (!current) { adds.push(entry); continue; }
      touched.add(current.id);
      let nextNotes = notes;
      let nextDate = arrivalDate;
      let nextLocation = location;
      if (mode === 'add') {
        nextNotes = mergeNotes(current.notes, notes);
        if (nextNotes === null) { errors.push({ row, message: `Ghi chú hiện có "${current.notes}" sai định dạng, không cộng thêm được.` }); continue; }
        nextDate = arrivalDate || current.arrival_date;
        nextLocation = current.location; // khop khong phan biet hoa/thuong: giu cach viet dang co
      }
      if (nextNotes === current.notes && nextDate === current.arrival_date && nextLocation === current.location) unchangedIds.push(current.id);
      else updates.push({ id: current.id, code: current.code, notes: nextNotes, arrivalDate: nextDate, location: nextLocation, row, before: current });
    }
    // Thay toan bo: dong hien co khong nam trong file bi xoa (ke ca dong trung ma + vi tri thua).
    const deletes = mode === 'replace' ? existing.filter(row => !touched.has(row.id)) : [];
    return { adds, updates, deletes, unchanged: unchangedIds.length, skippedEmpty, errors };
  }

  const countsOf = plan => ({ added: plan.adds.length, updated: plan.updates.length, deleted: plan.deletes.length, unchanged: plan.unchanged, skippedEmpty: plan.skippedEmpty, errors: plan.errors.length });

  async function importFile(ctx, branch, { mode, commit = false, buffer, fileName = '' } = {}) {
    assertBranch(branch);
    assertScope(ctx, branch);
    if (!MODES.includes(mode)) throw fail(400, 'VALIDATION', 'Chế độ import phải là replace hoặc add.', { field: 'mode' });
    if (!buffer || !buffer.length) throw fail(400, 'IMPORT_FILE_REQUIRED', 'Vui lòng chọn file Excel hoặc CSV.');
    const fileRows = parseImportWorkbook(buffer, { fileName, now: new Date(now()) });
    const actor = actorOf(ctx);
    const db = getDb();
    const run = async client => {
      const existing = (await client.query(`SELECT ${ROW_COLUMNS} FROM stock_positions WHERE branch = $1 ORDER BY id`, [branch])).rows;
      const resolved = await resolveCodes(client, branch, fileRows.map(line => line.code));
      return { plan: planImport(mode, fileRows, existing, resolved) };
    };
    const response = (plan, extra = {}) => ({ mode, commit: Boolean(commit), counts: countsOf(plan), errors: plan.errors.slice(0, ERROR_LIMIT), ...extra });
    if (!commit) return response((await run(db)).plan);

    return withTransaction(db, async client => {
      await lockBranch(client, branch);
      const { plan } = await run(client);
      if (plan.errors.length) throw fail(400, 'IMPORT_HAS_ERRORS', `File còn ${plan.errors.length} dòng lỗi, chưa nhập. Sửa file rồi thử lại.`, { body: response(plan) });
      const summaryAction = mode === 'replace' ? 'import_replace' : 'import_add';
      const entries = [{ action: summaryAction, summary: { file: fileName, ...countsOf(plan) } }];
      if (plan.adds.length) {
        const col = pick => plan.adds.map(pick);
        const { rows } = await client.query(
          `INSERT INTO stock_positions (branch, code, name, notes, arrival_date, location, updated_by_user_id, updated_by_name)
           SELECT $1, t.code, t.name, t.notes, t.arrival_date, t.location, $2, $3
           FROM unnest($4::text[], $5::text[], $6::text[], $7::text[], $8::text[]) AS t(code, name, notes, arrival_date, location)
           RETURNING id, code, location, notes`,
          [branch, actor.id, actor.name, col(a => a.code), col(a => a.name), col(a => a.notes), col(a => a.arrivalDate), col(a => a.location)]);
        for (const r of rows) entries.push({ positionId: r.id, code: r.code, location: r.location, action: 'create', newValue: r.notes });
      }
      if (plan.updates.length) {
        const col = pick => plan.updates.map(pick);
        await client.query(
          `UPDATE stock_positions p SET notes = u.notes, arrival_date = u.arrival_date, location = u.location, version = p.version + 1,
             updated_by_user_id = $2, updated_by_name = $3, updated_at = now()
           FROM unnest($1::bigint[], $4::text[], $5::text[], $6::text[]) AS u(id, notes, arrival_date, location) WHERE p.id = u.id`,
          [col(u => u.id), actor.id, actor.name, col(u => u.notes), col(u => u.arrivalDate), col(u => u.location)]);
        for (const u of plan.updates) {
          for (const change of fieldChanges(u.before, { notes: u.notes, arrivalDate: u.arrivalDate, location: u.location })) {
            entries.push({ positionId: u.id, code: u.code, location: u.location, action: 'edit', ...change });
          }
        }
      }
      if (plan.deletes.length) {
        await client.query('DELETE FROM stock_positions WHERE id = ANY($1::bigint[])', [plan.deletes.map(r => r.id)]);
        for (const r of plan.deletes) entries.push({ positionId: r.id, code: r.code, location: r.location, action: 'delete', field: 'notes', oldValue: r.notes });
      }
      await writeHistory(client, branch, actor, entries);
      productCache.delete(branch);
      return response(plan, { imported: true });
    });
  }

  return { list, create, update, deduct, remove, history, importFile };
}

module.exports = { createStockPositionsService, mergeNotes, keyOf, ...createStockPositionsService() };
