# Bằng chứng xác minh Pancake Marketing

## 09/10/2026 — Kiểm tra ban đầu

- Workspace có thay đổi chưa commit của tính năng ngày đặc biệt và giao diện nhân sự. Không reset, ghi đè hoặc đưa chúng vào thay đổi Pancake.
- Đã đọc trực tiếp ba workbook bằng Google Sheets API readonly: Báo cáo TRỰC PAGE TOKOSI, Sao lưu SĐT Trực page, BÁO CÁO ADS CTY.
- Đã đối chiếu sáu Facebook Page ID qua Dashboard Pancake; danh sách nằm trong plan.md.
- Đã đọc Sao lưu → Tin nhắn từ hội thoại → Lịch sử trên Hữu Nghị. Có đợt thành công ngày 08/10/2026 lúc 10:38:27, 1.420 bản ghi. Chưa tải file hoặc tạo yêu cầu sao lưu mới.
- Đã kiểm tra lại Cài đặt → Công cụ của Hữu Nghị: Tạo Token khả dụng, Sao chép và Xoá token bị vô hiệu hóa; chưa có Public API token. Không bấm tạo, sao chép hoặc xóa token.
- Kiểm tra tên biến môi trường trong server/.env và môi trường tiến trình: không có tên chứa Pancake. Không in giá trị bí mật.
- Tài liệu chính thức xác nhận Public API và token: https://docs.pancake.biz/pancake/st-f12/st-p1?lang=en và https://docs.pancake.biz/pancake/st-f7/st-p6?lang=en . Trang API hiện chỉ cung cấp giới thiệu trong nội dung đọc được; chưa đủ để chốt schema/endpoint bằng tài liệu.

## Điều kiện để hoàn tất T1

1. Có Public API token phía máy chủ cho ít nhất Hữu Nghị để kiểm thử nguồn.
2. Xác minh API có trả thông tin tương đương bộ lọc sao lưu đã chốt: bản ghi khách gửi có SĐT, inbox/comment, nhân viên, thời gian, thứ tự và phân trang.
3. Đối chiếu API với file sao lưu thật trên cùng khoảng thời gian. Lưu chỉ số chênh lệch, không commit nội dung tin nhắn, số điện thoại hoặc token.
4. Chỉ khi đạt T1 mới tiến hành migration, importer, scheduler và chuyển nguồn.

Không khẳng định API thiếu dữ liệu; hiện chưa thể xác minh vì thiếu thông tin xác thực. Không coi phiên đăng nhập trình duyệt là cấu hình API dùng được trên máy chủ.

## 09/10/2026 — Cấu hình token và kiểm tra API có xác thực

- Người dùng cho phép tạo API token cả sáu page. Tạo mới cho Hữu Nghị, HN–SG và Dương Nội; Tân Thanh, Bắc Lãm và Phú Lương đã có token nên giữ nguyên.
- Đã lưu sáu biến PANCAKE_PAGE_TOKEN_<page_id> trong server/.env, được Git bỏ qua. Không ghi token vào tài liệu, mã nguồn, frontend hoặc kết quả công cụ.
- Đã kiểm tra phía filesystem đủ sáu token. [Ảnh xác nhận không chứa token](tokens-saved.jpg).
- Đã đọc đặc tả chính thức: https://developer.pancake.biz/openapi/openapi.yaml . GET danh sách hội thoại dùng public_api/v2, GET tin nhắn dùng public_api/v1; token truyền page_access_token. Không gọi API gửi tin nhắn, đổi nhân viên, đổi thẻ hoặc đánh dấu đã đọc.
- Cả sáu page đã đọc có xác thực thành công. Dương Nội trả HTTP 200 nhưng success=false khi không lọc; lọc riêng type=INBOX và type=COMMENT đều success=true. Phải kiểm tra success, không chỉ mã HTTP.
- Tìm thấy bản sao lưu thật có sẵn C:/Users/BOSS/Downloads/EXPORT_MESSAGE_1791535128795.xlsx, tab Bắc Lãm 430840296781378: 462 dòng, 435 hội thoại, từ 09/09/2026 đến 09/10/2026, gồm INBOX và COMMENT; 27 dòng thiếu nhân viên. Đọc nguyên trạng, không sửa file gốc.
- Sáu dòng mẫu khớp mã tin nhắn, số điện thoại, loại nguồn và thời gian. inserted_at API là UTC; Tạo lúc trong file là UTC+7. SĐT nằm trong phone_info[].phone_number của từng tin nhắn.
- Phân trang hội thoại Bắc Lãm: 19 lượt, 1.083 hội thoại, có đủ 435 hội thoại trong file; không trùng ID giữa các lượt. Đang đối soát toàn bộ 462 dòng và nhân viên.
- Dữ liệu thật/API nằm trong .codex_tmp được Git bỏ qua. Tài liệu chỉ ghi số lượng/chênh lệch và số dòng nguồn, không nội dung khách hàng hoặc SĐT.
- Người dùng xác nhận dữ liệu Marketing phải lưu trên DB PostgreSQL/Supabase.

### Kết quả đối soát toàn bộ — T1 đạt

| Trường kiểm tra | Khớp / tổng |
| --- | --- |
| Mã tin nhắn | 462 / 462 |
| SĐT từ phone_info[].phone_number | 462 / 462 |
| Tạo lúc, chuyển UTC sang Việt Nam | 462 / 462 |
| Nhân viên từ current_assign_users | 462 / 462 |
| Kiểu INBOX/COMMENT | 462 / 462 |
| Người gửi là khách, có số điện thoại | 462 / 462 |

- Đọc 435 hội thoại trong file; giữ cả 27 dòng không có nhân viên. Không có chênh lệch.
- Thứ tự file nguồn tăng dần theo Tạo lúc. Tin nhắn API trả mới trước; cần đảo/sắp thứ tự trước khi xác định bản ghi đầu/cuối.
- Phân trang hội thoại: 19 lượt, không lặp cursor/ID và không thiếu hội thoại nguồn.
- Kiểm tra riêng phân trang tin nhắn hội thoại dài: lượt đầu 30, lượt tiếp 5, không trùng ID; lượt sau cũ hơn lượt trước.
- 38 kiểm thử Marketing nền đều đạt: 30 service/parser/export/frontend đạt trong sandbox; 8 route cần chạy ngoài sandbox vì socket localhost bị EACCES, chạy lại đạt 8/8.
- Chưa chuyển nguồn giao diện hoặc chạy migration vào DB tại thời điểm kết luận T1.
## PostgreSQL — T2 đã áp dụng

- Review độc lập đạt spec/quality; commit `33f35795c1e84821916b4560f93dc8316bf10c9c`.
- Migration `0044_pancake_marketing.sql` áp trên Supabase ngày 09/10/2026; chỉ chạy riêng migration này, không thay dữ liệu KiotViet.
- Query xác nhận 10 bảng `marketing_*` và đúng 6 page với platform `facebook`.
- Implementer SQL suite 13/13, Marketing regression 41/41; review đọc diff và bằng chứng, không chạy lặp cùng suite.
- Chưa nhập lịch sử/chạy sync ở thời điểm xác nhận migration này.

