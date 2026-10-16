'use strict';

// Port tests/test_invoice_pdf_reader.py (text that trich tu 2 hoa don mau VC / SHC).

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseInvoiceText } = require('./invoicePdfText');

const VC_INVOICE_TEXT = 'Ký hiệu(Serial No):1C26TVC\nSố(No.):\n'
  + 'Đơn vị bán hàng(Seller): CÔNG TY CỔ PHẦN THƯƠNG MẠI VC EXPRESS\n'
  + 'Mã số thuế/Mã đơn vị quan hệ ngân sách(Tax code):0111302750\n'
  + 'Địa chỉ(Address):Tầng 15 tháp B tòa nhà Sông Đà\n'
  + "Họ tên người mua hàng(Buyer's fullname):\n"
  + 'Tên đơn vị(Company\'s name):HỘ KINH DOANH MẸ VÀ BÉ NGUYỄN TÙNG\n'
  + 'Cộng tiền hàng(Total amount): 4.490.800\n'
  + 'Thuế suất GTGT(VAT Rate): 8% Tiền thuế GTGT(VAT amount): 359.264\n'
  + 'Tổng cộng tiền thanh toán(Total payment): 4.850.064';

const SHC_INVOICE_TEXT = 'Ký hiệu(Serial No):1C26THC\nSố(No.):\n'
  + 'Đơn vị bán hàng(Seller): CÔNG TY CỔ PHẦN THƯƠNG MẠI TỔNG HỢP SHC GROUP\n'
  + 'Mã số thuế/Mã đơn vị quan hệ ngân sách(Tax code):0319502477\n'
  + 'Cộng tiền hàng(Total amount): 1.050.000\n'
  + 'Thuế suất GTGT(VAT Rate): 8% Tiền thuế GTGT(VAT amount): 84.000\n'
  + 'Tổng cộng tiền thanh toán(Total payment): 1.134.000';

test('hoa don VC: don vi ban, tong tien, ky hieu', () => {
  const parsed = parseInvoiceText(VC_INVOICE_TEXT);
  assert.equal(parsed.error, null);
  assert.equal(parsed.sellerName, 'CÔNG TY CỔ PHẦN THƯƠNG MẠI VC EXPRESS');
  assert.equal(parsed.totalPayment, 4850064);
  assert.equal(parsed.totalBeforeVat, 4490800);
  assert.equal(parsed.vatAmount, 359264);
  assert.equal(parsed.serialNo, '1C26TVC');
});

test('hoa don SHC', () => {
  const parsed = parseInvoiceText(SHC_INVOICE_TEXT);
  assert.equal(parsed.error, null);
  assert.equal(parsed.sellerName, 'CÔNG TY CỔ PHẦN THƯƠNG MẠI TỔNG HỢP SHC GROUP');
  assert.equal(parsed.totalPayment, 1134000);
});

test('text rong / khong dung mau -> loi', () => {
  const empty = parseInvoiceText('');
  assert.ok(empty.error);
  assert.equal(empty.totalPayment, null);
  assert.ok(parseInvoiceText('Đây là một văn bản bất kỳ không phải hóa đơn.').error);
});

test('so le dong do lam tron thue: phay la phan le, cham la phan cach nghin', () => {
  const parsed = parseInvoiceText('Cộng tiền hàng (Total amount): 10.272.280\n'
    + 'Thuế suất GTGT (VAT Rate): 8% Tiền thuế GTGT (VAT amount): 821.782,4\n'
    + 'Tổng cộng tiền thanh toán (Total payment): 11.094.062,4');
  assert.equal(parsed.error, null);
  assert.equal(parsed.totalBeforeVat, 10272280);
  assert.equal(parsed.vatAmount, 821782);
  assert.equal(parsed.totalPayment, 11094062);
  assert.equal(parseInvoiceText('Tổng cộng tiền thanh toán (Total payment): 11.094.062,6').totalPayment, 11094063);
});

test('ten don vi ban dinh vao nhan "Mã số thuế" tren cung dong', () => {
  const parsed = parseInvoiceText('Đơn vị bán hàng (Seller): CÔNG TY SHC Mã số thuế: 0319502477\r\n');
  assert.equal(parsed.sellerName, 'CÔNG TY SHC');
});
