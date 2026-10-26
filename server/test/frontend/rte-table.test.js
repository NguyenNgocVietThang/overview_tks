'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const RteTable = require('../../public/shared/rte-table.js');

function mount(t, html) {
  const dom = new JSDOM('<!DOCTYPE html><body><div id="root">' + html + '</div></body>');
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  return { doc, root: doc.getElementById('root'), table: doc.querySelector('table') };
}

// Luoi dang chuoi: moi o la textContent, o rong -> '_'
function shape(table) {
  return RteTable.buildGrid(table).map(row =>
    Array.from(row).map(c => (c ? (c.textContent.trim() || '_') : '.'))
  );
}

function cellByText(table, text) {
  return Array.from(table.querySelectorAll('td,th')).find(c => c.textContent.trim() === text);
}

const PLAIN =
  '<table><tbody>' +
  '<tr><td>a</td><td>b</td><td>c</td></tr>' +
  '<tr><td>d</td><td>e</td><td>f</td></tr>' +
  '</tbody></table>';

// A chiem 2 hang (cot 0), B chiem 2 cot (hang 0)
const MERGED =
  '<table><tbody>' +
  '<tr><td rowspan="2">A</td><td colspan="2">B</td></tr>' +
  '<tr><td>C</td><td>D</td></tr>' +
  '<tr><td>E</td><td>F</td><td>G</td></tr>' +
  '</tbody></table>';

test('buildGrid va cellPosition tren bang co o gop', t => {
  const { table } = mount(t, MERGED);
  assert.deepEqual(shape(table), [
    ['A', 'B', 'B'],
    ['A', 'C', 'D'],
    ['E', 'F', 'G']
  ]);
  assert.deepEqual(RteTable.cellPosition(cellByText(table, 'A')), { row: 0, col: 0 });
  assert.deepEqual(RteTable.cellPosition(cellByText(table, 'B')), { row: 0, col: 1 });
  assert.deepEqual(RteTable.cellPosition(cellByText(table, 'D')), { row: 1, col: 2 });
});

test('insertRow bang thuong: truoc va sau', t => {
  const { table } = mount(t, PLAIN);
  const tr = RteTable.insertRow(cellByText(table, 'a'), true);
  assert.equal(tr.cells.length, 3);
  assert.equal(tr.cells[0].tagName, 'TD');
  assert.equal(tr.cells[0].innerHTML, '<br>');
  assert.deepEqual(shape(table).map(r => r[0]), ['_', 'a', 'd']);
  RteTable.insertRow(cellByText(table, 'd'), false);
  assert.deepEqual(shape(table).map(r => r[0]), ['_', 'a', 'd', '_']);
});

test('insertRow bang gop: sau o rowspan tinh sau hang cuoi no phu', t => {
  const { table } = mount(t, MERGED);
  RteTable.insertRow(cellByText(table, 'A'), false);
  assert.deepEqual(shape(table), [
    ['A', 'B', 'B'],
    ['A', 'C', 'D'],
    ['_', '_', '_'],
    ['E', 'F', 'G']
  ]);
  assert.equal(cellByText(table, 'A').getAttribute('rowspan'), '2');
});

test('insertRow bang gop: chen giua vung rowspan thi tang rowspan', t => {
  const { table } = mount(t, MERGED);
  // chen truoc hang 1 (hang chua C): A phu qua vi tri chen
  const tr = RteTable.insertRow(cellByText(table, 'C'), true);
  assert.equal(tr.cells.length, 2);
  assert.equal(cellByText(table, 'A').getAttribute('rowspan'), '3');
  assert.deepEqual(shape(table), [
    ['A', 'B', 'B'],
    ['A', '_', '_'],
    ['A', 'C', 'D'],
    ['E', 'F', 'G']
  ]);
});

test('insertRow truoc hang toan th dung th; sau hang thead dua vao tbody', t => {
  const { table } = mount(t,
    '<table><thead><tr><th>h1</th><th>h2</th></tr></thead>' +
    '<tbody><tr><td>x</td><td>y</td></tr></tbody></table>');
  const before = RteTable.insertRow(cellByText(table, 'h1'), true);
  assert.equal(before.cells[0].tagName, 'TH');
  const after = RteTable.insertRow(cellByText(table, 'h1'), false);
  assert.equal(after.cells[0].tagName, 'TD');
  assert.equal(after.parentNode.tagName, 'TBODY');
  assert.equal(after.parentNode.firstElementChild, after);
});

test('insertColumn bang thuong: trai va phai', t => {
  const { table } = mount(t, PLAIN);
  RteTable.insertColumn(cellByText(table, 'b'), true);
  assert.deepEqual(shape(table), [['a', '_', 'b', 'c'], ['d', '_', 'e', 'f']]);
  RteTable.insertColumn(cellByText(table, 'c'), false);
  assert.deepEqual(shape(table), [['a', '_', 'b', 'c', '_'], ['d', '_', 'e', 'f', '_']]);
});

test('insertColumn bang gop: tang colspan khi o phu qua vi tri chen', t => {
  const { table } = mount(t, MERGED);
  // chen ben trai C (cot 1): B colspan 2 bat dau o cot 1 nen khong bi cat
  RteTable.insertColumn(cellByText(table, 'C'), true);
  assert.deepEqual(shape(table), [
    ['A', '_', 'B', 'B'],
    ['A', '_', 'C', 'D'],
    ['E', '_', 'F', 'G']
  ]);
  // chen ben phai C (cot 2 cu): nam giua B (colspan 2) -> tang colspan
  const { table: t2 } = mount(t, MERGED);
  RteTable.insertColumn(cellByText(t2, 'C'), false);
  assert.equal(cellByText(t2, 'B').getAttribute('colspan'), '3');
  assert.deepEqual(shape(t2), [
    ['A', 'B', 'B', 'B'],
    ['A', 'C', '_', 'D'],
    ['E', 'F', '_', 'G']
  ]);
});

test('insertColumn: o moi cung loai th/td voi o cung hang', t => {
  const { table } = mount(t,
    '<table><tr><th>h1</th><th>h2</th></tr><tr><td>x</td><td>y</td></tr></table>');
  RteTable.insertColumn(cellByText(table, 'h2'), false);
  const rows = table.rows;
  assert.equal(rows[0].cells[2].tagName, 'TH');
  assert.equal(rows[1].cells[2].tagName, 'TD');
});

test('deleteRow bang thuong', t => {
  const { table } = mount(t, PLAIN);
  const res = RteTable.deleteRow(cellByText(table, 'a'));
  assert.deepEqual(res, { removedTable: false });
  assert.deepEqual(shape(table), [['d', 'e', 'f']]);
});

test('deleteRow bang gop: giam rowspan cua o phu tu tren', t => {
  const { table } = mount(t, MERGED);
  RteTable.deleteRow(cellByText(table, 'C'));
  assert.equal(cellByText(table, 'A').hasAttribute('rowspan'), false);
  assert.deepEqual(shape(table), [['A', 'B', 'B'], ['E', 'F', 'G']]);
});

test('deleteRow bang gop: doi o rowspan xuong hang ke', t => {
  const { table } = mount(t, MERGED);
  RteTable.deleteRow(cellByText(table, 'B'));
  assert.deepEqual(shape(table), [['A', 'C', 'D'], ['E', 'F', 'G']]);
  const a = cellByText(table, 'A');
  assert.equal(a.hasAttribute('rowspan'), false);
  assert.equal(a.parentNode, table.rows[0]);
  assert.equal(a, table.rows[0].cells[0]);
});

test('deleteRow hang cuoi cung xoa luon bang', t => {
  const { root, table } = mount(t, '<table><tbody><tr><td>only</td></tr></tbody></table><p>after</p>');
  const res = RteTable.deleteRow(table.rows[0].cells[0]);
  assert.deepEqual(res, { removedTable: true });
  assert.equal(root.querySelector('table'), null);
  assert.equal(root.querySelector('p').textContent, 'after');
});

test('deleteRow xoa nhom thead khi het hang', t => {
  const { table } = mount(t,
    '<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>x</td></tr></tbody></table>');
  RteTable.deleteRow(cellByText(table, 'h'));
  assert.equal(table.querySelector('thead'), null);
  assert.equal(table.rows.length, 1);
});

test('deleteColumn bang thuong', t => {
  const { table } = mount(t, PLAIN);
  const res = RteTable.deleteColumn(cellByText(table, 'b'));
  assert.deepEqual(res, { removedTable: false });
  assert.deepEqual(shape(table), [['a', 'c'], ['d', 'f']]);
});

test('deleteColumn bang gop: giam colspan, xoa o colspan 1', t => {
  const { table } = mount(t, MERGED);
  RteTable.deleteColumn(cellByText(table, 'D'));
  // cot 2: B colspan 2 -> 1, D va G bi xoa
  assert.equal(cellByText(table, 'B').hasAttribute('colspan'), false);
  assert.deepEqual(shape(table), [['A', 'B'], ['A', 'C'], ['E', 'F']]);
});

test('deleteColumn cot dau co o rowspan: xoa o rowspan mot lan', t => {
  const { table } = mount(t, MERGED);
  RteTable.deleteColumn(cellByText(table, 'A'));
  assert.equal(cellByText(table, 'A'), undefined);
  assert.deepEqual(shape(table), [['B', 'B'], ['C', 'D'], ['F', 'G']]);
});

test('deleteColumn cot cuoi cung xoa luon bang', t => {
  const { root, table } = mount(t, '<table><tr><td>1</td></tr><tr><td>2</td></tr></table>');
  const res = RteTable.deleteColumn(table.rows[0].cells[0]);
  assert.deepEqual(res, { removedTable: true });
  // bang la phan tu cuoi cua container -> thay bang doan trong
  assert.equal(root.innerHTML, '<p><br></p>');
});

test('mergeCells gop vung chu nhat, noi noi dung va bo o trong', t => {
  const { table } = mount(t,
    '<table><tr><td>a</td><td>b</td><td>c</td></tr>' +
    '<tr><td>d</td><td><br></td><td>f</td></tr></table>');
  const ok = RteTable.mergeCells(cellByText(table, 'a'), table.rows[1].cells[1]);
  assert.equal(ok, true);
  const a = cellByText(table, 'a') || table.rows[0].cells[0];
  assert.equal(a.getAttribute('colspan'), '2');
  assert.equal(a.getAttribute('rowspan'), '2');
  assert.equal(a.innerHTML, 'a<br>b<br>d');
  assert.deepEqual(shape(table).map(r => r.length), [3, 3]);
  assert.deepEqual(shape(table), [['a', 'a', 'c'], ['a', 'a', 'f']].map(r => r.map(x => (x === 'a' ? 'a\nb\nd'.replace(/\n/g, '') : x))));
});

test('mergeCells tu choi vung cat o gop khac', t => {
  const { table } = mount(t, MERGED);
  // vung bao C va E gom ca o A (rowspan 2 nhung bat dau ngoai/ cat) -> khong hop le
  const before = table.outerHTML;
  assert.equal(RteTable.mergeCells(cellByText(table, 'C'), cellByText(table, 'E')), false);
  assert.equal(table.outerHTML, before);
  // cung mot o
  assert.equal(RteTable.mergeCells(cellByText(table, 'C'), cellByText(table, 'C')), false);
});

test('mergeCells cho phep vung chua tron o gop', t => {
  const { table } = mount(t, MERGED);
  // vung A,B (hang 0-1, cot 0-2) chua tron A, B, C, D
  assert.equal(RteTable.mergeCells(cellByText(table, 'A'), cellByText(table, 'D')), true);
  const a = table.rows[0].cells[0];
  assert.equal(a.getAttribute('colspan'), '3');
  assert.equal(a.getAttribute('rowspan'), '2');
  assert.equal(table.rows[1].cells.length, 0);
  assert.equal(table.rows[2].cells.length, 3);
});

test('splitCell tach o gop thanh o trong, giu noi dung o goc', t => {
  const { table } = mount(t, MERGED);
  assert.equal(RteTable.splitCell(cellByText(table, 'A')), true);
  assert.deepEqual(shape(table), [
    ['A', 'B', 'B'],
    ['_', 'C', 'D'],
    ['E', 'F', 'G']
  ]);
  assert.equal(RteTable.splitCell(cellByText(table, 'B')), true);
  assert.deepEqual(shape(table), [
    ['A', 'B', '_'],
    ['_', 'C', 'D'],
    ['E', 'F', 'G']
  ]);
  assert.equal(table.rows[1].cells[0].tagName, 'TD');
  assert.equal(table.rows[1].cells[0].innerHTML, '<br>');
});

test('splitCell o thuong tra false', t => {
  const { table } = mount(t, PLAIN);
  assert.equal(RteTable.splitCell(cellByText(table, 'a')), false);
});

test('merge roi split tra ve luoi ban dau (hinh dang)', t => {
  const { table } = mount(t, PLAIN);
  RteTable.mergeCells(cellByText(table, 'a'), cellByText(table, 'e'));
  RteTable.splitCell(table.rows[0].cells[0]);
  const g = shape(table);
  assert.equal(g.length, 2);
  assert.deepEqual(g.map(r => r.length), [3, 3]);
});

test('setBorder dat thuoc tinh hop le', t => {
  const { table } = mount(t, PLAIN);
  RteTable.setBorder(table, { style: 'outer', width: 2, color: '#FF0000' });
  assert.equal(table.getAttribute('data-border'), 'outer');
  assert.equal(table.getAttribute('data-border-width'), '2');
  assert.equal(table.getAttribute('style'), '--tb-color:#ff0000');
});

test('setBorder giu nguyen phan khong truyen', t => {
  const { table } = mount(t, PLAIN);
  RteTable.setBorder(table, { style: 'all', width: 3, color: '#abc' });
  RteTable.setBorder(table, { width: 1 });
  assert.equal(table.getAttribute('data-border'), 'all');
  assert.equal(table.getAttribute('data-border-width'), '1');
  assert.equal(table.getAttribute('style'), '--tb-color:#abc');
});

test('setBorder xoa mau/kieu khi rong', t => {
  const { table } = mount(t, PLAIN);
  RteTable.setBorder(table, { style: 'none', width: 2, color: '#123456' });
  RteTable.setBorder(table, { color: null });
  assert.equal(table.hasAttribute('style'), false);
  RteTable.setBorder(table, { color: '#123456' });
  RteTable.setBorder(table, { color: '' });
  assert.equal(table.hasAttribute('style'), false);
  RteTable.setBorder(table, { style: '' });
  assert.equal(table.hasAttribute('data-border'), false);
  assert.equal(table.getAttribute('data-border-width'), '2');
});

test('setBorder bo qua dau vao sai', t => {
  const { table } = mount(t, PLAIN);
  RteTable.setBorder(table, { style: 'all', width: 2, color: '#112233' });
  RteTable.setBorder(table, {
    style: 'dotted',
    width: 9,
    color: 'red; background:url(x)'
  });
  assert.equal(table.getAttribute('data-border'), 'all');
  assert.equal(table.getAttribute('data-border-width'), '2');
  assert.equal(table.getAttribute('style'), '--tb-color:#112233');
  RteTable.setBorder(table, { width: 'abc', color: '#12' });
  assert.equal(table.getAttribute('data-border-width'), '2');
  assert.equal(table.getAttribute('style'), '--tb-color:#112233');
  RteTable.setBorder(table, { width: 1.5, style: 123 });
  assert.equal(table.getAttribute('data-border-width'), '2');
  assert.equal(table.getAttribute('data-border'), 'all');
  assert.doesNotThrow(() => RteTable.setBorder(table, null));
});

test('setBorder giu khai bao style khac, chi doi --tb-color', t => {
  const { table } = mount(t, '<table style="margin:0;--tb-color:#000000"><tr><td>x</td></tr></table>');
  RteTable.setBorder(table, { color: '#ffffff' });
  assert.equal(table.getAttribute('style'), 'margin:0;--tb-color:#ffffff');
});

test('setColumnWidth clamp 40-800 va ghi width cho o colspan 1', t => {
  const { table } = mount(t, MERGED);
  assert.equal(RteTable.setColumnWidth(table, 1, 120.4), 120);
  // cot 1 co C (colspan 1) va F; B colspan 2 bi bo qua
  assert.equal(cellByText(table, 'C').getAttribute('width'), '120');
  assert.equal(cellByText(table, 'F').getAttribute('width'), '120');
  assert.equal(cellByText(table, 'B').hasAttribute('width'), false);
  assert.equal(RteTable.getColumnWidth(table, 1), 120);
  assert.equal(RteTable.setColumnWidth(table, 0, 5), 40);
  assert.equal(RteTable.setColumnWidth(table, 0, 99999), 800);
  assert.equal(cellByText(table, 'E').getAttribute('width'), '800');
  // o A rowspan 2 van colspan 1 -> duoc ghi
  assert.equal(cellByText(table, 'A').getAttribute('width'), '800');
  assert.equal(RteTable.getColumnWidth(table, 0), 800);
});

test('setColumnWidth dau vao khong hop le', t => {
  const { table } = mount(t, PLAIN);
  assert.equal(RteTable.setColumnWidth(table, 0, 'abc'), null);
  assert.equal(RteTable.getColumnWidth(table, 0), null);
  assert.equal(RteTable.getColumnWidth(table, 2), null);
});

test('removeTable: thay doan trong khi la phan tu cuoi, nguoc lai chi xoa', t => {
  const a = mount(t, PLAIN);
  RteTable.removeTable(a.table);
  assert.equal(a.root.innerHTML, '<p><br></p>');
  const b = mount(t, PLAIN + '<p>tail</p>');
  RteTable.removeTable(b.table);
  assert.equal(b.root.innerHTML, '<p>tail</p>');
});
