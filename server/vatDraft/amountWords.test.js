'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseVietnameseAmountWords } = require('./amountWords');

test('doc so tien bang chu tren cac hoa don mau', () => {
  const cases = [
    ['Mười triệu chín trăm ba mươi ba nghìn không trăm năm mươi sáu đồng', 10933056],
    ['Chín triệu bảy trăm ba mươi hai nghìn hai trăm hai mươi đồng', 9732220],
    ['Một triệu ba trăm hai mươi nghìn không trăm lẻ hai đồng', 1320002],
    ['Ba triệu bốn trăm bốn mươi bảy nghìn ba trăm sáu mươi đồng', 3447360],
    ['Năm trăm ba mươi hai nghìn bốn trăm chín mươi chín đồng', 532499],
    ['Hai mươi mốt triệu không trăm linh năm nghìn đồng chẵn.', 21005000],
    ['Mười lăm nghìn đồng', 15000],
    ['Một tỷ hai trăm triệu đồng', 1200000000],
    ['Bốn mươi tư ngàn', 44000]
  ];
  for (const [text, expected] of cases) assert.equal(parseVietnameseAmountWords(text), expected, text);
});

test('tu la / sai cu phap / rong -> null', () => {
  assert.equal(parseVietnameseAmountWords(''), null);
  assert.equal(parseVietnameseAmountWords(null), null);
  assert.equal(parseVietnameseAmountWords('Mười triệu đô la'), null);
  assert.equal(parseVietnameseAmountWords('ba bốn nghìn'), null);
  assert.equal(parseVietnameseAmountWords('mươi nghìn'), null);
});
