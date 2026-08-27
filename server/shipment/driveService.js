// ==========================================
// DRIVE SERVICE — upload anh chung tu van chuyen len Google Drive
//
// To chuc thu muc: <VC_DRIVE_FOLDER_ID>/<YYYYMMDD>/<order_id>/
// Cache folder ID theo ngay va order_id de tranh goi Drive API thua.
//
// Export chinh: uploadAttachment({ orderId, date, type, fileBuffer,
//               mimeType, originalName }) => { drive_file_id,
//               drive_view_url, drive_thumbnail_url }
// ==========================================
const { google } = require('googleapis');
const { Readable } = require('stream');
const CONFIG = require('../config');
const { BRANCHES } = require('../branch/branches');

// Cac loai anh hop le (khop voi truong "type" trong VC_Attachments)
const ATTACHMENT_TYPES = {
  PICKUP_PHOTO: 'PICKUP_PHOTO',       // Anh kho nhat hang
  DELIVERY_PHOTO: 'DELIVERY_PHOTO',   // Anh giao hang
  SIGNED_BILL: 'SIGNED_BILL',         // Bill ky nhan
  EXCEPTION_PHOTO: 'EXCEPTION_PHOTO'  // Anh su co / tra hang
};

// ---- Auth singleton (Drive scope) -------------------------------------------

let driveApiPromise = null;

// Moi co so co thu muc Drive rieng. Thieu cau hinh => 503 BRANCH_NOT_CONFIGURED
// giong cac nguon du lieu khac, de UI hien dung thong bao "chua cau hinh".
function rootFolderIdFor(branch) {
  const isSaigon = branch === BRANCHES.SAIGON;
  const folderId = isSaigon ? CONFIG.VC_DRIVE_FOLDER_ID_SG : CONFIG.VC_DRIVE_FOLDER_ID;
  if (!folderId) {
    const err = new Error(`Cơ sở ${isSaigon ? BRANCHES.SAIGON : BRANCHES.HANOI} chưa được cấu hình thư mục Google Drive lưu ảnh chứng từ.`);
    err.code = 'BRANCH_NOT_CONFIGURED';
    err.statusCode = 503;
    err.detail = `[driveService] ${isSaigon ? 'VC_DRIVE_FOLDER_ID_SG' : 'VC_DRIVE_FOLDER_ID'} chua duoc dat trong .env`;
    throw err;
  }
  return folderId;
}

function getDriveApi() {
  if (!driveApiPromise) {
    const credentials = JSON.parse(CONFIG.GOOGLE_SERVICE_ACCOUNT_JSON);
    const auth = new google.auth.GoogleAuth({
      credentials,
      // drive.file: chi truy cap file do service account tao — an toan hon drive toan phan
      scopes: ['https://www.googleapis.com/auth/drive.file']
    });
    driveApiPromise = auth.getClient().then(authClient =>
      google.drive({ version: 'v3', auth: authClient })
    );
  }
  return driveApiPromise;
}

// ---- Cache folder ID --------------------------------------------------------
// Key: "<YYYYMMDD>" hoac "<YYYYMMDD>/<order_id>"
// Value: Google Drive folder ID (string)
const folderIdCache = new Map();

/**
 * Lay hoac tao thu muc con theo ten trong thu muc cha.
 * @param {object} drive   Drive API instance
 * @param {string} parentId  ID thu muc cha
 * @param {string} folderName  Ten thu muc can lay/tao
 * @returns {Promise<string>} ID cua thu muc
 */
async function getOrCreateFolder(drive, parentId, folderName) {
  const cacheKey = `${parentId}/${folderName}`;
  if (folderIdCache.has(cacheKey)) {
    return folderIdCache.get(cacheKey);
  }

  // Tim thu muc da ton tai
  const searchRes = await drive.files.list({
    q: [
      `'${parentId}' in parents`,
      `name = '${folderName}'`,
      `mimeType = 'application/vnd.google-apps.folder'`,
      `trashed = false`
    ].join(' and '),
    fields: 'files(id)',
    spaces: 'drive',
    pageSize: 1
  });

  if (searchRes.data.files && searchRes.data.files.length > 0) {
    const folderId = searchRes.data.files[0].id;
    folderIdCache.set(cacheKey, folderId);
    return folderId;
  }

  // Tao thu muc moi
  const createRes = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId]
    },
    fields: 'id'
  });
  const folderId = createRes.data.id;
  folderIdCache.set(cacheKey, folderId);
  return folderId;
}

// ---- Upload -----------------------------------------------------------------

/**
 * Upload mot file anh len Google Drive va tra ve metadata.
 *
 * @param {object} params
 * @param {string} params.orderId       Ma don hang (vd: "VC-20260817-0001")
 * @param {Date|string} [params.date]   Ngay de phan thu muc (mac dinh: hom nay)
 * @param {string} params.type          Loai anh (PICKUP_PHOTO | DELIVERY_PHOTO | SIGNED_BILL | EXCEPTION_PHOTO)
 * @param {Buffer} params.fileBuffer    Buffer nhi phan cua file anh
 * @param {string} params.mimeType      MIME type (vd: "image/jpeg", "image/png")
 * @param {string} params.originalName  Ten file goc (dung de tao ten file tren Drive)
 * @param {string} [params.branch]      Co so ('Hà Nội' | 'Sài Gòn') — quyet dinh thu muc Drive goc
 * @returns {Promise<{drive_file_id: string, drive_view_url: string, drive_thumbnail_url: string}>}
 */
async function uploadAttachment({ orderId, date, type, fileBuffer, mimeType, originalName, branch }) {
  if (!ATTACHMENT_TYPES[type]) {
    throw new Error(`[driveService] Loai anh khong hop le: "${type}". Phai la mot trong: ${Object.keys(ATTACHMENT_TYPES).join(', ')}`);
  }

  const rootFolderId = rootFolderIdFor(branch);
  const drive = await getDriveApi();

  // Xac dinh ten thu muc ngay (YYYYMMDD)
  const d = date ? new Date(date) : new Date();
  const pad = n => String(n).padStart(2, '0');
  const dateFolderName = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

  // 1. Lay/tao thu muc ngay: <root>/<YYYYMMDD>
  const dateFolderId = await getOrCreateFolder(drive, rootFolderId, dateFolderName);

  // 2. Lay/tao thu muc don hang: <root>/<YYYYMMDD>/<order_id>
  const orderFolderId = await getOrCreateFolder(drive, dateFolderId, orderId);

  // 3. Tao ten file: <type>_<timestamp>_<originalName>
  const timestamp = Date.now();
  const safeOriginalName = (originalName || 'photo').replace(/[^a-zA-Z0-9._-]/g, '_');
  const fileName = `${type}_${timestamp}_${safeOriginalName}`;

  // 4. Upload file
  const stream = Readable.from(fileBuffer);
  const uploadRes = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [orderFolderId]
    },
    media: {
      mimeType,
      body: stream
    },
    fields: 'id, webViewLink, thumbnailLink'
  });

  const { id, webViewLink, thumbnailLink } = uploadRes.data;

  return {
    drive_file_id: id,
    drive_view_url: webViewLink || `https://drive.google.com/file/d/${id}/view`,
    drive_thumbnail_url: thumbnailLink || null
  };
}

/**
 * Xoa file tren Google Drive (dung khi rollback loi upload).
 * @param {string} fileId
 * @returns {Promise<void>}
 */
async function deleteAttachment(fileId) {
  const drive = await getDriveApi();
  await drive.files.delete({ fileId });
}

/**
 * Invalidate folder cache (huu ich khi test hoac cau hinh lai folder).
 */
function clearFolderCache() {
  folderIdCache.clear();
}

module.exports = {
  ATTACHMENT_TYPES,
  uploadAttachment,
  deleteAttachment,
  clearFolderCache
};
