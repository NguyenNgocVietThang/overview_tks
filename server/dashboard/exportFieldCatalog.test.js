'use strict';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
// Test chi doc du lieu tinh + header cua pg reader, tuyet doi khong cham DB that.
process.env.SUPABASE_DB_URL = '';

const test = require('node:test');
const assert = require('node:assert/strict');
const CONFIG = require('../config');
const catalog = require('./exportFieldCatalog');
const { __headers__ } = require('./dashboardPgReader');

const { SOURCE_KEYS, PURCHASE_SUMMARY_KEYS, getSource, getSourceFields, getSourceBySheetName, labelForSheetHeader } = catalog;

const EXPECTED_SOURCES = [
  { key: 'products', sheetName: CONFIG.SHEET_PRODUCTS, codeKey: 'ma_hang', codeLabel: 'Mã hàng' },
  { key: 'invoices', sheetName: CONFIG.SHEET_INVOICES, codeKey: 'ma_hoa_don', codeLabel: 'Mã hóa đơn' },
  { key: 'orders', sheetName: CONFIG.SHEET_ORDERS, codeKey: 'ma_dat_hang', codeLabel: 'Mã đặt hàng' },
  { key: 'returns', sheetName: CONFIG.SHEET_RETURNS, codeKey: 'ma_tra_hang', codeLabel: 'Mã trả hàng' },
  { key: 'customers', sheetName: CONFIG.SHEET_CUSTOMERS, codeKey: 'ma_khach_hang', codeLabel: 'Mã khách hàng' },
  { key: 'suppliers', sheetName: CONFIG.SHEET_SUPPLIERS, codeKey: 'ma_ncc', codeLabel: 'Mã nhà cung cấp' },
  { key: 'purchases', sheetName: CONFIG.SHEET_PURCHASES, codeKey: 'ma_nhap_hang', codeLabel: 'Mã nhập hàng' }
];

const FIELD_TYPES = new Set(['text', 'number', 'date', 'percent', 'general']);
const MAX_LABEL_LENGTH = 40;
const MAX_DESCRIPTION_LENGTH = 90;

// Tu tieng Anh (ten bien Postgres/API) khong duoc lo ra nhan hay chu thich.
const FORBIDDEN_ENGLISH_TOKENS = new Set([
  'id', 'api', 'date', 'total', 'code', 'name', 'status', 'created', 'updated', 'price', 'quantity',
  'raw', 'sold', 'by', 'is', 'active', 'purchase', 'payment', 'customer', 'supplier', 'branch',
  'invoice', 'order', 'return', 'product', 'note', 'phone', 'address', 'debt', 'discount', 'fee'
]);
// Viet tat khong duoc dung (Ngoai le duy nhat: COD).
const FORBIDDEN_ABBREVIATIONS = new Set(['SL', 'DS', 'KH', 'NCC', 'SP', 'TT', 'HD', 'SĐT', 'SDT']);

function allFields() {
  return SOURCE_KEYS.flatMap(sourceKey => getSourceFields(sourceKey).map(item => ({ sourceKey, ...item })));
}

function tokensOf(text) {
  return text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

// "Ma hoa don" -> "ma_hoa_don", "Giam gia (%)" / "Giam gia %" -> "giam_gia_pct".
function slugifyHeader(header) {
  return header
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\(%\)|%/g, ' pct ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function labelOf(sourceKey, key) {
  const found = getSourceFields(sourceKey).find(item => item.key === key);
  assert.ok(found, `nguon "${sourceKey}" thieu truong "${key}"`);
  return found.label;
}

// ---------- (a) khop pg reader ----------

test('SOURCE_KEYS gom dung 7 nguon theo thu tu, moi nguon tro dung sheet va cot ma', () => {
  assert.deepEqual(SOURCE_KEYS, EXPECTED_SOURCES.map(item => item.key));
  EXPECTED_SOURCES.forEach(({ key, sheetName, codeKey, codeLabel }) => {
    const source = getSource(key);
    assert.equal(source.key, key);
    assert.equal(source.sheetName, sheetName);
    assert.equal(source.codeKey, codeKey);
    assert.equal(labelOf(key, codeKey), codeLabel, `nhan cot ma cua "${key}"`);
    assert.ok(sheetName in __headers__, `pg reader phai co tab "${sheetName}"`);
  });
});

test('danh sach sheetHeader cua tung nguon khop TUNG header cua pg reader (ten + thu tu)', () => {
  EXPECTED_SOURCES.forEach(({ key, sheetName }) => {
    const headers = getSourceFields(key).map(item => item.sheetHeader);
    assert.deepEqual(headers, __headers__[sheetName], `header cua nguon "${key}" (${sheetName}) phai khop pg reader`);
    assert.equal(new Set(headers).size, headers.length, `sheetHeader cua "${key}" phai la duy nhat`);
  });
});

test('key la alias snake_case duy nhat va khop tieu de goc (bo dau + doi ten viet tat)', () => {
  EXPECTED_SOURCES.forEach(({ key: sourceKey }) => {
    const fields = getSourceFields(sourceKey);
    const keys = fields.map(item => item.key);
    assert.equal(new Set(keys).size, keys.length, `key cua "${sourceKey}" phai duy nhat`);
    fields.forEach(item => {
      assert.match(item.key, /^[a-z][a-z0-9_]*$/, `key "${item.key}" phai la snake_case khong dau`);
      assert.equal(item.key, slugifyHeader(item.sheetHeader),
        `key "${item.key}" cua "${sourceKey}" khong khop tieu de goc "${item.sheetHeader}"`);
    });
  });
});

test('moi truong co dung 6 thuoc tinh, selected mac dinh true, type hop le', () => {
  allFields().forEach(({ sourceKey, ...item }) => {
    assert.deepEqual(Object.keys(item).sort(), ['description', 'key', 'label', 'selected', 'sheetHeader', 'type'],
      `truong ${sourceKey}.${item.key}`);
    assert.equal(item.selected, true, `${sourceKey}.${item.key} phai chon san`);
    assert.ok(FIELD_TYPES.has(item.type), `${sourceKey}.${item.key} co type la "${item.type}"`);
  });
});

// ---------- (b) chat luong nhan va chu thich ----------

test('label/description khong rong, dung do dai, viet tu nhien tieng Viet co dau', () => {
  allFields().forEach(({ sourceKey, key, label, description }) => {
    const where = `${sourceKey}.${key}`;
    assert.equal(typeof label, 'string', where);
    assert.equal(typeof description, 'string', where);
    assert.ok(label.length > 0, `${where}: label rong`);
    assert.ok(description.length > 0, `${where}: description rong`);
    assert.ok(label.length <= MAX_LABEL_LENGTH, `${where}: label dai ${label.length} ky tu (>${MAX_LABEL_LENGTH})`);
    assert.ok(description.length <= MAX_DESCRIPTION_LENGTH,
      `${where}: description dai ${description.length} ky tu (>${MAX_DESCRIPTION_LENGTH}): ${description}`);
    assert.equal(label, label.normalize('NFC').trim(), `${where}: label phai NFC va khong thua khoang trang`);
    assert.doesNotMatch(label, /\s{2,}/, `${where}: label co khoang trang doi`);
    assert.match(label, /^\p{Lu}/u, `${where}: label phai viet hoa chu dau`);
    assert.match(label, /[^\x00-\x7F]/, `${where}: label "${label}" khong co ky tu tieng Viet co dau`);
    assert.match(description, /[^\x00-\x7F]/, `${where}: chu thich khong co ky tu tieng Viet co dau`);
    assert.match(description, /^\p{Lu}/u, `${where}: chu thich phai viet hoa chu dau`);
    assert.ok(description.endsWith('.'), `${where}: chu thich phai ket thuc bang dau cham`);
  });
});

test('label khong co ky tu Excel/cong thuc khong hop le o header', () => {
  allFields().forEach(({ sourceKey, key, label }) => {
    assert.doesNotMatch(label, /[\x00-\x1f]/, `${sourceKey}.${key}: ky tu dieu khien`);
    assert.doesNotMatch(label, /[\[\]:*?/\\]/, `${sourceKey}.${key}: ky tu khong hop le "${label}"`);
    assert.doesNotMatch(label, /^[=+\-@]/, `${sourceKey}.${key}: nhan bat dau bang ky tu cong thuc`);
  });
});

test('label va chu thich khong lo ten bien tieng Anh/snake_case cua Postgres hay tu viet tat', () => {
  allFields().forEach(({ sourceKey, key, label, description }) => {
    [['label', label], ['description', description]].forEach(([part, text]) => {
      const where = `${sourceKey}.${key} ${part} "${text}"`;
      assert.doesNotMatch(text, /_/, `${where}: co gach duoi (snake_case)`);
      assert.doesNotMatch(text.replace(/KiotViet/g, ''), /[a-z][A-Z]/, `${where}: co camelCase`);
      assert.doesNotMatch(text, /(^|\s)T\.(\s|$)/, `${where}: co viet tat "T."`);
      tokensOf(text).forEach(token => {
        assert.ok(!FORBIDDEN_ENGLISH_TOKENS.has(token.toLowerCase()), `${where}: tu tieng Anh "${token}"`);
        assert.ok(!FORBIDDEN_ABBREVIATIONS.has(token.toUpperCase()), `${where}: viet tat "${token}"`);
      });
    });
    assert.doesNotMatch(description, /sheets?/i, `${sourceKey}.${key}: chu thich con nhac den Google Sheets`);
  });
});

// ---------- (c) duy nhat ----------

test('nhan duy nhat trong tung nguon', () => {
  SOURCE_KEYS.forEach(sourceKey => {
    const labels = getSourceFields(sourceKey).map(item => item.label);
    const duplicated = labels.filter((label, index) => labels.indexOf(label) !== index);
    assert.deepEqual(duplicated, [], `nguon "${sourceKey}" co nhan trung: ${duplicated.join(', ')}`);
  });
});

test('nguon purchases: nhan cap phieu va nhan cap dong hang khong trung nhau', () => {
  const fields = getSourceFields('purchases');
  const summary = fields.filter(item => PURCHASE_SUMMARY_KEYS.includes(item.key)).map(item => item.label);
  const lines = fields.filter(item => !PURCHASE_SUMMARY_KEYS.includes(item.key)).map(item => item.label);
  assert.equal(summary.length, 16);
  assert.equal(lines.length, 8);
  assert.deepEqual(summary.filter(label => lines.includes(label)), []);
  assert.equal(labelOf('purchases', 'giam_gia_phieu_nhap'), 'Giảm giá phiếu nhập');
  assert.equal(labelOf('purchases', 'giam_gia'), 'Giảm giá dòng hàng');
});

// ---------- (d) khai niem chung ----------

// [nhan chuan, [[sourceKey, key], ...]] — cung khai niem thi cung mot nhan o moi nguon.
const SHARED_CONCEPTS = [
  ['Mã nhà cung cấp', [['suppliers', 'ma_ncc'], ['purchases', 'ma_nha_cung_cap']]],
  ['Tên nhà cung cấp', [['suppliers', 'ten_ncc'], ['purchases', 'ten_nha_cung_cap']]],
  ['Giảm giá (%)', [['orders', 'giam_gia_pct'], ['purchases', 'giam_gia_pct']]],
  ['Chi nhánh', [['invoices', 'chi_nhanh'], ['orders', 'chi_nhanh'], ['returns', 'chi_nhanh'], ['purchases', 'chi_nhanh']]],
  ['Mã nội bộ chi nhánh', [['invoices', 'id_chi_nhanh'], ['orders', 'id_chi_nhanh'], ['returns', 'id_chi_nhanh']]],
  ['Ngày tạo', [
    ['products', 'ngay_tao'], ['invoices', 'ngay_tao'], ['orders', 'ngay_tao'], ['returns', 'ngay_tao'],
    ['customers', 'ngay_tao'], ['suppliers', 'ngay_tao'], ['purchases', 'thoi_gian_tao']
  ]],
  ['Ngày cập nhật', [
    ['products', 'ngay_cap_nhat'], ['orders', 'ngay_cap_nhat'], ['returns', 'ngay_cap_nhat'], ['suppliers', 'ngay_cap_nhat']
  ]],
  ['Khách hàng', [['invoices', 'khach_hang'], ['orders', 'khach_hang'], ['returns', 'khach_hang']]],
  ['Mã khách hàng', [
    ['invoices', 'ma_khach_hang'], ['orders', 'ma_khach_hang'], ['returns', 'ma_khach_hang'], ['customers', 'ma_khach_hang']
  ]],
  ['Mã nội bộ khách hàng', [
    ['invoices', 'id_khach_hang'], ['orders', 'id_khach_hang'], ['returns', 'id_khach_hang'], ['customers', 'id_khach_hang']
  ]],
  ['Nhân viên bán', [['invoices', 'nhan_vien_ban'], ['orders', 'nhan_vien_lap'], ['returns', 'nhan_vien_ban']]],
  ['Mã nội bộ nhân viên bán', [['invoices', 'id_nhan_vien_ban'], ['orders', 'id_nhan_vien_lap']]],
  ['Mã nội bộ gian hàng', [
    ['products', 'id_gian_hang'], ['orders', 'id_gian_hang'], ['customers', 'id_gian_hang'], ['suppliers', 'id_gian_hang']
  ]],
  ['Trạng thái', [
    ['invoices', 'trang_thai'], ['orders', 'trang_thai'], ['returns', 'trang_thai'], ['purchases', 'trang_thai']
  ]],
  ['Mã trạng thái (số)', [['invoices', 'ma_trang_thai'], ['orders', 'ma_trang_thai'], ['returns', 'ma_trang_thai']]],
  ['Trạng thái gốc từ KiotViet', [
    ['invoices', 'ten_trang_thai_api'], ['orders', 'ten_trang_thai_api'], ['returns', 'ten_trang_thai_api']
  ]],
  ['Thu hộ (COD)', [['invoices', 'thu_ho_cod'], ['orders', 'thu_ho_cod']]],
  ['Ghi chú', [['invoices', 'ghi_chu'], ['orders', 'ghi_chu'], ['purchases', 'ghi_chu']]],
  ['Đang hoạt động', [['products', 'dang_hoat_dong'], ['suppliers', 'trang_thai_hoat_dong']]],
  ['Điện thoại', [['customers', 'dien_thoai'], ['suppliers', 'dien_thoai']]],
  ['Địa chỉ', [['customers', 'dia_chi'], ['suppliers', 'dia_chi']]],
  ['Tổng tiền hàng', [['invoices', 'tong_tien_hang'], ['orders', 'tong_tien'], ['purchases', 'tong_tien_hang']]],
  ['Giảm giá', [['invoices', 'giam_gia'], ['orders', 'giam_gia']]],
  ['Khách đã trả', [['invoices', 'khach_da_tra'], ['orders', 'khach_da_tra']]],
  ['Người tạo', [['suppliers', 'nguoi_tao'], ['purchases', 'nguoi_tao']]],
  ['Mã hàng', [['products', 'ma_hang'], ['purchases', 'ma_hang']]],
  ['Tên hàng', [['products', 'ten_hang'], ['purchases', 'ten_hang']]]
];

test('khai niem chung dung cung mot nhan o moi nguon co truong do', () => {
  SHARED_CONCEPTS.forEach(([expectedLabel, members]) => {
    members.forEach(([sourceKey, key]) => {
      assert.equal(labelOf(sourceKey, key), expectedLabel, `${sourceKey}.${key} phai la "${expectedLabel}"`);
    });
  });
});

test('cung mot key o nhieu nguon thi cung nhan (tru cac ngoai le da chu dich)', () => {
  // trang_thai: hang hoa la trang thai kinh doanh, khac trang thai chung tu.
  // giam_gia: nguon purchases co ca giam gia phieu va giam gia dong hang.
  const INTENTIONAL_DIFFERENCES = { trang_thai: ['products'], giam_gia: ['purchases'] };
  const labelsByKey = new Map();
  allFields().forEach(({ sourceKey, key, label }) => {
    if ((INTENTIONAL_DIFFERENCES[key] || []).includes(sourceKey)) return;
    if (!labelsByKey.has(key)) labelsByKey.set(key, new Map());
    const labels = labelsByKey.get(key);
    if (!labels.has(label)) labels.set(label, []);
    labels.get(label).push(sourceKey);
  });
  labelsByKey.forEach((labels, key) => {
    assert.equal(labels.size, 1, `key "${key}" co nhieu nhan: ${JSON.stringify([...labels])}`);
  });
  assert.equal(labelOf('products', 'trang_thai'), 'Trạng thái kinh doanh');
  assert.notEqual(labelOf('products', 'trang_thai'), labelOf('invoices', 'trang_thai'));
});

test('cung nguon, khac khai niem thi khac nhan: hang hoa phan biet ngay sua cuoi va ngay cap nhat', () => {
  const editedOrCreated = getSourceFields('products').find(item => item.key === 'ngay_sua_cuoi');
  const updated = getSourceFields('products').find(item => item.key === 'ngay_cap_nhat');
  assert.equal(editedOrCreated.label, 'Ngày sửa hoặc tạo gần nhất');
  assert.equal(updated.label, 'Ngày cập nhật');
  assert.match(editedOrCreated.description, /ngày tạo/i);
  assert.match(updated.description, /trống nếu chưa từng cập nhật/);
});

test('ma ky thuat: "Mã nội bộ ..." / "Mã trạng thái (số)" / "Trạng thái gốc từ KiotViet" co chu thich noi ro nguon goc', () => {
  const technical = allFields().filter(item => /^id_/.test(item.key));
  assert.ok(technical.length > 0);
  technical.forEach(({ sourceKey, key, label, description }) => {
    assert.match(label, /^Mã nội bộ /, `${sourceKey}.${key}: nhan "${label}" phai bat dau bang "Mã nội bộ"`);
    assert.match(description, /^Số định danh /, `${sourceKey}.${key}: chu thich phai bat dau bang "Số định danh"`);
    assert.match(description, /do KiotViet cấp/, `${sourceKey}.${key}: chu thich phai noi KiotViet cap`);
    assert.match(description, /khác /, `${sourceKey}.${key}: chu thich phai noi khac gi voi ma/ten hien thi`);
  });
  // Cot ma_nhom_hang cua Hang hoa thuc chat la category_id (so), khong phai ma hien thi.
  assert.equal(labelOf('products', 'ma_nhom_hang'), 'Mã nội bộ nhóm hàng');
  assert.equal(labelOf('products', 'ma_loai_hang'), 'Mã loại hàng (số)');
  ['invoices', 'orders', 'returns'].forEach(sourceKey => {
    const status = getSourceFields(sourceKey).find(item => item.key === 'ma_trang_thai');
    const rawStatus = getSourceFields(sourceKey).find(item => item.key === 'ten_trang_thai_api');
    assert.equal(status.label, 'Mã trạng thái (số)');
    assert.match(status.description, /Mã số trạng thái thô của KiotViet/);
    assert.equal(rawStatus.label, 'Trạng thái gốc từ KiotViet');
    assert.match(rawStatus.description, /nguyên văn KiotViet trả về/);
  });
});

test('cot khong co nguon trong Postgres noi ro "để trống" trong chu thich', () => {
  assert.match(getSourceFields('invoices').find(item => item.key === 'sdt_khach').description, /để trống/);
  assert.match(getSourceFields('customers').find(item => item.key === 'nhom_khach_hang').description, /để trống/);
});

// ---------- (e) kieu du lieu ----------

const NUMBER_KEYS = new Set([
  'gia_von', 'gia_ban', 'ton_kho', 'khach_dat', 'gia_tri_quy_doi',
  'tong_tien_hang', 'tong_tien', 'giam_gia', 'giam_gia_pct', 'khach_da_tra',
  'tong_tien_tra', 'giam_gia_tra_hang', 'phi_tra_hang', 'tong_thanh_toan',
  'no_hien_tai', 'tong_ban', 'tong_doanh_thu',
  'no_can_tra', 'tong_mua', 'tong_mua_tru_tra_hang',
  'giam_gia_phieu_nhap', 'can_tra_ncc', 'tien_da_tra_ncc', 'tong_so_luong', 'tong_so_mat_hang',
  'don_gia', 'gia_nhap', 'thanh_tien', 'so_luong'
]);

test('kieu du lieu: ma/ID/dien thoai la text, ngay/thoi gian la date', () => {
  allFields().forEach(({ sourceKey, key, type }) => {
    const where = `${sourceKey}.${key} (type ${type})`;
    if (/^(ma_|id_|dien_thoai|sdt_)/.test(key)) assert.equal(type, 'text', where);
    if (/^(ngay_|thoi_gian)/.test(key)) assert.equal(type, 'date', where);
  });
});

test('kieu du lieu: tien/so luong/phan tram la number, khong cot nao dung percent', () => {
  allFields().forEach(({ sourceKey, key, label, type }) => {
    const where = `${sourceKey}.${key} (type ${type})`;
    assert.equal(type === 'number', NUMBER_KEYS.has(key), where);
    // Gia tri luu dang 10 nghia la 10% (khong chia 100): khong duoc dung 'percent' (Excel se hien 1000%).
    assert.notEqual(type, 'percent', where);
    if (/\(%\)/.test(label)) assert.equal(type, 'number', where);
  });
});

test('moi cot chi ton tai khi thuoc dung kieu: number/date/text khong lan voi nhau', () => {
  const byType = type => new Set(allFields().filter(item => item.type === type).map(item => item.key));
  const numbers = byType('number');
  const dates = byType('date');
  const texts = byType('text');
  [...numbers].forEach(key => {
    assert.ok(!dates.has(key) && !texts.has(key), `key "${key}" bi khai bao nhieu kieu khac nhau giua cac nguon`);
  });
  [...dates].forEach(key => assert.ok(!texts.has(key), `key "${key}" vua date vua text`));
});

// ---------- PURCHASE_SUMMARY_KEYS ----------

test('PURCHASE_SUMMARY_KEYS la 16 truong cap phieu, dung thu tu, dung truoc "Mã hàng"', () => {
  const fields = getSourceFields('purchases');
  const lineStart = __headers__[CONFIG.SHEET_PURCHASES].indexOf('Mã hàng');
  assert.equal(lineStart, 16);
  assert.equal(PURCHASE_SUMMARY_KEYS.length, 16);
  assert.deepEqual(PURCHASE_SUMMARY_KEYS, fields.slice(0, lineStart).map(item => item.key));
  assert.equal(PURCHASE_SUMMARY_KEYS[0], 'chi_nhanh');
  assert.equal(PURCHASE_SUMMARY_KEYS[PURCHASE_SUMMARY_KEYS.length - 1], 'trang_thai');
  assert.equal(fields[lineStart].key, 'ma_hang');
  assert.equal(fields.length, 24, 'worksheet "Chi tiết mặt hàng" dung toan bo 24 truong');
  assert.ok(PURCHASE_SUMMARY_KEYS.includes(getSource('purchases').codeKey));
});

// ---------- API ----------

test('getSource/getSourceFields/getSourceBySheetName tra cung mot doi tuong, nguon la khong co -> null/rong', () => {
  EXPECTED_SOURCES.forEach(({ key, sheetName }) => {
    const source = getSource(key);
    assert.equal(getSourceFields(key), source.fields);
    assert.equal(getSourceBySheetName(sheetName), source);
    assert.ok(source.fields.some(item => item.key === source.codeKey), `${key}: codeKey phai la mot truong cua nguon`);
  });
  assert.equal(getSource('khong-co'), null);
  assert.equal(getSource(undefined), null);
  assert.deepEqual(getSourceFields('khong-co'), []);
  assert.equal(getSourceBySheetName('Nhóm hàng'), null, 'tab Nhom hang khong thuoc catalogue');
  assert.equal(getSourceBySheetName('Chi tiết hóa đơn'), null, 'tab Chi tiet hoa don khong thuoc catalogue');
});

test('labelForSheetHeader tra nhan chuan hoa cho header cua dung sheet, nguoc lai tra header goc', () => {
  assert.equal(labelForSheetHeader(CONFIG.SHEET_INVOICES, 'ID hóa đơn'), 'Mã nội bộ hóa đơn');
  assert.equal(labelForSheetHeader(CONFIG.SHEET_INVOICES, 'Tên trạng thái API'), 'Trạng thái gốc từ KiotViet');
  assert.equal(labelForSheetHeader(CONFIG.SHEET_SUPPLIERS, 'Mã NCC'), 'Mã nhà cung cấp');
  assert.equal(labelForSheetHeader(CONFIG.SHEET_PURCHASES, 'Giảm giá %'), 'Giảm giá (%)');
  assert.equal(labelForSheetHeader(CONFIG.SHEET_PURCHASES, 'Giảm giá'), 'Giảm giá dòng hàng');
  assert.equal(labelForSheetHeader(CONFIG.SHEET_ORDERS, 'Giảm giá'), 'Giảm giá');
  assert.equal(labelForSheetHeader(CONFIG.SHEET_PRODUCTS, 'Ngày sửa cuối'), 'Ngày sửa hoặc tạo gần nhất');
  // Header khong thuoc sheet do -> giu nguyen (vd ket qua tim kiem gop nhieu sheet).
  assert.equal(labelForSheetHeader(CONFIG.SHEET_PRODUCTS, 'Mã NCC'), 'Mã NCC');
  assert.equal(labelForSheetHeader(CONFIG.SHEET_PRODUCTS, 'Cot la'), 'Cot la');
  // Sheet ngoai catalogue -> giu nguyen.
  assert.equal(labelForSheetHeader('Nhóm hàng', 'Mã nhóm hàng'), 'Mã nhóm hàng');
  assert.equal(labelForSheetHeader('Sheet la', 'ID hóa đơn'), 'ID hóa đơn');
});

test('labelForSheetHeader chiu duoc khoang trang thua va chuoi Unicode dang NFD', () => {
  assert.equal(labelForSheetHeader(CONFIG.SHEET_INVOICES, '  ID hóa đơn '), 'Mã nội bộ hóa đơn');
  assert.equal(labelForSheetHeader(CONFIG.SHEET_INVOICES, 'ID hóa đơn'.normalize('NFD')), 'Mã nội bộ hóa đơn');
  assert.equal(labelForSheetHeader(CONFIG.SHEET_INVOICES, undefined), undefined);
});

test('moi header cua 7 tab deu doi duoc sang nhan chuan hoa dung voi truong cung vi tri', () => {
  EXPECTED_SOURCES.forEach(({ key, sheetName }) => {
    __headers__[sheetName].forEach((header, index) => {
      assert.equal(labelForSheetHeader(sheetName, header), getSourceFields(key)[index].label, `${sheetName}: "${header}"`);
    });
  });
});

test('du lieu catalogue bi dong bang sau (deep freeze): khong ai sua nham duoc', () => {
  assert.ok(Object.isFrozen(SOURCE_KEYS));
  assert.ok(Object.isFrozen(PURCHASE_SUMMARY_KEYS));
  SOURCE_KEYS.forEach(sourceKey => {
    const source = getSource(sourceKey);
    assert.ok(Object.isFrozen(source), `${sourceKey}: source`);
    assert.ok(Object.isFrozen(source.fields), `${sourceKey}: fields`);
    source.fields.forEach(item => assert.ok(Object.isFrozen(item), `${sourceKey}.${item.key}`));
  });
  assert.throws(() => { getSource('products').fields.push({}); }, TypeError);
  assert.throws(() => { getSourceFields('products')[0].label = 'Sửa'; }, TypeError);
  assert.throws(() => { PURCHASE_SUMMARY_KEYS.push('x'); }, TypeError);
  assert.throws(() => { getSourceFields('khong-co').push({}); }, TypeError);
});
