// ==========================================
// HR LEAVE REPOSITORY — CRUD cho 2 tab nhan su:
//   - "Yêu cầu nghỉ phép" (du lieu chinh)
//   - "_HR_TELEGRAM_LINKS" (lien ket chat_id Telegram <-> tai khoan web, an)
//
// Theo mau repository/service/routes cua Phase 1B (vcOrderRepository.js):
// SCHEMA anh xa header Tieng Viet <-> fieldKeys, doc/ghi qua hrSheetsClient.
// ==========================================
'use strict';

const CONFIG = require('../config');
// Moi ham nghiep vu nhan `branch` (tham so CUOI, mac dinh = Ha Noi) roi lay
// client cua dung co so — hai co so dung hai spreadsheet nhan su rieng.
const hrClient = require('../sheets/hrSheetsClient');
const { invalidateHrSheetCache } = hrClient;

// ---- Schema -------------------------------------------------------------

const LEAVE_SCHEMA = {
  sheet: () => CONFIG.HR_SHEET_LEAVE_REQUESTS,
  headers: [
    'Mã yêu cầu', 'Telegram chat_id', 'Telegram username', 'Tài khoản web',
    'Họ tên', 'Chức vụ', 'Lý do nghỉ', 'Loại yêu cầu',
    'Thời gian gửi', 'Thời gian bắt đầu', 'Thời gian kết thúc',
    'Tổng buổi nghỉ', 'Tổng ngày nghỉ quy đổi', 'Người bàn giao',
    'Trạng thái phê duyệt', 'Người phê duyệt', 'Thời điểm phê duyệt', 'Ghi chú/lý do từ chối',
    'Cờ nghỉ gấp', 'Cờ tự ý nghỉ', 'Thời gian tạo', 'Cập nhật lần cuối',
    'Tin nhắn'
  ],
  fieldKeys: [
    'request_id', 'telegram_chat_id', 'telegram_username', 'web_username',
    'ho_ten', 'chuc_vu', 'ly_do', 'loai_yeu_cau',
    'thoi_gian_gui', 'thoi_gian_bat_dau', 'thoi_gian_ket_thuc',
    'tong_buoi_nghi', 'tong_ngay_nghi', 'nguoi_ban_giao',
    'trang_thai', 'nguoi_duyet', 'thoi_diem_duyet', 'ghi_chu_duyet',
    'co_nghi_gap', 'co_tu_y_nghi', 'created_at', 'updated_at',
    'tin_nhan'
  ]
};

const LINK_SCHEMA = {
  sheet: () => CONFIG.HR_SHEET_TELEGRAM_LINKS,
  headers: [
    'Mã liên kết', 'Tài khoản web', 'Trạng thái', 'Telegram chat_id',
    'Telegram username', 'Thời gian tạo', 'Thời gian hết hạn', 'Thời gian liên kết',
    'User ID'
  ],
  fieldKeys: [
    'link_code', 'web_username', 'status', 'telegram_chat_id',
    'telegram_username', 'created_at', 'expires_at', 'linked_at',
    'user_id'
  ]
};

function escapeUserEnteredFormula(value) {
  return typeof value === 'string' && /^\s*[=+\-@]/.test(value) ? `'${value}` : value;
}

const LEAVE_TYPE = Object.freeze({
  REQUEST: 'Xin nghỉ phép',
  MANUAL_ABSENCE: 'Tự ý nghỉ (HR ghi nhận)'
});

const LEAVE_STATUS = Object.freeze({
  PENDING: 'Chưa duyệt',
  PROVISIONAL: 'Tạm duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối',
  VIOLATION: 'Vi phạm'
});

const LINK_STATUS = Object.freeze({
  UNUSED: 'CHUA_SU_DUNG',
  LINKED: 'DA_LIEN_KET',
  EXPIRED: 'HET_HAN',
  REPLACED: 'DA_THAY_THE'
});

// ---- Loi nghiep vu (statusCode < 500 duoc handleError() o routes tra thang) ---

class HrError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.statusCode = statusCode || 400;
    this.code = code || 'HR_ERROR';
  }
}

// ---- Utility chung: doc toan bo 1 tab thanh mang object theo fieldKeys -------

function rowToObject(row, fieldKeys) {
  const obj = {};
  fieldKeys.forEach((key, i) => { obj[key] = row[i] !== undefined ? row[i] : ''; });
  return obj;
}

function objectToRow(obj, fieldKeys) {
  return fieldKeys.map(key => {
    const v = obj[key];
    if (v === undefined || v === null) return '';
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    return v;
  });
}

function objectToLeaveRow(record) {
  const row = objectToRow(record, LEAVE_SCHEMA.fieldKeys);
  row[LEAVE_SCHEMA.fieldKeys.indexOf('tin_nhan')] = escapeUserEnteredFormula(record.tin_nhan);
  return row;
}

/**
 * Doc toan bo tab, tra ve { rows: [{...obj, _rowIndex}], headers }.
 * _rowIndex la vi tri dong 1-based tren Sheet that (2 = dong du lieu dau tien),
 * dung cho hrUpdateRow.
 */
async function readAll(schema, branch) {
  const values = await hrClient.getHrClient(branch).hrGetValues(schema.sheet());
  if (!values || values.length === 0) return [];
  const dataRows = values.slice(1);
  return dataRows
    .map((row, i) => ({ row, rowIndex: i + 2 }))
    .filter(({ row }) => row.some(cell => cell !== '' && cell !== undefined))
    .map(({ row, rowIndex }) => Object.assign(rowToObject(row, schema.fieldKeys), { _rowIndex: rowIndex }));
}

function nowIso() {
  return new Date().toISOString();
}

function generateRequestId() {
  const stamp = new Date();
  const y = stamp.getFullYear();
  const m = String(stamp.getMonth() + 1).padStart(2, '0');
  const d = String(stamp.getDate()).padStart(2, '0');
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `NP-${y}${m}${d}-${rand}`;
}

function generateLinkCode() {
  return String(Math.floor(Math.random() * 900000 + 100000)); // 6 chu so
}

function submissionDateKey(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function extractIsoDateFromBoundary(value) {
  if (!value) return null;
  const str = String(value).trim();
  const match = str.match(/(?:Sáng|Chiều)?\s*(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/i);
  if (match) {
    const day = String(match[1]).padStart(2, '0');
    const month = String(match[2]).padStart(2, '0');
    const year = match[3];
    return `${year}-${month}-${day}`;
  }
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }
  return null;
}

// ---- Leave requests -------------------------------------------------------

/**
 * @param {Object} filters { status, employee, from, to } — from/to dạng 'YYYY-MM-DD', lọc theo ngày xin nghỉ thực tế
 */
async function getLeaveRequests(filters, branch) {
  filters = filters || {};
  let items = await readAll(LEAVE_SCHEMA, branch);

  if (filters.status) {
    items = items.filter(item => item.trang_thai === filters.status);
  }
  if (filters.employee) {
    const needle = String(filters.employee).trim().toLowerCase();
    items = items.filter(item =>
      String(item.ho_ten || '').toLowerCase().includes(needle) ||
      String(item.web_username || '').toLowerCase().includes(needle)
    );
  }
  if (filters.from) {
    const fromDate = String(filters.from).slice(0, 10);
    items = items.filter(item => {
      const endLeaveDate = extractIsoDateFromBoundary(item.thoi_gian_ket_thuc) ||
                           extractIsoDateFromBoundary(item.thoi_gian_bat_dau);
      if (endLeaveDate) return endLeaveDate >= fromDate;
      return submissionDateKey(item.thoi_gian_gui) >= fromDate;
    });
  }
  if (filters.to) {
    const toDate = String(filters.to).slice(0, 10);
    items = items.filter(item => {
      const startLeaveDate = extractIsoDateFromBoundary(item.thoi_gian_bat_dau) ||
                             extractIsoDateFromBoundary(item.thoi_gian_ket_thuc);
      if (startLeaveDate) return startLeaveDate <= toDate;
      return submissionDateKey(item.thoi_gian_gui) <= toDate;
    });
  }

  // Moi nhat truoc
  items.sort((a, b) => String(b.thoi_gian_gui || b.created_at).localeCompare(String(a.thoi_gian_gui || a.created_at)));
  return items.map(stripRowIndex);
}

async function getLeaveRequestById(id, branch) {
  const items = await readAll(LEAVE_SCHEMA, branch);
  const found = items.find(item => item.request_id === id);
  return found ? stripRowIndex(found) : null;
}

function stripRowIndex(item) {
  const copy = Object.assign({}, item);
  delete copy._rowIndex;
  return copy;
}

/**
 * Tao 1 yeu cau nghi phep moi (dung boi bot Telegram hoac Quan ly nhap tay).
 */
async function createLeaveRequest(data, branch) {
  const ts = nowIso();
  const totalSessions = Number(data.tong_buoi_nghi);
  if (!Number.isInteger(totalSessions) || totalSessions <= 0) {
    throw new HrError('Tổng buổi nghỉ phải là số nguyên dương.', 400, 'INVALID_TOTAL_SESSIONS');
  }
  const record = {
    request_id: generateRequestId(),
    telegram_chat_id: data.telegram_chat_id || '',
    telegram_username: data.telegram_username || '',
    web_username: data.web_username || '',
    ho_ten: data.ho_ten || '',
    chuc_vu: data.chuc_vu || '',
    ly_do: data.ly_do || '',
    loai_yeu_cau: data.loai_yeu_cau || LEAVE_TYPE.REQUEST,
    thoi_gian_gui: data.thoi_gian_gui || ts,
    thoi_gian_bat_dau: data.thoi_gian_bat_dau || '',
    thoi_gian_ket_thuc: data.thoi_gian_ket_thuc || '',
    tong_buoi_nghi: totalSessions,
    tong_ngay_nghi: Number((totalSessions / 2).toFixed(2)),
    nguoi_ban_giao: data.nguoi_ban_giao || '',
    trang_thai: data.trang_thai || LEAVE_STATUS.PENDING,
    nguoi_duyet: data.nguoi_duyet || '',
    thoi_diem_duyet: data.thoi_diem_duyet || '',
    ghi_chu_duyet: data.ghi_chu_duyet || '',
    co_nghi_gap: !!data.co_nghi_gap,
    co_tu_y_nghi: !!data.co_tu_y_nghi,
    created_at: ts,
    updated_at: ts,
    tin_nhan: data.tin_nhan || ''
  };
  await hrClient.getHrClient(branch).hrAppendRow(LEAVE_SCHEMA.sheet(), objectToLeaveRow(record));
  return record;
}

/**
 * Doi trang thai phe duyet 1 yeu cau. Ghi nguoi duyet + thoi diem duyet.
 */
async function updateLeaveRequestStatus(id, { status, approver, note }, branch) {
  if (!Object.values(LEAVE_STATUS).includes(status)) {
    throw new HrError(`Trạng thái không hợp lệ: "${status}".`, 400, 'INVALID_STATUS');
  }
  const items = await readAll(LEAVE_SCHEMA, branch);
  const found = items.find(item => item.request_id === id);
  if (!found) {
    throw new HrError(`Không tìm thấy yêu cầu nghỉ phép "${id}".`, 404, 'LEAVE_REQUEST_NOT_FOUND');
  }

  const ts = nowIso();
  const updated = Object.assign({}, found, {
    trang_thai: status,
    nguoi_duyet: approver || found.nguoi_duyet,
    thoi_diem_duyet: ts,
    ghi_chu_duyet: note != null ? note : found.ghi_chu_duyet,
    updated_at: ts
  });
  const rowIndex = updated._rowIndex;
  delete updated._rowIndex;

  await hrClient.getHrClient(branch).hrUpdateRow(LEAVE_SCHEMA.sheet(), rowIndex, objectToLeaveRow(updated));
  return updated;
}

/**
 * Tinh so lan "nghi gap" theo tung nhan vien trong 1 thang (badge canh bao).
 * @param {string} month 'YYYY-MM', mac dinh la thang hien tai
 */
async function getUrgentFlagSummary(month, branch) {
  const targetMonth = month || nowIso().slice(0, 7);
  const items = await readAll(LEAVE_SCHEMA, branch);
  const counts = new Map(); // web_username -> { ho_ten, count }

  items.forEach(item => {
    if (!item.co_nghi_gap || String(item.co_nghi_gap).toUpperCase() !== 'TRUE') return;
    const dateMatch = String(item.thoi_gian_bat_dau || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!dateMatch) return;
    const leaveMonth = `${dateMatch[3]}-${String(dateMatch[2]).padStart(2, '0')}`;
    if (leaveMonth !== targetMonth) return;
    const key = item.web_username || item.ho_ten || 'unknown';
    const entry = counts.get(key) || { web_username: item.web_username, ho_ten: item.ho_ten, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  });

  return Array.from(counts.values()).map(entry => Object.assign(entry, {
    month: targetMonth,
    isOverThreshold: entry.count > CONFIG.HR_URGENT_FLAG_MONTHLY_THRESHOLD
  }));
}

// ---- Mã liên kết Telegram ----------------------------------------------------

async function createLinkCode(webUsername, branch) {
  if (!webUsername) throw new HrError('Thiếu tài khoản web để tạo mã liên kết.', 400, 'INVALID_REQUEST');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CONFIG.HR_LINK_CODE_TTL_MINUTES * 60 * 1000);
  const record = {
    link_code: generateLinkCode(),
    web_username: webUsername,
    status: LINK_STATUS.UNUSED,
    telegram_chat_id: '',
    telegram_username: '',
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    linked_at: ''
  };
  await hrClient.getHrClient(branch).hrAppendRow(LINK_SCHEMA.sheet(), objectToRow(record, LINK_SCHEMA.fieldKeys));
  return record;
}

/**
 * Nhan vien go /lienket <code> tren bot -> xac nhan ma va rang buoc chat_id.
 */
async function consumeLinkCode(code, { chatId, telegramUsername }, branch) {
  const items = await readAll(LINK_SCHEMA, branch);
  const found = items.find(item => String(item.link_code) === String(code));
  if (!found) {
    throw new HrError('Mã liên kết không tồn tại.', 404, 'LINK_CODE_NOT_FOUND');
  }
  if (found.status === LINK_STATUS.LINKED) {
    throw new HrError('Mã liên kết này đã được sử dụng.', 400, 'LINK_CODE_ALREADY_USED');
  }
  if (new Date(found.expires_at).getTime() < Date.now()) {
    throw new HrError('Mã liên kết đã hết hạn, vui lòng tạo mã mới trên web.', 400, 'LINK_CODE_EXPIRED');
  }

  const updated = Object.assign({}, found, {
    status: LINK_STATUS.LINKED,
    telegram_chat_id: String(chatId),
    telegram_username: telegramUsername || '',
    linked_at: nowIso()
  });
  const rowIndex = updated._rowIndex;
  delete updated._rowIndex;

  await hrClient.getHrClient(branch).hrUpdateRow(LINK_SCHEMA.sheet(), rowIndex, objectToRow(updated, LINK_SCHEMA.fieldKeys));
  return updated;
}

async function findLinkByChatId(chatId, branch) {
  const items = await readAll(LINK_SCHEMA, branch);
  const found = items.find(item =>
    item.status === LINK_STATUS.LINKED && String(item.telegram_chat_id) === String(chatId)
  );
  return found ? stripRowIndex(found) : null;
}

async function findLinkByWebUsername(webUsername, branch) {
  const items = await readAll(LINK_SCHEMA, branch);
  const found = items
    .filter(item => item.web_username === webUsername && item.status === LINK_STATUS.LINKED)
    .sort((a, b) => String(b.linked_at).localeCompare(String(a.linked_at)))[0];
  return found ? stripRowIndex(found) : null;
}

/**
 * Tra ve toan bo lien ket Telegram dang hoat dong (DA_LIEN_KET), dung de
 * broadcast thong bao (vd: co nhan vien xin nghi phep) toi tat ca chat_id.
 */
async function findAllLinkedAccounts(branch) {
  const items = await readAll(LINK_SCHEMA, branch);
  return items
    .filter(item => item.status === LINK_STATUS.LINKED && item.telegram_chat_id)
    .map(stripRowIndex);
}

async function upsertAutomaticLink({ userId, webUsername, chatId, telegramUsername = '' }, branch) {
  const normalizedUserId = String(userId || '').trim();
  const normalizedUsername = String(webUsername || '').trim();
  const normalizedChatId = String(chatId || '').trim();
  if (!normalizedUserId || !normalizedUsername || !normalizedChatId) {
    throw new HrError('Thiếu thông tin liên kết Telegram tự động.', 400, 'INVALID_TELEGRAM_LINK');
  }
  const items = await readAll(LINK_SCHEMA, branch);
  const chatLink = items.find(item => item.status === LINK_STATUS.LINKED && String(item.telegram_chat_id) === normalizedChatId);
  if (chatLink &&
      ((chatLink.user_id && String(chatLink.user_id) !== normalizedUserId) ||
       (!chatLink.user_id && chatLink.web_username && chatLink.web_username !== normalizedUsername))) {
    throw new HrError('Telegram ID đã được liên kết với tài khoản khác.', 409, 'TELEGRAM_LINK_CONFLICT');
  }

  const accountLinks = items.filter(item => item.status === LINK_STATUS.LINKED && (
    String(item.user_id || '') === normalizedUserId ||
    (!item.user_id && item.web_username === normalizedUsername)
  ));
  const sameLink = accountLinks.find(item => String(item.telegram_chat_id) === normalizedChatId) || chatLink;
  if (sameLink) {
    const updated = {
      ...sameLink,
      web_username: normalizedUsername,
      telegram_username: telegramUsername || sameLink.telegram_username || '',
      user_id: normalizedUserId,
      linked_at: sameLink.linked_at || nowIso()
    };
    const rowIndex = updated._rowIndex;
    delete updated._rowIndex;
    await hrClient.getHrClient(branch).hrUpdateRow(LINK_SCHEMA.sheet(), rowIndex, objectToRow(updated, LINK_SCHEMA.fieldKeys));
    return updated;
  }

  for (const oldLink of accountLinks) {
    const replaced = { ...oldLink, status: LINK_STATUS.REPLACED };
    const rowIndex = replaced._rowIndex;
    delete replaced._rowIndex;
    await hrClient.getHrClient(branch).hrUpdateRow(LINK_SCHEMA.sheet(), rowIndex, objectToRow(replaced, LINK_SCHEMA.fieldKeys));
  }

  const linkedAt = nowIso();
  const record = {
    link_code: '',
    web_username: normalizedUsername,
    status: LINK_STATUS.LINKED,
    telegram_chat_id: normalizedChatId,
    telegram_username: telegramUsername,
    created_at: linkedAt,
    expires_at: '',
    linked_at: linkedAt,
    user_id: normalizedUserId
  };
  await hrClient.getHrClient(branch).hrAppendRow(LINK_SCHEMA.sheet(), objectToRow(record, LINK_SCHEMA.fieldKeys));
  return record;
}

module.exports = {
  LEAVE_TYPE,
  LEAVE_STATUS,
  LINK_STATUS,
  LEAVE_SCHEMA_HEADERS: LEAVE_SCHEMA.headers,
  LEAVE_SCHEMA_FIELD_KEYS: LEAVE_SCHEMA.fieldKeys,
  LINK_SCHEMA_HEADERS: LINK_SCHEMA.headers,
  LINK_SCHEMA_FIELD_KEYS: LINK_SCHEMA.fieldKeys,
  HrError,
  getLeaveRequests,
  getLeaveRequestById,
  createLeaveRequest,
  updateLeaveRequestStatus,
  getUrgentFlagSummary,
  createLinkCode,
  consumeLinkCode,
  findLinkByChatId,
  findLinkByWebUsername,
  findAllLinkedAccounts,
  upsertAutomaticLink
};
