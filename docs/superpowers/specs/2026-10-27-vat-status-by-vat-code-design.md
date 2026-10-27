# Trạng thái "Còn VAT" tính theo Mã VAT Kiot (2026-10-27)

Phạm vi: tab **Hàng VAT có sẵn** của trang Kế toán – Tra cứu VAT (`server/vatLookup/lookupModel.js`, hiển thị ở `server/public/vat-lookup/vat-lookup.js`).

## Hiện trạng
`summarizeVat(product)` tính trạng thái **theo Mã Kiot**: `Còn VAT` khi mã Kiot có Khớp mã **và** tổng *Tồn có thể nháp* của các dòng VAT thuộc chính mã Kiot đó > 0. Mọi dòng của cùng một mã Kiot dùng chung kết quả.

Hệ quả sai: mã Kiot có Khớp mã sang VAT10680 nhưng không có dòng Gộp VAT riêng (TBVC200, HDLCNL) luôn hiện "Không còn VAT", dù các mã khác cùng VAT10680 (H200TMC, 18S45TB…) đang còn tồn.

## Quy tắc mới
Với mỗi dòng của bảng:

```
tongTon(maVat) = SUMIF(Gộp VAT[MÃ VAT KIOT] = maVat, Gộp VAT[TỒN CÓ THỂ NHÁP])
conVAT = maVat khác rỗng VÀ tongTon(maVat) > 0
```

- **Cột cộng:** *Tồn có thể nháp* (giữ như quy tắc cũ, không dùng Tồn đầu ngày).
- **Phạm vi cộng:** toàn bộ sheet Gộp VAT, không phụ thuộc kết quả tìm kiếm. Tìm bằng mã nào thì một mã VAT cũng ra cùng một trạng thái. Kể cả dòng Gộp VAT không có Mã kiot đại diện vẫn được cộng.
- **So khớp mã VAT:** qua `normalizeCode` (bỏ dấu, chữ thường, bỏ ký tự không phải chữ/số), giống chỗ gom dòng hiện có.
- **Theo từng dòng:** mã Kiot có nhiều dòng với nhiều mã VAT khác nhau thì mỗi dòng xét theo mã VAT của chính dòng đó.
- **Không có Mã VAT Kiot** (sản phẩm chưa có Khớp mã/Gộp VAT, chỉ có ở DK về 2, hoặc Khớp mã để trống mã VAT): "Không còn VAT".
- **Bỏ điều kiện "phải có Khớp mã":** trạng thái chỉ phụ thuộc mã VAT của dòng. Mã Kiot chỉ xuất hiện ở Gộp VAT (là Mã kiot đại diện, không có trong Khớp mã) mà mã VAT còn tồn sẽ hiện "Còn VAT".

## Không đổi
- Các cột số Tồn đầu ngày, Tồn có thể nháp vẫn là số riêng của từng dòng.
- Nhãn "Chuẩn bị về" vẫn tính theo mã Kiot + DK về 2 (trạng thái 1–3).
- Không thêm cột "Tổng tồn theo mã VAT". Tab Hàng sắp về và ORDER VAT giữ nguyên.
- Hợp đồng API `/api/vat-lookup/search` giữ nguyên trường `conVAT`, frontend không cần sửa.

## Thiết kế
- `buildModel` tính thêm `tonCoTheNhapByMaVat: Map<maVatNorm, number>` từ các nhóm Gộp VAT (`buildGopVatGroups`). Tổng các nhóm bằng tổng mọi dòng sheet có mã VAT đó.
- `buildVatRows` đặt `conVAT` cho từng dòng bằng tra map theo `normalizeCode(line.maVat)`. Bỏ `summarizeVat`.
- Model được dựng một lần khi đọc sheet nên mỗi lần tìm chỉ tốn một lần tra Map cho mỗi dòng.

## Kiểm thử (`server/vatLookup/lookupModel.test.js`)
Fixture riêng mô phỏng ảnh lỗi (VAT10680):
- Tìm `TBVC200` thì mọi dòng VAT10680 ra `conVAT = true`, gồm cả dòng có tồn riêng = 0 và dòng không có Gộp VAT riêng.
- Tìm riêng `HDLCNL` cũng ra `true`.
- Mã VAT có tổng = 0 thì `false`.
- Dòng Gộp VAT không có Mã kiot đại diện vẫn được cộng vào tổng (chứng minh SUMIF toàn sheet).
- Mã Kiot chỉ có ở Gộp VAT, mã VAT còn tồn, ra `true`.
- Các test cũ (BDC-PT1B tổng 0, TALEWS không mã VAT) vẫn xanh.
