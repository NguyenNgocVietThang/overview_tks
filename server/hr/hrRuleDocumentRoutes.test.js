'use strict';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const repo = require('./hrRuleDocumentsRepository');
const notifier = require('./hrRuleDocumentNotifier');
const router = require('./hrRuleDocumentRoutes');

function fakeRes() {
  const res = { statusCode: 200, body: null, headers: {}, ended: undefined };
  res.status = code => { res.statusCode = code; return res; };
  res.json = payload => { res.body = payload; return res; };
  res.setHeader = (name, value) => { res.headers[name] = value; return res; };
  res.end = payload => { res.ended = payload === undefined ? null : payload; return res; };
  return res;
}

function routeLayer(method, routePath) {
  return router.stack.find(item => item.route && item.route.path === routePath && item.route.methods[method]);
}
function getRouteHandler(method, routePath) {
  const stack = routeLayer(method, routePath).route.stack;
  return stack[stack.length - 1].handle;
}

const MANAGER = { id: 'm1', vaiTro: 'Quản lý', username: 'manager', hoTen: 'Quản lý A' };
const PDF_DOC = { id: 7, kind: 'pdf', slug: 'pdf-7', title: 'Nội quy kho', fileName: 'noi-quy-kho.pdf', sizeBytes: 20 };
const PDF_BYTES = Buffer.from('%PDF-1.4\n%fake body');

// Thay ham cua module bang stub roi khoi phuc — route goi qua module object.
async function withStubs(stubs, fn) {
  const saved = [];
  for (const [target, key, value] of stubs) { saved.push([target, key, target[key]]); target[key] = value; }
  const originalInfo = console.info;
  console.info = () => {};
  try { return await fn(); } finally {
    console.info = originalInfo;
    for (const [target, key, value] of saved) target[key] = value;
  }
}

test('guard: xem = hr.rules, ghi = hr.rules.manage', () => {
  const cases = [
    ['get', '/api/hr/rules/documents', 'hr.rules'],
    ['get', '/api/hr/rules/documents/:id/file', 'hr.rules'],
    ['post', '/api/hr/rules/documents', 'hr.rules.manage'],
    ['post', '/api/hr/rules/documents/restore-defaults', 'hr.rules.manage'],
    ['delete', '/api/hr/rules/documents/:id', 'hr.rules.manage']
  ];
  for (const [method, routePath, feature] of cases) {
    const featureGuard = routeLayer(method, routePath).route.stack[1].handle;
    const denied = fakeRes();
    featureGuard({ user: { vaiTro: 'Nhân viên kho', permissions: feature === 'hr.rules' ? [] : ['hr.rules'] } }, denied, () => assert.fail('không được next'));
    assert.equal(denied.statusCode, 403, `${method} ${routePath}`);
    let passed = false;
    featureGuard({ user: { vaiTro: 'Quản lý', permissions: [feature] } }, fakeRes(), () => { passed = true; });
    assert.equal(passed, true, `${method} ${routePath}`);
  }
});

test('GET danh sách: trả tài liệu + missingDefaults', async () => {
  const docs = [{ id: 1, kind: 'builtin', slug: 'gio-giac', builtinKey: 'gio-giac', title: 'Giờ giấc làm việc' }, PDF_DOC];
  await withStubs([[repo, 'listDocuments', async () => docs]], async () => {
    const res = fakeRes();
    await getRouteHandler('get', '/api/hr/rules/documents')({ user: MANAGER }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.degraded, false);
    assert.deepEqual(res.body.missingDefaults, ['nghi-phep', 'phuc-loi']);
    assert.equal(res.body.documents.length, 2);
  });
});

test('GET danh sách: bảng chưa migrate (42P01) ⇒ trả 3 tài liệu mặc định, degraded', async () => {
  await withStubs([[repo, 'listDocuments', async () => { const e = new Error('no table'); e.code = '42P01'; throw e; }]], async () => {
    const res = fakeRes();
    await getRouteHandler('get', '/api/hr/rules/documents')({ user: MANAGER }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.degraded, true);
    assert.deepEqual(res.body.documents.map(d => d.slug), ['gio-giac', 'nghi-phep', 'phuc-loi']);
    assert.deepEqual(res.body.missingDefaults, []);
  });
});

test('GET file: 200 kèm header, tên tiếng Việt qua filename*, download=1 ⇒ attachment', async () => {
  const meta = { id: 7, kind: 'pdf', title: 'T', fileName: 'Nội quy kho.pdf', sizeBytes: 20, sha256: 'ab'.repeat(32) };
  await withStubs([[repo, 'getFileMeta', async () => meta], [repo, 'getFileContent', async () => PDF_BYTES]], async () => {
    const handler = getRouteHandler('get', '/api/hr/rules/documents/:id/file');
    const inline = fakeRes();
    await handler({ params: { id: '7' }, query: {}, fresh: false }, inline);
    assert.equal(inline.statusCode, 200);
    assert.equal(inline.headers['Content-Type'], 'application/pdf');
    assert.match(inline.headers['Content-Disposition'], /^inline; filename="Noi_quy_kho\.pdf"; filename\*=UTF-8''N%E1%BB%99i%20quy%20kho\.pdf$/);
    assert.equal(inline.headers['X-Content-Type-Options'], 'nosniff');
    assert.equal(inline.headers['ETag'], `"${'ab'.repeat(32)}"`);
    assert.equal(inline.ended, PDF_BYTES);

    const attach = fakeRes();
    await handler({ params: { id: '7' }, query: { download: '1' }, fresh: false }, attach);
    assert.match(attach.headers['Content-Disposition'], /^attachment;/);
  });
});

test('GET file: If-None-Match khớp ⇒ 304 và KHÔNG đọc nội dung', async () => {
  let contentRead = false;
  const meta = { id: 7, kind: 'pdf', title: 'T', fileName: 'a.pdf', sizeBytes: 20, sha256: 'cd'.repeat(32) };
  await withStubs([[repo, 'getFileMeta', async () => meta], [repo, 'getFileContent', async () => { contentRead = true; return PDF_BYTES; }]], async () => {
    const res = fakeRes();
    await getRouteHandler('get', '/api/hr/rules/documents/:id/file')({ params: { id: '7' }, query: {}, fresh: true }, res);
    assert.equal(res.statusCode, 304);
    assert.equal(contentRead, false);
  });
});

test('GET file: id sai 400, không tồn tại 404, tài liệu dựng sẵn 404 RULE_DOC_NOT_FILE', async () => {
  const handler = getRouteHandler('get', '/api/hr/rules/documents/:id/file');
  const bad = fakeRes();
  await handler({ params: { id: 'abc' }, query: {} }, bad);
  assert.equal(bad.statusCode, 400);

  await withStubs([[repo, 'getFileMeta', async () => null]], async () => {
    const res = fakeRes();
    await handler({ params: { id: '9' }, query: {} }, res);
    assert.equal(res.statusCode, 404);
  });
  await withStubs([[repo, 'getFileMeta', async () => ({ id: 1, kind: 'builtin', sha256: '' })]], async () => {
    const res = fakeRes();
    await handler({ params: { id: '1' }, query: {} }, res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.code, 'RULE_DOC_NOT_FILE');
  });
});

test('POST tải lên: thiếu file 400, không phải PDF 400, thành công 201 + gọi notifier', async () => {
  const handler = getRouteHandler('post', '/api/hr/rules/documents');

  const none = fakeRes();
  await handler({ user: MANAGER, body: {} }, none);
  assert.equal(none.statusCode, 400);
  assert.equal(none.body.code, 'RULE_DOC_NO_FILE');

  const notPdf = fakeRes();
  await handler({ user: MANAGER, body: {}, file: { originalname: 'a.pdf', buffer: Buffer.from('PK zip data') } }, notPdf);
  assert.equal(notPdf.body.code, 'RULE_DOC_NOT_PDF');

  let created; let notified;
  await withStubs([
    [repo, 'createPdfDocument', async data => { created = data; return PDF_DOC; }],
    [notifier, 'documentAdded', async (actor, doc) => { notified = { actor, doc }; }]
  ], async () => {
    const res = fakeRes();
    await handler({
      user: MANAGER, body: { title: '  Nội quy   kho  ' },
      file: { originalname: 'C:\\tmp\\Nội quy kho.PDF', buffer: PDF_BYTES }
    }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.document.slug, 'pdf-7');
    assert.equal(created.title, 'Nội quy kho');
    assert.equal(created.fileName, 'Nội quy kho.pdf');
    assert.equal(created.uploadedByName, 'Quản lý A');
    assert.equal(notified.doc, PDF_DOC);
  });
});

test('POST tải lên: tiêu đề mặc định lấy từ tên file; notifier lỗi không đổi response', async () => {
  let created;
  await withStubs([
    [repo, 'createPdfDocument', async data => { created = data; return PDF_DOC; }],
    [notifier, 'documentAdded', () => { throw new Error('boom'); }]
  ], async () => {
    const originalError = console.error;
    console.error = () => {};
    try {
      const res = fakeRes();
      await getRouteHandler('post', '/api/hr/rules/documents')({
        user: MANAGER, body: {}, file: { originalname: 'Bảng lương.pdf', buffer: PDF_BYTES }
      }, res);
      assert.equal(res.statusCode, 201);
      assert.equal(created.title, 'Bảng lương');
    } finally { console.error = originalError; }
  });
});

// Dung 1 request multipart that (Readable + header) de chay middleware multer that.
function multipartRequest(fileName, fileBuffer, extraFields = {}) {
  const { Readable } = require('node:stream');
  const boundary = '----testboundary';
  const parts = [];
  for (const [name, value] of Object.entries(extraFields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, 'utf8'));
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/pdf\r\n\r\n`, 'utf8'));
  parts.push(fileBuffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'));
  const body = Buffer.concat(parts);
  const req = Readable.from([body]);
  req.headers = { 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': String(body.length) };
  req.method = 'POST';
  return req;
}

test('wrapper multer: đọc đúng tên file tiếng Việt (utf8) và field title', async () => {
  const req = multipartRequest('Nội quy kho.pdf', PDF_BYTES, { title: 'Nội quy' });
  const res = fakeRes();
  await new Promise(resolve => router.uploadPdf(req, res, resolve));
  assert.equal(req.file.originalname, 'Nội quy kho.pdf');
  assert.equal(req.body.title, 'Nội quy');
  assert.equal(req.file.buffer.length, PDF_BYTES.length);
});

test('wrapper multer: quá 20 MB ⇒ 413 RULE_DOC_TOO_LARGE (không phải 500)', async () => {
  const req = multipartRequest('big.pdf', Buffer.alloc(router.MAX_PDF_BYTES + 1024, 1));
  const res = fakeRes();
  let nextCalled = false;
  await new Promise(resolve => {
    res.json = payload => { res.body = payload; resolve(); return res; };
    router.uploadPdf(req, res, () => { nextCalled = true; resolve(); });
  });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 413);
  assert.equal(res.body.code, 'RULE_DOC_TOO_LARGE');
});

test('DELETE: 200 + notifier, 404 khi không có, 400 khi id sai', async () => {
  const handler = getRouteHandler('delete', '/api/hr/rules/documents/:id');
  const bad = fakeRes();
  await handler({ params: { id: '0' }, user: MANAGER }, bad);
  assert.equal(bad.statusCode, 400);

  await withStubs([[repo, 'deleteDocument', async () => null]], async () => {
    const res = fakeRes();
    await handler({ params: { id: '7' }, user: MANAGER }, res);
    assert.equal(res.statusCode, 404);
  });

  let notified = null;
  await withStubs([
    [repo, 'deleteDocument', async () => PDF_DOC],
    [notifier, 'documentRemoved', async (actor, doc) => { notified = doc; }]
  ], async () => {
    const res = fakeRes();
    await handler({ params: { id: '7' }, user: MANAGER }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(notified, PDF_DOC);
  });
});

test('POST restore-defaults: trả số tài liệu khôi phục; không thông báo khi không có gì', async () => {
  const handler = getRouteHandler('post', '/api/hr/rules/documents/restore-defaults');
  let notifiedCount = 0;
  const notifierStub = [notifier, 'defaultsRestored', async () => { notifiedCount += 1; }];

  await withStubs([[repo, 'restoreDefaultDocuments', async () => []], [repo, 'listDocuments', async () => [PDF_DOC]], notifierStub], async () => {
    const res = fakeRes();
    await handler({ user: MANAGER }, res);
    assert.equal(res.body.restored, 0);
    assert.equal(notifiedCount, 0);
  });
  await withStubs([[repo, 'restoreDefaultDocuments', async () => [{ slug: 'nghi-phep', title: 'Quy định nghỉ phép' }]], [repo, 'listDocuments', async () => [PDF_DOC]], notifierStub], async () => {
    const res = fakeRes();
    await handler({ user: MANAGER }, res);
    assert.equal(res.body.restored, 1);
    assert.equal(notifiedCount, 1);
  });
});
