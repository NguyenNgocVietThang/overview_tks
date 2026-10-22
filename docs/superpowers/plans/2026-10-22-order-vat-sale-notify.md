# ORDER VAT — thông báo chuông cho sale sau khi kế toán sửa — kế hoạch triển khai

Bản chốt yêu cầu duyệt trong chat ngày 22/10/2026. Nhánh `feat/vat-request-sale-notify`, tách từ `main` `9a43ef6`. Không commit/push/deploy hoặc áp migration lên DB dùng chung khi chưa được duyệt.

## Bản chốt yêu cầu

- **Kết quả:** người có quyền xử lý (Kế toán được cấp quyền, Quản lý) sửa **KT phản hồi / KT note cho sale / Ngày về** trên các yêu cầu của một sale. Khi đã **ngừng sửa yêu cầu của sale đó đủ 10 phút** (mỗi lần sửa thêm thì đếm lại từ đầu), sale nhận **1 thông báo chuông** tóm tắt cả đợt.
- **Nội dung:** tiêu đề "Kế toán đã cập nhật N yêu cầu ORDER VAT", kèm từng dòng `Khách · Mã SP: <giá trị cuối của các cột đã đổi>`. Bấm vào thì mở `/vat-request/`.
- **Không báo khi:**
  - giá trị lúc gửi giống lúc bắt đầu đợt sửa (sửa rồi Ctrl+Z về như cũ);
  - kéo dòng đổi thứ tự (không ghi lịch sử);
  - sale tự sửa (kể cả trạng thái tự về "Chờ KT xử lý");
  - yêu cầu import thiếu tài khoản sale;
  - người sửa chính là người tạo yêu cầu;
  - yêu cầu đã xóa;
  - tài khoản sale không còn hoạt động.
- **Ngoài phạm vi:** Telegram / email, tùy chỉnh thời gian chờ trên giao diện, báo cho kế toán, đổi cách chuông lưu trữ, đánh dấu đúng yêu cầu khi mở trang.

## Thiết kế

**Không cần ghi thêm gì lúc kế toán sửa.** Mọi lần sửa đã được ghi ở `vat_request_history`: ai sửa, sửa lúc nào, trường nào, giá trị cũ và mới. Hướng này có 3 cái lợi:
- dùng được cho mọi đường sửa: `PATCH /:id`, `PATCH /bulk`, kéo chấm, dán, Delete, hoàn tác;
- đợt sửa đang chờ gửi vẫn còn khi web khởi động lại hay deploy;
- không đụng tới luồng lưu.

Job chỉ cần thêm **1 con trỏ cho mỗi sale**: id dòng lịch sử cuối cùng đã báo.

- **Migration `0080_vat_request_notice_state.sql`** (chỉ thêm bảng, idempotent):
  - Bảng `vat_request_notice_state(sale_id TEXT PRIMARY KEY, last_history_id BIGINT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`.
  - Thêm sẵn 1 dòng mốc `sale_id = '*'` với `last_history_id = max(id)` của `vat_request_history` lúc áp, để lần chạy đầu **không** báo lại các lần sửa cũ.
  - Thu hồi quyền `reporting_readonly` như `0076`.
- **Job `server/vatRequests/saleNotifier.js`:** `createSaleNotifier({ getPool, notificationRepo, userStore, now, quietMs = 10 phút })` với hàm `runOnce()`. Hàm này không bao giờ throw: lỗi thì ghi log và bỏ qua, chờ lượt sau.
  1. Mở transaction, lấy `pg_try_advisory_xact_lock(<khóa riêng>)`. Không lấy được thì thôi, vì đã có tiến trình khác đang chạy.
  2. Đọc các dòng lịch sử thỏa đủ các điều kiện:
     - `action='update'`, `field IN ('status','accountant_note','arrival_date')`;
     - `id >` con trỏ của sale, hoặc con trỏ mốc `'*'` nếu sale chưa có con trỏ riêng;
     - yêu cầu có `created_by` và chưa xóa;
     - `changed_by IS DISTINCT FROM r.created_by`.
     Chỉ đọc dòng mới hơn con trỏ nên không quét lại cả bảng.
  3. Gom theo sale (`created_by`). Sale nào có **lần sửa mới nhất ≤ now − 10 phút** thì đến hạn, còn lại chờ lượt sau.
  4. Với mỗi sale đến hạn, xét từng yêu cầu và từng trường: lấy giá trị cũ của dòng lịch sử **đầu tiên** trong đợt, so với giá trị **hiện tại** trong `vat_requests`. Giống nhau thì bỏ trường đó. Yêu cầu không còn trường nào đổi thì bỏ.
  5. Upsert con trỏ của sale = id lịch sử lớn nhất của đợt (kể cả khi không còn gì để báo), rồi COMMIT.
  6. **Sau khi commit** mới gọi `notificationRepository.createNotification`, với `type: 'vatRequestUpdated'`, `relatedType: 'vatRequest'`, `relatedId` = id yêu cầu đầu tiên. Chỉ gửi khi tài khoản sale còn tồn tại và đang hoạt động.
     - Thứ tự này đảm bảo **không bao giờ gửi trùng**. Đổi lại, nếu ghi chuông lỗi đúng lúc thì đợt đó mất thông báo; chấp nhận được và có ghi log.
- **Nội dung thông báo:**
  - Trạng thái hiện theo nhãn (`2. Đã khai chờ về`), ngày theo `dd/mm/yyyy`, note bị xóa thì ghi "(xóa note)".
  - Tối đa 5 dòng, phần còn lại ghi "… và N yêu cầu khác".
  - Mỗi yêu cầu 1 dòng, nên CSS chung `.tks-notif-item-msg` thêm `white-space:pre-line`. Các thông báo khác không có xuống dòng nên không bị ảnh hưởng.
- **Chạy ở đâu:** trong tiến trình **web**, giống `specialDayNotifier`, vì chuông lưu ở `server/data/notifications.json` của web. Chạy ngay lúc khởi động rồi quét mỗi 60 giây (`unref`). Bật / tắt bằng `VAT_REQUEST_NOTIFY_ENABLED`, mặc định bật, đặt `false` để tắt. Chưa áp `0080` thì gặp lỗi `42P01`, ghi log một lần rồi bỏ qua.
- **Chuông:** `shared-nav.js` thêm `vatRequest: '/vat-request/'` vào `NOTIF_NAV_TARGETS` để bấm vào thông báo là mở trang.

## Các bước

- [x] **Migration `server/db/migrations/0080_vat_request_notice_state.sql`:** như trên.
- [x] **`server/vatRequests/saleNotifier.js`:** `createSaleNotifier`, `startSaleNotifySchedule`, `formatDigest` (tách riêng để test).
- [x] **`server/config.js`:** thêm `VAT_REQUEST_NOTIFY_ENABLED: process.env.VAT_REQUEST_NOTIFY_ENABLED !== 'false'`. **`server/index.js`:** gọi `startSaleNotifySchedule()` cạnh `startSpecialDayNotifySchedule()`.
- [x] **`server/public/shared/shared-nav.js`:** thêm `vatRequest`, tăng `?v=` của `shared-nav.js` trên mọi trang có nạp nó. **`shared.css`:** thêm `white-space:pre-line` cho `.tks-notif-item-msg`, tăng `?v=`.
- [x] **Tests**
  - `server/vatRequests/saleNotifier.test.js` dùng PGlite với 0018/0053/0076/0079/0080, kèm `notificationRepo` giả và `now` giả. Các trường hợp:
    - KT sửa 3 yêu cầu của sale A trong 25 phút, mỗi lần cách nhau dưới 10 phút: chưa gửi khi chưa đủ 10 phút yên, đúng 1 thông báo khi đủ, giá trị cuối đúng;
    - sửa rồi hoàn tác về như cũ thì không gửi, con trỏ vẫn tiến;
    - sale tự sửa, hoặc trạng thái tự về "Chờ KT xử lý" thì không gửi;
    - yêu cầu không có `created_by` hoặc tài khoản sale ngừng hoạt động thì không gửi;
    - 2 sale ra 2 thông báo riêng, mỗi sale một đồng hồ 10 phút;
    - chạy 2 lần liên tiếp không gửi trùng;
    - dòng lịch sử trước mốc `'*'` không bị báo;
    - ghi chuông lỗi thì không throw;
    - chưa có bảng `0080` thì không throw;
    - `formatDigest`: nhãn trạng thái, ngày, xóa note, quá 5 dòng.
  - `test/frontend/notif-bell.test.js` (đã có sẵn): bấm thông báo `relatedType: 'vatRequest'` thì mở `/vat-request/`; nội dung nhiều dòng hiện đúng từng dòng.
  - Tăng `?v=`: `shared-nav.js` có ở 8 trang, `shared.css` có ở 11 trang.
- [x] **Tài liệu:**
  - `server/db/SCHEMA.md`: thêm `0080`.
  - `server/README.md`: migration, biến môi trường, mô tả job.
  - `README.md`: biến môi trường `VAT_REQUEST_NOTIFY_ENABLED` và mục cập nhật.
  - SRS: thêm FR-VR-20. `docs/04-planning/implementation_plan.md`. `CURRENT.md`.
- [x] **Kiểm tra:**
  - `npm test`, chỉ chấp nhận 4 lỗi có sẵn trên main.
  - Mock PGlite: chạy job với `quietMs` ngắn, KT sửa vài ô, đăng nhập vai sale thì chuông có 1 thông báo đúng nội dung, bấm vào mở ORDER VAT.
  - `graphify update .` nếu máy có lệnh.

## Khi triển khai lên production

1. Áp `0080` (`npm run db:migrate`) **trước** hoặc ngay sau khi deploy, khi được duyệt. Chưa áp thì job chỉ ghi log và bỏ qua, web vẫn chạy bình thường.
2. Deploy web `tokosi`. Job chạy trong web nên worker không cần deploy lại.
3. Kiểm tra: KT sửa 1 yêu cầu của một sale thử, khoảng 10–11 phút sau sale đó có 1 thông báo chuông.

**Lưu ý có sẵn:** chuông lưu ở file `notifications.json` trên đĩa của web. Nếu Render không gắn đĩa bền thì thông báo cũ có thể mất sau mỗi lần deploy. Đây là hạn chế đã có từ trước, PR này không đổi.
