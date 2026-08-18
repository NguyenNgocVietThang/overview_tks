# 3D Effects Rollback Guide

Hướng dẫn tắt hoặc gỡ bỏ lớp hiệu ứng 3D (particle background, tilt card, 3D chart, loading cube) nếu gây sự cố trên production. Lớp 3D là **progressive enhancement** — gỡ bỏ hoàn toàn không ảnh hưởng dữ liệu, layout gốc hay tính năng nghiệp vụ.

## Phạm vi ảnh hưởng

7 trang có tích hợp 3D: `server/public/index.html`, `login/index.html`, `register/index.html`, `account/index.html`, `shipment/index.html`, `shipment/dispatch/index.html`, `shipment/mobile/index.html`.

9 file nguồn liên quan:
```
server/public/vendor/three.min.js
server/public/shared/three-bg.js
server/public/shared/three-interactions.js
server/public/shared/three-loading.js
server/public/shared/three-performance.js
server/public/shared/three-memory.js
server/public/shared/three-visibility.js
server/public/js/three-charts.js          (chỉ index.html)
server/public/shared/shared.css           (chứa CSS 3D: .card-3d, .tks-bg-canvas, nav/button/table hover, không cần xóa file — xem "Rollback CSS" bên dưới)
```

## Tắt nhanh (theo từng trang)

Mỗi trang có 2 nhóm thẻ `<script>` liên quan đến 3D:

**Nhóm 1 — đầu trang, trong `<head>`:**
```html
<script src="/shared/three-interactions.js"></script>
<script src="/shared/three-loading.js"></script>
```

**Nhóm 2 — cuối trang, trước `</body>`:**
```html
<script src="/vendor/three.min.js"></script>
<script src="/shared/three-performance.js"></script>
<script src="/shared/three-memory.js"></script>
<script src="/shared/three-visibility.js"></script>
<script src="/shared/three-bg.js"></script>
<script src="/js/three-charts.js"></script>   <!-- chỉ có ở index.html -->
```

Xóa (hoặc comment `<!-- -->`) cả 2 nhóm trên khỏi 1 trang để tắt 3D chỉ trên trang đó. Không cần đổi gì khác — HTML/CSS gốc bên dưới vẫn còn nguyên, các class như `.card-3d` chỉ có `:hover` transform, không có JS bắt buộc nào khác phụ thuộc các script này.

## Tắt toàn site

Lặp lại thao tác "Tắt nhanh" ở trên cho cả 7 trang liệt kê ở mục "Phạm vi ảnh hưởng".

## Rollback bằng Git (khôi phục về trước khi có 3D)

Nếu cần gỡ bỏ hẳn cả file nguồn (không chỉ script tag), dùng git để khôi phục các file 3D về trạng thái trước khi tính năng được thêm vào. Xác định commit trước khi 3D được thêm bằng:

```bash
git log --oneline -- server/public/vendor/three.min.js | tail -1
```

Sau đó, với `<commit-before-3D>` là commit ngay trước dòng kết quả trên (hoặc dùng `git log -p -- "3D Design.md"` để tìm mốc bắt đầu tính năng):

```bash
git rm server/public/vendor/three.min.js
git rm server/public/shared/three-bg.js
git rm server/public/shared/three-interactions.js
git rm server/public/shared/three-loading.js
git rm server/public/shared/three-performance.js
git rm server/public/shared/three-memory.js
git rm server/public/shared/three-visibility.js
git rm server/public/js/three-charts.js
```

Sau đó xóa thủ công tất cả `<script src="/shared/three-*.js">`, `<script src="/vendor/three.min.js">`, `<script src="/js/three-charts.js">` khỏi 7 trang HTML (dùng "Tắt nhanh" ở trên trên từng trang), và xóa các khối CSS 3D-only trong `server/public/shared/shared.css` nếu muốn dọn sạch hoàn toàn (không bắt buộc — CSS không dùng thì không có tác dụng phụ nếu JS đã bị gỡ).

## Rollback CSS (tùy chọn, không bắt buộc)

`shared.css` chứa các rule 3D sau — có thể để nguyên (vô hại nếu JS bị gỡ) hoặc xóa nếu muốn dọn sạch:
- `.tks-bg-canvas` — style canvas nền, vô dụng nếu `three-bg.js` không chạy (canvas không được tạo ra)
- `.card-3d`, `.kpi-card`, `.panel` hover transform/box-shadow — thuần CSS `:hover`, không phụ thuộc JS, vẫn chạy dù xóa toàn bộ JS 3D
- `.nav-item`, `.btn-primary`, `tbody tr`, `.search-input` 3D hover — tương tự, thuần CSS
- `@media (prefers-reduced-motion: reduce)` và `@media (forced-colors: active)` blocks — an toàn khi để nguyên

## Xác minh sau rollback

- [ ] Mở console trình duyệt trên trang vừa rollback → không có lỗi `THREE is not defined` hoặc script 404
- [ ] Hover vào KPI card → không còn tilt effect (phẳng, có thể vẫn còn shadow nhẹ nếu để nguyên CSS)
- [ ] Không còn particle background phía sau nội dung
- [ ] Form/table/search/nav vẫn hoạt động bình thường (các tính năng này không phụ thuộc 3D)
- [ ] Trang tải nhanh hơn (giảm ~650KB do không load `three.min.js`)

## Khôi phục lại 3D sau khi rollback

```bash
git revert <commit-rollback>
```
hoặc thêm lại các thẻ `<script>` ở mục "Tắt nhanh" theo đúng thứ tự đã liệt kê (thứ tự bắt buộc — `three.min.js` phải load trước các module `three-performance.js`/`three-memory.js`/`three-visibility.js`/`three-bg.js`/`three-charts.js`).
