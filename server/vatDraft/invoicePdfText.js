'use strict';

// Port src/invoice_pdf_reader.py (phan doc TEXT): trich "Don vi ban hang", tong tien, ky
// hieu tu text hoa don GTGT dien tu. Trinh duyet doc PDF bang pdf.js roi gui text len day;
// regex giu nguyen app cu (\s, . va \S theo nghia Python).

const { PY_WS_CLASS, pyStrip } = require('./pyCompat');

const WS = `[${PY_WS_CLASS}]`;
const NON_WS = `[^${PY_WS_CLASS}]`;
// Python '.' khop moi ky tu tru '\n'.
const SELLER_RE = new RegExp(`Đơn vị bán hàng${WS}*\\(Seller\\)${WS}*:${WS}*([^\\n]+)`);
const TOTAL_PAYMENT_RE = new RegExp(`Tổng cộng tiền thanh toán${WS}*\\(Total payment\\)${WS}*:${WS}*([\\d.,]+)`);
const TOTAL_BEFORE_VAT_RE = new RegExp(`Cộng tiền hàng${WS}*\\(Total amount\\)${WS}*:${WS}*([\\d.,]+)`);
const VAT_AMOUNT_RE = new RegExp(`Tiền thuế GTGT${WS}*\\(VAT amount\\)${WS}*:${WS}*([\\d.,]+)`);
const SERIAL_RE = new RegExp(`Ký hiệu${WS}*\\(Serial No\\)${WS}*:${WS}*(${NON_WS}+)`);

const NO_TEXT_ERROR = 'Không tìm thấy lớp text trong PDF (có thể là ảnh scan/chụp) — '
  + 'vui lòng nhập số tiền và chọn tài khoản thủ công.';
const UNRECOGNIZED_ERROR = 'Không nhận diện được nội dung hóa đơn (không đúng mẫu hóa đơn GTGT '
  + 'điện tử) — vui lòng nhập số tiền và chọn tài khoản thủ công.';

/**
 * So tien theo DUNG dinh dang hoa don VN: cham ngan hang nghin, phay (neu co, 1-2 chu so)
 * la phan le cua dong — "11.094.062,4" = 11.094.062 dong (lam tron len khi le >= 5).
 */
function parseInvoiceAmount(text) {
  if (!text) return null;
  const value = pyStrip(text);
  const sepIndex = value.lastIndexOf(',');
  let intPart = value;
  let fracPart = '';
  if (sepIndex !== -1 && /^\d{1,2}$/.test(value.slice(sepIndex + 1))) {
    intPart = value.slice(0, sepIndex);
    fracPart = value.slice(sepIndex + 1);
  }
  const digits = intPart.replace(/[^\d]/g, '');
  if (!digits) return null;
  let amount = Number(digits);
  if (fracPart && Number(fracPart[0]) >= 5) amount += 1;
  return amount;
}

/** parse_invoice_text -> { sellerName, totalPayment, totalBeforeVat, vatAmount, serialNo, error }. */
function parseInvoiceText(text) {
  const source = String(text || '');
  if (!pyStrip(source)) {
    return { sellerName: '', totalPayment: null, totalBeforeVat: null, vatAmount: null, serialNo: '', error: NO_TEXT_ERROR };
  }
  const seller = source.match(SELLER_RE);
  const total = source.match(TOTAL_PAYMENT_RE);
  const beforeVat = source.match(TOTAL_BEFORE_VAT_RE);
  const vat = source.match(VAT_AMOUNT_RE);
  const serial = source.match(SERIAL_RE);

  let sellerName = seller ? pyStrip(seller[1]) : '';
  // PDF khong xuong dong dung cho, dinh vao nhan tiep theo.
  sellerName = pyStrip(sellerName.split('Mã số thuế')[0]);

  const parsed = {
    sellerName,
    totalPayment: total ? parseInvoiceAmount(total[1]) : null,
    totalBeforeVat: beforeVat ? parseInvoiceAmount(beforeVat[1]) : null,
    vatAmount: vat ? parseInvoiceAmount(vat[1]) : null,
    serialNo: serial ? pyStrip(serial[1]) : '',
    error: null
  };
  if (!parsed.sellerName && parsed.totalPayment === null) parsed.error = UNRECOGNIZED_ERROR;
  return parsed;
}

module.exports = { parseInvoiceAmount, parseInvoiceText };
