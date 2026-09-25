# TÀI LIỆU YÊU CẦU NGHIỆP VỤ

*(Business Requirements Document – BRD)*

**HỆ THỐNG DASHBOARD NỘI BỘ — TOKOSI**

| **Thông tin**     | **Nội dung**                                                        |
|-------------------|---------------------------------------------------------------------|
| Tên dự án         | Hệ thống Dashboard nội bộ TOKOSI (KiotViet → Supabase PostgreSQL + Google Sheets → Web) |
| Phiên bản         | 2.0                                                                 |
| Ngày tạo          | 27/07/2026                                                          |
| Ngày cập nhật     | 19/09/2026                                                          |
| Đối tượng sử dụng | Ban lãnh đạo, nhân viên nội bộ công ty & khách hàng tra cứu        |
| Trạng thái        | Đang vận hành (Kiến trúc Supabase PostgreSQL, Quản lý công nợ CN1/CN3/CN7, HR Leave, Vòng đời đơn hàng, 717 unit tests) |

> **Ghi chú phiên bản 2.0:** Chuyển đổi toàn diện dữ liệu KiotViet từ Google Sheets sang **Supabase PostgreSQL** làm kho lưu trữ chính. Engine `server/kiotvietSync/` (Node.js) đồng bộ KiotViet trực tiếp qua Webhook + Polling. Hai file Google Sheets Kiot HN/SG chỉ còn đọc tab **`Trả NCC`**. Tính năng **Vòng đời đơn hàng** (`ORDER_LIFECYCLE_SPREADSHEET_ID`) và **Nhân sự** (`HR_SPREADSHEET_ID`) tiếp tục duy trì qua Google Sheets. Chuẩn hóa ba kỳ công nợ 1/3/7 ngày thành **CN1 / CN3 / CN7** lưu trong bảng Supabase `customer_debt_activity_periods`. Nghỉ hưu hoàn toàn Apps Script (`src-dashboard`) và module vận chuyển cũ. Quản trị tài khoản chuyển sang bảng PostgreSQL `app_users`. Hệ thống đạt **717 unit tests** chuẩn `node:test`.

# 1. Giới thiệu

## 1.1. Mục đích tài liệu

Tài liệu này mô tả các yêu cầu nghiệp vụ cho Hệ thống Dashboard nội bộ TOKOSI — một website đọc dữ liệu KiotViet (qua Supabase PostgreSQL và Google Sheets có chọn lọc) và hiển thị các KPI, biểu đồ trực quan theo thời gian thực, phục vụ việc theo dõi và ra quyết định kinh doanh.

## 1.2. Bối cảnh

Công ty TOKOSI là một tổng kho sỉ phân phối hàng hóa, vận hành trên phần mềm **KiotViet** (quản lý bán hàng, kho, khách hàng). Dữ liệu KiotViet được đồng bộ tự động vào **Supabase PostgreSQL** (thông qua engine Node.js `server/kiotvietSync/`) gồm hàng hóa, hóa đơn, đặt hàng, trả hàng, khách hàng, nhà cung cấp, nhập hàng, thu chi và các bảng tổng hợp. Hai file Google Sheets Kiot HN/SG chỉ còn lưu tab **`Trả NCC`** để nhập thủ công. Ba kỳ công nợ 1/3/7 ngày (**CN1 / CN3 / CN7**) được tính toán và lưu trực tiếp trong bảng `customer_debt_activity_periods`. Tính năng Vòng đời đơn hàng (`DonHang_HN`, `DonHang_SG`, `Lịch sử cập nhật`) và Phân hệ Nhân sự (`HR_*`) tiếp tục vận hành trên Google Sheets độc lập.

Trước đây, việc theo dõi số liệu phải thực hiện thủ công trên KiotViet và Google Sheets, gây mất thời gian tổng hợp và khó trực quan hóa xu hướng. Công ty cần một **Website Dashboard tập trung** đọc dữ liệu từ Supabase PostgreSQL và Google Sheets, hiển thị các chỉ số quan trọng dưới dạng KPI card và biểu đồ, cập nhật gần thời gian thực mà không cần thao tác thủ công.

Hệ thống được xây dựng như nền móng kiến trúc để trong tương lai mở rộng thành nền tảng quản trị vận hành toàn diện.

## 1.3. Phạm vi tài liệu

Tài liệu tập trung vào yêu cầu nghiệp vụ của **Giai đoạn 1 & Nâng cấp PostgreSQL**: Dashboard đọc từ Supabase PostgreSQL và Google Sheets, hiển thị KPI, biểu đồ, Quản lý công nợ theo cơ sở (đối chiếu CN1/CN3/CN7), tìm kiếm đa chế độ, phân trang bảng lớn, xuất file Excel, Tra cứu vòng đời đơn hàng và Phân hệ Nhân sự HR. Đồng thời nêu định hướng mở rộng dài hạn để kiến trúc được thiết kế theo hướng dễ mở rộng.

# 2. Mục tiêu dự án

- Xây dựng website Dashboard nội bộ, kết nối trực tiếp với cơ sở dữ liệu Supabase PostgreSQL cho dữ liệu KiotViet và Google Sheets API cho các tab bổ trợ (`Trả NCC`, Vòng đời đơn hàng, HR).

- Hiển thị đầy đủ các KPI vận hành quan trọng: doanh thu hôm nay, số hóa đơn, hàng đã hết, công nợ khách hàng/nhà cung cấp, đơn đặt hàng đang chờ xử lý, trả hàng, nhập hàng.

- Hỗ trợ bộ lọc thời gian **7 / 30 / 90 ngày** cho biểu đồ doanh thu theo ngày.

- Tự động tải lại dữ liệu dashboard mỗi 10 phút và tải bù khi người dùng quay lại một tab trình duyệt đã bị ẩn quá một chu kỳ làm mới; tích hợp Result Cache cho tốc độ phản hồi tức thì khi chuyển tab.

- Bảo đảm các KPI theo ngày và thời điểm cập nhật luôn được tính theo múi giờ **Asia/Ho_Chi_Minh (UTC+7)**, không phụ thuộc múi giờ của máy chủ Render.

- Cung cấp tính năng **Xuất Excel** trực tiếp cho các bảng dữ liệu, kết quả tìm kiếm và báo cáo nghỉ phép nhân viên với tùy chọn trường linh hoạt, định dạng hoàn chỉnh.

- Phân trang mượt mà cho bảng dữ liệu lớn (trên 7.000 sản phẩm) nhằm đảm bảo giao diện luôn phản hồi nhanh chóng, không bị đơ giật.

- Dữ liệu KiotViet được đồng bộ **gần thời gian thực** vào Supabase PostgreSQL qua 2 cơ chế: (a) Webhook KiotViet đẩy trực tiếp vào hàng đợi Node.js, (b) Polling và đối soát định kỳ bởi `syncDriver.js` và scheduler; bảng rollup theo ngày làm mới mỗi 5 phút.

- Ba kỳ công nợ **CN1**, **CN3**, **CN7** (công nợ khách hàng 1/3/7 ngày gần đây, trước đây gọi là HN1/HN3/HN7) do scheduler `customerDebtReportRefresh.js` tự động tính từ database và lưu vào `customer_debt_activity_periods`, phục vụ cảnh báo "Chưa thu" trên màn hình Quản lý công nợ.

- **Phân hệ Quản lý Nghỉ phép HR & Telegram Bot:** Cung cấp kênh nộp đơn xin nghỉ phép, tra cứu số dư ngày phép trực tuyến 24/7 qua Web Portal và Telegram Bot. Yêu cầu nghỉ mới được thông báo trên web cho toàn bộ tài khoản; quản lý có thể duyệt hoặc từ chối ngay trong thông báo, và kết quả được báo lại cho nhân viên.

- **Tra cứu Vòng đời đơn hàng:** Cho phép khách hàng và nhân viên nội bộ tra cứu trạng thái đơn hàng theo mã đơn qua Google Sheets `ORDER_LIFECYCLE_SPREADSHEET_ID`.

- Rút ngắn thời gian tổng hợp báo cáo, giúp lãnh đạo và nhân viên theo dõi số liệu bằng một cú truy cập web đơn giản.

- Xây dựng trên nền kiến trúc mô-đun, dễ mở rộng, làm nền tảng cho lộ trình dài hạn.

# 3. Phạm vi dự án

## 3.1. Trong phạm vi (In-scope)

- **Nguồn dữ liệu:**
  - **Supabase PostgreSQL:** lưu toàn bộ dữ liệu KiotViet (nhóm hàng, hàng hóa, hóa đơn, chi tiết hóa đơn, đặt hàng, trả hàng, khách hàng, nhà cung cấp, nhập hàng, thu chi, tài khoản `app_users`, nhân sự `hr_employees`, và bảng công nợ `customer_debt_activity_periods` cho CN1/CN3/CN7).
  - **Google Sheets:**
    - Hai file Kiot HN/SG: chỉ đọc tab `Trả NCC` (dữ liệu nhập thủ công).
    - File Quản lý công nợ (`DEBT_MANAGEMENT_SPREADSHEET_ID`): đọc bảng công nợ quản lý theo cơ sở.
    - File Vòng đời đơn hàng (`ORDER_LIFECYCLE_SPREADSHEET_ID`): đọc `DonHang_HN`, `DonHang_SG`, `Lịch sử cập nhật`.
    - File Nhân sự (`HR_SPREADSHEET_ID`): đọc `HR_Leaves`, danh sách nhân viên và chính sách phép.

- **KPI Dashboard:** các chỉ số tổng quan tính từ dữ liệu PostgreSQL và tab Trả NCC (xem mục 5.2).

- **Biểu đồ doanh thu theo ngày** với bộ lọc 7/30/90 ngày.

- **Các bảng dữ liệu chi tiết:** top sản phẩm bán chạy, hàng đã hết, công nợ khách hàng, biểu đồ phân bổ tồn kho theo nhóm hàng, đơn đặt hàng/trả hàng/nhập hàng gần nhất.

- **Màn hình Quản lý công nợ:** thay thế tab công nợ kỳ cũ; kết hợp workbook Bảng công nợ, đối chiếu ba kỳ CN1/CN3/CN7, và lưu trạng thái xử lý trong PostgreSQL.

- **Cập nhật dữ liệu trên dashboard:** thủ công qua nút "Làm mới", tự động mỗi 10 phút và tải bù khi người dùng quay lại tab trình duyệt sau ít nhất 10 phút.

- **Đồng bộ tự động** từ KiotViet vào Supabase PostgreSQL qua Node.js sync engine (Webhook + Polling).

- **Xác thực & phân quyền (Phase 0):** Đăng nhập nội bộ bằng tài khoản trong tab `Users`, hỗ trợ Google Sign-In, và cho phép Khách tự đăng ký để tra cứu vận chuyển đơn hàng.

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
**Đồng bộ nguồn (Node.js Sync Engine):**
- **Webhook KiotViet → Node.js:** KiotViet gửi POST JSON webhook về endpoint `/api/internal/kiotviet-sync/webhook`; server ghi vào hàng đợi nền và cập nhật tức thì vào Supabase PostgreSQL.
- **Polling & Đối soát:** Scheduler chạy định kỳ mỗi 5-15 phút đối soát số liệu và bù đắp các sự kiện bị sót.
- **Dữ liệu công nợ CN1/CN3/CN7:** Scheduler gọi `customerDebtReportRefresh.js` tự động tính và ghi ba kỳ công nợ 1/3/7 ngày (CN1/CN3/CN7, trước đây gọi là HN1/HN3/HN7) vào bảng Supabase `customer_debt_activity_periods` gần 15:00 hàng ngày, phục vụ cảnh báo "Chưa thu" trên màn hình Quản lý công nợ.

## 5.6. Truy cập & bảo mật

- Hệ thống xác thực người dùng qua JWT cookie, mật khẩu mã hóa bcrypt, cơ chế lockout 5 phút chống dò mật khẩu, và khôi phục mật khẩu bằng OTP 6 số.
- Tài khoản, vai trò và Telegram ID người dùng được lưu trữ trong bảng PostgreSQL `app_users` (hỗ trợ phân quyền Quản lý, Nhân viên, Khách theo cơ sở). Luồng liên kết Telegram qua Google Sheets tạm ngừng; bot sẽ liên kết trực tiếp bằng database ở giai đoạn sau.
- Dữ liệu nhạy cảm (Service Account key, DB URL, JWT secret, KiotViet secret) lưu trong biến môi trường trên Render, không commit vào mã nguồn.
- Toàn bộ giao tiếp qua **HTTPS**.

## 5.7. Phạm vi dữ liệu theo cơ sở (Hà Nội / Sài Gòn / Cả hai)

- Mọi dữ liệu nghiệp vụ đều gắn với một **cơ sở vật lý**: `Hà Nội` hoặc `Sài Gòn`. Tài khoản được gán cơ sở phụ trách; vai trò `Quản lý` mặc định được cả hai cơ sở.

- Tài khoản được phép **cả hai** cơ sở vật lý có thêm lựa chọn **`Cả hai`** trên thanh điều hướng. Đây là **phạm vi xem**, không phải cơ sở thứ ba: không tài khoản nào được cấp `Cả hai` mà thiếu quyền một trong hai cơ sở, và `Cả hai` không bao giờ được lưu vào các trường dữ liệu nghiệp vụ (chỉ nhận `Hà Nội`/`Sài Gòn`).

- **Báo cáo tổng hợp:** KPI, biểu đồ và các bảng thống kê cộng dồn hai cơ sở. Thực thể trùng mã (hàng hóa, khách hàng, nhà cung cấp) được **gộp theo mã** — cộng tồn kho/công nợ, tính giá vốn bình quân theo tồn — rồi mới xếp hạng, nên một mã hàng có ở cả hai cơ sở chỉ chiếm một dòng. Giao dịch riêng lẻ (hóa đơn, đặt hàng, trả hàng, phiếu nhập) **không gộp**: mỗi dòng giữ khóa `(cơ sở, mã)` và có nhãn `Cơ sở` để không nhầm hai chứng từ trùng mã của hai cơ sở.

- **Tìm kiếm & xuất Excel:** tìm kiếm chạy trên dữ liệu đã gộp theo đúng quy tắc của màn hình; file xuất ở phạm vi `Cả hai` thêm cột `Cơ sở` cho các bảng giao dịch và dùng tiền tố tên file `TKS_` thay cho `HN_`/`SG_`.

- **Quản lý công nợ:** mỗi khách hàng là một dòng gộp theo khóa khách hàng (cộng nợ đầu kỳ/hiện tại/quá hạn, gộp cảnh báo), kèm chi tiết từng cơ sở. Khi Quản lý/Trợ lý đổi trạng thái xử lý ở phạm vi `Cả hai`, trạng thái được ghi cho **cả hai cơ sở trong một giao dịch database duy nhất**: hoặc cả hai cùng đổi, hoặc không có gì đổi (không tồn tại trạng thái ghi một nửa). Mỗi cơ sở được lưu kèm **chữ ký cảnh báo tính trên số liệu của chính cơ sở đó**, nên sau khi cập nhật, chuyển thanh điều hướng sang từng cơ sở riêng vẫn thấy đúng trạng thái vừa đặt (trạng thái chỉ hết hiệu lực khi khoản nợ của cơ sở đó thay đổi sau này — đúng như ở chế độ một cơ sở). Khách hàng chỉ có công nợ ở một cơ sở thì chỉ cơ sở đó được ghi. File Excel công nợ ở `Cả hai` tách một dòng cho mỗi cơ sở của khách hàng sau khi đã lọc trên dòng gộp.

- **Nhân sự, Vòng đời đơn hàng, Đứt hàng:** danh sách nhân sự và đơn nghỉ phép hiển thị cả hai cơ sở kèm cột `Cơ sở` và bộ lọc cơ sở. Ghi nhận đơn nghỉ phép ở `Cả hai` lấy cơ sở từ hồ sơ nhân sự; không xác định được (không có hồ sơ, hoặc trùng tên ở cả hai cơ sở) thì hệ thống yêu cầu chọn `Hà Nội`/`Sài Gòn` rồi ghi lại thay vì đoán. Tra cứu vòng đời đơn hàng vốn đã đọc cả hai cơ sở và gắn nhãn cơ sở cho từng đơn. Kiểm tra đứt hàng ở `Cả hai` quét lần lượt từng cơ sở rồi gộp kết quả, mỗi dòng kèm cơ sở; một cơ sở lỗi thì cả lần quét báo lỗi thay vì trả kết quả một nửa.

- **Giới hạn đã biết:** quét đứt hàng ở `Cả hai` chạy tuần tự hai cơ sở nên thời gian và hạn mức đọc Google Sheets tăng gấp đôi so với một cơ sở.

# 6. Lợi ích kỳ vọng

- Tiết kiệm thời gian tổng hợp báo cáo thủ công từ KiotViet và Google Sheets.
- Ra quyết định nhanh hơn nhờ số liệu trực quan, luôn cập nhật gần thời gian thực từ Supabase PostgreSQL.
- Chuẩn hóa cách theo dõi số liệu nội bộ, giảm phụ thuộc vào đọc sheet thô.
- Nền tảng kiến trúc dễ mở rộng thêm module theo lộ trình dài hạn.

# 7. Giả định & ràng buộc

## 7.1. Giả định

- Supabase PostgreSQL lưu trữ toàn bộ dữ liệu nghiệp vụ KiotViet và tài khoản người dùng với schema chuẩn hóa (`server/db/SCHEMA.md`).
- Service Account Google đã được cấp quyền Viewer để đọc tab `Trả NCC` trên hai file Sheets Kiot HN/SG, cũng như truy cập file Vòng đời đơn hàng và HR.
- Webhook KiotViet và scheduler Node.js hoạt động liên tục để đảm bảo dữ liệu trong database được cập nhật cận thời gian thực.
- Số lượng người dùng đồng thời dự kiến khoảng 10–50 người (nội bộ).

## 7.2. Ràng buộc

- Backend đọc dữ liệu KiotViet từ Supabase PostgreSQL; Google Sheets chỉ đọc các tab đặc thù (`Trả NCC`, Vòng đời đơn hàng, HR).
- Đối với hai file Kiot HN/SG, backend chỉ **đọc** duy nhất tab `Trả NCC`, không ghi và không tạo thêm tab nào khác.
- Dữ liệu real-time phụ thuộc vào kết nối webhook và API KiotViet.
- Đảm bảo hiệu năng cao: Result Cache phục vụ tức thì (<10ms), phân trang bảng lớn.

# 8. Tiêu chí nghiệm thu (Acceptance Criteria)

- Dashboard hiển thị đầy đủ KPI, biểu đồ, bảng dữ liệu với dữ liệu đúng từ Supabase PostgreSQL và tab Trả NCC.
- Bộ lọc 7/30/90 ngày thay đổi biểu đồ và KPI kỳ đúng theo ngày thực tế.
- Nút "Làm mới" cập nhật dữ liệu mới nhất trong vòng vài giây; chuyển tab / đổi bộ lọc phản hồi tức thì (<10ms) nhờ Result Cache.
- Dashboard tự làm mới sau mỗi 10 phút; khi quay lại tab đã ẩn quá 10 phút, dữ liệu được tải lại ngay.
- KPI "hôm nay", chuỗi ngày trên biểu đồ và `updatedAt` thống nhất theo múi giờ Asia/Ho_Chi_Minh.
- Hỗ trợ xuất Excel cho 18 bảng dữ liệu và kết quả tìm kiếm với đầy đủ tùy chọn trường, định dạng chuẩn.
- Bảng dữ liệu lớn (>7.000 dòng) được phân trang ~200 dòng/trang, chuyển trang mượt mà không lag.
- Ba kỳ công nợ CN1/CN3/CN7 (1/3/7 ngày) được tính toán chính xác và lưu trong bảng `customer_debt_activity_periods`; cảnh báo "Chưa thu" trên màn hình Quản lý công nợ đối chiếu đúng với dữ liệu.
- Tài khoản được cả hai cơ sở chọn `Cả hai` thì KPI/biểu đồ cộng dồn hai cơ sở, thực thể trùng mã chỉ hiện một dòng, giao dịch trùng mã vẫn giữ hai dòng kèm nhãn cơ sở, và không có giá trị `Cả hai` nào được ghi vào dữ liệu nghiệp vụ.
- Đổi trạng thái công nợ ở `Cả hai` hoặc cập nhật thành công cho cả hai cơ sở, hoặc không thay đổi gì khi có lỗi; sau khi cập nhật, xem riêng từng cơ sở đều thấy đúng trạng thái vừa đặt.
- Hệ thống hoạt động ổn định trên Render.com, uptime >= 99% trong giờ hành chính.
- Toàn bộ hệ thống vượt qua kiểm thử tự động **924 unit tests** (3 test migration integration chỉ chạy khi cấu hình `SUPABASE_TEST_DB_URL`).

# 9. Kế hoạch triển khai tổng quan

## 9.1. Giai đoạn 1 & Chuyển đổi PostgreSQL (đã hoàn thiện)

| **Bước**                          | **Nội dung**                                                                                      | **Trạng thái** |
|-----------------------------------|---------------------------------------------------------------------------------------------------|----------------|
| 1. Phân tích & thiết kế            | Hoàn thiện BRD v2.0, SRS v2.5, BPMN v2.1; thiết kế kiến trúc Supabase PostgreSQL                 | Hoàn thành     |
| 2. Engine đồng bộ KiotViet        | `server/kiotvietSync/`: webhook queue, syncDriver, backfill, reconcile, scheduler                | Hoàn thành     |
| 3. Backend Node.js/Express         | API `/api/dashboard`, `/api/search`, `/api/export`, Quản lý công nợ, Auth PostgreSQL, 717 unit tests | Hoàn thành     |
| 4. Frontend HTML/CSS/JS            | Dashboard, Quản lý công nợ, phân trang bảng (`pagination.js`), quản trị tài khoản (`/account/`) | Hoàn thành     |
| 5. Lớp hiệu ứng 3D Visual          | Đã gỡ bỏ hoàn toàn; giao diện thuần 2D hiện đại, tối ưu hiệu năng                                | Đã gỡ bỏ       |
| 6. Triển khai Render.com           | Deploy lên `tokosi.onrender.com`, kết nối Supabase DB                                             | Hoàn thành     |
| 7. Xuất Excel 18 bảng             | Module `exportService.js` tạo workbook `.xlsx` đa worksheet, tùy chọn trường                      | Hoàn thành     |

## 9.2. Lộ trình dài hạn (định hướng)

| **Giai đoạn**                                   | **Nội dung chính**                                                                                      | **Ghi chú**                                                          |
|-------------------------------------------------|---------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------|
| Giai đoạn 2 — Phân quyền & xuất PDF             | Đăng nhập nội bộ, phân quyền Admin/Nhân viên, xuất PDF cho KPI summary và bản in                       | Đã hoàn thành phần Quản lý tài khoản; tiếp tục PDF                    |
| Giai đoạn 3 — Bán hàng/POS                      | Tạo đơn bán, quản lý khách hàng, công nợ, in hóa đơn — tương đương nghiệp vụ KiotViet                  | Sau Giai đoạn 2                                                      |
| Giai đoạn 4 — Kho đa chi nhánh                  | Nhập/xuất/chuyển kho, tồn kho theo từng kho, kiểm kê định kỳ cho 5.000–20.000 SKU                      | Phụ thuộc dữ liệu chuẩn hoá từ Giai đoạn 3                           |
| Giai đoạn 5 — Phân tích & phát hiện bất thường  | Phân tích doanh số, dự đoán nhu cầu nhập hàng, phát hiện sai lệch tồn kho/giá bất thường               | Cần dữ liệu lịch sử đủ lớn từ Giai đoạn 3–4                          |
| Giai đoạn 6 — Danh bạ phòng ban                 | Sơ đồ tổ chức, danh bạ nhân sự (dạng xem thông tin)                                                    | Có thể triển khai song song, độc lập                                 |
| Giai đoạn 7 — Trợ lý AI                         | Chatbot hỏi-đáp số liệu bằng ngôn ngữ tự nhiên; AI dự đoán & phát hiện bất thường tự động             | Ưu tiên chatbot trước; cần dữ liệu chuẩn hoá từ các giai đoạn trước  |
| Giai đoạn 8 — Thay thế KiotViet                 | Ngừng sử dụng KiotViet, chuyển hoàn toàn nghiệp vụ sang hệ thống mới                                   | Chỉ thực hiện khi Giai đoạn 3–4 đã ổn định và nghiệm thu đầy đủ      |

*— Hết tài liệu BRD v1.8 —*
