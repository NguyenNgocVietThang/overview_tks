'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  RuleDocImageError, matchesSignature, extractAndPersistImages, pruneUnreferencedImages
} = require('./hrRuleDocumentImages');

// Anh 1x1 PNG that (hop le voi chu ky PNG) va JPEG gia (sai chu ky) de kiem matchesSignature.
const REAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

function fakeClient(nextIds = []) {
  const calls = [];
  let i = 0;
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/^INSERT INTO hr_rule_document_images/.test(sql)) {
        return { rows: [{ id: nextIds[i++] ?? (100 + i) }] };
      }
      return { rows: [] };
    }
  };
}

test('matchesSignature: PNG that khop, buffer rong/sai chu ky bi tu choi', () => {
  assert.equal(matchesSignature(REAL_PNG, 'image/png'), true);
  assert.equal(matchesSignature(Buffer.from('not a png'), 'image/png'), false);
  assert.equal(matchesSignature(Buffer.alloc(0), 'image/png'), false);
});

test('extractAndPersistImages: tach 1 anh data:, thay src bang duong dan that, luu dung buffer', async () => {
  const client = fakeClient([42]);
  const base64 = REAL_PNG.toString('base64');
  const html = `<p>truoc</p><img src="data:image/png;base64,${base64}" alt="x"><p>sau</p>`;

  const result = await extractAndPersistImages(client, 7, html);

  assert.equal(result, '<p>truoc</p><img src="/api/hr/rules/documents/7/images/42" alt="x"><p>sau</p>');
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].params[0], 7); // document_id
  assert.ok(Buffer.compare(client.calls[0].params[1], REAL_PNG) === 0); // content
  assert.equal(client.calls[0].params[2], 'image/png'); // content_type
  assert.equal(client.calls[0].params[3], REAL_PNG.length); // size_bytes
  assert.equal(client.calls[0].params[4], crypto.createHash('sha256').update(REAL_PNG).digest('hex'));
});

test('extractAndPersistImages: nhan ca src dung dau nhay don (HTML paste tu nguon khac)', async () => {
  const png = Buffer.from([0x89,0x50,0x4e,0x47,1]);
  const client = fakeClient([12]);
  const html = `<p>x</p><img alt='a' src='data:image/png;base64,${png.toString('base64')}'>`;
  const output = await extractAndPersistImages(client, 5, html);
  assert.match(output, /src="\/api\/hr\/rules\/documents\/5\/images\/12"/);
  assert.doesNotMatch(output, /data:image/);
});

test('extractAndPersistImages: tach nhieu anh, giu nguyen anh da la URL that (khong data:)', async () => {
  const client = fakeClient([1, 2]);
  const base64 = REAL_PNG.toString('base64');
  const html = `<img src="data:image/png;base64,${base64}">` +
    `<img src="/api/hr/rules/documents/7/images/99">` +
    `<img src="data:image/png;base64,${base64}">`;

  const result = await extractAndPersistImages(client, 7, html);
  assert.equal(client.calls.length, 2); // chi 2 anh data: moi, anh URL that bo qua
  assert.match(result, /\/api\/hr\/rules\/documents\/7\/images\/1"/);
  assert.match(result, /\/api\/hr\/rules\/documents\/7\/images\/99"/); // giu nguyen
  assert.match(result, /\/api\/hr\/rules\/documents\/7\/images\/2"/);
});

test('extractAndPersistImages: khong co anh nao thi tra ve html nguyen ven, khong goi query', async () => {
  const client = fakeClient();
  const html = '<p>khong co anh</p>';
  assert.equal(await extractAndPersistImages(client, 7, html), html);
  assert.equal(client.calls.length, 0);
});

test('extractAndPersistImages: anh qua 5MB nem RuleDocImageError 413', async () => {
  const client = fakeClient();
  const big = Buffer.alloc(5 * 1024 * 1024 + 1, 0x89); // > 5MB, byte dau gia PNG nhung qua lon
  const html = `<img src="data:image/png;base64,${big.toString('base64')}">`;
  await assert.rejects(() => extractAndPersistImages(client, 7, html), err => {
    assert.ok(err instanceof RuleDocImageError);
    assert.equal(err.statusCode, 413);
    assert.equal(err.code, 'RULE_DOC_IMAGE_TOO_LARGE');
    return true;
  });
});

test('extractAndPersistImages: byte dau khong khop MIME khai bao -> loi 400', async () => {
  const client = fakeClient();
  const fakePng = Buffer.from('day khong phai la mot tep PNG that su');
  const html = `<img src="data:image/png;base64,${fakePng.toString('base64')}">`;
  await assert.rejects(() => extractAndPersistImages(client, 7, html), err => {
    assert.ok(err instanceof RuleDocImageError);
    assert.equal(err.statusCode, 400);
    assert.equal(err.code, 'RULE_DOC_IMAGE_INVALID');
    return true;
  });
});

test('extractAndPersistImages: MIME ngoai whitelist (vd svg+xml) bi bo qua, khong luu', async () => {
  const client = fakeClient();
  const html = '<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">';
  const result = await extractAndPersistImages(client, 7, html);
  assert.equal(result, html); // khong khop regex (chi nhan png/jpeg/gif/webp) nen giu nguyen — bo loc XSS se go o buoc sau
  assert.equal(client.calls.length, 0);
});

test('pruneUnreferencedImages: xoa anh khong con duoc nhac toi trong body moi', async () => {
  const client = fakeClient();
  await pruneUnreferencedImages(client, 7, '<img src="/api/hr/rules/documents/7/images/1"><img src="/api/hr/rules/documents/7/images/3">');
  assert.equal(client.calls.length, 1);
  assert.match(client.calls[0].sql, /DELETE FROM hr_rule_document_images/);
  assert.deepEqual(client.calls[0].params, [7, [1, 3]]);
});

test('pruneUnreferencedImages: body khong con anh nao thi xoa het anh cua tai lieu', async () => {
  const client = fakeClient();
  await pruneUnreferencedImages(client, 7, '<p>khong con anh</p>');
  assert.equal(client.calls[0].sql, 'DELETE FROM hr_rule_document_images WHERE document_id = $1');
  assert.deepEqual(client.calls[0].params, [7]);
});
