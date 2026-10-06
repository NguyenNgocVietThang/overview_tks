'use strict';
const { getPool } = require('../db/pool');
const { stripTelegramId } = require('../dashboard/saleName');
const {
  buildWhere,
  validateCheckpoint,
  raw,
  invalid,
} = require('./cashbookFilters');
const { anchorSql, balanceSql } = require('./cashbookBalance');
const queues = new WeakMap();
const fundsSql = `SELECT NULL::bigint account_id UNION SELECT id FROM cash_book_accounts UNION SELECT account_id FROM cash_flows UNION SELECT account_id FROM cash_book_checkpoints`;
const numeric = (v) => (v == null ? null : Number(v));
function fundRow(r) {
  return {
    fund: r.account_id == null ? 'cash' : String(r.account_id),
    accountId: r.account_id == null ? null : String(r.account_id),
    name:
      r.account_id == null
        ? 'Tiền mặt'
        : r.bank_name ||
          `Tài khoản #${r.account_id} (không có trong danh sách KiotViet)`,
    accountNo: r.account_no || '',
    bank: r.bank || '',
    description: r.description || '',
  };
}
function checkpointRow(r) {
  return {
    id: String(r.id),
    fund: r.account_id == null ? 'cash' : String(r.account_id),
    fundName: fundRow(r).name,
    checkpointAt: r.checkpoint_at,
    balance: numeric(r.balance),
    systemBalance: numeric(r.system_balance),
    diff: numeric(r.diff),
    note: r.note || '',
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}
function eligible(f) {
  return (
    (f.fund === 'cash' || (Array.isArray(f.fund) && f.fund.length === 1)) &&
    f.docTypes.length === 2 &&
    f.groups === null &&
    f.creators === null &&
    f.staff === null &&
    f.accounting === 'all' &&
    !f.partnerQ &&
    !f.partnerPhone &&
    !f.code &&
    !f.note
  );
}
function createRepository(pool = getPool(), { now = () => new Date() } = {}) {
  async function summary(f) {
    const fw = buildWhere(f, { alias: 'a', fundOnly: true });
    const params = [
      ...fw.params,
      f.at || now().toISOString(),
      new Date(+new Date(f.from) - 1).toISOString(),
      f.to,
    ];
    const at = `$${params.length - 2}::timestamptz`,
      opening = `$${params.length - 1}::timestamptz`,
      closing = `$${params.length}::timestamptz`;
    const balances = (
      await pool.query(
        `SELECT a.account_id,b.bank_name,b.account_no,b.description,k.bank,cp.checkpoint_at,
          ${balanceSql('a.account_id', at)} balance,
          ${balanceSql('a.account_id', opening, 'op')} opening_balance,
          ${balanceSql('a.account_id', closing, 'cl')} closing_balance
        FROM (${fundsSql}) a
        LEFT JOIN cash_book_accounts b ON b.id=a.account_id
        LEFT JOIN cash_book_account_banks k ON k.account_no=b.account_no
        LEFT JOIN LATERAL ${anchorSql('a.account_id', at)} cp ON TRUE
        LEFT JOIN LATERAL ${anchorSql('a.account_id', opening)} op ON TRUE
        LEFT JOIN LATERAL ${anchorSql('a.account_id', closing)} cl ON TRUE
        WHERE ${fw.sql} ORDER BY a.account_id NULLS FIRST`,
        params,
      )
    ).rows;
    // KPI thu/chi theo bộ lọc hiển thị, luôn loại phiếu hủy. Mốc sync không phụ thuộc bộ lọc.
    const w = buildWhere(f);
    const totals = (
      await pool.query(
        `SELECT COALESCE(SUM(CASE WHEN c.is_receipt THEN c.amount ELSE 0 END),0) receipts,
          COALESCE(-SUM(CASE WHEN NOT c.is_receipt THEN c.amount ELSE 0 END),0) payments,
          (SELECT MAX(last_synced_at) FROM sync_checkpoints WHERE entity='cash_flows') synced_at
        FROM cash_flows c WHERE ${w.sql} AND c.status IS DISTINCT FROM 1`,
        w.params,
      )
    ).rows[0];
    const unclosedCount = balances.filter((r) => r.balance == null).length;
    // Đầu kỳ/tồn quỹ là số dư thật của các quỹ đang chọn tại 2 mốc của kỳ;
    // thu/chi theo bộ lọc hiển thị nên không suy tồn quỹ từ đầu kỳ + thu − chi.
    const fundTotal = (key) =>
      balances.some((r) => r[key] == null)
        ? null
        : balances.reduce((s, r) => s + Number(r[key]), 0);
    const openingBalance = fundTotal('opening_balance');
    const receipts = Number(totals.receipts),
      payments = Number(totals.payments);
    return {
      balances: balances.map((r) => ({
        ...fundRow(r),
        balance: numeric(r.balance),
        checkpointAt: r.checkpoint_at || null,
      })),
      totalBalance: balances.reduce((s, r) => s + Number(r.balance || 0), 0),
      unclosedCount,
      kpis: {
        openingBalance,
        totalReceipts: receipts,
        totalPayments: payments,
        closingBalance: fundTotal('closing_balance'),
      },
      syncedAt: totals.synced_at || null,
    };
  }
  async function entries(f, { exportLimit = null } = {}) {
    const w = buildWhere(f);
    const params = [...w.params];
    let window = '',
      join = '',
      running = 'NULL::numeric';
    let available = false;
    if (eligible(f)) {
      const account = f.fund === 'cash' ? null : f.fund[0];
      const cp = (
        await pool.query(
          `SELECT * FROM ${anchorSql('$1::bigint', '$2::timestamptz')} cp`,
          [account, f.to],
        )
      ).rows[0];
      if (cp) {
        available = true;
        params.push(account);
        const acc = `$${params.length}::bigint`;
        // Mỗi phiếu neo vào lần chốt có hiệu lực tại chính thời điểm phiếu.
        // Lần chốt mới không được đổi số dư của phiếu ở kỳ trước.
        window = `timeline AS (
          SELECT branch,id,
            SUM(CASE WHEN status IS DISTINCT FROM 1 THEN COALESCE(amount,0) ELSE 0 END)
              OVER(ORDER BY trans_date,id,branch ROWS UNBOUNDED PRECEDING) cum
          FROM cash_flows WHERE account_id IS NOT DISTINCT FROM ${acc}
        ), checkpoint_anchors AS MATERIALIZED (
          SELECT cp.*, COALESCE((
            SELECT SUM(amount) FROM cash_flows a
            WHERE a.account_id IS NOT DISTINCT FROM ${acc}
              AND a.status IS DISTINCT FROM 1 AND a.trans_date<=cp.checkpoint_at
          ),0) cum
          FROM cash_book_checkpoints cp
          WHERE cp.account_id IS NOT DISTINCT FROM ${acc}
        ),`;
        join = `LEFT JOIN timeline t ON t.branch=c.branch AND t.id=c.id
          LEFT JOIN LATERAL (
            SELECT * FROM checkpoint_anchors cp
            ORDER BY (cp.checkpoint_at<=c.trans_date) DESC,
              CASE WHEN cp.checkpoint_at<=c.trans_date THEN cp.checkpoint_at END DESC,
              CASE WHEN cp.checkpoint_at>c.trans_date THEN cp.checkpoint_at END ASC,
              cp.id DESC LIMIT 1
          ) anchor ON TRUE`;
        running = `CASE WHEN c.trans_date=anchor.checkpoint_at THEN anchor.balance
          ELSE anchor.balance+t.cum-anchor.cum END`;
      }
    }
    const base = `WITH ${window} filtered AS (
      SELECT c.*,b.bank_name,b.account_no,creator.name creator_name,
        staff.name staff_name,${running} running_balance
      FROM cash_flows c LEFT JOIN cash_book_accounts b ON b.id=c.account_id
      LEFT JOIN staff creator ON creator.branch=c.branch
        AND creator.id::text=${raw('c', 'CreatedBy', 'createdBy')}
      LEFT JOIN staff staff ON staff.branch=c.branch AND staff.id=c.user_id
      ${join} WHERE ${w.sql}
    )`;
    const total = Number(
      (await pool.query(`${base} SELECT COUNT(*) total FROM filtered`, params))
        .rows[0].total,
    );
    params.push(
      exportLimit || f.pageSize,
      exportLimit ? 0 : (f.page - 1) * f.pageSize,
    );
    const result = (
      await pool.query(
        `${base} SELECT * FROM filtered ORDER BY trans_date DESC,id DESC,branch DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      )
    ).rows;
    return {
      entries: result.map((r) => ({
        id: String(r.id),
        branch: r.branch,
        code: r.code || '',
        transDate: r.trans_date,
        docType: r.is_receipt ? 'receipt' : 'payment',
        group: r.raw.CashGroup ?? r.raw.cashGroup ?? '',
        partnerName: r.raw.PartnerName ?? r.raw.partnerName ?? '',
        partnerPhone: r.raw.ContactNumber ?? r.raw.contactNumber ?? '',
        fund: r.account_id == null ? 'cash' : String(r.account_id),
        fundName: fundRow(r).name,
        creatorName:
          stripTelegramId(r.creator_name) ||
          String(r.raw.CreatedBy ?? r.raw.createdBy ?? ''),
        staffName:
          stripTelegramId(r.raw.User ?? r.raw.user) ||
          stripTelegramId(r.staff_name) ||
          String(r.user_id ?? ''),
        amount: numeric(r.amount),
        runningBalance: numeric(r.running_balance),
        status: r.status === 1 ? 'cancelled' : 'paid',
        note: r.description || '',
      })),
      total,
      page: f.page,
      pageSize: f.pageSize,
      totalPages: Math.ceil(total / f.pageSize),
      runningBalanceAvailable: available,
      runningBalanceReason: available
        ? null
        : eligible(f)
          ? 'Quỹ chưa được chốt số dư.'
          : 'Chọn một quỹ đã chốt, cả thu và chi, không thu hẹp các bộ lọc khác để xem số dư lũy kế.',
    };
  }
  async function filterOptions() {
    const funds = (
      await pool.query(
        `SELECT a.account_id,b.bank_name,b.account_no,b.description,k.bank FROM (${fundsSql}) a LEFT JOIN cash_book_accounts b ON b.id=a.account_id LEFT JOIN cash_book_account_banks k ON k.account_no=b.account_no ORDER BY a.account_id NULLS FIRST`,
      )
    ).rows.map(fundRow);
    const rows = (
      await pool.query(
        `SELECT DISTINCT ${raw('c', 'CashFlowGroupId', 'cashFlowGroupId')} group_id,
          ${raw('c', 'CashGroup', 'cashGroup')} group_name,
          ${raw('c', 'CreatedBy', 'createdBy')} creator_id,
          creator.name creator_name,c.user_id,
          COALESCE(NULLIF(btrim(${raw('c', 'User', 'user')}),''),s.name) staff_name
        FROM cash_flows c
        LEFT JOIN staff creator ON creator.branch=c.branch
          AND creator.id::text=${raw('c', 'CreatedBy', 'createdBy')}
        LEFT JOIN staff s ON s.branch=c.branch AND s.id=c.user_id`,
      )
    ).rows;
    const groups = new Map(),
      creators = new Map(),
      staff = new Map();
    for (const r of rows) {
      if (r.group_id || r.group_name) {
        const key = r.group_id || `name:${encodeURIComponent(r.group_name)}`;
        groups.set(key, { key, label: r.group_name || `Nhóm #${r.group_id}` });
      }
      if (r.creator_id) {
        const key = String(r.creator_id),
          label = stripTelegramId(r.creator_name) || `#${r.creator_id}`;
        if (!creators.has(key) || !label.startsWith('#'))
          creators.set(key, { id: key, label });
      }
      if (r.user_id != null) {
        const key = String(r.user_id),
          label = stripTelegramId(r.staff_name) || `#${r.user_id}`;
        if (!staff.has(key) || !label.startsWith('#'))
          staff.set(key, { id: key, label });
      }
    }
    const sorted = (m) =>
      [...m.values()].sort((a, b) => a.label.localeCompare(b.label, 'vi'));
    return {
      funds,
      groups: sorted(groups),
      creators: sorted(creators),
      staff: sorted(staff),
      supportedFilters: {
        debt: false,
        partnerType: false,
        partnerCode: false,
        partnerName: true,
        partnerId: true,
        partnerPhone: true,
      },
    };
  }
  async function checkpoints(f, { exportLimit = null } = {}) {
    const w = buildWhere(f, { fundOnly: true, alias: 'c' });
    const total = Number(
      (
        await pool.query(
          `SELECT COUNT(*) total FROM cash_book_checkpoints c WHERE ${w.sql}`,
          w.params,
        )
      ).rows[0].total,
    );
    const params = [
      ...w.params,
      exportLimit || f.pageSize,
      exportLimit ? 0 : (f.page - 1) * f.pageSize,
    ];
    const rows = (
      await pool.query(
        `SELECT c.*,b.bank_name FROM cash_book_checkpoints c LEFT JOIN cash_book_accounts b ON b.id=c.account_id WHERE ${w.sql} ORDER BY checkpoint_at DESC,c.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      )
    ).rows;
    return {
      checkpoints: rows.map(checkpointRow),
      total,
      page: f.page,
      pageSize: f.pageSize,
      totalPages: Math.ceil(total / f.pageSize),
    };
  }
  async function insertCheckpoint(body, createdBy) {
    const b = validateCheckpoint(body, now());
    if (typeof createdBy !== 'string' || !createdBy.trim())
      throw new Error('Thiếu danh tính người chốt.');
    // Khóa theo quỹ ở DB bảo vệ nhiều instance; queue theo pool giữ transaction đúng khi dùng pool cục bộ.
    let queue = queues.get(pool);
    if (!queue) {
      queue = new Map();
      queues.set(pool, queue);
    }
    const key = b.fund,
      previous = queue.get(key) || Promise.resolve();
    const pending = previous
      .catch(() => {})
      .then(async () => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
            [`cashbook:${key}`],
          );
          if (b.accountId !== null) {
            const exists = await client.query(
              `SELECT account_id FROM (${fundsSql}) a WHERE account_id=$1::bigint`,
              [b.accountId],
            );
            if (!exists.rows.length)
              throw invalid('Quỹ không có trong dữ liệu KiotViet.');
          }
          const cp = (
            await client.query(
              `SELECT * FROM ${anchorSql('$1::bigint', '$2::timestamptz')} cp`,
              [b.accountId, b.checkpointAt],
            )
          ).rows[0];
          let systemBalance = null;
          if (cp) {
            const r = await client.query(
              `SELECT (${balanceSql('$1::bigint', '$2::timestamptz')})::text balance FROM cash_book_checkpoints cp WHERE cp.id=$3`,
              [b.accountId, b.checkpointAt, cp.id],
            );
            systemBalance = r.rows[0].balance;
          }
          const r = await client.query(
            'INSERT INTO cash_book_checkpoints(account_id,checkpoint_at,balance,system_balance,diff,note,created_by) VALUES($1,$2,$3,$4,$3::numeric-$4::numeric,$5,$6) RETURNING *',
            [
              b.accountId,
              b.checkpointAt,
              b.balanceText,
              systemBalance,
              b.note,
              createdBy,
            ],
          );
          const account =
            b.accountId == null
              ? null
              : (
                  await client.query(
                    'SELECT bank_name FROM cash_book_accounts WHERE id=$1',
                    [b.accountId],
                  )
                ).rows[0];
          if (account) r.rows[0].bank_name = account.bank_name;
          await client.query('COMMIT');
          return checkpointRow(r.rows[0]);
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }
      });
    queue.set(key, pending);
    try {
      return await pending;
    } finally {
      if (queue.get(key) === pending) queue.delete(key);
    }
  }
  // Đặt/xóa tên ngân hàng theo số tài khoản của quỹ; mọi quỹ HN/SG cùng số TK dùng chung.
  async function setAccountBank(accountId, bank, updatedBy) {
    const id = String(accountId ?? '');
    if (!/^\d{1,18}$/.test(id)) throw invalid('Quỹ không hợp lệ.');
    if (bank != null && typeof bank !== 'string')
      throw invalid('Tên ngân hàng không hợp lệ.');
    const text = (bank || '').trim().replace(/\s+/g, ' ');
    if (text.length > 100)
      throw invalid('Tên ngân hàng tối đa 100 ký tự.');
    const account = (
      await pool.query('SELECT account_no FROM cash_book_accounts WHERE id=$1', [id])
    ).rows[0];
    if (!account || !(account.account_no || '').trim())
      throw invalid('Tài khoản chưa có số TK trong danh mục KiotViet nên chưa gắn được ngân hàng.');
    if (!text)
      await pool.query('DELETE FROM cash_book_account_banks WHERE account_no=$1', [account.account_no]);
    else
      await pool.query(
        `INSERT INTO cash_book_account_banks(account_no,bank,updated_by) VALUES($1,$2,$3)
         ON CONFLICT (account_no) DO UPDATE SET bank=EXCLUDED.bank,updated_by=EXCLUDED.updated_by,updated_at=now()`,
        [account.account_no, text, updatedBy],
      );
    return { accountNo: account.account_no, bank: text };
  }
  return { summary, entries, filterOptions, checkpoints, insertCheckpoint, setAccountBank };
}
module.exports = { createRepository, eligible };
