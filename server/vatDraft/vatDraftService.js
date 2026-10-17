'use strict';

// Ghep dau vao (chung tu chon tu DB hoac du lieu dan tay) -> thuat toan port tu vat-draft-app
// -> payload cho trang Nhap VAT. Chung tu tu DB duoc dua ve DUNG 7 truong ma app cu doc tu
// file "Danh sach chi tiet hoa don" (Ma hang, Ten hang, So luong, Gia ban, Ghi chu hang hoa,
// Ma hoa don, Thanh tien), cong them "Ghi chu tong" chi gan o buoc hien thi.

const { pyStrip, pyRound } = require('./pyCompat');
const { allocateInvoiceSources, buildUnifiedColumns, buildUnifiedDisplayRows } = require('./allocation');
const { lookupAllSources, buildAllSourcesDisplayRows, buildLookupIssueRows, ALL_SOURCES_COLUMNS, LOOKUP_ISSUE_COLUMNS } = require('./sourceLookup');
const { parseInvoicePasteRows, parseLookupPasteRows, rowsToQueries, parseDocumentCodes } = require('./pasteParser');
const vietqr = require('./vietqr');
const { parseInvoiceText } = require('./invoicePdfText');
const vatDraftConfig = require('./vatDraftConfig');

const MAX_DOCUMENTS = 200;
const MAX_LINES = 5000;
const MAX_PASTE_CHARS = 2 * 1024 * 1024;

function badRequest(message, code = 'VAT_DRAFT_INVALID') {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  return error;
}

function masterDataMeta(snapshot) {
  return {
    loadedAt: snapshot.loadedAt ? new Date(snapshot.loadedAt).toISOString() : null,
    stale: !!snapshot.stale,
    stockRows: snapshot.stockRows.length,
    mappingRows: snapshot.mappingRows.length,
    invalidStockRows: (snapshot.warnings || []).length
  };
}

function normalizeSelections(documents) {
  if (!Array.isArray(documents) || !documents.length) throw badRequest('Chưa chọn chứng từ nào.');
  if (documents.length > MAX_DOCUMENTS) throw badRequest(`Mỗi lần xử lý tối đa ${MAX_DOCUMENTS} chứng từ.`);
  return documents.map(d => ({
    kind: String(d && d.kind || ''),
    branch: String(d && d.branch || ''),
    code: String(d && d.code || '').trim().toUpperCase()
  }));
}

/** Chung tu -> query thuat toan (bo dong khong co Ma hang nhu bo doc file cu) + Ghi chu tong theo dong. */
function documentsToQueries(docs) {
  const queries = [];
  const extraByOrder = new Map();
  for (const doc of docs) {
    for (const line of doc.lines) {
      const maSp = pyStrip(line.productCode);
      if (!maSp) continue;
      const orderIndex = queries.length + 1;
      queries.push({
        orderIndex,
        maSp,
        tenSp: pyStrip(line.productName),
        sl: pyStrip(line.quantity),
        giaBan: pyStrip(line.unitPrice),
        ghiChuHangHoa: pyStrip(line.note),
        maHoaDon: doc.code,
        thanhTien: pyStrip(line.lineTotal)
      });
      extraByOrder.set(orderIndex, { 'Ghi chú tổng': pyStrip(doc.docNote || '') });
    }
  }
  if (queries.length > MAX_LINES) throw badRequest(`Quá ${MAX_LINES} dòng hàng mỗi lần xử lý. Hãy chọn ít chứng từ hơn.`);
  return { queries, extraByOrder };
}

function pasteText(text) {
  const value = typeof text === 'string' ? text : '';
  if (value.length > MAX_PASTE_CHARS) throw badRequest('Dữ liệu dán quá lớn.');
  return value;
}

function createVatDraftService({ repository, masterData, config = vatDraftConfig }) {
  async function loadMaster() {
    return masterData.get();
  }

  async function documentsInput(documents) {
    const docs = await repository.readDocumentLines(normalizeSelections(documents));
    return { docs, ...documentsToQueries(docs) };
  }

  /** Chuc nang 1 — Xu ly hoa don. */
  async function allocate({ source, documents, text } = {}) {
    let queries;
    let extraByOrder;
    let docs = [];
    const hasMeta = source === 'documents';
    if (hasMeta) {
      ({ docs, queries, extraByOrder } = await documentsInput(documents));
    } else if (source === 'paste') {
      const raw = pasteText(text);
      if (!pyStrip(raw)) throw badRequest('Hãy dán dữ liệu hóa đơn trước khi kiểm tra.');
      queries = rowsToQueries(parseInvoicePasteRows(raw));
      if (queries.length > MAX_LINES) throw badRequest(`Quá ${MAX_LINES} dòng mỗi lần xử lý.`);
    } else {
      throw badRequest('Nguồn dữ liệu không hợp lệ.');
    }
    if (!queries.length) throw badRequest('Chưa có dòng hóa đơn nào để kiểm tra.');

    const master = await loadMaster();
    const result = allocateInvoiceSources(queries, master.mappingRows, master.stockRows, config);
    const columns = buildUnifiedColumns(hasMeta);
    const display = buildUnifiedDisplayRows(result.lines, result.shortages, result.issues, { extraByOrder });

    let qr = null;
    if (result.lines.length) {
      const accountKeys = config.vietqr.accounts.map(a => a.key);
      const bySource = [...vietqr.computeSourceAmounts(result.lines).values()].map(amount => {
        const account = vietqr.getAccountForSource(amount.nguon, config);
        return {
          nguon: amount.nguon,
          soDong: amount.soDong,
          tongGiaBan: amount.tongGiaBan,
          tongGiaNhap: amount.tongGiaNhap,
          thieuDonGia: amount.thieuDonGia,
          defaultAccountKey: account && accountKeys.includes(account.key) ? account.key : accountKeys[0] || null,
          // int(round(x)) cua Python (banker's), khong am.
          defaultAmount: Math.max(pyRound(amount.tongGiaNhap), 0)
        };
      });
      const total = vietqr.computeTotalAmount(result.lines);
      qr = {
        transferContent: hasMeta ? docs.map(d => d.code).join(' ') : '',
        bySource,
        total: {
          soDong: total.soDong,
          tongGiaBan: total.tongGiaBan,
          thieuDonGia: total.thieuDonGia,
          defaultAccountKey: accountKeys[0] || null,
          defaultAmount: Math.max(pyRound(total.tongGiaBan), 0)
        }
      };
    }

    return {
      hasMeta,
      columns,
      rows: display.map(row => ({ values: columns.map(column => row[column] ?? null), reason: row['Ghi chú'] || '' })),
      metrics: {
        inputCount: queries.length,
        okProducts: new Set(result.lines.map(l => l.queryOrder)).size,
        shortageProducts: result.shortageProductCount,
        missingCount: result.issues.length
      },
      qr,
      documents: docs.map(d => ({ kind: d.kind, branch: d.branch, code: d.code })),
      masterData: masterDataMeta(master)
    };
  }

  /** Chuc nang 2 — Tra cuu nguon (chi dung 5 truong dau nhu app cu). */
  async function lookup({ source, documents, text } = {}) {
    let queries;
    if (source === 'documents') {
      ({ queries } = await documentsInput(documents));
      queries = queries.map(q => ({ ...q, maHoaDon: '', thanhTien: '' }));
    } else if (source === 'paste') {
      const rows = parseLookupPasteRows(pasteText(text));
      if (!rows.length) throw badRequest('Không đọc được dòng dữ liệu nào từ vùng dán.');
      queries = rowsToQueries(rows);
      if (queries.length > MAX_LINES) throw badRequest(`Quá ${MAX_LINES} dòng mỗi lần tra cứu.`);
    } else {
      throw badRequest('Nguồn dữ liệu không hợp lệ.');
    }
    if (!queries.length) throw badRequest('Hãy nhập ít nhất một Mã SP hoặc Tên SP.');

    const master = await loadMaster();
    const result = lookupAllSources(queries, master.mappingRows, master.stockRows, config);
    return {
      columns: [...ALL_SOURCES_COLUMNS],
      rows: buildAllSourcesDisplayRows(result.lines).map(row => ALL_SOURCES_COLUMNS.map(column => row[column] ?? '')),
      issueColumns: [...LOOKUP_ISSUE_COLUMNS],
      issues: buildLookupIssueRows(result.issues).map(row => LOOKUP_ISSUE_COLUMNS.map(column => row[column] ?? '')),
      masterData: masterDataMeta(master)
    };
  }

  /** Chuc nang 3 — URL anh QR (tai khoan cau hinh hoac nhap tay). */
  function qrUrl({ accountKey, manual, amount, addInfo } = {}) {
    let account;
    let accountLabel;
    if (manual) {
      const bankId = String(manual.bankId || '').trim();
      const accountNo = String(manual.accountNo || '').trim();
      const accountName = String(manual.accountName || '').trim().slice(0, 100);
      if (!vietqr.isValidManualField(bankId) || !vietqr.isValidManualField(accountNo)) {
        throw badRequest('Nhập đủ Mã ngân hàng và Số tài khoản (chỉ chữ và số) để tạo QR.');
      }
      account = { bankId, accountNo, accountName };
      accountLabel = `${bankId} - ${accountNo}${accountName ? ` (${accountName})` : ''}`;
    } else {
      account = config.vietqr.accounts.find(a => a.key === accountKey);
      if (!account) throw badRequest('Tài khoản nhận tiền không hợp lệ.');
      accountLabel = vietqr.formatAccountLabel(account);
    }
    const value = vietqr.parseAmountInput(String(amount ?? ''));
    const info = pyStrip(String(addInfo || '')).slice(0, 200);
    return {
      url: vietqr.buildVietqrImageUrl(account, { amount: value, addInfo: info, template: config.vietqr.template }),
      amount: value,
      accountLabel,
      addInfo: info
    };
  }

  function parsePdfText(text) {
    const parsed = parseInvoiceText(String(text || '').normalize('NFC').slice(0, 500000));
    return {
      ...parsed,
      matchedAccountKeys: parsed.error ? [] : vietqr.getAccountsForSeller(parsed.sellerName, config).map(a => a.key)
    };
  }

  function accountsMeta() {
    return {
      template: config.vietqr.template,
      commonBankCodes: vietqr.COMMON_BANK_CODES,
      accounts: config.vietqr.accounts.map(a => ({ key: a.key, label: vietqr.formatAccountLabel(a) }))
    };
  }

  return { allocate, lookup, qrUrl, parsePdfText, accountsMeta, masterDataMeta, parseDocumentCodes };
}

module.exports = { createVatDraftService, documentsToQueries, MAX_DOCUMENTS, MAX_LINES };
