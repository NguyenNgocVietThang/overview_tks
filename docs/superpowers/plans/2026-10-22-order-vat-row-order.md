# ORDER VAT — kéo dòng lên/xuống (thứ tự ưu tiên chung) — kế hoạch triển khai

Bản chốt yêu cầu duyệt trong chat ngày 22/10/2026. Nhánh `feat/vat-request-row-order`, tách từ `main` `9cdb726`. Không commit/push/deploy hoặc áp migration lên DB dùng chung khi chưa được duyệt.

## Bản chốt yêu cầu

- **Kết quả:** KT kéo tay nắm ở đầu dòng lên hoặc xuống (như kéo dòng trong Google Sheet) để xếp thứ tự ưu tiên; thả chuột là lưu ngay.
- **Ai dùng:** chỉ người có `accounting.vatRequestProcess` (KT được cấp quyền, Quản lý) được kéo. Thứ tự **lưu chung**: sale và mọi người đều thấy thứ tự đó nhưng không kéo được.
- **Dòng mới:** yêu cầu mới tự lên đầu bảng; các dòng đã xếp giữ nguyên thứ tự giữa chúng.
- **Thành công khi:** tải lại trang hoặc người khác mở trang vẫn đúng thứ tự; file Excel xuất ra theo cùng thứ tự.
- **Ràng buộc:** chỉ kéo được ở thứ tự gốc. Đang sắp xếp theo cột, gộp theo mã SP hoặc gõ ô tìm kiếm thì tay nắm ẩn (đó là cách xem tạm). Đang lọc bằng chip trạng thái, Sale hoặc ngày thì kéo sẽ xếp lại giữa các dòng đang hiện.
- **Ngoài phạm vi:** thứ tự riêng từng người, sale kéo, kéo giãn chiều cao dòng, kéo cột, kéo bằng cảm ứng trên điện thoại, kéo sang trang khác (mỗi trang 100 dòng).

## Thiết kế

**Lưu thứ tự bằng 1 cột hạng số thực, không đánh số lại cả bảng.**
- Cột `sort_rank NUMERIC NOT NULL`. Danh sách xếp `ORDER BY sort_rank DESC, id DESC`.
- **Dòng mới:** mặc định `extract(epoch from clock_timestamp()) * 1000`, tức mili-giây hiện tại. Dòng tạo sau luôn có hạng lớn hơn mọi dòng cũ nên tự lên đầu, không cần code khi tạo.
- **Dòng cũ (backfill):** `COALESCE(extract(epoch from created_at) * 1000, 0) + id / 1e9`. Thứ tự hiện tại giữ nguyên y hệt, kể cả dòng import thiếu thời gian nằm cuối.
- **Khi kéo, client chỉ gửi dòng hàng xóm sau khi thả:** `{ belowId }` (dòng nằm ngay dưới), hoặc `{ aboveId }` khi thả xuống cuối. Server tự tính hạng mới từ hạng thật trong DB, trong 1 transaction:
  - Có `belowId`, đặt ngay trên dòng đó: tìm hạng nhỏ nhất lớn hơn `below.sort_rank` (bỏ chính dòng đang kéo). Hạng mới = trung điểm của hai hạng, hoặc `below + 1` nếu không có dòng nào ở trên.
  - Chỉ có `aboveId`, đặt ngay dưới dòng đó: tương tự với hạng lớn nhất nhỏ hơn. Hạng mới = trung điểm, hoặc `above - 1`.
  - `NUMERIC` không giới hạn độ chính xác, nên chia đôi mãi không bị trùng.
  - Vì chỉ cần 1 hàng xóm nên việc kéo không phụ thuộc các dòng đang bị lọc ẩn.
- **Không tăng `version`, không ghi lịch sử từng lần kéo.** Thứ tự không phải dữ liệu của yêu cầu, nên kéo dòng không làm 409 người đang sửa ô.
- **Chưa áp migration:** đọc danh sách lỗi `42703` (thiếu cột) thì quay về `ORDER BY created_at DESC`. API kéo trả 503 `ROW_ORDER_UNAVAILABLE`, giao diện ẩn tay nắm theo cờ `rowOrder: false` trong `list()`.

## Các bước

- [x] **Migration `server/db/migrations/0079_vat_request_sort_rank.sql`** (chỉ thêm, idempotent):
  - `ALTER TABLE vat_requests ADD COLUMN IF NOT EXISTS sort_rank NUMERIC`.
  - Backfill dòng NULL theo công thức trên.
  - `SET DEFAULT (extract(epoch from clock_timestamp()) * 1000)`, rồi `SET NOT NULL`.
  - Index `(sort_rank DESC, id DESC) WHERE NOT is_deleted`.
  - Không đổi quyền `reporting_readonly` (bảng đã bị thu hồi ở 0076).
- [x] **Repository** `server/vatRequests/repository.js`:
  - `listRequests` đổi `ORDER BY` sang `r.sort_rank DESC, r.id DESC`, có nhánh dự phòng `42703`.
  - Thêm `moveRequest(client, id, { aboveId, belowId })`:
    - khóa dòng `FOR UPDATE`;
    - đọc hạng hàng xóm, dòng phải chưa xóa;
    - tìm hạng kề bằng 1 câu `min`/`max`;
    - `UPDATE vat_requests SET sort_rank = $2 WHERE id = $1`.
  - Hàng xóm không tồn tại, bị xóa hoặc chính là dòng đang kéo thì trả 400.
- [x] **Service** `server/vatRequests/service.js`:
  - Thêm `move(user, id, payload)`: chỉ `canProcess` (403 `FEATURE_FORBIDDEN`); cần đúng 1 trong `aboveId` / `belowId` là số nguyên dương.
  - `list()` trả thêm `rowOrder: true|false`.
  - `exportList` dùng `list()` sẵn nên Excel tự theo thứ tự mới.
- [x] **Route** `server/vatRequests/routes.js`: `PATCH /:id/position` đặt trước `/:id`, trả `{ ok: true }`.
- [x] **Frontend** `server/public/vat-request/vat-request.js` (+ CSS, `index.html` tăng `?v=`):
  - **Tay nắm:** nút ⋮⋮ (`button[data-row-drag]`, `aria-label="Kéo để đổi thứ tự yêu cầu #id"`) đặt cạnh ô tick ở cột Chọn. Chỉ hiện khi đủ các điều kiện: `canProcess && rowOrder && !sortKey && !groupByProduct && !query` và không phải thiết bị cảm ứng.
    - Là `button` nên `vat-request-grid.js` tự bỏ qua (`CONTROLS`), không lẫn với kéo chọn ô.
  - **Kéo bằng chuột:**
    - mousedown trên tay nắm là bắt đầu kéo; dòng đang kéo mờ đi;
    - mouseover lên dòng khác hiện vạch xanh trên hoặc dưới dòng đó, tùy nửa trên hay nửa dưới;
    - tự cuộn khung `#vrScroll` khi chuột sát mép trên/dưới;
    - mouseup thì tính `belowId`/`aboveId` theo vị trí thả, dời dòng ngay trong `state.rows` rồi `render()` (lạc quan), sau đó gọi `PATCH /:id/position`;
    - lỗi thì báo và `load()` lại;
    - Esc hủy kéo.
  - **Bàn phím:** khi tay nắm đang focus, Alt+↑ / Alt+↓ dời 1 dòng, gửi cùng API.
  - **Thông báo:** `#vrStatus` hiện "Đã chuyển yêu cầu #id." Có `aria-live` sẵn thì đọc được.
- [x] **Tests**
  - `vatRequests/service.test.js` (PGlite, thêm `0079` vào `MIGRATIONS`):
    - dòng mới lên đầu;
    - kéo lên giữa, lên đầu, xuống cuối đều đúng thứ tự `list()`;
    - kéo 30 lần liên tiếp vào cùng một khe vẫn đúng (trung điểm không trùng);
    - sale hoặc KT chưa cấp quyền bị 403;
    - hàng xóm sai hoặc đã xóa bị 400;
    - kéo không đổi `version`, không thêm lịch sử;
    - `exportList` theo thứ tự mới;
    - không có cột `sort_rank` (bỏ `0079`) thì `list()` vẫn chạy, có `rowOrder: false`.
  - `vatRequests/routes.test.js`: route `/:id/position` không bị `/:id` nuốt.
  - `test/frontend/vat-request.test.js`:
    - KT có tay nắm, sale không có;
    - tay nắm ẩn khi đang sắp xếp theo cột, gộp mã hoặc tìm kiếm;
    - kéo dòng 3 lên trên dòng 1 thì gửi `{ belowId: 1 }` và đổi thứ tự ngay;
    - thả xuống cuối thì gửi `{ aboveId }`;
    - Alt+↓ dời 1 dòng;
    - API lỗi thì `load()` lại và báo lỗi;
    - kéo dòng không bật vùng chọn ô của grid.
- [x] **Tài liệu** (theo skill `update-file`):
  - `server/db/SCHEMA.md`: thêm `0079`.
  - `server/README.md`: danh sách migration và API `PATCH /:id/position`.
  - `README.md`: mục cập nhật gần nhất.
  - `docs/02-srs/SRS_Dashboard_GoogleSheets.md`: thêm FR-VR-17.
  - `docs/04-planning/implementation_plan.md`.
  - `CURRENT.md`.
- [x] **Kiểm tra:**
  - `npm test`: chỉ chấp nhận 4 lỗi có sẵn trên main (`sort-icons`, `overview-endpoints-access`).
  - Mock `vat-request-ui-mock` (PGlite) chỉ áp 0018/0053/0076, nên cần thêm 0079 vào mock (file mock ở scratchpad cũ, sửa bản sao).
  - Trên Chrome kiểm tra: KT kéo lên/xuống/cuối, tải lại vẫn giữ; sale thấy cùng thứ tự, không có tay nắm; sắp xếp theo cột thì tay nắm ẩn, bấm về gốc thì thứ tự kéo còn nguyên; tạo yêu cầu mới thì lên đầu; nền sáng/tối; không lỗi console.
  - `graphify update .` nếu máy có lệnh.

## Khi triển khai lên production

1. Merge rồi deploy. Code chạy được cả khi chưa có cột: thứ tự như cũ, tay nắm ẩn.
2. Áp `0079` lên DB dùng chung (`npm run db:migrate`) **khi người dùng duyệt**. Backfill khoảng 1.400 dòng, chạy nhanh.
3. Tải lại trang: tay nắm hiện với KT, thứ tự ban đầu y như trước.

## Bổ sung 22/10/2026 — kéo nhiều dòng một lúc (đã làm)

Bản chốt sau khi thử: chọn dòng như đầu dòng Google Sheet (bấm tay nắm, Shift đoạn liền, Ctrl thêm/bỏ), chung vùng chọn với ô tick; kéo nhóm thì dòng rời nhau gom thành 1 khối tại chỗ thả, giữ thứ tự. API đổi `PATCH /:id/position` → `PATCH /position { ids, belowId | aboveId }`; `moveRequest` → `moveRequests` chia đều khe bằng `k / 2^m` chính xác.

