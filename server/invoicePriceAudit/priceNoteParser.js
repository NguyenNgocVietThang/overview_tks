'use strict';

// Doc mo ta gia (products.raw.description) cua KiotViet thanh cac bac gia cho "Kiem tra gia ban".
// Mau: "T100 # 16/10 # 1T -24000 | 3T- 23800 | 5T- 23600 | 10T-23000 | VAT+2000đ"
//   T100        = so chiec / thung
//   16/10       = ngay cap nhat (chi de doi chieu)
//   nT -gia     = bac gia: tu n thung tro len; o trong "-T --" = khong co bac
//   VAT+2000đ   = VAT moi don vi
// Ham thuan, khong doc DB. Tien tra ve dang chuoi decimal (khong dung so thuc JS) de SQL CAST NUMERIC.

// Chuan hoa: NFKC, chu thuong, gop moi dang khoang trang thanh 1 dau cach, trim.
function normalizeText(value) {
  if (value == null) return '';
  return String(value).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

// So tien nguyen: "24000", "24.000", "24,000", kem hau to d/đ/dong/đồng.
// Chuoi khong hop le (vd 24x000, 12.5, 1.23.456) -> null, khong bao gio doc mot phan.
function parseMoney(text) {
  if (text == null) return null;
  const s = normalizeText(text).replace(/\s*(đồng|đ|dong|d)$/, '').trim();
  if (/^\d+$/.test(s)) return stripLeadingZeros(s);
  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(s)) return stripLeadingZeros(s.replace(/[.,]/g, ''));
  return null;
}

function stripLeadingZeros(digits) {
  return digits.replace(/^0+(?=\d)/, '');
}

const CARTON_SIZE_RE = /^t ?(\d+)$/;
const DATE_RE = /^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?$/;
const VAT_RE = /^vat ?\+ ?(.+)$/;
// Mot o bac: "1t -24000", "2t- 168000", "-t --", "10t-23000"
const TIER_RE = /^-? ?(\d*) ?t ?- ?(.*)$/;

function parsePriceNote(text) {
  const result = { cartonSize: null, tiers: [], vatPerUnit: null, updatedLabel: null };
  if (typeof text !== 'string') return result;
  const normalized = normalizeText(text);
  if (!normalized) return result;

  let position = 0;
  for (const raw of normalized.split(/[#|]/)) {
    const seg = raw.trim();
    if (!seg) continue;

    const carton = CARTON_SIZE_RE.exec(seg);
    if (carton) {
      if (result.cartonSize === null) result.cartonSize = stripLeadingZeros(carton[1]);
      continue;
    }
    if (DATE_RE.test(seg)) {
      if (result.updatedLabel === null) result.updatedLabel = seg;
      continue;
    }
    const vat = VAT_RE.exec(seg);
    if (vat) {
      if (result.vatPerUnit === null) result.vatPerUnit = parseMoney(vat[1]);
      continue;
    }
    const tier = TIER_RE.exec(seg);
    if (tier) {
      position += 1; // vi tri giu nguyen ke ca khi o trong bi bo
      const unitPrice = parseMoney(tier[2]);
      // O trong/khong hop le bi bo; gia 0 khong phai gia quy dinh (se keo min xuong 0).
      if (tier[1] === '' || unitPrice === null || unitPrice === '0') continue;
      result.tiers.push({ position, cartons: stripLeadingZeros(tier[1]), unitPrice });
    }
  }
  return result;
}

module.exports = { parsePriceNote, parseMoney, normalizeText };
