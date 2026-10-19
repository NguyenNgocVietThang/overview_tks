# Danh sách việc: Thể tích & giá cước nhà xe (2026-10-15)

Thiết kế: xem [plan-shipping-volume.md](plan-shipping-volume.md).

- [x] T1: freightCalculator.js + test
- [x] T2: measureSheet.js + config + test
- [x] T3: gắn vào readOrderDetail (measure, freight) + test
- [x] Checkpoint A: đối chiếu đơn thật với sheet Hoa
- [x] T4: giao diện hộp chi tiết (dropdown, cột M3, tổng, ghi chú, bảng cước)
- [x] T5: tài liệu, npm test, graphify update
- [x] Checkpoint B: người dùng xem thử rồi commit — đã commit trên main: ab528b5 (thể tích + giá cước), 8102bf6 (cước tạm tính + tra cứu CONT), 7ea5d4f (công thức Đức Mạnh/Việt Linh + tick Giao ra chành), ae5e4c0 (J&T), a27c9d4 (snapshot cân đo); `freightCalculator.test.js`, `measureSheet.test.js` và test hộp chi tiết (`order-lifecycle-kiot.test.js`) xanh trong lượt chạy 19/10/2026 (303/303).
