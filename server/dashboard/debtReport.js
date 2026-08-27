// ==========================================
// BAO CAO CONG NO THEO KY (HN1/HN3/HN7) — do Apps Script tao tu du lieu KiotViet.
// Module nay CHI DOC va parse du lieu, khong bao gio ghi/sua HN1/HN3/HN7.
// ==========================================

const DEBT_COLUMNS = {
  code: 'Mã KH',
  name: 'Khách hàng',
  phone: 'Số điện thoại',
  group: 'Nhóm khách hàng',
  openingDebt: 'Nợ đầu kỳ',
  debit: 'Ghi nợ',
  credit: 'Ghi có',
  closingDebt: 'Nợ cuối kỳ',
  txnCode: 'Mã giao dịch',
  txnTime: 'Thời gian',
  txnType: 'Loại giao dịch',
  txnValue: 'Giá trị',
  txnRunningBalance: 'Dư nợ cuối'
};

const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;
const GOOGLE_SHEETS_EPOCH_DAYS = 25569;
const DAY_MS = 24 * 60 * 60 * 1000;

function buildColumnIndex(headers) {
  const index = {};
  Object.entries(DEBT_COLUMNS).forEach(([key, headerName]) => {
    index[key] = headers.findIndex(header => String(header || '').trim() === headerName);
  });
  return index;
}

function cell(row, colIndex) {
  return colIndex >= 0 && colIndex < row.length ? row[colIndex] : undefined;
}

/**
 * Tach 1 o co the chua nhieu gia tri ngan cach boi "|" (khi khach co nhieu
 * giao dich trong ky) thanh mang chuoi da trim. O trong/undefined -> mang rong.
 */
function splitPipeValues(raw) {
  if (raw === undefined || raw === null || raw === '') return [];
  return String(raw).split('|').map(part => part.trim());
}

function toNumber(raw) {
  if (raw === undefined || raw === null || raw === '') return 0;
  if (typeof raw === 'number') return raw;
  // KiotViet co the tra chuoi da format "1.234.567" — bo dau cham phan cach hang nghin.
  const cleaned = String(raw).replace(/\./g, '').replace(/,/g, '.').trim();
  const num = Number(cleaned);
  return isNaN(num) ? 0 : num;
}

function normalizeText(raw) {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .trim()
    .toLowerCase();
}

function vietnamWallTimeToDate(year, month, day, hour, minute, second) {
  const values = [year, month, day, hour, minute, second].map(Number);
  if (values.some(value => !Number.isInteger(value))) return null;

  const [yyyy, MM, dd, hh, mi, ss] = values;
  const timestamp = Date.UTC(yyyy, MM - 1, dd, hh, mi, ss) - VIETNAM_UTC_OFFSET_MS;
  const wallTime = new Date(timestamp + VIETNAM_UTC_OFFSET_MS);
  const isValid = wallTime.getUTCFullYear() === yyyy &&
    wallTime.getUTCMonth() + 1 === MM &&
    wallTime.getUTCDate() === dd &&
    wallTime.getUTCHours() === hh &&
    wallTime.getUTCMinutes() === mi &&
    wallTime.getUTCSeconds() === ss;

  return isValid ? new Date(timestamp) : null;
}

/**
 * Doc thoi gian giao dich theo gio Viet Nam. Sheets API hien tra chuoi
 * dd/MM/yyyy HH:mm, nhung van ho tro serial number va ISO de parser khong bi
 * phu thuoc vao kieu hien thi cua sheet.
 */
function parseTransactionTime(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;

  if (typeof raw === 'number') {
    const wallTime = new Date(Math.round((raw - GOOGLE_SHEETS_EPOCH_DAYS) * DAY_MS));
    if (isNaN(wallTime.getTime())) return null;
    return vietnamWallTimeToDate(
      wallTime.getUTCFullYear(),
      wallTime.getUTCMonth() + 1,
      wallTime.getUTCDate(),
      wallTime.getUTCHours(),
      wallTime.getUTCMinutes(),
      wallTime.getUTCSeconds()
    );
  }

  const value = String(raw).trim();
  const dmy = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (dmy) {
    const [, dd, MM, yyyy, hh = '0', mi = '0', ss = '0'] = dmy;
    return vietnamWallTimeToDate(yyyy, MM, dd, hh, mi, ss);
  }

  const isoLocal = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (isoLocal) {
    const [, yyyy, MM, dd, hh = '0', mi = '0', ss = '0'] = isoLocal;
    return vietnamWallTimeToDate(yyyy, MM, dd, hh, mi, ss);
  }

  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function isPaymentTransaction(transaction) {
  return normalizeText(transaction.type) === 'thanh toan';
}

/**
 * Ghep 5 cot giao dich (da tach theo "|") thanh mang cac giao dich cua 1 khach.
 * Neu so phan tu giua cac cot lech nhau (du lieu KiotViet khong deu), dung do
 * dai mang lon nhat va de trong phan thieu — khong throw.
 */
function zipTransactions(codes, times, types, values, balances) {
  const length = Math.max(codes.length, times.length, types.length, values.length, balances.length);
  const transactions = [];
  for (let i = 0; i < length; i++) {
    transactions.push({
      code: codes[i] || '',
      time: times[i] || '',
      type: types[i] || '',
      value: toNumber(values[i]),
      runningBalance: toNumber(balances[i])
    });
  }
  return transactions;
}

/**
 * Parse 1 sheet cong no (HN1/HN3/HN7) thanh danh sach khach hang + KPI tong hop.
 * Sheet thuc te co the lap 1 khach tren nhieu dong. Moi khach chi duoc giu 1
 * lan; closingDebt lay tu "Du no cuoi" cua giao dich "Thanh toan" moi nhat
 * khong vuot qua thoi diem hien tai.
 * @param {any[][]} rows - gia tri tho tra ve tu Google Sheets API (rows[0] la header)
 * @param {Date} [now] - thoi diem doi soat (truyen vao de moi sheet dung cung 1 moc)
 * @returns {{customers: object[], kpi: object}}
 */
function parseDebtSheet(rows, now = new Date()) {
  const headers = (rows && rows[0]) || [];
  const columnIndex = buildColumnIndex(headers);
  const nowTime = now instanceof Date && !isNaN(now.getTime()) ? now.getTime() : Date.now();

  const customersByCode = new Map();
  for (let r = 1; r < (rows ? rows.length : 0); r++) {
    const row = rows[r];
    const code = cell(row, columnIndex.code);
    if (!code) continue;

    const normalizedCode = String(code).trim();
    if (!normalizedCode) continue;

    const transactions = zipTransactions(
      splitPipeValues(cell(row, columnIndex.txnCode)),
      splitPipeValues(cell(row, columnIndex.txnTime)),
      splitPipeValues(cell(row, columnIndex.txnType)),
      splitPipeValues(cell(row, columnIndex.txnValue)),
      splitPipeValues(cell(row, columnIndex.txnRunningBalance))
    );

    let customer = customersByCode.get(normalizedCode);
    if (!customer) {
      customer = {
        code: normalizedCode,
        name: cell(row, columnIndex.name) || '',
        phone: cell(row, columnIndex.phone) || '',
        group: cell(row, columnIndex.group) || '',
        openingDebt: toNumber(cell(row, columnIndex.openingDebt)),
        debit: toNumber(cell(row, columnIndex.debit)),
        credit: toNumber(cell(row, columnIndex.credit)),
        // "No cuoi ky" duoc Apps Script lap lai tren MOI dong cua khach (lay tu
        // KiotViet customer.debt hien tai) — dung truc tiep gia tri nay lam mac
        // dinh. Neu tim duoc giao dich "Thanh toan" gan nhat (khong vuot qua
        // thoi diem hien tai) thi tinh chinh lai ben duoi cho chinh xac hon.
        closingDebt: toNumber(cell(row, columnIndex.closingDebt)),
        transactions: [],
        latestPaymentTime: -Infinity
      };
      customersByCode.set(normalizedCode, customer);
    } else {
      // Dien thong tin neu dong dau bi thieu; cac cot tong hop lap lai theo khach
      // nen khong cong don qua tung dong giao dich.
      if (!customer.name) customer.name = cell(row, columnIndex.name) || '';
      if (!customer.phone) customer.phone = cell(row, columnIndex.phone) || '';
      if (!customer.group) customer.group = cell(row, columnIndex.group) || '';
    }

    transactions.forEach(transaction => {
      customer.transactions.push(transaction);
      if (!isPaymentTransaction(transaction)) return;

      const transactionTime = parseTransactionTime(transaction.time);
      if (!transactionTime) return;
      const timestamp = transactionTime.getTime();
      if (timestamp > nowTime || timestamp < customer.latestPaymentTime) return;

      // Neu co 2 dong thanh toan cung thoi gian, dong xuat hien sau trong sheet
      // la dong quyet dinh (thu tu sheet la thu tu nguon tra ve).
      customer.latestPaymentTime = timestamp;
      customer.closingDebt = transaction.runningBalance;
    });
  }

  // Khong loc theo latestPaymentTime nua: mot khach hoan toan co the chi co
  // hoa don/tra hang/dieu chinh trong ky (khong co dong "Thanh toan" nao) va
  // van phai hien thi cong no cua ho — truoc day bi filter loai het nhung
  // khach nay dan den bang trong dashboard du sheet HN1/HN3/HN7 co du lieu.
  const customers = Array.from(customersByCode.values())
    .map(customer => {
      const { latestPaymentTime, ...publicCustomer } = customer;
      return publicCustomer;
    });

  customers.sort((a, b) => b.closingDebt - a.closingDebt);

  const kpi = customers.reduce((acc, c) => {
    acc.totalClosingDebt += c.closingDebt;
    acc.totalDebit += c.debit;
    acc.totalCredit += c.credit;
    if (c.closingDebt > 0) acc.customersWithDebt += 1;
    return acc;
  }, { totalClosingDebt: 0, totalDebit: 0, totalCredit: 0, customersWithDebt: 0 });
  kpi.customersCount = customers.length;

  return { customers, kpi };
}

module.exports = { parseDebtSheet };
