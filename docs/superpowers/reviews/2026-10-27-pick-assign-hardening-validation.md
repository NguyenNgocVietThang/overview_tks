# Kiểm chứng đợt sửa Chỉ định hàng — 27/10/2026

## Phạm vi và mã đã lưu

Đối chiếu [spec đã duyệt](../specs/2026-10-27-pick-assign-hardening-design.md) và [kế hoạch](../plans/2026-10-27-pick-assign-hardening.md), sửa bốn lỗi của [báo cáo ban đầu](2026-10-27-pick-assign-review.md), đồng thời làm lại phiếu A4 theo mẫu người dùng và giữ cột ST.

- `607d6f33` — số chiếc nguyên, dấu vết vị trí/quy cách dưới khóa, snapshot tiền gốc, hoàn tác an toàn và nguồn metadata khách.
- `0692becd` — popup phục hồi khi mạng lỗi, phiếu A4 và kiểm thử frontend.

Đây là kiểm chứng mã cục bộ trên nhánh `feat/lifecycle-pick-assign`; chưa merge/push/deploy và chưa chạy migration 0096/0097 trên DB thật.

## Kết quả tập trung

| Nhóm | Đạt | Bằng chứng/hành vi đã kiểm |
|---|---:|---|
| Service PGlite | 20 | Đổi vị trí/mã/quy cách bị chặn và rollback cả phiếu; giảm tồn hợp lệ giữa hai đơn; dữ liệu cũ; số chiếc nguyên; hoàn tác không cộng lặp; snapshot giữ tiền dòng gốc |
| Carton/rules/snapshot vị trí | 31 | Lượng lẻ/không an toàn bị từ chối; phép trừ/hoàn nguyên; phương án thùng đã in vẫn đúng sau giảm tồn; không đổi sang quy cách mới chỉ vì gợi ý tối ưu đổi |
| Snapshot tiền | 3 | Dòng trùng mã giữ nguyên giá/chiết khấu; tổng 100.011; tính thập phân chính xác; từ chối tiền hoặc số lượng không hợp lệ |
| Popup frontend | 24 | Reject trước/sau ghi, POST có thể đã commit, GET đồng bộ lỗi, JSON lỗi, bỏ busy, khóa ghi chờ xác minh, retry chỉ đọc, phản hồi cũ và lượng nhập lẻ |
| Phiếu frontend | 2 | Snapshot v2 đọc tiền gốc; dòng cùng mã không lặp ST; mẫu có cột ST; tương thích phiếu cũ |
| Metadata đơn | 10 | SĐT/địa chỉ khách từ nguồn máy chủ và fallback dữ liệu nguồn; không suy diễn SĐT sale |

Tổng **90 test khác nhau đạt**, không cộng trùng các lượt chạy. Lượt tập trung tổng hợp trước đó có 77/77 đạt, 0 lỗi/0 bỏ qua (`.codex_tmp/pick-final-focused.log`); các lượt bổ sung hoàn tất sau đó đưa phạm vi tập trung lên 90 test.

Build prototype `node prototype-build.cjs` thành công; `node --test "public/prototypes/order-picking/*.test.js"` đạt **92/92**. Prototype vẫn là demo, không dùng làm bằng chứng thay cho service thật.

## Kiểm tra tích hợp liên quan

Lệnh chạy từ thư mục `server`:

```powershell
node --test pickAssignments/pickAssignmentsRoutes.test.js "shipment/orderLifecycle*.test.js" "stockPositions/*.test.js"
```

Kết quả sandbox: **230 test, 218 đạt, 12 lỗi, 0 bỏ qua**; cả 12 lỗi là kết nối localhost `EACCES 127.0.0.1` trong fixture route, không phải assertion sai nghiệp vụ. Log: `.codex_tmp/pick-integration-tests.log`.

Chạy lại đúng các route bằng quyền cho phép localhost fixture:

```powershell
node --test pickAssignments/pickAssignmentsRoutes.test.js stockPositions/stockPositionsRoutes.test.js
```

Kết quả **12/12 đạt, 0 lỗi/0 bỏ qua**. Log: `.codex_tmp/pick-routes-unsandboxed.log`. Nhóm 218 test liên quan và 12 route không được cộng vào tổng 90 như các ca hoàn toàn độc lập vì có phạm vi chạy trùng.

## Toàn suite

```powershell
node --max-old-space-size=4096 --test --test-force-exit --test-concurrency=4
```

Toàn suite `node --max-old-space-size=4096 --test --test-force-exit --test-concurrency=4` kết thúc: **3854 test, 3849 đạt, 2 lỗi, 3 bỏ qua** (720 s; log `.codex_tmp/pick-full-suite-force.log`). Hai lỗi là `telegram/managerLeaveMiniApp.test.js` và `telegram/managerLeaveWebhook.test.js`, không thuộc phạm vi Chỉ định hàng: cả hai in `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file srcwinasync.c` (lỗi libuv của Node 24.19 trên Windows khi `--test-force-exit` ép đóng handle còn mở) sau khi các ca bên trong đã ✔; chạy riêng KHÔNG có `--test-force-exit` thì 4/4 đạt, không có lỗi. Thư mục `telegram/` không khác `main`. Kết luận: không có lỗi hồi quy do bản sửa; suite chưa "xanh tuyệt đối" khi dùng cờ force-exit trên Windows.

## Bằng chứng hiển thị

Ảnh fixture cục bộ đã xem:

- `D:/Web TKS Dashboard/.codex_tmp/pick-invoice-preview.png`: bố cục A4, kho/đơn hàng/ba QR, bảng 9 cột có ST, tổng tiền, ghi chú và chữ ký. Không phải bằng chứng máy in hệ điều hành đã in đúng.
- `D:/Web TKS Dashboard/.codex_tmp/pick-popup-desktop-light.png`: popup desktop chế độ sáng, lượng phân bổ, ST và các nút hiển thị.
- `D:/Web TKS Dashboard/.codex_tmp/pick-popup-mobile-dark.png`: ảnh cũ, KHÔNG dùng làm bằng chứng (bị cắt 375px trong khi `innerWidth` là 500px). Đã thay bằng kiểm viewport thật bên dưới.
- **Viewport hẹp thật (đạt).** Đã kiểm lại bằng Chrome headless với viewport thật qua CDP `Emulation.setDeviceMetricsOverride` (fixture/API giả, harness `.codex_tmp/pick-vp/run.cjs`, không DB): 375×667 tối (bình thường và mất mạng), 375×667 sáng, 320×568 tối, 1280×800 sáng. Kết quả: `documentElement.scrollWidth` = `innerWidth` mọi ca (trang không cuộn ngang); popup nằm trong viewport (375px: x 10→365; 320px: 10→310); nút đóng, Tải lại, Gợi ý lại, Xác nhận & In phiếu nằm trọn trong popup, nhóm nút xuống dòng khi hẹp; thông báo lỗi 400 ký tự không có dấu cách vẫn bị bẻ dòng (scrollWidth = clientWidth); bảng rộng 900px cuộn ngang bên trong khung (`overflow-x:auto`, khung 323px). Ảnh: `.codex_tmp/pick-vp/shot-375x667-dark-fail.png` và các ảnh cùng thư mục. Giới hạn: Chrome headless trên Windows, chưa thử thiết bị thật/Safari iOS.
  CSS kèm theo: `box-sizing/min-width/max-width` cho hộp thoại, `flex-wrap` nhóm nút footer, `overflow-wrap:anywhere` cho thông báo (commit riêng ở cuối).

Ảnh fixture có thể dùng dữ liệu minh họa đủ liên hệ để xem mẫu. Nguồn vận hành mới nối được **SĐT và địa chỉ khách**; `sellerPhone` còn để trống vì nguồn staff chưa có SĐT tin cậy. Không lấy SĐT/Zalo sale theo tên hoặc mặc định dữ liệu minh họa là nguồn thật. Nợ trước cũng chỉ hiển thị khi snapshot có nguồn, không tự gán 0.

## Graph và giới hạn còn lại

- Lượt `graphify update .` đầu hoàn tất exit 0: 13.491 node, 29.505 cạnh, 562 community; log `.codex_tmp/pick-graphify.log`. Kết quả lượt chạy lại sau khi suite kết thúc: xem `.codex_tmp/pick-graphify-last.log` (exit 0, 13.500 node, 29.519 cạnh, 591 community — đây là lượt graph hoàn chỉnh cuối; lượt bị ngắt trước đó không còn tính).
- Lượt làm mới giữa chừng (khi suite đang chạy) bị ngắt, exit 1 (`.codex_tmp/pick-graphify-final.log`); đã chạy lại sau khi suite kết thúc và hoàn tất exit 0 (`.codex_tmp/pick-graphify-last.log`).
- Chưa kiểm PostgreSQL nhiều kết nối. PGlite một kết nối chỉ chứng minh hành vi giao dịch trong fixture, không chứng minh tranh chấp thực tế giữa nhiều kết nối.
- Chưa thao tác hộp in hệ điều hành hoặc xác minh PDF/máy in thật; chưa ghi DB thật để thử nghiệp vụ.
- Khi vận hành phải áp **0096 rồi 0097** trước backend/frontend mới. Phiếu cũ thiếu dấu vết chỉ định được xem/in/hủy giữ chỗ, phải chỉ định lại để xác nhận; bản đã xác nhận có lượng lẻ/lệch biến động phải đối soát trước hoàn.

Cập nhật: 27/10/2026. Toàn suite và viewport hẹp đã có kết quả thực tế (xem trên); vẫn không thay nghiệm thu vận hành: chưa PostgreSQL nhiều kết nối, chưa hộp in hệ điều hành, chưa áp migration 0096/0097, chưa merge/push/deploy.
