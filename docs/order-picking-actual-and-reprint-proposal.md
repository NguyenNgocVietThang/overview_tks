# Đề xuất luồng thực nhặt và in lại

23/10/2026. Nghiên cứu theo vận hành giấy của TOKOSI; chưa thay đổi HTML hoặc triển khai nghiệp vụ.

## Vấn đề bản thử hiện tại

Màn hình Kho nhặt hàng đang trộn nhập thực tế, giữ chỗ, lấy bù và kiểm đếm. Nhập “lấy thêm lần này” dễ bị nhập trùng. Nút In và Kho nhặt hàng ở ngoài popup chỉ định gây chia cắt luồng. Số nhặt theo đơn và điều chỉnh tồn theo vị trí chưa được phân biệt đủ rõ cho người sử dụng.

## Giao diện đề xuất

Giữ nguyên trang Vòng đời và hộp chi tiết. Ngoài chi tiết chỉ có nút Chỉ định vị trí. Trong popup Chỉ định có thanh công cụ: In phiếu (chọn Nhặt hàng G/ Nhặt bổ sung / iao hàng), Nhập kho nhặt thực, Lưu nháp, Xác nhận.

Bảng chính: Mã hàng, Tên hàng, SL đơn, Tổng tồn chung, Vị trí kho, Kho nhặt thực, Còn thiếu. Đơn vị chiếc, quy cách thùng để tham khảo.

Kho nhặt thực là tổng lũy kế của mã trong đơn, không phải lượng lấy thêm mỗi lần bấm. Khi mã lấy từ nhiều vị trí, mở rộng ngay tại dòng để nhập thực nhặt từng vị trí; tổng ở cột chính tự cộng, không cho nhập hai nguồn độc lập. Ô trống = chưa nhận kết quả; 0 = đã nhận phiếu và xác nhận không nhặt được. Không tự điền số đã chỉ định thành số thực nhặt.

Khi thay số đã xác nhận, hiển thị trước/sau và yêu cầu lý do. Lưu lại cùng giá trị không tạo biến động; ghi nhận theo ID sự kiện và phiên bản phiếu. Sửa giảm số đã nhặt không tự cộng tồn kệ: phải có xác nhận hoàn vị trí hoặc sửa sai ghi nhận bằng chứng từ đối ứng.

## Luồng chính

1. Kế toán xác nhận vị trí, giữ chỗ dùng chung, in phiếu nhặt có phiên bản. Bản giấy có cột Thực nhặt để kho điền. In lại không tạo thêm giữ chỗ.
2. Nhiều kho nhặt song song. Kế toán nhập kết quả từng kho theo phiếu đã trả; kho chưa báo vẫn để Chờ kết quả, không coi là thiếu 0.
3. Lưu nháp kết quả không cập nhật sổ. Xác nhận thực nhặt mới ghi biến động theo vị trí và giảm giữ chỗ tương ứng. Hàng đã lấy được theo dõi gắn với đơn ở khu chờ giao.
4. Đủ: chốt số giao, mở in phiếu giao theo số thực tế đã chốt.
5. Thiếu: đánh dấu dòng, người nhập chọn Chờ kho còn lại / Lấy bù / Chờ hàng / Giao thiếu được chấp thuận. Không tự sửa SL đơn Kiot.

## Ví dụ cần 100 nhưng nhặt 70

Phiếu chỉ định A01:100. Khi nhập 70, hệ thống trước tiên hỏi đây là kết quả hoàn tất tại A01 hay còn chờ nhặt. Nếu còn chờ: 30 vẫn giữ chỗ. Nếu hoàn tất: giải phóng 30 chưa lấy, đơn hiện Nhặt thiếu 30; vị trí báo không đủ bị loại khỏi phương án bù của dòng này trong lần xử lý.

Lấy bù: chỉ phân bổ phần thiếu 30, giữ nguyên 70 đã nhặt. Phiếu bổ sung chỉ in mã/vị trí/số lượng lấy thêm, không in lại thành yêu cầu nhặt 100. Kho báo bù thêm 20 thì nhập kết quả tại nhiệm vụ bổ sung; tổng mã thành 90, còn thiếu 10.

Giao thiếu: cần Kế toán hoặc người có quyền chấp thuận. Ví dụ chốt giao 70 thì phiếu giao ghi 70; SL yêu cầu gốc vẫn 100 và phần 30 phải có trạng thái chờ/hủy theo quyết định nghiệp vụ. Nếu Kiot cần sửa hóa đơn/đơn, phải xác nhận đã đối chiếu trước khi chốt in giao; chưa tự động sửa Kiot trong prototype.

Kho nhặt thực không đồng nghĩa SL giao: hàng đã lấy có thể vẫn phải kiểm hàng hoặc giao nhiều đợt. Số giao của đợt không vượt lượng đã nhặt hợp lệ còn chưa giao.

## Kiểm đếm tồn là luồng ngoại lệ riêng

Nhặt thiếu không đủ bằng chứng sửa tồn xuống 0. Báo hết/hỏng/sai mã tạo sự cố sản phẩm–vị trí và ngừng cấp mới ở phạm vi liên quan. Kiểm tra các đơn khác đang giữ ở đó. Kế toán nhận kết quả kiểm đếm, ghi lý do và xác nhận điều chỉnh theo quyền; không chặn việc chọn vị trí bù khác cho đơn đang xử lý.

## Phiên bản và Telegram

Mỗi phiếu có mã đơn, mã phiếu, phiên bản và loại phiếu. Phiếu nhặt, bổ sung, giao hàng phải phân biệt rõ. Thay đổi trên Kiot chỉ làm phần bị ảnh hưởng cần xác nhận lại; không xóa thực nhặt đã ghi. Telegram chỉ gửi khi người dùng chọn phát hành/gửi, không tự gửi lại mỗi lần xem trước/in lại. Gửi bổ sung hoặc thay thế phải chỉ rõ phiên bản nào còn hiệu lực. Đây là đề xuất, chưa có ủy quyền gửi Telegram thực tế.

## Điều kiện nghiệm thu

- Hai kho báo kết quả khác thời điểm, số chưa báo không trở thành 0.
- Cùng mã nhiều vị trí, tổng thực nhặt bằng tổng chi tiết.
- Lưu hai lần một kết quả không trừ tồn hai lần.
- Nhặt 70, bù 20: tổng 90; phiếu bù chỉ có 20.
- Giao thiếu 70/100 có quyết định rõ ràng cho 30 còn lại.
- Không chấp thuận giao thiếu thì chưa in được phiếu giao chốt thiếu; vẫn được in phiếu nhặt/bổ sung.
- In lại không tạo giữ chỗ hoặc yêu cầu kho nhặt lại hàng cũ.
- Sửa số thực nhặt đã xác nhận không tự hoàn hàng vật lý.
- Thay đổi đơn Kiot sau khi kho đã nhặt không làm mất lịch sử.

## Tham khảo chính thức

Microsoft tách short pick thành ngoại lệ có lý do, cho cấu hình phân bổ lại: https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/work-exceptions-log

Odoo phân biệt số giao một phần và phần chuyển sang backorder: https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/shipping_receiving/setup_configuration/multipack.html

Các bố cục, quyền và điều kiện áp dụng TOKOSI trong tài liệu này là đề xuất từ nghiên cứu, chưa phải quyết định đã chốt với người dùng.
