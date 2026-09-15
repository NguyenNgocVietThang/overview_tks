const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ALERT_CODES,
  DATA_ISSUES,
  deriveDebtManagement,
  normalizeCustomerName,
  normalizePaymentSchedule,
  parseNullableNumber,
  parsePercentage
} = require('./debtManagement');

function managementRows(branch = 'hanoi', customers = []) {
  const paymentHeader = branch === 'saigon' ? 'Lịch TT SG' : 'Lịch TT HN';
  return [
    [
      'Khách hàng',
      'Sale',
      paymentHeader,
      'Nợ đầu kỳ',
      'Nợ hiện tại',
      'Nợ quá hạn',
      '% nợ/Doanh số',
      '% quá hạn / TB DS',
      'TB T6/26-T9/26'
    ],
    ['TỔNG', '', '', 999999999, 999999999, 999999999, 9, 9, 999999999],
    ...customers.map(customer => [
      customer.name,
      customer.sale,
      customer.schedule,
      customer.openingDebt,
      customer.currentDebt,
      customer.overdueDebt,
      customer.currentRatio,
      customer.overdueRatio,
      customer.averageSales
    ])
  ];
}

function operationalRows(...names) {
  return [
    ['Mã KH', 'Khách hàng'],
    ...names.map((name, index) => [`KH${index + 1}`, name])
  ];
}

function customer(overrides = {}) {
  return {
    name: 'Công ty Ánh Dương',
    sale: 'Lan',
    schedule: 1,
    openingDebt: 100000,
    currentDebt: 500000,
    overdueDebt: 0,
    currentRatio: 0.25,
    overdueRatio: 0,
    averageSales: 2000000,
    ...overrides
  };
}

function derive(customers, operationalSheets, options = {}) {
  const branch = options.branch || 'hanoi';
  return deriveDebtManagement({
    branch,
    sourceSheet: branch === 'saigon' ? 'Công nợ SG' : 'Công nợ HN',
    managementRows: managementRows(branch, customers),
    operationalSheets,
    workflowStatuses: options.workflowStatuses || [],
    workflowAvailable: options.workflowAvailable !== false,
    userCanEdit: options.userCanEdit !== false
  });
}

test('chuẩn hóa Unicode/khoảng trắng/hoa thường nhưng không fuzzy-match tên khác', () => {
  assert.equal(normalizeCustomerName('  CÔNG  TY A\u0301NH\tDƯƠNG  '), 'công ty ánh dương');
  assert.notEqual(normalizeCustomerName('Công ty Anh Dương'), normalizeCustomerName('Công ty Ánh Dương'));
});

test('parse tiền, phần trăm, #N/A và lịch thanh toán theo dữ liệu Sheets', () => {
  assert.equal(parseNullableNumber(1234567), 1234567);
  assert.equal(parseNullableNumber('1.234.567'), 1234567);
  assert.equal(parseNullableNumber('-12.345,67'), -12345.67);
  assert.equal(parseNullableNumber('#N/A'), null);
  assert.equal(parseNullableNumber(''), null);

  assert.equal(parsePercentage(0.127), 0.127);
  assert.equal(parsePercentage('12,7%'), 0.127);
  assert.equal(parsePercentage('#N/A'), null);

  assert.equal(normalizePaymentSchedule(1), '1');
  assert.equal(normalizePaymentSchedule(' 3 '), '3');
  assert.equal(normalizePaymentSchedule('HÀNG TUẦN'), 'Hàng tuần');
  assert.equal(normalizePaymentSchedule('khác'), null);
});

test('đọc header HN từ hàng 1, bỏ hàng tổng 2 và bắt đầu khách từ hàng 3', () => {
  const result = derive(
    [customer({ openingDebt: '1.234.567', currentRatio: '12,7%' })],
    { HN1: operationalRows('Công ty Ánh Dương'), HN3: operationalRows(), HN7: operationalRows() }
  );

  assert.equal(result.available, true);
  assert.equal(result.sourceSheet, 'Công nợ HN');
  assert.equal(result.customers.length, 1);
  assert.equal(result.customers[0].openingDebt, 1234567);
  assert.equal(result.customers[0].currentDebtToSalesRatio, 0.127);
  assert.equal(result.kpi.totalCurrentDebt, 500000);
});

test('đọc đúng cột Lịch TT SG theo cơ sở Sài Gòn', () => {
  const result = derive(
    [customer({ schedule: 'Hàng Tuần' })],
    { HN1: operationalRows(), HN3: operationalRows(), HN7: operationalRows() },
    { branch: 'saigon' }
  );

  assert.equal(result.sourceSheet, 'Công nợ SG');
  assert.equal(result.customers[0].paymentSchedule, 'Hàng tuần');
});

test('lịch 1 cảnh báo Chưa thu khi chỉ tồn tại trong HN3 hoặc HN7', () => {
  for (const sheets of [
    { HN1: operationalRows(), HN3: operationalRows('Công ty Ánh Dương'), HN7: operationalRows() },
    { HN1: operationalRows(), HN3: operationalRows(), HN7: operationalRows('Công ty Ánh Dương') }
  ]) {
    const result = derive([customer({ schedule: 1 })], sheets);
    assert.deepEqual(result.customers[0].alertCodes, [ALERT_CODES.UNCOLLECTED]);
  }

  const alreadyInHn1 = derive(
    [customer({ schedule: 1 })],
    { HN1: operationalRows('Công ty Ánh Dương'), HN3: operationalRows('Công ty Ánh Dương'), HN7: operationalRows() }
  );
  assert.deepEqual(alreadyInHn1.customers[0].alertCodes, []);
});

test('lịch 3 chỉ cảnh báo Chưa thu khi vắng HN1/HN3 và có trong HN7', () => {
  const shouldAlert = derive(
    [customer({ schedule: 3 })],
    { HN1: operationalRows(), HN3: operationalRows(), HN7: operationalRows('Công ty Ánh Dương') }
  );
  assert.deepEqual(shouldAlert.customers[0].alertCodes, [ALERT_CODES.UNCOLLECTED]);

  for (const sheets of [
    { HN1: operationalRows('Công ty Ánh Dương'), HN3: operationalRows(), HN7: operationalRows('Công ty Ánh Dương') },
    { HN1: operationalRows(), HN3: operationalRows('Công ty Ánh Dương'), HN7: operationalRows('Công ty Ánh Dương') },
    { HN1: operationalRows(), HN3: operationalRows(), HN7: operationalRows() }
  ]) {
    assert.deepEqual(derive([customer({ schedule: 3 })], sheets).customers[0].alertCodes, []);
  }
});

test('mọi lịch 1/3/7/Hàng tuần cảnh báo Quá hạn khi nợ quá hạn dương', () => {
  for (const schedule of [1, 3, 7, 'Hàng tuần']) {
    const result = derive(
      [customer({ schedule, currentDebt: 500000, overdueDebt: 1000 })],
      { HN1: operationalRows(), HN3: operationalRows(), HN7: operationalRows() }
    );
    assert.ok(result.customers[0].alertCodes.includes(ALERT_CODES.OVERDUE), String(schedule));
  }
});

test('ngưỡng 399.999 bị loại khi cả hai khoản dưới ngưỡng; đúng 400.000 vẫn cảnh báo', () => {
  const sheets = { HN1: operationalRows(), HN3: operationalRows(), HN7: operationalRows('Công ty Ánh Dương') };
  const below = derive([customer({ schedule: 1, currentDebt: 399999, overdueDebt: 399999 })], sheets);
  assert.deepEqual(below.customers[0].alertCodes, []);

  const currentAtBoundary = derive([customer({ schedule: 1, currentDebt: 400000, overdueDebt: 0 })], sheets);
  assert.deepEqual(currentAtBoundary.customers[0].alertCodes, [ALERT_CODES.UNCOLLECTED]);

  const overdueAtBoundary = derive([customer({ schedule: 7, currentDebt: 0, overdueDebt: 400000 })], sheets);
  assert.deepEqual(overdueAtBoundary.customers[0].alertCodes, [ALERT_CODES.OVERDUE]);
});

test('thiếu một nguồn HN tắt Chưa thu nhưng vẫn giữ cảnh báo Quá hạn', () => {
  const result = derive(
    [customer({ schedule: 1, overdueDebt: 500000 })],
    { HN1: operationalRows(), HN3: null, HN7: operationalRows('Công ty Ánh Dương') }
  );

  assert.deepEqual(result.customers[0].alertCodes, [ALERT_CODES.OVERDUE]);
  assert.ok(result.dataWarnings.some(warning => warning.includes('HN3')));
});

test('tên chuẩn hóa trùng không bị gộp, được đánh lỗi và khóa sửa trạng thái', () => {
  const result = derive(
    [
      customer({ name: 'Công ty Ánh Dương', sale: 'Lan' }),
      customer({ name: '  CÔNG TY A\u0301NH DƯƠNG ', sale: 'Mai' })
    ],
    { HN1: operationalRows(), HN3: operationalRows('Công ty Ánh Dương'), HN7: operationalRows() }
  );

  assert.equal(result.customers.length, 2);
  for (const row of result.customers) {
    assert.ok(row.dataIssues.includes(DATA_ISSUES.DUPLICATE_CUSTOMER_NAME));
    assert.equal(row.canEditStatus, false);
    assert.equal(row.needsAction, false);
  }
  assert.equal(result.kpi.actionCustomerCount, 0);
});

test('tổng hợp KPI từ dòng khách, tỷ lệ quá hạn có trọng số và luôn đủ bốn lịch', () => {
  const result = derive(
    [
      customer({ name: 'A', sale: '', schedule: 1, currentDebt: 1000000, overdueDebt: 200000, averageSales: 1000000 }),
      customer({ name: 'B', sale: 'Lan', schedule: 3, currentDebt: 2000000, overdueDebt: 300000, averageSales: 4000000 })
    ],
    { HN1: operationalRows('A', 'B'), HN3: operationalRows(), HN7: operationalRows() }
  );

  assert.equal(result.kpi.totalCurrentDebt, 3000000);
  assert.equal(result.kpi.totalOverdueDebt, 500000);
  assert.equal(result.kpi.overdueToSalesRatio, 0.1);
  assert.deepEqual(result.byPaymentSchedule.map(item => item.paymentSchedule), ['1', '3', '7', 'Hàng tuần']);
  assert.equal(result.customers[0].sale, 'Chưa xác định');
});

test('Đã xử lý/Bỏ qua chỉ còn hiệu lực khi chữ ký cảnh báo khớp', () => {
  const base = derive(
    [customer({ schedule: 7, overdueDebt: 500000 })],
    { HN1: operationalRows(), HN3: operationalRows(), HN7: operationalRows() }
  );
  const row = base.customers[0];

  const resolved = derive(
    [customer({ schedule: 7, overdueDebt: 500000 })],
    { HN1: operationalRows(), HN3: operationalRows(), HN7: operationalRows() },
    { workflowStatuses: [{ customer_key: row.customerKey, status: 'Đã xử lý', alert_signature: row.alertSignature, updated_by_name: 'Quản lý', updated_at: '2026-09-15T00:00:00.000Z' }] }
  );
  assert.equal(resolved.customers[0].workflowStatus, 'Đã xử lý');
  assert.equal(resolved.customers[0].needsAction, false);

  const changedDebt = derive(
    [customer({ schedule: 7, overdueDebt: 600000 })],
    { HN1: operationalRows(), HN3: operationalRows(), HN7: operationalRows() },
    { workflowStatuses: [{ customer_key: row.customerKey, status: 'Đã xử lý', alert_signature: row.alertSignature, updated_by_name: 'Quản lý' }] }
  );
  assert.equal(changedDebt.customers[0].workflowStatus, 'Chưa xử lý');
  assert.equal(changedDebt.customers[0].needsAction, true);
});
