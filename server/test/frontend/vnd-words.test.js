'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { toVietnameseWords } = require('../../public/vat-draft/vnd-words');
const { parseVietnameseAmountWords } = require('../../vatDraft/amountWords');

test('so tien -> chu: dung cach doc tren hoa don mau', () => {
  assert.equal(toVietnameseWords(10933056), 'Mười triệu chín trăm ba mươi ba nghìn không trăm năm mươi sáu đồng');
  assert.equal(toVietnameseWords(1320002), 'Một triệu ba trăm hai mươi nghìn không trăm lẻ hai đồng');
  assert.equal(toVietnameseWords(532499), 'Năm trăm ba mươi hai nghìn bốn trăm chín mươi chín đồng');
  assert.equal(toVietnameseWords(15000), 'Mười lăm nghìn đồng');
  assert.equal(toVietnameseWords(21000), 'Hai mươi mốt nghìn đồng');
  assert.equal(toVietnameseWords(1000000), 'Một triệu đồng');
  assert.equal(toVietnameseWords(2000000000), 'Hai tỷ đồng');
  assert.equal(toVietnameseWords(0), '');
  assert.equal(toVietnameseWords(-5), '');
});

test('khu hoi: chu do trang sinh ra doc lai dung so (bo doc so bang chu cua may chu)', () => {
  const samples = [1, 10, 11, 15, 21, 24, 25, 101, 105, 110, 999, 1001, 1005, 10010, 100000, 1000001, 9732220, 3447360, 999999999, 1234567890];
  let seed = 7;
  for (let i = 0; i < 2000; i += 1) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    samples.push(1 + (seed % 5e9));
  }
  for (const value of samples) assert.equal(parseVietnameseAmountWords(toVietnameseWords(value)), value, String(value));
});
