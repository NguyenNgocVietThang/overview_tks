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

## Cải tiến UI theo ảnh demo đã duyệt (26/10/2026)
- Thanh công cụ trắng, biểu tượng nét mảnh, các nhóm Chèn / Gộp ô / Tách ô / Viền bảng / menu thao tác khác. Chèn mở bốn lệnh thêm dòng/cột; menu khác chứa ba lệnh xóa. Chuột phải vẫn có đủ mười lệnh.
- Ô hiện tại có lớp phủ viền xanh bên ngoài nội dung soạn thảo, không đi vào HTML lưu. Gộp/tách bị vô hiệu hóa khi vùng chọn không phù hợp.
- Khoảng trống trên bảng dành cho toolbar, tăng đệm ô, tiêu đề cột xanh nhạt. Giữ các định dạng viền và dữ liệu tài liệu hiện có.
- Menu giới hạn trong viewport; phím mũi tên/Home/End di chuyển nút, Esc đóng menu trước và trả focus về nút mở menu.
- Trình tự thực hiện: cập nhật kiểm thử tương tác → triển khai toolbar/menu và lớp phủ → kiểm tra DOM/sanitizer → kiểm tra Edge desktop 1440px và mobile 390px với dữ liệu mẫu.
