'use strict';

// Chi dinh vi tri hang cho don (trang Vong doi don hang) — migration 0096.
//   picking   = Dang nhat: giu cho tren dong vi tri (stock_positions), CHUA doi ghi chu thung.
//   confirmed = Xac nhan nhat: tru thung that (stock_position_history action 'pick').
//   cancelled = Huy nhat: tra giu cho; neu da xac nhan thi hoan tac (action 'pick_revert').
// Moi thao tac ghi chay trong 1 giao dich co khoa advisory theo co so (cung khoa voi stockPositionsService) + FOR UPDATE
// cac dong vi tri theo id, nen khong the chi dinh/tru vuot ton khi nhieu nguoi cung thao tac.
// Ton kha dung cua vi tri = SL (tinh tu ghi chu, carton.parseSpec) - tong giu cho (reserved_qty) cua cac chi dinh 'picking' o DON KHAC.
const { getPool } = require('../db/pool');
const carton = require('../public/shared/carton.js');
const rules = require('../public/shared/pick-rules.js');
const { tx } = require('../stockPositions/stockPositionsService');

const {
  withTransaction, lockBranch, writeHistory, removeRow, fail, assertBranch, assertScope, actorOf, lower, normalizeLocation,
  isEmptyNote, isoOf, ROW_COLUMNS
} = tx;

const STATUS = Object.freeze({ PICKING: 'picking', CONFIRMED: 'confirmed', CANCELLED: 'cancelled' });
const ELIGIBLE_STATUS = 'SENT_TO_ACCOUNTANT';
const MAX_ALLOCATIONS = 500;
const AVAILABILITY_ERROR = /vượt số lượng khả dụng/u;

const codeKey = value => String(value ?? '').trim().toLowerCase();
const num = value => (value === null || value === undefined ? null : Number(value));

/**
 * Dong don Kiot -> dong chi dinh: bo dong dich vu (VAT*), GOP theo ma hang (khong phan biet hoa/thuong).
 * Gia / chiet khau: cung gia thi giu nguyen, khac gia thi binh quan theo so luong.
 */
function mergeOrderLines(lines) {
  const merged = new Map();
  for (const line of Array.isArray(lines) ? lines : []) {
    const key = codeKey(line.productCode);
    if (!key || line.isService || key.startsWith('vat')) continue;
    const quantity = Number(line.quantity) || 0;
    if (quantity <= 0) continue;
    const price = Number(line.price) || 0;
    const discount = Number(line.discount) || 0;
    const hit = merged.get(key);
    if (!hit) {
      merged.set(key, { productCode: String(line.productCode).trim(), productName: String(line.productName || '').trim(), quantity, price, discount, _p: price * quantity, _d: discount * quantity, _same: true });
    } else {
      hit.quantity += quantity;
      hit._same = hit._same && hit.price === price && hit.discount === discount;
      hit._p += price * quantity;
      hit._d += discount * quantity;
      if (!hit.productName && line.productName) hit.productName = String(line.productName).trim();
    }
  }
  return [...merged.values()].map(({ _p, _d, _same, ...line }) => (_same ? line
    : { ...line, price: Math.round(_p / line.quantity * 100) / 100, discount: Math.round(_d / line.quantity * 100) / 100 }));
}

// Nguon don mac dinh: trang thai tu bang gop Vong doi don hang + dong hang tu don Kiot (khong tin du lieu tu trinh duyet).
async function defaultLoadOrder({ branch, orderCode }) {
  const kiot = require('../shipment/kiotOrdersRepository').kiotOrders;
  const lifecycle = require('../shipment/orderLifecycleService');
  const row = await lifecycle.findMergedOrder(branch, orderCode, { kiot });
  if (!row) return null;
  const detail = await kiot.readOrderDetail({ branch, code: row.orderCode });
  return {
    branch,
    orderCode: row.orderCode,
    customerName: row.customerName || detail.customerName || '',
    saleName: row.saleName || detail.seller || '',
    saleTelegramId: row.saleTelegramId || '',
    orderDate: row.orderDate || detail.date || '',
    status: { code: row.summary.code, label: row.summary.label },
    invoiceDiscount: Number(detail.discount) || 0,
    lines: detail.lines
  };
}

function createPickAssignmentsService({ getDb = getPool, loadOrder = defaultLoadOrder } = {}) {
  // ---------- Doc / dinh dang ----------

  async function readAssignment(db, id) {
    const head = (await db.query('SELECT * FROM order_pick_assignments WHERE id = $1', [id])).rows[0];
    if (!head) return null;
    const lines = (await db.query('SELECT * FROM order_pick_lines WHERE assignment_id = $1 ORDER BY id', [id])).rows;
    const history = (await db.query('SELECT created_at, action, actor_name, summary FROM order_pick_history WHERE assignment_id = $1 ORDER BY id', [id])).rows;
    const at = value => (value ? isoOf(value) : null);
    return {
      id: Number(head.id),
      branch: head.branch,
      orderCode: head.order_code,
      status: head.status,
      version: head.version,
      assignedByName: head.assigned_by_name,
      assignedAt: at(head.assigned_at),
      confirmedByName: head.confirmed_by_name || null,
      confirmedAt: at(head.confirmed_at),
      cancelledByName: head.cancelled_by_name || null,
      cancelledAt: at(head.cancelled_at),
      snapshot: head.order_snapshot || {},
      lines: lines.map(line => ({
        id: Number(line.id),
        productCode: line.product_code,
        positionId: Number(line.position_id),
        location: line.location,
        plannedQty: num(line.planned_qty),
        reservedQty: num(line.reserved_qty),
        stCartons: num(line.st_cartons),
        stText: line.st_text,
        pickedQty: num(line.picked_qty),
        specBefore: line.spec_before,
        specAfter: line.spec_after
      })),
      history: history.map(row => ({ at: isoOf(row.created_at), action: row.action, actorName: row.actor_name, summary: row.summary || null }))
    };
  }

  async function readLatestId(db, branch, orderCode) {
    const row = (await db.query(
      'SELECT id FROM order_pick_assignments WHERE branch = $1 AND lower(btrim(order_code)) = $2 ORDER BY id DESC LIMIT 1',
      [branch, codeKey(orderCode)])).rows[0];
    return row ? Number(row.id) : null;
  }

  async function readLatest(db, branch, orderCode) {
    const id = await readLatestId(db, branch, orderCode);
    return id === null ? null : readAssignment(db, id);
  }

  // Giu cho hien co theo vi tri: chi chi dinh 'picking' cua DON KHAC (exceptOrder bo qua chinh don dang xem/chi dinh).
  async function heldByPosition(db, branch, positionIds, exceptOrder) {
    const held = new Map();
    if (!positionIds.length) return held;
    const { rows } = await db.query(
      `SELECT l.position_id, COALESCE(SUM(l.reserved_qty), 0) AS held
         FROM order_pick_lines l JOIN order_pick_assignments a ON a.id = l.assignment_id
        WHERE a.status = 'picking' AND a.branch = $1 AND l.position_id = ANY($2::bigint[])
          AND lower(btrim(a.order_code)) <> $3
        GROUP BY l.position_id`,
      [branch, positionIds, codeKey(exceptOrder)]);
    for (const row of rows) held.set(Number(row.position_id), Number(row.held));
    return held;
  }

  function shapeCandidate(row, held) {
    const spec = carton.parseSpec(row.notes);
    const onHand = spec ? spec.quantity : null;
    return {
      positionId: Number(row.id),
      code: row.code,
      name: row.name,
      location: row.location,
      notes: row.notes,
      version: row.version,
      onHand,
      held,
      available: onHand === null ? null : Math.max(0, onHand - held),
      warnings: carton.warnings(row.notes)
    };
  }

  function orderView(order, lines) {
    return {
      branch: order.branch,
      orderCode: order.orderCode,
      customerName: order.customerName,
      saleName: order.saleName,
      saleTelegramId: order.saleTelegramId,
      orderDate: order.orderDate,
      status: order.status,
      eligible: order.status.code === ELIGIBLE_STATUS,
      lines
    };
  }

  async function requireOrder(branch, orderCode) {
    const order = await loadOrder({ branch, orderCode });
    if (!order) throw fail(404, 'NOT_FOUND', 'Không tìm thấy đơn hàng này.');
    return { order, lines: mergeOrderLines(order.lines) };
  }

  function cleanOrderCode(value) {
    const code = typeof value === 'string' ? value.trim() : '';
    if (!code || code.length > 100) throw fail(400, 'VALIDATION', 'Thiếu hoặc sai mã đơn hàng.', { field: 'orderCode' });
    return code;
  }

  // ---------- API ----------

  // Dong don (da gop theo ma) + cac vi tri ung vien kem ton kha dung, va chi dinh moi nhat cua don (neu co).
  async function candidates(ctx, { branch, orderCode } = {}) {
    assertBranch(branch);
    assertScope(ctx, branch);
    const code = cleanOrderCode(orderCode);
    const { order, lines } = await requireOrder(branch, code);
    const db = getDb();
    const keys = [...new Set(lines.map(line => codeKey(line.productCode)))];
    const rows = keys.length
      ? (await db.query(`SELECT ${ROW_COLUMNS} FROM stock_positions WHERE branch = $1 AND lower(btrim(code)) = ANY($2::text[]) ORDER BY id`, [branch, keys])).rows
      : [];
    const held = await heldByPosition(db, branch, rows.map(row => Number(row.id)), order.orderCode);
    const byCode = {};
    for (const key of keys) byCode[key] = [];
    for (const row of rows) byCode[codeKey(row.code)].push(shapeCandidate(row, held.get(Number(row.id)) || 0));
    return { order: orderView(order, lines), candidates: byCode, assignment: await readLatest(db, branch, order.orderCode) };
  }

  async function get(ctx, { branch, orderCode } = {}) {
    assertBranch(branch);
    assertScope(ctx, branch);
    return { assignment: await readLatest(getDb(), branch, cleanOrderCode(orderCode)) };
  }

  // Trang thai chi dinh MOI NHAT cua moi don: Map 'HN|ma don chu thuong' -> picking|confirmed|cancelled (cot pickStatus cua danh sach).
  // Fail-soft: chua ap migration 0096 hoac loi DB thi tra Map rong, danh sach Vong doi van chay binh thuong.
  async function latestStatuses() {
    const map = new Map();
    try {
      const { rows } = await getDb().query(
        `SELECT DISTINCT ON (branch, lower(btrim(order_code))) branch, lower(btrim(order_code)) AS code_key, status
           FROM order_pick_assignments ORDER BY branch, lower(btrim(order_code)), id DESC`);
      for (const row of rows) map.set(`${row.branch}|${row.code_key}`, row.status);
    } catch (error) {
      if (error && error.code !== '42P01') console.error('[PickAssignments] status lookup failed:', error.code || error.message);
    }
    return map;
  }

  function parseAllocations(body, lines) {
    const raw = Array.isArray(body.allocations) ? body.allocations : null;
    if (!raw || !raw.length) throw fail(400, 'VALIDATION', 'Chưa chỉ định vị trí nào.', { field: 'allocations' });
    if (raw.length > MAX_ALLOCATIONS) throw fail(400, 'VALIDATION', 'Quá nhiều dòng chỉ định.', { field: 'allocations' });
    const lineIndex = new Map(lines.map((line, index) => [codeKey(line.productCode), index]));
    const perLine = lines.map(() => new Map()); // dong don -> Map(positionId -> qty)
    for (const item of raw) {
      const index = lineIndex.get(codeKey(item && item.productCode));
      const positionId = Number(item && item.positionId);
      const qty = Number(item && item.qty);
      if (index === undefined) throw fail(400, 'VALIDATION', `Mã hàng ${item && item.productCode ? item.productCode : '(trống)'} không có trong đơn.`, { field: 'allocations' });
      if (!Number.isInteger(positionId) || positionId < 1) throw fail(400, 'VALIDATION', 'Mã dòng vị trí không hợp lệ.', { field: 'allocations' });
      if (!Number.isFinite(qty) || qty <= 0) throw fail(400, 'VALIDATION', 'Số lượng chỉ định phải lớn hơn 0.', { field: 'allocations' });
      perLine[index].set(positionId, (perLine[index].get(positionId) || 0) + qty);
    }
    return perLine;
  }

  async function assign(ctx, body = {}) {
    const branch = body.branch;
    assertBranch(branch);
    assertScope(ctx, branch);
    const orderCode = cleanOrderCode(body.orderCode);
    const { order, lines } = await requireOrder(branch, orderCode);
    if (order.status.code !== ELIGIBLE_STATUS) {
      throw fail(409, 'ORDER_NOT_ELIGIBLE', `Đơn đang ở trạng thái "${order.status.label}", chỉ đơn "Đã gửi kế toán" mới được chỉ định vị trí.`);
    }
    if (!lines.length) throw fail(400, 'VALIDATION', 'Đơn không có dòng hàng cần nhặt.');
    const perLine = parseAllocations(body, lines);
    const actor = actorOf(ctx);
    const snapshot = {
      customerName: order.customerName, saleName: order.saleName, saleTelegramId: order.saleTelegramId, orderDate: order.orderDate,
      lines, invoiceDiscount: order.invoiceDiscount
    };
    const db = getDb();
    let assignmentId;
    try {
      assignmentId = await withTransaction(db, async client => {
        await lockBranch(client, branch);
        const active = (await client.query(
          `SELECT id FROM order_pick_assignments WHERE branch = $1 AND lower(btrim(order_code)) = $2 AND status IN ('picking', 'confirmed') LIMIT 1`,
          [branch, codeKey(order.orderCode)])).rows[0];
        if (active) throw fail(409, 'ALREADY_ASSIGNED', 'Đơn này đã được chỉ định vị trí. Hãy hủy nhặt rồi chỉ định lại.');

        const ids = [...new Set(perLine.flatMap(map => [...map.keys()]))].sort((a, b) => a - b);
        const positions = (await client.query(
          `SELECT ${ROW_COLUMNS} FROM stock_positions WHERE branch = $1 AND id = ANY($2::bigint[]) ORDER BY id FOR UPDATE`, [branch, ids])).rows;
        if (positions.length !== ids.length) throw fail(400, 'VALIDATION', 'Có vị trí không tồn tại (có thể đã bị xóa). Hãy tải lại.', { field: 'allocations' });
        const held = await heldByPosition(client, branch, ids, order.orderCode);
        const byId = new Map(positions.map(row => [Number(row.id), row]));
        const locations = positions.map(row => {
          const spec = carton.parseSpec(row.notes);
          const onHand = spec ? spec.quantity : null;
          return { id: String(row.id), code: row.code, location: row.location, available: onHand === null ? null : Math.max(0, onHand - (held.get(Number(row.id)) || 0)), perCarton: spec && spec.perCarton ? spec.perCarton : 0 };
        });
        const allocations = perLine.map(map => [...map].map(([id, quantity]) => ({ id: String(id), quantity })));
        const errors = rules.validate(lines, locations, allocations);
        if (errors.length) {
          if (errors.every(message => AVAILABILITY_ERROR.test(message))) throw fail(409, 'INSUFFICIENT_AVAILABLE', errors.join('; '));
          throw fail(400, 'VALIDATION', errors.join('; '), { field: 'allocations' });
        }

        const head = (await client.query(
          `INSERT INTO order_pick_assignments (branch, order_code, status, order_snapshot, assigned_by_user_id, assigned_by_name)
           VALUES ($1, $2, 'picking', $3::jsonb, $4, $5) RETURNING id`,
          [branch, order.orderCode, JSON.stringify(snapshot), actor.id, actor.name])).rows[0];
        let total = 0;
        for (const [lineIndex, map] of perLine.entries()) {
          for (const [positionId, qty] of map) {
            const row = byId.get(positionId);
            const spec = carton.parseSpec(row.notes);
            total += qty;
            await client.query(
              `INSERT INTO order_pick_lines (assignment_id, product_code, position_id, location, planned_qty, reserved_qty, st_cartons, st_text)
               VALUES ($1, $2, $3, $4, $5, $5, $6, $7)`,
              [head.id, lines[lineIndex].productCode, positionId, row.location, qty, spec ? carton.cartonsFor(spec, qty) : null, spec ? carton.pickText(spec, qty) : null]);
          }
        }
        await client.query(
          `INSERT INTO order_pick_history (assignment_id, branch, order_code, action, summary, actor_user_id, actor_name)
           VALUES ($1, $2, $3, 'assign', $4::jsonb, $5, $6)`,
          [head.id, branch, order.orderCode, JSON.stringify({ lines: lines.length, positions: ids.length, quantity: total }), actor.id, actor.name]);
        return Number(head.id);
      });
    } catch (error) {
      if (error && error.code === '23505') throw fail(409, 'ALREADY_ASSIGNED', 'Đơn này đã được chỉ định vị trí. Hãy hủy nhặt rồi chỉ định lại.');
      throw error;
    }
    return { assignment: await readAssignment(db, assignmentId) };
  }

  // Khoa + doc 1 chi dinh de doi trang thai: kiem pham vi co so, version (409 kem ban moi nhat) va trang thai hien tai.
  async function lockAssignment(client, ctx, id, version, allowed) {
    if (!Number.isInteger(id) || id < 1) throw fail(400, 'VALIDATION', 'Mã chỉ định không hợp lệ.');
    const head = (await client.query('SELECT branch FROM order_pick_assignments WHERE id = $1', [id])).rows[0];
    if (!head) throw fail(404, 'NOT_FOUND', 'Không tìm thấy chỉ định vị trí.');
    assertScope(ctx, head.branch);
    await lockBranch(client, head.branch);
    const row = (await client.query('SELECT * FROM order_pick_assignments WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!row) throw fail(404, 'NOT_FOUND', 'Không tìm thấy chỉ định vị trí.');
    if (version === undefined || version === null || !Number.isInteger(Number(version))) throw fail(400, 'VALIDATION', 'Thiếu phiên bản (version) của chỉ định.', { field: 'version' });
    if (Number(version) !== row.version) {
      throw fail(409, 'VERSION_CONFLICT', 'Chỉ định đã bị người khác thay đổi. Dữ liệu mới nhất đã được tải lại.', { latest: await readAssignment(client, id) });
    }
    if (!allowed.includes(row.status)) {
      throw fail(409, 'INVALID_STATE', `Chỉ định đang ở trạng thái "${row.status}", không thực hiện được thao tác này.`, { latest: await readAssignment(client, id) });
    }
    return row;
  }

  async function lockPositions(client, branch, jobs) {
    const ids = jobs.map(job => Number(job.position_id)).sort((a, b) => a - b);
    const rows = ids.length
      ? (await client.query(`SELECT ${ROW_COLUMNS} FROM stock_positions WHERE branch = $1 AND id = ANY($2::bigint[]) ORDER BY id FOR UPDATE`, [branch, ids])).rows
      : [];
    return new Map(rows.map(row => [Number(row.id), row]));
  }

  const stockChanged = (job, why) => fail(409, 'STOCK_CHANGED', `Vị trí ${job.location || '(không tên)'} của mã ${job.product_code} ${why}. Hãy kiểm tra Vị trí hàng rồi hủy nhặt và chỉ định lại.`);

  async function confirm(ctx, id, body = {}) {
    const actor = actorOf(ctx);
    const db = getDb();
    await withTransaction(db, async client => {
      const head = await lockAssignment(client, ctx, id, body.version, [STATUS.PICKING]);
      const jobs = (await client.query('SELECT * FROM order_pick_lines WHERE assignment_id = $1 ORDER BY position_id', [id])).rows;
      const positions = await lockPositions(client, head.branch, jobs);
      const summary = { orderCode: head.order_code, assignmentId: Number(head.id) };
      for (const job of jobs) {
        const row = positions.get(Number(job.position_id));
        if (!row) throw stockChanged(job, 'không còn tồn tại');
        const spec = carton.parseSpec(row.notes);
        if (!spec || spec.empty) throw stockChanged(job, 'đã hết hàng hoặc ghi chú sai định dạng');
        const planned = Number(job.planned_qty);
        const result = carton.deduct(spec, planned);
        if (!result) throw stockChanged(job, `không còn đủ ${planned} để nhặt (hiện ${spec.quantity})`);
        const snapshot = { code: row.code, name: row.name, notes: row.notes, arrivalDate: row.arrival_date, location: row.location };
        if (isEmptyNote(result.text)) {
          await removeRow(client, head.branch, actor, row, 'auto_delete', { newValue: result.text, summary: { ...summary, picked: planned } });
        } else {
          await client.query(
            `UPDATE stock_positions SET notes = $2, version = version + 1, updated_by_user_id = $3, updated_by_name = $4, updated_at = now() WHERE id = $1`,
            [row.id, result.text, actor.id, actor.name]);
          await writeHistory(client, head.branch, actor, [{ positionId: row.id, code: row.code, location: row.location, action: 'pick', field: 'notes', oldValue: row.notes, newValue: result.text, summary: { ...summary, picked: planned } }]);
        }
        await client.query(
          `UPDATE order_pick_lines SET picked_qty = $2, spec_before = $3, spec_after = $4, position_snapshot = $5::jsonb WHERE id = $1`,
          [job.id, planned, row.notes, result.text, JSON.stringify(snapshot)]);
      }
      await client.query(
        `UPDATE order_pick_assignments SET status = 'confirmed', version = version + 1, confirmed_by_user_id = $2, confirmed_by_name = $3, confirmed_at = now(), updated_at = now() WHERE id = $1`,
        [id, actor.id, actor.name]);
      await client.query(
        `INSERT INTO order_pick_history (assignment_id, branch, order_code, action, summary, actor_user_id, actor_name) VALUES ($1, $2, $3, 'confirm', $4::jsonb, $5, $6)`,
        [id, head.branch, head.order_code, JSON.stringify({ positions: jobs.length }), actor.id, actor.name]);
    });
    return { assignment: await readAssignment(db, id) };
  }

  // Hoan tac 1 dong da tru: khoi phuc dung chuoi cu neu ghi chu chua bi doi tiep, khong thi cong tra so da nhat; dong da bi
  // tu xoa (het hang) duoc tao lai (hoac cong vao dong cung ma + vi tri vua duoc nhap lai).
  async function revertJob(client, head, actor, job, row) {
    const picked = Number(job.picked_qty);
    const summary = { orderCode: head.order_code, assignmentId: Number(head.id), restored: picked };
    const update = async (target, notes, extra) => {
      await client.query(
        `UPDATE stock_positions SET notes = $2, version = version + 1, updated_by_user_id = $3, updated_by_name = $4, updated_at = now() WHERE id = $1`,
        [target.id, notes, actor.id, actor.name]);
      await writeHistory(client, head.branch, actor, [{ positionId: target.id, code: target.code, location: target.location, action: 'pick_revert', field: 'notes', oldValue: target.notes, newValue: notes, summary: { ...summary, ...extra } }]);
    };
    if (row) {
      if (row.notes === job.spec_after) return update(row, job.spec_before, { exact: true });
      const spec = carton.parseSpec(row.notes);
      if (!spec) throw stockChanged(job, 'có ghi chú sai định dạng nên không cộng trả được số đã nhặt');
      return update(row, carton.restore(spec, picked).text, { exact: false });
    }
    const snapshot = job.position_snapshot || {};
    const same = (await client.query(
      `SELECT ${ROW_COLUMNS} FROM stock_positions WHERE branch = $1 AND lower(btrim(code)) = $2
         AND upper(regexp_replace(location, '\\s+', '', 'g')) = $3 ORDER BY id LIMIT 1 FOR UPDATE`,
      [head.branch, lower(snapshot.code || job.product_code), normalizeLocation(snapshot.location ?? job.location)])).rows[0];
    if (same) {
      const spec = carton.parseSpec(same.notes);
      if (!spec) throw stockChanged(job, 'đã được nhập lại với ghi chú sai định dạng nên không cộng trả được');
      return update(same, carton.restore(spec, picked).text, { exact: false, recreated: false });
    }
    // Chi co the khoi phuc nguyen chuoi cu khi chinh luot xac nhan nay da lam het hang (spec_after rong).
    const notes = isEmptyNote(job.spec_after) ? job.spec_before : carton.restore(carton.parseSpec('') || { terms: [], loose: 0 }, picked).text;
    const { rows } = await client.query(
      `INSERT INTO stock_positions (branch, code, name, notes, arrival_date, location, updated_by_user_id, updated_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [head.branch, snapshot.code || job.product_code, snapshot.name || '', notes, snapshot.arrivalDate || '', snapshot.location ?? job.location, actor.id, actor.name]);
    await writeHistory(client, head.branch, actor, [{ positionId: rows[0].id, code: snapshot.code || job.product_code, location: snapshot.location ?? job.location, action: 'pick_revert', field: 'notes', oldValue: null, newValue: notes, summary: { ...summary, recreated: true } }]);
  }

  async function cancel(ctx, id, body = {}) {
    const actor = actorOf(ctx);
    const db = getDb();
    await withTransaction(db, async client => {
      const head = await lockAssignment(client, ctx, id, body.version, [STATUS.PICKING, STATUS.CONFIRMED]);
      const wasConfirmed = head.status === STATUS.CONFIRMED;
      if (wasConfirmed) {
        const jobs = (await client.query('SELECT * FROM order_pick_lines WHERE assignment_id = $1 AND picked_qty IS NOT NULL ORDER BY position_id', [id])).rows;
        const positions = await lockPositions(client, head.branch, jobs);
        for (const job of jobs) await revertJob(client, head, actor, job, positions.get(Number(job.position_id)));
      }
      await client.query(
        `UPDATE order_pick_assignments SET status = 'cancelled', version = version + 1, cancelled_by_user_id = $2, cancelled_by_name = $3, cancelled_at = now(), updated_at = now() WHERE id = $1`,
        [id, actor.id, actor.name]);
      await client.query(
        `INSERT INTO order_pick_history (assignment_id, branch, order_code, action, summary, actor_user_id, actor_name) VALUES ($1, $2, $3, 'cancel', $4::jsonb, $5, $6)`,
        [id, head.branch, head.order_code, JSON.stringify({ reverted: wasConfirmed }), actor.id, actor.name]);
    });
    return { assignment: await readAssignment(db, id) };
  }

  return { candidates, get, assign, confirm, cancel, latestStatuses };
}

module.exports = { createPickAssignmentsService, mergeOrderLines, STATUS, ELIGIBLE_STATUS, ...createPickAssignmentsService() };
