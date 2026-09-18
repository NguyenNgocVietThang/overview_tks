const crypto = require('node:crypto');

const ALERT_CODES = Object.freeze({
  UNCOLLECTED: 'uncollected',
  OVERDUE: 'overdue'
});

const DATA_ISSUES = Object.freeze({
  DUPLICATE_CUSTOMER_NAME: 'duplicate_customer_name',
  MISSING_CUSTOMER_NAME: 'missing_customer_name',
  INVALID_PAYMENT_SCHEDULE: 'invalid_payment_schedule'
});

const PAYMENT_SCHEDULES = Object.freeze(['1', '3', '7', 'Hàng tuần']);
const TERMINAL_WORKFLOW_STATUSES = new Set(['Đã xử lý', 'Bỏ qua']);
const MINIMUM_ALERT_DEBT = 400000;

function normalizeUnicodeText(raw) {
  return String(raw ?? '')
    .normalize('NFC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCustomerName(raw) {
  return normalizeUnicodeText(raw).toLocaleLowerCase('vi-VN');
}

function normalizeHeader(raw) {
  return normalizeUnicodeText(raw)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLocaleLowerCase('vi-VN')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNullableNumber(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;

  const value = normalizeUnicodeText(raw);
  if (!value || /^#(?:n\/a|na|value!|ref!|div\/0!)$/i.test(value)) return null;

  const withoutSpaces = value.replace(/[\s\u00a0]/g, '');
  let normalized = withoutSpaces;
  const lastDot = withoutSpaces.lastIndexOf('.');
  const lastComma = withoutSpaces.lastIndexOf(',');

  if (lastDot >= 0 && lastComma >= 0) {
    const decimalSeparator = lastDot > lastComma ? '.' : ',';
    const groupingSeparator = decimalSeparator === '.' ? /,/g : /\./g;
    normalized = withoutSpaces.replace(groupingSeparator, '').replace(decimalSeparator, '.');
  } else if (lastComma >= 0) {
    const decimals = withoutSpaces.length - lastComma - 1;
    normalized = decimals === 3 && /^-?\d{1,3}(?:,\d{3})+$/.test(withoutSpaces)
      ? withoutSpaces.replace(/,/g, '')
      : withoutSpaces.replace(',', '.');
  } else if (lastDot >= 0) {
    const decimals = withoutSpaces.length - lastDot - 1;
    normalized = decimals === 3 && /^-?\d{1,3}(?:\.\d{3})+$/.test(withoutSpaces)
      ? withoutSpaces.replace(/\./g, '')
      : withoutSpaces;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePercentage(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const value = normalizeUnicodeText(raw);
  const hasPercentSign = value.includes('%');
  const parsed = parseNullableNumber(value.replace(/%/g, ''));
  if (parsed === null) return null;
  return hasPercentSign ? parsed / 100 : parsed;
}

function normalizePaymentSchedule(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const value = normalizeHeader(raw);
  if (value === '1' || value === '3' || value === '7') return value;
  if (value === 'hang tuan' || value === 'hangtuan' || value === 'weekly') return 'Hàng tuần';
  return null;
}

function findColumn(headers, aliases) {
  const normalizedAliases = new Set(aliases.map(normalizeHeader));
  return headers.findIndex(header => normalizedAliases.has(normalizeHeader(header)));
}

function buildColumnIndex(headers, branch) {
  const normalizedBranch = normalizeHeader(branch);
  const branchSuffix = normalizedBranch === 'saigon' || normalizedBranch === 'sai gon' ? 'sg' : 'hn';
  return {
    customerName: findColumn(headers, ['Khách hàng', 'Tên khách hàng']),
    sale: findColumn(headers, ['Sale', 'Nhân viên sale', 'Nhân viên bán hàng']),
    paymentSchedule: findColumn(headers, [
      `Lịch TT ${branchSuffix}`,
      `Lịch thanh toán ${branchSuffix}`,
      'Lịch TT',
      'Lịch thanh toán'
    ]),
    openingDebt: findColumn(headers, ['Nợ đầu kỳ', 'Nợ đầu kì']),
    currentDebt: findColumn(headers, ['Nợ hiện tại']),
    overdueDebt: findColumn(headers, ['Nợ quá hạn']),
    currentDebtToSalesRatio: findColumn(headers, ['% nợ/Doanh số', '% nợ / Doanh số']),
    overdueToSalesRatio: findColumn(headers, ['% quá hạn / TB DS', '% quá hạn/TB DS']),
    averageSales: headers.findIndex(header => normalizeHeader(header).startsWith('tb '))
  };
}

function readCell(row, index) {
  return index >= 0 && index < row.length ? row[index] : undefined;
}

function customerKeyFor(normalizedName, rowNumber) {
  const source = normalizedName || `missing-customer-row-${rowNumber}`;
  return crypto.createHash('sha256').update(source, 'utf8').digest('hex');
}

function parseManagementSheet(rows, branch) {
  if (!Array.isArray(rows) || !Array.isArray(rows[0])) {
    return { available: false, customers: [], dataWarnings: ['Không tải được sheet công nợ quản lý.'] };
  }

  const headers = rows[0];
  const columns = buildColumnIndex(headers, branch);
  const required = ['customerName', 'paymentSchedule', 'openingDebt', 'currentDebt', 'overdueDebt'];
  const missingHeaders = required.filter(key => columns[key] < 0);
  if (missingHeaders.length) {
    return {
      available: false,
      customers: [],
      dataWarnings: [`Sheet công nợ thiếu cột bắt buộc: ${missingHeaders.join(', ')}.`]
    };
  }

  const customers = [];
  for (let index = 2; index < rows.length; index += 1) {
    const row = Array.isArray(rows[index]) ? rows[index] : [];
    if (!row.some(value => normalizeUnicodeText(value) !== '')) continue;

    const customerName = normalizeUnicodeText(readCell(row, columns.customerName));
    const normalizedName = normalizeCustomerName(customerName);
    const paymentSchedule = normalizePaymentSchedule(readCell(row, columns.paymentSchedule));
    const dataIssues = [];
    if (!normalizedName) dataIssues.push(DATA_ISSUES.MISSING_CUSTOMER_NAME);
    if (!paymentSchedule) dataIssues.push(DATA_ISSUES.INVALID_PAYMENT_SCHEDULE);

    customers.push({
      customerKey: customerKeyFor(normalizedName, index + 1),
      customerName: customerName || 'Chưa xác định',
      normalizedName,
      sale: normalizeUnicodeText(readCell(row, columns.sale)) || 'Chưa xác định',
      paymentSchedule,
      openingDebt: parseNullableNumber(readCell(row, columns.openingDebt)),
      currentDebt: parseNullableNumber(readCell(row, columns.currentDebt)),
      overdueDebt: parseNullableNumber(readCell(row, columns.overdueDebt)),
      currentDebtToSalesRatio: parsePercentage(readCell(row, columns.currentDebtToSalesRatio)),
      overdueToSalesRatio: parsePercentage(readCell(row, columns.overdueToSalesRatio)),
      averageSales: parseNullableNumber(readCell(row, columns.averageSales)),
      dataIssues
    });
  }

  const counts = new Map();
  customers.forEach(item => {
    if (item.normalizedName) counts.set(item.normalizedName, (counts.get(item.normalizedName) || 0) + 1);
  });
  customers.forEach(item => {
    if ((counts.get(item.normalizedName) || 0) > 1) {
      item.dataIssues.push(DATA_ISSUES.DUPLICATE_CUSTOMER_NAME);
    }
  });

  return { available: true, customers, dataWarnings: [] };
}

function buildOperationalNameSet(rows) {
  if (!Array.isArray(rows)) return { available: false, names: new Set() };
  const headers = Array.isArray(rows[0]) ? rows[0] : [];
  const customerIndex = findColumn(headers, ['Khách hàng', 'Tên khách hàng']);
  if (customerIndex < 0) return { available: false, names: new Set() };

  const names = new Set();
  for (let index = 1; index < rows.length; index += 1) {
    const name = normalizeCustomerName(readCell(Array.isArray(rows[index]) ? rows[index] : [], customerIndex));
    if (name) names.add(name);
  }
  return { available: true, names };
}

function createAlertSignature(alertCodes, currentDebt, overdueDebt) {
  const payload = JSON.stringify({
    alertCodes: [...alertCodes].sort(),
    currentDebt: currentDebt ?? null,
    overdueDebt: overdueDebt ?? null
  });
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

function buildStatusMap(workflowStatuses) {
  const map = new Map();
  for (const status of Array.isArray(workflowStatuses) ? workflowStatuses : []) {
    const key = status.customer_key || status.customerKey;
    if (key) map.set(String(key), status);
  }
  return map;
}

function amountOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}

function deriveAlerts(customer, operational, operationalComplete) {
  const currentDebt = amountOrZero(customer.currentDebt);
  const overdueDebt = amountOrZero(customer.overdueDebt);
  if (currentDebt < MINIMUM_ALERT_DEBT && overdueDebt < MINIMUM_ALERT_DEBT) return [];

  const alertCodes = [];
  const name = customer.normalizedName;
  if (operationalComplete && name) {
    if (
      customer.paymentSchedule === '1' &&
      !operational.HN1.has(name) &&
      (operational.HN3.has(name) || operational.HN7.has(name))
    ) {
      alertCodes.push(ALERT_CODES.UNCOLLECTED);
    }
    if (
      customer.paymentSchedule === '3' &&
      !operational.HN1.has(name) &&
      !operational.HN3.has(name) &&
      operational.HN7.has(name)
    ) {
      alertCodes.push(ALERT_CODES.UNCOLLECTED);
    }
  }
  if (overdueDebt > MINIMUM_ALERT_DEBT) alertCodes.push(ALERT_CODES.OVERDUE);
  return alertCodes;
}

function buildSummary(customers) {
  const kpi = customers.reduce((summary, item) => {
    summary.totalCurrentDebt += amountOrZero(item.currentDebt);
    summary.totalOverdueDebt += amountOrZero(item.overdueDebt);
    if (Number.isFinite(item.averageSales) && item.averageSales > 0) summary.totalAverageSales += item.averageSales;
    if (item.needsAction) summary.actionCustomerCount += 1;
    return summary;
  }, { totalCurrentDebt: 0, totalOverdueDebt: 0, totalAverageSales: 0, actionCustomerCount: 0 });

  const bySaleMap = new Map();
  customers.forEach(item => {
    if (!bySaleMap.has(item.sale)) {
      bySaleMap.set(item.sale, {
        sale: item.sale,
        totalCurrentDebt: 0,
        totalOverdueDebt: 0,
        actionCustomerCount: 0,
        customerCount: 0
      });
    }
    const summary = bySaleMap.get(item.sale);
    summary.totalCurrentDebt += amountOrZero(item.currentDebt);
    summary.totalOverdueDebt += amountOrZero(item.overdueDebt);
    summary.customerCount += 1;
    if (item.needsAction) summary.actionCustomerCount += 1;
  });

  const byScheduleMap = new Map(PAYMENT_SCHEDULES.map(paymentSchedule => [paymentSchedule, {
    paymentSchedule,
    totalCurrentDebt: 0,
    totalOverdueDebt: 0,
    actionCustomerCount: 0,
    customerCount: 0
  }]));
  customers.forEach(item => {
    const summary = byScheduleMap.get(item.paymentSchedule);
    if (!summary) return;
    summary.totalCurrentDebt += amountOrZero(item.currentDebt);
    summary.totalOverdueDebt += amountOrZero(item.overdueDebt);
    summary.customerCount += 1;
    if (item.needsAction) summary.actionCustomerCount += 1;
  });

  const toTopItem = item => ({
    customerKey: item.customerKey,
    customerName: item.customerName,
    sale: item.sale,
    paymentSchedule: item.paymentSchedule,
    currentDebt: item.currentDebt,
    overdueDebt: item.overdueDebt,
    needsAction: item.needsAction
  });

  return {
    kpi: {
      totalCurrentDebt: kpi.totalCurrentDebt,
      totalOverdueDebt: kpi.totalOverdueDebt,
      actionCustomerCount: kpi.actionCustomerCount,
      overdueToSalesRatio: kpi.totalAverageSales > 0 ? kpi.totalOverdueDebt / kpi.totalAverageSales : 0
    },
    bySale: Array.from(bySaleMap.values())
      .sort((a, b) => b.totalOverdueDebt - a.totalOverdueDebt || b.totalCurrentDebt - a.totalCurrentDebt || a.sale.localeCompare(b.sale, 'vi'))
      .slice(0, 15),
    byPaymentSchedule: PAYMENT_SCHEDULES.map(schedule => byScheduleMap.get(schedule)),
    topCurrentDebt: customers.filter(item => amountOrZero(item.currentDebt) > 0)
      .sort((a, b) => amountOrZero(b.currentDebt) - amountOrZero(a.currentDebt))
      .slice(0, 10)
      .map(toTopItem),
    topOverdueDebt: customers.filter(item => amountOrZero(item.overdueDebt) > 0)
      .sort((a, b) => amountOrZero(b.overdueDebt) - amountOrZero(a.overdueDebt))
      .slice(0, 10)
      .map(toTopItem)
  };
}

function deriveDebtManagement({
  managementRows,
  branch,
  sourceSheet,
  operationalSheets = {},
  workflowStatuses = [],
  workflowAvailable = true,
  userCanEdit = false
}) {
  const parsed = parseManagementSheet(managementRows, branch);
  if (!parsed.available) {
    return {
      available: false,
      sourceSheet,
      dataWarnings: parsed.dataWarnings,
      kpi: { totalCurrentDebt: 0, totalOverdueDebt: 0, actionCustomerCount: 0, overdueToSalesRatio: 0 },
      bySale: [],
      byPaymentSchedule: PAYMENT_SCHEDULES.map(paymentSchedule => ({ paymentSchedule, totalCurrentDebt: 0, totalOverdueDebt: 0, actionCustomerCount: 0, customerCount: 0 })),
      topCurrentDebt: [],
      topOverdueDebt: [],
      customers: []
    };
  }

  const dataWarnings = [...parsed.dataWarnings];
  const operational = {};
  let operationalComplete = true;
  for (const sheetName of ['HN1', 'HN3', 'HN7']) {
    const indexed = buildOperationalNameSet(operationalSheets[sheetName]);
    operational[sheetName] = indexed.names;
    if (!indexed.available) {
      operationalComplete = false;
      dataWarnings.push(`Thiếu dữ liệu đối chiếu ${sheetName}; đã tắt cảnh báo Chưa thu.`);
    }
  }
  if (!workflowAvailable) dataWarnings.push('Không thể tải trạng thái xử lý; chức năng cập nhật tạm thời bị khóa.');

  const statusMap = buildStatusMap(workflowStatuses);
  const customers = parsed.customers.map(customer => {
    const alertCodes = deriveAlerts(customer, operational, operationalComplete);
    const alertSignature = createAlertSignature(alertCodes, customer.currentDebt, customer.overdueDebt);
    const stored = statusMap.get(customer.customerKey);
    const storedStatus = stored?.status || 'Chưa xử lý';
    const storedSignature = stored?.alert_signature || stored?.alertSignature || '';
    const terminalStatusExpired = TERMINAL_WORKFLOW_STATUSES.has(storedStatus) && storedSignature !== alertSignature;
    const workflowStatus = terminalStatusExpired ? 'Chưa xử lý' : storedStatus;
    const hasDataIssue = customer.dataIssues.length > 0;
    const needsAction = alertCodes.length > 0 && !hasDataIssue && !TERMINAL_WORKFLOW_STATUSES.has(workflowStatus);
    const statusRelevant = alertCodes.length > 0 || Boolean(stored);

    return {
      customerKey: customer.customerKey,
      customerName: customer.customerName,
      sale: customer.sale,
      paymentSchedule: customer.paymentSchedule,
      openingDebt: customer.openingDebt,
      currentDebt: customer.currentDebt,
      overdueDebt: customer.overdueDebt,
      currentDebtToSalesRatio: customer.currentDebtToSalesRatio,
      overdueToSalesRatio: customer.overdueToSalesRatio,
      alertCodes,
      dataIssues: [...customer.dataIssues],
      workflowStatus,
      needsAction,
      canEditStatus: Boolean(userCanEdit && workflowAvailable && !hasDataIssue && statusRelevant),
      alertSignature,
      updatedBy: terminalStatusExpired ? '' : (stored?.updated_by_name || stored?.updatedBy || ''),
      updatedAt: terminalStatusExpired ? null : (stored?.updated_at || stored?.updatedAt || null),
      averageSales: customer.averageSales
    };
  });

  const summary = buildSummary(customers);
  return {
    available: true,
    sourceSheet,
    dataWarnings,
    ...summary,
    customers: customers.map(({ averageSales, ...publicCustomer }) => publicCustomer)
  };
}

module.exports = {
  ALERT_CODES,
  DATA_ISSUES,
  MINIMUM_ALERT_DEBT,
  PAYMENT_SCHEDULES,
  createAlertSignature,
  deriveDebtManagement,
  normalizeCustomerName,
  normalizePaymentSchedule,
  parseManagementSheet,
  parseNullableNumber,
  parsePercentage
};
