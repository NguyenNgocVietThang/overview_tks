// ==========================================
// USER SHEET COLUMNS — anh xa giua user object (localUserStore) va hang/cot
// cua tab "Users" trong Google Sheets. Dung chung boi userRepository.js (doc,
// chi active trong test khi mock sheetsClient.getValues) va localUserStore.js
// (doc/ghi that qua usersSheetsClient.js).
// ==========================================

const USER_COLUMNS = {
  id: 'ID',
  hoTen: 'Họ tên',
  username: 'Tài khoản đăng nhập',
  passwordHash: 'Mật khẩu (bcrypt hash)',
  vaiTro: 'Vai trò',
  coSo: 'Cơ sở phụ trách',
  trangThai: 'Trạng thái tài khoản',
  ngayTao: 'Ngày tạo',
  dangNhapGanNhat: 'Đăng nhập gần nhất',
  email: 'Email',
  soDienThoai: 'Số điện thoại',
  emailKhoiPhuc: 'Email khôi phục',
  sdtKhoiPhuc: 'SĐT khôi phục'
};

function buildColumnIndex(headers) {
  const index = {};
  Object.entries(USER_COLUMNS).forEach(([key, headerName]) => {
    index[key] = headers.findIndex(header => String(header || '').trim() === headerName);
  });
  return index;
}

function cell(row, colIndex) {
  return colIndex >= 0 && colIndex < row.length ? row[colIndex] : undefined;
}

function rowToUser(row, colIndex) {
  return {
    id: String(cell(row, colIndex.id) || ''),
    hoTen: String(cell(row, colIndex.hoTen) || ''),
    username: String(cell(row, colIndex.username) || '').trim(),
    passwordHash: String(cell(row, colIndex.passwordHash) || ''),
    vaiTro: String(cell(row, colIndex.vaiTro) || ''),
    coSo: String(cell(row, colIndex.coSo) || ''),
    trangThai: String(cell(row, colIndex.trangThai) || ''),
    ngayTao: String(cell(row, colIndex.ngayTao) || ''),
    dangNhapGanNhat: String(cell(row, colIndex.dangNhapGanNhat) || ''),
    email: String(cell(row, colIndex.email) || '').trim(),
    soDienThoai: String(cell(row, colIndex.soDienThoai) || '').trim(),
    emailKhoiPhuc: String(cell(row, colIndex.emailKhoiPhuc) || '').trim(),
    sdtKhoiPhuc: String(cell(row, colIndex.sdtKhoiPhuc) || '').trim()
  };
}

/**
 * Map 1 user object thanh mang gia tri theo DUNG thu tu cot hien co tren
 * sheet that (tra theo ten header, khong theo vi tri co dinh) — de khong phu
 * thuoc thu tu cot vat ly va khong ghi de nham cot la (vd cot them sau nay).
 * Cot khong nam trong USER_COLUMNS thi giu nguyen rong.
 */
function userToRow(user, headers) {
  const headerToKey = {};
  Object.entries(USER_COLUMNS).forEach(([key, headerName]) => {
    headerToKey[headerName] = key;
  });
  return headers.map(header => {
    const key = headerToKey[String(header || '').trim()];
    if (!key) return '';
    const value = user[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

module.exports = {
  USER_COLUMNS,
  buildColumnIndex,
  cell,
  rowToUser,
  userToRow
};
