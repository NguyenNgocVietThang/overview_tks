// ==========================================
// HR RULE DOCUMENTS REPOSITORY — bang Postgres `hr_rule_documents` (migration
// 0027): tai lieu "Quy dinh cong ty". Moi dong la 1 tab trong trang Quan ly nhan
// su va 1 nhanh con trong sidebar:
//   kind='builtin' : tai lieu dung san (noi dung nam trong HTML), chi luu metadata
//   kind='pdf'     : file PDF Quan ly tai len, luu trong cot content (BYTEA)
// Danh sach chi SELECT cot metadata — KHONG bao gio keo cot content.
// ==========================================
'use strict';

const crypto = require('crypto');
const { getPool } = require('../db/pool');

// Phai khop 2 dong seed cua migration 0027 (dung cho "Khoi phuc tai lieu mac dinh"
// va cho danh sach du phong khi bang chua duoc migrate).
const DEFAULT_BUILTIN_DOCUMENTS = Object.freeze([
  Object.freeze({ key: 'gio-giac', title: 'Giờ giấc làm việc', sortOrder: 10 }),
  Object.freeze({ key: 'nghi-phep', title: 'Quy định nghỉ phép', sortOrder: 20 })
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class RuleDocError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.statusCode = statusCode || 400;
    this.code = code || 'RULE_DOC_ERROR';
  }
}

// Tai khoan hard-code (admin) co the khong co id dang UUID -> luu NULL thay vi
// de Postgres nem loi 22P02.
function uuidOrNull(value) {
  const text = String(value || '').trim();
  return UUID.test(text) ? text : null;
}

function toIso(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function slugFor(row) {
  return row.kind === 'builtin' ? row.builtin_key : `pdf-${row.id}`;
}

function mapRow(row) {
  const doc = {
    id: Number(row.id),
    kind: row.kind,
    slug: slugFor(row),
    title: row.title
  };
  if (row.kind === 'builtin') {
    doc.builtinKey = row.builtin_key;
  } else {
    doc.fileName = row.file_name || '';
    doc.sizeBytes = Number(row.size_bytes) || 0;
    doc.uploadedBy = row.uploaded_by_name || '';
    doc.createdAt = toIso(row.created_at);
  }
  return doc;
}

const LIST_COLUMNS = 'id, kind, builtin_key, title, file_name, size_bytes, uploaded_by_name, created_at';

function createHrRuleDocumentsRepository({ pool = getPool() } = {}) {
  async function listDocuments() {
    const { rows } = await pool.query(
      `SELECT ${LIST_COLUMNS} FROM hr_rule_documents ORDER BY sort_order, created_at, id`
    );
    return rows.map(mapRow);
  }

  // Metadata + sha256 (dung lam ETag) — khong keo content.
  async function getFileMeta(id) {
    const { rows } = await pool.query(
      'SELECT id, kind, title, file_name, size_bytes, sha256 FROM hr_rule_documents WHERE id = $1',
      [id]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: Number(row.id),
      kind: row.kind,
      title: row.title,
      fileName: row.file_name || '',
      sizeBytes: Number(row.size_bytes) || 0,
      sha256: row.sha256 ? String(row.sha256).trim() : ''
    };
  }

  async function getFileContent(id) {
    const { rows } = await pool.query(
      "SELECT content FROM hr_rule_documents WHERE id = $1 AND kind = 'pdf'",
      [id]
    );
    return rows[0] ? rows[0].content : null;
  }

  /**
   * @param {{title:string, fileName:string, content:Buffer, uploadedByUserId?:string, uploadedByName?:string}} data
   */
  async function createPdfDocument(data) {
    const content = data.content;
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    const { rows } = await pool.query(
      `INSERT INTO hr_rule_documents
         (kind, title, file_name, size_bytes, sha256, content, uploaded_by_user_id, uploaded_by_name)
       VALUES ('pdf', $1, $2, $3, $4, $5, $6, $7)
       RETURNING ${LIST_COLUMNS}`,
      [data.title, data.fileName, content.length, sha256, content,
        uuidOrNull(data.uploadedByUserId), data.uploadedByName || '']
    );
    return mapRow(rows[0]);
  }

  // Tra ve tai lieu vua xoa (de bao thong bao) hoac null neu khong ton tai.
  async function deleteDocument(id) {
    const { rows } = await pool.query(
      `DELETE FROM hr_rule_documents WHERE id = $1 RETURNING ${LIST_COLUMNS}`,
      [id]
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  // Chen lai cac tai lieu dung san con thieu; tra ve danh sach vua duoc chen.
  async function restoreDefaultDocuments() {
    const values = [];
    const params = [];
    DEFAULT_BUILTIN_DOCUMENTS.forEach((doc, index) => {
      const base = index * 3;
      values.push(`('builtin', $${base + 1}, $${base + 2}, $${base + 3})`);
      params.push(doc.key, doc.title, doc.sortOrder);
    });
    const { rows } = await pool.query(
      `INSERT INTO hr_rule_documents (kind, builtin_key, title, sort_order)
       VALUES ${values.join(', ')}
       ON CONFLICT (builtin_key) DO NOTHING
       RETURNING ${LIST_COLUMNS}`,
      params
    );
    return rows.map(mapRow);
  }

  return { listDocuments, getFileMeta, getFileContent, createPdfDocument, deleteDocument, restoreDefaultDocuments };
}

const repository = createHrRuleDocumentsRepository();

module.exports = {
  DEFAULT_BUILTIN_DOCUMENTS,
  RuleDocError,
  createHrRuleDocumentsRepository,
  listDocuments: (...args) => repository.listDocuments(...args),
  getFileMeta: (...args) => repository.getFileMeta(...args),
  getFileContent: (...args) => repository.getFileContent(...args),
  createPdfDocument: (...args) => repository.createPdfDocument(...args),
  deleteDocument: (...args) => repository.deleteDocument(...args),
  restoreDefaultDocuments: (...args) => repository.restoreDefaultDocuments(...args)
};
