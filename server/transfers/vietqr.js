'use strict';
// Dung chuoi VietQR (chuan EMVCo QR cua NAPAS) cho chuyen khoan nhanh 24/7 toi tai khoan/the.
// Chuoi tao o SERVER tu du lieu trong DB (khong nhan tu client) roi render SVG bang `qrcode`.
// Khong dung img.vietqr.io: se gui STK/ten khach ra ben thu ba.

const NAPAS_GUID = 'A000000727';
const SERVICE = Object.freeze({ ACCOUNT: 'QRIBFTTA', CARD: 'QRIBFTTC' });
const ADD_INFO_MAX = 25;

function tlv(tag, value) {
  const text = String(value);
  if (text.length > 99) throw new Error(`VietQR field ${tag} too long`);
  return tag + String(text.length).padStart(2, '0') + text;
}

// CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) — "123456789" -> 29B1.
function crc16ccitt(input) {
  let crc = 0xffff;
  for (const byte of Buffer.from(input, 'utf8')) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// Noi dung chuyen khoan: bo dau, viet hoa, chi chu/so/khoang trang, toi da 25 ky tu
// (nhieu app ngan hang cat hoac tu choi noi dung dai/co dau).
function toAddInfo(text) {
  return String(text || '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, ADD_INFO_MAX)
    .trim();
}

function buildPayload({ bin, account, accountType = 'ACCOUNT', amount, addInfo }) {
  if (!/^\d{6}$/.test(String(bin || ''))) throw new Error('VietQR: BIN không hợp lệ');
  if (!/^[0-9A-Za-z]{4,19}$/.test(String(account || ''))) throw new Error('VietQR: số tài khoản không hợp lệ');
  const service = SERVICE[accountType];
  if (!service) throw new Error('VietQR: loại tài khoản không hợp lệ');
  const money = amount == null ? null : Number(amount);
  if (money != null && !(Number.isSafeInteger(money) && money > 0)) throw new Error('VietQR: số tiền không hợp lệ');
  const info = toAddInfo(addInfo);
  const merchant = tlv('00', NAPAS_GUID) + tlv('01', tlv('00', bin) + tlv('01', account)) + tlv('02', service);
  let body = tlv('00', '01')
    + tlv('01', money != null ? '12' : '11')
    + tlv('38', merchant)
    + tlv('53', '704');
  if (money != null) body += tlv('54', String(money));
  body += tlv('58', 'VN');
  if (info) body += tlv('62', tlv('08', info));
  body += '6304';
  return body + crc16ccitt(body);
}

module.exports = { buildPayload, crc16ccitt, toAddInfo, ADD_INFO_MAX };
