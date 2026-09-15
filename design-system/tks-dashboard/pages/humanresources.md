# Page Design Notes — `humanresources/index.html` (Nhân Sự / Nghỉ Phép)

> Kế thừa toàn bộ `MASTER.md`. Audit gần nhất: 2026-09-15.

## Vai trò trang
Quản lý đơn nghỉ phép (duyệt/từ chối), KPI nhân sự, tra cứu chính sách nghỉ phép dạng tài liệu in.

## Component đặc thù của trang
- Sub-nav gạch chân (`.hr-subnav-item`) — cùng mẫu với `account`, xem MASTER §5.9.
- KPI card với biến thể màu (`.kpi-stat.kpi-green/red/amber`) — biến thể "colored KPI" đáng đưa vào
  MASTER §5.2 làm modifier chính thức của KPI card.
- **Editable Status Select** (`.status-select` + `.leave-pending/approved/rejected/violation`) — đây
  là bản triển khai gốc của mẫu ở MASTER §5.6b, chất lượng tốt, dùng `color-mix()` cho viền. Giữ
  nguyên làm chuẩn khi cần trạng thái chỉnh sửa trực tiếp trong bảng ở trang khác.
- Row update flash (`@keyframes rowPulseHighlight`, `.row-highlight-update`) — bản gốc của MASTER
  §5.16.
- Sortable table header (`.sort-button`, `th.sortable`) — bản gốc của MASTER §5.13.
- `.link-code-display` — chip mã mời dạng monospace, pattern mới đáng tái sử dụng khi cần hiển thị
  mã/link ngắn dùng để chia sẻ.
- `.doc-page` (trình xem văn bản chính sách dạng "trang giấy in") — **ngoại lệ có chủ đích**, xem
  MASTER §5.17. Không áp token theme (`--panel`/`--text`) lên khối này hay phần tử con của nó.
- Modal duyệt/từ chối nghỉ phép dùng chung khung `.modal-overlay/.modal-box` — cần sửa theo §12.1.

## Nợ thiết kế riêng của trang
1. **`backdrop-filter: blur(3px)` trên `.modal-overlay`** — vi phạm MASTER §7.1, sửa theo §5.7.
2. `.export-button` bị khai báo lại đầy đủ (gradient/shadow/hover) dù `shared.css` đã có cùng
   selector trong nhóm dùng chung — giá trị trùng khớp nên không gây lỗi hiển thị, nhưng nên xoá
   phần khai báo lặp khi có dịp dọn file.
3. `.empty-row` là bản thu gọn của `.empty-state` (đã có ở `shared.css`) — cân nhắc dùng thẳng
   `.empty-state` thay vì giữ 2 bản.
4. 5 icon chevron SVG data-URI (mỗi màu trạng thái một icon riêng cho `.status-select`) có thể giảm
   còn 1 SVG dùng `currentColor` — tối ưu nhỏ, không khẩn cấp.
