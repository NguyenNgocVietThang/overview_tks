'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { createRepository, CASH_BOOK_TRANSACTIONS_SELECT } = require('../cashbook/cashbookRepository');
const { parseFilters } = require('../cashbook/cashbookFilters');

const SQL = fs.readFileSync(path.join(__dirname, 'migrations', '0070_cash_book_transactions_view.sql'), 'utf8');
const SCHEMA = `
  CREATE TABLE cash_flows(branch text,id bigint,code text,is_receipt boolean,amount numeric,source_missing_at timestamptz,
    method text,account_id bigint,status int,trans_date timestamptz,user_id bigint,description text,raw jsonb NOT NULL,
    PRIMARY KEY(branch,id));
  CREATE TABLE staff(branch text,id bigint,name text,primary key(branch,id));
  CREATE TABLE cash_book_accounts(id bigint primary key,bank_name text,account_no text,description text,raw jsonb);
  CREATE TABLE sync_checkpoints(branch text,entity text,last_synced_at timestamptz);
  INSERT INTO staff VALUES ('hanoi',9,'Lan - 1234567890');
  INSERT INTO cash_book_accounts VALUES (7,'Holder','123','Main','{}');
  INSERT INTO cash_flows VALUES
   ('hanoi',1,'P1',true,10,NULL,'Transfer',7,0,'2026-10-02T00:00:00Z',9,'n1',
     '{"CashFlowGroupId":"5","CashGroup":"Pascal","PartnerId":"P9","PartnerName":"Alice","ContactNumber":"090","CreatedBy":"9","User":"Lan","UserId":"9","UsedForFinancialReporting":"1"}'),
   ('saigon',2,'P2',false,-4,NULL,'Cash',NULL,0,'2026-10-03T00:00:00Z',9,'n2',
     '{"cashFlowGroupId":"6","cashGroup":"camel","partnerId":"p8","partnerName":"Bob","contactNumber":"091","createdBy":"9","user":"Lan 2","userId":"9","usedForFinancialReporting":"0"}'),
   ('hanoi',3,'P3',true,5,now(),'Transfer',-1,1,'2026-10-04T00:00:00Z',NULL,'n3','{}');`;
const COLUMNS = ['branch', 'id', 'code', 'trans_date', 'is_receipt', 'amount', 'method', 'status', 'account_id', 'user_id',
  'description', 'source_missing_at', 'fund_key', 'account_no', 'account_name', 'account_desc', 'cash_group_id',
  'cash_group_name', 'partner_id', 'partner_name', 'partner_phone', 'created_by', 'user_name', 'raw_user_id',
  'used_for_financial_reporting'];

test('migration 0070 tao view v_cash_book_transactions, khong lo raw, chay lai duoc', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(SCHEMA);
  await db.exec(SQL);
  await db.exec(SQL); // CREATE OR REPLACE: idempotent
  const cols = await db.query(`SELECT column_name FROM information_schema.columns
    WHERE table_name='v_cash_book_transactions' ORDER BY ordinal_position`);
  assert.deepEqual(cols.rows.map((r) => r.column_name), COLUMNS);
  const { rows } = await db.query('SELECT * FROM v_cash_book_transactions ORDER BY branch,id');
  const byCode = Object.fromEntries(rows.map((r) => [r.code, r]));
  assert.equal(byCode.P1.fund_key, '7');
  assert.equal(byCode.P1.account_no, '123');
  assert.equal(byCode.P1.account_name, 'Holder');
  assert.equal(byCode.P1.account_desc, 'Main');
  assert.equal(byCode.P1.cash_group_id, '5');
  assert.equal(byCode.P1.partner_name, 'Alice');
  assert.equal(byCode.P1.raw_user_id, '9');
  assert.equal(byCode.P2.fund_key, 'cash');
  assert.equal(byCode.P2.cash_group_name, 'camel');
  assert.equal(byCode.P2.partner_id, 'p8');
  assert.equal(byCode.P2.user_name, 'Lan 2');
  assert.equal(byCode.P2.used_for_financial_reporting, '0');
  assert.equal(byCode.P3.fund_key, '-1');
  assert.equal(byCode.P3.account_no, null);
  assert.equal(byCode.P3.created_by, null);
});

test('migration 0070 chay duoc khi role reporting_readonly ton tai va khi khong', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(SCHEMA);
  await db.exec(SQL); // khong co role: khong loi
  await db.exec('CREATE ROLE reporting_readonly');
  await db.exec(SQL);
  const g = await db.query(`SELECT has_table_privilege('reporting_readonly','v_cash_book_transactions','SELECT') ok`);
  assert.equal(g.rows[0].ok, true);
});

test('subquery du phong trong repository giong het view (cot va du lieu)', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(SCHEMA);
  await db.exec(SQL);
  const inline = await db.query(`SELECT * FROM (${CASH_BOOK_TRANSACTIONS_SELECT}) v ORDER BY branch,id`);
  const view = await db.query('SELECT * FROM v_cash_book_transactions ORDER BY branch,id');
  assert.deepEqual(inline.fields.map((x) => x.name), view.fields.map((x) => x.name));
  assert.deepEqual(inline.rows, view.rows);
});

test('thieu view (chua migrate): repository lui ve doc cash_flows va ra cung ket qua', async (t) => {
  const withView = new PGlite();
  const without = new PGlite();
  t.after(async () => { await withView.close(); await without.close(); });
  for (const db of [withView, without]) await db.exec(SCHEMA);
  await withView.exec(SQL);
  const mk = (db) => createRepository({ query: (s, p) => db.query(s, p) });
  const filters = parseFilters({ from: '2026-10-01', to: '2026-10-31' }, new Date('2026-10-06T00:00:00Z'));
  const warn = console.warn;
  const warnings = [];
  console.warn = (m) => warnings.push(m);
  t.after(() => { console.warn = warn; });
  const a = mk(withView), b = mk(without);
  assert.deepEqual(await b.summary(filters), await a.summary(filters));
  assert.deepEqual(await b.entries(filters), await a.entries(filters));
  assert.deepEqual(await b.filterOptions(), await a.filterOptions());
  const staff = parseFilters({ from: '2026-10-01', to: '2026-10-31', staff: '9', groups: '5' }, new Date('2026-10-06T00:00:00Z'));
  assert.deepEqual(await b.entries(staff), await a.entries(staff));
  assert.equal((await b.entries(staff)).total, 1);
  assert.equal(warnings.length, 1, 'chi canh bao mot lan, cac lan sau doc thang');
});
