// ==========================================
// HR RULE DOCUMENT NOTIFIER — bao len chuong thong bao khi Quan ly them / go /
// khoi phuc tai lieu "Quy dinh cong ty". Nguoi nhan = moi tai khoan co quyen
// `hr.rules` (tru nguoi thao tac; tai khoan Khach khong mo duoc trang HR).
// Best-effort: KHONG BAO GIO throw — loi thong bao khong duoc lam hong thao tac chinh.
// ==========================================
'use strict';

const localUserStore = require('../auth/localUserStore');
const notificationRepository = require('../notifications/notificationRepository');
const { hasFeature } = require('../auth/featureRegistry');

const TYPE_ADDED = 'rule_document_added';
const TYPE_REMOVED = 'rule_document_removed';
const RELATED_TYPE = 'ruleDocument';

function createHrRuleDocumentNotifier(options = {}) {
  const userStore = options.userStore || localUserStore;
  const notificationRepo = options.notificationRepo || notificationRepository;
  const canView = options.hasFeature || hasFeature;

  function actorName(actor) {
    return (actor && (actor.hoTen || actor.username)) || 'Quản lý';
  }

  async function send(actor, payload) {
    try {
      const actorId = actor && actor.id != null ? String(actor.id) : null;
      const users = await userStore.getAllUsers();
      const recipientIds = users
        .filter(u => u && u.id != null && String(u.id) !== actorId && canView(u, 'hr.rules'))
        .map(u => u.id);
      if (!recipientIds.length) return;
      await notificationRepo.createNotificationForUsers(recipientIds, {
        relatedType: RELATED_TYPE,
        ...payload
      });
    } catch (err) {
      console.error('[HR Rules] Lỗi báo thông báo tài liệu quy định:', err.message);
    }
  }

  function documentAdded(actor, doc) {
    return send(actor, {
      type: TYPE_ADDED,
      title: 'Có tài liệu quy định mới',
      message: `${actorName(actor)} vừa thêm tài liệu "${doc.title}" vào Quy định công ty.`,
      relatedId: doc.slug || null
    });
  }

  function documentRemoved(actor, doc) {
    return send(actor, {
      type: TYPE_REMOVED,
      title: 'Tài liệu quy định đã được gỡ',
      message: `${actorName(actor)} vừa gỡ tài liệu "${doc.title}" khỏi Quy định công ty.`,
      relatedId: null
    });
  }

  function defaultsRestored(actor, docs) {
    const names = (docs || []).map(d => `"${d.title}"`).join(', ');
    return send(actor, {
      type: TYPE_ADDED,
      title: 'Có tài liệu quy định mới',
      message: `${actorName(actor)} vừa khôi phục tài liệu ${names} trong Quy định công ty.`,
      relatedId: docs && docs[0] ? docs[0].slug || null : null
    });
  }

  return { documentAdded, documentRemoved, defaultsRestored };
}

const defaultNotifier = createHrRuleDocumentNotifier();

module.exports = {
  TYPE_ADDED,
  TYPE_REMOVED,
  RELATED_TYPE,
  createHrRuleDocumentNotifier,
  documentAdded: (...args) => defaultNotifier.documentAdded(...args),
  documentRemoved: (...args) => defaultNotifier.documentRemoved(...args),
  defaultsRestored: (...args) => defaultNotifier.defaultsRestored(...args)
};
