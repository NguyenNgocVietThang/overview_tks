# Kế hoạch: Tính sẵn báo cáo trong DB + hoàn tất việc tồn đọng (2026-10-19)

## Context

Nguyên tắc dự án: báo cáo mới = bảng kết quả dựng bằng job nền, web chỉ đọc (`feedback-tokosi-precompute-db-tables`).
Bạn yêu cầu 3 ưu tiên, cộng "hoàn thành luôn các việc chưa xong" ở `tasks/` (đã chốt: được migrate DB + push git, KHÔNG deploy/Render; đối chiếu từng mục cũ với code/git).

Khảo sát code cho thấy 2 giả định cần chỉnh:

| Ưu tiên | Giả định | Thực tế trong code |
|---|---|---|
| 1 Kinh doanh | Tháng hiện tại quét SQL mỗi lần xem | Đã có cache SWR 60s; tháng hiện tại tải tuần tự bằng `live()`. Hết hạn thì 1–2 s. Thật sự cần bảng tính sẵn, nhất là cho `/detail` (`linesFor`). |
| 2 Marketing | Còn đọc Sheets + Pancake lúc request | Pancake đã sync đêm vào Postgres (mig 0044/0046/0056, `MARKETING_REPORT_SOURCE=pancake`). **Còn lại thật**: (a) chi phí ADS vẫn đọc Sheets mỗi request, không có bảng; (b) doanh số KiotViet ghép theo tên trong RAM; (c) toàn bộ observation (~22k+) đọc và gộp bằng JS mỗi request. |
| 3 Sổ quỹ | Trang `/reports/#cashbook`, JOIN `cash_book_account_banks` | Trang là `/cashbook/`. Bảng `cash_book_account_banks` **không query nào dùng**. Cột "ngân hàng" thực ra là `cash_book_accounts.bank_name` = tên chủ TK. Gộp HN+SG và 5 nhóm quỹ nằm trong JS (`groupFunds`, `GROUP_ACCOUNT_NUMBERS`). |

Trung thực về Ưu tiên 3: view thường trong Postgres **không** cho cache query plan tốt hơn. Lợi ích thật là đơn giản hóa code và gom trích xuất JSON (`raw->>...`) vào một chỗ để trang dữ liệu không phải kéo cột `raw` (giảm egress Supabase).

## Quyết định thiết kế

- Mọi bảng/view mới **fail-soft**: thiếu migration (`42P01`/`42703`) thì tự lùi về đường cũ, không làm hỏng báo cáo (mẫu `debtAgingRefresh`, `missingMonthlyRelation`).
- Job ghi **diff-only** (`unnest` + `LEFT JOIN` + `IS DISTINCT FROM`, `ON CONFLICT DO UPDATE`, chốt an toàn không xóa khi đọc ra 0 dòng) để không lặp sự cố Disk IO 2026-09-28.
- Số migration cấp trước, tránh va nhau: **0068** (kinh doanh), **0069** (marketing), **0070** (sổ quỹ).
- Agent chạy song song trong **cùng checkout**, mỗi agent chỉ chạm tập file riêng, **không commit** (merge git trên Windows hay lỗi `unlink`, xem memory). Tôi commit từng mảng. Tài liệu dùng chung (`SCHEMA.md`, `README`, `server/README.md`, `CURRENT.md`, docs SRS/BRD) do một lượt cuối viết, tránh tranh chấp file.
- Thư mục theo dõi: `tasks/2026-10-19-precompute-reports/{plan.md,todo.md}`. **Không ghi đè** `tasks/plan.md`, `tasks/todo.md` cũ (chỉ tick lại, ở Task 0).

## Hợp đồng dữ liệu (cho agent chạy song song)

Migration `0068_business_current_month.sql`:
```sql
business_current_month_customer_sales          -- cột y hệt business_monthly_customer_sales
  (month, branch, customer_code, customer_id, customer_name,
   invoice_amount, return_amount, net_revenue, invoice_count, return_count,
   PRIMARY KEY (month, branch, customer_code))
business_current_month_customer_product_sales -- cột y hệt business_monthly_customer_product_sales
  (month, branch, customer_code, product_code, product_name, net_revenue, net_qty,
   PRIMARY KEY (month, branch, customer_code, product_code))
business_current_month_state
  (id int PK CHECK(id=1), month date, computed_at timestamptz, cutoff timestamptz,
   last_full_at timestamptz, customers_synced_at timestamptz, version bigint)
```
Không dùng tên `business_current_month_cache` đơn lẻ: `/detail` cần dòng khách × mã hàng, nên cần 2 bảng mirror bảng chốt (đọc code cũ gần như không đổi). Không ghi vào `business_monthly_*`, vì có dòng trong `business_monthly_state` nghĩa là "đã chốt".

## Task 0 — Tồn đọng cũ (agent C, chỉ chạm `tasks/*`, `auth/`, `shipment/`, test liên quan)

Quy tắc: đối chiếu từng mục với code + git + test, **không tin tên commit**; mục nào chưa thật sự làm thì làm nốt.

- **0a. `tasks/plan.md` + `tasks/todo.md` (vá auth/dọn API, T0–T13)**
  - Commit `0a10477`, `643b85f`, `ceeffd4` có trong git. Với từng T: grep xác nhận (resolver không gắn lại TK; `POST /api/auth/profile` không đổi email; `/api/search`, `customer-product-top`, `register/*`, `hr/telegram/link-status`, `shipment/lifecycle/lookup` đã gỡ; các trường Tổng quan/Hóa đơn/Hàng hóa đã bỏ; FE đã bỏ `topSellingProducts`, `days`).
  - T0 (SQL audit TK gắn sai nhân sự): chạy `tasks/audit-hr-binding.sql` **chỉ đọc** trên DB, báo kết quả. TK nghi vấn → liệt kê cho Quản lý xử lý tay (không tự sửa dữ liệu).
  - Preview 4 tab + thử export còn lại bằng harness (`reference-tokosi-view-pages-without-login`).
  - Tick các mục đã chứng minh; mục thiếu → làm + test.
- **0b. `2026-10-12-lifecycle-north-south`**: viết 10 test còn thiếu trong `plan.md` (repo đọc tab Bắc-Nam, thiếu cột/đổi thứ tự, `getValues` lỗi vẫn trả HN+SG, thứ tự đọc HN→Bắc-Nam→SG, cảnh báo 24h, `mergeRows`, ghi đè thủ công), kiểm hành vi HN/SG không đổi, cập nhật `README.md`/`server/README.md`/docs/`CURRENT.md`. Mục "đơn `DH043419` hiện đúng trên trang" chạy được qua harness thì chạy, không thì ghi rõ.
- **0c. `2026-10-09-pancake-marketing`**: đối chiếu với trạng thái thật (docs ghi run 28 ngày 16/10 đạt 6 page, `MARKETING_REPORT_SOURCE=pancake`). Truy vấn DB chỉ đọc `marketing_pancake_independent_*`, `marketing_sync_runs` để xác nhận. Cập nhật tick; mục lỗi thời (plan A/ID-recovery bị plan B thay) ghi "superseded".
- **0d. `2026-10-05-hr-approval`, `todo-shipping-volume.md`**: đối chiếu code/test; commit nếu code đã xong chờ duyệt.
- **Phần tôi KHÔNG làm được/được phép (liệt kê thành checklist cho bạn):** thử bot Telegram thật, đo p95 trên service chạy thật, bật `MARKETING_REPORT_SOURCE`/job trên Render, "ít nhất 3 đợt hằng ngày" (cần 3 ngày thật), nghiệm thu T7 và các mục "người dùng duyệt".
- Migration 0031 (hr-approval): kiểm `schema_migrations` xem đã áp chưa; nếu có staging thì áp ở đó trước, **nếu không có staging, hỏi bạn trước khi áp lên DB chính**.

## Task 1 — Ưu tiên 1: Báo cáo kinh doanh tháng hiện tại (agent A)

Files: `server/db/migrations/0068_business_current_month.sql`, `server/kiotvietSync/businessCurrentMonthRefresh.js` (+ test), `server/businessReport/businessReportRepository.js`, `server/kiotvietSync/scheduler.js`, `server/config.js` (nếu cần cờ), tests `businessReport/*.test.js`, `kiotvietSync/scheduler.test.js`, `db/businessCurrentMonthMigration.test.js`.

1. Migration 0068 theo hợp đồng trên (`IF NOT EXISTS`, không `CONCURRENTLY`).
2. Job `refreshBusinessCurrentMonth(pool)`: chạy lại đúng `CUSTOMER_MONTH_SELECT_SQL` + `CUSTOMER_PRODUCT_MONTH_SELECT_SQL` (tái dùng `businessMonthlySql.js`, **không viết lại công thức** → số live = số chốt) cho tháng hiện tại, ghi diff-only, cập nhật `business_current_month_state` (`version` chỉ tăng khi đổi). Giữ `OFFSET 0` fence, `work_mem`, `enable_mergejoin=off`, `statement_timeout`. Khóa advisory riêng, gom lượt (`running/rerunRequested`), nuốt `42P01`.
   - Lượt nhanh gắn trong `runFastGroupAndRollup` (sau sync nhanh, cạnh `refreshDebtAging`), bọc `try/catch`. Có sàn tối thiểu giữa 2 lượt (mặc định ~10 phút) + chạy ngay khi sang tháng mới.
   - Lượt đầy đủ mỗi đêm (bắt hóa đơn sửa/hủy muộn, vì phát hiện thay đổi bằng `synced_at` chứ không `modified_date`). Sang tháng thì xóa dòng tháng cũ khỏi bảng này sau khi `freezeMonth` ghi xong.
   - Phát tín hiệu `onBusinessCurrentMonthChanged` để repository xóa cache.
3. Repository: với tháng chưa chốt = tháng hiện tại, đọc từ 2 bảng mới khi `state.month = currentMonth` và `computed_at` chưa quá hạn (mặc định 30 phút); ngược lại/thiếu bảng → lùi về `live()` cũ. `linesFor` (`/detail`) đọc bảng khách × mã hàng mới. Thêm tên bảng vào `MONTHLY_TABLES`/`missingMonthlyRelation`. Tháng vừa qua chưa chốt vẫn đi đường `live()` (không đổi).
4. Giữ nguyên: Team/nhóm sale ghép lúc đọc (đổi Team không cần làm mới bảng), lọc `is_active` lúc đọc, `refreeze` xóa cache cả bảng mới.

Acceptance:
- [ ] Test PGlite: số từ bảng mới == số từ `live()` trên cùng dữ liệu mẫu (khách, sale, mã hàng, HN+SG gộp).
- [ ] Không có migration → báo cáo vẫn chạy bằng `live()`; job không ném lỗi.
- [ ] Job chạy lần 2 không đổi gì → 0 dòng ghi, `version` giữ nguyên.
- [ ] `/sales|/customers|/products|/overview|/detail|/export` giữ nguyên JSON (test hiện có không phải sửa nội dung kỳ vọng).
- [ ] Đo `snapshot()` tháng hiện tại từ bảng < 50 ms trên DB thật (chỉ đọc).

## Task 2 — Ưu tiên 3: Sổ quỹ (agent B; độc lập, làm trước để fail-fast)

Files: `0070_cash_book_transactions_view.sql`, `server/cashbook/cashbookRepository.js`, `cashbookFilters.js`, `cashbookRepository.test.js`, `cashbookFilters.test.js`, `db/cashBookViewMigration.test.js`, `db/migrate.integration.test.js` (nếu bị ảnh hưởng).

1. `CREATE OR REPLACE VIEW v_cash_book_transactions`: từ `cash_flows c LEFT JOIN cash_book_accounts a ON a.id=c.account_id`, đưa ra `branch,id,code,trans_date,is_receipt,amount,method,status,account_id,user_id,description,source_missing_at,fund_key` (đúng biểu thức hiện có), `account_no,account_name(=bank_name),account_desc`, và các trường trích sẵn từ `raw`: `cash_group_id,cash_group_name,partner_id,partner_name,partner_phone,created_by,user_name,used_for_financial_reporting`. **Không** lộ `raw`. Có `GRANT SELECT` cho `reporting_readonly` nếu cần.
2. Repository đọc từ view: `fundsSql`, `funds()`, `summary()`, `entries()` (CTE `page`, `timeline`), `filterOptions()`. `buildWhere` đổi các điều kiện `raw->>` thành cột view. Trang dữ liệu thôi `SELECT c.*` kéo `raw`.
3. Giữ trong JS: `groupFunds`, `GROUP_ACCOUNT_NUMBERS` (một nguồn sự thật, tránh nhân đôi hằng số sang SQL). Không đụng bảng `cash_book_account_banks` (chưa dùng; ghi vào docs là bảng chờ dọn, không xóa trong đợt này).
4. Không tạo generated column/index trên `cash_flows` (viết lại bảng trên Supabase rủi ro IO). Đề xuất index `(trans_date) WHERE source_missing_at IS NULL` ghi vào "Mở" sau khi đo `EXPLAIN`.

Acceptance:
- [ ] 12 test `cashbookRepository.test.js` xanh (cập nhật schema giả thêm view), `cashbookFilters.test.js` xanh.
- [ ] JSON `/summary`, `/entries`, `/filter-options` giữ nguyên khóa (`test/frontend/cashbook*.test.js` xanh).
- [ ] So sánh trước/sau trên DB thật (chỉ đọc): `totalBalance`, số dòng, `runningBalance` trang đầu khớp 100%.
- [ ] Payload `/entries` không còn nhắc tới `raw` ở phía truy vấn.

## Task 3 — Ưu tiên 2: Marketing (agent D; 3 bước tuần tự vì cùng module)

Files: `0069_marketing_precompute.sql`, `server/marketingReport/*` (repository, service, mới: `marketingAdsSync.js`, `marketingSummaryRefresh.js`), `server/sheetSnapshots/` (chỉ đọc làm mẫu), `server/businessReport/businessMonths.js` (căn `nameKey`), test tương ứng.

3a. **Bảng chi phí ADS** `marketing_ads_costs` (+ state): sync từ workbook ADS (`COST_PAGES`, `parseCosts`, khối Quảng Châu nằm trong tab Hữu Nghị, phân biệt dòng tổng tháng/dòng ngày), theo mẫu `sheetSnapshots/sync.js` (diff-only, advisory lock). Chạy theo lịch hiện có của Pancake sync hoặc 30–60 phút/lần. `report('costs')` đọc bảng; thiếu bảng/chưa sync → lùi về đọc Sheets. Đây là bước duy nhất gỡ phụ thuộc Google Sheets lúc request.

3b. **Ghép doanh số bằng SQL**: hàm SQL `tks_name_key(text)` IMMUTABLE (cùng công thức `normalizedNameSql`), căn JS `nameKey` cho cùng kết quả (hiện JS không bỏ ký tự zero-width, SQL có — thêm test lệch). View `v_marketing_customer_revenue(month, name_key, net_revenue, known)` = UNION `business_monthly_customer_sales` (tháng đã chốt) + `business_current_month_customer_sales` (từ Task 1), gộp HN+SG theo `name_key`, giữ ngữ nghĩa: có trong danh bạ nhưng không bán = 0; không có trong danh bạ = NULL. Giữ lọc khách `is_active=false`. Thay `marketingRevenue.js` bằng truy vấn view; lùi về đường RAM nếu thiếu view.
   - Dùng **view, không trigger** (doanh số đổi liên tục, trigger sẽ ghi dày và gây IO; view đọc rẻ vì bảng nguồn đã tính sẵn).

3c. **Bảng kết quả Pancake tính sẵn** `marketing_phone_summary` (theo `page_id, phone_key` hoặc theo tháng/page/nhân viên — agent chốt dạng nhỏ nhất đủ cho `aggregateIndependentPhones` + `countPhoneKpis`) dựng cuối mỗi lượt Pancake sync (đã chạy đêm, nên không thêm tải). Service DB đọc bảng thay vì kéo toàn bộ observation; lọc/phân trang bằng SQL. Chốt đơn (`marketing_monthly_rows`) giữ nguyên (nhập tay).

Acceptance:
- [ ] Test so sánh: kết quả từ bảng/view == kết quả đường cũ (JS) trên fixture, cả `monthly`, `receipt-check`, `phones`, `costs`.
- [ ] Không còn gọi Sheets lúc request khi bảng ADS có dữ liệu (test kiểm số lần gọi `read()` = 0).
- [ ] Thiếu migration/bảng → lùi đường cũ, không lỗi.
- [ ] `marketing-report.test.js` (frontend) và `marketingReportRoutes.test.js` xanh, JSON không đổi khóa.
- Ngoài phạm vi (ghi vào "Mở"): giữ hay xóa chế độ `sheets`/`postgres` legacy và `marketingSheetsWriter`; "chốt đơn" từ Pancake (chưa có sự kiện); bật env trên Render.

## Thứ tự và song song

```
Wave 1 (song song, tập file rời nhau, không commit)
  A: Task 1 (kinh doanh)   B: Task 2 (sổ quỹ)   C: Task 0 (tồn đọng cũ)   D: Task 3a (ADS) → 3b chờ A xong 0068 → 3c
Checkpoint 1: tôi review diff từng mảng, chạy test tập trung, commit riêng 3-4 commit
Wave 2: lượt tài liệu (SCHEMA.md 0068-0070, README, server/README, implementation_plan, SRS/BRD, CURRENT.md, ngày cập nhật cuối)
Checkpoint 2: npm test toàn bộ xanh + graphify update . + git status
Wave 3: migrate DB (0068→0070 và các mig tồn đọng chưa áp), đo/đối chiếu chỉ đọc, push main
```
D chỉ bắt đầu 3b sau khi A đã tạo file 0068 (agent A tạo 0068 trước tiên, ngay đầu task). Nếu A/D cần chung `scheduler.js`, chỉ A sửa; D tự đăng ký job trong `pancakeScheduler.js`.

## Rủi ro

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Số bảng tính sẵn lệch live (hóa đơn sửa muộn) | Cao | tái dùng nguyên SQL chốt; lượt full đêm; test đối chiếu live-vs-bảng; ngưỡng quá hạn 30 phút → lùi `live()` |
| Job ghi dày làm lại sự cố Disk IO | Cao | diff-only, `version` chỉ tăng khi đổi, sàn 10 phút, chốt an toàn không xóa khi 0 dòng |
| Migrate lên DB thật trước khi code lên | Thấp | mọi đường đọc fail-soft; áp migration rồi mới push |
| Lệch `nameKey` JS/SQL → khách mất doanh số | Trung | test chéo với tên có zero-width, dấu, khoảng trắng |
| Hai file `0044_*` làm thứ tự migration mơ hồ | Thấp | giữ nguyên, không đổi tên |
| `CURRENT.md` mâu thuẫn về 0066 đã áp chưa | Thấp | tra `schema_migrations` trước khi áp, chỉ áp mig chưa có |
| Agent chung checkout ghi đè nhau | Trung | tập file rời nhau, không commit, tôi review diff từng mảng |

## Câu hỏi mở (không chặn)
- Staging cho migration 0031 có tồn tại không? Nếu không, sẽ hỏi trước khi áp lên DB chính.
- Có muốn bật `REPORTS_INCREMENTAL_ENABLED`? Job kinh doanh mới dựa cờ riêng, mặc định bật khi có migration (như `debtAgingRefresh`), không đụng cờ này.

## Kiểm chứng đầu-cuối

1. `cd server; npm test` — 100% xanh (baseline trước khi bắt đầu ghi lại số test/skip).
2. Harness PGlite/trang giả (`.codex_tmp/cashbook-review/harness.js` cổng 3066, mở bằng `preview_start --use-system-ca`): mở `#business` (các tab Sale/Khách/Hàng hóa + hộp chi tiết), `/cashbook/` (lọc thu/chi, phân trang, xuất), `#marketing` (4 báo cáo) → console sạch, số khớp trước/sau.
3. Trên DB thật (chỉ đọc): so `business_current_month_*` với tổng `live()`; `EXPLAIN ANALYZE` `snapshot()` < 50 ms; tổng quỹ view == truy vấn cũ; 0 lần gọi Sheets cho costs.
4. `graphify update .`, cập nhật `CURRENT.md`, `git status` chỉ gồm file dự kiến, push main.
