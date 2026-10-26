# Sắp xếp cột nhập liệu và căn giữa tiêu đề bảng

Ngày: 26/10/2026. Thiết kế đã được người dùng duyệt trong chat; đã triển khai cục bộ và kiểm tra nhóm liên quan/fixture trình duyệt; toàn suite 3.582 test: 3.579 đạt, 3 bỏ qua, 0 lỗi; chưa commit/push/deploy.

## Mục tiêu

Các cột chứa ô nhập, danh sách chọn hoặc vùng ghi chú phải sắp xếp theo giá trị hiện tại của ô. Tiêu đề cột của các bảng dữ liệu căn giữa; cách căn nội dung ô giữ nguyên.

## Hành vi đã duyệt

- Đọc `input.value`, `textarea.value` và nhãn lựa chọn hiện tại của `select`, thay vì `textContent` rỗng hoặc toàn bộ danh sách option.
- Khi ô có form control, giá trị hiện tại được ưu tiên hơn `data-sort-value`/`data-sort-text` có thể đã cũ sau chỉnh sửa. Ô chỉ đọc tiếp tục dùng metadata sort hiện có.
- So sánh số theo giá trị số và ngày theo thời gian; văn bản theo cách sắp xếp tiếng Việt hiện có. Giữ quy tắc ô trống và thứ tự ổn định của từng bộ điều khiển bảng.
- Bấm tiêu đề lần lượt chuyển tăng dần → giảm dần → thứ tự ban đầu.
- Căn giữa tiêu đề, bao gồm tiêu đề số liệu và nhãn nằm trong nút sort; giữ biểu tượng sort dễ nhìn và không ảnh hưởng thao tác kéo độ rộng cột.
- Bảng phân trang tiếp tục sắp xếp trên toàn bộ dữ liệu đã lọc, không chỉ các dòng đang hiển thị. Không chồng sort tại chỗ lên bảng đang sắp xếp ở máy chủ.
- Giữ các ngoại lệ có chủ đích: cột thao tác, dòng nhóm/tổng, bảng tài liệu trong trình soạn thảo và bảng đã tắt sort.

## Phạm vi kỹ thuật

Rà soát bộ đọc giá trị trong `server/public/shared/table-controls.js` và mã sort riêng của trang, đặc biệt `server/public/index.html` và `server/public/humanresources/index.html`. Sửa quy tắc căn tiêu đề tại CSS dùng chung để thống nhất các bảng. Không thêm API, migration hoặc thư viện.

Kết quả rà soát ban đầu: `cellText` của bộ điều khiển chung đã đọc form control nhưng metadata sort có thể được ưu tiên trước; `getTableSortValue` của Dashboard/Nhân sự vẫn đọc `textContent`. Cần sửa cả hai đường để không chỉ khắc phục một nhóm bảng.

Thực hiện trên checkout riêng của `main` local theo lựa chọn bổ sung của người dùng: `C:/Users/BOSS/.codex/worktrees/editable-table-sort/Web TKS Dashboard`, tại commit nền `18dab0c6`; không pull. Giữ nguyên phần thay đổi prototype trong workspace cũ. Một subagent phụ trách tài liệu Markdown; agent chính sửa mã và kiểm chứng.

## Tiêu chí kiểm chứng

Kiểm tra input chữ/số/ngày, textarea, select có nhiều option và giá trị vừa sửa; đủ ba trạng thái sort và trường hợp bằng nhau/ô trống. Kiểm tra bảng phân trang và bảng đã tắt sort không đổi hành vi. Kiểm tra căn giữa tiêu đề ở bảng thường, bảng có nút sort và cột số liệu; nội dung ô vẫn giữ căn cũ. Chạy các test frontend liên quan, sau đó suite của dự án và ghi rõ giới hạn nếu còn lỗi ngoài phạm vi.

## Bằng chứng hiện có

- Nhóm frontend liên quan: 54/54 đạt, gồm table-controls, table-controls-integration, table-time-sort, sort-icons và order-lifecycle-sort; log `server/table-sort-targeted.log`.
- Ba regression case lỗi trước sửa và đạt sau sửa. Bao phủ số định dạng `1,234.50`/`-12,5`, giữ SĐT dạng chữ, giá trị control hiện tại thắng metadata cũ và `sortItemsByRenderedColumn` trên toàn danh sách.
- Fixture Edge headless dùng CSS chung và table-controls thật: đủ chu kỳ sort, input/select/textarea/ngày; tiêu đề kể cả cột số căn giữa, ô số vẫn căn phải; desktop 1440px/mobile 390px, sáng/tối, không page error hoặc tràn trang. Ảnh `.codex_tmp/table-sort-desktop.png`, `.codex_tmp/table-sort-mobile.png`.
- Đây là kiểm tra fixture, chưa kiểm ứng dụng có đăng nhập hoặc production.
- `graphify update .` exit 0: 12.836 nút, 28.117 cạnh, 542 cộng đồng; cache/report đã thay đổi. Toàn suite `npm test -- --test-concurrency=4` exit 0: 3.582 test, 3.579 đạt, 3 bỏ qua, 0 lỗi, 513.452 ms; log `server/table-sort-full.log`. Log đồ thị cuối `server/table-sort-graphify-final.log`. Chưa commit/push/deploy.
Môi trường toàn suite: dùng `NODE_PATH` trỏ node_modules workspace gốc, `GOOGLE_SERVICE_ACCOUNT_JSON='{}'` và `JWT_SECRET` giả; `DATABASE_URL`/`SUPABASE_DB_URL` trống. Không dùng kết quả này để suy ra ứng dụng có đăng nhập hay production đã được kiểm tra. Chưa kiểm kéo độ rộng cột bằng trình duyệt.