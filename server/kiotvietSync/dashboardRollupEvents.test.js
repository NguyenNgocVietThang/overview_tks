'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');

test('worker emit -> pg_notify -> web re-emits locally with remote:true', async () => {
  delete require.cache[require.resolve('./dashboardRollupEvents')];
  const bus = require('./dashboardRollupEvents');
  const sent = [];
  const local = [];
  bus.dashboardRollupEvents.on('customersChanged', info => local.push(info));

  // Worker: emit van chay listener tai cho va gui NOTIFY.
  bus.publishToPostgres({ query: async (sql, params) => { sent.push(params); } });
  bus.dashboardRollupEvents.emit('customersChanged', { branch: 'hanoi' });
  assert.deepEqual(local, [{ branch: 'hanoi' }]);
  assert.equal(sent[0][0], bus.CHANNEL);

  // Web: nhan NOTIFY -> emit tai cho, KHONG gui NOTIFY lai (tranh vong lap).
  const client = new EventEmitter();
  const queries = [];
  client.connect = async () => {};
  client.query = async sql => { queries.push(sql); };
  client.end = async () => {};
  const listener = bus.listenToPostgres(() => client, { log: { log() {}, error() {} } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(queries, [`LISTEN ${bus.CHANNEL}`]);

  client.emit('notification', { payload: sent[0][1] });
  client.emit('notification', { payload: 'not json' });
  assert.deepEqual(local[1], { branch: 'hanoi', remote: true });
  assert.equal(local.length, 2);
  assert.equal(sent.length, 1);
  listener.stop();
  delete require.cache[require.resolve('./dashboardRollupEvents')];
});
