# Kế hoạch tối ưu tốc độ "Báo cáo tổng hợp" (`/api/dashboard`)

> **Cho agent thực thi:** làm tuần tự từng Task, đánh dấu checkbox (`- [ ]`) khi xong. Mỗi Task là một commit riêng để rollback độc lập. Không gộp Đợt 2/3 vào Đợt 1.

**Mục tiêu:** giảm thời gian phản hồi và tải DB của `/api/dashboard` mà không đổi shape JSON trả về, không đổi số liệu hiển thị, không thêm dependency.

**Căn cứ (đo thật 2026-09-25, máy local → Supabase, Hà Nội, bộ lọc mặc định 30 ngày):**

| Hạng mục | Kết quả |
|---|---|
| `readCoreDashboardSheets` (7 tab, toàn bộ lịch sử hóa đơn 15k / đặt hàng 22k / hàng hóa 10k) | ~13,5 s, ~16 MB |
| `/api/dashboard` cache nguội | 6,6–14,8 s |
| `/api/dashboard` **trúng cache kết quả** | 300–500 ms (lẽ ra ~0) |
| Đổi bộ lọc (cache thô còn nóng) | ~0,9 s |
| Payload | ~5 MB JSON (invoices 1,5 MB · allProducts 1,1 MB · debtManagement 1 MB · lowStock 0,85 MB) |
| `INVOICE_QUANTITIES_SQL` (EXPLAIN ANALYZE) | 39 ms — **không** cần index mới |

**Ràng buộc chung**

- Không đổi shape JSON của `/api/dashboard` (frontend + `dashboardPermissionFilter.js` + `exportService.js` phụ thuộc).
- Không thêm npm dependency. Test dùng `node:test` như `server/dashboard/dashboardData.test.js` (`npm test` trong `server/`).
- Giữ nguyên nguyên tắc: object trong `dashboardResultCache` dùng chung nhiều request → **không bao giờ sửa tại chỗ** (xem đầu `dashboardPermissionFilter.js`).
- Giả định 1 instance Node (Render hiện tại). Các bộ đếm phiên bản là biến module; nếu sau này scale nhiều instance phải xem lại.
- Không dùng `git stash` (lỗi trên Windows với repo này) — so sánh bằng `git diff`/`git show`.
- Comment theo phong cách hiện có (tiếng Việt không dấu trong `server/dashboard/*.js`).

---

## ĐỢT 1 — Sửa nhỏ, rủi ro thấp (ưu tiên làm ngay)

Kết quả kỳ vọng: request trúng cache < 50 ms; hết "SSE báo mới nhưng vẫn nhận số cũ"; sau mỗi lượt rollup chỉ tính lại 1 lần dù nhiều người đang mở; client không render lệch bộ lọc; người đầu tiên sau deploy không phải chờ ~14 s.

### Task 1.1 — Tra cache kết quả TRƯỚC khi truy vấn rollup + đưa phiên bản rollup vào khóa cache

**Vấn đề:** `getDashboardData` ([dashboardData.js:2149](../../../server/dashboard/dashboardData.js)) gọi `loadDashboardBranchSources` → `fetchDashboardRollups` (7 câu SQL/cơ sở, 14 câu khi "Cả hai") rồi mới tra `dashboardResultCache`. Comment ở `fetchDashboardRollups` (~dòng 2095) nhắc "precheck" nhưng không tồn tại. Đồng thời khóa cache chỉ gồm version sheets/công nợ/workflow, **không có rollup** → sau sự kiện `updated`, client gọi lại vẫn nhận kết quả cũ tới 90 s.

Hai việc này phải làm CÙNG nhau: nếu chỉ precheck mà không có version rollup, kết quả cũ sẽ bám đến hết TTL.

**Files:**
- Sửa: `server/dashboard/dashboardData.js` (khu vực dòng 2078–2226, `module.exports.__test__`)
- Sửa: `server/dashboard/dashboardData.test.js`

**Các bước:**

- [x] **B1 — Test đỏ trước.** Trong `dashboardData.test.js`, mở rộng `mockDashboardRollups` để đếm số lần gọi (hoặc viết `mockDashboardRollupsCounted`). Thêm 2 test:
  1. Gọi `getDashboardData(BASE_FILTERS, ...)` 2 lần liên tiếp → lần 2 **không** gọi hàm rollup nào (số đếm không tăng), `getComputeCallCount()` vẫn = 1.
  2. Gọi 1 lần → `dashboardRollupEvents.emit('updated', { at: Date.now() })` → gọi lại cùng bộ lọc → rollup được gọi lại và `getComputeCallCount()` = 2.
- [x] **B2 — Bộ đếm phiên bản rollup.** Đầu file:
  ```js
  const { dashboardRollupEvents } = require('../kiotvietSync/dashboardRollupEvents');
  // Tang moi lan rollup refresh xong — nam trong khoa dashboardResultCache de
  // ket qua tinh tu rollup cu tu het hieu luc ngay khi co rollup moi.
  let rollupVersion = 0;
  dashboardRollupEvents.on('updated', () => { rollupVersion += 1; });
  ```
  (`dashboardRollupEvents.js` đứng độc lập, không gây vòng require.)
- [x] **B3 — Tách nguồn "rẻ" khỏi rollup.** Đổi `loadDashboardBranchSources` thành 2 bước:
  - `loadDashboardBaseSources(branch, physicalBranch)` → `Promise.all([getCachedDashboardCoreSheets, getCachedDebtManagementSource, getCachedDebtWorkflow])` (đều là cache trong bộ nhớ, thường tức thì).
  - Rollup chỉ gọi khi cache miss.
- [x] **B4 — Viết lại thứ tự trong `getDashboardData`:**
  1. Resolve ranges như cũ.
  2. `await` base sources của mọi cơ sở trong `branchScope`.
  3. `const versionTag = sourceVersions + ':r' + rollupVersion;` → dùng `versionTag` cho cả `cacheKey` và vòng dọn entry cũ (thay cho `sourceVersions` hiện tại, để entry của rollup cũ cũng bị dọn).
  4. Trúng cache → `return cached.data` (không chạm DB).
  5. Miss → `fetchDashboardRollups` cho từng cơ sở → gắn `rollups` vào source → `computeDashboardData` như cũ → lưu cache.
  - Chụp `rollupVersion` **trước** khi fetch rollup. Nếu rollup đổi giữa chừng, kết quả được lưu dưới khóa cũ và không ai hỏi tới nữa: lãng phí một lần, không sai số liệu.
- [x] **B5 — Sửa comment** ở `fetchDashboardRollups` cho đúng thực tế mới.
- [x] **B6 — Chạy `npm test`**; toàn bộ test cũ phải xanh (đặc biệt các test "bo loc khong doi -> khong tinh lai" quanh dòng 380–391).

**Rollback:** revert 1 commit. Không có migration, không đổi API. — Đã commit `e9265bd`.

### Task 1.2 — Gộp request trùng khóa (single-flight)

**Vấn đề:** sau mỗi lượt rollup (~7 phút theo `KIOTVIET_SYNC_FAST_INTERVAL_MS`, cộng lượt đầy đủ 30 phút), mọi tab đang mở nhận SSE và gọi `/api/dashboard` cùng lúc. Mỗi request miss cache tự fetch 7–14 câu rollup và tự compute → dồn pool 12 kết nối.

**Files:** `server/dashboard/dashboardData.js`, `server/dashboard/dashboardData.test.js`

- [x] **B1 — Test đỏ:** gọi `Promise.all([getDashboardData(f), getDashboardData(f), getDashboardData(f)])` cùng bộ lọc trên cache trống → `getComputeCallCount()` = 1, rollup mock chỉ được gọi 1 lượt, cả 3 kết quả `===` nhau.
- [x] **B2 — Cài đặt:** `const dashboardResultInflight = new Map(); // cacheKey -> Promise<data>`. Sau bước tra cache ở Task 1.1: nếu `inflight.has(cacheKey)` → trả promise đó; nếu không → tạo promise (fetch rollup + compute + lưu cache), `.finally(() => inflight.delete(cacheKey))`.
  - Lỗi phải lan tới mọi người đang chờ nhưng **không** được lưu vào cache (giữ hành vi hiện tại: lần sau thử lại).
- [x] **B3 — Thêm `dashboardResultInflight` vào `__test__.resetCaches()`.**
- [x] **B4 — `npm test`.** — Đã commit `c3aeb64`.

### Task 1.3 — Client: bỏ response cũ khi đổi bộ lọc nhanh + giãn nhịp gọi sau SSE

**Vấn đề:** `loadData` ([index.html:9398](../../../server/public/index.html)) không hủy request trước. Đổi bộ lọc A → B nhanh: nếu response A về sau B thì A ghi đè màn hình (sai bộ lọc) và vẫn phải tải/parse 5 MB vô ích.

**Files:** `server/public/index.html`

- [x] **B1 — Đánh số + hủy request:**
  ```js
  let dashboardRequestSeq = 0;
  let dashboardRequestController = null;
  function loadData(days, isManualRefresh) {
    const seq = ++dashboardRequestSeq;
    if (dashboardRequestController) dashboardRequestController.abort();
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    dashboardRequestController = controller;
    ...fetch(url, controller ? { signal: controller.signal } : undefined)
  ```
  - Trong `.then(data)`: `if (seq !== dashboardRequestSeq) return;` trước khi đụng `state`.
  - Trong `.catch`: `if (err && err.name === 'AbortError') { if (isManualRefresh) setLoading(false); return; }` → không hiện toast lỗi.
  - Spinner: request thủ công bị thay thế phải tắt `setLoading(false)` (nếu không sẽ kẹt spinner khi request thay thế là request nền từ SSE).
- [x] **B2 — Giãn nhịp SSE:** trong listener `dashboard-updated` (~dòng 9624) đổi thành
  `setTimeout(function () { loadData(state.days, false); }, Math.floor(Math.random() * 3000));`
  Kết hợp Task 1.2, việc này giảm đỉnh tải chứ không phải điều kiện đúng/sai.
- [x] **B3 — Kiểm tra trong trình duyệt** (preview): đổi bộ lọc tab Tổng quan 3–4 lần liên tục → tab Network thấy các request trước bị `(canceled)`, màn hình khớp bộ lọc cuối; console không có lỗi; không có toast "Không thể tải dữ liệu". — Đã commit `eeff908`; kiểm chứng trực tiếp trên preview local (click 1 ngày→7 ngày→90 ngày→Tất cả liên tục): 6 request trước `net::ERR_ABORTED`, chỉ request cuối 200 OK, màn hình khớp "Tất cả", không toast lỗi.

### Task 1.4 — Nạp sẵn cache lúc khởi động (prewarm)

**Vấn đề:** sau mỗi restart/redeploy/Render thức dậy, người đầu tiên mở báo cáo phải chờ đọc 7 tab (~14 s).

**Files:** `server/dashboard/dashboardData.js`, `server/index.js`, test

- [x] **B1 — Export `prewarmDashboardCaches({ log })`:** duyệt `resolveBranchScope(BRANCH_BOTH)` **tuần tự** (không song song, tránh chiếm pool đúng lúc lượt sync khởi động đang chạy), với mỗi cơ sở gọi `getCachedDashboardCoreSheets`, `getCachedDebtManagementSource`, `getCachedDebtWorkflow`; bắt lỗi từng cơ sở và chỉ log (cơ sở chưa cấu hình không được làm crash).
- [x] **B2 — Gọi trong `app.listen` callback** ở `server/index.js` (~dòng 129), không `await`, sau `startPollingScheduler()`. Cho phép tắt bằng env `DASHBOARD_PREWARM=false`.
- [x] **B3 — Test:** mock pgReader đếm lượt gọi → `await prewarmDashboardCaches()` → gọi `getDashboardData` → pgReader không bị gọi thêm. Test phụ: một cơ sở ném lỗi → prewarm vẫn resolve.
- [x] **B4 — Chạy server local, xem log** thấy prewarm xong; mở báo cáo không phải chờ đọc thô. — Đã commit `62d76ab`; log thực tế trên preview local: `[Dashboard] Prewarm xong cho co so Hà Nội` / `Sài Gòn`.

### Nghiệm thu Đợt 1

- [x] `npm test` xanh. — 1070 test / 1067 pass / 0 fail / 3 skip.
- [x] Đo lại bằng script benchmark (xem Phụ lục): trúng cache < 50 ms; cache nguội không chậm hơn trước. — Đo thật trên Supabase (2026-09-25 sau khi sửa): `cold 8290ms`, `warm1/2/3 0ms` (trước khi sửa: cold 6,6–14,8s, warm 300–500ms).
- [x] Trình duyệt: kiểm chứng tab Tổng quan render đúng dữ liệu thật (Supabase) khớp bộ lọc đã chọn qua preview local, không lỗi console/toast. Không có ảnh chụp/số KPI "trước khi sửa" để so trực tiếp (đợt sửa không đổi `computeDashboardData`/logic tính KPI, chỉ đổi tầng cache/fetch), nên coi bước này đã xác nhận gián tiếp qua toàn bộ 1067 test xanh (bao gồm test snapshot số liệu) + kiểm tra trực quan.
- [ ] Deploy Render → theo dõi log 1 lượt sync + rollup: SSE bắn, client gọi lại, nhận số mới (không phải chờ 90 s). — **CHƯA LÀM**: cần merge/push + deploy, việc này cần xác nhận của người dùng trước khi thực hiện.
- [x] Cập nhật memory `dashboard_perf_audit_2026_09_25.md` (trạng thái đã làm).

---

## ĐỢT 2 — Giảm tải đọc thô và dung lượng truyền (rủi ro thấp, cần kiểm thử kỹ hơn)

Làm sau khi Đợt 1 đã chạy ổn trên production ít nhất vài ngày.

### Task 2.1 — Làm mới cache thô theo sự kiện, không theo nhịp 90 s

**Vấn đề:** `DASHBOARD_SHEETS_CACHE_TTL_MS = 90 s` → khi có người xem, cứ 90 s lại đọc lại ~16 MB (13,5 s DB + mạng + heap), dù dữ liệu chỉ đổi khi có lượt sync (fast 7 phút, slow lâu hơn).

**Files:** `server/dashboard/dashboardData.js`, `server/kiotvietSync/scheduler.js`, test

- [ ] **B1 — TTL riêng cho cache core:** `DASHBOARD_CORE_SHEETS_CACHE_TTL_MS = 10 * 60 * 1000`. Cache "full" (dùng cho `/api/search`) **giữ nguyên** 90 s ở đợt này.
- [ ] **B2 — Đánh dấu cũ theo sự kiện:** khi `dashboardRollupEvents` phát `updated` → với mọi entry của `dashboardCoreSheetsCacheByBranch`, đặt `expiresAt = Date.now() - 1` (hết hạn "mềm", vẫn trong cửa sổ `DASHBOARD_SHEETS_MAX_STALE_MS`) → request kế tiếp nhận dữ liệu cũ ngay và kích hoạt làm mới nền (cơ chế SWR sẵn có).
- [ ] **B3 — Nhóm slow (danh mục, hàng hóa, khách hàng, NCC…) không phát `updated`:** thêm sự kiện riêng `dashboardRollupEvents.emit('sources-updated')` sau `runGroup(slowEntities)` trong `scheduler.js`; `dashboardData.js` lắng nghe cả `sources-updated` để hết hạn mềm. **Không** dùng tên `updated` để SSE không bắn thêm cho client.
- [ ] **B4 — Khóa cache kết quả phải có "ngày VN hiện tại":** bộ lọc `days` tính theo `now`, qua nửa đêm cửa sổ 30 ngày dịch đi. TTL kết quả hiện là 90 s nên lệch không đáng kể; nếu kéo TTL kết quả theo TTL core thì phải thêm `toCalendarDateKey(now)` vào `dashboardResultCacheKey`. Tách hằng `DASHBOARD_RESULT_CACHE_TTL_MS` khỏi TTL thô (hiện đang gán bằng nhau ở dòng 2078).
- [ ] **B5 — Test:** (a) trong 10 phút không có sự kiện → không đọc lại; (b) emit `updated` → lần gọi kế trả dữ liệu cũ ngay + pgReader được gọi đúng 1 lần ở nền; (c) đổi ngày (tiêm `now`) → không trúng cache của ngày trước.

**Đánh đổi chấp nhận:** nếu sync bị tắt (`KIOTVIET_SYNC_ENABLED=false`, như môi trường local), dữ liệu cũ tối đa 10 phút thay vì 90 s.

### Task 2.2 — ETag/304 cho `/api/dashboard`

**Vấn đề:** middleware `/api` đặt `Cache-Control: no-store` ([index.js:41](../../../server/index.js)) → trình duyệt không bao giờ revalidate; mỗi lần gọi đều tải + parse 5 MB, rồi client còn `JSON.stringify` 5 MB để so fingerprint. Express vẫn tự băm ETag cho 5 MB mỗi response mà không ai dùng.

**Files:** `server/dashboard/dashboardData.js`, `server/routes.js`, `server/public/index.html`, test route

- [ ] **B1 — Mã kết quả ổn định:** mỗi lần compute gán `resultId` tăng dần, lưu cùng entry cache. Export thêm `getDashboardResult(filters, branch, viewer)` → `{ data, resultId }`; `getDashboardData` giữ nguyên chữ ký (bọc lại) cho `exportService.js`.
- [ ] **B2 — Route:** `etag = 'W/"' + resultId + '-' + hash(permissions đã sort) + '"'`. Riêng route này: `res.set('Cache-Control', 'private, no-cache')` (ghi đè `no-store`; `private` để Cloudflare không cache chung). Nếu `req.get('If-None-Match') === etag` → `res.status(304).end()` **trước** khi gọi `filterDashboardForUser` và `res.json`. Ngược lại `res.set('ETag', etag)` rồi `res.json(...)` (Express không tự băm khi ETag đã có).
- [ ] **B3 — Client:** so `res.headers.get('ETag')` với `state.lastEtag`; trùng thì bỏ qua `res.json()` + fingerprint + render (vẫn cập nhật `state.lastFetchAt`). Giữ fingerprint cũ làm dự phòng khi không có ETag.
- [ ] **B4 — Kiểm chứng `sessionStorage`:** trong trình duyệt đo `JSON.stringify(state.data).length`. Nếu gần hoặc vượt ~5 triệu ký tự thì `saveDashboardCache` đang lỗi âm thầm → bỏ lưu các khóa lớn (`allProducts`, `lowStock`, `invoices`, `debtManagement.customers`) hoặc bỏ hẳn cache này. Chỉ sửa khi đã đo xác nhận.
- [ ] **B5 — Test route:** lần 1 → 200 + ETag; lần 2 gửi `If-None-Match` → 304 không body; đổi quyền → ETag khác; sau `updated` → ETag khác.

**Rủi ro cần canh:** proxy/CDN bỏ qua `private`. Sau deploy phải xem header thật qua Cloudflare/Render (curl `-I` có cookie) để chắc response không bị cache chung.

### Task 2.3 — Không parse lại ngày của hóa đơn/đặt hàng mỗi lần đổi bộ lọc

**Vấn đề:** `computeDashboardData` gọi `parseSheetDate` cho toàn bộ 15k hóa đơn + 22k đơn đặt hàng + trả hàng ở MỖI lần tính (đổi bộ lọc ~0,9 s).

- [ ] **B1 — Đo trước:** bọc `console.time` quanh các khối dựng `invoiceRecords`/`orderRecords`/`returnRecords` (dòng tương đối 201, 418, 453 trong hàm) để biết phần này chiếm bao nhiêu trong 0,9 s. **Nếu < 150 ms thì bỏ Task này.**
- [ ] **B2 — Nếu đáng làm:** `WeakMap<sheetsObject, parsedRecords>` — khóa theo chính object `sheets` từ cache (đổi phiên bản = object mới → tự hết hạn, không rò bộ nhớ). Hàm dựng records trả mảng mới cho mỗi bộ lọc; bản trong WeakMap chỉ đọc, **không** sửa tại chỗ.
- [ ] **B3 — Test:** hai bộ lọc khác nhau trên cùng sheets → kết quả y hệt bản trước khi sửa (snapshot so sánh `deepEqual` với output của commit trước).

### Nghiệm thu Đợt 2

- [ ] Log server: số lần `readCoreDashboardSheets` chạy mỗi giờ giảm rõ (trước: ~40/giờ/cơ sở khi có người xem; mục tiêu: ≈ số lượt sync).
- [ ] Network trình duyệt: SSE báo mới nhưng dữ liệu không đổi → 304, vài trăm byte.
- [ ] Số liệu các tab khớp trước khi sửa.

---

## ĐỢT 3 — Thay đổi cấu trúc (rủi ro trung bình, cần spec riêng trước khi làm)

Không làm ngay. Mỗi mục cần một spec/brainstorm riêng vì đụng shape dữ liệu hoặc luồng render.

### 3.1 — Bỏ việc đọc toàn bộ lịch sử hóa đơn/đặt hàng/trả hàng

- Hiện 7 tab core kéo hóa đơn/đặt hàng/trả hàng **toàn thời gian** rồi lọc theo ngày trong Node; đây là phần lớn trong 16 MB / 13,5 s.
- Hướng: các khối tab Hóa đơn/Đặt hàng/Trả hàng + "Chi tiết giao dịch" truy vấn SQL theo khoảng ngày của bộ lọc (giống `listPurchaseOrders`), chỉ lấy cột cần hiển thị thay vì ~20 cột tách từ `raw` jsonb.
- Khi làm mới cần index `invoices (branch, purchase_date)`, `orders (branch, purchase_date)`, và đổi điều kiện `(purchase_date AT TIME ZONE 'UTC')::date >= $2` thành so sánh trực tiếp trên `purchase_date` với mốc timestamp (sargable).
- Rủi ro: các KPI "toàn thời gian" và bộ lọc `mode=all` vẫn cần tổng toàn bộ → phải lấy từ rollup, không phải từ danh sách chi tiết. Cần đối chiếu từng con số với bản cũ.

### 3.2 — Tải theo tab (lazy) các bảng lớn

- `allProducts` (1,1 MB), `lowStock` (0,85 MB, 6.762 dòng), `debtManagement.customers` (~1 MB), bảng `invoices` (1,5 MB) luôn nằm trong payload dù người dùng đang ở tab khác.
- Hướng: endpoint con (vd `/api/dashboard/section/:name`) hoặc tham số `sections=` cho các bảng lớn, gọi khi mở tab; KPI/biểu đồ vẫn trong payload chính. Có thể phân trang server-side cho `lowStock`/`allProducts`.
- Rủi ro: ảnh hưởng tìm kiếm trong bảng, xuất file, điều hướng từ biểu đồ sang bảng (spec 2026-09-16) → phải rà hết chỗ đọc `state.data.<bảng>` trong `index.html`.

### 3.3 — Xem lại danh sách `lowStock`

- 6.762/10.680 mã bị tính là "tồn thấp" — gần như toàn bộ danh mục, có thể do gồm cả mã ngừng kinh doanh/tồn 0 lâu năm. Hỏi nghiệp vụ trước: nếu thu hẹp định nghĩa, payload và thời gian render giảm mà không cần đổi kiến trúc.

---

## Không làm (đã đo, không đáng)

- **Thêm index `purchase_date` ngay bây giờ:** truy vấn liên quan chỉ 39 ms trên DB; chậm ở client là do tranh pool, Đợt 1 đã giải quyết. Chỉ thêm khi làm 3.1.
- **Tăng `max` pool Postgres:** 12 đã sát hạn mức kết nối Supabase; giảm số câu chạy thừa (Task 1.1/1.2) hiệu quả hơn.

## Phụ lục — Script đo lại

Chạy từ `server/` (chỉ SELECT, đọc `.env`):

```js
require('dotenv').config();
const dd = require('./dashboard/dashboardData');
const { getPool } = require('./db/pool');
(async () => {
  const f = { overview: {}, products: {}, invoices: {}, customers: { mode: 'all' }, newPurchases: {}, newProducts: {} };
  const v = { permissions: [] };
  for (const label of ['cold', 'warm1', 'warm2', 'warm3']) {
    const s = Date.now(); await dd.getDashboardData(f, 'Hà Nội', v); console.log(label, Date.now() - s, 'ms');
  }
  await getPool().end();
})();
```

Số trước khi sửa (2026-09-25): cold 6,6–14,8 s · warm 300–500 ms · đổi bộ lọc ~0,9 s.
