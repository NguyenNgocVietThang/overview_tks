# Sổ quỹ (Cash book) — Thiết kế & hướng dẫn triển khai cho agent

Ngày: 2026-10-06 · Trạng thái: đã triển khai và kiểm chứng cục bộ; migration `0033` và deploy production còn chờ

## 1. Mục tiêu

Thêm tab cấp 1 **"Sổ quỹ"** (đặt ngay dưới tab "Quản lý nhân sự" trong sidebar) cho phép Quản lý:

1. Xem **số dư hiện tại của từng tài khoản** (ngân hàng + tiền mặt) — thay file Excel thủ công.
2. Lọc / xem **sổ chi tiết phiếu thu–chi** với bộ lọc giống KiotViet.
3. **Chốt số dư** theo sao kê ngân hàng bất cứ lúc nào; xem **lịch sử chốt**.
4. **Xuất Excel / HTML**, chọn cột trước khi xuất.

### Quyết định đã chốt (không bàn lại)

| # | Quyết định |
|---|---|
| D1 | Tất cả tài khoản đều có trong KiotViet. Dùng **tên tài khoản của KiotViet**, không có tính năng đổi tên/nhóm (Cá nhân/Công ty) trong phạm vi này. |
| D2 | Số dư = **số dư lần chốt gần nhất + Σ thu − Σ chi** của phiếu có `trans_date > checkpoint_at`. KiotViet không trả số dư nên bắt buộc có chốt. |
| D3 | **Không tách cơ sở.** Sổ quỹ luôn hiện toàn bộ tài khoản, gộp phiếu HN + SG; bỏ qua cookie `tks_branch`. |
| D4 | Có dòng **"Tiền mặt"** (phiếu không có tài khoản ngân hàng) như một quỹ riêng, chốt được. |
| D5 | **Phiếu đã hủy không bao giờ tính vào số dư**, bất kể bộ lọc. |
| D6 | Quyền mặc định: **chỉ Quản lý** (`cashbook.view`, `cashbook.manage`). |
| D7 | Tài khoản chưa từng chốt hiển thị **"Chưa chốt"**, không hiển thị 0. |

### Ngoài phạm vi (YAGNI)

Nhóm/đổi tên tài khoản, ẩn tài khoản, tách số dư theo cơ sở, biểu đồ, tạo/sửa phiếu thu chi từ dashboard, thông báo Telegram.

## 2. Bối cảnh code hiện có (đọc trước khi làm)

- `server/kiotvietSync/entities/cashFlows.js` — đã sync endpoint `cashflow` với `includeAccount/includeBranch/includeUser`, lưu bảng `cash_flows` (migration `0006`, đổi kiểu tiền ở `0012`). **Chưa có cột tài khoản** — chỉ nằm trong `raw` JSONB.
- `server/kiotvietSync/entities/entityUtils.js` — `createSimpleEntity`, `value()`. Mẫu entity đơn giản: `categories.js`.
- `server/kiotvietSync/scheduler.js`, `syncDriver.js` — đăng ký entity + lịch.
- `server/db/migrations/` — migration mới nhất `0032_hr_department_groups.sql` → dùng **`0033`**. Cập nhật `server/db/SCHEMA.md`.
- `server/auth/featureRegistry.js` — nhóm feature, `MANAGER_ONLY`, danh sách trang (`path/href/anyOf`, dòng ~111).
- `server/public/shared/shared-nav.js` — sidebar (khối HR ~dòng 1345, Vị trí hàng ~1388 là mẫu tab cấp 1 gần nhất).
- Mẫu module hoàn chỉnh để bắt chước: `server/stockLocations/` (routes + service + test) và `server/shipment/orderLifecycle*` (lọc/phân trang máy chủ, xuất Excel ≤ 20k dòng, hộp chọn cột).
- `server/excelTableStyle.js` — style Excel dùng chung.
- `server/dashboard/saleName.js` — cắt ID Telegram khỏi tên nhân viên; dùng cho tên người tạo/nhân viên.
- Quy ước frontend: HTML thuần, test trích code từ HTML (xem test của `public/stock-locations`). Múi giờ hiển thị/lọc: **Asia/Ho_Chi_Minh**.
- Bảng `staff` (tên nhân viên KiotViet theo branch + id).

## 3. Bước 0 — Xác minh dữ liệu thật (BẮT BUỘC trước khi code)

Chạy trên DB (role đọc) và ghi kết quả vào mục "Kết quả xác minh" cuối file này:

```sql
SELECT raw FROM cash_flows ORDER BY trans_date DESC LIMIT 5;
SELECT DISTINCT jsonb_object_keys(raw) FROM cash_flows;
```

Xác định đúng tên khóa (KiotViet trả camelCase hoặc PascalCase — dùng `value(x,'Pascal','camel')` như code hiện có) cho:

| Ý nghĩa | Tên đoán | Dùng cho |
|---|---|---|
| ID tài khoản ngân hàng | `accountId` | cột `account_id`, lọc Quỹ |
| Trạng thái (đã thanh toán/đã hủy) | `status` | D5, lọc Trạng thái |
| Nhóm/loại thu chi | `cashFlowGroupId`, `cashGroup` | lọc Loại thu chi |
| Hạch toán KQKD | `usedForFinancialReporting` | lọc Hạch toán KQKD |
| Người tạo | `createdBy` | lọc Người tạo |
| Người nộp/nhận | `partnerName`, `partnerType`, `partnerId` | lọc Người nộp/nhận |
| SĐT người nộp/nhận | `contactNumber` | lọc SĐT |
| Công nợ đối tác | (tìm khóa liên quan) | lọc Công nợ đối tác |

Gọi thử `GET /bankaccounts` của KiotViet (qua client trong `server/kiotviet/`) để xác nhận cấu trúc danh sách tài khoản.

**Quy tắc:** khóa nào không tồn tại → **ẩn bộ lọc tương ứng**, ghi lý do vào mục kết quả; **không đoán**. Nếu `accountId` không có thì DỪNG và báo người dùng (thiết kế phụ thuộc vào nó).

## 4. Bước 1 — Migration `0033_cash_book.sql`

```sql
ALTER TABLE cash_flows ADD COLUMN account_id BIGINT;
ALTER TABLE cash_flows ADD COLUMN status INT;          -- giá trị thật theo Bước 0
UPDATE cash_flows SET account_id = NULLIF(raw->>'accountId','')::bigint,
                      status     = NULLIF(raw->>'status','')::int;   -- sửa tên khóa theo Bước 0
CREATE INDEX idx_cash_flows_account_date ON cash_flows (account_id, trans_date);

CREATE TABLE cash_book_accounts (
  id          BIGINT PRIMARY KEY,         -- id tài khoản KiotViet
  bank_name   TEXT,
  account_no  TEXT,
  description TEXT,
  raw         JSONB NOT NULL,
  synced_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cash_book_checkpoints (
  id             BIGSERIAL PRIMARY KEY,
  account_id     BIGINT,                  -- NULL = quỹ Tiền mặt
  checkpoint_at  TIMESTAMPTZ NOT NULL,
  balance        NUMERIC NOT NULL,        -- số thực tế người dùng nhập
  system_balance NUMERIC,                 -- số hệ thống tính tại thời điểm chốt (NULL nếu chưa từng chốt)
  diff           NUMERIC,                 -- balance - system_balance
  note           TEXT,
  created_by     TEXT NOT NULL,           -- email/id người chốt
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_cash_book_checkpoints_account ON cash_book_checkpoints (account_id, checkpoint_at DESC);
```

- Kiểu tiền: theo `0012` (NUMERIC). Nếu `cash_flows.amount` là NUMERIC thì giữ đồng nhất.
- UPDATE backfill trên bảng lớn: chạy theo lô nếu > 200k dòng (nhớ sự cố Supabase Disk IO 2026-09-28 — tránh ghi đè no-op, chỉ UPDATE dòng `account_id IS NULL`).
- Thêm test vào `server/db/migrate.integration.test.js`. Cập nhật `SCHEMA.md`.

## 5. Bước 2 — Sync

1. `cashFlows.js`: thêm `account_id`, `status` vào `columns`, `updateColumns`, `map` (thứ tự cột phải khớp). Cập nhật `cashFlows.test.js`.
2. Entity mới `server/kiotvietSync/entities/bankAccounts.js` (mẫu `categories.js`): endpoint `bankaccounts`, bảng `cash_book_accounts`, **không theo branch** (nếu factory bắt buộc branch thì sync bằng branch `hanoi` và bỏ cột branch khỏi PK — ghi chú rõ). Đăng ký trong scheduler, chạy **1 lần/ngày** + chạy khi khởi động nếu bảng trống. Test kèm theo.

## 6. Bước 3 — Backend `server/cashbook/`

Tách file theo trách nhiệm:

| File | Trách nhiệm |
|---|---|
| `cashbookFilters.js` | Parse + validate query string → object filter chuẩn; build mệnh đề SQL tham số hóa. Thuần, không I/O. |
| `cashbookBalance.js` | Tính số dư từng quỹ: checkpoint mới nhất + Σ phiếu sau mốc (bỏ phiếu hủy). Hàm thuần nhận dữ liệu + hàm SQL. |
| `cashbookRepository.js` | Truy vấn Postgres (summary, entries có phân trang, filter-options, checkpoints, insert checkpoint trong transaction). |
| `cashbookExport.js` | Xuất xlsx/html cho 3 view, chọn cột, giới hạn 20.000 dòng (mẫu `orderLifecycleExport.js`). |
| `cashbookRoutes.js` | Express router, `requireFeature`. Mount trong `server/routes.js`. |

### Quy ước "quỹ"
- `fund=all` (Tổng quỹ), `fund=cash` (account_id IS NULL), `fund=bank` (account_id IS NOT NULL), `fund=<id>` (nhiều id cách nhau dấu phẩy).

### Công thức (D2, D5)
```
balance(fund) = cp.balance + Σ amount(is_receipt) − Σ amount(!is_receipt)
  với phiếu: account khớp fund, status ≠ ĐÃ_HỦY, trans_date > cp.checkpoint_at
  cp = checkpoint mới nhất của fund; không có cp → "Chưa chốt" (null)
```
Kiểm tra dấu `amount`: nếu KiotViet trả phiếu chi với amount âm thì KHÔNG trừ lần nữa — xác minh ở Bước 0 và viết test cho đúng thực tế.

KPI theo kỳ lọc [from, to] cho tập quỹ đang chọn: Quỹ đầu kỳ = số dư tại `from` (tính từ checkpoint ≤ from; nếu checkpoint > from thì tính lùi: cp.balance − Σ phiếu trong (from, cp]), Tổng thu, Tổng chi, Tồn cuối kỳ = đầu kỳ + thu − chi. Quỹ nào chưa chốt → KPI số dư hiển thị "Chưa chốt" (thu/chi vẫn hiển thị).

### API

| Method & path | Quyền | Mô tả |
|---|---|---|
| `GET /api/cashbook/summary` | `cashbook.view` | Bảng số dư từng quỹ (tên, số TK, số dư hiện tại, ngày chốt gần nhất) + 4 KPI theo bộ lọc. |
| `GET /api/cashbook/entries?page=&pageSize=` | `cashbook.view` | Sổ chi tiết, lọc + phân trang máy chủ, sắp xếp `trans_date DESC`. |
| `GET /api/cashbook/filter-options` | `cashbook.view` | Danh sách quỹ, loại thu chi, người tạo, nhân viên. |
| `GET /api/cashbook/checkpoints?fund=` | `cashbook.view` | Lịch sử chốt. |
| `POST /api/cashbook/checkpoints` | `cashbook.manage` | Body `{ fund, checkpointAt, balance, note }`. Trong 1 transaction: tính `system_balance` tại `checkpointAt`, ghi `diff`. Từ chối `checkpointAt` > now, balance không phải số. |
| `GET /api/cashbook/export?view=balances\|entries\|checkpoints&format=xlsx\|html&columns=` | `cashbook.view` | Xuất theo bộ lọc hiện tại. |

### Tham số bộ lọc (dùng chung summary/entries/export)

| Bộ lọc UI | Query | Mặc định |
|---|---|---|
| Quỹ | `fund` | `all` |
| Thời gian | `preset` (today, yesterday, thisWeek, thisMonth, lastMonth, thisYear) hoặc `from`,`to` (YYYY-MM-DD, giờ VN) | `thisYear` |
| Loại chứng từ | `docTypes=receipt,payment` | cả hai |
| Loại thu chi | `groups=<id,...>` | tất cả |
| Trạng thái | `statuses=paid,cancelled` | cả hai |
| Hạch toán KQKD | `accounting=all\|yes\|no` | `all` |
| Người tạo | `creators=<id,...>` | tất cả |
| Nhân viên | `staff=<id,...>` | tất cả |
| Người nộp/nhận | `partnerType=all\|customer\|supplier\|staff\|other`, `partnerQ`, `partnerPhone` | tất cả |
| Công nợ đối tác | `debt=counted,notCounted,none` | cả ba |

Danh sách rỗng (bỏ tick hết) → trả kết quả rỗng, không lỗi. Mọi giá trị đều qua tham số SQL, không nối chuỗi.

### Cột sổ chi tiết
Mã phiếu, Thời gian, Loại (Thu/Chi), Loại thu chi, Người nộp/nhận, SĐT, Quỹ/Tài khoản, Cơ sở (HN/SG — chỉ để tham khảo), Người tạo, Nhân viên, Giá trị (+/−), **Số dư lũy kế**, Trạng thái, Ghi chú.

**Số dư lũy kế** chỉ trả về khi: đúng 1 quỹ được chọn, quỹ đó đã chốt, không lọc Loại thu chi / Người tạo / Nhân viên / Người nộp nhận / Hạch toán / Công nợ, cả 2 loại chứng từ đều tick. Ngược lại trả `null` → UI để trống và hiện chú thích. Tính bằng window function (`SUM() OVER (ORDER BY trans_date, id)`) neo vào checkpoint; phiếu hủy hiển thị nhưng không cộng.

### Cache
Không cache kết quả (dữ liệu nhỏ, cần chính xác sau khi chốt). Chỉ cần index ở Bước 1. Nếu đo thấy chậm > 1s mới tính tiếp.

## 7. Bước 4 — Quyền & điều hướng

`server/auth/featureRegistry.js`:
- Nhóm `{ key: 'cashbook', label: 'Sổ quỹ' }` — đặt ngay sau nhóm `hr`.
- `{ key: 'cashbook.view', groupKey: 'cashbook', label: 'Xem sổ quỹ', roles: MANAGER_ONLY }`
- `{ key: 'cashbook.manage', groupKey: 'cashbook', label: 'Chốt số dư sổ quỹ', roles: MANAGER_ONLY, requires: ['cashbook.view'] }` (dùng cơ chế `requires` hiện có nếu áp dụng).
- Trang `{ path: '/cashbook', href: '/cashbook/', anyOf: ['cashbook.view'] }`.
- Cập nhật test của featureRegistry / quyền mặc định (Sale, Kho, Khách phải KHÔNG có).

`server/public/shared/shared-nav.js`: thêm mục cấp 1 "Sổ quỹ" (key `cashbook`) **ngay dưới "Quản lý nhân sự"**, hiện khi có `cashbook.view`. Không phụ thuộc chọn cơ sở; khi ở trang `/cashbook` thì bộ chọn cơ sở có thể giữ nguyên nhưng không ảnh hưởng dữ liệu (hiện badge "Toàn công ty").

## 8. Bước 5 — Frontend `server/public/cashbook/index.html`

HTML thuần, theo theme sáng/tối và `shared-nav` như `public/stock-locations/`.

Bố cục: **cột bộ lọc trái** (giống KiotViet, ảnh tham chiếu trong hội thoại 2026-10-06) + **nội dung phải**. Mobile: bộ lọc thu thành nút "Bộ lọc" mở ngăn kéo.

Thứ tự bộ lọc: Quỹ (radio Tổng quỹ / Tiền mặt / Ngân hàng + multi-select tài khoản) · Thời gian (radio preset ▸ | Tùy chỉnh Từ–Đến) · Loại chứng từ (☑Phiếu thu ☑Phiếu chi) · Loại thu chi (multi-select) · Trạng thái (☑Đã thanh toán ☑Đã hủy) · Hạch toán KQKD (chip Tất cả/Có/Không) · Người tạo · Nhân viên · Người nộp/nhận (select loại + ô tên/mã + ô SĐT) · Công nợ đối tác (3 checkbox). Ô text debounce 300ms. Lưu bộ lọc vào URL hash để F5 không mất.

Nội dung phải (từ trên xuống):
1. Dòng "Dữ liệu KiotViet đồng bộ lúc HH:mm dd/MM" (checkpoint sync của `cash_flows`).
2. 4 thẻ KPI: Quỹ đầu kỳ · Tổng thu · Tổng chi · Tồn quỹ.
3. **Bảng số dư tài khoản**: Tên · Số TK · Số dư hiện tại · Chốt gần nhất · nút **Chốt số dư** (chỉ khi có `cashbook.manage`). Dòng tổng cuối bảng (tổng các quỹ đã chốt + ghi chú số quỹ chưa chốt). Bấm dòng → đặt bộ lọc Quỹ = tài khoản đó.
4. **Sổ chi tiết** (phân trang máy chủ).
5. **Lịch sử chốt số dư**: Thời điểm chốt · Quỹ · Người chốt · Số hệ thống · Số thực tế · Chênh lệch (đỏ nếu ≠ 0) · Ghi chú.

Hộp thoại **Chốt số dư**: Quỹ (đã chọn sẵn), Thời điểm (mặc định hiện tại, cho phép chọn quá khứ), Số dư thực tế (định dạng 1,234,567 khi gõ), Ghi chú. Trước khi lưu hiện "Hệ thống đang tính: X — chênh lệch: Y" (gọi summary). Lần chốt đầu tiên của tài khoản là cách nhập số dư ban đầu (ví dụ các số trong file Excel).

Mỗi bảng 3/4/5 có nút **Xuất** → hộp chọn cột (tick, mặc định tất cả) + chọn Excel/HTML (tái dùng hộp "Cột hiển thị"/xuất của vòng đời đơn).

Tiền: định dạng `1.234.567` theo quy ước hiện có của dashboard; số âm màu đỏ.

## 9. Kiểm thử (bắt buộc, `node --test` với glob)

- `cashbookBalance.test.js`: chưa chốt → null; có chốt + phiếu sau mốc; phiếu đúng bằng mốc (không tính, vì `>`); phiếu trước mốc bị bỏ; phiếu hủy bị bỏ; tiền mặt (account null); nhiều checkpoint lấy mới nhất; Quỹ đầu kỳ khi `from` trước/sau checkpoint.
- `cashbookFilters.test.js`: mặc định, preset theo giờ VN (biên 00:00/23:59), danh sách rỗng, giá trị lạ bị từ chối (400), không có SQL injection (tham số hóa).
- `cashbookRoutes.test.js`: Sale/Kho/Khách → 403; Quản lý → 200; POST checkpoint thiếu `cashbook.manage` → 403; checkpointAt tương lai → 400; transaction ghi đúng `system_balance`/`diff`.
- `cashbookExport.test.js`: chọn cột, > 20k dòng → lỗi thân thiện, HTML escape.
- Entity `bankAccounts.test.js`, cập nhật `cashFlows.test.js`, migration integration test.
- Test frontend trích code từ HTML (format tiền, build query từ bộ lọc, điều kiện hiện số dư lũy kế).
- Chạy toàn bộ test suite trước khi commit; không được giảm số test đang pass.

## 10. Thứ tự giao việc & commit

1. Bước 0 (xác minh) → cập nhật mục 12. 2. Migration + sync (commit `feat(cashbook): sync bank accounts and cash flow account_id`). 3. Backend + test (`feat(cashbook): balance, ledger and checkpoint API`). 4. Quyền + nav. 5. Frontend + xuất. 6. Kiểm tra trên trình duyệt (harness xem trang không cần đăng nhập — xem memory `reference-tokosi-view-pages-without-login`), chụp ảnh sáng/tối/mobile.

## 11. Checklist deploy

1. Áp migration `0033` (backfill có thể lâu — chạy ngoài giờ cao điểm).
2. Deploy code; xác nhận `cash_book_accounts` có dữ liệu sau lần sync đầu (hoặc chạy tay job bankAccounts).
3. Quản lý chốt số dư ban đầu cho từng tài khoản + Tiền mặt (dùng số trong file Excel tại một thời điểm X).
4. Đối chiếu 1–2 ngày với sao kê; lệch thì kiểm tra phiếu KiotViet thiếu tài khoản.

## 12. Kết quả xác minh (agent điền ở Bước 0)

- Xác minh ngày 2026-10-06: người dùng cho phép SELECT bằng kết nối hiện có; role thực tế `postgres`, `BEGIN READ ONLY` và kiểm tra `transaction_read_only=on`, chỉ SELECT rồi ROLLBACK. `reporting_readonly` không dùng được vì SET ROLE lỗi 42501.
- Khóa tài khoản: `accountId` (65.542/74.946 dòng); 9.404 dòng thiếu = quỹ Tiền mặt theo D4. Không suy ra từ method: 100 dòng Cash có ID, 9 Transfer thiếu ID. `IsReceipt` có chữ I/R hoa.
- Giá trị status: `0` = Đã thanh toán (74.657), `1` = Đã hủy (289), nhãn ở `statusValue`.
- Dấu amount: tất cả 55.438 phiếu thu dương; tất cả 19.508 phiếu chi âm. Tổng số dư dùng amount đã có dấu, không trừ chi âm lần nữa; loại status=1.
- Loại thu chi: `cashFlowGroupId` (63.376 dòng) + `cashGroup` (74.388). Hạch toán: `usedForFinancialReporting` 0/1 (70.128/4.818). Người tạo `createdBy`, nhân viên `userId` có mọi dòng; tên `user` chỉ có 38.639 dòng, fallback staff và saleName. Người nộp/nhận `partnerType`, `partnerId`, `partnerName`; SĐT `contactNumber`. Không có khóa công nợ hoặc mã đối tác trong toàn bộ raw keys.
- GIỮ quỹ/thời gian/chứng từ/loại thu chi/trạng thái/hạch toán/người tạo/nhân viên/tên người nộp nhận/SĐT. ẨN công nợ và tìm mã đối tác vì thiếu trường. Mã partnerType quan sát B/C/O/S/U; source nội bộ xác nhận C=customer, các nhãn khác chưa được xác minh nên ẩn chọn loại đối tác đến khi có bằng chứng, không đoán ánh xạ.
- GET `/bankaccounts` đã xác minh qua client hiện có: Hà Nội 26 tài khoản, Sài Gòn 24. Trường quan sát: `id`, `bankName`, `accountNumber`, `retailerId`, `accountType`, `createdDate`, `modifiedDate`, `description`. ID có kiểu number và đã đối chiếu với `cash_flows.raw` theo branch như bên dưới. Dùng `node --use-system-ca` để tin cậy chứng thư hệ thống, không tắt xác minh TLS.
- Đối chiếu accountId theo branch với `/bankaccounts`: HN 30 ID raw, 25 khớp, 5 thiếu danh mục hiện tại (48 dòng); SG 25 ID raw, 22 khớp, 3 thiếu (32 dòng). Giữ ID lịch sử, không đổi 80 dòng này thành tiền mặt; cần fallback hiển thị cho tài khoản chưa có danh mục. Nguyên nhân thiếu chưa được xác minh.
- Báo cáo chi tiết: `.superpowers/sdd/2026-10-06-so-quy-subagent-prompts/task-A-report.md`.
- Kiểu JSON quan sát: number = accountId/cashFlowGroupId/usedForFinancialReporting/createdBy/userId/partnerId; string = cashGroup/user/partnerType/partnerName/contactNumber. Nhóm có tên nhưng thiếu ID cần giữ qua khóa tên.
- ID thiếu danh mục (ID:số dòng): HN `1219533:2`, `1219532:22`, `-1:2`, `1220929:4`, `1219530:18`; SG `1219549:21`, `-1:4`, `1219547:7`. Giá trị `-1` cũng không được đoán nghĩa. Fallback tên: `Tài khoản #ID (không có trong danh sách KiotViet)`.
