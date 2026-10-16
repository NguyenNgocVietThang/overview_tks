# Marketing tính độc lập từ Pancake

Ngày kiểm tra: 16/10/2026, Asia/Ho_Chi_Minh.
Trạng thái: đã kiểm tra nguồn thật; đề xuất thiết kế, chưa sửa runtime hoặc bật nguồn mới. Cần xác nhận chính sách ngày trước khi lập kế hoạch triển khai.

## Mục tiêu

Tự động tính những chỉ số có đủ dữ liệu Pancake mà không đọc kết quả CHUẨN, CHECK hoặc bảng xếp hạng Sheets. Không dùng việc khớp số Sheets làm điều kiện công bố kết quả Pancake mới. Chi phí ADS và dữ liệu bán hàng có nguồn riêng phải được thể hiện đúng nguồn.

## Bằng chứng kiểm tra

Đã dùng Google Sheets API readonly đọc mẫu công thức trực tiếp của cả sáu tab CHUẨN và sáu tab THÔ, CHECK Tỷ lệ nhận số T10, BẢNG XẾP HẠNG, BC Tháng 10 và Tên. Chỉ in công thức và kiểu ô; không đưa SĐT, tên khách hoặc token vào tài liệu.

| Công thức thực tế | Quy tắc tương ứng |
| --- | --- |
| UNIQUE(cột T của THÔ) | Một nhóm theo giá trị SĐT trong từng page |
| XLOOKUP SĐT, cột S, tìm từ đầu/cuối | Nhân viên lần đầu/hiện tại theo thứ tự dòng nguồn |
| IF(nhân viên đầu = cuối, rỗng, nhân viên cuối) | Chào lại dựa trên khác tên nhân viên nguồn |
| XLOOKUP SĐT, cột U, tìm từ đầu/cuối | Ngày lần đầu/hiện tại là ngày ghi nhận trong THÔ |
| IF(ngày đầu = cuối, rỗng, ngày cuối) | Ngày chào lại chỉ hiện nếu hai ngày khác nhau |
| COUNTIFS theo nhân viên và khoảng ngày | Lần đầu/chào lại theo tháng |
| lần đầu + chào lại / 5 | Quy đổi |
| VLOOKUP bảng Tên | Ánh xạ tên nguồn sang nhân viên báo cáo sau khi xác định người đầu/cuối |
| COUNTIFS BC tháng theo sale và page | Khách chốt đếm dòng nhập BC tháng, không suy từ tin nhắn |
| khách chốt / SUMIFS(quy đổi theo page, nhân viên) | Tỷ lệ chốt; mẫu số 0 để trống |

Trong các ô mẫu THÔ, cột U là giá trị nhập sẵn, không có công thức. Đây là ngày ghi nhận báo cáo, khác trường Tạo lúc.

BC tháng có các trường nhập tay. Doanh số và Khách mới có công thức tra DS Khách trong mẫu đọc được. Doanh số runtime đã được thay bằng KiotViet. Không thể khẳng định các trường này được Pancake cung cấp chỉ vì chúng xuất hiện trên Sheets.

## Hiện trạng mã và cấu hình

- Local đang MARKETING_REPORT_SOURCE=sheets và PANCAKE_MARKETING_SYNC_ENABLED=false; đủ sáu token được cấu hình. Chưa kiểm tra cấu hình Render trong phiên này.
- aggregatePhones đã mô phỏng quy tắc đầu/cuối và countPhoneKpis đã tính quy đổi trong backend.
- readSnapshot hiện trộn marketing_history_rows với marketing_pancake_observations. Đây chưa phải tập dữ liệu chỉ từ Pancake.
- preparePageRows hiện loại tin trong marketing_baseline_messages và chặn tin chưa liên kết trong khoảng lịch sử; các quyết định này phụ thuộc nền Sheets cũ.
- metadata của chế độ DB vẫn gọi legacy.metadata(), đọc danh sách cả ba workbook. Cần tách ADS khỏi metadata chung để báo cáo Pancake không phụ thuộc kết nối Sheets.
- DB đọc thật: 18.305 dòng lịch sử Sheets, 4.451 quan sát Pancake, 12.379 fact, 18.307 liên kết lịch sử, 3.148 tin bị loại theo nền Sheets, 459 dòng BC tháng và 37 ánh xạ nhân viên. Đây là snapshot tại lúc kiểm tra, không phải số liệu cố định.
- Cả sáu page có lastSuccessAt ngày 16/10 giờ Việt Nam. Job local vẫn tắt; không dùng trạng thái DB để kết luận scheduler hiện đang bật ở mọi môi trường.

## Phạm vi có thể tự động hóa

1. SĐT/page, nhân viên đang phụ trách, lần đầu, chào lại và quy đổi: có thể tính backend từ dữ liệu Pancake và nhật ký quan sát do hệ thống tự lưu.
2. Khách chốt/tỷ lệ chốt: cần sự kiện chốt đáng tin cậy hoặc BC tháng được lưu trong DB. Client hiện chỉ lấy tin nhắn, SĐT, loại tin, thời gian và current_assign_users, chưa có quy tắc suy ra khách chốt. Không mặc định có SĐT là đã chốt. Nếu chưa có nguồn khách chốt, hiển thị chưa có dữ liệu cho khách chốt/tỷ lệ thay vì 0.
3. BC tháng: có thể bỏ đọc Sheets bằng chức năng nhập/sửa DB đã có; các trường nhập tay vẫn cần nhập trên web. Doanh số tiếp tục KiotViet. Đây là độc lập Sheets khi vận hành, nhưng không phải chỉ Pancake.
4. ADS, VAT, phí thuê: giữ nguồn ADS Sheets; không suy chi phí từ số tin nhắn.

## Ba phương án thời gian và lịch sử

### A — Giữ lịch sử đã nhập, độc lập cho dữ liệu mới (đề xuất)

Giữ nguyên ngày ghi nhận và người đầu/cuối lịch sử đã lưu DB; từ mốc chuyển đổi, lấy tin và quan sát mới trực tiếp từ Pancake, tự ghi ngày đồng bộ thành công theo giờ Việt Nam. Không cần mở, dán dữ liệu hoặc đọc kết quả Sheets để tính. Giữ baseline cũ chỉ cho phần lịch sử, không để baseline loại tin mới. Phân biệt rõ lịch sử đã nhập và nguồn Pancake tự thu thập.

Ưu điểm: phù hợp chính sách ngày đã ghi trong kế hoạch 09/10, hạn chế chuyển chỉ số giữa các tháng. Giới hạn: báo cáo lịch sử vẫn có nguồn gốc dữ liệu Sheets đã nhập một lần, không đáp ứng cách hiểu mọi thời kỳ đều chỉ dùng Pancake.

### B — Tập báo cáo chỉ dùng Pancake, lấy ngày tạo tin nhắn

Nạp lại tập tin từ Pancake theo phạm vi thời gian được khai báo, không lọc bằng baseline Sheets hoặc chờ đối soát CHUẨN. Lần đầu dùng ngày tạo tin đầu tiên. Gắn nhãn người phụ trách lấy từ snapshot hiện tại; không khẳng định đây là người phụ trách lịch sử. Chỉ ghi nhận đổi người đã quan sát kể từ lúc theo dõi; dùng ngày quan sát thay đổi cho chào lại. Lưu tập nguồn mới riêng, không ghi đè lịch sử cũ.

Ưu điểm: độc lập nguồn Sheets. Giới hạn: ngày và số tháng sẽ khác báo cáo cũ; không thể tái dựng chính xác ngày đổi người trước lúc theo dõi bằng current_assign_users. Không hứa khớp lịch sử Sheets. Phạm vi nạp dữ liệu phải có trạng thái hoàn tất trước khi báo cáo được coi là đầy đủ.

### C — Chỉ bật công tắc PostgreSQL hiện có

Thay đổi ít nhưng không đáp ứng yêu cầu nguồn Pancake độc lập: báo cáo vẫn trộn lịch sử và loại 3.148 tin theo nền Sheets. Không đề xuất chọn cách này như một giải pháp hoàn chỉnh.

## Thiết kế triển khai sau khi chốt A hoặc B

- Tách nguồn theo phần báo cáo, bỏ phụ thuộc ba workbook chung cho metadata Pancake. ADS lỗi không chặn SĐT/KPI.
- Đồng bộ backend theo lịch 23:55 Việt Nam đã có; khóa chống chạy trùng, lưu trạng thái sáu page, không đổi ngày khi chạy lại cùng dữ liệu. Lỗi giữ snapshot thành công gần nhất và hiện ngày cập nhật/lỗi nguồn.
- Lưu mã page/conversation/message, SĐT, nhân viên nguồn, thời gian tạo, thời gian quan sát và nguồn gốc để truy vết. Không tự chuẩn hóa/gộp số làm thay đổi nhóm trước khi có quy tắc rõ ràng.
- Ánh xạ nhân viên lưu DB, quản lý trên web. Không cần đọc lại bảng Tên Sheets; tên chưa ánh xạ vẫn hiển thị.
- Tính lần đầu/chào lại/quy đổi trên backend. Tên đầu/cuối và ngày đầu/cuối phải được chọn theo chính sách nguồn đã chốt; ánh xạ sau bước chọn. Mỗi page có nhóm SĐT riêng.
- Chốt/tỷ lệ dùng BC tháng DB nếu được chọn, đồng thời công bố nguồn; chưa có dữ liệu thì hiển thị —. Tổng tỷ lệ tính lại từ tổng khách chốt / tổng quy đổi.
- Lịch sử đã nhập giữ nguyên để kiểm toán. Không xóa hoặc đổi số cũ chỉ bằng thao tác bật công tắc nguồn mới.
- Kiểm thử cùng SĐT ở hai page; cùng người/khác người; khác người cùng ngày; nhiều tên về một người; thiếu tên/ngày; đổi người A→B→A; chạy lại; qua nửa đêm/tháng; tin không có trong baseline; lỗi ADS; thiếu khách chốt; tổng khớp dòng chi tiết; xuất file dùng cùng bộ tính.

## Quyết định cần xác nhận

Chọn A để giữ ngày ghi nhận lịch sử và tự động hóa từ mốc chuyển đổi, hoặc B để có tập nguồn chỉ Pancake và chấp nhận tính lại theo ngày tạo tin cùng giới hạn lịch sử nhân viên. Đây là quyết định thay đổi ý nghĩa số liệu theo tháng, không chỉ là cấu hình kỹ thuật.

Chưa thay đổi mã chạy, biến môi trường, lịch đồng bộ hoặc dữ liệu DB trong phiên kiểm tra này.
