# Thiết lập bot Telegram quản lý nghỉ phép

Cập nhật: 02/10/2026. Hướng dẫn này dành cho người vận hành sau khi triển khai code; không xác nhận bot đã được bật trên production.

Kiểm thử code trên Node 22: toàn bộ bộ kiểm thử có 1.622 test thành công, 3 test bỏ qua, không có test thất bại. Kiểm thử bot mô phỏng Telegram và dùng PostgreSQL trong bộ nhớ (PGlite), bao gồm quyết định đồng thời, update trùng, restart, lý do từ chối và đồng bộ nhiều quản lý. Chưa áp migration, đăng ký webhook hoặc gửi tin thật trên production.

## Chuẩn bị

- Máy chủ Express có HTTPS origin công khai và chạy liên tục nếu cần thông báo gần thời gian thực. Khi máy chủ ngủ/tắt, quét và giao tin dừng đến khi chạy lại.
- Kết nối PostgreSQL đúng môi trường và quyền chạy migration. Bot xin nghỉ của nhân viên hiện có vẫn dùng database này, webhook và tiến trình riêng.
- Mỗi quản lý có tài khoản Quản lý đang hoạt động, Telegram ID và quyền `hr.leave.manage`. Cơ sở tài khoản phải là Hà Nội, Sài Gòn hoặc Cả hai; để trống sẽ không nhận thông báo bot quản lý.

## 1. Tạo bot riêng

Trong Telegram, mở **BotFather**, dùng `/newbot` và hoàn tất tên/username. Lưu token vào môi trường máy chủ dưới `HR_MANAGER_TELEGRAM_BOT_TOKEN`. Dùng token bot mới, không lấy token của bot xin nghỉ nhân viên.

Tạo secret ngẫu nhiên gồm 1–256 ký tự chữ/số, dấu gạch dưới hoặc gạch ngang (chuỗi hex ngẫu nhiên phù hợp), lưu ở `HR_MANAGER_TELEGRAM_WEBHOOK_SECRET`. Giữ token/secret trong cấu hình bí mật, không commit vào repo và không cần dán vào chat để thiết lập.

## 2. Áp migration trước bản web mới

Tại `server/`, với cấu hình database đúng môi trường:

```bash
npm run db:migrate
```

Xác nhận `0029_hr_manager_telegram.sql` đã được áp: có `hr_leave_requests.decision_version` và các bảng `hr_leave_change_events`, `hr_leave_manager_messages`, `hr_manager_telegram_sessions`, `hr_manager_telegram_updates`, `hr_manager_telegram_state`.

**Phải áp migration trước khi chạy bản web mới, kể cả khi bot đang tắt:** repository web đọc `decision_version`. Không xóa hay tạo lại ba bảng nền của bot nhân viên (`hr_leave_requests`, `hr_telegram_links`, `hr_telegram_sessions`).

## 3. Cấu hình và khởi động

Dùng các biến tương ứng trong `server/.env.example`; local có thể dùng `.env`, môi trường triển khai dùng cấu hình bí mật của nền tảng:

```dotenv
HR_MANAGER_TELEGRAM_ENABLED=true
HR_MANAGER_TELEGRAM_BOT_TOKEN=
HR_MANAGER_TELEGRAM_WEBHOOK_SECRET=
HR_MANAGER_TELEGRAM_WEB_URL=https://your-dashboard.example
HR_MANAGER_TELEGRAM_SCAN_INTERVAL_MS=5000
HR_LEAVE_DB_REALTIME_ENABLED=true
```

Điền token/secret đã lưu ở bước 1. `HR_MANAGER_TELEGRAM_WEB_URL` là **HTTPS origin của dashboard**, ví dụ `https://tokosi.onrender.com`, không kèm đường dẫn. Scan interval mặc định 5000 ms. Công tắc bot mặc định false; công tắc cầu DB → SSE HR mặc định true và độc lập với bot.

File local `server/.env.render-manager-bot` (đã gitignore) có thể chứa riêng bộ biến môi trường để nhập vào mục Environment của service Render bằng **Add from .env**. Server local chỉ tự đọc `server/.env`, trong đó giữ `HR_MANAGER_TELEGRAM_ENABLED=false`; không đổi tên hay sao chép file cấu hình Render đè lên file này. Render API key, nếu dùng để tự động cấu hình service, là khóa quản trị Render riêng và không phải token Telegram.

Khởi động lại Express theo quy trình môi trường. Bot chạy cùng tiến trình web, không cần VPS hay dependency bot mới.

## 4. Đăng ký webhook bot mới

Tại `server/`, với cùng môi trường token/secret/origin đã cấu hình:

```bash
npm run telegram-manager:set-webhook
```

Lệnh đăng ký webhook của **bot quản lý** về:

```text
https://<dashboard-origin>/api/telegram/manager-leave/webhook
```

Lệnh đăng ký `max_connections=1` và giữ cập nhật đang chờ (`drop_pending_updates=false`). Secret được gửi khi đăng ký, rồi Telegram gửi lại ở header `X-Telegram-Bot-Api-Secret-Token`. Kiểm tra kết quả đăng ký; xác nhận origin đúng trước khi chạy lại lệnh ở môi trường khác. Không thay webhook của bot xin nghỉ nhân viên.

## 5. Cho từng quản lý Start bot

Mỗi quản lý mở **bot mới** và bấm **Start**. Telegram ID đã có trong database chưa đủ để bot mới nhắn được cho người đó.

Đối chiếu tài khoản trên trang Tài khoản:

| Cơ sở tài khoản | Đơn nhận qua bot |
|---|---|
| Hà Nội | Hà Nội |
| Sài Gòn | Sài Gòn |
| Cả hai | Hà Nội và Sài Gòn |
| Để trống | Không nhận |

Vai trò khác Quản lý, tài khoản không hoạt động, thiếu Telegram ID hoặc bị rút `hr.leave.manage` cũng không nhận/thao tác. Quyền và cơ sở được kiểm tra lại khi bấm nút; thay đổi trên trang Tài khoản có hiệu lực cho thao tác tiếp theo.

## 6. Kiểm tra giao tin và quyết định

Dùng các đơn được phép thử trong môi trường triển khai:

1. Bot gửi bù các đơn **Xin nghỉ phép** Chưa duyệt/Tạm duyệt chưa gửi. Lịch sử đã kết thúc trước lần bật bot đầu tiên không gửi mới; đơn tạo sau mốc bật vẫn gửi trạng thái hiện tại dù web đã duyệt trước lượt quét. Tạo một đơn mới qua bot nhân viên hiện có; xác nhận web và quản lý đúng cơ sở nhận được. Đơn mới Vi phạm vẫn được gửi; **Tự ý nghỉ (HR ghi nhận)** không được gửi.
2. Tin nhắn chỉ có hai nút quyết định **Phê duyệt** và **Từ chối**. Thử Phê duyệt: lưu trạng thái Đã duyệt, người duyệt và thời điểm trên web và các tin Telegram đã gửi. Các nút Chưa duyệt/Tạm duyệt/Vi phạm trên tin cũ không được xử lý; nút cũ sau khi quyết định đổi không được ghi đè bản mới.
3. Thử Từ chối: reply đúng tin nhắc nhập lý do, khoảng trắng đầu/cuối bị bỏ; trên 500 ký tự không được nhận. Kiểm tra Bỏ qua lưu lý do rỗng, Hủy không quyết định, phiên quá 15 phút không còn nhận lý do.
4. Với Đã duyệt/Từ chối, tin Telegram khóa thao tác tiếp của mọi quản lý. Trên web, đổi về Chưa duyệt/Tạm duyệt/Vi phạm để mở lại; tin Telegram cập nhật và nhận thao tác ở phiên bản mới.
5. Xác nhận bot nhân viên vẫn báo kết quả như trước qua `decision_notified_at`. Bot quản lý không đánh dấu cột này.
6. Kiểm tra restart/retry bằng môi trường thử: việc đã lưu tiếp tục, update trùng không đổi quyết định hai lần. Kết nối lại SSE trên web làm mới danh sách.

Các bước này là kiểm tra cần thực hiện sau cấu hình, không phải kết quả kiểm thử đã được tài liệu xác nhận.

Sau khi cập nhật mã và khởi động lại Express, bot làm mới nút trên các tin đã gửi của đơn chưa kết thúc qua hàng đợi giao tin hiện có. Các cuộc trò chuyện bị chặn giữ nguyên trạng thái chặn; không cần migration mới cho thay đổi hai nút này.

## Theo dõi và xử lý lỗi

- **Không nhận tin:** kiểm tra server hoạt động, công tắc bot, migration, bot token, manager Start đúng bot và đủ vai trò/trạng thái/ID/quyền/cơ sở.
- **Webhook không đến hoặc bị từ chối:** kiểm tra origin HTTPS, webhook trỏ đúng endpoint và secret đồng nhất; kiểm tra kết quả của lệnh đăng ký.
- **Không bấm được nút:** kiểm tra trạng thái Đã duyệt/Từ chối, phiên bản đơn hoặc quyền/cơ sở đã thay đổi. Mở web để xem quyết định mới nhất.
- **Lý do không được nhận:** nhấn chuột phải/chạm giữ tin nhắc, chọn **Trả lời (Reply)** rồi gửi lý do trong hạn phiên. Nếu gửi tin mới hoặc Reply nhầm tin, bot nhắc lại và dẫn về tin hỏi lý do đang chờ; lý do chưa được lưu. Kiểm tra độ dài và phiên chưa bị quyết định mới thay thế.
- **Web chưa phản ánh đơn từ bot nhân viên:** kiểm tra `HR_LEAVE_DB_REALTIME_ENABLED`, server và kết nối DB/SSE; kết nối lại hoặc làm mới danh sách.

Mốc bật lần đầu được lưu ở `hr_manager_telegram_state.first_enabled_at`, giữ qua restart/tắt-bật. Runtime theo dõi giao tin qua `hr_leave_manager_messages` (lease/retry) và inbox `hr_manager_telegram_updates`; bot xin nghỉ giữ bảng phiên `hr_telegram_sessions` riêng. Xem hợp đồng dữ liệu trong [SCHEMA](../server/db/SCHEMA.md).

## Dừng bot quản lý

Đặt `HR_MANAGER_TELEGRAM_ENABLED=false` và khởi động lại server để dừng nhận/xử lý của bot quản lý. Giữ migration và các bảng; web vẫn quyết định được, bot xin nghỉ cũ vẫn nhận đơn/báo kết quả. Nếu cần xử lý cầu DB → SSE, có thể tắt riêng `HR_LEAVE_DB_REALTIME_ENABLED`.

Không rollback migration bằng cách xóa cột/bảng khi bản web mới còn chạy. Khi bật lại, công việc đã lưu tiếp tục và các đơn chờ chưa gửi được quét lại.
