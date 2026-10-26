'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { stripTelegramId, saleNameSql, TELEGRAM_ID_SUFFIX_SQL, extractTelegramId, saleTelegramIdSql, TELEGRAM_ID_CAPTURE_SQL } = require('./saleName');

test('stripTelegramId: bo hau to " - <ID Telegram 10 so>", chi giu phan ten', () => {
  assert.equal(stripTelegramId('Nguyễn Văn A - 1234567890'), 'Nguyễn Văn A');
  assert.equal(stripTelegramId('Trần Thị Bích Hạnh - 9876543210'), 'Trần Thị Bích Hạnh');
});

test('stripTelegramId: chiu duoc khoang trang thua / khong co khoang trang quanh gach ngang', () => {
  assert.equal(stripTelegramId('  Lê Văn B   -   1234567890  '), 'Lê Văn B');
  assert.equal(stripTelegramId('Lê Văn B-1234567890'), 'Lê Văn B');
  assert.equal(stripTelegramId('Lê Văn B -1234567890'), 'Lê Văn B');
});

test('stripTelegramId: ten khong co hau to giu nguyen (da trim), null/undefined -> chuoi rong', () => {
  assert.equal(stripTelegramId('Phạm Văn C'), 'Phạm Văn C');
  assert.equal(stripTelegramId('  Phạm Văn C '), 'Phạm Văn C');
  assert.equal(stripTelegramId(''), '');
  assert.equal(stripTelegramId(null), '');
  assert.equal(stripTelegramId(undefined), '');
});

test('stripTelegramId: so ngan (< 5 chu so) hoac so khong o cuoi KHONG bi cat nham', () => {
  assert.equal(stripTelegramId('Kho 2 - 3'), 'Kho 2 - 3');
  assert.equal(stripTelegramId('Chi nhánh 12345678 Tân Phú'), 'Chi nhánh 12345678 Tân Phú');
  assert.equal(stripTelegramId('Quầy - 1234'), 'Quầy - 1234');
});

test('stripTelegramId: chi cat 1 hau to o cuoi; ten co gach ngang khac van nguyen ven', () => {
  assert.equal(stripTelegramId('Anh - Em - 1234567890'), 'Anh - Em');
  assert.equal(stripTelegramId('Nguyễn Văn A - 1234567890 - 1234567890'), 'Nguyễn Văn A - 1234567890');
});

test('stripTelegramId: ten chi la ID thi giu nguyen ban goc (khong de o trong)', () => {
  assert.equal(stripTelegramId('- 1234567890'), '- 1234567890');
  assert.equal(stripTelegramId('1234567890'), '1234567890');
});

test('stripTelegramId: nhan dau so khong phai chuoi (so) khong lam nem loi', () => {
  assert.equal(stripTelegramId(1234567890), '1234567890');
});

test('saleNameSql: doan SQL dung bieu thuc 2 lan (cat + du phong), cung mau voi quy tac JS', () => {
  const sql = saleNameSql(`COALESCE(NULLIF(raw->>'soldByName', ''), '')`);
  assert.equal(
    sql,
    `COALESCE(NULLIF(btrim(regexp_replace(COALESCE(NULLIF(raw->>'soldByName', ''), ''), '${TELEGRAM_ID_SUFFIX_SQL}', '')), ''), COALESCE(NULLIF(raw->>'soldByName', ''), ''))`
  );
  assert.equal(TELEGRAM_ID_SUFFIX_SQL, '[[:space:]]*-[[:space:]]*[0-9]{5,}[[:space:]]*$');
});

test('mau POSIX trong SQL tuong duong regex JS tren tap ten that (dang ky tu)', () => {
  // Doi POSIX -> JS (\s) de kiem tra cung ket qua voi stripTelegramId tren cac dang ten.
  const posixAsJs = new RegExp(TELEGRAM_ID_SUFFIX_SQL.replace(/\[\[:space:\]\]/g, '\\s'));
  const samples = [
    'Nguyễn Văn A - 1234567890', 'Nguyễn Văn A-1234567890', 'Phạm Văn C', 'Kho 2 - 3', 'Quầy - 1234',
    'Chi nhánh 12345678 Tân Phú', 'Anh - Em - 1234567890'
  ];
  for (const sample of samples) {
    const viaPosix = sample.replace(posixAsJs, '').trim() || sample;
    assert.equal(viaPosix, stripTelegramId(sample), sample);
  }
});

// --- extractTelegramId: mat con lai cua stripTelegramId (chi tiet don hien them ID nhu Kiot) ---

test('extractTelegramId: lay dung phan ID o hau to', () => {
  assert.equal(extractTelegramId('Nguyễn Văn A - 1234567890'), '1234567890');
  assert.equal(extractTelegramId('Trần Thị Bích Hạnh - 9876543210'), '9876543210');
  assert.equal(extractTelegramId('  Lê Văn B   -   1234567890  '), '1234567890');
  assert.equal(extractTelegramId('Lê Văn B-1234567890'), '1234567890');
});

test('extractTelegramId: khong co hau to / so ngan / so khong o cuoi -> chuoi rong', () => {
  assert.equal(extractTelegramId('Phạm Văn C'), '');
  assert.equal(extractTelegramId('Kho 2 - 3'), '');
  assert.equal(extractTelegramId('Quầy - 1234'), '');
  assert.equal(extractTelegramId('Chi nhánh 12345678 Tân Phú'), '');
  assert.equal(extractTelegramId(''), '');
  assert.equal(extractTelegramId(null), '');
  assert.equal(extractTelegramId(undefined), '');
});

test('extractTelegramId: chuoi chi gom ID -> rong, vi stripTelegramId dang giu no lam ten', () => {
  assert.equal(extractTelegramId('- 1234567890'), '');
  assert.equal(extractTelegramId('1234567890'), '');
});

test('extractTelegramId: chi lay 1 hau to o cuoi, giong stripTelegramId', () => {
  assert.equal(extractTelegramId('Anh - Em - 1234567890'), '1234567890');
  assert.equal(extractTelegramId('Nguyễn Văn A - 1234567890 - 1234567890'), '1234567890');
});

test('BAT BIEN: ten da cat + " - " + ID dung lai duoc chuoi goc', () => {
  const samples = [
    'Nguyễn Văn A - 1234567890', 'Trần Thị Bích Hạnh - 9876543210', 'Anh - Em - 1234567890',
    'Phạm Văn C', 'Kho 2 - 3', 'Quầy - 1234', '- 1234567890', '1234567890', ''
  ];
  for (const sample of samples) {
    const id = extractTelegramId(sample);
    const rebuilt = stripTelegramId(sample) + (id ? ' - ' + id : '');
    // So sau khi bo khoang trang: chi khac nhau o cach dat khoang trang quanh gach ngang.
    assert.equal(rebuilt.replace(/\s/g, ''), String(sample).trim().replace(/\s/g, ''), sample);
  }
});

test('saleTelegramIdSql: mau POSIX cho cung ket qua voi extractTelegramId tren tap ten that', () => {
  const posixAsJs = new RegExp(TELEGRAM_ID_CAPTURE_SQL.replace(/\[\[:space:\]\]/g, '\\s'));
  const stripAsJs = new RegExp(TELEGRAM_ID_SUFFIX_SQL.replace(/\[\[:space:\]\]/g, '\\s'));
  const samples = [
    'Nguyễn Văn A - 1234567890', 'Lê Văn B-1234567890', 'Phạm Văn C', 'Kho 2 - 3', 'Quầy - 1234',
    'Chi nhánh 12345678 Tân Phú', 'Anh - Em - 1234567890', '- 1234567890', '1234567890'
  ];
  for (const sample of samples) {
    // Mo phong dung thu tu CASE WHEN cua saleTelegramIdSql.
    const match = posixAsJs.exec(sample);
    const viaPosix = sample.replace(stripAsJs, '').trim() ? (match ? match[1] : '') : '';
    assert.equal(viaPosix, extractTelegramId(sample), sample);
  }
  assert.match(saleTelegramIdSql(`raw->>'soldByName'`), /^CASE WHEN btrim\(regexp_replace\(/);
});
