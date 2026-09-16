# Thiết kế: Tìm kiếm từng bảng và điều hướng từ biểu đồ

Ngày: 2026-09-16

## Bối cảnh

Trang `server/public/index.html` của tính năng **Báo cáo tổng hợp** hiện có 20
bảng dữ liệu thuộc các tab Tổng quan, Hàng hóa, Hóa đơn, Khách hàng, Nhà cung
cấp và Quản lý công nợ. Các bảng lớn dùng chung `renderPaginatedRows()` với 100
dòng mỗi trang, nhưng phần lớn chưa có bộ lọc riêng. Ô tìm kiếm cấp tab hiện tại
gọi API và hiển thị một vùng kết quả độc lập, vì vậy không thay thế được thao tác
tìm trực tiếp trong từng bảng.

Một số biểu đồ đứng cạnh bảng chi tiết có cùng tập dữ liệu nhưng chưa hỗ trợ
điều hướng từ điểm/cột biểu đồ đến dòng tương ứng. Riêng tab Quản lý công nợ đã
có hành vi nghiệp vụ nhấn biểu đồ để lọc bảng; hành vi này được giữ nguyên.

## Mục tiêu

1. Mọi bảng trong Báo cáo tổng hợp đều có khả năng tìm trên **toàn bộ dữ liệu
   của bảng trước khi phân trang**.
2. Tìm thông thường dùng phép khớp chứa cụm từ, không phân biệt chữ hoa/thường,
   dấu tiếng Việt hoặc khoảng trắng thừa; tất cả dòng khớp được giữ lại.
3. Bảng có cột mã hiển thị hỗ trợ thêm chế độ tìm nhiều mã bằng phép khớp chính
   xác.
4. Biểu đồ có quan hệ một-một với dòng bảng cho phép nhấn để chuyển đến, cuộn
   và tô sáng dòng chính xác.
5. Kết quả xuất Excel phản ánh cùng bộ lọc đang áp dụng trên bảng.
6. Hành vi thống nhất, có thể tái sử dụng và kiểm thử độc lập thay vì viết logic
   riêng cho từng bảng.

## Ngoài phạm vi

- Không biến biểu đồ tổng hợp theo ngày/nhóm thành bộ lọc nhiều dòng khi không
  tồn tại một dòng bảng đối ứng duy nhất.
- Không thay đổi API tìm kiếm cấp tab hoặc cách vùng kết quả tìm kiếm cấp tab
  hoạt động.
- Không thay đổi quy tắc sắp xếp, kích thước trang 100 dòng hoặc dữ liệu nguồn.
- Không thay hành vi nhấn biểu đồ hiện có của tab Quản lý công nợ.
- Không thêm tìm kiếm phía server cho thao tác hiển thị bảng; dữ liệu bảng đã có
  ở frontend và được lọc cục bộ.

## Kiến trúc

### Mô-đun dùng chung

Thêm `server/public/js/table-explorer.js` theo cùng kiểu mô-đun trình duyệt đang
dùng cho `pagination.js`. Mô-đun chỉ chứa các hàm thuần và API điều phối nhỏ:

- `normalizeTableSearchText(value)`: chuẩn hóa Unicode, bỏ dấu, chuyển chữ
  thường, gom khoảng trắng.
- `parseTableCodes(value)`: tách mã theo xuống dòng, khoảng trắng, dấu phẩy hoặc
  dấu chấm phẩy; bỏ mã rỗng và mã trùng nhưng giữ thứ tự nhập.
- `filterTableItems(items, config, searchState)`: lọc toàn bộ tập dữ liệu theo
  chế độ thường hoặc nhiều mã.
- `findTableItemPage(items, identity, pageSize)`: tìm vị trí và trang của dòng
  theo khóa định danh ổn định.

`index.html` giữ registry cấu hình theo `tableKey`. Mỗi cấu hình khai báo:

- nguồn dữ liệu gốc;
- các trường tạo search text;
- trường mã nếu bảng có chế độ nhiều mã;
- hàm lấy định danh dòng;
- ID tbody, phân trang, ô tìm kiếm, bộ đếm;
- hàm dựng HTML của dòng và thông báo rỗng.

State bổ sung theo `tableKey`:

```js
tableSearches: {
  [tableKey]: {
    mode: 'normal' | 'codes',
    query: '',
    requestedCodes: [],
    missingCodes: []
  }
}
```

Chuỗi render bắt buộc là:

```text
dữ liệu gốc -> lọc tìm kiếm trên toàn tập -> phân trang -> dựng dòng -> áp sort DOM hiện có
```

Như vậy tìm kiếm không bị giới hạn ở trang đang xem. Khi từ khóa hoặc chế độ
thay đổi, trang của bảng trở về 1. Khi dashboard tự làm mới dữ liệu, state tìm
kiếm được giữ và áp lại trên dữ liệu mới; khi tải lại trang, state trở về rỗng.

### Phạm vi các bảng

20 bảng đều tham gia cơ chế tìm kiếm. Các điều khiển chuyên biệt hiện có được
tái sử dụng, không tạo ô trùng:

- `prResultRows`: tiếp tục dùng ô Báo cáo doanh thu theo hàng và hai chế độ tìm
  hiện có, nhưng dùng cùng quy tắc chuẩn hóa/lọc kết quả.
- `cpDetailRows` và `cpMonthlyRows`: tiếp tục dùng một ô sản phẩm chung của báo
  cáo doanh thu theo khách, nhưng đổi từ chọn duy nhất sang lọc chứa cụm từ trên
  toàn bộ sản phẩm; chọn một gợi ý vẫn tạo phép khớp chính xác sản phẩm đó.
- `debtManagementRows`: tiếp tục dùng `debtManagementSearch`, đồng thời mở rộng
  search text từ tên khách/sale sang tất cả trường hiển thị có ý nghĩa.
- Các bảng còn lại nhận ô tìm kiếm cục bộ trong `panel-head`.

Chế độ **Nhiều mã** xuất hiện khi bảng đang hiển thị cột mã:

- Kết quả doanh thu theo hàng.
- Hai bảng kết quả kiểm tra đứt hàng.
- Chi tiết giao dịch, danh sách nhập hàng và danh sách mã mới.
- Top sản phẩm bán chạy khi chế độ phân tích là Theo mặt hàng.
- Hàng đã hết, tất cả mã hàng và hàng mới nhập.
- Đặt hàng, trả hàng và hóa đơn gần đây.
- Chi tiết doanh thu theo khách và chi tiết khách nợ.
- Danh sách nhà cung cấp.

Ở bảng Trả hàng, mã chính là Mã trả hàng; Mã hóa đơn gốc vẫn tham gia tìm thông
thường nhưng không được dùng làm khóa cho chế độ Nhiều mã. Top sản phẩm bán chạy
ẩn chế độ Nhiều mã khi chuyển sang phân tích Theo nhóm cha.

## Giao diện và hành vi tìm kiếm

### Tìm thông thường

- Ô tìm kiếm nằm trong thanh tiêu đề của từng panel và có placeholder phù hợp
  với dữ liệu bảng.
- Phép tìm là `normalizedRowText.includes(normalizedQuery)` trên các trường có ý
  nghĩa của dòng, không phải chỉ trên nội dung trang DOM hiện tại.
- Ví dụ `chổi lau nhà` giữ lại mọi dòng có chứa cụm từ này trong mã, tên hoặc
  trường được cấu hình; không tự chọn, cuộn hoặc tô sáng một kết quả.
- Nút xóa và phím `Escape` xóa từ khóa, khôi phục toàn bộ dữ liệu và về trang 1.
- Bộ đếm hiển thị `số kết quả / tổng số`, ví dụ `12 / 350`, khi đang lọc; khi
  không lọc chỉ hiển thị tổng số như hiện tại.
- Không có kết quả thì tbody hiển thị thông báo có chứa từ khóa đã tìm.

### Tìm nhiều mã

- Bảng đủ điều kiện có hai nút `Thông thường` và `Nhiều mã` cạnh ô tìm kiếm.
- Có thể dán mã phân cách bằng xuống dòng, khoảng trắng, dấu phẩy hoặc dấu chấm
  phẩy.
- Mã được so sánh chính xác sau khi trim và chuẩn hóa chữ hoa/thường; không ép
  sang số để tránh mất số 0 ở đầu.
- Kết quả giữ lại mọi dòng có mã thuộc danh sách yêu cầu và vẫn đi qua phân
  trang bình thường.
- Trạng thái hiển thị `Đã tìm thấy X/Y mã`; danh sách mã thiếu được rút gọn nếu
  dài, nhưng toàn bộ vẫn nằm trong state để xuất báo cáo và kiểm thử.

### Xuất Excel

Payload xuất bổ sung `tableSearch` gồm `mode`, `query` hoặc `codes` cho tableKey
đang xuất. Backend áp cùng quy tắc tìm trên dữ liệu xuất trước khi tạo workbook.
Ô tìm kiếm trống giữ nguyên hành vi xuất toàn bộ hiện tại. Việc lọc xuất được
thực hiện phía server, không gửi toàn bộ dữ liệu bảng từ trình duyệt lên.

## Điều hướng từ biểu đồ

Chỉ các biểu đồ dưới đây có quan hệ một-một đủ chắc chắn để bật click:

| Biểu đồ | Bảng đích | Khóa liên kết |
|---|---|---|
| Top 15 giao dịch lớn nhất | Chi tiết giao dịch | Mã giao dịch |
| Doanh thu theo sản phẩm của một khách | Bảng chi tiết sản phẩm | Mã sản phẩm |
| Top sản phẩm/nhóm cha bán chạy | Chi tiết sản phẩm/nhóm cha bán chạy | Mã sản phẩm hoặc tên nhóm cha trong chế độ tương ứng |
| Top doanh thu hàng mới nhập | Hàng mới nhập | Mã sản phẩm |
| Doanh thu theo nhóm con | Chi tiết nhóm con | Cặp nhóm cha + nhóm con |
| Số lượng theo nhóm con | Chi tiết nhóm con | Cặp nhóm cha + nhóm con |
| Top khách hàng theo doanh thu | Chi tiết doanh thu theo khách | Mã khách hàng |
| Khách hàng công nợ cao nhất | Chi tiết khách nợ | Mã khách hàng |
| Top nhà cung cấp nợ cao nhất | Danh sách nhà cung cấp | Mã nhà cung cấp |

Handler biểu đồ lấy khóa từ item nguồn bằng `dataIndex`, không suy ngược từ
nhãn hiển thị. Khi nhấn:

1. Xóa tìm kiếm cục bộ đang áp dụng ở bảng đích.
2. Tìm dòng theo khóa trên dữ liệu gốc.
3. Chuyển sang trang chứa dòng.
4. Cuộn panel bảng vào vùng nhìn thấy, sau đó cuộn dòng vào giữa khung bảng.
5. Gắn lớp tô sáng trong 2,5 giây và thông báo qua vùng `aria-live`.

Nếu khóa không còn tồn tại sau một lần làm mới dữ liệu, không thay đổi trang hay
ô tìm kiếm; chỉ thông báo `Không còn tìm thấy dòng tương ứng`. Canvas có liên
kết dùng con trỏ pointer và ghi chú `Nhấn cột để xem dòng tương ứng`.

Các biểu đồ theo ngày, biểu đồ phân bổ nhà cung cấp thành nhiều phiếu, cơ cấu tồn
kho và các biểu đồ nhóm hàng có nhiều sản phẩm đối ứng chỉ giữ hover/tooltip.

## Khả năng truy cập

- Mỗi ô tìm kiếm có label hoặc `aria-label` gắn rõ tên bảng.
- Nhóm chế độ tìm dùng `role="group"`, `aria-pressed` và giữ focus khi chuyển
  chế độ.
- Trạng thái số kết quả, mã thiếu và kết quả điều hướng biểu đồ dùng `aria-live`.
- Hiệu ứng tô sáng bị tắt khi `prefers-reduced-motion: reduce`, nhưng dòng vẫn
  được đưa vào vùng nhìn thấy.
- Không dùng màu sắc làm tín hiệu duy nhất; ghi chú biểu đồ cho biết có thể nhấn.

## Trường hợp biên và xử lý lỗi

- Dữ liệu bảng rỗng: giữ thông báo rỗng nghiệp vụ hiện tại; không hiển thị trạng
  thái “không khớp” nếu chưa có từ khóa.
- Từ khóa chỉ gồm khoảng trắng hoặc dấu phân cách: coi như chưa lọc.
- Danh sách nhiều mã chứa mã trùng: chỉ tính một lần, giữ thứ tự nhập đầu tiên.
- Hai dòng có cùng tên: tìm thường trả cả hai; click biểu đồ vẫn tìm đúng bằng mã
  nguồn. Biểu đồ không có khóa duy nhất không được đăng ký click.
- Dữ liệu làm mới trong lúc đang ở trang cao: sau khi lọc lại, số trang được
  clamp bằng cơ chế `paginate()` hiện có.
- Lọc xuất Excel lỗi: modal xuất hiển thị lỗi hiện có; dữ liệu trên màn hình
  không bị thay đổi.
- Một bảng không có cấu hình registry: render cũ vẫn hoạt động, đồng thời test
  coverage phải phát hiện tbody chưa được đăng ký.

## Kiểm thử

### Unit test cho `table-explorer.js`

- Chuẩn hóa dấu tiếng Việt, hoa/thường và khoảng trắng.
- Khớp chứa cả cụm từ và trả mọi dòng khớp.
- Parse nhiều mã với bốn loại dấu phân cách, loại mã trùng và giữ số 0 đầu.
- Khớp mã chính xác, tính mã tìm thấy/mã thiếu.
- Lọc toàn tập trước khi phân trang.
- Tìm đúng trang từ khóa định danh và trả trạng thái không tìm thấy.

### Frontend/JSDOM

- Mọi tbody thuộc Báo cáo tổng hợp được đăng ký hoặc được một bộ tìm kiếm chuyên
  biệt đã đăng ký điều khiển.
- Ô tìm thường lọc được dòng nằm ngoài trang đầu và đưa kết quả về trang 1.
- Chế độ nhiều mã chỉ xuất hiện trên bảng có cột mã trong trạng thái hiện hành.
- Xóa từ khóa khôi phục toàn bộ dữ liệu.
- Mỗi biểu đồ trong bảng mapping điều hướng đến đúng trang và đúng dòng bằng mã,
  kể cả khi tên hiển thị trùng nhau.
- Click mục đã biến mất chỉ phát thông báo, không làm đổi bảng.
- Tab Quản lý công nợ giữ nguyên click-to-filter hiện tại.

### Backend/export và hồi quy

- Mỗi export tableKey áp đúng tìm thường hoặc danh sách mã trước khi tạo sheet.
- Payload trống giữ nguyên số dòng xuất hiện tại.
- Chạy toàn bộ test frontend, test export service và `git diff --check`.

## Tiêu chí nghiệm thu

1. Người dùng có thể tìm một cụm từ trong từng bảng và nhận mọi dòng khớp từ
   toàn bộ các trang.
2. Mọi bảng có cột mã hiển thị cho phép chuyển sang chế độ Nhiều mã và báo rõ mã
   tìm thấy/mã thiếu.
3. Nhấn biểu đồ có mapping một-một đưa người dùng tới chính xác dòng tương ứng;
   biểu đồ tổng hợp không tạo điều hướng mơ hồ.
4. Export khớp với kết quả đang lọc.
5. Các bộ tìm kiếm chuyên biệt và click-to-filter của Quản lý công nợ không bị
   hồi quy.
