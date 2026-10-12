# Danh sách việc: Vòng đời đơn hàng - luồng Đơn Bắc-Nam (2026-10-12)

Thiết kế, quyết định đã chốt, rủi ro: xem [plan.md](plan.md).
Lệnh test (chạy trong `server/`): `node --max-old-space-size=4096 --test "shipment/**/*.test.js" "test/frontend/order-lifecycle-*.test.js"`; cả bộ: `npm test`.

- [x] T1: đọc tab `DonHang_MienNam` (config + repository, fail-soft, 4 test mới)
- [x] T2: không cảnh báo 24h + ghép Kiot HN (service + 4 test mới)
- [x] Checkpoint A: `shipment/` + `order-lifecycle-*` xanh (238/238)
- [x] T3a: đọc thật tab trên Google Sheet và qua service + Kiot (DH043419: Hà Nội, "Đơn đã gửi kế toán", 12/10/2026 08:52, không cảnh báo)
- [x] T3b: đồng bộ README, server/README, SRS (FR-14.8), BRD, implementation_plan
- [x] T3c: `npm test` 2182/2189 (chỉ 4 test lỗi cũ ở xuất tồn kho, không thuộc phạm vi), `graphify update .`, `CURRENT.md`, memory
- [ ] Checkpoint B: người dùng xem trang và duyệt trước khi commit/deploy (chỉ cần restart server)
