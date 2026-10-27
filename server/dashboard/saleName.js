// ==========================================
// SALE NAME — ten nhan vien ban tren KiotViet duoc gan them ID Telegram o duoi, dang
// "<ten> - <ID>" (vd "Nguyen Van A - 1234567890"; do that 2026-10-01: 73/73 ten co hau to
// dung 10 chu so, khong ten nao khac co so/gach ngang). Giao dien chi can phan <ten>.
//
// MOT dinh nghia duy nhat cho 2 noi dung chung quy tac:
//   - stripTelegramId(name): ham JS (hang Kiot cua Vong doi don hang...).
//   - saleNameSql(expr): doan SQL tuong duong cho cac reader SQL dang "sheet"
//     (dashboardPgReader.js, documentDetailRepository.js).
// CHI doi cach HIEN THI: khong ghi lai vao `raw`/`staff`/DB (ID con dung de doi chieu bot
// Telegram). Sua quy tac thi sua CA 2 cho o day + test saleName.test.js.
//
// 2026-10-26: chi tiet don cua Vong doi don hang hien THEM ID ben canh ten (giong Kiot), nen
// can doc duoc phan ID da cat. extractTelegramId / saleTelegramIdSql la mat con lai cua
// stripTelegramId, giu dung BAT BIEN: ten da cat + " - " + ID == chuoi goc (sau trim). Ten chi
// gom ID (khong co phan ten) -> KHONG tach, de stripTelegramId van giu nguyen dong chu.
// ==========================================
'use strict';

// Hau to " - <>=5 chu so>" o CUOI chuoi. Cho phep >=5 chu so (ID that = 10) de khong cat nham
// ten kieu "Kho 2 - 3".
const TELEGRAM_ID_SUFFIX = /\s*-\s*\d{5,}\s*$/;

// Cung quy tac dang POSIX cho Postgres (regexp_replace; [[:space:]] thay cho \s).
const TELEGRAM_ID_SUFFIX_SQL = '[[:space:]]*-[[:space:]]*[0-9]{5,}[[:space:]]*$';

/**
 * "Ten - 1234567890" -> "Ten". Khong co hau to -> giu nguyen (da trim); null/undefined -> ''.
 * Neu cat xong rong (ten chi la "- 1234567890") thi giu nguyen ban goc de khong mat dong chu.
 */
function stripTelegramId(name) {
  if (name === undefined || name === null) return '';
  const text = String(name).trim();
  const stripped = text.replace(TELEGRAM_ID_SUFFIX, '').trim();
  return stripped || text;
}

/**
 * Doan SQL tuong duong stripTelegramId cho 1 bieu thuc `expr` (bieu thuc duoc dung 2 lan trong
 * cau SQL tra ve — chi truyen bieu thuc thuan, khong tham so/side effect). NULL -> NULL.
 */
function saleNameSql(expr) {
  return `COALESCE(NULLIF(btrim(regexp_replace(${expr}, '${TELEGRAM_ID_SUFFIX_SQL}', '')), ''), ${expr})`;
}

// Cung hau to nhung BAT lay nhom chu so, dung cho ca JS va POSIX (Postgres regexp_match).
const TELEGRAM_ID_CAPTURE = /\s*-\s*(\d{5,})\s*$/;
const TELEGRAM_ID_CAPTURE_SQL = '[[:space:]]*-[[:space:]]*([0-9]{5,})[[:space:]]*$';

/**
 * "Ten - 1234567890" -> "1234567890". Khong co hau to -> ''. Chuoi chi gom ID (vd "- 1234567890",
 * "1234567890") -> '' vi stripTelegramId giu nguyen ban goc lam ten; tach nua se nhan doi ID.
 */
function extractTelegramId(name) {
  if (name === undefined || name === null) return '';
  const text = String(name).trim();
  const match = TELEGRAM_ID_CAPTURE.exec(text);
  if (!match) return '';
  // Cat xong con ten thi moi coi la hau to ID; khong con gi thi day la ten, khong phai ID.
  return text.replace(TELEGRAM_ID_CAPTURE, '').trim() ? match[1] : '';
}

/**
 * Doan SQL tuong duong extractTelegramId cho 1 bieu thuc `expr` (dung 3 lan trong cau SQL tra ve —
 * chi truyen bieu thuc thuan, khong tham so/side effect). Khong co hau to hoac khong con ten -> ''.
 */
function saleTelegramIdSql(expr) {
  return `CASE WHEN btrim(regexp_replace(${expr}, '${TELEGRAM_ID_SUFFIX_SQL}', '')) <> ''`
    + ` THEN COALESCE((regexp_match(${expr}, '${TELEGRAM_ID_CAPTURE_SQL}'))[1], '')`
    + ` ELSE '' END`;
}

module.exports = {
  stripTelegramId, saleNameSql, TELEGRAM_ID_SUFFIX_SQL,
  extractTelegramId, saleTelegramIdSql, TELEGRAM_ID_CAPTURE_SQL
};
