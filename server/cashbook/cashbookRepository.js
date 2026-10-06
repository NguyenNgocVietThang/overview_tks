'use strict';
const { getPool } = require('../db/pool');
const { stripTelegramId } = require('../dashboard/saleName');
const { buildWhere, raw } = require('./cashbookFilters');
// Mọi quỹ đã từng xuất hiện: tiền mặt, danh mục KiotViet và ID lịch sử chỉ còn trong phiếu.
const fundsSql = `SELECT NULL::bigint account_id UNION SELECT id FROM cash_book_accounts UNION SELECT DISTINCT account_id FROM cash_flows`;
const numeric = (v) => (v == null ? null : Number(v));
const BRANCH_KEYS = { hanoi: 'balanceHanoi', saigon: 'balanceSaigon' };
// HN và SG là 2 retailer KiotViet nên cùng một tài khoản ngân hàng có 2 ID.
// Gộp theo số TK; khóa quỹ là danh sách ID nên dùng thẳng làm bộ lọc `fund`.
function groupFunds(rows) {
  const groups = new Map();
  for (const r of rows) {
    const id = r.account_id == null ? null : String(r.account_id);
    const no = (r.account_no || '').trim();
    const key = id == null ? 'cash' : no ? `no:${no}` : `id:${id}`;
    if (!groups.has(key))
      groups.set(key, { ids: [], accountNo: no, names: [], descriptions: [] });
    const g = groups.get(key);
    if (id != null) g.ids.push(id);
    const name = (r.bank_name || '').trim();
    const same = (x) => x.toLocaleLowerCase('vi') === name.toLocaleLowerCase('vi');
    if (name && name !== no && !g.names.some(same)) g.names.push(name);
    const note = (r.description || '').trim();
    if (note && !g.descriptions.includes(note)) g.descriptions.push(note);
  }
  const funds = [...groups.values()].map((g) => {
    const ids = g.ids.sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
    return {
      fund: ids.length ? ids.join(',') : 'cash',
      accountIds: ids,
      name: !ids.length
        ? 'Tiền mặt'
        : g.names.join(' / ') ||
          g.accountNo ||
          `Tài khoản #${ids[0]} (không có trong danh sách KiotViet)`,
      accountNo: g.accountNo,
      description: g.descriptions.join(' · '),
    };
  });
  return funds.sort(
    (a, b) =>
      (a.fund === 'cash' ? -1 : 0) - (b.fund === 'cash' ? -1 : 0) ||
      a.name.localeCompare(b.name, 'vi') ||
      a.accountNo.localeCompare(b.accountNo, 'vi', { numeric: true }),
  );
}
function selectedFunds(funds, fund) {
  if (fund === 'all') return funds;
  if (fund === 'cash') return funds.filter((x) => x.fund === 'cash');
  if (fund === 'bank') return funds.filter((x) => x.fund !== 'cash');
  return funds.filter((x) => x.accountIds.some((id) => fund.includes(id)));
}
function createRepository(pool = getPool()) {
  async function funds() {
    const rows = (
      await pool.query(
        `SELECT a.account_id,b.bank_name,b.account_no,b.description FROM (${fundsSql}) a
        LEFT JOIN cash_book_accounts b ON b.id=a.account_id`,
      )
    ).rows;
    return groupFunds(rows);
  }
  async function summary(f) {
    // Tồn quỹ = Σ mọi phiếu chưa hủy (thu dương, chi âm) tới mốc, như Sổ quỹ KiotViet.
    // Bảng số dư luôn liệt kê mọi quỹ (người dùng tìm ở ô tìm kiếm); KPI Tồn quỹ theo quỹ đang chọn.
    // KPI thu/chi theo bộ lọc hiển thị, luôn loại phiếu hủy. Mốc sync không phụ thuộc bộ lọc.
    const w = buildWhere(f);
    const [catalog, sums, totals] = await Promise.all([
      funds(),
      pool.query(
        `SELECT c.account_id,c.branch,
          COALESCE(SUM(c.amount),0) closing_balance
        FROM cash_flows c WHERE c.status IS DISTINCT FROM 1 AND c.trans_date<=$1::timestamptz
        GROUP BY c.account_id,c.branch`,
        [f.to],
      ),
      pool.query(
        `SELECT COALESCE(SUM(CASE WHEN c.is_receipt THEN c.amount ELSE 0 END),0) receipts,
          COALESCE(-SUM(CASE WHEN NOT c.is_receipt THEN c.amount ELSE 0 END),0) payments,
          (SELECT MAX(last_synced_at) FROM sync_checkpoints WHERE entity='cash_flows') synced_at
        FROM cash_flows c WHERE ${w.sql} AND c.status IS DISTINCT FROM 1`,
        w.params,
      ),
    ]);
    const byAccount = new Map();
    for (const r of sums.rows) {
      const key = r.account_id == null ? 'cash' : String(r.account_id);
      if (!byAccount.has(key)) byAccount.set(key, []);
      byAccount.get(key).push(r);
    }
    const chosen = new Set(selectedFunds(catalog, f.fund));
    let closingBalance = 0;
    const balances = catalog.map((fund) => {
      const row = { ...fund, balanceHanoi: 0, balanceSaigon: 0, balance: 0 };
      for (const key of fund.accountIds.length ? fund.accountIds : ['cash'])
        for (const r of byAccount.get(key) || []) {
          const closing = Number(r.closing_balance);
          row.balance += closing;
          if (BRANCH_KEYS[r.branch]) row[BRANCH_KEYS[r.branch]] += closing;
          // Link cũ có thể chọn 1 ID của nhóm: KPI chỉ cộng ID nằm trong bộ lọc.
          if (chosen.has(fund) && (!Array.isArray(f.fund) || f.fund.includes(key)))
            closingBalance += closing;
        }
      return row;
    });
    const t = totals.rows[0];
    const totalBalance = balances.reduce((s, r) => s + r.balance, 0);
    return {
      balances,
      totalBalance,
      kpis: {
        totalReceipts: Number(t.receipts),
        totalPayments: Number(t.payments),
        closingBalance,
      },
      syncedAt: t.synced_at || null,
    };
  }
  async function entries(f, { exportLimit = null } = {}) {
    const w = buildWhere(f);
    const params = [...w.params];
    // Số dư lũy kế = tồn quỹ của các quỹ đang chọn ngay sau phiếu. Tính trên toàn
    // dòng thời gian của quỹ (trước khi lọc ngày/loại/trạng thái) nên luôn đúng.
    const tw = buildWhere(f, {
      alias: 't',
      fundOnly: true,
      start: params.length,
    });
    params.push(...tw.params, f.to);
    const timeline = `timeline AS (
      SELECT t.branch,t.id,
        SUM(CASE WHEN t.status IS DISTINCT FROM 1 THEN COALESCE(t.amount,0) ELSE 0 END)
          OVER(ORDER BY t.trans_date,t.id,t.branch ROWS UNBOUNDED PRECEDING) running_balance
      FROM cash_flows t WHERE ${tw.sql} AND t.trans_date<=$${params.length}::timestamptz
    )`;
    params.push(
      exportLimit || f.pageSize,
      exportLimit ? 0 : (f.page - 1) * f.pageSize,
    );
    const [catalog, count, result] = await Promise.all([
      funds(),
      pool.query(
        `SELECT COUNT(*) total FROM cash_flows c WHERE ${w.sql}`,
        w.params,
      ),
      pool.query(
        `WITH ${timeline}, page AS (
          SELECT c.* FROM cash_flows c WHERE ${w.sql}
          ORDER BY c.trans_date DESC,c.id DESC,c.branch DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}
        )
        SELECT c.*,creator.name creator_name,staff.name staff_name,t.running_balance
        FROM page c
        LEFT JOIN timeline t ON t.branch=c.branch AND t.id=c.id
        LEFT JOIN staff creator ON creator.branch=c.branch
          AND creator.id::text=${raw('c', 'CreatedBy', 'createdBy')}
        LEFT JOIN staff staff ON staff.branch=c.branch AND staff.id=c.user_id
        ORDER BY c.trans_date DESC,c.id DESC,c.branch DESC`,
        params,
      ),
    ]);
    const total = Number(count.rows[0].total);
    const fundById = new Map();
    for (const fund of catalog)
      for (const id of fund.accountIds.length ? fund.accountIds : ['cash'])
        fundById.set(id, fund);
    const fundLabel = (accountId) => {
      const fund = fundById.get(accountId == null ? 'cash' : String(accountId));
      if (!fund) return `Tài khoản #${accountId}`;
      return fund.accountNo ? `${fund.accountNo} · ${fund.name}` : fund.name;
    };
    return {
      entries: result.rows.map((r) => ({
        id: String(r.id),
        branch: r.branch,
        code: r.code || '',
        transDate: r.trans_date,
        docType: r.is_receipt ? 'receipt' : 'payment',
        group: r.raw.CashGroup ?? r.raw.cashGroup ?? '',
        partnerName: r.raw.PartnerName ?? r.raw.partnerName ?? '',
        partnerPhone: r.raw.ContactNumber ?? r.raw.contactNumber ?? '',
        fund: r.account_id == null ? 'cash' : String(r.account_id),
        fundName: fundLabel(r.account_id),
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
    };
  }
  async function filterOptions() {
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
      funds: await funds(),
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
  return { summary, entries, filterOptions };
}
module.exports = { createRepository, groupFunds };
