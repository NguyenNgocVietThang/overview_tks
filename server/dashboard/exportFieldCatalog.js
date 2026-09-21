'use strict';
// ==========================================
// TU DIEN TRUONG XUAT EXCEL — ten truong tieng Viet chuan hoa cho 7 nguon
// Postgres cua dashboard: Hang hoa, Hoa don, Dat hang, Tra hang, Khach hang,
// Nha cung cap, Nhap hang (xem dashboardPgReader.js, TABS).
//
// Vi sao co file nay:
//   - Ten cot trong dashboardPgReader.js phai giu nguyen shape cu cua 9 tab
//     Google Sheets (co "ID hoa don", "Ten trang thai API", "Ma NCC", "Giam gia %"
//     ...) vi dashboardData.js tra cuu theo dung cac ten do. Dung nguyen chung
//     lam nhan Excel se lo ten ky thuat/viet tat cho nguoi dung.
//   - Buoc "lay danh sach truong" cua modal xuat Excel chi can nhan + chu thich,
//     khong can doc du lieu. Day la bang TINH, tra ve tuc thi, khong query DB
//     va khong nap tab nao.
//
// Quy uoc nhan (exportFieldCatalog.test.js canh giu tung dieu):
//   1. Tieng Viet co dau, tu nhien nhu giao dien KiotViet; khong ten bien tieng
//      Anh/snake_case cua Postgres.
//   2. Khong viet tat (Khach hang, Nha cung cap, So luong...). Ngoai le: "COD"
//      va "(%)".
//   3. Ma ky thuat: "ID ..." -> "Ma noi bo ..."; "Ten trang thai API" ->
//      "Trang thai goc tu KiotViet"; "Ma trang thai" -> "Ma trang thai (so)".
//   4. Cung khai niem -> cung mot nhan o moi nguon; khac khai niem -> nhan khac
//      nhau trong cung nguon. Nhan duy nhat trong tung nguon.
//   5. Phan tram luu dang 10 nghia la 10% (KHONG chia 100) nen type = number,
//      nhan co "(%)"; type 'percent' chi danh cho gia tri thuc su la phan so 0..1.
//
// Moi truong: { key, sheetHeader, label, type, description, selected }
//   key         alias cot trong TABS[i].columns cua dashboardPgReader.js
//   sheetHeader dung chuoi trong TABS[i].headers (cung vi tri) — test doi chieu
//   label       nhan cot Excel chuan hoa (<= 40 ky tu)
//   type        text | number | date | percent | general (nhu inferColumnType)
//   description chu thich ngan (<= 90 ky tu): y nghia / nguon / cach tinh
//   selected    mac dinh chon san (true cho moi truong, giu hanh vi hien tai)
// Cot do dashboard tinh them (derived) KHONG thuoc catalogue nay.
// ==========================================
const CONFIG = require('../config');

function field(key, sheetHeader, label, type, description) {
  return { key, sheetHeader, label, type, description, selected: true };
}

// ---------- Hang hoa ----------
const PRODUCT_FIELDS = [
  field('ma_hang', 'Mã hàng', 'Mã hàng', 'text',
    'Mã hàng hiển thị trên KiotViet, dùng để tra cứu và ghép với hóa đơn, phiếu nhập.'),
  field('ten_hang', 'Tên hàng', 'Tên hàng', 'general',
    'Tên đầy đủ của hàng (kèm thuộc tính nếu có); thiếu thì lấy tên gốc.'),
  field('nhom_hang', 'Nhóm hàng', 'Nhóm hàng', 'general',
    'Tên nhóm hàng mà mặt hàng thuộc về theo phân loại trên KiotViet.'),
  field('loai_hang', 'Loại hàng', 'Loại hàng', 'general',
    'Hàng hóa, Combo hoặc Dịch vụ, suy ra từ mã số loại hàng của KiotViet.'),
  field('gia_von', 'Giá vốn', 'Giá vốn', 'number',
    'Giá vốn của hàng (VNĐ) theo KiotViet; hàng có nhiều kho thì lấy trung bình.'),
  field('gia_ban', 'Giá bán', 'Giá bán', 'number',
    'Giá bán niêm yết cơ bản của hàng (VNĐ), chưa áp dụng bảng giá riêng.'),
  field('ton_kho', 'Tồn kho', 'Tồn kho', 'number',
    'Tổng số lượng tồn kho thực tế của hàng, cộng dồn các kho trên KiotViet.'),
  field('khach_dat', 'Khách đặt', 'Số lượng khách đặt', 'number',
    'Số lượng khách đã đặt nhưng chưa xuất bán, đang được giữ chỗ trong kho.'),
  field('trang_thai', 'Trạng thái', 'Trạng thái kinh doanh', 'general',
    'Đang kinh doanh hoặc Ngừng kinh doanh; thiếu dữ liệu thì coi là Đang kinh doanh.'),
  field('ngay_sua_cuoi', 'Ngày sửa cuối', 'Ngày sửa hoặc tạo gần nhất', 'date',
    'Lần sửa gần nhất của hàng; chưa từng sửa thì lấy ngày tạo (khác Ngày cập nhật).'),
  field('ma_nhom_hang', 'Mã nhóm hàng', 'Mã nội bộ nhóm hàng', 'text',
    'Số định danh nhóm hàng do KiotViet cấp (khác tên nhóm); dùng để ghép với nhóm hàng.'),
  field('vi_tri', 'Vị trí', 'Vị trí', 'general',
    'Vị trí kệ để hàng trong kho hoặc cửa hàng; nhiều vị trí cách nhau bằng dấu phẩy.'),
  field('id_hang_hoa', 'ID hàng hóa', 'Mã nội bộ hàng hóa', 'text',
    'Số định danh hàng hóa do KiotViet cấp, khác với Mã hàng hiển thị.'),
  field('id_gian_hang', 'ID gian hàng', 'Mã nội bộ gian hàng', 'text',
    'Số định danh gian hàng do KiotViet cấp, khác tên gian hàng; cả cơ sở dùng chung một số.'),
  field('duoc_phep_ban', 'Được phép bán', 'Được phép bán', 'general',
    'Có nếu hàng được phép bán, Không nếu bị chặn bán; trống nếu KiotViet không trả về.'),
  field('ten_goc', 'Tên gốc', 'Tên gốc', 'general',
    'Tên hàng gốc trong dữ liệu KiotViet, không kèm thuộc tính như màu sắc, kích cỡ.'),
  field('mo_ta', 'Mô tả', 'Mô tả', 'general',
    'Mô tả thêm về hàng do nhân viên nhập trên KiotViet.'),
  field('gia_tri_quy_doi', 'Giá trị quy đổi', 'Giá trị quy đổi', 'number',
    'Hệ số quy đổi sang đơn vị cơ bản (ví dụ 1 thùng = 24 chai thì giá trị là 24).'),
  field('co_thuoc_tinh', 'Có thuộc tính', 'Có thuộc tính', 'general',
    'Có nếu hàng có thuộc tính/biến thể (ví dụ màu, kích cỡ), Không nếu là hàng đơn.'),
  field('dang_hoat_dong', 'Đang hoạt động', 'Đang hoạt động', 'general',
    'Cờ hoạt động nguyên gốc của KiotViet (Có/Không); trống nếu KiotViet không trả về.'),
  field('ngay_tao', 'Ngày tạo', 'Ngày tạo', 'date',
    'Ngày giờ hàng được tạo trên KiotViet.'),
  field('ngay_cap_nhat', 'Ngày cập nhật', 'Ngày cập nhật', 'date',
    'Ngày giờ KiotViet cập nhật hàng lần cuối; trống nếu chưa từng cập nhật.'),
  field('ma_loai_hang', 'Mã loại hàng', 'Mã loại hàng (số)', 'text',
    'Mã số loại hàng của KiotViet (1 = Combo, 3 = Dịch vụ), khác chữ ở cột Loại hàng.')
];

// ---------- Hoa don ----------
const INVOICE_FIELDS = [
  field('ma_hoa_don', 'Mã hóa đơn', 'Mã hóa đơn', 'text',
    'Mã hóa đơn bán hàng hiển thị trên KiotViet; mỗi hóa đơn có một mã duy nhất.'),
  field('ngay_ban', 'Ngày bán', 'Ngày bán', 'date',
    'Ngày giờ bán hàng ghi trên hóa đơn (giờ Việt Nam).'),
  field('khach_hang', 'Khách hàng', 'Khách hàng', 'general',
    'Tên khách hàng ghi trên hóa đơn; không có thông tin khách thì hiện Khách lẻ.'),
  field('sdt_khach', 'SĐT khách', 'Điện thoại khách hàng', 'text',
    'Số điện thoại khách; KiotViet không trả trên hóa đơn nên hiện luôn để trống.'),
  field('nhan_vien_ban', 'Nhân viên bán', 'Nhân viên bán', 'general',
    'Tên nhân viên bán hóa đơn; thiếu thì lấy theo danh sách nhân viên đã đồng bộ.'),
  field('chi_nhanh', 'Chi nhánh', 'Chi nhánh', 'general',
    'Tên chi nhánh KiotViet nơi phát sinh hóa đơn.'),
  field('tong_tien_hang', 'Tổng tiền hàng', 'Tổng tiền hàng', 'number',
    'Tổng tiền hàng của hóa đơn (VNĐ) theo KiotViet, chưa trừ số tiền khách đã trả.'),
  field('giam_gia', 'Giảm giá', 'Giảm giá', 'number',
    'Số tiền giảm giá áp dụng cho cả hóa đơn (VNĐ).'),
  field('khach_da_tra', 'Khách đã trả', 'Khách đã trả', 'number',
    'Số tiền khách đã thanh toán cho hóa đơn (VNĐ).'),
  field('trang_thai', 'Trạng thái', 'Trạng thái', 'general',
    'Trạng thái hóa đơn, ưu tiên chữ gốc của KiotViet; thiếu thì suy ra từ mã số trạng thái.'),
  field('id_hoa_don', 'ID hóa đơn', 'Mã nội bộ hóa đơn', 'text',
    'Số định danh hóa đơn do KiotViet cấp, khác với Mã hóa đơn hiển thị.'),
  field('ma_dat_hang', 'Mã đặt hàng', 'Mã đặt hàng', 'text',
    'Mã đơn đặt hàng mà hóa đơn được tạo từ đó; trống nếu bán trực tiếp.'),
  field('id_chi_nhanh', 'ID chi nhánh', 'Mã nội bộ chi nhánh', 'text',
    'Số định danh chi nhánh do KiotViet cấp, khác với tên chi nhánh.'),
  field('id_nhan_vien_ban', 'ID nhân viên bán', 'Mã nội bộ nhân viên bán', 'text',
    'Số định danh nhân viên bán do KiotViet cấp, khác với tên nhân viên.'),
  field('id_khach_hang', 'ID khách hàng', 'Mã nội bộ khách hàng', 'text',
    'Số định danh khách hàng do KiotViet cấp, khác với Mã khách hàng hiển thị.'),
  field('ma_khach_hang', 'Mã khách hàng', 'Mã khách hàng', 'text',
    'Mã khách hàng hiển thị trên KiotViet; trống với khách lẻ.'),
  field('ma_trang_thai', 'Mã trạng thái', 'Mã trạng thái (số)', 'text',
    'Mã số trạng thái thô của KiotViet; ý nghĩa đổi theo loại phiếu nên xem cột Trạng thái.'),
  field('ten_trang_thai_api', 'Tên trạng thái API', 'Trạng thái gốc từ KiotViet', 'general',
    'Chữ trạng thái nguyên văn KiotViet trả về, không suy diễn; trống nếu không có.'),
  field('ghi_chu', 'Ghi chú', 'Ghi chú', 'general',
    'Ghi chú do nhân viên nhập trên hóa đơn.'),
  field('thu_ho_cod', 'Thu hộ COD', 'Thu hộ (COD)', 'general',
    'Có nếu hóa đơn giao hàng và thu hộ tiền (COD), Không nếu không dùng.'),
  field('ngay_tao', 'Ngày tạo', 'Ngày tạo', 'date',
    'Ngày giờ hóa đơn được tạo trên KiotViet, có thể khác Ngày bán.')
];

// ---------- Dat hang ----------
const ORDER_FIELDS = [
  field('ma_dat_hang', 'Mã đặt hàng', 'Mã đặt hàng', 'text',
    'Mã đơn đặt hàng hiển thị trên KiotViet; mỗi đơn có một mã duy nhất.'),
  field('ngay_dat', 'Ngày đặt', 'Ngày đặt hàng', 'date',
    'Ngày giờ khách đặt hàng ghi trên đơn (giờ Việt Nam).'),
  field('khach_hang', 'Khách hàng', 'Khách hàng', 'general',
    'Tên khách hàng ghi trên đơn đặt hàng; không có thông tin khách thì hiện Khách lẻ.'),
  field('nhan_vien_lap', 'Nhân viên lập', 'Nhân viên bán', 'general',
    'Tên nhân viên bán (người lập) của đơn đặt hàng, theo KiotViet.'),
  field('chi_nhanh', 'Chi nhánh', 'Chi nhánh', 'general',
    'Tên chi nhánh KiotViet nhận đơn đặt hàng.'),
  field('tong_tien', 'Tổng tiền', 'Tổng tiền hàng', 'number',
    'Tổng tiền hàng của đơn đặt hàng (VNĐ) theo KiotViet.'),
  field('trang_thai', 'Trạng thái', 'Trạng thái', 'general',
    'Trạng thái đơn (Phiếu tạm, Hoàn thành, Đã hủy...): ưu tiên chữ gốc KiotViet.'),
  field('id_dat_hang', 'ID đặt hàng', 'Mã nội bộ đặt hàng', 'text',
    'Số định danh đơn đặt hàng do KiotViet cấp, khác với Mã đặt hàng hiển thị.'),
  field('id_gian_hang', 'ID gian hàng', 'Mã nội bộ gian hàng', 'text',
    'Số định danh gian hàng do KiotViet cấp, khác tên gian hàng; cả cơ sở dùng chung một số.'),
  field('id_chi_nhanh', 'ID chi nhánh', 'Mã nội bộ chi nhánh', 'text',
    'Số định danh chi nhánh do KiotViet cấp, khác với tên chi nhánh.'),
  field('id_nhan_vien_lap', 'ID nhân viên lập', 'Mã nội bộ nhân viên bán', 'text',
    'Số định danh nhân viên bán đơn do KiotViet cấp, khác với tên nhân viên.'),
  field('id_khach_hang', 'ID khách hàng', 'Mã nội bộ khách hàng', 'text',
    'Số định danh khách hàng do KiotViet cấp, khác với Mã khách hàng hiển thị.'),
  field('ma_khach_hang', 'Mã khách hàng', 'Mã khách hàng', 'text',
    'Mã khách hàng hiển thị trên KiotViet; trống với khách lẻ.'),
  field('khach_da_tra', 'Khách đã trả', 'Khách đã trả', 'number',
    'Số tiền khách đã thanh toán (đặt cọc) trên đơn đặt hàng (VNĐ).'),
  field('giam_gia_pct', 'Giảm giá (%)', 'Giảm giá (%)', 'number',
    'Tỷ lệ giảm giá của cả đơn theo phần trăm, ví dụ 10 nghĩa là giảm 10%.'),
  field('giam_gia', 'Giảm giá', 'Giảm giá', 'number',
    'Số tiền giảm giá áp dụng cho cả đơn đặt hàng (VNĐ).'),
  field('ma_trang_thai', 'Mã trạng thái', 'Mã trạng thái (số)', 'text',
    'Mã số trạng thái thô của KiotViet; ý nghĩa đổi theo loại phiếu nên xem cột Trạng thái.'),
  field('ten_trang_thai_api', 'Tên trạng thái API', 'Trạng thái gốc từ KiotViet', 'general',
    'Chữ trạng thái nguyên văn KiotViet trả về, không suy diễn; trống nếu không có.'),
  field('ghi_chu', 'Ghi chú', 'Ghi chú', 'general',
    'Ghi chú do nhân viên nhập trên đơn đặt hàng.'),
  field('thu_ho_cod', 'Thu hộ COD', 'Thu hộ (COD)', 'general',
    'Có nếu đơn giao hàng và thu hộ tiền (COD), Không nếu không dùng.'),
  field('ngay_tao', 'Ngày tạo', 'Ngày tạo', 'date',
    'Ngày giờ đơn đặt hàng được tạo trên KiotViet, có thể khác Ngày đặt hàng.'),
  field('ngay_cap_nhat', 'Ngày cập nhật', 'Ngày cập nhật', 'date',
    'Ngày giờ KiotViet cập nhật đơn đặt hàng lần cuối; trống nếu chưa từng cập nhật.')
];

// ---------- Tra hang ----------
const RETURN_FIELDS = [
  field('ma_tra_hang', 'Mã trả hàng', 'Mã trả hàng', 'text',
    'Mã phiếu trả hàng hiển thị trên KiotViet; mỗi phiếu có một mã duy nhất.'),
  field('ngay_tra', 'Ngày trả', 'Ngày trả hàng', 'date',
    'Ngày giờ khách trả hàng ghi trên phiếu (giờ Việt Nam).'),
  field('khach_hang', 'Khách hàng', 'Khách hàng', 'general',
    'Tên khách trả hàng ghi trên phiếu; không có thông tin khách thì hiện Khách lẻ.'),
  field('tong_tien_tra', 'Tổng tiền trả', 'Tổng tiền hàng trả', 'number',
    'Tổng giá trị hàng khách trả lại (VNĐ); xem thêm Giảm giá trả hàng và Phí trả hàng.'),
  field('trang_thai', 'Trạng thái', 'Trạng thái', 'general',
    'Trạng thái phiếu trả (Đã trả, Đã hủy...): ưu tiên chữ gốc KiotViet.'),
  field('id_tra_hang', 'ID trả hàng', 'Mã nội bộ trả hàng', 'text',
    'Số định danh phiếu trả hàng do KiotViet cấp, khác với Mã trả hàng hiển thị.'),
  field('id_hoa_don_goc', 'ID hóa đơn gốc', 'Mã nội bộ hóa đơn gốc', 'text',
    'Số định danh hóa đơn bị trả do KiotViet cấp, khác với Mã hóa đơn hiển thị.'),
  field('id_chi_nhanh', 'ID chi nhánh', 'Mã nội bộ chi nhánh', 'text',
    'Số định danh chi nhánh do KiotViet cấp, khác với tên chi nhánh.'),
  field('chi_nhanh', 'Chi nhánh', 'Chi nhánh', 'general',
    'Tên chi nhánh KiotViet nhận trả hàng.'),
  field('id_nguoi_nhan_tra', 'ID người nhận trả', 'Mã nội bộ người nhận trả', 'text',
    'Số định danh nhân viên nhận hàng trả do KiotViet cấp, khác với tên nhân viên.'),
  field('nhan_vien_ban', 'Nhân viên bán', 'Nhân viên bán', 'general',
    'Tên nhân viên bán ghi trên phiếu trả hàng theo KiotViet.'),
  field('id_khach_hang', 'ID khách hàng', 'Mã nội bộ khách hàng', 'text',
    'Số định danh khách hàng do KiotViet cấp, khác với Mã khách hàng hiển thị.'),
  field('ma_khach_hang', 'Mã khách hàng', 'Mã khách hàng', 'text',
    'Mã khách hàng hiển thị trên KiotViet; trống với khách lẻ.'),
  field('giam_gia_tra_hang', 'Giảm giá trả hàng', 'Giảm giá trả hàng', 'number',
    'Số tiền giảm giá áp dụng cho phiếu trả hàng (VNĐ).'),
  field('phi_tra_hang', 'Phí trả hàng', 'Phí trả hàng', 'number',
    'Phí trả hàng cửa hàng thu của khách (VNĐ).'),
  field('tong_thanh_toan', 'Tổng thanh toán', 'Đã trả khách', 'number',
    'Số tiền cửa hàng đã hoàn trả cho khách trên phiếu trả hàng (VNĐ) theo KiotViet.'),
  field('ma_trang_thai', 'Mã trạng thái', 'Mã trạng thái (số)', 'text',
    'Mã số trạng thái thô của KiotViet; ý nghĩa đổi theo loại phiếu nên xem cột Trạng thái.'),
  field('ten_trang_thai_api', 'Tên trạng thái API', 'Trạng thái gốc từ KiotViet', 'general',
    'Chữ trạng thái nguyên văn KiotViet trả về, không suy diễn; trống nếu không có.'),
  field('ngay_tao', 'Ngày tạo', 'Ngày tạo', 'date',
    'Ngày giờ phiếu trả hàng được tạo trên KiotViet, có thể khác Ngày trả hàng.'),
  field('ngay_cap_nhat', 'Ngày cập nhật', 'Ngày cập nhật', 'date',
    'Ngày giờ KiotViet cập nhật phiếu trả hàng lần cuối; trống nếu chưa từng cập nhật.')
];

// ---------- Khach hang ----------
const CUSTOMER_FIELDS = [
  field('ma_khach_hang', 'Mã khách hàng', 'Mã khách hàng', 'text',
    'Mã khách hàng hiển thị trên KiotViet, dùng để tra cứu và ghép với chứng từ.'),
  field('ten_khach_hang', 'Tên khách hàng', 'Tên khách hàng', 'general',
    'Tên khách hàng trên KiotViet.'),
  field('dien_thoai', 'Điện thoại', 'Điện thoại', 'text',
    'Số điện thoại chính của khách; lưu dạng chữ để giữ số 0 đầu.'),
  field('nhom_khach_hang', 'Nhóm khách hàng', 'Nhóm khách hàng', 'general',
    'Nhóm khách hàng; hiện luôn để trống vì dữ liệu đồng bộ chưa lưu nhóm khách.'),
  field('dia_chi', 'Địa chỉ', 'Địa chỉ', 'general',
    'Địa chỉ liên hệ của khách.'),
  field('no_hien_tai', 'Nợ hiện tại', 'Nợ hiện tại', 'number',
    'Số tiền khách còn nợ cửa hàng tại thời điểm đồng bộ (VNĐ).'),
  field('tong_ban', 'Tổng bán', 'Tổng bán', 'number',
    'Tổng giá trị đã bán cho khách do KiotViet tính sẵn (VNĐ).'),
  field('id_khach_hang', 'ID khách hàng', 'Mã nội bộ khách hàng', 'text',
    'Số định danh khách hàng do KiotViet cấp, khác với Mã khách hàng hiển thị.'),
  field('dien_thoai_phu', 'Điện thoại phụ', 'Điện thoại phụ', 'text',
    'Số điện thoại phụ của khách (nếu có); lưu dạng chữ để giữ số 0 đầu.'),
  field('cong_ty', 'Công ty', 'Công ty', 'general',
    'Tên công ty hoặc tổ chức của khách (nếu có).'),
  field('tong_doanh_thu', 'Tổng doanh thu', 'Tổng doanh thu', 'number',
    'Doanh thu lũy kế của khách do KiotViet tính sẵn (VNĐ), không tính lại từ hóa đơn.'),
  field('id_gian_hang', 'ID gian hàng', 'Mã nội bộ gian hàng', 'text',
    'Số định danh gian hàng do KiotViet cấp, khác tên gian hàng; cả cơ sở dùng chung một số.'),
  field('ngay_tao', 'Ngày tạo', 'Ngày tạo', 'date',
    'Ngày giờ khách hàng được tạo trên KiotViet.')
];

// ---------- Nha cung cap ----------
const SUPPLIER_FIELDS = [
  field('ma_ncc', 'Mã NCC', 'Mã nhà cung cấp', 'text',
    'Mã nhà cung cấp hiển thị trên KiotViet, dùng để tra cứu và ghép với phiếu nhập.'),
  field('ten_ncc', 'Tên NCC', 'Tên nhà cung cấp', 'general',
    'Tên nhà cung cấp trên KiotViet.'),
  field('dien_thoai', 'Điện thoại', 'Điện thoại', 'text',
    'Số điện thoại nhà cung cấp; lưu dạng chữ để giữ số 0 đầu.'),
  field('dia_chi', 'Địa chỉ', 'Địa chỉ', 'general',
    'Địa chỉ nhà cung cấp.'),
  field('no_can_tra', 'Nợ cần trả', 'Nợ cần trả hiện tại', 'number',
    'Số tiền cửa hàng còn nợ nhà cung cấp tại thời điểm đồng bộ (VNĐ).'),
  field('id_nha_cung_cap', 'ID nhà cung cấp', 'Mã nội bộ nhà cung cấp', 'text',
    'Số định danh nhà cung cấp do KiotViet cấp, khác với Mã nhà cung cấp hiển thị.'),
  field('trang_thai_hoat_dong', 'Trạng thái hoạt động', 'Đang hoạt động', 'general',
    'Có nếu nhà cung cấp còn hoạt động, Không nếu đã ngừng; trống nếu KiotViet không trả về.'),
  field('ngay_cap_nhat', 'Ngày cập nhật', 'Ngày cập nhật', 'date',
    'Ngày giờ KiotViet cập nhật nhà cung cấp lần cuối; trống nếu chưa từng cập nhật.'),
  field('ngay_tao', 'Ngày tạo', 'Ngày tạo', 'date',
    'Ngày giờ nhà cung cấp được tạo trên KiotViet.'),
  field('id_gian_hang', 'ID gian hàng', 'Mã nội bộ gian hàng', 'text',
    'Số định danh gian hàng do KiotViet cấp, khác tên gian hàng; cả cơ sở dùng chung một số.'),
  field('id_chi_nhanh_tao', 'ID chi nhánh tạo', 'Mã nội bộ chi nhánh tạo', 'text',
    'Số định danh chi nhánh tạo nhà cung cấp do KiotViet cấp, khác với tên chi nhánh.'),
  field('nguoi_tao', 'Người tạo', 'Người tạo', 'general',
    'Người tạo nhà cung cấp, nguyên văn như KiotViet trả về.'),
  field('tong_mua', 'Tổng mua', 'Tổng mua', 'number',
    'Tổng giá trị đã mua từ nhà cung cấp do KiotViet tính sẵn (VNĐ).'),
  field('tong_mua_tru_tra_hang', 'Tổng mua trừ trả hàng', 'Tổng mua trừ trả hàng', 'number',
    'Tổng mua đã trừ giá trị hàng trả lại nhà cung cấp, do KiotViet tính sẵn (VNĐ).')
];

// ---------- Nhap hang ----------
// Sheet "Nhap hang" la dang "flatten": moi dong = 1 mat hang, thong tin phieu
// nhap lap lai tren tung dong. 16 truong dau la cap PHIEU (dung cho worksheet
// "Tong hop phieu"), 8 truong sau la cap DONG HANG; ca 24 truong dung cho
// worksheet "Chi tiet mat hang". Nhan phai duy nhat giua hai phan nay.
const PURCHASE_HEADER_FIELDS = [
  field('chi_nhanh', 'Chi nhánh', 'Chi nhánh', 'general',
    'Tên chi nhánh KiotViet lập phiếu nhập.'),
  field('ma_nhap_hang', 'Mã nhập hàng', 'Mã nhập hàng', 'text',
    'Mã phiếu nhập hàng hiển thị trên KiotViet; một phiếu có thể có nhiều dòng hàng.'),
  field('thoi_gian', 'Thời gian', 'Ngày nhập hàng', 'date',
    'Ngày giờ nhập hàng ghi trên phiếu nhập (giờ Việt Nam).'),
  field('thoi_gian_tao', 'Thời gian tạo', 'Ngày tạo', 'date',
    'Ngày giờ phiếu nhập được tạo trên KiotViet, có thể khác Ngày nhập hàng.'),
  field('ma_nha_cung_cap', 'Mã nhà cung cấp', 'Mã nhà cung cấp', 'text',
    'Mã nhà cung cấp của phiếu nhập; thiếu thì lấy từ danh sách nhà cung cấp.'),
  field('ten_nha_cung_cap', 'Tên nhà cung cấp', 'Tên nhà cung cấp', 'general',
    'Tên nhà cung cấp của phiếu nhập; thiếu thì lấy từ danh sách nhà cung cấp.'),
  field('nguoi_nhap', 'Người nhập', 'Người nhập', 'general',
    'Tên nhân viên thực hiện nhập hàng trên phiếu.'),
  field('nguoi_tao', 'Người tạo', 'Người tạo', 'general',
    'Tên người tạo phiếu nhập; thiếu thì lấy theo Người nhập.'),
  field('tong_tien_hang', 'Tổng tiền hàng', 'Tổng tiền hàng', 'number',
    'Tổng tiền hàng của cả phiếu nhập (VNĐ) theo KiotViet.'),
  field('giam_gia_phieu_nhap', 'Giảm giá phiếu nhập', 'Giảm giá phiếu nhập', 'number',
    'Số tiền giảm giá áp dụng cho cả phiếu nhập (VNĐ).'),
  field('can_tra_ncc', 'Cần trả NCC', 'Cần trả nhà cung cấp', 'number',
    'Số tiền phiếu nhập còn phải trả nhà cung cấp (VNĐ); thiếu thì lấy tổng tiền trừ đã trả.'),
  field('tien_da_tra_ncc', 'Tiền đã trả NCC', 'Tiền đã trả nhà cung cấp', 'number',
    'Số tiền đã trả nhà cung cấp cho phiếu nhập (VNĐ).'),
  field('ghi_chu', 'Ghi chú', 'Ghi chú', 'general',
    'Ghi chú do nhân viên nhập trên phiếu nhập.'),
  field('tong_so_luong', 'Tổng số lượng', 'Tổng số lượng', 'number',
    'Tổng số lượng hàng của cả phiếu nhập, cộng từ các dòng hàng.'),
  field('tong_so_mat_hang', 'Tổng số mặt hàng', 'Tổng số mặt hàng', 'number',
    'Số dòng mặt hàng của phiếu nhập.'),
  field('trang_thai', 'Trạng thái', 'Trạng thái', 'general',
    'Trạng thái phiếu nhập theo chữ gốc của KiotViet; thiếu thì hiện mã số trạng thái.')
];

const PURCHASE_LINE_FIELDS = [
  field('ma_hang', 'Mã hàng', 'Mã hàng', 'text',
    'Mã hàng của dòng hàng trong phiếu nhập; thiếu thì lấy từ danh mục hàng hóa.'),
  field('ten_hang', 'Tên hàng', 'Tên hàng', 'general',
    'Tên hàng của dòng hàng trong phiếu nhập; thiếu thì lấy từ danh mục hàng hóa.'),
  field('don_gia', 'Đơn giá', 'Đơn giá', 'number',
    'Giá nhập trên một đơn vị hàng của dòng (VNĐ), trước giảm giá dòng hàng.'),
  field('giam_gia_pct', 'Giảm giá %', 'Giảm giá (%)', 'number',
    'Tỷ lệ giảm giá của dòng hàng theo phần trăm, ví dụ 10 nghĩa là giảm 10%.'),
  field('giam_gia', 'Giảm giá', 'Giảm giá dòng hàng', 'number',
    'Số tiền giảm giá của riêng dòng hàng (VNĐ), khác giảm giá của cả phiếu nhập.'),
  field('gia_nhap', 'Giá nhập', 'Giá nhập', 'number',
    'Giá nhập của mặt hàng (VNĐ); hiện cùng giá trị với Đơn giá của dòng hàng.'),
  field('thanh_tien', 'Thành tiền', 'Thành tiền', 'number',
    'Thành tiền dòng hàng (VNĐ) theo KiotViet; thiếu thì tính đơn giá x số lượng - giảm giá.'),
  field('so_luong', 'Số lượng', 'Số lượng', 'number',
    'Số lượng hàng nhập của dòng hàng.')
];

// sourceKey <-> sheetName <-> codeKey (cot ma dung loc/ghep du lieu cua nguon).
const SOURCE_DEFINITIONS = [
  { key: 'products', sheetName: CONFIG.SHEET_PRODUCTS, codeKey: 'ma_hang', fields: PRODUCT_FIELDS },
  { key: 'invoices', sheetName: CONFIG.SHEET_INVOICES, codeKey: 'ma_hoa_don', fields: INVOICE_FIELDS },
  { key: 'orders', sheetName: CONFIG.SHEET_ORDERS, codeKey: 'ma_dat_hang', fields: ORDER_FIELDS },
  { key: 'returns', sheetName: CONFIG.SHEET_RETURNS, codeKey: 'ma_tra_hang', fields: RETURN_FIELDS },
  { key: 'customers', sheetName: CONFIG.SHEET_CUSTOMERS, codeKey: 'ma_khach_hang', fields: CUSTOMER_FIELDS },
  { key: 'suppliers', sheetName: CONFIG.SHEET_SUPPLIERS, codeKey: 'ma_ncc', fields: SUPPLIER_FIELDS },
  {
    key: 'purchases',
    sheetName: CONFIG.SHEET_PURCHASES,
    codeKey: 'ma_nhap_hang',
    fields: [...PURCHASE_HEADER_FIELDS, ...PURCHASE_LINE_FIELDS]
  }
];

// Cac truong cap PHIEU cua nguon purchases (16 cot dau, truoc "Mã hàng") — dung
// cho worksheet "Tổng hợp phiếu"; worksheet "Chi tiết mặt hàng" dung ca 24 truong.
const PURCHASE_SUMMARY_KEYS = PURCHASE_HEADER_FIELDS.map(item => item.key);

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const SOURCES = deepFreeze(SOURCE_DEFINITIONS);
const SOURCE_KEYS = Object.freeze(SOURCES.map(source => source.key));
const SOURCE_BY_KEY = new Map(SOURCES.map(source => [source.key, source]));
const SOURCE_BY_SHEET_NAME = new Map(SOURCES.map(source => [source.sheetName, source]));

function normalizeHeader(header) {
  return String(header === undefined || header === null ? '' : header).normalize('NFC').trim();
}

// sheetName -> (header da chuan hoa NFC/trim -> nhan Excel), dung cho ket qua tim kiem.
const LABEL_BY_SHEET_HEADER = new Map(SOURCES.map(source => [
  source.sheetName,
  new Map(source.fields.map(item => [normalizeHeader(item.sheetHeader), item.label]))
]));

/** Nguon theo sourceKey; khong co -> null. */
function getSource(sourceKey) {
  return SOURCE_BY_KEY.get(sourceKey) || null;
}

/** Danh sach truong cua nguon (frozen, dung thu tu cot cua tab); khong co nguon -> []. */
function getSourceFields(sourceKey) {
  const source = getSource(sourceKey);
  return source ? source.fields : Object.freeze([]);
}

/** Nguon theo ten sheet (CONFIG.SHEET_*); khong co -> null. */
function getSourceBySheetName(sheetName) {
  return SOURCE_BY_SHEET_NAME.get(sheetName) || null;
}

/**
 * Nhan Excel chuan hoa cho 1 header cua sheet. Header khong thuoc sheet (hoac
 * sheet nam ngoai catalogue) tra ve NGUYEN header goc — dung cho ket qua tim
 * kiem, noi header co the den tu nhieu sheet khac nhau.
 */
function labelForSheetHeader(sheetName, header) {
  const labels = LABEL_BY_SHEET_HEADER.get(sheetName);
  if (!labels) return header;
  const label = labels.get(normalizeHeader(header));
  return label === undefined ? header : label;
}

module.exports = {
  SOURCE_KEYS,
  PURCHASE_SUMMARY_KEYS: Object.freeze(PURCHASE_SUMMARY_KEYS),
  getSource,
  getSourceFields,
  getSourceBySheetName,
  labelForSheetHeader
};
