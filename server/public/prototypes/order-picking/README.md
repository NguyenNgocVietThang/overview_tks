# Prototype: Vòng đời đơn hàng → Chỉ định vị trí

## Mẫu in và giao diện hiện tại — thay thế mô tả các phiên bản bên dưới

Đường dẫn Kiot: chi tiết đơn có **Mở đơn trên Kiot ↗** cạnh trạng thái KiotViet, ngoài popup nhặt. HN mở chhanoi, SG mở chsaigon, trang `/man/#/Orders?code=...`; query `code` được đối chiếu với mã OrderCtrl của giao diện Kiot. Link lọc theo mã để kế toán chọn/kiểm tra rồi tự bấm Kết thúc trên Kiot. Mã DH-DEMO được ghi rõ là mô phỏng, không tồn tại như đơn thật. File HTML không gửi lệnh hoàn thành và không tự đọc lại trạng thái Kiot; phần cập nhật trạng thái qua đồng bộ thuộc hệ thống máy chủ hiện có, chưa kết nối vào prototype. Không chứa khóa API trong link hoặc mã HTML.

Kho nhặt thực tự điền theo số đã chỉ định ở từng vị trí sau khi xác nhận chỉ định. Kế toán chỉ sửa những ô lệch. Đây là giá trị đề xuất trong ô nhập, chưa tự ghi thực nhặt hoặc trừ tồn. Giữ nguyên giá trị nháp đã sửa (kể cả 0 hoặc ô bị xóa), không ghi đè khi mở lại; đã ghi nhận thì hiển thị số thực nhặt đã lưu. Nhấn In đơn mới kiểm tra và ghi số thực nhặt theo luồng hiện tại. Phiếu nhặt lần đầu vẫn để trống cột giấy Thực tế nhặt.

Tồn kho sỉ mới nhất: các mã bổ sung tăng 100 lần, mã mẫu cũ có số tồn đã biết tăng 1.000 lần. Ví dụ HN: COC123 3.000.000; KEP78 600.000; HOP1000 và BANCHAIGC 300.000; BINH500 và KHAN30 150.000; THAU28 90.000; KETO3 60.000; ADN3LYU 155.000; BN2L 70.000. Số đặt giữ nguyên. Cặp 005/006: COC123 từ 3.000.000 còn 2.990.000 khi giữ 10.000, hoặc 2.992.000 nếu kết thúc với thực nhặt 8.000. Các số tồn thấp trong mô tả lịch sử bên dưới đã được thay thế.

Dữ liệu thử mở rộng: 12 đơn, 56 dòng vị trí, 8 mã mới dùng chung giữa nhiều đơn. Cặp `DH-DEMO-005` / `DH-DEMO-006` (HN) cùng 8 mã; cặp `011` / `012` (SG) kiểm tra tồn riêng cơ sở. COC123 HN có A05=12.000, B05=10.000, C05=8.000, tổng 30.000. Trước xác nhận đơn 005, đơn 006 thấy khả dụng 30.000. Xác nhận 005 lấy 10.000: khả dụng còn 20.000 do giữ chỗ; nhập thực nhặt đủ 10.000: tồn vật lý còn 20.000, giữ chỗ được giải phóng, khả dụng vẫn 20.000 (không trừ kép). Nếu thực nhặt 8.000: khả dụng 22.000. Mở các đơn trong cùng một phiên; tải lại trang sẽ khởi tạo lại dữ liệu. Kiểm tra tự động gồm cả mở popup đơn 006 trước/sau khi xử lý 005, giữ chỗ và nhập thực nhặt, in lại không trừ thêm, cùng mã ở SG không bị ảnh hưởng.

Cập nhật cuối: bỏ cột Nhặt, còn tám cột; thu khoảng cách và giới hạn bảng trong vùng in 186 mm. Các bảng phiếu đều đặt `data-table-controls="off"` và `data-table-sort="off"` để trình quản lý cột dùng chung không chèn thanh công cụ hoặc kéo rộng bảng. CSS xuất/in chỉ dùng `invoice-a4.css`. Nút **In** dùng iframe cùng trang gọi `print()` sau khi ảnh tải xong, mở hộp chọn máy in của trình duyệt và không tạo tab mới. Đã đo trên Chrome: bảng rộng 703 px, tám cột nằm trọn trong phiếu, không có cuộn ngang.

Mẫu mới nhất lấy từ `order-template-source.html` (người dùng cung cấp), chuẩn hóa bằng `prototype-template.cjs` khi dựng. Giữ đủ phần tổng tiền, người nhận, ngày tháng, nhân viên nhặt/xuất và lưu ý. `invoice-a4.css` đặt A4 dọc, lề 10 mm, vùng nội dung 190 mm, chín cột có tỷ lệ cố định, lặp tiêu đề khi sang trang và tránh tách dòng hàng. Nút chỉ hiển thị biểu tượng máy in + **In**, mở trang riêng và gọi hộp in sau khi ảnh tải xong để người dùng chọn máy in vật lý. Không tự gửi lệnh tới một máy in cụ thể hoặc xác nhận đã in xong. Tắt đầu/chân trang trình duyệt và dùng tỷ lệ 100% khi in.

In và lưu file: bản xem trước cho sửa trực tiếp nội dung; **Lưu file HTML** tải phiếu riêng đã nhúng CSS và ảnh cùng nội dung sửa, mở lại vẫn sửa/in/lưu được. **In / Lưu PDF** mở trang in riêng để tránh in cả giao diện popup; bấm nút In trên trang đó và chọn máy in hoặc Lưu thành PDF. Nếu môi trường nhúng chặn cửa sổ, tải HTML rồi mở bằng Chrome/Edge. Sửa bản in không cập nhật sổ tồn hoặc số liệu đơn; nhập số thực nhặt ở bảng chỉ định để ghi nhận nghiệp vụ. Hộp in/PDF thực tế cần trình duyệt hỗ trợ; kiểm thử JSDOM chỉ xác nhận nội dung xuất và gọi chức năng in, không giả lập máy in hệ điều hành.

Cập nhật theo ảnh phiếu đặt hàng: dùng `order-template.html` với chín cột Nhặt / TT / Tên hàng / SL / Đơn giá / Thành tiền / Vị trí / Ghi chú / Thực tế nhặt. Vị trí luôn là vị trí đã chỉ định, không ghép vào ghi chú. Lần đầu Thực tế nhặt để trống; in sau khi kế toán nhập sẽ điền kết quả vào cột này (kể cả 0). Nhiều vị trí in số thực nhặt theo tên vị trí. SL và tiền hàng giữ theo đơn gốc, không bị số thực nhặt ghi đè. Mô tả tính lại tiền theo thực nhặt ở phiên bản trước bên dưới đã được thay thế.

Luồng chính: **Xác nhận & In phiếu nhặt** → nhập ô text **Kho nhặt thực** theo từng vị trí → **In đơn**. Đã bỏ khối xử lý thiếu, lý do, xử lý khác và ghi chú cho kho theo yêu cầu. Nhập thiếu vẫn in theo thực nhặt; không tự giảm số lượng đơn gốc. Ô trống cần nhập kết quả, 0 là không nhặt được. In lại cùng kết quả không trừ tồn thêm.

Mẫu người dùng gửi nằm tại `invoice-template.html`; `invoice.js` giữ đầu TOKOSI, thông tin khách, bảng hàng, tổng tiền/công nợ, chữ ký và lưu ý. Phiếu nhặt thêm cột trống Thực nhặt; vị trí cùng số lượng nằm trong ghi chú mỗi mã. Hóa đơn giao dùng số thực nhặt, tính lại thành tiền và tổng tiền hàng. Trường chưa có dữ liệu hiển thị —; không tự giả định công nợ hoặc chiết khấu bằng 0. Đơn giá trong dữ liệu thử là giá minh họa. Ba ảnh gốc được lưu ở `invoice-assets` và nhúng vào bản HTML duy nhất, không cần mạng.

Sổ tồn chung có giữ chỗ giữa các đơn và trừ tồn theo thực nhặt trong cùng phiên thử. Chưa ghi hệ thống thật; mở lại trang sẽ đặt lại sổ tồn mô phỏng.

Kiểm tra hiện tại: 19 bài kiểm tra trong `rules.test.js`, `ui.test.js`, `inventory.test.js`; `node prototype-smoke.cjs` kiểm tra cả mẫu in, ảnh nhúng, tính tiền theo thực nhặt, dữ liệu thiếu và in lại không trừ tồn hai lần. Dựng file bằng `node prototype-single.cjs` từ thư mục `server`.

## Luồng rút gọn — áp dụng mới nhất

Hai thao tác chính cho đơn đủ hàng: **Xác nhận & In phiếu nhặt** → nhập trực tiếp số Thực nhặt trong bảng → **Chốt & In giao hàng**. Không cần bật chế độ nhập, lưu nháp, xác nhận thực nhặt riêng hoặc chọn loại phiếu trên luồng chính. Dữ liệu đang gõ giữ nháp trong phiên, chưa đổi tồn. Ô trống bị chặn, nhập 0 để xác nhận không nhặt được. Nhiều vị trí mới cần mở chi tiết nhập theo vị trí.

Thiếu hàng mới mở **Lấy bù & In phiếu bổ sung** hoặc **Giao theo thực nhặt**. Lấy bù ghi thực nhặt, kết thúc giữ chỗ chưa lấy và cấp phần bổ sung ở nơi khác; các dòng bổ sung trong cùng lần xử lý dùng chung một batch/phiếu. Nếu không đủ khả dụng thì giữ thiếu, không tự giảm đơn. Giao thiếu cần quyết định chờ/hủy phần thiếu và lý do chấp thuận. Kiểm đếm/lịch sử và in lại nằm trong Xử lý khác. Phiếu giao là snapshot đã chốt; dữ liệu mới cần chốt lại.

Luồng tối giản coi số nhập theo phiếu trả là kết quả kết thúc nhặt tại vị trí; không tự kết luận vị trí hết hàng hoặc điều chỉnh tồn về 0. Cần báo hết/kiểm đếm thì dùng Xử lý khác. Các mô tả toolbar nhiều nút bên dưới thuộc phiên bản trước và được thay thế bởi mục này.

## Luồng thực nhặt mới đã triển khai — cập nhật mới nhất

Nút In và Nhập kho nhặt thực nằm trong popup Chỉ định vị trí; ngoài chi tiết chỉ giữ nút Chỉ định vị trí. Bảng có Kho nhặt thực và Còn thiếu, nhập lũy kế theo từng nhiệm vụ/vị trí, trống = chưa báo và 0 = đã báo không lấy được. Lưu nháp giữ trong phiên không đổi tồn; Xác nhận kết quả kiểm tra toàn bộ trước khi ghi phần chênh lệch, cùng số lưu lại không trừ lại. Sửa giảm số đã xác nhận bị chặn để xử lý hoàn/sửa sai riêng.

Nhặt thiếu chỉ phân bổ bù phần còn thiếu, giữ kết quả đã nhặt. In chọn ba loại: nhặt ban đầu (có cột giấy Thực nhặt), nhặt bổ sung mới nhất (chỉ các dòng bổ sung, ghi rõ không nhặt lại), giao hàng đã chốt. Chốt giao yêu cầu mọi vị trí đã báo và kết thúc nhặt; giao thiếu cần quyết định chờ/hủy phần thiếu và lý do chấp thuận. Không thay SL đơn gốc hoặc sửa KiotViet. Lấy bù/thực nhặt mới làm hết hiệu lực bản giao đã chốt để buộc chốt lại. Prototype chỉ mô phỏng một lần giao được chốt tại một thời điểm, chưa theo dõi nhiều lần xuất giao thực tế. Kiểm đếm tồn là phần mở rộng riêng, không trộn vào màn hình nhập kết quả.

### Nguồn tổng tồn chung — cập nhật mới nhất

Cột Tổng tồn chung lấy từ `PickingInventory.summary(branch, code)`, không phụ thuộc đơn đang mở: hiển thị khả dụng chung, tồn vị trí và tổng giữ chỗ mọi đơn. Ví dụ tồn 150, đơn 1 xác nhận 30: mọi đơn thấy khả dụng 120. “Đơn này chọn / Dự kiến sau xác nhận” là dự tính riêng, chỉ hiển thị phụ; chưa xác nhận không làm giảm khả dụng chung. Thay thế cách hiển thị trước đó bên dưới. Sổ chỉ dùng chung trong một phiên mở file HTML, chưa chia sẻ giữa nhiều máy/tab.

### Cột Tổng tồn còn lại — 23/10/2026

Popup có thêm cột Tổng tồn còn lại: tổng khả dụng đúng mã/cơ sở sau giữ chỗ của đơn khác, trừ tổng số đang chọn cho mã này trong đơn hiện tại. Tự cập nhật khi chọn/bỏ chọn, không trừ hai lần khi mở lại chỉ định đã xác nhận. Ví dụ 100 + 35 + 20 = 155, đang chọn 30 thì còn 125. Hiển thị thêm “Trước chọn” và “Đang chọn”. Nếu một vị trí chưa rõ số lượng, hiển thị Chưa xác định thay vì coi là 0. Thay đổi ở bước chọn là dự tính khả dụng; chỉ xác nhận mới giữ chỗ dùng chung, không phải trừ tồn vật lý.

## Bản HTML duy nhất và luồng kho thực nhặt

Chạy `node prototype-single.cjs` từ `server` để tạo `TOKOSI-prototype-nhat-don.html` ở gốc repository. File này nhúng toàn bộ CSS, JavaScript, logo, ảnh nền và dữ liệu mô phỏng; mở trực tiếp bằng trình duyệt, không cần cài đặt hay mạng. Không yêu cầu các file nguồn đi kèm. Font chuyển sang font có sẵn trên máy khi không có font hệ thống.

Sau xác nhận chỉ định, bấm **Kho nhặt hàng** trong chi tiết đơn. Giữ chỗ làm giảm khả dụng; nhập thực nhặt thêm chỉ trừ đúng số lấy lần này. Kết thúc vị trí sẽ giải phóng phần giữ chỗ chưa lấy và loại vị trí đó khỏi gợi ý lấy bù của dòng đơn. Báo đã hết sẽ khóa vị trí chờ kiểm đếm. Có thể gợi ý/giữ chỗ lấy bù, nhập số kiểm đếm và lý do rồi dùng **Quản lý xác nhận** để điều chỉnh/mở khóa. Bản thử mô phỏng cả vai trò kế toán/kho/quản lý trong một màn hình; bản thật cần phân quyền riêng.

Sổ tồn/giữ chỗ chỉ nằm trong bộ nhớ phiên thử, tải lại file sẽ đặt lại. Không ghi DB/Sheet/KiotViet. Kiểm thử: `node --test public/prototypes/order-picking/inventory.test.js`; kiểm tra toàn luồng file offline: `node prototype-smoke.cjs`.

Cập nhật 23/10/2026 theo ảnh chụp và bản vẽ người dùng. Chỉ là bản thử, chưa sửa luồng vận hành hoặc triển khai lên máy chủ.

## Chạy thử

Từ thư mục `server`: `node prototype-preview.cjs`, mở `http://127.0.0.1:4178/prototypes/order-picking/`.

`prototype-build.cjs` đọc nguyên `public/shipment/lifecycle/index.html`, thêm adapter dữ liệu và popup rồi tạo `public/prototypes/order-picking/index.html`. Không sửa file Vòng đời nguồn. Muốn dựng lại khi nguồn thay đổi: `node prototype-build.cjs`. Không chỉnh tay file index đã sinh.

## Luồng

1. Bảng Toàn bộ đơn hàng và hộp Chi tiết dùng nguyên template hiện tại, giữ bộ lọc, cột, sắp xếp, bảng hàng hóa và theme.
2. Bấm một dòng đơn để mở chi tiết. Chỉ đơn `SENT_TO_ACCOUNTANT` có nút **Chỉ định vị trí** ngay trên bảng Hàng hóa trong đơn.
3. Bấm nút để mở popup bốn cột **Mã hàng / Tên hàng / SL đơn / Vị trí kho**. Từng vị trí hiển thị dưới dạng ô chọn có tên, khả dụng, số lấy và trạng thái đã chọn.
4. Gợi ý mới: trong các vị trí đủ lượng còn cần lấy, chọn vị trí có khả dụng nhỏ nhất (phần dư nhỏ nhất, ưu tiên khớp chính xác). Ví dụ cần 100: chọn 100 trước 120, 200, 500; nếu không có 100 thì chọn 120. Không dựa khoảng cách hoặc thứ tự vị trí. Nếu không vị trí nào đủ, chia từ vị trí nhiều hàng nhất rồi tính lại cho lượng còn thiếu. Khả dụng đã trừ giữ chỗ của các đơn khác.
5. Bấm vị trí đủ hàng để chuyển sang vị trí đó; bấm các vị trí không đủ để chia nhiều nơi. Bấm ô đang chọn để bỏ chọn. Không xác nhận khi thiếu, thừa, vượt khả dụng hoặc mã chưa có vị trí.
6. **Xác nhận chỉ định** lưu localStorage riêng `tks-picking-popup-v2`, đóng popup, hiện dấu đã xác nhận và nút **In đơn** tại chi tiết. Bản lưu có fingerprint đơn/vị trí để chặn in phương án cũ khi dữ liệu đổi.
7. Nút In đơn mở xem trước mẫu tạm; in qua hộp in trình duyệt. Format chính thức đang chờ người dùng gửi.

## Dữ liệu

Adapter `lifecycle-data.js` cung cấp JSON theo hợp đồng API hiện có cho trang Vòng đời gốc, từ `demo.js`. Mọi yêu cầu GET API cùng origin được xử lý ở adapter; thao tác ghi bị từ chối, không gửi dữ liệu ra hệ thống. Tài khoản Kế toán trên giao diện là tài khoản mô phỏng.

Nút **Nguồn dữ liệu** cho tải mẫu/nhập JSON `{orders,locations}`, tối đa 10 MB, 1.000 đơn, 50.000 dòng vị trí. `orders`: `branch` HN/SG, `orderCode`, `status.code`, `lines` với `productCode`, `productName`, `quantity`. `locations`: `branch`, `code`, `location`, `available` (số đã xác nhận cùng đơn vị với dòng đơn).

Chưa kết nối DB hoặc API thật. Không coi `totalQuantity` trên sheet, đặc biệt “TỔNG SL đã đi” SG, là tồn còn tại vị trí. Vị trí thiếu `available` cần người thử xác nhận trước khi chọn. Không giữ hàng giữa các đơn, không trừ tồn, không migration. Bản in và giao diện ghi nhãn mô phỏng.

## Kiểm thử

`node --test public/prototypes/order-picking/rules.test.js public/prototypes/order-picking/ui.test.js`

10 test: gợi ý số lượng không dựa ưu tiên vị trí, chia hàng/thiếu hàng, số liệu chưa rõ, kiểm tra khả dụng dùng chung, bố cục popup, đổi ô chọn, xác nhận/mở in, điều kiện trạng thái và giữ nguyên markup bảng Vòng đời nguồn.
