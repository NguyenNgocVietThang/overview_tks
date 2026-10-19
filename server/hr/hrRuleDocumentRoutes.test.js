'use strict';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const repo = require('./hrRuleDocumentsRepository');
const notifier = require('./hrRuleDocumentNotifier');
const router = require('./hrRuleDocumentRoutes');

// Mac dinh coi nhu migration 0061 da chay (bang hr_rule_document_images da co) — khong
// the nao cung can goi that pool.query() (khong co DB that trong test). Test rieng kiem
// tra truong hop CHUA chay se tu override bang withStubs roi duoc khoi phuc ve day.
repo.isRichTextReady = async () => true;

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

test('GET danh sach: DB local khong cau hinh van tra 4 tai lieu builtin o che do chi doc', async () => {
  await withStubs([[repo, 'listDocuments', async () => {
    const error = new Error('SUPABASE_DB_URL chua duoc cau hinh');
    throw error;
  }]], async () => {
    const res = fakeRes();
    await getRouteHandler('get', '/api/hr/rules/documents')({ user: MANAGER }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.degraded, true);
    assert.deepEqual(
      res.body.documents.map(doc => doc.builtinKey),
      ['gio-giac', 'nghi-phep', 'phuc-loi', 'treo-hang']
    );
  });
});

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
    ['get', '/api/hr/rules/documents/:id/images/:imageId', 'hr.rules'],
    ['post', '/api/hr/rules/documents', 'hr.rules.manage'],
    ['post', '/api/hr/rules/documents/text', 'hr.rules.manage'],
    ['put', '/api/hr/rules/documents/:id/text', 'hr.rules.manage'],
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

test('GET danh sách: trả tài liệu; missingDefaults luôn rỗng (từ migration 0065 không còn tài liệu dựng sẵn mặc định)', async () => {
  const docs = [TEXT_DOC, PDF_DOC];
  await withStubs([[repo, 'listDocuments', async () => docs]], async () => {
    const res = fakeRes();
    await getRouteHandler('get', '/api/hr/rules/documents')({ user: MANAGER }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.degraded, false);
    assert.deepEqual(res.body.missingDefaults, []);
    assert.equal(res.body.documents.length, 2);
  });
});

test('GET danh sách: bảng chưa migrate (42P01) ⇒ degraded, danh sách mặc định rỗng (từ migration 0065 không còn builtin)', async () => {
  await withStubs([[repo, 'listDocuments', async () => { const e = new Error('no table'); e.code = '42P01'; throw e; }]], async () => {
    const res = fakeRes();
    await getRouteHandler('get', '/api/hr/rules/documents')({ user: MANAGER }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.degraded, true);
    assert.deepEqual(res.body.documents.map(doc => doc.builtinKey), ['gio-giac', 'nghi-phep', 'phuc-loi', 'treo-hang']);
    assert.deepEqual(res.body.missingDefaults, []);
  });
});

test('GET danh sách: deploy code trước migration cột mới (42703, vd thiếu cột body) ⇒ cũng degraded như 42P01', async () => {
  await withStubs([[repo, 'listDocuments', async () => { const e = new Error('column "body" does not exist'); e.code = '42703'; throw e; }]], async () => {
    const res = fakeRes();
    await getRouteHandler('get', '/api/hr/rules/documents')({ user: MANAGER }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.degraded, true);
    assert.deepEqual(res.body.documents.map(doc => doc.builtinKey), ['gio-giac', 'nghi-phep', 'phuc-loi', 'treo-hang']);
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

test('GET ảnh: 200 kèm ETag/Cache-Control immutable, 304 khi If-None-Match khớp, 404 khi sai document_id hoặc không có, 400 khi id sai', async () => {
  const handler = getRouteHandler('get', '/api/hr/rules/documents/:id/images/:imageId');
  const IMAGE_META = { id: 42, documentId: 9, contentType: 'image/png', sizeBytes: 100, sha256: 'ab'.repeat(32) };
  const IMAGE_BYTES = Buffer.from('fake-png-bytes');

  const badId = fakeRes();
  await handler({ params: { id: 'x', imageId: '42' }, query: {} }, badId);
  assert.equal(badId.statusCode, 400);

  await withStubs([[repo, 'getImageMeta', async () => null]], async () => {
    const res = fakeRes();
    await handler({ params: { id: '9', imageId: '42' }, query: {} }, res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.code, 'RULE_DOC_IMAGE_NOT_FOUND');
  });

  // Anh thuoc tai lieu khac (documentId=9) nhung goi qua :id=5 -> tu choi, khong lo du lieu cheo tai lieu.
  await withStubs([[repo, 'getImageMeta', async () => IMAGE_META]], async () => {
    const res = fakeRes();
    await handler({ params: { id: '5', imageId: '42' }, query: {} }, res);
    assert.equal(res.statusCode, 404);
  });

  await withStubs([[repo, 'getImageMeta', async () => IMAGE_META], [repo, 'getImageContent', async () => IMAGE_BYTES]], async () => {
    const res = fakeRes();
    await handler({ params: { id: '9', imageId: '42' }, query: {}, fresh: false }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Content-Type'], 'image/png');
    assert.match(res.headers['Cache-Control'], /immutable/);
    assert.equal(res.headers['ETag'], `"${'ab'.repeat(32)}"`);
    assert.equal(res.ended, IMAGE_BYTES);
  });

  let contentRead = false;
  await withStubs([[repo, 'getImageMeta', async () => IMAGE_META], [repo, 'getImageContent', async () => { contentRead = true; return IMAGE_BYTES; }]], async () => {
    const res = fakeRes();
    await handler({ params: { id: '9', imageId: '42' }, query: {}, fresh: true }, res);
    assert.equal(res.statusCode, 304);
    assert.equal(contentRead, false);
  });
});

test('POST tạo / PUT sửa tài liệu gõ tay: nội dung thô (ảnh base64) vượt 8MB ⇒ 413', async () => {
  const bigBody = 'a'.repeat(8 * 1024 * 1024 + 1);
  const postHandler = getRouteHandler('post', '/api/hr/rules/documents/text');
  const resPost = fakeRes();
  await postHandler({ user: MANAGER, body: { title: 'x', body: bigBody } }, resPost);
  assert.equal(resPost.statusCode, 413);
  assert.equal(resPost.body.code, 'RULE_DOC_BODY_TOO_LARGE');

  const putHandler = getRouteHandler('put', '/api/hr/rules/documents/:id/text');
  const resPut = fakeRes();
  await putHandler({ params: { id: '9' }, user: MANAGER, body: { title: 'x', body: bigBody } }, resPut);
  assert.equal(resPut.statusCode, 413);
  assert.equal(resPut.body.code, 'RULE_DOC_BODY_TOO_LARGE');
});

test('POST/PUT rich-text bị khóa 503 khi migration 0061 chưa áp (tránh lưu/render HTML sai thời điểm)', async () => {
  const create = getRouteHandler('post', '/api/hr/rules/documents/text');
  const update = getRouteHandler('put', '/api/hr/rules/documents/:id/text');
  await withStubs([[repo, 'isRichTextReady', async () => false]], async () => {
    const created = fakeRes();
    await create({ body:{ title:'T', body:'<b>x</b>' }, user:MANAGER }, created);
    assert.equal(created.statusCode, 503);
    assert.equal(created.body.code, 'RULE_DOC_RICH_TEXT_NOT_READY');
    const updated = fakeRes();
    await update({ params:{id:'8'}, body:{title:'T',body:'<b>x</b>'}, user:MANAGER }, updated);
    assert.equal(updated.statusCode, 503);
    assert.equal(updated.body.code, 'RULE_DOC_RICH_TEXT_NOT_READY');
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

const TEXT_DOC = { id: 9, kind: 'text', slug: 'text-9', title: 'Hướng dẫn dùng bot', body: 'Bước 1: ...' };

test('POST tạo tài liệu gõ tay: thiếu tiêu đề 400, thiếu nội dung 400, thành công 201 + gọi notifier', async () => {
  const handler = getRouteHandler('post', '/api/hr/rules/documents/text');

  const noTitle = fakeRes();
  await handler({ user: MANAGER, body: { title: '  ', body: 'Nội dung' } }, noTitle);
  assert.equal(noTitle.statusCode, 400);
  assert.equal(noTitle.body.code, 'RULE_DOC_NO_TITLE');

  const noBody = fakeRes();
  await handler({ user: MANAGER, body: { title: 'Hướng dẫn', body: '   ' } }, noBody);
  assert.equal(noBody.statusCode, 400);
  assert.equal(noBody.body.code, 'RULE_DOC_NO_BODY');

  let created; let notified;
  await withStubs([
    [repo, 'createTextDocument', async data => { created = data; return TEXT_DOC; }],
    [notifier, 'documentAdded', async (actor, doc) => { notified = doc; }]
  ], async () => {
    const res = fakeRes();
    await handler({ user: MANAGER, body: { title: '  Hướng dẫn   dùng bot  ', body: 'Bước 1: ...' } }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.document.slug, 'text-9');
    assert.equal(created.title, 'Hướng dẫn dùng bot');
    assert.equal(created.body, 'Bước 1: ...');
    assert.equal(created.createdByName, 'Quản lý A');
    assert.equal(notified, TEXT_DOC);
  });
});

test('PUT sửa tài liệu gõ tay: id sai 400, thiếu tiêu đề/nội dung 400, không tồn tại 404, thành công 200', async () => {
  const handler = getRouteHandler('put', '/api/hr/rules/documents/:id/text');

  const badId = fakeRes();
  await handler({ params: { id: 'abc' }, user: MANAGER, body: { title: 'x', body: 'y' } }, badId);
  assert.equal(badId.statusCode, 400);
  assert.equal(badId.body.code, 'RULE_DOC_INVALID_ID');

  const noTitle = fakeRes();
  await handler({ params: { id: '9' }, user: MANAGER, body: { title: '', body: 'y' } }, noTitle);
  assert.equal(noTitle.body.code, 'RULE_DOC_NO_TITLE');

  await withStubs([[repo, 'updateTextDocument', async () => null]], async () => {
    const res = fakeRes();
    await handler({ params: { id: '9' }, user: MANAGER, body: { title: 'x', body: 'y' } }, res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.code, 'RULE_DOC_NOT_FOUND');
  });

  let updated;
  await withStubs([[repo, 'updateTextDocument', async (id, data) => { updated = { id, data }; return TEXT_DOC; }]], async () => {
    const res = fakeRes();
    await handler({ params: { id: '9' }, user: MANAGER, body: { title: 'Hướng dẫn mới', body: 'Nội dung mới' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.document.slug, 'text-9');
    assert.equal(updated.id, 9);
    assert.equal(updated.data.title, 'Hướng dẫn mới');
    assert.equal(updated.data.body, 'Nội dung mới');
    assert.equal(updated.data.updatedByName, 'Quản lý A');
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
