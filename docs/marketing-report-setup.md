<!-- Chính sách hiện hành: mục 16/10/2026 — Tập Pancake độc lập ở cuối tài liệu. Các mốc cũ giữ làm lịch sử. -->
# Báo cáo Marketing — cấu hình và nghiệm thu

16/10/2026 — Đã đọc trực tiếp công thức sáu page và trạng thái DB để đánh giá tính độc lập từ Pancake. [Kết quả kiểm tra và phương án chuyển nguồn](superpowers/specs/2026-10-16-marketing-pancake-independent-design.md). Chưa bật nguồn mới; cần chốt ngày ghi nhận lịch sử hay ngày tạo tin nhắn trước khi triển khai.

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

## 16/10/2026 — Tập Pancake độc lập (phương án B đã duyệt)

Đặt MARKETING_REPORT_SOURCE=pancake và PANCAKE_MARKETING_SYNC_ENABLED=true sau khi áp migration 0056_pancake_independent.sql. Chế độ postgres cũ vẫn là lịch sử hỗn hợp; không dùng để công bố dữ liệu chỉ Pancake. Hai tập tách bảng, không xóa/sửa lịch sử. Trong Sao lưu SĐT và Check tỷ lệ nhận số có bộ chọn Lịch sử cũ (có nguồn Sheets) để tra cứu; dataset=legacy được truyền cả vào chi tiết và xuất file.

- Scheduler backend chạy độc lập việc mở dashboard: bắt kịp slot gần nhất khi server khởi động, sau đó 23:55 Asia/Ho_Chi_Minh; khóa PostgreSQL ngăn trùng nhiều tiến trình. Production cần dịch vụ luôn chạy; dịch vụ ngủ không thể chạy đúng giờ (sẽ bắt kịp khi thức).
- Sáu page fetch từ since=0 tới thời điểm bắt đầu job, hết phân trang INBOX/COMMENT và tin nhắn; lưu coverage từng page (phạm vi, số trang/tin và giới hạn truy cập API). Complete chỉ xác nhận đã đọc hết phạm vi API trả về, không cam kết phục hồi tin đã xóa hoặc không được cấp quyền. Page lỗi không commit dữ liệu dở dang, giữ snapshot thành công và công bố cảnh báo thiếu dữ liệu.
- Không đọc marketing_baseline_messages, liên kết lịch sử, CHUẨN, CHECK hoặc bảng tên Sheets để tính tập mới. Không cần đối soát Sheets để công bố. Giữ nguyên chuỗi SĐT nguồn, nhóm riêng theo page; không tự gộp +84/0.
- Lần đầu là ngày tạo tin sớm nhất đổi UTC+7. Nhân viên lần đầu là assignment được hệ thống quan sát trên tin đó, không phải bằng chứng người phụ trách tại thời điểm tạo tin. Chào lại cần người đầu/cuối nguồn khác nhau, có chuyển người trên cùng tin được quan sát qua các ngày khác nhau; ngày là ngày quan sát bằng chứng. Đổi cùng ngày, thiếu người, A→B→A không tạo chào lại theo quy tắc đầu/cuối. Ánh xạ tên sau chọn đầu/cuối; nhiều tên nguồn về một nhân viên vẫn giữ bằng chứng đổi tên nguồn. Quy đổi = lần đầu + chào lại/5.
- Khách chốt chưa có sự kiện Pancake được xác minh. Chỉ đếm dòng BC tháng nhập web (origin=manual), không trộn dòng Sheets cũ. Chưa có dòng tháng thì khách chốt/tỷ lệ là null (—); có dòng thì ghi rõ nguồn manual-db, không tuyên bố đã nhập đủ toàn bộ tháng. Tỷ lệ tổng = tổng dòng nhập / tổng quy đổi, mẫu số 0 là —.
- Doanh số: KiotViet. ADS/VAT/phí thuê: Sheets. Metadata Pancake không gọi Sheets; lỗi ADS chỉ ảnh hưởng phần chi phí. Sửa/ánh xạ BC tháng vẫn yêu cầu Quản lý và quyền sửa; có version/audit DB.
- Chi tiết pin snapshot trong 30 phút. XLSX/HTML dùng cùng report service và kèm nguồn, snapshot, cảnh báo. Rerun cùng slot không tăng số; --retry cho một lần thử bổ sung khi slot lỗi. Ngày tạo tin được giữ bất biến; sai thời gian nguồn làm page lỗi.

Lệnh kiểm tra: cd server; node --test marketingReport/*.test.js test/frontend/marketing-report.test.js
Lệnh nạp thật: npm run marketing:pancake:sync -- --apply --date YYYY-MM-DD --report-file PATH (cấu hình source=pancake).
Không đưa token hoặc dữ liệu cá nhân vào log/tài liệu công khai. Xem phần trạng thái triển khai mới nhất bên dưới; mã trên main không có nghĩa production đã được deploy.

### Trạng thái thực hiện 16/10/2026
- Đã áp riêng migration 0056 vào PostgreSQL đang cấu hình; không áp 0054/0055 ngoài phạm vi và không sửa/xóa dữ liệu lịch sử.
- Local .env đã đặt source=pancake, sync=true; đủ sáu token. Run 28 (pancake-independent:2026-10-16) bắt đầu 14:24 giờ Việt Nam, đang backfill API. Chưa xác nhận đủ sáu page; báo cáo trả pending/null trong lúc chưa có page thành công. CLI ghi kết quả cuối vào marketing-independent-sync-status.json tại workspace (không chứa dữ liệu khách).
- Scheduler trong backend sẽ chạy khi tiến trình server hoạt động; việc mở dashboard không kích hoạt hoặc duy trì job. Trong phiên này chỉ chạy CLI backfill, chưa khởi động server như dịch vụ thường trú.
- Full npm test: 2486 tests, 2483 pass, 0 fail, 3 skipped. Sau rà soát có kiểm thử bổ sung cho nhả khóa khi DB lỗi, metadata ADS chưa thăm dò, KPI pending và lựa chọn lịch sử/nguồn xuất file; các nhóm kiểm thử liên quan đạt.
- Chưa push/deploy code, chưa đổi biến môi trường Render/production; không tuyên bố production đã kích hoạt. DB được cấu hình local có thể dùng chung môi trường khác: migration bổ sung đã áp nhưng đó không phải deploy ứng dụng production.

### Kích hoạt production Render — 16/10/2026, 14:51 (Việt Nam)
Đã xác minh dịch vụ tokosi (srv-d9k1ikp42hec739su3j0), project TKS Website / Production, đang chạy commit dac24b8 có thay đổi Pancake độc lập. Đã đổi MARKETING_REPORT_SOURCE từ postgres sang pancake và giữ PANCAKE_MARKETING_SYNC_ENABLED=true; xác minh đủ sáu token đã lưu, không thay token hoặc biến ngoài Marketing. Lưu và triển khai lại qua Render Dashboard, deployment dep-db8termq1p3s739b6880 báo Deploy succeeded | Live (37 giây); /health trả HTTP 200 với status ok. Đã đọc lại hai giá trị đã lưu sau deploy. Scheduler backend được bật, lịch 23:55 Asia/Ho_Chi_Minh, không cần mở dashboard.

Lần nạp đầu run 28 còn running và sáu page pending tại lúc xác minh; chưa xác nhận dữ liệu đầy đủ. Cấu hình production đã hoạt động không đồng nghĩa backfill hoàn tất. Nguồn chốt vẫn manual-db, doanh số KiotViet, chi phí Sheets. Tab báo cáo chưa được kiểm tra bằng phiên đăng nhập người dùng trong lần cấu hình này; smoke test gồm health, deployment và giá trị environment đã lưu.

[Deployment production](https://dashboard.render.com/web/srv-d9k1ikp42hec739su3j0/deploys/dep-db8termq1p3s739b6880). Không push thay đổi tài liệu chỉ để tránh tạo thêm deployment không cần thiết.
