# TÀI LIỆU YÊU CẦU NGHIỆP VỤ

*(Business Requirements Document – BRD)*

**HỆ THỐNG DASHBOARD TỰ ĐỘNG TỪ GOOGLE SHEETS**

| **Thông tin**     | **Nội dung**                               |
|-------------------|--------------------------------------------|
| Tên dự án         | Hệ thống Dashboard nội bộ từ Google Sheets |
| Phiên bản         | 1.0                                        |
| Ngày tạo          | 27/07/2026                                 |
| Đối tượng sử dụng | Nhân viên & Quản trị viên nội bộ công ty   |
| Trạng thái        | Bản thảo – chờ phê duyệt                   |

# 1. Giới thiệu

## 1.1. Mục đích tài liệu

Tài liệu này mô tả các yêu cầu nghiệp vụ cho việc xây dựng một hệ thống Website Dashboard nội bộ, cho phép công ty kết nối trực tiếp với một Google Sheets có sẵn để tự động dựng báo cáo trực quan (KPI tổng quan và biểu đồ), phục vụ việc theo dõi và ra quyết định nhanh chóng. Tài liệu là cơ sở thống nhất giữa các bên liên quan (chủ đầu tư nội bộ, đội phát triển) trước khi bước vào giai đoạn thiết kế kỹ thuật chi tiết (SRS).

## 1.2. Bối cảnh

Công ty là một tổng kho sỉ phân phối hàng hóa, với khoảng 5.000–20.000 mã hàng (SKU) lưu thông liên tục qua nhiều kho/chi nhánh. Hiện tại, dữ liệu vận hành của công ty (bán hàng, tồn kho, khách hàng...) được lưu trữ và cập nhật trên Google Sheets và một phần trên phần mềm KiotViet. Việc theo dõi số liệu đang phải thực hiện thủ công, gây mất thời gian tổng hợp, khó trực quan hóa xu hướng theo thời gian, và không thuận tiện cho nhiều người cùng theo dõi. Công ty có nhu cầu xây dựng một hệ thống website tập trung — bắt đầu từ một Dashboard đọc dữ liệu Google Sheets — làm nền móng kiến trúc để trong tương lai mở rộng thành một nền tảng quản trị vận hành toàn diện (bán hàng/POS, quản lý kho đa chi nhánh, phân tích doanh số, phát hiện bất thường, và cuối cùng thay thế hoàn toàn KiotViet).

## 1.3. Phạm vi tài liệu

Tài liệu tập trung vào yêu cầu nghiệp vụ của Giai đoạn 1 (Dashboard đọc từ Google Sheets) ở mức tổng quan: mục tiêu, phạm vi, đối tượng sử dụng, lợi ích kỳ vọng và yêu cầu chức năng chính. Đồng thời, tài liệu nêu rõ định hướng mở rộng dài hạn (mục 3.3 và mục 9) để đội phát triển thiết kế kiến trúc Giai đoạn 1 theo hướng dễ mở rộng, tránh phải xây lại từ đầu khi triển khai các giai đoạn sau. Các đặc tả kỹ thuật chi tiết được trình bày trong tài liệu SRS đi kèm.

# 2. Mục tiêu dự án

- Xây dựng một website Dashboard nội bộ, kết nối trực tiếp với 1 Google Sheets nguồn của công ty.

- Tự động nhận diện cấu trúc dữ liệu trong Sheet (không yêu cầu Sheet phải theo khuôn mẫu cố định) để dựng số liệu và biểu đồ.

- Rút ngắn thời gian tổng hợp báo cáo thủ công, giúp lãnh đạo và nhân viên theo dõi số liệu real-time chỉ với một cú nhấp Làm mới.

- Cung cấp giao diện trực quan, dễ dùng, có thể lọc số liệu theo 4 khung thời gian: 1 ngày, 7 ngày, 30 ngày, 90 ngày.

- Đảm bảo phân quyền rõ ràng: Quản trị viên (Admin) cấu hình dashboard, Nhân viên chỉ xem báo cáo.

- Cho phép xuất báo cáo ra file (PDF/Excel) để phục vụ họp, lưu trữ, gửi báo cáo cấp trên.

- Xây dựng Giai đoạn 1 trên một nền kiến trúc mô-đun, dễ mở rộng, làm nền tảng cho lộ trình dài hạn: module Bán hàng/POS, Quản lý kho đa chi nhánh, Phân tích doanh số & phát hiện bất thường, Danh bạ phòng ban, và tích hợp Trợ lý AI — hướng tới thay thế hoàn toàn KiotViet.

# 3. Phạm vi dự án

## 3.1. Trong phạm vi (In-scope)

- Kết nối 1 Google Sheets nguồn duy nhất cho mỗi phiên làm việc/công ty (không yêu cầu multi-tenant).

- Hỗ trợ 2 phương thức truy cập dữ liệu: (a) đăng nhập Google (OAuth) để đọc Sheet riêng tư, (b) dùng link Sheet đã chia sẻ/publish công khai — người dùng lựa chọn.

- Tự động phân tích cấu trúc cột dữ liệu (kiểu dữ liệu: số, ngày tháng, văn bản, danh mục) để đề xuất số liệu tổng hợp và loại biểu đồ phù hợp.

- Giao diện gồm 3 phần chính: Sidebar điều hướng, Khu vực Tổng số liệu (KPI), Khu vực Biểu đồ.

- Bộ lọc thời gian theo 4 mốc: 1 ngày / 7 ngày / 30 ngày / 90 ngày.

- Cập nhật dữ liệu theo yêu cầu người dùng thông qua nút Làm mới thủ công.

- Tự động đồng bộ dữ liệu real-time qua webhook/Apps Script trigger: khi Google Sheets nguồn thay đổi, hệ thống tự động nhận và cập nhật dữ liệu mà không cần người dùng bấm Làm mới.

- Phân quyền 2 vai trò: Admin (cấu hình dashboard, quản lý kết nối Sheet, quản lý người dùng) và Nhân viên (chỉ xem).

- Chức năng xuất báo cáo dưới dạng PDF và/hoặc Excel.

## 3.2. Ngoài phạm vi Giai đoạn 1 (Out-of-scope)

- Kết nối đồng thời nhiều Google Sheets / mô hình multi-tenant cho nhiều công ty khác nhau.

- Chia sẻ dashboard công khai qua đường link ra bên ngoài hệ thống.

- Chỉnh sửa/ghi dữ liệu ngược lại vào Google Sheets từ giao diện Dashboard.

- Toàn bộ các module ở mục 3.3 bên dưới (Bán hàng/POS, Kho đa chi nhánh, Phân tích & dự đoán bất thường, Danh bạ phòng ban, Trợ lý AI) — không xây dựng trong Giai đoạn 1, nhưng kiến trúc Giai đoạn 1 phải được thiết kế để không cản trở việc bổ sung các module này sau.

## 3.3. Định hướng mở rộng dài hạn (Lộ trình sau Giai đoạn 1)

Các mục dưới đây KHÔNG thuộc phạm vi triển khai của Giai đoạn 1, nhưng được liệt kê để đội phát triển thiết kế kiến trúc, cơ sở dữ liệu và lựa chọn công nghệ ở Giai đoạn 1 theo hướng tương thích, tránh phải viết lại khi mở rộng. Chi tiết kiến trúc kỹ thuật cho định hướng này nằm ở SRS mục 2.5.

- Giai đoạn 2 — Bán hàng/POS: các nghiệp vụ tương đương KiotViet (tạo đơn bán, quản lý khách hàng, công nợ, in hóa đơn).

- Giai đoạn 3 — Quản lý kho đa chi nhánh: nhập/xuất/chuyển kho, tồn kho theo từng kho/chi nhánh, kiểm kê định kỳ, quản lý 5.000–20.000 SKU.

- Giai đoạn 4 — Phân tích doanh số & Phát hiện bất thường: phân tích xu hướng bán hàng, dự đoán nhu cầu nhập hàng, phát hiện sai lệch tồn kho/giá bất thường, cảnh báo rủi ro thất thoát.

- Giai đoạn 5 — Danh bạ phòng ban: sơ đồ tổ chức và danh bạ nhân sự công ty (dạng xem thông tin, không phải HRM đầy đủ).

- Giai đoạn 6 — Trợ lý AI: chatbot hỏi-đáp số liệu bằng ngôn ngữ tự nhiên (ưu tiên hàng đầu về AI), sau đó mở rộng sang AI hỗ trợ dự đoán nhập hàng và phát hiện bất thường tự động.

- Định hướng cuối: khi các module trên đủ trưởng thành, hệ thống thay thế hoàn toàn phần mềm KiotViet hiện tại của công ty.

# 4. Đối tượng liên quan (Stakeholders)

| **Vai trò**                                            | **Mô tả trách nhiệm / nhu cầu**                                                                                                       |
|--------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------|
| Ban lãnh đạo / Quản lý                                 | Theo dõi số liệu tổng quan nhanh, ra quyết định dựa trên xu hướng dữ liệu.                                                            |
| Quản trị viên hệ thống (Admin)                         | Kết nối Google Sheets, cấu hình/quản lý các dashboard, phân quyền người dùng.                                                         |
| Nhân viên nội bộ                                       | Xem báo cáo, lọc theo thời gian, xuất báo cáo phục vụ công việc.                                                                      |
| Nhân viên Kho / Bán hàng (đối tượng của Giai đoạn 2–3) | Người dùng chính của các module POS và Quản lý kho trong lộ trình dài hạn; ở Giai đoạn 1 chỉ xem dashboard tổng quan.                 |
| Đội phát triển (Dev team)                              | Xây dựng, kiểm thử và triển khai hệ thống theo yêu cầu trong BRD/SRS, đảm bảo kiến trúc Giai đoạn 1 tương thích với lộ trình mở rộng. |

# 5. Yêu cầu nghiệp vụ chi tiết

## 5.1. Kết nối & đọc dữ liệu Google Sheets

- Người dùng (Admin) nhập vào link Google Sheets nguồn.

- Hệ thống hỗ trợ 2 chế độ truy cập: đăng nhập OAuth (đọc Sheet riêng tư) hoặc dùng link Sheet đã publish/chia sẻ công khai.

- Hệ thống tự động đọc và phân tích các cột/tab trong Sheet, nhận diện kiểu dữ liệu (số liệu, ngày tháng, văn bản) mà không yêu cầu người dùng khai báo trước cấu trúc cố định.

## 5.2. Tổng số liệu (KPI tổng quan)

- Hệ thống tự động tổng hợp các chỉ số tổng quan quan trọng nhất từ dữ liệu (ví dụ: tổng doanh thu, tổng số dòng, giá trị trung bình, số lượng theo danh mục...) hiển thị dưới dạng thẻ số liệu (KPI card).

- Các số liệu này thay đổi theo khung thời gian được chọn (1/7/30/90 ngày).

## 5.3. Biểu đồ trực quan

- Hệ thống tự động gợi ý loại biểu đồ phù hợp (đường, cột, tròn, v.v.) dựa trên đặc điểm của dữ liệu được phát hiện (dữ liệu theo thời gian → biểu đồ đường/cột; dữ liệu theo danh mục → biểu đồ tròn/cột ngang...).

- Biểu đồ cập nhật tương ứng theo bộ lọc thời gian được chọn.

## 5.4. Sidebar điều hướng

- Sidebar cho phép chuyển đổi giữa các dashboard/báo cáo khác nhau (nếu có nhiều view được cấu hình từ cùng một Sheet).

- Sidebar đồng thời chứa các mục chức năng: Tổng quan, Cài đặt kết nối Sheet, Quản lý người dùng (chỉ Admin thấy), Xuất báo cáo.

## 5.5. Bộ lọc thời gian

- Người dùng chọn nhanh 1 trong 4 khung thời gian cố định: 1 ngày / 7 ngày / 30 ngày / 90 ngày để xem lại số liệu và biểu đồ tương ứng.

## 5.6. Cập nhật dữ liệu

- Người dùng chủ động nhấn nút “Làm mới” để hệ thống đọc lại dữ liệu mới nhất từ Google Sheets nguồn.

- Song song đó, hệ thống hỗ trợ đồng bộ tự động qua webhook/Apps Script trigger: ngay khi Sheet nguồn có thay đổi, hệ thống tự động nhận và cập nhật dữ liệu Dashboard mà không cần thao tác thủ công.

## 5.7. Phân quyền người dùng

| **Vai trò** | **Quyền hạn**                                                                                       |
|-------------|-----------------------------------------------------------------------------------------------------|
| Admin       | Kết nối/thay đổi Sheet nguồn, cấu hình dashboard, quản lý tài khoản người dùng, xem & xuất báo cáo. |
| Nhân viên   | Xem dashboard, lọc theo thời gian, xuất báo cáo. Không có quyền thay đổi cấu hình.                  |

## 5.8. Xuất báo cáo

- Cho phép xuất dashboard hiện tại (số liệu + biểu đồ) ra file PDF và/hoặc Excel để lưu trữ hoặc gửi báo cáo.

- Không yêu cầu chức năng chia sẻ báo cáo qua đường link công khai.

# 6. Lợi ích kỳ vọng

- Tiết kiệm thời gian tổng hợp báo cáo thủ công từ Google Sheets.

- Ra quyết định nhanh hơn nhờ số liệu trực quan, cập nhật theo yêu cầu.

- Chuẩn hóa cách theo dõi số liệu trong nội bộ công ty, giảm phụ thuộc vào việc đọc Sheet thô.

- Dễ dàng mở rộng thêm các nguồn Sheet/khung thời gian khác trong tương lai.

# 7. Giả định & ràng buộc

## 7.1. Giả định

- Google Sheets nguồn có ít nhất một cột chứa dữ liệu dạng ngày tháng để phục vụ lọc theo thời gian.

- Người dùng nội bộ có tài khoản Google hoặc được cấp tài khoản đăng nhập hệ thống.

- Số lượng người dùng đồng thời dự kiến khoảng 150 người.

- Công ty vận hành theo mô hình nhiều kho/chi nhánh, quản lý khoảng 5.000–20.000 SKU, với khối lượng giao dịch nhập/xuất khoảng 500–5.000 đơn/ngày — các con số này là cơ sở để SRS thiết kế kiến trúc chịu tải cho các giai đoạn mở rộng sau.

## 7.2. Ràng buộc

- Giai đoạn 1 chỉ hỗ trợ 1 Google Sheets nguồn tại một thời điểm (không phải mô hình multi-tenant).

- Cập nhật dữ liệu hỗ trợ song song 2 cơ chế: thủ công (nút Làm mới) và tự động qua webhook/Apps Script trigger khi Sheet nguồn thay đổi.

- Giới hạn định dạng (quota) truy cập Google Sheets API theo chính sách của Google.

# 8. Tiêu chí nghiệm thu (Acceptance Criteria)

- Kết nối thành công với Google Sheets nguồn qua cả 2 phương thức (OAuth và link công khai).

- Hệ thống tự nhận diện đúng kiểu dữ liệu của tối thiểu 90% cột dữ liệu phổ biến (số, ngày, văn bản, danh mục).

- Hiển thị đầy đủ 3 khu vực: Sidebar, Tổng số liệu, Biểu đồ, đúng với dữ liệu nguồn.

- Bộ lọc 1/7/30/90 ngày hoạt động chính xác, số liệu và biểu đồ thay đổi tương ứng.

- Nút Làm mới cập nhật đúng dữ liệu mới nhất từ Sheet nguồn.

- Khi dữ liệu trong Sheet nguồn thay đổi, hệ thống tự động cập nhật Dashboard qua webhook trong thời gian hợp lý (không cần người dùng thao tác).

- Phân quyền Admin/Nhân viên hoạt động đúng theo ma trận quyền hạn ở mục 5.7.

- Xuất được báo cáo PDF/Excel với nội dung khớp với dữ liệu đang hiển thị.

- Hệ thống hoạt động ổn định với khoảng 150 người dùng truy cập.

- Kiến trúc Giai đoạn 1 được tổ chức theo mô-đun (module hoá) rõ ràng, cho phép bổ sung các module ở mục 3.3 (Bán hàng/POS, Kho, Phân tích, Danh bạ, AI) mà không phải tái cấu trúc toàn bộ hệ thống hiện có.

# 9. Kế hoạch triển khai tổng quan (đề xuất)

## 9.1. Giai đoạn 1 — Dashboard (phạm vi của tài liệu này)

| **Bước**                      | **Nội dung**                                                                                       | **Thời gian dự kiến** |
|-------------------------------|----------------------------------------------------------------------------------------------------|-----------------------|
| 1\. Phân tích & thiết kế      | Hoàn thiện BRD, SRS, thiết kế UI/UX, kiến trúc kỹ thuật mô-đun mở rộng                             | 1–2 tuần              |
| 2\. Xây dựng lõi (MVP)        | Kết nối Sheets, engine nhận diện dữ liệu, Sidebar, KPI, Biểu đồ, bộ lọc thời gian, webhook đồng bộ | 3–4 tuần              |
| 3\. Phân quyền & xuất báo cáo | Xây dựng module Admin/Nhân viên, xuất PDF/Excel                                                    | 1–2 tuần              |
| 4\. Kiểm thử & UAT            | Kiểm thử chức năng, hiệu năng (150 user), nghiệm thu với người dùng nội bộ                         | 1–2 tuần              |
| 5\. Triển khai & đào tạo      | Triển khai production, hướng dẫn sử dụng cho nhân viên                                             | 1 tuần                |

## 9.2. Lộ trình dài hạn (định hướng, ngoài phạm vi tài liệu này)

Bảng dưới đây mang tính định hướng, phục vụ việc lập kế hoạch nguồn lực dài hạn; phạm vi và thời gian chi tiết của từng giai đoạn sẽ được chốt trong BRD/SRS riêng khi bắt đầu giai đoạn tương ứng.

| **Giai đoạn**                                  | **Nội dung chính**                                                                                       | **Ghi chú**                                                                 |
|------------------------------------------------|----------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------|
| Giai đoạn 2 — Bán hàng/POS                     | Tạo đơn bán, quản lý khách hàng, công nợ, in hóa đơn — tương đương nghiệp vụ KiotViet                    | Ưu tiên triển khai ngay sau Giai đoạn 1                                     |
| Giai đoạn 3 — Kho đa chi nhánh                 | Nhập/xuất/chuyển kho, tồn kho theo từng kho, kiểm kê định kỳ cho 5.000–20.000 SKU                        | Phụ thuộc dữ liệu chuẩn hoá từ Giai đoạn 2                                  |
| Giai đoạn 4 — Phân tích & phát hiện bất thường | Phân tích doanh số, dự đoán nhu cầu nhập hàng, phát hiện sai lệch tồn kho/giá bất thường                 | Cần dữ liệu lịch sử đủ lớn từ Giai đoạn 2–3                                 |
| Giai đoạn 5 — Danh bạ phòng ban                | Sơ đồ tổ chức, danh bạ nhân sự (dạng xem thông tin)                                                      | Có thể triển khai song song, độc lập với các giai đoạn khác                 |
| Giai đoạn 6 — Trợ lý AI                        | Chatbot hỏi-đáp số liệu bằng ngôn ngữ tự nhiên; sau đó mở rộng AI dự đoán & phát hiện bất thường tự động | Ưu tiên chatbot hỏi-đáp trước; cần dữ liệu chuẩn hoá từ các giai đoạn trước |
| Giai đoạn 7 — Thay thế KiotViet                | Ngừng sử dụng KiotViet, chuyển hoàn toàn nghiệp vụ sang hệ thống mới                                     | Chỉ thực hiện khi Giai đoạn 2–3 đã ổn định và được nghiệm thu đầy đủ        |

*— Hết tài liệu BRD —*
