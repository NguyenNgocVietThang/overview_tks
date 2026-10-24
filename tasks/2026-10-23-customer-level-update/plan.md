# Kế hoạch: cập nhật level khách từ "DS khách (1).xlsx" + SĐT/địa chỉ + cột "Khách mới"

(Đặt trong thư mục con vì `tasks/plan.md` và `tasks/todo.md` cũ còn việc chưa tick.)

## Hiện trạng đã đọc
- File Excel: 5.207 dòng, 5 cột: Tên khách hàng | LEVEL (Vừa 4.100 · Mới 754 · Lớn 292 · VIP 61) | Khách mới (nhãn đợt: Cũ 2.535, T3/26…T10/26, T10/26-Page…, 147 trống) | Điện thoại | Địa chỉ (87 trống, 8 thiếu SĐT). Có 6 tên trùng.
- Level nội bộ: bảng `customer_price_levels` (khóa `nameKey(tên)`, level medium/large/vip/new – mig 0087/0088), `customerPriceLevelRepository.saveLevel` có version + history; `PUT /api/business-report/customer-price-level`, quyền sửa = `canEditPriceLevel`.
- Hồ sơ/“Chi tiết” khách: `customerProfileRepository` (mig 0080), hộp `cpOpenFrame('profile')` trong `server/public/index.html`.
- Working tree đang có sửa dở ở `customerPriceLevelRepository.js`, `priceAudit*`, `table-controls.js` (việc khác, không đụng).
- Migration 0087 và script khởi tạo `--apply` **chưa chạy DB thật** → import level chỉ chạy được sau khi khởi tạo.

## Quyết định thiết kế
1. **Level**: script `scripts/import-customer-levels-from-excel.js` (mặc định preview, `--apply` mới ghi). Map Vừa→medium, Mới→new, Lớn→large, VIP→vip; khớp theo `nameKey`. Ghi qua đường `saveLevel` (tăng version + history, actor "Import DS khách"). Tên trùng khác level/nhãn: giữ lại không ghi (liệt kê để chốt); trùng giống nhau: gộp, in danh sách xung đột. Tên không khớp khách trong DB: chỉ báo cáo, không tạo. Hóa đơn đã chụp giữ nguyên.
2. **Khách mới**: thêm cột `new_customer text` vào `customer_price_levels` (mig 0089) – dùng chung version, quyền sửa, 409 và history với level; `PUT customer-price-level` nhận thêm `newCustomer` (tùy chọn). Giá trị mặc định = cột "Khách mới" của Excel, nạp bởi cùng script import.
3. **SĐT + địa chỉ**: thêm `phone`, `address` vào hồ sơ khách (mig 0089). Hiển thị ở “thông tin chung” (hộp Chi tiết) và nạp mặc định từ Excel; ưu tiên giá trị đã nhập tay, fallback dữ liệu KiotViet (`customers.raw`) nếu trống.
4. UI: cột "Khách mới" trong bảng tổng quan, ô chọn/nhập chỉ hiện cho người có `canEditPriceLevel`, người khác chỉ xem; giữ sáng/tối, mobile, `table-controls.js`.

## Task
Xem [todo.md](todo.md).

## Rủi ro
| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Ghi đè level người đã chỉnh tay | Cao | preview trước, báo số dòng đổi, chỉ ghi khi level khác, có history |
| Tên Excel lệch tên trong DB (dấu, khoảng trắng, HN/SG) | Trung bình | khớp bằng `nameKey`, báo cáo danh sách không khớp |
| Chạy trước khi khởi tạo 0087 | Cao | script từ chối nếu `initialized_at` rỗng |
| Chưa migrate 0089 trên DB thật | Trung bình | 503 MIGRATION_PENDING như pattern hiện có |

## Câu hỏi cần bạn chốt
1. "Khách mới" là **nhãn đợt tự do** (T10/26, Cũ, T10/26-Page…) như trong file, hay danh sách chọn cố định? (Mặc định kế hoạch: ô chọn gợi ý từ giá trị có sẵn + cho gõ mới.)
2. SĐT/địa chỉ **được sửa tay** trong Chi tiết hay chỉ xem (nạp từ file/KiotViet)?
3. Có chạy `--apply` trên DB thật trong phiên này không (cần khởi tạo 0087 + migrate trước), hay chỉ làm code + preview?
