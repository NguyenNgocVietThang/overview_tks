# Page Design Notes — `vat-draft/index.html` (Kế toán – Nháp VAT / Tạo QR)

> Kế thừa toàn bộ `MASTER.md`. Thiết kế lại tab **Tạo QR** ngày 2026-10-19 theo hướng *workspace kế toán*: ưu tiên đọc nhanh, ít click, chống sai sót tiền. Tab Xử lý hóa đơn chỉ đổi phần khung chung (thanh tiêu đề, cỡ chữ).

## Vai trò trang
`/vat-draft/` — 2 tab: **Xử lý hóa đơn** (`accounting.vatDraft`) và **Tạo QR** (`accounting.vatDraft` hoặc `accounting.qr`, mặc định có cả Nhân viên sale). Tài khoản chỉ có `accounting.qr` chỉ thấy Tạo QR (ẩn tab + trạng thái dữ liệu).

## Khung chung
- `.vd-titlebar`: tên trang + tab dạng nút viên (`.vd-tabs`, mục đang mở nền `--primary`) + **ô trạng thái dữ liệu** `details#vdSourceBar.vd-status` (chấm màu theo `data-tone` ok/warning/error, bấm mở popover Google Sheets + KiotViet + nút Cập nhật; đóng khi bấm ra ngoài / Esc). Ô trạng thái **ẩn ở tab Tạo QR** vì Sheets/KiotViet chỉ phục vụ Xử lý hóa đơn.
- Chữ: nhãn 13px, gợi ý 13px, ô nhập 14px (tab Tạo QR 15px, cao 44px). Không emoji làm icon trong tab Tạo QR và thanh tiêu đề — dùng SVG nét 2px.

## Tab Tạo QR — bố cục
```
┌ Đọc từ hóa đơn [Tùy chọn]        Ctrl+V ┐ ┌ Mã QR            [badge trạng thái] ┐  sticky
│ vùng dán 1 hàng / thẻ ảnh (xem, xóa)    │ │ vùng QR: hướng dẫn 3 bước | đang đọc │
│ Kết quả AI: lưới 3 ô + callout cảnh báo │ │  | QR | QR mờ + "đã thay đổi" | lỗi  │
├ Thông tin chuyển khoản                  ┤ │ Tóm tắt: Người nhận · Tài khoản ·   │
│ Tài khoản (nhóm Gợi ý/Công ty/Cá nhân/  │ │  Số tiền (22px + bằng chữ) · Nội dung│
│  Khác) + dòng chi tiết chủ TK · NH · STK │ │ [ Tạo mã QR        Enter ] (CTA duy │
│ Số tiền 24px tabular + "đ" + bằng chữ   │ │  nhất) | Tải · Sao chép · Phóng to · │
│ (Xác nhận số tiền khi AI chưa chắc)     │ │  Tạo QR mới                          │
│ Nội dung chuyển khoản (không bắt buộc)  │ └──────────────────────────────────────┘
└─────────────────────────────────────────┘
```
- Lưới `minmax(0,1fr) 380px`, tối đa 1160px; ≤1100px cột phải 340px; ≤900px 1 cột, **nút chính thành thanh cố định đáy màn hình**, tạo xong tự cuộn tới QR.
- Bảng QR `aside#vdQrPanel` có `data-state`: `empty` · `reading` · `confirm` · `ready` · `busy` · `success` · `stale` · `error`. Badge đổi màu theo trạng thái (xanh dương đang xử lý, xanh lá đã tạo, amber chờ xác nhận/đã đổi, đỏ lỗi) và luôn có chữ (không chỉ dựa màu).
- **Chống sai sót**: QR gắn với "khóa" (tài khoản + số tiền + nội dung). Sửa bất kỳ trường nào sau khi tạo → `stale`: QR xám mờ + lớp phủ "Thông tin đã thay đổi", ẩn nút Tải/Sao chép, nút chính thành "Tạo lại mã QR". Mặc định **chưa chọn tài khoản** (không còn mặc định "nhập tay"); lỗi nhập tay chỉ hiện sau khi rời ô / bấm tạo. Số tiền luôn kèm dòng **bằng chữ** (`vnd-words.js`) để đối chiếu với dòng "Số tiền viết bằng chữ" trên hóa đơn.
- **Bàn phím**: Ctrl+V ở bất kỳ đâu trên tab = đọc hóa đơn; Enter trong ô nhập = tạo QR; Enter ở lựa chọn Xác nhận số tiền = xác nhận; Esc đóng hộp xem ảnh / QR / ô trạng thái. Tạo xong focus vào "Tải mã QR". Dán lại chính ảnh QR vừa sao chép bị bỏ qua (so kích thước ảnh).
- Trường do AI điền có chip "Từ hóa đơn" / "Gợi ý từ hóa đơn"; sửa tay thì chip biến mất.
