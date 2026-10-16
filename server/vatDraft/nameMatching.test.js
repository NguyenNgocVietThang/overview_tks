'use strict';

// Port tests/test_name_matching.py + so doi chieu chinh xac voi RapidFuzz 3.14.5.

const test = require('node:test');
const assert = require('node:assert/strict');
const { tokenSortRatio, calculateAccountingNameScore } = require('./nameMatching');
const { nameMatchWeights: weights } = require('./vatDraftConfig');

test('tokenSortRatio khop RapidFuzz token_sort_ratio tung chu so', () => {
  assert.equal(tokenSortRatio('bong tay trang mieng', 'bong tay trang vang mieng'), 88.88888888888889);
  assert.equal(tokenSortRatio('am giu nhiet', 'am giu nhiet hoa'), 85.71428571428572);
  assert.equal(tokenSortRatio('ban chai danh rang', 'bong tay trang vang mieng'), 51.162790697674424);
  assert.equal(tokenSortRatio('kt', 'san pham'), 0);
  assert.equal(tokenSortRatio('moc dan tuong da nang', 'moc dan tuong dung de treo do da nang'), 72.41379310344827);
  assert.equal(tokenSortRatio('Bb a', 'a bb'), 25, 'khong tu chuyen chu thuong (processor=None)');
});

const scoreOf = args => calculateAccountingNameScore({ ...args, weights }).score;

test('ten giong hon thi diem cao hon (diem khop Python)', () => {
  const shared = {
    userTenSp: 'Bông tẩy trang VÀNG 222 miếng',
    khopMaTenSp: 'Bông tẩy trang VÀNG 222 miếng',
    tenVatKiot: 'Bông tẩy trang',
    tenTruocVatRaw: 'Bông tẩy trang (11,200 - 12,100) (VAT)'
  };
  const good = scoreOf({ tenKeToan: 'Bông tẩy trang 222 miếng', ...shared });
  const bad = scoreOf({ tenKeToan: 'Bàn chải đánh răng', ...shared });
  assert.ok(good > bad);
  assert.equal(good, 94.9281045751634);
  assert.equal(bad, 52.68895348837209);
});

test('token so mau thuan bi tru diem', () => {
  const shared = {
    userTenSp: 'Ấm giữ nhiệt 1000ml Hoa',
    khopMaTenSp: 'Ấm giữ nhiệt Hoa 1L',
    tenVatKiot: 'Ấm giữ nhiệt',
    tenTruocVatRaw: 'Ấm giữ nhiệt 1000ML (1-2) (VAT)'
  };
  const matching = scoreOf({ tenKeToan: 'Ấm giữ nhiệt 1000ml', ...shared });
  const conflicting = scoreOf({ tenKeToan: 'Ấm giữ nhiệt 500ml', ...shared });
  assert.ok(matching > conflicting);
  assert.equal(matching, 98.0);
  assert.equal(conflicting, 65.0);
});

test('diem deterministic', () => {
  const args = {
    tenKeToan: 'Móc dán tường đa năng',
    userTenSp: 'Móc dán tường dùng để treo đồ đa năng',
    khopMaTenSp: 'Móc dán tường đa năng 1 mặt',
    tenVatKiot: 'Móc dán tường',
    tenTruocVatRaw: 'Móc dán tường (1-2) (VAT)'
  };
  assert.equal(scoreOf(args), scoreOf(args));
});
