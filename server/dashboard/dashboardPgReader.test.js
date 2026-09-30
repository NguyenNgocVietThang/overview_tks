'use strict';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const CONFIG = require('../config');
const {
  createDashboardPgReader, SHEET_NAMES, CORE_SHEET_NAMES, EXPORT_SHEET_NAMES, __headers__, __tabs__,
  readRowsByCodes: readRowsByCodesFromModule
} = require('./dashboardPgReader');

// pool gia: ghi lai TOAN BO cac lan goi query (theo dung thu tu TABS.map goi
// dong bo tung phan tu — xem readDashboardSheets) va tra ve dong tuy chinh
// theo tung tab qua `rowsBySheetName` (khop bang cach tim "-- tab: <ten>"
// trong dau chuoi SQL — moi cau SQL trong dashboardPgReader.js deu co comment
// nay, xem TABS).
function fakePool(rowsBySheetName = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      // Truy van phu 'Đang vận chuyển' (tab Hang hoa) khong thuoc cac phep dem cau SQL cua tab.
      if (String(sql).includes('-- in-transit')) return { rows: [] };
      calls.push({ sql, params });
      const match = SHEET_NAMES.find(name => sql.includes(`-- tab: ${name}`));
      return { rows: rowsBySheetName[match] || [] };
    }
  };
}

test('readDashboardSheets tra dung 7 sheet, dung header (ten + thu tu) nhu Sheets that', async () => {
  const pool = fakePool();
  const reader = createDashboardPgReader({ pool });
  const sheets = await reader.readDashboardSheets('Hà Nội');

  assert.deepEqual(Object.keys(sheets).sort(), SHEET_NAMES.slice().sort());
  SHEET_NAMES.forEach(name => {
    assert.deepEqual(sheets[name][0], __headers__[name], `header cua "${name}" phai dung ten + thu tu`);
  });
});

test('readDashboardSheets truyen dung branch code Postgres (hanoi/saigon) cho ca 7 truy van', async () => {
  const pool = fakePool();
  const reader = createDashboardPgReader({ pool });

  await reader.readDashboardSheets('Hà Nội');
  assert.equal(pool.calls.length, SHEET_NAMES.length);
  pool.calls.forEach(call => assert.deepEqual(call.params, ['hanoi']));

  pool.calls.length = 0;
  await reader.readDashboardSheets('Sài Gòn');
  assert.equal(pool.calls.length, SHEET_NAMES.length);
  pool.calls.forEach(call => assert.deepEqual(call.params, ['saigon']));
});

test('readDashboardSheets tu choi branch khong hop le, khong query Postgres', async () => {
  const pool = fakePool();
  const reader = createDashboardPgReader({ pool });
  await assert.rejects(
    () => reader.readDashboardSheets('Không tồn tại'),
    err => err.statusCode === 400 && err.code === 'INVALID_BRANCH'
  );
  assert.equal(pool.calls.length, 0);
});

test('readDashboardSheets: Hang hoa map dung gia tri theo TEN COT (khong theo vi tri object tra ve)', async () => {
  const pool = fakePool({
    [CONFIG.SHEET_PRODUCTS]: [{
      ma_hang: 'SP-01', ten_hang: 'Sản phẩm một', nhom_hang: 'Đồ gỗ', loai_hang: 'Hàng hóa',
      gia_von: '', gia_ban: 150000, ton_kho: '', khach_dat: '', trang_thai: 'Đang kinh doanh',
      ngay_sua_cuoi: '10/08/2026 10:00', ma_nhom_hang: '5', vi_tri: '', id_hang_hoa: '99',
      id_gian_hang: '1', duoc_phep_ban: 'Có', ten_goc: 'Sản phẩm một', mo_ta: '',
      gia_tri_quy_doi: 1, co_thuoc_tinh: 'Không', dang_hoat_dong: 'Có',
      ngay_tao: '01/01/2026 08:00', ngay_cap_nhat: '10/08/2026 10:00', ma_loai_hang: '2'
    }]
  });
  const reader = createDashboardPgReader({ pool });
  const sheets = await reader.readDashboardSheets('Hà Nội');
  const header = sheets[CONFIG.SHEET_PRODUCTS][0];
  const row = sheets[CONFIG.SHEET_PRODUCTS][1];

  assert.equal(row[header.indexOf('Mã hàng')], 'SP-01');
  assert.equal(row[header.indexOf('Tên hàng')], 'Sản phẩm một');
  assert.equal(row[header.indexOf('Giá bán')], 150000);
  assert.equal(row[header.indexOf('Trạng thái')], 'Đang kinh doanh');
  assert.equal(row.length, header.length, 'moi dong phai co du so cot nhu header');
});

test('readDashboardSheets: sheet khong co du lieu tra ve mang rong (chi con header)', async () => {
  const pool = fakePool({ [CONFIG.SHEET_INVOICES]: [] });
  const reader = createDashboardPgReader({ pool });
  const sheets = await reader.readDashboardSheets('Hà Nội');
  assert.deepEqual(sheets[CONFIG.SHEET_INVOICES], [__headers__[CONFIG.SHEET_INVOICES]]);
});

test('SHEET_NAMES khop dung 7 tab KiotViet, KHONG bao gom Bao cao ban hang (SHEET_CUSTOMER_REPORT) — co chu dich kich hoat fallback trong dashboardData.js', () => {
  assert.equal(SHEET_NAMES.length, 7);
  assert.ok(!SHEET_NAMES.includes(CONFIG.SHEET_CUSTOMER_REPORT));
  assert.deepEqual(SHEET_NAMES, [
    CONFIG.SHEET_CATEGORIES, CONFIG.SHEET_PRODUCTS, CONFIG.SHEET_INVOICES,
    CONFIG.SHEET_INVOICE_DETAILS, CONFIG.SHEET_ORDERS, CONFIG.SHEET_RETURNS,
    CONFIG.SHEET_CUSTOMERS
  ]);
});

test('CORE_SHEET_NAMES khop dung 6 tab, bo "Chi tiết hóa đơn" (tab nang nhat, thay bang dashboardRollupRepository.js)', () => {
  assert.equal(CORE_SHEET_NAMES.length, 6);
  assert.ok(!CORE_SHEET_NAMES.includes(CONFIG.SHEET_INVOICE_DETAILS));
  assert.deepEqual(CORE_SHEET_NAMES, [
    CONFIG.SHEET_CATEGORIES, CONFIG.SHEET_PRODUCTS, CONFIG.SHEET_INVOICES,
    CONFIG.SHEET_ORDERS, CONFIG.SHEET_RETURNS, CONFIG.SHEET_CUSTOMERS
  ]);
});

test('readCoreDashboardSheets: CHI chay 6 cau SQL (khong chay roi bo ket qua cua tab nang nhat)', async () => {
  const pool = fakePool();
  const reader = createDashboardPgReader({ pool });
  const sheets = await reader.readCoreDashboardSheets('Hà Nội');

  assert.equal(pool.calls.length, CORE_SHEET_NAMES.length, 'khong duoc chay cau SQL cua "Chi tiết hóa đơn"');
  assert.deepEqual(Object.keys(sheets).sort(), CORE_SHEET_NAMES.slice().sort());
  assert.equal(sheets[CONFIG.SHEET_INVOICE_DETAILS], undefined);
  pool.calls.forEach(call => assert.deepEqual(call.params, ['hanoi']));
});

test('readCoreDashboardSheets tu choi branch khong hop le, khong query Postgres', async () => {
  const pool = fakePool();
  const reader = createDashboardPgReader({ pool });
  await assert.rejects(
    () => reader.readCoreDashboardSheets('Không tồn tại'),
    err => err.statusCode === 400 && err.code === 'INVALID_BRANCH'
  );
  assert.equal(pool.calls.length, 0);
});

test('readCoreDashboardSheets mo rong Ca hai thanh hai nguon vat ly va gan provenance cho giao dich', async () => {
  const invoiceColumns = __tabs__[CONFIG.SHEET_INVOICES].columns;
  const pool = {
    calls: [],
    async query(sql, params) {
      // Truy van phu 'Đang vận chuyển' (tab Hang hoa) khong thuoc cac phep dem cau SQL cua tab.
      if (String(sql).includes('-- in-transit')) return { rows: [] };
      this.calls.push({ sql, params });
      if (!sql.includes(`-- tab: ${CONFIG.SHEET_INVOICES}`)) return { rows: [] };
      const row = Object.fromEntries(invoiceColumns.map(column => [column, '']));
      row.ma_hoa_don = 'HD-TRUNG';
      row.chi_nhanh = 'ten-kho-khong-dung-lam-provenance';
      return { rows: [row] };
    }
  };
  const reader = createDashboardPgReader({ pool });

  const sheets = await reader.readCoreDashboardSheets('Cả hai');

  assert.equal(pool.calls.length, CORE_SHEET_NAMES.length * 2);
  assert.deepEqual(
    pool.calls.map(call => call.params[0]),
    [...Array(CORE_SHEET_NAMES.length).fill('hanoi'), ...Array(CORE_SHEET_NAMES.length).fill('saigon')]
  );
  const header = sheets[CONFIG.SHEET_INVOICES][0];
  const branchIndex = header.indexOf('Chi nhánh');
  assert.deepEqual(
    sheets[CONFIG.SHEET_INVOICES].slice(1).map(row => [row[0], row[branchIndex]]),
    [['HD-TRUNG', 'Hà Nội'], ['HD-TRUNG', 'Sài Gòn']]
  );
});

// ==========================================
// readRowsByCodes — doc THEO MA phuc vu Xuat Excel (chi 7 tab xuat duoc).
// Loc theo ma o phia Postgres bang tham so `$2` (text[]); khong nap ca tab.
// ==========================================
// Alias cot ma ky vong cua tung tab xuat duoc.
const EXPORT_CODE_COLUMNS = {
  [CONFIG.SHEET_PRODUCTS]: 'ma_hang',
  [CONFIG.SHEET_INVOICES]: 'ma_hoa_don',
  [CONFIG.SHEET_ORDERS]: 'ma_dat_hang',
  [CONFIG.SHEET_RETURNS]: 'ma_tra_hang',
  [CONFIG.SHEET_CUSTOMERS]: 'ma_khach_hang'
};

// Dieu kien loc ma ky vong chen vao WHERE cua tung tab — bieu thuc cot GOC cua
// bang (co alias bang trong truy van), KHONG phai alias trong SELECT.
const EXPECTED_CODE_FILTERS = {
  [CONFIG.SHEET_PRODUCTS]: 'AND code = ANY($2::text[])',
  [CONFIG.SHEET_INVOICES]: 'AND i.code = ANY($2::text[])',
  [CONFIG.SHEET_ORDERS]: 'AND code = ANY($2::text[])',
  [CONFIG.SHEET_RETURNS]: 'AND code = ANY($2::text[])',
  [CONFIG.SHEET_CUSTOMERS]: 'AND code = ANY($2::text[])'
};

// pool gia cho readRowsByCodes: `makeRows(params, callIndex, sql)` tra dong cho
// tung lan goi (co the throw de gia lap loi Postgres) va do so cau truy van
// chay DONG THOI (moi lan query nhuong 1 luot event loop de lo chong nhau lo ra).
function fakeCodePool(makeRows = () => []) {
  const calls = [];
  let inFlight = 0;
  const pool = {
    calls,
    maxInFlight: 0,
    async query(sql, params) {
      // Truy van phu 'Đang vận chuyển' (tab Hang hoa) khong thuoc cac phep dem cau SQL cua tab.
      if (String(sql).includes('-- in-transit')) return { rows: [] };
      calls.push({ sql, params });
      const callIndex = calls.length - 1;
      inFlight += 1;
      pool.maxInFlight = Math.max(pool.maxInFlight, inFlight);
      await new Promise(resolve => setImmediate(resolve));
      inFlight -= 1;
      return { rows: makeRows(params, callIndex, sql) };
    }
  };
  return pool;
}

function makeCodes(count, prefix = 'MA') {
  return Array.from({ length: count }, (_, i) => `${prefix}${String(i).padStart(6, '0')}`);
}

test('EXPORT_SHEET_NAMES la dung 5 tab xuat duoc (theo thu tu TABS), khong gom "Nhóm hàng"/"Chi tiết hóa đơn"', () => {
  assert.deepEqual(EXPORT_SHEET_NAMES, [
    CONFIG.SHEET_PRODUCTS, CONFIG.SHEET_INVOICES, CONFIG.SHEET_ORDERS, CONFIG.SHEET_RETURNS,
    CONFIG.SHEET_CUSTOMERS
  ]);
  assert.ok(!EXPORT_SHEET_NAMES.includes(CONFIG.SHEET_CATEGORIES));
  assert.ok(!EXPORT_SHEET_NAMES.includes(CONFIG.SHEET_INVOICE_DETAILS));
  EXPORT_SHEET_NAMES.forEach(name => assert.ok(SHEET_NAMES.includes(name), `"${name}" phai la 1 trong 7 tab`));
});

test('__tabs__: du 7 tab, headers/columns khop __headers__, codeColumn dung (null voi 2 tab khong xuat duoc), la ban sao', () => {
  assert.deepEqual(Object.keys(__tabs__).sort(), SHEET_NAMES.slice().sort());
  SHEET_NAMES.forEach(name => {
    const tab = __tabs__[name];
    assert.deepEqual(tab.headers, __headers__[name], `headers cua "${name}" phai giong __headers__`);
    assert.notStrictEqual(tab.headers, __headers__[name], `headers cua "${name}" phai la BAN SAO, khong dung chung mang voi TABS`);
    assert.equal(tab.columns.length, tab.headers.length, `"${name}": so alias phai bang so header`);
    assert.equal(new Set(tab.columns).size, tab.columns.length, `"${name}": alias khong duoc trung nhau`);
    if (EXPORT_SHEET_NAMES.includes(name)) {
      assert.equal(tab.codeColumn, EXPORT_CODE_COLUMNS[name], `codeColumn cua "${name}"`);
      assert.ok(tab.columns.includes(tab.codeColumn), `codeColumn cua "${name}" phai la 1 alias trong columns`);
    } else {
      assert.equal(tab.codeColumn, null, `"${name}" khong xuat Excel nen codeColumn = null`);
    }
  });
});

test('readRowsByCodes: dung params [branchCode, [codes]] cho ca hanoi/saigon o ca 5 tab, moi tab chay dung 1 cau SQL cua chinh tab do', async () => {
  for (const [label, branchCode] of [['Hà Nội', 'hanoi'], ['Sài Gòn', 'saigon']]) {
    for (const name of EXPORT_SHEET_NAMES) {
      const pool = fakePool();
      const reader = createDashboardPgReader({ pool });
      await reader.readRowsByCodes(name, label, ['MA-01', 'MA-02']);

      assert.equal(pool.calls.length, 1, `"${name}"/${label}: dung 1 cau truy van`);
      const { sql, params } = pool.calls[0];
      assert.ok(sql.includes(`-- tab: ${name}`), `"${name}": phai chay dung cau SQL cua tab do`);
      assert.deepEqual(params, [branchCode, ['MA-01', 'MA-02']], `"${name}"/${label}: params`);
      assert.ok(sql.includes('ANY($2'), `"${name}": SQL phai loc bang ANY($2...)`);
      assert.ok(sql.includes(EXPECTED_CODE_FILTERS[name]), `"${name}": dieu kien loc ma`);
    }
  }
});

test('readRowsByCodes: SQL loc chi them dung cac dong dieu kien ma so voi SQL khong loc (ban khong loc khong doi)', async () => {
  const basePool = fakePool();
  await createDashboardPgReader({ pool: basePool }).readDashboardSheets('Hà Nội');
  const baseSql = name => basePool.calls.find(call => call.sql.includes(`-- tab: ${name}`)).sql;

  for (const name of EXPORT_SHEET_NAMES) {
    const pool = fakePool();
    await createDashboardPgReader({ pool }).readRowsByCodes(name, 'Hà Nội', ['MA-01']);

    const lines = pool.calls[0].sql.split('\n');
    const filterLines = lines.filter(line => line.includes('ANY($2::text[])'));
    assert.equal(filterLines.length, 1, `"${name}": so dong dieu kien ma them vao`);
    assert.equal(
      lines.filter(line => !line.includes('ANY($2::text[])')).join('\n'),
      baseSql(name),
      `"${name}": bo cac dong loc ma thi phai ra dung SQL khong loc`
    );
    assert.ok(!baseSql(name).includes('$2'), `"${name}": SQL khong loc khong duoc co tham so $2`);
    assert.ok(!baseSql(name).includes('ANY('), `"${name}": SQL khong loc khong duoc co ANY(`);
  }
});

test('readRowsByCodes: ma di bang THAM SO, SQL khong bao gio chua ma (chong noi chuoi SQL)', async () => {
  const hostile = ["X'; DROP TABLE invoices; --", 'HD"001', "O'Brien) OR 1=1 --", 'SP\\01', 'MA_DAC_BIET_12345'];
  for (const name of EXPORT_SHEET_NAMES) {
    const pool = fakePool();
    await createDashboardPgReader({ pool }).readRowsByCodes(name, 'Sài Gòn', hostile);

    const { sql, params } = pool.calls[0];
    assert.ok(sql.includes('ANY($2'), `"${name}": phai loc bang tham so`);
    hostile.forEach(code => assert.ok(!sql.includes(code), `"${name}": SQL khong duoc chua ma ${JSON.stringify(code)}`));
    assert.equal(params.length, 2);
    assert.deepEqual(params[1], hostile, `"${name}": ma phai nam nguyen ven trong mang tham so`);
  }
});

test('readRowsByCodes: khu trung lap (giu thu tu xuat hien dau tien), bo phan tu rong / chi khoang trang / khong phai chuoi / chua NUL, KHONG trim', async () => {
  const pool = fakePool();
  const reader = createDashboardPgReader({ pool });
  await reader.readRowsByCodes(CONFIG.SHEET_PRODUCTS, 'Hà Nội', [
    'SP-02', 'SP-01', 'SP-02', '', '   ', null, undefined, 42, {}, [], ['SP-01'], true,
    'SP-01', 'SP\x003', 'SP 03', ' SP-04 '
  ]);
  assert.deepEqual(pool.calls[0].params, ['hanoi', ['SP-02', 'SP-01', 'SP 03', ' SP-04 ']]);

  // Set cung duoc chap nhan (khu trung lap san).
  pool.calls.length = 0;
  await reader.readRowsByCodes(CONFIG.SHEET_PRODUCTS, 'Hà Nội', new Set(['B', 'A', 'B']));
  assert.deepEqual(pool.calls[0].params, ['hanoi', ['B', 'A']]);
});

test('readRowsByCodes: mang rong / toan ma khong hop le / khong phai mang -> KHONG query, tra {columns, rows: []}', async () => {
  const pool = fakePool();
  const reader = createDashboardPgReader({ pool });
  const expectedColumns = __tabs__[CONFIG.SHEET_INVOICES].columns;

  for (const codes of [[], ['', '  ', null, undefined, 7], undefined, null, 'HD000001', {}]) {
    const result = await reader.readRowsByCodes(CONFIG.SHEET_INVOICES, 'Hà Nội', codes);
    assert.deepEqual(result, { columns: expectedColumns, rows: [] }, `codes = ${JSON.stringify(codes)}`);
  }
  assert.equal(pool.calls.length, 0, 'khong co ma hop le thi khong duoc cham Postgres');
});

test('readRowsByCodes: <= 20000 ma (sau khu trung lap) chay dung 1 cau truy van, > 20000 ma chia lo 5000 va noi ket qua theo thu tu lo', async () => {
  // Bien: dung 20000 ma -> 1 cau; 20005 phan tu nhung chi 20000 ma duy nhat -> van 1 cau
  // (nguong tinh SAU khi khu trung lap).
  const exact = makeCodes(20000);
  const poolExact = fakeCodePool();
  await createDashboardPgReader({ pool: poolExact }).readRowsByCodes(CONFIG.SHEET_PRODUCTS, 'Hà Nội', exact);
  assert.equal(poolExact.calls.length, 1);
  assert.equal(poolExact.calls[0].params[1].length, 20000);

  const poolDup = fakeCodePool();
  await createDashboardPgReader({ pool: poolDup }).readRowsByCodes(CONFIG.SHEET_PRODUCTS, 'Hà Nội', [...exact, ...exact.slice(0, 5)]);
  assert.equal(poolDup.calls.length, 1, 'trung lap khong duoc tinh vao nguong chia lo');

  // 20001 ma -> 5 lo: 5000 x 4 + 1. Moi lo tra 2 dong danh dau theo lo.
  const many = makeCodes(20001);
  const pool = fakeCodePool((params, callIndex) => [
    { ma_hang: `lo${callIndex}-a`, ten_hang: 'X' },
    { ma_hang: `lo${callIndex}-b`, ten_hang: 'Y' }
  ]);
  const result = await createDashboardPgReader({ pool }).readRowsByCodes(CONFIG.SHEET_PRODUCTS, 'Sài Gòn', many);

  assert.deepEqual(pool.calls.map(call => call.params[1].length), [5000, 5000, 5000, 5000, 1]);
  pool.calls.forEach((call, index) => {
    assert.equal(call.params[0], 'saigon');
    assert.deepEqual(call.params[1], many.slice(index * 5000, (index + 1) * 5000), `lo ${index}: ma theo dung thu tu dau vao`);
    assert.ok(call.sql.includes('-- tab: Hàng hóa') && call.sql.includes('ANY($2'), `lo ${index}: dung SQL loc ma cua tab`);
  });
  assert.equal(pool.maxInFlight, 1, 'cac lo chay TUAN TU, khong chiem nhieu ket noi cung luc');
  assert.deepEqual(
    result.rows.map(row => row.ma_hang),
    [0, 1, 2, 3, 4].flatMap(i => [`lo${i}-a`, `lo${i}-b`]),
    'ket qua noi theo thu tu lo'
  );
});

test('readRowsByCodes: loi Postgres o 1 lo lam ca ham loi, dung ngay (khong chay tiep cac lo sau)', async () => {
  const pool = fakeCodePool((params, callIndex) => {
    if (callIndex === 1) throw new Error('mat ket noi Postgres');
    return [];
  });
  await assert.rejects(
    () => createDashboardPgReader({ pool }).readRowsByCodes(CONFIG.SHEET_PRODUCTS, 'Hà Nội', makeCodes(20001)),
    /mat ket noi Postgres/
  );
  assert.equal(pool.calls.length, 2);
});

test('readRowsByCodes: tu choi tab khong xuat duoc (EXPORT_SOURCE_NOT_ALLOWED, 400), kiem tra TRUOC khi xet ma, khong query Postgres', async () => {
  const notAllowed = [
    CONFIG.SHEET_CATEGORIES, CONFIG.SHEET_INVOICE_DETAILS, CONFIG.SHEET_CUSTOMER_REPORT,
    'Không có tab này', '', undefined, null, 42, 'constructor', '__proto__', 'toString'
  ];
  const pool = fakePool();
  const reader = createDashboardPgReader({ pool });
  for (const sheetName of notAllowed) {
    for (const codes of [['MA-01'], []]) {
      await assert.rejects(
        () => reader.readRowsByCodes(sheetName, 'Hà Nội', codes),
        err => err.statusCode === 400 && err.code === 'EXPORT_SOURCE_NOT_ALLOWED',
        `tab ${String(sheetName)} / codes ${JSON.stringify(codes)} phai bi tu choi`
      );
    }
  }
  assert.equal(pool.calls.length, 0);
});

test('readRowsByCodes: tu choi co so khong hop le (INVALID_BRANCH, 400) ke ca khi danh sach ma rong, khong query Postgres', async () => {
  const pool = fakePool();
  const reader = createDashboardPgReader({ pool });
  // 'Cả hai' la gia tri phan quyen, khong phai 1 co so don; 'hanoi' la ma Postgres, khong phai nhan hien thi.
  for (const branch of ['Không tồn tại', 'Cả hai', 'hanoi']) {
    for (const codes of [['MA-01'], []]) {
      await assert.rejects(
        () => reader.readRowsByCodes(CONFIG.SHEET_PRODUCTS, branch, codes),
        err => err.statusCode === 400 && err.code === 'INVALID_BRANCH',
        `co so ${JSON.stringify(branch)} / codes ${JSON.stringify(codes)} phai bi tu choi`
      );
    }
  }
  assert.equal(pool.calls.length, 0);
});

test('readRowsByCodes: bo trong co so -> mac dinh Ha Noi (giong readDashboardSheets/queryTabs)', async () => {
  for (const branch of [undefined, null, '']) {
    const pool = fakePool();
    await createDashboardPgReader({ pool }).readRowsByCodes(CONFIG.SHEET_PRODUCTS, branch, ['SP-01']);
    assert.deepEqual(pool.calls[0].params, ['hanoi', ['SP-01']], `branch = ${JSON.stringify(branch)}`);
  }
});

test('readRowsByCodes: moi row la object khoa theo alias dung thu tu columns, bo khoa thua, alias khop columns o ca 5 tab', async () => {
  for (const name of EXPORT_SHEET_NAMES) {
    const { columns, codeColumn } = __tabs__[name];
    // Dong tu Postgres voi khoa xep NGUOC thu tu columns + 1 khoa thua: dau ra phai theo columns.
    const pgRow = Object.fromEntries(columns.slice().reverse().map(column => [column, column === codeColumn ? 'MA-01' : 1.5]));
    pgRow.khoa_thua = 'x';
    const pool = fakeCodePool(() => [pgRow]);
    const result = await createDashboardPgReader({ pool }).readRowsByCodes(name, 'Hà Nội', ['MA-01']);

    assert.deepEqual(result.columns, columns, `"${name}": columns dung thu tu tab`);
    assert.equal(result.rows.length, 1);
    assert.deepEqual(Object.keys(result.rows[0]), columns, `"${name}": khoa cua row phai trung columns, dung thu tu`);
    assert.ok(!('khoa_thua' in result.rows[0]), `"${name}": khoa thua tu Postgres bi bo`);
    assert.equal(result.rows[0][codeColumn], 'MA-01');
  }
});

test('readRowsByCodes: giu nguyen kieu gia tri (ngay DD/MM/YYYY HH24:MI, so la number) va thu tu dong Postgres tra ve', async () => {
  const pool = fakeCodePool(() => [
    { ma_hoa_don: 'HD000003', ngay_ban: '10/08/2026 11:10', tong_tien_hang: 150000, giam_gia: 0.5, trang_thai: 'Hoàn thành' },
    { ma_hoa_don: 'HD000001', ngay_ban: '', tong_tien_hang: 0 },
    { ma_hoa_don: 'HD000002', ngay_ban: '01/01/2026 08:00', tong_tien_hang: 20 }
  ]);
  const result = await createDashboardPgReader({ pool }).readRowsByCodes(CONFIG.SHEET_INVOICES, 'Hà Nội', ['HD000001', 'HD000002', 'HD000003']);

  assert.deepEqual(result.rows.map(row => row.ma_hoa_don), ['HD000003', 'HD000001', 'HD000002'], 'khong duoc sap xep lai — thu tu la ORDER BY cua SQL');
  assert.equal(result.rows[0].ngay_ban, '10/08/2026 11:10');
  assert.equal(typeof result.rows[0].tong_tien_hang, 'number');
  assert.equal(result.rows[0].tong_tien_hang, 150000);
  assert.equal(result.rows[0].giam_gia, 0.5);
  assert.equal(result.rows[0].trang_thai, 'Hoàn thành');
  assert.equal(result.rows[1].ngay_ban, '');
});

test('readRowsByCodes: columns tra ve la ban sao moi lan goi (sua khong anh huong lan sau / __tabs__); Postgres tra ve rong/thieu rows van an toan', async () => {
  const pool = { async query() { return undefined; } };
  const reader = createDashboardPgReader({ pool });

  const first = await reader.readRowsByCodes(CONFIG.SHEET_PRODUCTS, 'Hà Nội', ['SP-01']);
  assert.deepEqual(first.rows, []);
  first.columns.push('rac');
  const second = await reader.readRowsByCodes(CONFIG.SHEET_PRODUCTS, 'Hà Nội', ['SP-01']);
  assert.deepEqual(second.columns, __tabs__[CONFIG.SHEET_PRODUCTS].columns);
  assert.ok(!second.columns.includes('rac'));

  const poolNoRows = { async query() { return {}; } };
  const third = await createDashboardPgReader({ pool: poolNoRows }).readRowsByCodes(CONFIG.SHEET_PRODUCTS, 'Hà Nội', ['SP-01']);
  assert.deepEqual(third.rows, []);
});

test('readRowsByCodes khong lam doi readDashboardSheets/readCoreDashboardSheets: SQL van khong tham so $2, params chi [branchCode], ket qua y het', async () => {
  const pool = fakePool({
    [CONFIG.SHEET_PRODUCTS]: [{ ma_hang: 'SP-01', ten_hang: 'Sản phẩm một', gia_ban: 150000 }]
  });
  const reader = createDashboardPgReader({ pool });
  const before = await reader.readDashboardSheets('Hà Nội');
  await reader.readRowsByCodes(CONFIG.SHEET_PRODUCTS, 'Hà Nội', ['SP-01']);

  pool.calls.length = 0;
  const after = await reader.readDashboardSheets('Hà Nội');
  assert.deepEqual(after, before, 'readDashboardSheets phai ra ket qua y het sau khi goi readRowsByCodes');
  assert.equal(pool.calls.length, SHEET_NAMES.length);
  pool.calls.forEach(call => {
    assert.ok(!call.sql.includes('$2') && !call.sql.includes('ANY('), 'SQL khong loc khong duoc co $2/ANY(');
    assert.deepEqual(call.params, ['hanoi']);
  });

  pool.calls.length = 0;
  await reader.readCoreDashboardSheets('Sài Gòn');
  assert.equal(pool.calls.length, CORE_SHEET_NAMES.length);
  pool.calls.forEach(call => {
    assert.ok(!call.sql.includes('$2') && !call.sql.includes('ANY('));
    assert.deepEqual(call.params, ['saigon']);
  });
});

test('readRowsByCodes (export module-level): la ham, tu choi tab khong xuat duoc va bo qua ma rong ma KHONG cham DB', async () => {
  assert.equal(typeof readRowsByCodesFromModule, 'function');
  await assert.rejects(
    () => readRowsByCodesFromModule(CONFIG.SHEET_CATEGORIES, 'Hà Nội', ['1']),
    err => err.statusCode === 400 && err.code === 'EXPORT_SOURCE_NOT_ALLOWED'
  );
  await assert.rejects(
    () => readRowsByCodesFromModule(CONFIG.SHEET_PRODUCTS, 'Không tồn tại', ['SP-01']),
    err => err.statusCode === 400 && err.code === 'INVALID_BRANCH'
  );
  const result = await readRowsByCodesFromModule(CONFIG.SHEET_PRODUCTS, 'Hà Nội', []);
  assert.deepEqual(result, { columns: __tabs__[CONFIG.SHEET_PRODUCTS].columns, rows: [] });
});

test('readRowsByCodes: signal da huy -> dung truoc lo ke tiep (EXPORT_ABORTED), khong chay not cac lo con lai', async () => {
  const controller = new AbortController();
  const pool = fakeCodePool(() => {
    controller.abort();
    return [];
  });
  const reader = createDashboardPgReader({ pool });
  await assert.rejects(
    reader.readRowsByCodes(CONFIG.SHEET_PRODUCTS, 'Hà Nội', makeCodes(20001), { signal: controller.signal }),
    error => error.code === 'EXPORT_ABORTED' && error.statusCode === 499
  );
  assert.equal(pool.calls.length, 1, 'huy sau lo dau thi chi 1 cau truy van duoc chay');

  // Da huy san -> khong query nao; khong truyen signal -> chay het nhu cu.
  const poolPre = fakeCodePool();
  const pre = new AbortController();
  pre.abort();
  await assert.rejects(
    createDashboardPgReader({ pool: poolPre }).readRowsByCodes(CONFIG.SHEET_PRODUCTS, 'Hà Nội', ['A'], { signal: pre.signal }),
    error => error.code === 'EXPORT_ABORTED'
  );
  assert.equal(poolPre.calls.length, 0);
  const poolFull = fakeCodePool();
  await createDashboardPgReader({ pool: poolFull }).readRowsByCodes(CONFIG.SHEET_PRODUCTS, 'Hà Nội', makeCodes(20001));
  assert.equal(poolFull.calls.length, 5);
});

test('readCoreDashboardSheets(branch, sheetNames): CHI chay cau SQL cua cac bang duoc chon (bang khac khong bi doc)', async () => {
  const pool = fakePool();
  const reader = createDashboardPgReader({ pool });
  const wanted = [CONFIG.SHEET_PRODUCTS, CONFIG.SHEET_INVOICES];
  const sheets = await reader.readCoreDashboardSheets('Hà Nội', wanted);

  assert.equal(pool.calls.length, 2, 'moi bang duoc chon dung 1 cau SQL, khong doc 5 bang con lai (vd Dat hang ~23K dong)');
  assert.deepEqual(Object.keys(sheets).sort(), wanted.slice().sort());
  pool.calls.forEach(call => assert.deepEqual(call.params, ['hanoi']));
  assert.ok(pool.calls.some(call => call.sql.includes(`-- tab: ${CONFIG.SHEET_PRODUCTS}`)));
  assert.ok(!pool.calls.some(call => call.sql.includes(`-- tab: ${CONFIG.SHEET_ORDERS}`)));
});

test('readCoreDashboardSheets(branch, sheetNames): ten khong thuoc 6 bang core (Chi tiet hoa don/la) bi bo qua, mang rong = khong query', async () => {
  const pool = fakePool();
  const reader = createDashboardPgReader({ pool });
  const sheets = await reader.readCoreDashboardSheets('Hà Nội', [CONFIG.SHEET_INVOICE_DETAILS, 'khong-co']);
  assert.deepEqual(sheets, {});
  assert.equal(pool.calls.length, 0);

  const none = await reader.readCoreDashboardSheets('Hà Nội', []);
  assert.deepEqual(none, {});
  assert.equal(pool.calls.length, 0);
});

test('readCoreDashboardSheets(branch, sheetNames) van mo rong "Ca hai" thanh hai co so vat ly cho bang duoc chon', async () => {
  const pool = fakePool();
  const reader = createDashboardPgReader({ pool });
  await reader.readCoreDashboardSheets('Cả hai', [CONFIG.SHEET_CUSTOMERS]);
  assert.deepEqual(pool.calls.map(call => call.params[0]).sort(), ['hanoi', 'saigon']);
});

test('moi tab co cot "Cơ sở" o CUOI (alias co_so) va SQL dien nhan co so tu tham so $1', () => {
  SHEET_NAMES.forEach(name => {
    const tab = __tabs__[name];
    assert.equal(tab.headers[tab.headers.length - 1], 'Cơ sở', `"${name}": header cuoi la Cơ sở`);
    assert.equal(tab.columns[tab.columns.length - 1], 'co_so', `"${name}": alias cuoi la co_so`);
  });
});

test('readDashboardSheets: SQL moi tab chon nhan co so theo $1 (hanoi -> Hà Nội, saigon -> Sài Gòn)', async () => {
  const pool = fakePool();
  await createDashboardPgReader({ pool }).readDashboardSheets('Hà Nội');
  assert.equal(pool.calls.length, SHEET_NAMES.length);
  pool.calls.forEach(call => {
    assert.match(call.sql, /CASE \$1::text WHEN 'saigon' THEN 'Sài Gòn' ELSE 'Hà Nội' END\s+AS co_so/);
  });
});

test('readDashboardSheets: gia tri Cơ sở duoc dua ra cot cuoi cua moi dong (Ca hai gop hai co so)', async () => {
  const productRow = { ma_hang: 'SP-1', ten_hang: 'Áo', trang_thai: 'Đang kinh doanh' };
  const pool = {
    calls: [],
    async query(sql, params) {
      this.calls.push({ sql, params });
      if (!sql.includes(`-- tab: ${CONFIG.SHEET_PRODUCTS}`)) return { rows: [] };
      return { rows: [{ ...productRow, co_so: params[0] === 'hanoi' ? 'Hà Nội' : 'Sài Gòn' }] };
    }
  };
  const sheets = await createDashboardPgReader({ pool }).readDashboardSheets('Cả hai');
  const products = sheets[CONFIG.SHEET_PRODUCTS];
  const facilityIndex = products[0].indexOf('Cơ sở');
  assert.deepEqual(products.slice(1).map(row => row[facilityIndex]), ['Hà Nội', 'Sài Gòn'], 'cung ma nhung hai dong rieng');
});

test('tab Hang hoa chi lay hang dang kinh doanh (is_active IS NOT FALSE), ca ban loc theo ma', async () => {
  const pool = fakePool();
  const reader = createDashboardPgReader({ pool });
  await reader.readDashboardSheets('Hà Nội');
  await reader.readRowsByCodes(CONFIG.SHEET_PRODUCTS, 'Hà Nội', ['SP-1']);
  const productSql = pool.calls
    .filter(call => call.sql.includes(`-- tab: ${CONFIG.SHEET_PRODUCTS}`))
    .map(call => call.sql);
  assert.equal(productSql.length, 2);
  productSql.forEach(sql => assert.match(sql, /AND is_active IS NOT FALSE/));
});

// ---------- "Đang vận chuyển" (Hàng hóa) ----------

function inTransitPool({ inTransitRows = [], productRows = [], failInTransit = false } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('-- in-transit')) {
        if (failInTransit) { const error = new Error('relation "order_suppliers" does not exist'); error.code = '42P01'; throw error; }
        return { rows: inTransitRows };
      }
      if (sql.includes(`-- tab: ${CONFIG.SHEET_PRODUCTS}`)) return { rows: productRows.map(row => ({ ...row })) };
      return { rows: [] };
    }
  };
}

test('tab Hang hoa co cot "Đang vận chuyển" ngay truoc cot Cơ sở cuoi cung', () => {
  const tab = __tabs__[CONFIG.SHEET_PRODUCTS];
  assert.ok(tab.headers.includes('Đang vận chuyển'));
  assert.equal(tab.headers.indexOf('Đang vận chuyển'), tab.columns.indexOf('dang_van_chuyen'));
  assert.equal(tab.headers.indexOf('Đang vận chuyển'), tab.headers.length - 2);
});

test('"Đang vận chuyển": truy van rieng CHI tinh phieu Dat hang nhap Sai Gon "Đã xác nhận NCC" theo chuoi statusValue', async () => {
  const pool = inTransitPool();
  await createDashboardPgReader({ pool }).readCoreDashboardSheets('Hà Nội', [CONFIG.SHEET_PRODUCTS]);
  const call = pool.calls.find(c => c.sql.includes('-- in-transit'));
  assert.ok(call, 'phai co truy van hang dang van chuyen');
  assert.match(call.sql, /FROM order_suppliers o\s+JOIN order_supplier_details d/);
  assert.match(call.sql, /o\.branch = 'saigon' AND o\.raw->>'statusValue' = \$1/, 'co dinh Sai Gon, loc theo chuoi trang thai');
  assert.deepEqual(call.params, ['Đã xác nhận NCC']);
  assert.match(call.sql, /LEFT JOIN products sp ON sp\.branch = o\.branch AND sp\.id = d\.product_id/, 'chi tiet chi co productId nen phai noi products de lay ma');
  assert.doesNotMatch(call.sql, /o\.status\s*=/, 'khong loc theo ma so status');
  // SQL cua tab Hang hoa khong con phu thuoc bang order_suppliers.
  pool.calls.filter(c => c.sql.includes(`-- tab: ${CONFIG.SHEET_PRODUCTS}`))
    .forEach(c => assert.doesNotMatch(c.sql, /order_suppliers/));
});

test('"Đang vận chuyển": dien so theo ma (khong phan biet hoa thuong/khoang trang) cho dong cua Ha Noi va Sai Gon, ma khong co = 0', async () => {
  const pool = inTransitPool({
    inTransitRows: [{ product_key: 'sp-1', qty: '720' }, { product_key: 'sp-9', qty: 5 }],
    productRows: [{ ma_hang: ' SP-1 ', ten_hang: 'A' }, { ma_hang: 'SP-2', ten_hang: 'B' }]
  });
  const sheets = await createDashboardPgReader({ pool }).readCoreDashboardSheets('Cả hai', [CONFIG.SHEET_PRODUCTS]);
  const products = sheets[CONFIG.SHEET_PRODUCTS];
  const idx = products[0].indexOf('Đang vận chuyển');
  assert.deepEqual(products.slice(1).map(row => row[idx]), [720, 0, 720, 0], 'cung so theo ma o ca 2 co so (2 dong moi co so)');
  assert.equal(pool.calls.filter(c => c.sql.includes('-- in-transit')).length, 1, 'chi 1 truy van dung chung cho ca hai co so');
});

test('"Đang vận chuyển": khong doc tab Hang hoa thi khong chay truy van hang dang van chuyen', async () => {
  const pool = inTransitPool();
  await createDashboardPgReader({ pool }).readCoreDashboardSheets('Hà Nội', [CONFIG.SHEET_CUSTOMERS]);
  assert.equal(pool.calls.some(c => c.sql.includes('-- in-transit')), false);
});

test('"Đang vận chuyển": fail-soft — bang order_suppliers chua co (42P01) thi cot = 0, cac cot khac van doc duoc', async () => {
  const pool = inTransitPool({ failInTransit: true, productRows: [{ ma_hang: 'SP-1', ten_hang: 'A', ton_kho: 5 }] });
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const sheets = await createDashboardPgReader({ pool }).readCoreDashboardSheets('Hà Nội', [CONFIG.SHEET_PRODUCTS]);
    const products = sheets[CONFIG.SHEET_PRODUCTS];
    assert.equal(products.length, 2);
    assert.equal(products[1][products[0].indexOf('Đang vận chuyển')], 0);
    assert.equal(products[1][products[0].indexOf('Tồn kho')], 5);
  } finally {
    console.warn = originalWarn;
  }
});

test('readRowsByCodes(Hàng hóa) cung dien cot dang_van_chuyen; huy truoc lo dau thi khong chay truy van nao', async () => {
  const pool = inTransitPool({
    inTransitRows: [{ product_key: 'sp-1', qty: 30 }],
    productRows: [{ ma_hang: 'SP-1', ten_hang: 'A' }]
  });
  const result = await createDashboardPgReader({ pool }).readRowsByCodes(CONFIG.SHEET_PRODUCTS, 'Hà Nội', ['SP-1']);
  assert.equal(result.rows[0].dang_van_chuyen, 30);

  const pre = new AbortController();
  pre.abort();
  const poolPre = inTransitPool();
  await assert.rejects(
    createDashboardPgReader({ pool: poolPre }).readRowsByCodes(CONFIG.SHEET_PRODUCTS, 'Hà Nội', ['A'], { signal: pre.signal }),
    error => error.code === 'EXPORT_ABORTED'
  );
  assert.equal(poolPre.calls.length, 0);
});
