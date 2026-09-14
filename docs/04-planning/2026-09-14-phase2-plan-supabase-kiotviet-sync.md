# Kế hoạch chi tiết: Giai đoạn 2 — Engine đồng bộ (Webhook + Polling đối soát)
### (từ Roadmap: Đưa dữ liệu KiotViet lên Supabase Postgres, cận thời gian thực, 2 cơ sở)

## Context

`docs/04-planning/2026-09-14-roadmap-supabase-kiotviet-sync.md` (mục 5, Giai đoạn 2) đã chốt phạm
vi: dùng lại nguyên `kiotVietApiClient.js`, thêm 1 route webhook thật (thay stub Giai đoạn 0), viết
driver đồng bộ dùng chung + module riêng cho từng entity, và 1 bộ lập lịch polling đối soát chạy
song song độc lập cho 2 cơ sở — toàn bộ nằm sau cờ `KIOTVIET_SYNC_ENABLED` (mặc định tắt).

**Tình trạng thật của 2 giai đoạn trước khi lập kế hoạch này (đã kiểm tra trực tiếp trong repo,
không suy đoán):**
- **Giai đoạn 0 — đã merge và deploy** (commit `97a77b7`): [server/config.js](../../server/config.js)
  có `SUPABASE_DB_URL`/`PGSSL`/`KIOTVIET_SYNC_ENABLED` (fail-soft, mặc định tắt),
  [server/kiotviet/kiotvietWebhookRoutes.js](../../server/kiotviet/kiotvietWebhookRoutes.js) là stub
  webhook đã mount tại [server/routes.js:38](../../server/routes.js#L38) (trước mọi guard
  `resolveBranch`), `server/apphosting.yaml` đã có đủ 4 secret entry mới.
- **Giai đoạn 1 — CHƯA được code**, chỉ có kế hoạch
  (`docs/04-planning/2026-09-14-phase1-plan-supabase-kiotviet-sync.md`). Xác nhận bằng khảo sát trực
  tiếp: **không có thư mục `server/db/`** trong repo (không có `pool.js`, `migrate.js`,
  `migrations/`, `SCHEMA.md`). Nghĩa là **chưa có bảng nào tồn tại trên Postgres** — 16 bảng nghiệp
  vụ (`categories`, `products`, ..., `sync_checkpoints`) mới chỉ là SQL viết sẵn trong tài liệu kế
  hoạch, chưa chạy migration lần nào.

**Hệ quả bắt buộc cho kế hoạch Giai đoạn 2 này:** Giai đoạn 2 phụ thuộc cứng vào Giai đoạn 1 (cần
`getPool()`, cần bảng `sync_checkpoints` và 16 bảng nghiệp vụ tồn tại để `INSERT`/`UPSERT` vào).
Task 0 dưới đây ghi rõ điều kiện tiên quyết này — **không code Task 1 trở đi trước khi Giai đoạn 1
merge xong và đã chạy migration thật trên Supabase** (checkpoint cuối Giai đoạn 1 đã liệt kê điều
kiện này).

Tài liệu nguồn bắt buộc phải đọc trước khi code (theo `source-driven-development`, đã áp dụng nhất
quán ở 2 kế hoạch trước):
- [server/kiotviet/API_ENDPOINTS.md](../../server/kiotviet/API_ENDPOINTS.md) — tên entity, tham số
  incremental, các trường hợp đặc biệt (`orders`/`returns` không có tham số chặn trên,
  `cash_flows` dùng `startDate`/`endDate` và gọi 2 lần).
- `docs/04-planning/2026-09-14-phase1-plan-supabase-kiotviet-sync.md` — tên bảng, cột, PK, quyết
  định `line_no` không ổn định (phải `DELETE` rồi insert lại toàn bộ dòng chi tiết, không upsert
  từng dòng).
- `server/db/SCHEMA.md` (sẽ tồn tại sau khi Giai đoạn 1 xong Task 10) — bảng map
  `branch` (`'hanoi'`/`'saigon'`) ↔ `BRANCHES` (tiếng Việt) ↔ `KIOTVIET_RETAILER` (biến env).

**Phát hiện quan trọng khi khảo sát code hiện có (định hình thiết kế Giai đoạn 2):**
- `kiotVietApiClient.js` là client thuần, nhận `{ clientId, clientSecret, retailer }` qua tham số,
  **không đọc `process.env` trực tiếp** — tái sử dụng nguyên vẹn, không sửa file này.
- Cách đọc credentials theo cơ sở (fallback Sài Gòn → Hà Nội nếu thiếu biến `_SG`, throw
  `BRANCH_NOT_CONFIGURED` nếu thiếu riêng `KIOTVIET_RETAILER_SG`) đã có sẵn ở
  [server/dashboard/stockoutCheck/stockoutCheckRoutes.js:20-35](../../server/dashboard/stockoutCheck/stockoutCheckRoutes.js#L20)
  (`readKiotVietConfig(branch)`) — Giai đoạn 2 tái dùng logic này (tách ra thành helper dùng chung,
  xem Task 2), không viết lại từ đầu.
- Không có thư viện cron nào (`node-cron`, `node-schedule`) trong `package.json` gốc lẫn
  `server/package.json`. Pattern lập lịch nền hiện có trong dự án là `setInterval` thuần ở
  module-scope, khởi động **có điều kiện** trong `startServer()` của
  [server/index.js](../../server/index.js) (xem cách bot Telegram HR được bật/tắt theo cờ config ở
  cuối file) — Giai đoạn 2 theo đúng pattern này cho polling, **không thêm dependency mới**.
- `server/kiotviet/API_ENDPOINTS.md` đã nhắc tới các file **chưa tồn tại**:
  `server/kiotvietSync/entities/*.js`, `backfillProgressRepository.js`, `staffSync.js`,
  `runWithConcurrencyLimit`, lệnh `sync:once`/`backfill`. Đây là tàn dư mô tả từ lần thiết kế
  trước (8/2026, đã xóa code ngày 2026-09-08) — **tên module/thư mục trong kế hoạch này lấy lại
  đúng các tên đó** (đã có nguồn tham chiếu, giữ nhất quán với tài liệu, không đặt tên mới tùy ý),
  nhưng nội dung code là viết mới hoàn toàn ở Giai đoạn 2 này.
- `server/jobs/syncCustomerReport.js` là ví dụ 1 job gọi `kiotVietClient` cũ để đồng bộ Sheets, chạy
  độc lập ngoài tiến trình server chính (`npm run sync:customer-report`, kích hoạt bởi lịch ngoài,
  không phải `setInterval` trong server) — **không phải pattern dùng cho Giai đoạn 2** (webhook cần
  chạy trong cùng tiến trình server đang lắng nghe request), chỉ tham khảo cách gọi client.

## Nguyên tắc thiết kế đã chốt

- **Webhook là nguồn chính, polling là lưới an toàn** (roadmap mục 4) — thiết kế driver dùng chung
  sao cho cả 2 đường (webhook payload, polling page) đi qua **cùng 1 hàm upsert** cho mỗi entity,
  tránh 2 code path ghi dữ liệu khác nhau dẫn tới lệch kết quả.
- **Webhook route phải trả `HTTP 200` trước khi xử lý ghi Postgres** (roadmap mục 5, rủi ro mục 7)
  — tách "nhận + trả 200" khỏi "xử lý ghi" bằng 1 hàng đợi trong-tiến-trình (in-process queue, xem
  Task 4), **không** dùng dịch vụ queue ngoài (Redis, SQS...) — ngoài phạm vi gói free/kiến trúc
  hiện tại, và khối lượng sự kiện của 1 cửa hàng bán lẻ 2 cơ sở không cần tới mức đó.
- **Checkpoint chỉ tiến lên khi ghi Postgres thành công** (roadmap mục 5) — mọi module entity đọc
  `sync_checkpoints.last_synced_at` trước khi gọi API, chỉ `UPDATE` checkpoint đó **sau khi**
  transaction ghi dữ liệu trang hiện tại commit thành công. Nếu lỗi giữa chừng (mất mạng, Postgres
  timeout), checkpoint giữ nguyên mốc cũ — lần chạy sau tự động lấy lại đúng từ đó, tự chấp nhận
  ghi trùng một phần dữ liệu **đã upsert nhưng chưa kịp cập nhật checkpoint** (an toàn vì mọi bảng
  dùng `UPSERT` theo PK `(branch, id)`, ghi trùng không tạo bản ghi rác).
- **`(branch, id)` là đơn vị upsert duy nhất** — không có "phiên bản" hay "delta" nào khác; mỗi lần
  ghi 1 bản ghi là `INSERT ... ON CONFLICT (branch, id) DO UPDATE SET ...`. Với bảng `*_details`
  (dòng chi tiết), theo đúng quyết định đã ghi ở kế hoạch Giai đoạn 1 (rủi ro `line_no` không ổn
  định): `DELETE FROM x_details WHERE branch=$1 AND x_id=$2` rồi `INSERT` lại toàn bộ mảng dòng chi
  tiết trong **cùng 1 transaction** với `UPSERT` bảng cha — không tách 2 transaction riêng.
- **2 cơ sở chạy hoàn toàn độc lập** (roadmap mục 3, 2 quota riêng biệt) — mọi vòng lặp polling,
  mọi client KiotViet, mọi worker xử lý webhook đều tham số hóa theo `branch`; lỗi/rate-limit ở 1
  cơ sở không được chặn cơ sở còn lại (dùng `Promise.allSettled`, không dùng `Promise.all`, ở tầng
  điều phối 2 cơ sở).
- **Webhook không có xác thực chữ ký ở Giai đoạn 2** (đã ghi nhận là rủi ro tồn dư ở kế hoạch Giai
  đoạn 0, mục "Rủi ro & lưu ý") — vì tra cứu tài liệu KiotViet hiện tại không xác nhận cơ chế ký
  request. Giảm thiểu bằng cách route xử lý **idempotent tuyệt đối** (upsert theo id, không có tác
  dụng phụ nào khác ngoài ghi Postgres) — 1 request giả mạo tối đa chỉ gây ghi/đọc lại 1 bản ghi
  KiotViet thật (không đoán được id hợp lệ để ghi rác có ý nghĩa), rủi ro chấp nhận được cho gói
  free hiện tại. Ghi rõ trong `SCHEMA.md`/`API_ENDPOINTS.md` để không bị quên nếu sau này cần thêm
  xác thực.
- **Không polling dồn dập ngay khi bật cờ** — lần đầu bật `KIOTVIET_SYNC_ENABLED=true`,
  `sync_checkpoints` rỗng (chưa có bản ghi) → mỗi entity module coi checkpoint rỗng là
  "bắt đầu từ `now() - 1 giờ`" (không phải "từ đầu lịch sử" — đó là việc của Giai đoạn 3 backfill,
  không phải Giai đoạn 2), tránh vô tình kéo toàn bộ lịch sử qua polling thường trực.

## Task List

### Task 0 (điều kiện tiên quyết, không phải task code): Xác nhận Giai đoạn 1 đã hoàn tất

**Description:** Trước khi bắt đầu Task 1, xác nhận đúng checkpoint cuối
`docs/04-planning/2026-09-14-phase1-plan-supabase-kiotviet-sync.md`: `server/db/pool.js`,
`server/db/migrate.js`, 16 bảng + `sync_checkpoints` đã tồn tại thật trên Supabase project (không
chỉ trong tài liệu), `server/db/SCHEMA.md` đã được viết. Nếu chưa, dừng và hoàn tất Giai đoạn 1
trước — Task 1 trở đi trong kế hoạch này giả định `require('../db/pool').getPool()` dùng được và
schema đã đúng như `SCHEMA.md` mô tả.

**Acceptance criteria:**
- [ ] `server/db/` tồn tại với `pool.js`, `migrate.js`, `migrations/000*.sql`, `SCHEMA.md`.
- [ ] Query thủ công trên Supabase xác nhận đủ 16 bảng + `sync_checkpoints` + `schema_migrations`.

**Dependencies:** Toàn bộ Giai đoạn 1.

---

### Task 1: `server/kiotvietSync/config.js` — đọc & xác thực cấu hình 2 cơ sở

**Description:** Tách logic đọc credentials theo cơ sở (hiện đang lặp lại tương lai nếu copy trực
tiếp từ `stockoutCheckRoutes.js`) thành 1 module dùng chung cho toàn bộ `kiotvietSync/`. Trả về
danh sách cấu hình cho **cả 2 cơ sở** cùng lúc (khác `readKiotVietConfig(branch)` hiện có — hàm đó
nhận 1 branch, trả lỗi throw nếu thiếu; module mới trả **danh sách các cơ sở có đủ cấu hình**, bỏ
qua — không throw — cơ sở nào thiếu, kèm log cảnh báo rõ ràng, để 1 cơ sở thiếu cấu hình không
chặn cơ sở còn lại chạy).

```js
// server/kiotvietSync/config.js
function getConfiguredBranches() {
  // Doc bien moi trung truc tiep (khong qua CONFIG.js - engine nay doc rieng
  // vi CONFIG.js hien tai khong khai bao cac bien KIOTVIET_* theo branch).
  // Tra ve mang cac { branch: 'hanoi'|'saigon', clientId, clientSecret, retailer }
  // cho MOI co so co du ca 3 bien; co so thieu bi bo qua kem console.warn ro
  // rang (khong throw - 1 co so thieu cau hinh khong duoc chan co so con lai).
}
module.exports = { getConfiguredBranches };
```

**Acceptance criteria:**
- [ ] Cả 2 cơ sở đủ cấu hình → trả về mảng 2 phần tử, đúng thứ tự `hanoi` rồi `saigon`.
- [ ] Chỉ Hà Nội đủ cấu hình (thiếu `KIOTVIET_RETAILER_SG`) → trả về mảng 1 phần tử (`hanoi`), có
      `console.warn` nêu rõ lý do bỏ qua Sài Gòn — không throw.
- [ ] Không cơ sở nào đủ cấu hình → trả về mảng rỗng, có cảnh báo — không throw (fail-soft, đúng
      tinh thần `KIOTVIET_SYNC_ENABLED` không được làm sập server).
- [ ] Dùng đúng logic fallback đã có (`_SG` thiếu thì lấy biến gốc) khớp 100% với
      `readKiotVietConfig` hiện tại ở `stockoutCheckRoutes.js` (không đổi hành vi fallback đang
      chạy production).

**Verification:**
- [ ] Test tự động `server/kiotvietSync/config.test.js`: 3 trường hợp trên (set/không set biến qua
      `process.env` giả lập trong test, không đọc `.env` thật).
- [ ] `npm test` (server) pass.

**Dependencies:** Task 0

**Files likely touched:**
- `server/kiotvietSync/config.js` (mới)
- `server/kiotvietSync/config.test.js` (mới)

**Estimated scope:** XS (1-2 files)

---

### Task 2: `server/kiotvietSync/checkpointRepository.js` — đọc/ghi `sync_checkpoints`

**Description:** Module bọc 3 thao tác trên bảng `sync_checkpoints` (đã tạo ở Giai đoạn 1 Task 3):
`getCheckpoint(branch, entity)` (trả `null` nếu chưa có bản ghi — nghĩa là lần đầu), `advanceCheckpoint(branch, entity, syncedAt, { client })` (nhận **transaction client** đang mở, không tự mở
transaction riêng — Task 5 sẽ gọi trong cùng transaction với việc ghi dữ liệu, đúng nguyên tắc
"checkpoint chỉ tiến khi ghi thành công"), `recordFailure(branch, entity, errorMessage)` (ghi
`note` mô tả lỗi gần nhất, không đổi `last_synced_at` — chỉ để quan sát qua API nội bộ Giai đoạn 4).

**Acceptance criteria:**
- [ ] `getCheckpoint('hanoi', 'invoices')` khi bảng rỗng trả `null`.
- [ ] `advanceCheckpoint` dùng `INSERT ... ON CONFLICT (branch, entity) DO UPDATE SET
      last_synced_at = EXCLUDED.last_synced_at, last_success_at = now()`.
- [ ] `advanceCheckpoint` nhận tham số `client` (pg `PoolClient` đang trong transaction) thay vì tự
      gọi `getPool().query` — bắt buộc để đảm bảo cùng transaction với Task 5.

**Verification:**
- [ ] Test tích hợp tùy chọn (giống pattern Task 9 Giai đoạn 1: skip nếu không có
      `SUPABASE_DB_URL`) — `server/kiotvietSync/checkpointRepository.integration.test.js`.
- [ ] `npm test` pass (test tích hợp skip khi chưa cấu hình).

**Dependencies:** Task 0 (cần bảng `sync_checkpoints` thật)

**Files likely touched:**
- `server/kiotvietSync/checkpointRepository.js` (mới)
- `server/kiotvietSync/checkpointRepository.integration.test.js` (mới)

**Estimated scope:** Small (1-2 files)

---

### Task 3: `server/kiotvietSync/entities/categories.js` — entity module mẫu đầu tiên (đơn giản nhất)

**Description:** Đây là **entity mẫu** để chốt "hình dạng" chung mọi entity module khác sẽ theo
(Task 4 nhân rộng cho 7 entity còn lại). Chọn `categories` làm mẫu vì đơn giản nhất (không có bảng
chi tiết con, tham số incremental chuẩn `lastModifiedFrom`, đã xác minh trong `API_ENDPOINTS.md`).

Mỗi entity module export đúng 1 hàm `syncPage(kiotVietClient, branch, sinceIso, pgClient)` — nhận
1 **trang** đã fetch sẵn từ `fetchAllPages` (driver dùng chung ở Task 5 gọi `fetchAllPages` và
truyền từng trang vào đây qua callback), thực hiện `UPSERT` các bản ghi trong trang đó vào bảng
tương ứng. Việc tách "1 trang" thay vì "toàn bộ entity" là để driver dùng chung (Task 5) kiểm soát
transaction theo từng trang (advance checkpoint sau mỗi trang thành công, không phải sau cả entity
— quan trọng với `invoices`/`orders` có hàng chục nghìn bản ghi, lỗi giữa chừng không mất tiến độ
các trang trước).

```js
// server/kiotvietSync/entities/categories.js
module.exports = {
  entity: 'categories',
  endpoint: 'categories',
  listQuery: { hierachicalData: 'false' }, // dung dung chinh ta loi cua KiotViet - xem API_ENDPOINTS.md
  incrementalParam: 'lastModifiedFrom',
  hasUpperBound: true,
  async upsertPage(pgClient, branch, items) {
    // Voi moi item trong items: INSERT INTO categories (...) VALUES (...)
    // ON CONFLICT (branch, id) DO UPDATE SET ... , raw = EXCLUDED.raw,
    // synced_at = now();
    // Dung pgClient.query voi placeholder, KHONG noi chuoi SQL truc tiep tu du
    // lieu KiotViet (tranh SQL injection du du lieu la tu API tin cay).
  }
};
```

**Acceptance criteria:**
- [ ] `upsertPage` ghi đúng cột `id, parent_id, name, rank, modified_date, raw` như schema Giai
      đoạn 1 Task 3.
- [ ] Gọi `upsertPage` 2 lần với cùng dữ liệu → không tạo bản ghi trùng, không lỗi (idempotent).
- [ ] `raw` lưu đúng nguyên văn object KiotViet trả về cho từng item (không lọc field).
- [ ] Field không có trong response KiotViet (ví dụ `rank` thiếu ở 1 số bản ghi cũ) → ghi `NULL`,
      không throw.

**Verification:**
- [ ] Test tự động `server/kiotvietSync/entities/categories.test.js` dùng pg client giả (mock ghi
      lại câu lệnh + tham số đã gọi, không cần Postgres thật) — xác nhận đúng SQL/tham số cho 1
      trang mẫu 3 item (kể cả 1 item thiếu field).
- [ ] Test tích hợp tùy chọn: upsert thật vào Supabase test, đọc lại xác nhận đúng giá trị.

**Dependencies:** Task 0

**Files likely touched:**
- `server/kiotvietSync/entities/categories.js` (mới)
- `server/kiotvietSync/entities/categories.test.js` (mới)

**Estimated scope:** Small (1-2 files)

---

### Task 4: 7 entity module còn lại (`products`, `customers`, `suppliers`, `invoices`, `orders`, `returns`, `purchases`) + `cashFlows.js`

**Description:** Nhân rộng hình dạng Task 3 cho từng entity, theo đúng bảng tham số trong
`API_ENDPOINTS.md`. 3 nhóm khác biệt cần xử lý riêng:

1. **Có bảng chi tiết con** (`invoices`→`invoice_details`+`invoice_payments`, `orders`→
   `order_details`, `returns`→`return_details`, `purchases`→`purchase_details`): `upsertPage` thực
   hiện, cho mỗi item cha, trong cùng câu lệnh nhóm: `UPSERT` bảng cha, rồi
   `DELETE FROM <detail_table> WHERE branch=$1 AND <parent>_id=$2`, rồi `INSERT` lại toàn bộ mảng
   dòng chi tiết lấy từ `item.invoiceDetails`/`item.orderDetails`/... (tên field lấy đúng từ
   `API_ENDPOINTS.md`, xác minh case-sensitivity thật khi code, không đoán từ tài liệu này).
2. **`cashFlows.js` không dùng `lastModifiedFrom`** (API bỏ qua tham số này — đã xác minh) — module
   này có chữ ký khác 1 chút: nhận `(pgClient, branch, { startDate, endDate })` thay vì `sinceIso`
   đơn, và driver (Task 5) phải gọi entity này theo nhánh xử lý riêng: gọi client API **2 lần**
   (`isReceipt=true` rồi `isReceipt=false`), gộp kết quả trước khi `upsertPage`. Checkpoint của
   entity này lưu `endDate` của lần chạy gần nhất vào cột `note` (dạng ISO string), **không** dùng
   `last_synced_at` cho mục đích tính khoảng ngày lần sau (chỉ set `last_synced_at` để hiển thị "lần
   chạy gần nhất" ở API nội bộ Giai đoạn 4).
3. **`orders`/`returns` không có tham số chặn trên** (`hasUpperBound: false`) — driver (Task 5) khi
   polling các entity này **không** truyền thêm tham số chặn trên (đã xác nhận bị API bỏ qua hoàn
   toàn), chấp nhận mỗi lần polling tải lại từ mốc checkpoint đến hiện tại (dữ liệu tăng dần, không
   phải toàn bộ lịch sử vì checkpoint tiến dần theo mỗi lần polling thành công).

**Acceptance criteria:**
- [ ] 8 file entity module (`products.js`, `customers.js`, `suppliers.js`, `invoices.js`,
      `orders.js`, `returns.js`, `purchases.js`, `cashFlows.js`) export đúng hình dạng đã chốt ở
      Task 3 (riêng `cashFlows.js` có chữ ký khác như mô tả).
- [ ] `invoices.js`/`orders.js`/`returns.js`/`purchases.js` xử lý đúng bảng chi tiết con bằng
      `DELETE` + `INSERT` lại toàn bộ (không upsert từng `line_no`).
- [ ] `invoices.js` ghi cả `invoice_payments` (từ field payment lồng trong response, tên field xác
      minh khi code) bằng cùng cơ chế `DELETE`+`INSERT`.
- [ ] Mỗi item cha ghi `staff` (upsert tối thiểu `id` + `last_seen_at = now()`, `name` nếu response
      có field tên nhân viên) từ `SoldById`/`CreatedById`/`UserId` — dùng chung 1 hàm helper
      `upsertStaffFromEntity(pgClient, branch, staffId, staffName)` đặt trong
      `server/kiotvietSync/staffSync.js` (tên file đã có tiền lệ nhắc tới trong
      `API_ENDPOINTS.md`), gọi từ cả 4 entity trên trong cùng transaction.

**Verification:**
- [ ] Mỗi entity có test tự động riêng theo pattern Task 3 (mock pg client), tổng cộng 8 file test
      mới + 1 file test cho `staffSync.js`.
- [ ] Test tích hợp tùy chọn cho `cashFlows.js` xác nhận gọi API 2 lần (`isReceipt=true/false`) và
      gộp đúng.
- [ ] `npm test` pass toàn bộ.

**Dependencies:** Task 3 (dùng chung hình dạng đã chốt)

**Files likely touched:**
- `server/kiotvietSync/entities/products.js`, `customers.js`, `suppliers.js`, `invoices.js`,
  `orders.js`, `returns.js`, `purchases.js`, `cashFlows.js` (mới, 8 file)
- `server/kiotvietSync/entities/*.test.js` tương ứng (mới, 8 file)
- `server/kiotvietSync/staffSync.js` (mới)
- `server/kiotvietSync/staffSync.test.js` (mới)

**Estimated scope:** Large — **nên chia thành 3-4 sub-PR theo nhóm** (nhóm 1: `products`+
`customers`+`suppliers` — giống `categories`, không bảng con; nhóm 2: `invoices`+`orders` — có bảng
con, khối lượng lớn; nhóm 3: `returns`+`purchases` — có bảng con; nhóm 4: `cashFlows`+`staffSync`
— chữ ký khác). Không merge thành 1 PR duy nhất dù mô tả gộp chung 1 task ở đây cho gọn tài liệu.

---

### Task 5: `server/kiotvietSync/syncDriver.js` — driver dùng chung (đọc checkpoint → gọi API/nhận payload → ghi → advance checkpoint)

**Description:** Đây là phần lõi nối mọi thứ lại — dùng chung cho cả polling (Task 6) lẫn webhook
(Task 7, dùng đường tắt khác — xem Task 7).

```js
// server/kiotvietSync/syncDriver.js
async function pollEntityOnce(kiotVietClient, branch, entityModule) {
  // 1. checkpoint = await checkpointRepository.getCheckpoint(branch, entityModule.entity)
  // 2. sinceIso = checkpoint?.last_synced_at ?? (now() - 1h)  -- xem nguyen tac
  //    "khong polling don dap ngay khi bat co"
  // 3. Voi moi trang tu kiotVietClient.fetchAllPages(entityModule.endpoint, {
  //      ...entityModule.listQuery, [entityModule.incrementalParam]: sinceIso
  //    }, onPage):
  //    a. Mo 1 transaction Postgres (BEGIN).
  //    b. entityModule.upsertPage(pgClient, branch, page.items).
  //    c. checkpointRepository.advanceCheckpoint(branch, entityModule.entity, now(), { client: pgClient }).
  //    d. COMMIT. Loi o buoc b/c => ROLLBACK, throw (dung vong lap, checkpoint
  //       giu nguyen tu lan COMMIT gan nhat - dung nguyen tac da chot).
  // 4. Bat loi tang cap ham goi (Task 6) quyet dinh log/retry, driver nay
  //    khong tu retry entity - moi lan polling la 1 lan thu, that bai thi cho
  //    vong polling ke tiep.
}
```

**Acceptance criteria:**
- [ ] Checkpoint rỗng (lần đầu) → `sinceIso = now() - 1h`, không kéo toàn bộ lịch sử.
- [ ] Mỗi trang là 1 transaction riêng — trang 3/5 lỗi thì trang 1-2 đã COMMIT giữ nguyên, checkpoint
      đứng ở cuối trang 2 (không phải đầu entity).
- [ ] Entity `cashFlows` đi qua nhánh riêng (gọi 2 lần `isReceipt`, gộp trước khi coi là "1 trang" —
      không cần phân trang kiểu `currentItem` như các entity khác vì khối lượng cash_flows nhỏ hơn
      nhiều, xác nhận lại số lượng thật khi code, nếu lớn thì vẫn áp dụng `fetchAllPages` bình
      thường cho mỗi lượt `isReceipt`).
- [ ] Entity có `hasUpperBound: false` (`orders`, `returns`) không truyền tham số chặn trên vào
      `fetchAllPages`.

**Verification:**
- [ ] Test tự động `server/kiotvietSync/syncDriver.test.js`: dùng `kiotVietClient` giả (trả sẵn 2-3
      trang cố định) + pg client giả (mock transaction, có thể ép lỗi ở trang bất kỳ để kiểm tra
      rollback đúng) + `checkpointRepository` giả. Không cần Postgres/KiotViet thật.
- [ ] Test riêng: checkpoint rỗng → gọi API với `sinceIso` đúng bằng `now() - 1h` (dùng `now` tiêm
      qua tham số như `kiotVietApiClient.js` đã làm, để test không phụ thuộc đồng hồ thật).
- [ ] `npm test` pass.

**Dependencies:** Task 2, Task 4 (cần entity module thật để test end-to-end với mock, dù có thể bắt
đầu code song song với Task 4 dùng entity module giả tối giản)

**Files likely touched:**
- `server/kiotvietSync/syncDriver.js` (mới)
- `server/kiotvietSync/syncDriver.test.js` (mới)

**Estimated scope:** Medium (1-2 file, logic lõi phức tạp nhất của Giai đoạn 2)

---

### Task 6: Bộ lập lịch polling đối soát (2 nhịp: 5-10 phút và 15-30 phút, cả 2 cơ sở song song)

**Description:** `server/kiotvietSync/scheduler.js`, khởi động bằng 1 hàm `startPollingScheduler()`
gọi từ `server/index.js` trong `startServer()`, **ch�ỉ khi** `CONFIG.KIOTVIET_SYNC_ENABLED === true`
— theo đúng pattern bật/tắt có điều kiện đã dùng cho Telegram bot HR ở cuối `server/index.js` (xem
Context). Dùng `setInterval` thuần (không thêm dependency cron), 2 timer riêng:

- Timer "nhanh" (mặc định 7 phút, cấu hình qua `KIOTVIET_SYNC_FAST_INTERVAL_MS`, biến này **thêm
  mới ở Giai đoạn 2** — kế hoạch Giai đoạn 0 đã cố tình không thêm vì lúc đó chưa có code đọc):
  chạy `invoices`, `orders`.
- Timer "chậm" (mặc định 20 phút, `KIOTVIET_SYNC_SLOW_INTERVAL_MS`): chạy `categories`, `products`,
  `customers`, `suppliers`, `returns`, `purchases`, `cashFlows`.

Mỗi lần timer nổ: với mỗi cơ sở đã cấu hình (từ `config.getConfiguredBranches()`, Task 1), với mỗi
entity trong nhóm, gọi `syncDriver.pollEntityOnce` — dùng `Promise.allSettled` ở **cả 2 tầng** (2
cơ sở, và các entity trong cùng cơ sở) để 1 lỗi (1 cơ sở rate-limit, 1 entity lỗi tạm thời) không
chặn phần còn lại. Ghi log lỗi qua `checkpointRepository.recordFailure` thay vì chỉ `console.error`
— để API nội bộ Giai đoạn 4 nhìn thấy được entity nào đang lỗi.

**Acceptance criteria:**
- [ ] `KIOTVIET_SYNC_ENABLED=false` (mặc định) → `startPollingScheduler()` không được gọi, không
      timer nào chạy, không request nào tới KiotViet — xác nhận bằng cách server khởi động và chờ
      vài giây, không thấy log polling nào.
- [ ] `KIOTVIET_SYNC_ENABLED=true` nhưng `config.getConfiguredBranches()` trả mảng rỗng (thiếu hết
      credentials) → scheduler khởi động nhưng mỗi lần timer nổ chỉ log cảnh báo, không lỗi crash.
- [ ] 1 cơ sở lỗi (giả lập ép lỗi mạng) không chặn cơ sở còn lại tiếp tục polling ở lần chạy đó.
- [ ] 2 timer chạy độc lập đúng nhịp đã cấu hình (test bằng cách tiêm hàm `setInterval`/thời gian
      giả, không chờ thật 7-20 phút trong test).

**Verification:**
- [ ] Test tự động `server/kiotvietSync/scheduler.test.js`: tiêm `setIntervalFn`/`clearIntervalFn`
      giả (như cách `kiotVietApiClient.js` tiêm `now`), `pollEntityOnce` giả (đếm số lần gọi, có
      thể ép reject) — xác nhận đúng 4 tình huống trên mà không cần chờ thời gian thật.
- [ ] Test thủ công: set `KIOTVIET_SYNC_ENABLED=true` + 1 bộ credentials test trên môi trường dev,
      giảm tạm 2 interval xuống vài giây, quan sát log xác nhận cả 2 nhịp polling chạy và
      `sync_checkpoints` được cập nhật.
- [ ] `npm test` pass.

**Dependencies:** Task 5

**Files likely touched:**
- `server/kiotvietSync/scheduler.js` (mới)
- `server/kiotvietSync/scheduler.test.js` (mới)
- `server/config.js` (thêm 2 biến `KIOTVIET_SYNC_FAST_INTERVAL_MS`/`_SLOW_INTERVAL_MS`, fail-soft
  với giá trị mặc định như trên khi biến rỗng/không hợp lệ)
- `server/index.js` (gọi `startPollingScheduler()` có điều kiện trong `startServer()`)
- `server/.env.example` (2 dòng mới, để trống, comment giải thích + giá trị mặc định)

**Estimated scope:** Medium (3-5 files)

---

### Task 7: Thay logic thật vào webhook endpoint (thay stub Giai đoạn 0)

**Description:** Sửa [server/kiotviet/kiotvietWebhookRoutes.js](../../server/kiotviet/kiotvietWebhookRoutes.js): route vẫn trả `HTTP 200` **ngay lập tức** (giữ đúng dòng đầu tiên trong
handler), nhưng trước khi return, đẩy `req.body` vào 1 hàng đợi trong-tiến-trình (mảng + xử lý tuần
tự bằng 1 vòng lặp async chạy nền, dạng đơn giản nhất — không cần thư viện queue ngoài, khối lượng
webhook của 1 chuỗi bán lẻ 2 cơ sở không cần).

Vì tài liệu KiotViet không xác nhận cấu trúc payload webhook chi tiết cho từng loại sự kiện (khác
với response GET đã xác minh qua live probe), **bước đầu tiên trong xử lý nền phải là xác định loại
sự kiện + gian hàng nào gửi tới** dựa trên field có trong payload thật (chỉ biết chắc khi nhận được
request thật lần đầu tiên — sau khi Task 4 của Giai đoạn 0 deploy và ai đó đăng ký thử webhook).
**Nếu chưa nhận được ít nhất 1 payload mẫu thật, Task 7 dừng ở bước "log nguyên văn payload nhận
được vào console + 1 bảng tạm `webhook_events_raw (id, received_at, payload jsonb)`"** thay vì đoán
cấu trúc — tránh lặp lại rủi ro "đoán sai field" mà cơ chế `raw JSONB` ở Giai đoạn 1 đã cố tránh cho
GET response, webhook payload cũng cần cùng kỷ luật.

Sau khi có payload mẫu thật (xem Task 7b), map sự kiện sang lệnh gọi `syncDriver` tương ứng —
**không** ghi trực tiếp dữ liệu từ payload webhook vào bảng nghiệp vụ (payload thường chỉ có id +
loại sự kiện, không đủ field để upsert đúng schema); thay vào đó dùng payload để biết "cần đồng bộ
ngay entity X của cơ sở Y", rồi gọi lại **1 lần GET** entity đó theo id cụ thể (hoặc theo
`lastModifiedFrom = received_at - 1 phút` để bắt luôn các thay đổi lân cận) qua driver — tái dùng
100% logic `upsertPage` đã viết ở Task 4, không viết thêm code ghi dữ liệu riêng cho đường webhook.

**Acceptance criteria (Task 7a — làm ngay, không cần payload mẫu thật):**
- [ ] Route vẫn trả `200` trước khi xử lý gì (đo bằng test: mock hàng đợi xử lý chậm, xác nhận
      response trả về không chờ xử lý xong).
- [ ] Payload nhận được được đẩy vào hàng đợi trong-tiến-trình, xử lý tuần tự (không xử lý song song
      nhiều payload cùng lúc — tránh nhiều transaction Postgres tranh chấp ghi cùng 1 bản ghi).
- [ ] Payload không parse được (không phải JSON hợp lệ) → log lỗi, vẫn trả `200` (không được để
      KiotViet retry vô ích với payload luôn luôn lỗi).
- [ ] Bảng tạm `webhook_events_raw` được thêm bằng 1 migration mới
      (`server/db/migrations/0007_webhook_events_raw.sql`, nối tiếp 6 file migration Giai đoạn 1)
      — ghi mọi payload nhận được kèm `received_at`, dùng để phân tích cấu trúc thật sau này.

**Acceptance criteria (Task 7b — làm sau khi có payload mẫu thật, có thể là 1 sub-task riêng sau
khi Task 7a đã deploy và nhận được request thật từ KiotViet):**
- [ ] Xác định được field trong payload cho biết loại sự kiện (hóa đơn/đơn hàng/tồn kho) và gian
      hàng (`Retailer`/tên tương đương) — ghi phát hiện này vào `API_ENDPOINTS.md` (mục webhook,
      thêm mới) theo đúng kỷ luật "ghi lại nguồn xác minh" đã áp dụng cho GET endpoints.
- [ ] Xử lý nền gọi đúng `syncDriver`/entity module tương ứng với loại sự kiện, đúng cơ sở.
- [ ] 1 sự kiện webhook không xác định được loại/cơ sở → log cảnh báo, bỏ qua (không throw làm rớt
      cả hàng đợi các payload sau).

**Verification:**
- [ ] Test tự động cho Task 7a: `server/kiotviet/kiotvietWebhookRoutes.test.js` (đã có từ Giai đoạn
      0, mở rộng thêm case) — xác nhận trả 200 ngay cả khi xử lý nền được mock là chậm/lỗi.
- [ ] Test thủ công Task 7a: `curl -X POST .../api/kiotviet/webhook -d '<payload mẫu tự tạo>'`,
      xác nhận bản ghi xuất hiện trong `webhook_events_raw`.
- [ ] Task 7b verification chỉ chốt được sau khi có payload thật — ghi rõ đây là **giới hạn đã biết
      trước** của kế hoạch này, không phải thiếu sót khi lập kế hoạch.
- [ ] `npm test` pass cho toàn bộ Task 7a.

**Dependencies:** Task 5 (Task 7b cần `syncDriver` xong); Task 7a độc lập, có thể làm song song với
Task 3-6.

**Files likely touched:**
- `server/kiotviet/kiotvietWebhookRoutes.js` (sửa)
- `server/kiotviet/kiotvietWebhookRoutes.test.js` (sửa/mở rộng)
- `server/db/migrations/0007_webhook_events_raw.sql` (mới)
- `server/kiotviet/API_ENDPOINTS.md` (bổ sung mục webhook, sau khi có payload thật — Task 7b)

**Estimated scope:** Medium cho 7a (2-3 files) — Task 7b tách thành task riêng khi có dữ liệu thật,
không ước lượng scope trước vì phụ thuộc cấu trúc payload chưa biết.

---

### Checkpoint: Sau Task 1-7a (toàn bộ phần code chắc chắn làm được ngay)
- [ ] `npm test` (server) pass toàn bộ.
- [ ] `KIOTVIET_SYNC_ENABLED=false` (mặc định) → server khởi động, không request nào tới KiotViet,
      Dashboard Sheets hiện tại không có regression.
- [ ] Bật `KIOTVIET_SYNC_ENABLED=true` trên môi trường dev/staging với `SUPABASE_DB_URL` trỏ project
      Supabase thật (đã có schema từ Giai đoạn 1) + 1 bộ credentials KiotViet thật (ít nhất Hà Nội):
      polling chạy đúng nhịp, `sync_checkpoints` tiến lên, dữ liệu xuất hiện trong các bảng nghiệp
      vụ, đối chiếu thủ công vài bản ghi với giao diện KiotViet khớp nhau.
- [ ] Webhook stub cũ đã thay bằng Task 7a (log vào `webhook_events_raw`), sẵn sàng nhận payload
      thật để làm Task 7b.
- [ ] Deploy production, theo dõi log vài giờ đầu xác nhận không có 429 dồn dập (nếu có, tăng
      `KIOTVIET_SYNC_SLOW_INTERVAL_MS`/giảm số entity polling đồng thời — ghi vào rủi ro bên dưới).

---

### Task 8: API nội bộ xem tình trạng đồng bộ (chuẩn bị sớm cho Giai đoạn 4, làm trong Giai đoạn 2 vì cần ngay khi debug Task 6-7)

**Description:** Dù roadmap xếp "API nội bộ xem tình trạng đồng bộ" vào Giai đoạn 4, việc **debug
Task 6 (polling)/Task 7 (webhook)** trên môi trường thật gần như không thể quan sát được nếu không
có cách xem nhanh `sync_checkpoints` + vài bản ghi mẫu mà không cần vào thẳng Supabase SQL Editor
mỗi lần. Vì vậy kế hoạch này đưa 1 phiên bản tối giản của API đó vào Giai đoạn 2 (Giai đoạn 4 sẽ mở
rộng thêm, không phải viết lại).

`GET /api/internal/kiotviet-sync/status` (yêu cầu `requireAuth` + `requireRole` giới hạn vai trò
Quản lý — dùng đúng middleware đã có ở `server/auth/authMiddleware.js`, không tạo cơ chế auth
riêng): trả về, cho mỗi `(branch, entity)` trong `sync_checkpoints`: `last_synced_at`,
`last_success_at`, `note` (chứa lỗi gần nhất nếu có).

**Acceptance criteria:**
- [ ] Route yêu cầu đăng nhập + đúng vai trò, giống các route nội bộ khác trong `server/routes.js`.
- [ ] Trả JSON đúng dữ liệu `sync_checkpoints`, sắp theo `branch, entity`.
- [ ] `SUPABASE_DB_URL` chưa cấu hình → trả `503` với thông báo rõ ràng, không crash route khác.

**Verification:**
- [ ] Test tự động với pg client giả.
- [ ] Test thủ công: gọi qua trình duyệt/curl sau khi đăng nhập, đối chiếu với dữ liệu
      `sync_checkpoints` thật trên Supabase SQL Editor.

**Dependencies:** Task 6 (cần có checkpoint thật để xem)

**Files likely touched:**
- `server/kiotvietSync/kiotvietSyncStatusRoutes.js` (mới)
- `server/kiotvietSync/kiotvietSyncStatusRoutes.test.js` (mới)
- `server/routes.js` (mount route mới)

**Estimated scope:** Small (2-3 files)

---

### Checkpoint: Hoàn tất Giai đoạn 2
- [ ] Task 1-6, 7a, 8 merge, `npm test` pass toàn bộ.
- [ ] Polling đối soát chạy ổn định ≥ 24h trên production cho cả 2 cơ sở (nếu Sài Gòn đã đủ
      credentials theo Task 5/6 của kế hoạch Giai đoạn 0 — nếu chưa, Hà Nội chạy trước, Sài Gòn bật
      sau khi có credentials, không chặn checkpoint này).
- [ ] `GET /api/internal/kiotviet-sync/status` cho thấy mọi entity đều có `last_success_at` gần
      đây (trong vòng 1 nhịp polling chậm nhất, ~30 phút).
- [ ] Task 7b (webhook thật) đã có ít nhất 1 lần map thành công payload thật → dữ liệu Postgres —
      nếu chưa (do phụ thuộc đăng ký webhook thủ công ở Giai đoạn 0 Task 7 chưa xong), ghi rõ đây
      là hạng mục còn treo, không chặn việc coi Giai đoạn 2 "về cơ bản hoàn tất" vì polling đã đủ
      để có dữ liệu cận thời gian thực (webhook chỉ cải thiện độ trễ, không phải điều kiện tồn tại
      dữ liệu).
- [ ] Dashboard Sheets hiện tại không có regression trong suốt quá trình.
- [ ] Sẵn sàng chuyển sang Giai đoạn 3 (backfill dữ liệu lịch sử).

## Rủi ro & lưu ý

| Rủi ro | Ảnh hưởng | Giảm thiểu |
|---|---|---|
| Cấu trúc payload webhook thật khác giả định (chưa từng thấy payload thật tại thời điểm lập kế hoạch) | Cao cho Task 7b cụ thể, thấp cho toàn Giai đoạn 2 | Task 7 tách rõ 7a (an toàn, làm ngay, chỉ log raw) và 7b (cần payload thật mới làm được) — polling (Task 5-6) không phụ thuộc webhook nên vẫn đưa dữ liệu vào Postgres cận thời gian thực dù Task 7b bị trễ |
| 2 cơ sở polling đồng thời cả entity "nhanh" lẫn "chậm" có thể cộng dồn vượt burst thực tế (~600 req/phút) nếu nhiều entity cùng vào 1 nhịp và có nhiều trang | Trung bình | `Promise.allSettled` theo cơ sở không giới hạn concurrency giữa các entity cùng cơ sở trong task này ở mức tối thiểu — nếu log production cho thấy 429 xuất hiện, thêm 1 giới hạn đồng thời đơn giản (`runWithConcurrencyLimit`, tên đã có tiền lệ trong `API_ENDPOINTS.md`) giữa các entity cùng nhịp, coi là cải tiến Task 6 chứ không phải lỗi thiết kế chặn merge |
| Webhook không xác thực chữ ký — request giả có thể trigger đồng bộ lại 1 entity không cần thiết | Thấp (đã phân tích ở "Nguyên tắc thiết kế") | Idempotent tuyệt đối theo `(branch, id)`; nếu lạm dụng thấy rõ trên log, thêm rate-limit theo IP ở tầng route (không phải phạm vi Giai đoạn 2, ghi nhận cho sau) |
| `orders`/`returns` polling luôn kéo từ checkpoint tới hiện tại (không có chặn trên) — nếu 1 lần polling bị gián đoạn giữa chừng ở trang cuối cùng của tập rất lớn, lần sau tải lại gần hết tập đó | Thấp — chấp nhận theo đúng phân tích đã có trong `API_ENDPOINTS.md` (mục ghi chú `backfill.js`, áp dụng tương tự cho polling) | Không cần giảm thiểu thêm ở Giai đoạn 2 — bản chất `UPSERT` theo `(branch,id)` khiến tải lại không gây sai dữ liệu, chỉ tốn thêm request/thời gian; nếu tập dữ liệu quá lớn ảnh hưởng hiệu năng thấy rõ, cân nhắc ở Giai đoạn 3 khi đã có số liệu thật về khối lượng |
| `staff` suy luận từ nhiều entity cùng lúc ghi vào 1 bảng — 2 entity module chạy song song (khác cơ sở hoặc khác nhịp) có thể `UPSERT` cùng `(branch, staff_id)` gần như đồng thời | Thấp | PK `(branch, id)` + `ON CONFLICT DO UPDATE` của Postgres tự xử lý đúng (row-level lock trong transaction), không cần khóa ứng dụng thêm |

## Xác minh tổng thể cuối Giai đoạn 2

1. `npm test` (server) — toàn bộ pass.
2. Server khởi động với `KIOTVIET_SYNC_ENABLED=false` — không có bất kỳ hành vi mới nào so với
   trước Giai đoạn 2 (đối chiếu bằng cách so log khởi động trước/sau).
3. Bật cờ trên dev/staging, polling chạy ≥ vài giờ, đối chiếu thủ công số lượng bản ghi trong vài
   bảng (`invoices`, `products`) với tổng số hiển thị trên giao diện KiotViet (cho phép lệch nhỏ do
   độ trễ polling, không lệch lớn).
4. `GET /api/internal/kiotviet-sync/status` phản ánh đúng tiến độ thật.
5. Đăng ký thử 1 webhook thật (nếu Giai đoạn 0 Task 7 đã xong), xác nhận `webhook_events_raw` nhận
   được ít nhất 1 bản ghi — dùng bản ghi đó để hoàn thiện Task 7b ngay sau khi Giai đoạn 2 coi như
   xong phần polling.
6. Dashboard Sheets hiện tại (đăng nhập, xem báo cáo, kiểm tra đứt hàng cả 2 cơ sở) không có
   regression trong suốt quá trình bật thử nghiệm.
