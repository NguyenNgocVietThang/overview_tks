# Kiểm tra sai giá hóa đơn — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Chỉ dùng subagent-driven-development nếu người dùng yêu cầu giao việc cho subagent.

**Goal:** Thêm một bảng duy nhất trong tab Hóa đơn để đối chiếu giá bán, giải thích và chốt Ok/Phạt trong cửa sổ 7 ngày.

**Architecture:** Job 23:00 chụp kết quả đối chiếu vào PostgreSQL; API và xuất file đọc bản đã chụp, không tính lại theo giá hiện tại. Khóa theo hóa đơn giúp giữ nguyên cả dòng đúng và sai của 6 ngày cũ; giải thích và quyết định là phần được sửa riêng, có kiểm soát quyền và phiên bản.

**Tech Stack:** Node.js 22, Express/CommonJS, PostgreSQL NUMERIC, node:test/PGlite, Vanilla JS/CSS, bộ điều khiển bảng và Excel/HTML đang có.

**Trạng thái 20/10/2026:** Đã phỏng vấn và được người dùng xác nhận nghiệp vụ. Đã lập trình và kiểm thử trên nhánh `feature/invoice-price-audit` (Task 1–6 xong, giao diện đã kiểm trên trình duyệt với dữ liệu thử; Task 7: tài liệu và kiểm thử xong, các bước production còn lại). **Chưa merge, chưa áp migration `0077` lên DB dùng chung, chưa deploy, job chưa chạy; production chưa triển khai.**

## 1. Global Constraints và nghiệp vụ đã xác nhận

- Chỉ một bảng kiểm tra giá cho HN/SG, đúng/sai giá, VAT và bao cước; không tạo các bảng riêng như Excel cũ. Bảng giao dịch hiện có của tab Hóa đơn vẫn giữ chức năng hiện tại.
- Mỗi dòng hóa đơn là một dòng kết quả. Cộng số lượng các dòng cùng mã trong cùng hóa đơn để xét bậc; không cộng giữa hóa đơn hoặc giữa cơ sở. VAT, giá thực bán, chênh và giải thích vẫn theo từng dòng.
- Dùng giá mới nhất trên KiotViet khi ghi nhận lần đầu; ngày cập nhật trong mô tả chỉ để đối chiếu, không tìm lịch sử giá trước ngày bán.
- Job chạy 23:00 Asia/Ho_Chi_Minh. Cửa sổ gồm ngày chạy D và D−6 đến D−1. Những hóa đơn chưa quét nhưng đến muộn được bổ sung trong lần sau nếu ngày bán còn trong cửa sổ.
- Bản đã ghi nhận không đổi khi sửa hóa đơn, hạ giá hàng hóa, đổi VAT/cước/cấp khách. Không tính lại dòng cũ, dù dòng đó chưa được giải thích hoặc chốt.
- Cấp khách lấy từ email KiotViet: Vừa, Lớn, VIP; email rỗng/khác mặc định Vừa. Sale lấy từ nhóm khách KiotViet, không lấy nhân viên lập hóa đơn.
- Giá thực bán mỗi đơn vị = `invoice_details.price − invoice_details.discount`; không phân bổ giảm giá chung hóa đơn.
- Quy tắc hàng hóa lấy từ `products.raw.description` theo từng cơ sở, không lấy `products.base_price` làm giá thay thế.
- Tên hàng chứa `(OD)` hoặc `(PK)`, không phân biệt hoa/thường, được coi không sai giá. Không có giá quy định dùng được cũng coi không sai giá.
- Thiếu VAT hoặc cước của mã hàng = 0đ. Bậc trống như `-T --` là không có bậc, tuyệt đối không đổi thành giá 0đ rồi đưa vào `min`.
- Chưa làm bảng nhập/duyệt giá cắt lô riêng theo khách–mã. Bậc thứ tư trong mô tả vẫn là bậc số lượng cho mọi khách, không phải quyền cắt lô riêng.
- Không tự gửi thông báo, không tự thu tiền hoặc khấu trừ lương. Phạt ở đây là số tiền được ghi nhận trong bảng.

### 1.1. Đọc các bậc giá

Ví dụ `T100 # 16/10 # 1T -24000 | 3T- 23800 | 5T- 23600 | 10T-23000 | VAT+2000đ`:

| Tổng số lượng cùng mã | Giá theo số lượng |
|---|---:|
| Lớn hơn 0 và dưới 300 | 24.000đ |
| Từ 300 đến dưới 500 | 23.800đ |
| Từ 500 đến dưới 1.000 | 23.600đ |
| Từ 1.000 trở lên | 23.000đ |

- Quy đổi ngưỡng `số thùng × số chiếc/thùng`; đủ ngưỡng là được giá mới. Khoảng 300–499 được dùng để sửa phần ví dụ ban đầu bị chồng khoảng 300–599 và 500–999.
- Dưới ngưỡng bậc đầu vẫn dùng giá bậc đầu; không yêu cầu khách mua đủ 1 thùng mới có giá quy định.
- Bậc thứ nhất/thứ hai/thứ ba tương ứng cấp Vừa/Lớn/VIP. Giữ vị trí bậc khi có ô trống, không dồn bậc rồi gán nhầm cấp.
- `giá cơ bản miền = min(giá theo tổng số lượng; giá theo cấp khách)` trong các giá hợp lệ đang có.
- Nếu thiếu số chiếc/thùng thì không suy đoán ngưỡng số lượng, nhưng vẫn dùng giá cấp khách nếu có. Nếu không còn ứng viên hợp lệ thì coi không sai giá, lưu lý do thiếu giá.
- Chuẩn hóa Unicode, hoa/thường và khoảng trắng; đọc các dấu phân cách trong ví dụ, số tiền nguyên hoặc có phân cách hàng nghìn, hậu tố đ/đồng. Không đọc một phần chuỗi số không hợp lệ thành giá khác.
- `fullvat` và `full vat` được nhận diện trong ghi chú dòng hoặc ghi chú chung sau chuẩn hóa, có ranh giới từ. Ghi chú chung áp dụng mọi dòng, ghi chú dòng chỉ áp dụng dòng đó; không có quy tắc phủ định VAT trong phiên bản này.
- Với miền R: `min_R = giá cơ bản R + (fullVat ? VAT_R : 0)`; VAT lấy từ mô tả KiotViet của chính miền R, thiếu là 0.
- Email: chuẩn hóa phần trước `@`, bỏ dấu/hoa thường/khoảng trắng; chỉ `vua`, `lon`, `vip` được nhận diện, mọi giá trị khác là Vừa. Không dùng trường comments đang phục vụ Level giá ở báo cáo Khách hàng.

### 1.2. Bao cước

- Chỉ hóa đơn HN, đúng danh sách khách bao cước bên dưới: `min áp dụng = min(min_HN + cước; min_SG)`.
- Tra sản phẩm miền kia bằng mã đã trim, chuẩn hóa hoa/thường, không dùng product_id để ghép xuyên Kiot.
- Cùng tổng số lượng và cùng cấp khách lấy từ hóa đơn nguồn; quy cách thùng, bậc giá và VAT lấy riêng từng Kiot HN/SG.
- HN có giá, SG không có: dùng `min_HN + cước`. HN không có giá quy định: áp dụng quy tắc không sai giá, không dùng riêng SG để kết luận phạt.
- Cước/chiếc đọc trực tiếp cột O “Cước 1 Sp (465/m³, 1367đ/kg)” trong sheet CÂN ĐO của workbook Sale + Kế toán; không tự tính lại từ cân nặng/thể tích. Giá trị thiếu/trống = 0. Cước được cộng một lần, không nhân VAT lên cước.
- Hóa đơn SG luôn dùng `min_SG`, kể cả khách nằm trong danh sách bao cước.
- So khớp toàn bộ tên khách sau chuẩn hóa Unicode/hoa thường/khoảng trắng; không tìm chuỗi con hoặc đoán gần đúng. Giữ dấu và nội dung tên; khác tên không tự áp ưu đãi.

Danh sách khởi tạo:

1. KMN Jinlong + ĐI MÃ NÀO DÁN TÊN ĐẦU THÙNG LÊN
2. KMN KAI (ML)+ ĐI MÃ NÀO DÁN TÊN ĐẦU THÙNG LÊN
3. KH Vin Dany + ĐI MÃ NÀO DÁN TÊN ĐẦU THÙNG LÊN
4. KMN Tín Phong Shop
5. KH HENG - ĐI MÃ NÀO DÁN TÊN ĐẦU THÙNG LÊN
6. KMN C Thư Sóc Trăng
7. KMN A Thìn Bình Tân
8. KMN C Thu Thủy Bình Phước
9. KMN C Vân Anh Bình Phước
10. KH Srey Hi - ĐI MÃ NÀO DÁN TÊN ĐẦU THÙNG LÊN

### 1.3. Chênh lệch, kết quả và quyết định

```text
chênh/đơn vị gốc = max(0, min áp dụng − giá sau giảm giá)
tiền chênh gốc   = chênh/đơn vị gốc × số lượng dòng
sai giá gốc      = có giá đối chiếu, không thuộc diện bỏ qua, tiền chênh gốc > 0
kết quả hiện tại = Đúng giá nếu Chốt = Ok; trường hợp khác giữ kết quả gốc
tiền chênh/phạt  = 0 nếu Chốt = Ok; trường hợp khác giữ tiền chênh gốc
tiền phạt chốt   = tiền chênh gốc nếu Chốt = Phạt; trường hợp khác = 0
```

- Giá bằng hoặc cao hơn min là đúng giá. Dòng được bỏ qua không tạo tiền chênh/phạt, kể cả giá thực bán thấp.
- Ví dụ 100 sản phẩm thấp hơn min 1.000đ: chưa chốt hiển thị 100.000đ chênh; Phạt = 100.000đ phạt; Ok = 0đ và Đúng giá.
- Chốt mặc định trống, hiển thị “Chưa chốt”; hai lựa chọn nghiệp vụ là Ok/Phạt. Cho xóa quyết định để về Chưa chốt hoặc đổi quyết định nếu còn quyền; ghi lịch sử mỗi lần.
- Chỉ dòng sai giá gốc được chốt Ok/Phạt. Dòng đúng giá gốc vẫn có ô giải thích theo quyền nhưng Chốt bị khóa.
- Không cộng tiền dự kiến vào tổng tiền đã phạt. Chỉ số riêng: tổng tiền chênh/phạt đang hiển thị, tiền chênh chưa chốt, tiền đã chốt Phạt.

## 2. Chốt một bảng và cấu trúc cột

Tên mục: **Kiểm tra giá bán** trong tab Hóa đơn, sau mục Giao dịch hiện có. Bảng mặc định hiện tất cả kết quả; sắp xếp sai giá trước, ngày bán mới nhất trước, rồi cơ sở/mã hóa đơn/thứ tự dòng. Không gộp hai dòng thành một dòng kết quả khi cộng số lượng xét bậc.

### 2.1. 18 cột nghiệp vụ theo đúng thứ tự

| STT | Cột | Khóa API | Hiển thị mặc định | Nội dung / quyền sửa |
|---:|---|---|:---:|---|
| 1 | Ngày giờ bán | soldAt | Có | Ngày giờ hóa đơn đã ghi nhận |
| 2 | Cơ sở | branch | Có | HN / SG |
| 3 | Mã hóa đơn | invoiceCode | Có | Link mở chi tiết hóa đơn hiện có |
| 4 | Sale phụ trách | saleName | Có | Nhóm khách KiotViet khi ghi nhận |
| 5 | Khách hàng | customerName | Có | Tên khách khi ghi nhận |
| 6 | Mã hàng | productCode | Có | Mã trên dòng hóa đơn |
| 7 | Tên hàng | productName | Có | Tên khi ghi nhận; hiển thị được OD/PK |
| 8 | Cấp khách | customerLevel | Có | Vừa / Lớn / VIP |
| 9 | SL dòng | quantity | Có | Số lượng riêng của dòng |
| 10 | Tổng SL cùng mã | totalCodeQuantity | Không | Số lượng dùng xét bậc giá trong hóa đơn |
| 11 | Full VAT | fullVat | Có | Có / Không, theo ghi chú dòng hoặc cả hóa đơn |
| 12 | Đơn giá sau giảm | netUnitPrice | Có | Đơn giá − giảm giá từng đơn vị |
| 13 | Giá min áp dụng | minimumUnitPrice | Có | Sau xét miền, VAT và cước; thiếu giá hiện “—” |
| 14 | Chênh/đơn vị | unitShortfall | Không | Chênh gốc, không xóa khi duyệt Ok |
| 15 | Tiền chênh / phạt | effectiveAmount | Có | Giá trị gốc khi Chưa chốt/Phạt, 0 khi Ok |
| 16 | Kết quả | effectiveStatus | Có | Đúng giá / Sai giá; Ok đổi thành Đúng giá |
| 17 | Sale giải thích | saleExplanation | Có | Sửa theo quyền và đúng nhóm khách phụ trách |
| 18 | Chốt | decision | Có | Chưa chốt / Ok / Phạt; chỉ người có quyền chốt |

Như vậy mặc định có 16 cột. Ghim Mã hóa đơn và Khách hàng khi cuộn ngang nếu bộ điều khiển bảng hỗ trợ; không chèn thêm bảng tóm tắt thứ hai. Số tiền căn phải, ghi chú cho xuống dòng; tiêu đề dính, Light/Dark, ô sửa có nút Lưu/Hủy và trạng thái đang lưu/lỗi. Lọc không làm mất nội dung giải thích chưa lưu: hỏi giữ/sửa trước khi rời dòng.

### 2.2. Cột đối chiếu bật thêm trong cùng bảng

Đặt sau 18 cột nghiệp vụ; cùng bộ chọn ẩn/hiện và danh mục xuất file. Nhóm này không được tạo thành các bảng HN/SG/FV/bao cước khác nhau.

| Nhóm | Cột bổ sung và khóa |
|---|---|
| Nhận diện | Mã khách (`customerCode`), Email cấp giá lúc quét (`customerEmail`), Dòng hóa đơn (`sourceLineNo`) |
| Giá bán | Đơn giá trước giảm (`originalUnitPrice`), Giảm/đơn vị (`unitDiscount`) |
| HN | Chiếc/thùng HN (`cartonSizeHn`), Giá SL HN (`quantityPriceHn`), Giá cấp HN (`levelPriceHn`), VAT HN đã cộng (`vatHn`), Min HN gồm VAT (`minimumHn`) |
| Cước và SG | Khách bao cước (`freightEligible`), Cước/đơn vị đã cộng (`freightPerUnit`), Chiếc/thùng SG (`cartonSizeSg`), Giá SL SG (`quantityPriceSg`), Giá cấp SG (`levelPriceSg`), VAT SG đã cộng (`vatSg`), Min SG gồm VAT (`minimumSg`) |
| Căn cứ | Nguồn giá thắng (`winningSource`: HN / HN + cước / SG / Không xét), Lý do (`reason`), Ghi chú hàng HN (`productNoteHn`), Ghi chú hàng SG (`productNoteSg`), Ghi chú dòng (`lineNote`), Ghi chú hóa đơn (`invoiceNote`) |
| Duyệt | Kết quả gốc (`originalStatus`), Tiền chênh gốc (`originalAmount`), Người chốt (`decidedBy`), Thời gian chốt (`decidedAt`), Ghi nhận lúc (`capturedAt`) |

- Lý do gồm: Theo giá quy định; Được duyệt Ok; Không xét OD; Không xét PK; Không có giá quy định. Thiếu VAT/cước 0đ thể hiện trong căn cứ, không tạo trạng thái lỗi nghiệp vụ thứ ba.
- Với SG không tra HN không cần thiết: các trường đối chiếu HN hiển thị “—”, cước đã cộng = 0.
- Thiếu giá khác với giá 0 đã được ghi rõ: `null` hiển thị “—”, số 0 hiển thị 0đ.
- Mở hóa đơn dùng popup hiện có; popup là dữ liệu Kiot đã đồng bộ hiện tại, có nhãn phân biệt với các cột căn cứ đã chụp trong bảng.

### 2.3. Bộ lọc, tổng và xuất file

- Bộ lọc cơ sở dùng bộ chọn HN/SG/Cả hai sẵn có; bổ sung ngày trong cửa sổ đã công bố, Sale, Kết quả, Chốt, Full VAT, Bao cước, tìm mã hóa đơn/khách/mã hàng/tên hàng.
- Kết quả: Tất cả / Đúng giá / Sai giá. Chốt: Tất cả / Chưa chốt / Ok / Phạt. Cặp bộ lọc phải hỗ trợ “Đúng giá + Ok” để xem dòng được miễn.
- Chỉ số theo toàn bộ tập đã lọc, không chỉ trang đang xem: số hóa đơn phân biệt, số dòng đúng/sai, tiền chênh chưa chốt, tiền đã chốt Phạt. Đơn có nhiều dòng không đếm trùng số hóa đơn.
- Xuất XLSX/HTML theo cùng bộ lọc, cùng thứ tự và các cột được chọn; backend dùng chung catalog cột với bảng. Dữ liệu text xuất Excel phải được xử lý theo cơ chế chống formula injection đang có.
- Trạng thái trên đầu bảng: ngày đầu–cuối của bản dữ liệu, thời điểm chạy thành công, số hóa đơn bổ sung, cảnh báo nguồn/lần chạy lỗi. Dữ liệu cũ vẫn xem được nếu job mới lỗi, nhưng không hiển thị như vừa cập nhật.

## 3. Thiết kế dữ liệu, quyền và API

### 3.1. Nguồn và các điểm tích hợp đã kiểm tra

- Hóa đơn: `invoices` + `invoice_details`; ghi chú chung `i.raw.description`, ghi chú dòng `d.raw.note`. Tiền/số lượng trong schema hiện tại là NUMERIC sau migration 0012.
- Hàng hóa: `products` theo `(branch, product_id)` và mã khi cần ghép miền kia; mô tả gốc `raw.description` đã được dùng ở báo cáo hàng hóa.
- Khách: `customers.raw.email` (hỗ trợ key `Email` nếu payload có), `raw.groups`, tên khách. Không dùng `raw.comments` đang được báo cáo khác dùng làm Level giá.
- Cân đo: `server/shipment/measureSheet.js` đang chỉ đọc quy cách/khối lượng/thể tích. `server/sheetSnapshots/sync.js` đồng bộ sheet mỗi 5 phút vào `shipping_measures`, hiện chưa có cột tiền cước O.
- Quyền: `server/auth/featureRegistry.js`; mẫu bảng/xuất tách module ở `server/productContainers/expectedRoutes.js`. Đăng ký route trong `server/routes.js`, vòng đời scheduler trong `server/index.js`.
- **Lưu ý thời gian có sẵn trong dự án:** `purchase_date` hiện chứa giờ địa phương Kiot gắn nhãn UTC. Lấy ngày hóa đơn bằng `(purchase_date AT TIME ZONE 'UTC')::date` như dashboard hiện có, không cộng UTC+7 lần nữa. Giờ job/captured_at thực dùng `vnTime.js` và timestamptz đúng thời điểm.

### 3.2. Bảng lưu trữ

Migration kế tiếp dự kiến `0077_invoice_price_audit.sql` (0076 đã dành cho yêu cầu xuất VAT); lúc thực hiện chọn số tiếp theo nếu 0077 đã được công việc khác sử dụng.

1. `invoice_price_audit_invoices`: PK `(branch, invoice_id)`, `invoice_code`, `sold_day DATE`, `captured_at`, `run_day`, `source_hash`, `source_modified_at`. Đây là sổ đánh dấu hóa đơn đã quét, kể cả không có dòng cần phạt.
2. `invoice_price_audit_lines`: PK `(branch, invoice_id, source_line_no)`, FK tới sổ đánh dấu riêng; các trường nhận diện/nghiệp vụ của bảng, số lượng/giá/chênh gốc NUMERIC, `original_status`, `reason`, `calculation JSONB` chứa ứng viên từng miền và ghi chú nguồn; `sale_explanation`, `explanation_by/at`, `decision` nullable (`ok`/`penalty`), `decided_by/at`, `version INTEGER DEFAULT 1`. Không FK cascade sang dữ liệu hóa đơn Kiot để đồng bộ nguồn không xóa bản ghi nhận.
3. `invoice_price_audit_state`: singleton chứa `published_day`, `window_from/to`, `last_success_at`, `last_attempt_at`, `last_error`, `added_invoice_count`, `version`. Hoàn thành mỗi ngày dựa trên DB, không dựa trên bộ nhớ tiến trình.
4. `invoice_price_audit_changes`: ID, FK dòng, actor, timestamp, action, giá trị trước/sau, version trước/sau. Nhật ký sửa giải thích và Chốt; hết cửa sổ xóa cùng dòng, không tạo lịch sử tra cứu dài hạn.
5. `shipping_measures`: thêm `freight_per_unit NUMERIC NULL`; cột này giữ nguyên giá trị thiếu, áp 0 ở quy tắc đối chiếu. Sửa parser và snapshot writer để lưu cột O, không ảnh hưởng m3/kg dùng cho Vòng đời đơn.

Index theo ngày bán/cơ sở và theo decision/sale của bảng kết quả; ràng buộc `branch IN ('hanoi','saigon')`. Giữ quyền báo cáo readonly theo chính sách hiện có; không tự mở quyền sửa hoặc cấp quyền đọc ghi chú/giải thích qua role báo cáo bên ngoài API.

### 3.3. Công bố bản dữ liệu hằng ngày

```text
runDailyAudit({ day, pool, now })
  khóa advisory riêng cho tính năng, kiểm tra day đã thành công chưa
  bắt đầu giao dịch REPEATABLE READ
  đọc hóa đơn chưa có trong invoice_price_audit_invoices,
    ngày bán trong [day−6, day], trạng thái Hoàn thành theo SQL dùng chung
  tải đủ các dòng mỗi hóa đơn; khách, giá HN/SG và Cân đo cùng bản đọc
  chuẩn hóa ghi chú, cộng SL theo mã, tính NUMERIC và chụp mọi dòng
  thêm sổ đánh dấu + các dòng trong cùng giao dịch; không upsert giá dòng cũ
  xóa dữ liệu chụp/giải thích/quyết định/audit ngoài [day−6, day]
  công bố state và commit
```

- Chống trùng ở cấp hóa đơn: hóa đơn cũ đổi thứ tự dòng, sửa giá/SL, thêm/xóa dòng hoặc bị hủy sau khi chụp không tạo kết quả mới. Một hóa đơn đến muộn hoàn toàn chưa quét mới được bổ sung. Đây là cách cụ thể hóa giữ trạng thái 6 ngày cũ.
- Công bố tất cả hoặc không công bố: thất bại giữa chừng rollback, giữ nguyên bản trước. Ghi lỗi an toàn vào state sau rollback; không đánh dấu ngày thành công.
- Scheduler kiểm tra slot đến hạn mỗi phút, chạy lúc 23:00. Nhiều instance chỉ có một job nhờ advisory lock. Khởi động lại thì bắt kịp slot 23:00 gần nhất chưa thành công; không dựng các ngày lịch sử đã trôi khỏi cửa sổ.
- Job lỗi tự thử lại sau 5 phút, vẫn cùng slot; thành công thì không chạy lại ngày đó. Không có nút tính lại làm thay đổi bản đã ghi nhận.
- Bản dữ liệu hiển thị theo `window_from/to` của lần công bố thành công gần nhất, không tự đổi cửa sổ lúc 00:00 trước job 23:00 tiếp theo.
- Hóa đơn 23:01 ngày D chưa quét sẽ xuất hiện vào lượt D+1, vẫn mang ngày bán D và dùng giá tại lần đầu được ghi nhận. Hóa đơn tới sau khi ngày bán đã ra khỏi 7 ngày không được đưa vào bảng.
- Lỗi đọc DB hoặc chưa có bản đồng bộ sản phẩm/khách cần thiết: giữ bản cũ và báo job lỗi; không coi nguồn lỗi là “không có giá”. Cân đo chưa từng đồng bộ thì chưa cho công bố lượt đầu; ô cước trống trong một bản đọc thành công vẫn là 0 theo nghiệp vụ.
- Nếu nguồn có bản đồng bộ thành công cũ, dùng bản đó kèm thời điểm/cảnh báo; không kích hoạt gọi trực tiếp Kiot/Sheets từ API bảng.

### 3.4. Quyền

- `reports.invoices.priceAudit`: xem bảng, mặc định Quản lý/Trợ lý/Nhân viên sale; requires `reports.invoices`.
- `reports.invoices.priceAudit.explain`: sửa Sale giải thích, mặc định Nhân viên sale; requires quyền xem. Phải kiểm tra quyền và nhóm khách trên server cho mọi lần ghi.
- `reports.invoices.priceAudit.decide`: sửa Chốt, mặc định chỉ Quản lý; requires quyền xem. Người khác chỉ chốt khi được cấp quyền này qua trang phân quyền hiện có. Không tự cấp cho Trợ lý.
- Xuất file cần quyền xem và `reports.export` hiện có, không mặc nhiên mở xuất file cho Sale.
- Mặc định ánh xạ nhóm Sale với `req.user.hoTen` theo NFKC/trim/gộp khoảng trắng/không phân biệt hoa thường; không fuzzy match, không dùng tên người bán trên hóa đơn. Nhóm trống/không khớp thì không sửa được; người quản trị chỉnh tên tài khoản/nhóm ở nguồn quản trị hiện có, không thêm màn hình ánh xạ mới trong đợt này.
- Cột Sale trên bản chụp giữ nguyên khi nhóm thay đổi; quyền sửa kiểm tra nhóm khách **hiện tại** trong DB, để chỉ người đang phụ trách được điền giải thích. Tài khoản có quyền Chốt không tự có quyền viết thay Sale.
- Cơ sở là bộ lọc xem theo quy ước hiện tại; không tự biến `user.coSo` thành giới hạn phân quyền cơ sở mới.
- Ghi cập nhật dùng `WHERE version = expectedVersion`, tăng version và ghi audit cùng giao dịch; xung đột 409 để tải lại, không ghi đè âm thầm. Hết cửa sổ thì không cho sửa.

### 3.5. API

Router `/api/invoice-price-audit`, `Cache-Control: no-store`; định danh dòng phải chứa cơ sở vật lý, invoiceId và sourceLineNo, ID hóa đơn truyền chuỗi để không mất độ chính xác BIGINT.

| Method | Đường dẫn | Hợp đồng |
|---|---|---|
| GET | `/` | Query `branch`, `from`, `to`, `sale`, `status=correct/wrong`, `decision=pending/ok/penalty`, `vat`, `freight`, `q`, `page`, `pageSize`; bỏ query tương ứng là tất cả. Trả `{ meta, filters, kpis, totals, rows, totalRows, page, pageSize }` |
| PATCH | `/:branch/:invoiceId/:lineNo/explanation` | `{ text, expectedVersion }`, text tối đa 4.000 ký tự, cho chuỗi trống; trả dòng hiện tại sau ghi |
| PATCH | `/:branch/:invoiceId/:lineNo/decision` | `{ decision: null / "ok" / "penalty", expectedVersion }`; trả dòng sau ghi cùng tổng mới cần cập nhật |
| GET | `/export/fields` | Catalog cột dùng chung, không bỏ qua quyền xuất |
| GET | `/export` | Cùng bộ lọc, `format=xlsx/html`, `columns`; bỏ phân trang, xuất toàn bộ tập đã lọc |

- `rows` chứa 18 khóa nghiệp vụ, các cột bổ sung, `version`, `canEditExplanation`, `canDecide`; tiền NUMERIC truyền chuỗi decimal, frontend định dạng khi hiển thị. `originalStatus/effectiveStatus` dùng `correct/wrong`, nhãn UI tiếng Việt.
- Mặc định `pageSize=50`, cho 25/50/100/200, page từ 1; ngày ngoài cửa sổ hoặc enum không hợp lệ trả 400. Ngày lọc chỉ trong cửa sổ công bố.
- Chưa có bản công bố trả 200 với `meta.available=false` và thông điệp “Chưa chạy kiểm tra giá”, không trình bày KPI 0 như đã kiểm tra xong. Thiếu migration trả trạng thái unavailable có lý do an toàn; lỗi DB thực trả 503.
- Chốt Ok/Phạt trả số tính từ bản gốc; client không được gửi giá min, tiền phạt hoặc trạng thái đúng/sai tự tính. Giá trị khác `ok/penalty/null` bị từ chối.
- Sau sửa, cập nhật KPI và bộ lọc đang dùng: một dòng Sai giá vừa duyệt Ok phải rời bộ lọc Sai giá, xuất hiện ở Đúng giá + Ok, số dòng và tổng tiền cập nhật tương ứng.

## 4. Các task triển khai theo thứ tự

### Task 1 — Parser và bộ quy tắc đầu vào

**Files:** tạo `server/invoicePriceAudit/priceNoteParser.js`, `priceAuditRules.js`, các test cùng tên; giữ danh sách khách bao cước trong `priceAuditRules.js`.

**Interfaces:** `parsePriceNote(text)` trả `{ cartonSize, tiers: [{ position, cartons, unitPrice }], vatPerUnit, updatedLabel }`, các số là decimal string hoặc null; `customerLevelFromEmail(email)` trả `medium/large/vip`; `hasFullVat(lineNote, invoiceNote)` trả boolean; `isExcludedProduct(name)` trả `od/pk/null`; `isFreightCustomer(name)` trả boolean. Các hàm này thuần, không đọc DB.

- [x] Viết test bảng bậc giá, ví dụ T100/T30, ô `-T --`, email và các ghi chú VAT trước khi tạo implementation.
- [x] Chạy `node --test invoicePriceAudit/priceNoteParser.test.js invoicePriceAudit/priceAuditRules.test.js` trong `server`; xác nhận test đỏ do thiếu module/hành vi.
- [x] Implement parser/chuẩn hóa tối thiểu theo mục 1; không dùng eval hoặc suy giá từ chữ số bất kỳ trong mô tả.
- [x] Chạy lại lệnh trên và xác nhận xanh; commit riêng parser/quy tắc.

Test mẫu tối thiểu:

```js
assert.deepEqual(parsePriceNote('T30 # 4/10 # 1T -169000 | 2T- 168000 | 3T- 167000 | -T -- | VAT+16800đ').tiers,
  [{position: 1, cartons: '1', unitPrice: '169000'},
   {position: 2, cartons: '2', unitPrice: '168000'},
   {position: 3, cartons: '3', unitPrice: '167000'}]);
assert.equal(customerLevelFromEmail('Vừa@gmail.com'), 'medium');
assert.equal(customerLevelFromEmail('abc@gmail.com'), 'medium');
assert.equal(hasFullVat(' FULL   VAT ', ''), true);
assert.equal(hasFullVat('', 'fullvat'), true);
assert.equal(isExcludedProduct('Hàng phụ (pk)'), 'pk');
```

### Task 2 — Migration và cước cột O

**Files:** migration trong `server/db/migrations/`; sửa `server/shipment/measureSheet.js`, `measureSheet.test.js`, `server/sheetSnapshots/sync.js`, `sync.test.js`; thêm `server/invoicePriceAudit/priceAuditMigration.test.js`.

**Interfaces:** `parseMeasureRows()` bổ sung `freightPerUnit` nullable nhưng không đổi các trường cũ; `shipping_measures.freight_per_unit` lưu giá trị nguồn; API tra cứu cũ không phải thay đổi hình dạng nếu bên dùng không cần cước.

- [x] Test migration trên DB mới và DB có shipping_measures cũ; test ràng buộc decision/PK, không cascade từ invoices nguồn.
- [x] Test parser lấy đúng cột O có tiêu đề xuống dòng, 0 hợp lệ, trống là null; không tính lại cước từ m3/kg. Tiêu đề O sai cấu trúc phải báo lỗi nguồn, không lấy nhầm cột khác.
- [x] Chạy test đỏ: `node --test invoicePriceAudit/priceAuditMigration.test.js shipment/measureSheet.test.js sheetSnapshots/sync.test.js`.
- [x] Viết migration và bổ sung đọc/ghi `freight_per_unit`; giữ hành vi mã trùng lấy dòng đầu như measureSheet hiện có.
- [x] Chạy lại xanh, đối chiếu test Vòng đời đơn không thay đổi kết quả; commit migration và tích hợp Cân đo.

Fixture cước: hàng T100 có O=384 phải lưu `'384'`; hàng có O trống lưu null; khi quy tắc đối chiếu dùng cước thiếu phải ra 0.

### Task 3 — Tính giá chính xác và chụp hóa đơn

**Files:** tạo `server/invoicePriceAudit/priceAuditSql.js`, `priceAuditRepository.js`, các test cùng tên.

**Interfaces:** `captureUnseenInvoices({ day, client, now })` trả `{ addedInvoices, addedLines }`; `readReport(query, viewer)` trả shape GET đã định nghĩa. SQL nhận kết quả parser dưới dạng decimal string, CAST NUMERIC để so ngưỡng/tính min/chênh, không đưa phép tiền tệ qua số thực JS. `priceAuditSql.js` chứa biểu thức NUMERIC dùng chung với truy vấn đọc kết quả.

- [x] Dựng fixture PGlite gồm invoice/customer/product HN/SG, mô tả đã parse và cước. Viết các test giá trong mục 5, test giữ bản chụp cả hóa đơn.
- [x] Chạy `node --test invoicePriceAudit/priceAuditSql.test.js invoicePriceAudit/priceAuditRepository.test.js`, xác nhận đỏ.
- [x] Implement loader đầy đủ dòng, tổng theo mã, ứng viên từng miền và insert snapshot; khóa/xác nhận toàn bộ hóa đơn trong một giao dịch. Không chọn lại sản phẩm theo tên khi có product_id đúng cơ sở.
- [x] Dùng `MIN` trên các ứng viên hợp lệ; thiếu giá là null, không COALESCE thành 0. Trường hợp bỏ qua có cờ riêng, không chỉ dựa vào chênh dương.
- [x] Test giá lẻ và SL thập phân bằng NUMERIC, tổng chính xác; lưu source_hash và ghi chú để kiểm chứng snapshot. Chạy lại xanh và commit.

Fixture đối chiếu bắt buộc: HN cơ bản 24.000 + VAT 2.000, cước 500; SG cơ bản 23.800 + VAT 1.000; khách bao cước HN full VAT phải ra `min(26.500; 24.800) = 24.800`, không phải 25.800 hoặc 26.500.

### Task 4 — Job 23:00 và cửa sổ 7 ngày

**Files:** tạo `server/invoicePriceAudit/priceAuditRefresh.js`, `priceAuditScheduler.js`, test cùng tên, `server/scripts/refresh-invoice-price-audit.js`; sửa `server/index.js`, `server/config.js`, `server/.env.example`, `server/package.json`.

**Interfaces:** `runDailyAudit({ day, pool, now })` trả `{ status: completed/already-completed/failed, addedInvoices, addedLines }`; `createPriceAuditScheduler({ enabled, pool, now })` trả `{ start, stop }`. Biến `INVOICE_PRICE_AUDIT_ENABLED` mặc định false cho rollout có kiểm soát; sau nghiệm thu bật true. Script `npm run invoices:price-audit -- --date YYYY-MM-DD` mặc định dry-run, `--apply` mới ghi DB, không có cờ ghi đè snapshot cũ.

- [x] Viết test fake clock 22:59/23:00, UTC/VN, tháng/năm, hai instance, retry và bắt kịp sau restart.
- [x] Chạy `node --test invoicePriceAudit/priceAuditRefresh.test.js invoicePriceAudit/priceAuditScheduler.test.js`, xác nhận đỏ.
- [x] Implement slot DB/advisory lock, giao dịch công bố và prune mục 3.3; stop timer theo SIGTERM/SIGINT như các job có sẵn.
- [x] Test lỗi giữa chừng không xóa bản cũ; thành công ngày D+1 giữ nguyên 6 ngày, thêm invoice muộn và loại D−6 cũ. Dry-run không ghi cả state/lịch sử.
- [x] Chạy lại xanh, thêm npm script, cấu hình và commit.

Ví dụ nghiệm thu: job ngày 20/10 công bố 14–20/10; job ngày 21/10 công bố 15–21/10. Hóa đơn ngày 20/10 xuất hiện lúc 23:10 được thêm ngày 21/10; dòng đã ghi nhận ngày 20/10 không đổi khi giá ngày 21/10 giảm.

### Task 5 — API, quyền giải thích và Chốt

**Files:** tạo `server/invoicePriceAudit/priceAuditAccess.js`, `priceAuditService.js`, `priceAuditRoutes.js`, test cùng tên; sửa `server/auth/featureRegistry.js`, `featureRegistry.test.js`, `server/routes.js`; mở rộng `priceAuditRepository.js` cho ghi có version/audit.

**Interfaces:** `canExplain(viewer, currentCustomerGroup)` và `canDecide(viewer)` theo mục 3.4; `setExplanation(key, text, expectedVersion, actor)` / `setDecision(key, decision, expectedVersion, actor)` ghi atomically và trả row mới. Khóa `key = { branch, invoiceId, sourceLineNo }`.

- [x] Test người chưa đăng nhập, thiếu quyền, Sale đúng/sai nhóm, tên giống gần đúng, nhóm rỗng, Quản lý, người được cấp riêng, thu hồi quyền và quyền xem cơ sở hiện có.
- [x] Test không sửa được snapshot qua PATCH, 409 khi version cũ, 400 khi Phạt dòng vốn đúng, quyết định ngoài enum, 404 khi dòng hết cửa sổ.
- [x] Chạy `node --test invoicePriceAudit/priceAuditAccess.test.js invoicePriceAudit/priceAuditService.test.js invoicePriceAudit/priceAuditRoutes.test.js auth/featureRegistry.test.js`, xác nhận đỏ.
- [x] Implement endpoints, row capabilities, kiểm tra quyền mới trên mọi request, nhật ký trước/sau. Dùng query parameterized; không ghép SQL trực tiếp từ sort/filter/columns.
- [x] Test Ok → Đúng/0, Phạt → Sai/chênh gốc, đổi Ok sang Phạt phục hồi đúng số gốc, tổng chưa chốt và tổng phạt không lẫn; chạy lại xanh và commit.

### Task 6 — Một bảng, bộ lọc và xuất file

**Files:** tạo `server/public/invoice-price-audit.js`, `server/invoicePriceAudit/priceAuditColumns.js`, `priceAuditExport.js` và test; sửa `server/public/index.html`, tận dụng `server/public/shared/table-controls.js`; thêm `server/test/frontend/invoice-price-audit.test.js`.

**Interfaces:** catalog ở `priceAuditColumns.js` là nguồn cho export fields và metadata cột frontend; `createPriceAuditExport({ rows, columns, format, meta })` trả `{ buffer, mimeType, fileName }`. Chọn cột không được làm mất quyền/đổi tập lọc.

- [x] Viết test DOM: đúng 18 cột nghiệp vụ đúng thứ tự, 16 cột mặc định, chỉ một bảng kiểm tra giá, dòng OD/PK/thiếu giá hiện đúng, nút theo quyền từng dòng.
- [x] Viết test query/bộ lọc, đổi Chốt làm dòng di chuyển đúng tập lọc, giữ số gốc trong cột đối chiếu; giải thích thất bại không giả vờ đã lưu.
- [x] Chạy `node --test test/frontend/invoice-price-audit.test.js invoicePriceAudit/priceAuditExport.test.js`, xác nhận đỏ.
- [x] Implement mục bảng, nạp khi mở tab/có quyền; không kéo toàn bộ hóa đơn vào trình duyệt để tính giá. Dùng table-controls cho cột/độ rộng/phân trang; catalog định nghĩa tên tiếng Việt đúng mục 2.
- [x] Implement XLSX/HTML từ cùng repository/filter/catalog; metadata cửa sổ, lần chạy và tiền chênh/phạt nhất quán trên màn hình và file.
- [x] Test export đúng toàn bộ kết quả lọc, không chỉ trang 1; chạy lại xanh. Kiểm tra browser Light/Dark, cuộn ngang, form sửa, lỗi 409 và popup hóa đơn; commit.

### Task 7 — Nghiệm thu, tài liệu và triển khai

**Files:** cập nhật `README.md`, `server/README.md`, `server/db/SCHEMA.md`, `CURRENT.md`; đối chiếu tài liệu BRD/SRS/planning nếu đang mô tả phạm vi tính năng bị thay đổi.

- [ ] Chạy toàn bộ nhóm test tính năng, rồi `npm test` trong `server`; điều tra lỗi mới trước khi công bố kết quả. Chạy `graphify update .` theo quy ước repo sau khi code hoàn thành.
- [ ] Trên dữ liệu thử, dựng 7 ngày đầy đủ: đúng, sai, Ok, Phạt, VAT theo dòng/đơn, bao cước HN, khách cùng tên mua SG và hóa đơn tới muộn.
- [ ] Chạy CLI dry-run với cấu hình triển khai; kiểm số hóa đơn/dòng và mẫu min HN/SG trước khi áp dữ liệu thật. Không ghi lại vào KiotViet hoặc Google Sheets.
- [ ] Áp migration đã kiểm tra, deploy với job tắt, xác nhận Cân đo đã lưu cột cước thành công. Nạp lần đầu bằng CLI `--apply` đúng ngày triển khai; xác minh cửa sổ và từng căn cứ trên một tập mẫu.
- [ ] Bật `INVOICE_PRICE_AUDIT_ENABLED=true`, xác nhận lượt 23:00 tiếp theo; chỉ ghi “đã triển khai” sau khi kiểm chứng production thực tế.
- [ ] Rollback: tắt job, ẩn mục theo feature nếu cần; giữ bảng chụp để khôi phục, không sửa/xóa nguồn Kiot. Lỗi job mới không chặn tab Giao dịch hiện có.
- [ ] Cập nhật tài liệu trạng thái với thời điểm migrate/deploy/job đầu thực tế, không ghi hoàn thành trước bằng chứng; commit tài liệu.

## 5. Ma trận nghiệm thu tối thiểu

| Nhóm | Kịch bản và kết quả phải đạt |
|---|---|
| Ngưỡng | T100: 1/99/100/299 → 24.000; 300/499 → 23.800; 500/999 → 23.600; 1.000/1.001 → 23.000 |
| Cộng dòng | 200 + 100 cùng mã trong một hóa đơn cùng được xét 300; hai hóa đơn riêng không được cộng |
| Cấp khách | Vừa mua đủ bậc Lớn hưởng giá Lớn; VIP mua ít hưởng VIP; đủ bậc thứ tư được hưởng bất kể cấp; email trống/lạ = Vừa |
| Bậc thiếu | T30 có `-T --` không tạo bậc giá 0 và không làm giảm min; thiếu cả giá = Đúng giá, lý do không có giá |
| VAT | `FULLVAT`, `Full Vat`, nhiều khoảng trắng; dòng VAT không lan dòng khác; ghi chú đơn áp toàn bộ; thiếu VAT = 0 |
| Bỏ qua | Tên OD/PK có đủ giá và bán thấp vẫn Đúng, tiền 0; chữ OD/PK không nằm trong ngoặc không tự loại |
| Giảm giá | Đơn giá 25.000, giảm dòng 2.000, min 24.000 → thiếu 1.000/đv; giảm chung đơn không tác động |
| Bao cước | HN đúng danh sách dùng min(HN+cước, SG); SG không cộng; mã thiếu O=0; thiếu SG dùng HN+cước; VAT từng miền khác nhau |
| Ranh giới | Giá bằng min đúng; giá cao hơn không có tiền âm; NUMERIC không sinh sai giá vì sai số dấu phẩy động |
| Chốt | 100 × 1.000 = 100.000; chưa chốt là chênh dự kiến; Phạt đúng 100.000; Ok thành Đúng/0 nhưng giữ gốc; sửa lại khôi phục gốc |
| Snapshot | Đổi giá/SL/ghi chú/VAT/cước/email sau quét không đổi dòng cũ; hóa đơn thêm/xóa/đổi thứ tự dòng không bị thêm trùng |
| Cửa sổ | Job 20/10 giữ 14–20; job 21/10 giữ 15–21; lịch sử giải thích/chốt ngày hết hạn bị loại cùng dòng |
| Tới muộn | Hóa đơn 23:10 thêm tối sau; hóa đơn mới đồng bộ của ngày vẫn trong cửa sổ được thêm; quá 7 ngày không thêm |
| Ngày giờ | Hóa đơn Kiot 00:10 không bị dịch +7h; slot 23:00 = 16:00 UTC; scheduler không lệ thuộc timezone server |
| Độ bền | Lỗi nửa chừng giữ toàn bộ bản cũ; retry cùng ngày không nhân bản; hai instance không chạy trùng; server restart bắt kịp |
| Quyền | Sale đúng nhóm sửa giải thích, sai nhóm bị 403 dù sửa request; Quản lý/người được cấp mới chốt; thu hồi quyền có hiệu lực request kế tiếp |
| Hiển thị | Tất cả/Đúng/Sai + Chưa chốt/Ok/Phạt kết hợp đúng; Ok rời danh sách Sai; chỉ số đếm hóa đơn không trùng; xuất giống bộ lọc |
| Nguồn lỗi | Mô tả thực sự trống = không sai; lỗi query/nguồn chưa sẵn sàng không được giả thành giá trống và công bố 0 lỗi |

## 6. Mặc định thiết kế để triển khai thống nhất

Các mục sau là lựa chọn kỹ thuật được chốt trong kế hoạch, không phải nội dung người dùng đã mô tả nguyên văn:

- Chỉ quét hóa đơn **Hoàn thành**, số lượng dòng dương. Hóa đơn hủy/chưa hoàn thành chưa được ghi nhận; khi chuyển Hoàn thành và còn trong 7 ngày thì được thêm. Hóa đơn đã chụp sau đó bị hủy vẫn giữ kết quả như quy tắc bất biến.
- Khóa snapshot ở cấp hóa đơn, vì thứ tự dòng nguồn có thể thay đổi. Phát hiện muộn chỉ bổ sung hóa đơn chưa quét, không cập nhật thêm dòng vào hóa đơn cũ.
- Nhóm phụ trách hiện tại quyết định quyền giải thích; nhãn Sale lúc quét giữ nguyên để giải trình. Ánh xạ theo tên tài khoản chuẩn hóa chính xác; không thêm bảng phân công mới.
- Có thể đổi/xóa Chốt khi còn quyền và còn trong cửa sổ; giữ audit trong cùng thời hạn 7 ngày. Không tự khóa vĩnh viễn sau lần duyệt đầu.
- Không có giá quy định: min=null, kết quả Đúng giá, tiền 0; không ngầm gán giá min bằng 0 hoặc lấy giá bán làm giá quy định.
- Cước thiếu ở ô hợp lệ là 0; không đọc được toàn bộ nguồn Cân đo chưa có bản thành công thì job giữ bản cũ, không giả dữ liệu nguồn bằng 0.
- Tiền lưu/tính NUMERIC đúng độ chính xác nguồn, không áp dung sai hoặc làm tròn trước so sánh. Hiển thị theo độ lẻ thực tế tối đa 2 số, xuất giữ số gốc; tổng dùng số gốc.
- Không tạo cột nhập tiền phạt riêng: tiền phạt tự suy từ quyết định và chênh gốc, tránh nhập sai khác với giá đã đối chiếu.

## 7. Checklist tự rà soát kế hoạch

- [x] Bao phủ các quy tắc đã xác nhận, gồm min HN+cước/SG và VAT từng Kiot.
- [x] Một bảng duy nhất, chốt thứ tự cột, cột mặc định/ẩn, bộ lọc và quyền sửa.
- [x] Phân biệt số tính gốc với số sau duyệt; tiền dự kiến khác tiền đã chốt phạt.
- [x] Có sổ khóa hóa đơn để giữ 6 ngày cũ và tránh trùng khi nguồn đổi dòng.
- [x] Có lịch 23:00, bổ sung muộn, cửa sổ, giao dịch công bố, retry và nguồn lỗi.
- [x] Có task/file/interface/test/rollout; lựa chọn kỹ thuật chưa được phỏng vấn riêng được ghi rõ ở mục 6.
- [x] Không triển khai bảng giá cắt lô riêng trong phạm vi này.
