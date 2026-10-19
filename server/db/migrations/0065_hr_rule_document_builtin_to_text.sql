-- Chuyen 4 tai lieu "Quy dinh cong ty" dung san (kind='builtin', noi dung nam cung
-- trong HTML trang Quan ly nhan su) sang kind='text' (go tay, Quan ly tu sua qua web).
-- Noi dung HTML duoc trich tu chinh 4 khoi tinh (server/public/humanresources/index.html
-- truoc migration nay) va da chay qua sanitizeRuleDocumentHtml() (hr/hrRuleDocumentSanitizer.js)
-- de xac nhan KHONG mat the nao (kiem bang script rieng, doi chieu so luong moi loai the
-- truoc/sau loc) truoc khi dua vao day — chi mat thuoc tinh class/data-* (vd data-table-controls
-- dung cho table-controls.js an/hien cot) vi khong nam trong whitelist, khong mat noi dung.
-- Icon dinh kem (migration 0062) giu dung 4 icon da dung truoc do: dong ho, lich, qua, hop hang.
-- Giu nguyen id dong (ON CONFLICT khong can) de khong doi URL/thu tu tab (sort_order cu).
-- Sau migration nay khong con tai lieu kind='builtin' nao — DEFAULT_BUILTIN_DOCUMENTS phia
-- code can doi thanh mang rong (xem hr/hrRuleDocumentsRepository.js) de "Khoi phuc tai lieu
-- mac dinh" khong hien sai va khong tao lai ban trung ten.

UPDATE hr_rule_documents
SET kind = 'text', builtin_key = NULL, icon_key = 'clock',
    body = $body1$<p>Để đảm bảo kỷ luật và công bằng trong công việc, công ty yêu cầu toàn thể nhân viên tuân thủ nghiêm túc các quy định sau.</p>

                <div>
                  <h4>Giờ làm việc chính thức</h4>
                  <table>
                    <thead><tr><th>Khối</th><th>Buổi sáng</th><th>Buổi chiều</th></tr></thead>
                    <tbody>
                      <tr><td>Kho vận</td><td>Ca 1: 08h00 – 11h30<br />Ca 2: 08h00 – 12h30</td><td>Ca 1: 12h30 – 17h00<br />Ca 2: 13h30 – 17h00</td></tr>
                      <tr><td>Văn phòng HN</td><td>07h45 – 11h30</td><td>12h30 – 16h45</td></tr>
                      <tr><td>Văn phòng SG</td><td>08h00 – 12h00</td><td>13h00 – 17h00</td></tr>
                    </tbody>
                  </table>
                  <p>☞ Nhân viên phải có mặt đúng giờ, không được tự ý nghỉ sớm.</p>
                </div>

                <div>
                  <h4>Quy định đi muộn, về sớm, quên chấm công</h4>
                  <ul>
                    <li>Mỗi tháng, nhân viên được phép đi muộn, về sớm hoặc quên chấm công tối đa <strong>03 lần</strong>.
                      <ul>
                        <li>Từ lần 1 – lần 3: Không bị phạt.</li>
                        <li>Từ lần 4 – lần 8 sẽ bị phạt <strong>50.000đ/lần</strong>.</li>
                        <li>Từ lần 9 trở đi sẽ bị phạt <strong>100.000đ/lần</strong>.</li>
                      </ul>
                    </li>
                    <li>Quên chấm vào hoặc chấm ra: chỉ được kiểm tra camera trong khoảng <strong>±5 phút</strong> so với giờ vào/ra để xác nhận (sáng: 7h45 – 7h50; chiều: 16h45 – 16h50). Không thấy sẽ mặc định nghỉ buổi sáng hoặc chiều tương ứng.</li>
                    <li>Quên chấm cả 2 lần (vào và ra): không được tính công ngày đó.</li>
                  </ul>
                </div>

                <div>
                  <h4>Cách tính ngày công khi đi muộn/về sớm</h4>
                  <ul>
                    <li>Đi muộn hoặc về sớm sẽ bị tính vào <strong>03 lần</strong> được trừ trong tháng.</li>
                    <li>Đi muộn hoặc về sớm <strong>≤ 30 phút</strong>: không bị trừ công.</li>
                    <li>Đi muộn hoặc về sớm <strong>&gt; 30 phút</strong>: tính đi muộn và ngày công được tính theo công thức <strong>Ngày công = Số giờ làm việc thực tế trong ngày ÷ 8</strong>.</li>
                    <li>Ví dụ: nhân viên đi muộn 45 phút → thời gian làm việc còn lại 7h15 → số công = 7h15 ÷ 8 ≈ 0.90625 công và bị tính 1 lỗi đi muộn.</li>
                  </ul>
                  <p>Lưu ý: Việc đi muộn, về sớm nhiều lần sẽ ảnh hưởng trực tiếp đến lương, thưởng và xét tăng lương. Ban quản trị sẽ giám sát và xử lý nghiêm minh, không có ngoại lệ.</p>
                </div>$body1$,
    updated_at = now(), updated_by_name = 'Hệ thống (chuyển từ tài liệu dựng sẵn)'
WHERE builtin_key = 'gio-giac' AND kind = 'builtin';

UPDATE hr_rule_documents
SET kind = 'text', builtin_key = NULL, icon_key = 'calendar',
    body = $body2$<p>Nhân viên cần xin phép và được quản lý đồng ý trước khi nghỉ. Thời hạn gửi yêu cầu phụ thuộc vào số ngày nghỉ.</p>

                <div>
                  <h4>Cách xin nghỉ phép</h4>
                  <ul>
                    <li>Nhắn tin xin nghỉ cho bot Telegram: <strong>@nghipheptks_bot</strong> hoặc tạo đơn trên web.</li>
                    <li>Chỉ được tính là đã xin phép khi yêu cầu được gửi qua bot đúng thời hạn quy định bên dưới.</li>
                    <li>Đơn xin nghỉ phải ghi đủ: ngày nghỉ, lý do nghỉ và <strong>bàn giao công việc</strong> (người nhận bàn giao, nội dung bàn giao).</li>
                  </ul>
                </div>

                <div>
                  <h4>Thời hạn đăng ký nghỉ phép</h4>
                  <ul>
                    <li><strong>Tổng buổi nghỉ thực tế ≤ 2:</strong> hạn đăng ký là <strong>hết 23:59:59 của 02 ngày trước ngày nghỉ đầu tiên</strong>.
                      <ul>
                        <li>Ví dụ: nghỉ từ thứ Ba → hạn là hết 23:59:59 Chủ nhật. Hai buổi trên hai ngày khác nhau vẫn áp dụng hạn 02 ngày.</li>
                      </ul>
                    </li>
                    <li><strong>Tổng buổi nghỉ thực tế &gt; 2:</strong> hạn đăng ký là <strong>hết 23:59:59 của 03 ngày trước ngày nghỉ đầu tiên</strong>.
                      <ul>
                        <li>Ví dụ: nghỉ đủ bốn buổi thứ Năm và thứ Sáu → hạn là hết 23:59:59 thứ Hai.</li>
                      </ul>
                    </li>
                    <li>Tính theo ngày lịch và giờ Việt Nam, gồm cuối tuần và ngày lễ. Toàn bộ phút 23:59 nằm trong hạn; từ 00:00 ngày kế tiếp là quá hạn.</li>
                    <li>Gửi trước hạn: <strong>Đúng hạn</strong>. Gửi sau hạn nhưng trước giờ bắt đầu buổi nghỉ đầu tiên theo lịch nhân sự: <strong>Xin muộn</strong>. Gửi từ đúng giờ bắt đầu buổi đầu tiên trở đi: <strong>Vi phạm</strong>. Nếu chưa có lịch làm việc, cần nhờ quản lý cấu hình trước khi gửi.</li>
                    <li>Nhãn thời hạn được lưu khi gửi và tách khỏi trạng thái duyệt. Quản lý có thể duyệt mọi nhãn; chờ duyệt không tự đổi nhãn. Sửa lịch và gửi lại sẽ tính lại nhãn theo thời gian gửi mới, cần duyệt lại và giữ lịch sử cũ.</li>
                  </ul>
                </div>

                <div>
                  <h4>Bàn giao công việc</h4>
                  <ul>
                    <li>Đơn không có thông tin bàn giao chưa được tính là đã xin phép, quản lý có thể từ chối.</li>
                    <li>Nghỉ gấp: bàn giao cho quản lý và người thay thế qua tin nhắn riêng ngay khi có thể.</li>
                    <li>Người nhận bàn giao chịu trách nhiệm xử lý các việc được giao trong thời gian đồng nghiệp nghỉ.</li>
                  </ul>
                </div>

                <div>
                  <h4>Xử lý vi phạm</h4>
                  <ul>
                    <li>Gửi yêu cầu xin nghỉ trễ hạn: phạt <strong>50.000đ/lần</strong>.</li>
                    <li>Tự ý nghỉ không xin phép, hoặc quản lý đã từ chối nhưng vẫn nghỉ: phạt <strong>500.000đ/lần</strong>.</li>
                    <li>Tất cả các khoản phạt này sẽ trừ vào lương cuối tháng đó.</li>
                  </ul>
                  <p>Lưu ý: Ban quản lý sẽ giám sát và xử lý nghiêm minh, không có ngoại lệ.</p>
                </div>$body2$,
    updated_at = now(), updated_by_name = 'Hệ thống (chuyển từ tài liệu dựng sẵn)'
WHERE builtin_key = 'nghi-phep' AND kind = 'builtin';

UPDATE hr_rule_documents
SET kind = 'text', builtin_key = NULL, icon_key = 'gift',
    body = $body3$<p>Đơn vị tính: đồng. Mức phúc lợi tính cho mỗi người, trừ khi có ghi chú khác.</p>

                <div>
                  <h4>I. Các khoản chi theo sự kiện</h4>
                  <table>
                    <thead><tr><th>Khoản mục chi</th><th>Phúc lợi công ty</th><th>Ghi chú</th></tr></thead>
                    <tbody>
                      <tr><td colspan="3"><strong>1. Kết hôn</strong></td></tr>
                      <tr><td>Người lao động kết hôn</td><td>1.000.000</td><td></td></tr>
                      <tr><td>Con người lao động kết hôn</td><td>500.000</td><td></td></tr>
                      <tr><td colspan="3"><strong>2. Sinh nhật người lao động</strong></td></tr>
                      <tr><td>Sinh nhật người lao động</td><td>300.000</td><td></td></tr>
                      <tr><td colspan="3"><strong>3. Chi 08/3</strong></td></tr>
                      <tr><td>Chi 08/3</td><td>300.000</td><td></td></tr>
                      <tr><td>Quà 8/3 nhân viên nữ (tiền hoặc quà)</td><td>200.000</td><td></td></tr>
                      <tr><td>Hoa và đồ ngọt liên hoan tại mỗi khu vực</td><td></td><td>Trung bình chi phí 40-50k/người</td></tr>
                      <tr><td colspan="3"><strong>4. Quà 1/6</strong></td></tr>
                      <tr><td>Con của người lao động dưới 16 tuổi</td><td>100.000</td><td>Tính theo cháu</td></tr>
                      <tr><td colspan="3"><strong>5. Quà trung thu dành cho toàn bộ nhân viên</strong></td></tr>
                      <tr><td>Hộp quà trung thu</td><td></td><td>Hộp quà trung thu do công ty chuẩn bị</td></tr>
                      <tr><td colspan="3"><strong>6. Chi 20/10</strong></td></tr>
                      <tr><td>Chi 20/10</td><td>200.000</td><td></td></tr>
                      <tr><td>Quà 20-10 cho nhân viên nữ</td><td>200.000</td><td></td></tr>
                      <tr><td>Hoa và đồ ngọt liên hoan tại mỗi khu vực</td><td>200.000</td><td>Trung bình chi phí 40-50k/người</td></tr>
                      <tr><td colspan="3"><strong>7. Chi ngày quốc tế đàn ông 19-11</strong></td></tr>
                      <tr><td>Quà nhân viên Nam (tiền hoặc quà)</td><td>200.000</td><td></td></tr>
                      <tr><td>Đồ ngọt liên hoan tại mỗi khu vực</td><td></td><td>Trung bình chi phí 40-50k/người</td></tr>
                      <tr><td colspan="3"><strong>8. Sinh con</strong></td></tr>
                      <tr><td>Thăm người lao động/vợ người lao động sinh con</td><td>1.000.000</td><td></td></tr>
                      <tr><td colspan="3"><strong>9. Thăm ốm</strong></td></tr>
                      <tr><td>Người lao động ốm đau nằm viện 3 ngày trở lên</td><td>500.000</td><td></td></tr>
                      <tr><td>Người lao động điều trị dài ngày tại nhà (7 ngày trở lên)</td><td>500.000</td><td></td></tr>
                      <tr><td>Bố mẹ, con cái, vợ/chồng của NLĐ nằm viện từ 5 ngày trở lên</td><td>500.000</td><td></td></tr>
                      <tr><td colspan="3"><strong>10. Thăm hiếu</strong></td></tr>
                      <tr><td>Phúng viếng bố mẹ, con cái, vợ/chồng của NLĐ - Vòng hoa</td><td>1.000.000</td><td></td></tr>
                      <tr><td>Phúng viếng bố mẹ, con cái, vợ/chồng của NLĐ - Tiền</td><td>1.000.000</td><td></td></tr>
                      <tr><td>Phúng viếng người lao động - Vòng hoa</td><td>1.000.000</td><td></td></tr>
                      <tr><td>Phúng viếng người lao động - Tiền</td><td>2.000.000</td><td></td></tr>
                      <tr><td colspan="3"><strong>11. Hỗ trợ NLĐ tai nạn, mắc bệnh hiểm nghèo, phẫu thuật</strong></td></tr>
                      <tr><td>Hỗ trợ NLĐ tai nạn, mắc bệnh hiểm nghèo, phẫu thuật</td><td>1.000.000</td><td>Công ty chi theo từng trường hợp cụ thể nếu quá nặng</td></tr>
                    </tbody>
                  </table>
                </div>

                <div>
                  <h4>II. Nghỉ mát và sinh nhật công ty</h4>
                  <table>
                    <thead><tr><th>Khoản mục chi</th><th>Phúc lợi công ty</th><th>Ghi chú</th></tr></thead>
                    <tbody>
                      <tr><td colspan="3"><strong>1. Nghỉ mát hàng năm</strong></td></tr>
                      <tr><td>Định mức chi phí đối với NLĐ tham gia cùng công ty</td><td>4.000.000 - 5.000.000</td><td>Tùy vào tình hình thực tế có thể biến động (nhưng không vượt quá 10%)</td></tr>
                      <tr><td>Người lao động ở nhà theo yêu cầu nhiệm vụ công việc công ty</td><td></td><td>Được hưởng bằng 70% giá trị định mức năm đó</td></tr>
                      <tr><td>Người lao động bất khả kháng không thể đi có xác nhận cụ thể (NLĐ ốm nặng, gia đình có hiếu hỉ bố mẹ - con ruột)</td><td></td><td>Được hưởng tối đa 50% giá trị định mức năm đó (tùy vào thời điểm mà công ty đã chi trả các chi phí trước hay chưa)</td></tr>
                      <tr><td>Các trường hợp còn lại không đi</td><td></td><td>Không được hưởng và sẽ đi làm như bình thường (nếu nghỉ làm trong những ngày này coi như nghỉ không lương)</td></tr>
                      <tr><td>Trường hợp nghỉ mát nếu phát sinh chi phí ngoài định mức thì NLĐ sẽ đóng góp thêm phần vượt; con số và lịch trình cụ thể sẽ báo trước cho người lao động tham khảo trước khi có phương án chốt</td><td></td><td></td></tr>
                      <tr><td colspan="3"><strong>2. Sinh nhật công ty</strong></td></tr>
                      <tr><td colspan="3"><strong>2.1. Sinh nhật năm lẻ tại mỗi khu vực</strong></td></tr>
                      <tr><td colspan="3"><strong>2.2. Sinh nhật công ty năm chẵn (5-10-15-20 năm)</strong></td></tr>
                      <tr><td>Thưởng cho người lao động đi làm đủ năm</td><td>500.000</td><td>Mỗi năm tăng thêm được cộng thêm 50.000đ</td></tr>
                      <tr><td>Thưởng cho NLĐ đi làm từ 3 tháng đến dưới 1 năm</td><td>300.000</td><td></td></tr>
                      <tr><td>Thưởng cho NLĐ dưới 3 tháng</td><td>200.000</td><td></td></tr>
                      <tr><td>Tổ chức các hoạt động tiệc, Gala</td><td></td><td>Định mức chi phí tổ chức: chi phí dự kiến khoảng 1.500.000 - 3.000.000đ/người. Cụ thể công ty sẽ tổ chức tùy vào dịp từng mốc</td></tr>
                      <tr><td>Thưởng nhân viên cống hiến, gắn bó</td><td>1.000.000</td><td>Sau 5 năm thì mỗi năm tăng thêm được cộng thêm 100.000đ</td></tr>
                      <tr><td colspan="3"><strong>3. Liên hoan tổng kết quý tại mỗi khu vực (lồng ghép chúc mừng sinh nhật nhân viên trong quý đó)</strong></td></tr>
                      <tr><td>Liên hoan tổng kết quý</td><td></td><td>Mua 01 bánh sinh nhật trị giá 500.000đ. Chi phí tiệc trung bình từ 200-250k/người</td></tr>
                    </tbody>
                  </table>
                </div>

                <div>
                  <h4>III. Thưởng lễ, Tết</h4>
                  <table>
                    <thead><tr><th>Đối tượng</th><th>Lễ 30-4 và 1/5</th><th>Quốc khánh 2-9</th><th>Tết dương lịch</th></tr></thead>
                    <tbody>
                      <tr><td>Ban giám đốc</td><td>1.500.000</td><td>1.200.000</td><td>1.500.000</td></tr>
                      <tr><td>Trưởng khu vực</td><td>1.000.000</td><td>1.000.000</td><td>1.200.000</td></tr>
                      <tr><td>Trưởng phòng</td><td>800.000</td><td>800.000</td><td>1.000.000</td></tr>
                      <tr><td>Phó phòng, phó các bộ phận</td><td>700.000</td><td>700.000</td><td>800.000</td></tr>
                      <tr><td>Người lao động làm việc từ trên 3 năm</td><td>600.000</td><td>600.000</td><td>700.000</td></tr>
                      <tr><td>Người lao động làm việc từ 1-3 năm</td><td>500.000</td><td>500.000</td><td>500.000</td></tr>
                      <tr><td>Người lao động làm việc từ 3 tháng - dưới 1 năm</td><td>300.000</td><td>300.000</td><td>300.000</td></tr>
                      <tr><td>Người lao động làm việc dưới 3 tháng</td><td>200.000</td><td>200.000</td><td>200.000</td></tr>
                    </tbody>
                  </table>
                  <p>Thưởng Tết âm lịch: Ban giám đốc sẽ tính căn cứ trên hiệu suất và thâm niên của người lao động hàng năm.</p>
                </div>$body3$,
    updated_at = now(), updated_by_name = 'Hệ thống (chuyển từ tài liệu dựng sẵn)'
WHERE builtin_key = 'phuc-loi' AND kind = 'builtin';

UPDATE hr_rule_documents
SET kind = 'text', builtin_key = NULL, icon_key = 'box',
    body = $body4$<div>
                  <h4>1. Vấn đề</h4>
                  <ul>
                    <li>Sale treo hàng lâu ảnh hưởng đến việc phòng mua đặt hàng và ảnh hưởng đến tồn kho chung.</li>
                    <li>Sale treo giữ hàng thì Sale khác không có hàng để bán.</li>
                  </ul>
                </div>

                <div>
                  <h4>2. Hướng giải quyết</h4>

                  <h4>2.1. Quy định về đơn treo chờ hàng</h4>
                  <ul>
                    <li>Các đơn treo chờ hàng <strong>bắt buộc phải treo đơn mới</strong> và có ghi chú cụ thể về lịch chờ hàng về.</li>
                    <li>Hàng về đơn kho đã treo quá <strong>3 ngày</strong> (phải note rõ ghi chú về cont nào): không chấp nhận các đơn treo chờ thêm hàng, chờ gom đủ đơn.</li>
                    <li>Đơn treo 3 ngày không đi hàng: Sale <strong>bắt buộc phải xóa đơn</strong>, tránh trường hợp các Sale khác không có hàng đi trong khi hàng trong kho bị tồn đọng lâu.</li>
                  </ul>

                  <h4>2.2. Quy định về đơn treo giữ hàng</h4>
                  <ul>
                    <li>Với các đơn treo giữ hàng, khách muốn dời lịch lấy hàng phải có <strong>xác nhận từ khách hàng</strong> và <strong>lịch đi hàng cụ thể</strong>.</li>
                    <li>Phát hiện trường hợp Sale treo hàng lách luật:
                      <ul>
                        <li>Lần 1: phạt <strong>100.000 đồng</strong>.</li>
                        <li>Lần 2: phạt <strong>500.000 đồng</strong>.</li>
                        <li>Lần 3: công ty sẽ cân nhắc cho nhân sự thôi việc.</li>
                      </ul>
                    </li>
                  </ul>

                  <h4>2.3. Trường hợp cố ý treo đơn cũ</h4>
                  <ul>
                    <li>Sale cố ý treo vào đơn cũ, gây ảnh hưởng đến việc treo hàng của Sale khác: kế toán kiểm tra ra lỗi sẽ bị phạt.</li>
                  </ul>

                  <h4>2.4. Trường hợp khách hẹn lịch lấy hàng lâu hơn dự kiến</h4>
                  <ul>
                    <li>Sale muốn treo đơn giữ hàng cho khách phải báo lại ban lãnh đạo và xin xác nhận cụ thể.</li>
                  </ul>

                  <h4>2.5. Trường hợp Sale muốn đặt hàng về để đáp ứng vòng quay lấy hàng của khách</h4>
                  <ul>
                    <li>Sale phải có <strong>văn bản và cam kết cụ thể</strong> về lịch đi hàng và số lượng hàng đi như Sale đã đặt.</li>
                    <li>Tránh trường hợp Sale đặt quá nhiều hàng về nhưng không có lịch đi hàng cụ thể.</li>
                  </ul>
                </div>

                <div>
                  <h4>Mức xử lý khi treo hàng lách luật</h4>
                  <table>
                    <thead><tr><th>Lần vi phạm</th><th>Mức xử lý</th></tr></thead>
                    <tbody>
                      <tr><td>Lần 1</td><td>Phạt 100.000 đồng</td></tr>
                      <tr><td>Lần 2</td><td>Phạt 500.000 đồng</td></tr>
                      <tr><td>Lần 3</td><td>Công ty cân nhắc cho nhân sự thôi việc</td></tr>
                    </tbody>
                  </table>
                  <p>Lưu ý: Ban quản lý sẽ giám sát và xử lý nghiêm minh, không có ngoại lệ.</p>
                </div>$body4$,
    updated_at = now(), updated_by_name = 'Hệ thống (chuyển từ tài liệu dựng sẵn)'
WHERE builtin_key = 'treo-hang' AND kind = 'builtin';
