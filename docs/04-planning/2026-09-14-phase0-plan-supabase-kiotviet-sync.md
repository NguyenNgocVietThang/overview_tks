# Kế hoạch chi tiết: Giai đoạn 0 — Dọn dẹp & chuẩn bị hạ tầng
### (từ Roadmap: Đưa dữ liệu KiotViet lên Supabase Postgres, cận thời gian thực, 2 cơ sở)

> **Lưu trữ lịch sử (18/09/2026):** Tham chiếu `server/telegram/*` trong kế hoạch này thuộc cấu trúc cũ. Bot hiện nằm ngoài repository web trong deployment VPS độc lập.
>
> **Lưu trữ lịch sử (18/09/2026):** Toàn bộ nội dung liên quan Firebase App Hosting trong tài liệu này (file `apphosting.yaml`/`.firebaserc`/`firebase.json`, lệnh `firebase apphosting:secrets:set`, gói Blaze) **không còn áp dụng** — hệ thống đã chuyển hẳn sang **Render** cho hosting và **Supabase** cho Postgres, không dùng Firebase ở bất kỳ thành phần nào. Xem `server/README.md` mục "Deploying on Render" để biết cách khai báo biến môi trường hiện tại. Phần còn lại của tài liệu (phân tích `DATABASE_URL` cũ, kế hoạch dọn config) vẫn đúng về mặt lịch sử.

## Context

Roadmap `docs/04-planning/2026-09-14-roadmap-supabase-kiotviet-sync.md` đã được thống nhất: xây một lớp lưu trữ Supabase Postgres đồng bộ dữ liệu KiotViet cho cả 2 cơ sở (Hà Nội, Sài Gòn), tách biệt hoàn toàn với Dashboard Google Sheets hiện tại. Trước khi viết schema/engine (Giai đoạn 1-2), Giai đoạn 0 phải dọn sạch tàn dư của lần triển khai Postgres trước đó (đã bị hủy và xóa code ngày 2026-09-08, nhưng để sót cấu hình) và chuẩn bị hạ tầng bên ngoài (Supabase project, thông tin đăng nhập KiotViet Sài Gòn, đăng ký Webhook).

**Phát hiện quan trọng khi khảo sát code (lý do việc dọn dẹp là ưu tiên số 1, khẩn cấp):**
- [server/config.js:176](../../server/config.js#L176) hiện có `DATABASE_URL: required('DATABASE_URL')` — dòng này **throw ngay khi load module** nếu thiếu biến `DATABASE_URL`. Đây là tàn dư của thiết kế Postgres cũ (comment tại dòng 174-175 trỏ tới `server/db/pool.js`/`server/db/migrate.js` — **hai file này không còn tồn tại trong repo**).
- [server/apphosting.yaml](../../server/apphosting.yaml) — file khai báo secret cho production — **không có** entry `DATABASE_URL`. Nghĩa là nếu biến này chưa được set thủ công ngoài luồng (Firebase Secret Manager, ngoài file yaml), **production hiện tại đang crash-loop khi khởi động lại**, hoặc nó đang chạy nhờ một secret cũ sót lại từ lần deploy trước khi dọn (không được track trong repo). Cả hai khả năng đều cần dọn ngay bằng cách xóa `required('DATABASE_URL')` khỏi code — không phụ thuộc vào phần còn lại của roadmap.
- Không có package `pg`/`postgres` nào trong `package.json` (root lẫn `server/`) — khẳng định code Postgres cũ đã bị xóa triệt để, chỉ còn sót cấu hình.
- `server/kiotviet/kiotVietApiClient.js` là client thuần (không đọc `process.env`, nhận credentials qua tham số) — tái sử dụng được nguyên vẹn cho Giai đoạn 2, không cần đụng tới trong Giai đoạn 0.
- `server/kiotviet/API_ENDPOINTS.md` còn nguyên — tài liệu tham chiếu cho Giai đoạn 1-2, không cần sửa ở Giai đoạn 0.
- Thông tin đăng nhập KiotViet Sài Gòn (`KIOTVIET_CLIENT_ID_SG`, `KIOTVIET_CLIENT_SECRET_SG`, `KIOTVIET_RETAILER_SG`) hiện chỉ được đọc trực tiếp từ `process.env` trong [server/dashboard/stockoutCheck/stockoutCheckRoutes.js:20-35](../../server/dashboard/stockoutCheck/stockoutCheckRoutes.js#L20) — có khai báo rỗng trong `server/.env.example` nhưng **không có trong `server/apphosting.yaml`** (khác với `SPREADSHEET_ID_SG` đã có secret). Nghĩa là môi trường production hiện tại chưa có 3 biến này — tính năng "Kiểm tra đứt hàng" cho Sài Gòn trên production đang trả lỗi 503 `BRANCH_NOT_CONFIGURED`, hoặc được set thủ công ngoài repo.

**Quyết định đã chốt với người dùng:** thêm ngay 1 stub webhook endpoint (chỉ trả `HTTP 200`, chưa xử lý gì) trong Giai đoạn 0, để có thể đăng ký Webhook KiotViet an toàn ngay bây giờ thay vì phải chờ Giai đoạn 2 code xong logic thật. Giai đoạn 2 sẽ thay logic thật vào route này.

## Nguyên tắc thiết kế cấu hình mới

- Đặt tên biến kết nối Postgres mới là **`SUPABASE_DB_URL`** (không dùng lại `DATABASE_URL`) — tránh nhầm với biến cũ đã xóa, và tên rõ ràng hơn vì đây là Supabase chứ không phải Postgres chung chung.
- `SUPABASE_DB_URL` phải **fail-soft** (không dùng `required()`) — vì toàn bộ engine đồng bộ mặc định TẮT ở Giai đoạn 0-1, thiếu biến này không được làm sập server hiện tại (giống tinh thần `VC_SPREADSHEET_ID`, `HR_SPREADSHEET_ID`).
- `KIOTVIET_SYNC_ENABLED` mặc định **`false`** một cách tường minh (không có logic "tự bật khi production" như thiết kế cũ từng ghi trong `.env.example` — thiết kế đó đã bị loại bỏ cùng code cũ và không nên khôi phục ngầm).
- Không thêm các biến `KIOTVIET_SYNC_FAST_INTERVAL_MS` / `KIOTVIET_SYNC_SLOW_INTERVAL_MS` ở Giai đoạn 0 — chưa có code nào đọc chúng (engine chưa tồn tại), thêm bây giờ là cấu hình chết. Sẽ thêm ở đúng lúc Giai đoạn 2 cần chúng.
- Không thêm package `pg` ở Giai đoạn 0 — chưa có code nào dùng, sẽ thêm cùng lúc viết migration/pool ở Giai đoạn 1.

## Task List

### Task 1: Xóa cấu hình Postgres cũ (dead code) khỏi `server/config.js` và `server/.env.example`

**Description:** Gỡ toàn bộ khối cấu hình Postgres/sync-interval cũ (dòng 171-182 của `config.js`, khối tương ứng dòng ~103-124 của `.env.example`) vì trỏ tới code đã bị xóa (`server/db/pool.js`, `server/db/migrate.js`). Đây là bước khẩn cấp nhất vì `required('DATABASE_URL')` đang chặn khởi động server bất cứ lúc nào biến này không có mặt.

**Acceptance criteria:**
- [ ] `server/config.js` không còn dòng `required('DATABASE_URL')`, không còn `PGSSL`, `KIOTVIET_SYNC_FAST_INTERVAL_MS`, `KIOTVIET_SYNC_SLOW_INTERVAL_MS`, không còn comment tham chiếu `PlanDB-Phase1-Spec.md` hay `server/db/`.
- [ ] `server/.env.example` không còn khối "POSTGRES — Phase 1" cũ (bao gồm ví dụ lệnh `docker run ... postgres:16`).
- [ ] Server khởi động bình thường (`node server/index.js` hoặc lệnh dev hiện có) mà **không cần set** biến `DATABASE_URL`.

**Verification:**
- [ ] Chạy bộ test hiện có liên quan tới config: kiểm tra `server/telegram/leaveAiExtractor.test.js` (đang set `DATABASE_URL: 'postgresql://test'` giả chỉ để né lỗi `required()`) — sau khi xóa `required('DATABASE_URL')`, dòng giả này trở thành thừa, cần gỡ khỏi test đó luôn trong cùng task này (không sửa ở PR khác vì cùng 1 nguyên nhân).
- [ ] Chạy full test suite server (`npm test` trong `server/` hoặc lệnh tương ứng repo dùng) — không có test nào fail do thiếu `DATABASE_URL`.
- [ ] Khởi động server thủ công không set `DATABASE_URL`/`PGSSL` trong `.env`, xác nhận không crash.

**Dependencies:** None

**Files likely touched:**
- `server/config.js`
- `server/.env.example`
- `server/telegram/leaveAiExtractor.test.js`

**Estimated scope:** Small (2-3 files)

---

### Task 2: Thêm cấu hình Supabase mới (fail-soft, mặc định tắt) vào `server/config.js` và `server/.env.example`

**Description:** Thêm 3 biến mới theo đúng roadmap mục 5 (Giai đoạn 0): `SUPABASE_DB_URL` (optional, fail-soft), `PGSSL` (optional, giữ lại vì vẫn cần cho Giai đoạn 1, mặc định theo `NODE_ENV`), `KIOTVIET_SYNC_ENABLED` (optional, mặc định `false` tường minh, không có logic tự-bật). Thêm comment ngắn trỏ về roadmap mới (`docs/04-planning/2026-09-14-roadmap-supabase-kiotviet-sync.md`) thay vì tài liệu cũ đã xóa.

**Acceptance criteria:**
- [ ] `CONFIG.SUPABASE_DB_URL` = `process.env.SUPABASE_DB_URL || null` (không dùng `required()`).
- [ ] `CONFIG.PGSSL` giữ nguyên logic cũ: `process.env.PGSSL ? process.env.PGSSL === 'true' : process.env.NODE_ENV === 'production'`.
- [ ] `CONFIG.KIOTVIET_SYNC_ENABLED` = `process.env.KIOTVIET_SYNC_ENABLED === 'true'` (mặc định `false` khi biến rỗng/không set, không có nhánh "tự bật khi production/RENDER").
- [ ] `server/.env.example` có 3 dòng mới tương ứng, để trống giá trị, kèm comment ngắn giải thích mục đích và trỏ về roadmap doc.

**Verification:**
- [ ] Test thủ công: không set 3 biến → `require('./config')` trả về `SUPABASE_DB_URL: null`, `KIOTVIET_SYNC_ENABLED: false`, server khởi động bình thường.
- [ ] Test thủ công: set `KIOTVIET_SYNC_ENABLED=true` → `CONFIG.KIOTVIET_SYNC_ENABLED === true`.
- [ ] Chạy lại full test suite server — không fail.

**Dependencies:** Task 1 (sửa cùng vùng file, làm sau khi dọn xong tránh xung đột merge trong chính phiên làm việc)

**Files likely touched:**
- `server/config.js`
- `server/.env.example`

**Estimated scope:** XS (1-2 files)

---

### Task 3: Khai báo secret mới trong `server/apphosting.yaml`

**Description:** Thêm entry khai báo (mapping variable → secret name) cho `SUPABASE_DB_URL` và 3 biến KiotViet Sài Gòn còn thiếu (`KIOTVIET_CLIENT_ID_SG`, `KIOTVIET_CLIENT_SECRET_SG`, `KIOTVIET_RETAILER_SG`), theo đúng pattern các entry hiện có (ví dụ `SPREADSHEET_ID_SG` dòng 19-20). **Lưu ý:** entry trong yaml chỉ là khai báo tên biến ↔ tên secret; giá trị secret thật phải được set bằng `firebase apphosting:secrets:set <TÊN_SECRET>` (việc này KHÔNG làm trong task code này — xem Task 5/6, cần người dùng thực hiện thủ công vì cần đăng nhập Firebase CLI/console).

**Acceptance criteria:**
- [ ] `server/apphosting.yaml` có thêm 4 entry mới theo đúng format `- variable: X\n  secret: X` như các entry hiện có.
- [ ] Không xóa/sửa bất kỳ entry nào đang có (Hà Nội KiotViet, `SPREADSHEET_ID_SG`, v.v.).

**Verification:**
- [ ] Đọc lại file, xác nhận YAML hợp lệ (không lỗi indent) — có thể kiểm bằng `node -e "require('js-yaml').load(require('fs').readFileSync('server/apphosting.yaml','utf8'))"` nếu repo có sẵn `js-yaml` (nếu không có, kiểm tra bằng mắt cẩn thận theo đúng indent 2 field như các entry khác).
- [ ] Diff review: chỉ thêm dòng, không đổi dòng cũ.

**Dependencies:** None (độc lập với Task 1-2, có thể làm song song)

**Files likely touched:**
- `server/apphosting.yaml`

**Estimated scope:** XS (1 file)

---

### Task 4: Thêm stub webhook endpoint (`POST /api/kiotviet/webhook`) trả `HTTP 200`

**Description:** Tạo 1 route Express tối giản, public (không qua `requireAuth`/`resolveBranch` vì KiotViet gọi tới, không phải người dùng đăng nhập), chỉ trả `HTTP 200` ngay lập tức mà chưa xử lý payload gì. Mục đích duy nhất: có 1 URL public HTTPS ổn định để đăng ký Webhook trên KiotViet ngay bây giờ (Task 7), tránh phải chờ Giai đoạn 2 code xong logic ghi Postgres. Theo đúng pattern module hóa hiện có trong repo (mỗi tính năng có router riêng, mount vào `server/routes.js`) — tham khảo `server/dashboard/stockoutCheck/stockoutCheckRoutes.js` và cách mount tại `server/routes.js:29`.

**Acceptance criteria:**
- [ ] File mới `server/kiotviet/kiotvietWebhookRoutes.js` export 1 Express router có `router.post('/api/kiotviet/webhook', (req, res) => res.status(200).json({ received: true }))`.
- [ ] Route được mount vào `server/routes.js` (thêm `require` + `router.use(kiotvietWebhookRoutes)`), đặt **trước** các middleware guard theo cơ sở (`resolveBranch`) vì đây là request từ bên ngoài KiotViet, không có cookie/session người dùng.
- [ ] Route không đọc/ghi gì vào Postgres hay Google Sheets — chỉ trả 200, đúng tinh thần "stub".
- [ ] Thêm 1 comment ngắn trong file nêu rõ đây là stub tạm cho Giai đoạn 0, logic thật (xác định gian hàng, queue xử lý nền) sẽ thay vào ở Giai đoạn 2 — để tránh người đọc sau tưởng nhầm đây là implementation hoàn chỉnh.

**Verification:**
- [ ] Test tự động mới (`server/kiotviet/kiotvietWebhookRoutes.test.js`): gửi `POST /api/kiotviet/webhook` bất kỳ body nào → nhận `200`.
- [ ] Test thủ công qua `curl -X POST http://localhost:<port>/api/kiotviet/webhook -d '{}' -H "Content-Type: application/json"` sau khi chạy server dev → nhận `200 {"received":true}`.
- [ ] Chạy full test suite server — không fail, không có route khác bị đè (kiểm tra không trùng path với route hiện có nào).

**Dependencies:** None (độc lập, có thể làm song song với Task 1-3)

**Files likely touched:**
- `server/kiotviet/kiotvietWebhookRoutes.js` (mới)
- `server/kiotviet/kiotvietWebhookRoutes.test.js` (mới)
- `server/routes.js`

**Estimated scope:** Small (2-3 files)

---

### Checkpoint: Sau Task 1-4 (toàn bộ phần code)
- [ ] Full test suite server pass.
- [ ] Server khởi động sạch không cần `DATABASE_URL`/`SUPABASE_DB_URL`.
- [ ] `POST /api/kiotviet/webhook` trả 200 khi test thủ công.
- [ ] Dashboard Sheets hiện tại (đăng nhập, xem báo cáo cơ bản) vẫn hoạt động bình thường — xác nhận không có regression.
- [ ] Deploy thử lên môi trường production (Firebase App Hosting) sau khi merge — xác nhận server khởi động được (giải quyết dứt điểm rủi ro crash-loop do `DATABASE_URL` nêu ở Context).

---

### Task 5 (thủ công, ngoài code — người dùng thực hiện): Tạo Supabase project & set secret `SUPABASE_DB_URL`

**Description:** Tạo project Supabase mới (gói free). Lấy connection string dạng **"Direct connection"** (cổng **5432**, KHÔNG dùng pooler cổng 6543 — vì server chạy 1 tiến trình liên tục, không phải serverless). Set giá trị này làm secret production.

**Acceptance criteria:**
- [ ] Project Supabase free tier đã tạo, khu vực (region) nên chọn gần Việt Nam nhất có (Singapore) để giảm độ trễ.
- [ ] Đã copy đúng connection string "Direct connection" (không phải "Transaction pooler"/"Session pooler").
- [ ] Đã chạy `firebase apphosting:secrets:set SUPABASE_DB_URL` (hoặc tên secret tương ứng đã khai ở Task 3) và dán connection string vào.
- [ ] Đã cấp quyền truy cập secret cho service backend App Hosting (giống cách các secret khác như `JWT_SECRET` đang được cấp — theo đúng flow Firebase đã dùng trước đây, không cần hướng dẫn lại nếu người dùng đã quen).

**Verification:**
- [ ] `firebase apphosting:secrets:access SUPABASE_DB_URL` (hoặc lệnh tương đương) trả về đúng giá trị vừa set, không lộ ra ngoài log/commit.
- [ ] Không commit connection string vào bất kỳ file nào trong repo (chỉ tồn tại trong Secret Manager + `.env` local cá nhân nếu cần dev).

**Dependencies:** Task 3 (cần đã khai báo entry `SUPABASE_DB_URL` trong `apphosting.yaml` trước khi set secret có ý nghĩa cho deploy)

**Ghi chú:** Đây là hành động tạo tài khoản/dịch vụ bên thứ ba và nhập secret — nằm ngoài phạm vi việc agent có thể tự làm; người dùng cần tự thực hiện qua Supabase dashboard + Firebase CLI.

---

### Task 6 (thủ công, ngoài code — người dùng thực hiện): Xác nhận/bổ sung thông tin đăng nhập API KiotViet Sài Gòn

**Description:** Xác nhận `KIOTVIET_CLIENT_ID_SG` / `KIOTVIET_CLIENT_SECRET_SG` / `KIOTVIET_RETAILER_SG` cho gian hàng Sài Gòn (có thể dùng chung `CLIENT_ID`/`CLIENT_SECRET` với Hà Nội nếu cùng 1 tài khoản KiotViet quản lý nhiều gian hàng — theo đúng logic fallback đã có sẵn trong `stockoutCheckRoutes.js`, chỉ `KIOTVIET_RETAILER_SG` là bắt buộc phải khác). Set các secret này trên production.

**Acceptance criteria:**
- [ ] Xác nhận được tên gian hàng (retailer) chính xác của cơ sở Sài Gòn trên KiotViet.
- [ ] Đã chạy `firebase apphosting:secrets:set` cho `KIOTVIET_CLIENT_ID_SG`, `KIOTVIET_CLIENT_SECRET_SG` (nếu khác Hà Nội), `KIOTVIET_RETAILER_SG`.
- [ ] Tính năng "Kiểm tra đứt hàng" hiện có cho cơ sở Sài Gòn (đã code sẵn, dùng đúng các biến này) chạy được trên production mà không trả 503 `BRANCH_NOT_CONFIGURED` — đây là cách kiểm chứng gián tiếp nhanh nhất mà không cần viết code mới.

**Verification:**
- [ ] Vào tính năng "Kiểm tra đứt hàng", chọn cơ sở Sài Gòn trên production, xác nhận trả dữ liệu thay vì lỗi cấu hình.

**Dependencies:** Task 3

**Ghi chú:** Việc xác nhận này vốn đã được roadmap liệt kê là điều kiện tiên quyết bắt buộc trước khi đồng bộ Sài Gòn hoạt động được (cả webhook lẫn polling) — không thể agent tự làm vì cần thông tin tài khoản KiotViet thật.

---

### Task 7 (thủ công, ngoài code — người dùng thực hiện): Đăng ký Webhook KiotViet cho cả 2 gian hàng

**Description:** Sau khi Task 4 (stub endpoint) đã deploy lên production, đăng ký Webhook trên KiotViet cho **cả 2 gian hàng** (Hà Nội, Sài Gòn), cùng trỏ về `https://<domain-production-hiện-có>/api/kiotviet/webhook`. Đăng ký cho các sự kiện: tạo/sửa hóa đơn, đơn hàng, tồn kho (theo mục 3 của roadmap — KiotViet xác nhận có hỗ trợ, cả 2 tài khoản đều gói cao nhất nên không có rủi ro bị chặn tính năng).

**Acceptance criteria:**
- [ ] Webhook đã đăng ký trên KiotViet cho gian hàng Hà Nội, trỏ đúng URL stub endpoint.
- [ ] Webhook đã đăng ký trên KiotViet cho gian hàng Sài Gòn, cùng URL.
- [ ] Test gửi thử từ giao diện KiotViet (nếu có nút "Test webhook") → xác nhận nhận được `200` (kiểm bằng log server production).

**Verification:**
- [ ] Tạo/sửa thử 1 hóa đơn test trên KiotViet (môi trường cho phép), xác nhận log production của stub endpoint nhận được request POST.

**Dependencies:** Task 4 (đã deploy stub endpoint lên production), Task 5-6 không bắt buộc phải xong trước (webhook không phụ thuộc Postgres/credentials Sài Gòn để đăng ký, chỉ cần endpoint tồn tại).

**Ghi chú:** Vì stub endpoint chưa xử lý gì, các sự kiện webhook nhận được trong giai đoạn này sẽ bị bỏ qua (không mất dữ liệu về lâu dài — vì Giai đoạn 3 sẽ backfill lại toàn bộ lịch sử, và Giai đoạn 2's polling đối soát sẽ bắt kịp phần phát sinh giữa lúc này và lúc engine thật chạy).

---

### Checkpoint: Hoàn tất Giai đoạn 0
- [ ] Toàn bộ Task 1-4 đã merge, test pass, đã deploy production, xác nhận không crash.
- [ ] Task 5-7 (thủ công) đã hoàn tất — có `SUPABASE_DB_URL` secret hợp lệ, có đủ credentials Sài Gòn, có Webhook đăng ký cho cả 2 gian hàng.
- [ ] Dashboard Sheets hiện tại không có regression nào trong suốt quá trình.
- [ ] Sẵn sàng chuyển sang Giai đoạn 1 (thiết kế schema Postgres).

## Rủi ro & lưu ý

| Rủi ro | Ảnh hưởng | Giảm thiểu |
|---|---|---|
| Production đang crash-loop hoặc chạy nhờ secret `DATABASE_URL` sót lại ngoài repo | Cao — không rõ trạng thái thật cho tới khi kiểm tra | Task 1 giải quyết dứt điểm bất kể trạng thái hiện tại là gì; nên kiểm tra Firebase Console/log production TRƯỚC khi bắt đầu Task 1 để biết đang ở tình huống nào |
| Stub webhook endpoint public, không xác thực | Thấp/Trung bình — bất kỳ ai biết URL đều POST được, nhưng route không làm gì (chỉ trả 200) nên không có tác động | Giai đoạn 2 khi thêm logic thật cần cân nhắc xác thực webhook (KiotViet có ký request hay không — cần tra cứu thêm, ghi vào Giai đoạn 2, không chặn Giai đoạn 0) |
| `firebase apphosting:secrets:set` yêu cầu quyền admin project Firebase | Trung bình | Task 5/6 ghi rõ là thao tác thủ công của người dùng, agent không tự thực hiện được |

## Xác minh tổng thể cuối Giai đoạn 0

1. `npm test` (server) — toàn bộ pass.
2. Chạy server dev local không set `DATABASE_URL` — khởi động thành công.
3. Deploy production — server khởi động thành công, các tính năng Sheets hiện có (đăng nhập, xem báo cáo, kiểm tra đứt hàng cả 2 cơ sở) hoạt động bình thường.
4. `curl -X POST .../api/kiotviet/webhook` trên production trả `200`.
5. Webhook KiotViet đã đăng ký cho cả 2 gian hàng, test gửi thử thành công.

---

## Domain production xác nhận

**Trạng thái kiểm tra ngày 2026-09-14: CHƯA CÓ domain Firebase App Hosting production để xác nhận.**

- Cấu hình local trỏ đúng Firebase project `tokosi-a02e0` và backend ID `tokosi-dashboard`.
- Lệnh kiểm tra chính thức đã chạy:

  ```powershell
  firebase apphosting:backends:get tokosi-dashboard --project=tokosi-a02e0
  ```

- Firebase CLI trả về rằng project phải ở gói **Blaze (pay-as-you-go)** mới chạy được lệnh và API `firebaseapphosting.googleapis.com` chưa thể bật khi chưa nâng gói. Vì vậy backend App Hosting chưa thể được truy vấn/triển khai và chưa có URL production hợp lệ. Không dùng URL suy đoán để đăng ký Webhook.
- Firebase App Hosting yêu cầu hoàn tất nâng project lên Blaze, tạo/triển khai backend, rồi chạy lại lệnh trên. Khi lệnh trả về backend, copy chính xác trường URL/domain (domain mặc định có dạng `<backend-id>--<project-id>.<region>.hosted.app`) vào dòng dưới:

  ```text
  Domain production: CHƯA XÁC NHẬN — chờ nâng Blaze và triển khai backend
  Webhook endpoint: CHƯA KHẢ DỤNG — sau khi xác nhận sẽ là https://<domain-production>/api/kiotviet/webhook
  ```

- Trước khi cấu hình KiotViet, kiểm tra endpoint thật (không đưa secret vào câu lệnh hoặc log):

  ```powershell
  curl.exe -i -X POST "https://<domain-production>/api/kiotviet/webhook" -H "Content-Type: application/json" -d "{}"
  ```

  Kết quả đạt yêu cầu là HTTP `200` và body `{"received":true}`. Nếu chưa đạt, không đăng ký URL đó trên KiotViet.

### Hướng dẫn đăng ký Webhook KiotViet cho Hà Nội và Sài Gòn

Chỉ thực hiện các bước dưới đây **sau khi** phần trên có domain production thật và phép thử endpoint trả HTTP `200`. Hai gian hàng là hai tài khoản/retailer riêng nên phải cấu hình hai lần, nhưng cùng trỏ về một endpoint:

```text
https://<domain-production-đã-xác-nhận>/api/kiotviet/webhook
```

#### A. Gian hàng Hà Nội

1. Đăng nhập trang quản trị KiotViet của gian hàng **Hà Nội** bằng tài khoản có quyền quản trị.
2. Kiểm tra tên/mã gian hàng đang chọn để tránh cấu hình nhầm sang Sài Gòn.
3. Mở biểu tượng bánh răng **Thiết lập/Cài đặt** → **Cửa hàng/Thiết lập cửa hàng** → **Kết nối Webhook** (tên mục có thể thay đổi nhẹ theo phiên bản giao diện).
4. Bật **Thiết lập Webhook/Kết nối Webhook**.
5. Nhập nguyên vẹn URL HTTPS ở trên vào ô **Webhook URL**; không thêm dấu `/` hoặc path khác ở cuối.
6. Bật các sự kiện tạo/cập nhật tương ứng với **hóa đơn**, **đơn hàng**, và **hàng hóa/tồn kho**. Nếu giao diện yêu cầu tạo một đăng ký riêng cho từng loại sự kiện, dùng cùng URL cho tất cả các đăng ký.
7. Nếu KiotViet cho phép đặt **Secret key**, tạo một giá trị ngẫu nhiên riêng cho gian hàng Hà Nội và lưu trong Secret Manager/trình quản lý mật khẩu. Không ghi secret vào file này, source code, ảnh chụp hoặc git. Stub Giai đoạn 0 chưa kiểm tra chữ ký; việc xác thực sẽ được bổ sung khi triển khai logic thật.
8. Chọn **Lưu** và bảo đảm webhook ở trạng thái đang hoạt động.
9. Nếu có nút **Test webhook/Gửi thử**, chạy thử và xác nhận KiotViet báo thành công; đồng thời kiểm tra log production thấy request `POST /api/kiotviet/webhook` nhận HTTP `200`.
10. Nếu không có nút test, tạo hoặc cập nhật một bản ghi thử phù hợp (ưu tiên dữ liệu test), rồi kiểm tra log production. Ghi lại thời điểm và loại sự kiện để đối chiếu.

#### B. Gian hàng Sài Gòn

1. Đăng xuất/chuyển retailer và đăng nhập đúng trang quản trị KiotViet của gian hàng **Sài Gòn** bằng tài khoản có quyền quản trị.
2. Kiểm tra lại tên/mã gian hàng; không tiếp tục nếu giao diện vẫn hiển thị Hà Nội.
3. Lặp lại các bước 3-10 của gian hàng Hà Nội, dùng **chính xác cùng Webhook URL**.
4. Nếu dùng Secret key, tạo giá trị **riêng cho Sài Gòn** và lưu an toàn ngoài git; không sao chép secret của Hà Nội nếu không có chủ đích quản trị rõ ràng.

#### Checklist bàn giao thủ công

- [ ] Domain production thật đã được điền thay cho placeholder và endpoint đã trả HTTP `200`.
- [ ] Webhook Hà Nội đang hoạt động, đúng URL, đã bật sự kiện hóa đơn/đơn hàng/hàng hóa-tồn kho và test thành công.
- [ ] Webhook Sài Gòn đang hoạt động, đúng URL, đã bật sự kiện hóa đơn/đơn hàng/hàng hóa-tồn kho và test thành công.
- [ ] Log production cho thấy request từ từng gian hàng đi vào `POST /api/kiotviet/webhook` và nhận HTTP `200`.
- [ ] Không có secret, mật khẩu, access token hoặc thông tin đăng nhập nào được ghi vào repository.

Tài liệu tham chiếu: [Firebase App Hosting — Get started](https://firebase.google.com/docs/app-hosting/get-started), [KiotViet Retail Public API — Webhook](https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/retail-ket-noi-api/public-api/).
