#!/usr/bin/env node
// ==========================================
// QUAN LY WEBHOOK KIOTVIET (CLI admin tools)
// Usage:
//   node kiotviet/webhookAdmin.js register <webhook-url>
//   node kiotviet/webhookAdmin.js list
//   node kiotviet/webhookAdmin.js delete-all
// ==========================================
const CONFIG = require('../config');
const { getKiotVietToken } = require('./auth');

const EVENT_TYPES = ['product.update', 'product.delete', 'stock.update', 'customer.update', 'customer.delete', 'invoice.update', 'order.update'];

async function authHeaders() {
  const token = await getKiotVietToken();
  if (!token) throw new Error('Khong lay duoc KiotViet token.');
  return { Authorization: 'Bearer ' + token, Retailer: CONFIG.RETAILER };
}

async function registerWebhook(webhookUrl) {
  if (!webhookUrl) throw new Error('Thieu webhook URL. Vi du: node kiotviet/webhookAdmin.js register https://your-app.onrender.com/webhook');
  const headers = await authHeaders();
  let successCount = 0, failCount = 0;

  for (const type of EVENT_TYPES) {
    const payload = {
      Webhook: { Type: type, Url: webhookUrl, IsActive: true, Description: 'Auto-sync Google Sheets - ' + type }
    };
    const response = await fetch('https://public.kiotapi.com/webhooks', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const body = await response.text();
    console.log(`---- ${type} -> ${response.status} ----`);
    console.log(body);
    if (response.status === 200 || response.status === 201) successCount++; else failCount++;
  }
  console.log(`===== TONG KET: Thanh cong ${successCount} / That bai ${failCount} =====`);
}

async function listWebhooks() {
  const headers = await authHeaders();
  const response = await fetch('https://public.kiotapi.com/webhooks', { headers });
  const result = await response.json();
  console.log(JSON.stringify(result, null, 2));
}

async function deleteAllWebhooks() {
  const headers = await authHeaders();
  const listResponse = await fetch('https://public.kiotapi.com/webhooks', { headers });
  const listResult = await listResponse.json();
  if (!listResult.data || listResult.data.length === 0) {
    console.log('Khong co webhook nao de xoa.');
    return;
  }
  console.log(`Tim thay ${listResult.data.length} webhook. Bat dau xoa...`);
  for (const webhook of listResult.data) {
    const deleteResponse = await fetch(`https://public.kiotapi.com/webhooks/${webhook.id}`, { method: 'DELETE', headers });
    console.log(`Xoa webhook id=${webhook.id} (type=${webhook.type}) -> ${deleteResponse.status}`);
  }
}

async function main() {
  const [command, arg] = process.argv.slice(2);
  if (command === 'register') return registerWebhook(arg);
  if (command === 'list') return listWebhooks();
  if (command === 'delete-all') return deleteAllWebhooks();
  console.log('Usage: node kiotviet/webhookAdmin.js <register <url>|list|delete-all>');
  process.exit(1);
}

if (require.main === module) {
  main().catch(err => {
    console.error('Loi:', err);
    process.exit(1);
  });
}

module.exports = { registerWebhook, listWebhooks, deleteAllWebhooks };
