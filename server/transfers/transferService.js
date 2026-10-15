'use strict';
// May trang thai yeu cau chuyen tien + kiem quyen. Routes chi goi vao day.
//   Ke toan (transfers.review): sua khi CHO_DUYET, duyet, bo duyet, huy (co ly do).
//   transfers.markPaid (mac dinh Quan ly): quet VietQR va bam "Đã chuyển" cho dong DA_DUYET.
//   Admin he thong (hardcoded): thu hoi "Đã chuyển" (bat buoc ly do).
//   Sale: tao/huy tu bot; tren web chi xem dong cua minh (transfers.own).

const QRCode = require('qrcode');
const { hasFeature } = require('../auth/featureRegistry');
const { isHardcodedAdmin } = require('../auth/userRepository');
const localUserStore = require('../auth/localUserStore');
const notificationRepository = require('../notifications/notificationRepository');
const { createRepository } = require('./transferRepository');
const { broadcastTransferEvent } = require('./transferEvents');
const { buildPayload, toAddInfo } = require('./vietqr');
const v = require('./transferValidation');

const OPENABLE_BY_OTHERS = Object.freeze(['DA_DUYET', 'DA_CHUYEN']);

function httpError(statusCode, code, message, extra = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function isAdmin(user) {
  return !!user && (isHardcodedAdmin(user.email) || isHardcodedAdmin(user.username));
}

function actorName(user) {
  return String((user && (user.hoTen || user.username)) || '').trim();
}

function isOwnRequest(user, request) {
  const telegramId = String((user && user.telegramId) || '').trim();
  return !!telegramId && telegramId === request.saleTelegramId && hasFeature(user, 'transfers.own');
}

const can = Object.freeze({
  review: user => hasFeature(user, 'transfers.review'),
  markPaid: user => hasFeature(user, 'transfers.markPaid'),
  viewAll: user => hasFeature(user, 'transfers.view'),
  // Chi Ke toan mo duoc dong chua duyet; nguoi khac chi mo dong Da duyet / Da chuyen.
  open: (user, request) => hasFeature(user, 'transfers.review')
    || (OPENABLE_BY_OTHERS.includes(request.status)
      && (hasFeature(user, 'transfers.view', 'transfers.markPaid') || isOwnRequest(user, request)))
});

function createNotifier({
  getUsers = localUserStore.getAllUsers,
  notifyUsers = notificationRepository.createNotificationForUsers,
  logger = console
} = {}) {
  async function recipients(...features) {
    const users = await getUsers();
    return users
      .filter(u => u && !u.isDeleted && u.trangThai !== localUserStore.LOCKED_STATUS && hasFeature(u, ...features))
      .map(u => u.id);
  }
  async function send(features, payload) {
    try {
      const ids = await recipients(...features);
      if (ids.length) await notifyUsers(ids, { relatedType: 'transfer_request', ...payload });
    } catch (error) {
      logger.error('[transfers] Không gửi được thông báo:', error.message);
    }
  }
  const money = n => `${Number(n).toLocaleString('vi-VN')} đ`;
  return {
    created: r => send(['transfers.review'], {
      type: 'TRANSFER_CREATED',
      title: `Yêu cầu chuyển tiền mới ${r.requestCode}`,
      message: `${r.saleName}: ${r.customerName} — ${money(r.amountVnd)}`,
      relatedId: String(r.id)
    }),
    approved: r => send(['transfers.markPaid'], {
      type: 'TRANSFER_APPROVED',
      title: `Đã duyệt ${r.requestCode} — chờ chuyển`,
      message: `${r.customerName} — ${money(r.amountVnd)}`,
      relatedId: String(r.id)
    }),
    canceledAfterApproval: r => send(['transfers.markPaid', 'transfers.review'], {
      type: 'TRANSFER_CANCELED_URGENT',
      title: `⚠️ Sale đã hủy ${r.requestCode} (đã duyệt) — KHÔNG chuyển`,
      message: `${r.customerName} — ${money(r.amountVnd)}`,
      relatedId: String(r.id)
    })
  };
}

function createTransferService({
  repository = createRepository(),
  notifier = createNotifier(),
  broadcast = broadcastTransferEvent,
  clock = () => new Date()
} = {}) {
  async function loadOr404(id) {
    const request = await repository.getById(id);
    if (!request) throw httpError(404, 'NOT_FOUND', 'Không tìm thấy yêu cầu.');
    return request;
  }

  function requireFeature(ok, message = 'Tài khoản không có quyền thực hiện thao tác này.') {
    if (!ok) throw httpError(403, 'FORBIDDEN', message);
  }

  function parseVersion(value) {
    const version = Number(value);
    if (!Number.isSafeInteger(version) || version < 1) throw v.invalid('expectedVersion', 'Thiếu phiên bản dữ liệu (expectedVersion).');
    return version;
  }

  async function bankLabel(bin) {
    if (!bin) return '(chưa xác định)';
    const bank = await repository.getBank(bin);
    return bank ? bank.shortName : bin;
  }

  async function requireActiveBank(bin) {
    const bank = bin ? await repository.getBank(bin) : null;
    if (!bank || !bank.isActive) throw httpError(400, 'BANK_REQUIRED', 'Chọn ngân hàng hợp lệ trước khi duyệt.');
    return bank;
  }

  function finish(type, result) {
    broadcast(type, result.after);
    return result.after;
  }

  // ---------------------------------------------------------------- bot
  async function createFromBot(body) {
    if (!body || typeof body !== 'object') throw v.invalid(null, 'Dữ liệu không hợp lệ.');
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
    if (idempotencyKey.length < 8 || idempotencyKey.length > 200) throw v.invalid('idempotencyKey', 'Thiếu khóa idempotency.');
    const createdAt = new Date(body.createdAt);
    if (Number.isNaN(createdAt.getTime())) throw v.invalid('createdAt', 'Thời điểm tạo không hợp lệ.');
    const source = body.source === 'cutover' ? 'cutover' : 'telegram';
    const inputKind = ['text', 'qr_image', 'manual'].includes(body.inputKind) ? body.inputKind : 'text';
    const sale = body.sale || {};
    const fields = v.normalizePatch(body, v.TRANSFER_FIELDS);
    for (const key of ['customerName', 'amountVnd', 'bankAccount', 'accountHolder']) {
      if (!Object.hasOwn(fields, key)) throw v.invalid(key, `Thiếu ${v.FIELD_LABELS[key]}.`);
    }
    // BIN la khong biet thi bo, giu ten ngan hang sale go de ke toan chon lai.
    let bankBin = fields.bankBin || null;
    if (bankBin) {
      const bank = await repository.getBank(bankBin);
      if (!bank || !bank.isActive) bankBin = null;
    }
    const qrPayload = typeof body.qrPayload === 'string' && body.qrPayload.length <= 512 ? body.qrPayload : null;
    const fieldSources = {};
    if (body.fieldSources && typeof body.fieldSources === 'object' && !Array.isArray(body.fieldSources)) {
      for (const [key, value] of Object.entries(body.fieldSources)) {
        if (Object.hasOwn(v.FIELD_LABELS, key) && typeof value === 'string' && value.length <= 30) fieldSources[key] = value;
      }
    }
    let canceled = null;
    if (body.canceled) {
      const at = new Date(body.canceled.at);
      if (Number.isNaN(at.getTime())) throw v.invalid('canceled', 'Thời điểm hủy không hợp lệ.');
      canceled = { at, reason: v.reason(body.canceled.reason, { required: false }) || null };
    }
    const input = {
      requestCode: v.requestCode(body.requestCode),
      idempotencyKey,
      source,
      inputKind,
      saleTelegramId: v.telegramId(sale.telegramId),
      saleNameBot: v.text(sale.name, 'saleName', { max: 100, required: false }),
      customerName: fields.customerName,
      amountVnd: fields.amountVnd,
      bankAccount: fields.bankAccount,
      accountType: fields.accountType || 'ACCOUNT',
      accountHolder: fields.accountHolder,
      bankBin,
      bankNameRaw: v.text(body.bankNameRaw, 'bankNameRaw', { max: 150, required: false }),
      note: fields.note || '',
      accountantNote: v.text(body.accountantNote, 'accountantNote', { max: 500, required: false }),
      importNote: v.text(body.importNote, 'importNote', { max: 300, required: false }) || null,
      qrPayload,
      fieldSources,
      createdAt,
      canceled
    };
    const result = await repository.insertFromBot(input);
    if (!result.duplicate) {
      broadcast('CREATED', result.request);
      if (result.request.status === 'CHO_DUYET') await notifier.created(result.request);
    }
    return result;
  }

  async function cancelFromBot(code, body) {
    const request = await repository.getByCode(v.requestCode(code));
    if (!request) throw httpError(404, 'NOT_FOUND', 'Không tìm thấy yêu cầu.');
    const telegramId = v.telegramId(body && body.telegramId);
    if (request.saleTelegramId !== telegramId) throw httpError(403, 'NOT_OWNER', 'Yêu cầu không phải của bạn.');
    const reason = v.reason(body && body.reason, { required: false }) || null;
    const alreadyPaid = r => httpError(409, 'ALREADY_PAID', 'Yêu cầu đã được chuyển tiền.', { paidAt: r.paidAt, paidByName: r.paidByName, request: r });
    if (request.status === 'DA_HUY') return request;
    if (request.status === 'DA_CHUYEN') throw alreadyPaid(request);
    let result;
    try {
      result = await repository.updateWithEvent(request.id, {
        allowedStatuses: ['CHO_DUYET', 'DA_DUYET'],
        set: { status: 'DA_HUY', canceledAt: clock(), canceledByType: 'SALE', canceledByName: request.saleName, cancelReason: reason },
        event: { type: 'CANCELED', actorType: 'SALE', actorName: request.saleName, reason }
      });
    } catch (error) {
      if (error.code === 'INVALID_STATE' && error.current.status === 'DA_HUY') return error.current;
      if (error.code === 'INVALID_STATE' && error.current.status === 'DA_CHUYEN') throw alreadyPaid(error.current);
      throw error;
    }
    if (result.before.status === 'DA_DUYET') await notifier.canceledAfterApproval(result.after);
    return finish('CANCELED', result);
  }

  // ---------------------------------------------------------------- web
  async function getForUser(user, id) {
    const request = await loadOr404(id);
    requireFeature(can.open(user, request), 'Chỉ mở được yêu cầu đã duyệt.');
    const events = await repository.listEvents(request.id);
    return {
      request,
      events,
      allowed: {
        edit: can.review(user) && request.status === 'CHO_DUYET',
        editAccountantNote: can.review(user) && ['CHO_DUYET', 'DA_DUYET'].includes(request.status),
        approve: can.review(user) && request.status === 'CHO_DUYET',
        unapprove: can.review(user) && request.status === 'DA_DUYET',
        cancel: can.review(user) && ['CHO_DUYET', 'DA_DUYET'].includes(request.status),
        markPaid: can.markPaid(user) && request.status === 'DA_DUYET',
        viewQr: (can.markPaid(user) || can.review(user)) && request.status === 'DA_DUYET',
        revertPaid: isAdmin(user) && request.status === 'DA_CHUYEN'
      }
    };
  }

  async function listForUser(user, filters) {
    const viewAll = can.viewAll(user) || can.review(user);
    let saleTelegramId = null;
    if (!viewAll) {
      requireFeature(hasFeature(user, 'transfers.own'));
      saleTelegramId = String(user.telegramId || '').trim();
      if (!saleTelegramId) return { requests: [], total: 0, counts: { CHO_DUYET: 0, DA_DUYET: 0, DA_CHUYEN: 0, DA_HUY: 0 }, page: 1, pageSize: 100, linked: false };
    }
    if (filters.status && !v.STATUSES.includes(filters.status)) throw v.invalid('status', 'Trạng thái không hợp lệ.');
    for (const key of ['from', 'to']) {
      if (filters[key] && !/^\d{4}-\d{2}-\d{2}$/.test(filters[key])) throw v.invalid(key, 'Ngày không hợp lệ.');
    }
    const result = await repository.list({ ...filters, q: String(filters.q || '').trim().slice(0, 100), saleTelegramId });
    // Dong nao nguoi xem mo duoc (giao dien dung de bat/tat click; server van kiem lai).
    for (const r of result.requests) r.canOpen = can.open(user, r);
    return { ...result, linked: viewAll || !!saleTelegramId };
  }

  async function edit(user, id, body) {
    requireFeature(can.review(user));
    const expectedVersion = parseVersion(body && body.expectedVersion);
    const patch = v.normalizePatch(body, [...v.TRANSFER_FIELDS, 'accountantNote']);
    const current = await loadOr404(id);
    if (Object.hasOwn(patch, 'bankBin') && patch.bankBin) await requireActiveBank(patch.bankBin);
    const changes = [];
    for (const [field, value] of Object.entries(patch)) {
      if (value === current[field]) continue;
      const display = field === 'bankBin' ? bankLabel : x => x;
      changes.push({ field, label: v.FIELD_LABELS[field], before: await display(current[field]), after: await display(value) });
    }
    if (!changes.length) return current;
    const touchesTransfer = changes.some(c => c.field !== 'accountantNote');
    const set = Object.fromEntries(changes.map(c => [c.field, patch[c.field]]));
    const result = await repository.updateWithEvent(current.id, {
      expectedVersion,
      allowedStatuses: touchesTransfer ? ['CHO_DUYET'] : ['CHO_DUYET', 'DA_DUYET'],
      set,
      event: { type: 'EDITED', actorType: 'ACCOUNTANT', actorUserId: user.id, actorName: actorName(user), changes }
    });
    return finish('EDITED', result);
  }

  async function approve(user, id, body) {
    requireFeature(can.review(user));
    const expectedVersion = parseVersion(body && body.expectedVersion);
    const current = await loadOr404(id);
    await requireActiveBank(current.bankBin);
    const result = await repository.updateWithEvent(current.id, {
      expectedVersion,
      allowedStatuses: ['CHO_DUYET'],
      set: { status: 'DA_DUYET', approvedAt: clock(), approvedByUserId: user.id, approvedByName: actorName(user) },
      event: { type: 'APPROVED', actorType: 'ACCOUNTANT', actorUserId: user.id, actorName: actorName(user) }
    });
    await notifier.approved(result.after);
    return finish('APPROVED', result);
  }

  async function unapprove(user, id, body) {
    requireFeature(can.review(user));
    const expectedVersion = parseVersion(body && body.expectedVersion);
    const reason = v.reason(body && body.reason, { required: false }) || null;
    const result = await repository.updateWithEvent(Number(id), {
      expectedVersion,
      allowedStatuses: ['DA_DUYET'],
      set: { status: 'CHO_DUYET', approvedAt: null, approvedByUserId: null, approvedByName: null },
      event: { type: 'UNAPPROVED', actorType: 'ACCOUNTANT', actorUserId: user.id, actorName: actorName(user), reason }
    });
    return finish('UNAPPROVED', result);
  }

  async function cancel(user, id, body) {
    requireFeature(can.review(user));
    const expectedVersion = parseVersion(body && body.expectedVersion);
    const reason = v.reason(body && body.reason, { required: true });
    const result = await repository.updateWithEvent(Number(id), {
      expectedVersion,
      allowedStatuses: ['CHO_DUYET', 'DA_DUYET'],
      set: { status: 'DA_HUY', canceledAt: clock(), canceledByType: 'ACCOUNTANT', canceledByUserId: user.id, canceledByName: actorName(user), cancelReason: reason },
      event: { type: 'CANCELED', actorType: 'ACCOUNTANT', actorUserId: user.id, actorName: actorName(user), reason }
    });
    return finish('CANCELED', result);
  }

  async function markPaid(user, id, body) {
    requireFeature(can.markPaid(user));
    const expectedVersion = parseVersion(body && body.expectedVersion);
    let result;
    try {
      result = await repository.updateWithEvent(Number(id), {
        expectedVersion,
        allowedStatuses: ['DA_DUYET'],
        set: { status: 'DA_CHUYEN', paidAt: clock(), paidByUserId: user.id, paidByName: actorName(user) },
        event: { type: 'PAID', actorType: isAdmin(user) ? 'ADMIN' : 'MANAGER', actorUserId: user.id, actorName: actorName(user) }
      });
    } catch (error) {
      const current = error.current;
      if (current && current.status === 'DA_HUY') {
        throw httpError(409, 'TRANSFER_CANCELED', 'Sale vừa hủy yêu cầu — KHÔNG chuyển. Nếu đã chuyển, hãy liên hệ sale/khách để xử lý.', { request: current });
      }
      if (current && current.status === 'DA_CHUYEN') {
        throw httpError(409, 'ALREADY_PAID', `Yêu cầu đã được ${current.paidByName || 'người khác'} đánh dấu đã chuyển.`, { request: current });
      }
      throw error;
    }
    return finish('PAID', result);
  }

  async function revertPaid(user, id, body) {
    requireFeature(isAdmin(user), 'Chỉ quản trị viên hệ thống được thu hồi trạng thái Đã chuyển.');
    const expectedVersion = parseVersion(body && body.expectedVersion);
    const reason = v.reason(body && body.reason, { required: true });
    const result = await repository.updateWithEvent(Number(id), {
      expectedVersion,
      allowedStatuses: ['DA_CHUYEN'],
      set: { status: 'DA_DUYET', paidAt: null, paidByUserId: null, paidByName: null },
      event: { type: 'PAID_REVERTED', actorType: 'ADMIN', actorUserId: user.id, actorName: actorName(user), reason }
    });
    return finish('PAID_REVERTED', result);
  }

  async function vietQr(user, id) {
    const request = await loadOr404(id);
    requireFeature(can.markPaid(user) || can.review(user));
    if (request.status !== 'DA_DUYET') throw httpError(409, 'INVALID_STATE', 'Chỉ tạo mã QR cho yêu cầu đã duyệt.');
    let payload;
    try {
      payload = buildPayload({
        bin: request.bankBin,
        account: request.bankAccount,
        accountType: request.accountType,
        amount: request.amountVnd,
        addInfo: request.customerName
      });
    } catch (error) {
      throw httpError(422, 'QR_UNSUPPORTED', `Không tạo được mã QR: ${error.message.replace(/^VietQR: /, '')}. Chuyển tay theo thông tin.`);
    }
    const svg = await QRCode.toString(payload, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 });
    return { payload, svg, addInfo: toAddInfo(request.customerName), amountVnd: request.amountVnd, version: request.version };
  }

  async function lookupSale(telegramId) {
    const id = v.telegramId(telegramId);
    const users = await localUserStore.getAllUsers();
    const user = users.find(u => u && !u.isDeleted && String(u.telegramId || '').trim() === id);
    return user ? { linked: true, name: user.hoTen || user.username || '' } : { linked: false, name: '' };
  }

  return {
    createFromBot, cancelFromBot, listUndeliveredEvents: limit => repository.listUndeliveredEvents(limit),
    ackEvents: ids => repository.ackEvents(ids), lookupSale,
    listForUser, getForUser, edit, approve, unapprove, cancel, markPaid, revertPaid, vietQr,
    listBanks: () => repository.listBanks()
  };
}

module.exports = { createTransferService, createNotifier, can, isAdmin, httpError };
