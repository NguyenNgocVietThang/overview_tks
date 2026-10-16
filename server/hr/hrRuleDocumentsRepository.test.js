'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createHrRuleDocumentsRepository, DEFAULT_BUILTIN_DOCUMENTS } = require('./hrRuleDocumentsRepository');

function fakePool(rowsQueue = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: rowsQueue.length ? rowsQueue.shift() : [] };
    }
  };
}

const PDF_ROW = {
  id: '7', kind: 'pdf', builtin_key: null, title: 'Nội quy kho', file_name: 'noi-quy-kho.pdf',
  size_bytes: 1234, uploaded_by_name: 'Quản lý A', created_at: new Date('2026-09-30T03:00:00.000Z')
};
const BUILTIN_ROW = { id: '1', kind: 'builtin', builtin_key: 'gio-giac', title: 'Giờ giấc làm việc' };

test('listDocuments ánh xạ slug/kind và KHÔNG chọn cột content', async () => {
  const pool = fakePool([[BUILTIN_ROW, PDF_ROW]]);
  const docs = await createHrRuleDocumentsRepository({ pool }).listDocuments();

  assert.equal(docs[0].slug, 'gio-giac');
  assert.equal(docs[0].kind, 'builtin');
  assert.equal(docs[0].builtinKey, 'gio-giac');
  assert.equal(docs[1].slug, 'pdf-7');
  assert.equal(docs[1].id, 7);
  assert.equal(docs[1].fileName, 'noi-quy-kho.pdf');
  assert.equal(docs[1].sizeBytes, 1234);
  assert.equal(docs[1].uploadedBy, 'Quản lý A');
  assert.equal(docs[1].createdAt, '2026-09-30T03:00:00.000Z');
  assert.doesNotMatch(pool.calls[0].sql, /\bcontent\b/);
  assert.match(pool.calls[0].sql, /ORDER BY sort_order, created_at, id/);
});

test('createPdfDocument tính sha256 + kích thước và bỏ id không phải UUID', async () => {
  const pool = fakePool([[PDF_ROW]]);
  const content = Buffer.from('%PDF-1.4 hello');
  const doc = await createHrRuleDocumentsRepository({ pool }).createPdfDocument({
    title: 'Nội quy kho', fileName: 'noi-quy-kho.pdf', content,
    uploadedByUserId: 'admin-default', uploadedByName: 'Quản lý A'
  });

  const { sql, params } = pool.calls[0];
  assert.match(sql, /INSERT INTO hr_rule_documents/);
  assert.equal(params[2], content.length);
  assert.equal(params[3], crypto.createHash('sha256').update(content).digest('hex'));
  assert.equal(params[4], content);
  assert.equal(params[5], null, 'id không phải UUID ⇒ NULL');
  assert.equal(doc.slug, 'pdf-7');

  const uuid = '11111111-1111-1111-1111-111111111111';
  const pool2 = fakePool([[PDF_ROW]]);
  await createHrRuleDocumentsRepository({ pool: pool2 }).createPdfDocument({
    title: 'x', fileName: 'x.pdf', content, uploadedByUserId: uuid
  });
  assert.equal(pool2.calls[0].params[5], uuid);
});

test('deleteDocument trả tài liệu đã xóa hoặc null khi không có', async () => {
  const repo = createHrRuleDocumentsRepository({ pool: fakePool([[PDF_ROW], []]) });
  assert.equal((await repo.deleteDocument(7)).slug, 'pdf-7');
  assert.equal(await repo.deleteDocument(8), null);
});

test('getFileMeta / getFileContent chỉ đọc PDF, meta không kéo content', async () => {
  const pool = fakePool([[{ id: '7', kind: 'pdf', title: 'T', file_name: 'a.pdf', size_bytes: 5, sha256: 'ab'.repeat(32) }], [{ content: Buffer.from('x') }], []]);
  const repo = createHrRuleDocumentsRepository({ pool });
  const meta = await repo.getFileMeta(7);
  assert.equal(meta.sha256, 'ab'.repeat(32));
  assert.doesNotMatch(pool.calls[0].sql, /\bcontent\b/);
  assert.equal((await repo.getFileContent(7)).toString(), 'x');
  assert.match(pool.calls[1].sql, /kind = 'pdf'/);
  assert.equal(await repo.getFileContent(9), null);
});

test('restoreDefaultDocuments chèn các tài liệu mặc định với ON CONFLICT DO NOTHING', async () => {
  const pool = fakePool([[BUILTIN_ROW]]);
  const restored = await createHrRuleDocumentsRepository({ pool }).restoreDefaultDocuments();

  const { sql, params } = pool.calls[0];
  assert.match(sql, /ON CONFLICT \(builtin_key\) DO NOTHING/);
  assert.deepEqual(params, DEFAULT_BUILTIN_DOCUMENTS.flatMap(d => [d.key, d.title, d.sortOrder]));
  assert.equal(restored.length, 1);
});
