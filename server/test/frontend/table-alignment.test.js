'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');

test('bang du lieu dashboard can trai (tieu de, o du lieu, cot so, nut sap xep)', () => {
  // Mot selector co the xuat hien o nhieu quy tac (vd hieu ung chuyen mau) —
  // yeu cau: it nhat 1 quy tac dat can trai va KHONG quy tac nao dat can giua.
  const rules = selector => [...html.matchAll(new RegExp(`\n    ${selector} \{([^}]*)\}`, 'g'))].map(match => match[1]);
  [['thead th', /text-align:\s*left/], ['tbody td', /text-align:\s*left/], ['td\.mono', /text-align:\s*left/]].forEach(([selector, expected]) => {
    const blocks = rules(selector);
    assert.ok(blocks.some(block => expected.test(block)), `${selector} phai can trai`);
    assert.ok(!blocks.some(block => /text-align:\s*center|justify-content:\s*center/.test(block)), `${selector} khong con can giua`);
  });
  // Nut sap xep dung quy uoc chung o shared.css (nhan can trai, bieu tuong dinh mep phai); trang khong tu dinh nghia lai.
  const shared = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'shared', 'shared.css'), 'utf8');
  const sortRules = [...shared.matchAll(/\n\.sort-button \{([^}]*)\}/g)].map(match => match[1]);
  assert.ok(sortRules.some(block => /text-align:\s*left/.test(block)), '.sort-button phai can trai');
  assert.ok(!sortRules.some(block => /text-align:\s*center|justify-content:\s*center/.test(block)), '.sort-button khong can giua');
  assert.equal(rules('\.sort-button').length, 0, 'index.html khong tu dinh nghia lai .sort-button');
});
