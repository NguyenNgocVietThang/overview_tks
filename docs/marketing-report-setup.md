# Báo cáo Marketing — cấu hình và nghiệm thu

## Chuyển nguồn Pancake — 12/10/2026

Mã T3–T6 đã triển khai và qua kiểm thử; nguồn chính thức vẫn là Sheets. Ngày 12/10/2026 đã khôi phục ID tin nhắn từ sáu bản xuất đầy đủ (migration 0046): 18.304 dòng lịch sử thật đều có liên kết (18.294 duy nhất, 7 chỉ khác cách viết số +84/0 thừa đã kiểm cùng giây-cùng nhân viên, 3 dòng thuộc cặp tin tương đương = 6 liên kết); chỉ còn dòng tiêu đề lặp BL THÔ!1950 (không phải quan sát). 3.148 tin trong kỳ nằm ngoài nền Sheets được ghi sổ riêng, không tính. Đồng bộ thật đủ sáu page đạt (slot 12/10): 11.797 fact, 2.478 quan sát cùng ngày ghi nhận 12/10 (thay đổi nhân viên tích lũy từ lúc dán Sheets và 861 tin mới), 0 mục chưa giải quyết, 0 dòng lịch sử chưa liên kết; nền lịch sử khớp CHUẨN (11.942 nhóm SĐT); tổng khớp chi tiết 100/100 (T10) và 80/80 (T9). Công tắc job vẫn TẮT và nguồn vẫn Sheets: chưa có ba đợt hằng đêm đối soát, chưa cấu hình token trên Render. Lưu ý nghiệm thu: lần đồng bộ đầu dồn các thay đổi nhân viên cũ vào ngày 12/10 nên "chào lại" tháng 10 tăng mạnh (179 → 1.660); cần Quản lý xác nhận cách tính trước khi chuyển nguồn.

`PANCAKE_MARKETING_SYNC_ENABLED=false` mặc định; chỉ bật sau khi khôi phục ID và thử đồng bộ đạt. `MARKETING_REPORT_SOURCE=sheets` mặc định; đặt `postgres` sau ít nhất ba đợt hằng ngày đối soát đủ sáu page. Token `PANCAKE_PAGE_TOKEN_<pageId>` chỉ ở phía máy chủ, không commit hoặc trả API. Giữ riêng Tạo lúc và ngày ghi nhận thành công Việt Nam; lịch sử giữ ngày cũ. ADS luôn đọc Sheets (kể cả Quảng Châu); doanh số luôn lấy KiotViet theo tên, bán trừ trả hàng HN+SG.

## Nguồn chỉ đọc

Tab `/reports/#marketing` đọc ba workbook qua Google Sheets client của máy chủ. Chỉ có MỘT thao tác ghi: sửa cột **Khách mới** (I) và **Ghi chú** (J) của tab BC Tháng N trong workbook Báo cáo trực page (quyền `reports.marketing.edit`, mặc định Quản lý; cần chia sẻ workbook đó cho service account quyền **Editor**, nếu chưa có thì API trả `MARKETING_WRITE_FORBIDDEN`). Cột **Doanh số** của BC tháng lấy từ KiotViet (bảng `business_monthly_customer_sales`, bán trừ trả hàng cả tháng của tab, nối theo TÊN khách, gộp HN+SG; không khớp tên thì hiện —). Đây là chế độ Sheets hiện hành; chế độ PostgreSQL được giữ sau công tắc cho đến khi đối soát đạt.

| Biến môi trường | Workbook |
|---|---|
| `MARKETING_REPORT_SPREADSHEET_ID` | [TRỰC PAGE](https://docs.google.com/spreadsheets/d/14MaEMfPCyfxPx-HfJMJ1gcwIpKVbuhx3FIBCSnLSWl8/edit) — `14MaEMfPCyfxPx-HfJMJ1gcwIpKVbuhx3FIBCSnLSWl8` |
| `MARKETING_PHONES_SPREADSHEET_ID` | [Sao lưu SĐT](https://docs.google.com/spreadsheets/d/1cAOmY4WC2tIE0-OMwvy43PTR9dNK72k2d4DUDrB2swk/edit) — `1cAOmY4WC2tIE0-OMwvy43PTR9dNK72k2d4DUDrB2swk` |
| `MARKETING_ADS_SPREADSHEET_ID` | [Chi phí ADS](https://docs.google.com/spreadsheets/d/12b4Y5-zIuVHxgdVHoxtbIirhTYl3Czw0DIGHvaCODzs/edit) — `12b4Y5-zIuVHxgdVHoxtbIirhTYl3Czw0DIGHvaCODzs` |

Đặt ba biến trong môi trường máy chủ và khởi động lại. Chia sẻ từng workbook với `client_email` của service account đang dùng trong `GOOGLE_SERVICE_ACCOUNT_JSON`, quyền **Viewer**. Kiểm tra tài khoản của đúng môi trường; không công khai workbook và không đưa private key vào tài liệu hoặc trình duyệt. Workbook SĐT cần được bổ sung quyền đọc trước nghiệm thu đủ bốn phần; việc thêm code không tự cấp quyền Google.

## Hành vi và giới hạn

- Quyền `reports.marketing` mặc định cho Quản lý, Trợ lý, Nhân viên Marketing; áp dụng menu, trang và API. Cơ sở chung không giới hạn page Marketing.
- Bốn phần có bộ lọc độc lập: BC tháng, Check tỷ lệ nhận số, Sao lưu SĐT, Báo cáo chi phí. Tháng hiện tại theo giờ Việt Nam là mặc định cho ba báo cáo tháng; SĐT mặc định toàn bộ sáu tab CHUẨN. Thiếu tháng hiện tại hiển thị chưa có dữ liệu.
- Giữ giá trị công thức Sheets, số 0 đầu của SĐT và dòng thuộc các page khác nhau. Ô lỗi/thiếu hiện `—`; không thay lỗi bằng số 0. Chi phí không cộng dòng tổng tháng với dòng ngày; tổng từ dòng ngày khi thiếu dòng tổng phải có nhãn rõ ràng.
- Bấm dòng tổng quan hoặc Enter/Space mở hộp chữ nhật giữa màn hình theo mẫu Báo cáo kinh doanh, giữ bộ lọc hiện tại. Có tìm kiếm, sắp xếp, phân trang, cập nhật chi tiết; đóng bằng X/Esc/nền và trả focus về dòng nguồn. Chênh lệch giữa tổng nguồn và dòng chi tiết được báo rõ.
- Cache nguồn tối đa 5 phút; trình duyệt làm mới mỗi 5 phút khi tab đang hiển thị. Một nguồn lỗi không làm mất phần khác; lỗi cập nhật giữ bản cũ và thời điểm cũ. Hộp đang mở giữ snapshot đến khi người dùng cập nhật.
- Không sửa công thức hoặc dựng lịch sử từ tab THÔ. Phiên bản đầu chưa hỗ trợ lịch sử nhiều năm.

## API và nghiệm thu

Các API chỉ dùng GET và yêu cầu đăng nhập + `reports.marketing`: `/api/marketing-report/metadata`, `/monthly`, `/receipt-check`, `/phones`, `/costs`, `/detail`. Phản hồi có `Cache-Control: no-store`; bộ nhớ cache nằm ở máy chủ. Không đưa lỗi Google thô hoặc thông tin xác thực vào phản hồi lỗi.

Chạy `node --test marketingReport/*.test.js` trong `server/` để kiểm tra các ánh xạ, dịch vụ và cổng quyền hiện có. Nghiệm thu nguồn thật cần so sánh tháng hiện tại và một tháng cũ với Sheets: doanh số, quy đổi, tỷ lệ, dòng SĐT và chi phí/VAT/phí thuê. Kiểm tra hai khối chi phí Hữu Nghị/Quảng Châu, số tổng không cộng trùng và thông báo khi thiếu nguồn.

Nghiệm thu UI ở sáng/tối, chiều rộng 375/768/1024/1440px, bàn phím, tìm kiếm không dấu, sort trước phân trang và đóng/mở nhanh hộp chi tiết. Kiểm tra người không có quyền bị chặn cả URL trực tiếp và API. Tài liệu này không xác nhận triển khai production hay quyền nguồn đã được cấp.

## Kết quả kiểm tra cục bộ ngày 08/10/2026

- Đã cấp Viewer cho `tokosi@tokosi.iam.gserviceaccount.com` trên workbook SĐT sau xác nhận của người dùng; server đọc được sáu tab CHUẨN, 11.942 dòng tại thời điểm kiểm tra.
- BC tháng 10: doanh số nguồn 280.751.350 đồng, 36 khách theo page; tháng 9: 1.573.244.944 đồng, 100 khách. Số liệu là snapshot lúc đọc và có thể đổi khi Sheets cập nhật.
- Check tháng 10 của Tâm MKT: 253 lần đầu, 27 chào lại, quy đổi 258,4, 7 khách chốt; nhóm chi tiết tìm thấy đúng 253/27/7 dòng. Tỷ lệ nguồn hiển thị 2,71%.
- Toàn dự án: 2.054 bài đạt, 3 bài bỏ qua theo cấu hình. Sau các bổ sung cuối, 80 bài Marketing/giao diện/phân quyền đạt. Không xác nhận triển khai production.
- Đã kiểm tra giao diện desktop sáng/tối, mở bằng Enter, đóng bằng Esc và trả focus. Bộ công cụ trình duyệt không áp dụng được viewport nhỏ (vẫn trả chiều rộng 1280px); kiểm tra trực quan 375/768/1024/1440px vẫn cần thực hiện trong trình duyệt có responsive mode. CSS và kiểm thử DOM đã có quy tắc responsive tương ứng.

## Vận hành và API PostgreSQL

Migration `0044_pancake_marketing.sql` và `0045_pancake_current_input.sql` đã áp lên DB Marketing. Scheduler trong backend chạy 23:55 Asia/Ho_Chi_Minh, khóa PostgreSQL chống chạy trùng; page lỗi giữ dữ liệu cũ. Full scan lịch sử còn tốn thời gian và chưa được nghiệm thu production.

`GET /api/marketing-report/metadata` trả năm/tháng có dữ liệu và quyền ghi đã xác minh ở máy chủ; `/sync-status` trả kết quả an toàn từng page. API đọc, chi tiết và xuất xlsx/html giữ cùng bộ lọc/snapshot. `POST /monthly/rows`, `PUT /monthly/rows/:id`, `PUT /aliases` cần vai trò Quản lý và `reports.marketing.edit`; `GET /monthly/rows/:id/audit` chỉ Quản lý. ID khách chọn từ danh mục KiotViet theo cơ sở/mã, sửa cần version; báo cáo tháng tách ngày chốt. Không tự chọn page cho lịch sử chưa xác định.

Chạy từ thư mục server: `npm run marketing:history:capture -- --output PRIVATE.json`; `npm run marketing:history:import -- --input PRIVATE.json --year 2026 --dry-run`; `npm run marketing:pancake:sync -- --date YYYY-MM-DD --dry-run`. `--apply` ghi DB; `--retry` yêu cầu thêm một lần thử cho slot lỗi. Chạy mặc định dry-run không truy cập API/DB. File xuất và snapshot chứa SĐT, phải giữ ngoài Git. Không coi ba lần thử cùng ngày là ba đợt hằng ngày.
