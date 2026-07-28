# TÀI LIỆU YÊU CẦU NGHIỆP VỤ

*(Business Requirements Document – BRD)*

**HỆ THỐNG DASHBOARD NỘI BỘ — TOKOSI**

| **Thông tin**     | **Nội dung**                                                        |
|-------------------|---------------------------------------------------------------------|
| Tên dự án         | Hệ thống Dashboard nội bộ TOKOSI (KiotViet → Google Sheets → Web)  |
| Phiên bản         | 1.1                                                                 |
| Ngày tạo          | 27/07/2026                                                          |
| Ngày cập nhật     | 28/07/2026                                                          |
| Đối tượng sử dụng | Ban lãnh đạo & nhân viên nội bộ công ty                            |
| Trạng thái        | Đang vận hành (Giai đoạn 1 đã triển khai)                          |

> **Ghi chú phiên bản 1.1:** Cập nhật để phản ánh đúng kiến trúc đã được xây dựng và triển khai thực tế. Các điều chỉnh chính so với v1.0: (1) xác định rõ nguồn dữ liệu là KiotViet thông qua Apps Script; (2) bỏ yêu cầu nhận diện cột tự động (hệ thống dùng schema cố định 8 sheet); (3) bỏ OAuth người dùng (dùng Service Account); (4) bỏ phân quyền Admin/Nhân viên trong Giai đoạn 1; (5) cập nhật stack công nghệ thực tế.

# 1. Giới thiệu

## 1.1. Mục đích tài liệu

Tài liệu này mô tả các yêu cầu nghiệp vụ cho Hệ thống Dashboard nội bộ TOKOSI — một website đọc dữ liệu KiotViet (qua Google Sheets trung gian) và hiển thị các KPI, biểu đồ trực quan theo thời gian thực, phục vụ việc theo dõi và ra quyết định kinh doanh.

## 1.2. Bối cảnh

Công ty TOKOSI là một tổng kho sỉ phân phối hàng hóa, vận hành trên phần mềm **KiotViet** (quản lý bán hàng, kho, khách hàng). Dữ liệu KiotViet được đồng bộ tự động sang **Google Sheets** (qua Apps Script `KiotVietExport.gs`) dưới dạng 8 sheet cố định: Hàng hóa, Hóa đơn, Chi tiết hóa đơn, Đặt hàng, Trả hàng, Khách hàng, Nhà cung cấp, Nhập hàng.

Trước đây, việc theo dõi số liệu phải thực hiện thủ công trên KiotViet và Google Sheets, gây mất thời gian tổng hợp và khó trực quan hóa xu hướng. Công ty cần một **Website Dashboard tập trung** đọc dữ liệu từ Google Sheets này, hiển thị các chỉ số quan trọng dưới dạng KPI card và biểu đồ, cập nhật gần thời gian thực mà không cần thao tác thủ công.

Hệ thống được xây dựng như nền móng kiến trúc để trong tương lai mở rộng thành nền tảng quản trị vận hành toàn diện.

## 1.3. Phạm vi tài liệu

Tài liệu tập trung vào yêu cầu nghiệp vụ của **Giai đoạn 1 (đã triển khai)**: Dashboard đọc từ Google Sheets KiotViet, hiển thị KPI và biểu đồ. Đồng thời nêu định hướng mở rộng dài hạn để kiến trúc Giai đoạn 1 được thiết kế theo hướng dễ mở rộng.

# 2. Mục tiêu dự án

- Xây dựng website Dashboard nội bộ, kết nối trực tiếp với Google Sheets nguồn (KiotViet export) qua Google Sheets API sử dụng Service Account.

- Hiển thị đầy đủ các KPI vận hành quan trọng: doanh thu hôm nay, số hóa đơn, tồn kho thấp, công nợ khách hàng/nhà cung cấp, đơn đặt hàng đang chờ xử lý, trả hàng, nhập hàng.

- Hỗ trợ bộ lọc thời gian **7 / 30 / 90 ngày** cho biểu đồ doanh thu theo ngày.

- Dữ liệu được đồng bộ **gần thời gian thực** từ KiotViet sang Google Sheets qua 2 cơ chế: (a) webhook KiotViet → Apps Script cho 6 nhóm dữ liệu chính, (b) lịch polling 5 phút cho 3 bảng KiotViet không có webhook (Trả hàng, Nhà cung cấp, Nhập hàng).

- Rút ngắn thời gian tổng hợp báo cáo, giúp lãnh đạo và nhân viên theo dõi số liệu bằng một cú truy cập web đơn giản.

- Xây dựng trên nền kiến trúc mô-đun, dễ mở rộng, làm nền tảng cho lộ trình dài hạn.

# 3. Phạm vi dự án

## 3.1. Trong phạm vi (In-scope) — Giai đoạn 1 đã triển khai

- **Nguồn dữ liệu cố định:** 1 Google Spreadsheet duy nhất (ID cố định theo cấu hình), chứa 8 sheet do Apps Script KiotVietExport.gs duy trì:

  | Sheet              | Dữ liệu                                                                  |
  |--------------------|--------------------------------------------------------------------------|
  | Hàng hóa           | Mã hàng, tên, nhóm, giá vốn, giá bán, tồn kho, khách đặt, trạng thái    |
  | Hóa đơn            | Mã HĐ, ngày bán, khách, nhân viên, chi nhánh, tổng tiền, trạng thái      |
  | Chi tiết hóa đơn   | Mã HĐ, mã hàng, tên hàng, số lượng, đơn giá, giảm giá, thành tiền        |
  | Đặt hàng           | Mã đặt, ngày đặt, khách, nhân viên, chi nhánh, tổng tiền, trạng thái     |
  | Trả hàng           | Mã trả, ngày trả, mã HĐ gốc, khách, tổng tiền trả, trạng thái            |
  | Khách hàng         | Mã KH, tên, SĐT, giới tính, nhóm, địa chỉ, email, nợ hiện tại, tổng bán  |
  | Nhà cung cấp       | Mã NCC, tên, SĐT, email, địa chỉ, nợ cần trả                             |
  | Nhập hàng          | Mã nhập, ngày nhập, NCC, chi nhánh, tổng tiền, trạng thái                |

- **KPI Dashboard:** các chỉ số tổng quan tính từ dữ liệu 8 sheet trên (xem mục 5.2).

- **Biểu đồ doanh thu theo ngày** với bộ lọc 7/30/90 ngày.

- **Các bảng dữ liệu chi tiết:** top sản phẩm bán chạy, hàng tồn thấp, công nợ khách hàng, biểu đồ phân bổ tồn kho theo nhóm hàng, đơn đặt hàng/trả hàng/nhập hàng gần nhất.

- **Cập nhật dữ liệu thủ công** qua nút "Làm mới" trên giao diện.

- **Đồng bộ tự động** từ KiotViet qua Apps Script (webhook + polling 5 phút), không cần thao tác từ phía web dashboard.

- **Truy cập không yêu cầu đăng nhập** trong Giai đoạn 1 (nội bộ, truy cập trực tiếp URL).

- **Triển khai trên Render.com** (cloud hosting), domain `tokosi.onrender.com`.

## 3.2. Ngoài phạm vi Giai đoạn 1 (Out-of-scope)

- Đăng nhập / phân quyền người dùng (Admin/Nhân viên) — dự kiến bổ sung Giai đoạn 2.

- Kết nối đồng thời nhiều Google Sheets / multi-tenant.

- Chỉnh sửa/ghi dữ liệu ngược lại vào Google Sheets hoặc KiotViet từ giao diện Dashboard.

- Xuất báo cáo PDF/Excel — dự kiến bổ sung ở giai đoạn sau.

- Nhận webhook trực tiếp từ KiotViet vào backend web (hiện tại webhook đi qua Apps Script → Google Sheets, backend chỉ đọc Sheets).

- Toàn bộ các module ở mục 3.3 (POS, Kho, Phân tích, AI).

## 3.3. Định hướng mở rộng dài hạn (Lộ trình sau Giai đoạn 1)

- **Giai đoạn 2:** Phân quyền người dùng (Admin/Nhân viên), xuất báo cáo PDF/Excel, quản lý tài khoản nội bộ.
- **Giai đoạn 3 — Bán hàng/POS:** nghiệp vụ tương đương KiotViet (tạo đơn bán, quản lý khách hàng, công nợ, in hóa đơn).
- **Giai đoạn 4 — Quản lý kho đa chi nhánh:** nhập/xuất/chuyển kho, kiểm kê, quản lý 5.000–20.000 SKU.
- **Giai đoạn 5 — Phân tích & Phát hiện bất thường:** phân tích xu hướng, dự đoán nhập hàng, phát hiện sai lệch tồn kho/giá.
- **Giai đoạn 6 — Danh bạ phòng ban:** sơ đồ tổ chức và danh bạ nhân sự.
- **Giai đoạn 7 — Trợ lý AI:** chatbot hỏi-đáp số liệu bằng ngôn ngữ tự nhiên.
- **Định hướng cuối:** thay thế hoàn toàn KiotViet.

# 4. Đối tượng liên quan (Stakeholders)

| **Vai trò**                    | **Mô tả trách nhiệm / nhu cầu**                                                               |
|--------------------------------|-----------------------------------------------------------------------------------------------|
| Ban lãnh đạo / Quản lý         | Theo dõi KPI tổng quan nhanh, ra quyết định dựa trên xu hướng dữ liệu.                        |
| Nhân viên kho / bán hàng       | Xem tồn kho, đơn hàng, trả hàng; theo dõi công nợ khách hàng và nhà cung cấp.                 |
| Người quản trị hệ thống (IT)   | Cấu hình biến môi trường (Spreadsheet ID, Service Account), duy trì Apps Script đồng bộ.      |
| Đội phát triển (Dev team)      | Xây dựng, kiểm thử và triển khai hệ thống, đảm bảo kiến trúc tương thích lộ trình mở rộng.   |

# 5. Yêu cầu nghiệp vụ chi tiết

## 5.1. Kết nối & đọc dữ liệu Google Sheets

- Hệ thống kết nối Google Sheets thông qua **Google Sheets API v4** bằng **Service Account** (không yêu cầu người dùng đăng nhập Google).

- `SPREADSHEET_ID` và `GOOGLE_SERVICE_ACCOUNT_JSON` được cấu hình qua biến môi trường (không hard-code trong code).

- Backend đọc **8 sheet cùng lúc** trong 1 lần gọi API (`batchGet`) để giảm độ trễ và tiết kiệm quota.

## 5.2. KPI tổng quan

Hệ thống tính toán và hiển thị các nhóm KPI sau từ dữ liệu 8 sheet:

| **Nhóm**                  | **KPI**                                                                                          |
|---------------------------|--------------------------------------------------------------------------------------------------|
| Bán hàng hôm nay          | Doanh thu hôm nay, số hóa đơn hoàn thành, số hóa đơn đã hủy                                     |
| Kỳ lọc (7/30/90 ngày)     | Doanh thu kỳ, số hóa đơn kỳ, biểu đồ doanh thu theo ngày                                        |
| Hàng hóa                  | Tổng mã hàng, tổng tồn kho, số mã đang có hàng, sản phẩm đang/ngừng kinh doanh, số mã tồn thấp  |
| Khách hàng                | Tổng khách hàng, số khách có công nợ, tổng công nợ khách hàng                                   |
| Nhà cung cấp              | Tổng NCC, số NCC có công nợ, tổng nợ cần trả NCC                                                |
| Đặt hàng                  | Số đơn đang chờ xử lý (Phiếu tạm/Đang xử lý/Đã xác nhận), tổng giá trị đang chờ               |
| Trả hàng                  | Tổng số lần trả hàng, tổng giá trị hàng trả                                                     |
| Nhập hàng                 | Tổng phiếu nhập, tổng giá trị nhập                                                              |

## 5.3. Biểu đồ & bảng dữ liệu chi tiết

- **Biểu đồ doanh thu theo ngày:** trục X là ngày (trong khoảng 7/30/90 ngày gần nhất), trục Y là doanh thu và số hóa đơn.

- **Top 10 sản phẩm bán chạy:** xếp hạng theo doanh thu, tính từ Chi tiết hóa đơn (loại trừ hóa đơn đã hủy).

- **Hàng tồn thấp:** danh sách sản phẩm có tồn kho ≤ 5 đơn vị.

- **Phân bổ tồn kho theo nhóm hàng:** biểu đồ top 15 nhóm.

- **Top 8 khách hàng có công nợ cao nhất.**

- **8 hóa đơn / đặt hàng / trả hàng / nhập hàng gần nhất** (sort theo thời gian).

## 5.4. Bộ lọc thời gian

- Người dùng chọn 1 trong 3 khung: **7 ngày / 30 ngày / 90 ngày** để xem biểu đồ doanh thu và KPI kỳ tương ứng.

- Mặc định là 30 ngày.

## 5.5. Cập nhật dữ liệu

**Thủ công:** Người dùng nhấn nút "Làm mới" → frontend gọi lại `GET /api/dashboard` → backend đọc Google Sheets API → trả dữ liệu mới.

**Tự động (phía Apps Script, không phụ thuộc backend web):**
- **Webhook KiotViet → Apps Script:** KiotViet gửi POST JSON mỗi khi có thay đổi Hàng hóa, Hóa đơn, Đặt hàng, Khách hàng, Nhóm hàng (9 loại event); Apps Script cập nhật đúng dòng trong Google Sheets ngay lập tức.
- **Polling 5 phút:** Apps Script trigger chạy mỗi 5 phút để đồng bộ Trả hàng, Nhà cung cấp, Nhập hàng (KiotViet không có webhook cho 3 nhóm này).

## 5.6. Truy cập & bảo mật (Giai đoạn 1)

- Dashboard truy cập trực tiếp qua URL, **không yêu cầu đăng nhập** trong Giai đoạn 1 (nội bộ, URL không public).

- Dữ liệu nhạy cảm (Service Account key, Spreadsheet ID) lưu trong biến môi trường trên Render, không commit vào code.

- Toàn bộ giao tiếp qua **HTTPS**.

# 6. Lợi ích kỳ vọng

- Tiết kiệm thời gian tổng hợp báo cáo thủ công từ KiotViet và Google Sheets.
- Ra quyết định nhanh hơn nhờ số liệu trực quan, luôn cập nhật gần thời gian thực.
- Chuẩn hóa cách theo dõi số liệu nội bộ, giảm phụ thuộc vào đọc sheet thô.
- Nền tảng kiến trúc dễ mở rộng thêm module theo lộ trình dài hạn.

# 7. Giả định & ràng buộc

## 7.1. Giả định

- Google Sheets nguồn được duy trì bởi Apps Script `KiotVietExport.gs` với **schema cố định** (tên sheet và thứ tự cột không thay đổi tùy tiện).

- Service Account `tokosi@tokosi.iam.gserviceaccount.com` đã được chia sẻ quyền Viewer trên Google Spreadsheet nguồn.

- KiotViet webhook và Apps Script trigger đang hoạt động để đảm bảo dữ liệu trong Sheets được cập nhật thường xuyên.

- Số lượng người dùng đồng thời dự kiến khoảng 10–50 người (nội bộ).

## 7.2. Ràng buộc

- Hệ thống chỉ đọc 1 Google Spreadsheet cố định (không đa nguồn, không multi-tenant).
- Backend chỉ **đọc** Google Sheets, không ghi ngược lại.
- Dữ liệu real-time phụ thuộc vào tính khả dụng của KiotViet webhook và Apps Script — nếu bị gián đoạn, dữ liệu có thể bị trễ đến lần sync tiếp theo.
- Giới hạn quota Google Sheets API: áp dụng cơ chế `batchGet` (1 lần gọi cho 8 sheet) để tối ưu.

# 8. Tiêu chí nghiệm thu (Acceptance Criteria)

- Dashboard hiển thị đầy đủ KPI, biểu đồ, bảng dữ liệu với dữ liệu đúng từ 8 sheet Google Sheets.
- Bộ lọc 7/30/90 ngày thay đổi biểu đồ và KPI kỳ đúng theo ngày thực tế.
- Nút "Làm mới" cập nhật dữ liệu mới nhất từ Sheets trong vòng vài giây.
- Hệ thống hoạt động ổn định trên Render.com, uptime >= 99% trong giờ hành chính.
- Không lộ thông tin nhạy cảm (Service Account key, Spreadsheet ID) ra phía client.
- Kiến trúc Giai đoạn 1 được tổ chức theo mô-đun rõ ràng, cho phép bổ sung module ở mục 3.3 mà không phải tái cấu trúc toàn bộ.

# 9. Kế hoạch triển khai tổng quan

## 9.1. Giai đoạn 1 — Dashboard (đã triển khai)

| **Bước**                          | **Nội dung**                                                                                      | **Trạng thái** |
|-----------------------------------|---------------------------------------------------------------------------------------------------|----------------|
| 1. Phân tích & thiết kế            | Hoàn thiện BRD, SRS, BPMN; thiết kế kiến trúc kỹ thuật                                           | Hoàn thành     |
| 2. Apps Script đồng bộ KiotViet    | `KiotVietExport.gs`: sync toàn bộ, webhook real-time, polling 5 phút cho 3 bảng không có webhook | Hoàn thành     |
| 3. Backend Node.js/Express         | API `/api/dashboard`, đọc 8 sheet bằng `batchGet`, tính toán KPI & dữ liệu biểu đồ               | Hoàn thành     |
| 4. Frontend HTML/CSS/JS            | Giao diện Dashboard: Sidebar, KPI cards, biểu đồ doanh thu, bảng chi tiết, bộ lọc thời gian      | Hoàn thành     |
| 5. Triển khai Render.com           | Deploy lên `tokosi.onrender.com`, cấu hình biến môi trường                                        | Hoàn thành     |
| 6. Phân quyền & xuất báo cáo       | Module Admin/Nhân viên, xuất PDF/Excel                                                            | Giai đoạn 2    |

## 9.2. Lộ trình dài hạn (định hướng)

| **Giai đoạn**                                   | **Nội dung chính**                                                                                      | **Ghi chú**                                                          |
|-------------------------------------------------|---------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------|
| Giai đoạn 2 — Phân quyền & xuất báo cáo         | Đăng nhập nội bộ, phân quyền Admin/Nhân viên, xuất PDF/Excel                                           | Ưu tiên triển khai ngay sau Giai đoạn 1                              |
| Giai đoạn 3 — Bán hàng/POS                      | Tạo đơn bán, quản lý khách hàng, công nợ, in hóa đơn — tương đương nghiệp vụ KiotViet                  | Sau Giai đoạn 2                                                      |
| Giai đoạn 4 — Kho đa chi nhánh                  | Nhập/xuất/chuyển kho, tồn kho theo từng kho, kiểm kê định kỳ cho 5.000–20.000 SKU                      | Phụ thuộc dữ liệu chuẩn hoá từ Giai đoạn 3                           |
| Giai đoạn 5 — Phân tích & phát hiện bất thường  | Phân tích doanh số, dự đoán nhu cầu nhập hàng, phát hiện sai lệch tồn kho/giá bất thường               | Cần dữ liệu lịch sử đủ lớn từ Giai đoạn 3–4                          |
| Giai đoạn 6 — Danh bạ phòng ban                 | Sơ đồ tổ chức, danh bạ nhân sự (dạng xem thông tin)                                                    | Có thể triển khai song song, độc lập                                 |
| Giai đoạn 7 — Trợ lý AI                         | Chatbot hỏi-đáp số liệu bằng ngôn ngữ tự nhiên; AI dự đoán & phát hiện bất thường tự động             | Ưu tiên chatbot trước; cần dữ liệu chuẩn hoá từ các giai đoạn trước  |
| Giai đoạn 8 — Thay thế KiotViet                 | Ngừng sử dụng KiotViet, chuyển hoàn toàn nghiệp vụ sang hệ thống mới                                   | Chỉ thực hiện khi Giai đoạn 3–4 đã ổn định và nghiệm thu đầy đủ      |

*— Hết tài liệu BRD v1.1 —*
