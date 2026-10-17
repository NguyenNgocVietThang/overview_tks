# Page Design Notes — `shipment/lifecycle/index.html` (Vòng Đời Đơn Hàng)

> Kế thừa toàn bộ `MASTER.md`. Audit gần nhất: 2026-09-15. **Cập nhật 2026-10-12:**
> Trang gồm bảng "Toàn bộ đơn hàng" lọc/sắp xếp/phân trang ở máy chủ (mọi đơn KiotViet ghép Google Sheet) và tab "Lịch sử cập nhật".
> Bổ sung dải thẻ chỉ số tổng quát đầu trang (Chưa gửi KT, Đã gửi KT, Đang giao và 6 loại cảnh báo) bấm để lọc nhanh.
> Hộp xem chi tiết đơn `#lcDetailOverlay` áp dụng chuẩn dùng chung `detail-panel.css` (`.dp-*`) với dải chỉ số tổng quan, tiến trình mốc theo luồng, bảng hàng hóa tắt nút "Cột hiển thị".
> **Cập nhật 2026-10-13:** Hộp chi tiết hiển thị node theo đúng luồng đơn; nút "Bỏ sắp xếp" xuất hiện khi đang sắp theo cột.
> **Cập nhật 2026-10-15:** Bổ sung luồng 6 Kế toán/Chứng từ (`KeToan_ChungTu`): trạng thái `COMPLETED` "Hoàn thành"; dropdown nhà xe (Đức Mạnh / Việt Linh) và cột "Thể tích (m³)" + tổng m³/kg/thùng trong hộp chi tiết.

## Vai trò trang
Xem toàn bộ đơn hàng và vòng đời (quyền `shipment.lifecycle`), tra cứu theo mã, xem lịch sử ghi đè, xuất Excel (quyền `shipment.export`). Đường dẫn: `/shipment/lifecycle/` (tab Lịch sử: `/shipment/lifecycle/#history`).

## 6 Luồng Đơn Hàng (flows)

| `flow` | Sheet nguồn | Số mốc | Ghi chú |
|---|---|---|---|
| `DELIVERY` | `DonHang_HN`, `DonHang_SG` | 6 | Luồng chính, có lái xe, kho |
| `NORTH_SOUTH` | `DonHang_MienNam` | 3 | Bắc-Nam, bỏ cột lái xe/ship |
| `PICKUP` | `Khách_HN`, `Khách_SG` | 4 | Khách/ship lấy tại kho |
| `ACCOUNTING` | `KeToan_ChungTu` | — | Xác nhận KT đã nhận; → trạng thái `COMPLETED` |
| *(Phiếu tạm)* | KiotViet API | — | Giữ mọi ngày, không lọc theo `LIFECYCLE_ORDER_FROM` |

**Hộp chi tiết theo luồng:** chỉ hiện node đúng luồng — DELIVERY 6 node, NORTH_SOUTH 3 node, PICKUP 4 node; chỉ số "Tiến trình" tính theo số mốc của luồng. Luồng ACCOUNTING thêm node "Hoàn thành" (xanh lá) nếu mã đơn xuất hiện trong `KeToan_ChungTu`.

## 6 Cảnh Báo (warnings)

| Mã cảnh báo | Điều kiện | Luồng |
|---|---|---|
| `kt_missing` | Sale gửi KT > 30 phút (giờ 6h–18h), KT chưa duyệt | Tất cả |
| `driver_missing_photo` | Sale gửi > 24h, chưa Tài xế xác nhận, chưa ký nhận | DELIVERY |
| `driver_forgot_photo` | Đã ký nhận mà chưa Tài xế xác nhận | DELIVERY |
| `delivery_overtime` | Tài xế xác nhận > 6h, chưa ký nhận | DELIVERY |
| `pickup_overdue` | Sale gửi > 2 ngày, chưa Ship nhận đơn | PICKUP |
| `north_south_missing_bill` | Sale gửi > 24h, chưa ký nhận | NORTH_SOUTH |

Cảnh báo tự mất khi bước tương ứng đã làm; đơn hủy/sự cố không cảnh báo. API trả `warnings` (mảng mã) + `warning` (boolean tổng hợp). Bộ lọc `?warning=any|<mã>`.

## Component đặc thù của trang
- **Dải thẻ KPI tổng quan & lọc nhanh** (`.lc-kpi-grid`, `.lc-kpi-card`, `.is-active`) — xem MASTER §5.19.
- **Hộp xem chi tiết đơn** dùng khung `.dp-*` (`public/shared/detail-panel.css`), dải chỉ số `.dp-stats`, bảng hàng hóa `.dp-table-wrap` (`data-table-controls="off"`), 1 khung cuộn.
- **Cột Thể tích (m³)** và tổng m³/kg/thùng hiển thị trong hộp chi tiết khi đơn có dữ liệu đo (`measureSheet.js`, `freightCalculator.js`); dropdown nhà xe Đức Mạnh / Việt Linh / J&T và bảng tính cước; khi chọn Việt Linh có ô tick "Giao ra chành" (490k/m³ + vé chành 70k).
- **Nút "Bỏ sắp xếp"** xuất hiện trên cả hai bảng (Toàn bộ đơn hàng, Lịch sử cập nhật) khi đang sắp theo cột; lần bấm tiêu đề thứ ba của bảng Lịch sử cũng về mặc định (mới nhất trước).
- `.lookup-hero` — khối tiêu đề, dùng đúng hệ thống `--canvas-text` (không phải pattern mới, chỉ là cách dùng đúng của mục "Chữ trực tiếp trên nền" trong `shared.css`).
- `.lookup-panel textarea` — cần thay bằng `.form-textarea` chuẩn ở MASTER §5.12 thay vì tự định nghĩa `border-radius:12px` (lệch thang bo góc).
- `.int-nav-card` — thẻ điều hướng nội bộ, `shared.css` đã có sẵn hover chuẩn (box-shadow/border, không transform) cho selector này ở dòng ~866–891.

## Quy tắc lọc đơn
- Chỉ lấy đơn KiotViet có ngày đặt ≥ `LIFECYCLE_ORDER_FROM` (10/10/2026 giờ VN). **Phiếu tạm giữ mọi ngày.**
- Hằng số `LIFECYCLE_ORDER_FROM` trong `config.js`; đổi ngày tại đó, không hardcode.

## Nợ thiết kế riêng của trang
1. **`.lookup-message.error` hardcode màu đỏ** thay vì `var(--alert-error-bg)` — cùng lỗi lặp ở MASTER §12.2.
2. **`.status-found`/`.status-missing` là bản tự chế của `.badge`/`.badge-success`** (MASTER §5.3) với padding hơi khác (`4px 10px` thay vì `3px 10px`) — nên đổi sang dùng thẳng `.badge`/`.badge-success`/`.badge` (danger) thay vì giữ tên riêng.
3. **`.int-nav-card:hover` tự thêm `transform:translateY(-2px)` cục bộ** — xung đột với quy ước "card hover chỉ box-shadow/border-color, không transform" đã ghi rõ trong `shared.css` (dòng ~863). Nên bỏ dòng transform này để nhất quán với các trang khác dùng cùng class.
4. `.lookup-panel textarea` dùng `border-radius:12px` — không khớp bậc nào trong thang MASTER §4.4; nên đổi thành `var(--radius-sm)` khi áp dụng `.form-textarea` chuẩn.
