# Thiết kế nguồn dữ liệu API KiotViet cho tính đứt hàng

## Mục tiêu

Ba tính năng tính đứt hàng dùng cùng một cơ chế lấy biến động kho, ưu tiên API KiotViet theo từng nguồn. Hóa đơn và Nhập hàng dùng Google Sheets khi chính API của nguồn đó lỗi. Khách trả hàng không thể fallback vì Sheet thiếu chi tiết theo mã hàng. Không trộn dữ liệu API và Sheet trong cùng một nguồn, qua đó tránh cộng trùng giao dịch.

Ba tính năng áp dụng:

- Kiểm tra đứt hàng bằng danh sách mã hoặc file upload.
- Hàng đứt gần đây.
- Kiểm tra đứt hàng 30 ngày.

## Nguồn dữ liệu

| Dữ liệu | Nguồn chính | Nguồn dự phòng |
| --- | --- | --- |
| Hàng hóa và tồn hiện tại | Google Sheets | Không đổi |
| Hóa đơn và chi tiết hóa đơn | API `GET /invoices` | Sheet `Hóa đơn` + `Chi tiết hóa đơn` |
| Nhập hàng | API `GET /purchaseorders` | Sheet `Nhập hàng` |
| Khách trả hàng | API `GET /returns` | Không có nguồn dự phòng đủ dữ liệu; API lỗi thì job thất bại |
| Trả nhà cung cấp | Sheet `Trả NCC` | Không có API Public KiotViet nên luôn dùng Sheet |

API trả thành công với danh sách rỗng được coi là kết quả hợp lệ và không kích hoạt fallback.

## Kiến trúc

Tạo một bộ tải biến động dùng chung trong module stockout. Bộ tải nhận `client`, `sheetsClient`, tập mã hợp lệ, khoảng ngày tính toán và callback tiến độ. Nó trả về:

- `eventMapByCode`: biến động đã chuẩn hóa theo mã và ngày Việt Nam.
- `sources`: trạng thái thực tế của từng nguồn (`kiotviet-api`, `google-sheets-fallback`, hoặc `google-sheets`).
- `warnings`: lỗi API đã được xử lý bằng fallback, để giao diện và log có thể giải thích nguồn dữ liệu.

Mỗi nguồn API được tải vào một `Map` tạm. Chỉ sau khi tải và kiểm tra toàn bộ các trang thành công mới gộp `Map` tạm vào kết quả chung. Nếu bất kỳ trang nào lỗi, dữ liệu API tạm bị loại bỏ hoàn toàn và chỉ dữ liệu Sheet của nguồn tương ứng được dùng. Nhờ vậy lỗi ở giữa phân trang không tạo dữ liệu nửa API, nửa Sheet.

Ba service chỉ chịu trách nhiệm chọn sản phẩm, gọi bộ tải chung và đưa timeline vào bộ phân tích đứt hàng hiện tại. Logic nguồn dữ liệu không được sao chép giữa ba service.

## Quy tắc chuẩn hóa API

- Hóa đơn: chỉ `status = 1`; lấy `purchaseDate`, `invoiceDetails[].productCode` và `quantity`; biến động âm.
- Nhập hàng: chỉ phiếu xác định đã hoàn thành (`isDraft = false`); lấy `purchaseDate`, `purchaseOrderDetails[].productCode` và `quantity`; biến động dương.
- Khách trả: chỉ `status = 1`; lấy `returnDate`, `returnDetails[].productCode` và `quantity`; biến động dương.
- Mã hàng được trim đầu/cuối và khớp chính xác, phân biệt chữ hoa/thường.
- Chỉ giữ sự kiện thuộc cửa sổ tính toán, bao gồm 4 ngày đệm trước kỳ báo cáo.
- Nếu phản hồi thành công nhưng cấu trúc bắt buộc bị thiếu, nguồn API được coi là lỗi dữ liệu. Hóa đơn và Nhập hàng chuyển sang Sheet; Khách trả hàng làm job thất bại. Không âm thầm bỏ chi tiết.

Trả NCC tiếp tục áp dụng quy tắc Sheet hiện tại: chỉ dòng có trạng thái hoàn thành, mã khớp chính xác và số lượng hợp lệ; biến động âm.

## Fallback và xử lý lỗi

Fallback hoạt động độc lập theo nguồn:

- API Hóa đơn lỗi: chỉ Hóa đơn chuyển sang hai Sheet hóa đơn; Nhập hàng và Khách trả vẫn dùng API.
- API Nhập hàng lỗi: chỉ Nhập hàng chuyển sang Sheet.
- API Khách trả lỗi: toàn bộ job thất bại với thông báo rõ ràng vì Sheet `Trả hàng` không có mã hàng và số lượng chi tiết; không trả kết quả thiếu biến động.
- Trả NCC luôn đọc Sheet và không ảnh hưởng quyết định fallback của ba nguồn còn lại.

Các lỗi kích hoạt fallback gồm timeout, lỗi mạng, HTTP không thành công, hết retry, thiếu quyền và phản hồi sai cấu trúc. Kết quả rỗng hợp lệ không kích hoạt fallback.

Nếu cả API và nguồn Sheet dự phòng của một nguồn đều lỗi, job thất bại. Không trả báo cáo có vẻ thành công nhưng thiếu nguồn giao dịch.

## Tiến độ và kết quả API nội bộ

Tiến độ job chia theo nguồn thay vì mô tả chung “đang tải dữ liệu”. Giao diện có thể hiển thị nguồn đang tải và cảnh báo khi đã fallback.

Kết quả của cả ba tính năng giữ nguyên các trường hiện tại và bổ sung:

```json
{
  "sources": {
    "invoices": "kiotviet-api",
    "purchases": "google-sheets-fallback",
    "customerReturns": "kiotviet-api",
    "supplierReturns": "google-sheets"
  },
  "warnings": [
    "API Nhập hàng lỗi; kết quả đã dùng Google Sheets dự phòng."
  ]
}
```

Thông tin này cũng được ghi log phía server để truy vết sai lệch dữ liệu.

## Hiệu năng và giới hạn

- Truy vấn API theo khoảng ngày hẹp nhất mà từng báo cáo cần, cộng 4 ngày đệm.
- Dùng phân trang tối đa 100 bản ghi theo client hiện tại.
- Không gọi Sheet giao dịch dự phòng trước khi API lỗi, ngoại trừ `Hàng hóa` và `Trả NCC` vốn luôn cần đọc.
- Tải tuần tự từng nguồn API; mỗi nguồn vẫn phân trang qua client hiện tại để kiểm soát số request và hiển thị tiến độ rõ ràng.

## Kiểm thử

- Cả ba API thành công; Sheet giao dịch dự phòng không được gọi.
- API thành công và rỗng; không fallback.
- API Hóa đơn hoặc Nhập hàng lỗi riêng lẻ; chỉ nguồn đó fallback, các nguồn khác vẫn dùng API.
- API lỗi ở giữa phân trang; bỏ toàn bộ dữ liệu tạm trước khi dùng Sheet, không cộng trùng.
- API trả thiếu mảng chi tiết; fallback thay vì coi số lượng bằng 0.
- API Hóa đơn hoặc Nhập hàng và Sheet dự phòng tương ứng cùng lỗi; job chuyển trạng thái lỗi.
- API Khách trả hàng lỗi; job chuyển trạng thái lỗi và không dùng Sheet tổng hợp `Trả hàng`.
- Trả NCC luôn lấy Sheet.
- Đúng dấu biến động, trạng thái chứng từ, ngày Việt Nam và khớp mã chính xác.
- Ba tính năng cho kết quả giống nhau khi cùng mã và cùng kỳ.
- Metadata `sources` và `warnings` phản ánh đúng nguồn thực tế.
- Chạy nhóm test stockout, export/frontend liên quan và toàn bộ `npm test` trong `server`.

## Ngoài phạm vi

- Không thay đổi công thức xác định đợt đứt hàng đã chuẩn hóa.
- Không thay đổi schema PostgreSQL hoặc cấu trúc các Sheet.
- Không suy diễn Trả NCC từ Nhập hàng hay công nợ nhà cung cấp.
- Không trộn hoặc khử trùng API với Sheet khi API đã trả thành công.
