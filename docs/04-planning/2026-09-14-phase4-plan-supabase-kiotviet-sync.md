# Kế hoạch chi tiết: Giai đoạn 4 — Kiểm thử & xác minh
### (từ Roadmap: Đưa dữ liệu KiotViet lên Supabase Postgres, cận thời gian thực, 2 cơ sở)

## Context

`docs/04-planning/2026-09-14-roadmap-supabase-kiotviet-sync.md` (mục 5, Giai đoạn 4) chốt phạm vi:

- Viết test tự động cho phần logic quan trọng (tính checkpoint, xử lý khi lỗi giữa chừng, xử lý
  riêng cho thu chi/đơn hàng/trả hàng) — không cần kết nối Postgres thật.
- 1 bộ test tích hợp (tùy chọn, tự bỏ qua nếu chưa cấu hình) chạy thật trên Supabase để xác nhận
  schema và câu lệnh ghi dữ liệu đúng.
- Thêm 1 API nội bộ (chỉ dùng để tự kiểm tra thủ công, có đăng nhập, không phải tính năng cho
  người dùng cuối) để xem tình trạng đồng bộ: checkpoint gần nhất, số bản ghi mỗi loại, vài dòng
  dữ liệu mẫu.
- Xác nhận Dashboard Sheets hiện tại vẫn hoạt động bình thường, không bị ảnh hưởng.

**Tình trạng thật tại thời điểm lập kế hoạch này (đã kiểm tra trực tiếp trong repo, không suy
đoán):** chỉ có 5 tài liệu kế hoạch (`roadmap` + `phase0`..`phase3`) tồn tại trong
`docs/04-planning/`. **Không có thư mục `server/db/` và không có thư mục `server/kiotvietSync/`**
trong repo — nghĩa là tính đến lúc viết kế hoạch Giai đoạn 4 này, **Giai đoạn 1, 2, 3 đều chưa
được code**, chỉ mới có kế hoạch chi tiết. Kế hoạch Giai đoạn 4 dưới đây viết dựa trên **giả định
tên module/bảng/route đã được thống nhất ở 3 kế hoạch trước** (không đặt tên mới tùy ý) — Task 0
bắt buộc xác nhận lại thực tế trước khi bắt đầu code, giống kỷ luật đã áp dụng nhất quán ở
`phase2-plan` và `phase3-plan`.

**Vì sao Giai đoạn 4 không phải là "viết test từ đầu":** Đọc kỹ 3 kế hoạch trước cho thấy phần lớn
việc roadmap liệt kê ở Giai đoạn 4 **đã được giao thành acceptance criteria/verification của từng
task riêng lẻ** ở Giai đoạn 2-3, không phải để dồn hết vào cuối:
- Mỗi entity module (`categories.js`, `invoices.js`, `cashFlows.js`...) đã có file `.test.js` riêng
  dùng pg client giả (phase2 Task 3-4).
- `syncDriver.test.js` (phase2 Task 5) đã test rollback khi lỗi giữa trang, checkpoint không tiến
  khi lỗi.
- `scheduler.test.js` (phase2 Task 6) đã test 2 nhịp polling, cơ sở lỗi không chặn cơ sở khác.
- `GET /api/internal/kiotviet-sync/status` **đã được tạo từ phase2 Task 8** (không phải mới ở Giai
  đoạn 4) — lý do nêu rõ trong `phase2-plan`: cần route này sớm để debug Task 6/7, Giai đoạn 4 chỉ
  "mở rộng thêm, không phải viết lại".
- `backfill_progress`, `reconcileCounts.js` (phase3 Task 2, 8) đã có sẵn cơ chế đối chiếu số lượng
  riêng cho backfill.

**Hệ quả cho kế hoạch này:** Giai đoạn 4 tập trung vào 3 việc thật sự còn thiếu, không trùng lặp
với 3 kế hoạch trước:
1. **Test khép kín cho các "đường nối"** giữa các module — những hành vi chỉ lộ ra khi ghép
   `syncDriver` + entity module + `checkpointRepository` chạy cùng nhau qua nhiều vòng lặp poll
   liên tiếp (crash giữa chừng rồi tự phục hồi đúng, 2 cơ sở không lẫn checkpoint của nhau), thay vì
   test từng module đơn lẻ như Giai đoạn 2 đã làm.
2. **1 bộ test tích hợp tổng hợp chạy thật trên Supabase** — Giai đoạn 1 Task 9 chỉ kiểm tra cấu
   trúc bảng (không ghi dữ liệu), Giai đoạn 2 chỉ có test tích hợp tùy chọn *rải rác* theo từng
   entity. Giai đoạn 4 gộp lại thành 1 bộ test end-to-end thật (ghi + đọc lại) cho đại diện đủ 3
   nhóm entity (đơn giản / có bảng con / thu chi đặc biệt).
3. **Mở rộng** (không viết lại) route status đã có, thêm số bản ghi mỗi loại + vài dòng mẫu +
   tổng quan `backfill_progress`, và làm 1 vòng xác minh cuối cùng cho toàn bộ roadmap (Giai đoạn
   0-4) trước khi coi nền tảng Postgres là "sẵn sàng" cho Giai đoạn 5 (chuyển Dashboard sang đọc
   Postgres — ngoài phạm vi kế hoạch này).

Tài liệu nguồn bắt buộc đọc trước khi code (theo `source-driven-development`, nhất quán với 3 kế
hoạch trước):
- `docs/04-planning/2026-09-14-phase1-plan-supabase-kiotviet-sync.md` — tên 16 bảng, PK
  `(branch, id)`, `server/db/SCHEMA.md`.
- `docs/04-planning/2026-09-14-phase2-plan-supabase-kiotviet-sync.md` — hình dạng entity module,
  `syncDriver.js`, `checkpointRepository.js`, route status đã có ở Task 8.
- `docs/04-planning/2026-09-14-phase3-plan-supabase-kiotviet-sync.md` — `backfill_progress`,
  `reconcileCounts.js`.
- `server/kiotviet/API_ENDPOINTS.md` — vẫn là nguồn xác minh duy nhất cho tham số/hành vi API thật.

## Nguyên tắc thiết kế đã chốt

- **Không viết lại test đã có** — mọi task dưới đây trước khi thêm file test mới phải xác nhận
  (đọc file `.test.js` đã tồn tại từ Giai đoạn 2-3) rằng tình huống đó *chưa* được test, tránh lặp
  lại đúng bộ assertion đã có ở nơi khác (khó bảo trì về sau, 2 nơi có thể trôi khỏi nhau).
- **Test "đường nối" chạy `syncDriver` thật (không mock `syncDriver`), chỉ mock `kiotVietClient` +
  pg client** — mục tiêu là bắt lỗi tích hợp giữa các module thật với nhau, mock càng ít tầng càng
  tốt, khác với test đơn lẻ từng entity module (mock `pgClient` trực tiếp, không qua `syncDriver`).
- **Bộ test tích hợp thật (Task 2) dùng chung 1 Supabase project test riêng biệt với project
  production** — không chạy trên project đang có dữ liệu backfill thật (rủi ro ghi/xóa nhầm dữ liệu
  thật). Biến môi trường test dùng tên khác (`SUPABASE_TEST_DB_URL`, **mới**, tách khỏi
  `SUPABASE_DB_URL` production) để không ai vô tình chạy `npm test` trỏ nhầm vào production.
- **Test tích hợp phải tự dọn dữ liệu đã ghi** (`DELETE` các bản ghi test tạo ra trong `afterAll`/
  `afterEach`, dùng `branch`/`id` cố định dễ nhận diện, ví dụ `id` âm hoặc tiền tố riêng không trùng
  dữ liệu KiotViet thật) — vì Supabase free tier giới hạn 500MB (rủi ro đã ghi ở phase1/phase3), test
  chạy lặp lại nhiều lần (CI) không được tích tụ rác.
- **Route status mở rộng vẫn dùng đúng `requireAuth`/`requireRole` đã áp dụng ở phase2 Task 8** —
  không đổi cơ chế auth, không thêm endpoint mới song song.
- **`backfill_progress` có thể chưa tồn tại khi route status được gọi** (nếu môi trường chưa chạy
  Giai đoạn 3) — route phải xử lý mềm (bảng không tồn tại → phần đó trả `null`/rỗng, không làm lỗi
  toàn bộ response), đúng tinh thần fail-soft xuyên suốt roadmap.
- **Xác nhận Dashboard Sheets không hồi quy là việc lặp lại ở mọi checkpoint, không chỉ cuối cùng**
  — vì Giai đoạn 4 là giai đoạn cuối của roadmap này (Giai đoạn 5 ngoài phạm vi), Task cuối phải là
  1 vòng xác minh tổng thể toàn bộ roadmap (Giai đoạn 0-4), không chỉ riêng phần việc Giai đoạn 4.

## Task List

### Task 0 (điều kiện tiên quyết, không phải task code): Xác nhận Giai đoạn 1-3 đã hoàn tất thật

**Description:** Trước khi code Task 1, xác nhận đúng checkpoint cuối của 3 kế hoạch trước đã đạt
trong thực tế (không chỉ trong tài liệu): `server/db/` với 16 bảng + `schema_migrations` +
`SCHEMA.md`; `server/kiotvietSync/` với đủ entity module, `syncDriver.js`, `scheduler.js`,
`checkpointRepository.js`, `staffSync.js`, route
`GET /api/internal/kiotviet-sync/status` đã hoạt động; `backfillProgressRepository.js`,
`backfill.js`, `reconcileCounts.js` (Giai đoạn 3) đã merge và đã backfill xong ít nhất Hà Nội. Nếu
thiếu bất kỳ phần nào, dừng và hoàn tất giai đoạn tương ứng trước — Task 1 trở đi giả định toàn bộ
API/bảng trên dùng được thật.

**Acceptance criteria:**
- [ ] `server/db/`, `server/kiotvietSync/` tồn tại thật trong repo với đủ file đã liệt kê ở
      phase1/phase2/phase3.
- [ ] `KIOTVIET_SYNC_ENABLED=true` đang chạy ổn định trên production cho ít nhất Hà Nội,
      `GET /api/internal/kiotviet-sync/status` trả `last_success_at` gần đây cho mọi entity.
- [ ] Backfill Hà Nội (phase3 Task 9) đã hoàn tất, `reconcileCounts.js` không còn lệch lớn.

**Dependencies:** Toàn bộ Giai đoạn 1, 2, 3.

---

### Task 1: Test "đường nối" cho phục hồi sau lỗi giữa chừng (`server/kiotvietSync/syncRecovery.test.js`)

**Description:** File test mới, **không lặp lại** assertion đã có trong `syncDriver.test.js` (phase2
Task 5, vốn test 1 lần gọi `pollEntityOnce` bị lỗi giữa trang). Task này test **chuỗi nhiều lần gọi
`pollEntityOnce` liên tiếp**, mô phỏng đúng kịch bản vận hành thật: lần 1 lỗi giữa chừng (giả lập
crash sau khi commit trang 2/4), lần 2 gọi lại `pollEntityOnce` cho cùng entity/branch — xác nhận
hệ thống **tự phục hồi đúng** mà không cần can thiệp thủ công (đây là hành vi mà roadmap gọi là "xử
lý khi lỗi giữa chừng", nhưng ở cấp độ chuỗi vận hành nhiều lần poll, không phải 1 lần gọi đơn lẻ).

Dùng `kiotVietClient` giả (trả sẵn 4 trang cố định cho 1 entity) + pg client giả (mock transaction,
đếm số `INSERT`/`UPDATE` đã gọi) + `checkpointRepository` thật (không mock, vì đây chính là phần
cần xác nhận hoạt động đúng qua nhiều lần gọi) chạy trên pg client giả.

**Acceptance criteria:**
- [ ] Lần 1: trang 1-2 commit thành công, trang 3 ném lỗi giả lập → `pollEntityOnce` throw, checkpoint
      dừng đúng ở mốc cuối trang 2 (không phải mốc trang 3 hay mốc ban đầu).
- [ ] Lần 2 (gọi lại ngay sau lần 1, cùng tham số): `sinceIso` truyền cho `kiotVietClient` đúng bằng
      checkpoint đã lưu ở cuối trang 2 — không phải `now() - 1h` (không "quên" tiến độ đã có), và
      không phải tải lại từ trang 1 (dù bản chất trang 1-2 gọi lại API vẫn có thể trả về do nằm
      trong khoảng `sinceIso`, upsert lại là an toàn — đây là hành vi **được chấp nhận**, chỉ cần
      xác nhận **không tải lại từ trước checkpoint đã lưu**).
- [ ] Lần 2 chạy hết 4 trang không lỗi → checkpoint tiến tới mốc cuối trang 4.
- [ ] Test riêng: 2 cơ sở (`hanoi`, `saigon`) gọi `pollEntityOnce` cho cùng 1 `entity` gần như đồng
      thời (2 Promise chạy song song trong test) — checkpoint của `hanoi` và `saigon` **không lẫn
      vào nhau** (đọc đúng theo PK `(branch, entity)`, không có state module-scope nào bị chia sẻ
      nhầm giữa 2 lần gọi).

**Verification:**
- [ ] `npm test` (server) pass — file mới, không sửa file test đã có của Giai đoạn 2.
- [ ] Review thủ công: đối chiếu với `syncDriver.test.js` để xác nhận không có assertion trùng lặp
      (nếu trùng, xóa bớt ở 1 trong 2 nơi, ưu tiên giữ ở nơi test chi tiết hơn).

**Dependencies:** Task 0

**Files likely touched:**
- `server/kiotvietSync/syncRecovery.test.js` (mới)

**Estimated scope:** Small (1 file, không sửa code nguồn)

---

### Task 2: Test "điều phối đặc biệt" cho thu chi/đơn hàng/trả hàng ở cấp `syncDriver` (`server/kiotvietSync/syncDriverSpecialCases.test.js`)

**Description:** Phase2 Task 4 đã test **entity module** `cashFlows.js`/`orders.js`/`returns.js` tự
thân xử lý đúng tham số. Task này test rằng **`syncDriver.js` — tầng điều phối gọi các entity module
đó — dispatch đúng nhánh đặc biệt**, không phải trách nhiệm của entity module tự lo (đây là "đường
nối" thứ 2, khác Task 1):
- `cashFlows`: `syncDriver` phải gọi `kiotVietClient` **đúng 2 lần** (`isReceipt=true` rồi
  `isReceipt=false`) cho 1 lần `pollEntityOnce`, gộp kết quả trước khi coi là "1 trang" để upsert,
  và ghi khoảng ngày đã dùng vào `checkpointRepository` qua cột `note` (không dùng
  `last_synced_at` để tính khoảng ngày lần sau — xác nhận `syncDriver` đọc lại đúng `note` này ở
  lần gọi kế tiếp, không tính lại từ `last_synced_at`).
- `orders`/`returns` (`hasUpperBound: false`): xác nhận tham số truyền vào
  `kiotVietClient.fetchAllPages` **không có bất kỳ tham số chặn trên nào** (kiểm tra object query
  đầy đủ được truyền, không chỉ kiểm tra sự có mặt của `lastModifiedFrom`).
- 1 entity thường (`hasUpperBound: true`, ví dụ `invoices`) đối chứng — xác nhận **có** tham số
  chặn trên tương ứng, để phân biệt rõ nhánh đặc biệt và nhánh thường không bị lẫn logic.

**Acceptance criteria:**
- [ ] `cashFlows` gọi API đúng 2 lần/1 lần poll, đúng thứ tự `isReceipt=true` trước.
- [ ] `cashFlows` lần poll thứ 2 dùng đúng `startDate` = `endDate` đã lưu ở `note` của lần poll
      trước (không dùng `now() - 1h` lại từ đầu mỗi lần, trừ khi checkpoint rỗng thật sự).
- [ ] `orders`/`returns`: object query gọi `fetchAllPages` không chứa tham số chặn trên.
- [ ] `invoices` (đối chứng): object query có tham số chặn trên đúng tên (theo `API_ENDPOINTS.md`).

**Verification:**
- [ ] `npm test` pass.
- [ ] Review thủ công đối chiếu `syncDriver.test.js` (phase2) — không lặp assertion.

**Dependencies:** Task 0

**Files likely touched:**
- `server/kiotvietSync/syncDriverSpecialCases.test.js` (mới)

**Estimated scope:** Small (1 file, không sửa code nguồn)

---

### Checkpoint: Sau Task 1-2 (test đường nối, không cần Postgres thật)
- [ ] `npm test` (server) pass toàn bộ.
- [ ] Không có file test nào bị trùng lặp assertion với Giai đoạn 2 (đã review thủ công).

---

### Task 3: Bộ test tích hợp tổng hợp chạy thật trên Supabase (`server/kiotvietSync/integration/fullSync.integration.test.js`)

**Description:** Đây là phần lõi của roadmap mục "1 bộ test tích hợp (tùy chọn, tự bỏ qua nếu chưa
cấu hình) chạy thật trên Supabase để xác nhận schema và câu lệnh ghi dữ liệu đúng". Khác test tích
hợp rải rác theo từng entity (phase2 Task 3/4, tùy chọn per-file), file này là **1 bộ end-to-end
duy nhất** chạy `syncDriver.pollEntityOnce` thật (không mock `pgClient`, chỉ mock `kiotVietClient`)
trên **Supabase project test riêng** (`SUPABASE_TEST_DB_URL`), cho 3 entity đại diện đủ 3 nhóm hành
vi khác nhau:

1. `categories` — đại diện nhóm đơn giản (không bảng con).
2. `invoices` — đại diện nhóm có bảng con + `invoice_payments` + tác dụng phụ `staffSync` (xác
   nhận `INSERT` cha, `DELETE`+`INSERT` bảng con, và `staff` được upsert đúng, tất cả trong 1
   transaction).
3. `cash_flows` — đại diện nhóm gọi API 2 lần + checkpoint qua `note`.

Đầu file kiểm tra `process.env.SUPABASE_TEST_DB_URL` — rỗng thì `describe.skip`/`test.skip` toàn bộ
(không fail CI), giống pattern đã dùng ở phase1 Task 9 và phase2 Task 2 (integration test tùy
chọn), nhưng đọc biến **mới** `SUPABASE_TEST_DB_URL` (không phải `SUPABASE_DB_URL` production —
xem "Nguyên tắc thiết kế").

Mỗi test: gọi `pollEntityOnce` với `kiotVietClient` giả trả 1-2 trang dữ liệu mẫu cố định (dữ liệu
`id` dùng số âm hoặc tiền tố `TEST_` để không đụng dữ liệu backfill thật nếu lỡ trỏ nhầm project) →
query lại bảng thật bằng `pg` client → xác nhận đúng cột, đúng giá trị, đúng `raw` JSONB, checkpoint
đã tiến. `afterEach` xóa sạch các bản ghi test vừa tạo (theo `id` đã biết trước).

**Acceptance criteria:**
- [ ] Không set `SUPABASE_TEST_DB_URL` → toàn bộ test trong file này ở trạng thái skip, `npm test`
      vẫn pass.
- [ ] Có set, trỏ Supabase project test rỗng/riêng: cả 3 kịch bản trên chạy thật, dữ liệu xuất hiện
      đúng khi query lại, checkpoint tiến đúng.
- [ ] Chạy lại toàn bộ file 2 lần liên tiếp (giống migration idempotent) không để lại bản ghi rác
      (dọn sạch ở `afterEach`, xác nhận bằng `SELECT COUNT(*)` về 0 sau khi test xong).
- [ ] Test `invoices`: `invoice_details`/`invoice_payments` có đúng số dòng, `staff` bảng có bản ghi
      tương ứng `sold_by_id` trong dữ liệu mẫu.

**Verification:**
- [ ] `npm test` không set biến — thấy toàn bộ suite "skipped".
- [ ] Chạy thủ công (không phải CI) với `SUPABASE_TEST_DB_URL` trỏ 1 Supabase project test (tạo
      mới, miễn phí, tách biệt hoàn toàn với project production) đã chạy `npm run db:migrate` — xác
      nhận pass.

**Dependencies:** Task 0

**Files likely touched:**
- `server/kiotvietSync/integration/fullSync.integration.test.js` (mới)
- `server/.env.example` (thêm dòng `SUPABASE_TEST_DB_URL=` để trống, có comment giải thích khác
  `SUPABASE_DB_URL`)

**Estimated scope:** Medium (2 file, cần cẩn thận dọn dữ liệu test đúng)

---

### Task 4: Mở rộng `GET /api/internal/kiotviet-sync/status` — số bản ghi mỗi loại + dòng mẫu + tổng quan backfill

**Description:** **Sửa** (không viết lại) `server/kiotvietSync/kiotvietSyncStatusRoutes.js` đã tạo
ở phase2 Task 8 (hiện chỉ trả `sync_checkpoints`). Thêm vào response:
- `counts`: với mỗi bảng nghiệp vụ trong 16 bảng (trừ bảng con `*_details`/`*_payments`, chỉ đếm
  bảng cha + `staff`), chạy `SELECT branch, COUNT(*) FROM <table> GROUP BY branch` — trả object
  `{ [table]: { hanoi: N, saigon: N } }`.
- `samples`: với mỗi bảng cha, `SELECT * FROM <table> WHERE branch=$1 ORDER BY modified_date DESC
  NULLS LAST LIMIT 3` (hoặc `synced_at DESC` cho bảng không có `modified_date` như `cash_flows`) —
  dùng để đối chiếu thủ công bằng mắt với giao diện KiotViet, đúng mục đích roadmap nêu.
- `backfillProgress` (tùy chọn — chỉ có nếu Giai đoạn 3 đã chạy): tổng số chunk theo từng
  `status` (`pending`/`running`/`done`/`error`) nhóm theo `(branch, entity)`. Nếu bảng
  `backfill_progress` chưa tồn tại (Postgres báo lỗi `relation does not exist`), trả `null` cho
  trường này thay vì để lỗi làm hỏng cả response — bắt lỗi cụ thể theo mã lỗi Postgres
  (`42P01`), không bắt lỗi chung chung che giấu lỗi thật khác.

**Acceptance criteria:**
- [ ] Response giữ nguyên field `checkpoints` đã có (không đổi hợp đồng cũ, tránh phá bất kỳ ai/gì
      đang gọi route này).
- [ ] Thêm đúng `counts`, `samples`, `backfillProgress` như trên.
- [ ] `backfill_progress` chưa tồn tại → `backfillProgress: null`, phần còn lại của response vẫn
      đầy đủ, HTTP status vẫn `200`.
- [ ] Vẫn giữ nguyên `requireAuth`/`requireRole` và trả `503` khi `SUPABASE_DB_URL` chưa cấu hình
      (hành vi cũ từ phase2 Task 8, không đổi).
- [ ] `samples` không rò rỉ toàn bộ `raw` JSONB nếu chứa dữ liệu nhạy cảm không cần thiết cho việc
      đối chiếu thủ công (SĐT khách hàng, ví dụ) — cân nhắc lược bớt cột `raw` khỏi `samples`, chỉ
      trả các cột "first-class" đã đủ để đối chiếu (quyết định cụ thể khi code, ưu tiên tối giản dữ
      liệu trả về hơn là tiện lợi debug, vì route này dù có `requireRole` vẫn là 1 endpoint HTTP
      thật).

**Verification:**
- [ ] Test tự động (sửa `kiotvietSyncStatusRoutes.test.js` đã có từ phase2 Task 8, thêm case mới)
      với pg client giả — xác nhận đúng cấu trúc response, xác nhận nhánh `backfill_progress` không
      tồn tại được xử lý mềm.
- [ ] Test thủ công: gọi route sau khi đăng nhập, đối chiếu `counts` với `reconcileCounts.js`
      (phase3 Task 8) chạy cùng thời điểm — 2 số phải khớp (cùng nguồn `COUNT(*)` trên Postgres).
- [ ] `npm test` pass.

**Dependencies:** Task 0 (cần route đã có từ phase2 Task 8 tồn tại thật để sửa)

**Files likely touched:**
- `server/kiotvietSync/kiotvietSyncStatusRoutes.js` (sửa)
- `server/kiotvietSync/kiotvietSyncStatusRoutes.test.js` (sửa/mở rộng)

**Estimated scope:** Medium (2 file, nhiều bảng cần liệt kê đúng tên)

---

### Checkpoint: Sau Task 3-4
- [ ] `npm test` pass toàn bộ (test tích hợp Task 3 skip nếu chưa cấu hình
      `SUPABASE_TEST_DB_URL`).
- [ ] Đã chạy Task 3 thật ít nhất 1 lần trên Supabase project test riêng, không lỗi.
- [ ] `GET /api/internal/kiotviet-sync/status` (Task 4) đã gọi thử thật trên production/staging,
      `counts` khớp `reconcileCounts.js`.
- [ ] Dashboard Sheets hiện tại không có regression.

---

### Task 5: Xác minh tổng thể toàn bộ roadmap (Giai đoạn 0-4) — thao tác vận hành, không phải code mới

**Description:** Vì Giai đoạn 4 là giai đoạn cuối cùng trong phạm vi roadmap này (Giai đoạn 5 —
chuyển Dashboard sang Postgres, chuyển hosting sang Render — nằm ngoài phạm vi, xem roadmap mục 5 và
mục 6), task này là 1 vòng kiểm tra toàn diện trước khi coi nền tảng Postgres "sẵn sàng":

- Chạy lại `reconcileCounts.js` (phase3) lần cuối cho toàn bộ entity × 2 cơ sở.
- Gọi `GET /api/internal/kiotviet-sync/status` (Task 4), đối chiếu `counts`/`samples` bằng mắt với
  giao diện KiotViet cho vài bản ghi ngẫu nhiên mỗi loại, cả 2 cơ sở.
- Kiểm tra Dashboard Sheets hiện tại (đăng nhập, xem báo cáo doanh thu/công nợ, kiểm tra đứt hàng
  cả 2 cơ sở, xuất báo cáo) — không có bất kỳ thay đổi hành vi nào so với trước khi bắt đầu roadmap
  này (đối chiếu bằng cách so sánh với hành vi đã biết trước khi Giai đoạn 0 bắt đầu).
- Kiểm tra `KIOTVIET_SYNC_ENABLED=false` vẫn tắt được toàn bộ engine không ảnh hưởng gì (test khôi
  phục trạng thái an toàn — tắt cờ, xác nhận server khởi động bình thường, không lỗi, Dashboard
  Sheets vẫn chạy).
- Ghi lại kết quả (số liệu đối chiếu, ảnh chụp/log nếu cần) vào mục "Xác minh tổng thể" cuối tài
  liệu này.

**Acceptance criteria:**
- [ ] `reconcileCounts.js` không còn lệch lớn không giải thích được cho bất kỳ `(branch, entity)`
      nào.
- [ ] Đối chiếu thủ công `counts`/`samples` khớp giao diện KiotViet cho mẫu đã kiểm tra.
- [ ] Dashboard Sheets xác nhận không hồi quy trên toàn bộ luồng chính (đăng nhập, xem báo cáo,
      đứt hàng, xuất báo cáo) cho cả 2 cơ sở.
- [ ] Tắt `KIOTVIET_SYNC_ENABLED` rồi khởi động lại server — không lỗi, không request nào tới
      KiotViet, Dashboard Sheets không đổi.

**Verification:** Toàn bộ là thao tác thủ công, không có test tự động mới — kết quả ghi vào mục
"Xác minh tổng thể" bên dưới khi thực thi.

**Dependencies:** Task 0-4, và toàn bộ Giai đoạn 0-3.

**Estimated scope:** Không phải code — thao tác vận hành + đối chiếu thủ công.

---

### Checkpoint: Hoàn tất Giai đoạn 4 (và toàn bộ roadmap Giai đoạn 0-4)
- [ ] Task 1-4 merge, `npm test` pass toàn bộ.
- [ ] Task 5 hoàn tất, kết quả đối chiếu ghi lại đầy đủ.
- [ ] Dashboard Sheets hiện tại không có regression trong suốt toàn bộ roadmap (Giai đoạn 0 → 4).
- [ ] Nền tảng Postgres (schema + engine đồng bộ + dữ liệu lịch sử + công cụ kiểm tra) coi là **sẵn
      sàng** để bắt đầu Giai đoạn 5 (ngoài phạm vi roadmap này — cần 1 roadmap/kế hoạch riêng khi
      quyết định bắt tay vào).

## Rủi ro & lưu ý

| Rủi ro | Ảnh hưởng | Giảm thiểu |
|---|---|---|
| Test tích hợp (Task 3) trỏ nhầm vào Supabase project production nếu biến môi trường đặt sai | Cao nếu xảy ra (có thể ghi/xóa dữ liệu thật) | Dùng tên biến **khác hẳn** (`SUPABASE_TEST_DB_URL` so với `SUPABASE_DB_URL`), không tái dùng cùng 1 biến cho 2 mục đích; đặt tên `id` dữ liệu test rõ ràng khác biệt (số âm/tiền tố) để nếu lỡ trỏ nhầm vẫn dễ nhận ra và dọn dẹp |
| Route status (Task 4) trả `samples` chứa dữ liệu khách hàng (SĐT, tên) dù có `requireRole` | Trung bình (rò rỉ dữ liệu nội bộ nếu route bị lộ hoặc vai trò bị cấp nhầm) | Cân nhắc lược bớt field nhạy cảm khỏi `samples` khi code (đã ghi trong acceptance criteria Task 4); route vẫn yêu cầu đăng nhập + đúng vai trò như mọi route nội bộ khác trong dự án |
| `backfill_progress` chưa tồn tại (nếu môi trường nào đó chưa chạy Giai đoạn 3) làm route status lỗi toàn bộ nếu code không bắt lỗi đúng | Thấp nếu xử lý đúng theo Task 4, cao nếu bỏ qua | Task 4 acceptance criteria bắt buộc test riêng tình huống bảng chưa tồn tại (`42P01`), không bắt lỗi chung chung |
| Test "đường nối" (Task 1-2) có thể trùng lặp 1 phần với test đã có ở Giai đoạn 2 nếu người code không đọc kỹ file cũ trước khi viết | Thấp (chỉ tốn công bảo trì đôi, không gây lỗi chức năng) | Mỗi task đều yêu cầu review thủ công đối chiếu với file test đã có trước khi coi là xong |

## Câu hỏi cần quyết định

1. **Có cần dựng riêng 1 Supabase project "test" (miễn phí) cho Task 3, hay dùng chung project
   production với dữ liệu test có tiền tố rõ ràng rồi dọn sạch?** Kế hoạch này đề xuất **project
   riêng** (an toàn tuyệt đối, tránh mọi rủi ro đụng dữ liệu thật dù đã có cơ chế dọn dẹp) — Supabase
   free tier cho phép tạo nhiều project, chi phí là 0, chỉ tốn thao tác tạo thêm 1 project và chạy
   `db:migrate` cho project đó. Cần xác nhận với người quyết định trước khi Task 3 code (ảnh hưởng
   tới việc có cấu hình `SUPABASE_TEST_DB_URL` trên CI hay chỉ chạy thủ công cục bộ — nếu chỉ chạy
   thủ công, Task 3 vẫn hữu ích nhưng không chạy được trong CI tự động, chỉ skip mãi).
2. **Route status mở rộng (Task 4) có nên giới hạn `samples` chỉ hiển thị cho 1 cơ sở tại 1 thời
   điểm (qua query param `?branch=hanoi`) thay vì luôn trả cả 2** — giảm kích thước response, đặc
   biệt nếu sau này thêm nhiều entity hơn. Không phải quyết định bắt buộc trước khi code (có thể để
   mặc định trả cả 2, thêm query param sau nếu thấy cần), nêu ra để người quyết định biết đây là 1
   lựa chọn có thể điều chỉnh dễ dàng.

## Xác minh tổng thể cuối Giai đoạn 4 (điền khi thực thi Task 5)

1. `npm test` (server) — toàn bộ pass, bao gồm test tích hợp Task 3 (pass thật hoặc skip có lý do
   rõ ràng nếu chưa có `SUPABASE_TEST_DB_URL`).
2. `reconcileCounts.js` (phase3) chạy lần cuối — kết quả: _(điền khi thực thi)_.
3. `GET /api/internal/kiotviet-sync/status` đối chiếu thủ công với giao diện KiotViet — kết quả:
   _(điền khi thực thi)_.
4. Dashboard Sheets (đăng nhập, báo cáo, đứt hàng, xuất báo cáo, cả 2 cơ sở) — không hồi quy: _(điền
   khi thực thi)_.
5. Tắt `KIOTVIET_SYNC_ENABLED`, khởi động lại server — an toàn: _(điền khi thực thi)_.
6. Kết luận: nền tảng Postgres sẵn sàng cho Giai đoạn 5 hay chưa, nêu rõ hạng mục còn treo nếu có.
