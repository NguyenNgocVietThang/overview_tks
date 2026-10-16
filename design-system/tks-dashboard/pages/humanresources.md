# Page Design Notes — `humanresources/index.html` (Nhân Sự / Nghỉ Phép)

> Kế thừa toàn bộ `MASTER.md`. Audit gần nhất: 2026-09-15. **Cập nhật 2026-10-12:**
> Bảng danh sách nhân sự, bảng chấm công, bảng nghỉ phép được bổ sung điều khiển phân trang chuẩn (`table-controls.js`).
> Hộp xem chi tiết đơn nghỉ phép (`#leaveDetailModal`) áp dụng chuẩn dùng chung `detail-panel.css` (`.dp-*`) với hàng chỉ số tổng quan (`.dp-stats`), 1 khung cuộn thống nhất.
> **Cập nhật 2026-10-15:** Gỡ nút "Lịch làm việc" (cấu hình giờ ca theo ngày) và hộp tương ứng khỏi tab Nghỉ phép; bỏ `PUT /api/hr/leave-work-schedules/:id`. Giữ `GET` và giờ mặc định cố định 07:45 (sáng) / 12:30 (chiều). Trạng thái nhân sự (`employment_status`) phân biệt `active`/`resigned` khỏi xóa mềm `is_active` (Migration `0041`): khi nhân sự nghỉ việc → tự động khóa tài khoản liên kết với `lock_reason = 'hr_resigned'`.

## Vai trò trang
Quản lý đơn nghỉ phép (duyệt/từ chối), KPI nhân sự, tra cứu chính sách nghỉ phép dạng tài liệu in. Nghỉ phép cho tài khoản nội bộ chưa gắn nhân sự (Migration `0042`): mọi tài khoản nội bộ đang hoạt động (trừ Khách) đều được gửi đơn, cơ sở lấy từ đơn, giờ mặc định 07:45 / 12:30.

## Trạng thái nhân sự
- `employment_status`: `active` (đang làm) | `resigned` (đã nghỉ việc) — tách khỏi xóa mềm `is_active`.
- Khi `resigned`: tự động gọi `lockAccount({ lock_reason: 'hr_resigned' })`; khi kích hoạt lại: mở tài khoản.
- Badge hiển thị `employment_status` dùng hệ token màu có sẵn (`--green`, `--red`) qua `.status-active`/`.status-locked`.

## Giờ làm việc mặc định (cố định)
- Sáng: **07:45**; Chiều: **12:30** — không còn API cấu hình, không còn UI chỉnh sửa giờ ca.
- `GET /api/hr/leave-work-schedules/:id` vẫn giữ để xem trước khi ghi nhận vắng.

## Component đặc thù của trang
- Sub-nav gạch chân (`.hr-subnav-item`) — cùng mẫu với `account`, xem MASTER §5.9.
- KPI card với biến thể màu (`.kpi-stat.kpi-green/red/amber`) — biến thể "colored KPI" đáng đưa vào MASTER §5.2 làm modifier chính thức của KPI card.
- **Editable Status Select** (`.status-select` + `.leave-pending/approved/rejected/violation`) — đây là bản triển khai gốc của mẫu ở MASTER §5.6b, chất lượng tốt, dùng `color-mix()` cho viền. Giữ nguyên làm chuẩn khi cần trạng thái chỉnh sửa trực tiếp trong bảng ở trang khác.
- Row update flash (`@keyframes rowPulseHighlight`, `.row-highlight-update`) — bản gốc của MASTER §5.16.
- Sortable table header (`.sort-button`, `th.sortable`) — bản gốc của MASTER §5.13.
- `.link-code-display` — chip mã mời dạng monospace, pattern mới đáng tái sử dụng khi cần hiển thị mã/link ngắn dùng để chia sẻ.
- `.doc-page` (trình xem văn bản chính sách dạng "trang giấy in") — **ngoại lệ có chủ đích**, xem MASTER §5.17. Không áp token theme (`--panel`/`--text`) lên khối này hay phần tử con của nó.
- Hộp chi tiết nghỉ phép chuẩn hóa theo `.dp-*` (`public/shared/detail-panel.css`), dải thẻ `.dp-stats`.
- Modal duyệt/từ chối nghỉ phép dùng chung khung `.modal-overlay/.modal-box` — cần sửa theo §12.1.

## Tài liệu chính sách (doc-page)
- Hiện có 4 tài liệu dựng sẵn trong `hr_rule_documents`: `nghi-phep`, `chi-tieu`, `phuc-loi` (Migration `0039`), `treo-hang` (Migration `0049` — chưa áp DB/deploy tính đến 15/10).
- `font-family: 'Noto Serif', Georgia, serif` + bảng màu hardcode cố định (ngoại lệ theo MASTER §5.17). Không áp token Dark/Light Mode.

## Nợ thiết kế riêng của trang
1. **`backdrop-filter: blur(3px)` trên `.modal-overlay`** — vi phạm MASTER §7.1, sửa theo §5.7.
2. `.export-button` bị khai báo lại đầy đủ (gradient/shadow/hover) dù `shared.css` đã có cùng selector trong nhóm dùng chung — giá trị trùng khớp nên không gây lỗi hiển thị, nhưng nên xoá phần khai báo lặp khi có dịp dọn file.
3. `.empty-row` là bản thu gọn của `.empty-state` (đã có ở `shared.css`) — cân nhắc dùng thẳng `.empty-state` thay vì giữ 2 bản.
4. 5 icon chevron SVG data-URI (mỗi màu trạng thái một icon riêng cho `.status-select`) có thể giảm còn 1 SVG dùng `currentColor` — tối ưu nhỏ, không khẩn cấp.
