# Tiến độ triển khai — tasks/2026-10-09-pancake-marketing/plan.md

## Không chạy lại công việc đã hoàn tất

- T1 hoàn tất: sáu token hợp lệ; 462/462 dòng sao lưu Bắc Lãm khớp toàn bộ trường cần thiết; phân trang hội thoại/tin nhắn đạt. Xem verification.md.
- Token nằm trong server/.env bị Git bỏ qua. Tạo Hữu Nghị, HN–SG, Dương Nội; giữ token có sẵn của Tân Thanh, Bắc Lãm, Phú Lương. Không tạo lại token.
- Nhánh: codex/pancake-marketing, worktree được Codex quản lý tại C:/Users/BOSS/.codex/worktrees/pancake-marketing/Web TKS Dashboard. Checkout chính có thay đổi không thuộc nhiệm vụ, không ghi đè.
- Sandbox không cho đọc/ghi worktree trên C:; dùng exec_command require_escalated với đường dẫn này cho các thao tác cần thiết. Không cố dùng đường dẫn tương đối khi sandbox đã rơi về cwd checkout chính.
- server/node_modules của worktree là junction tới thư viện đã cài của checkout chính. server/.env được sao chép cục bộ và Git bỏ qua.
- Bộ kiểm thử nền Marketing 38/38 đạt (route cần socket localhost ngoài sandbox).
- Dữ liệu Marketing phải lưu DB PostgreSQL/Supabase theo xác nhận mới nhất của người dùng.
- Người dùng xác nhận thêm: doanh số từng khách vẫn giữ cách lấy KiotViet hiện tại (ghép tên khách, bán trừ trả hàng), không đổi sang nguồn Pancake/Sheets.

## Đang thực hiện

- T2: thiết kế/schema/repository và kiểm thử DB; chưa chạy migration vào DB thật.
- Implementer T2: /root/marketing_storage, brief/report dưới .superpowers/sdd/2026-10-09-pancake-marketing/.
- Commit gốc worktree trước T2: d428e37e5cd9db01712f54fce78aa3902b219cc0.
- Đã kiểm tra Supabase chỉ đọc: chưa có bảng marketing_*, migration gần nhất đã áp dụng 0043_special_day_notice_log.sql. T2 sử dụng 0044.
- **Đang chờ lựa chọn SĐT từ người dùng qua câu hỏi async**: normalize/gộp số 0 đầu (HN 4780→3774; BL3132→2714) hoặc giữ phân biệt dạng số/chữ như Sheets. Chưa có câu trả lời; không quyết định thay người dùng. T2 giữ phoneText và phoneKey do caller cung cấp để hỗ trợ hai phương án. T3 phụ thuộc câu trả lời.
- T3–T7: chưa bắt đầu. Chuyển nguồn chính thức vẫn cần ba đợt hằng ngày, không thay bằng ba lần chạy tức thời.

## Bằng chứng/private artifacts

- .codex_tmp/pancake-openapi.yaml: đặc tả chính thức tải từ developer.pancake.biz/openapi/openapi.yaml.
- .codex_tmp/pancake-preflight.cjs: helper GET chỉ đọc đã dùng để đối soát.
- .codex_tmp/pancake-export-comparison-summary.json: kết quả toàn bộ 462 dòng, không thông tin khách.
- File gốc chỉ đọc: C:/Users/BOSS/Downloads/EXPORT_MESSAGE_1791535128795.xlsx, tab 430840296781378, 462 dòng, 435 hội thoại, 27 dòng không nhân viên.
- Dương Nội: API không lọc trả success=false; type=INBOX và type=COMMENT thành công. Job phải đọc riêng hai loại và kiểm tra success.
- API messages trả mới trước, thời gian không timezone phải hiểu UTC. phone_info[].phone_number; current_assign_users[].name ở conversations khớp cột nhân viên file.
- .codex_tmp/pancake-sheets-import-snapshot.json: snapshot readonly mới nhất gồm sáu THÔ/CHUẨN, Tên, BC tháng6–10, CHECK8–10/ranking. 18.305 dòng THÔ. Các ngày ghi nhận không ghi năm; dữ liệu năm2026 được xác nhận từ nguồn Tạo lúc và BC tháng. BL THÔ dòng1950 thiếu thời gian tạo, vẫn cần giữ dòng.
- BC tháng6 có70 dòng và bố cục cũ A sale/B khách/C phone/D status/E nguồn/F ngày/G doanh số/H ghi chú, không có page. Lưu page chưa xác định, không tự đoán; giữ provenance và liệt kê cho Quản lý xử lý.

## Nhật ký rà soát

Các báo cáo/brief riêng nhiệm vụ lưu dưới .superpowers/sdd/2026-10-09-pancake-marketing/ để không đụng kế hoạch khác.
## Tiếp tục 09/10: lưu DB và giữ nguồn doanh số

- Người dùng xác nhận doanh số từng khách vẫn lấy KiotViet. Không nhập số tiền Sheets làm nguồn doanh số chính.
- T2 implementer hoàn thành commit `33f35795c1e84821916b4560f93dc8316bf10c9c`: migration 0044, repository, 13/13 SQL tests, 41/41 Marketing regression; đang review độc lập trước migration remote.
- T3 brief đã chuẩn bị. Nhập giữ phone text/cell gốc để giữ công thức và số lượng CHUẨN theo kế hoạch; không tự chuẩn hoá số 0 khi câu hỏi tuỳ chọn chưa được trả lời. Mọi raw cell/type giữ trong DB để sau này tính lại nếu chọn chuẩn hoá.
- Remote DB chưa có bảng Marketing. Chỉ áp dụng migration 0044 sau review; không chạy lại migration ngoài phạm vi.
- T2 review độc lập: spec compliant, quality Approved, không lỗi chặn. Migration `0044_pancake_marketing.sql` đã áp lên Supabase thành công, xác nhận 10 bảng và 6 page Facebook.
- Người dùng yêu cầu hoàn thành thì commit, đẩy GitHub và **gộp main**. Đã uỷ quyền tích hợp main/push sau kiểm tra. Không chuyển nguồn chính thức trước ba đợt hằng ngày theo kế hoạch.
