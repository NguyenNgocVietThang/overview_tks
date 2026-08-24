# Hướng dẫn test thủ công: Batch update `updateOrderItems` (Task 4.2)

> **Trạng thái:** Code đã merge, đã pass toàn bộ unit test (mock Google Sheets API hoàn
> toàn). **CHƯA được test với Google Sheets API thật** — sandbox thực hiện task này không
> có credential đăng nhập dashboard. Tài liệu này là hướng dẫn để người vận hành (TKS
> Admin) tự test bằng 1 đơn hàng thật trước khi hoàn toàn tin tưởng code path này.
>
> Liên quan: `server/shipment/vcOrderRepository.js` (`updateOrderItems`),
> `server/sheets/vcSheetsClient.js` (`vcGetSheetId`, `vcBatchUpdate`).
> Xem thêm plan gốc: `docs/superpowers/plans/hi-n-t-i-trang-web-expressive-rocket.md`
> (nếu còn lưu) hoặc lịch sử git các commit `perf: batch sequential row writes...` /
> `fix: normalize order_id/product_code matching...`.

## ĐỌC TRƯỚC: hiện KHÔNG có giao diện nào gọi endpoint này

Đã grep cả hai SPA frontend: **`dispatch.js` và `mobile.js` đều KHÔNG gọi**
`PATCH /api/shipment/orders/:orderId/items`.
- `dispatch.js` chỉ PATCH `/vehicles/:id` và `/orders/:id` (metadata đơn, **không phải** item).
- `mobile.js` chỉ gọi `/attachments`, `/transition`, `/exceptions`.

**Hệ quả 1 — TIN TỐT:** merge code này mang **rủi ro thụ động gần bằng 0**. Không có
luồng người dùng nào chạm tới code path này, nên **không có gì ghi vào Google Sheet**
cho tới khi ai đó **cố ý** gọi API trực tiếp. Không có nguy cơ "sáng mai nhân viên bấm
nhầm rồi hỏng dữ liệu".

**Hệ quả 2 — QUAN TRỌNG:** "vào trang dispatch, sửa số lượng nhặt, bấm Lưu" **KHÔNG
test được gì cả** — sẽ không có request nào tới endpoint này, và bạn sẽ tưởng là đã test
xong trong khi thực tế chưa. **Bắt buộc phải gọi API trực tiếp** bằng `curl`/Postman
theo công thức dưới đây.

## Bước 1 — SAO LƯU (BẮT BUỘC, làm TRƯỚC KHI test)

1. Mở Google Sheet vận đơn (`VC_SPREADSHEET_ID`).
2. **Cách A (nhanh, đủ dùng):** chuột phải vào tab **`Chi tiết vận chuyển`** → **Duplicate**.
   Đổi tên bản sao thành ví dụ `Chi tiết vận chuyển - BACKUP <ngày>`.
3. **Cách B (an toàn hơn, khuyến nghị):** **File → Make a copy** toàn bộ spreadsheet.
4. **Ghi lại thời điểm backup** (ngày + giờ).

> Bản backup này là điểm khôi phục thủ công duy nhất (copy-paste dữ liệu ngược lại) nếu
> code ghi sai. Đừng bỏ qua.

## Bước 2 — Lấy cookie xác thực từ trình duyệt

Endpoint yêu cầu `requireAuth` + `requireRole(...INTERNAL_ROLES)`. Xác thực bằng **JWT
trong httpOnly cookie tên `tks_auth`** (xem `server/auth/authMiddleware.js`). Vì là
httpOnly nên **không** đọc được bằng JavaScript — phải lấy qua DevTools:

1. Đăng nhập dashboard bình thường bằng tài khoản có vai trò nội bộ
   (**Quản lý / Kế toán / Trưởng kho / Trợ lý / Lái xe**; tài khoản **Khách** sẽ bị 403).
2. Mở **DevTools (F12) → tab Application** (Chrome/Edge) hoặc **Storage** (Firefox).
3. Bên trái chọn **Cookies → domain đang dùng** (vd `http://localhost:3000`).
4. Tìm dòng tên **`tks_auth`**, copy toàn bộ giá trị ở cột **Value** (chuỗi JWT dài, có 2
   dấu chấm).

> Cookie này là chìa khoá đăng nhập của bạn — đừng dán vào chỗ công khai, và đừng để lại
> trong lịch sử shell dùng chung. Sau khi test xong có thể đăng xuất để vô hiệu hoá phiên.

## Bước 3 — Chọn đơn test và ĐỌC giá trị hiện tại

Chọn **1 đơn có 3-5 item**, **không phải đơn gấp / đang giao**, vào **giờ thấp điểm**.

> #### Về `Mã hàng` toàn chữ số
>
> Trước đây mã hàng toàn chữ số **không khớp** và bị bỏ qua âm thầm; đã sửa (xem mục
> "Vấn đề cần lưu ý" bên dưới, điểm 2). Nếu muốn test con đường "cơ bản nhất" thì chọn mã
> có chữ cái (vd `SP-A123`). Nếu muốn kiểm luôn phần vừa sửa thì chọn đơn có mã hàng toàn
> chữ số — nó **phải** hoạt động.

Đọc trạng thái hiện tại của đơn (thay `VC-20260820-0001` bằng mã đơn thật, và
`<COOKIE>` bằng giá trị `tks_auth` vừa copy):

```bash
curl -s "http://localhost:3000/api/shipment/orders/VC-20260820-0001" \
  -H "Cookie: tks_auth=<COOKIE>"
```

Đồng thời **mở tab `Chi tiết vận chuyển` trên Google Sheet** và **chụp màn hình** tất cả
dòng của đơn đó (cả 7 cột) **và** vài dòng liền kề trên/dưới (thuộc đơn khác) để đối chiếu.
Ghi lại **số dòng** (số 1, 2, 3… ở lề trái Sheets) của từng dòng thuộc đơn test.

## Bước 4 — Gọi endpoint thật

Route: `PATCH /api/shipment/orders/:orderId/items` (`shipmentOrderRoutes.js:219`).
Handler chỉ kiểm `Array.isArray(items)`; mỗi phần tử cần `product_code`, và tuỳ chọn
`quantity_picked` và/hoặc `notes`. Trả về `{"success":true}`.

**Bash / macOS / Linux / Git Bash:**

```bash
curl -i -X PATCH "http://localhost:3000/api/shipment/orders/VC-20260820-0001/items" \
  -H "Content-Type: application/json" \
  -H "Cookie: tks_auth=<COOKIE>" \
  -d '{
    "items": [
      { "product_code": "SP-A123", "quantity_picked": 5 },
      { "product_code": "SP-B456", "quantity_picked": 3, "notes": "thiếu 2 thùng" },
      { "product_code": "SP-C789", "quantity_picked": 10 }
    ]
  }'
```

**PowerShell (Windows) — dùng here-string để tránh lỗi escape dấu nháy:**

```powershell
$body = @'
{"items":[
  {"product_code":"SP-A123","quantity_picked":5},
  {"product_code":"SP-B456","quantity_picked":3,"notes":"thiếu 2 thùng"},
  {"product_code":"SP-C789","quantity_picked":10}
]}
'@
Invoke-WebRequest -Method PATCH `
  -Uri "http://localhost:3000/api/shipment/orders/VC-20260820-0001/items" `
  -ContentType "application/json; charset=utf-8" `
  -Headers @{ Cookie = "tks_auth=<COOKIE>" } `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
```

**Postman:** Method `PATCH` · URL như trên · tab **Headers** thêm
`Cookie: tks_auth=<COOKIE>` · tab **Body → raw → JSON** dán đúng JSON ở trên.

Kết quả mong đợi: **HTTP 200** với body `{"success":true}`.

| Mã lỗi | Ý nghĩa |
|---|---|
| `401` | Cookie sai/hết hạn → đăng nhập lại rồi copy `tks_auth` mới |
| `403` | Tài khoản không thuộc 5 vai trò nội bộ (vd đang dùng tài khoản Khách) |
| `400` `INVALID_REQUEST` | `items` không phải mảng — kiểm tra lại JSON body |
| `500` | Lỗi từ Google API — đọc log server, **kiểm tra Sheet ngay** vì có thể đã ghi một phần |

> **Lưu ý:** HTTP 200 **không** đảm bảo đã ghi. Nếu `product_code` không khớp dòng nào,
> hàm bỏ qua âm thầm và vẫn trả 200. Vì vậy **bắt buộc** làm Bước 5.

## Bước 5 — Kiểm tra ngay sau khi gọi

Mở trực tiếp Google Sheet, tab `Chi tiết vận chuyển`, kiểm tra:

- [ ] **TẤT CẢ** item trong request đã cập nhật đúng giá trị, **đúng dòng** (đối chiếu số
      dòng đã ghi ở Bước 3 — không lệch lên/xuống 1 dòng; đây là lỗi nguy hiểm nhất).
- [ ] Số lượng đã nhặt hiển thị là **SỐ** (căn phải mặc định), **không** phải văn bản
      (căn trái) — căn trái là dấu hiệu sai kiểu dữ liệu.
- [ ] Các cột **không** được sửa (Mã vận đơn, Mã hàng, Tên hàng hóa, Số lượng đặt, Đơn vị
      tính) vẫn **y hệt** trước khi gọi.
- [ ] Các dòng **của đơn KHÁC** (đặc biệt dòng ngay trên và ngay dưới) **không đổi gì cả**.
- [ ] **Dòng header (dòng 1) không bị ghi đè** — nếu header bị thay bằng dữ liệu đơn hàng
      thì có lỗi off-by-one, **dừng ngay**.
- [ ] **Định dạng ô còn nguyên**: màu nền, viền, in đậm header, number format, data
      validation (dropdown) nếu có.
- [ ] Ghi chú (note/comment của ô) nếu có → còn nguyên.
- [ ] Nếu **không có gì thay đổi cả** dù trả về 200 → khả năng cao là `product_code` gửi
      lên không khớp chính xác giá trị trên sheet (kiểm tra lại chính tả/khoảng trắng),
      **không** vội kết luận là code hỏng. Xem mục "Vấn đề cần lưu ý" điểm 2.

## Bước 6 — Nếu có bất kỳ sai lệch nào: KHÔI PHỤC

1. **Dừng ngay**, không gọi thêm request nào.
2. Khôi phục dữ liệu từ bản backup ở Bước 1.
3. ** Sau khi khôi phục/đổi tên bất kỳ tab nào: KHỞI ĐỘNG LẠI SERVER (hoặc chờ 5 phút)**
   trước khi ghi tiếp — xem điểm 4 bên dưới.

## Test biên (khuyến nghị làm thêm sau khi test cơ bản qua)

- Đơn chỉ có **1 item**.
- Item nằm ở **dòng cuối cùng** của sheet.
- Chỉ patch `notes`, không đổi `quantity_picked`.
- Trộn 1 mã đúng + 1 mã sai trong cùng request (mã sai phải bị bỏ qua, mã đúng vẫn ghi).
- Request với `items: []` (mảng rỗng) — không được gọi Google API nào cả.
- 2 đơn liên tiếp để kiểm tra cache `vcGetSheetId` hoạt động đúng (không phải gọi lại
  metadata mỗi lần).

## Vấn đề cần lưu ý

1. **[QUAN TRỌNG] Kiểm chứng production chưa làm.** Sandbox không có credential đăng nhập
   nên bước test bằng đơn thật chưa chạy. Mọi kết luận "đúng" ở trên đến từ static analysis
   + unit test với API đã mock. Rủi ro tồn dư: **hành vi thật của Google Sheets API** (đặc
   biệt ngữ nghĩa field mask và CellData rỗng) được suy ra từ tài liệu API chứ chưa quan
   sát trực tiếp. **Giảm nhẹ:** hiện **không giao diện nào gọi endpoint này**, nên merge
   không tạo rủi ro thụ động — chỉ khi gọi API trực tiếp mới có ghi.

2. **[ĐÃ SỬA] Mã hàng dạng SỐ trước đây không khớp — bug có sẵn, nay đã xử lý.**
   `vcGetValues` đọc bằng `UNFORMATTED_VALUE`, nên ô "Mã hàng" toàn chữ số (vd `12345`) trả
   về **SỐ** `12345`, trong khi client luôn gửi **chuỗi** `"12345"` qua JSON. Phép so sánh
   cũ cho `12345 === "12345"` = **false** ⇒ item bị **bỏ qua âm thầm**: API trả 200, không
   ghi gì, không báo lỗi. Đã sửa bằng helper `sameKeyValue()` chuẩn hoá cả 2 vế qua
   `String(...).trim()`, dùng cho cả `order_id` và `product_code`, có guard chặn
   `null`/`undefined` khớp bậy.

3. **Grid phải có ít nhất 7 cột.** Chỉ thành vấn đề nếu ai đó **xoá bớt cột** trên tab
   thật; khi đó API báo lỗi rõ ràng ("exceeds grid limits") chứ không ghi sai âm thầm.

4. **Cache `vcGetSheetId` 5 phút vs. thao tác đổi tên/tạo lại tab.** Nếu tab bị xoá rồi
   tạo lại (hoặc bản backup được đổi tên thành tên gốc), sẽ có **sheetId mới dưới tên cũ**
   trong khi cache còn giữ id cũ tới 5 phút ⇒ ghi trong cửa sổ đó lỗi `"No sheet with id"`.
   **Fail loudly, không hỏng dữ liệu.** **Restart server (hoặc chờ 5 phút) sau khi khôi
   phục/đổi tên bất kỳ tab nào.**

5. **`vcBatchUpdate` xoá TOÀN BỘ cache VC** (mọi tab), không chỉ tab orderItems — hành vi
   có chủ ý (blast radius của batchUpdate không biết trước). An toàn về tính đúng đắn, chỉ
   hơi phí đọc lại.

6. **Thay đổi hành vi có chủ ý** về suy diễn kiểu dữ liệu: `updateCells` ghi kiểu tường
   minh (số/chuỗi) thay vì để Google tự đoán như `USER_ENTERED` trước đây — an toàn hơn
   (văn bản dạng số như `"0012"` không còn bị biến thành số `12`), nhưng vẫn là 1 thay đổi
   hành vi đáng lưu ý khi đối chiếu.
