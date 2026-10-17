'use strict';

// Parser CSV toi gian cho file export cua Google Sheets (dau phay, nhay kep, "" la
// nhay kep thuc, xuong dong trong o duoc bao bang nhay kep). Dong rong hoan toan bi
// bo qua nhu pandas (skip_blank_lines).

function parseCsv(text) {
  const source = String(text || '').replace(/^\uFEFF/, '');
  const records = [];
  let record = [];
  let field = '';
  let inQuotes = false;
  let fieldStarted = false;
  let i = 0;

  const endField = () => {
    record.push(field);
    field = '';
    fieldStarted = false;
  };
  const endRecord = () => {
    // Dong rong hoan toan (khong co dau phay nao) -> bo qua.
    if (!(record.length === 0 && !fieldStarted && field === '')) {
      endField();
      records.push(record);
    }
    record = [];
    field = '';
    fieldStarted = false;
  };

  while (i < source.length) {
    const ch = source[i];
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      fieldStarted = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      endField();
      fieldStarted = true;
      i += 1;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      endRecord();
      i += ch === '\r' && source[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += ch;
    fieldStarted = true;
    i += 1;
  }
  if (fieldStarted || field !== '' || record.length) endRecord();
  return records;
}

module.exports = { parseCsv };
