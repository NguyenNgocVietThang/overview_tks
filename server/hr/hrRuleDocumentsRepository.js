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
const { sanitizeRuleDocumentHtml, hasMeaningfulRuleDocumentContent } = require('./hrRuleDocumentSanitizer');
const { extractAndPersistImages, pruneUnreferencedImages } = require('./hrRuleDocumentImages');

// Phai khop cac dong seed cua migration 0027 + 0039 (dung cho "Khoi phuc tai lieu mac dinh"
// va cho danh sach du phong khi bang chua duoc migrate).
const DEFAULT_BUILTIN_DOCUMENTS = Object.freeze([
  Object.freeze({ key: 'gio-giac', title: 'Giờ giấc làm việc', sortOrder: 10 }),
  Object.freeze({ key: 'nghi-phep', title: 'Quy định nghỉ phép', sortOrder: 20 }),
  Object.freeze({ key: 'phuc-loi', title: 'Chi tiêu & Phúc lợi', sortOrder: 30 }),
  Object.freeze({ key: 'treo-hang', title: 'Quy định treo hàng', sortOrder: 40 })
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
  if (row.kind === 'builtin') return row.builtin_key;
  return `${row.kind}-${row.id}`;
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
  } else if (row.kind === 'text') {
    doc.body = row.body || '';
    doc.uploadedBy = row.uploaded_by_name || '';
    doc.createdAt = toIso(row.created_at);
    doc.updatedBy = row.updated_by_name || '';
    doc.updatedAt = row.updated_at ? toIso(row.updated_at) : '';
  } else {
    doc.fileName = row.file_name || '';
    doc.sizeBytes = Number(row.size_bytes) || 0;
    doc.uploadedBy = row.uploaded_by_name || '';
    doc.createdAt = toIso(row.created_at);
  }
  return doc;
}

// Gioi han do dai HTML SAU KHI da loc + tach anh ra bang rieng — khop CHECK
// char_length(body) BETWEEN 1 AND 200000 (migration 0061). Noi dung tho nguoi dung
// gui len (truoc khi tach anh base64) co the lon hon nhieu, xem RAW_BODY_MAX_BYTES
// o hrRuleDocumentRoutes.js.
const BODY_MAX_LENGTH = 200000;

const LIST_COLUMNS = 'id, kind, builtin_key, title, file_name, size_bytes, uploaded_by_name, created_at, body, updated_at, updated_by_name';

function createHrRuleDocumentsRepository({ pool = getPool() } = {}) {
  async function isRichTextReady() {
    const { rows } = await pool.query(
      "SELECT to_regclass('public.hr_rule_document_images') IS NOT NULL AS ready"
    );
    return Boolean(rows[0] && rows[0].ready);
  }

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

/**
   * Xu ly noi dung rich text truoc khi luu: tach anh data: ra bang rieng (can co id
   * tai lieu truoc, xem hrRuleDocumentImages.js) roi loc HTML qua whitelist XSS
   * (hrRuleDocumentSanitizer.js). Nem RuleDocError/RuleDocImageError (statusCode<500)
   * neu noi dung rong hoac qua dai SAU khi xu ly.
   */
  async function processBodyForStorage(client, documentId, rawBody) {
    const withImages = await extractAndPersistImages(client, documentId, rawBody);
    const finalHtml = sanitizeRuleDocumentHtml(withImages);
    if (!hasMeaningfulRuleDocumentContent(finalHtml)) throw new RuleDocError('Nội dung rỗng sau khi lọc (có thể toàn bộ nội dung không hợp lệ).', 400, 'RULE_DOC_BODY_EMPTY');
    if (finalHtml.length > BODY_MAX_LENGTH) throw new RuleDocError(`Nội dung quá dài sau khi xử lý (tối đa ${BODY_MAX_LENGTH} ký tự).`, 400, 'RULE_DOC_BODY_TOO_LONG');
    return finalHtml;
  }

  /**
   * @param {{title:string, body:string, createdByUserId?:string, createdByName?:string}} data
   */
  async function createTextDocument(data) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // body dat tam '<p></p>' (hop le voi CHECK rang buoc hinh dang kind='text') de
      // lay duoc id truoc — can id de tach anh gan dung document_id ngay tu dau.
      const inserted = await client.query(
        `INSERT INTO hr_rule_documents (kind, title, body, uploaded_by_user_id, uploaded_by_name)
         VALUES ('text', $1, '<p></p>', $2, $3) RETURNING id`,
        [data.title, uuidOrNull(data.createdByUserId), data.createdByName || '']
      );
      const id = inserted.rows[0].id;
      const finalHtml = await processBodyForStorage(client, id, data.body);
      const { rows } = await client.query(
        `UPDATE hr_rule_documents SET body = $2 WHERE id = $1 RETURNING ${LIST_COLUMNS}`,
        [id, finalHtml]
      );
      await client.query('COMMIT');
      return mapRow(rows[0]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * @param {{title:string, body:string, updatedByName?:string}} data
   */
  async function updateTextDocument(id, data) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Khoa va xac nhan tai lieu ton tai TRUOC khi tach anh. Neu id khong co/khong
      // phai kind=text ma van chen anh truoc, FK document_id se nem 500 thay vi 404.
      const existing = await client.query(
        "SELECT id FROM hr_rule_documents WHERE id = $1 AND kind = 'text' FOR UPDATE",
        [id]
      );
      if (!existing.rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }
      const finalHtml = await processBodyForStorage(client, id, data.body);
      // Anh nguoi dung da xoa khoi noi dung (khong con duoc nhac toi) bi don luon o day.
      await pruneUnreferencedImages(client, id, finalHtml);
      const { rows } = await client.query(
        `UPDATE hr_rule_documents SET title = $2, body = $3, updated_at = now(), updated_by_name = $4
         WHERE id = $1 AND kind = 'text'
         RETURNING ${LIST_COLUMNS}`,
        [id, data.title, finalHtml, data.updatedByName || '']
      );
      await client.query(rows[0] ? 'COMMIT' : 'ROLLBACK');
      return rows[0] ? mapRow(rows[0]) : null;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
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

  // Anh chen trong tai lieu go tay (hr_rule_document_images, migration 0061) — cung
  // mau voi getFileMeta/getFileContent cua PDF: meta khong keo content, co sha256 lam ETag.
  async function getImageMeta(imageId) {
    const { rows } = await pool.query(
      'SELECT id, document_id, content_type, size_bytes, sha256 FROM hr_rule_document_images WHERE id = $1',
      [imageId]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: Number(row.id),
      documentId: Number(row.document_id),
      contentType: row.content_type,
      sizeBytes: Number(row.size_bytes) || 0,
      sha256: row.sha256 ? String(row.sha256).trim() : ''
    };
  }

  async function getImageContent(imageId) {
    const { rows } = await pool.query('SELECT content FROM hr_rule_document_images WHERE id = $1', [imageId]);
    return rows[0] ? rows[0].content : null;
  }

  return {
    isRichTextReady, listDocuments, getFileMeta, getFileContent, createPdfDocument,
    createTextDocument, updateTextDocument, deleteDocument, restoreDefaultDocuments,
    getImageMeta, getImageContent
  };
}

const repository = createHrRuleDocumentsRepository();

module.exports = {
  DEFAULT_BUILTIN_DOCUMENTS,
  RuleDocError,
  createHrRuleDocumentsRepository,
  isRichTextReady: (...args) => repository.isRichTextReady(...args),
  listDocuments: (...args) => repository.listDocuments(...args),
  getFileMeta: (...args) => repository.getFileMeta(...args),
  getFileContent: (...args) => repository.getFileContent(...args),
  createPdfDocument: (...args) => repository.createPdfDocument(...args),
  createTextDocument: (...args) => repository.createTextDocument(...args),
  updateTextDocument: (...args) => repository.updateTextDocument(...args),
  deleteDocument: (...args) => repository.deleteDocument(...args),
  restoreDefaultDocuments: (...args) => repository.restoreDefaultDocuments(...args),
  getImageMeta: (...args) => repository.getImageMeta(...args),
  getImageContent: (...args) => repository.getImageContent(...args),
  BODY_MAX_LENGTH
};
