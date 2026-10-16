'use strict';

// Port tests/test_vietqr.py (bo phan trich ma HD tu ten file — tks_web lay ma tu chung tu da chon).

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getAccountForSource,
  getAccountsForSeller,
  computeSourceAmounts,
  computeTotalAmount,
  formatAccountLabel,
  parseAmountInput,
  buildVietqrImageUrl,
  isValidManualField
} = require('./vietqr');
const vatDraftConfig = require('./vatDraftConfig');

const line = (nguon, giaBan, giaNhap, slPhanBo = 1) => ({ nguon, giaBan, giaNhap, slPhanBo });

const sourceConfig = {
  vietqr: {
    template: 'compact2',
    accounts: [{ key: 'mbbank', bankId: 'MB', accountNo: '0389040222' }, { key: 'vietinbank', bankId: 'ICB', accountNo: '102875264435' }],
    sourceAccountMap: { MAY: 'mbbank', CAO: 'vietinbank' },
    sellerAccountMap: []
  }
};

test('parseAmountInput bo dinh dang', () => {
  assert.equal(parseAmountInput('37,037 đ'), 37037);
  assert.equal(parseAmountInput('37.037 đ'), 37037);
  assert.equal(parseAmountInput('99000'), 99000);
  assert.equal(parseAmountInput(''), 0);
  assert.equal(parseAmountInput('   '), 0);
});

test('tai khoan theo don vi ban hang: bo dau, khong phan biet hoa thuong, chua chuoi', () => {
  assert.deepEqual(getAccountsForSeller('CÔNG TY CỔ PHẦN THƯƠNG MẠI XUẤT NHẬP KHẨU TKS GROUP').map(a => a.key), ['vcb_tks_group', 'tks_group']);
  assert.deepEqual(getAccountsForSeller('CÔNG TY CỔ PHẦN THƯƠNG MẠI TỔNG HỢP SHC GROUP').map(a => a.key), ['shc']);
  assert.deepEqual(getAccountsForSeller('CÔNG TY TNHH KHÔNG LIÊN QUAN'), []);
  assert.deepEqual(getAccountsForSeller(''), []);
});

test('tai khoan theo nguon', () => {
  assert.equal(getAccountForSource('may', sourceConfig).accountNo, '0389040222');
  assert.equal(getAccountForSource('SAIGONHANOI', sourceConfig), null);
  assert.equal(getAccountForSource('TKS THẤP').key, 'tks_group');
  assert.equal(getAccountForSource('vc').key, 'mb_vc_ex');
});

test('tong theo nguon (Gia ban va Gia nhap)', () => {
  const totals = computeSourceAmounts([line('MAY', 11000, 10000, 2), line('MAY', 5500, 5000, 1), line('CAO', 2200, 2000, 3)]);
  assert.equal(totals.get('MAY').tongGiaBan, 11000 * 2 + 5500);
  assert.equal(totals.get('MAY').tongGiaNhap, 10000 * 2 + 5000);
  assert.equal(totals.get('MAY').soDong, 2);
  assert.equal(totals.get('CAO').tongGiaBan, 2200 * 3);
  assert.equal(totals.get('CAO').thieuDonGia, false);
  const missing = computeSourceAmounts([line('MAY', null, null)]).get('MAY');
  assert.deepEqual([missing.thieuDonGia, missing.tongGiaBan, missing.tongGiaNhap], [true, 0, 0]);
});

test('tong gop moi nguon (hoa don khong VAT)', () => {
  const total = computeTotalAmount([line('MAY', 11000, 10000, 2), line('CAO', 2200, 2000, 3)]);
  assert.deepEqual([total.tongGiaBan, total.tongGiaNhap, total.soDong, total.thieuDonGia], [11000 * 2 + 2200 * 3, 10000 * 2 + 2000 * 3, 2, false]);
  assert.equal(computeTotalAmount([line('MAY', null, null)]).thieuDonGia, true);
});

test('URL anh QR', () => {
  const account = { key: 'mbbank', bankId: 'MB', accountNo: '0389040222' };
  const url = buildVietqrImageUrl(account, { amount: 1500000, addInfo: 'HD018699', template: 'compact2' });
  assert.ok(url.startsWith('https://img.vietqr.io/image/MB-0389040222-compact2.png?'));
  assert.ok(url.includes('amount=1500000'));
  assert.ok(url.includes('addInfo=HD018699'));
  const empty = buildVietqrImageUrl(account, { amount: 0, addInfo: 'HD1 HD2', template: 'compact2' });
  assert.ok(empty.includes('addInfo=HD1%20HD2'));
  assert.ok(empty.includes('amount=&'));
  const named = buildVietqrImageUrl(vatDraftConfig.vietqr.accounts[4], { amount: 10.5, addInfo: '' });
  assert.equal(named, 'https://img.vietqr.io/image/MB-525345345-compact2.png?amount=10&addInfo=&accountName=CONG%20TY%20SHC');
});

test('nhan tai khoan va kiem tra o nhap tay', () => {
  assert.equal(formatAccountLabel(vatDraftConfig.vietqr.accounts[1]), 'MB TKS — MB 606266688888 (CONG TY CO PHAN THUONG MAI XUAT NHAP KHAU TKS GROUP)');
  assert.equal(formatAccountLabel({ bankId: 'VCB', accountNo: '123', accountName: '' }), 'VCB - 123');
  assert.ok(isValidManualField('VCB'));
  assert.ok(!isValidManualField('VCB/../x'));
  assert.ok(!isValidManualField(''));
});
