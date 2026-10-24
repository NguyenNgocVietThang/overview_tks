'use strict';

// Test dung chung: PGlite trong bo nho + migration 0092, tiem vao notificationRepository.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PGlite } = require('@electric-sql/pglite');
const repo = require('../notificationRepository');

const MIGRATION = path.join(__dirname, '..', '..', 'db', 'migrations', '0092_notifications.sql');

async function useNotificationTestPool() {
  const db = new PGlite();
  await db.exec(fs.readFileSync(MIGRATION, 'utf8'));
  repo.setPool(db);

  return {
    db,
    async close() { repo.setPool(null); await db.close(); },
    reset: () => db.exec('TRUNCATE notifications'),
    /** Xoa sach roi chen dung cac dong cho san (thu tu mang = thu tu chen). */
    async seed(notifications) {
      await db.exec('TRUNCATE notifications');
      for (const n of notifications) {
        await db.query(
          `INSERT INTO notifications (id, recipient_user_id, type, title, message, related_type, related_id, is_read, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [n.id || crypto.randomUUID(), n.recipientUserId, n.type, n.title || '', n.message || '',
            n.relatedType || null, n.relatedId || null, n.isRead === true, n.createdAt || new Date().toISOString()]
        );
      }
    }
  };
}

module.exports = { useNotificationTestPool };
