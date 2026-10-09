'use strict';

const { createHash } = require('node:crypto');
const p = require('./marketingParsers');
const { aggregatePhones, countPhoneKpis, countMonthlyClosures, isPhoneReportObservation } = require('./marketingAggregation');
const WORKBOOK_IDS = Object.freeze({ phones: '1cAOmY4WC2tIE0-OMwvy43PTR9dNK72k2d4DUDrB2swk', report: '14MaEMfPCyfxPx-HfJMJ1gcwIpKVbuhx3FIBCSnLSWl8' });
const PAGE_SOURCES = Object.freeze([
  { pageId: '1184366971419195', page: 'Hữu Nghị', rawTab: 'HN THÔ', standardTab: 'HỮU NGHỊ CHUẨN', expectedRaw: 5982, expectedStandard: 4780 },
  { pageId: '1144127138790204', page: 'Tân Thanh', rawTab: 'TT THÔ', standardTab: 'TÂN THANH CHUẨN', expectedRaw: 4986, expectedStandard: 1726 },
  { pageId: '430840296781378', page: 'Bắc Lãm', rawTab: 'BL THÔ', standardTab: 'BẮC LÃM CHUẨN', expectedRaw: 4863, expectedStandard: 3132 },
  { pageId: '1094883173717378', page: 'Phú Lương', rawTab: 'PL THÔ', standardTab: 'Phú lương CHUẨN', expectedRaw: 2346, expectedStandard: 2188 },
  { pageId: '1222318524308489', page: 'HN-SG', rawTab: 'HS THÔ', standardTab: 'HN-SG Chuẩn', expectedRaw: 26, expectedStandard: 26 },
  { pageId: '1387564787764418', page: 'Dương Nội', rawTab: 'DN THÔ', standardTab: 'Dương nội Chuẩn', expectedRaw: 102, expectedStandard: 90 }
]);
const PHONE_POLICY = 'exact-source-cell-text; numeric/string raw types retained; no leading-zero repair, split, trim or cross-page merge';
const cellText = v => v == null ? '' : String(v);
const filled = v => Boolean(cellText(v).trim());
const ref = (tab, row) => `${tab}!${row}`;
function invalid(rowReferences = []) {
  return Object.assign(new Error('Marketing history input is invalid; inspect source structure or the listed row references.'), { code: 'INVALID_MARKETING_IMPORT', rowReferences });
}
function validYear(year) { return Number.isInteger(year) && year >= 1900 && year <= 9999; }
function calendarDate(year, month, day) {
  if (!validYear(year) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day ? date.toISOString().slice(0, 10) : null;
}
function parseHistoricalDate(value, year) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 1 || value > 2958465) return null;
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
    return calendarDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  const text = cellText(value).trim();
  if (!/^(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)$/.test(text)) return null;
  const parts = p.dateParts(text);
  return parts ? calendarDate(parts.year ?? year, parts.month, parts.day) : null;
}
function parseCreatedTimestamp(value) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(cellText(value).trim());
  if (!m) return null;
  const date = calendarDate(+m[3], +m[2], +m[1]);
  const hour = +m[4], minute = +m[5], second = +(m[6] || 0);
  if (!date || hour > 23 || minute > 59 || second > 59) return null;
  return new Date(`${date}T${String(hour).padStart(2, '0')}:${m[5]}:${String(second).padStart(2, '0')}+07:00`).toISOString();
}
function pageIdOf(label) { return PAGE_SOURCES.find(page => p.norm(page.page) === p.norm(label))?.pageId ?? null; }
function requireSheet(workbook, title) {
  const rows = workbook.sheets?.[title];
  if (!Array.isArray(rows) || !rows.every(row => Array.isArray(row) && row.every(cell => cell == null || ['string', 'number', 'boolean'].includes(typeof cell)))) throw invalid([ref(title, 1)]);
  return rows;
}
function parseAliases(report) {
  const values = requireSheet(report, 'Tên'), mappings = new Map(), rowRefs = new Map();
  const unresolved = []; let filledRows = 0;
  values.slice(1).forEach((row, i) => {
    if (!filled(row[0]) && !filled(row[1])) return;
    const rowRef = ref('Tên', i + 2); filledRows++;
    if (!filled(row[0]) || !filled(row[1])) { unresolved.push(rowRef); return; }
    const rawName = cellText(row[0]), reportEmployee = cellText(row[1]);
    if (mappings.has(rawName) && mappings.get(rawName) !== reportEmployee) throw invalid([rowRefs.get(rawName), rowRef]);
    mappings.set(rawName, reportEmployee); rowRefs.set(rawName, rowRef);
  });
  return { aliases: [...mappings].map(([rawName, reportEmployee]) => ({ rawName, reportEmployee })), summary: { filledRows, uniqueRawNames: mappings.size, equalDuplicates: filledRows - unresolved.length - mappings.size, conflicts: 0, unresolved } };
}
function importMonthly(report, year, unresolved) {
  const rows = [], summary = [];
  const titles = Object.keys(report.sheets).filter(title => /^bc tháng /i.test(title));
  for (const title of titles) {
    const month = p.monthOfTitle(title); if (!month) throw invalid([ref(title, 1)]);
    const values = requireSheet(report, title), june = month === 6 && !filled(values[0]?.[0]);
    if (!june && p.norm(values[0]?.[0]) !== 'sale') throw invalid([ref(title, 1)]);
    let count = 0;
    values.slice(2).forEach((raw, i) => {
      if (!raw.slice(0, 4).some(filled)) return;
      const sourceRow = i + 3, rowRef = ref(title, sourceRow), page = june ? '' : cellText(raw[3]);
      const pageId = june ? null : pageIdOf(page), closedCell = raw[june ? 5 : 6];
      const closedAt = parseHistoricalDate(closedCell, year);
      const row = { reportYear: year, reportMonth: month, sale: cellText(raw[0]), customer: cellText(raw[1]), phone: cellText(raw[2]), pageId, page,
        status: cellText(raw[june ? 3 : 4]), dataSource: cellText(raw[june ? 4 : 5]), closedAt,
        newCustomer: june ? '' : cellText(raw[8]), note: cellText(raw[june ? 7 : 9]), sourceTab: title, sourceRow, raw };
      if (!pageId) unresolved.monthlyPage.push(rowRef);
      if (!closedAt) unresolved.monthlyClosedAt.push(rowRef);
      if (!filled(raw[0])) unresolved.monthlyEmployee.push(rowRef);
      rows.push(row); count++;
    });
    summary.push({ tab: title, reportYear: year, reportMonth: month, rows: count, schema: june ? 'june-legacy-no-page' : 'july-onwards', expectedRows: ({ 6: 70, 7: 126, 8: 114, 9: 100, 10: 49 })[month] ?? null });
  }
  return { rows, summary };
}
function reconcileStandard(phonesWorkbook, phones, year) {
  return PAGE_SOURCES.map(page => {
    const source = requireSheet(phonesWorkbook, page.standardTab).slice(1).flatMap((row, index) => filled(row[0]) ? [{ raw: row, rowNumber: index + 2 }] : []);
    const found = new Map(phones.filter(row => row.pageId === page.pageId).map(row => [row.phoneKey, row]));
    const compared = new Set(), differences = []; let matched = 0;
    for (const row of source) {
      const rowRef = ref(page.standardTab, row.rowNumber), key = cellText(row.raw[0]), actual = found.get(key);
      if (!actual) { differences.push({ row: rowRef, field: 'phone', reason: 'missing-source-key' }); continue; }
      if (compared.has(key)) differences.push({ row: rowRef, field: 'phone', reason: 'duplicate-standard-key' });
      compared.add(key);
      const fields = ['firstEmployee', 'currentEmployee', 'repeatEmployee', 'firstAt', 'currentAt', 'repeatAt'];
      let equal = true;
      fields.forEach((field, index) => {
        const expected = index < 3 ? cellText(row.raw[index + 1]) : parseHistoricalDate(row.raw[index + 1], year);
        if (actual[field] !== expected) { equal = false; differences.push({ row: rowRef, field, reason: 'value-differs', firstSourceRow: ref(actual.firstRow.tab, actual.firstRow.rowNumber), lastSourceRow: ref(actual.lastRow.tab, actual.lastRow.rowNumber) }); }
      });
      if (equal) matched++;
    }
    const extraSourceRows = [...found].filter(([key]) => !compared.has(key)).map(([, row]) => ref(row.firstRow.tab, row.firstRow.rowNumber));
    return { pageId: page.pageId, tab: page.standardTab, sourceRows: source.length, foundRows: found.size, expectedRows: page.expectedStandard, matched, differences, extraSourceRows };
  });
}
function reconcileChecks(report, phones, year, aliases, monthlyRows) {
  const mapping = new Map(aliases.map(a => [a.rawName, a.reportEmployee]));
  const checks = [];
  for (const title of Object.keys(report.sheets).filter(t => /^check tỷ lệ nhận số t/i.test(t))) {
    const month = p.monthOfTitle(title), values = requireSheet(report, title), headerMonth = p.monthOfTitle(cellText(values[0]?.[0]));
    const counts = countPhoneKpis(phones, { year, month }), byRaw = new Map(counts.map(row => [JSON.stringify([row.pageId, row.employee]), row]));
    const closures = new Map(countMonthlyClosures(monthlyRows, { year, month }).map(row => [JSON.stringify([row.pageId, row.employee]), row.closed]));
    const mapped = new Map(), differences = [], structural = [], pendingRates = [], mismatched = new Set(), unresolvedRowReferences = [];
    const seenRawKeys = new Set(); let sourceRows = 0, phoneMatchedRows = 0;
    if (headerMonth !== month) structural.push({ row: ref(title, 1), field: 'headerMonth', source: headerMonth, found: month });
    values.slice(1).forEach((raw, index) => {
      if (!filled(raw[0]) && !filled(raw[4])) return;
      const rowRef = ref(title, index + 2); sourceRows++;
      const pageId = pageIdOf(raw[4]), employee = cellText(raw[0]);
      if (!pageId || !employee) { structural.push({ row: rowRef, field: !pageId ? 'page' : 'employee', reason: 'unresolved' }); unresolvedRowReferences.push(rowRef); return; }
      const expected = byRaw.get(JSON.stringify([pageId, employee])) || { first: 0, repeat: 0, equivalent: 0 };
      const rawKey = JSON.stringify([pageId, employee]);
      if (seenRawKeys.has(rawKey)) structural.push({ row: rowRef, field: 'rawEmployeePage', reason: 'duplicate-check-row' });
      seenRawKeys.add(rawKey);
      const reportEmployee = mapping.get(employee) ?? null;
      if (!reportEmployee) structural.push({ row: rowRef, field: 'alias', reason: 'unmapped' });
      if (cellText(raw[5]) !== reportEmployee) structural.push({ row: rowRef, field: 'reportEmployee', reason: 'mapping-differs' });
      let equal = true;
      ['first', 'repeat', 'equivalent'].forEach((field, i) => {
        const source = p.number(raw[i + 1]), found = expected[field];
        if (source === null || Math.abs(source - found) > 1e-9) { differences.push({ row: rowRef, field, source, found }); equal = false; mismatched.add(rowRef); }
      });
      const first = p.number(raw[1]), repeat = p.number(raw[2]), equivalent = p.number(raw[3]);
      if (first !== null && repeat !== null && equivalent !== null && Math.abs(equivalent - first - repeat / 5) > 1e-9) structural.push({ row: rowRef, field: 'equivalentFormula', source: equivalent, found: first + repeat / 5 });
      if (equal) phoneMatchedRows++;
      // Safe anonymous group references retain reconciliation without exposing names.
      const groupKey = JSON.stringify([pageId, reportEmployee]);
      if (!mapped.has(groupKey)) mapped.set(groupKey, { pageId, rows: [], first: 0, repeat: 0 });
      const group = mapped.get(groupKey); group.rows.push(rowRef); group.first += expected.first; group.repeat += expected.repeat;
      const closed = reportEmployee ? closures.get(groupKey) || 0 : null;
      group.closed = closed;
      if (raw[6] !== undefined) {
        const source = p.number(raw[6]);
        if (source !== closed) { differences.push({ row: rowRef, field: 'closed', source, found: closed }); mismatched.add(rowRef); }
      }
      if (raw[7] !== undefined) pendingRates.push({ row: rowRef, source: p.number(raw[7]), groupKey });
    });
    for (const group of mapped.values()) {
      group.equivalent = group.first + group.repeat / 5;
      group.rate = group.closed === null || group.equivalent === 0 ? null : group.closed / group.equivalent;
    }
    for (const row of pendingRates) {
      const found = mapped.get(row.groupKey).rate;
      if (row.source !== found && (row.source === null || found === null || Math.abs(row.source - found) > 1e-9)) { differences.push({ row: row.row, field: 'rate', source: row.source, found }); mismatched.add(row.row); }
    }
    checks.push({ tab: title, reportYear: year, reportMonth: month, headerMonth, sourceRows, phoneMatchedRows, phoneMismatchedRows: sourceRows - phoneMatchedRows - unresolvedRowReferences.length,
      matchedRows: sourceRows - mismatched.size - unresolvedRowReferences.length, mismatchedRows: mismatched.size,
      unresolvedRows: unresolvedRowReferences.length, unresolvedRowReferences, differences, structural,
      closureRule: 'COUNTIFS(monthly sale, mapped employee, monthly page, page); all statuses; explicit report month',
      rateRule: 'one sale/page closed count / sum(first + repeat/5) for mapped sale/page; zero denominator null',
      mappedTotals: [...mapped.values()] });
  }
  return checks;
}
function makeBatch(workbookId, data, year) {
  const batch = { workbookId, ...data };
  const hash = createHash('sha256').update(JSON.stringify({ importerVersion: 1, year, ...batch })).digest('hex');
  return { batchKey: `sheets-marketing-v1:${year}:${hash}`, ...batch };
}
function prepareHistoryImport(snapshot, { year } = {}) {
  if (!validYear(year)) throw invalid();
  for (const kind of ['phones', 'report']) {
    if (snapshot?.workbooks?.[kind]?.workbookId !== WORKBOOK_IDS[kind] || !snapshot.workbooks[kind].sheets) throw invalid();
  }
  const { phones, report } = snapshot.workbooks;
  const unresolved = { creditedDate: [], createdAt: [], sourceHeader: [], employee: [], alias: [], monthlyPage: [], monthlyClosedAt: [], monthlyEmployee: [], monthlyUnmappedEmployee: [] };
  const { aliases, summary: aliasSummary } = parseAliases(report);
  const names = new Set(aliases.map(a => a.rawName)), saleNames = new Set(aliases.map(a => a.reportEmployee));
  const rawRows = [], rawSummary = []; let order = 0;
  for (const page of PAGE_SOURCES) {
    const values = requireSheet(phones, page.rawTab);
    if (p.norm(values[0]?.[19]) !== 'số điện thoại' || p.norm(values[0]?.[15]) !== 'tạo lúc') throw invalid([ref(page.rawTab, 1)]);
    const types = {}, typeKeys = new Map(); let count = 0;
    values.slice(1).forEach((raw, i) => {
      if (!filled(raw[19])) return;
      const rowNumber = i + 2, rowRef = ref(page.rawTab, rowNumber), sourceCreatedText = cellText(raw[15]), employeeRaw = cellText(raw[18]), phone = cellText(raw[19]);
      const sourceCreatedAt = parseCreatedTimestamp(raw[15]), creditedDate = parseHistoricalDate(raw[20], year);
      if (!sourceCreatedAt) unresolved.createdAt.push(rowRef);
      if (!creditedDate) unresolved.creditedDate.push(rowRef);
      if (!filled(employeeRaw)) unresolved.employee.push(rowRef);
      else if (!names.has(employeeRaw)) unresolved.alias.push(rowRef);
      types[typeof raw[19]] = (types[typeof raw[19]] || 0) + 1;
      if (!typeKeys.has(phone)) typeKeys.set(phone, { types: new Set(), rows: [] });
      typeKeys.get(phone).types.add(typeof raw[19]); typeKeys.get(phone).rows.push(rowRef);
      rawRows.push({ tab: page.rawTab, rowNumber, pageId: page.pageId, sourceCreatedAt, sourceCreatedText, phone, phoneKey: phone, employeeRaw, creditedDate, raw });
      count++;
    });
    rawSummary.push({ tab: page.rawTab, pageId: page.pageId, rows: count, expectedRows: page.expectedRaw, phoneCellTypes: types,
      mixedPhoneTypeKeys: [...typeKeys.values()].filter(group => group.types.size > 1).map(group => group.rows) });
  }
  const aggregationRows = rawRows.map(row => ({ ...row, workbookId: phones.workbookId, sourceOrder: String(++order), origin: 'sheet' }));
  unresolved.sourceHeader = aggregationRows.filter(row => !isPhoneReportObservation(row)).map(row => ref(row.tab, row.rowNumber));
  const aggregated = aggregatePhones(aggregationRows, aliases);
  const monthly = importMonthly(report, year, unresolved);
  for (const row of monthly.rows) if (filled(row.sale) && !saleNames.has(row.sale)) unresolved.monthlyUnmappedEmployee.push(ref(row.sourceTab, row.sourceRow));
  const summary = { mode: 'dry-run', importYear: year, capturedAt: snapshot.capturedAt ?? null, phonePolicy: PHONE_POLICY,
    revenuePolicy: 'source money retained in raw provenance only; KiotViet provider unchanged',
    rawRows: rawRows.length, uniquePhones: aggregated.length, monthlyRows: monthly.rows.length, aliases: aliasSummary,
    raw: rawSummary, monthly: monthly.summary, unresolved,
    standard: reconcileStandard(phones, aggregated, year), checks: reconcileChecks(report, aggregated, year, aliases, monthly.rows) };
  return { batches: [makeBatch(phones.workbookId, { rawRows }, year), makeBatch(report.workbookId, { rawRows: [], monthlyRows: monthly.rows, aliases }, year)], summary };
}
async function applyHistoryImport(prepared, repository, actor) {
  const results = [];
  for (const batch of prepared.batches) results.push(await repository.importHistory(batch, actor));
  return results;
}
async function captureHistorySnapshot({ clients, now = () => new Date() } = {}) {
  if (!clients) {
    const { createReadOnlyClient } = require('../sheets/sheetsClient');
    clients = Object.fromEntries(Object.entries(WORKBOOK_IDS).map(([kind, id]) => [kind, createReadOnlyClient(() => id, 'Marketing history')]));
  }
  const workbooks = {};
  for (const kind of ['phones', 'report']) {
    const titles = await clients[kind].listSheetTitles();
    const selected = kind === 'phones' ? PAGE_SOURCES.flatMap(page => [page.rawTab, page.standardTab]) : titles.filter(t => t === 'Tên' || /^bc tháng /i.test(t) || /^check tỷ lệ nhận số t/i.test(t));
    if (selected.some(t => !titles.includes(t)) || (kind === 'report' && !selected.includes('Tên'))) throw invalid();
    const sheets = {};
    for (const title of selected) sheets[title] = await clients[kind].getValues(title, { valueRenderOption: 'UNFORMATTED_VALUE' });
    workbooks[kind] = { workbookId: WORKBOOK_IDS[kind], titles, sheets };
  }
  return { capturedAt: now().toISOString(), workbooks };
}
module.exports = { prepareHistoryImport, applyHistoryImport, captureHistorySnapshot, parseHistoricalDate, parseCreatedTimestamp, WORKBOOK_IDS, PAGE_SOURCES, PHONE_POLICY };
