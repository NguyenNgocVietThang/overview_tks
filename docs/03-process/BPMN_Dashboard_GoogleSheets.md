**SƠ ĐỒ QUY TRÌNH NGHIỆP VỤ (BPMN)**

**HỆ THỐNG DASHBOARD NỘI BỘ TỪ GOOGLE SHEETS — GIAI ĐOẠN 1**

|                         |                                                                               |
| ----------------------- | ----------------------------------------------------------------------------- |
| **Tên tài liệu**        | Sơ đồ quy trình nghiệp vụ (BPMN) — Hệ thống Dashboard nội bộ từ Google Sheets |
| **Phiên bản**           | 1.0                                                                           |
| **Ngày tạo**            | 27/07/2026                                                                    |
| **Tài liệu tham chiếu** | BRD v1.0 và SRS v1.0 — Hệ thống Dashboard nội bộ từ Google Sheets             |
| **Phạm vi**             | Toàn bộ luồng nghiệp vụ Giai đoạn 1 (Dashboard đọc dữ liệu Google Sheets)     |
| **Trạng thái**          | Bản thảo — chờ phê duyệt                                                      |

**1. Giới thiệu**

**1.1. Mục đích tài liệu**

Tài liệu này trình bày mô hình hóa quy trình nghiệp vụ (BPMN — Business
Process Model and Notation) cho toàn bộ luồng vận hành của Hệ thống
Dashboard nội bộ đọc dữ liệu từ Google Sheets, cụ thể hóa các yêu cầu đã
nêu trong BRD v1.0 và SRS v1.0 thành sơ đồ trực quan theo vai trò
(swimlane), phục vụ trao đổi thống nhất giữa các bên liên quan và làm cơ
sở cho đội phát triển triển khai chi tiết.

**1.2. Phạm vi mô hình hóa**

Tài liệu mô hình hóa toàn bộ luồng end-to-end của Giai đoạn 1, được chia
thành 3 giai đoạn con liên kết với nhau:

  - Giai đoạn A — Kết nối & nhận diện dữ liệu Google Sheets (thiết lập
    một lần / khi thay đổi cấu hình).

  - Giai đoạn B — Sử dụng Dashboard hằng ngày: đăng nhập, lọc thời gian,
    xem KPI/biểu đồ, làm mới dữ liệu, xuất báo cáo.

  - Giai đoạn C — Đồng bộ dữ liệu tự động qua Webhook/Apps Script
    trigger, chạy song song và liên tục.

Các nhánh xử lý ngoại lệ/lỗi quan trọng (link Sheet không hợp lệ, thiếu
cột ngày tháng, làm mới thất bại, webhook lỗi) được thể hiện đầy đủ
trong từng sơ đồ chi tiết.

**2. Vai trò tham gia quy trình (Swimlane)**

Sơ đồ sử dụng mô hình 1 bể (Pool) "Hệ thống Dashboard nội bộ" với 4 làn
(Lane) tương ứng 4 vai trò/tác nhân sau:

|                                |                                                                                                                                                                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vai trò (Lane)**             | **Mô tả trách nhiệm**                                                                                                                                                                                                   |
| Admin                          | Quản trị viên hệ thống: kết nối/thay đổi Google Sheets nguồn, cấu hình dashboard (KPI, biểu đồ), thiết lập đồng bộ tự động qua Apps Script, quản lý tài khoản người dùng (thêm/khóa/đổi vai trò).                       |
| Nhân viên / Admin (Người dùng) | Đại diện cho người dùng nội bộ đăng nhập vào hệ thống — bao gồm cả Nhân viên (Viewer) và Admin khi ở vai trò xem báo cáo: chọn dashboard, lọc theo thời gian, xem KPI/biểu đồ, làm mới dữ liệu, xuất báo cáo PDF/Excel. |
| Hệ thống (Backend)             | Phần xử lý nghiệp vụ tự động của hệ thống: xác thực, gọi Google Sheets API, engine nhận diện kiểu dữ liệu, tính toán KPI/biểu đồ, xử lý webhook, cache (Redis), đóng gói báo cáo.                                       |
| Google Sheets / Apps Script    | Nguồn dữ liệu bên ngoài và cơ chế Apps Script trigger (onEdit/onChange) gắn trên Sheet nguồn, chịu trách nhiệm cung cấp dữ liệu và phát sự kiện thay đổi cho hệ thống.                                                  |

**3. Chú giải ký hiệu sử dụng**

|                                      |                                                                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| **Ký hiệu**                          | **Ý nghĩa**                                                                                                     |
| ● Hình tròn viền xanh lá (mỏng)      | Sự kiện Bắt đầu (Start Event) — điểm khởi phát của một luồng quy trình.                                         |
| ● Hình tròn viền đỏ (đậm)            | Sự kiện Kết thúc (End Event) — điểm hoàn tất một nhánh/luồng.                                                   |
| ◎ Hình tròn đôi (viền xanh dương)    | Sự kiện trung gian / mốc quan trọng (Intermediate/Milestone Event) — vd: "Dashboard sẵn sàng sử dụng".          |
| ▭ Hình chữ nhật bo góc               | Hoạt động / Tác vụ (Task) — một bước xử lý cụ thể do một vai trò (lane) thực hiện.                              |
| ◇ Hình thoi có dấu X (màu vàng)      | Cổng quyết định loại trừ (Exclusive Gateway) — rẽ nhánh theo điều kiện, chỉ đi theo đúng 1 nhánh.               |
| → Mũi tên liền nét                   | Luồng tuần tự chính (Sequence Flow) — thứ tự thực hiện bình thường.                                             |
| ⇢ Mũi tên nét đứt                    | Luồng ngoại lệ / vòng lặp quay lại / đồng bộ theo sự kiện bất đồng bộ (loop-back, webhook, cập nhật real-time). |
| ▤ Làn ngang (Lane) trong 1 bể (Pool) | Đại diện cho 1 vai trò/tác nhân chịu trách nhiệm thực hiện các bước nằm trong làn đó.                           |

**4. Sơ đồ tổng quan quy trình**

Sơ đồ dưới đây thể hiện mối quan hệ tổng quát giữa 3 giai đoạn: Giai
đoạn A khởi tạo Dashboard một lần, sau đó Giai đoạn B (người dùng
xem/lọc/xuất báo cáo) lặp lại hằng ngày, song song với Giai đoạn C (đồng
bộ tự động qua webhook) chạy liên tục trong nền và đẩy cập nhật near
real-time về Giai đoạn B.

![](./bpmn_media/media/4bda4996c0568ad21dd89b7657d395e178c26c8b.png)

*Hình 1 — Sơ đồ tổng quan 3 giai đoạn của quy trình Dashboard Google
Sheets*

**5. Giai đoạn A — Kết nối & nhận diện dữ liệu Google Sheets**

Giai đoạn này diễn ra khi Admin thiết lập Dashboard lần đầu, hoặc khi
thay đổi Sheet nguồn. Hệ thống hỗ trợ 2 phương thức truy cập (OAuth hoặc
link công khai), tự động nhận diện cấu trúc cột dữ liệu mà không yêu cầu
khuôn mẫu cố định, và xử lý các trường hợp lỗi (link không hợp lệ, thiếu
cột ngày tháng).

![](./bpmn_media/media/91e3f836e262e61045b205cdb09ce07d9c48f3ba.png)

*Hình 2 — BPMN chi tiết Giai đoạn A: Kết nối & nhận diện dữ liệu*

|          |               |                                                                                                              |                        |
| -------- | ------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------- |
| **Bước** | **Vai trò**   | **Mô tả**                                                                                                    | **Yêu cầu tham chiếu** |
| A0       | Admin         | Sự kiện bắt đầu: Admin cần thiết lập Dashboard cho công ty.                                                  | —                      |
| A1       | Admin         | Nhập link Google Sheets nguồn vào màn hình Cài đặt kết nối.                                                  | FR-02.1                |
| A2       | Admin         | Chọn phương thức truy cập: đăng nhập OAuth (đọc Sheet riêng tư) hoặc dùng link đã publish/chia sẻ công khai. | FR-02.2                |
| A3       | Hệ thống      | Cổng quyết định theo phương thức truy cập đã chọn.                                                           | FR-02.2                |
| A4a      | Google Sheets | Người dùng cấp quyền OAuth trên Google (nếu chọn OAuth).                                                     | FR-02.2                |
| A4b      | Hệ thống      | Lưu access token, mã hoá khi lưu trữ, giới hạn thời gian sống (TTL).                                         | NFR-03                 |
| A4c      | Hệ thống      | Gọi Google Sheets API bằng API key/link công khai (nếu chọn Link công khai).                                 | FR-02.2                |
| A5       | Hệ thống      | Kiểm tra tính hợp lệ của link và quyền truy cập Sheet.                                                       | FR-02.3                |
| A6       | Hệ thống      | Cổng quyết định: link có hợp lệ và có quyền truy cập hay không?                                              | FR-02.3                |
| A6-No    | Hệ thống      | Hiển thị lỗi rõ ràng, yêu cầu Admin nhập lại link (quay lại bước A1).                                        | FR-02.3                |
| A7       | Admin         | Chọn tab/sheet cụ thể nếu file có nhiều tab.                                                                 | FR-02.4                |
| A8       | Hệ thống      | Đọc dòng tiêu đề (header) và dữ liệu mẫu, suy luận kiểu dữ liệu từng cột.                                    | FR-03.1                |
| A9       | Hệ thống      | Xác định (các) cột dạng ngày tháng để làm trục thời gian.                                                    | FR-03.2                |
| A10      | Hệ thống      | Cổng quyết định: có phát hiện được cột ngày tháng hay không?                                                 | FR-03.2                |
| A10-No   | Hệ thống      | Ẩn bộ lọc thời gian, vẫn hiển thị KPI/biểu đồ tổng quát không theo thời gian.                                | FR-03.5                |
| A11      | Hệ thống      | Xác định các cột số để tính KPI và các cột danh mục/văn bản để nhóm dữ liệu (group by).                      | FR-03.3, FR-03.4       |
| A12      | Hệ thống      | Tự động sinh tối đa 4–6 thẻ KPI và gợi ý loại biểu đồ phù hợp theo đặc tính dữ liệu.                         | FR-04.1, FR-05.1       |
| A13      | Admin         | Xem trước và điều chỉnh cấu hình KPI/biểu đồ (ẩn/hiện, sắp xếp lại).                                         | FR-10.2                |
| A14      | Admin         | Thiết lập Google Apps Script trigger (onEdit/onChange) trên Sheet nguồn để gọi webhook.                      | FR-08.4                |
| A15      | Hệ thống      | Sự kiện kết thúc: Dashboard sẵn sàng sử dụng, chuyển sang Giai đoạn B/C.                                     | —                      |

**6. Giai đoạn B — Sử dụng Dashboard hằng ngày & xuất báo cáo**

Giai đoạn này lặp lại mỗi khi người dùng (Admin hoặc Nhân viên) truy cập
Dashboard: chọn view, lọc thời gian, xem số liệu, làm mới dữ liệu theo
yêu cầu, và xuất báo cáo khi cần. Nhánh riêng dành cho Admin quản lý
tài khoản người dùng cũng được thể hiện.

![](./bpmn_media/media/5603549471707f82a7bc7a5a5307ba81216f1b2e.png)

*Hình 3 — BPMN chi tiết Giai đoạn B: Sử dụng Dashboard & xuất báo cáo*

|          |               |                                                                                          |                        |
| -------- | ------------- | ---------------------------------------------------------------------------------------- | ---------------------- |
| **Bước** | **Vai trò**   | **Mô tả**                                                                                | **Yêu cầu tham chiếu** |
| B0       | Người dùng    | Sự kiện bắt đầu: người dùng đăng nhập vào hệ thống.                                      | FR-01.1                |
| B1       | Hệ thống      | Cổng quyết định theo vai trò người dùng (Admin / Nhân viên).                             | FR-01.2                |
| B1a      | Admin         | (Nhánh Admin) Thấy thêm menu "Quản lý người dùng" trên Sidebar.                          | FR-06.3                |
| B1b      | Admin         | (Nhánh Admin) Thêm, khóa/mở khóa, đổi vai trò tài khoản người dùng khác.                 | FR-10.1                |
| B2       | Người dùng    | Chọn dashboard/view cần xem từ Sidebar điều hướng.                                       | FR-06.1                |
| B3       | Người dùng    | Chọn khung thời gian lọc: 1 / 7 / 30 / 90 ngày.                                          | FR-07.1                |
| B4       | Hệ thống      | Tính lại KPI và biểu đồ theo khung thời gian đã chọn, không cần tải lại trang.           | FR-07.2                |
| B5       | Người dùng    | Xem các thẻ KPI và biểu đồ; có thể đổi loại biểu đồ được gợi ý sang loại khác phù hợp.   | FR-05.2                |
| B6       | Người dùng    | Cổng quyết định: người dùng có bấm nút "Làm mới" hay không?                              | FR-08.1                |
| B6a      | Hệ thống      | Gọi lại Google Sheets API để lấy dữ liệu mới nhất từ Sheet nguồn.                        | FR-08.1                |
| B6b      | Google Sheets | Trả về dữ liệu mới nhất cho hệ thống.                                                    | —                      |
| B7       | Hệ thống      | Cổng quyết định: việc làm mới có thành công hay không?                                   | FR-08.3                |
| B7-No    | Hệ thống      | Hiển thị thông báo lỗi làm mới cho người dùng, quay lại màn hình xem.                    | FR-08.3                |
| B7-Yes   | Hệ thống      | Cập nhật thời điểm (timestamp) lần cập nhật dữ liệu gần nhất.                            | FR-08.2                |
| B8       | Người dùng    | Cổng quyết định: người dùng có muốn xuất báo cáo hay không?                              | —                      |
| B8a      | Người dùng    | Chọn xuất báo cáo dưới dạng PDF và/hoặc Excel.                                           | FR-09.1, FR-09.2       |
| B8b      | Hệ thống      | Đóng gói đúng dữ liệu và khung thời gian đang hiển thị tại thời điểm xuất.               | FR-09.3                |
| B8c      | Người dùng    | Tải file báo cáo xuống thiết bị.                                                         | FR-09.1                |
| B9       | —             | Sự kiện kết thúc: hoàn tất xuất báo cáo, hoặc kết thúc phiên xem nếu không xuất báo cáo. | —                      |

**7. Giai đoạn C — Đồng bộ tự động qua Webhook**

Giai đoạn này chạy độc lập, được kích hoạt bởi sự kiện (event-triggered)
mỗi khi Sheet nguồn thay đổi, không phụ thuộc thao tác của người dùng.
Đây là cơ chế đảm bảo Dashboard luôn cập nhật gần thời gian thực, kèm
theo phương án dự phòng khi webhook gặp sự cố.

![](./bpmn_media/media/6c65e3e7ebdac6216d800f8a8747235d2cd92929.png)

*Hình 4 — BPMN chi tiết Giai đoạn C: Đồng bộ tự động qua Webhook*

|          |               |                                                                                                            |                        |
| -------- | ------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------- |
| **Bước** | **Vai trò**   | **Mô tả**                                                                                                  | **Yêu cầu tham chiếu** |
| C0       | Google Sheets | Sự kiện bắt đầu (theo sự kiện): Sheet nguồn thay đổi dữ liệu (onEdit/onChange).                            | FR-08.4                |
| C1       | Google Sheets | Apps Script trigger tự động gọi đến endpoint Webhook của backend.                                          | FR-08.4                |
| C2       | Hệ thống      | Cổng quyết định: Webhook có được nhận và xử lý thành công hay không?                                       | FR-08.4                |
| C2-No    | Hệ thống      | Nếu thất bại (Apps Script bị gỡ, mất quyền, mất kết nối): hệ thống tự động rơi về cơ chế làm mới thủ công. | FR-08.6                |
| C3-No    | Admin         | Hệ thống cảnh báo Admin qua giao diện để kiểm tra và khắc phục.                                            | FR-08.6                |
| C2-Yes   | Hệ thống      | Đọc lại dữ liệu mới từ Sheet nguồn và cập nhật cache (Redis).                                              | FR-08.4                |
| C3-Yes   | Hệ thống      | Đẩy cập nhật tới các client đang mở Dashboard qua WebSocket/SSE (near real-time).                          | FR-08.5                |
| C4       | Người dùng    | Giao diện Dashboard tự động cập nhật KPI/biểu đồ mà không cần thao tác thủ công.                           | FR-08.5                |
| C5       | —             | Sự kiện kết thúc: đồng bộ hoàn tất, độ trễ mục tiêu dưới 10 giây trong điều kiện vận hành bình thường.     | NFR-09                 |

**8. Truy vết yêu cầu**

Mỗi bước trong 3 sơ đồ chi tiết (Giai đoạn A, B, C) đã được gắn mã yêu
cầu chức năng/phi chức năng (FR-xx / NFR-xx) tương ứng với SRS v1.0
mục 3 và mục 4, giúp truy vết đầy đủ hai chiều giữa mô hình quy trình
(BPMN) và đặc tả kỹ thuật (SRS), phục vụ kiểm thử và nghiệm thu theo mục
8 của BRD v1.0.

**9. Ghi chú & khuyến nghị**

  - File hình ảnh độ phân giải cao (.png) của cả 4 sơ đồ được đính kèm
    riêng cùng tài liệu này để phóng to xem chi tiết từng bước hoặc in
    khổ lớn (A3/A2) khi cần trình bày.

  - Nếu đội phát triển cần chỉnh sửa sơ đồ bằng công cụ BPMN chuẩn
    (Camunda Modeler, bpmn.io, draw.io), có thể yêu cầu chuyển đổi các
    sơ đồ này sang định dạng .bpmn (XML chuẩn BPMN 2.0).

  - Khuyến nghị rà soát sơ đồ này cùng đội phát triển trước khi bắt đầu
    giai đoạn thiết kế kỹ thuật chi tiết, đảm bảo mọi nhánh ngoại lệ đã
    được xử lý đúng như thiết kế kiến trúc mô-đun tại SRS mục 2.5.
