'use strict';

function isPhoneReportObservation(row) {
  // UNIQUE(raw!T:T) also emits the source header as its first row. CHUAN uses
  // that row as its header, so repeated embedded headers are not phone facts.
  return !(row.origin === 'sheet' && row.phone === 'Số điện thoại' && row.sourceCreatedText === 'Tạo lúc');
}

// Keep source identity intact. Mapping is deliberately applied after selecting
// first/last observations: two raw names mapped to one sale can still repeat.
function aggregatePhones(rawRows, aliases = []) {
  const mapping = new Map(aliases.map(a => [a.rawName, a.reportEmployee]));
  const groups = new Map();
  const ordered = [...rawRows].sort((a, b) => {
    const left = BigInt(a.sourceOrder), right = BigInt(b.sourceOrder);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  for (const row of ordered) {
    if (!isPhoneReportObservation(row)) continue;
    const phoneKey = row.phoneKey ?? row.phone;
    const key = JSON.stringify([row.pageId, phoneKey]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].map(([key, rows]) => {
    const first = rows[0], last = rows[rows.length - 1];
    const firstEmployee = first.employeeRaw || '', currentEmployee = last.employeeRaw || '';
    const repeatEmployee = firstEmployee !== currentEmployee ? currentEmployee : '';
    const firstAt = first.creditedDate ?? null, currentAt = last.creditedDate ?? null;
    const repeatAt = firstAt !== currentAt ? currentAt : null;
    const mapped = employee => mapping.get(employee) ?? null;
    return {
      key, pageId: first.pageId, phone: first.phone, phoneKey: first.phoneKey ?? first.phone,
      firstEmployee, currentEmployee, repeatEmployee, firstAt, currentAt, repeatAt,
      mappedFirstEmployee: mapped(firstEmployee), mappedCurrentEmployee: mapped(currentEmployee),
      mappedRepeatEmployee: repeatEmployee ? mapped(repeatEmployee) : null,
      firstRow: first, lastRow: last,
      trace: rows.map(row => ({ origin: row.origin || 'sheet', id: row.id ?? null, workbookId: row.workbookId ?? null,
        tab: row.tab ?? null, rowNumber: row.rowNumber ?? null, sourceOrder: String(row.sourceOrder),
        factId: row.factId ?? null, runId: row.runId ?? null, sourceKey: row.sourceKey ?? null })),
      unresolved: {
        firstEmployee: !firstEmployee, currentEmployee: !currentEmployee,
        firstAlias: Boolean(firstEmployee) && !mapping.has(firstEmployee),
        currentAlias: Boolean(currentEmployee) && !mapping.has(currentEmployee),
        firstDate: !firstAt, currentDate: !currentAt
      }
    };
  });
}

// Raw employee/page grouping remains available to reconcile COUNTIFS. Consumers
// can request mapped employees after grouping without splitting multi-name cells.
function countPhoneKpis(phones, { year, month, mapped = false } = {}) {
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  const raw = new Map();
  for (const row of phones) {
    for (const [kind, employee, date, mappedEmployee] of [
      ['first', row.firstEmployee, row.firstAt, row.mappedFirstEmployee],
      ['repeat', row.repeatEmployee, row.repeatAt, row.mappedRepeatEmployee]
    ]) {
      if (!date?.startsWith(prefix) || (kind === 'repeat' && !employee)) continue;
      const key = JSON.stringify([row.pageId, employee]);
      if (!raw.has(key)) raw.set(key, { pageId: row.pageId, employee, mappedEmployee, first: 0, repeat: 0 });
      raw.get(key)[kind]++;
    }
  }
  let rows = [...raw.values()];
  if (mapped) {
    const groups = new Map();
    for (const row of rows) {
      const key = JSON.stringify([row.pageId, row.mappedEmployee]);
      if (!groups.has(key)) groups.set(key, { pageId: row.pageId, employee: row.mappedEmployee, first: 0, repeat: 0 });
      const target = groups.get(key); target.first += row.first; target.repeat += row.repeat;
    }
    rows = [...groups.values()];
  }
  return rows.map(row => ({ ...row, equivalent: row.first + row.repeat / 5 }));
}

function countMonthlyClosures(monthlyRows, { year, month } = {}) {
  const groups = new Map();
  for (const row of monthlyRows) {
    if (row.reportYear !== year || row.reportMonth !== month) continue;
    const key = JSON.stringify([row.pageId, row.sale]);
    if (!groups.has(key)) groups.set(key, { pageId: row.pageId, employee: row.sale, closed: 0 });
    groups.get(key).closed++;
  }
  return [...groups.values()];
}

module.exports = { aggregatePhones, countPhoneKpis, countMonthlyClosures, isPhoneReportObservation };
