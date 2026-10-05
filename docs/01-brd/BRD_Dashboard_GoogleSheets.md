# TÀI LIỆU YÊU CẦU NGHIỆP VỤ

*(Business Requirements Document – BRD)*

**HỆ THỐNG DASHBOARD NỘI BỘ — TOKOSI**

| **Thông tin**     | **Nội dung**                                                        |
|-------------------|---------------------------------------------------------------------|
| Tên dự án         | Hệ thống Dashboard nội bộ TOKOSI (KiotViet → Supabase PostgreSQL → Web; Google Sheets bổ trợ) |
| Phiên bản         | 2.2                                                                 |
| Ngày tạo          | 27/07/2026                                                          |
| Ngày cập nhật     | 05/10/2026                                                          |
| Đối tượng sử dụng | Ban lãnh đạo, nhân viên nội bộ công ty                              |
| Trạng thái        | Khớp code tại HEAD `11751c4` (migration `0001`–`0030`; 1.704 test, 0 lỗi, 3 bỏ qua ghi nhận 05/10/2026). Chưa xác nhận trạng thái triển khai production. |

> **Ghi chú phiên bản 2.2 (05/10/2026):** rà soát lại toàn bộ theo code. Loại các nội dung đã lỗi thời: tab `Trả NCC` đọc từ Google Sheets (nay upload Excel vào Postgres), tab Nhà cung cấp và KPI nhà cung cấp/nhập hàng (đã gỡ), bộ lọc 7/30/90 ngày và tự làm mới 10 phút (nay bộ lọc Từ–Đến theo từng bảng và cập nhật bằng SSE), đăng nhập theo tab `Users`, Khách tự đăng ký (nay khóa), workbook HR (không còn đọc). Bổ sung Vị trí hàng, Vòng đời đơn hàng hợp nhất đơn KiotViet, quản lý ID Telegram và phân quyền theo tính năng.

# 1. Giới thiệu

## 1.1. Mục đích tài liệu

Mô tả các yêu cầu nghiệp vụ của Hệ thống Dashboard nội bộ TOKOSI — website tổng hợp dữ liệu KiotViet (qua Supabase PostgreSQL) và một số Google Sheets bổ trợ, hiển thị KPI, biểu đồ, bảng chi tiết gần thời gian thực để theo dõi và ra quyết định kinh doanh, kèm các phân hệ vận hành nội bộ (công nợ, vòng đời đơn hàng, vị trí hàng, nhân sự/nghỉ phép, tài khoản).

## 1.2. Bối cảnh

TOKOSI là tổng kho sỉ phân phối hàng hóa, vận hành trên **KiotViet** (bán hàng, kho, khách hàng) với hai cơ sở **Hà Nội** và **Sài Gòn**. Dữ liệu KiotViet được đồng bộ tự động vào **Supabase PostgreSQL** bằng engine Node.js `server/kiotvietSync/` (hàng hóa, hóa đơn, đặt hàng, trả hàng, khách hàng, nhập hàng, phiếu đặt hàng nhập, thu chi) cùng các bảng tổng hợp. Ba kỳ công nợ 1/3/7 ngày (**CN1 / CN3 / CN7**) được tính từ database. Google Sheets chỉ còn dùng cho Bảng Công nợ, Vòng đời đơn hàng và Vị trí hàng.

Trước đây việc theo dõi số liệu phải làm thủ công trên KiotViet và Google Sheets, mất thời gian tổng hợp và khó thấy xu hướng. Công ty cần một **website tập trung** hiển thị chỉ số quan trọng dưới dạng KPI, biểu đồ, bảng có lọc/tìm/xuất, cập nhật gần thời gian thực, và là nền móng để mở rộng thành nền tảng quản trị vận hành.

## 1.3. Phạm vi tài liệu

Giai đoạn 1 đến hiện tại: Báo cáo tổng hợp (5 tab), Quản lý công nợ theo cơ sở, kiểm tra đứt hàng, Vòng đời đơn hàng, Vị trí hàng, Quản lý nhân sự & nghỉ phép (kèm bot Telegram), Quản lý tài khoản & phân quyền, xuất Excel/HTML; cùng định hướng mở rộng dài hạn.

# 2. Mục tiêu dự án

- Dashboard nội bộ kết nối **Supabase PostgreSQL** cho dữ liệu KiotViet và **Google Sheets API** cho Bảng Công nợ, Vòng đời đơn hàng, Vị trí hàng.
- Hiển thị KPI vận hành: doanh thu thực tế (đã trừ hàng trả), số hóa đơn, giá trị và số lượng tồn kho, **Tồn có thể bán**, hàng đang vận chuyển, hàng hết, công nợ khách hàng, trả hàng, hàng mới nhập.
- Mỗi bảng/biểu đồ có bộ lọc thời gian **Từ – Đến** riêng, tìm kiếm không dấu, sắp xếp trên toàn bộ dữ liệu đã lọc và phân trang 100 dòng.
- Dữ liệu cập nhật **gần thời gian thực**: engine đồng bộ polling KiotViet (nhóm fast 7 phút, nhóm slow 20 phút), rollup tính lại ngay sau mỗi lượt fast, và trình duyệt tự tải lại tab đang xem khi nhận sự kiện SSE `dashboard-updated`.
- Báo cáo tổng hợp **tải dữ liệu theo từng tab** để phản hồi nhanh; cache hai tầng.
- Mọi ngày giờ ("hôm nay", mốc lọc, `updatedAt`) theo múi giờ **Asia/Ho_Chi_Minh (UTC+7)**, không phụ thuộc múi giờ máy chủ.
- **Xuất Excel/HTML** cho các bảng, kết quả tìm kiếm và báo cáo nghỉ phép/danh sách nhân sự, với tùy chọn trường linh hoạt.
- Ba kỳ công nợ **CN1 / CN3 / CN7** do `customerDebtReportRefresh.js` tính 5 phút/lần vào `customer_debt_activity_periods` để phục vụ cảnh báo "Chưa thu" trên màn hình Quản lý công nợ.
- **Kiểm tra đứt hàng** dựa trên dữ liệu đã đồng bộ và dữ liệu Trả NCC do người dùng tự upload (Excel xuất từ KiotViet).
- **Phân hệ nghỉ phép:** đơn xin nghỉ nhận từ bot của nhân viên; Quản lý duyệt/từ chối trên web hoặc trên bot Telegram riêng cho quản lý; web có lịch nghỉ phép dùng chung.
- **Vòng đời đơn hàng:** xem mọi đơn đặt hàng KiotViet cùng trạng thái vòng đời từ Google Sheet; lọc, sắp xếp, phân trang ở máy chủ.
- **Vị trí hàng:** tra cứu vị trí hàng HN/SG từ workbook Google Sheets dùng chung.
- **Tài khoản và phân quyền theo tính năng** theo vai trò, Quản lý ghi đè từng tài khoản; ID Telegram do Quản lý quản lý.
- Kiến trúc mô-đun, dễ mở rộng theo lộ trình dài hạn.

# 3. Phạm vi dự án

## 3.1. Trong phạm vi (In-scope)

- **Nguồn dữ liệu:**
  - **Supabase PostgreSQL:** toàn bộ dữ liệu KiotViet (nhóm hàng, hàng hóa, hóa đơn + chi tiết + thanh toán, đặt hàng, trả hàng, khách hàng, nhập hàng, phiếu đặt hàng nhập, thu chi), bảng tổng hợp (rollup theo ngày, báo cáo hàng hóa, chi tiết hóa đơn 90 ngày, giá trị tồn kho theo ngày, CN1/CN3/CN7), Trả NCC upload, tài khoản `app_users`, nhân sự `hr_employees`, nghỉ phép và liên kết Telegram, trạng thái xử lý công nợ, tài liệu quy định công ty.
  - **Google Sheets:** Bảng Công nợ (`DEBT_MANAGEMENT_SPREADSHEET_ID`, chỉ đọc); Vòng đời đơn hàng (`ORDER_LIFECYCLE_SPREADSHEET_ID`, đọc `DonHang_HN`/`DonHang_SG`, ghi tab `Lịch sử cập nhật`); Vị trí hàng (`STOCK_LOCATIONS_SPREADSHEET_ID`, chỉ đọc).
- **Báo cáo tổng hợp (5 tab):** Tổng quan (Xu hướng, Báo cáo doanh thu theo khách, Báo cáo hàng hóa, Kiểm tra đứt hàng), Hàng hóa (Cơ cấu tồn kho, Phân tích, Tất cả mã hàng, Hàng mới nhập, Mã mới tạo), Hóa đơn (Chi tiết giao dịch), Khách hàng (Top khách theo doanh thu, Phân tích công nợ), Quản lý công nợ.
- **Màn hình Quản lý công nợ:** kết hợp Bảng Công nợ, đối chiếu CN1/CN3/CN7 và trạng thái xử lý lưu trong PostgreSQL.
- **Vòng đời đơn hàng, Vị trí hàng, Quản lý nhân sự (Quy định công ty, Danh sách nhân sự, Nghỉ phép), Quản lý tài khoản.**
- **Cập nhật dữ liệu dashboard** bằng nút "Làm mới", SSE `dashboard-updated` và tải bù khi quay lại tab trình duyệt.
- **Đồng bộ tự động** KiotViet → Supabase (polling; webhook chỉ lưu thô).
- **Xác thực & phân quyền:** đăng nhập tài khoản trong `app_users` (kể cả Google Sign-In cho tài khoản đã có), phân quyền theo tính năng; tự đăng ký tài khoản mới đang **khóa**.
- **Bot Telegram quản lý nghỉ phép** (mục 5.8).
- **Triển khai trên Render.com**, domain `tokosi.onrender.com`.

## 3.2. Ngoài phạm vi hiện tại (Out-of-scope)

- Ghi dữ liệu ngược lên KiotViet; ghi lên Google Sheets ngoài tab `Lịch sử cập nhật` của Vòng đời đơn hàng.
- Bot xin nghỉ của nhân viên (chạy ngoài repo, chỉ ghi/đọc các bảng nền nghỉ phép trong Postgres).
- Tab Nhà cung cấp và KPI nhà cung cấp/nhập hàng (đã gỡ ngày 30/09/2026).
- Toàn bộ các module ở mục 3.3 (POS, Kho đa chi nhánh, Phân tích, AI).
- Xuất báo cáo PDF của toàn dashboard (hiện chỉ có Excel/HTML; tài liệu quy định có "Tải về PDF").

## 3.3. Định hướng mở rộng dài hạn

- **Bán hàng/POS:** tạo đơn bán, quản lý khách hàng, công nợ, in hóa đơn tương đương KiotViet.
- **Kho đa chi nhánh:** nhập/xuất/chuyển kho, kiểm kê, quản lý 5.000–20.000 SKU.
- **Phân tích & phát hiện bất thường:** xu hướng, dự đoán nhập hàng, sai lệch tồn kho/giá.
- **Danh bạ phòng ban:** sơ đồ tổ chức và danh bạ nhân sự.
- **Trợ lý AI:** hỏi-đáp số liệu bằng ngôn ngữ tự nhiên.
- **Định hướng cuối:** thay thế hoàn toàn KiotViet.

# 4. Đối tượng liên quan (Stakeholders)

| **Vai trò**                    | **Mô tả trách nhiệm / nhu cầu**                                                               |
|--------------------------------|-----------------------------------------------------------------------------------------------|
| Ban lãnh đạo / Quản lý         | Theo dõi KPI tổng quan, ra quyết định; duyệt nghỉ phép; quản lý tài khoản, phân quyền, ID Telegram. |
| Trợ lý                         | Xem báo cáo, xuất file, cập nhật trạng thái công nợ.                                          |
| Nhân viên sale / kế toán / kho | Xem báo cáo (sale), tra cứu vòng đời đơn hàng, vị trí hàng, nhân sự theo quyền được cấp.     |
| Người quản trị hệ thống (IT)   | Cấu hình biến môi trường, migration, webhook KiotViet, bot Telegram, Service Account Google.  |
| Đội phát triển (Dev team)      | Xây dựng, kiểm thử, triển khai; giữ tài liệu khớp code.                                       |

# 5. Yêu cầu nghiệp vụ chi tiết

## 5.1. Nguồn dữ liệu & kết nối

- Dữ liệu KiotViet đọc từ **Supabase PostgreSQL**; thông tin kết nối (`SUPABASE_DB_URL`), Service Account Google (`GOOGLE_SERVICE_ACCOUNT_JSON`) và các ID workbook cấu hình qua biến môi trường, không hard-code.
- Google Sheets chỉ dùng cho Bảng Công nợ (Viewer), Vòng đời đơn hàng (Editor — để ghi tab Lịch sử) và Vị trí hàng (Viewer). Thiếu ID workbook chỉ tắt tính năng tương ứng (trả 503), không làm sập dashboard.
- Một bảng/nguồn lỗi tạm thời chỉ làm rỗng hoặc cảnh báo phần tương ứng, các phần khác vẫn hiển thị.

## 5.2. KPI tổng quan

| **Nhóm**                  | **KPI**                                                                                          |
|---------------------------|--------------------------------------------------------------------------------------------------|
| Bán hàng hôm nay          | Doanh thu hôm nay, số hóa đơn hoàn thành, số hóa đơn đã hủy                                     |
| Kỳ lọc (Từ – Đến)         | **Doanh thu thực tế** (hóa đơn hoàn thành trừ tiền hàng khách trả lại), số hóa đơn hoàn thành, số hóa đơn hủy, biểu đồ doanh thu theo ngày |
| Hàng hóa                  | Tổng mã hàng, tổng tồn kho, mã đang có hàng, mã đang kinh doanh, mã hết hàng, giá trị tồn kho (theo giá vốn), Tồn có thể bán, hàng đang vận chuyển |
| Khách hàng                | Tổng khách hàng, số khách có công nợ, tổng công nợ khách hàng                                   |
| Trả hàng                  | Số phiếu trả và tổng giá trị trả trong kỳ (tab Hóa đơn)                                         |
| Công nợ (tab riêng)       | Tổng nợ hiện tại, tổng nợ quá hạn, số khách cần xử lý, tỷ lệ nợ quá hạn so với doanh số         |

Chỉ hàng **Đang kinh doanh** được tính; không còn KPI nhà cung cấp/nhập hàng.

## 5.3. Biểu đồ & bảng dữ liệu chi tiết

- **Tổng quan:** biểu đồ doanh thu thực tế theo ngày; biểu đồ cột chồng **Giá trị tồn kho theo ngày** (HN + SG, bản chụp 23:59 mỗi ngày); **Báo cáo doanh thu theo khách** (chọn 1 khách để xem doanh thu 90 ngày theo sản phẩm); **Báo cáo hàng hóa** gộp hai cơ sở với nút Chi tiết xem doanh số 90 ngày từng khách; **Kiểm tra đứt hàng** (nhập Trả NCC, hàng đứt gần đây, kiểm tra 30/90 ngày).
- **Hàng hóa:** Cơ cấu tồn kho (bảng chi tiết theo sản phẩm với Tồn kho, Tồn có thể bán, Hàng đang vận chuyển); Sản phẩm bán chạy (doanh thu thực tế); Tất cả mã hàng; Hàng mới nhập; Mã mới tạo và tỷ lệ theo nhóm hàng.
- **Hóa đơn:** bảng Chi tiết giao dịch; bấm một dòng để xem chi tiết hóa đơn (dòng hàng, tổng tiền, thanh toán).
- **Khách hàng:** Top khách theo doanh thu (đã trừ hàng trả, có cột HN/SG), Phân tích công nợ khách hàng, Chi tiết khách nợ.
- **Công thức Tồn có thể bán** = Tồn thực tế − Đặt hàng Phiếu tạm của khách + Hàng đang vận chuyển (không kẹp về 0).
- Mọi bảng có cột **Cơ sở**; cột thời gian sắp xếp theo thời gian thật.

## 5.4. Bộ lọc thời gian

- Mỗi bảng/biểu đồ có bộ lọc **Từ – Đến** riêng; xóa cả hai ô nghĩa là "Tất cả". Mặc định 30 ngày gần nhất (Top khách theo doanh thu: toàn thời gian; Giá trị tồn kho theo ngày: 7 ngày).
- Không còn bộ lọc chung 7/30/90 ngày và không còn thanh tìm kiếm chung đầu tab; mỗi bảng có ô tìm kiếm riêng.
- Ranh giới "hôm nay", các ngày trong kỳ lọc và `updatedAt` theo **Asia/Ho_Chi_Minh (UTC+7)**.

## 5.5. Cập nhật dữ liệu

**Trên dashboard:**
- **Gần thời gian thực:** server phát SSE `dashboard-updated` sau mỗi lượt đồng bộ + rollup; trình duyệt tải lại tab đang xem (chỉ render lại khi dữ liệu thật sự đổi), các tab khác tải lại khi được mở.
- **Thủ công:** nút "Làm mới".
- **Khi quay lại tab:** nếu đã quá 60 giây kể từ lần tải gần nhất thì tải lại ngay và nối lại SSE.

**Đồng bộ nguồn (Node.js Sync Engine):**
- **Polling** là nguồn dữ liệu: nhóm fast (hóa đơn, đơn hàng, tồn kho, phiếu đặt hàng nhập) mỗi 7 phút; nhóm slow (nhóm hàng, hàng hóa, khách hàng, trả hàng, nhập hàng, thu chi) mỗi 20 phút; tồn kho được quét toàn bộ tối đa 10 phút/lần.
- **Webhook KiotViet** (`/api/kiotviet/webhook/<secret>`) hiện chỉ được lưu thô để phân tích, không cập nhật bảng nghiệp vụ.
- **Job tổng hợp:** rollup theo ngày; CN1/CN3/CN7 mỗi 5 phút; Báo cáo hàng hóa và chi tiết hóa đơn 90 ngày tính 1 lần/đêm; giá trị tồn kho chụp lúc 23:59.

## 5.6. Truy cập & bảo mật

- Xác thực bằng JWT cookie, mật khẩu băm bcrypt, khóa đăng nhập 5 phút khi sai 5 lần liên tiếp, khôi phục mật khẩu bằng OTP 6 số (email/SĐT khôi phục).
- Tài khoản, vai trò, quyền riêng và Telegram ID lưu trong PostgreSQL `app_users`.
- **Tự đăng ký tài khoản mới bị khóa từ 03/10/2026**; tài khoản mới do Quản lý tạo (có thể mở lại bằng cấu hình `ALLOW_SELF_REGISTRATION`). Đăng nhập Google chỉ dành cho tài khoản đã có.
- **Phân quyền theo tính năng:** mỗi vai trò có bộ quyền mặc định; Quản lý cấp/rút từng quyền cho từng tài khoản; một số quyền phụ chỉ có hiệu lực khi có quyền gốc (vd các quyền của Vòng đời đơn hàng). Quản lý thường không được thao tác nhạy cảm trên Quản lý khác; chỉ Quản lý cấp cao (admin cứng) giữ đủ quyền.
- **ID Telegram** chỉ Quản lý thêm/sửa được (kể cả hộ nhân viên); hệ thống chống trùng ID giữa tài khoản, liên kết bot và nhân sự.
- Dữ liệu nhạy cảm (Service Account, DB URL, JWT secret, KiotViet secret, token Telegram) chỉ ở biến môi trường, không commit; toàn bộ giao tiếp qua HTTPS.

## 5.7. Phạm vi dữ liệu theo cơ sở (Hà Nội / Sài Gòn / Cả hai)

- Mọi dữ liệu nghiệp vụ gắn với một **cơ sở vật lý** (`Hà Nội` hoặc `Sài Gòn`). **Cơ sở chỉ là bộ lọc xem:** mọi tài khoản xem được Hà Nội, Sài Gòn và **`Cả hai`**; cơ sở gán cho tài khoản (để trống = `Cả hai`) chỉ là cơ sở **mặc định** lúc đăng nhập.
- `Cả hai` là **phạm vi xem**, không phải cơ sở thứ ba, và không bao giờ được lưu vào dữ liệu nghiệp vụ.
- **Báo cáo tổng hợp ở `Cả hai`:** KPI và biểu đồ cộng dồn hai cơ sở. Hàng hóa và giao dịch cùng mã ở hai cơ sở là **hai dòng riêng** `(cơ sở, mã)` kèm nhãn Cơ sở; **khách hàng gộp theo tên** (mã khách khác nhau giữa hai cơ sở). Riêng Cơ cấu tồn kho và Báo cáo hàng hóa gộp 1 dòng/mã với cột HN/SG riêng.
- **Tìm kiếm & xuất file:** chạy trên dữ liệu đã gộp theo đúng quy tắc của màn hình; file xuất ở `Cả hai` thêm cột `Cơ sở` cho bảng giao dịch và dùng tiền tố tên file `TKS_` thay `HN_`/`SG_`.
- **Quản lý công nợ:** mỗi khách là một dòng gộp theo khóa khách hàng kèm chi tiết từng cơ sở. Đổi trạng thái xử lý ở `Cả hai` ghi cho **cả hai cơ sở trong một giao dịch database**: hoặc cả hai cùng đổi hoặc không có gì đổi; mỗi cơ sở lưu chữ ký cảnh báo của chính nó. File Excel công nợ ở `Cả hai` tách một dòng cho mỗi cơ sở.
- **Nhân sự, Vòng đời đơn hàng, Đứt hàng:** nhân sự/nghỉ phép hiển thị cả hai cơ sở kèm cột và bộ lọc cơ sở; ghi nhận đơn nghỉ ở `Cả hai` lấy cơ sở từ hồ sơ nhân sự, không xác định được thì yêu cầu chọn. Vòng đời đơn hàng gắn nhãn cơ sở cho từng đơn. Kiểm tra đứt hàng ở `Cả hai` quét lần lượt từng cơ sở rồi gộp; một cơ sở lỗi thì cả lần quét báo lỗi.

## 5.8. Bot Telegram riêng cho quản lý nghỉ phép

- Bot chạy cùng máy chủ dashboard, dùng chung đơn PostgreSQL với bot xin nghỉ của nhân viên (ngoài repo). Mọi đơn **Xin nghỉ phép** mới gửi cho quản lý phù hợp, kể cả đơn `Vi phạm`; khi bật hệ thống, gửi bù đơn `Chưa duyệt` chưa gửi. Bản ghi **Tự ý nghỉ (HR ghi nhận)** không gửi qua bot này.
- Chỉ tài khoản **Quản lý** hoạt động, có Telegram ID và quyền `hr.leave.manage` mới nhận/thao tác. Cơ sở tài khoản Hà Nội nhận đơn Hà Nội, Sài Gòn nhận đơn Sài Gòn, Cả hai nhận cả hai; cơ sở trống không nhận. Mỗi quản lý phải bấm **Start** với bot mới.
- Quản lý chỉ có thể chọn **Phê duyệt** (lưu Đã duyệt) hoặc **Từ chối**. Khi từ chối có thể nhập lý do bằng reply đúng lời nhắc, Bỏ qua hoặc Hủy; lý do tối đa 500 ký tự, phiên hết hạn sau 15 phút.
- Đã duyệt/Từ chối khóa thao tác tiếp trên Telegram; người đủ quyền vẫn đổi được trên web (chuyển về trạng thái chưa kết thúc mở lại Telegram). Các tin đã gửi cập nhật theo quyết định mới; thao tác cũ/trùng/đồng thời không ghi đè quyết định mới hơn.
- Trạng thái đơn nghỉ: `Chưa duyệt`, `Đã duyệt`, `Từ chối`, `Vi phạm` (đã gỡ `Tạm duyệt` ngày 02/10/2026).
- Bot nhân viên tiếp tục nhận đơn và báo kết quả cho nhân viên; bot quản lý không thay đổi quyền sở hữu liên kết Telegram hay phiên xin nghỉ của bot đó.
- Thông báo gần thời gian thực chỉ khi máy chủ chạy liên tục (quét mặc định 5 giây); máy chủ ngủ/tắt thì trì hoãn đến khi chạy lại. Hướng dẫn: [thiết lập bot](../telegram-manager-leave-setup.md).

## 5.9. Vị trí hàng

- Mọi tài khoản nội bộ (không phải Khách) tra cứu vị trí hàng Hà Nội/Sài Gòn từ workbook Google Sheets dùng chung. Nhóm riêng trên sidebar có hai tab theo cơ sở đang chọn; bảng 6 cột (Mã hàng, Tên hàng, Tổng SL, Ghi chú hàng hóa, Ngày về, Vị trí), tìm mã/tên/vị trí không dấu, 100 dòng/trang, không xuất file.
- Giữ từng dòng nguồn kể cả mã trùng, SL = 0 hoặc vị trí trống. Dữ liệu đọc mới mỗi lần mở tab/tải lại. Khách bị chặn hoàn toàn, kể cả khi được ghi đè cấp quyền. Xem [thiết lập/nguồn](../stock-locations-setup.md).

## 5.10. Vòng đời đơn hàng

- Trang liệt kê **mọi đơn đặt hàng KiotViet** của hai cơ sở (Phiếu tạm, Đã xác nhận, Đang giao hàng, Hoàn thành, Đã hủy) ghép với Google Sheet theo (cơ sở, mã đơn) để lấy trạng thái vòng đời (Đơn chưa gửi kế toán → Đã gửi kế toán → Đang được giao → Đã giao thành công → Đã nhận (Tại kho) → Đã nhận (Đi giao xong); thêm Sự cố/Đã hủy qua ghi đè).
- Có Trạng thái KiotViet, Ghi chú, Giá trị đơn và **Giá trị có bán** (đơn Phiếu tạm: Σ min(SL đặt, tồn) × đơn giá); lọc, sắp xếp, phân trang chạy ở máy chủ; bấm dòng xem chi tiết đơn.
- Tra cứu theo mã, Lịch sử cập nhật, Ghi đè trạng thái (mặc định chỉ Quản lý) và Xuất Excel (mặc định chỉ Quản lý, tối đa 20.000 dòng) đều là quyền phụ của quyền Vòng đời đơn hàng. Nhân viên kho, marketing, mua hàng và Khách không có trang này.

## 5.11. Quản lý nhân sự

- **Quy định công ty:** hai tài liệu dựng sẵn (Giờ giấc làm việc, Quy định nghỉ phép) và PDF do Quản lý tải lên; gỡ/khôi phục mặc định; thêm/gỡ tài liệu báo lên chuông thông báo.
- **Danh sách nhân sự:** xem và xuất Excel; là nguồn đối chiếu vai trò theo bộ phận cho tài khoản.
- **Nghỉ phép:** bảng đơn có lọc cơ sở/phòng ban/ngày, phân trang, cảnh báo nghỉ gấp, xuất Excel; Quản lý nhập tay "Tự ý nghỉ" và duyệt/từ chối; lịch nghỉ phép ở thanh header cho mọi trang; thông báo chuông cho đơn mới. Quy tắc nghiệp vụ theo CSNS-NP-01.

# 6. Lợi ích kỳ vọng

- Tiết kiệm thời gian tổng hợp báo cáo thủ công từ KiotViet và Google Sheets.
- Ra quyết định nhanh hơn nhờ số liệu trực quan, cập nhật gần thời gian thực từ Supabase PostgreSQL.
- Chuẩn hóa cách theo dõi số liệu nội bộ, giảm phụ thuộc vào đọc sheet thô.
- Tập trung vận hành (công nợ, vòng đời đơn hàng, vị trí hàng, nghỉ phép) vào một hệ thống có phân quyền rõ ràng.
- Nền tảng kiến trúc dễ mở rộng theo lộ trình dài hạn.

# 7. Giả định & ràng buộc

## 7.1. Giả định

- Supabase PostgreSQL lưu toàn bộ dữ liệu nghiệp vụ với schema trong `server/db/SCHEMA.md`, đã áp migration tới `0030`.
- Service Account Google được cấp Viewer trên Bảng Công nợ và Vị trí hàng, Editor trên workbook Vòng đời đơn hàng.
- Scheduler Node.js hoạt động liên tục (một instance) để dữ liệu được cập nhật gần thời gian thực.
- Bot xin nghỉ của nhân viên vận hành ngoài repo và ghi trực tiếp vào Postgres.
- Số người dùng đồng thời khoảng 10–50 (nội bộ).

## 7.2. Ràng buộc

- Dữ liệu KiotViet phụ thuộc tốc độ polling và hạn mức KiotViet API; webhook không phải nguồn cập nhật.
- Bảng Công nợ, Vòng đời đơn hàng, Vị trí hàng phụ thuộc cấu trúc header của Google Sheets; đổi tên tab/cột có thể làm tính năng báo lỗi cấu hình.
- Job nặng chạy một lần/đêm (Báo cáo hàng hóa, chi tiết hóa đơn 90 ngày) nên số liệu hôm nay chỉ xuất hiện ở đêm sau; giao diện ghi rõ mốc.
- Hiệu năng: cache hai tầng, phân trang, tải theo tab; hạn chế IO Postgres (job chỉ ghi dòng thay đổi).

# 8. Tiêu chí nghiệm thu (Acceptance Criteria)

- Dashboard hiển thị đủ KPI, biểu đồ, bảng với dữ liệu đúng từ Supabase PostgreSQL; chỉ tab/mục tài khoản có quyền mới hiện.
- Bộ lọc Từ – Đến của từng bảng đổi dữ liệu đúng khoảng ngày thực tế; "xóa cả hai ô" nghĩa là Tất cả.
- Sau mỗi lượt đồng bộ + rollup, tab đang xem tự cập nhật qua SSE; nút "Làm mới" và quay lại tab ≥ 60 giây tải lại dữ liệu.
- KPI "hôm nay", chuỗi ngày trên biểu đồ và `updatedAt` thống nhất theo Asia/Ho_Chi_Minh.
- Doanh thu thực tế đã trừ hàng khách trả ở mọi nơi (theo ngày, theo khách, theo hàng hóa, Báo cáo hàng hóa).
- Xuất Excel/HTML các bảng và kết quả tìm kiếm với tùy chọn trường; tối đa 2 file xuất đồng thời.
- Bảng lớn phân trang 100 dòng/trang, tìm/sắp xếp trên toàn bộ dữ liệu đã lọc, cột thời gian sắp theo thời gian thật.
- CN1/CN3/CN7 tính chính xác và lưu trong `customer_debt_activity_periods`; cảnh báo "Chưa thu" đối chiếu đúng.
- Tài khoản chọn `Cả hai` thấy KPI/biểu đồ cộng dồn hai cơ sở, giao dịch trùng mã giữ hai dòng kèm nhãn cơ sở, không có giá trị `Cả hai` nào được ghi vào dữ liệu nghiệp vụ.
- Đổi trạng thái công nợ ở `Cả hai` cập nhật cả hai cơ sở hoặc không đổi gì khi có lỗi.
- Vòng đời đơn hàng hiển thị đủ đơn KiotViet, lọc/phân trang ở máy chủ, quyền phụ gắn đúng quyền gốc.
- Vị trí hàng đọc đúng 6 cột của hai sheet, Khách bị chặn.
- Tự đăng ký trả `REGISTRATION_DISABLED` khi chưa bật; ID Telegram chỉ Quản lý sửa được và chống trùng.
- Bot quản lý giao đơn đúng cơ sở, loại tài khoản không đủ điều kiện và bản ghi tự ý nghỉ; Phê duyệt/Từ chối đồng bộ với web và mọi bản tin; nút cũ/đồng thời không ghi đè; phiên lý do chỉ nhận reply đúng tin, giới hạn 500 ký tự, hết hạn 15 phút; webhook không secret hợp lệ bị từ chối.
- Bộ kiểm thử tự động vượt qua: **1.704 test (1.701 đạt, 3 bỏ qua)** ghi nhận 05/10/2026; 3 test migration integration chỉ chạy khi có `SUPABASE_TEST_DB_URL`.
- Hệ thống ổn định trên Render.com, uptime ≥ 99% trong giờ hành chính.

# 9. Kế hoạch triển khai tổng quan

## 9.1. Giai đoạn 1 & chuyển đổi PostgreSQL (đã hoàn thiện)

| **Bước**                          | **Nội dung**                                                                                      | **Trạng thái** |
|-----------------------------------|---------------------------------------------------------------------------------------------------|----------------|
| 1. Phân tích & thiết kế            | BRD, SRS, BPMN; thiết kế kiến trúc Supabase PostgreSQL                                           | Hoàn thành     |
| 2. Engine đồng bộ KiotViet        | `server/kiotvietSync/`: polling fast/slow, rollup, backfill, reconcile, job nền                  | Hoàn thành     |
| 3. Backend Node.js/Express         | API báo cáo theo tab, công nợ, auth/phân quyền, nhân sự, vòng đời đơn hàng, vị trí hàng          | Hoàn thành     |
| 4. Frontend HTML/CSS/JS            | Báo cáo tổng hợp, Quản lý công nợ, Vòng đời đơn hàng, Vị trí hàng, Nhân sự, Tài khoản             | Hoàn thành     |
| 5. Lớp hiệu ứng 3D                 | Đã gỡ bỏ hoàn toàn; giao diện 2D tối ưu hiệu năng                                                 | Đã gỡ bỏ       |
| 6. Xuất file                       | `exportService.js`: Excel/HTML nhiều worksheet, tùy chọn trường                                   | Hoàn thành     |
| 7. Bot Telegram quản lý nghỉ phép  | Code, migration `0029`/`0030`, tài liệu thiết lập; bật production theo hướng dẫn vận hành        | Code hoàn thành; vận hành chờ cấu hình |
| 8. Triển khai Render.com           | `tokosi.onrender.com`, kết nối Supabase                                                           | Hoàn thành (xác nhận phiên bản deploy ngoài phạm vi tài liệu) |

## 9.2. Lộ trình dài hạn (định hướng)

| **Giai đoạn**                                   | **Nội dung chính**                                                                                      | **Ghi chú**                                                          |
|-------------------------------------------------|---------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------|
| Giai đoạn 2 — Phân quyền & báo cáo              | Phân quyền theo tính năng, quản lý tài khoản (đã hoàn thành); xuất PDF cho báo cáo (chưa làm)          | Phần còn lại: PDF                                                    |
| Giai đoạn 3 — Bán hàng/POS                      | Tạo đơn bán, quản lý khách hàng, công nợ, in hóa đơn — tương đương nghiệp vụ KiotViet                  | Sau Giai đoạn 2                                                      |
| Giai đoạn 4 — Kho đa chi nhánh                  | Nhập/xuất/chuyển kho, tồn kho theo từng kho, kiểm kê định kỳ cho 5.000–20.000 SKU                      | Phụ thuộc dữ liệu chuẩn hoá từ Giai đoạn 3                           |
| Giai đoạn 5 — Phân tích & phát hiện bất thường  | Phân tích doanh số, dự đoán nhu cầu nhập hàng, phát hiện sai lệch tồn kho/giá bất thường               | Cần dữ liệu lịch sử đủ lớn từ Giai đoạn 3–4                          |
| Giai đoạn 6 — Danh bạ phòng ban                 | Sơ đồ tổ chức, danh bạ nhân sự (dạng xem thông tin)                                                    | Có thể triển khai song song, độc lập                                 |
| Giai đoạn 7 — Trợ lý AI                         | Chatbot hỏi-đáp số liệu bằng ngôn ngữ tự nhiên; AI dự đoán & phát hiện bất thường                      | Ưu tiên chatbot trước                                                |
| Giai đoạn 8 — Thay thế KiotViet                 | Ngừng sử dụng KiotViet, chuyển hoàn toàn nghiệp vụ sang hệ thống mới                                   | Chỉ thực hiện khi Giai đoạn 3–4 đã ổn định và nghiệm thu             |

*— Hết tài liệu BRD v2.2 —*
