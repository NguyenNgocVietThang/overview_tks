# Sửa bảng trong trình soạn tài liệu quy định (2026-10-26)

Phạm vi: modal soạn tài liệu `#ruleTextModal` ở `server/public/humanresources/index.html` và bộ lọc `server/hr/hrRuleDocumentSanitizer.js`.

## Hiện trạng
Chỉ có nút "Chèn bảng" (hỏi số dòng/cột bằng `prompt`). Sau khi chèn không thể thêm/xóa/chỉnh dòng cột. Sanitizer đã cho `table/thead/tbody/tr/th/td`, `colspan`, `rowspan`.

## Giao diện
- Con trỏ nằm trong ô bảng ở tab Soạn: hiện thanh nổi `#rteTableBar` phía trên bảng. Chuột phải vào ô mở menu `#rteTableMenu` cùng thao tác.
- Thao tác: thêm dòng trên/dưới, thêm cột trái/phải, xóa dòng, xóa cột, gộp ô (theo vùng bôi chọn hình chữ nhật), tách ô, viền (kiểu, độ dày, màu), xóa bảng.
- Kéo mép phải ô để đổi độ rộng cột (tối thiểu 40px).
- Mọi thao tác gọi `markRuleTextDirty()`; Sáng/Tối, responsive; không hiện ở tab Xem trước.
- Xóa dòng/cột cuối cùng hoặc xóa bảng: hỏi xác nhận.

## Hợp đồng dữ liệu (HTML lưu trong DB)
| Phần tử | Thuộc tính | Giá trị hợp lệ |
|---|---|---|
| `table` | `data-border` | `all` \| `outer` \| `none` |
| `table` | `data-border-width` | `1` \| `2` \| `3` |
| `table` | `style` | chỉ `--tb-color: #rrggbb` (hex 3 hoặc 6 ký tự) |
| `td`, `th` | `width` | số nguyên 40–800 (px) |
| `td`, `th` | `colspan`, `rowspan` | như cũ |

Mọi giá trị khác bị loại bỏ. Không có thuộc tính nào → bảng hiển thị mặc định như cũ (lưới đầy đủ 1px `#d8d5cb`).

## CSS
Giữ nguyên các dòng `border:1px solid #d8d5cb !important` hiện có (test đang assert). Thêm quy tắc đè theo `table[data-border=…]` và biến `--tb-w`, `--tb-color` cho `.rte-editor`, `.doc-page .doc-section` (xem trước + trang đọc). Ở trình soạn, bảng `none` có đường kẻ nét đứt mờ để còn thấy ô.

## Kiểm thử
- Sanitizer: giữ giá trị hợp lệ, loại giá trị lạ/độc hại.
- Frontend: từng thao tác trên DOM (có ô gộp), viền, độ rộng, các nút có mặt, các assert CSS cũ vẫn xanh.
- Cập nhật CURRENT.md, SRS/README liên quan.
