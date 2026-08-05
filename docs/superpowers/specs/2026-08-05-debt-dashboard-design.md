# Thiết kế: Dashboard Công nợ 1/3/7 ngày (HN1/HN3/HN7)

Ngày: 2026-08-05

## Bối cảnh

Dashboard hiện tại (`server/`, Node.js/Express, đọc Google Sheets read-only) có 5 tab:
Tổng quan, Hàng hóa, Hóa đơn, Khách hàng, Nhà cung cấp. Ba tab `HN1`, `HN3`, `HN7`
trong Google Sheet do KiotViet tự quản lý và tự động xuất báo cáo — Apps Script
(`src/`) tuyệt đối không được tạo/xóa/ghi/đổi cấu trúc 3 tab này (xem README,
SRS FR-06.10). Cho đến nay dashboard Node.js cũng chưa từng đọc 3 tab này.

Yêu cầu: thêm 1 khu vực dashboard hiển thị công nợ theo 3 kỳ 1/7/3 ngày, lấy dữ
liệu trực tiếp (chỉ đọc) từ HN1/HN3/HN7, tự làm mới cùng chu kỳ với dashboard
hiện tại.

## Cấu trúc dữ liệu nguồn (xác nhận từ header thực tế của HN1)

Mỗi dòng = 1 khách hàng trong kỳ báo cáo. Header:

```
Mã KH | Khách hàng | Số điện thoại | Nhóm khách hàng | Nợ đầu kỳ | Ghi nợ |
Ghi có | Nợ cuối kỳ | Mã giao dịch | Thời gian | Loại giao dịch | Giá trị |
Dư nợ cuối | Mã hàng | Tên hàng | Thương hiệu | Nhóm hàng(3 Cấp)
```

- HN1 = kỳ 1 ngày gần nhất (tính cả hôm nay), HN3 = 3 ngày, HN7 = 7 ngày — cùng
  cấu trúc cột, chỉ khác độ dài kỳ.
- KiotViet tự cập nhật 1 lần/ngày lúc ~15:00. "Real-time" ở đây nghĩa là dashboard
  phản ánh đúng dữ liệu mới nhất tại mỗi lần tự làm mới (hiện 10 phút/lần), không
  nhanh hơn tốc độ nguồn cập nhật.
- 5 cột giao dịch (Mã giao dịch, Thời gian, Loại giao dịch, Giá trị, Dư nợ cuối)
  có thể chứa NHIỀU giá trị trong 1 ô, ngăn cách bằng dấu `|`, khi khách có nhiều
  giao dịch trong kỳ.

## Kiến trúc thay đổi (chỉ trong `server/`, không đụng `src/`)

1. `server/config.js`: thêm `SHEET_DEBT_1='HN1'`, `SHEET_DEBT_3='HN3'`, `SHEET_DEBT_7='HN7'`.
2. `server/dashboard/debtReport.js` (mới): hàm `parseDebtSheet(rows)` — dò cột
   theo TÊN header (không hardcode theo vị trí), parse số, tách các cột giao
   dịch theo `|` (dùng độ dài mảng lớn nhất nếu các cột lệch số phần tử, không
   throw), trả về `{ customers: [...], kpi: {...} }` cho 1 kỳ.
3. `server/dashboard/dashboardData.js`: thêm HN1/HN3/HN7 vào cùng danh sách sheet
   trong `batchGet` hiện có (1 lần gọi API, không tăng round-trip), gọi
   `parseDebtSheet` cho từng sheet, trả thêm field `debt: { 1, 3, 7 }` trong
   response `getDashboardData()`.
4. `server/public/index.html`: thêm nav-item "Công nợ" (view `debt`), nội dung:
   - 3 nút chuyển kỳ 1 ngày/3 ngày/7 ngày — chuyển tức thời, không gọi lại API
     (dữ liệu cả 3 kỳ đã có sẵn trong 1 response).
   - 4 KPI card: Tổng nợ cuối kỳ, Tổng ghi nợ, Tổng ghi có, Số khách còn nợ.
   - Biểu đồ cột: top 25 khách theo Nợ cuối kỳ giảm dần (tái dùng
     `renderBarChartList`).
   - Bảng đầy đủ khách hàng trong kỳ (Mã KH, Tên, SĐT, Nhóm KH, Nợ đầu kỳ, Ghi
     nợ, Ghi có, Nợ cuối kỳ), có ô tìm kiếm lọc client-side, click 1 dòng để mở
     rộng xem chi tiết từng giao dịch.
   - Dòng ghi chú: dữ liệu công nợ theo kỳ này khác nguồn với "Nợ hiện tại"
     (tổng nợ lũy kế) đang hiển thị ở tab Khách hàng — không đối chiếu chéo.

## Lỗi & trường hợp biên

- Sheet HN1/HN3/HN7 bị đổi tên hoặc chưa share cho service account → cơ chế lọc
  `existingTitles` sẵn có trong `sheetsClient.getMultipleSheetValues` trả mảng
  rỗng cho sheet đó; kỳ tương ứng hiển thị KPI = 0, bảng trống, không crash toàn
  bộ `/api/dashboard`.
- Dòng thiếu Mã KH → bỏ qua.
- Số phần tử giữa các cột giao dịch (`|`) lệch nhau → dùng độ dài lớn nhất, phần
  thiếu để trống.
- Không bao giờ ghi/sửa HN1/HN3/HN7 — chỉ gọi `spreadsheets.values.batchGet` với
  scope `readonly` đã có sẵn.

## Ngoài phạm vi

- Không sửa Apps Script (`src/`), không tạo/xóa/ghi HN1/HN3/HN7.
- Không cần endpoint `/api/search` mới — bảng công nợ lọc phía client.
- Không cố gắng đọc note/comment của ô Google Sheets (chỉ đọc giá trị qua Values
  API) — dòng ghi chú "cập nhật lúc..." trên sheet không được hiển thị lại trên
  dashboard, thay bằng dòng ghi chú tĩnh giải thích chu kỳ cập nhật.
