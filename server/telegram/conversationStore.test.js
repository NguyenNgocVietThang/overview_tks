// Test cho conversationStore — dam bao trang thai hoi thoai song sot qua
// "restart" (mo phong bang cach xoa cache RAM va doc lai tu dia).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshStore() {
  // Moi test dung 1 file rieng trong thu muc tam, tranh dam vao du lieu that.
  delete require.cache[require.resolve('./conversationStore')];
  const store = require('./conversationStore');
  const tmpFile = path.join(os.tmpdir(), `tks-hr-conv-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  store.initStore(tmpFile);
  return { store, tmpFile };
}

test('setConversation ghi xuong dia va getConversation doc lai dung du lieu', () => {
  const { store, tmpFile } = freshStore();
  try {
    store.setConversation(111, { step: 'AWAITING_START', data: { ly_do: 'kham benh' } });
    assert.ok(fs.existsSync(tmpFile), 'file trang thai phai duoc tao ra');

    const conv = store.getConversation(111);
    assert.equal(conv.step, 'AWAITING_START');
    assert.equal(conv.data.ly_do, 'kham benh');
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
});

test('trang thai song sot qua "restart" (cache RAM bi xoa, doc lai tu file)', () => {
  const { store, tmpFile } = freshStore();
  try {
    const start = new Date(2026, 7, 22, 8, 0);
    store.setConversation(222, { step: 'AWAITING_END', data: { start, ly_do: 'viec gia dinh' } });

    // Mo phong restart server: nap lai module (xoa cache RAM), tro ve cung file.
    delete require.cache[require.resolve('./conversationStore')];
    const reloaded = require('./conversationStore');
    reloaded.initStore(tmpFile);

    const conv = reloaded.getConversation(222);
    assert.ok(conv, 'trang thai phai con sau khi restart, khong duoc mat');
    assert.equal(conv.step, 'AWAITING_END');
    assert.ok(conv.data.start instanceof Date, 'truong start phai duoc hoi phuc thanh Date');
    assert.equal(conv.data.start.getTime(), start.getTime());
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
});

test('khoi phuc startDate va endDate cua luong nghi theo buoi sau restart', () => {
  const { store, tmpFile } = freshStore();
  try {
    const startDate = new Date(2026, 7, 22);
    const endDate = new Date(2026, 7, 24);
    store.setConversation(223, { step: 'AWAITING_END_SESSION', data: { startDate, endDate } });

    delete require.cache[require.resolve('./conversationStore')];
    const reloaded = require('./conversationStore');
    reloaded.initStore(tmpFile);
    const conv = reloaded.getConversation(223);

    assert.ok(conv.data.startDate instanceof Date);
    assert.ok(conv.data.endDate instanceof Date);
    assert.equal(conv.data.startDate.getTime(), startDate.getTime());
    assert.equal(conv.data.endDate.getTime(), endDate.getTime());
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
});

test('deleteConversation xoa han, getConversation tra ve null', () => {
  const { store, tmpFile } = freshStore();
  try {
    store.setConversation(333, { step: 'CONFIRM', data: {} });
    store.deleteConversation(333);
    assert.equal(store.getConversation(333), null);
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
});

test('phien qua han (updatedAt qua cu) bi coi la het han va tu xoa', () => {
  const { store, tmpFile } = freshStore();
  try {
    store.setConversation(444, { step: 'AWAITING_HANDOVER', data: {} });
    // Chinh truc tiep file de gia lap phien da qua 61 phut khong hoat dong.
    const raw = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    raw['444'].updatedAt = Date.now() - (61 * 60 * 1000);
    fs.writeFileSync(tmpFile, JSON.stringify(raw, null, 2), 'utf8');

    delete require.cache[require.resolve('./conversationStore')];
    const reloaded = require('./conversationStore');
    reloaded.initStore(tmpFile);

    assert.equal(reloaded.getConversation(444), null, 'phien qua han phai bi coi nhu khong ton tai');
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
});
