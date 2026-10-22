# Bàn giao: Kế toán – ORDER VAT (đã gộp và push `main`)

> Viết 20/10/2026, cập nhật đối soát 21/10/2026 để AI khác (Codex) làm tiếp. Đọc hết file này trước khi sửa code. Các số liệu nhập ngày 20/10 bên dưới là lịch sử; bộ dữ liệu hiện hành có 1.360 dòng.
> Quy tắc dự án: [CLAUDE.md](../../CLAUDE.md), [MEMORY.md](../../MEMORY.md), [CURRENT.md](../../CURRENT.md).

## 1. Tính năng là gì

Trang `/vat-request/` thay Google Form + sheet "ORDER VAT 1". Sale gửi yêu cầu xuất hóa đơn VAT, Kế toán (KT) xử lý trạng thái. Có phân quyền theo trường, khóa theo trạng thái, lịch sử từng trường và chống ghi đè (version).

Ý định đã chốt với chủ dự án (đừng tự đổi):
- **Sale** (`accounting.vatRequest`, mặc định Nhân viên sale + Kế toán + Quản lý): tạo yêu cầu, **xem toàn bộ bảng** (chỉ đọc dòng người khác), sửa/xóa yêu cầu của mình khi chưa khóa.
- **KT được cấp quyền riêng** (`accounting.vatRequestProcess`, mặc định chỉ Quản lý): sửa `status`, `accountantNote`, `arrivalDate`; sửa nhanh trên dòng, chọn nhiều dòng đổi hàng loạt, chế độ "Gom theo mã SP". Quản lý cấp cho từng tài khoản Kế toán tại `/account/#users` → Sửa phân quyền; quyền này cần `accounting.vatRequest`. Kế toán chưa được cấp chỉ xem/tạo yêu cầu.
- **Quản lý**: sửa mọi trường.
- Trạng thái: `pending` (mặc định) / `0` Không khai được / `1` Đã xong / `2` Đã khai chờ về / `3` Chờ khai chèn / `4` Chờ cont về, tăng slg.
- Sale bị khóa khi status ∈ {0,1,2}. Sale sửa yêu cầu đang 3/4 → **tự về pending**. KT đổi trạng thái mọi chiều (lùi = mở khóa).
- Trường sale: khách (gõ tự do + gợi ý KiotViet/lịch sử VAT, tìm không dấu, mã khách, đảo từ), mã SP (chọn từ `product_report`), SL nguyên > 0, giá chưa VAT > 0, **Full VAT / Không full VAT**, ghi chú. Giá được gợi ý từ yêu cầu VAT gần nhất cùng mã và chỉ áp dụng khi bấm; không dùng giá cột J của sheet. Không có ô "giá đã gồm VAT".
- Cột live (không lưu DB): **O Tồn VAT** = `TỒN ĐẦU NGÀY` (cột I) tab GỘP MỚI tra qua Khớp mã, cộng mọi công ty; **P** = Σ SL yêu cầu cùng mã ở 3/4; **Q** = Σ `product_container_lines` status 1–3; **R** = ETA sớm nhất (đọc chữ "DK 14-16/10").
- Ngoài phạm vi: thông báo, ghi ngược Google Sheets, nối tool Nháp VAT, tách theo công ty/cơ sở. 3 sheet XỬ LÝ VAT LÂU / HẢI - VAT / Chạy tồn VAT bỏ hẳn.
- Import toàn bộ sheet cũ; ngày 21/10/2026 đã thay bộ 1.357 dòng bằng CSV mới 1.360 dòng theo yêu cầu chủ dự án, giữ lịch sử và xóa mềm bộ cũ.

## 2. Trạng thái hiện tại

- **21/10/2026, đã hoàn tất code và nhập CSV mới:** form nhiều mã SP, dán Excel, lưu bản nháp, sắp xếp cột và màu trạng thái (`1b52247`) đã gộp vào `main`. GitHub `main` được đối chiếu trực tiếp tại `4be5e1554d3bea87eef9eadbc7a98b649cfcbed5`. Lệnh nền Claude `bv2dn8p4u` đã COMMIT thành công và exit 0; không chạy lại script thay toàn bộ dữ liệu.
- **Đối soát DB chỉ đọc 21/10/2026 lúc 11:19 VN:** 1.360 dòng đang hiển thị, 1.357 dòng cũ xóa mềm, 0 dòng tạo trên web; đủ 1.360 lịch sử nhập mới và 1.357 lịch sử xóa. Khớp CSV cả 21.760 giá trị (16 trường/dòng), không thiếu/thừa/sai lệch, `legacy_row` duy nhất, thành tiền đúng. 1.213 dòng khớp tài khoản Sale, 147 giữ tên chữ; trạng thái `0`: 70, `1`: 1.268, `2`: 18, `3`: 4. Giữ nguyên ô nguồn lỗi/thiếu: 13 thời gian, 2 SL, 24 giá, 1 mã SP. SHA-256 CSV mới `B0FAFEB03DD2FAC687D637CE7AF695E6B46698CDBBB5EC24A994B624500413C1`; báo cáo cục bộ `.codex_tmp/order-vat-verification-20261021.json` (không commit CSV hoặc dữ liệu cá nhân). Chưa xác nhận deploy Render.

- **Kiểm thử phiên tiếp nối 21/10/2026:** ORDER VAT (`vatRequests/*.test.js`), import CSV, giao diện VAT và `auth/featureRegistry.test.js`: **87/87 đạt**, exit 0. Toàn bộ: **3.150 test, 3.143 đạt, 3 bỏ qua, 4 lỗi có sẵn trên main**, exit 1: một test `test/frontend/sort-icons.test.js:135` không chuẩn hóa CRLF khi khớp CSS và ba test `test/overview-endpoints-access.test.js:73` còn kỳ vọng Marketing được xem Báo cáo hàng hóa sau thay đổi quyền `c106d78`. Không sửa mã/quyền ngoài phạm vi ORDER VAT. Chạy bằng Node 24.19.0, preload chặn dotenv, bỏ kết nối DB thật và dùng cấu hình giả; log `.codex_tmp/order-vat-focused-tests-20261021.log` và `.codex_tmp/order-vat-full-tests-20261021-verified.log`. Lượt full-test đầu bị dừng vì thiếu cấu hình giả, không dùng làm kết quả nghiệm thu. `graphify` không có trên PATH trong phiên này; chỉ cập nhật tài liệu, không đổi mã/schema.

Các mốc ngày 20/10 dưới đây giữ làm lịch sử:

- Code đã merge từ nhánh `feature/vat-requests` vào `main` qua PR #4 (`ac96b88`) ngày 20/10/2026; chưa xác nhận deploy Render.
- **Migration `0076_vat_requests.sql` đã áp lên DB thật** ngày 20/10/2026 theo yêu cầu nhập CSV của chủ dự án. Đã nhập 1.357 yêu cầu cũ và 1.357 dòng lịch sử; mỗi `legacy_row` duy nhất.
- Test 20/10/2026 sau gộp `origin/main`: `npm test` 2.980 test, 2.976 đạt, 3 bỏ qua, chỉ 1 test có sẵn trên main `test/frontend/sort-icons.test.js` lỗi CRLF trên Windows — đã sửa ở nhánh riêng `claude/cranky-pike-6ec25e` (commit `0e6bd34`, chưa merge). Kiểm tra PGlite/JSDOM riêng đều đạt; bản giả lập PGlite đã xem Kế toán được cấp/chưa cấp quyền, trước đó đã xem form tạo/sửa, mobile/desktop, sáng/tối.
- `graphify update .` chưa chạy được (máy không cài graphify).
- Cập nhật 20/10/2026: mặc định Tồn VAT đã chuyển sang tab GỘP MỚI `gid=39032` của cùng sheet công khai; mã gợi ý khách/giá đã bổ sung trong `suggestions.js`. Quyền xử lý VAT không còn cấp mặc định cho Kế toán; Quản lý vẫn có mặc định và có thể cấp riêng cho từng người. Migration `0076` đã áp; chưa xác nhận deploy Render.

## 3. Bản đồ file

| File | Vai trò |
|---|---|
| `server/db/migrations/0076_vat_requests.sql` | Bảng `vat_requests` + `vat_request_history` (append-only, trigger chặn sửa/xóa). Dòng `is_legacy` được phép thiếu dữ liệu. |
| `server/vatRequests/service.js` | **Mọi luật nghiệp vụ**: whitelist `SALE_FIELDS`/`ACCOUNTANT_FIELDS` (trường lạ → 403 `FIELD_FORBIDDEN`), khóa (`NOT_OWNER`/`LOCKED`), auto-pending, version (409 `VERSION_CONFLICT` kèm `latest`), lịch sử, bulk (1 dòng lệch → hủy cả lô), metrics O/P/Q/R. |
| `server/vatRequests/repository.js` | Chỉ SQL. `withTransaction` dùng `pool.connect()`. |
| `server/vatRequests/routes.js` | `/api/vat-requests` (GET list, POST, PATCH /:id, PATCH /bulk, DELETE /:id?version=, GET /:id/history, /metrics, /product-suggest, /customer-suggest, /price-suggest). |
| `server/vatRequests/stockSource.js` | Đọc CSV công khai Google Sheets cho cột O, cache 10 phút / stale 6 giờ. Cấu hình qua env `VAT_REQUEST_STOCK_*`. |
| `server/vatRequests/suggestions.js` | Xếp hạng khách KiotViet + lịch sử VAT; đọc giá của yêu cầu gần nhất cùng mã SP. |
| `server/vatRequests/etaParser.js` | Đọc ETA chữ → ngày. |
| `server/auth/featureRegistry.js` | 2 key mới + `PAGE_FEATURES` `/vat-request`. |
| `server/public/vat-request/{index.html,vat-request.js,vat-request.css}` | Trang (vanilla JS, `table-controls.js`, token màu `shared.css`). |
| `server/public/vat-request/vat-request-batch.js` | Form nhiều mã SP, dán từ Excel, gợi ý dữ liệu và lưu bản nháp cục bộ. |
| `server/public/shared/shared-nav.js` | Mục menu Kế toán → "Yêu cầu xuất VAT". |
| `server/scripts/importOrderVat.js` | Import sheet cũ: mặc định chạy thử, `--apply` mới ghi; idempotent theo `legacy_row`. |
| Test | `server/vatRequests/*.test.js` (PGlite), `server/scripts/importOrderVat.test.js`, `server/test/frontend/vat-request.test.js` (JSDOM), `server/auth/featureRegistry.test.js`. |
| Tài liệu đã cập nhật | README.md, server/README.md (mục "Kế toán – Yêu cầu xuất VAT"), server/db/SCHEMA.md (0076), SRS (FR-VR-1…10), BRD, implementation_plan.md, CURRENT.md. |

## 4. Giao diện hiện tại (để không làm hỏng khi sửa tiếp)

- Bảng: nháy đúp / Enter vào dòng → hộp sửa (không sửa được thì chỉ lịch sử); chuột phải → menu "Sửa yêu cầu / Xem lịch sử". Cột Thao tác 1 nút. Hai nút tròn ‹ › cuộn về cột đầu / cuối.
- Ngắt chữ: `table-controls.css` dùng chung ép `overflow-wrap:anywhere !important` → bảng này ghi đè (`table.tks-controlled-table.vr-table`) để xuống dòng theo cả từ; cột số / mã / ngày có class `vr-nowrap`.
- Độ rộng cột mặc định nằm trong `columns()` ở `vat-request.js` (theo tỉ lệ ảnh chủ dự án gửi, tổng ~1.840px).
- Hộp sửa (redesign gần nhất): `<dialog class="vr-editor">` trong suốt chứa `.vr-modal` (640px, max 85vh, header/footer cố định, `#vrFormBody` cuộn) + `#vrChat` (khung chat lịch sử nổi, `position:absolute; left:calc(100% + 16px)`). Khung chat PHẢI nằm trong `<dialog>` (top layer; ngoài dialog sẽ bị backdrop chặn). Breakpoint: ≥1360 cạnh modal; 1028–1359 dịch dialog `translateX(-168px)` khi mở; <1028 drawer phải; ≤640 bottom sheet.
- 3 chế độ `data-mode`: `create` / `edit` / `history`. Hàm chính: `openForm(row, mode)`, `setHistoryOpen()`, `setSaving()`, `loadHistory()`, `chatItemHtml()`, `deleteEditing()`.

## 5. Việc còn lại (theo thứ tự ưu tiên)

1. **Chủ dự án xem lại giao diện** và góp ý tiếp (đang ở bước này). Xem bằng bản giả lập (mục 6), không cần DB.
2. **Nguồn cột Tồn VAT**: tab GỘP MỚI `gid=39032` của sheet công khai `1dNabQaiob7CMozrqjA746uV-atHWJi8gbG6L-I0yrmU` đã kiểm tra CSV HTTP 200 và đặt làm mặc định. Nếu Render đang đặt `VAT_REQUEST_STOCK_GID` khác, đổi thành `39032`; giữ tab Khớp mã hiện hành (`gid=1192158065`).
3. Code mới đã gộp và push `main` ngày 21/10/2026 (`4be5e15`). Theo yêu cầu hiện hành của chủ dự án, tiếp tục trên `main` (xem MEMORY.md); không tự tạo nhánh/worktree khác.
4. Migration `0076` đã áp; còn deploy Render (chỉ 1 instance).
5. **Đã nhập và đối soát xong CSV mới 1.360 dòng ngày 21/10/2026** (mục 2). Không còn bước nhập dữ liệu. Script import thường bỏ qua `legacy_row` đã có; không dùng nó để thay bộ CSV có đổi thứ tự dòng. Không chạy lại script thay toàn bộ khi dữ liệu hiện hành đã khớp CSV, vì sẽ tạo thêm bộ xóa mềm/lịch sử không cần thiết.
6. `graphify update .` nếu máy có graphify.

## 6. Cách chạy / kiểm tra

- Test: `cd server && npm test` (Node v24: `node --test <thư mục>` không chạy, phải truyền file/glob, vd `node --test test/frontend/vat-request.test.js`).
- Xem giao diện KHÔNG cần DB: bản giả lập dùng service thật trên PGlite + đăng nhập giả. Script mẫu đã dùng nằm ngoài repo (scratchpad Claude) — tự tạo lại theo mẫu:
  - `process.chdir('server')`, `createRequire` từ `server/index.js`;
  - PGlite chạy migration `0018_product_report.sql`, `0053_product_containers.sql`, `0076_vat_requests.sql`; nạp dòng bằng `mapOrderVatRows` + `insertRows` từ CSV sheet cũ;
  - `createVatRequestService({ pool, stockSource: { get: async () => snapshot } })`, mount `createVatRequestRouter({ service, customerSearch })`;
  - middleware gán `req.user = {...user, permissions: resolvePermissions(user)}` + `req.effectiveUserResolved = true`; route `/api/auth/me` trả user + `pageFeatures`; `/__as?role=kt|sale` đặt cookie đổi vai;
  - `express.static('server/public')`.
- Server local thật: cấu hình `tks-dashboard-local-readonly` trong `.claude/launch.json` (tắt sync, pool 3) — đọc DB thật, hỏi chủ dự án trước.

## 7. Điều cấm / lưu ý

- Không đụng thuật toán Nháp VAT (`server/vatDraft/allocation.js`, `nameMatching.js`, `pyCompat.js`).
- Không dùng framework client (React/Vue/Tailwind); giữ vanilla + token `shared.css`, hỗ trợ Sáng/Tối, responsive.
- Mọi luật quyền kiểm tra ở `service.js`; giao diện chỉ ẩn nút.
- Số hiển thị kiểu en-US `1,234,567`; giờ Asia/Ho_Chi_Minh.
- Thay đổi cấu trúc/migration/API → cập nhật đồng bộ tài liệu theo `.agents/skills/update-file/SKILL.md`; cập nhật CURRENT.md đầu và cuối phiên.
- Commit message tiếng Việt không dấu kiểu `feat(vat-requests): ...` như lịch sử repo.

## 8. Prompt gợi ý cho Codex

```
Đọc docs/04-planning/HANDOFF_vat-requests.md, CLAUDE.md, MEMORY.md, CURRENT.md.
Làm việc trực tiếp trên main theo yêu cầu hiện hành của chủ dự án. Tính năng Kế toán – ORDER VAT
đã push code và nhập/đối soát CSV mới 1.360 dòng; không nhập lại dữ liệu. Nhiệm vụ tiếp: <mô tả việc cần sửa tiếp>.
Giữ nguyên business logic trong server/vatRequests/service.js trừ khi được yêu cầu. Sau khi sửa:
chạy toàn bộ test cách ly DB thật, kiểm tra giao diện thay đổi bằng bản giả lập PGlite (mục 6),
cập nhật tài liệu liên quan + CURRENT.md, rồi commit/push main nếu nằm trong phạm vi yêu cầu.
```
