// ==========================================
// HR RULE DOCUMENT IMAGES — anh chen trong tai lieu go tay (kind='text', migration 0061).
//
// Luong: trinh soan thao chen anh bang Data URI (FileReader.readAsDataURL) de xem truoc
// ngay tren trinh duyet, KHONG goi API rieng. Khi Luu (create/update), server quet HTML
// gui len, tach tung the <img src="data:..."> thanh 1 dong trong hr_rule_document_images,
// roi THAY src bang duong dan that (/api/hr/rules/documents/:id/images/:imageId) truoc
// khi dua qua bo loc XSS (hrRuleDocumentSanitizer). Nho vay:
//   - body luu trong hr_rule_documents KHONG bao gio chua base64 khong lo (tranh dong
//     phinh to, moi lan GET danh sach phai keo het).
//   - Luu/Sua la 1 giao dich (transaction): tao dong anh + doi body + xoa anh khong con
//     duoc nhac toi nua (nguoi dung xoa anh khoi noi dung) deu atomic.
// ==========================================
'use strict';

const crypto = require('crypto');

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MIME_TO_SIGNATURE = {
  'image/png': [[0x89, 0x50, 0x4e, 0x47]],
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/gif': [[0x47, 0x49, 0x46, 0x38]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]] // RIFF....WEBP — kiem them o duoi
};
const ALLOWED_MIME = new Set(Object.keys(MIME_TO_SIGNATURE));

class RuleDocImageError extends Error {
  constructor(message, statusCode = 400, code = 'RULE_DOC_IMAGE_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

/** Kiem tra byte dau file co khop dung MIME khai bao khong (chan gia mao duoi/MIME). */
function matchesSignature(buffer, mime) {
  const signatures = MIME_TO_SIGNATURE[mime];
  const matchAny = signatures.some(sig => sig.every((byte, i) => buffer[i] === byte));
  if (!matchAny) return false;
  if (mime === 'image/webp') {
    return buffer.length >= 12 && buffer.subarray(8, 12).toString('latin1') === 'WEBP';
  }
  return true;
}

const DATA_URI_IMG_RE = /<img\b[^>]*\bsrc\s*=\s*(["'])data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)\1[^>]*>/gi;

/**
 * Tach moi <img src="data:..."> trong html thanh dong trong hr_rule_document_images
 * (gan voi documentId), thay src bang duong dan that. Chay trong transaction cua caller
 * (client la pg PoolClient dang o giua BEGIN/COMMIT).
 *
 * @param {import('pg').PoolClient} client
 * @param {number} documentId
 * @param {string} html
 * @returns {Promise<string>} html voi moi src data: da duoc thay bang URL that
 */
async function extractAndPersistImages(client, documentId, html) {
  const matches = [...String(html || '').matchAll(DATA_URI_IMG_RE)];
  if (!matches.length) return html;

  let result = html;
  for (const match of matches) {
    const [fullTag, , mime, base64] = match;
    if (!ALLOWED_MIME.has(mime)) continue;

    let buffer;
    try {
      buffer = Buffer.from(base64, 'base64');
    } catch {
      continue;
    }
    if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
      throw new RuleDocImageError(`Ảnh quá lớn, tối đa ${MAX_IMAGE_BYTES / (1024 * 1024)} MB.`, 413, 'RULE_DOC_IMAGE_TOO_LARGE');
    }
    if (!matchesSignature(buffer, mime)) {
      throw new RuleDocImageError('File ảnh không hợp lệ (không khớp định dạng khai báo).', 400, 'RULE_DOC_IMAGE_INVALID');
    }

    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const { rows } = await client.query(
      `INSERT INTO hr_rule_document_images (document_id, content, content_type, size_bytes, sha256)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [documentId, buffer, mime, buffer.length, sha256]
    );
    const realSrc = `/api/hr/rules/documents/${documentId}/images/${rows[0].id}`;
    const newTag = fullTag.replace(/\bsrc\s*=\s*(["'])data:[\s\S]*?\1/i, `src="${realSrc}"`);
    result = result.replace(fullTag, newTag);
  }
  return result;
}

const REFERENCED_IMAGE_ID_RE = /\/api\/hr\/rules\/documents\/\d+\/images\/(\d+)/g;

/** Xoa cac dong anh cua documentId khong con duoc nhac toi trong finalHtml. */
async function pruneUnreferencedImages(client, documentId, finalHtml) {
  const referencedIds = [...String(finalHtml || '').matchAll(REFERENCED_IMAGE_ID_RE)].map(m => Number(m[1]));
  if (referencedIds.length) {
    await client.query(
      'DELETE FROM hr_rule_document_images WHERE document_id = $1 AND NOT (id = ANY($2::bigint[]))',
      [documentId, referencedIds]
    );
  } else {
    await client.query('DELETE FROM hr_rule_document_images WHERE document_id = $1', [documentId]);
  }
}

module.exports = {
  RuleDocImageError,
  MAX_IMAGE_BYTES,
  ALLOWED_MIME,
  matchesSignature,
  extractAndPersistImages,
  pruneUnreferencedImages
};
