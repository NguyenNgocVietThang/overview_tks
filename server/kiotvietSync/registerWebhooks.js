'use strict';

// Script van hanh: dang ky Webhook that voi KiotViet cho ca 2 gian hang, tro
// ve endpoint /api/kiotviet/webhook cua server nay. PORT LAI logic da chay
// that, on dinh nhieu thang trong src-dashboard/kiotviet/WebhookAdmin.gs
// (registerWebhookProgrammatically/reconcileKiotVietAutoSyncWebhooks_) -
// cung 1 endpoint dang ky (POST https://public.kiotapi.com/webhooks), cung
// schema body ({Webhook:{Type,Url,IsActive,Description}}), goi RIENG 1 lan
// cho MOI loai su kien (KiotViet khong nhan mang nhieu Type trong 1 lan goi).
//
// Khac voi ban Apps Script (1 webhook dung chung cho ca 2 gian hang qua cung
// 1 deployment Apps Script rieng biet moi ben) - server nay dung CHUNG 1
// endpoint public cho ca 2 co so, nen can them ?branch=hanoi|saigon vao URL
// dang ky de kiotvietWebhookRoutes.js phan biet duoc gian hang nao gui toi.
//
// Chay thu cong (mac dinh DRY-RUN, chi in ke hoach - khong goi API that):
//   node kiotvietSync/registerWebhooks.js --baseUrl=https://<domain-production>
// Them --execute de dang ky that. Them --list de chi xem danh sach webhook
// hien co tren KiotViet (khong dang ky/xoa gi).

if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (e) { /* dotenv là tùy chọn trong môi trường production */ }
}

// Giong het KIOTVIET_AUTO_SYNC_EVENT_TYPES trong WebhookAdmin.gs - da xac
// nhan dang ky thanh cong that voi KiotViet, khong doan lai danh sach.
const EVENT_TYPES = Object.freeze([
  'product.update', 'product.delete', 'stock.update',
  'customer.update', 'customer.delete',
  'invoice.update', 'order.update',
  'category.update', 'category.delete'
]);
const DESCRIPTION_PREFIX = 'Postgres sync - ';
const WEBHOOKS_URL = 'https://public.kiotapi.com/webhooks';

function buildWebhookUrl(baseUrl, secret, branch, eventType) {
  const url = new URL('/api/kiotviet/webhook', baseUrl);
  url.searchParams.set('secret', secret);
  url.searchParams.set('branch', branch);
  url.searchParams.set('eventType', eventType);
  return url.toString();
}

async function listWebhooks(kiotVietClient) {
  const token = await kiotVietClient.getAccessToken();
  return kiotVietClient.fetchJsonWithRetry(`${WEBHOOKS_URL}?pageSize=100`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  }).then((result) => (Array.isArray(result.data) ? result.data : []));
}

async function registerWebhook(kiotVietClient, { url, eventType }) {
  const token = await kiotVietClient.getAccessToken();
  return kiotVietClient.fetchJsonWithRetry(WEBHOOKS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      Webhook: { Type: eventType, Url: url, IsActive: true, Description: DESCRIPTION_PREFIX + eventType }
    })
  });
}

async function deleteWebhook(kiotVietClient, id) {
  const token = await kiotVietClient.getAccessToken();
  return kiotVietClient.fetchJsonWithRetry(`${WEBHOOKS_URL}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  }).catch((error) => {
    // DELETE thanh cong thuong tra body rong - fetchJsonWithRetry that bai
    // parse JSON rong se nem loi "Unexpected end of JSON input"; coi la thanh
    // cong neu khong phai loi HTTP that (co .status).
    if (error.status) throw error;
  });
}

function parseArgs(argv) {
  const args = { branch: 'all', execute: false, list: false };
  for (const arg of argv) {
    if (arg === '--execute') { args.execute = true; continue; }
    if (arg === '--list') { args.list = true; continue; }
    const [key, value] = arg.replace(/^--/, '').split('=');
    if (key === 'branch') args.branch = value;
    if (key === 'baseUrl') args.baseUrl = value;
  }
  return args;
}

async function main() {
  const CONFIG = require('../config');
  const { getConfiguredBranches } = require('./config');
  const { createKiotVietClient } = require('../kiotviet/kiotVietApiClient');

  const args = parseArgs(process.argv.slice(2));
  const configuredBranches = getConfiguredBranches();
  const branches = args.branch === 'all' ? configuredBranches : configuredBranches.filter((b) => b.branch === args.branch);
  if (!branches.length) {
    console.error('[registerWebhooks] Khong co co so nao du cau hinh credentials.');
    process.exitCode = 1;
    return;
  }

  if (args.list) {
    for (const branchConfig of branches) {
      const client = createKiotVietClient(branchConfig);
      const existing = await listWebhooks(client);
      console.log(`[registerWebhooks] ${branchConfig.branch}: ${existing.length} webhook hien co`);
      for (const wh of existing) console.log(`  id=${wh.id} type=${wh.type} url=${wh.url} isActive=${wh.isActive}`);
    }
    return;
  }

  if (!args.baseUrl) {
    console.error('[registerWebhooks] Thieu --baseUrl=https://<domain-production> (URL cong khai cua server sau khi deploy).');
    process.exitCode = 1;
    return;
  }
  if (!CONFIG.KIOTVIET_WEBHOOK_SECRET) {
    console.error('[registerWebhooks] Thieu KIOTVIET_WEBHOOK_SECRET trong .env - dat truoc khi dang ky (fail-safe, tranh dang ky webhook khong xac thuc duoc).');
    process.exitCode = 1;
    return;
  }

  const plan = [];
  for (const branchConfig of branches) {
    for (const eventType of EVENT_TYPES) {
      plan.push({
        branch: branchConfig.branch,
        eventType,
        url: buildWebhookUrl(args.baseUrl, CONFIG.KIOTVIET_WEBHOOK_SECRET, branchConfig.branch, eventType)
      });
    }
  }

  console.log(`[registerWebhooks] Ke hoach: ${plan.length} webhook (${branches.length} co so x ${EVENT_TYPES.length} loai su kien).`);
  if (!args.execute) {
    for (const item of plan) console.log(`  DRY-RUN ${item.branch}/${item.eventType} -> ${item.url}`);
    console.log('[registerWebhooks] DRY-RUN (mac dinh) - chua goi API KiotViet. Them --execute de dang ky that.');
    return;
  }

  let successCount = 0;
  let failCount = 0;
  for (const branchConfig of branches) {
    const client = createKiotVietClient(branchConfig);
    const existing = await listWebhooks(client);

    // Xoa webhook cu cung tien to mo ta nhung URL khong con khop (vd doi
    // domain/secret) - giu nguyen webhook cua he thong khac (vd Apps Script
    // cu, tien to "Auto-sync Google Sheets - ").
    for (const wh of existing) {
      const description = String(wh.description || wh.Description || '');
      if (description.indexOf(DESCRIPTION_PREFIX) !== 0) continue;
      const stillDesired = plan.some((item) => item.branch === branchConfig.branch && item.eventType === wh.type && item.url === wh.url && wh.isActive === true);
      if (stillDesired) continue;
      const id = wh.id || wh.Id;
      if (!id) continue;
      await deleteWebhook(client, id);
      console.log(`[registerWebhooks] ${branchConfig.branch}: da xoa webhook cu/le id=${id} type=${wh.type}`);
    }

    for (const item of plan.filter((p) => p.branch === branchConfig.branch)) {
      const alreadyActive = existing.some((wh) => wh.type === item.eventType && wh.url === item.url && wh.isActive === true);
      if (alreadyActive) { successCount++; continue; }
      try {
        await registerWebhook(client, item);
        console.log(`[registerWebhooks] ${item.branch}/${item.eventType}: dang ky thanh cong`);
        successCount++;
      } catch (error) {
        console.error(`[registerWebhooks] ${item.branch}/${item.eventType}: THAT BAI - ${error.message}`);
        failCount++;
      }
    }
  }

  console.log(`[registerWebhooks] Tong ket: ${successCount} thanh cong, ${failCount} that bai / ${plan.length} tong.`);
  if (failCount > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[registerWebhooks] That bai: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { buildWebhookUrl, listWebhooks, registerWebhook, deleteWebhook, parseArgs, EVENT_TYPES, DESCRIPTION_PREFIX };
