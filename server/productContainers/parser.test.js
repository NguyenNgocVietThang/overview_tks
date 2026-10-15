'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseContainerSheet, normalizeCode } = require('./parser');
const row = (code, quantity, extra = {}) => Object.assign(Array(24).fill(''), { 0: code, 14: quantity }, extra);
test('only O contributes; repeated rows, zero, decimals and all five statuses survive', () => {
  const values = [row('ignored', 90)];
  for (let s = 1; s <= 5; s++) values.push([' CONT SAME ', `${s}. Trạng thái`, 'DK 14-16/10'], row(' 001a ', s === 1 ? 100 : s === 2 ? 50 : s === 3 ? 30 : 20, {12:999,13:999}));
  values.push(row('001A', 0), row('001A', 1.5), ['END'], row('001A', 900));
  const parsed = parseContainerSheet('YIWU', values);
  assert.equal(parsed.rows.length, 7);
  assert.equal(parsed.rows[0].productKey, '001a');
  assert.equal(parsed.rows[0].quantity, 100);
  assert.equal(parsed.rows[0].eta, 'DK 14-16/10');
  assert.equal(parsed.rows[0].containerName, 'CONT SAME');
  assert.equal(normalizeCode(' AB-01 '), 'ab-01');
  assert.notEqual(normalizeCode('00123'), normalizeCode('123'));
});
test('20 blank displayed rows close a block but later CONT resumes; 19 do not', () => {
  const values = [['CONT A','1.Chưa có lịch'], ...Array.from({length:19},()=>[]), row('YES',1), ...Array.from({length:20},()=>[]), row('NO',2), ['CONT B','3.Đã bốc'], row('YES',3)];
  assert.deepEqual(parseContainerSheet('SD',values).rows.map(x=>x.quantity), [1,3]);
  const withNote = [['CONT A','1.Chưa có lịch'], ...Array.from({length:19},()=>[]), row('', '', {5:'note'}), ...Array.from({length:19},()=>[]), row('YES',4)];
  assert.equal(parseContainerSheet('SD',withNote).rows.length,1);
});
test('invalid status skips entire block and invalid O never falls back to M*N', () => {
  const values = [['CONT BAD','12.X'],row('BAD',4),['CONT GOOD','2.Chưa bốc'],['Mã SP'],row('A','',{12:2,13:4}),row('A','#REF!'),row('A',-1),row('A',5,{12:'#N/A',13:'',23:'#DIV/0!'})];
  const parsed = parseContainerSheet('KHÁC',values);
  assert.deepEqual(parsed.rows.map(x=>x.quantity),[5]);
  assert.equal(parsed.rows[0].unitsPerPackage,null);
  assert.equal(parsed.rows[0].vietnamPrice,null);
  assert.equal(parsed.warnings.length,4);
});
test('formatted dates are preserved and blank formulas use displayed value', () => {
  const raw = [['CONT A','3.Đã bốc',45678],row('SKU',50,{11:45670})];
  const displayed = [['CONT A','3.Đã bốc','DK 10/10'],row('SKU','50',{11:'15/10'})];
  const result = parseContainerSheet('SD',raw,displayed);
  assert.equal(result.rows[0].listedAt,'15/10');
  assert.equal(result.rows[0].eta,'DK 10/10');
  assert.equal(result.rows[0].sourceRow,2);
});
test('displayed numeric product codes preserve leading zeroes',()=>{
  const raw=[['CONT A','2.Chưa bốc'],row(123,4)];
  const displayed=[['CONT A','2.Chưa bốc'],row('00123','4')];
  const result=parseContainerSheet('YIWU',raw,displayed);
  assert.equal(result.rows[0].productCode,'00123');
  assert.equal(result.rows[0].productKey,'00123');
});
