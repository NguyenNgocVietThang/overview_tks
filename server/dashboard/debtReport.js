// ==========================================
// BAO CAO CONG NO THEO KY (HN1/HN3/HN7) — do KiotViet tu quan ly va tu xuat.
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
 * @param {any[][]} rows - gia tri tho tra ve tu Google Sheets API (rows[0] la header)
 * @returns {{customers: object[], kpi: object}}
 */
function parseDebtSheet(rows) {
  const headers = (rows && rows[0]) || [];
  const columnIndex = buildColumnIndex(headers);

  const customers = [];
  for (let r = 1; r < (rows ? rows.length : 0); r++) {
    const row = rows[r];
    const code = cell(row, columnIndex.code);
    if (!code) continue;

    const transactions = zipTransactions(
      splitPipeValues(cell(row, columnIndex.txnCode)),
      splitPipeValues(cell(row, columnIndex.txnTime)),
      splitPipeValues(cell(row, columnIndex.txnType)),
      splitPipeValues(cell(row, columnIndex.txnValue)),
      splitPipeValues(cell(row, columnIndex.txnRunningBalance))
    );

    customers.push({
      code: String(code).trim(),
      name: cell(row, columnIndex.name) || '',
      phone: cell(row, columnIndex.phone) || '',
      group: cell(row, columnIndex.group) || '',
      openingDebt: toNumber(cell(row, columnIndex.openingDebt)),
      debit: toNumber(cell(row, columnIndex.debit)),
      credit: toNumber(cell(row, columnIndex.credit)),
      closingDebt: toNumber(cell(row, columnIndex.closingDebt)),
      transactions
    });
  }

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
