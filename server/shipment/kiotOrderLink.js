// ==========================================
// KIOT ORDER LINK — dung dia chi mo DUNG mot don tren giao dien KiotViet, de ke toan tu kiem tra
// roi tu bam Ket thuc tren Kiot. KHONG goi API Kiot, khong gui lenh hoan thanh, khong doc lai
// trang thai: chi la mot duong dan.
//
// Ten gian hang lay tu KIOTVIET_RETAILER / KIOTVIET_RETAILER_SG (cung bien voi kiotvietSync/config.js).
// Day la SUBDOMAIN cong khai, KHONG phai khoa/secret — client id/secret khong bao gio ra client.
// Thieu bien hoac ten khong hop le -> tra null va giao dien khong hien nut (khong doan bua).
// ==========================================
'use strict';

// Subdomain Kiot chi gom chu/so/gach ngang. Chan gia tri env la URL day du, co dau '/', '@'...
const RETAILER_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

function normalizeRetailer(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return RETAILER_PATTERN.test(text) ? text : null;
}

/**
 * { HN: 'chhanoi.kiotviet.vn' | null, SG: ... }. SG thieu bien rieng thi dung chung bien HN
 * (cung quy uoc du phong voi kiotvietSync/config.js).
 */
function retailerHosts(env = process.env) {
  const hanoi = normalizeRetailer(env.KIOTVIET_RETAILER);
  const saigon = normalizeRetailer(env.KIOTVIET_RETAILER_SG) || hanoi;
  return {
    HN: hanoi ? `${hanoi}.kiotviet.vn` : null,
    SG: saigon ? `${saigon}.kiotviet.vn` : null
  };
}

/**
 * Dia chi loc danh sach Dat hang theo ma don. Thieu host hoac ma don -> null.
 * Query `code` khop tham so ma giao dien Kiot doc; khong kem khoa hoac token nao.
 */
function kiotOrderUrl(branch, code, env = process.env) {
  const host = retailerHosts(env)[branch];
  const orderCode = String(code ?? '').trim();
  if (!host || !orderCode) return null;
  return `https://${host}/man/#/Orders?code=${encodeURIComponent(orderCode)}`;
}

module.exports = { retailerHosts, kiotOrderUrl, normalizeRetailer };
