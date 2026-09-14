# Kế hoạch chi tiết: Giai đoạn 3 — Đồng bộ dữ liệu lịch sử (backfill)
### (từ Roadmap: Đưa dữ liệu KiotViet lên Supabase Postgres, cận thời gian thực, 2 cơ sở)

## Context

`docs/04-planning/2026-09-14-roadmap-supabase-kiotviet-sync.md` (mục 5, Giai đoạn 3) chốt phạm vi
ở mức định hướng: sau khi engine đồng bộ (Giai đoạn 2) chạy ổn với dữ liệu **mới phát sinh**, chạy
thêm 1 lượt "backfill" kéo dữ liệu **lịch sử** (ví dụ từ đầu năm) vào Postgres cho cả 2 cơ sở, rồi
đối chiếu số lượng bản ghi với KiotViet để xác nhận không thiếu/lặp. Kế hoạch này cụ thể hóa thành
task có thể code được.

**Tình trạng thật của 2 giai đoạn trước khi lập kế hoạch này (đã kiểm tra trực tiếp trong repo,
không suy đoán):**
- **Giai đoạn 0 — đã merge và deploy** (commit `97a77b7`): `server/config.js` có
  `SUPABASE_DB_URL`/`PGSSL`/`KIOTVIET_SYNC_ENABLED`, `server/kiotviet/kiotvietWebhookRoutes.js` là
  stub webhook đã mount.
- **Giai đoạn 1 (schema Postgres) — CHƯA được code.** Xác nhận bằng khảo sát trực tiếp: **không có
  thư mục `server/db/`** trong repo. Chưa có bảng nào tồn tại trên Supabase.
- **Giai đoạn 2 (engine đồng bộ) — CHƯA được code.** Xác nhận: **không có thư mục
  `server/kiotvietSync/`** trong repo (chỉ có `server/kiotviet/` chứa client API thuần + stub
  webhook, không phải entity module/driver/scheduler).

**Hệ quả bắt buộc cho kế hoạch này:** Giai đoạn 3 phụ thuộc cứng và toàn diện vào Giai đoạn 1
(schema, `getPool()`) và Giai đoạn 2 (entity module có `upsertPage`, `syncDriver`, `staffSync`,
checkpoint đang chạy thật trên production). **Không code bất kỳ task nào dưới đây trước khi Giai
đoạn 1 và Giai đoạn 2 merge xong, chạy polling ổn định trên production ít nhất vài ngày** — nếu
không, backfill sẽ ghi vào bảng chưa tồn tại hoặc dùng entity module chưa có logic thật. Task 0 ghi
rõ điều kiện tiên quyết này.

Tài liệu nguồn bắt buộc phải đọc trước khi code (theo `source-driven-development`, nhất quán với 3
kế hoạch trước):
- [server/kiotviet/API_ENDPOINTS.md](../../server/kiotviet/API_ENDPOINTS.md) — đặc biệt 2 mục
  **"Ghi chú cho `backfill.js`"** và **"UNVERIFIED"** đã viết sẵn từ lần khảo sát API trước đây,
  là nền tảng trực tiếp cho toàn bộ chiến lược chia chunk dưới đây.
- `docs/04-planning/2026-09-14-phase1-plan-supabase-kiotviet-sync.md` — tên bảng/cột, nguyên tắc
  `(branch, id)`, quyết định `DELETE`+`INSERT` lại cho bảng `*_details` (áp dụng nguyên vẹn khi
  backfill, không có ngoại lệ).
- `docs/04-planning/2026-09-14-phase2-plan-supabase-kiotviet-sync.md` — hình dạng entity module
  (`entity`, `endpoint`, `listQuery`, `incrementalParam`, `hasUpperBound`, `upsertPage`), nguyên
  tắc "checkpoint chỉ tiến khi ghi thành công", và đặc biệt: **checkpoint rỗng ở Giai đoạn 2 coi là
  "bắt đầu từ `now() - 1h`", không phải "từ đầu lịch sử"**. Đây là lý do Giai đoạn 3 phải tồn tại
  độc lập — polling của Giai đoạn 2 **không bao giờ** tự kéo dữ liệu trước thời điểm bật cờ, bất kể
  entity là dữ liệu giao dịch (hóa đơn...) hay dữ liệu nền (sản phẩm, khách hàng...).

**Phát hiện quan trọng khi khảo sát `kiotVietApiClient.js` (định hình thiết kế resume của Giai đoạn
3):** [server/kiotviet/kiotVietApiClient.js:93-113](../../server/kiotviet/kiotVietApiClient.js#L93)
— `fetchAllPages(endpoint, query, onPage, options)` đã nhận sẵn `options.startItem` để tiếp tục
phân trang từ 1 vị trí cụ thể, và callback `onPage` đã trả `nextItem` sau mỗi trang. Comment tại
dòng 108-109 trong chính file này ghi rõ: *"nextItem là vị trí để tiếp tục nếu tiến trình bị dừng
ngay sau trang này — dùng cho cơ chế resume backfill (xem `backfillProgressRepository.js`)"* — tên
module đã có tiền lệ, xác nhận thiết kế đúng hướng đã định từ trước, không cần đoán tên mới.

## Nguyên tắc thiết kế đã chốt

- **Backfill là script CLI chạy 1 lần theo yêu cầu (on-demand), không phải job nền thường trực** —
  khác `scheduler.js` của Giai đoạn 2 (polling tự động). Người vận hành chủ động chạy
  `node server/kiotvietSync/backfill.js --branch=... --entity=...` khi cần, có thể chạy nhiều lần
  an toàn (idempotent) và tiếp tục lại nếu bị dừng giữa chừng.
- **Tái dùng 100% `upsertPage` của entity module đã viết ở Giai đoạn 2** — không viết logic ghi dữ
  liệu riêng cho backfill, đúng kỷ luật đã áp dụng cho webhook Task 7b của Giai đoạn 2. Backfill chỉ
  khác polling ở cách tính tham số truy vấn (chunk theo khoảng ngày) và cơ chế tiến độ.
- **Tiến độ backfill lưu ở bảng riêng (`backfill_progress`), không đụng `sync_checkpoints`** —
  `sync_checkpoints` là trạng thái của polling/webhook (Giai đoạn 2), phải giữ nguyên độc lập để
  backfill chạy song song với polling đang sống mà không làm lệch mốc `last_synced_at` của polling.
  Ghi trùng dữ liệu giữa 2 tiến trình là an toàn (mọi bảng dùng `UPSERT` theo `(branch, id)`).
- **3 chiến lược chia chunk khác nhau theo entity, lấy đúng từ `API_ENDPOINTS.md`:**
  1. **Có tham số chặn cả 2 đầu an toàn** (`invoices` dùng `fromPurchaseDate`/`toPurchaseDate`,
     `purchases` dùng cùng tên tham số, `cash_flows` dùng `startDate`/`endDate`) → chia theo
     **từng tháng** từ `--from` đến hiện tại. Mỗi tháng là 1 chunk độc lập, resume được riêng từng
     chunk — giảm rủi ro trôi trang (phân trang kiểu offset `currentItem` trôi nếu dữ liệu bị ghi
     thêm giữa lúc đang phân trang một tập rất lớn).
  2. **Không có tham số chặn trên** (`orders`, `returns` — `API_ENDPOINTS.md` mục "Ghi chú cho
     `backfill.js`" đã xác nhận `lastModifiedTo`/`toModifiedDate` bị API bỏ qua hoàn toàn) → **1
     lượt chạy đầy đủ duy nhất** với `lastModifiedFrom=--from`, chấp nhận rủi ro trôi trang trên tập
     lớn như rủi ro tồn dư đã biết trước (ghi nhận trong `API_ENDPOINTS.md`, không phải phát hiện
     mới của kế hoạch này).
  3. **Dữ liệu nền, không mang tính giao dịch theo thời gian** (`categories`, `products`,
     `customers`, `suppliers`) → **1 lượt chạy đầy đủ duy nhất, KHÔNG truyền tham số incremental**
     (lấy toàn bộ bản ghi hiện có, không lọc theo ngày) — vì đây là "hiện trạng", không phải log
     giao dịch; khối lượng cũng nhỏ hơn nhiều (hàng trăm đến ~10.000 bản ghi theo live probe cũ),
     không cần chia chunk.
  - `staff` **không có task backfill riêng** — tiếp tục được suy luận tự động qua
    `staffSync.upsertStaffFromEntity()` như 1 tác dụng phụ của việc backfill `invoices`/`orders`/
    `returns`/`purchases`/`cash_flows` (đúng nguyên tắc đã chốt ở Giai đoạn 2 Task 4, dùng lại
    nguyên vẹn, không viết thêm).
- **Resume theo đúng cơ chế `nextItem` đã có sẵn trong client** — `backfill_progress` lưu
  `next_item` (không phải chỉ cờ done/pending) cho mỗi `(branch, entity, chunk_key)`; khi chạy lại,
  truyền `{ startItem: next_item }` vào `fetchAllPages` để tiếp tục đúng từ trang bị dừng, không tải
  lại từ đầu chunk.
- **Giới hạn số lượng entity chạy đồng thời** (`runWithConcurrencyLimit`, tên đã có tiền lệ trong
  `API_ENDPOINTS.md` mục "UNVERIFIED") — vì backfill gọi API dồn dập hơn hẳn polling (nhiều trang
  liên tiếp không giãn cách như polling định kỳ), cần giới hạn để không cộng dồn vượt burst thực tế
  (~600 request/phút) cùng lúc với polling của Giai đoạn 2 đang chạy song song trên cùng 1 gian
  hàng. Mặc định giới hạn **2** entity chạy đồng thời mỗi cơ sở, giảm xuống 1 nếu log thấy `429`.
  Mọi chunk **trong cùng 1 entity** chạy tuần tự theo thứ tự tháng tăng dần (không song song hoá
  trong cùng entity) — đơn giản hoá việc resume và log tiến độ.
- **2 cơ sở chạy độc lập** — đúng nguyên tắc đã có ở Giai đoạn 2, dùng
  `config.getConfiguredBranches()` (Task 1 Giai đoạn 2), `Promise.allSettled` giữa 2 cơ sở.
- **Không cần kiểm tra `UNVERIFIED` về rate limit thực tế trước khi code** (điều đó là rủi ro vận
  hành, xử lý bằng backoff có sẵn trong `kiotVietApiClient.js` + `runWithConcurrencyLimit`) — nhưng
  **bắt buộc kiểm tra `UNVERIFIED` về tính khả dụng dữ liệu lịch sử cũ trước khi CHẠY backfill thật**
  (`API_ENDPOINTS.md`: "chưa test 1 hóa đơn tháng 3/2026 xem field có bị cắt bớt so với hóa đơn gần
  đây không... test trước khi chạy `backfill.js` đầy đủ") — xem Task 3.
- **Ước lượng dung lượng trước khi chạy backfill toàn bộ** — Supabase free tier giới hạn 500MB (rủi
  ro đã ghi ở kế hoạch Giai đoạn 1). Backfill là lúc dung lượng tăng đột ngột nhất (từ gần rỗng lên
  toàn bộ lịch sử), nên cần 1 bước đo trước khi chạy — xem Task 3.

## Bổ sung nhỏ vào hình dạng entity module (Giai đoạn 2) — cần làm trước Task 2

Entity module hiện tại (theo kế hoạch Giai đoạn 2 Task 3-4) chỉ có `incrementalParam` +
`hasUpperBound`. Backfill cần biết thêm **tên tham số chặn trên** khi có (khác nhau giữa entity:
`toPurchaseDate` cho invoices/purchases, `endDate` cho cash_flows). Thêm 1 field tùy chọn
`backfillRangeParam` vào từng entity module đã có (không đổi hành vi polling — field này chỉ được
`backfillPlan.js` đọc, `syncDriver.js` của Giai đoạn 2 không đọc field này):

```js
// Vi du bo sung vao server/kiotvietSync/entities/invoices.js (da co tu Giai doan 2)
module.exports = {
  entity: 'invoices',
  endpoint: 'invoices',
  listQuery: { includePayment: 'true', includeInvoiceDelivery: 'true', IncludeSaleChannel: 'true' },
  incrementalParam: 'lastModifiedFrom',
  hasUpperBound: true,
  backfillRangeParam: { from: 'fromPurchaseDate', to: 'toPurchaseDate' }, // MOI cho Giai doan 3
  async upsertPage(pgClient, branch, items) { /* da co */ }
};
```

Nếu Giai đoạn 2 đã merge xong mà chưa có field này, đây là **Task 1** dưới đây — sửa thêm (không
sửa lại) 3 file `invoices.js`, `purchases.js`, `cashFlows.js`; 5 entity còn lại không cần field này
(theo đúng phân loại "Nguyên tắc thiết kế" mục 3 trên).

## Task List

### Task 0 (điều kiện tiên quyết, không phải task code): Xác nhận Giai đoạn 1 và 2 đã hoàn tất thật

**Description:** Trước khi bắt đầu Task 1, xác nhận đúng checkpoint cuối của cả 2 kế hoạch trước:
`server/db/` tồn tại với 16 bảng + `sync_checkpoints` đã chạy migration thật trên Supabase;
`server/kiotvietSync/entities/*.js` đủ 8 entity module với `upsertPage` hoạt động; polling
(`scheduler.js`) đã chạy ổn định trên production ít nhất vài ngày, `GET
/api/internal/kiotviet-sync/status` cho thấy `last_success_at` gần đây cho mọi entity. Nếu chưa,
dừng và hoàn tất Giai đoạn 1-2 trước.

**Acceptance criteria:**
- [ ] `server/db/SCHEMA.md` và `server/kiotvietSync/` tồn tại thật trong repo (không chỉ trong tài
      liệu kế hoạch).
- [ ] `KIOTVIET_SYNC_ENABLED=true` đang chạy trên production, checkpoint đang tiến lên đều đặn.

**Dependencies:** Toàn bộ Giai đoạn 1 và Giai đoạn 2.

---

### Task 1: Bổ sung `backfillRangeParam` vào 3 entity module (`invoices`, `purchases`, `cashFlows`)

**Description:** Thêm field `backfillRangeParam: { from, to }` như mô tả ở mục "Bổ sung nhỏ" phía
trên vào 3 file entity module đã có từ Giai đoạn 2. Không sửa `upsertPage`, không sửa
`incrementalParam`/`hasUpperBound` — chỉ thêm 1 field mới, không phá hành vi polling hiện tại (đã
có test riêng ở Giai đoạn 2, chạy lại xác nhận không đổi).

**Acceptance criteria:**
- [ ] `invoices.js`, `purchases.js` có `backfillRangeParam: { from: 'fromPurchaseDate', to:
      'toPurchaseDate' }`.
- [ ] `cashFlows.js` có `backfillRangeParam: { from: 'startDate', to: 'endDate' }`.
- [ ] 5 entity module còn lại (`categories`, `products`, `customers`, `suppliers`) **không** có
      field này (đúng phân loại "dữ liệu nền, chạy full snapshot, không chunk theo ngày").
- [ ] `orders`, `returns` **không** có field này (đúng phân loại "không có tham số chặn trên").

**Verification:**
- [ ] Test hiện có của Giai đoạn 2 cho 3 entity này (`*.test.js`) vẫn pass không sửa gì (field mới
      không được `syncDriver.js`/`upsertPage` đọc tới).
- [ ] `npm test` (server) pass toàn bộ.

**Dependencies:** Task 0

**Files likely touched:**
- `server/kiotvietSync/entities/invoices.js`
- `server/kiotvietSync/entities/purchases.js`
- `server/kiotvietSync/entities/cashFlows.js`

**Estimated scope:** XS (3 file, 1 dòng mỗi file)

---

### Task 2: Migration `0007` — bảng `backfill_progress`

**Description:** File `server/db/migrations/0007_backfill_progress.sql` (tiếp theo 6 migration của
Giai đoạn 1 — nếu Giai đoạn 2 đã dùng số `0007` cho `webhook_events_raw`, đổi số file này thành số
kế tiếp thật tại thời điểm code, không cố định cứng số `0007`).

```sql
-- Theo doi tien do backfill theo tung chunk (thang, hoac 'full' cho entity
-- khong chia chunk). Doc lap voi sync_checkpoints (Giai doan 2) - khong duoc
-- backfill dung chung bang voi polling, tranh lam lech moc dang chay.
CREATE TABLE backfill_progress (
  branch        TEXT NOT NULL CHECK (branch IN ('hanoi','saigon')),
  entity        TEXT NOT NULL,
  chunk_key     TEXT NOT NULL,        -- '2026-01', '2026-02', ... hoac 'full'
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','error')),
  next_item     INT NOT NULL DEFAULT 0,  -- vi tri fetchAllPages se resume tu day
  records_synced INT NOT NULL DEFAULT 0,
  last_error    TEXT,
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch, entity, chunk_key)
);
```

**Acceptance criteria:**
- [ ] Bảng tạo đúng như trên, `CHECK (status IN (...))`.
- [ ] Áp dụng migration 2 lần liên tiếp qua `npm run db:migrate` không lỗi.

**Verification:**
- [ ] Test tích hợp tùy chọn (theo pattern Giai đoạn 1 Task 9 — skip nếu không có
      `SUPABASE_DB_URL`), mở rộng thêm assertion cho bảng này vào file tích hợp đã có (hoặc file
      mới, tùy quy mô), xác nhận bảng + cột + CHECK.

**Dependencies:** Task 0 (cần `db:migrate` runner của Giai đoạn 1 tồn tại)

**Files likely touched:**
- `server/db/migrations/00XX_backfill_progress.sql` (mới)

**Estimated scope:** XS (1 file)

---

### Task 3: `server/kiotvietSync/backfillProgressRepository.js`

**Description:** Module bọc thao tác trên `backfill_progress`, theo đúng tên đã có tiền lệ trong
`kiotVietApiClient.js` (comment dòng 109) và `API_ENDPOINTS.md`.

```js
// server/kiotvietSync/backfillProgressRepository.js
module.exports = {
  // Tra ve progress cua 1 chunk, hoac null neu chua tung chay (chunk moi).
  async getChunkProgress(pgClient, branch, entity, chunkKey) {},

  // Goi truoc khi bat dau xu ly 1 chunk: upsert status='running', started_at=now()
  // neu chua co, giu nguyen next_item cu neu dang resume.
  async markChunkStarted(pgClient, branch, entity, chunkKey) {},

  // Goi sau MOI trang thanh cong (khong phai sau ca chunk) - cap nhat next_item,
  // records_synced += so ban ghi trang nay. Dung de resume dung vi tri neu dung
  // giua chung o trang N.
  async advanceChunkProgress(pgClient, branch, entity, chunkKey, { nextItem, recordsInPage }) {},

  // Goi khi chunk xong toan bo (fetchAllPages tra ve, khong con trang nao):
  // status='done', finished_at=now().
  async markChunkDone(pgClient, branch, entity, chunkKey) {},

  // Goi khi loi giua chung: status='error', last_error=message. KHONG doi
  // next_item (giu moc resume gan nhat da luu qua advanceChunkProgress).
  async markChunkError(pgClient, branch, entity, chunkKey, errorMessage) {}
};
```

**Acceptance criteria:**
- [ ] Chunk chưa từng chạy → `getChunkProgress` trả `null`; `next_item` mặc định coi là `0`.
- [ ] `advanceChunkProgress` dùng `INSERT ... ON CONFLICT (branch, entity, chunk_key) DO UPDATE`,
      không tạo dòng trùng khi gọi nhiều lần liên tiếp cho cùng 1 chunk.
- [ ] Chunk có `status='done'` → Task 4 (driver backfill) phải **bỏ qua hoàn toàn**, không gọi lại
      API cho chunk đó khi chạy lại toàn bộ lệnh backfill (idempotent ở cấp chunk, không chỉ cấp
      bản ghi).
- [ ] Chunk có `status='error'` với `next_item > 0` → chạy lại phải resume đúng từ `next_item` đó
      (truyền vào `fetchAllPages({ startItem: next_item })`), không tải lại từ trang 0.

**Verification:**
- [ ] Test tự động `server/kiotvietSync/backfillProgressRepository.test.js` dùng pg client giả
      (mock, không cần Postgres thật) — xác nhận đúng SQL/tham số cho 5 hàm trên.
- [ ] Test tích hợp tùy chọn (skip nếu không có `SUPABASE_DB_URL`) ghi/đọc thật.
- [ ] `npm test` pass.

**Dependencies:** Task 2

**Files likely touched:**
- `server/kiotvietSync/backfillProgressRepository.js` (mới)
- `server/kiotvietSync/backfillProgressRepository.test.js` (mới)

**Estimated scope:** Small (2 file)

---

### Task 4: `server/kiotvietSync/backfillPlan.js` — tính danh sách chunk cần chạy (hàm thuần, không I/O)

**Description:** Hàm thuần (dễ test, không gọi API/Postgres), nhận entity module + `{ fromDate,
now }`, trả về mảng chunk theo đúng 3 chiến lược đã chốt ở "Nguyên tắc thiết kế" mục 3.

```js
// server/kiotvietSync/backfillPlan.js
function buildBackfillPlan(entityModule, { fromDate, now }) {
  if (entityModule.backfillRangeParam) {
    // Chia theo THANG tu fromDate den now (bao gom thang hien tai, chan tai
    // thoi diem `now` chu khong phai cuoi thang). Chunk key: 'YYYY-MM'.
    // Moi chunk: query = { [from]: dauThang.toISOString(), [to]: min(cuoiThang, now).toISOString() }.
  }
  if (entityModule.hasUpperBound === false) {
    // 1 chunk duy nhat, chunkKey='full', query = { [incrementalParam]: fromDate.toISOString() }.
  }
  // Con lai (khong co backfillRangeParam, hasUpperBound !== false, tuc du lieu
  // nen): 1 chunk duy nhat, chunkKey='full', query = {} (KHONG truyen
  // incrementalParam - lay toan bo).
}
module.exports = { buildBackfillPlan };
```

**Acceptance criteria:**
- [ ] `invoices` (có `backfillRangeParam`), `fromDate=2026-01-01`, `now=2026-09-14` → trả 9 chunk
      (`2026-01` .. `2026-09`), chunk cuối có `to` = `now`, không phải cuối tháng 9 (tránh backfill
      "tương lai" nếu chạy trước cuối tháng).
- [ ] `orders` (`hasUpperBound: false`) → trả đúng 1 chunk `full`, query chỉ có
      `lastModifiedFrom`, không có tham số chặn trên nào.
- [ ] `categories` (không `backfillRangeParam`, `hasUpperBound` mặc định `true` nhưng không dùng
      cho backfill) → trả đúng 1 chunk `full`, query rỗng (không có `lastModifiedFrom`).
- [ ] Hàm không gọi `Date.now()` trực tiếp — nhận `now` qua tham số (test không phụ thuộc đồng hồ
      thật, đúng pattern đã dùng cho `kiotVietApiClient.js`/`syncDriver.js`).

**Verification:**
- [ ] Test tự động `server/kiotvietSync/backfillPlan.test.js` — 3 case trên + case biên (`fromDate`
      cùng tháng với `now` → 1 chunk duy nhất).
- [ ] `npm test` pass.

**Dependencies:** Task 1 (cần field `backfillRangeParam` đã có trên entity module thật)

**Files likely touched:**
- `server/kiotvietSync/backfillPlan.js` (mới)
- `server/kiotvietSync/backfillPlan.test.js` (mới)

**Estimated scope:** Small (2 file, logic chia tháng cần cẩn thận biên)

---

### Task 5: `server/kiotvietSync/runWithConcurrencyLimit.js` — giới hạn số tác vụ async chạy đồng thời

**Description:** Hàm tiện ích nhỏ, tên đã có tiền lệ trong `API_ENDPOINTS.md`. Nhận 1 danh sách hàm
async (`() => Promise`) + giới hạn đồng thời `limit`, chạy tối đa `limit` hàm cùng lúc, trả về mảng
kết quả (dùng `Promise.allSettled` bên trong cho từng hàm — 1 hàm lỗi không dừng các hàm còn lại,
nhất quán với nguyên tắc "2 cơ sở/nhiều entity không chặn nhau" đã áp dụng xuyên suốt 3 kế hoạch
trước).

**Acceptance criteria:**
- [ ] `limit=2`, 5 hàm async (mỗi hàm tự ghi lại thời điểm bắt đầu) → tối đa 2 hàm đang chạy cùng
      lúc ở bất kỳ thời điểm nào.
- [ ] 1 hàm reject → các hàm còn lại vẫn chạy tiếp, kết quả trả về phân biệt được hàm nào lỗi (dạng
      `{ status: 'fulfilled'|'rejected', ... }` giống `Promise.allSettled`).

**Verification:**
- [ ] Test tự động `server/kiotvietSync/runWithConcurrencyLimit.test.js` dùng hàm giả có `delay`
      tiêm được (không chờ thời gian thật), đếm số hàm đang chạy đồng thời tại từng mốc thời gian.
- [ ] `npm test` pass.

**Dependencies:** None (độc lập, có thể làm song song với Task 1-4)

**Files likely touched:**
- `server/kiotvietSync/runWithConcurrencyLimit.js` (mới)
- `server/kiotvietSync/runWithConcurrencyLimit.test.js` (mới)

**Estimated scope:** XS (2 file)

---

### Task 6: Script khảo sát trước khi backfill (`server/kiotvietSync/preflightCheck.js`) — bắt buộc chạy trước Task 7

**Description:** Giải quyết 2 mục **UNVERIFIED** của `API_ENDPOINTS.md` cần xác minh **trước khi
chạy backfill thật** (không phải trước khi code) — đây là lý do tách hẳn thành 1 script/task riêng
thay vì gộp vào Task 7:
1. **Tính khả dụng dữ liệu lịch sử cũ:** gọi GET 1 hóa đơn cụ thể từ tháng xa nhất dự kiến backfill
   (ví dụ tháng 1 hoặc tháng 3/2026) qua `kiotVietClient`, in ra toàn bộ field nhận được, so sánh
   thủ công với 1 hóa đơn gần đây — xác nhận không bị cắt bớt field quan trọng (`InvoiceDetails`,
   payment...).
2. **Ước lượng dung lượng:** gọi GET không filter (giống kỹ thuật live-probe đã dùng để xác minh
   `API_ENDPOINTS.md`) cho mỗi entity × mỗi cơ sở để lấy `total` hiện tại, in ra bảng tổng số bản
   ghi dự kiến, nhân với ước lượng kích thước JSONB trung bình (script lấy mẫu 10 bản ghi thật để đo
   `pg_column_size`-tương-đương bằng `JSON.stringify(...).length` trong Node, không cần Postgres
   thật để ước lượng) — cảnh báo rõ nếu tổng ước lượng vượt quá **300MB** (còn margin an toàn dưới
   500MB free tier, tính cả tăng trưởng tiếp diễn qua polling).

Script này **chỉ đọc** (GET), không ghi Postgres, không phải 1 phần của luồng backfill chính — chạy
thủ công 1 lần, kết quả quyết định (bởi người dùng, không phải agent) có nên backfill toàn bộ lịch
sử hay giới hạn `--from` gần hơn.

**Acceptance criteria:**
- [ ] Chạy `node server/kiotvietSync/preflightCheck.js --branch=hanoi` in ra: (a) so sánh field của
      1 hóa đơn cũ vs. 1 hóa đơn mới, (b) bảng tổng `total` mỗi entity + ước lượng MB.
- [ ] Không ghi gì vào Postgres (script không import `db/pool.js`).

**Verification:**
- [ ] Test tự động cho phần logic ước lượng dung lượng (hàm thuần nhận sẵn mảng bản ghi mẫu + total
      → trả về MB ước lượng), không test phần gọi API thật (không mock nổi ý nghĩa, chạy thủ công).
- [ ] Chạy thủ công thật trên tài khoản Hà Nội, ghi lại kết quả vào phần "Xác minh tổng thể" cuối
      tài liệu này trước khi merge Task 7.

**Dependencies:** Task 0 (cần `kiotVietClient` cấu hình thật — dùng lại `config.js` của Giai đoạn 2
Task 1)

**Files likely touched:**
- `server/kiotvietSync/preflightCheck.js` (mới)
- `server/kiotvietSync/preflightCheck.test.js` (mới, chỉ phần ước lượng thuần)

**Estimated scope:** Small (2 file)

---

### Task 7: `server/kiotvietSync/backfill.js` — script chính điều phối backfill

**Description:** Đây là phần lõi nối mọi thứ lại. CLI: `node server/kiotvietSync/backfill.js
--branch=hanoi|saigon|all --entity=invoices|all --from=2026-01-01`.

```js
// server/kiotvietSync/backfill.js
async function backfillEntity(kiotVietClient, pgClient, branch, entityModule, { fromDate, now }) {
  const chunks = buildBackfillPlan(entityModule, { fromDate, now });
  for (const chunk of chunks) {               // TUAN TU trong 1 entity, khong song song
    const progress = await backfillProgressRepository.getChunkProgress(pgClient, branch, entityModule.entity, chunk.chunkKey);
    if (progress?.status === 'done') continue; // idempotent o cap chunk
    await backfillProgressRepository.markChunkStarted(pgClient, branch, entityModule.entity, chunk.chunkKey);
    try {
      await kiotVietClient.fetchAllPages(entityModule.endpoint, chunk.query, async (items, pageInfo) => {
        // Mo 1 transaction Postgres cho TRANG nay (giong syncDriver.js Giai doan 2):
        // upsertPage roi advanceChunkProgress(nextItem, items.length) trong CUNG transaction.
      }, { startItem: progress?.next_item || 0 }); // RESUME dung tu day
      await backfillProgressRepository.markChunkDone(pgClient, branch, entityModule.entity, chunk.chunkKey);
    } catch (err) {
      await backfillProgressRepository.markChunkError(pgClient, branch, entityModule.entity, chunk.chunkKey, err.message);
      throw err; // dung entity nay, chunk sau khong chay, nhung entity/co so khac van tiep tuc (xem dieu phoi ben duoi)
    }
  }
}

async function main() {
  // Doc --branch/--entity/--from tu argv. Voi moi co so da chon (loc qua
  // config.getConfiguredBranches() - dung lai Giai doan 2 Task 1), voi moi
  // entity da chon, goi backfillEntity qua runWithConcurrencyLimit(limit=2).
  // Dung Promise.allSettled o tang co so - 1 co so loi khong chan co so con lai.
}
```

**Acceptance criteria:**
- [ ] Chạy lần đầu (chưa có `backfill_progress`) → tất cả chunk `pending` → chạy từ đầu.
- [ ] Dừng giữa chừng (giả lập ép lỗi ở chunk thứ 3/9) rồi chạy lại lệnh **giống nguyên** → 2 chunk
      đầu (`done`) bị bỏ qua, chunk thứ 3 resume đúng từ `next_item` đã lưu, không tải lại từ trang
      0, các chunk sau đó (`pending`) chạy tiếp bình thường.
- [ ] 1 entity lỗi hoàn toàn (hết retry) không chặn entity khác của cùng cơ sở hoặc cơ sở khác chạy
      tiếp (`runWithConcurrencyLimit` + `Promise.allSettled`).
- [ ] Mỗi trang là 1 transaction riêng (giống `syncDriver.js`) — không mất tiến độ các trang trước
      nếu trang sau lỗi.
- [ ] `--entity=all` chạy đúng thứ tự khối lượng tăng dần (`categories`, `suppliers`, `customers`,
      `products`, `returns`, `purchases`, `cash_flows`, `orders`, `invoices`) — để phát hiện lỗi
      sớm ở entity nhỏ trước khi tốn thời gian ở entity lớn nhất.

**Verification:**
- [ ] Test tự động `server/kiotvietSync/backfill.test.js`: dùng `kiotVietClient` giả (trả sẵn nhiều
      trang cố định, có thể ép lỗi ở trang/chunk bất kỳ) + pg client giả + `backfillProgressRepository`
      giả — không cần Postgres/KiotViet thật. Xác nhận đúng 5 tình huống trên.
- [ ] Test thủ công trên môi trường dev với `SUPABASE_DB_URL` trỏ Supabase test + credentials
      KiotViet thật, `--entity=categories` (nhỏ nhất, an toàn nhất để thử đầu tiên) — xác nhận dữ
      liệu xuất hiện đúng trong bảng `categories`.
- [ ] `npm test` pass.

**Dependencies:** Task 3, Task 4, Task 5, Task 6 (đã chạy preflight, có quyết định `--from` cụ thể)

**Files likely touched:**
- `server/kiotvietSync/backfill.js` (mới)
- `server/kiotvietSync/backfill.test.js` (mới)
- `server/package.json` (script `"backfill": "node kiotvietSync/backfill.js"`)

**Estimated scope:** Medium — **nên chạy thật theo từng entity riêng lẻ trên production, không
chạy `--entity=all` ngay lần đầu**, dù code hỗ trợ `all` (để cô lập được entity nào có vấn đề nếu
xảy ra lỗi giữa lúc backfill khối lượng lớn).

---

### Checkpoint: Sau Task 1-7 (toàn bộ phần code)
- [ ] `npm test` (server) pass toàn bộ.
- [ ] Đã chạy `preflightCheck.js` (Task 6) thật trên Hà Nội, có kết quả ước lượng dung lượng và xác
      nhận field dữ liệu cũ không bị cắt bớt — quyết định `--from` cụ thể dựa trên kết quả này (xem
      "Câu hỏi cần quyết định" bên dưới).
- [ ] Đã chạy `backfill.js --entity=categories --branch=hanoi` thành công trên Supabase project
      thật (entity nhỏ nhất, dùng để xác nhận toàn bộ pipeline hoạt động đúng trước khi chạy entity
      lớn).
- [ ] Dashboard Sheets hiện tại không có regression trong suốt quá trình (backfill chạy hoàn toàn
      độc lập, không đọc/ghi Google Sheets).

---

### Task 8: `server/kiotvietSync/reconcileCounts.js` — đối chiếu số lượng sau backfill

**Description:** Script đối chiếu, theo đúng yêu cầu roadmap mục 5 Giai đoạn 3 ("đối chiếu số lượng
bản ghi với số liệu đã biết trên KiotViet... xác nhận không thiếu/lặp"). Với mỗi `(branch, entity)`:
gọi KiotViet không filter lấy `total` hiện tại (kỹ thuật live-probe đã dùng để viết
`API_ENDPOINTS.md`), so với `SELECT COUNT(*)` trên bảng Postgres tương ứng, in ra bảng lệch (nếu
có). Chấp nhận lệch nhỏ do độ trễ giữa lúc backfill xong và lúc chạy đối chiếu (bản ghi mới phát
sinh, đã được polling Giai đoạn 2 bắt kịp) — lệch lớn (ví dụ > 1%) cần điều tra thủ công, đặc biệt
với `orders`/`returns` (rủi ro trôi trang đã biết trước).

**Acceptance criteria:**
- [ ] In ra bảng: `entity | branch | kiotviet_total | postgres_count | diff`.
- [ ] `diff = 0` cho toàn bộ entity **có tham số chặn trên an toàn** (`invoices`, `purchases`,
      `cash_flows`, và dữ liệu nền `categories`/`products`/`customers`/`suppliers`) sau khi backfill
      xong và không có giao dịch mới trong lúc đối chiếu.
- [ ] `orders`/`returns` được phép lệch nhỏ (rủi ro trôi trang tồn dư) — script chỉ cảnh báo, không
      coi là lỗi cứng.

**Verification:**
- [ ] Chạy thủ công thật sau khi Task 7 backfill xong ít nhất 1 entity, đối chiếu bằng mắt với giao
      diện KiotViet.
- [ ] Test tự động cho phần tính `diff` (hàm thuần, nhận sẵn 2 số) — không test phần gọi API/DB
      thật.

**Dependencies:** Task 7

**Files likely touched:**
- `server/kiotvietSync/reconcileCounts.js` (mới)
- `server/kiotvietSync/reconcileCounts.test.js` (mới, chỉ phần tính diff)

**Estimated scope:** Small (2 file)

---

### Task 9: Chạy backfill thật cho toàn bộ entity, cả 2 cơ sở (thao tác vận hành, không phải code mới)

**Description:** Sau khi Task 1-8 merge và đã thử thành công với `categories`, chạy tuần tự
`backfill.js` cho từng entity còn lại theo thứ tự khối lượng tăng dần đã nêu ở Task 7, cho **Hà Nội
trước** (đã đủ credentials từ trước), rồi **Sài Gòn** (nếu Giai đoạn 0 Task 6 — bổ sung credentials
Sài Gòn — đã hoàn tất; nếu chưa, backfill Sài Gòn bị chặn cho tới khi có credentials, không chặn
việc coi Hà Nội "xong" trước). Sau mỗi entity, chạy `reconcileCounts.js` (Task 8) ngay để phát hiện
sớm nếu có vấn đề, trước khi chuyển sang entity tiếp theo.

**Acceptance criteria:**
- [ ] Toàn bộ 9 entity (`categories`, `products`, `customers`, `suppliers`, `invoices`, `orders`,
      `returns`, `purchases`, `cash_flows`) đã backfill xong cho Hà Nội, `reconcileCounts.js` xác
      nhận lệch trong ngưỡng chấp nhận được (0 cho nhóm có chặn trên an toàn, nhỏ cho `orders`/
      `returns`).
- [ ] Sài Gòn hoàn tất tương tự (hoặc ghi rõ đang chờ credentials nếu Giai đoạn 0 Task 6 chưa xong —
      không phải lỗi của kế hoạch này).
- [ ] Dung lượng Supabase thật sau backfill được kiểm tra qua Supabase Dashboard (Settings →
      Database → Usage), đối chiếu với ước lượng của `preflightCheck.js` (Task 6) — nếu lệch lớn so
      với ước lượng, ghi lại làm bài học cho lần backfill tiếp theo (nếu có).

**Verification:**
- [ ] `reconcileCounts.js` chạy lần cuối cho toàn bộ entity × 2 cơ sở, không còn lệch lớn nào không
      giải thích được.
- [ ] Dashboard Sheets hiện tại không có regression trong toàn bộ quá trình chạy backfill (có thể
      kéo dài vài giờ tuỳ khối lượng `invoices`/`orders`).

**Dependencies:** Task 7, Task 8, và Giai đoạn 0 Task 6 (credentials Sài Gòn) cho phần Sài Gòn.

**Estimated scope:** Không phải code — thao tác vận hành, có thể kéo dài nhiều giờ do rate limit
KiotViet (5.000 request/giờ/gian hàng) với khối lượng lớn nhất (`invoices` ~24.000 bản ghi,
`orders` ~35.000 bản ghi theo live probe cũ — số thật tại thời điểm chạy sẽ lớn hơn do đã qua thời
gian).

---

### Checkpoint: Hoàn tất Giai đoạn 3
- [ ] Task 1-8 merge, `npm test` pass toàn bộ.
- [ ] Task 9 hoàn tất cho Hà Nội (bắt buộc) và Sài Gòn (nếu đã đủ credentials).
- [ ] `reconcileCounts.js` không còn lệch lớn không giải thích được cho bất kỳ entity nào.
- [ ] Dung lượng Supabase còn trong ngưỡng an toàn của free tier (< 500MB), có số liệu thật ghi lại.
- [ ] Dashboard Sheets hiện tại không có regression trong suốt quá trình.
- [ ] Sẵn sàng chuyển sang Giai đoạn 4 (kiểm thử & xác minh — phần API nội bộ tối giản đã có từ
      Giai đoạn 2 Task 8, Giai đoạn 4 sẽ mở rộng thêm, có thể hiển thị luôn `backfill_progress`).

## Rủi ro & lưu ý

| Rủi ro | Ảnh hưởng | Giảm thiểu |
|---|---|---|
| Dữ liệu lịch sử cũ (đầu năm) có thể thiếu field so với giả định ("UNVERIFIED" trong `API_ENDPOINTS.md`) | Trung bình | Task 6 (`preflightCheck.js`) bắt buộc chạy trước Task 7, không suy đoán |
| Backfill + polling chạy song song có thể cộng dồn vượt rate limit 1 gian hàng | Trung bình | `runWithConcurrencyLimit` (Task 5) giới hạn mặc định 2, giảm xuống 1 nếu thấy `429`; có thể tạm tăng `KIOTVIET_SYNC_SLOW_INTERVAL_MS` trong lúc backfill nếu cần (không phải thay đổi bắt buộc, chỉ là lựa chọn vận hành) |
| `orders`/`returns` trôi trang trên tập lớn do không có tham số chặn trên (rủi ro đã biết trước, ghi trong `API_ENDPOINTS.md`) | Trung bình, chấp nhận được | `reconcileCounts.js` (Task 8) phát hiện sớm; vì `UPSERT` theo `(branch,id)`, chạy lại `backfill.js` cho đúng entity đó (xoá chunk `full` trong `backfill_progress` để buộc chạy lại) là cách khắc phục, không cần code thêm |
| Dung lượng Supabase free tier (500MB) có thể không đủ nếu backfill toàn bộ lịch sử nhiều năm | Cao nếu xảy ra, thấp nếu `--from` chọn hợp lý | Task 6 ước lượng trước; nếu vượt ngưỡng, ưu tiên backfill entity giao dịch (`invoices`, `orders`...) trước với `--from` gần hơn, cân nhắc nâng gói Supabase trả phí nếu cần lưu toàn bộ lịch sử nhiều năm (quyết định nằm ngoài phạm vi kỹ thuật của kế hoạch này) |
| Chạy `backfill.js --entity=all` ngay lần đầu có thể khó xác định entity nào lỗi nếu có sự cố giữa chừng trên tập lớn | Thấp (chỉ ảnh hưởng tốc độ debug) | Task 7/9 khuyến nghị rõ chạy từng entity riêng, thứ tự khối lượng tăng dần, dù code hỗ trợ `all` |

## Câu hỏi cần quyết định (trước khi chạy Task 9 thật)

1. **Giá trị `--from` cụ thể cho backfill:** roadmap ghi "ví dụ từ đầu năm" nhưng chưa chốt ngày cụ
   thể. Đề xuất mặc định `2026-01-01` (khớp ví dụ roadmap, khối lượng vừa phải — ~9 tháng dữ liệu),
   nhưng quyết định cuối cần dựa trên kết quả ước lượng dung lượng của Task 6 (`preflightCheck.js`)
   — nếu dung lượng dư nhiều so với 500MB, có thể lùi xa hơn (ví dụ từ khi 2 cửa hàng bắt đầu dùng
   KiotViet); nếu sát ngưỡng, giữ nguyên hoặc rút ngắn hơn.
2. **Có cần backfill dữ liệu nền (`categories`/`products`/`customers`/`suppliers`) hay để polling tự
   bắt kịp dần?** Kế hoạch này chọn **có backfill ngay** (Task 7 nhóm 3) vì polling Giai đoạn 2 chỉ
   tiến từ lúc bật cờ, nếu không backfill thì các bản ghi tạo/sửa **trước** thời điểm bật
   `KIOTVIET_SYNC_ENABLED` sẽ **không bao giờ** xuất hiện trong Postgres (không chỉ chậm, mà là
   thiếu vĩnh viễn) — cần xác nhận lại với người quyết định rằng đây đúng là hành vi mong muốn của
   Giai đoạn 2, không phải hiểu nhầm khi lập kế hoạch này.

## Xác minh tổng thể cuối Giai đoạn 3

1. `npm test` (server) — toàn bộ pass.
2. `preflightCheck.js` đã chạy thật, kết quả ước lượng dung lượng + kiểm tra field dữ liệu cũ được
   ghi lại (đính kèm log hoặc tóm tắt vào phần này khi thực thi).
3. `backfill.js` đã chạy xong cho toàn bộ 9 entity, Hà Nội (bắt buộc) và Sài Gòn (nếu đủ điều kiện).
4. `reconcileCounts.js` không còn lệch lớn không giải thích được.
5. Supabase Dashboard xác nhận dung lượng thật sau backfill, còn trong ngưỡng an toàn.
6. Dashboard Sheets hiện tại (đăng nhập, xem báo cáo, kiểm tra đứt hàng cả 2 cơ sở) không có
   regression trong suốt quá trình.
