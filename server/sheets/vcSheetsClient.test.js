'use strict';
// Test cache ngan han (12s) + invalidate-on-write cho vcSheetsClient.js
// Mock truc tiep googleapis (google.auth.GoogleAuth, google.sheets) vi day la
// module can test hanh vi cache NOI BO cua chinh no (khac vcOrderRepository.test.js
// chi can mock cac ham export cua vcSheetsClient wholesale).

process.env.SPREADSHEET_ID              = process.env.SPREADSHEET_ID              || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET                  = process.env.JWT_SECRET                  || 'test-jwt-secret';
process.env.VC_SPREADSHEET_ID           = process.env.VC_SPREADSHEET_ID           || 'test-vc-spreadsheet-id';

const test   = require('node:test');
const assert = require('node:assert/strict');
const { google } = require('googleapis');

/**
 * Tao fresh instance vcSheetsClient voi googleapis da mock.
 * @param {object} opts { getImpl: async (params) => ({data:{values:[[...]]}}) }
 * @returns {{ client, calls }}
 */
function freshClient(opts = {}) {
  try { delete require.cache[require.resolve('./vcSheetsClient')]; } catch (e) { /* ignore */ }

  const calls = { get: 0, append: 0, update: 0, batchUpdate: 0 };

  const defaultGetImpl = async () => ({ data: { values: [['header'], ['row1']] } });
  const getImpl = opts.getImpl || defaultGetImpl;

  const fakeSheetsApi = {
    spreadsheets: {
      values: {
        get: async (params) => { calls.get++; return getImpl(params); },
        append: async () => { calls.append++; return {}; },
        update: async () => { calls.update++; return {}; }
      },
      batchUpdate: async () => { calls.batchUpdate++; return {}; },
      get: async () => ({ data: { sheets: [] } })
    }
  };

  // Monkeypatch googleapis truoc khi vcSheetsClient goi getVcSheetsApi()
  const originalGoogleAuth = google.auth.GoogleAuth;
  const originalSheetsFn = google.sheets;
  google.auth.GoogleAuth = class {
    getClient() { return Promise.resolve({}); }
  };
  google.sheets = () => fakeSheetsApi;

  const client = require('./vcSheetsClient');

  // Tra lai googleapis nguyen ban ngay sau khi module da resolve xong require
  // (vcSheetsApiPromise duoc tao lazy trong getVcSheetsApi, chi goi khi vcGetValues
  // duoc goi lan dau — nen phai giu mock cho toi khi test xong; restore o cuoi test).
  return {
    client,
    calls,
    restore: () => { google.auth.GoogleAuth = originalGoogleAuth; google.sheets = originalSheetsFn; }
  };
}

test('vcGetValues: cache hit trong TTL — khong goi lai Google API', async () => {
  const { client, calls, restore } = freshClient();
  try {
    const v1 = await client.vcGetValues('Đơn vận chuyển');
    const v2 = await client.vcGetValues('Đơn vận chuyển');
    assert.deepEqual(v1, [['header'], ['row1']]);
    assert.deepEqual(v2, v1);
    assert.equal(calls.get, 1, 'lan doc thu 2 phai dung cache, khong goi Google API');
  } finally { restore(); }
});

test('vcGetValues: cache theo tung sheet rieng biet (khong dung chung)', async () => {
  const { client, calls, restore } = freshClient();
  try {
    await client.vcGetValues('Đơn vận chuyển');
    await client.vcGetValues('Chi tiết vận chuyển');
    assert.equal(calls.get, 2, 'sheet khac ten phai la cache-miss rieng');
  } finally { restore(); }
});

test('vcAppendRow: invalidate cache cua dung sheet vua ghi — doc lai la cache-miss', async () => {
  const { client, calls, restore } = freshClient();
  try {
    await client.vcGetValues('Đơn vận chuyển');
    assert.equal(calls.get, 1);

    await client.vcAppendRow('Đơn vận chuyển', ['VC-001']);
    await client.vcGetValues('Đơn vận chuyển');
    assert.equal(calls.get, 2, 'sau khi append, lan doc tiep theo phai la cache-miss (du lieu moi)');
  } finally { restore(); }
});

test('vcUpdateRow: invalidate cache cua dung sheet vua ghi', async () => {
  const { client, calls, restore } = freshClient();
  try {
    await client.vcGetValues('Đơn vận chuyển');
    await client.vcUpdateRow('Đơn vận chuyển', 2, ['VC-001', 'updated']);
    await client.vcGetValues('Đơn vận chuyển');
    assert.equal(calls.get, 2, 'sau khi update, lan doc tiep theo phai la cache-miss');
  } finally { restore(); }
});

test('vcBatchUpdate: xoa toan bo cache (moi sheet, khong chi 1 sheet)', async () => {
  const { client, calls, restore } = freshClient();
  try {
    await client.vcGetValues('Đơn vận chuyển');
    await client.vcGetValues('Chi tiết vận chuyển');
    assert.equal(calls.get, 2);

    await client.vcBatchUpdate([{ updateCells: {} }]);

    await client.vcGetValues('Đơn vận chuyển');
    await client.vcGetValues('Chi tiết vận chuyển');
    assert.equal(calls.get, 4, 'ca 2 sheet phai la cache-miss sau batchUpdate');
  } finally { restore(); }
});

test('vcGetValues: loi tam thoi tu Google API khong bi cache — lan sau thu lai ngay', async () => {
  let attempt = 0;
  const { client, calls, restore } = freshClient({
    getImpl: async () => {
      attempt++;
      if (attempt === 1) throw new Error('Google API tam thoi loi (503)');
      return { data: { values: [['header'], ['row-sau-loi']] } };
    }
  });
  try {
    await assert.rejects(() => client.vcGetValues('Đơn vận chuyển'), /tam thoi loi/);
    // Lan goi thu 2 phai thu lai ngay (khong bi "ket cung" boi loi da cache)
    const v = await client.vcGetValues('Đơn vận chuyển');
    assert.deepEqual(v, [['header'], ['row-sau-loi']]);
    assert.equal(calls.get, 2, 'phai goi lai Google API ngay, khong dung ket qua loi da cache');
  } finally { restore(); }
});

test('createOrder read-after-write race: doc lai ngay sau append thay du lieu moi', async () => {
  // Mo phong dung tinh huong createOrder(): doc truoc -> ghi -> doc lai ngay
  // de kiem tra trung order_id. Xac nhan lan doc lai KHONG bi cache cu che khuat.
  let rows = [['Mã vận đơn'], ['VC-20260101-0001']];
  const { client, calls, restore } = freshClient({
    getImpl: async () => ({ data: { values: rows.map(r => r.slice()) } })
  });
  try {
    const before = await client.vcGetValues('Đơn vận chuyển');
    assert.equal(before.length, 2);

    // Gia lap ghi dong moi (append) — cap nhat "du lieu that" ma mock get se tra ve sau nay
    rows = rows.concat([['VC-20260101-0002']]);
    await client.vcAppendRow('Đơn vận chuyển', ['VC-20260101-0002']);

    const after = await client.vcGetValues('Đơn vận chuyển');
    assert.equal(after.length, 3, 'doc lai ngay sau ghi phai thay dong moi, khong doc cache cu');
    assert.equal(calls.get, 2, 'lan doc sau ghi phai la request that toi Google API');
  } finally { restore(); }
});

test('vcGetValues: 2 request dong thoi (cung tick) cho cung sheet chi goi API 1 lan (dedupe qua loading placeholder)', async () => {
  const { client, calls, restore } = freshClient();
  try {
    const [v1, v2] = await Promise.all([
      client.vcGetValues('Đơn vận chuyển'),
      client.vcGetValues('Đơn vận chuyển')
    ]);
    assert.deepEqual(v1, v2);
    assert.equal(calls.get, 1, 'ca 2 request cung tick phai dedupe vao 1 lan goi API duy nhat (placeholder dang ky dong bo truoc await)');
  } finally { restore(); }
});

test('vcGetValues: generation-guard — read dang bay (bat dau truoc ghi, resolve sau invalidate) khong duoc "hoi sinh" du lieu cu vao cache', async () => {
  // Mo phong dung kich ban bug duoc phat hien: 1 poller doc sheet X, TRUOC KHI
  // doc xong thi 1 dispatcher khac ghi (vd doi trang thai don) vao chinh sheet
  // X va invalidate cache. Read cu (dang bay) chi resolve SAU khi invalidate da
  // chay. Neu khong co generation-guard, .then() cua read cu se ghi de cache
  // bang snapshot TU TRUOC khi ghi, khien lan doc tiep theo (vd 1 ham doc-sua-
  // ghi nhu transitionOrderStatus) an nham du lieu cu roi ghi ca dong tro lai
  // — khong chi hien thi sai ma con co the GHI DE mat du lieu that.
  let callIndex = 0;
  let resolveStaleRead;
  const staleReadGate = new Promise(resolve => { resolveStaleRead = resolve; });

  const { client, calls, restore } = freshClient({
    getImpl: async () => {
      callIndex++;
      if (callIndex === 1) {
        // Lan doc dau tien (read "dang bay") — bi chan lai, chi tra ve sau khi
        // test chu dong resolve staleReadGate (mo phong resolve TRE, sau khi
        // 1 lan ghi khac da invalidate xong).
        await staleReadGate;
        return { data: { values: [['header'], ['stale-row (truoc khi ghi)']] } };
      }
      return { data: { values: [['header'], ['fresh-row (sau khi ghi)']] } };
    }
  });

  try {
    // 1. Bat dau 1 lan doc — se bi "treo" (dang bay) cho toi khi ta chu dong resolve.
    const staleReadPromise = client.vcGetValues('Đơn vận chuyển');

    // 2. Trong luc read tren con dang bay, mo phong 1 request KHAC ghi vao dung
    //    sheet nay va thanh cong — invalidateVcSheetCache() chay, bump generation.
    await client.vcAppendRow('Đơn vận chuyển', ['VC-NEW']);

    // 3. Bay gio moi cho read "dang bay" o buoc 1 hoan tat (mo phong no resolve
    //    TRE, sau khi lan ghi o buoc 2 da xong).
    resolveStaleRead();
    const staleValues = await staleReadPromise;
    // Chinh promise cua lan doc do van phai tra dung du lieu tai thoi diem no
    // doc (khong sai cho caller cua no) — chi khong duoc phep GHI vao cache.
    assert.deepEqual(staleValues, [['header'], ['stale-row (truoc khi ghi)']]);

    // 4. Lan doc TIEP THEO phai la cache-miss that su (goi lai Google API) va
    //    tra ve du lieu MOI — neu bug con ton tai, buoc 3 se da "hoi sinh" du
    //    lieu cu vao cache voi TTL con nguyen 12s, khien buoc nay tra ve cache
    //    hit voi du lieu SAI (calls.get se dung o 2 thay vi tang len 3).
    const nextValues = await client.vcGetValues('Đơn vận chuyển');
    assert.deepEqual(nextValues, [['header'], ['fresh-row (sau khi ghi)']]);
    assert.equal(calls.get, 2, 'lan doc sau cung phai la 1 request Google API moi (goi lan thu 2), khong duoc dung cache "hoi sinh" tu read da bi vuot mat');
  } finally { restore(); }
});
