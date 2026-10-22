# CONT TKS1 và cột Nguồn — thiết kế

Ngày: 21/10/2026. Phạm vi nghiệp vụ đã được người dùng duyệt trong chat. Tài liệu phục vụ triển khai, chưa xác nhận thay đổi đã chạy trên production.

## Mục tiêu và phạm vi

Bổ sung sheet `CONT TKS1` trong workbook `1T233BdyYBxgSUhR2CwVn2CChgK6Z8OmY8f_s4LalmbE` vào cùng luồng đồng bộ với YIWU, VK-DUNG, HÀ BẮC, SD, GDONG, KHÁC. Dữ liệu tham gia bảng Dự kiến hàng về, số Chưa bốc/Đã bốc và chi tiết CONT theo quy tắc hiện tại. Thêm cột **Nguồn** đầu bảng Dự kiến hàng về, lấy nguyên tên sheet.

Tên sản phẩm vẫn tra từ `product_report` theo mã; mã không có trong báo cáo vẫn để tên trống. Không đổi dữ liệu Google Sheets, bộ lọc, quyền, lịch đồng bộ hoặc cách gộp số liệu.

## Khảo sát nguồn và các lựa chọn

Đã đọc trực tiếp CONT TKS1 qua tab trình duyệt ngày 21/10/2026; kết nối Drive trả 403. Bản đọc có dòng CONT tại 2, 15, 22, 66, lần lượt trạng thái 1, 2, 3, 4; END tại 728. Đây là bằng chứng khảo sát, không phải các số dòng cố định để lập trình.

Các cột được yêu cầu khớp parser: A mã SP; B/C trên dòng CONT là trạng thái/ngày dự kiến; E màu; F ghi chú sale; H người đặt; M số cái/kiện; N số kiện; O tổng số lượng; P giá tệ; X giá về VN. Sheet mới có dữ liệu ngay dưới CONT, không bắt buộc có dòng tiêu đề lặp. Tổng lượng luôn lấy O, không tính lại M × N. Nhiều khối có cùng tên `CONT TKS1`, phải phân biệt theo dòng bắt đầu khối.

Ba cách đã cân nhắc: (1) mở rộng luồng chung, ít thay đổi và đáp ứng yêu cầu đã duyệt; (2) đồng bộ riêng chỉ cho bảng dự kiến, không phù hợp lựa chọn dùng chung của người dùng; (3) tạo module nhập và bảng DB riêng, dư thừa khi cấu trúc cần đọc đã khớp. Chọn (1).

## Thiết kế

- Nối `CONT TKS1` sau `KHÁC` trong `SHEET_NAMES`; giữ thứ tự sáu nguồn cũ. Dùng parser và job hiện có, không tạo job hoặc bảng mới.
- Giữ khóa `(sheet_name, source_row)` và nhóm chi tiết theo sheet/dòng CONT. Hai mã giống nhau hoặc tên CONT giống nhau không làm mất dòng. Giữ xử lý CONT/END, kiểm tra số, cảnh báo, chốt giảm số dòng và ghi khác biệt hiện có.
- Giữ đồng bộ nguyên khối: thiếu/không đọc được bất kỳ sheet bắt buộc nào thì giữ bản thành công gần nhất. Thông báo lỗi dùng số lượng từ `SHEET_NAMES.length`, tránh ghi cứng 6.
- API `/api/expected-arrivals` tiếp tục trả `sheetName` sẵn có; không thêm trường hoặc endpoint. Không migration, không thư viện mới.
- Giao diện thêm `<th>` đầu tiên nhãn Nguồn, `data-column-key="nguon"`, rộng 120px; ô dữ liệu dùng `expectedArrivalsTextCell(r.sheetName)` để giữ escape HTML. Giữ khóa lưu cấu hình bảng và khóa các cột cũ; cột mới mặc định hiện, hỗ trợ ẩn/hiện, đổi độ rộng và sắp xếp như các cột khác. Đổi colspan của các trạng thái tải/rỗng/lỗi từ 10 thành 11, gồm cấu hình phân trang liên quan.
- Xuất Excel/HTML bổ sung `sheetName`/Nguồn ở đầu danh sách trường và mặc định chọn, dùng dữ liệu API hiện có. Các yêu cầu xuất chọn cột cũ vẫn hợp lệ. Không mở rộng tìm kiếm theo nguồn hoặc thêm bộ lọc nguồn.
- Các trường khác ngoài yêu cầu giữ mapping hiện có. Đặc biệt L của CONT TKS1 có tiêu đề Link, khác ý nghĩa `listedAt` của parser cũ; không tự thêm hiển thị Link hoặc đổi hợp đồng ngày lên list trong thay đổi này.

## Nghiệm thu

- Fixture bảy sheet chứng minh CONT TKS1 được đọc cả giá trị raw/formatted; lỗi hoặc thiếu sheet mới không ghi đè snapshot cũ.
- Parser giữ sản phẩm đầu tiên ngay sau CONT, mã trùng, khối cùng tên khác trạng thái, số kiện thập phân, số lượng O, và bỏ mọi dòng sau END.
- Repository/refresh giữ nguồn, thứ tự, số tổng trạng thái 1+2/3 và chi tiết theo từng khối; trạng thái 4 vẫn xuất hiện trong bảng dự kiến nhưng không cộng vào Chưa bốc/Đã bốc. Tên vẫn tra báo cáo.
- Bảng có 11 cột, Nguồn đầu tiên; kiểm tra dòng rỗng/lỗi, cấu hình cột cũ, sắp xếp, phân trang, hai chế độ tìm kiếm và các quyền hiện có.
- Đọc lại Excel/HTML xác nhận cột Nguồn đầu tiên, đúng tên sheet, xuất chọn cột tương thích.
- Chạy kiểm thử liên quan rồi `npm test` toàn bộ. Kiểm tra trình duyệt desktop/mobile, sáng/tối bằng fixture, không chạy job ghi DB production để kiểm thử.

## Triển khai

Sau khi triển khai code bằng quy trình vận hành hiện có, job đến hạn tiếp theo đọc bảy sheet trong khoảng chu kỳ mặc định 10 phút. Kiểm tra log số dòng từng sheet, metadata đồng bộ và bảng. Không cần thay quyền service account nếu nó đã có Viewer trên cùng workbook. Khôi phục code cũ sẽ khiến lần đồng bộ hợp lệ tiếp theo loại nguồn mới khỏi snapshot; không xóa hoặc sửa workbook.
