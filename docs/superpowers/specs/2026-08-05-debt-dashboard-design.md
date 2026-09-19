# Thiết kế: Dashboard Công nợ 1/3/7 ngày (CN1/CN3/CN7)

Ngày: 2026-08-05 (Cập nhật 19/09/2026: Đổi tên gọi HN1/HN3/HN7 thành CN1/CN3/CN7)

> **Trạng thái: ĐÃ ĐƯỢC THAY THẾ.** Thiết kế màn hình kỳ 1/3/7 và payload `debt`
> không còn được sử dụng. Kiến trúc hiện hành là `Quản lý công nợ` theo
> [kế hoạch 15/09/2026](../plans/2026-09-15-debt-management-dashboard.md): số liệu
> lấy từ workbook `Bảng Công nợ`, CN1/CN3/CN7 (trước đây gọi là HN1/HN3/HN7, nay được tổng hợp tự động vào bảng Supabase `customer_debt_activity_periods`) chỉ còn là nguồn đối chiếu cảnh báo "Chưa thu",
> trạng thái xử lý lưu PostgreSQL. Phần bên dưới chỉ được giữ làm lịch sử quyết định.

## Bối cảnh

Dashboard (`server/`, Node.js/Express) đọc dữ liệu từ Supabase PostgreSQL và Google Sheets. Ba
tập dữ liệu `CN1`, `CN3`, `CN7` (trước đây là các tab `HN1`, `HN3`, `HN7` trên Google Sheets do Apps Script tính; nay do Node.js sync engine `customerDebtReportRefresh.js` tính trực tiếp từ KiotViet và lưu vào bảng Supabase `customer_debt_activity_periods`).

Yêu cầu: thêm 1 khu vực dashboard hiển thị công nợ theo 3 kỳ 1/3/7 ngày (CN1/CN3/CN7), tự làm mới cùng chu kỳ với dashboard hiện tại.

## Cấu trúc dữ liệu nguồn (xác nhận từ schema thực tế của CN1/CN3/CN7)

Mỗi dòng = 1 khách hàng trong kỳ báo cáo. Cấu trúc dữ liệu:

```
Mã KH | Khách hàng | Số điện thoại | Nhóm khách hàng | Nợ đầu kỳ | Ghi nợ |
Ghi có | Nợ cuối kỳ | Mã giao dịch | Thời gian | Loại giao dịch | Giá trị |
Dư nợ cuối | Mã hàng | Tên hàng | Thương hiệu | Nhóm hàng(3 Cấp)
```

- CN1 = kỳ 1 ngày gần nhất (tính cả hôm nay), CN3 = 3 ngày, CN7 = 7 ngày — cùng
  cấu trúc, chỉ khác độ dài kỳ.
- Hệ thống tự động cập nhật 1 lần/ngày lúc ~15:00. "Real-time" ở đây nghĩa là dashboard
  phản ánh đúng dữ liệu mới nhất tại mỗi lần tự làm mới (hiện 10 phút/lần), không
  nhanh hơn tốc độ nguồn cập nhật.
- 5 cột giao dịch (Mã giao dịch, Thời gian, Loại giao dịch, Giá trị, Dư nợ cuối)
  có thể chứa NHIỀU giá trị trong 1 ô, ngăn cách bằng dấu `|`, khi khách có nhiều
  giao dịch trong kỳ.

## Kiến trúc dashboard phía server (lịch sử)

1. `server/config.js`: cấu hình kỳ `CN1`, `CN3`, `CN7` (trước đây là `SHEET_DEBT_1='HN1'`, `SHEET_DEBT_3='HN3'`, `SHEET_DEBT_7='HN7'`).
2. `server/dashboard/debtReport.js`: hàm `parseDebtSheet(rows)` — phân tích dữ liệu kỳ, trả về `{ customers: [...], kpi: {...} }` cho 1 kỳ.
3. `server/dashboard/dashboardData.js`: tích hợp CN1/CN3/CN7 vào dữ liệu công nợ.
4. `server/public/index.html`: thêm nav-item "Công nợ" (view `debt`), nội dung:
   - 3 nút chuyển kỳ 1 ngày/3 ngày/7 ngày (CN1/CN3/CN7) — chuyển tức thời.
   - 4 KPI card: Tổng nợ cuối kỳ, Tổng ghi nợ, Tổng ghi có, Số khách còn nợ.
   - Biểu đồ cột: top 25 khách theo Nợ cuối kỳ giảm dần (tái dùng
     `renderBarChartList`).
   - Bảng đầy đủ khách hàng trong kỳ (Mã KH, Tên, SĐT, Nhóm KH, Nợ đầu kỳ, Ghi
     nợ, Ghi có, Nợ cuối kỳ), có ô tìm kiếm lọc client-side, click 1 dòng để mở
     rộng xem chi tiết từng giao dịch.
   - Dòng ghi chú: dữ liệu công nợ theo kỳ này khác nguồn với "Nợ hiện tại"
     (tổng nợ lũy kế) đang hiển thị ở tab Khách hàng — không đối chiếu chéo.

## Lỗi & trường hợp biên

- Nguồn CN1/CN3/CN7 chưa có dữ liệu → cơ chế phòng vệ trả mảng
  rỗng; kỳ tương ứng hiển thị KPI = 0, bảng trống, không crash toàn
  bộ `/api/dashboard`.
- Dòng thiếu Mã KH → bỏ qua.
- Số phần tử giữa các cột giao dịch (`|`) lệch nhau → dùng độ dài lớn nhất, phần
  thiếu để trống.
- Backend không sửa dữ liệu gốc CN1/CN3/CN7 — chỉ đọc đối chiếu.

## Ngoài phạm vi

- Không cần endpoint `/api/search` mới — bảng công nợ lọc phía client.
- Không cố gắng đọc note/comment của ô Google Sheets (chỉ đọc giá trị qua Values
  API) — dòng ghi chú "cập nhật lúc..." trên sheet không được hiển thị lại trên
  dashboard, thay bằng dòng ghi chú tĩnh giải thích chu kỳ cập nhật.
