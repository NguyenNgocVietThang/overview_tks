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

  const calls = { get: 0, append: 0, update: 0, batchUpdate: 0, sheetsGet: 0, batchGet: 0 };

  const defaultGetImpl = async () => ({ data: { values: [['header'], ['row1']] } });
  const getImpl = opts.getImpl || defaultGetImpl;

  // spreadsheets.get (metadata) — dung boi vcListSheetTitles va vcGetSheetId
  const defaultSheetsGetImpl = async () => ({ data: { sheets: [] } });
  const sheetsGetImpl = opts.sheetsGetImpl || defaultSheetsGetImpl;

  const defaultBatchGetImpl = async () => ({ data: { valueRanges: [] } });
  const batchGetImpl = opts.batchGetImpl || defaultBatchGetImpl;

  // Ghi lai tham so thu 2 (options) cua moi lan goi de test xac nhan timeout
  // duoc truyen dung vi tri (khong bi lot vao requestBody / param dau).
  const lastOptions = { get: null, append: null, update: null, batchUpdate: null, sheetsGet: null, batchGet: null };

  const fakeSheetsApi = {
    spreadsheets: {
      values: {
        get: async (params, options) => { calls.get++; lastOptions.get = options; return getImpl(params); },
        append: async (params, options) => { calls.append++; lastOptions.append = options; return {}; },
        update: async (params, options) => { calls.update++; lastOptions.update = options; return {}; },
        batchGet: async (params, options) => { calls.batchGet++; lastOptions.batchGet = options; return batchGetImpl(params); }
      },
      batchUpdate: async (params, options) => { calls.batchUpdate++; lastOptions.batchUpdate = options; return {}; },
      get: async (params, options) => { calls.sheetsGet++; lastOptions.sheetsGet = options; return sheetsGetImpl(params); }
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
    lastOptions,
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

test('vcGetValues: ghi vao sheet KHAC khong duoc lam "dong bang" vinh vien cache cua sheet dang doc dang bay (cross-sheet regression)', async (t) => {
  // Day la kich ban CU THE re-reviewer da dung de tai hien bug thu 2: dung 1
  // counter generation TOAN CUC (thay vi PER-SHEET) lam cho 1 lan ghi vao
  // sheet Y hoan toan khong lien quan cung "vuot mat" duoc 1 read dang bay
  // cua sheet X — .then() cua read X dung khong set() lai cache (dung, nho
  // generation-guard), NHUNG voi thiet ke SAI (global) thi khong co gi xoa
  // hoac cap nhat lai placeholder {data:null, expiresAt:0, loading} cua X, nen
  // moi lan vcGetValues(X) sau do deu roi vao nhanh `cached.loading` va tra ve
  // DUNG 1 promise-da-settled-tu-lau — VINH VIEN, du TTL 12s co troi qua bao
  // nhieu lan, cho toi khi co ai do ghi TRUC TIEP vao X. Fix (Map generation
  // PER-SHEET) dam bao ghi vao Y hoan toan khong dung toi generation/cache cua
  // X, nen X van duoc cache dung (hoac fetch lai binh thuong) sau TTL.
  t.mock.timers.enable({ apis: ['Date'] });

  let resolveXRead;
  const xReadGate = new Promise(resolve => { resolveXRead = resolve; });
  let xCallCount = 0;

  const { client, calls, restore } = freshClient({
    getImpl: async (params) => {
      const isSheetX = params.range.includes('Đơn vận chuyển');
      if (!isSheetX) {
        // Sheet Y — luon tra ve ngay, khong lien quan gi den kich ban dang test.
        return { data: { values: [['header'], ['Y-row']] } };
      }
      xCallCount++;
      if (xCallCount === 1) {
        // Lan doc DAU TIEN cho sheet X — bi treo (dang bay) cho toi khi test
        // chu dong resolve xReadGate, mo phong no resolve TRE (sau khi 1 lan
        // ghi vao sheet Y KHAC da chay xong).
        await xReadGate;
      }
      return { data: { values: [['header'], [`X-v${xCallCount}`]] } };
    }
  });

  try {
    // 1. Bat dau doc sheet X — bi treo (dang bay), chua resolve.
    const xReadPromise = client.vcGetValues('Đơn vận chuyển');

    // 2. Trong luc X con dang bay, ghi vao sheet Y — HOAN TOAN KHAC voi X.
    //    Voi fix (per-sheet), invalidate nay chi dung toi generation/cache cua Y.
    await client.vcAppendRow('Chi tiết vận chuyển', ['Y-NEW']);

    // 3. Tha gate cho read X hoan tat — resolve SAU khi buoc 2 (ghi vao Y) da xong.
    resolveXRead();
    const v1 = await xReadPromise;
    assert.deepEqual(v1, [['header'], ['X-v1']]);

    // 4. Cho TTL (12s) troi qua that su (bang fake timer) — neu X van hoat dong
    //    binh thuong (khong bi "dong bang"), lan doc tiep theo phai la 1
    //    cache-miss THAT SU va kich hoat 1 lan goi Google API moi cho X. Neu bug
    //    "dong bang" con ton tai (do sheet Y "vuot mat" gay ra), placeholder cu
    //    cua X (data:null, loading:promise-da-settled) van con nguyen trong map
    //    mai mai — nhanh kiem tra TTL (`cached.data && ...`) luon bi bo qua vi
    //    `data` la null, va vcGetValues(X) se mai mai roi vao nhanh
    //    `cached.loading`, KHONG BAO GIO goi lai API du TTL da het han tu lau.
    t.mock.timers.tick(13000);

    const callsGetBefore = calls.get;
    const v2 = await client.vcGetValues('Đơn vận chuyển');
    assert.equal(calls.get, callsGetBefore + 1,
      'sau khi TTL het han, doc lai sheet X phai kich hoat 1 lan goi Google API MOI — ' +
      'neu X bi "dong bang" boi lan ghi vao sheet Y (bug generation toan cuc), se KHONG co ' +
      'lan goi API moi nao du bao nhieu thoi gian troi qua');
    assert.deepEqual(v2, [['header'], ['X-v2']], 'du lieu tra ve phai la du lieu MOI (lan fetch thu 2), khong phai promise cu tai su dung');
  } finally {
    t.mock.timers.reset();
    restore();
  }
});

// ---------------------------------------------------------------------------
// vcGetSheetId — tra cuu sheetId SO tu ten tab (Task 4.2)
//
// LUU Y: googleapis duoc mock hoan toan — KHONG co request that nao toi Google.
// ---------------------------------------------------------------------------

const SHEETS_META = {
  data: {
    sheets: [
      // sheetId 0 la gia tri THAT cua tab dau tien tren Google — falsy, de bat
      // cac loi kieu `if (!sheetId)` hoac `sheetId || fallback`.
      { properties: { sheetId: 0,       title: 'Đơn vận chuyển' } },
      { properties: { sheetId: 1234567, title: 'Chi tiết vận chuyển' } },
      { properties: { sheetId: 890,     title: 'Lịch sử trạng thái' } }
    ]
  }
};

test('vcGetSheetId: tra ve dung sheetId SO theo ten tab (ke ca sheetId = 0)', async () => {
  const { client, restore } = freshClient({ sheetsGetImpl: async () => SHEETS_META });
  try {
    assert.equal(await client.vcGetSheetId('Đơn vận chuyển'), 0);
    assert.equal(await client.vcGetSheetId('Chi tiết vận chuyển'), 1234567);
    assert.equal(await client.vcGetSheetId('Lịch sử trạng thái'), 890);
  } finally { restore(); }
});

test('vcGetSheetId: goi spreadsheets.get dung fields metadata, khong doc gia tri o', async () => {
  let seenParams = null;
  const { client, calls, restore } = freshClient({
    sheetsGetImpl: async (params) => { seenParams = params; return SHEETS_META; }
  });
  try {
    await client.vcGetSheetId('Chi tiết vận chuyển');
    assert.equal(seenParams.spreadsheetId, 'test-vc-spreadsheet-id');
    assert.equal(seenParams.fields, 'sheets.properties(sheetId,title)');
    assert.equal(calls.get, 0, 'khong duoc goi values.get (chi can metadata)');
  } finally { restore(); }
});

test('vcGetSheetId: cache — nhieu lan goi (ke ca tab khac nhau) chi 1 lan goi API', async () => {
  const { client, calls, restore } = freshClient({ sheetsGetImpl: async () => SHEETS_META });
  try {
    await client.vcGetSheetId('Đơn vận chuyển');
    await client.vcGetSheetId('Đơn vận chuyển');
    await client.vcGetSheetId('Chi tiết vận chuyển');
    await client.vcGetSheetId('Lịch sử trạng thái');
    assert.equal(calls.sheetsGet, 1, '1 lan spreadsheets.get lay duoc sheetId cua TAT CA tab');
  } finally { restore(); }
});

test('vcGetSheetId: 2 request dong thoi (cung tick) chi goi API 1 lan (dedupe)', async () => {
  const { client, calls, restore } = freshClient({ sheetsGetImpl: async () => SHEETS_META });
  try {
    const [a, b] = await Promise.all([
      client.vcGetSheetId('Chi tiết vận chuyển'),
      client.vcGetSheetId('Đơn vận chuyển')
    ]);
    assert.equal(a, 1234567);
    assert.equal(b, 0);
    assert.equal(calls.sheetsGet, 1, 'phai dedupe vao 1 lan goi API duy nhat');
  } finally { restore(); }
});

test('vcGetSheetId: het TTL (5 phut) thi doc lai metadata', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const { client, calls, restore } = freshClient({ sheetsGetImpl: async () => SHEETS_META });
  try {
    await client.vcGetSheetId('Đơn vận chuyển');
    assert.equal(calls.sheetsGet, 1);

    t.mock.timers.tick(4 * 60 * 1000);
    await client.vcGetSheetId('Đơn vận chuyển');
    assert.equal(calls.sheetsGet, 1, 'trong TTL van dung cache');

    t.mock.timers.tick(2 * 60 * 1000); // tong 6 phut > TTL 5 phut
    await client.vcGetSheetId('Đơn vận chuyển');
    assert.equal(calls.sheetsGet, 2, 'sau TTL phai doc lai metadata');
  } finally { t.mock.timers.reset(); restore(); }
});

test('vcGetSheetId: tab khong ton tai -> nem loi ro rang', async () => {
  const { client, restore } = freshClient({ sheetsGetImpl: async () => SHEETS_META });
  try {
    await assert.rejects(
      () => client.vcGetSheetId('Tab khong ton tai'),
      /Khong tim thay sheetId cho tab "Tab khong ton tai"/
    );
  } finally { restore(); }
});

test('vcGetSheetId: tab MOI tao sau khi da cache -> doc lai 1 lan roi tra ve dung, khong nem loi', async () => {
  let round = 0;
  const { client, calls, restore } = freshClient({
    sheetsGetImpl: async () => {
      round++;
      if (round === 1) return SHEETS_META;
      return { data: { sheets: SHEETS_META.data.sheets.concat([{ properties: { sheetId: 999, title: 'Tab mới' } }]) } };
    }
  });
  try {
    await client.vcGetSheetId('Đơn vận chuyển'); // nap cache (chua co 'Tab mới')
    assert.equal(calls.sheetsGet, 1);

    assert.equal(await client.vcGetSheetId('Tab mới'), 999, 'miss tren cache phai kich hoat doc lai');
    assert.equal(calls.sheetsGet, 2);
  } finally { restore(); }
});

test('vcGetSheetId: miss tren du lieu VUA doc (khong phai cache) khong doc lai vo han', async () => {
  const { client, calls, restore } = freshClient({ sheetsGetImpl: async () => SHEETS_META });
  try {
    // Lan goi dau tien: cache rong -> fetch 1 lan -> van khong thay -> throw ngay,
    // KHONG duoc fetch them lan nua (du lieu vua doc da la tuoi nhat).
    await assert.rejects(() => client.vcGetSheetId('Khong co'), /Khong tim thay sheetId/);
    assert.equal(calls.sheetsGet, 1, 'chi 1 lan goi API khi du lieu vua doc da tuoi');
  } finally { restore(); }
});

test('vcGetSheetId: loi API khong bi cache — lan sau thu lai ngay', async () => {
  let attempt = 0;
  const { client, calls, restore } = freshClient({
    sheetsGetImpl: async () => {
      attempt++;
      if (attempt === 1) throw new Error('Google API tam thoi loi (503)');
      return SHEETS_META;
    }
  });
  try {
    await assert.rejects(() => client.vcGetSheetId('Đơn vận chuyển'), /tam thoi loi/);
    assert.equal(await client.vcGetSheetId('Đơn vận chuyển'), 0);
    assert.equal(calls.sheetsGet, 2, 'phai goi lai API sau loi, khong ket cung');
  } finally { restore(); }
});

// ---------------------------------------------------------------------------
// Task 4.3 — timeout truyen dung tham so thu 2 (options) cho moi lan goi
// Google Sheets API, khong bi lot vao requestBody (se bi Google API bo qua
// am tham va khong cung cap bao ve nao ca).
// ---------------------------------------------------------------------------

const VC_API_TIMEOUT_MS = 15000;

test('vcGetValues: truyen { timeout } lam tham so thu 2 cho values.get', async () => {
  const { client, lastOptions, restore } = freshClient();
  try {
    await client.vcGetValues('Đơn vận chuyển');
    assert.equal(lastOptions.get && lastOptions.get.timeout, VC_API_TIMEOUT_MS);
  } finally { restore(); }
});

test('vcAppendRow: truyen { timeout } lam tham so thu 2 cho values.append', async () => {
  const { client, lastOptions, restore } = freshClient();
  try {
    await client.vcAppendRow('Đơn vận chuyển', ['VC-001']);
    assert.equal(lastOptions.append && lastOptions.append.timeout, VC_API_TIMEOUT_MS);
  } finally { restore(); }
});

test('vcUpdateRow: truyen { timeout } lam tham so thu 2 cho values.update', async () => {
  const { client, lastOptions, restore } = freshClient();
  try {
    await client.vcUpdateRow('Đơn vận chuyển', 2, ['VC-001', 'x']);
    assert.equal(lastOptions.update && lastOptions.update.timeout, VC_API_TIMEOUT_MS);
  } finally { restore(); }
});

test('vcBatchUpdate: truyen { timeout } lam tham so thu 2 cho spreadsheets.batchUpdate', async () => {
  const { client, lastOptions, restore } = freshClient();
  try {
    await client.vcBatchUpdate([{ updateCells: {} }]);
    assert.equal(lastOptions.batchUpdate && lastOptions.batchUpdate.timeout, VC_API_TIMEOUT_MS);
  } finally { restore(); }
});

test('vcGetMultipleSheetValues: truyen { timeout } lam tham so thu 2 cho values.batchGet', async () => {
  const { client, lastOptions, restore } = freshClient({
    sheetsGetImpl: async () => ({ data: { sheets: [{ properties: { title: 'Đơn vận chuyển' } }] } }),
    batchGetImpl: async () => ({ data: { valueRanges: [{ range: "'Đơn vận chuyển'!A1", values: [['x']] }] } })
  });
  try {
    await client.vcGetMultipleSheetValues(['Đơn vận chuyển']);
    assert.equal(lastOptions.batchGet && lastOptions.batchGet.timeout, VC_API_TIMEOUT_MS);
  } finally { restore(); }
});

test('vcGetSheetId (spreadsheets.get metadata): truyen { timeout } lam tham so thu 2', async () => {
  const { client, lastOptions, restore } = freshClient({ sheetsGetImpl: async () => SHEETS_META });
  try {
    await client.vcGetSheetId('Đơn vận chuyển');
    assert.equal(lastOptions.sheetsGet && lastOptions.sheetsGet.timeout, VC_API_TIMEOUT_MS);
  } finally { restore(); }
});

test('vcInvalidateSheetTitlesCache: xoa ca cache sheetId', async () => {
  const { client, calls, restore } = freshClient({ sheetsGetImpl: async () => SHEETS_META });
  try {
    await client.vcGetSheetId('Đơn vận chuyển');
    assert.equal(calls.sheetsGet, 1);

    client.vcInvalidateSheetTitlesCache();

    await client.vcGetSheetId('Đơn vận chuyển');
    assert.equal(calls.sheetsGet, 2, 'sau invalidate phai doc lai metadata');
  } finally { restore(); }
});

test('vcGetSheetId: fetch dang bay bi invalidate vuot mat -> khong "hoi sinh" du lieu cu vao cache', async () => {
  // Cung ho bug voi generation-guard cua vcGetValues (Task 4.1): 1 lan doc
  // metadata dang bay, giua chung co ai do doi ten tab + goi invalidate. Ket
  // qua CU khong duoc phep ghi de len cache moi.
  let resolveFirst;
  const gate = new Promise(r => { resolveFirst = r; });
  let round = 0;

  const { client, calls, restore } = freshClient({
    sheetsGetImpl: async () => {
      round++;
      if (round === 1) { await gate; return SHEETS_META; }
      return { data: { sheets: [{ properties: { sheetId: 42, title: 'Tab đã đổi tên' } }] } };
    }
  });
  try {
    const inFlight = client.vcGetSheetId('Đơn vận chuyển');
    client.vcInvalidateSheetTitlesCache(); // vuot mat lan fetch dang bay
    resolveFirst();
    assert.equal(await inFlight, 0, 'caller cua chinh lan fetch do van nhan du lieu no vua doc');

    // Lan goi tiep theo KHONG duoc dung ket qua cu da "hoi sinh" — phai fetch lai.
    assert.equal(await client.vcGetSheetId('Tab đã đổi tên'), 42);
    assert.equal(calls.sheetsGet, 2);
    // Va ten cu khong con ton tai nua
    await assert.rejects(() => client.vcGetSheetId('Đơn vận chuyển'), /Khong tim thay sheetId/);
  } finally { restore(); }
});
