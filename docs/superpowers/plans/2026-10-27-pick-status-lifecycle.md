# Kế hoạch: Trạng thái bốc hàng + phiếu in mới (2026-10-27)

Nguồn: bản chốt ý định đã được người dùng xác nhận trong phiên phỏng vấn (không lưu `docs/intent/`). `tasks/plan.md` + `tasks/todo.md` đang là kế hoạch KHÁC chưa xong (vá auth 2026-10-05), nên kế hoạch này nằm riêng ở đây.

## Hiện trạng (đã có từ commit 812f6e25 → 0dc6e218)

Module `server/pickAssignments/` + migration 0096/0097: bảng `order_pick_assignments` (status `picking` / `confirmed` / `cancelled`), `order_pick_lines`, `order_pick_history`. `picking` = giữ chỗ (không đổi ghi chú thùng), `confirmed` = trừ thùng thật trong `stock_positions`, `cancelled` = trả giữ chỗ (nếu đã confirmed thì hoàn tác). Chỉ định lại = hủy rồi chỉ định mới. Giao diện hộp chỉ định + phiếu in ở `server/public/shipment/lifecycle/pick/`. Luật đọc ghi chú thùng ở `server/public/shared/carton.js`. => Phần lớn mô hình dữ liệu ĐÃ khớp; việc còn lại là phần delta dưới đây.

## Ý định đã chốt (rút gọn)

- **Phiếu in:** cột TT, Tên hàng, SL, Đơn giá, Thành tiền, Ghi chú, Vị trí, Thùng (= cột "ST" cũ, đổi tên), Thực nhặt. Ô Vị trí: 1 vị trí → chỉ tên vị trí; từ 2 vị trí → mỗi vị trí 1 dòng `VT: SL` (SL in đậm). Cột Vị trí đủ rộng cho mã dạng `A01:200000`.
- **Thẻ gợi ý trong hộp bốc hàng:** tên vị trí in đậm + màu nổi ở góc trái, tổng SL góc phải, ghi chú thùng dòng dưới. Thẻ đã chỉ định (Đang bốc) mở lại để chỉ định lại.
- **Trạng thái bốc (cột mới ở Vòng đời đơn hàng):** Chưa bốc (mặc định, = không có chỉ định hoạt động) / Đang bốc (`picking`) / Đã bốc (`confirmed`) / Đã hủy (`cancelled`, chỉ hiện sau khi từng Đang bốc; xử lý như Chưa bốc: trả giữ chỗ, in lại được, không cảnh báo). In đơn → tự Đang bốc + giữ chỗ; in lại = hủy lượt cũ + lượt mới. Dropdown sửa tay chỉ: Đang bốc → Đã bốc, Đang bốc → Đã hủy. Chỉ người có quyền chỉ định thấy/sửa cột; người khác ẩn cột.
- **Theo Kiot:** Đang bốc + Kiot hoàn thành → tự Đã bốc (lúc đó mới trừ thùng/cập nhật ghi chú vị trí). Đang bốc + Kiot hủy → về Chưa bốc, trả giữ chỗ. Đã bốc không bao giờ bị hủy bởi Kiot. Đã bốc là trạng thái cuối.
- **VT Hà Nội / VT Sài Gòn:** thêm cột "Có thể bốc" = SL tồn ghi chú − tổng giữ chỗ của các đơn Đang bốc.
- **Cảnh báo lệch SL:** đơn Đang bốc hoặc Đã bốc mà, ở bất kỳ mã hàng nào, tổng ST đã chỉ định ≠ SL dòng đơn Kiot → tô đỏ dòng đơn + cảnh báo lệch SL; tự hết khi Kiot khớp lại. Không cảnh báo với Chưa bốc / Đã hủy.
- **Ghi chú thùng (carton.js):** x, X, * chuẩn hóa thành x; `a*B` (không T) = `aTxB`, hợp lệ, không còn "Sai định dạng"; cùng quy cách thì cộng gộp: `3t*40+14t*40+1t*39` → `17Tx40 + 1Tx39`.
- **Ngoài phạm vi:** quy tắc tự gợi ý vị trí; quyền in hiện có; cho Đã bốc quay lại; các tab khác.

## Danh sách việc (3 luồng, tách tệp để chạy song song)

### Luồng 1 — Phiếu in + thẻ gợi ý + luật ghi chú thùng (frontend dùng chung)
Tệp được sửa: `server/public/shared/carton.js` (+ test), `server/public/shipment/lifecycle/pick/*` (`invoice.js`, `order-template.tpl`, `invoice-a4.css`, `pick-assign.js`, `pick-assign.css`, `print-tools.js`) và test frontend tương ứng trong `server/test/frontend/`.
- T1.1 `carton.js`: chuẩn hóa x/X/* → x; `a*B` hợp lệ; gộp cùng quy cách (xem ví dụ). Test mới. Acceptance: ví dụ `3t*40+14t*40+1t*39` → `17Tx40 + 1Tx39`; `9*12+1Tx12` → `10Tx12`; `1T100` vẫn hợp lệ; các test cũ vẫn xanh.
- T1.2 Phiếu in: thứ tự cột mới, đổi nhãn ST→Thùng, ô Vị trí theo quy tắc 1 / 2+ vị trí, độ rộng cột. Acceptance: test dựng HTML phiếu cho 1 vị trí / 2 vị trí / mã `A01:200000`.
- T1.3 Thẻ gợi ý trong hộp bốc hàng: vị trí đậm màu nổi trái, tổng SL phải, ghi chú dưới. Acceptance: test cấu trúc thẻ; kiểm tra bằng trình duyệt/harness nếu có thể (xem memory `reference-tokosi-view-pages-without-login`).

### Luồng 2 — Trạng thái bốc trong Vòng đời đơn hàng (backend + UI) + cảnh báo lệch SL
Tệp được sửa: `server/pickAssignments/*` (service, routes, repo, test), migration mới `0098_*.sql` nếu cần, `server/shipment/orderLifecycle*.js` (query/service/repository + test), `server/public/shipment/lifecycle/index.html`, feature registry/quyền nếu cần thêm quyền ẩn/hiện cột, và test liên quan. KHÔNG sửa tệp của Luồng 1 và 3.
- T2.1 Xác định trạng thái hiển thị (Chưa bốc / Đang bốc / Đã bốc / Đã hủy) từ `order_pick_assignments` và trả trong API vòng đời đơn; lọc/phân trang giữ ở máy chủ. Acceptance: test query.
- T2.2 Cột "Trạng thái bốc" + dropdown trên UI, chỉ hiện với người có quyền chỉ định; API đổi trạng thái chỉ cho Đang bốc → Đã bốc / Đã hủy (khóa lạc quan `version` đã có). Acceptance: người không có quyền không thấy cột và API trả 403; đổi trạng thái hợp lệ gọi lại đúng confirm/cancel hiện có.
- T2.3 Tự động theo Kiot: Đang bốc + đơn Kiot hoàn thành → confirm (trừ thùng); Đang bốc + Kiot hủy → cancel + hiển thị Chưa bốc; Đã bốc không bị đụng. Hook vào chỗ vòng đời đơn nhận trạng thái Kiot (không gọi thêm API KiotViet — xem quy tắc chống vượt hạn mức). Acceptance: test cả 3 nhánh, không trừ thùng hai lần khi chạy lặp.
- T2.4 Xác nhận lại hành vi in lại: in lại đơn Đang bốc = hủy lượt cũ + lượt mới, tồn thực không đổi; Chưa bốc/Đã hủy in lần đầu → Đang bốc. Chỉ sửa nếu hiện chưa đúng.
- T2.5 Cảnh báo lệch SL: tính theo từng mã (tổng ST đã chỉ định vs SL dòng đơn Kiot) cho Đang bốc + Đã bốc; tô đỏ dòng + nhãn cảnh báo; tự hết khi khớp. Acceptance: test với đơn cưỡng ép lệch và đơn khớp lại.

### Luồng 3 — Cột "Có thể bốc" ở VT Hà Nội / VT Sài Gòn
Tệp được sửa: `server/stockPositions/*`, `server/public/vt-positions/*` (và xuất Excel của trang này), test liên quan. Chỉ ĐỌC logic giữ chỗ trong `server/pickAssignments/` (không sửa tệp Luồng 2; cần hàm mới thì viết trong stockPositions).
- T3.1 API trả thêm `available` (Có thể bốc) mỗi dòng = SL từ ghi chú − giữ chỗ của đơn Đang bốc; tính 1 truy vấn gộp, không N+1.
- T3.2 Cột trên bảng + xuất Excel + hộp chi tiết nếu có; theo quy ước `table-controls.js` (ẩn/hiện, kéo cột, sort). Acceptance: test API + test frontend.

## Checkpoint cuối (do luồng điều phối làm, không giao agent)
- `cd server && npm test` 100% xanh; `graphify update .`
- Cập nhật tài liệu theo `update-file` (README, server/README, SCHEMA.md nếu có migration, implementation_plan, SRS/BRD, CURRENT.md) + memory.
- Chưa commit/push/migrate/deploy nếu người dùng chưa yêu cầu.

## Rủi ro
| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Hai luồng sửa trùng tệp | Cao | Phân tách tệp như trên; không commit; không đổi nhánh |
| Hoàn thành Kiot chạy lặp → trừ thùng 2 lần | Cao | confirm idempotent theo `version`/trạng thái; test chạy lặp |
| Đơn Kiot đổi sau khi đã chỉ định (lệch SL) | Trung bình | cảnh báo đã chốt, không tự sửa |
| Migration cần áp tay | Thấp | Chỉ tạo tệp, không tự áp DB |
