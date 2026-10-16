'use strict';

// Port 1:1 lookup_all_sources + build_all_sources_display_rows (src/source_lookup.py) —
// chuc nang "Tra cuu nguon": tra MOI dong nguon cua Ma VAT, khong phan bo, khong chon.
// Nguon con ton duong xep truoc (ton it truoc), sau do nguon het/am ton.

const { pySortedStrings } = require('./pyCompat');
const { normalizeCode, normalizeCodeForMatch, toFloatOrNone } = require('./normalization');
const {
  buildMappingIndexes,
  addGopVatMappingFallbacks,
  computeGiaNhap,
  sortedBy,
  pushTo
} = require('./allocation');
const vatDraftConfig = require('./vatDraftConfig');

function addIssue(result, query, maSp, tenSp, issueType, detail) {
  result.issues.push({ queryOrder: query.orderIndex, maSp, tenSp, issueType, detail });
}

function resolveMappings(query, mappingsByCode, mappingsByName, result) {
  const maSp = normalizeCode(query.maSp);
  const tenSp = normalizeCode(query.tenSp);
  let mappings;
  if (maSp) {
    mappings = mappingsByCode.get(normalizeCodeForMatch(maSp)) || [];
    if (!mappings.length) {
      addIssue(result, query, maSp, tenSp, 'khong_tim_thay_ma', `Không tìm thấy Mã SP '${maSp}'.`);
      return null;
    }
  } else if (tenSp) {
    mappings = mappingsByName.get(normalizeCodeForMatch(tenSp)) || [];
    if (!mappings.length) {
      addIssue(result, query, maSp, tenSp, 'khong_tim_thay_ten', `Không tìm thấy chính xác Tên SP '${tenSp}'.`);
      return null;
    }
    const distinctCodes = pySortedStrings(new Set(mappings.filter(m => m.maSp).map(m => m.maSp)));
    if (distinctCodes.length > 1) {
      addIssue(
        result, query, maSp, tenSp, 'ten_trung_nhieu_ma',
        `Tên SP khớp nhiều mã: ${distinctCodes.join(', ')}. Hãy nhập Mã SP để chọn chính xác.`
      );
      return null;
    }
  } else {
    addIssue(result, query, maSp, tenSp, 'thieu_dieu_kien', 'Cần nhập ít nhất Mã SP hoặc Tên SP.');
    return null;
  }

  const distinctVat = new Set(mappings.filter(m => m.maVatKiotNorm).map(m => m.maVatKiotNorm));
  if (distinctVat.size !== 1) {
    const vatLabels = pySortedStrings(new Set(mappings.filter(m => m.maVatKiot).map(m => m.maVatKiot)));
    const detail = vatLabels.length
      ? `Sản phẩm đang trỏ tới nhiều Mã VAT: ${vatLabels.join(', ')}.`
      : 'Sản phẩm chưa có Mã VAT trong sheet Khớp mã.';
    addIssue(result, query, maSp, tenSp, 'ma_vat_khong_duy_nhat', detail);
    return null;
  }
  return { mapping: mappings[0], vatNorm: [...distinctVat][0] };
}

/** lookup_all_sources -> { lines, issues }. */
function lookupAllSources(queries, mappingRows, stockRows, config = vatDraftConfig) {
  const result = { lines: [], issues: [], skippedNonPositiveStockCount: 0 };
  const { byCode: mappingsByCode, byName: mappingsByName } = buildMappingIndexes(mappingRows);
  addGopVatMappingFallbacks(mappingsByCode, stockRows);

  const stockByVat = new Map();
  for (const stock of stockRows || []) {
    if (!stock.maVatKiotNorm) continue;
    pushTo(stockByVat, stock.maVatKiotNorm, stock);
  }

  for (const query of queries || []) {
    const resolved = resolveMappings(query, mappingsByCode, mappingsByName, result);
    if (!resolved) continue;
    const { mapping, vatNorm } = resolved;

    const candidates = sortedBy(stockByVat.get(vatNorm) || [], stock => [
      stock.tonCoTheNhap <= 0,
      stock.tonCoTheNhap > 0 ? stock.tonCoTheNhap : -stock.tonCoTheNhap,
      normalizeCodeForMatch(stock.nguon),
      stock.rowIndex
    ]);
    if (!candidates.length) {
      addIssue(
        result, query, mapping.maSp, mapping.tenSp, 'khong_co_nguon',
        `Mã VAT '${mapping.maVatKiot}' không có dòng nguồn trong sheet Gộp VAT.`
      );
      continue;
    }

    const giaBan = toFloatOrNone(query.giaBan);
    for (const stock of candidates) {
      result.lines.push({
        queryOrder: query.orderIndex,
        maSp: mapping.maSp,
        tenSp: mapping.tenSp,
        sl: query.sl,
        giaBan: query.giaBan,
        maVat: mapping.maVatKiot,
        tenVat: mapping.tenTruocVat || stock.tenVatKiot,
        tenKeToan: stock.tenKeToan,
        dvt: stock.donViTinh,
        nguon: stock.nguon,
        tonConNhap: stock.tonCoTheNhap,
        phanTramVat: stock.thueVat,
        giaNhap: computeGiaNhap(giaBan, stock.thueVat, config)
      });
    }
  }
  return result;
}

const ALL_SOURCES_COLUMNS = Object.freeze([
  'Mã kiot', 'Tên kiot', 'SL', 'Giá bán', 'Mã VAT', 'Tên VAT', 'Mã kế toán', 'ĐVT', 'Nguồn', 'Tồn nháp được', '%VAT'
]);
const LOOKUP_ISSUE_COLUMNS = Object.freeze(['Dòng nhập', 'Mã SP', 'Tên SP', 'Nội dung']);

/** Bang nhieu nguon: thong tin dau vao chi hien o dong dau moi san pham. */
function buildAllSourcesDisplayRows(lines) {
  const seen = new Set();
  return lines.map(line => {
    const isFirst = !seen.has(line.queryOrder);
    seen.add(line.queryOrder);
    return {
      'Mã kiot': isFirst ? line.maSp : '',
      'Tên kiot': isFirst ? line.tenSp : '',
      'SL': isFirst ? toFloatOrNone(line.sl) : '',
      'Giá bán': isFirst ? toFloatOrNone(line.giaBan) : '',
      'Mã VAT': line.maVat,
      'Tên VAT': line.tenVat,
      'Mã kế toán': line.tenKeToan,
      'ĐVT': line.dvt,
      'Nguồn': line.nguon,
      'Tồn nháp được': line.tonConNhap,
      '%VAT': line.phanTramVat !== null && line.phanTramVat !== undefined ? line.phanTramVat * 100 : null
    };
  });
}

function buildLookupIssueRows(issues) {
  return issues.map(issue => ({
    'Dòng nhập': issue.queryOrder,
    'Mã SP': issue.maSp,
    'Tên SP': issue.tenSp,
    'Nội dung': issue.detail
  }));
}

module.exports = {
  ALL_SOURCES_COLUMNS,
  LOOKUP_ISSUE_COLUMNS,
  lookupAllSources,
  buildAllSourcesDisplayRows,
  buildLookupIssueRows
};
