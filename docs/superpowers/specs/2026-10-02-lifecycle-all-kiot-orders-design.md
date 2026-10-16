# Vòng đời đơn hàng: mọi đơn Kiot, Ghi chú, công thức có bán mới, ẩn/hiện cột (2026-10-02)

Bổ sung cho `2026-10-01-lifecycle-kiotviet-orders-design.md` (phần "Chỉ đơn Phiếu tạm" và công thức "+ hàng đang vận chuyển" bị thay thế bởi tài liệu này).

## Yêu cầu của người dùng
1. Lấy **tất cả** đơn trên KiotViet, mọi trạng thái (kể cả Hoàn thành, Đã hủy, Phiếu tạm); thêm cột + bộ lọc **"Trạng thái KiotViet"** (mặc định *Tất cả*); vẫn giữ bộ lọc trạng thái chính.
2. Thêm cột **Ghi chú** (lấy ở Kiot) cho từng đơn.
3. Đổi quy tắc: số lượng có bán = `min(SL đặt, Tồn kho)`; thành tiền có bán = số lượng có bán × đơn giá.
4. Cột "Đang vận chuyển" ở bảng chi tiết đổi tên **"Điều chuyển SG"**.
5. Bảng có tick **ẩn/hiện cột** (giống cách tick ở nút xuất file); mặc định hiện hết các cột hiện tại, cột Ghi chú nằm bên phải "Giá trị có bán".
6. Ngoài Quản lý, không ai có quyền xuất file ở Vòng đời đơn hàng.

## Quyết định thiết kế (điểm tôi tự quyết — có thể phản đối)
- **Lọc / sắp xếp / phân trang chuyển sang máy chủ.** DB có 60.171 đơn (HN 41.081, SG 19.090; 40.717 Hoàn thành, 18.364 Đã hủy, 1.089 Phiếu tạm). Gửi cả danh sách xuống trình duyệt mỗi 60 giây ≈ 17 MB JSON thô (~3 MB nén) và làm mọi lần lọc / sắp xếp chữ tiếng Việt trên 60 nghìn dòng ở máy người dùng (nặng nhất trên điện thoại). Nay `GET /api/shipment/lifecycle` trả 1 trang 100 dòng (~8 KB). Giao diện gửi lại bộ lọc khi đổi trang / lọc / sắp xếp / tự làm mới.
- **Mặc định sắp xếp**: thời gian đặt hàng mới nhất trước (trước đây thứ tự sheet rồi Kiot). Bấm cột lần 1 tăng dần, lần 2 giảm dần, lần 3 bỏ sắp xếp (về mặc định).
- **Dòng sheet không khớp đơn Kiot nào bị bỏ** (giữ quyết định 2026-10-02 lần 2). Đo thật: sheet 270 dòng, 262 khớp một đơn Kiot (mọi trạng thái), 5 dòng không khớp (`DH047975` HN; `HD000013`, `HD014526`, `DH040959`, `DH040992` SG) nên không hiện ở bảng (vẫn tra cứu được bằng ô tra cứu mã).
- **Giá trị có bán chỉ cho đơn Phiếu tạm** (đơn khác "—"): tồn kho hiện tại không còn ý nghĩa với đơn đã xuất / đã hủy. **Giá trị đơn** (tổng phiếu) thì có với mọi đơn Kiot.
- **Cột "Điều chuyển SG" vẫn hiển thị** (số hàng đang vận chuyển của Kiot SG) nhưng KHÔNG tính vào số lượng có bán.
- **Cache Kiot 2 phút kiểu stale-while-revalidate**: đọc ~60 nghìn đầu đơn mất ~2–4 giây (quét tuần tự, chỉ mục 0028 không giúp được) — hết hạn thì trả ngay bản cũ và làm mới nền, nên người dùng không phải chờ.
- **Xuất Excel gửi bộ lọc** (không còn danh sách mã — cũng sửa lỗi cũ: cùng mã DH có ở cả HN và SG nên khớp theo mã trần có thể lấy nhầm dòng). **Giới hạn 20.000 dòng mỗi lần xuất**: đo 60 nghìn dòng × 19 cột mất ~7 giây CPU liên tục và chặn cả máy chủ (chỉ chạy 1 tiến trình); vượt giới hạn → 400 `TOO_MANY_ROWS` kèm gợi ý lọc thêm. Chỉnh bằng `MAX_EXPORT_ROWS` trong `orderLifecycleExport.js`.
- **Hộp "Cột hiển thị"**: tick áp dụng ngay, nhớ trong `localStorage` (lưu danh sách cột ẨN để cột mới sau này mặc định hiện); "Mã đơn" luôn hiện. Việc ẩn cột không ảnh hưởng nội dung file Excel (xuất đủ cột).
- **Quyền**: `shipment.export` mặc định `MANAGER_ONLY`. Kiểm tra DB thật: không tài khoản nào ngoài Quản lý có ghi đè `shipment.export` (có 1 Quản lý ghi đè `true` dư thừa).

## Kiểm chứng
- Dữ liệu thật (chỉ đọc): đọc đủ 60.178 đơn trong ~3,9 giây nguội; lọc / sắp xếp 60 nghìn dòng 130–830 ms, lật trang 6 ms từ bộ nhớ đệm; Σ giá trị có bán Phiếu tạm ≈ 20,38 tỷ trên 33,32 tỷ.
- Trình duyệt thật qua máy chủ thử cục bộ (router + service + Kiot repository + Sheet là code thật, tài khoản Quản lý tổng hợp): bảng, hộp "Cột hiển thị", bộ lọc Trạng thái KiotViet (40.732 / 60.184 đơn Hoàn thành), hộp chi tiết đơn (Điều chuyển SG, Ghi chú), xuất Excel (1.083 dòng Phiếu tạm ≈ 110 KB trong 0,9 giây; tất cả → 400), bố cục điện thoại 375px không tràn ngang.
- `npm test` trong `server/`: toàn bộ qua.
