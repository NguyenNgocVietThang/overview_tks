# Danh sách việc: Vòng đời đơn hàng - luồng Đơn Bắc-Nam (2026-10-12)

Thiết kế, quyết định đã chốt, rủi ro: xem [plan.md](plan.md).
Lệnh test (chạy trong `server/`): `node --max-old-space-size=4096 --test "shipment/**/*.test.js" "test/frontend/order-lifecycle-*.test.js"`; cả bộ: `npm test`.

- [x] T1: đọc tab `DonHang_MienNam` (config + repository, fail-soft, 4 test mới)
- [x] T2: không cảnh báo 24h + ghép Kiot HN (service + 4 test mới)
- [x] Checkpoint A: `shipment/` + `order-lifecycle-*` xanh (238/238)
- [x] T3a: đọc thật tab trên Google Sheet và qua service + Kiot (DH043419: Hà Nội, "Đơn đã gửi kế toán", 12/10/2026 08:52, không cảnh báo)
- [x] T3b: đồng bộ README, server/README, SRS (FR-14.8), BRD, implementation_plan
- [x] T3c: `npm test` 2.207/2.214 (chỉ 4 test lỗi cũ ở xuất tồn kho, không thuộc phạm vi), `graphify update .`, `CURRENT.md`, memory
- [x] Checkpoint B (phần commit): code + tài liệu đã commit trên main (e161c34 Bắc-Nam, fa0c134 5 luồng, 3a30c91 UI) — đối chiếu lại 19/10/2026: `node --test "shipment/*.test.js" "test/frontend/order-lifecycle-*.test.js"` = 303/303 đạt. Ghi chú: 4 test lỗi cũ ở xuất tồn kho nêu ở T3c không còn tái hiện trong lượt chạy tập trung này (không thuộc phạm vi).
  - [ ] (chờ người dùng/ngoài phạm vi) Deploy (chỉ cần restart server) — không xác nhận được từ repo.
- Ghi chú đối chiếu 19/10/2026: kỳ vọng "Bắc-Nam không cảnh báo 24h" trong plan.md đã được thay bằng cảnh báo `NO_TRAIN_BILL` ở lượt 5 luồng (12/10) — xem plan.md; tab thứ tự đọc nay là HN → Bắc-Nam → Khách_HN → SG → Khách_SG.
