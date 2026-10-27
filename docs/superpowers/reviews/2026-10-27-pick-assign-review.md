# Rà soát Chỉ định vị trí — 2026-10-27

Phạm vi: mã trong cây làm việc nhánh `feat/lifecycle-pick-assign`, sau khi `git status --short` đã có `server/pickAssignments/` và `server/public/shipment/lifecycle/pick/`. Chỉ đọc nguồn backend/frontend; không sửa nguồn tính năng, không chạy server, không migrate/ghi DB thật. PGlite dùng trong bộ nhớ. Đây là rà soát phiên bản cục bộ, không xác nhận triển khai.

## Lỗi cần sửa (theo mức nghiêm trọng)

### 1. [P1] Xác nhận trừ vị trí/quy cách đã đổi nhưng phiếu vẫn ghi thông tin cũ

- **Vị trí:** `server/pickAssignments/pickAssignmentsService.js:353`–`362` (nhánh `confirm`); `server/stockPositions/stockPositionsService.js:270` cho phép đổi vị trí.
- **Kịch bản đã tái hiện:** vị trí id 1 ở A01, ghi chú `3T x 100`; chỉ định 100, phiếu ghi A01 / `1Tx100`. Sau đó sửa cùng id thành B02 / `3T x 50`, tăng version. Gọi confirm với version chỉ định = 1 vẫn trả `confirmed`, trừ thành `1T x 50` tại B02, trong khi assignment vẫn A01 / `1Tx100`.
- **Nguyên nhân:** khóa dòng có hiệu lực nhưng confirm chỉ kiểm tồn đủ và parse được; không so lại location/quy cách với thông tin đã chỉ định. Version chỉ định không phát hiện version vị trí đã đổi.
- **Đề xuất:** lưu dấu vết vị trí/quy cách/version lúc chỉ định; dưới khóa dòng, từ chối `STOCK_CHANGED` nếu thông tin làm thay đổi phiếu đã phát hành. Không chặn mọi thay đổi notes một cách máy móc vì các đơn khác có thể xác nhận hợp lệ; cần phân biệt giảm tồn với đổi vị trí/quy cách. Yêu cầu hủy rồi chỉ định lại khi phiếu không còn đúng.

### 2. [P1] Số lượng lẻ được giữ chỗ/ghi đã nhặt nhưng lượng thực trừ bị làm tròn

- **Vị trí:** `server/pickAssignments/pickAssignmentsService.js:238` (chỉ kiểm hữu hạn, > 0), `server/pickAssignments/pickAssignmentsService.js:360`; `server/public/shared/carton.js:110` và `:120` (`Math.round(quantity)` khi trừ/cộng trả).
- **Kịch bản đã tái hiện:** đơn cần 0.4, vị trí `1Tx100`, phân bổ 0.4. `PickingRules.validate` trả `[]`; `deduct` trả ghi chú vẫn `1T x 100`, quantity vẫn 100, nhưng `taken = 0.004`. Confirm ghi `picked_qty = 0.4` và chuyển confirmed dù tồn không giảm. Với 0.6 thì giảm 1. Khi hoàn tác sau sửa notes, restore cũng làm tròn.
- **Đề xuất:** nếu nghiệp vụ nhặt chỉ cho số chiếc nguyên, chặn đơn/phân bổ lẻ ở máy chủ và báo rõ trước khi tạo giữ chỗ; nếu phải hỗ trợ NUMERIC lẻ, sửa đồng bộ parser/format/deduct/restore để bảo toàn số lượng. Bổ sung ca 0.4, 0.6 và hoàn tác sau đổi ghi chú.

### 3. [P2] Gộp dòng cùng mã làm sai tiền trên phiếu

- **Vị trí:** `server/pickAssignments/pickAssignmentsService.js:53`, `:256`–`258`; `server/public/shipment/lifecycle/pick/invoice.js:61`–`63`.
- **Kịch bản đã tái hiện:** cùng mã A, 10.000 chiếc giá 10 và 1 chiếc giá 11: tiền gốc 100.011. `mergeOrderLines` làm tròn giá bình quân về 10; snapshot chỉ giữ dòng gộp và phiếu tính lại thành 100.010. Mất cả chi tiết dòng gốc; làm tròn discount bình quân có rủi ro tương tự.
- **Đề xuất:** chỉ gộp để phân bổ/giữ chỗ; giữ dòng gốc và thành tiền gốc trong snapshot dùng in, hoặc lưu tổng tiền chính xác và không suy ngược từ giá bình quân đã làm tròn. Không dùng client làm nguồn tiền.

### 4. [P2] Lỗi mạng làm popup mắc vĩnh viễn ở trạng thái bận

- **Vị trí:** `server/public/shipment/lifecycle/pick/pick-assign.js:27`, `:161`–`164`, `:172`–`175`, `:185`.
- **Kịch bản:** mở popup thành công; mất mạng hoặc fetch bị reject khi tạo/xác nhận/hủy/chỉ định lại. `busy(true)` đã chạy; await ném lỗi trước khi đặt busy về false. Các nút bị disabled; mở lại popup không đặt lại `state.busy`, nên không phục hồi thao tác trong cùng trang.
- **Đề xuất:** dùng try/catch/finally để luôn bỏ busy, thông báo lỗi kết nối; sau lỗi ghi không rõ kết quả, tải lại trạng thái máy chủ trước khi cho thử lại để tránh hiểu nhầm thao tác chưa thành công.

## Các mục đã đối chiếu, chưa thấy lỗi trực tiếp

- Assign/confirm/cancel ghi trong `withTransaction`; cùng advisory lock `stock_positions:<branch>` với stockPositions; dòng vị trí khóa `ORDER BY id FOR UPDATE`, chỉ định khóa theo id và kiểm `version` trước đổi trạng thái.
- Migration 0096 có partial unique index `(branch, lower(btrim(order_code))) WHERE status IN ('picking','confirmed')`, chặn hai chỉ định hoạt động cùng đơn; lịch sử có trigger chặn sửa/xóa và thu hồi quyền reporting_readonly.
- Giữ chỗ chỉ cộng `reserved_qty` của đơn khác đang picking, tách HN/SG; tra mã theo `lower(btrim(code))`; gộp theo mã, bỏ dòng dịch vụ/VAT. Server tự đọc đơn Kiot và trạng thái lifecycle. Lưu ý trạng thái/dòng đơn được đọc trước transaction, không phải snapshot giao dịch với nguồn lifecycle/Sheets; chưa xác minh tranh chấp với cập nhật nguồn ngoài.
- Hủy sau confirmed: notes bằng spec_after thì trả nguyên spec_before; khác thì restore; dòng mất thì tìm dòng cùng mã/vị trí hoặc dựng lại từ position_snapshot. Status/version chặn lần hủy/xác nhận lặp, không cộng hai lần. Retry không trả thành công idempotent mà trả VERSION_CONFLICT/INVALID_STATE; không coi đây là lỗi cộng tồn.
- Mọi route trong router `/api/shipment/pick` đi qua `requireAuth` và `requireFeature('shipment.pick')`. `shipment.pick` và `stockLocationsV2.edit` đều mặc định MANAGER_ONLY; không thấy mở quyền edit cho vai trò khác. Router không truyền scope, tương tự chủ đích lifecycle xem cả hai cơ sở; không kết luận đây là lỗ hổng khi chưa có yêu cầu giới hạn cơ sở theo tài khoản.
- Popup và phiếu in escape dữ liệu API trước nội suy HTML; text trạng thái dùng textContent. Chưa thấy đường XSS trực tiếp từ dữ liệu đơn/vị trí đã rà.
- CSS dùng biến theme, có màu khu riêng cho light và media max-width 600px; bảng có cuộn ngang trong khung. Chưa kiểm trình duyệt thật ở sáng/tối/375px, không khẳng định đã xác minh trực quan hoặc thao tác in hệ điều hành.

## Đối chiếu nguồn sau thông báo hai agent hoàn tất

Đã đọc lại service/router, migration, frontend và bộ lọc sau khi nhận thông báo mã ổn định. `latestStatuses` dùng DISTINCT ON theo cơ sở/mã đơn và id giảm dần nên lấy cả cancelled; route danh sách và xuất Excel đều truyền `pickStatuses`. Export lọc đúng tập đơn nhưng chưa có cột trạng thái chỉ định. `snapshot.priorDebt` chưa có nguồn nên phiếu để trống. Nhãn pick/pick_revert có ở cả helper backend và giao diện VT. Các hạn chế được báo từ hai agent (chưa thử trình duyệt/backend thật, PGlite một kết nối) vẫn còn.

## Kiểm thử của phiên rà soát

- `node server/prototype-build.cjs`: exit 0. Prototype có sẵn 91 test xanh; thêm ca không nạp bộ popup/in thật, đã đỏ trước sửa build và xanh sau sửa; toàn bộ `node --test "public/prototypes/order-picking/*.test.js"` đạt 92/92, không bỏ qua.
- `node --test "pickAssignments/pickAssignmentsService.test.js"`: 15/15 đạt, gồm hoàn tác ghi chú đổi, auto_delete/tái tạo và chặn gọi lại. Những test này chưa bao phủ bốn lỗi đã nêu.
- Chạy thêm glob `pickAssignments/*.test.js` gặp EACCES khi fetch tới 127.0.0.1 trong test router, exit 1; đây là giới hạn kết nối localhost của môi trường kiểm tra, không kết luận route bị lỗi và không xác nhận nhóm router xanh tại đây.
- Không chạy thêm npm test toàn bộ vì phiên tích hợp đang chạy nền; không chạy graphify vì phạm vi sửa file được giới hạn cho báo cáo, prototype và tám tài liệu. Chưa thử trình duyệt thật hoặc PostgreSQL nhiều kết nối.

## Bằng chứng và giới hạn

Hai kiểm chứng độc lập trong bộ nhớ: PGlite nạp 0001/0064/0095/0096 cho ca đổi vị trí/quy cách; gọi hàm thuần thực tế cho số lượng lẻ và tiền gộp. Không dùng kết nối pool thật. Ca lỗi mạng được xác định từ luồng await không có catch/finally. Không dùng PGlite một kết nối để kết luận rằng đã kiểm chứng tranh chấp PostgreSQL nhiều kết nối.

Cập nhật cuối: 2026-10-27.
