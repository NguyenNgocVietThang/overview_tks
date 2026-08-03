# TÀI LIỆU YÊU CẦU NGHIỆP VỤ

*(Business Requirements Document – BRD)*

**HỆ THỐNG DASHBOARD NỘI BỘ — TOKOSI**

| **Thông tin**     | **Nội dung**                                                        |
|-------------------|---------------------------------------------------------------------|
| Tên dự án         | Hệ thống Dashboard nội bộ TOKOSI (KiotViet → Google Sheets → Web)  |
| Phiên bản         | 1.2                                                                 |
| Ngày tạo          | 27/07/2026                                                          |
| Ngày cập nhật     | 31/07/2026                                                          |
| Đối tượng sử dụng | Ban lãnh đạo & nhân viên nội bộ công ty                            |
| Trạng thái        | Đang vận hành (Giai đoạn 1 đã triển khai)                          |

> **Ghi chú phiên bản 1.2:** Bổ sung cơ chế làm mới dashboard tự động mỗi 10 phút và khi người dùng quay lại tab trình duyệt; chuẩn hóa toàn bộ phép tính ngày giờ theo múi giờ Việt Nam; backend đọc đủ 9 tab dữ liệu, gồm tab Nhóm hàng để gom tồn kho theo nhóm cha; bổ sung khả năng tiếp tục hiển thị khi một tab nguồn bị thiếu hoặc đổi tên.

# 1. Giới thiệu

## 1.1. Mục đích tài liệu

Tài liệu này mô tả các yêu cầu nghiệp vụ cho Hệ thống Dashboard nội bộ TOKOSI — một website đọc dữ liệu KiotViet (qua Google Sheets trung gian) và hiển thị các KPI, biểu đồ trực quan theo thời gian thực, phục vụ việc theo dõi và ra quyết định kinh doanh.

## 1.2. Bối cảnh

Công ty TOKOSI là một tổng kho sỉ phân phối hàng hóa, vận hành trên phần mềm **KiotViet** (quản lý bán hàng, kho, khách hàng). Dữ liệu KiotViet được đồng bộ tự động sang **Google Sheets** (qua Apps Script module trong `src/`) dưới dạng 9 tab dữ liệu vận hành và 5 tab báo cáo. Backend dashboard đọc 9 tab vận hành; tab Nhóm hàng cung cấp quan hệ nhóm cha–con cho biểu đồ tồn kho, còn năm tab báo cáo phục vụ đối soát trực tiếp trên Google Sheets.

Trước đây, việc theo dõi số liệu phải thực hiện thủ công trên KiotViet và Google Sheets, gây mất thời gian tổng hợp và khó trực quan hóa xu hướng. Công ty cần một **Website Dashboard tập trung** đọc dữ liệu từ Google Sheets này, hiển thị các chỉ số quan trọng dưới dạng KPI card và biểu đồ, cập nhật gần thời gian thực mà không cần thao tác thủ công.

Hệ thống được xây dựng như nền móng kiến trúc để trong tương lai mở rộng thành nền tảng quản trị vận hành toàn diện.

## 1.3. Phạm vi tài liệu

Tài liệu tập trung vào yêu cầu nghiệp vụ của **Giai đoạn 1 (đã triển khai)**: Dashboard đọc từ Google Sheets KiotViet, hiển thị KPI và biểu đồ. Đồng thời nêu định hướng mở rộng dài hạn để kiến trúc Giai đoạn 1 được thiết kế theo hướng dễ mở rộng.

# 2. Mục tiêu dự án

- Xây dựng website Dashboard nội bộ, kết nối trực tiếp với Google Sheets nguồn (KiotViet export) qua Google Sheets API sử dụng Service Account.

- Hiển thị đầy đủ các KPI vận hành quan trọng: doanh thu hôm nay, số hóa đơn, hàng đã hết, công nợ khách hàng/nhà cung cấp, đơn đặt hàng đang chờ xử lý, trả hàng, nhập hàng.

- Hỗ trợ bộ lọc thời gian **7 / 30 / 90 ngày** cho biểu đồ doanh thu theo ngày.

- Tự động tải lại dữ liệu dashboard mỗi 10 phút và tải bù khi người dùng quay lại một tab trình duyệt đã bị ẩn quá một chu kỳ làm mới.

- Bảo đảm các KPI theo ngày và thời điểm cập nhật luôn được tính theo múi giờ **Asia/Ho_Chi_Minh (UTC+7)**, không phụ thuộc múi giờ của máy chủ Render.

- Dữ liệu được đồng bộ **gần thời gian thực** từ KiotViet sang Google Sheets qua 2 cơ chế: (a) webhook KiotViet → Apps Script cho 6 nhóm dữ liệu chính, (b) lịch polling 5 phút cho 3 bảng KiotViet không có webhook (Trả hàng, Nhà cung cấp, Nhập hàng).

- Tab **Báo cáo bán hàng** bám theo file xuất KiotViet trong tháng hiện tại với 18 cột: thông tin khách hàng, số đơn/tổng tiền/giảm giá/doanh thu/trả hàng và chi tiết từng giao dịch; tự động làm mới hàng ngày lúc gần 07:00 theo múi giờ Việt Nam.

- Tab **Hàng bán theo khách** liệt kê từng mặt hàng của hóa đơn hoàn thành trong 90 ngày qua với đúng 5 cột: Khách hàng, Mã hàng, Tên hàng, SL mua chi tiết, Thời gian. Hóa đơn mới/sửa/hủy được phản ánh qua webhook trong khoảng 1 phút; lượt 07:00 đối soát lại toàn bộ dữ liệu.

- Ba tab **HN1**, **HN3**, **HN7** tổng hợp công nợ khách hàng cho 1/3/7 ngày gần đây tính cả hôm nay, dùng cấu trúc 25 cột của file xuất KiotViet nhưng chỉ hiển thị một dòng cho mỗi khách hàng; nhiều giao dịch hoặc mặt hàng được ghép trong ô bằng dấu `|`; tự động làm mới hằng ngày gần 15:00.

- Rút ngắn thời gian tổng hợp báo cáo, giúp lãnh đạo và nhân viên theo dõi số liệu bằng một cú truy cập web đơn giản.

- Xây dựng trên nền kiến trúc mô-đun, dễ mở rộng, làm nền tảng cho lộ trình dài hạn.

# 3. Phạm vi dự án

## 3.1. Trong phạm vi (In-scope) — Giai đoạn 1 đã triển khai

- **Nguồn dữ liệu cố định:** 1 Google Spreadsheet duy nhất (ID cố định theo cấu hình), chứa 9 tab vận hành và 5 tab báo cáo do Apps Script duy trì. Backend dashboard đọc 9 tab vận hành:

  | Tab                | Dữ liệu                                                                  | Backend đọc |
  |--------------------|--------------------------------------------------------------------------|-------------|
  | Nhóm hàng          | Mã nhóm, tên nhóm, mã nhóm cha                                             | Có          |
  | Hàng hóa           | Mã hàng, tên, nhóm, mã nhóm, giá vốn, giá bán, tồn kho, khách đặt, trạng thái | Có       |
  | Hóa đơn            | Mã HĐ, ngày bán, khách, nhân viên, chi nhánh, tổng tiền, trạng thái      | Có          |
  | Chi tiết hóa đơn   | Mã HĐ, mã hàng, tên hàng, số lượng, đơn giá, giảm giá, thành tiền        | Có          |
  | Đặt hàng           | Mã đặt, ngày đặt, khách, nhân viên, chi nhánh, tổng tiền, trạng thái     | Có          |
  | Trả hàng           | Mã trả, ngày trả, mã HĐ gốc, khách, tổng tiền trả, trạng thái            | Có          |
  | Khách hàng         | Mã KH, tên, SĐT, giới tính, nhóm, địa chỉ, email, nợ hiện tại, tổng bán  | Có          |
  | Nhà cung cấp       | Mã NCC, tên, SĐT, email, địa chỉ, nợ cần trả                             | Có          |
  | Nhập hàng          | Mã nhập, ngày nhập, NCC, chi nhánh, tổng tiền, trạng thái                | Có          |
  | Báo cáo bán hàng | 18 cột theo file xuất KiotViet: khách hàng, tổng hợp bán/trả và chi tiết từng giao dịch trong tháng hiện tại | Không |
  | Hàng bán theo khách | Khách hàng, mã hàng, tên hàng, SL mua chi tiết, thời gian của từng dòng hàng bán trong 90 ngày qua | Có |
  | HN1 / HN3 / HN7 | Công nợ khách hàng 1/3/7 ngày tính cả hôm nay, đúng 25 cột của báo cáo KiotViet | Không |

- **KPI Dashboard:** các chỉ số tổng quan tính từ dữ liệu 9 sheet trên (xem mục 5.2).

- **Biểu đồ doanh thu theo ngày** với bộ lọc 7/30/90 ngày.

- **Các bảng dữ liệu chi tiết:** top sản phẩm bán chạy, hàng đã hết, công nợ khách hàng, biểu đồ phân bổ tồn kho theo nhóm hàng, đơn đặt hàng/trả hàng/nhập hàng gần nhất.

- **Cập nhật dữ liệu trên dashboard:** thủ công qua nút "Làm mới", tự động mỗi 10 phút và tải bù khi người dùng quay lại tab trình duyệt sau ít nhất 10 phút.

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

- Backend lấy danh sách tab hiện có, lọc 9 tab dữ liệu dashboard theo tên rồi đọc các tab tồn tại bằng một lệnh `batchGet` để giảm độ trễ và tránh một tab thiếu/đổi tên làm lỗi toàn bộ dashboard.

- Tab được kỳ vọng nhưng chưa tồn tại được xem như tập dữ liệu rỗng; các phần khác của dashboard vẫn hiển thị bình thường. Danh sách tab thực tế được cung cấp qua route chẩn đoán `/api/debug` cho IT Admin.

## 5.2. KPI tổng quan

Hệ thống tính toán và hiển thị các nhóm KPI sau từ 9 tab dữ liệu dashboard:

| **Nhóm**                  | **KPI**                                                                                          |
|---------------------------|--------------------------------------------------------------------------------------------------|
| Bán hàng hôm nay          | Doanh thu hôm nay, số hóa đơn hoàn thành, số hóa đơn đã hủy                                     |
| Kỳ lọc (7/30/90 ngày)     | Doanh thu kỳ, số hóa đơn kỳ, biểu đồ doanh thu theo ngày                                        |
| Hàng hóa                  | Tổng mã hàng, tổng tồn kho, số mã đang có hàng, sản phẩm đang/ngừng kinh doanh, số mã đã hết hàng |
| Khách hàng                | Tổng khách hàng, số khách có công nợ, tổng công nợ khách hàng                                   |
| Nhà cung cấp              | Tổng NCC, số NCC có công nợ, tổng nợ cần trả NCC                                                |
| Đặt hàng                  | Số đơn đang chờ xử lý (Phiếu tạm/Đang xử lý/Đã xác nhận), tổng giá trị đang chờ               |
| Trả hàng                  | Tổng số lần trả hàng, tổng giá trị hàng trả                                                     |
| Nhập hàng                 | Tổng phiếu nhập, tổng giá trị nhập                                                              |

## 5.3. Biểu đồ & bảng dữ liệu chi tiết

- **Biểu đồ doanh thu theo ngày:** trục X là ngày (trong khoảng 7/30/90 ngày gần nhất), trục Y là doanh thu và số hóa đơn.

- **Top 10 sản phẩm bán chạy:** xếp hạng theo doanh thu, tính từ Chi tiết hóa đơn (loại trừ hóa đơn đã hủy).

- **Hàng đã hết:** danh sách sản phẩm có tồn kho = 0.

- **Tỷ lệ giá trị tồn kho theo nhóm cha:** biểu đồ cột toàn chiều ngang, lấy `Giá vốn × max(Tồn kho, 0)` và gom các nhóm con về nhóm cha theo tab Nhóm hàng. Dòng để trống `Mã nhóm cha` được xem là nhóm cha gốc. Trục ngang hiển thị tối đa 30 cột; nếu vượt quá thì giữ 29 nhóm có giá trị lớn nhất và gộp phần còn lại vào `Khác`.

- **Phân bổ số lượng tồn kho theo nhóm cha:** biểu đồ tròn gom các nhóm con về nhóm cha theo tab Nhóm hàng; dòng để trống `Mã nhóm cha` được xem là nhóm cha gốc.

- **Top 8 khách hàng có công nợ cao nhất.**

- **8 hóa đơn / đặt hàng / trả hàng / nhập hàng gần nhất** (sort theo thời gian).

## 5.4. Bộ lọc thời gian

- Người dùng chọn 1 trong 3 khung: **7 ngày / 30 ngày / 90 ngày** để xem biểu đồ doanh thu và KPI kỳ tương ứng.

- Mặc định là 30 ngày.

- Ranh giới "hôm nay", các ngày trong kỳ lọc và timestamp `updatedAt` được xác định theo múi giờ **Asia/Ho_Chi_Minh (UTC+7)**.

## 5.5. Cập nhật dữ liệu

**Trên dashboard:**
- **Thủ công:** Người dùng nhấn nút "Làm mới" → frontend gọi lại `GET /api/dashboard` → backend đọc Google Sheets API → trả dữ liệu mới.
- **Định kỳ:** Frontend tự gọi lại API mỗi 10 phút, chỉ render lại nội dung khi dữ liệu nghiệp vụ thay đổi.
- **Khi quay lại tab:** Nếu tab trình duyệt đã bị ẩn ít nhất 10 phút, frontend tải lại dữ liệu ngay khi tab trở lại trạng thái hiển thị để timestamp không bị cũ do trình duyệt tạm dừng bộ hẹn giờ nền.

**Đồng bộ nguồn (phía Apps Script, không phụ thuộc backend web):**
- **Webhook KiotViet → Apps Script:** KiotViet gửi POST JSON mỗi khi có thay đổi Hàng hóa, Hóa đơn, Đặt hàng, Khách hàng, Nhóm hàng (9 loại event); Apps Script cập nhật đúng dòng trong Google Sheets, đồng thời thay các dòng tương ứng trong `Hàng bán theo khách` khi hóa đơn đổi.
- **Polling 5 phút:** Apps Script trigger chạy mỗi 5 phút để đồng bộ Trả hàng, Nhà cung cấp, Nhập hàng (KiotViet không có webhook cho 3 nhóm này).
- **Đối soát công nợ 15:00:** Apps Script làm mới HN1/HN3/HN7 hằng ngày; trigger hàng đợi 1 phút chạy bù sau 15:00 nếu lượt chính bị trễ hoặc lỗi.

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

- Google Sheets nguồn được duy trì bởi Apps Script `src/kiotviet/SheetSchemas.gs` với **schema cố định**: cột dashboard ở bên trái, trường KiotViet mở rộng ở bên phải.

- Service Account `tokosi@tokosi.iam.gserviceaccount.com` đã được chia sẻ quyền Viewer trên Google Spreadsheet nguồn.

- KiotViet webhook và Apps Script trigger đang hoạt động để đảm bảo dữ liệu trong Sheets được cập nhật thường xuyên.

- Số lượng người dùng đồng thời dự kiến khoảng 10–50 người (nội bộ).

## 7.2. Ràng buộc

- Hệ thống chỉ đọc 1 Google Spreadsheet cố định (không đa nguồn, không multi-tenant).
- Backend chỉ **đọc** Google Sheets, không ghi ngược lại.
- Dữ liệu real-time phụ thuộc vào tính khả dụng của KiotViet webhook và Apps Script — nếu bị gián đoạn, dữ liệu có thể bị trễ đến lần sync tiếp theo.
- Giới hạn quota Google Sheets API: mỗi lần tải dashboard cần một request metadata để liệt kê tab và một `batchGet` cho các tab dữ liệu đang tồn tại.
- Nếu một tab dữ liệu bị thiếu hoặc đổi tên, phần dữ liệu tương ứng hiển thị rỗng/0 cho đến khi IT Admin khôi phục đúng schema; dashboard không dừng toàn bộ vì lỗi range không tồn tại.

# 8. Tiêu chí nghiệm thu (Acceptance Criteria)

- Dashboard hiển thị đầy đủ KPI, biểu đồ, bảng dữ liệu với dữ liệu đúng từ 9 tab dữ liệu Google Sheets.
- Bộ lọc 7/30/90 ngày thay đổi biểu đồ và KPI kỳ đúng theo ngày thực tế.
- Nút "Làm mới" cập nhật dữ liệu mới nhất từ Sheets trong vòng vài giây.
- Dashboard tự làm mới sau mỗi 10 phút; khi quay lại tab đã ẩn quá 10 phút, dữ liệu được tải lại ngay.
- KPI "hôm nay", chuỗi ngày trên biểu đồ và `updatedAt` thống nhất theo múi giờ Asia/Ho_Chi_Minh.
- Khi thiếu một tab nguồn, dashboard vẫn trả kết quả cho các phần dữ liệu còn lại và route `/api/debug` liệt kê được các tab thực tế.
- HN1/HN3/HN7 dùng đúng cửa sổ 1/3/7 ngày tính cả hôm nay, đủ 25 cột như file xuất KiotViet và chỉ có một dòng cho mỗi khách hàng; các chi tiết phát sinh được ghép trong ô bằng dấu `|`. Báo cáo được cập nhật hằng ngày gần 15:00 theo giờ Việt Nam.
- Hệ thống hoạt động ổn định trên Render.com, uptime >= 99% trong giờ hành chính.
- Không lộ thông tin nhạy cảm (Service Account key, Spreadsheet ID) ra phía client.
- Kiến trúc Giai đoạn 1 được tổ chức theo mô-đun rõ ràng, cho phép bổ sung module ở mục 3.3 mà không phải tái cấu trúc toàn bộ.

# 9. Kế hoạch triển khai tổng quan

## 9.1. Giai đoạn 1 — Dashboard (đã triển khai)

| **Bước**                          | **Nội dung**                                                                                      | **Trạng thái** |
|-----------------------------------|---------------------------------------------------------------------------------------------------|----------------|
| 1. Phân tích & thiết kế            | Hoàn thiện BRD, SRS, BPMN; thiết kế kiến trúc kỹ thuật                                           | Hoàn thành     |
| 2. Apps Script đồng bộ KiotViet    | `src/`: sync đủ trường, webhook real-time, polling 5 phút cho 3 bảng không có webhook | Hoàn thành     |
| 3. Backend Node.js/Express         | API `/api/dashboard`, lọc tab hiện có rồi `batchGet`, tính KPI theo giờ Việt Nam                 | Hoàn thành     |
| 4. Frontend HTML/CSS/JS            | Dashboard, bộ lọc thời gian, làm mới thủ công/tự động 10 phút và tải bù khi quay lại tab          | Hoàn thành     |
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

*— Hết tài liệu BRD v1.2 —*
