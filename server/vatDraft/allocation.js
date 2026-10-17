'use strict';

// Port 1:1 src/invoice_allocation.py (vat-draft-app) — chuc nang "Xu ly hoa don":
// chia SL tung dong hoa don ra cac nguon theo TON CO THE NHAP (hien la TON CON NHAP).
//   * Tong ton moi nguon >= SL thi san pham moi hop le.
//   * Co nguon tu no du SL: chi dung 1 nguon, uu tien nguon xuat hien nhieu nhat.
//   * Khong nguon nao du: lay toi da tu nguon xuat hien nhieu nhat, phan thieu lay
//     tiep theo ton giam dan cho toi khi du dung SL.
//   * Tong ton van < SL: san pham vao nhom "Thieu ton".
// Deterministic, KHONG tru ton mo phong giua cac dong (giu dung hanh vi app cu).
// KHONG sua thuat toan o day — "Ghi chu tong" chi gan them o buoc hien thi.

const { pyStrip, pyStr, pyRound, pySum, pyMin2, pyMax2, cmpTuple, pySortedStrings } = require('./pyCompat');
const { normalizeCode, normalizeCodeForMatch, toFloatOrNone } = require('./normalization');
const { calculateAccountingNameScore } = require('./nameMatching');
const vatDraftConfig = require('./vatDraftConfig');

// Sai so cho phep khi so sanh so thuc (SL va ton co the la so le).
const TOLERANCE = 1e-9;

const STATUS_OK = 'OK';
const STATUS_SHORTAGE = 'Thiếu tồn';
const STATUS_MISSING = 'Không có mã';
const GIA_NHAP_COLUMN = 'GIÁ NHÁP\n(Giá bán/(1+%VAT))';

/** `str(x).strip() if x else ""` cua Python. */
function cleanText(value) {
  return value ? pyStrip(pyStr(value)) : '';
}

/** sorted(list, key=...) on dinh cua Python voi khoa tuple. */
function sortedBy(items, keyFn) {
  return items
    .map((item, index) => ({ item, key: keyFn(item), index }))
    .sort((a, b) => cmpTuple(a.key, b.key) || a.index - b.index)
    .map(entry => entry.item);
}

function computeGiaNhap(giaBan, phanTramVat, config) {
  if (giaBan !== null && phanTramVat !== null && phanTramVat !== undefined && (1 + phanTramVat) !== 0) {
    return pyRound(giaBan / (1 + phanTramVat), config.giaNhapDecimalPlaces);
  }
  return null;
}

/** Hien thi so luong gon (_format_qty): 1,234 / 1,234.50. */
function formatQty(value) {
  if (Number.isInteger(value)) {
    return Math.trunc(value).toLocaleString('en-US');
  }
  if (!Number.isFinite(value)) return Number.isNaN(value) ? 'nan' : (value > 0 ? 'inf' : '-inf');
  const [intPart, frac] = Math.abs(pyRound(value, 2)).toFixed(2).split('.');
  const grouped = Number(intPart).toLocaleString('en-US');
  return `${value < 0 ? '-' : ''}${grouped}.${frac}`;
}

// ---------------------------------------------------------------------------
// Tra cuu ma san pham -> ma VAT -> cac dong ton
// ---------------------------------------------------------------------------

function pushTo(map, key, value) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function buildMappingIndexes(mappingRows) {
  const byCode = new Map();
  const byName = new Map();
  for (const mapping of mappingRows || []) {
    if (mapping.maSpNorm) pushTo(byCode, mapping.maSpNorm, mapping);
    const nameNorm = normalizeCodeForMatch(mapping.tenSp);
    if (nameNorm) pushTo(byName, nameNorm, mapping);
  }
  return { byCode, byName };
}

/**
 * Bo sung Ma SP chi co trong cot "Mã kiot đại diện" cua Gop VAT. Khop ma van uu tien:
 * ma da co o Khop ma thi khong tron dong Gop VAT; ma chua co thi giu MOI Ma VAT tim thay.
 */
function addGopVatMappingFallbacks(mappingsByCode, stockRows) {
  const fallbackByCode = new Map();
  for (const stock of stockRows || []) {
    const maSpNorm = normalizeCodeForMatch(stock.maKiotDaiDien);
    if (!maSpNorm || mappingsByCode.has(maSpNorm)) continue;
    pushTo(fallbackByCode, maSpNorm, {
      rowIndex: stock.rowIndex,
      maSp: stock.maKiotDaiDien,
      tenSp: stock.tenKiotDaiDien,
      maVatKiot: stock.maVatKiot,
      tenTruocVat: stock.tenVatKiot,
      maSpNorm,
      maVatKiotNorm: stock.maVatKiotNorm
    });
  }
  for (const [key, value] of fallbackByCode) mappingsByCode.set(key, value);
}

function buildStockIndex(stockRows, result) {
  const stockByVat = new Map();
  for (const stock of stockRows || []) {
    if (!stock.maVatKiotNorm) continue;
    // Khong loai dong ton <= 0 khoi chi muc: buoc resolve can phan biet "het ton"
    // voi "Ma VAT khong ton tai". Loai khoi ung vien phan bo nam o allocateOneProduct.
    if (stock.tonCoTheNhap === null || stock.tonCoTheNhap === undefined || stock.tonCoTheNhap <= 0) {
      result.skippedNonPositiveStockCount += 1;
    }
    pushTo(stockByVat, stock.maVatKiotNorm, stock);
  }
  return stockByVat;
}

function addIssue(result, query, maSp, tenSp, issueType, detail) {
  result.issues.push({
    queryOrder: query.orderIndex,
    maSp,
    tenSp,
    issueType,
    detail,
    sl: query.sl,
    giaBan: query.giaBan,
    ghiChuHangHoa: cleanText(query.ghiChuHangHoa),
    maHoaDon: cleanText(query.maHoaDon),
    thanhTien: toFloatOrNone(query.thanhTien)
  });
}

function resolveQuery(query, mappingsByCode, mappingsByName, stockByVat, config, result) {
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

  const mapping = mappings[0];

  const sl = toFloatOrNone(query.sl);
  if (query.sl === null || query.sl === undefined || pyStrip(pyStr(query.sl)) === '') {
    addIssue(result, query, mapping.maSp, mapping.tenSp, 'sl_trong', 'SL để trống.');
    return null;
  }
  if (sl === null) {
    addIssue(result, query, mapping.maSp, mapping.tenSp, 'sl_khong_phai_so', `SL='${pyStr(query.sl)}' không phải số.`);
    return null;
  }
  if (sl <= 0) {
    addIssue(result, query, mapping.maSp, mapping.tenSp, 'sl_khong_duong', `SL=${formatQty(sl)} phải lớn hơn 0.`);
    return null;
  }

  const stocks = stockByVat.get([...distinctVat][0]) || [];
  if (!stocks.length) {
    addIssue(
      result, query, mapping.maSp, mapping.tenSp, 'khong_con_ton_duong',
      `Mã VAT '${mapping.maVatKiot}' không còn nguồn nào có tồn nháp dương.`
    );
    return null;
  }

  const candidates = stocks.map(stock => ({
    stock,
    score: calculateAccountingNameScore({
      tenKeToan: stock.tenKeToan,
      userTenSp: tenSp || mapping.tenSp,
      khopMaTenSp: mapping.tenSp,
      tenVatKiot: stock.tenVatKiot,
      tenTruocVatRaw: mapping.tenTruocVat,
      weights: config.nameMatchWeights
    }).score
  }));

  return { query, mapping, maSp: mapping.maSp, tenSp: mapping.tenSp, sl, candidates };
}

// ---------------------------------------------------------------------------
// Phan bo
// ---------------------------------------------------------------------------

function buildLine(item, stock, qty, config) {
  const giaBan = toFloatOrNone(item.query.giaBan);
  const phanTramVat = stock.thueVat;
  return {
    queryOrder: item.query.orderIndex,
    maSp: item.maSp,
    tenSp: item.tenSp,
    slYeuCau: item.sl,
    slPhanBo: qty,
    giaBan: item.query.giaBan,
    maVat: item.mapping.maVatKiot,
    tenVat: item.mapping.tenTruocVat || stock.tenVatKiot,
    tenKeToan: stock.tenKeToan,
    dvt: stock.donViTinh,
    nguon: stock.nguon,
    tonConNhap: stock.tonCoTheNhap,
    phanTramVat,
    giaNhap: computeGiaNhap(giaBan, phanTramVat, config),
    ghiChuHangHoa: cleanText(item.query.ghiChuHangHoa),
    maHoaDon: cleanText(item.query.maHoaDon),
    thanhTien: toFloatOrNone(item.query.thanhTien)
  };
}

/** Moi nguon con ton duong cua san pham thieu ton lay 1 dong dai dien (ton giam dan). */
function selectShortageSources(candidates, sourceKey) {
  const bySource = new Map();
  for (const candidate of candidates) pushTo(bySource, candidate.stock.nguon, candidate);

  const stockBySource = new Map();
  for (const [source, rows] of bySource) {
    stockBySource.set(source, pySum(rows.map(c => pyMax2(0.0, c.stock.tonCoTheNhap))));
  }
  const positiveSources = [...stockBySource].filter(([, stock]) => stock > 0).map(([source]) => source);
  let selectedSources = positiveSources.length ? positiveSources : [sortedBy([...bySource.keys()], sourceKey)[0]];
  selectedSources = sortedBy(selectedSources, source => [-stockBySource.get(source), ...sourceKey(source)]);

  return selectedSources.map(source => {
    const positive = bySource.get(source).filter(c => c.stock.tonCoTheNhap > 0);
    const sourceCandidates = positive.length ? positive : bySource.get(source);
    const best = sortedBy(sourceCandidates, c => [-c.score, c.stock.rowIndex])[0];
    return { best, source, sourceStock: stockBySource.get(source) };
  });
}

/**
 * Chia `need` trong MOT nguon: uu tien 1 dong ton du ca `need` (diem ten cao nhat, ton
 * thap nhat); khong co thi lay dan tu dong ton lon nhat de so dong ket qua it nhat.
 */
function allocateWithinSource(candidates, need) {
  const single = candidates.filter(c => c.stock.tonCoTheNhap >= need - TOLERANCE);
  if (single.length) {
    const best = sortedBy(single, c => [-c.score, c.stock.tonCoTheNhap, c.stock.rowIndex])[0];
    return [{ candidate: best, qty: need }];
  }
  const taken = [];
  let remaining = need;
  for (const candidate of sortedBy(candidates, c => [-c.stock.tonCoTheNhap, -c.score, c.stock.rowIndex])) {
    if (remaining <= TOLERANCE) break;
    const qty = pyMin2(candidate.stock.tonCoTheNhap, remaining);
    if (qty <= TOLERANCE) continue;
    taken.push({ candidate, qty });
    remaining -= qty;
  }
  return taken;
}

function allocateOneProduct(item, sourceKey, config, result) {
  const need = item.sl;
  const usable = item.candidates.filter(c => c.stock.tonCoTheNhap > 0);
  const totalTon = pySum(usable.map(c => c.stock.tonCoTheNhap));

  if (need > totalTon + TOLERANCE) {
    const thieu = need - totalTon;
    const giaBan = toFloatOrNone(item.query.giaBan);
    for (const { best, source, sourceStock } of selectShortageSources(item.candidates, sourceKey)) {
      const phanTramVat = best.stock.thueVat;
      result.shortages.push({
        queryOrder: item.query.orderIndex,
        maSp: item.maSp,
        tenSp: item.tenSp,
        slYeuCau: need,
        tongTon: totalTon,
        thieu,
        giaBan: item.query.giaBan,
        maVat: item.mapping.maVatKiot,
        tenVat: item.mapping.tenTruocVat || best.stock.tenVatKiot,
        tenKeToan: best.stock.tenKeToan,
        dvt: best.stock.donViTinh,
        nguon: source,
        tonConNhap: sourceStock,
        phanTramVat,
        giaNhap: computeGiaNhap(giaBan, phanTramVat, config),
        ghiChuHangHoa: cleanText(item.query.ghiChuHangHoa),
        maHoaDon: cleanText(item.query.maHoaDon),
        thanhTien: toFloatOrNone(item.query.thanhTien),
        ghiChu: 'Không đủ số lượng tồn'
      });
    }
    return;
  }

  const bySource = new Map();
  for (const candidate of usable) pushTo(bySource, candidate.stock.nguon, candidate);
  const totalBySource = new Map();
  for (const [nguon, rows] of bySource) totalBySource.set(nguon, pySum(rows.map(c => c.stock.tonCoTheNhap)));

  const plan = [];
  const fullSources = [...totalBySource].filter(([, total]) => total >= need - TOLERANCE).map(([nguon]) => nguon);

  if (fullSources.length) {
    // Chi dung mot nguon khi mot nguon da du; uu tien nguon xuat hien nhieu nhat.
    plan.push([sortedBy(fullSources, sourceKey)[0], need]);
  } else {
    // Lay toi da tu nguon xuat hien nhieu nhat, phan con thieu lay tiep theo ton giam dan.
    const first = sortedBy([...totalBySource.keys()], sourceKey)[0];
    const rest = sortedBy(
      [...totalBySource.keys()].filter(n => n !== first),
      n => [-totalBySource.get(n), ...sourceKey(n)]
    );
    let remaining = need;
    for (const nguon of [first, ...rest]) {
      if (remaining <= TOLERANCE) break;
      const take = pyMin2(totalBySource.get(nguon), remaining);
      if (take <= TOLERANCE) continue;
      plan.push([nguon, take]);
      remaining -= take;
    }
  }

  for (const [nguon, take] of plan) {
    for (const { candidate, qty } of allocateWithinSource(bySource.get(nguon), take)) {
      result.lines.push(buildLine(item, candidate.stock, qty, config));
    }
  }
}

/**
 * allocate_invoice_sources(queries, mapping_rows, stock_rows) ->
 * { lines, shortages, issues, skippedNonPositiveStockCount, shortageProductCount }.
 * query: { orderIndex, maSp, tenSp, sl, giaBan, ghiChuHangHoa, maHoaDon, thanhTien }.
 */
function allocateInvoiceSources(queries, mappingRows, stockRows, config = vatDraftConfig) {
  const result = { lines: [], shortages: [], issues: [], skippedNonPositiveStockCount: 0 };

  const { byCode: mappingsByCode, byName: mappingsByName } = buildMappingIndexes(mappingRows);
  addGopVatMappingFallbacks(mappingsByCode, stockRows);
  const stockByVat = buildStockIndex(stockRows, result);

  const resolved = [];
  for (const query of queries || []) {
    const item = resolveQuery(query, mappingsByCode, mappingsByName, stockByVat, config, result);
    if (item) resolved.push(item);
  }

  // So lan xuat hien cua moi nguon con ton duong: dem theo so san pham co nguon do,
  // khong dem trung nhieu dong ton cua cung san pham.
  const appearanceCount = new Map();
  for (const item of resolved) {
    for (const nguon of new Set(item.candidates.filter(c => c.stock.tonCoTheNhap > 0).map(c => c.stock.nguon))) {
      appearanceCount.set(nguon, (appearanceCount.get(nguon) || 0) + 1);
    }
  }

  const priorityList = config.sourceTiebreakPriority.map(normalizeCodeForMatch);
  const sourceKey = nguon => {
    const nguonNorm = normalizeCodeForMatch(nguon);
    const priorityIndex = priorityList.indexOf(nguonNorm);
    return [-(appearanceCount.get(nguon) || 0), priorityIndex === -1 ? priorityList.length : priorityIndex, nguonNorm];
  };

  for (const item of resolved) allocateOneProduct(item, sourceKey, config, result);

  result.shortageProductCount = new Set(result.shortages.map(s => s.queryOrder)).size;
  return result;
}

// ---------------------------------------------------------------------------
// Bang hien thi
// ---------------------------------------------------------------------------

const CHECK_RESULT_COLUMNS = Object.freeze([
  'MÃ SP', 'TÊN SP', 'Mã VAT', 'TÊN VAT', 'Ghi chú hàng hóa', 'NGUỒN', 'TỒN CÒN NHÁP',
  'Giá bán', 'TÊN KẾ TOÁN', 'ĐVT', 'SL', GIA_NHAP_COLUMN, '%VAT'
]);

/**
 * build_unified_columns(has_invoice_meta): "Trạng thái" + cot nghiep vu; khi du lieu den
 * tu chung tu (hasInvoiceMeta) chen "Mã hóa đơn" sau "TÊN VAT", "Ghi chú tổng" ngay sau
 * "Ghi chú hàng hóa" (cot moi cua tks_web) va "Thành tiền" o cuoi.
 */
function buildUnifiedColumns(hasInvoiceMeta) {
  let columns = [...CHECK_RESULT_COLUMNS];
  if (hasInvoiceMeta) {
    const tenVatIdx = columns.indexOf('TÊN VAT') + 1;
    columns = [...columns.slice(0, tenVatIdx), 'Mã hóa đơn', ...columns.slice(tenVatIdx)];
    const noteIdx = columns.indexOf('Ghi chú hàng hóa') + 1;
    columns = [...columns.slice(0, noteIdx), 'Ghi chú tổng', ...columns.slice(noteIdx)];
    columns.push('Thành tiền');
  }
  return ['Trạng thái', ...columns];
}

function percent(value) {
  return value !== null && value !== undefined ? value * 100 : null;
}

/**
 * Gop 3 nhom (OK / Thieu ton / Khong co ma) vao mot bang; cac dong cung Ma hoa don
 * nam canh nhau (nhom theo Ma hoa don xuat hien truoc, trong nhom giu thu tu nhap).
 * `extraByOrder`: Map(orderIndex -> { 'Ghi chú tổng': ... }) gan them cot hien thi.
 */
function buildUnifiedDisplayRows(lines, shortages, issues, { extraByOrder } = {}) {
  const entries = [];
  const extra = order => (extraByOrder && extraByOrder.get(order)) || {};

  lines.forEach((line, order) => {
    entries.push([line.queryOrder, String(line.maHoaDon || ''), order, {
      'Trạng thái': STATUS_OK,
      'MÃ SP': line.maSp,
      'TÊN SP': line.tenSp,
      'SL': line.slPhanBo,
      'Giá bán': toFloatOrNone(line.giaBan),
      'Mã VAT': line.maVat,
      'TÊN VAT': line.tenVat,
      'TÊN KẾ TOÁN': line.tenKeToan,
      'ĐVT': line.dvt,
      'NGUỒN': line.nguon,
      'TỒN CÒN NHÁP': line.tonConNhap,
      '%VAT': percent(line.phanTramVat),
      [GIA_NHAP_COLUMN]: line.giaNhap,
      'Ghi chú hàng hóa': line.ghiChuHangHoa,
      'Mã hóa đơn': line.maHoaDon,
      'Thành tiền': line.thanhTien,
      'Ghi chú': '',
      ...extra(line.queryOrder)
    }]);
  });

  shortages.forEach((shortage, order) => {
    entries.push([shortage.queryOrder, String(shortage.maHoaDon || ''), order, {
      'Trạng thái': STATUS_SHORTAGE,
      'MÃ SP': shortage.maSp,
      'TÊN SP': shortage.tenSp,
      'SL': shortage.slYeuCau,
      'Giá bán': toFloatOrNone(shortage.giaBan),
      'Mã VAT': shortage.maVat,
      'TÊN VAT': shortage.tenVat,
      'TÊN KẾ TOÁN': shortage.tenKeToan,
      'ĐVT': shortage.dvt,
      'NGUỒN': shortage.nguon,
      'TỒN CÒN NHÁP': shortage.tonConNhap,
      '%VAT': percent(shortage.phanTramVat),
      [GIA_NHAP_COLUMN]: shortage.giaNhap,
      'Ghi chú hàng hóa': shortage.ghiChuHangHoa,
      'Mã hóa đơn': shortage.maHoaDon,
      'Thành tiền': shortage.thanhTien,
      // Cot Trang thai da the hien "Thieu ton", khong lap lai.
      'Ghi chú': '',
      ...extra(shortage.queryOrder)
    }]);
  });

  issues.forEach((issue, order) => {
    entries.push([issue.queryOrder, String(issue.maHoaDon || ''), order, {
      'Trạng thái': STATUS_MISSING,
      'MÃ SP': issue.maSp,
      'TÊN SP': issue.tenSp,
      'SL': toFloatOrNone(issue.sl),
      'Giá bán': toFloatOrNone(issue.giaBan),
      'Mã VAT': '',
      'TÊN VAT': '',
      'TÊN KẾ TOÁN': '',
      'ĐVT': '',
      'NGUỒN': '',
      'TỒN CÒN NHÁP': null,
      '%VAT': null,
      [GIA_NHAP_COLUMN]: null,
      'Ghi chú hàng hóa': issue.ghiChuHangHoa,
      'Mã hóa đơn': issue.maHoaDon,
      'Thành tiền': issue.thanhTien,
      'Ghi chú': issue.detail,
      ...extra(issue.queryOrder)
    }]);
  });

  const firstSeen = new Map();
  for (const [queryOrder, maHoaDon] of entries) {
    const current = firstSeen.get(maHoaDon);
    if (current === undefined || queryOrder < current) firstSeen.set(maHoaDon, queryOrder);
  }

  return sortedBy(entries, e => [firstSeen.get(e[1]), e[1], e[0], e[2]]).map(e => e[3]);
}

module.exports = {
  TOLERANCE,
  STATUS_OK,
  STATUS_SHORTAGE,
  STATUS_MISSING,
  GIA_NHAP_COLUMN,
  allocateInvoiceSources,
  buildUnifiedColumns,
  buildUnifiedDisplayRows,
  formatQty,
  // dung lai o sourceLookup.js
  buildMappingIndexes,
  addGopVatMappingFallbacks,
  computeGiaNhap,
  sortedBy,
  pushTo,
  __test__: { selectShortageSources, allocateWithinSource }
};
