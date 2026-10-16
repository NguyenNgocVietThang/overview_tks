'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRepository } = require('./transferRepository');
const { createTransferService } = require('./transferService');
const { createTransferDb, botRequest, user } = require('./testHelpers');

const accountant = user('accountant');
const manager = user('manager');
const sale = user('sale', { telegramId: '8870151609' });
const otherSale = user('sale', { id: 'other', telegramId: '111' });
const admin = user('admin', { username: 'admin', permissions: ['transfers.view', 'transfers.review', 'transfers.markPaid', 'transfers.own'] });
const nobody = user('none');

function setup(db, pool) {
  const notices = [];
  const broadcasts = [];
  const notifier = {
    created: async r => notices.push(['created', r.requestCode]),
    approved: async r => notices.push(['approved', r.requestCode]),
    canceledAfterApproval: async r => notices.push(['urgent', r.requestCode])
  };
  const service = createTransferService({
    repository: createRepository({ pool }),
    notifier,
    broadcast: (type, r) => broadcasts.push([type, r.id, r.version])
  });
  return { service, notices, broadcasts };
}

test('transfer request lifecycle', async (t) => {
  const { db, pool } = await createTransferDb();
  const { service, notices, broadcasts } = setup(db, pool);
  try {
    await t.test('bot create is idempotent and notifies accountants once', async () => {
      const body = botRequest();
      const first = await service.createFromBot(body);
      const again = await service.createFromBot(body);
      assert.equal(first.duplicate, false);
      assert.equal(again.duplicate, true);
      assert.equal(again.request.id, first.request.id);
      assert.equal(first.request.status, 'CHO_DUYET');
      assert.deepEqual(notices, [['created', body.requestCode]]);
      await assert.rejects(service.createFromBot({ ...body, idempotencyKey: 'another-key-123' }), e => e.code === 'CODE_CLASH');
      await assert.rejects(service.createFromBot({ ...botRequest(), idempotencyKey: body.idempotencyKey }), e => e.code === 'CODE_CLASH');
    });

    await t.test('unknown BIN is dropped but raw bank name kept', async () => {
      const { request } = await service.createFromBot(botRequest({ bankBin: '999999', bankNameRaw: 'Techcombang' }));
      assert.equal(request.bankBin, null);
      assert.equal(request.bankNameRaw, 'Techcombang');
      await assert.rejects(service.approve(accountant, request.id, { expectedVersion: request.version }), e => e.code === 'BANK_REQUIRED');
    });

    await t.test('accountant edits with diff, approves; details lock after approval', async () => {
      const { request } = await service.createFromBot(botRequest());
      const edited = await service.edit(accountant, request.id, { expectedVersion: request.version, amountVnd: '6.400.000', bankBin: '970418' });
      assert.equal(edited.amountVnd, 6400000);
      assert.equal(edited.bankShortName, 'BIDV');
      const detail = await service.getForUser(accountant, request.id);
      const ev = detail.events.at(-1);
      assert.equal(ev.type, 'EDITED');
      assert.deepEqual(ev.changes.map(c => [c.label, c.before, c.after]), [['Số tiền', 6350000, 6400000], ['Ngân hàng', 'Vietcombank', 'BIDV']]);
      await assert.rejects(service.edit(accountant, request.id, { expectedVersion: request.version, note: 'x' }), e => e.code === 'STALE');
      const approved = await service.approve(accountant, request.id, { expectedVersion: edited.version });
      assert.equal(approved.status, 'DA_DUYET');
      assert.equal(approved.approvedByName, 'accountant name');
      await assert.rejects(service.edit(accountant, request.id, { expectedVersion: approved.version, amountVnd: 1 }), e => e.code === 'INVALID_STATE');
      const noted = await service.edit(accountant, request.id, { expectedVersion: approved.version, accountantNote: 'Đã gọi khách' });
      assert.equal(noted.accountantNote, 'Đã gọi khách');
      const back = await service.unapprove(accountant, request.id, { expectedVersion: noted.version });
      assert.equal(back.status, 'CHO_DUYET');
      assert.equal(back.approvedAt, null);
    });

    await t.test('only accountants open unapproved rows; others see approved rows only', async () => {
      const { request } = await service.createFromBot(botRequest());
      await assert.rejects(service.getForUser(manager, request.id), e => e.statusCode === 403);
      await assert.rejects(service.getForUser(sale, request.id), e => e.statusCode === 403);
      const approved = await service.approve(accountant, request.id, { expectedVersion: request.version });
      assert.equal((await service.getForUser(manager, request.id)).allowed.markPaid, true);
      assert.equal((await service.getForUser(sale, request.id)).allowed.markPaid, false);
      await assert.rejects(service.getForUser(otherSale, request.id), e => e.statusCode === 403);
      await assert.rejects(service.getForUser(nobody, request.id), e => e.statusCode === 403);
      await assert.rejects(service.vietQr(sale, request.id), e => e.statusCode === 403);
      const qr = await service.vietQr(manager, request.id);
      assert.match(qr.payload, /0006970436/);
      assert.match(qr.svg, /^<svg/);
      assert.equal(qr.addInfo, 'C TUYET BAC LAM');
      await assert.rejects(service.approve(manager, request.id, { expectedVersion: approved.version }), e => e.statusCode === 403);
    });

    await t.test('mark paid records who paid; sale cancel then refused; admin revert needs reason', async () => {
      const { request } = await service.createFromBot(botRequest());
      const approved = await service.approve(accountant, request.id, { expectedVersion: request.version });
      await assert.rejects(service.markPaid(accountant, request.id, { expectedVersion: approved.version }), e => e.statusCode === 403);
      const paid = await service.markPaid(manager, request.id, { expectedVersion: approved.version });
      assert.equal(paid.status, 'DA_CHUYEN');
      assert.equal(paid.paidByName, 'manager name');
      await assert.rejects(service.cancelFromBot(request.requestCode, { telegramId: '8870151609' }), e => e.code === 'ALREADY_PAID' && e.paidByName === 'manager name');
      await assert.rejects(service.revertPaid(manager, request.id, { expectedVersion: paid.version, reason: 'nhầm' }), e => e.statusCode === 403);
      await assert.rejects(service.revertPaid(admin, request.id, { expectedVersion: paid.version, reason: '' }), e => e.code === 'INVALID');
      const reverted = await service.revertPaid(admin, request.id, { expectedVersion: paid.version, reason: 'Bấm nhầm dòng' });
      assert.equal(reverted.status, 'DA_DUYET');
      assert.equal(reverted.paidByName, null);
    });

    await t.test('sale cancel races a manager: mark paid is blocked with TRANSFER_CANCELED', async () => {
      const { request } = await service.createFromBot(botRequest());
      const approved = await service.approve(accountant, request.id, { expectedVersion: request.version });
      notices.length = 0;
      await assert.rejects(service.cancelFromBot(request.requestCode, { telegramId: '111' }), e => e.code === 'NOT_OWNER');
      const canceled = await service.cancelFromBot(request.requestCode, { telegramId: '8870151609', reason: 'Khách đổi ý' });
      assert.equal(canceled.status, 'DA_HUY');
      assert.equal(canceled.canceledByType, 'SALE');
      assert.deepEqual(notices, [['urgent', request.requestCode]]);
      await assert.rejects(service.markPaid(manager, request.id, { expectedVersion: approved.version }), e => e.code === 'TRANSFER_CANCELED');
      const again = await service.cancelFromBot(request.requestCode, { telegramId: '8870151609' });
      assert.equal(again.version, canceled.version);
    });

    await t.test('accountant cancel requires reason', async () => {
      const { request } = await service.createFromBot(botRequest());
      await assert.rejects(service.cancel(accountant, request.id, { expectedVersion: request.version }), e => e.code === 'INVALID');
      const canceled = await service.cancel(accountant, request.id, { expectedVersion: request.version, reason: 'Trùng yêu cầu' });
      assert.equal(canceled.canceledByType, 'ACCOUNTANT');
    });

    await t.test('created-then-canceled before sync arrives already canceled, no accountant bell', async () => {
      notices.length = 0;
      const { request } = await service.createFromBot(botRequest({ canceled: { at: '2026-10-15T03:30:00Z', reason: 'Gửi nhầm' } }));
      assert.equal(request.status, 'DA_HUY');
      assert.deepEqual(notices, []);
    });

    await t.test('bot receives every event exactly once via fetch + ack', async () => {
      const events = await service.listUndeliveredEvents(500);
      assert.ok(events.length > 10);
      const paid = events.find(e => e.type === 'PAID');
      assert.equal(paid.actorName, 'manager name');
      assert.ok(paid.snapshot.requestCode.startsWith('YC-'));
      assert.ok(paid.snapshot.idempotencyKey.startsWith('bot-create-'), 'bot đối chiếu đúng yêu cầu của mình');
      assert.equal(await service.ackEvents(events.map(e => e.id)), events.length);
      assert.equal(await service.ackEvents(events.map(e => e.id)), 0);
      assert.deepEqual(await service.listUndeliveredEvents(), []);
    });

    await t.test('sales only list their own rows; linked web name replaces bot name', async () => {
      await db.query("INSERT INTO app_users (id, ho_ten, telegram_id) VALUES ('11111111-1111-1111-1111-111111111111', 'Trương Phương Uyên', '8870151609')");
      const own = await service.listForUser(sale, {});
      assert.ok(own.total > 0);
      assert.ok(own.requests.every(r => r.saleTelegramId === '8870151609' && r.saleName === 'Trương Phương Uyên'));
      assert.ok(own.requests.every(r => r.canOpen === ['DA_DUYET', 'DA_CHUYEN'].includes(r.status)));
      const other = await service.listForUser(otherSale, {});
      assert.equal(other.total, 0);
      const all = await service.listForUser(accountant, { status: 'DA_HUY' });
      assert.ok(all.requests.length >= 3 && all.requests.every(r => r.status === 'DA_HUY'));
      assert.equal(all.counts.DA_HUY, all.total);
      const search = await service.listForUser(accountant, { q: 'Uyên' });
      assert.ok(search.total > 0);
      await assert.rejects(service.listForUser(nobody, {}), e => e.statusCode === 403);
    });

    assert.ok(broadcasts.length > 0);
  } finally {
    await db.close();
  }
});
