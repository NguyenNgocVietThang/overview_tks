# Hoàn thành đơn và đồng bộ Kiot — nghiên cứu nghiệp vụ

Ngày: 23/10/2026. Phạm vi: nghiên cứu, chưa triển khai nút hoặc ghi dữ liệu Kiot. Vị trí nút đã được người dùng xác nhận: trong chi tiết đơn, ngoài popup chỉ định vị trí.

## Kết luận cần dùng để thiết kế

Không được đồng nhất ba thao tác: ghi kết quả kho nhặt, tạo hóa đơn bán hàng, kết thúc phiếu đặt hàng. Một nút hoàn thành phải có nghĩa xác định trước khi lựa chọn API. Đề xuất trước đó mặc định hoàn thành = tạo hóa đơn là chưa đủ căn cứ.

Theo hướng dẫn Kiot, đơn đặt hàng có thể được xử lý nhiều lần, mỗi lần tạo hóa đơn tương ứng. Khi chưa lấy hết hàng, người dùng có thể tiếp tục xử lý hoặc kết thúc phần còn lại. Tính năng kết thúc đặt hàng và tính năng tạo hóa đơn là các thao tác riêng. Nút trên TOKOSI cần thực hiện đúng thao tác kế toán đang dùng, không chỉ đặt một nhãn Hoàn thành ở hai nơi.

## Đã chốt và chưa chốt

Đã chốt: giữ nguyên màn hình vòng đời; chỉ định vị trí và số thực nhặt ở popup riêng; in có cột SL đơn, vị trí, ghi chú, thực tế nhặt riêng; nút hoàn thành ở chi tiết đơn; hệ thống TOKOSI chủ động gửi kết quả sang Kiot. In lại không trừ tồn hoặc tạo giao dịch bán hàng mới.

Chưa chốt: nút hoàn thành chỉ kết thúc phiếu đặt hàng hay còn thay thao tác tạo hóa đơn; được hoàn thành ở mốc nhặt xong, xuất hàng hay giao xong; phần thiếu tiếp tục giao hay ngừng xử lý; cách quản lý tiền cọc/thu tiền và người được quyền thực hiện. Câu trả lời nghiên cứu trước đây của người dùng chưa phải quy định vận hành cuối cùng.

## Phát hiện từ mã hiện có

- `server/shipment/orderLifecycleService.js`: trạng thái vòng đời được suy ra từ Sheet và có ghi đè thủ công. Riêng luồng ACCOUNTING hiện có thể nhận nhãn COMPLETED do xuất hiện trong tab kế toán/chứng từ. Nhãn này không đủ để kết luận đã bán, đã giao hoặc đã hoàn thành Kiot. Không được gắn lệnh ghi Kiot vào mọi lần đọc thấy COMPLETED.
- `server/shipment/kiotOrdersRepository.js`: đã đọc trạng thái Kiot riêng và ghép theo cơ sở/mã đơn; đây là thông tin tham chiếu, chưa phải cơ chế hoàn thành đơn ra Kiot.
- `server/kiotvietSync/entities/orders.js`, `invoices.js`: có nguồn đơn đặt, hóa đơn và thanh toán đồng bộ về DB. Cần đối chiếu hóa đơn liên quan trước khi gửi lệnh mới; không chỉ dựa vào cache danh sách.
- `server/kiotviet/kiotVietApiClient.js`: client đọc hiện tại có cơ chế thử lại chung. Không tái sử dụng nguyên cơ chế thử lại cho lệnh tạo hóa đơn: mất phản hồi có thể xảy ra sau khi Kiot đã ghi thành công.
- Prototype HTML mới có sổ vị trí trong bộ nhớ phiên. Thực nhặt làm giảm tồn vị trí; chưa có giao dịch ra Kiot hoặc mô hình đủ cho hàng chờ xuất. Không dùng trạng thái mô phỏng làm bằng chứng giao dịch thật.

## Các trường hợp cần xử lý

| Tình huống | Xử lý đề xuất | Không tự làm |
|---|---|---|
| Đủ hàng, chưa có hóa đơn | Nếu đã chốt phạm vi có tạo hóa đơn: lập hóa đơn đúng số lượng bán đã xác nhận, đọc lại kết quả và trạng thái đặt hàng | Không lấy số đặt thay số bán đã chốt |
| Hóa đơn đã được kế toán lập trên Kiot | Ghép hóa đơn hiện có, đối chiếu mã, dòng và số lượng; chỉ thực hiện phần còn thiếu của tác vụ | Không lập lại hóa đơn |
| Đặt 100, nhặt 80, còn giao tiếp | Ghi nhận phần đã xử lý; đặt hàng còn mở theo chính sách Kiot, phần 20 vẫn còn phải xử lý | Không gọi là đã hoàn thành toàn đơn |
| Đặt 100, nhặt 80, ngừng xử lý 20 | Cần một quyết định kết thúc phần thiếu ở thao tác hoàn thành đơn; bảo toàn SL đặt gốc và lịch sử | Không tự biến 80 thành 100 hoặc tự hủy phần thiếu |
| Còn vị trí chưa nhập thực nhặt | Hiện đúng mã chưa có kết quả; chưa cho hoàn tất theo kết quả kho | Không coi ô trống là 0 |
| Tất cả số thực nhặt bằng 0 | Không tạo hóa đơn hàng bằng 0; xử lý hủy/kết thúc không phát sinh bán theo nghiệp vụ được chọn | Không báo đã xuất/giao hàng |
| Có tiền cọc, đã thu một phần hoặc còn nợ | Đọc giao dịch thu hiện có; chỉ ghi số thu mới thực tế nếu có nghiệp vụ thu được xác nhận | Không gửi lại toàn bộ tiền đã thu, không mặc định khách trả đủ |
| Kiot đổi mã, số lượng, giá, giảm giá hoặc thuế sau khi in | So sánh phiên bản tại lúc xác nhận; báo phần thay đổi và yêu cầu đối chiếu | Không ghi đè đơn mới bằng bản nhặt cũ |
| Kiot đã hủy hoặc hoàn thành ở nơi khác | Đọc lại dữ liệu và đối chiếu đúng nghĩa hoàn thành; cập nhật kết quả nếu cùng tác vụ, nếu khác thì đưa vào cần kiểm tra | Không âm thầm mở lại hoặc tạo mới |
| Hai kế toán bấm đồng thời | Một tác vụ duy nhất cho cùng đơn/phạm vi xử lý; khóa và kiểm tra phiên bản ở máy chủ | Không chỉ khóa nút ở trình duyệt |
| Mất mạng sau khi gửi lệnh | Trạng thái cần đối soát; kiểm tra Kiot trước khi quyết định gửi lại | Không mặc định thất bại rồi tạo lại hóa đơn |
| Đã hoàn thành rồi có hàng trả | Làm nghiệp vụ trả hàng/điều chỉnh riêng có chứng từ | Không xóa lịch sử nhặt và tự cộng tồn vị trí |

## Giao diện đề xuất, ít thao tác

Chi tiết đơn có nút Hoàn thành đơn & đồng bộ Kiot, tách khỏi nút In và Chỉ định vị trí. Bấm nút mở một hộp xác nhận duy nhất: mã/cơ sở, số đặt, số thực nhặt, số bán sẽ gửi, giá trị và giao dịch Kiot liên quan. Không thêm lại khối xử lý thiếu phức tạp vào popup nhặt hàng đã được người dùng yêu cầu bỏ.

Đơn đủ và dữ liệu khớp chỉ cần xác nhận một lần. Đơn thiếu mới cần quyết định còn giao tiếp hay kết thúc phần thiếu. Đây là đề xuất cần người dùng chốt, chưa phải quy tắc đã được duyệt. Không mặc định coi phần nhập trong bản xem trước in có thể sửa trực tiếp là số liệu nghiệp vụ đã xác nhận.

Hiển thị trạng thái đồng bộ riêng: chưa gửi, đang gửi, cần đối soát, đã đồng bộ, có lỗi xác định. Chỉ ghi Đã hoàn thành trên Kiot sau khi đã kiểm tra trạng thái thật phù hợp; có hóa đơn không tự chứng minh mọi phần của đặt hàng đã kết thúc. Chưa đồng bộ thành công vẫn giữ lịch sử và kết quả kho. Không tự đánh dấu tài xế giao thành công hoặc khách ký nhận.

## Tồn và tiền: các nguồn phải tách rõ

1. Chỉ định giảm khả dụng bằng giữ chỗ. Nhập thực nhặt chuyển phần giữ chỗ sang hàng đã lấy khỏi vị trí, giải phóng phần chưa lấy theo chính sách hiện tại.
2. Tác vụ hoàn thành không trừ sổ vị trí thêm lần nữa cho đúng lượng đã ghi nhận. Tạo hóa đơn/ghi bán trên Kiot có tác động riêng tới hệ thống Kiot; phải đối chiếu đúng thời điểm, không phát thêm lệnh điều chỉnh tồn cùng lượng.
3. Kiot giữ chứng từ bán hàng, đơn giá, giảm giá, thuế và thanh toán. Không lấy dữ liệu giá giả hoặc giá trị công nợ suy ra từ bản in HTML để ghi giao dịch thật. Số chưa có dữ liệu phải được xác minh, không chuyển dấu — thành 0.
4. Cần biết hàng sau nhặt còn ở khu chờ giao hay đã rời cơ sở để đối soát tổng vị trí với tổng tồn Kiot. Không ép hai tổng bằng nhau ở mọi mốc bằng cách tự sửa số.

## Kết quả xác minh API và giới hạn

### Kiểm chứng kết nối bằng cấu hình người dùng cung cấp

Đã thực hiện trên cả HN/SG: POST lấy token client_credentials tại `https://id.kiotviet.vn/connect/token`, GET một đơn qua Public API, rồi GET chỉ đọc tại origin API nội bộ đã quan sát. Không gửi lệnh hoàn thành, sửa đơn, tạo hóa đơn hoặc thanh toán. Không lưu giá trị khóa/token vào tài liệu hoặc file cấu hình.

| Cơ sở | Lấy token | GET Public API `/orders?pageSize=1&currentItem=0` | GET API nội bộ `/api/orders?format=json&$top=1` |
|---|---|---|---|
| HN | HTTP 200 | HTTP 200 | HTTP 401, KvAuthenticationException |
| SG | HTTP 200 | HTTP 200 | HTTP 401, KvAuthenticationException |

Kết luận quan sát: bộ khóa Public API hiện có hoạt động để lấy token và đọc dữ liệu cho cả hai cơ sở, nhưng cùng token đó bị từ chối xác thực ở yêu cầu đọc API nội bộ được thử. Đây không phải thử nghiệm POST hoàn thành và không chứng minh mọi API/miền nội bộ đều có cùng chính sách. Tuy nhiên, chưa có cơ sở dùng bộ khóa hiện có để gọi thẳng cơ chế Complete của giao diện. Cần Kiot cung cấp endpoint/cách cấp quyền được hỗ trợ, hoặc một giải pháp thao tác trong phiên người dùng được thiết kế và xác nhận riêng. Không dùng cách tạo hóa đơn thay cho kết thúc đặt hàng.

### Phát hiện mới từ mã giao diện Kiot — bổ sung sau khi kiểm tra tài liệu

Đã mở trang Đặt hàng đang đăng nhập của gian hàng chhanoi ở một tab nghiên cứu riêng và quan sát danh sách tài nguyên. Không bấm Kết thúc, không gửi lệnh tạo/sửa/hủy chứng từ, không đọc hoặc sao chép giá trị token đăng nhập.

Tài nguyên quan sát: `https://cdn1-retail-kv-man-app.kiotviet.vn/20261023071242-81c1870f/kiotviet-app.min.js`, 7.243.267 byte, SHA-256 `1e912d16e198e0b468ed96148e6101f13a483b6b4a11dbbbf6aad28ed665c501`. Tải bản JavaScript công khai này để đọc tĩnh, không thực thi bundle đã tải.

Các bằng chứng trực tiếp trong mã:

- Template gắn nút kết thúc đơn với hàm `finishOrder()`.
- Controller chi tiết khai báo biến `o` là `OrderResource`. Trong handler kết thúc, sau xác nhận người dùng, nó gọi `o.save` với object có các khóa `Order`, `Complete` và `FromManager`; hai cờ sau được đặt true. Không gọi hàm tạo hóa đơn trong chính handler này. Chưa chứng minh được mọi tác động của máy chủ từ việc đọc handler.
- Resource khai báo tuyến `orders/:orderId/:action`; hàm `finishOrders` dành cho hàng loạt có method POST, action `finishOrders`. Hàm hàng loạt chuẩn bị mỗi mục gồm ID, mã, trạng thái và chi nhánh. Hàm resource chung ghép tuyến với base API và sử dụng Angular `$resource`.
- Danh sách tài nguyên của trang thực tế cho thấy yêu cầu đọc đơn ở `https://api-man1.kiotviet.vn/api/orders`. Từ resource/method có thể suy ra tuyến ghi hoàn thành đơn lẻ qua resource orders và tuyến hàng loạt `/api/orders/finishOrders`. Đây là suy luận từ mã, chưa phải bản ghi mạng của một yêu cầu hoàn thành đã chạy.
- Mã interceptor đọc BearerToken từ phiên đăng nhập Kiot rồi gắn header, cùng ngữ cảnh gian hàng/chi nhánh. Không có bằng chứng rằng token client_credentials của Public API có quyền gọi API nội bộ này. Không trích xuất giá trị phiên đăng nhập để thử lại bên ngoài trình duyệt.

Điều chỉnh kết luận: **đã xác nhận có cơ chế hoàn thành riêng trong mã giao diện Kiot, với cờ Complete, không còn chỉ là giả định từ tài liệu hướng dẫn.** Chưa xác nhận một endpoint Public API được Kiot hỗ trợ cho tích hợp bên thứ ba, chưa thử tác vụ trên một đơn thử, và chưa xác minh kết quả/tác động phía máy chủ. Không được báo đã hoàn thành đơn thật hoặc đã tích hợp production.

Khả năng triển khai cần phân biệt: tích hợp máy chủ bằng Public API vẫn cần xác minh cơ chế cấp quyền hoặc endpoint được Kiot chấp nhận; thao tác trong phiên trình duyệt Kiot là hướng khác, phụ thuộc phiên đăng nhập và không phải API máy chủ đã được hỗ trợ. Không lưu token trình duyệt vào prototype hoặc tự coi cơ chế nội bộ là cam kết API ổn định.

Bằng chứng cục bộ: `tmp/kiot-api-research/completion-evidence.json` chứa URL, checksum và khoảng nguồn theo UTF-16; handler ở khoảng 1679123–1680442. Đã kiểm tra cú pháp handler trích xuất. Phân tích toàn bundle bằng REA hết thời gian; phân tích lại riêng handler 1.320 byte thành công, không có lỗi parse. REA chỉ cung cấp bằng chứng tĩnh, các quan hệ động vẫn chưa biết. Bản bằng chứng được xuất ở `tmp/kiot-api-research/rea-evidence.json`. Các file này là dữ liệu nghiên cứu, không phải mã tích hợp.

### Kiểm tra bổ sung theo yêu cầu xác minh, 23/10/2026

Đã mở lại tài liệu Public API chính thức và đối chiếu toàn bộ request/response mục 2.5.4, danh sách thao tác Đặt hàng 2.5.1–2.5.5, mục tạo hóa đơn 2.12.3, cùng hướng dẫn Đặt hàng trên website. Kết quả: chức năng Kết thúc có trên sản phẩm Kiot, nhưng tài liệu Public API kiểm tra không mô tả một endpoint kết thúc riêng. Request PUT đặt hàng được công bố không có trường `status`; `status`/`statusValue` có trong response không phải bằng chứng có thể gửi chúng để đổi trạng thái. `makeInvoice` được mô tả là tạo hóa đơn/phiếu thu, không được dùng thay việc chỉ kết thúc đặt hàng.

Kết luận xác minh: chưa xác nhận được cách thực hiện đúng thao tác Hoàn thành/Kết thúc đặt hàng qua Public API được hỗ trợ. Đây là kết luận về phạm vi tài liệu đã kiểm tra, không phải khẳng định Kiot không có API nội bộ hoặc API đối tác cho việc này. Chưa có thử nghiệm ghi trên gian hàng hoặc phản hồi từ đội Kiot; không báo đã kiểm chứng thực tế và không tự thử PUT tham số phỏng đoán trên đơn bán thật. Mã dự án cũng chưa có hàm tích hợp thao tác này.

Nội dung cần Kiot xác nhận (đã soạn, chưa gửi): “Gian hàng muốn tích hợp thao tác Kết thúc/Hoàn thành phiếu đặt hàng bằng Public API, tương đương nút Kết thúc trên giao diện, không tạo hóa đơn, không thu tiền mới và không thay số lượng hàng. Public API có hỗ trợ không? Nếu có xin endpoint, HTTP method, request mẫu, quyền cần thiết, trạng thái đầu vào cho phép, xử lý đơn đã có hóa đơn một phần, tác động tiền cọc/giữ hàng và cách đọc xác nhận kết quả. PUT /orders/{id} có hỗ trợ chuyển trạng thái không, hay chỉ hỗ trợ cập nhật nội dung và makeInvoice?”

Nếu có endpoint được xác nhận: kiểm thử trên phiếu được xác định rõ là dữ liệu thử; so sánh trước/sau trạng thái, mã/SL dòng, hóa đơn, thanh toán và giữ hàng; gọi lại để xác minh hành vi lặp. Chỉ sau đó mới cam kết chức năng kết nối thật.

Tài liệu Public API mô tả cập nhật đặt hàng bằng PUT /orders/{id}, có `makeInvoice` để tạo hóa đơn và phiếu thu; mô tả POST /invoices có `orderId` cùng chi tiết hóa đơn; danh sách hóa đơn có bộ lọc `orderId`.

Đây là bằng chứng có API xử lý hóa đơn liên quan đặt hàng. Chưa thấy trong tài liệu đã đối chiếu một API công khai riêng, đủ rõ, cho thao tác Kết thúc đặt hàng còn thiếu mà không tạo hóa đơn. Không suy ra rằng `makeInvoice=true` tương đương thao tác đó hoặc PUT có thể nhận mọi mã trạng thái. Cần xác minh với Kiot về API được hỗ trợ cho gian hàng này, nhất là kết thúc phần chưa giao và tác động tiền cọc. Chưa thử ghi vào gian hàng thật.

Đề xuất chọn hướng có tài liệu rõ: khi nghiệp vụ cần ghi bán, tạo hóa đơn gắn đúng đơn gốc và đọc lại kết quả. Nếu nghiệp vụ chỉ cần kết thúc phiếu đặt hàng, cần xác minh API trước khi cam kết tự động hóa đầy đủ; không thay bằng việc tạo hóa đơn ngoài ý muốn.

## Yêu cầu kỹ thuật trước khi kết nối thật

Lưu khóa gian hàng + chi nhánh + ID đặt hàng Kiot; mã DH chỉ để hiển thị/tra cứu. Lưu phiên bản đơn gốc, kết quả thực nhặt đã xác nhận, người thực hiện, tác vụ đồng bộ và ID chứng từ Kiot. Máy chủ kiểm tra quyền Kế toán/Quản lý, không để khóa API trong HTML.

Mỗi tác vụ cần khóa chống gửi trùng ở DB, đối soát khi kết quả không rõ và lịch sử chuyển trạng thái. Cùng một lần hoàn thành bấm lại phải lấy lại kết quả đã có. Nếu có nhiều đợt giao, mỗi đợt có định danh riêng và tổng số bán không được vượt số được phép bán. Khi một bước ngoài Kiot thành công nhưng ghi DB lỗi, phục hồi bằng đối soát, không chạy lại toàn bộ tác vụ.

## Những câu cần chốt tiếp

1. Hiện tại trên Kiot kế toán bấm Kết thúc/Hoàn thành phiếu đặt hàng, hay bấm Tạo hóa đơn rồi hoàn tất bán hàng?
2. Nút trên TOKOSI dùng lúc kho nhặt xong, lúc giao cho lái xe hay lúc khách nhận hàng?
3. Nhặt thiếu: còn giao tiếp hay kết thúc phần thiếu ngay; ai có quyền quyết định?
4. Thu tiền/cọc tiếp tục làm trên Kiot hay cũng muốn nhập tại TOKOSI?

## Nghiệm thu tối thiểu

Đủ hàng một lần; thiếu rồi giao tiếp; thiếu và kết thúc; đã có hóa đơn; cùng mã DH ở hai cơ sở; hai người bấm; gửi thành công nhưng mất phản hồi; ghi DB lỗi sau thành công Kiot; thử lại sau khi người khác sửa đơn; tiền cọc không bị thu lần hai; in lại không tạo hóa đơn; đồng bộ không trừ tồn vị trí lần hai; hoàn thành Kiot không tự tạo bằng chứng khách ký nhận.

## Nguồn

- KiotViet, Đặt hàng: https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/retail-dat-hang/dat-hang/ — phân biệt tạo hóa đơn, giao một phần và kết thúc phần còn lại.
- KiotViet, Tạo phiếu đặt hàng: https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/huong-dan-dat-hang/tao-phieu-dat-hang/ — một đặt hàng có thể có nhiều lần tạo hóa đơn; hoàn thành phiếu chưa giao đủ.
- KiotViet, Public API: https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/retail-ket-noi-api/public-api/ — mục 2.5.4, 2.12.1, 2.12.3.

Các xử lý, quyền, cách đặt nút và trạng thái đồng bộ trong tài liệu này là đề xuất riêng cho TOKOSI, không phải cam kết hành vi API từ Kiot.
