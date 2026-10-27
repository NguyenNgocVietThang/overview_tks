# Sửa luồng Chỉ định hàng trên Vòng đời đơn hàng và VT hàng

Ngày: 2026-10-27. Trạng thái: người dùng đã duyệt bản spec trong chat; chuyển sang lập kế hoạch triển khai.

## 1. Mục tiêu và phạm vi

Sửa bốn lỗi trong [báo cáo rà soát](../reviews/2026-10-27-pick-assign-review.md): xác nhận sai vị trí/quy cách, số chiếc lẻ bị làm tròn, sai tiền khi gộp dòng, popup kẹt khi mất mạng.

Người dùng đã chốt: **số lượng nhặt không có số lẻ**. Số chiếc và số thùng là hai đại lượng khác nhau: lấy 30 chiếc từ thùng 100 chiếc hợp lệ dù quy đổi thành 0,3 thùng.

Giữ luồng đang có: chỉ định giữ chỗ, xác nhận trừ tồn vị trí, hủy giải phóng giữ chỗ hoặc hoàn lượng đã trừ. Áp dụng cả HN và SG. Không mở rộng sang giao hàng, nhặt một phần, đối soát Kiot, nhập/chuyển kho hoặc thiết kế lại giao diện.

Chọn sửa đồng bộ tại service, snapshot, phiếu in và popup thay vì chỉ vá giao diện: máy chủ là nơi kiểm tra điều kiện cuối cùng, kể cả khi gọi API trực tiếp.

## 2. Ranh giới và dữ liệu

- `server/pickAssignments/pickAssignmentsService.js`: đọc đơn từ máy chủ; kiểm số lượng; lưu snapshot đơn và dấu vết vị trí; xác nhận/hủy trong giao dịch.
- `server/public/shared/pick-rules.js`: phản hồi quy tắc số nguyên trước khi gửi yêu cầu, dùng chung với backend khi phù hợp.
- `server/public/shared/carton.js`: trừ/hoàn số chiếc nguyên; từ chối đầu vào lẻ thay vì âm thầm làm tròn. Rà các nơi gọi để giữ tương thích cho đầu vào nguyên, bao gồm số 0 nếu hàm hiện hỗ trợ.
- `server/public/shipment/lifecycle/pick/invoice.js`: in từ snapshot máy chủ, dùng dòng và thành tiền gốc.
- `server/public/shipment/lifecycle/pick/pick-assign.js`: quản lý trạng thái bận, báo lỗi và đọc lại trạng thái sau lỗi ghi chưa rõ kết quả.

Giữ advisory lock theo cơ sở, khóa dòng theo thứ tự ID, version chỉ định, lịch sử trong cùng giao dịch và quyền hiện hành. Không dùng dữ liệu giá hoặc tồn gửi từ trình duyệt làm nguồn tin cậy.

Thêm migration kế tiếp theo thứ tự thực tế trong repository; không sửa migration đã có. Bổ sung snapshot tại thời điểm chỉ định cho từng dòng phân bổ, tách với `position_snapshot` đang dùng cho hoàn tác lúc xác nhận. Snapshot mới gồm phiên bản định dạng, mã hàng chuẩn hóa, vị trí chuẩn hóa, ghi chú/quy cách đã phân tích, version vị trí và cách lấy hàng đã in (`st_text`, `st_cartons`). Version là dấu vết hỗ trợ, không phải điều kiện duy nhất để từ chối.

Snapshot đơn mới có phiên bản định dạng và chứa các dòng hàng gốc đủ điều kiện nhặt theo đúng thứ tự, số lượng, giá, chiết khấu, thành tiền từng dòng, tổng tiền hàng và chiết khấu hóa đơn. Dữ liệu phân bổ theo mã được giữ riêng khỏi dữ liệu tiền dùng in.

## 3. Xác nhận đúng vị trí và quy cách

Khi chỉ định, đọc vị trí dưới khóa rồi lưu dấu vết cùng bản ghi giữ chỗ. Khi xác nhận, khóa chỉ định và các vị trí, kiểm tất cả điều kiện trước khi hoàn tất giao dịch:

1. Vị trí còn tồn tại, đúng cơ sở và mã hàng, vị trí chuẩn hóa khớp phiếu.
2. Ghi chú phân tích được, số chiếc còn đủ và số lượng nhặt hợp lệ.
3. Cách lấy hàng trên phiếu vẫn thực hiện được từ quy cách hiện tại: phân tích cách lấy đã lưu, đối chiếu quy cách/thùng cần lấy với tồn hiện tại; kiểm số chiếc và phần dư đúng lượng chỉ định. Không so nguyên chuỗi ghi chú hoặc chỉ so version.

Chỉ khác chữ hoa, khoảng trắng hoặc dấu nhân nhưng cùng nghĩa thì chấp nhận. Đơn khác giảm số thùng, làm tăng phần đã lấy lẻ hoặc dùng hết một quy cách không liên quan vẫn có thể được chấp nhận nếu lượng còn đủ và cách lấy in trên phiếu còn thực hiện được. Không bắt buộc thuật toán gợi ý hiện tại phải chọn lại đúng phương án cũ nếu phương án cũ vẫn hợp lệ.

Đổi A01 sang B02, đổi mã hoặc thay quy cách khiến cách lấy đã in không còn đúng: trả 409 `STOCK_CHANGED`, nêu mã/vị trí và hướng dẫn hủy, chỉ định lại. Một dòng lỗi làm rollback toàn bộ; không trừ một phần, không đổi trạng thái, không thêm lịch sử thành công.

## 4. Số lượng nguyên và hoàn tác

Kiểm từng dòng hàng gốc trước khi gộp: số lượng cần nhặt phải là số nguyên dương trong miền số nguyên an toàn của JavaScript. Hai dòng 0,4 và 0,6 không được cộng thành 1 để vượt kiểm tra. Giữ quy tắc loại dòng dịch vụ/VAT hiện có; các dòng hàng không hợp lệ phải báo rõ trước khi tạo giữ chỗ, không âm thầm bỏ qua.

Kiểm từng phân bổ và tổng sau cộng: số nguyên dương, hữu hạn, không vượt nhu cầu hoặc khả dụng theo quy tắc phân bổ hiện hành. Các giá trị 0,4; 0,6; âm; không hữu hạn; vượt miền an toàn đều bị từ chối. Giao diện nhập bước 1 và báo lỗi tại mã tương ứng; máy chủ kiểm tra độc lập.

Kiểm lại lượng đã lưu trước xác nhận và trước hoàn tồn. Với số nguyên hợp lệ, lượng thực giảm/tăng phải bằng lượng ghi trong lịch sử; xác nhận và hoàn tác không dùng phép làm tròn để chữa dữ liệu sai.

## 5. Phiếu in giữ đúng tiền và phân bổ

Chỉ gộp mã để tính nhu cầu, gợi ý và giữ chỗ. Snapshot in giữ từng dòng gốc; thành tiền và tổng tính tại máy chủ từ số liệu nguồn, sử dụng phép tính thập phân để tránh sai số tiền do số thực nhị phân. Không suy ngược tiền từ đơn giá bình quân đã làm tròn. Phiếu đọc thành tiền/tổng đã lưu, chỉ định dạng theo quy tắc hiển thị tiền hiện hành.

Ví dụ 10.000 chiếc giá 10 và 1 chiếc giá 11 cùng mã: giữ hai dòng, tổng 100.011; in lại sau thay đổi đơn nguồn vẫn giữ tổng này. Kiểm cả trường hợp cùng mã khác chiết khấu và chiết khấu hóa đơn.

Với nhiều dòng cùng mã, thông tin vị trí/ST tổng của mã xuất hiện một lần tại dòng đầu tiên, các dòng tiếp theo ghi tham chiếu đến dòng đó. Không lặp toàn bộ ST như thể phải lấy thêm cho mỗi dòng. Giữ thứ tự dòng gốc; không tự chia lượng theo dòng giá khi nghiệp vụ chỉ định đang theo mã.

## 6. Mất mạng và kết quả ghi chưa rõ

Mỗi thao tác bất đồng bộ có `try/catch/finally`; `finally` luôn tắt bận, kể cả lỗi fetch, đọc JSON hoặc tải dữ liệu sau ghi. Đóng/mở popup đặt lại trạng thái tải phù hợp; phản hồi cũ không được ghi đè đơn vừa mở khác.

Sau lỗi mạng ở thao tác ghi, có thể máy chủ đã commit. Popup chuyển sang trạng thái cần đồng bộ, đọc lại chỉ định mới nhất và danh sách khả dụng từ máy chủ trước khi bật thao tác ghi tiếp. Đọc thành công thì hiển thị trạng thái/version mới và cập nhật trạng thái liên quan trong danh sách Vòng đời đơn hàng.

Nếu đọc lại vẫn lỗi, popup hết bận và cho đóng hoặc thử tải lại; các nút tạo/xác nhận/hủy/chỉ định lại tiếp tục bị khóa do chưa xác định trạng thái, kèm thông báo rõ. Không tự gửi lại lệnh ghi. Sau hủy thành công nhưng tải lại lỗi, không tự tạo chỉ định mới. Lỗi tải ban đầu cũng phải cho phép tải lại.

## 7. Dữ liệu cũ và triển khai

- Chỉ định cũ đang nhặt thiếu snapshot vị trí mới: được xem, in lại và hủy giải phóng giữ chỗ; chặn xác nhận, hướng dẫn tạo lại để có dấu vết tin cậy. Không backfill bằng trạng thái VT hiện tại rồi coi đó là dữ liệu lúc chỉ định.
- Chỉ định cũ đang nhặt có lượng lẻ: chặn xác nhận, cho hủy giữ chỗ.
- Chỉ định cũ đã xác nhận có lượng lẻ hoặc chênh lệch giữa lượng ghi và biến động tồn: chặn hoàn tự động, báo cần đối soát. Không sửa lịch sử hoặc cộng trả lượng làm tròn. Đối soát thủ công nằm ngoài đợt sửa này.
- Chỉ định cũ đã xác nhận với lượng nguyên hợp lệ: giữ khả năng hoàn tác hiện hành, kiểm tra đầu vào trước khi hoàn.
- Snapshot in cũ chỉ có dòng gộp: vẫn đọc/in theo dữ liệu cũ và thông báo không có dòng gốc để đối chiếu; không tuyên bố khôi phục được tiền đã mất, không thay bằng đơn Kiot hiện tại.
- Migration mới không xóa dữ liệu/lịch sử, không cưỡng ép đổi NUMERIC thành số nguyên trên dữ liệu cũ. Service chặn dữ liệu sai; ràng buộc mới chỉ áp dụng cho bản ghi định dạng mới nếu cần.

Áp migration trước khi đưa mã mới vào vận hành. Phiên này chỉ tạo spec; không chạy migration hoặc ghi DB thật. Khi triển khai, cập nhật tài liệu API/schema/nghiệp vụ và trạng thái theo thay đổi thực tế.

## 8. Nghiệm thu

| Nhóm | Kịch bản và kết quả bắt buộc |
|---|---|
| Vị trí | A01 đổi B02: xác nhận bị chặn, tồn và trạng thái không đổi |
| Quy cách | 100 chiếc/thùng đổi 50: chặn khi phiếu cũ không còn thực hiện đúng |
| Giảm tồn hợp lệ | Hai đơn chung vị trí: đơn trước giảm tồn; đơn sau vẫn xác nhận nếu phiếu còn đúng và tồn đủ |
| Chuẩn hóa | Khác khoảng trắng/hoa thường/dấu nhân nhưng cùng nghĩa: không chặn nhầm |
| Nguyên tử | Một trong nhiều vị trí lỗi: toàn bộ thao tác rollback |
| Số lượng | 0,4; 0,6; hai dòng lẻ cộng thành nguyên; lượng âm/không hữu hạn/vượt miền an toàn: bị chặn trước giữ chỗ |
| Hoàn tác | Nhặt/hủy lượng nguyên khớp biến động thực tế; ghi chú đã đổi; tự xóa/tạo lại dòng; gọi lặp không trừ/cộng hai lần |
| Dữ liệu cũ | Thiếu snapshot và số lẻ xử lý đúng mục 7, không đoán lại lịch sử |
| Tiền | Tổng 100.011 được giữ; khác chiết khấu và in lại không sai; ST không cộng lặp khi trùng mã |
| Mất mạng | Lỗi trước ghi và mất phản hồi sau commit đều bỏ bận; đọc lại đúng trạng thái trước thao tác tiếp |
| Tải lại lỗi | Cho đóng/thử tải lại, khóa ghi đến khi đồng bộ; đóng/mở và đổi đơn không bị phản hồi cũ ghi đè |
| Tích hợp | Trạng thái/lọc Vòng đời, lịch sử VT, quyền và tách HN/SG hoạt động như hiện hành |

Kiểm bằng unit test quy tắc, service với PGlite, route và frontend mô phỏng lỗi fetch; kiểm phiếu in thực tế, popup trên màn hình hẹp và sáng/tối. Kiểm tranh chấp nhiều kết nối bằng PostgreSQL khi có môi trường phù hợp; PGlite một kết nối không được coi là bằng chứng kiểm thử đồng thời. Báo rõ các kiểm tra chưa chạy thay vì suy diễn đạt.

## 9. Tự rà soát spec

Đã đối chiếu bốn lỗi với yêu cầu tương ứng và tiêu chí nghiệm thu. Đã tách số chiếc nguyên khỏi số thùng lẻ; tách snapshot lúc chỉ định khỏi snapshot phục vụ hoàn tác; xác định hành vi dữ liệu cũ, dòng in trùng mã và lỗi ghi chưa rõ kết quả. Không còn lựa chọn nghiệp vụ bỏ ngỏ trong phạm vi này. Kế hoạch triển khai sẽ xác định số migration theo repository tại thời điểm thực hiện.
