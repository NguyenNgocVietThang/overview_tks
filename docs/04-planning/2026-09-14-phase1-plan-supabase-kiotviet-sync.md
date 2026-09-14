# Kế hoạch chi tiết: Giai đoạn 1 — Thiết kế & tạo schema dữ liệu
### (từ Roadmap: Đưa dữ liệu KiotViet lên Supabase Postgres, cận thời gian thực, 2 cơ sở)

## Context

`docs/04-planning/2026-09-14-roadmap-supabase-kiotviet-sync.md` (mục 5, Giai đoạn 1) đã chốt
phạm vi: thiết kế bảng cho từng loại dữ liệu KiotViet (nhóm hàng, sản phẩm, khách hàng, nhà cung
cấp, hóa đơn, đơn hàng, trả hàng, nhập hàng, thu chi, nhân viên) + 1 bảng checkpoint theo dõi tiến
độ đồng bộ, viết migration SQL thủ công (không ORM), và 2 nguyên tắc bắt buộc: khóa chính là cặp
**(cơ sở, id)** thay vì id đơn lẻ, và cột tiền dùng số thập phân chính xác.

`docs/04-planning/2026-09-14-phase0-plan-supabase-kiotviet-sync.md` (Task 1-4) đã hoàn tất trong
code: `server/config.js` có `SUPABASE_DB_URL`/`PGSSL`/`KIOTVIET_SYNC_ENABLED` (fail-soft, mặc định
tắt), `server/kiotviet/kiotvietWebhookRoutes.js` là stub webhook đã mount. Giai đoạn 1 **chưa bật
engine đồng bộ** (đó là Giai đoạn 2) — chỉ tạo schema rỗng trên Supabase, không ảnh hưởng Dashboard
Sheets hiện tại.

`server/kiotviet/API_ENDPOINTS.md` là tài liệu nguồn bắt buộc (theo quy ước
`source-driven-development` đã áp dụng trong dự án) cho tên entity, tham số incremental
(`lastModifiedFrom` / `startDate`+`endDate` cho cash_flows), và các lưu ý về `orders`/`returns`
không có tham số chặn trên. Giai đoạn 1 không cần gọi API thật — chỉ cần danh sách entity và biết
loại dữ liệu mỗi entity mang theo (invoices có `InvoiceDetails[]`/payment lồng bên trong, v.v.) để
thiết kế bảng con.

## Nguyên tắc thiết kế đã chốt

- **Khóa chính mọi bảng nghiệp vụ là `(branch, id)`** — `branch` là cột `TEXT` mới, giá trị cố định
  `'hanoi'` / `'saigon'`, **không dùng lại** `BRANCHES.HANOI = 'Hà Nội'` (enum tiếng Việt hiện có ở
  `server/branch/branches.js`, dùng cho Dashboard Sheets) và **không dùng lại** giá trị
  `KIOTVIET_RETAILER` (ví dụ `CHhanoi`, dùng để gọi API). Đây là 1 định danh nội bộ riêng của lớp
  Postgres, tách biệt khỏi 2 hệ thống định danh cũ để tránh Giai đoạn 2 vô tình trộn lẫn 3 khái niệm
  "cơ sở nào" khác nhau. Việc map `KIOTVIET_RETAILER` ↔ `branch` (`'hanoi'`/`'saigon'`) sẽ làm ở
  Giai đoạn 2 khi viết entity sync module (mỗi module biết nó đang chạy cho branch nào từ config).
- **Cột tiền dùng `NUMERIC(18,2)`** (hoặc `NUMERIC(18,3)` cho số lượng hàng hóa có thể có phần thập
  phân như cân/kg) — không dùng `FLOAT`/`DOUBLE PRECISION`.
- **Mỗi bảng nghiệp vụ có cột `raw JSONB NOT NULL`** lưu nguyên văn object KiotViet trả về cho bản
  ghi đó. Đây là quyết định mới so với roadmap gốc (bổ sung ở bước lập kế hoạch chi tiết này), lý do:
  KiotViet Public API không có tài liệu OpenAPI chính thức, `API_ENDPOINTS.md` mới xác minh tham số
  query chứ chưa xác minh đầy đủ từng field response. Cột `raw` đảm bảo **không mất dữ liệu** ngay
  cả khi 1 cột "first-class" bị đặt sai tên/kiểu — sửa lại cột sau này chỉ là `ALTER TABLE` +
  backfill từ `raw`, không cần gọi lại API. Các cột "first-class" (id, code, tên, số tiền, ngày
  tháng, khóa ngoại) được chọn vì đó là các cột Giai đoạn 5 (Dashboard) chắc chắn cần join/lọc/sắp
  xếp trực tiếp bằng SQL.
- **Không suy diễn nhãn cho `status`** (hóa đơn/đơn hàng) — giữ nguyên `SMALLINT` thô, đúng như
  `API_ENDPOINTS.md` mục "Đã xác minh" đã ghi (2 nguồn tài liệu cũ mâu thuẫn nhau về ý nghĩa mã số).
- **Dòng chi tiết (line items) không có id riêng ổn định từ KiotViet** — dùng `line_no` (vị trí
  trong mảng trả về, đánh số từ 0) làm 1 phần khóa chính phụ: `(branch, <parent>_id, line_no)`.
  Nếu Giai đoạn 2 phát hiện response thực tế có id dòng ổn định (ví dụ `InvoiceDetails[].id`), có
  thể đổi sang dùng id đó — ghi chú này vào `SCHEMA.md` (Task 10) để không bị quên.
- **Không dùng ORM/migration framework** (Prisma, Knex, TypeORM...) — chỉ file `.sql` thuần + 1
  runner nhỏ tự viết, đúng quyết định đã chốt trong roadmap (giữ nhất quán với phong cách hiện có
  của dự án: không có ORM ở bất kỳ đâu trong `server/`).
- **`staff` chỉ có id + tên nếu bắt gặp được, không có endpoint riêng** — bảng này Giai đoạn 1 chỉ
  tạo cấu trúc tối thiểu; việc "suy luận nhân viên từ `SoldById`/`CreatedById`..." là logic của
  Giai đoạn 2 (`staffSync.js` sẽ upsert vào bảng này), Giai đoạn 1 không viết logic, chỉ tạo bảng.

## Task List

### Task 1: Thêm dependency `pg` + `server/db/pool.js` (connection pool)

**Description:** Thêm `pg` vào `server/package.json`. Viết `server/db/pool.js` export 1 hàm
`getPool()` tạo (lazy, singleton) `pg.Pool` từ `CONFIG.SUPABASE_DB_URL`/`CONFIG.PGSSL`, pool nhỏ
(`max: 5`, đúng giới hạn Supabase free đã nêu ở roadmap mục 7). **Không** được throw khi module
được `require()` nếu thiếu `SUPABASE_DB_URL` — chỉ throw khi thực sự có ai gọi `getPool().query()`
mà thiếu cấu hình (lỗi rõ ràng: "SUPABASE_DB_URL chưa được cấu hình"), để giữ đúng tinh thần
fail-soft đã thiết lập ở Giai đoạn 0.

**Acceptance criteria:**
- [ ] `server/package.json` có dependency `pg` (bản mới nhất ổn định tại thời điểm code).
- [ ] `require('./db/pool')` không throw, không mở kết nối, khi `SUPABASE_DB_URL` là `null`.
- [ ] `getPool()` trả về cùng 1 instance `Pool` ở các lần gọi sau (singleton, không tạo pool mới
      mỗi lần gọi).
- [ ] Gọi `getPool().query(...)` khi `SUPABASE_DB_URL` là `null` throw lỗi thông điệp rõ ràng, không
      phải lỗi `pg` khó hiểu (ví dụ `ECONNREFUSED` tới `localhost:5432`).

**Verification:**
- [ ] Test tự động `server/db/pool.test.js`: require module không set `SUPABASE_DB_URL` → không
      throw; set biến giả → `getPool()` trả về object có phương thức `.query`.
- [ ] `npm test` (server) pass toàn bộ.

**Dependencies:** None

**Files likely touched:**
- `server/package.json`
- `server/db/pool.js` (mới)
- `server/db/pool.test.js` (mới)

**Estimated scope:** Small (2-3 files)

---

### Task 2: Viết migration runner thủ công `server/db/migrate.js`

**Description:** Runner đơn giản: đọc toàn bộ file `.sql` trong `server/db/migrations/` theo thứ tự
tên file (`0001_...sql`, `0002_...sql`, ...), với mỗi file — nếu chưa có trong bảng
`schema_migrations` thì chạy trong 1 transaction (`BEGIN`/`COMMIT`, `ROLLBACK` nếu lỗi) rồi ghi
nhận đã áp dụng. Bảng `schema_migrations(filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL
DEFAULT now())` được tự tạo (`CREATE TABLE IF NOT EXISTS`) trước khi chạy migration đầu tiên. Thêm
script `npm run db:migrate` (`node server/db/migrate.js`) — script này **được phép** báo lỗi rõ
ràng và dừng nếu thiếu `SUPABASE_DB_URL` (đây là lệnh chủ động của người vận hành, khác với việc
server tự khởi động).

**Acceptance criteria:**
- [ ] Chạy 2 lần liên tiếp với cùng bộ file migration → lần 2 không chạy lại file nào (idempotent),
      không lỗi.
- [ ] 1 file migration lỗi giữa chừng (ví dụ SQL sai cú pháp) → transaction rollback, các câu lệnh
      trước đó trong CÙNG file không để lại thay đổi nửa vời; các file migration trước đó (đã
      commit thành công) không bị ảnh hưởng.
- [ ] Log ra console tên từng file đã áp dụng và tổng số file mới áp dụng ở lần chạy đó.
- [ ] `server/package.json` có script `"db:migrate": "node db/migrate.js"`.

**Verification:**
- [ ] Test tự động `server/db/migrate.test.js` dùng 1 pg client giả (mock đơn giản ghi lại các câu
      lệnh đã gọi, không cần Postgres thật) — xác nhận: thứ tự file đúng, file đã áp dụng bị bỏ qua,
      lỗi giữa file gây rollback đúng file đó và dừng lại (không chạy tiếp file sau).
- [ ] `npm test` (server) pass.

**Dependencies:** Task 1 (dùng `getPool()`)

**Files likely touched:**
- `server/db/migrate.js` (mới)
- `server/db/migrate.test.js` (mới)
- `server/package.json`

**Estimated scope:** Small (2-3 files)

---

### Task 3: Migration `0001` — dữ liệu nền tảng (categories, products, customers, suppliers, staff, sync_checkpoints)

**Description:** File `server/db/migrations/0001_core_master_data.sql`. Tạo 6 bảng:

```sql
CREATE TABLE categories (
  branch       TEXT NOT NULL CHECK (branch IN ('hanoi','saigon')),
  id           BIGINT NOT NULL,
  parent_id    BIGINT,
  name         TEXT NOT NULL,
  rank         INT,
  modified_date TIMESTAMPTZ,
  raw          JSONB NOT NULL,
  synced_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch, id)
);

CREATE TABLE products (
  branch        TEXT NOT NULL CHECK (branch IN ('hanoi','saigon')),
  id            BIGINT NOT NULL,
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  category_id   BIGINT,
  base_price    NUMERIC(18,2),
  unit          TEXT,
  is_active     BOOLEAN,
  created_date  TIMESTAMPTZ,
  modified_date TIMESTAMPTZ,
  raw           JSONB NOT NULL,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch, id),
  UNIQUE (branch, code)
);

CREATE TABLE customers (
  branch        TEXT NOT NULL CHECK (branch IN ('hanoi','saigon')),
  id            BIGINT NOT NULL,
  code          TEXT,
  name          TEXT,
  phone         TEXT,
  group_id      BIGINT,
  debt          NUMERIC(18,2),
  total_revenue NUMERIC(18,2),
  created_date  TIMESTAMPTZ,
  modified_date TIMESTAMPTZ,
  raw           JSONB NOT NULL,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch, id)
);

CREATE TABLE suppliers (
  branch        TEXT NOT NULL CHECK (branch IN ('hanoi','saigon')),
  id            BIGINT NOT NULL,
  code          TEXT,
  name          TEXT,
  phone         TEXT,
  group_id      BIGINT,
  debt          NUMERIC(18,2),
  created_date  TIMESTAMPTZ,
  modified_date TIMESTAMPTZ,
  raw           JSONB NOT NULL,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch, id)
);

-- Khong co endpoint rieng, suy luan tu SoldById/CreatedById... o Giai doan 2.
CREATE TABLE staff (
  branch      TEXT NOT NULL CHECK (branch IN ('hanoi','saigon')),
  id          BIGINT NOT NULL,
  name        TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch, id)
);

-- Theo doi tien do dong bo tung loai du lieu x tung co so.
CREATE TABLE sync_checkpoints (
  branch          TEXT NOT NULL CHECK (branch IN ('hanoi','saigon')),
  entity          TEXT NOT NULL,
  last_synced_at  TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  note            TEXT,
  PRIMARY KEY (branch, entity)
);
```

**Acceptance criteria:**
- [ ] Cả 6 bảng trên được tạo đúng như trên (tên cột, kiểu, PK, UNIQUE, CHECK).
- [ ] `CHECK (branch IN ('hanoi','saigon'))` áp dụng cho mọi bảng có cột `branch`.
- [ ] Áp dụng migration 2 lần liên tiếp (qua `npm run db:migrate`) không lỗi (nhờ Task 2).

**Verification:**
- [ ] Test tích hợp tùy chọn (Task 9) xác nhận 6 bảng tồn tại với đúng cột qua
      `information_schema.columns`.

**Dependencies:** Task 2

**Files likely touched:**
- `server/db/migrations/0001_core_master_data.sql` (mới)

**Estimated scope:** Small (1 file, nhiều bảng)

---

### Task 4: Migration `0002` — hóa đơn (invoices, invoice_details, invoice_payments)

**Description:** File `server/db/migrations/0002_invoices.sql`.

```sql
CREATE TABLE invoices (
  branch          TEXT NOT NULL CHECK (branch IN ('hanoi','saigon')),
  id              BIGINT NOT NULL,
  code            TEXT NOT NULL,
  purchase_date   TIMESTAMPTZ,
  customer_id     BIGINT,
  sold_by_id      BIGINT,
  total           NUMERIC(18,2),
  total_payment   NUMERIC(18,2),
  status          SMALLINT,
  created_date    TIMESTAMPTZ,
  modified_date   TIMESTAMPTZ,
  raw             JSONB NOT NULL,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch, id),
  UNIQUE (branch, code)
);

CREATE TABLE invoice_details (
  branch     TEXT NOT NULL CHECK (branch IN ('hanoi','saigon')),
  invoice_id BIGINT NOT NULL,
  line_no    INT NOT NULL,
  product_id BIGINT,
  quantity   NUMERIC(18,3),
  price      NUMERIC(18,2),
  discount   NUMERIC(18,2),
  raw        JSONB NOT NULL,
  PRIMARY KEY (branch, invoice_id, line_no),
  FOREIGN KEY (branch, invoice_id) REFERENCES invoices (branch, id) ON DELETE CASCADE
);

CREATE TABLE invoice_payments (
  branch     TEXT NOT NULL CHECK (branch IN ('hanoi','saigon')),
  invoice_id BIGINT NOT NULL,
  line_no    INT NOT NULL,
  method     TEXT,
  amount     NUMERIC(18,2),
  trans_date TIMESTAMPTZ,
  raw        JSONB NOT NULL,
  PRIMARY KEY (branch, invoice_id, line_no),
  FOREIGN KEY (branch, invoice_id) REFERENCES invoices (branch, id) ON DELETE CASCADE
);

CREATE INDEX idx_invoices_modified ON invoices (branch, modified_date);
```

Cột `idx_invoices_modified` phục vụ Giai đoạn 2 khi polling đối soát cần lọc theo checkpoint hiệu
quả (dù bản thân truy vấn incremental gọi API KiotViet chứ không query bảng này, nhưng bảng
`internal API` ở Giai đoạn 4 sẽ cần `ORDER BY modified_date`).

**Acceptance criteria:**
- [ ] 3 bảng + 1 index trên được tạo đúng.
- [ ] `FOREIGN KEY (branch, invoice_id)` hoạt động — insert `invoice_details` với `invoice_id`
      không tồn tại trong `invoices` phải bị Postgres từ chối.

**Verification:** như Task 3 (test tích hợp Task 9).

**Dependencies:** Task 3 (chạy sau `0001` theo thứ tự file)

**Files likely touched:**
- `server/db/migrations/0002_invoices.sql` (mới)

**Estimated scope:** Small (1 file)

---

### Task 5: Migration `0003` — đơn hàng (orders, order_details)

**Description:** File `server/db/migrations/0003_orders.sql`, cấu trúc song song với Task 4
(không có `invoice_payments` tương đương — theo `API_ENDPOINTS.md`, `orders` chỉ có
`includePayment=true` lồng trong response chính, chưa xác nhận cần bảng con riêng; nếu Giai đoạn 2
phát hiện cần, thêm bảng `order_payments` bằng 1 migration mới, không sửa lại `0003`).

```sql
CREATE TABLE orders (
  branch        TEXT NOT NULL CHECK (branch IN ('hanoi','saigon')),
  id            BIGINT NOT NULL,
  code          TEXT NOT NULL,
  order_date    TIMESTAMPTZ,
  customer_id   BIGINT,
  sold_by_id    BIGINT,
  total         NUMERIC(18,2),
  status        SMALLINT,
  created_date  TIMESTAMPTZ,
  modified_date TIMESTAMPTZ,
  raw           JSONB NOT NULL,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch, id),
  UNIQUE (branch, code)
);

CREATE TABLE order_details (
  branch     TEXT NOT NULL CHECK (branch IN ('hanoi','saigon')),
  order_id   BIGINT NOT NULL,
  line_no    INT NOT NULL,
  product_id BIGINT,
  quantity   NUMERIC(18,3),
  price      NUMERIC(18,2),
  discount   NUMERIC(18,2),
  raw        JSONB NOT NULL,
  PRIMARY KEY (branch, order_id, line_no),
  FOREIGN KEY (branch, order_id) REFERENCES orders (branch, id) ON DELETE CASCADE
);

CREATE INDEX idx_orders_modified ON orders (branch, modified_date);
```

**Acceptance criteria:** như Task 4, áp dụng cho `orders`/`order_details`.

**Verification:** như Task 4.

**Dependencies:** Task 4

**Files likely touched:**
- `server/db/migrations/0003_orders.sql` (mới)

**Estimated scope:** Small (1 file)

---

### Task 6: Migration `0004` — trả hàng (returns, return_details)

**Description:** File `server/db/migrations/0004_returns.sql`. Đây là bảng **mới so với lần triển
khai trước** (roadmap mục 5 ghi rõ "thiếu ở lần trước, bổ sung lần này"). Cấu trúc song song:

```sql
CREATE TABLE returns (
  branch        TEXT NOT NULL CHECK (branch IN ('hanoi','saigon')),
  id            BIGINT NOT NULL,
  code          TEXT NOT NULL,
  return_date   TIMESTAMPTZ,
  invoice_id    BIGINT,
  customer_id   BIGINT,
  sold_by_id    BIGINT,
  total         NUMERIC(18,2),
  status        SMALLINT,
  created_date  TIMESTAMPTZ,
  modified_date TIMESTAMPTZ,
  raw           JSONB NOT NULL,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch, id),
  UNIQUE (branch, code)
);

CREATE TABLE return_details (
  branch     TEXT NOT NULL CHECK (branch IN ('hanoi','saigon')),
  return_id  BIGINT NOT NULL,
  line_no    INT NOT NULL,
  product_id BIGINT,
  quantity   NUMERIC(18,3),
  price      NUMERIC(18,2),
  raw        JSONB NOT NULL,
  PRIMARY KEY (branch, return_id, line_no),
  FOREIGN KEY (branch, return_id) REFERENCES returns (branch, id) ON DELETE CASCADE
);

CREATE INDEX idx_returns_modified ON returns (branch, modified_date);
```

Lưu ý: `invoice_id` **không** khai báo `FOREIGN KEY` tới `invoices` — vì thứ tự đồng bộ giữa 2
entity không đảm bảo (1 phiếu trả có thể đồng bộ trước hóa đơn gốc khi polling 2 entity chạy song
song độc lập theo roadmap mục 4). Ràng buộc cứng sẽ làm insert thất bại không cần thiết; đối chiếu
`invoice_id` tồn tại là việc của Giai đoạn 4 (kiểm thử/xác minh), không phải ràng buộc schema.

**Acceptance criteria:**
- [ ] 2 bảng trên được tạo đúng, **không có** FK từ `returns.invoice_id` sang `invoices`.

**Verification:** như Task 4.

**Dependencies:** Task 5

**Files likely touched:**
- `server/db/migrations/0004_returns.sql` (mới)

**Estimated scope:** Small (1 file)

---

### Task 7: Migration `0005` — nhập hàng (purchases, purchase_details)

**Description:** File `server/db/migrations/0005_purchases.sql`. Theo `API_ENDPOINTS.md`, endpoint
thật là `/purchaseorders` — đặt tên bảng `purchases` (ngắn gọn, khớp cách gọi trong roadmap) nhưng
ghi rõ comment SQL nêu endpoint thật, tránh nhầm lẫn cho người đọc sau.

```sql
-- Endpoint KiotViet that: /purchaseorders (khong phai /purchases) - xem API_ENDPOINTS.md.
CREATE TABLE purchases (
  branch         TEXT NOT NULL CHECK (branch IN ('hanoi','saigon')),
  id             BIGINT NOT NULL,
  code           TEXT NOT NULL,
  purchase_date  TIMESTAMPTZ,
  supplier_id    BIGINT,
  total          NUMERIC(18,2),
  status         SMALLINT,
  created_date   TIMESTAMPTZ,
  modified_date  TIMESTAMPTZ,
  raw            JSONB NOT NULL,
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch, id),
  UNIQUE (branch, code)
);

CREATE TABLE purchase_details (
  branch       TEXT NOT NULL CHECK (branch IN ('hanoi','saigon')),
  purchase_id  BIGINT NOT NULL,
  line_no      INT NOT NULL,
  product_id   BIGINT,
  quantity     NUMERIC(18,3),
  price        NUMERIC(18,2),
  raw          JSONB NOT NULL,
  PRIMARY KEY (branch, purchase_id, line_no),
  FOREIGN KEY (branch, purchase_id) REFERENCES purchases (branch, id) ON DELETE CASCADE
);

CREATE INDEX idx_purchases_modified ON purchases (branch, modified_date);
```

**Acceptance criteria:** như Task 4, áp dụng cho `purchases`/`purchase_details`.

**Verification:** như Task 4.

**Dependencies:** Task 6

**Files likely touched:**
- `server/db/migrations/0005_purchases.sql` (mới)

**Estimated scope:** Small (1 file)

---

### Task 8: Migration `0006` — thu chi (cash_flows)

**Description:** File `server/db/migrations/0006_cash_flows.sql`. Không có bảng chi tiết dòng (thu
chi là bản ghi đơn, không có line items theo `API_ENDPOINTS.md`). Theo roadmap mục 5.8: lấy **toàn
bộ** cash_flows (cả khách hàng lẫn nhà cung cấp), không lọc `partnerType` ở tầng schema/sync.

```sql
CREATE TABLE cash_flows (
  branch        TEXT NOT NULL CHECK (branch IN ('hanoi','saigon')),
  id            BIGINT NOT NULL,
  code          TEXT,
  is_receipt    BOOLEAN NOT NULL,
  amount        NUMERIC(18,2),
  method        TEXT,
  customer_id   BIGINT,
  supplier_id   BIGINT,
  user_id       BIGINT,
  description   TEXT,
  trans_date    TIMESTAMPTZ,
  created_date  TIMESTAMPTZ,
  raw           JSONB NOT NULL,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch, id)
);

CREATE INDEX idx_cash_flows_trans_date ON cash_flows (branch, trans_date);
```

Lưu ý: **không** có cột `modified_date`/index tương ứng — `API_ENDPOINTS.md` xác nhận
`lastModifiedFrom` bị API `/cashflow` bỏ qua hoàn toàn; checkpoint của entity này (Giai đoạn 2) dùng
`startDate`/`endDate`, lưu vào cột `note` của `sync_checkpoints`, không dựa vào cột nào của bảng
này. Index dùng `trans_date` vì đó là trục truy vấn thực tế (đối soát theo khoảng ngày).

**Acceptance criteria:**
- [ ] Bảng + index trên được tạo đúng, không có cột `modified_date`.

**Verification:** như Task 4.

**Dependencies:** Task 7

**Files likely touched:**
- `server/db/migrations/0006_cash_flows.sql` (mới)

**Estimated scope:** XS (1 file)

---

### Checkpoint: Sau Task 1-8 (toàn bộ schema)
- [ ] `npm run db:migrate` chạy 2 lần liên tiếp trên 1 Postgres thật (local Docker hoặc Supabase
      project đã tạo ở Giai đoạn 0) không lỗi ở lần thứ 2.
- [ ] Toàn bộ 15 bảng tồn tại: `categories, products, customers, suppliers, staff,
      sync_checkpoints, invoices, invoice_details, invoice_payments, orders, order_details,
      returns, return_details, purchases, purchase_details, cash_flows` (16, đã đếm lại — xem
      danh sách đủ trong Task 3-8).
- [ ] Full test suite server (`npm test`) pass — không cần Postgres thật cho phần lớn test (Task
      1-2 dùng mock).

---

### Task 9: Test tích hợp tùy chọn (tự bỏ qua nếu chưa cấu hình Supabase)

**Description:** File `server/db/migrate.integration.test.js`. Đầu file kiểm tra
`process.env.SUPABASE_DB_URL` — nếu rỗng, gọi `t.skip('SUPABASE_DB_URL chưa cấu hình — bỏ qua test
tích hợp')` và kết thúc ngay (không fail CI khi chưa có Supabase project thật). Nếu có cấu hình:
chạy `migrate.js` thật, sau đó query `information_schema.tables`/`information_schema.columns` xác
nhận đủ 16 bảng và vài cột khóa (PK `(branch, id)` của `products`, FK của `invoice_details`).
**Không** insert/xóa dữ liệu thật trong test này (chỉ kiểm tra cấu trúc, tránh rác trên Supabase free
tier vốn giới hạn dung lượng).

**Acceptance criteria:**
- [ ] Không set `SUPABASE_DB_URL` → test tự skip, không fail, không cần Postgres.
- [ ] Có set `SUPABASE_DB_URL` trỏ tới Postgres test thật → test xác nhận đủ bảng, PK, FK như migration
      đã định nghĩa.

**Verification:**
- [ ] Chạy `npm test` không set biến — thấy test này ở trạng thái "skipped", suite vẫn pass.
- [ ] (Thủ công, tùy chọn) Chạy với `SUPABASE_DB_URL` trỏ Postgres local Docker tạm — test pass.

**Dependencies:** Task 8

**Files likely touched:**
- `server/db/migrate.integration.test.js` (mới)

**Estimated scope:** Small (1 file)

---

### Task 10: Viết `server/db/SCHEMA.md` — tài liệu tham chiếu bắt buộc cho Giai đoạn 2

**Description:** Tài liệu liệt kê 16 bảng, mục đích mỗi bảng, PK, các cột "first-class" quan trọng
và lý do chọn (đối chiếu ngược lại các quyết định ở mục "Nguyên tắc thiết kế" phía trên), cùng 3 ghi
chú **bắt buộc đọc trước khi code Giai đoạn 2**:
1. Cột `branch` là định danh nội bộ mới (`'hanoi'`/`'saigon'`), khác `BRANCHES` (tiếng Việt, dùng
   cho Sheets) và khác `KIOTVIET_RETAILER` (dùng để gọi API) — bảng map 3 giá trị này với nhau.
2. `line_no` trong các bảng `*_details`/`invoice_payments` là vị trí mảng, không phải id KiotViet —
   nếu Giai đoạn 2 tìm thấy id dòng ổn định trong response thật, cân nhắc đổi (ghi rõ đây là quyết
   định tạm, không phải cuối cùng).
3. `cash_flows` không có `modified_date` — checkpoint entity này dùng cơ chế khác (`startDate`/
   `endDate`, lưu trong `sync_checkpoints.note`), khác mọi entity còn lại.

Theo đúng tinh thần `source-driven-development` đã áp dụng cho `API_ENDPOINTS.md` (dòng đầu file đó
ghi "mọi entity sync module... phải trỏ về đây") — `SCHEMA.md` đóng vai trò tương tự cho tầng
Postgres, và các file entity sync module ở Giai đoạn 2 nên trỏ về cả 2 tài liệu.

**Acceptance criteria:**
- [ ] `server/db/SCHEMA.md` tồn tại, liệt kê đủ 16 bảng với PK và cột chính.
- [ ] Có bảng map `branch` ↔ `BRANCHES` (tiếng Việt) ↔ `KIOTVIET_RETAILER` (biến env).
- [ ] Có 3 ghi chú bắt buộc nêu trên.

**Verification:**
- [ ] Review thủ công: đối chiếu file với 6 migration đã viết (Task 3-8), không có bảng/cột nào bị
      thiếu hoặc sai so với SQL thật.

**Dependencies:** Task 8 (viết sau khi toàn bộ migration đã ổn định, tránh phải sửa lại nhiều lần)

**Files likely touched:**
- `server/db/SCHEMA.md` (mới)

**Estimated scope:** XS (1 file, tài liệu)

---

### Checkpoint: Hoàn tất Giai đoạn 1
- [ ] Task 1-10 merge, `npm test` pass toàn bộ (test tích hợp Task 9 skip nếu chưa có Supabase).
- [ ] `npm run db:migrate` đã chạy thật ít nhất 1 lần trên Supabase project thật (tạo ở Giai đoạn 0
      Task 5) — 16 bảng tồn tại, xác nhận qua Supabase Table Editor hoặc SQL Editor.
- [ ] `server/db/SCHEMA.md` phản ánh đúng schema thật đã tạo.
- [ ] `KIOTVIET_SYNC_ENABLED` vẫn là `false` — Giai đoạn 1 chỉ tạo schema, chưa ghi dữ liệu thật nào
      qua sync engine (đó là Giai đoạn 2-3). Dashboard Sheets không bị ảnh hưởng.
- [ ] Sẵn sàng chuyển sang Giai đoạn 2 (engine đồng bộ Webhook + Polling).

## Rủi ro & lưu ý

| Rủi ro | Ảnh hưởng | Giảm thiểu |
|---|---|---|
| Đoán sai tên/kiểu 1 vài cột "first-class" (KiotViet không có OpenAPI spec công khai đầy đủ) | Thấp | Cột `raw JSONB` trên mọi bảng giữ nguyên dữ liệu gốc; sửa cột sai chỉ là `ALTER TABLE` + backfill từ `raw`, không mất dữ liệu, không cần gọi lại API |
| `line_no` không ổn định nếu KiotViet đổi thứ tự mảng giữa các lần gọi cho cùng 1 bản ghi khi polling ghi đè | Trung bình — có thể tạo dòng trùng/rác nếu thứ tự đổi | Ghi rõ trong `SCHEMA.md` (Task 10) là quyết định tạm; Giai đoạn 2 khi viết logic upsert cần `DELETE ... WHERE branch=$1 AND invoice_id=$2` rồi insert lại toàn bộ dòng chi tiết mỗi lần đồng bộ 1 hóa đơn/đơn hàng (thay vì upsert từng dòng theo `line_no`), tránh rác khi thứ tự đổi |
| Supabase free tier 500MB — tạo schema không tốn gì (bảng rỗng), nhưng cần nhớ khi Giai đoạn 3 backfill | Thấp (chưa xảy ra ở Giai đoạn 1) | Không hành động ở Giai đoạn 1, chỉ ghi nhận rủi ro để Giai đoạn 3 tính toán dung lượng trước khi backfill toàn bộ lịch sử |
| Migration chạy nhầm trên Postgres production đã có dữ liệu (sau này) | Cao nếu xảy ra sai thời điểm | Giai đoạn 1 chạy trên Supabase project **mới tạo, còn rỗng** (Giai đoạn 0 Task 5) — không có dữ liệu để mất; runner (Task 2) dùng transaction + bảng `schema_migrations` nên an toàn để chạy lại nhiều lần ở mọi giai đoạn sau |

## Xác minh tổng thể cuối Giai đoạn 1

1. `npm test` (server) — toàn bộ pass (test tích hợp skip nếu chưa cấu hình).
2. `npm run db:migrate` chạy trên Supabase project thật — không lỗi, log đủ 6 file migration đã áp
   dụng.
3. Query thủ công trên Supabase SQL Editor: `SELECT table_name FROM information_schema.tables WHERE
   table_schema='public' ORDER BY table_name;` → thấy đủ 16 bảng + `schema_migrations`.
4. `server/db/SCHEMA.md` đối chiếu khớp với schema thật vừa tạo.
5. Dashboard Sheets hiện tại (đăng nhập, xem báo cáo) không có regression.
