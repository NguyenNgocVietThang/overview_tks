'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const p = require('./marketingParsers');

test('whitespace numeric cells are missing, not zero',()=>assert.equal(p.number('   '),null));

test('monthly uses source totals, preserves text phones and spreadsheet errors', () => {
  const rows = [['SALE','ID khách trên Kiot','SĐT lấy từ Pancake','PAGE LẤY SỐ','Tình trạng','DATA TỪ ĐÂU','Ngày Chốt đơn','Doanh Số Tháng 10','Khách mới','Note'],
    ['','','','','','','',999,'','','','','Page','Số khách chốt'],
    ['An','KH1','0912345678','Hữu Nghị','Chưa chốt','Mới','08/10/2026','#N/A','','ghi chú','','','Hữu Nghị',7]];
  const result = p.parseMonthly(rows, 'BC Tháng 10');
  assert.equal(result.rows[0].phone, '0912345678');
  assert.equal(result.rows[0].revenue, null);
  assert.equal(result.totalRevenue, 999);
  assert.equal(result.pages[0].closed, 7);
});

test('check keeps computed ratios and separate employee aggregate', () => {
  const rows = [['BÁO CÁO SĐT T9','SĐT LẦN ĐẦU','SĐT CHÀO LẠI','QUY ĐỔI','PAGE','Tên NV','Khách chốt','Tỷ lệ chốt'],
    ['Pancake',5,10,7,'Hữu Nghị','An',3,0.7,'','','','','','','','NV','SĐT LẦN ĐẦU','SĐT CHÀO LẠI','QUY ĐỔI','Số khách chốt','Tỷ lệ chốt'],
    ['','','','','','','','','','','','','','','','','An',5,10,7,3,0.9]];
  const result = p.parseCheck(rows, 'CHECK Tỷ lệ nhận số T10');
  assert.equal(result.rows[0].rate, 0.7);
  assert.equal(result.employees[0].rate, 0.9);
});

test('phones retain page identity and formatted phone zero prefix', () => {
  const values = [['Số điện thoại','Nhân viên lần đầu','Nhân viên hiện tại','Tính chào lại','THỜI GIAN','THỜI GIAN','Tính chào lại'], ['0912345678','An','Bình','Bình','01/10','02/10','02/10'], []];
  const a = p.parsePhones(values,'HỮU NGHỊ CHUẨN','Hữu Nghị');
  const b = p.parsePhones(values,'HN-SG Chuẩn','HN-SG');
  assert.equal(a.rows.length, 1);
  assert.notEqual(a.rows[0].key, b.rows[0].key);
  assert.equal(a.rows[0].phone,'0912345678');
});

test('costs distinguish paired blocks, source totals and daily rows', () => {
  const headers=['','Chi phí','Chi phí + Phí Thuê','SL mess','Chi phí /mess','SL SĐT','Chi phí /SĐT'];
  const rows=[headers.concat(['','',...headers]), ['Tháng 10/26',10,99,2,49.5,1,99,'','','Tháng 10/26',4,8,1,8,1,8], ['01/10',10,11,2,5.5,1,11,'','','01/10',4,8,1,8,1,8]];
  const parsed=p.parseCosts(rows,'Chi Phí Hữu Nghị+Quảng Châu');
  assert.equal(parsed.rows.length,2);
  assert.equal(parsed.totals.length,2);
  assert.equal(parsed.totals[0].totalCost,99);
  assert.deepEqual(parsed.rows.map(r=>r.page),['Hữu Nghị','Quảng Châu']);
});

test('costs handle serial dates and trailing totals without turning errors into zero', () => {
  const rows=[['NGÀY THÁNG','Chi phí','Chi phí +VAT','SL mess','Chi phí /mess','SL SĐT','Chi phí /SĐT'], [46296,10,11,0,'#DIV/0!',0,'#DIV/0!'], ['Tổng',10,12,0,'#DIV/0!',0,'#DIV/0!']];
  const parsed=p.parseCosts(rows,'CHI PHÍ ADS-SG');
  assert.equal(parsed.rows[0].month,10);
  assert.equal(parsed.rows[0].costPerPhone,null);
  assert.equal(parsed.totals[0].totalCost,12);
});

test('numeric phone cells regain the leading zero', () => {
  assert.equal(p.phoneText(912345678), '0912345678');
  assert.equal(p.phoneText(84912345678), '0912345678');
  assert.equal(p.phoneText('0912345678'), '0912345678');
  assert.equal(p.phoneText(null), '');
  const rows = [['SALE','ID','SĐT'],['','','',''],['An','KH1',912345678,'Hữu Nghị']];
  assert.equal(p.parseMonthly(rows, 'BC Tháng 10').rows[0].phone, '0912345678');
});
