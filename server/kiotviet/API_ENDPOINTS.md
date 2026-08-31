# KiotViet Public API — Endpoint Reference (Phase 1)

> Tài liệu nguồn bắt buộc theo `source-driven-development`: mọi entity sync module trong
> `server/kiotvietSync/entities/*.js` phải trỏ về đây thay vì đoán tham số từ trí nhớ.
> Không sửa file này dựa trên "tôi nghĩ API chắc hỗ trợ X" — chỉ sửa khi có bằng chứng mới
> (live probe hoặc tài liệu chính thức), và phải ghi lại nguồn.

## Auth

```
POST https://id.kiotviet.vn/connect/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id=<id>&client_secret=<secret>&scopes=PublicApi.Access
```

Nguồn: `src-dashboard/kiotviet/Auth.gs:23-29` (đang chạy production cho cả 2 chi nhánh) — cùng
implementation đã copy đúng vào `kiotVietApiClient.js:getAccessToken` (trích xuất từ
`server/dashboard/stockoutCheck/kiotVietClient.js`, đã di dời — không còn file cũ).

Response: `{ access_token, expires_in, token_type }`. `expires_in` thực tế ~3600s. Client cache
token, refresh khi còn ~60s trước hết hạn hoặc khi gặp `401`.

Mỗi chi nhánh (Hà Nội/Sài Gòn) là 1 tài khoản KiotViet riêng — lấy token riêng bằng
`KIOTVIET_CLIENT_ID`/`_SECRET` tương ứng, không dùng chung.

## Request chung cho mọi endpoint danh sách

```
GET https://public.kiotapi.com/{endpoint}?pageSize=100&currentItem=N&<query riêng entity>
Authorization: Bearer <access_token>
Retailer: <CHhanoi | CHsaigon>
```

Response: `{ total: number, data: [...] }`. Lặp `currentItem += pageSize` cho đến khi
`currentItem >= total` hoặc trang trả về rỗng (guard chống vòng lặp vô hạn nếu `total` sai).
Nguồn: `fetchAllPages()` trong `kiotVietApiClient.js`, hành vi giữ nguyên từ file gốc đã di dời
(`stockoutCheck/kiotVietClient.js`, xem lịch sử git nếu cần đối chiếu).

## Bảng endpoint từng entity

Cột "Tham số incremental" là tham số dùng để lọc theo `sinceIso` (checkpoint) — **đã xác minh
bằng live GET probe (chỉ đọc) ngày 2026-08-30 trên tài khoản Hà Nội thật**, phương pháp: so
sánh `total` khi gọi không filter vs. filter = một ngày trong tương lai (`2027-01-01T00:00:00`).
Nếu tham số được API tôn trọng, `total` phải về 0.

| Entity | Endpoint | `listQuery` cố định | Tham số incremental | Nguồn xác minh |
|---|---|---|---|---|
| categories | `/categories` | `hierachicalData=false` (đúng chính tả lỗi của KiotViet — không sửa) | `lastModifiedFrom` | Live probe: total 98→0. `modifiedFrom` bị thử và **không hoạt động** (total không đổi) — không dùng tên này. |
| products | `/products` | `includeInventory=true&includeQuantity=true&IncludeProductShelves=true&includePricebook=true&IncludeSerials=true&IncludeBatchExpires=true&includeWarranties=true&includeMaterial=true&includeSoftDeletedAttribute=false` | `lastModifiedFrom` | Live probe: total 10378→0. Nguồn `listQuery`: `src-dashboard/kiotviet/SheetSchemas.gs:589-599`. |
| customers | `/customers` | `includeTotal=true&includeCustomerGroup=true&includeCustomerSocial=true` | `lastModifiedFrom` | Live probe: total 5246→0. |
| suppliers | `/suppliers` | `includeTotal=true&includeSupplierGroup=true` | `lastModifiedFrom` | Live probe: total 122→0. |
| invoices | `/invoices` | `includePayment=true&includeInvoiceDelivery=true&IncludeSaleChannel=true` | `lastModifiedFrom` | Live probe: total 23988→0. (`fromPurchaseDate`/`toPurchaseDate` cũng hoạt động — đã dùng production ở `CustomerDebtReport.gs:53-54` và `syncCustomerReport.js` — nhưng lọc theo *ngày bán*, không bắt được hóa đơn cũ bị **sửa**. Dùng `lastModifiedFrom` cho checkpoint incremental vì đúng ngữ nghĩa "đã thay đổi từ mốc nào".) Line items nằm trong `InvoiceDetails[]`/`invoiceDetails[]` của cùng response. |
| orders | `/orders` | `includePayment=true&includeOrderDelivery=true` | `lastModifiedFrom` | **Live probe: `fromOrderDate` bị API bỏ qua hoàn toàn (total không đổi khi set = ngày tương lai) — khác giả định ban đầu trong PlanDB-Phase1-Spec.md §9.1.** `lastModifiedFrom` được xác nhận hoạt động (total 34972→0). Dùng `lastModifiedFrom`, không dùng `fromOrderDate`/`toOrderDate`. |
| returns | `/returns` | `includePayment=true` | `lastModifiedFrom` | Live probe: total 1348→0. Khớp cách `server/dashboard/stockoutCheck/stockoutCheckService.js` đã gọi `client.fetchAllPages('returns', { lastModifiedFrom: fromDate }, ...)` trong production. |
| purchases | `/purchaseorders` (**không phải** `/purchases`) | `includePayment=true&includeOrderDelivery=true` | `lastModifiedFrom` | Live probe: total 3276→0. `fromPurchaseDate`/`toPurchaseDate` cũng xác nhận hoạt động (đã dùng production ở `stockoutCheckService.js`), nhưng dùng `lastModifiedFrom` để nhất quán và bắt được phiếu nhập cũ bị sửa. |
| cash_flows | `/cashflow` | `includeAccount=true&includeBranch=true&includeUser=true` | `startDate` + `endDate` (**`lastModifiedFrom` bị API bỏ qua** — live probe xác nhận total không đổi) | Gọi **2 lần**: `isReceipt=true` và `isReceipt=false`, gộp kết quả. Nguồn: `CustomerDebtReport.gs:65-79` (production, cùng scope `PublicApi.Access` — không cần scope riêng, đã xác minh live). |
| staff | *(không gọi endpoint riêng)* | — | — | Suy ra từ `SoldById`/`CreatedById`/`UserId`... trong response của invoices/orders/returns/purchases/cash_flows qua `staffSync.upsertStaffFromEntity()`. Quyết định giữ nguyên như spec dù `GET /users` đã xác nhận tồn tại (xem ghi chú bên dưới). |

## Ghi chú quan trọng: `GET /users`

Live probe xác nhận `GET /users` **tồn tại và trả dữ liệu thật** (status 200, `total=113` nhân
viên, tài khoản Hà Nội). `GET /employees` trả 404 (không tồn tại).

Đây là thông tin mới so với `PlanDB-Phase1-Spec.md §17.3` ("chưa xác minh KiotViet Public API
có endpoint Users/Employees không"). **Quyết định của chủ dự án (2026-08-30): giữ nguyên thiết
kế Phase 1 hiện tại** — không dùng `/users`, `staffSync.js` chỉ là helper suy luận, không có
checkpoint riêng. Việc này chỉ ghi lại ở đây để Phase 3 hoặc một cải tiến sau này có thể cân
nhắc dùng `/users` làm nguồn staff đầy đủ hơn (vai trò, SĐT, trạng thái hoạt động) — **không**
thay đổi phạm vi Phase 1.

## Ghi chú cho `backfill.js`: không có tham số chặn trên (upper bound) cho orders/returns

Live probe 2026-08-30 xác nhận thêm: `lastModifiedTo` và `toModifiedDate` **đều bị API `/orders` và
`/returns` bỏ qua hoàn toàn** (thử kèm `lastModifiedFrom` đã có tác dụng, `total` không đổi khi thêm
tham số chặn trên). Nghĩa là 2 entity này **không có cách nào giới hạn cả 2 đầu ngày qua API** — khác
với `invoices`/`purchaseorders` (có `fromPurchaseDate`/`toPurchaseDate` chặn được cả 2 đầu, đã xác
minh production + live probe) và `cash_flows` (có `startDate`/`endDate`).

Hệ quả cho `backfill.js`: **không chia được theo tháng một cách an toàn** cho `orders`/`returns` —
chia "theo tháng" bằng `lastModifiedFrom=<đầu tháng>` sẽ luôn kéo từ đầu tháng đó **đến hiện tại**
(không bị chặn ở cuối tháng), khiến mỗi "tháng" thực chất tải lại gần như toàn bộ tập dữ liệu — vừa
không giảm được rủi ro trôi trang do phân trang offset-based (PlanDB.md §9) vừa lãng phí gấp nhiều
lần. `backfill.js` xử lý 2 entity này bằng **1 lượt chạy đầy đủ duy nhất** (`lastModifiedFrom = --from`),
chấp nhận rủi ro trôi trang trên tập lớn như một rủi ro tồn dư đã biết trước (spec đã ghi nhận), thay
vì giả vờ chia theo tháng trong khi API không thực sự hỗ trợ.

## UNVERIFIED — chưa xác minh, không hardcode giả định

- **Rate limit thực tế / ngưỡng 429**: chưa đo. `fetchJsonWithRetry` đã có backoff exponential
  cho 429/5xx (giữ nguyên từ `kiotVietClient.js`), nhưng số lần 429 gặp phải khi chạy
  `sync:once`/`backfill` với 2-3 request đồng thời/branch chưa được đo thực tế. Đo qua log khi
  chạy `sync:once` lần đầu, giảm `runWithConcurrencyLimit` xuống 1-2 nếu 429 xuất hiện nhiều.
- **Tính khả dụng dữ liệu lịch sử cho backfill từ 2026-01-01**: chưa test 1 hóa đơn tháng
  3/2026 xem field có bị cắt bớt so với hóa đơn gần đây không. Test trước khi chạy
  `backfill.js` đầy đủ, không phải trước khi code các entity sync module.
- **Mã trạng thái (`status`) hóa đơn/đơn hàng**: đã biết có mâu thuẫn giữa 2 nơi trong code cũ
  (xem `PlanDB.md §9`) — **không** suy diễn nhãn "hoàn thành"/"đã hủy" ở Phase 1, giữ nguyên
  `status SMALLINT` thô như spec đã chốt.

## Đã xác minh nhưng KHÔNG dùng trong Phase 1

- `partnerType=C` trên `/cashflow` (lọc theo khách hàng, dùng trong `CustomerDebtReport.gs`) —
  Phase 1 lấy **toàn bộ** `cash_flows` (cả khách hàng lẫn nhà cung cấp) vì bảng `cash_flows` có
  cả `customer_id` lẫn `supplier_id`, không lọc `partnerType` ở tầng sync.
