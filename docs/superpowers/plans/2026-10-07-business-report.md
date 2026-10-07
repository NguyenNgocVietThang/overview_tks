# Báo cáo kinh doanh — kế hoạch triển khai

> **Dành cho agent thực thi:** BẮT BUỘC dùng `superpowers:subagent-driven-development` (khuyến nghị) hoặc `superpowers:executing-plans`, làm lần lượt từng task. Mỗi bước có checkbox (`- [ ]`) để đánh dấu tiến độ.

**Mục tiêu:** thêm tab cấp 2 "Báo cáo kinh doanh" (`/reports/#business`) gồm 3 mục: Tăng trưởng Sale, Tăng trưởng Khách hàng, Tăng trưởng Mã hàng. Các tháng trước được chốt cứng trong Postgres; tháng hiện tại tính trực tiếp.

**Kiến trúc:**
- Job nền chốt doanh số **từng tháng** vào 4 bảng:
  - khách × tháng;
  - khách × mã hàng × tháng (giảm giá cả đơn đã phân bổ);
  - mã hàng × tháng;
  - sale × tháng.
- Bảng sale × tháng được dựng lại theo nhóm khách **hiện tại**.
- Tháng chưa chốt (tháng hiện tại, hoặc tháng trước khi job chưa kịp chạy) tính trực tiếp bằng **cùng câu SQL**, cache 60 giây.
- Module `server/businessReport/` (theo khuôn `server/cashbook/`) gom số liệu, tính quy đổi 30 ngày, tăng trưởng, TB 4 tháng, KPI, dữ liệu panel, xuất Excel/HTML.
- Frontend là 1 view mới trong `server/public/index.html`, tái dùng `renderPaginatedRows`, `renderSectionKpis`, `DOC_DETAIL_KINDS` và Chart.js.

**Công nghệ:** Node 22 CommonJS, Express 4, `pg`, PGlite (`@electric-sql/pglite`, dùng trong test), ExcelJS, `dashboard/exportHtmlReport.js`, HTML/JS thuần, JSDOM (test frontend), `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-07-business-report-design.md`. Đọc trước khi làm.

## Ràng buộc chung (mọi task đều phải tuân theo)

- **Phạm vi:** luôn gộp HN + SG. KHÔNG dùng bộ chọn cơ sở / cookie `tks_branch`.
- **Tháng đầu tiên là 2026-03** (hằng `FIRST_MONTH = '2026-03-01'`). Bỏ T2 vì dữ liệu bắt đầu từ 05/02.
- **Doanh số khách theo tháng** = Σ `invoices.total` (hóa đơn có trạng thái 'Hoàn thành', theo tháng của `purchase_date`) − Σ `abs(returns.total)` (phiếu có `raw->>'statusValue' = 'Đã trả'`, theo tháng của `return_date`).
  - Trạng thái hóa đơn dùng `INVOICE_STATUS_SQL` (ưu tiên `statusValue`).
  - KHÔNG lọc theo cột số `status`.
- **Doanh số mã hàng** = thành tiền dòng (`DETAIL_AMOUNT_SQL` / `RETURN_AMOUNT_SQL`) × (tổng chứng từ / Σ thành tiền dòng của chứng từ). Phân bổ theo tỷ lệ để Σ theo mã = Σ theo khách.
- **Múi giờ:** `purchase_date`/`return_date` là giờ VN gắn nhãn UTC.
  - Khung tháng viết: `col >= ($2::date::timestamp AT TIME ZONE 'UTC') AND col < ($3::date::timestamp AT TIME ZONE 'UTC')`.
  - KHÔNG viết `(col AT TIME ZONE 'UTC')::date` trong WHERE, vì cách đó không dùng được index.
- **Định danh:**
  - Khách = `(branch, customer_code)`. Cùng mã ở HN và SG là 2 khách khác nhau. Hóa đơn không có mã thì khớp theo tên chuẩn hóa (`CUSTOMER_BY_NAME_CTE`); vẫn không khớp thì `customer_code = ''` (Khách lẻ).
  - Mã hàng = `product_code`, gộp 2 cơ sở.
  - Sale = `btrim(customers.raw->>'groups')`. Trống, không có khách hoặc Khách lẻ thì là `'Chưa phân nhóm'` (hằng `UNGROUPED_SALE`).
- **Đổi nhóm:** lịch sử đi theo nhóm HIỆN TẠI.
- **Quy đổi 30 ngày:** `cur × 30 / d`, với `d` = ngày trong tháng theo lịch VN, tính cả hôm nay. Ngày 06/10 thì d = 6.
- **Tăng trưởng** = `normalized / prev × 100`. Nếu `prev <= 0` thì là `null`, UI hiện "—".
- **TB 4 tháng** = `(m-1 + m-2 + m-3 + normalized) / 4`. Tháng không có dữ liệu tính là 0.
- **Khách hoạt động** ⇔ TB 4 tháng > 0. "SL Khách" của sale = số khách hoạt động của sale đó.
- **Level giá** = `customers.raw->>'comments'`.
- **Chốt tháng:** khi giờ VN ≥ 00:10 ngày 1, chốt tháng vừa qua. Lần đầu chạy thì backfill toàn bộ tháng chưa chốt từ 2026-03.
- **Quyền:**
  - `reports.business` (roles `REPORT_VIEW_ROLES`): xem.
  - `reports.business.refreeze` (`MANAGER_ONLY`, `requires: 'reports.business'`): nút "Tính lại tháng".
  - `reports.export`: xuất file.
- **Bài học IO Supabase:**
  - Không TRUNCATE bảng lớn định kỳ.
  - Không `ON CONFLICT DO UPDATE` vô điều kiện. Lọc dòng không đổi ngay ở SELECT, vì `ON CONFLICT … WHERE` vẫn khóa và ghi WAL.
  - Đặt `SET LOCAL work_mem = '32MB'` trong giao dịch chốt.
- **`.env` local trỏ DB production:**
  - Test chỉ dùng PGlite hoặc stub.
  - Kiểm chứng trên DB thật CHỈ được SELECT hoặc chạy trong giao dịch `ROLLBACK`.
  - KHÔNG chạy `npm run db:migrate`, KHÔNG chạy job ghi thật, KHÔNG deploy, KHÔNG push.
- **Quy ước code:**
  - Comment SQL/JS bằng tiếng Việt không dấu (theo file xung quanh); chuỗi UI bằng tiếng Việt có dấu.
  - Test đặt cạnh file (`foo.test.js`); test frontend ở `server/test/frontend/`.
  - Commit message tiếng Việt không dấu, dạng `feat(business-report): …`, kết thúc bằng dòng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Chạy test:**
  - Trong `server/`: `node --test <file>`.
  - Toàn bộ suite: `npm test` (khoảng 6 phút, chạy nền).
  - Trên Windows/Git Bash, `node --test` với thư mục cần glob, ví dụ `node --test "businessReport/*.test.js"`.

## Bản đồ file

| File | Trách nhiệm |
|---|---|
| `server/db/migrations/0036_business_monthly_sales.sql` (tạo mới) | 5 bảng + index |
| `server/db/SCHEMA.md` (sửa) | Mô tả 5 bảng |
| `server/kiotvietSync/salesSqlFragments.js` (tạo mới) | Mảnh SQL dùng chung: `INVOICE_STATUS_SQL`, `normalizedNameSql`, `CUSTOMER_BY_NAME_CTE`, re-export `DETAIL_AMOUNT_SQL`/`RETURN_AMOUNT_SQL` |
| `server/kiotvietSync/customerInvoiceLinesRefresh.js` (sửa) | Import các mảnh trên thay vì tự định nghĩa |
| `server/businessReport/businessMonths.js` (tạo mới) | Hàm thuần: khóa tháng, danh sách tháng, ngày VN, quy đổi, tăng trưởng, TB 4 tháng |
| `server/businessReport/businessMonthlySql.js` (tạo mới) | 2 câu SELECT theo khung tháng (khách; khách × mã) + SQL chốt + SQL dựng bảng sale |
| `server/kiotvietSync/businessMonthlyRefresh.js` (tạo mới) | `freezeMonth`, `rebuildSaleTable`, `refreshBusinessMonthlyIfDue`, `startBusinessMonthlySchedule`, `main` |
| `server/kiotvietSync/scheduler.js` (sửa) | Đăng ký job |
| `server/businessReport/businessReportRepository.js` (tạo mới) | Đọc tháng đã chốt + tính tháng chưa chốt + đọc khách/nhóm, cache 60 giây |
| `server/businessReport/businessReportService.js` (tạo mới) | Gom ra dòng Sale/Khách/Mã hàng, KPI, panel chi tiết (hàm thuần trên dữ liệu repository) |
| `server/businessReport/businessReportExport.js` (tạo mới) | Xuất Excel/HTML |
| `server/businessReport/businessReportRoutes.js` (tạo mới) | Router `/api/business-report` |
| `server/routes.js` (sửa) | Mount router |
| `server/auth/featureRegistry.js` (sửa) | 2 key quyền mới |
| `server/public/shared/shared-nav.js` (sửa) | Mục sidebar |
| `server/public/index.html` (sửa) | Nút sub-nav, `view-business`, JS render/tải/panel |
| `server/test/frontend/business-report.test.js` (tạo mới) | Test JSDOM |

---

### Task 1: Migration 0036 + SCHEMA.md

**Files:**
- Create: `server/db/migrations/0036_business_monthly_sales.sql`
- Modify: `server/db/SCHEMA.md` (thêm 1 mục mới theo định dạng các bảng báo cáo khác, ví dụ mục của `inventory_value_snapshots`)
- Test: `server/db/businessMonthlyMigration.test.js`

**Interfaces:**
- Produces: các bảng `business_monthly_customer_sales`, `business_monthly_customer_product_sales`, `business_monthly_product_sales`, `business_monthly_sale_sales`, `business_monthly_state` với đúng các cột dưới đây. Mọi task sau đều dùng các tên này.

- [ ] **Step 1: Viết test lỗi (PGlite chạy file migration)**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SQL = fs.readFileSync(path.join(__dirname, 'migrations', '0036_business_monthly_sales.sql'), 'utf8');

test('migration 0036 tao 5 bang bao cao kinh doanh voi khoa chinh dung', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  try {
    await db.exec(SQL);
    const { rows } = await db.query(`
      SELECT tc.table_name, string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS pk
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name LIKE 'business_monthly_%'
      GROUP BY tc.table_name ORDER BY tc.table_name`);
    assert.deepEqual(rows, [
      { table_name: 'business_monthly_customer_product_sales', pk: 'month,branch,customer_code,product_code' },
      { table_name: 'business_monthly_customer_sales', pk: 'month,branch,customer_code' },
      { table_name: 'business_monthly_product_sales', pk: 'month,product_code' },
      { table_name: 'business_monthly_sale_sales', pk: 'month,sale_name' },
      { table_name: 'business_monthly_state', pk: 'month' }
    ]);
    await assert.rejects(db.query(`INSERT INTO business_monthly_customer_sales (month, branch, customer_code) VALUES ('2026-03-02', 'hanoi', 'KH1')`), /check/i,
      'month phai la ngay 1');
  } finally { await db.close(); }
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Chạy: `cd server && node --test db/businessMonthlyMigration.test.js`
Kỳ vọng: FAIL với lỗi `ENOENT` (chưa có file migration).

- [ ] **Step 3: Viết migration**

```sql
-- Bao cao kinh doanh (tab Bao cao tong hop > Bao cao kinh doanh): doanh so THEO THANG
-- da CHOT CUNG cua tung khach / khach x ma hang / ma hang / sale. Spec:
-- docs/superpowers/specs/2026-10-07-business-report-design.md.
--
-- Job server/kiotvietSync/businessMonthlyRefresh.js chot thang vua qua luc >= 00:10 VN
-- ngay mung 1 (va backfill tu 2026-03 lan dau). Thang hien tai KHONG nam o day - API
-- tinh truc tiep bang cung cau SQL. month = ngay 1 cua thang (lich VN).
--
-- Doanh so = tong hoa don 'Hoàn thành' (invoices.total, da tru giam gia ca don) - tong
-- phieu tra 'Đã trả' (returns.total) theo thang cua ngay ban/ngay tra. Bang khach x ma
-- hang phan bo tong chung tu cho tung dong theo ty le thanh tien nen tong theo ma = tong
-- theo khach (lech vai dong do lam tron).
--
-- Khach = (branch, customer_code): cung ma o HN va SG la 2 khach KHAC nhau. customer_code
-- '' = Khach le / khong doi chieu duoc. Sale KHONG luu o bang khach: lich su di theo
-- nhom HIEN TAI (customers.raw->>'groups'), bang sale duoc dung lai khi nhom doi.

CREATE TABLE business_monthly_customer_sales (
  month          DATE NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
  branch         TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  customer_code  TEXT NOT NULL,
  customer_name  TEXT NOT NULL DEFAULT '',
  invoice_amount NUMERIC NOT NULL DEFAULT 0,
  return_amount  NUMERIC NOT NULL DEFAULT 0,
  net_revenue    NUMERIC NOT NULL DEFAULT 0,
  invoice_count  INTEGER NOT NULL DEFAULT 0,
  return_count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (month, branch, customer_code)
);

CREATE TABLE business_monthly_customer_product_sales (
  month         DATE NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
  branch        TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  customer_code TEXT NOT NULL,
  product_code  TEXT NOT NULL,
  product_name  TEXT NOT NULL DEFAULT '',
  net_revenue   NUMERIC NOT NULL DEFAULT 0,
  net_qty       NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (month, branch, customer_code, product_code)
);
-- Panel "top khach cua 1 ma hang".
CREATE INDEX business_monthly_cps_product_idx
  ON business_monthly_customer_product_sales (product_code, month);

CREATE TABLE business_monthly_product_sales (
  month        DATE NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
  product_code TEXT NOT NULL,
  product_name TEXT NOT NULL DEFAULT '',
  net_revenue  NUMERIC NOT NULL DEFAULT 0,
  net_qty      NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (month, product_code)
);

CREATE TABLE business_monthly_sale_sales (
  month          DATE NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
  sale_name      TEXT NOT NULL,
  net_revenue    NUMERIC NOT NULL DEFAULT 0,
  -- So khach co doanh so <> 0 trong thang (thong tin; "SL Khach" tren UI la so khach
  -- hoat dong = TB 4 thang > 0, tinh luc doc).
  customer_count INTEGER NOT NULL DEFAULT 0,
  refreshed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (month, sale_name)
);

-- 1 dong / thang da chot. Khong co dong = thang chua chot (API tinh truc tiep).
CREATE TABLE business_monthly_state (
  month               DATE PRIMARY KEY CHECK (EXTRACT(DAY FROM month) = 1),
  frozen_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  customer_rows       INTEGER NOT NULL DEFAULT 0,
  customer_product_rows INTEGER NOT NULL DEFAULT 0,
  net_revenue         NUMERIC NOT NULL DEFAULT 0
);

-- Khong can GRANT rieng: ALTER DEFAULT PRIVILEGES o 0010.
```

- [ ] **Step 4: Chạy test, xác nhận PASS**

Chạy: `cd server && node --test db/businessMonthlyMigration.test.js`
Kỳ vọng: PASS.

- [ ] **Step 5: Thêm mục vào `server/db/SCHEMA.md`**
  - Liệt kê 5 bảng, khóa, ý nghĩa cột (chép từ comment của migration).
  - Nêu: job ghi `kiotvietSync/businessMonthlyRefresh.js`, module đọc `businessReport/businessReportRepository.js`.
  - Nếu `db/migrate.integration.test.js` có danh sách migration/bảng mong đợi thì cập nhật luôn. Kiểm tra: `grep -n "0035" db/*.test.js`.

- [ ] **Step 6: Commit**

```bash
git add server/db/migrations/0036_business_monthly_sales.sql server/db/SCHEMA.md server/db/businessMonthlyMigration.test.js
git commit -m "feat(business-report): migration 0036 bang doanh so thang chot cung"
```

---

### Task 2: Mảnh SQL dùng chung + hàm thuần tính tháng/tăng trưởng

**Files:**
- Create: `server/kiotvietSync/salesSqlFragments.js`
- Modify: `server/kiotvietSync/customerInvoiceLinesRefresh.js` (xóa định nghĩa `normalizedNameSql`, `INVOICE_STATUS_SQL`, `CUSTOMER_BY_NAME_CTE`, thay bằng import; giữ nguyên `module.exports`/`__sql__` nếu có)
- Create: `server/businessReport/businessMonths.js`
- Test: `server/kiotvietSync/salesSqlFragments.test.js`, `server/businessReport/businessMonths.test.js`

**Interfaces:**
- Produces (`salesSqlFragments.js`):
  - `{ DETAIL_AMOUNT_SQL, RETURN_AMOUNT_SQL, INVOICE_STATUS_SQL, normalizedNameSql(expr: string): string, CUSTOMER_BY_NAME_CTE }`.
  - `CUSTOMER_BY_NAME_CTE` bắt đầu bằng `WITH customer_by_name AS (` và dùng `$1::text[]` là danh sách cơ sở.
- Produces (`businessMonths.js`):
  - `FIRST_MONTH = '2026-03-01'`, `UNGROUPED_SALE = 'Chưa phân nhóm'`
  - `monthKey(dateKey: 'YYYY-MM-DD'): 'YYYY-MM-01'`
  - `addMonths(monthKey, n): monthKey`
  - `monthsBetween(fromMonth, toMonth): monthKey[]` (gồm cả 2 đầu, tăng dần)
  - `monthLabel(monthKey): 'T3/26'`
  - `vnToday(now: Date): 'YYYY-MM-DD'` (dùng `vnDateKey` của `kiotvietSync/vnTime.js`)
  - `dayOfMonth(dateKey): number`
  - `normalizeTo30Days(amount, day): number`
  - `growthPct(normalized, prev): number|null`
  - `avg4Months(prev3: number[], normalized): number`
  - `buildMetrics(series: Record<monthKey, number>, currentMonth, day): { current, normalized, prev, growth, avg4 }`

- [ ] **Step 1: Viết test lỗi cho `businessMonths.js`**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('./businessMonths');

test('khoa thang, cong thang, danh sach thang, nhan cot', () => {
  assert.equal(m.monthKey('2026-10-06'), '2026-10-01');
  assert.equal(m.addMonths('2026-01-01', -1), '2025-12-01');
  assert.equal(m.addMonths('2026-10-01', 3), '2027-01-01');
  assert.deepEqual(m.monthsBetween('2026-03-01', '2026-05-01'), ['2026-03-01', '2026-04-01', '2026-05-01']);
  assert.deepEqual(m.monthsBetween('2026-05-01', '2026-03-01'), []);
  assert.equal(m.monthLabel('2026-03-01'), 'T3/26');
});

test('ngay VN tinh ca hom nay; 23:30 UTC ngay 5 la ngay 6 o VN', () => {
  assert.equal(m.vnToday(new Date('2026-10-05T23:30:00Z')), '2026-10-06');
  assert.equal(m.dayOfMonth('2026-10-06'), 6);
});

test('quy doi 30 ngay va tang truong theo vi du cua nguoi dung', () => {
  // 7 ngay dau thang 10 ban 100tr, thang 9 ban 500tr => 100*30/7/500 = 85,71%
  const normalized = m.normalizeTo30Days(100e6, 7);
  assert.ok(Math.abs(normalized - 428571428.5714) < 1);
  assert.ok(Math.abs(m.growthPct(normalized, 500e6) - 85.714) < 0.01);
  // Anh mau: Trinh 2.098.305.500 ngay 06/10, T9 7.891.382.769 => 133%
  assert.equal(Math.round(m.growthPct(m.normalizeTo30Days(2098305500, 6), 7891382769)), 133);
});

test('thang truoc <= 0 thi tang truong null (UI hien —)', () => {
  assert.equal(m.growthPct(1000, 0), null);
  assert.equal(m.growthPct(1000, -5), null);
});

test('TB 4 thang = (3 thang chot + quy doi thang nay) / 4, thang thieu = 0', () => {
  assert.equal(m.avg4Months([100, 200, 300], 400), 250);
  assert.equal(m.avg4Months([100], 300), 100);
});

test('buildMetrics lay dung thang truoc va 3 thang gan nhat', () => {
  const series = { '2026-07-01': 300, '2026-08-01': 600, '2026-09-01': 900, '2026-10-01': 100 };
  const r = m.buildMetrics(series, '2026-10-01', 10);
  assert.deepEqual(r, { current: 100, normalized: 300, prev: 900, growth: 300 / 900 * 100, avg4: (900 + 600 + 300 + 300) / 4 });
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Chạy: `cd server && node --test businessReport/businessMonths.test.js`
Kỳ vọng: FAIL với `Cannot find module './businessMonths'`.

- [ ] **Step 3: Cài đặt `businessMonths.js`**

```js
'use strict';

// Ham thuan cua Bao cao kinh doanh: khoa thang (ngay 1, lich VN), quy doi thang dang
// chay ve 30 ngay, tang truong, TB 4 thang. Spec: docs/superpowers/specs/2026-10-07-business-report-design.md.

const { vnDateKey } = require('../kiotvietSync/vnTime');

const FIRST_MONTH = '2026-03-01';
const UNGROUPED_SALE = 'Chưa phân nhóm';

function monthKey(dateKey) {
  return String(dateKey).slice(0, 7) + '-01';
}

function addMonths(month, n) {
  const [y, mo] = month.split('-').map(Number);
  const index = y * 12 + (mo - 1) + n;
  const year = Math.floor(index / 12);
  const mon = (index % 12) + 1;
  return `${year}-${String(mon).padStart(2, '0')}-01`;
}

function monthsBetween(fromMonth, toMonth) {
  const out = [];
  for (let m = fromMonth; m <= toMonth; m = addMonths(m, 1)) out.push(m);
  return out;
}

function monthLabel(month) {
  const [y, mo] = month.split('-');
  return `T${Number(mo)}/${y.slice(2)}`;
}

function vnToday(now = new Date()) {
  return vnDateKey(now);
}

function dayOfMonth(dateKey) {
  return Number(String(dateKey).slice(8, 10));
}

// Thang dang chay: doanh so x 30 / so ngay da qua (gom ca hom nay).
function normalizeTo30Days(amount, day) {
  return (Number(amount) || 0) * 30 / Math.max(1, day);
}

function growthPct(normalized, prev) {
  const p = Number(prev) || 0;
  if (p <= 0) return null;
  return (Number(normalized) || 0) / p * 100;
}

function avg4Months(prev3, normalized) {
  const values = [0, 1, 2].map(i => Number(prev3[i]) || 0);
  return (values[0] + values[1] + values[2] + (Number(normalized) || 0)) / 4;
}

function buildMetrics(series, currentMonth, day) {
  const current = Number(series[currentMonth]) || 0;
  const normalized = normalizeTo30Days(current, day);
  const prev3 = [1, 2, 3].map(i => Number(series[addMonths(currentMonth, -i)]) || 0);
  return { current, normalized, prev: prev3[0], growth: growthPct(normalized, prev3[0]), avg4: avg4Months(prev3, normalized) };
}

module.exports = {
  FIRST_MONTH, UNGROUPED_SALE, monthKey, addMonths, monthsBetween, monthLabel,
  vnToday, dayOfMonth, normalizeTo30Days, growthPct, avg4Months, buildMetrics
};
```

- [ ] **Step 4: Chạy test, xác nhận PASS**

Chạy: `cd server && node --test businessReport/businessMonths.test.js`
Kỳ vọng: PASS (6 test).

- [ ] **Step 5: Viết test lỗi cho `salesSqlFragments.js`**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./salesSqlFragments');
const top = require('../dashboard/customerProductTopRepository');

test('manh SQL dung chung: thanh tien dong giu nguyen nguon cu, trang thai uu tien statusValue', () => {
  assert.equal(f.DETAIL_AMOUNT_SQL, top.DETAIL_AMOUNT_SQL);
  assert.equal(f.RETURN_AMOUNT_SQL, top.RETURN_AMOUNT_SQL);
  assert.match(f.INVOICE_STATUS_SQL, /i\.raw->>'statusValue'/);
  assert.match(f.CUSTOMER_BY_NAME_CTE, /^\s*WITH customer_by_name AS \(/);
  assert.match(f.CUSTOMER_BY_NAME_CTE, /branch = ANY\(\$1::text\[\]\)/);
  assert.match(f.normalizedNameSql('x'), /normalize\(x, NFKC\)/);
});

test('customerInvoiceLinesRefresh dung lai manh SQL chung (khong dinh nghia rieng)', () => {
  const src = require('node:fs').readFileSync(require.resolve('./customerInvoiceLinesRefresh'), 'utf8');
  assert.match(src, /require\('\.\/salesSqlFragments'\)/);
  assert.doesNotMatch(src, /const CUSTOMER_BY_NAME_CTE =/);
});
```

Lưu ý: kiểm tra `customerProductTopRepository.js` đã export `DETAIL_AMOUNT_SQL`/`RETURN_AMOUNT_SQL` chưa (`grep -n "module.exports" -A5 dashboard/customerProductTopRepository.js`). `customerInvoiceLinesRefresh.js` đang import chúng nên chắc chắn đã export.

- [ ] **Step 6: Chạy test, xác nhận FAIL** (`node --test kiotvietSync/salesSqlFragments.test.js`, báo không tìm thấy module)

- [ ] **Step 7: Tạo `salesSqlFragments.js`**
  - CHUYỂN NGUYÊN VĂN `normalizedNameSql`, `INVOICE_STATUS_SQL`, `CUSTOMER_BY_NAME_CTE` cùng comment của chúng từ `customerInvoiceLinesRefresh.js` sang file mới.
  - Thêm `const { DETAIL_AMOUNT_SQL, RETURN_AMOUNT_SQL } = require('../dashboard/customerProductTopRepository');`.
  - `module.exports = { DETAIL_AMOUNT_SQL, RETURN_AMOUNT_SQL, INVOICE_STATUS_SQL, normalizedNameSql, CUSTOMER_BY_NAME_CTE };`
  - Trong `customerInvoiceLinesRefresh.js`, xóa 3 định nghĩa đó và thay bằng:
    ```js
    const { DETAIL_AMOUNT_SQL, RETURN_AMOUNT_SQL, INVOICE_STATUS_SQL, normalizedNameSql, CUSTOMER_BY_NAME_CTE } = require('./salesSqlFragments');
    ```
    Xóa dòng require cũ tới `customerProductTopRepository`.

- [ ] **Step 8: Chạy test, xác nhận PASS, và không hỏng test cũ**

Chạy: `cd server && node --test kiotvietSync/salesSqlFragments.test.js kiotvietSync/customerInvoiceLinesRefresh.test.js dashboard/customerProductTopRepository.test.js`
Kỳ vọng: tất cả PASS.

- [ ] **Step 9: Commit**

```bash
git add server/kiotvietSync/salesSqlFragments.js server/kiotvietSync/salesSqlFragments.test.js server/kiotvietSync/customerInvoiceLinesRefresh.js server/businessReport/businessMonths.js server/businessReport/businessMonths.test.js
git commit -m "feat(business-report): manh SQL dung chung va ham tinh thang/tang truong"
```

---

### Task 3: SQL theo tháng + job chốt tháng + scheduler

**Files:**
- Create: `server/businessReport/businessMonthlySql.js`
- Create: `server/kiotvietSync/businessMonthlyRefresh.js`
- Modify: `server/kiotvietSync/scheduler.js`
- Test: `server/businessReport/businessMonthlySql.test.js` (PGlite), `server/kiotvietSync/businessMonthlyRefresh.test.js`, và cập nhật test scheduler hiện có (`grep -ln "startInventoryValueSnapshotSchedule" kiotvietSync/*.test.js`)

**Interfaces:**
- Consumes: `salesSqlFragments.js`, `businessMonths.js` (Task 2); các bảng của Task 1.
- Produces (`businessMonthlySql.js`), mọi câu nhận `$1 text[]` cơ sở, `$2 date` đầu khung, `$3 date` cuối khung (KHÔNG gồm):
  - `CUSTOMER_MONTH_SELECT_SQL`: trả `branch, customer_code, customer_name, invoice_amount, return_amount, net_revenue, invoice_count, return_count`.
  - `CUSTOMER_PRODUCT_MONTH_SELECT_SQL`: trả `branch, customer_code, product_code, product_name, net_revenue, net_qty`.
  - `FREEZE_CUSTOMER_SQL`, `FREEZE_CUSTOMER_PRODUCT_SQL`: INSERT…SELECT với `month = $2`.
  - `FREEZE_PRODUCT_SQL`: `$1` = month.
  - `REBUILD_SALE_SQL`: không tham số.
  - `BRANCH_CODES = ['hanoi', 'saigon']`.
- Produces (`businessMonthlyRefresh.js`):
  - `freezeMonth(pool, month, { log }) → { month, customerRows, customerProductRows, netRevenue }`
  - `rebuildSaleTable(pool) → { upserted, deleted }`
  - `refreshBusinessMonthlyIfDue(pool, { log, now }) → { frozen: monthKey[], sale: {upserted, deleted} }`
  - `startBusinessMonthlySchedule(pool, { intervalMs, setIntervalFn, scheduleImmediate, log })`

- [ ] **Step 1: Viết test PGlite lỗi cho SQL**

Tạo `server/businessReport/businessMonthlySql.test.js`. Schema tối thiểu chỉ gồm các cột câu SQL dùng (theo `db/migrations/0001…`/`0002`/`0004`), cộng với file migration 0036:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sql = require('./businessMonthlySql');

const MIGRATION = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '0036_business_monthly_sales.sql'), 'utf8');
const BASE = `
  CREATE TABLE customers(branch text, id bigint, code text, name text, raw jsonb);
  CREATE TABLE products(branch text, id bigint, code text, name text);
  CREATE TABLE invoices(branch text, id bigint, code text, purchase_date timestamptz, total numeric, status int, raw jsonb);
  CREATE TABLE invoice_details(branch text, invoice_id bigint, line_no int, product_id bigint, quantity numeric, price numeric, discount numeric, raw jsonb);
  CREATE TABLE returns(branch text, id bigint, code text, return_date timestamptz, total numeric, status int, raw jsonb);
  CREATE TABLE return_details(branch text, return_id bigint, line_no int, product_id bigint, quantity numeric, price numeric, raw jsonb);`;

async function seed(db) {
  await db.exec(BASE + MIGRATION);
  await db.exec(`
    INSERT INTO customers VALUES
      ('hanoi', 1, 'KH1', 'Chị A', '{"groups":"Khang","comments":"Level 2"}'),
      ('saigon', 2, 'KH1', 'Anh B', '{"groups":"Trinh"}'),
      ('hanoi', 3, 'KH2', 'Cô C', '{}');
    INSERT INTO products VALUES ('hanoi', 10, 'SP1', 'Khay'), ('hanoi', 11, 'SP2', 'Bình');
    -- HD1 (HN, KH1, 30/09 23:00 gio VN): 2 dong 600+400 = 1000, giam ca don 100 => total 900
    INSERT INTO invoices VALUES ('hanoi', 101, 'HD1', '2026-09-30 23:00:00+00', 900, 1, '{"statusValue":"Hoàn thành","customerCode":"KH1","customerName":"Chị A"}');
    INSERT INTO invoice_details VALUES
      ('hanoi', 101, 1, 10, 2, 300, 0, '{"productCode":"SP1","subTotal":600}'),
      ('hanoi', 101, 2, 11, 1, 400, 0, '{"productCode":"SP2","subTotal":400}');
    -- HD2 (01/10 00:30 gio VN) thuoc thang 10, khong duoc tinh vao thang 9
    INSERT INTO invoices VALUES ('hanoi', 102, 'HD2', '2026-10-01 00:30:00+00', 500, 1, '{"statusValue":"Hoàn thành","customerCode":"KH1"}');
    INSERT INTO invoice_details VALUES ('hanoi', 102, 1, 10, 1, 500, 0, '{"productCode":"SP1","subTotal":500}');
    -- HD3 da huy: bo qua; HD4 khong ma KH, khop theo ten "Cô C" => KH2
    INSERT INTO invoices VALUES ('hanoi', 103, 'HD3', '2026-09-10 10:00:00+00', 777, 2, '{"statusValue":"Đã hủy","customerCode":"KH1"}');
    INSERT INTO invoices VALUES ('hanoi', 104, 'HD4', '2026-09-11 10:00:00+00', 200, 1, '{"statusValue":"Hoàn thành","customerName":"Cô C"}');
    INSERT INTO invoice_details VALUES ('hanoi', 104, 1, 11, 1, 200, 0, '{"productCode":"SP2","subTotal":200}');
    -- Tra hang TH1 thang 9 cua KH1 HN: dong 100, giam gia tra 10 => total 90
    INSERT INTO returns VALUES ('hanoi', 201, 'TH1', '2026-09-15 09:00:00+00', 90, 1, '{"statusValue":"Đã trả","customerCode":"KH1"}');
    INSERT INTO return_details VALUES ('hanoi', 201, 1, 10, 1, 100, '{"productCode":"SP1","subTotal":100}');`);
}

test('doanh so khach thang 9: tong hoa don Hoan thanh - tong tra Da tra, khop ten khi thieu ma', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  try {
    await seed(db);
    const { rows } = await db.query(sql.CUSTOMER_MONTH_SELECT_SQL + ' ORDER BY branch, customer_code',
      [sql.BRANCH_CODES, '2026-09-01', '2026-10-01']);
    assert.deepEqual(rows.map(r => [r.branch, r.customer_code, Number(r.net_revenue), Number(r.invoice_amount), Number(r.return_amount)]), [
      ['hanoi', 'KH1', 810, 900, 90],
      ['hanoi', 'KH2', 200, 200, 0]
    ]);
  } finally { await db.close(); }
});

test('khach x ma hang phan bo giam gia ca don, tong theo ma = tong theo khach', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  try {
    await seed(db);
    const { rows } = await db.query(sql.CUSTOMER_PRODUCT_MONTH_SELECT_SQL + ' ORDER BY customer_code, product_code',
      [sql.BRANCH_CODES, '2026-09-01', '2026-10-01']);
    // HD1: SP1 600*900/1000=540, SP2 360; TH1: SP1 -90; HD4: SP2 200
    assert.deepEqual(rows.map(r => [r.customer_code, r.product_code, Number(r.net_revenue), Number(r.net_qty)]), [
      ['KH1', 'SP1', 450, 1],
      ['KH1', 'SP2', 360, 1],
      ['KH2', 'SP2', 200, 1]
    ]);
  } finally { await db.close(); }
});

test('chot thang roi dung bang ma hang + bang sale theo nhom hien tai; doi nhom thi dung lai', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  try {
    await seed(db);
    const p = [sql.BRANCH_CODES, '2026-09-01', '2026-10-01'];
    await db.query(sql.FREEZE_CUSTOMER_SQL, p);
    await db.query(sql.FREEZE_CUSTOMER_PRODUCT_SQL, p);
    await db.query(sql.FREEZE_PRODUCT_SQL, ['2026-09-01']);
    await db.query(sql.REBUILD_SALE_SQL);
    const products = await db.query('SELECT product_code, net_revenue::float8 v FROM business_monthly_product_sales ORDER BY 1');
    assert.deepEqual(products.rows, [{ product_code: 'SP1', v: 450 }, { product_code: 'SP2', v: 560 }]);
    let sales = await db.query('SELECT sale_name, net_revenue::float8 v FROM business_monthly_sale_sales ORDER BY 1');
    assert.deepEqual(sales.rows, [{ sale_name: 'Chưa phân nhóm', v: 200 }, { sale_name: 'Khang', v: 810 }]);
    // Lan dung lai khong doi gi => 0 dong ghi
    const again = await db.query(sql.REBUILD_SALE_SQL);
    assert.deepEqual(again.rows[0], { upserted: 0, deleted: 0 });
    // KH1 HN chuyen sang nhom Trinh => toan bo lich su di theo
    await db.exec(`UPDATE customers SET raw = '{"groups":"Trinh"}' WHERE branch='hanoi' AND code='KH1'`);
    await db.query(sql.REBUILD_SALE_SQL);
    sales = await db.query('SELECT sale_name, net_revenue::float8 v FROM business_monthly_sale_sales ORDER BY 1');
    assert.deepEqual(sales.rows, [{ sale_name: 'Chưa phân nhóm', v: 200 }, { sale_name: 'Trinh', v: 810 }]);
  } finally { await db.close(); }
});
```

Lưu ý khi chạy với PGlite:
- Nếu PGlite không hỗ trợ `normalize(... , NFKC)` thì xem cách `customerInvoiceLinesRefresh.test.js` xử lý (grep `NFKC`) và làm theo y hệt.
- `REBUILD_SALE_SQL` phải trả 1 dòng `{ upserted: int, deleted: int }`, ép kiểu `::int` trong SQL.

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Chạy: `cd server && node --test businessReport/businessMonthlySql.test.js`
Kỳ vọng: FAIL do chưa có module.

- [ ] **Step 3: Cài đặt `businessMonthlySql.js`**

```js
'use strict';

// SQL cua Bao cao kinh doanh. Cung 1 cau SELECT dung cho (a) job chot thang
// (kiotvietSync/businessMonthlyRefresh.js, INSERT...SELECT) va (b) API tinh truc tiep
// thang chua chot (businessReportRepository.js) => so chot va so live khong lech cong thuc.
// $1 text[] co so, $2 date dau khung, $3 date cuoi khung (KHONG gom). Khung viet tren
// cot goc de dung duoc index (bai hoc su co IO 2026-09-28).

const {
  DETAIL_AMOUNT_SQL, RETURN_AMOUNT_SQL, INVOICE_STATUS_SQL, normalizedNameSql, CUSTOMER_BY_NAME_CTE
} = require('../kiotvietSync/salesSqlFragments');

const BRANCH_CODES = Object.freeze(['hanoi', 'saigon']);

const range = column => `${column} >= ($2::date::timestamp AT TIME ZONE 'UTC')
    AND ${column} < ($3::date::timestamp AT TIME ZONE 'UTC')`;
const customerCode = alias => `COALESCE(NULLIF(btrim(${alias}.raw->>'customerCode'), ''), cbn.code, '')`;
const nameJoin = alias => `LEFT JOIN customer_by_name cbn
    ON cbn.branch = ${alias}.branch
   AND cbn.name_key = ${normalizedNameSql(`COALESCE(NULLIF(${alias}.raw->>'customerName', ''), 'Khách lẻ')`)}`;

const CUSTOMER_MONTH_SELECT_SQL = `${CUSTOMER_BY_NAME_CTE},
  docs AS (
    SELECT i.branch, ${customerCode('i')} AS customer_code,
           COALESCE(NULLIF(i.raw->>'customerName', ''), 'Khách lẻ') AS customer_name, i.purchase_date AS at,
           COALESCE(i.total, 0)::numeric AS invoice_amount, 0::numeric AS return_amount, 1 AS invoice_count, 0 AS return_count
    FROM invoices i ${nameJoin('i')}
    WHERE i.branch = ANY($1::text[]) AND ${range('i.purchase_date')}
      AND ${INVOICE_STATUS_SQL} = 'Hoàn thành' AND btrim(i.code) <> ''
    UNION ALL
    SELECT r.branch, ${customerCode('r')},
           COALESCE(NULLIF(r.raw->>'customerName', ''), 'Khách lẻ'), r.return_date,
           0::numeric, abs(COALESCE(r.total, 0))::numeric, 0, 1
    FROM returns r ${nameJoin('r')}
    WHERE r.branch = ANY($1::text[]) AND ${range('r.return_date')}
      AND r.raw->>'statusValue' = 'Đã trả' AND btrim(r.code) <> ''
  )
  SELECT branch, customer_code,
         (array_agg(customer_name ORDER BY at DESC))[1] AS customer_name,
         SUM(invoice_amount) AS invoice_amount, SUM(return_amount) AS return_amount,
         SUM(invoice_amount) - SUM(return_amount) AS net_revenue,
         SUM(invoice_count)::int AS invoice_count, SUM(return_count)::int AS return_count
  FROM docs
  GROUP BY branch, customer_code`;

// Phan bo tong chung tu (da tru giam gia ca don / giam gia tra) cho tung dong theo ty le
// thanh tien dong => tong theo ma hang = tong theo khach. Chung tu co tong thanh tien
// dong = 0 thi khong phan bo (dong = 0).
const CUSTOMER_PRODUCT_MONTH_SELECT_SQL = `${CUSTOMER_BY_NAME_CTE},
  lines AS (
    SELECT i.branch, ${customerCode('i')} AS customer_code,
           COALESCE(NULLIF(d.raw->>'productCode', ''), p.code, '') AS product_code,
           COALESCE(NULLIF(d.raw->>'productName', ''), p.name, '') AS product_name,
           COALESCE(d.quantity, 0)::numeric AS qty,
           (${DETAIL_AMOUNT_SQL})::numeric AS line_amount,
           COALESCE(i.total, 0)::numeric AS doc_total,
           'i:' || i.branch || ':' || i.id AS doc_key
    FROM invoices i
    JOIN invoice_details d ON d.branch = i.branch AND d.invoice_id = i.id
    LEFT JOIN products p ON p.branch = d.branch AND p.id = d.product_id
    ${nameJoin('i')}
    WHERE i.branch = ANY($1::text[]) AND ${range('i.purchase_date')}
      AND ${INVOICE_STATUS_SQL} = 'Hoàn thành' AND btrim(i.code) <> ''
    UNION ALL
    SELECT r.branch, ${customerCode('r')},
           COALESCE(NULLIF(rd.raw->>'productCode', ''), p.code, ''),
           COALESCE(NULLIF(rd.raw->>'productName', ''), p.name, ''),
           -abs(COALESCE(rd.quantity, 0))::numeric,
           (${RETURN_AMOUNT_SQL})::numeric,
           -abs(COALESCE(r.total, 0))::numeric,
           'r:' || r.branch || ':' || r.id
    FROM returns r
    JOIN return_details rd ON rd.branch = r.branch AND rd.return_id = r.id
    LEFT JOIN products p ON p.branch = rd.branch AND p.id = rd.product_id
    ${nameJoin('r')}
    WHERE r.branch = ANY($1::text[]) AND ${range('r.return_date')}
      AND r.raw->>'statusValue' = 'Đã trả' AND btrim(r.code) <> ''
  ),
  allocated AS (
    SELECT branch, customer_code, product_code, product_name, qty,
           CASE WHEN SUM(line_amount) OVER w = 0 THEN 0
                ELSE doc_total * line_amount / SUM(line_amount) OVER w END AS amount
    FROM lines
    WINDOW w AS (PARTITION BY doc_key)
  )
  SELECT branch, customer_code, product_code, MAX(product_name) AS product_name,
         round(SUM(amount), 2) AS net_revenue, SUM(qty) AS net_qty
  FROM allocated
  WHERE product_code <> ''
  GROUP BY branch, customer_code, product_code`;

const FREEZE_CUSTOMER_SQL = `
  INSERT INTO business_monthly_customer_sales
    (month, branch, customer_code, customer_name, invoice_amount, return_amount, net_revenue, invoice_count, return_count)
  SELECT $2::date, q.branch, q.customer_code, q.customer_name, q.invoice_amount, q.return_amount,
         q.net_revenue, q.invoice_count, q.return_count
  FROM (${CUSTOMER_MONTH_SELECT_SQL}) q`;

const FREEZE_CUSTOMER_PRODUCT_SQL = `
  INSERT INTO business_monthly_customer_product_sales
    (month, branch, customer_code, product_code, product_name, net_revenue, net_qty)
  SELECT $2::date, q.branch, q.customer_code, q.product_code, q.product_name, q.net_revenue, q.net_qty
  FROM (${CUSTOMER_PRODUCT_MONTH_SELECT_SQL}) q`;

const FREEZE_PRODUCT_SQL = `
  INSERT INTO business_monthly_product_sales (month, product_code, product_name, net_revenue, net_qty)
  SELECT month, product_code, MAX(product_name), SUM(net_revenue), SUM(net_qty)
  FROM business_monthly_customer_product_sales
  WHERE month = $1::date
  GROUP BY month, product_code`;

// Dung lai bang sale tu bang khach x thang theo nhom HIEN TAI. Chi ghi dong THAT SU doi
// (loc o SELECT, khong dua vao ON CONFLICT ... WHERE - van khoa + ghi WAL).
const REBUILD_SALE_SQL = `
  WITH grp AS (
    SELECT DISTINCT ON (branch, btrim(code)) branch, btrim(code) AS code,
           COALESCE(NULLIF(btrim(raw->>'groups'), ''), 'Chưa phân nhóm') AS sale_name
    FROM customers
    WHERE btrim(COALESCE(code, '')) <> ''
    ORDER BY branch, btrim(code), id DESC
  ),
  target AS (
    SELECT m.month, COALESCE(g.sale_name, 'Chưa phân nhóm') AS sale_name,
           SUM(m.net_revenue) AS net_revenue,
           COUNT(*) FILTER (WHERE m.net_revenue <> 0)::int AS customer_count
    FROM business_monthly_customer_sales m
    LEFT JOIN grp g ON g.branch = m.branch AND g.code = m.customer_code
    GROUP BY 1, 2
  ),
  changed AS (
    SELECT t.* FROM target t
    LEFT JOIN business_monthly_sale_sales s ON s.month = t.month AND s.sale_name = t.sale_name
    WHERE s.month IS NULL OR s.net_revenue IS DISTINCT FROM t.net_revenue
       OR s.customer_count IS DISTINCT FROM t.customer_count
  ),
  upserted AS (
    INSERT INTO business_monthly_sale_sales (month, sale_name, net_revenue, customer_count, refreshed_at)
    SELECT month, sale_name, net_revenue, customer_count, now() FROM changed
    ON CONFLICT (month, sale_name) DO UPDATE
      SET net_revenue = EXCLUDED.net_revenue, customer_count = EXCLUDED.customer_count, refreshed_at = now()
    RETURNING 1
  ),
  deleted AS (
    DELETE FROM business_monthly_sale_sales s
    WHERE NOT EXISTS (SELECT 1 FROM target t WHERE t.month = s.month AND t.sale_name = s.sale_name)
    RETURNING 1
  )
  SELECT (SELECT COUNT(*) FROM upserted)::int AS upserted, (SELECT COUNT(*) FROM deleted)::int AS deleted`;

module.exports = {
  BRANCH_CODES, CUSTOMER_MONTH_SELECT_SQL, CUSTOMER_PRODUCT_MONTH_SELECT_SQL,
  FREEZE_CUSTOMER_SQL, FREEZE_CUSTOMER_PRODUCT_SQL, FREEZE_PRODUCT_SQL, REBUILD_SALE_SQL
};
```

- [ ] **Step 4: Chạy test, xác nhận PASS**

Chạy: `cd server && node --test businessReport/businessMonthlySql.test.js`
Kỳ vọng: PASS (3 test). Nếu số phân bổ lệch vì làm tròn, giữ nguyên kỳ vọng của test: số liệu seed được chọn để chia hết.

- [ ] **Step 5: Viết test lỗi cho job (stub pool)**

Tạo `server/kiotvietSync/businessMonthlyRefresh.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const job = require('./businessMonthlyRefresh');

function fakePool(frozenMonths = []) {
  const calls = [];
  const client = {
    query: async (text, params) => {
      calls.push({ text: String(text), params });
      if (/SELECT COUNT\(\*\)::int AS customer_rows/.test(text)) return { rows: [{ customer_rows: 3, customer_product_rows: 5, net_revenue: '1000' }] };
      return { rows: [], rowCount: 0 };
    },
    release() {}
  };
  return {
    calls,
    connect: async () => client,
    query: async (text, params) => {
      calls.push({ text: String(text), params });
      if (/FROM business_monthly_state/.test(text)) return { rows: frozenMonths.map(month => ({ month })) };
      if (/AS upserted/.test(text)) return { rows: [{ upserted: 0, deleted: 0 }] };
      return { rows: [] };
    }
  };
}

test('freezeMonth: 1 giao dich, xoa thang cu roi nap lai 3 bang + ghi state', async () => {
  const pool = fakePool();
  const r = await job.freezeMonth(pool, '2026-09-01', { log: () => {} });
  const texts = pool.calls.map(c => c.text.replace(/\s+/g, ' ').trim());
  assert.equal(texts[0], 'BEGIN');
  assert.ok(texts.some(t => /^SET LOCAL work_mem/.test(t)));
  for (const table of ['business_monthly_customer_sales', 'business_monthly_customer_product_sales', 'business_monthly_product_sales']) {
    assert.ok(texts.some(t => t.startsWith(`DELETE FROM ${table} WHERE month = $1`)), table);
  }
  assert.ok(texts.some(t => /INSERT INTO business_monthly_state/.test(t)));
  assert.equal(texts.at(-1), 'COMMIT');
  const fill = pool.calls.find(c => /INSERT INTO business_monthly_customer_sales/.test(c.text));
  assert.deepEqual(fill.params, [['hanoi', 'saigon'], '2026-09-01', '2026-10-01']);
  assert.deepEqual(r, { month: '2026-09-01', customerRows: 3, customerProductRows: 5, netRevenue: 1000 });
});

test('IfDue: truoc 00:10 ngay 1 khong chot thang vua qua; sau do backfill moi thang thieu tu 2026-03', async () => {
  const early = fakePool(['2026-03-01']);
  const r1 = await job.refreshBusinessMonthlyIfDue(early, { log: () => {}, now: () => new Date('2026-09-30T17:05:00Z') }); // 00:05 VN 01/10
  assert.deepEqual(r1.frozen, ['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01']);
  const late = fakePool(['2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01']);
  const r2 = await job.refreshBusinessMonthlyIfDue(late, { log: () => {}, now: () => new Date('2026-09-30T17:15:00Z') }); // 00:15 VN
  assert.deepEqual(r2.frozen, ['2026-09-01']);
});

test('IfDue luon dung lai bang sale (chi ghi dong doi) ke ca khi khong co thang moi', async () => {
  const months = ['2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'];
  const pool = fakePool(months);
  const r = await job.refreshBusinessMonthlyIfDue(pool, { log: () => {}, now: () => new Date('2026-10-07T03:00:00Z') });
  assert.deepEqual(r.frozen, []);
  assert.ok(pool.calls.some(c => /AS upserted/.test(c.text)));
});

test('schedule chay ngay 1 luot va fail-soft', async () => {
  const logs = [];
  let immediate; let interval;
  const handle = job.startBusinessMonthlySchedule({ query: async () => { throw new Error('db down'); } }, {
    intervalMs: 99, setIntervalFn: (fn, ms) => { interval = { fn, ms }; return 'h'; },
    scheduleImmediate: fn => { immediate = fn; }, log: m => logs.push(m)
  });
  assert.equal(handle, 'h');
  assert.equal(interval.ms, 99);
  immediate();
  await new Promise(r => setImmediate(r));
  assert.match(logs[0], /\[businessMonthlyRefresh\] Loi/);
});
```

- [ ] **Step 6: Chạy test, xác nhận FAIL** (`node --test kiotvietSync/businessMonthlyRefresh.test.js`)

- [ ] **Step 7: Cài đặt `businessMonthlyRefresh.js`**

```js
'use strict';

// Chot cung doanh so theo thang cho Bao cao kinh doanh (migration 0036). Goi moi 5 phut
// (nhu productReportRefresh.js): hau het cac lan chi la 1 SELECT state + dung lai bang
// sale (chi ghi dong doi). Thang vua qua duoc chot khi gio VN >= 00:10 ngay mung 1 (cho
// hoa don cuoi ngay kip sync 7 phut/lan). Lan dau sau deploy: backfill moi thang tu
// FIRST_MONTH. Nut "Tinh lai thang" goi freezeMonth truc tiep.
//
// IO: moi thang chi chot 1 lan (DELETE + INSERT theo thang trong 1 giao dich), khong
// TRUNCATE; bang sale ghi dong doi, loc o SELECT (xem REBUILD_SALE_SQL).

if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (e) { /* dotenv tuy chon */ }
}

const { getPool } = require('../db/pool');
const { vnMinutesOfDay } = require('./vnTime');
const sql = require('../businessReport/businessMonthlySql');
const { FIRST_MONTH, monthKey, addMonths, monthsBetween, vnToday, dayOfMonth } = require('../businessReport/businessMonths');

const SETTLE_MINUTES_AFTER_MIDNIGHT = 10;
const REFRESH_WORK_MEM = '32MB';

async function freezeMonth(pool, month, { log = console.log } = {}) {
  const params = [sql.BRANCH_CODES, month, addMonths(month, 1)];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL work_mem = '${REFRESH_WORK_MEM}'`);
    await client.query('DELETE FROM business_monthly_customer_sales WHERE month = $1', [month]);
    await client.query('DELETE FROM business_monthly_customer_product_sales WHERE month = $1', [month]);
    await client.query('DELETE FROM business_monthly_product_sales WHERE month = $1', [month]);
    await client.query(sql.FREEZE_CUSTOMER_SQL, params);
    await client.query(sql.FREEZE_CUSTOMER_PRODUCT_SQL, params);
    await client.query(sql.FREEZE_PRODUCT_SQL, [month]);
    const { rows } = await client.query(`
      SELECT COUNT(*)::int AS customer_rows,
             (SELECT COUNT(*)::int FROM business_monthly_customer_product_sales WHERE month = $1) AS customer_product_rows,
             COALESCE(SUM(net_revenue), 0) AS net_revenue
      FROM business_monthly_customer_sales WHERE month = $1`, [month]);
    const stats = rows[0];
    await client.query(`
      INSERT INTO business_monthly_state (month, frozen_at, customer_rows, customer_product_rows, net_revenue)
      VALUES ($1, now(), $2, $3, $4)
      ON CONFLICT (month) DO UPDATE SET frozen_at = now(), customer_rows = EXCLUDED.customer_rows,
        customer_product_rows = EXCLUDED.customer_product_rows, net_revenue = EXCLUDED.net_revenue`,
    [month, stats.customer_rows, stats.customer_product_rows, stats.net_revenue]);
    await client.query('COMMIT');
    const result = { month, customerRows: stats.customer_rows, customerProductRows: stats.customer_product_rows, netRevenue: Number(stats.net_revenue) };
    log(`[businessMonthlyRefresh] Da chot thang ${month}: ${result.customerRows} khach, ${result.customerProductRows} dong khach x ma.`);
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function rebuildSaleTable(pool) {
  const { rows } = await pool.query(sql.REBUILD_SALE_SQL);
  return rows[0] || { upserted: 0, deleted: 0 };
}

// Cac thang can chot: tu FIRST_MONTH den thang vua qua, tru thang da co state. Thang vua
// qua chi duoc chot khi da qua 00:10 ngay mung 1 (gio VN).
function monthsDue(frozen, now) {
  const today = vnToday(now);
  const current = monthKey(today);
  let lastClosed = addMonths(current, -1);
  if (dayOfMonth(today) === 1 && vnMinutesOfDay(now) < SETTLE_MINUTES_AFTER_MIDNIGHT) lastClosed = addMonths(lastClosed, -1);
  const done = new Set(frozen);
  return monthsBetween(FIRST_MONTH, lastClosed).filter(m => !done.has(m));
}

async function refreshBusinessMonthlyIfDue(pool, { log = console.log, now = () => new Date() } = {}) {
  const { rows } = await pool.query(`SELECT to_char(month, 'YYYY-MM-DD') AS month FROM business_monthly_state`);
  const due = monthsDue(rows.map(r => r.month), now());
  for (const month of due) await freezeMonth(pool, month, { log });
  const sale = await rebuildSaleTable(pool);
  return { frozen: due, sale };
}

function startBusinessMonthlySchedule(pool, {
  intervalMs = 5 * 60 * 1000, setIntervalFn = setInterval, scheduleImmediate = queueMicrotask, log = console.log
} = {}) {
  const run = label => refreshBusinessMonthlyIfDue(pool, { log }).catch(error => {
    log(`[businessMonthlyRefresh] Loi ${label}: ${error.message}`);
  });
  scheduleImmediate(() => run('khi chay lan dau'));
  return setIntervalFn(() => run('khi kiem tra/chot thang'), intervalMs);
}

async function main() {
  const pool = getPool();
  try {
    const month = process.argv[2];
    if (month) {
      await freezeMonth(pool, monthKey(month));
      console.log(await rebuildSaleTable(pool));
    } else {
      console.log(await refreshBusinessMonthlyIfDue(pool));
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}

module.exports = { freezeMonth, rebuildSaleTable, refreshBusinessMonthlyIfDue, startBusinessMonthlySchedule, monthsDue };
```

Kiểm tra `vnMinutesOfDay(date)` trong `kiotvietSync/vnTime.js` nhận `Date` và trả số phút trong ngày theo giờ VN. Nếu chữ ký khác, sửa lời gọi cho khớp.

- [ ] **Step 8: Chạy test job, xác nhận PASS** (`node --test kiotvietSync/businessMonthlyRefresh.test.js`)

- [ ] **Step 9: Đăng ký trong `scheduler.js`** (theo đúng khuôn `startInventoryValueSnapshot`)
  - Thêm `const { startBusinessMonthlySchedule } = require('./businessMonthlyRefresh');`.
  - Thêm tham số `businessMonthlyIntervalMs = 5 * 60 * 1000` và `startBusinessMonthlySchedule: startBusinessMonthly = startBusinessMonthlySchedule` vào `createPollingScheduler({...})`.
  - Thêm phần tử cuối mảng:

```js
      // Bao cao kinh doanh (server/db/migrations/0036) - chot doanh so thang vua qua luc
      // >= 00:10 VN ngay mung 1 (backfill tu 2026-03 lan dau) + dung lai bang sale theo
      // nhom khach hien tai; ham refreshBusinessMonthlyIfDue tu kiem tra, goi moi 5 phut.
      startBusinessMonthly(getPoolFn(), {
        intervalMs: businessMonthlyIntervalMs,
        setIntervalFn,
        scheduleImmediate,
        log: logger.log ? logger.log.bind(logger) : logger
      })
```

  - Tìm test scheduler hiện có (`grep -ln "startInventoryValueSnapshot" kiotvietSync/*.test.js`). Thêm stub `startBusinessMonthlySchedule` và cập nhật số lượng handle hoặc danh sách job mong đợi.

- [ ] **Step 10: Chạy test liên quan**

Chạy: `cd server && node --test kiotvietSync/businessMonthlyRefresh.test.js businessReport/businessMonthlySql.test.js kiotvietSync/scheduler.test.js`
Nếu file test scheduler có tên khác, dùng file tìm được ở Step 9. Kỳ vọng: PASS.

- [ ] **Step 11: Commit**

```bash
git add server/businessReport/businessMonthlySql.js server/businessReport/businessMonthlySql.test.js server/kiotvietSync/businessMonthlyRefresh.js server/kiotvietSync/businessMonthlyRefresh.test.js server/kiotvietSync/scheduler.js server/kiotvietSync/*scheduler*.test.js
git commit -m "feat(business-report): job chot doanh so thang va dung bang sale"
```

---

### Task 4: Repository + service + API + xuất file

**Files:**
- Create: `server/businessReport/businessReportRepository.js`, `server/businessReport/businessReportService.js`, `server/businessReport/businessReportExport.js`, `server/businessReport/businessReportRoutes.js`
- Modify: `server/routes.js`, `server/auth/featureRegistry.js`
- Test: `server/businessReport/businessReportService.test.js`, `server/businessReport/businessReportRepository.test.js`, `server/businessReport/businessReportRoutes.test.js`, `server/businessReport/businessReportExport.test.js`; cập nhật `server/auth/featureRegistry.test.js` và `server/auth/adminUserRoutes.test.js` (danh sách `saleViewKeys` ở dòng ~650 nếu test so khớp toàn bộ key)

**Interfaces:**
- Consumes: SQL của Task 3, `businessMonths.js`, `freezeMonth`/`rebuildSaleTable` (Task 3).
- Produces (repository):
  - `createRepository({ pool = getPool(), now = () => new Date(), ttlMs = 60000, freeze = freezeMonth, rebuildSale = rebuildSaleTable })`
  - Trả về object với các hàm:
    - `snapshot(): Promise<Snapshot>`
    - `customerProducts({ branch, customerCode, months }): Promise<Array<{productCode, productName, revenue, qty}>>`
    - `productCustomers({ productCode, months }): Promise<Array<{branch, customerCode, revenue, qty}>>`
    - `refreeze(month): Promise<object>` (gọi freeze + rebuildSale + xóa cache)
  - Kiểu dữ liệu:
    - `Snapshot = { today, currentMonth, day, months: monthKey[], frozenMonths: monthKey[], customers: CustomerMonthRow[], products: ProductMonthRow[], sales: SaleMonthRow[], directory: DirectoryRow[], computedAt }`
    - `CustomerMonthRow = { month, branch, customerCode, customerName, netRevenue }`
    - `ProductMonthRow = { month, productCode, productName, netRevenue, netQty }`
    - `SaleMonthRow = { month, saleName, netRevenue }`
    - `DirectoryRow = { branch, code, name, saleName, priceLevel }`
- Produces (service, thuần, không I/O):
  - `buildSaleReport(snapshot)`, `buildCustomerReport(snapshot)`, `buildProductReport(snapshot)` → `{ today, currentMonth, day, months, monthLabels, kpis, rows }`
  - `buildDetail(kind, key, snapshot, extra)`
  - Mỗi row chứa: `key`, các trường nhận diện, `series: { [monthKey]: number }`, `current`, `normalized`, `prev`, `growth` (`number|null`), `avg4`, `active` (`boolean`).
    - Sale row: `{ key: saleName, saleName, activeCustomers, … }`
    - Customer row: `{ key: branch + ':' + code, branch, code, name, saleName, priceLevel, … }`
    - Product row: `{ key: code, code, name, … }`
- HTTP (mount `/api/business-report`):
  - `GET /sales`, `GET /customers`, `GET /products` (yêu cầu `reports.business`)
  - `GET /detail?kind=sale|customer|product&key=` (yêu cầu `reports.business`)
  - `POST /refreeze` body `{month:'YYYY-MM'}` (yêu cầu `reports.business.refreeze`)
  - `GET /export?kind=sales|customers|products&format=xlsx|html&q=&sale=&branch=&inactive=1` (yêu cầu `reports.business` + `reports.export`)

- [ ] **Step 1: Thêm quyền (test trước)**

Trong `server/auth/featureRegistry.test.js`, thêm test:

```js
test('bao cao kinh doanh: xem theo vai tro xem bao cao, tinh lai thang chi Quan ly', () => {
  const { FEATURES, REPORT_VIEW_FEATURES, resolvePermissions } = require('./featureRegistry');
  const view = FEATURES.find(f => f.key === 'reports.business');
  const refreeze = FEATURES.find(f => f.key === 'reports.business.refreeze');
  assert.ok(view && refreeze);
  assert.equal(refreeze.requires, 'reports.business');
  assert.ok(REPORT_VIEW_FEATURES.includes('reports.business'));
  assert.ok(resolvePermissions({ vaiTro: 'Nhân viên sale' }).includes('reports.business'));
  assert.ok(!resolvePermissions({ vaiTro: 'Nhân viên sale' }).includes('reports.business.refreeze'));
  assert.ok(resolvePermissions({ vaiTro: 'Quản lý' }).includes('reports.business.refreeze'));
});
```

Kiểm tra tên vai trò đúng chính tả trong `auth/userRepository.js` (ROLES), và tên hàm `resolvePermissions` có trong `module.exports` của featureRegistry. Nếu khác thì sửa test cho khớp.

Chạy test, xác nhận FAIL. Sau đó thêm vào `FEATURES`, ngay sau dòng `reports.debt.edit`:

```js
  // 2026-10-07: Bao cao kinh doanh (tang truong Sale/Khach/Ma hang theo thang). Spec:
  // docs/superpowers/specs/2026-10-07-business-report-design.md.
  { key: 'reports.business', groupKey: 'reports', label: 'Báo cáo kinh doanh', roles: REPORT_VIEW_ROLES },
  { key: 'reports.business.refreeze', groupKey: 'reports', label: 'Báo cáo kinh doanh: tính lại tháng đã chốt (cần Báo cáo kinh doanh)', roles: MANAGER_ONLY, requires: 'reports.business' },
```

Thêm `'reports.business'` vào `REPORT_VIEW_FEATURES`. Chạy `node --test auth/*.test.js` và sửa các test so khớp danh sách key đầy đủ (ví dụ `adminUserRoutes.test.js` `saleViewKeys`), chỉ thêm key mới, không bỏ kiểm tra cũ. Kỳ vọng: PASS.

- [ ] **Step 2: Viết test lỗi cho service (dữ liệu snapshot giả)**

`server/businessReport/businessReportService.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const svc = require('./businessReportService');

function snapshot() {
  return {
    today: '2026-10-06', currentMonth: '2026-10-01', day: 6,
    months: ['2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01'],
    frozenMonths: ['2026-07-01', '2026-08-01', '2026-09-01'],
    computedAt: '2026-10-06T03:00:00.000Z',
    directory: [
      { branch: 'hanoi', code: 'KH1', name: 'Chị A', saleName: 'Khang', priceLevel: 'Level 2' },
      { branch: 'saigon', code: 'KH1', name: 'Anh B', saleName: 'Khang', priceLevel: '' },
      { branch: 'hanoi', code: 'KH2', name: 'Cô C', saleName: 'Chưa phân nhóm', priceLevel: '' },
      { branch: 'hanoi', code: 'KH9', name: 'Cũ', saleName: 'Trinh', priceLevel: '' }
    ],
    customers: [
      { month: '2026-09-01', branch: 'hanoi', customerCode: 'KH1', customerName: 'Chị A', netRevenue: 500 },
      { month: '2026-10-01', branch: 'hanoi', customerCode: 'KH1', customerName: 'Chị A', netRevenue: 100 },
      { month: '2026-08-01', branch: 'saigon', customerCode: 'KH1', customerName: 'Anh B', netRevenue: 300 },
      { month: '2026-10-01', branch: 'hanoi', customerCode: '', customerName: 'Khách lẻ', netRevenue: 60 },
      { month: '2026-03-01', branch: 'hanoi', customerCode: 'KH9', customerName: 'Cũ', netRevenue: 999 }
    ],
    sales: [
      { month: '2026-08-01', saleName: 'Khang', netRevenue: 300 },
      { month: '2026-09-01', saleName: 'Khang', netRevenue: 500 }
    ],
    products: [
      { month: '2026-09-01', productCode: 'SP1', productName: 'Khay', netRevenue: 400, netQty: 4 },
      { month: '2026-10-01', productCode: 'SP1', productName: 'Khay', netRevenue: 160, netQty: 2 }
    ]
  };
}

test('bang khach: quy doi 30 ngay, tang truong, TB 4 thang, khach hoat dong, Khach le vao Chua phan nhom', () => {
  const r = svc.buildCustomerReport(snapshot());
  const a = r.rows.find(x => x.key === 'hanoi:KH1');
  assert.equal(a.saleName, 'Khang');
  assert.equal(a.priceLevel, 'Level 2');
  assert.equal(a.normalized, 500);            // 100*30/6
  assert.equal(a.growth, 100);                // 500/500
  assert.equal(a.avg4, (500 + 0 + 0 + 500) / 4);
  assert.equal(a.active, true);
  const le = r.rows.find(x => x.key === 'hanoi:');
  assert.equal(le.saleName, 'Chưa phân nhóm');
  assert.equal(le.name, 'Khách lẻ');
  assert.equal(le.growth, null);
  const old = r.rows.find(x => x.key === 'hanoi:KH9');
  assert.equal(old.active, false, 'chi co doanh so T3 => TB 4 thang = 0');
  assert.deepEqual(r.monthLabels, ['T7/26', 'T8/26', 'T9/26', 'T10/26']);
});

test('bang sale: thang chot doc bang sale, thang hien tai gom tu khach theo nhom hien tai; SL khach = so khach hoat dong', () => {
  const r = svc.buildSaleReport(snapshot());
  const khang = r.rows.find(x => x.saleName === 'Khang');
  assert.equal(khang.series['2026-09-01'], 500);
  assert.equal(khang.current, 100);
  assert.equal(khang.activeCustomers, 2); // KH1 HN + KH1 SG (TB4 = 300/4 > 0)
  const none = r.rows.find(x => x.saleName === 'Chưa phân nhóm');
  assert.equal(none.current, 60);
  assert.ok(r.kpis.find(k => k.key === 'current').value === 160);
});

test('bang ma hang: tang truong theo tien', () => {
  const r = svc.buildProductReport(snapshot());
  const p = r.rows.find(x => x.code === 'SP1');
  assert.equal(p.normalized, 800);
  assert.equal(p.growth, 200);
});

test('chi tiet sale: tong quan + chuoi thang + danh sach khach cua sale', () => {
  const d = svc.buildDetail('sale', 'Khang', snapshot(), {});
  assert.equal(d.title, 'Khang');
  assert.deepEqual(d.chart.map(c => c.label), ['T7/26', 'T8/26', 'T9/26', 'T10/26']);
  assert.equal(d.customers.length, 2);
  assert.ok(d.summary.find(s => s.key === 'avg4'));
});

test('khong co key thi buildDetail nem loi 404', () => {
  assert.throws(() => svc.buildDetail('sale', 'Khong ton tai', snapshot(), {}), e => e.statusCode === 404);
});
```

- [ ] **Step 3: Chạy, xác nhận FAIL** (`node --test businessReport/businessReportService.test.js`)

- [ ] **Step 4: Cài đặt `businessReportService.js`**

```js
'use strict';

// Gom so lieu Bao cao kinh doanh tu snapshot cua repository (ham thuan, khong I/O):
// dong Sale / Khach / Ma hang voi chuoi doanh so theo thang, quy doi 30 ngay, tang
// truong, TB 4 thang, co "hoat dong"; KPI dau muc; du lieu panel chi tiet.

const { UNGROUPED_SALE, buildMetrics, monthLabel, addMonths } = require('./businessMonths');

function notFound(message) {
  const e = new Error(message);
  e.statusCode = 404;
  return e;
}

function withMetrics(row, series, snap) {
  const m = buildMetrics(series, snap.currentMonth, snap.day);
  return { ...row, series, ...m, active: m.avg4 > 0 };
}

function header(snap) {
  return {
    today: snap.today, currentMonth: snap.currentMonth, day: snap.day, months: snap.months,
    monthLabels: snap.months.map(monthLabel), frozenMonths: snap.frozenMonths, computedAt: snap.computedAt
  };
}

function directoryIndex(snap) {
  const map = new Map();
  for (const d of snap.directory) map.set(`${d.branch}:${d.code}`, d);
  return map;
}

function customerRows(snap) {
  const dir = directoryIndex(snap);
  const groups = new Map();
  for (const r of snap.customers) {
    const key = `${r.branch}:${r.customerCode}`;
    let g = groups.get(key);
    if (!g) {
      const d = dir.get(key);
      g = {
        row: {
          key, branch: r.branch, code: r.customerCode,
          name: (d && d.name) || r.customerName || 'Khách lẻ',
          saleName: (r.customerCode && d && d.saleName) || UNGROUPED_SALE,
          priceLevel: (d && d.priceLevel) || ''
        },
        series: {}
      };
      groups.set(key, g);
    }
    g.series[r.month] = (g.series[r.month] || 0) + Number(r.netRevenue || 0);
  }
  return [...groups.values()].map(g => withMetrics(g.row, g.series, snap));
}

function sumKpis(rows, snap) {
  const total = key => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
  const current = total('current');
  const prev = total('prev');
  const normalized = total('normalized');
  return [
    { key: 'current', label: `Doanh số tháng này (đến ${snap.today.slice(8, 10)}/${snap.today.slice(5, 7)})`, value: current, type: 'money' },
    { key: 'normalized', label: 'Quy đổi 30 ngày', value: normalized, type: 'money' },
    { key: 'prev', label: 'Tháng trước', value: prev, type: 'money' },
    { key: 'growth', label: 'Tăng trưởng chung', value: prev > 0 ? normalized / prev * 100 : null, type: 'percent' },
    { key: 'avg4', label: 'TB 4 tháng', value: total('avg4'), type: 'money' }
  ];
}

function sortByAvg4(rows) {
  return rows.sort((a, b) => b.avg4 - a.avg4 || b.current - a.current);
}

function buildCustomerReport(snap) {
  const rows = sortByAvg4(customerRows(snap));
  const kpis = [
    ...sumKpis(rows.filter(r => r.active), snap),
    { key: 'activeCount', label: 'Khách hoạt động', value: rows.filter(r => r.active).length, type: 'number' }
  ];
  return { ...header(snap), kpis, rows };
}

function buildSaleReport(snap) {
  const customers = customerRows(snap);
  const sales = new Map();
  const ensure = name => {
    if (!sales.has(name)) sales.set(name, { saleName: name, series: {}, activeCustomers: 0 });
    return sales.get(name);
  };
  const frozen = new Set(snap.frozenMonths);
  // Thang da chot: doc bang sale (dung lai theo nhom hien tai boi job).
  for (const r of snap.sales) {
    if (frozen.has(r.month)) ensure(r.saleName).series[r.month] = Number(r.netRevenue) || 0;
  }
  // Thang chua chot (gom thang hien tai) + dem khach hoat dong: gom tu dong khach.
  for (const c of customers) {
    const s = ensure(c.saleName);
    if (c.active) s.activeCustomers += 1;
    for (const [month, value] of Object.entries(c.series)) {
      if (!frozen.has(month)) s.series[month] = (s.series[month] || 0) + value;
    }
  }
  const rows = sortByAvg4([...sales.values()].map(s =>
    withMetrics({ key: s.saleName, saleName: s.saleName, activeCustomers: s.activeCustomers }, s.series, snap)));
  const kpis = [
    ...sumKpis(rows, snap),
    { key: 'saleCount', label: 'Số sale', value: rows.filter(r => r.saleName !== UNGROUPED_SALE).length, type: 'number' },
    { key: 'activeCount', label: 'Khách hoạt động', value: rows.reduce((s, r) => s + r.activeCustomers, 0), type: 'number' }
  ];
  return { ...header(snap), kpis, rows };
}

function buildProductReport(snap) {
  const groups = new Map();
  for (const r of snap.products) {
    let g = groups.get(r.productCode);
    if (!g) { g = { row: { key: r.productCode, code: r.productCode, name: r.productName || '' }, series: {} }; groups.set(r.productCode, g); }
    if (r.productName) g.row.name = r.productName;
    g.series[r.month] = (g.series[r.month] || 0) + Number(r.netRevenue || 0);
  }
  const rows = sortByAvg4([...groups.values()].map(g => withMetrics(g.row, g.series, snap)));
  const kpis = [
    ...sumKpis(rows, snap),
    { key: 'activeCount', label: 'Mã hoạt động', value: rows.filter(r => r.active).length, type: 'number' }
  ];
  return { ...header(snap), kpis, rows };
}

function last4Months(snap) {
  return [3, 2, 1, 0].map(i => addMonths(snap.currentMonth, -i));
}

function detailBase(row, snap, title, subtitle) {
  return {
    ...header(snap), title, subtitle,
    summary: [
      { key: 'current', label: 'Tháng này', value: row.current, type: 'money' },
      { key: 'normalized', label: 'Quy đổi 30 ngày', value: row.normalized, type: 'money' },
      { key: 'prev', label: 'Tháng trước', value: row.prev, type: 'money' },
      { key: 'growth', label: 'Tăng trưởng', value: row.growth, type: 'percent' },
      { key: 'avg4', label: 'TB 4 tháng', value: row.avg4, type: 'money' },
      { key: 'total', label: 'Tổng từ T3/26', value: Object.values(row.series).reduce((s, v) => s + v, 0), type: 'money' }
    ],
    chart: snap.months.map(m => ({ month: m, label: monthLabel(m), value: row.series[m] || 0, partial: m === snap.currentMonth }))
  };
}

// extra.topProducts / extra.topCustomers do routes nap qua repository (4 thang gan nhat).
function buildDetail(kind, key, snap, extra = {}) {
  if (kind === 'sale') {
    const report = buildSaleReport(snap);
    const row = report.rows.find(r => r.key === key);
    if (!row) throw notFound('Không tìm thấy sale này.');
    const customers = buildCustomerReport(snap).rows.filter(c => c.saleName === key);
    const base = detailBase(row, snap, key, `${row.activeCustomers} khách hoạt động`);
    base.summary.push({ key: 'activeCustomers', label: 'SL khách hoạt động', value: row.activeCustomers, type: 'number' });
    return { ...base, kind, customers };
  }
  if (kind === 'customer') {
    const row = buildCustomerReport(snap).rows.find(r => r.key === key);
    if (!row) throw notFound('Không tìm thấy khách hàng này.');
    return { ...detailBase(row, snap, row.name, `${row.code || 'Khách lẻ'} · ${row.branch === 'hanoi' ? 'HN' : 'SG'} · Sale ${row.saleName}`),
      kind, customer: row, topProducts: extra.topProducts || [], window: last4Months(snap) };
  }
  if (kind === 'product') {
    const row = buildProductReport(snap).rows.find(r => r.key === key);
    if (!row) throw notFound('Không tìm thấy mã hàng này.');
    return { ...detailBase(row, snap, `${row.code} – ${row.name}`, 'Doanh số theo tháng'),
      kind, product: row, topCustomers: extra.topCustomers || [], window: last4Months(snap) };
  }
  const e = new Error('Loại chi tiết không hợp lệ.');
  e.statusCode = 400;
  throw e;
}

module.exports = { buildSaleReport, buildCustomerReport, buildProductReport, buildDetail, last4Months };
```

- [ ] **Step 5: Chạy, xác nhận PASS** (`node --test businessReport/businessReportService.test.js`)

- [ ] **Step 6: Viết test lỗi cho repository (PGlite, tái dùng `seed` của Task 3)**

Tách hàm `seed`/`BASE` của `businessMonthlySql.test.js` ra `server/businessReport/testFixtures.js` (exports `{ seed }`), rồi cho cả 2 file test require nó. Pool giả bọc PGlite:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { seed } = require('./testFixtures');
const { createRepository } = require('./businessReportRepository');

function poolFrom(db) {
  return { query: (text, params) => db.query(text, params), connect: async () => ({ query: (t, p) => db.query(t, p), release() {} }) };
}

test('snapshot: thang da chot doc bang, thang chua chot tinh truc tiep; danh ba co sale/level gia; cache 60s', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  try {
    await seed(db);
    let now = new Date('2026-10-06T03:00:00Z');
    const repo = createRepository({ pool: poolFrom(db), now: () => now });
    // Chua chot thang nao => thang 9 tinh live
    let snap = await repo.snapshot();
    assert.equal(snap.currentMonth, '2026-10-01');
    assert.equal(snap.day, 6);
    assert.equal(snap.months[0], '2026-03-01');
    assert.deepEqual(snap.frozenMonths, []);
    assert.equal(snap.customers.find(r => r.month === '2026-09-01' && r.customerCode === 'KH1').netRevenue, 810);
    assert.equal(snap.customers.find(r => r.month === '2026-10-01' && r.customerCode === 'KH1').netRevenue, 500);
    assert.deepEqual(snap.directory.find(d => d.branch === 'hanoi' && d.code === 'KH1'),
      { branch: 'hanoi', code: 'KH1', name: 'Chị A', saleName: 'Khang', priceLevel: 'Level 2' });
    // Chot thang 9 bang repo.refreeze => doc tu bang
    await repo.refreeze('2026-09');
    snap = await repo.snapshot();
    assert.ok(snap.frozenMonths.includes('2026-09-01'));
    assert.equal(snap.sales.find(s => s.month === '2026-09-01' && s.saleName === 'Khang').netRevenue, 810);
    // Cache: them hoa don moi, trong 60s van so cu; qua 60s thi so moi
    await db.exec(`INSERT INTO invoices VALUES ('hanoi', 105, 'HD5', '2026-10-05 10:00:00+00', 50, 1, '{"statusValue":"Hoàn thành","customerCode":"KH1"}')`);
    assert.equal((await repo.snapshot()).customers.find(r => r.month === '2026-10-01' && r.customerCode === 'KH1').netRevenue, 500);
    now = new Date(now.getTime() + 61000);
    assert.equal((await repo.snapshot()).customers.find(r => r.month === '2026-10-01' && r.customerCode === 'KH1').netRevenue, 550);
  } finally { await db.close(); }
});

test('top ma hang cua khach va top khach cua ma hang trong cac thang chi dinh (gop thang chot + live)', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  try {
    await seed(db);
    const repo = createRepository({ pool: poolFrom(db), now: () => new Date('2026-10-06T03:00:00Z') });
    await repo.refreeze('2026-09');
    const months = ['2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01'];
    const top = await repo.customerProducts({ branch: 'hanoi', customerCode: 'KH1', months });
    assert.deepEqual(top.map(r => [r.productCode, r.revenue]), [['SP1', 950], ['SP2', 360]]); // 450 + 500 (T10)
    const buyers = await repo.productCustomers({ productCode: 'SP2', months });
    assert.deepEqual(buyers.map(r => [r.branch, r.customerCode, r.revenue]), [['hanoi', 'KH1', 360], ['hanoi', 'KH2', 200]]);
  } finally { await db.close(); }
});
```

- [ ] **Step 7: Chạy, xác nhận FAIL**

- [ ] **Step 8: Cài đặt `businessReportRepository.js`**

```js
'use strict';

// Nguon du lieu Bao cao kinh doanh. Thang DA CHOT (co dong business_monthly_state) doc
// tu bang 0036; thang CHUA chot (thang hien tai, hoac thang vua qua khi job chua kip chot /
// chua backfill) tinh truc tiep bang CUNG cau SQL cua job. Ket qua cache ttlMs (mac dinh
// 60s, stale-while-revalidate) vi tinh live 1 thang mat ~1-2s. Luon gop HN + SG.

const { getPool } = require('../db/pool');
const sql = require('./businessMonthlySql');
const { FIRST_MONTH, UNGROUPED_SALE, monthKey, addMonths, monthsBetween, vnToday, dayOfMonth } = require('./businessMonths');
const { freezeMonth, rebuildSaleTable } = require('../kiotvietSync/businessMonthlyRefresh');

const num = v => Number(v) || 0;

function createRepository({
  pool = getPool(), now = () => new Date(), ttlMs = 60 * 1000,
  freeze = freezeMonth, rebuildSale = rebuildSaleTable
} = {}) {
  let cache = null; // { at, promise }
  const liveCache = new Map(); // month -> { at, promise: {customers, customerProducts} }

  function live(month) {
    const hit = liveCache.get(month);
    if (hit && now().getTime() - hit.at < ttlMs) return hit.promise;
    const params = [sql.BRANCH_CODES, month, addMonths(month, 1)];
    const promise = Promise.all([
      pool.query(sql.CUSTOMER_MONTH_SELECT_SQL, params),
      pool.query(sql.CUSTOMER_PRODUCT_MONTH_SELECT_SQL, params)
    ]).then(([c, cp]) => ({ customers: c.rows, customerProducts: cp.rows }));
    liveCache.set(month, { at: now().getTime(), promise });
    promise.catch(() => liveCache.delete(month));
    return promise;
  }

  async function load() {
    const today = vnToday(now());
    const currentMonth = monthKey(today);
    const months = monthsBetween(FIRST_MONTH, currentMonth);
    const [state, frozenCustomers, frozenProducts, frozenSales, directory] = await Promise.all([
      pool.query(`SELECT to_char(month, 'YYYY-MM-DD') AS month FROM business_monthly_state`),
      pool.query(`SELECT to_char(month, 'YYYY-MM-DD') AS month, branch, customer_code, customer_name, net_revenue
                  FROM business_monthly_customer_sales WHERE month >= $1::date`, [FIRST_MONTH]),
      pool.query(`SELECT to_char(month, 'YYYY-MM-DD') AS month, product_code, product_name, net_revenue, net_qty
                  FROM business_monthly_product_sales WHERE month >= $1::date`, [FIRST_MONTH]),
      pool.query(`SELECT to_char(month, 'YYYY-MM-DD') AS month, sale_name, net_revenue
                  FROM business_monthly_sale_sales WHERE month >= $1::date`, [FIRST_MONTH]),
      pool.query(`SELECT DISTINCT ON (branch, btrim(code)) branch, btrim(code) AS code, name,
                         COALESCE(NULLIF(btrim(raw->>'groups'), ''), $1) AS sale_name,
                         COALESCE(btrim(raw->>'comments'), '') AS price_level
                  FROM customers WHERE btrim(COALESCE(code, '')) <> ''
                  ORDER BY branch, btrim(code), id DESC`, [UNGROUPED_SALE])
    ]);
    const frozenMonths = state.rows.map(r => r.month).filter(m => m < currentMonth).sort();
    const frozen = new Set(frozenMonths);
    const customers = frozenCustomers.rows.filter(r => frozen.has(r.month)).map(r => ({
      month: r.month, branch: r.branch, customerCode: r.customer_code, customerName: r.customer_name, netRevenue: num(r.net_revenue)
    }));
    const products = frozenProducts.rows.filter(r => frozen.has(r.month)).map(r => ({
      month: r.month, productCode: r.product_code, productName: r.product_name, netRevenue: num(r.net_revenue), netQty: num(r.net_qty)
    }));
    for (const month of months.filter(m => !frozen.has(m))) {
      const data = await live(month);
      for (const r of data.customers) customers.push({ month, branch: r.branch, customerCode: r.customer_code, customerName: r.customer_name, netRevenue: num(r.net_revenue) });
      const byCode = new Map();
      for (const r of data.customerProducts) {
        const p = byCode.get(r.product_code) || { month, productCode: r.product_code, productName: r.product_name, netRevenue: 0, netQty: 0 };
        p.netRevenue += num(r.net_revenue); p.netQty += num(r.net_qty);
        if (r.product_name) p.productName = r.product_name;
        byCode.set(r.product_code, p);
      }
      products.push(...byCode.values());
    }
    return {
      today, currentMonth, day: dayOfMonth(today), months, frozenMonths,
      customers, products,
      sales: frozenSales.rows.filter(r => frozen.has(r.month)).map(r => ({ month: r.month, saleName: r.sale_name, netRevenue: num(r.net_revenue) })),
      directory: directory.rows.map(r => ({ branch: r.branch, code: r.code, name: r.name || '', saleName: r.sale_name, priceLevel: r.price_level })),
      computedAt: now().toISOString()
    };
  }

  function snapshot() {
    if (cache && now().getTime() - cache.at < ttlMs) return cache.promise;
    const promise = load();
    cache = { at: now().getTime(), promise };
    promise.catch(() => { if (cache && cache.promise === promise) cache = null; });
    return promise;
  }

  async function linesFor(months, where, params, mapKey) {
    const snap = await snapshot();
    const frozen = new Set(snap.frozenMonths);
    const totals = new Map();
    const add = (row) => {
      const key = mapKey(row);
      const t = totals.get(key) || { ...row, revenue: 0, qty: 0 };
      t.revenue += num(row.net_revenue); t.qty += num(row.net_qty);
      totals.set(key, t);
    };
    const frozenList = months.filter(m => frozen.has(m));
    if (frozenList.length) {
      const { rows } = await pool.query(`SELECT branch, customer_code, product_code, product_name, net_revenue, net_qty
        FROM business_monthly_customer_product_sales
        WHERE month = ANY($1::date[]) AND ${where}`, [frozenList, ...params]);
      rows.forEach(add);
    }
    for (const m of months.filter(x => !frozen.has(x) && x >= FIRST_MONTH && x <= snap.currentMonth)) {
      const data = await live(m);
      data.customerProducts.filter(r => matches(r, where, params)).forEach(add);
    }
    return [...totals.values()].sort((a, b) => b.revenue - a.revenue);
  }

  // Loc dong live tuong ung voi menh de WHERE cua bang chot (2 dang duy nhat ben duoi).
  function matches(r, where, params) {
    if (where.startsWith('branch')) return r.branch === params[0] && r.customer_code === params[1];
    return r.product_code === params[0];
  }

  async function customerProducts({ branch, customerCode, months }) {
    const rows = await linesFor(months, 'branch = $2 AND customer_code = $3', [branch, customerCode], r => r.product_code);
    return rows.map(r => ({ productCode: r.product_code, productName: r.product_name, revenue: r.revenue, qty: r.qty }));
  }

  async function productCustomers({ productCode, months }) {
    const rows = await linesFor(months, 'product_code = $2', [productCode], r => `${r.branch}:${r.customer_code}`);
    return rows.map(r => ({ branch: r.branch, customerCode: r.customer_code, revenue: r.revenue, qty: r.qty }));
  }

  async function refreeze(monthParam) {
    if (!/^\d{4}-\d{2}$/.test(String(monthParam || ''))) {
      const e = new Error('Tháng không hợp lệ (định dạng YYYY-MM).'); e.statusCode = 400; throw e;
    }
    const month = `${monthParam}-01`;
    const current = monthKey(vnToday(now()));
    if (month < FIRST_MONTH || month >= current) {
      const e = new Error('Chỉ tính lại được tháng đã qua, từ T3/2026.'); e.statusCode = 400; throw e;
    }
    const result = await freeze(pool, month, { log: console.log });
    await rebuildSale(pool);
    cache = null; liveCache.clear();
    return result;
  }

  return { snapshot, customerProducts, productCustomers, refreeze };
}

module.exports = { createRepository };
```

Lưu ý:
- `matches` dựa trên 2 mệnh đề `where` cố định ở trên. Đừng thêm dạng where mới mà không sửa `matches`.
- Nếu PGlite trả `to_char` khác định dạng thì sửa test, không sửa SQL.
- Nếu bảng chưa migrate thì `snapshot()` ném lỗi `relation ... does not exist`. Route bắt lỗi này (Step 10) và trả `503 { error, code: 'BUSINESS_REPORT_NOT_READY' }`.

- [ ] **Step 9: Chạy test repository, xác nhận PASS**

- [ ] **Step 10: Test lỗi + cài đặt routes**

`server/businessReport/businessReportRoutes.test.js` dựng theo khuôn `cashbook/cashbookRoutes.test.js`: app express, gắn `req.user`, `createBusinessReportRouter({ repository })`. Các test:
1. `GET /sales` với quyền `['reports.business']` → 200, `body.rows[0].saleName`. Không có quyền → 403.
2. `GET /detail?kind=customer&key=hanoi:KH1` gọi `repository.customerProducts` với `{branch:'hanoi', customerCode:'KH1', months:[4 tháng]}` và trả `topProducts`.
3. `GET /detail?kind=sale&key=Khong` → 404.
4. `POST /refreeze` body `{month:'2026-09'}`: không có `reports.business.refreeze` → 403; có quyền → 200 và gọi `repository.refreeze('2026-09')`.
5. `GET /export?kind=customers&format=xlsx` không có `reports.export` → 403; có quyền → header `content-type` chứa `spreadsheetml`.
6. Repository ném lỗi `relation "business_monthly_state" does not exist` → 503 `BUSINESS_REPORT_NOT_READY`.

Repository giả trả `snapshot()` = hàm `snapshot()` của service test (chép vào `testFixtures.js` dạng `serviceSnapshot()`).

Cài đặt:

```js
'use strict';
const express = require('express');
const { requireAuth, requireFeature } = require('../auth/authMiddleware');
const { createRepository } = require('./businessReportRepository');
const svc = require('./businessReportService');
const { createExportFile, filterRows } = require('./businessReportExport');

const BUILDERS = { sales: svc.buildSaleReport, customers: svc.buildCustomerReport, products: svc.buildProductReport };

function createBusinessReportRouter({ repository = createRepository() } = {}) {
  const router = express.Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const view = [requireAuth, requireFeature('reports.business')];
  const handle = fn => async (req, res) => {
    try { await fn(req, res); } catch (e) {
      if (e.statusCode && e.statusCode < 500) return res.status(e.statusCode).json({ error: e.message, code: e.code });
      if (/business_monthly_\w+" does not exist/.test(e.message || '')) {
        return res.status(503).json({ error: 'Báo cáo kinh doanh chưa sẵn sàng (chưa áp migration 0036).', code: 'BUSINESS_REPORT_NOT_READY' });
      }
      console.error(`[business-report ${req.method} ${req.path}]`, e);
      return res.status(500).json({ error: 'Lỗi hệ thống, vui lòng thử lại sau.', code: 'BUSINESS_REPORT_ERROR' });
    }
  };

  for (const kind of Object.keys(BUILDERS)) {
    router.get(`/${kind}`, ...view, handle(async (req, res) => res.json(BUILDERS[kind](await repository.snapshot()))));
  }

  router.get('/detail', ...view, handle(async (req, res) => {
    const kind = String(req.query.kind || '');
    const key = String(req.query.key || '');
    const snap = await repository.snapshot();
    const months = svc.last4Months(snap);
    const extra = {};
    if (kind === 'customer') {
      const i = key.indexOf(':');
      extra.topProducts = (await repository.customerProducts({ branch: key.slice(0, i), customerCode: key.slice(i + 1), months })).slice(0, 50);
    } else if (kind === 'product') {
      const names = new Map(snap.directory.map(d => [`${d.branch}:${d.code}`, d.name]));
      extra.topCustomers = (await repository.productCustomers({ productCode: key, months })).slice(0, 50)
        .map(r => ({ ...r, customerName: r.customerCode ? (names.get(`${r.branch}:${r.customerCode}`) || r.customerCode) : 'Khách lẻ' }));
    }
    res.json(svc.buildDetail(kind, key, snap, extra));
  }));

  router.post('/refreeze', requireAuth, requireFeature('reports.business.refreeze'), express.json(),
    handle(async (req, res) => res.json(await repository.refreeze(req.body && req.body.month))));

  router.get('/export', ...view, requireFeature('reports.export'), handle(async (req, res) => {
    const kind = String(req.query.kind || '');
    if (!BUILDERS[kind]) { const e = new Error('Bảng xuất không hợp lệ.'); e.statusCode = 400; throw e; }
    const report = BUILDERS[kind](await repository.snapshot());
    const rows = filterRows(kind, report.rows, req.query);
    const file = await createExportFile(kind, String(req.query.format || 'xlsx'), report, rows);
    res.set('Content-Type', file.mimeType);
    res.set('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.send(file.buffer);
  }));

  return router;
}

module.exports = { createBusinessReportRouter };
```

Kiểm tra `requireFeature(a)` đặt 2 lần liên tiếp (view + export) vẫn yêu cầu đủ cả 2 quyền. Đọc `auth/authMiddleware.js`: nếu `requireFeature(...keys)` là "một trong các key" thì việc gọi 2 middleware riêng là đúng ý "cả hai".

Trong `server/routes.js`:
- Thêm `const { createBusinessReportRouter } = require('./businessReport/businessReportRoutes');` cạnh `cashbookRoutes`.
- Thêm `router.use('/api/business-report', createBusinessReportRouter());` cạnh `router.use('/api/cashbook', …)`.

KHÔNG dùng `reportsUser` (không cần `resolveBranch`).

- [ ] **Step 11: Test lỗi + cài đặt xuất file `businessReportExport.js`**

Test (`businessReportExport.test.js`):
- `filterRows('customers', rows, {})` chỉ giữ `active`.
- `{inactive:'1'}` giữ tất cả.
- `{sale:'Khang'}` lọc theo sale.
- `{branch:'saigon'}` lọc theo cơ sở.
- `{q:'chi a'}` tìm không dấu trong tên/mã.
- `createExportFile('sales','xlsx', report, rows)`: đọc lại bằng ExcelJS, hàng 1 = `['Sale','SL Khách','TB 4 tháng','Tăng trưởng','Tháng hiện tại (đến 06/10)','T9/26','T8/26','T7/26']` (tháng giảm dần, bỏ tháng hiện tại khỏi danh sách tháng vì đã có cột riêng); ô tăng trưởng `null` ghi `'—'`.
- `createExportFile('products','html', …)`: buffer chứa `<!DOCTYPE html>` và `Chart`.

Cài đặt theo khuôn `cashbook/cashbookExport.js`: `renderHtmlReport` của `dashboard/exportHtmlReport.js`; `HEADER_FONT`, `frozenNoGridlinesView`, `applyFullTableBorder` của `../excelTableStyle`.
- Cột cố định theo kind:
  - `sales`: `saleName` Sale, `activeCustomers` SL Khách.
  - `customers`: `code` Mã KH, `name` Tên khách, `branch` Cơ sở (HN/SG), `saleName` Sale, `priceLevel` Level giá.
  - `products`: `code` Mã hàng, `name` Tên hàng.
- Sau cột cố định:
  - `avg4` TB 4 tháng (tiền);
  - `growth` Tăng trưởng (`numFmt '0%'`, ghi `growth/100`; null thì `'—'`);
  - `current` Tháng hiện tại (đến dd/mm);
  - mỗi tháng trước `m_<YYYY_MM>` nhãn `monthLabel`.
- HTML worksheet: `summaryKeys: ['current', 'avg4']`, `hints: { labelKey: kind==='sales' ? 'saleName' : 'name' }`.
- `filterRows` dùng chuẩn hóa không dấu: `s.normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/đ/g,'d').toLowerCase()`.
- `fileName` = `TKS_Bao_cao_kinh_doanh_${kind}.${format}`.
- Giới hạn 20.000 dòng giống cashbook (`TOO_MANY_ROWS`).

- [ ] **Step 12: Chạy toàn bộ test module + auth**

Chạy: `cd server && node --test "businessReport/*.test.js" "auth/*.test.js"`
Kỳ vọng: PASS.

- [ ] **Step 13: Commit**

```bash
git add server/businessReport server/routes.js server/auth/featureRegistry.js server/auth/*.test.js
git commit -m "feat(business-report): API bao cao kinh doanh, quyen va xuat Excel/HTML"
```

---

### Task 5: Frontend — tab "Báo cáo kinh doanh"

**Files:**
- Modify: `server/public/shared/shared-nav.js` (`reportItems`, khoảng dòng 1361)
- Modify: `server/public/index.html`:
  - sub-nav (~3235–3256);
  - section mới sau `view-debt`;
  - `REPORT_VIEW_NAMES` (~8539);
  - `switchView` (~6146);
  - `DOC_DETAIL_KINDS` (~7226);
  - `renderDocumentDetail` (~7306);
  - `initDocumentDetail` (~7388);
  - `TABLE_EXPLORER_CONFIGS` (~6832).
- Test: `server/test/frontend/business-report.test.js`; cập nhật các test liệt kê tab báo cáo (`grep -ln "'debt'" test/frontend/*.test.js`, ví dụ `branch-switcher.test.js`, `overview-section-permissions.test.js`) và `fixed-table-widths.test.js` (mọi `<th>` trong `.fixed-table` cần `style="width:…"`)

**Interfaces:**
- Consumes: API Task 4 (đúng các trường `rows`, `kpis`, `months`, `monthLabels`, `currentMonth`, `today`, `day`; detail `summary`, `chart`, `customers`/`topProducts`/`topCustomers`).
- Produces (hàm cấp cao nhất, test chạm được qua `window`):
  - `loadBusinessReport(force)`, `renderBusinessReport()`
  - `businessGrowthHtml(growth)`
  - `businessFilteredCustomers()`
  - `exportBusiness(kind, format)`
  - `refreezeBusinessMonth()`

- [ ] **Step 1: Viết test JSDOM lỗi**

Tạo `server/test/frontend/business-report.test.js` theo khuôn `product-report-detail.test.js` (JSDOM, Chart giả, `TKSNav.can` có thể cấu hình, `fetch` giả). Payload giả lấy từ service thật để khớp hợp đồng:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const svc = require('../../businessReport/businessReportService');
const { serviceSnapshot } = require('../../businessReport/testFixtures');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };

function createPage({ can = () => true } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://tokosi.example/reports/#business' });
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({});
  const charts = [];
  dom.window.Chart = class { static defaults = { font: {}, animation: {}, plugins: { tooltip: {} } }; constructor(c, cfg) { this.config = cfg; charts.push(this); } destroy() {} };
  dom.window.setInterval = () => 1;
  dom.window.requestAnimationFrame = cb => cb();
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  dom.window.TKSNav = { authGuard: () => new Promise(() => {}), can, handleBranchError: () => false, renderTopSidebar() {} };
  const urls = [];
  const snap = serviceSnapshot();
  dom.window.fetch = (url, opts) => {
    const href = String(url); urls.push({ href, opts });
    const ok = body => Promise.resolve({ ok: true, status: 200, json: async () => body });
    if (href === '/api/business-report/sales') return ok(svc.buildSaleReport(snap));
    if (href === '/api/business-report/customers') return ok(svc.buildCustomerReport(snap));
    if (href === '/api/business-report/products') return ok(svc.buildProductReport(snap));
    if (href.startsWith('/api/business-report/detail?kind=sale')) return ok(svc.buildDetail('sale', 'Khang', snap, {}));
    return ok({});
  };
  for (const script of dom.window.document.querySelectorAll('script:not([src])')) dom.window.eval(script.textContent);
  return { dom, urls, charts };
}
```

Nếu `product-report-detail.test.js` khởi chạy script theo cách khác (ví dụ chỉ eval script cuối), chép ĐÚNG cách của nó.

Các test cần có:
1. Nút sub-nav `[data-view="business"]` tồn tại, nhãn "Báo cáo kinh doanh". `#view-business` có 3 section với tiêu đề "Tăng trưởng Sale", "Tăng trưởng khách hàng", "Tăng trưởng mã hàng".
2. Gọi `dom.window.switchView('business')` rồi `settle()`:
   - fetch đúng 3 URL `/api/business-report/{sales,customers,products}`;
   - KHÔNG gọi `/api/dashboard?view=business`.
3. Bảng Sale:
   - header = `Sale | SL Khách | TB 4 tháng | Tăng trưởng | 06/10/2026 | T9/26 | T8/26 | T7/26 | …` (tháng giảm dần tới T3/26);
   - dòng "Khang" có tăng trưởng `100%`;
   - dòng "Chưa phân nhóm" có "—".
4. KPI `#businessSalesKpis` có thẻ "Doanh số tháng này (đến 06/10)".
5. Bảng khách:
   - mặc định ẩn khách không hoạt động (KH9 không có);
   - tick `#businessCustomersInactive` thì KH9 xuất hiện;
   - chọn `#businessCustomersSale` = "Khang" thì chỉ còn khách của Khang;
   - cột Level giá hiện "Level 2".
6. Bấm dòng "Khang" thì mở `#docModalBackdrop`:
   - tiêu đề chứa "Khang";
   - có `.business-summary` với thẻ "TB 4 tháng";
   - Chart được tạo với `config.type === 'bar'`;
   - có bảng khách.
7. `TKSNav.can = k => k !== 'reports.business.refreeze'` thì nút `#businessRefreezeBtn` bị ẩn. `can = k => k !== 'reports.export'` thì các nút xuất bị ẩn.

- [ ] **Step 2: Chạy, xác nhận FAIL**

Chạy: `cd server && node --test test/frontend/business-report.test.js`

- [ ] **Step 3: Sidebar + sub-nav + đăng ký view**
  - `shared-nav.js` `reportItems`: thêm sau `reports.debt`:
    `{ feature: 'reports.business', view: 'business', label: 'Báo cáo kinh doanh', icon: '<path d="M3 3v18h18"></path><path d="m19 9-5 5-4-4-3 3"></path>' }`
  - `index.html`: thêm nút sub-nav cùng mẫu với nút `debt`:
    `data-view="business"`, `onclick="goReportView('business')"`, cùng SVG như trên, nhãn "Báo cáo kinh doanh".
  - `REPORT_VIEW_NAMES` thêm `'business'`.
  - `switchView(view)`: ngay sau `hideDashboardLoadError();`, chèn:
    ```js
      // Bao cao kinh doanh co API rieng (/api/business-report), khong di qua /api/dashboard.
      if (view === 'business') { loadBusinessReport(false); return; }
    ```
    Đồng thời bọc `if (viewIsLoaded(view)) {…renderView…}` để bỏ qua với `business` (`viewIsLoaded` dựa trên `state.viewMeta`).
  - Tìm mọi chỗ khác gọi `ensureViewData(state.view)` / `loadData(..., view)` cho view hiện tại (lúc khởi động, hashchange, SSE `dashboard-live-updates`): `grep -n "ensureViewData(\|loadData(" public/index.html`. Thêm điều kiện bỏ qua `'business'`, để không gọi `/api/dashboard?view=business` (server sẽ trả 400).

- [ ] **Step 4: Markup `#view-business`** (đặt ngay sau `</div>` đóng `view-debt`; dùng đúng class của mục "Báo cáo hàng hóa")

```html
        <!-- ============ BÁO CÁO KINH DOANH ============ -->
        <div class="view" id="view-business">
          <div class="view-title">Báo cáo kinh doanh</div>
          <div class="view-sub">Doanh số = hóa đơn hoàn thành − trả hàng (đã trừ giảm giá) · gộp Hà Nội + Sài Gòn · tháng trước chốt cứng, tháng này cập nhật trực tiếp · tăng trưởng = tháng này quy đổi 30 ngày ÷ tháng trước <span class="section-note" id="businessUpdatedAt">—</span>
            <button class="export-button" type="button" id="businessRefreezeBtn" hidden onclick="refreezeBusinessMonth()">Tính lại tháng</button>
          </div>

          <section class="section">
            <div class="section-head"><span class="section-step">1</span><h2>Tăng trưởng Sale</h2></div>
            <div class="kpi-grid section-kpis" id="businessSalesKpis"></div>
            <div class="grid"><div class="panel col-12">
              <div class="panel-head">
                <h2>Doanh số theo sale <span class="tag" id="tagBusinessSales">—</span></h2>
                <div class="panel-head-actions business-export" data-kind="sales">
                  <button class="export-button" type="button" onclick="exportBusiness('sales','xlsx')">Xuất Excel</button>
                  <button class="export-button" type="button" onclick="exportBusiness('sales','html')">Xuất HTML</button>
                </div>
              </div>
              <div class="scroll-list" style="max-height:600px;"><table class="fixed-table">
                <thead id="businessSalesHead"></thead>
                <tbody id="businessSalesRows"><tr><td class="table-note">Đang tải...</td></tr></tbody>
              </table></div>
              <div class="pagination-controls" id="businessSalesPagination" hidden>
                <button type="button" id="businessSalesFirstPage" aria-label="Trang đầu" title="Trang đầu">&lt;&lt;</button>
                <button type="button" id="businessSalesPrevPage" aria-label="Trang trước" title="Trang trước">&lt;</button>
                <span id="businessSalesPageLabel">Trang 1/1</span>
                <button type="button" id="businessSalesNextPage" aria-label="Trang sau" title="Trang sau">&gt;</button>
                <button type="button" id="businessSalesLastPage" aria-label="Trang cuối" title="Trang cuối">&gt;&gt;</button>
              </div>
            </div></div>
          </section>
          <!-- Mục 2 "Tăng trưởng khách hàng" (tiền tố id businessCustomers…) và mục 3 "Tăng trưởng mã hàng"
               (tiền tố businessProducts…) lặp đúng khối trên. Mục 2 thêm hàng lọc trong panel-head-actions:
               <select id="businessCustomersSale"><option value="">Tất cả sale</option></select>
               <select id="businessCustomersBranch"><option value="">Cả hai cơ sở</option><option value="hanoi">Hà Nội</option><option value="saigon">Sài Gòn</option></select>
               <label><input type="checkbox" id="businessCustomersInactive"> Hiện cả khách không hoạt động</label> -->
        </div>
```

Phải viết ra đầy đủ markup của mục 2 và 3 trong file thật (comment trên chỉ để bản kế hoạch gọn; không để comment đó trong code). Mỗi `<th>` sinh ra trong `<thead>` động phải có `style="width:…px"` (test `fixed-table-widths`).

- [ ] **Step 5: JS render + tải** (đặt ngay sau khối "Báo cáo hàng hóa", khoảng dòng 7210)

```js
    // ===== Báo cáo kinh doanh (tab #business) — API riêng /api/business-report (xem
    // server/businessReport/). Tháng trước chốt cứng trong DB, tháng này tính trực tiếp (cache 60s
    // phía máy chủ) nên tab tự tải lại khi mở nếu dữ liệu đã cũ hơn 60s. =====
    const BUSINESS_KINDS = ['sales', 'customers', 'products'];
    const BUSINESS_TABLE_KEYS = { sales: 'businessSales', customers: 'businessCustomers', products: 'businessProducts' };
    state.business = { data: {}, loadedAt: 0, loading: false };
    TABLE_EXPLORER_CONFIGS.businessSales = { title: 'Tăng trưởng Sale', searchText: tableSearchText, identity: r => r.key };
    TABLE_EXPLORER_CONFIGS.businessCustomers = { title: 'Tăng trưởng khách hàng', searchText: tableSearchText, identity: r => r.key };
    TABLE_EXPLORER_CONFIGS.businessProducts = { title: 'Tăng trưởng mã hàng', searchText: tableSearchText, code: r => r.code, identity: r => r.key, supportsCodes: true };

    function businessGrowthHtml(growth) {
      if (growth === null || growth === undefined) return '<span class="muted">—</span>';
      const cls = growth >= 100 ? 'text-green' : 'text-red';
      return '<span class="' + cls + '">' + Math.round(growth) + '%</span>';
    }

    // Cột: [cố định...] TB 4 tháng | Tăng trưởng | dd/mm/yyyy (tháng này) | T(n-1) … T3 (giảm dần).
    function businessMonthColumns(data) {
      return data.months.filter(m => m !== data.currentMonth).slice().reverse();
    }

    function businessHeadHtml(kind, data) {
      const fixed = {
        sales: [['Sale', 180], ['SL Khách', 95]],
        customers: [['Mã KH', 110], ['Tên khách', 240], ['Cơ sở', 70], ['Sale', 140], ['Level giá', 160]],
        products: [['Mã hàng', 140], ['Tên hàng', 280]]
      }[kind];
      const today = data.today.split('-').reverse().join('/');
      const cols = fixed.concat([['TB 4 tháng', 140], ['Tăng trưởng', 105], [today, 140]])
        .concat(businessMonthColumns(data).map(m => [data.monthLabels[data.months.indexOf(m)], 135]));
      return '<tr>' + cols.map(c => '<th style="width:' + c[1] + 'px">' + escapeHtml(c[0]) + '</th>').join('') + '</tr>';
    }

    function businessRowHtml(kind, data) {
      const months = businessMonthColumns(data);
      return function (r) {
        const money = v => '<td class="mono" data-sort-value="' + (Number(v) || 0) + '">' + fmtMoney(v || 0) + '</td>';
        const fixed = kind === 'sales'
          ? '<td class="name-cell">' + escapeHtml(r.saleName) + '</td><td class="mono" data-sort-value="' + r.activeCustomers + '">' + fmtNumber(r.activeCustomers) + '</td>'
          : kind === 'customers'
            ? '<td class="mono muted">' + escapeHtml(r.code || '—') + '</td><td class="name-cell">' + escapeHtml(r.name) + '</td>' +
              '<td>' + (r.branch === 'hanoi' ? 'HN' : 'SG') + '</td><td>' + escapeHtml(r.saleName) + '</td><td>' + escapeHtml(r.priceLevel || '') + '</td>'
            : '<td class="mono muted">' + escapeHtml(r.code) + '</td><td class="name-cell">' + escapeHtml(r.name) + '</td>';
        return '<tr class="doc-row" tabindex="0" title="Bấm để xem chi tiết" data-table-item-id="' + escapeHtml(r.key) + '">' + fixed +
          money(r.avg4) +
          '<td class="mono" data-sort-value="' + (r.growth === null ? -1 : r.growth) + '">' + businessGrowthHtml(r.growth) + '</td>' +
          money(r.current) + months.map(m => money(r.series[m])).join('') + '</tr>';
      };
    }

    function businessFilteredCustomers() {
      const data = state.business.data.customers;
      if (!data) return [];
      const sale = document.getElementById('businessCustomersSale').value;
      const branch = document.getElementById('businessCustomersBranch').value;
      const inactive = document.getElementById('businessCustomersInactive').checked;
      return data.rows.filter(r => (inactive || r.active) && (!sale || r.saleName === sale) && (!branch || r.branch === branch));
    }

    function businessKpiCards(kpis) {
      const accents = ['green', 'blue', 'amber', 'purple', 'green', 'blue', 'amber'];
      return kpis.map((k, i) => ({
        label: k.label, accent: accents[i % accents.length],
        value: k.type === 'percent' ? (k.value === null ? '—' : Math.round(k.value) + '%') : k.type === 'number' ? fmtNumber(k.value) : fmtMoney(k.value)
      }));
    }

    function renderBusinessReport() {
      BUSINESS_KINDS.forEach(function (kind) {
        const data = state.business.data[kind];
        const prefix = BUSINESS_TABLE_KEYS[kind];
        if (!data) return;
        document.getElementById(prefix + 'Head').innerHTML = businessHeadHtml(kind, data);
        const rows = kind === 'customers' ? businessFilteredCustomers() : data.rows;
        document.getElementById('tag' + prefix[0].toUpperCase() + prefix.slice(1)).textContent = String(rows.length);
        renderSectionKpis(prefix + 'Kpis', businessKpiCards(data.kpis));
        renderPaginatedRows(prefix, {
          tbody: prefix + 'Rows', pagination: prefix + 'Pagination', firstBtn: prefix + 'FirstPage', prevBtn: prefix + 'PrevPage',
          nextBtn: prefix + 'NextPage', lastBtn: prefix + 'LastPage', label: prefix + 'PageLabel'
        }, rows, businessRowHtml(kind, data), 20, 'Chưa có dữ liệu.');
      });
      const sales = state.business.data.sales;
      if (sales) {
        const select = document.getElementById('businessCustomersSale');
        const current = select.value;
        select.innerHTML = '<option value="">Tất cả sale</option>' + sales.rows.map(r =>
          '<option value="' + escapeHtml(r.saleName) + '">' + escapeHtml(r.saleName) + '</option>').join('');
        select.value = current;
        document.getElementById('businessUpdatedAt').textContent = formatProductReportUpdatedAt(sales.computedAt);
      }
      const can = k => typeof TKSNav !== 'undefined' && TKSNav.can(k);
      document.getElementById('businessRefreezeBtn').hidden = !can('reports.business.refreeze');
      document.querySelectorAll('.business-export').forEach(el => { el.hidden = !can('reports.export'); });
    }

    function loadBusinessReport(force) {
      if (state.business.loading) return;
      if (!force && Date.now() - state.business.loadedAt < 60000 && state.business.data.sales) { renderBusinessReport(); return; }
      state.business.loading = true;
      Promise.all(BUSINESS_KINDS.map(function (kind) {
        return fetch('/api/business-report/' + kind).then(function (res) {
          return res.json().catch(() => ({})).then(function (body) {
            if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
            state.business.data[kind] = body;
          });
        });
      })).then(function () {
        state.business.loadedAt = Date.now();
        renderBusinessReport();
      }).catch(function (err) {
        console.error('Không tải được báo cáo kinh doanh:', err);
        BUSINESS_KINDS.forEach(kind => {
          document.getElementById(BUSINESS_TABLE_KEYS[kind] + 'Rows').innerHTML =
            '<tr><td class="table-note">' + escapeHtml(err.message || 'Không tải được báo cáo kinh doanh.') + '</td></tr>';
        });
      }).finally(function () { state.business.loading = false; });
    }

    function exportBusiness(kind, format) {
      const params = new URLSearchParams({ kind: kind, format: format });
      const search = getTableSearchState(BUSINESS_TABLE_KEYS[kind]);
      if (search && search.query) params.set('q', search.query);
      if (kind === 'customers') {
        const sale = document.getElementById('businessCustomersSale').value;
        const branch = document.getElementById('businessCustomersBranch').value;
        if (sale) params.set('sale', sale);
        if (branch) params.set('branch', branch);
        if (document.getElementById('businessCustomersInactive').checked) params.set('inactive', '1');
      }
      window.location.href = '/api/business-report/export?' + params.toString();
    }

    function refreezeBusinessMonth() {
      const month = window.prompt('Tính lại tháng đã chốt (định dạng YYYY-MM, ví dụ 2026-09):');
      if (!month) return;
      fetch('/api/business-report/refreeze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month: month.trim() }) })
        .then(res => res.json().then(body => { if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status); return body; }))
        .then(() => { window.alert('Đã tính lại tháng ' + month + '.'); loadBusinessReport(true); })
        .catch(err => window.alert('Không tính lại được: ' + err.message));
    }

    ['businessCustomersSale', 'businessCustomersBranch', 'businessCustomersInactive'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', function () {
        state.tablePages.businessCustomers = 1;
        renderBusinessReport();
      });
    });
```

Trước khi dán, kiểm tra tên thật của các helper:
- `getTableSearchState(tableKey)` trả gì (trường `query`?). Đọc hàm này; nếu trường có tên khác thì dùng đúng tên.
- `fmtMoney`, `fmtNumber`, `escapeHtml`, `tableSearchText`, `renderSectionKpis(id, cards)` (thẻ có `label/value/accent`, xem cách `renderProductReport` dùng).
- Class màu xanh/đỏ có sẵn: `grep -n "text-green\|\.up\b\|\.down\b\|delta-up" public/index.html`. Dùng class đang có, không tạo màu mới.
- Nếu `renderPaginatedRows` dùng tham số thứ 5 là `emptyColspan` thì truyền số cột thật (`businessMonthColumns(data).length + số cột cố định + 3`), không truyền `20`.

- [ ] **Step 6: Panel chi tiết**
  - `DOC_DETAIL_KINDS` thêm:

```js
      businessSales: { api: '/api/business-report/detail', title: 'Sale', wide: true,
        query: item => '?kind=sale&key=' + encodeURIComponent(item.key), failure: 'Không tải được chi tiết sale.' },
      businessCustomers: { api: '/api/business-report/detail', title: 'Khách hàng', wide: true,
        query: item => '?kind=customer&key=' + encodeURIComponent(item.key), failure: 'Không tải được chi tiết khách hàng.' },
      businessProducts: { api: '/api/business-report/detail', title: 'Mã hàng', wide: true,
        query: item => '?kind=product&key=' + encodeURIComponent(item.key), failure: 'Không tải được chi tiết mã hàng.' },
```

  - `initDocumentDetail`: thêm 3 cặp `['businessSalesRows','businessSales']`, `['businessCustomersRows','businessCustomers']`, `['businessProductsRows','businessProducts']` vào mảng.
  - `renderDocumentDetail`:
    - thêm `const isBusiness = docDetail.tableKey.indexOf('business') === 0;`
    - gọi `destroyChart('businessDetailTrend')` cùng chỗ với `destroyChart('productDetailCustomers')`;
    - tiêu đề khi `isBusiness`: `kind.title + ' · ' + (docDetail.item.saleName || docDetail.item.name || docDetail.item.code)`;
    - nhánh `if (status === 'ready' && isBusiness) renderBusinessDetailModal(body, subtitle, data);` đặt trước nhánh `isProduct`.
  - Thêm hàm:

```js
    // Panel chi tiết Báo cáo kinh doanh: thẻ tổng quan + biểu đồ cột doanh số theo tháng (cột tháng
    // này là số đến hôm nay, chưa quy đổi) + bảng phụ (khách của sale / top mã của khách / top khách của mã).
    function renderBusinessDetailModal(body, subtitle, data) {
      subtitle.textContent = data.subtitle || '';
      const card = s => '<div class="kpi"><div class="kpi-label">' + escapeHtml(s.label) + '</div><div class="kpi-value">' +
        (s.type === 'percent' ? (s.value === null ? '—' : Math.round(s.value) + '%') : s.type === 'number' ? fmtNumber(s.value) : fmtMoney(s.value)) + '</div></div>';
      let table = '';
      if (data.kind === 'sale') {
        table = '<h3 class="doc-lines-title"><span>Khách của sale</span><span class="muted">' + fmtNumber(data.customers.length) + ' khách</span></h3>' +
          '<div class="scroll-list" style="max-height:320px"><table><thead><tr><th>Khách hàng</th><th>Cơ sở</th><th>TB 4 tháng</th><th>Tăng trưởng</th><th>Tháng này</th></tr></thead><tbody>' +
          data.customers.map(c => '<tr class="doc-row business-detail-customer" data-key="' + escapeHtml(c.key) + '"><td class="name-cell">' + escapeHtml(c.name) + '</td><td>' + (c.branch === 'hanoi' ? 'HN' : 'SG') +
            '</td><td class="mono">' + fmtMoney(c.avg4) + '</td><td class="mono">' + businessGrowthHtml(c.growth) + '</td><td class="mono">' + fmtMoney(c.current) + '</td></tr>').join('') +
          '</tbody></table></div>';
      } else {
        const list = data.kind === 'customer' ? data.topProducts : data.topCustomers;
        const label = data.kind === 'customer' ? 'Top mã hàng 4 tháng' : 'Top khách 4 tháng';
        table = '<h3 class="doc-lines-title"><span>' + label + '</span></h3><div class="scroll-list" style="max-height:320px"><table><thead><tr><th>' +
          (data.kind === 'customer' ? 'Mã hàng</th><th>Tên hàng' : 'Khách hàng</th><th>Cơ sở') + '</th><th>Doanh số</th><th>SL</th></tr></thead><tbody>' +
          (list.length ? list.map(r => '<tr><td>' + escapeHtml(data.kind === 'customer' ? r.productCode : r.customerName) + '</td><td>' +
            escapeHtml(data.kind === 'customer' ? r.productName : (r.branch === 'hanoi' ? 'HN' : 'SG')) + '</td><td class="mono">' + fmtMoney(r.revenue) +
            '</td><td class="mono">' + fmtNumber(r.qty) + '</td></tr>').join('') : '<tr><td colspan="4" class="table-note">Không có dữ liệu.</td></tr>') +
          '</tbody></table></div>';
      }
      body.innerHTML = '<div class="kpi-grid business-summary">' + data.summary.map(card).join('') + '</div>' +
        '<div class="chart-box wide"><canvas id="businessDetailChart" role="img" aria-label="Biểu đồ cột doanh số theo tháng"></canvas></div>' + table;
      renderBarChartList('businessDetailChart', 'businessDetailTrend', data.chart, c => c.label + (c.partial ? '*' : ''), c => c.value, null, true, null, null, 0);
      body.querySelectorAll('.business-detail-customer').forEach(function (row) {
        row.addEventListener('click', function () {
          const item = (state.business.data.customers.rows || []).find(c => c.key === row.dataset.key);
          if (item) openDocumentDetail('businessCustomers', item, row);
        });
      });
    }
```

  - Đọc `renderBarChartList` (khoảng dòng 6483) để xác nhận: `vertical=true` có nghĩa là cột đứng; `labelRotation=0` được phép (nếu `0` bị `||` đổi thành 60 thì truyền `1`). Đọc lớp CSS `.kpi`/`.kpi-label`/`.kpi-value` thật mà `renderSectionKpis` sinh ra, rồi dùng lại đúng các lớp đó.

- [ ] **Step 7: Chạy test frontend mới + các test frontend liên quan**

Chạy: `cd server && node --test test/frontend/business-report.test.js test/frontend/branch-switcher.test.js test/frontend/fixed-table-widths.test.js test/frontend/document-detail-panel.test.js test/frontend/product-report-detail.test.js test/frontend/overview-section-permissions.test.js test/frontend/pagination.test.js test/frontend/dashboard-per-view-loading.test.js`
Kỳ vọng: tất cả PASS. Sửa test cũ chỉ ở chỗ liệt kê đầy đủ các tab/sub-nav (thêm `business`).

- [ ] **Step 8: Kiểm tra giao diện thật (không đăng nhập)**

Làm theo memory `reference-tokosi-view-pages-without-login`:
- Harness trong scratchpad mount `createBusinessReportRouter()` thật (đọc DB thật, chỉ SELECT; tháng chưa chốt sẽ tính live), cùng `/api/auth/me` và static `public`.
- Khai báo tạm trong `.claude/launch.json` với `--use-system-ca`, rồi `preview_start`.
- Mở `/reports/#business` ở 1500x900 và mobile. Chụp: 3 bảng, bộ lọc khách, panel Sale (biểu đồ cột), panel Khách, panel Mã hàng, file HTML xuất.
- KHÔNG bấm "Tính lại tháng" (sẽ GHI vào DB production).
- Xong thì `preview_stop`, xóa entry khỏi `launch.json`.

- [ ] **Step 9: Commit**

```bash
git add server/public/index.html server/public/shared/shared-nav.js server/test/frontend
git commit -m "feat(business-report): tab Bao cao kinh doanh (Sale/Khach/Ma hang, panel chi tiet)"
```

---

### Task 6: Đối chiếu trên DB thật + toàn bộ test + tài liệu

**Files:**
- Create (scratchpad, KHÔNG commit): script đối chiếu `reconcile-business.js`
- Modify: `server/README.md` (mục job nền và các API), `docs/02-srs` (thêm Báo cáo kinh doanh vào mục báo cáo), cùng các file tài liệu nhắc tới danh sách tab báo cáo (`grep -rln "Công nợ" docs/02-srs docs/01-brd README.md | head`)

- [ ] **Step 1: Script đối chiếu (chỉ đọc + ROLLBACK)**

Script dùng `getPool()` của `server/db/pool.js` (đường dẫn tuyệt đối). Mở 1 client:
1. Chạy `BEGIN`.
2. Áp nội dung file migration 0036 (bảng chỉ tồn tại trong giao dịch).
3. Gọi lần lượt `FREEZE_CUSTOMER_SQL`, `FREEZE_CUSTOMER_PRODUCT_SQL`, `FREEZE_PRODUCT_SQL` cho 2026-09 và 2026-08, rồi `REBUILD_SALE_SQL`.
4. In ra:
   - (a) Σ `net_revenue` của bảng khách, bảng mã, bảng sale cho từng tháng;
   - (b) độ lệch khách − mã;
   - (c) doanh thu ròng tháng của rollup hiện có: `SELECT SUM(revenue) …` theo `dashboardRollupRepository.getInvoiceRevenueByDay` (đọc hàm này để viết lại phép tính tương đương bằng SQL, gồm cả phần trừ `RETURN_AMOUNT_SQL`);
   - (d) top 5 sale tháng 9 (đối chiếu ảnh mẫu: Khang T9 ≈ 5.443.819.645, Trinh T9 ≈ 7.891.382.769);
   - (e) thời gian chạy từng câu.
5. Chạy `ROLLBACK` trong `finally`.

Chạy: `cd server && node "<scratchpad>/reconcile-business.js"`

Kỳ vọng:
- Σ khách = Σ sale (khớp tuyệt đối).
- |Σ khách − Σ mã| nhỏ (chỉ do làm tròn hoặc chứng từ có tổng dòng = 0). Nếu lệch > 0,1% thì liệt kê 10 chứng từ gây lệch và báo người dùng, không tự đổi công thức.
- (c) chênh với (a) phải giải thích được: rollup dùng `returns.total` và `invoices.total` giống ta. Nếu khác vì 'Đang xử lý' / giảm giá thì ghi rõ trong báo cáo.
- Số sale gần với ảnh mẫu. Lệch nhiều thì báo người dùng (có thể do khác cách gán sale).

- [ ] **Step 2: Đo hiệu năng live**

Trong cùng script, đo `CUSTOMER_MONTH_SELECT_SQL` + `CUSTOMER_PRODUCT_MONTH_SELECT_SQL` cho tháng 2026-10 (live). Nếu > 3 giây thì chạy `EXPLAIN (ANALYZE, BUFFERS)` và báo người dùng kèm đề xuất index. KHÔNG tự tạo index trên DB thật.

- [ ] **Step 3: Chạy toàn bộ test suite**

Chạy (nền): `cd server && npm test`
Kỳ vọng: 0 fail (trước thay đổi là 1701 pass / 3 skip; số mới phải bằng số cũ cộng số test mới).

- [ ] **Step 4: Cập nhật tài liệu**

- `server/README.md`:
  - job `businessMonthlyRefresh` (khi nào chạy, chạy tay `node kiotvietSync/businessMonthlyRefresh.js [YYYY-MM]`);
  - API `/api/business-report/*`.
- SRS: mục "Báo cáo kinh doanh" (định nghĩa doanh số, quy đổi 30 ngày, TB 4 tháng, khách hoạt động, Chưa phân nhóm, chốt tháng).

- [ ] **Step 5: Commit**

```bash
git add server/README.md docs
git commit -m "docs(business-report): huong dan van hanh bao cao kinh doanh"
```

- [ ] **Step 6: Báo cáo cho người dùng**
  - Kết quả đối chiếu (số liệu Step 1–2) và kết quả test.
  - Các việc sau deploy:
    1. Áp migration 0036 (`npm run db:migrate` ở máy có DB production).
    2. Deploy. Lần khởi động đầu tiên job tự backfill T3–T9 (có thể chạy tay `node kiotvietSync/businessMonthlyRefresh.js`).
    3. Kiểm tra `SELECT * FROM business_monthly_state ORDER BY month`.

## Tự rà soát (đã làm khi viết kế hoạch)

- **Đối chiếu spec:**
  - Chốt tháng / nút tính lại: Task 3 và 4.
  - Live + cache: Task 4.
  - 3 bảng + cột: Task 4 và 5.
  - KPI đầu mục: Task 4 (`kpis`) và Task 5.
  - Panel 3 loại + biểu đồ cột: Task 4 và 5.
  - Lọc khách: Task 5 (frontend) và Task 4 (`filterRows` khi xuất).
  - Xuất Excel/HTML: Task 4 và 5.
  - Quyền: Task 4 và 5.
  - "Chưa phân nhóm": Task 3 (bảng sale) và Task 4 (service).
  - Đối chiếu: Task 6.
- **Khác spec (cố ý):**
  - Hàm tính tăng trưởng chỉ chạy ở server; API trả sẵn `growth/avg4/active`, frontend không tính lại.
  - Panel tái dùng `#docModalBackdrop`. Xuất file dùng endpoint riêng (theo khuôn Sổ quỹ) thay vì hộp chọn cột `/api/export`, vì bảng có cột tháng động.
- **Tên dùng xuyên task:**
  - `freezeMonth`, `rebuildSaleTable`, `createRepository().snapshot/customerProducts/productCustomers/refreeze`
  - `buildSaleReport/buildCustomerReport/buildProductReport/buildDetail/last4Months`
  - `createBusinessReportRouter`, `createExportFile/filterRows`
  - `testFixtures.seed/serviceSnapshot`
