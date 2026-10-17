'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseInvoicePasteRows, rowsToQueries, parseDocumentCodes } = require('./pasteParser');

test('dan tay trang Xu ly hoa don: bo dong trang, bo tieu de "Mã SP ... SL", dem 5 cot', () => {
  const rows = parseInvoicePasteRows('\nMã SP\tTên SP\tSL\tGiá bán\nSP01\tSản phẩm 1\t200\t10000\n\n  \nSP02\tSản phẩm 2\t50\n');
  assert.deepEqual(rows, [
    ['SP01', 'Sản phẩm 1', '200', '10000', ''],
    ['SP02', 'Sản phẩm 2', '50', '', '']
  ]);
  // Tieu de chi bi bo khi cot 3 la "SL".
  assert.equal(parseInvoicePasteRows('Mã SP\tTên\tSố lượng').length, 1);
});

test('rowsToQueries: orderIndex tinh ca dong bi bo vi trong ca ma lan ten', () => {
  const queries = rowsToQueries([['SP01', '', '1', '', ''], ['', ' ', '2', '', ''], ['', 'Tên', '3', '', 'note']]);
  assert.deepEqual(queries.map(q => [q.orderIndex, q.maSp, q.tenSp, q.ghiChuHangHoa]), [[1, 'SP01', '', ''], [3, '', 'Tên', 'note']]);
});

test('parseDocumentCodes: tach, viet hoa, bo trung, loai ma la', () => {
  const parsed = parseDocumentCodes('hd028346, HD028345;DH044391\nHD028346  xyz HD028345.01');
  assert.deepEqual(parsed.codes, ['HD028346', 'HD028345', 'DH044391', 'HD028345.01']);
  assert.deepEqual(parsed.invalid, ['XYZ']);
  assert.equal(parsed.truncated, false);
});
