'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const repositoryPath = path.join(__dirname, 'marketingRepository.js');
const migrationPath = path.join(__dirname, '../db/migrations/0044_pancake_marketing.sql');
const HN = '1184366971419195', TT = '1144127138790204';
const actor = { userId: '7', username: 'manager', name: 'Manager' };
const monthly = { reportYear: 2026, reportMonth: 10, sale: 'Sale', customer: 'Customer', phone: '0900000001', pageId: HN, status: 'Chốt', dataSource: 'Mới', closedAt: '2026-09-30', newCustomer: 'Có', note: '' };
function historical(overrides = {}) {
  return { tab: 'THÔ HN', rowNumber: 3, pageId: HN, sourceCreatedAt: '2026-09-27T03:00:00Z', sourceCreatedText: '27/09/2026 10:00', phone: '0900000001, 0900000002', employeeRaw: 'First, Second', creditedDate: '2026-09-28', raw: ['original cell'], ...overrides };
}
function apiRow(overrides = {}) {
  return { sourceKey: 'message-1:phone-1', messageId: 'message-1', conversationId: 'conversation-1', type: 'INBOX', phone: '0900000001', employeeRaw: 'First', sourceCreatedAt: '2026-09-27T03:00:00Z', raw: { id: 'message-1' }, ...overrides };
}
async function setup(t) {
  // Missing implementation fails an explicit feature assertion before DB setup.
  const exports = fs.existsSync(repositoryPath) ? require(repositoryPath) : {};
  assert.equal(typeof exports.createMarketingRepository, 'function', 'PostgreSQL Marketing repository must exist');
  assert.ok(fs.existsSync(migrationPath), 'Marketing migration must exist');
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(fs.readFileSync(migrationPath, 'utf8'));
  await db.exec(fs.readFileSync(path.join(__dirname,'../db/migrations/0045_pancake_current_input.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(__dirname,'../db/migrations/0056_pancake_independent.sql'),'utf8'));
  const pool = { query: (...args) => db.query(...args), connect: async () => ({ query: (...args) => db.query(...args), release() {} }) };
  return { db, repo: exports.createMarketingRepository({ pool }) };
}

test('history preserves duplicate phones, exact cells, provenance and row ordering across idempotent imports', async t => {
  const { repo } = await setup(t);
  const batch = { batchKey: 'history-v1', workbookId: 'book', rawRows: [historical({ rowNumber: 8, employeeRaw: 'Later' }), historical(), historical({ tab: 'THÔ TT', pageId: TT })] };
  const first = await repo.importHistory(batch, actor);
  const retry = await repo.importHistory(batch, actor);
  assert.equal(retry.id, first.id);
  const snap = await repo.readSnapshot();
  assert.equal(snap.rawRows.length, 3);
  assert.deepEqual(snap.rawRows.filter(r => r.pageId === HN).map(r => [r.rowNumber, r.employeeRaw]), [[3, 'First, Second'], [8, 'Later']]);
  assert.equal(snap.rawRows[0].phone, '0900000001, 0900000002');
  assert.equal(snap.rawRows[0].creditedDate, '2026-09-28');
  assert.equal(snap.rawRows[0].sourceCreatedAt, '2026-09-27T03:00:00.000Z');
  assert.deepEqual(snap.rawRows[0].raw, ['original cell']);
  assert.equal(snap.rawRows[0].workbookId, 'book');
  await assert.rejects(repo.importHistory({ ...batch, rawRows: [historical({ employeeRaw: 'Changed' })] }, actor), { code: 'MARKETING_IMPORT_CONFLICT' });
  await repo.importHistory({ ...batch, batchKey: 'second-import' }, actor);
  assert.equal((await repo.readSnapshot()).rawRows.length, 3);
});

test('caller phone keys coexist with exact raw cells and nullable historical timestamp without collapsing rows', async t => {
  const { repo } = await setup(t);
  await repo.importHistory({ batchKey:'phone-keys',workbookId:'book',rawRows:[
    historical({phone:'900000001',phoneKey:'0900000001',sourceCreatedAt:null,sourceCreatedText:'unknown'}),
    historical({rowNumber:4,phone:'0900000001',phoneKey:'0900000001'})
  ] },actor);
  const rows=(await repo.readSnapshot()).rawRows;
  assert.deepEqual(rows.map(r=>[r.phone,r.phoneKey]),[['900000001','0900000001'],['0900000001','0900000001']]);
  assert.equal(rows[0].sourceCreatedAt,null);
  assert.equal(rows[0].sourceCreatedText,'unknown');
});

test('successful page retries keep dates and order while changed assignments retain immutable observations', async t => {
  const { repo, db } = await setup(t);
  const run = await repo.startSyncRun({ runKey: '2026-10-01', startedAt: '2026-10-01T16:55:00Z' });
  await repo.commitPageSync({ runId: run.id, pageId: HN, completedAt: '2026-10-01T17:01:00Z', rows: [apiRow(), apiRow({ sourceKey: 'message-2:phone-1', messageId: 'message-2', employeeRaw: '' })] });
  let snap = await repo.readSnapshot();
  const original = snap.rawRows.map(r => [r.id, r.sourceOrder, r.creditedDate]);
  assert.deepEqual(snap.rawRows.map(r => r.creditedDate), ['2026-10-02', '2026-10-02']);
  assert.equal(snap.rawRows[1].employeeRaw, '');
  const retry = await repo.startSyncRun({ runKey: '2026-10-02', startedAt: '2026-10-02T16:55:00Z' });
  await repo.commitPageSync({ runId: retry.id, pageId: HN, completedAt: '2026-10-02T16:56:00Z', rows: [apiRow(), apiRow({ sourceKey: 'message-2:phone-1', messageId: 'message-2', employeeRaw: '' })] });
  assert.deepEqual((await repo.readSnapshot()).rawRows.map(r => [r.id, r.sourceOrder, r.creditedDate]), original);
  const changed = await repo.startSyncRun({ runKey: '2026-10-03', startedAt: '2026-10-03T16:55:00Z' });
  await repo.commitPageSync({ runId: changed.id, pageId: HN, completedAt: '2026-10-03T16:56:00Z', rows: [apiRow({ employeeRaw: 'Later, Another' })] });
  snap = await repo.readSnapshot();
  assert.deepEqual(snap.rawRows.filter(r => r.sourceKey === 'message-1:phone-1').map(r => [r.employeeRaw, r.creditedDate]), [['First', '2026-10-02'], ['Later, Another', '2026-10-03']]);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM marketing_pancake_facts')).rows[0].n, 2);
  await assert.rejects(db.query("UPDATE marketing_pancake_observations SET employee_raw='Overwrite'"));
});

test('same successful page run can replay only identical facts and metadata changes never shift dates', async t => {
  const {repo}=await setup(t);
  const run=await repo.startSyncRun({runKey:'same-run'});
  const saved=await repo.commitPageSync({runId:run.id,pageId:HN,completedAt:'2026-10-01T16:55:00Z',rows:[apiRow()]});
  assert.equal(typeof saved.runId,'string');
  const replay=await repo.commitPageSync({runId:run.id,pageId:HN,completedAt:'2026-10-02T16:55:00Z',rows:[apiRow({raw:{id:'message-1',updated_at:'changed-metadata'}})]});
  assert.equal(String(replay.runId),String(saved.runId));
  assert.equal((await repo.readSnapshot()).rawRows[0].creditedDate,'2026-10-01');
  await assert.rejects(repo.commitPageSync({runId:run.id,pageId:HN,rows:[apiRow({employeeRaw:'Different'})]}),{code:'MARKETING_SYNC_CONFLICT'});
  assert.equal((await repo.readSnapshot()).pages.find(p=>p.pageId===HN).status,'success');
});

test('invalid calendar dates and duplicate API source keys reject without writing any source rows', async t => {
  const {repo}=await setup(t);
  const run=await repo.startSyncRun({runKey:'invalid'});
  await assert.rejects(repo.commitPageSync({runId:run.id,pageId:HN,rows:[apiRow({sourceCreatedAt:'2026-02-30T03:00:00Z'})]}),{code:'INVALID_MARKETING_INPUT'});
  await assert.rejects(repo.commitPageSync({runId:run.id,pageId:HN,rows:[apiRow(),apiRow()]}),{code:'INVALID_MARKETING_INPUT'});
  assert.equal((await repo.readSnapshot()).rawRows.length,0);
});

test('same API source key and phone on different pages stay separate and only Facebook whitelist is accepted', async t => {
  const { repo, db } = await setup(t);
  const run = await repo.startSyncRun({ runKey: 'pages' });
  for (const pageId of [HN, TT]) await repo.commitPageSync({ runId: run.id, pageId, completedAt: '2026-10-01T16:55:00Z', rows: [apiRow()] });
  assert.equal((await repo.readSnapshot()).rawRows.length, 2);
  await assert.rejects(repo.commitPageSync({ runId: run.id, pageId: 'zalo-1', rows: [] }), { code: 'INVALID_MARKETING_INPUT' });
  await assert.rejects(db.query("INSERT INTO marketing_pages(page_id,name) VALUES('zalo-1','Zalo')"));
});

test('adopted API baseline preserves historical dates and appends only later changed employee observations', async t => {
  const { repo, db } = await setup(t);
  await repo.importHistory({ batchKey: 'baseline', workbookId: 'book', rawRows: [historical({ phone: '0900000001', employeeRaw: 'First' })] }, actor);
  const [history] = (await repo.readSnapshot()).rawRows;
  const first = await repo.startSyncRun({ runKey: 'baseline' });
  await repo.commitPageSync({ runId: first.id, pageId: HN, completedAt: '2026-10-01T16:55:00Z', rows: [apiRow({ historicalRowId: history.id })] });
  assert.equal((await repo.readSnapshot()).rawRows.length, 1);
  const baselineSnapshot=await repo.readSnapshot();
  assert.ok(Array.isArray(baselineSnapshot.facts),'snapshot exposes canonical facts for baseline reconciliation');
  assert.equal(baselineSnapshot.facts[0].historicalRowId,history.id);
  assert.equal((await db.query('SELECT credited_date::text AS date FROM marketing_pancake_facts')).rows[0].date, '2026-09-28');
  const next = await repo.startSyncRun({ runKey: 'after-baseline' });
  await repo.commitPageSync({ runId: next.id, pageId: HN, completedAt: '2026-10-02T16:55:00Z', rows: [apiRow({ employeeRaw: 'Changed' })] });
  assert.deepEqual((await repo.readSnapshot()).rawRows.map(r => [r.employeeRaw, r.creditedDate]), [['First', '2026-09-28'], ['Changed', '2026-10-02']]);
  const bad = await repo.startSyncRun({ runKey: 'bad-adoption' });
  await assert.rejects(repo.commitPageSync({ runId: bad.id, pageId: TT, completedAt: '2026-10-03T16:55:00Z', rows: [apiRow({ historicalRowId: history.id })] }), { code: 'INVALID_MARKETING_INPUT' });
  assert.equal((await repo.readSnapshot()).rawRows.length, 2);
});

test('baseline adoption uses explicit phone key while retaining numeric source cell text', async t => {
  const {repo}=await setup(t);
  await repo.importHistory({batchKey:'numeric-baseline',workbookId:'book',rawRows:[historical({phone:'900000001',phoneKey:'0900000001',employeeRaw:'First'})]},actor);
  const [history]=(await repo.readSnapshot()).rawRows;
  const run=await repo.startSyncRun({runKey:'numeric-baseline'});
  await repo.commitPageSync({runId:run.id,pageId:HN,completedAt:'2026-10-01T16:55:00Z',rows:[apiRow({phoneKey:'0900000001',historicalRowId:history.id})]});
  assert.equal((await repo.readSnapshot()).rawRows.length,1);
  assert.equal((await repo.readSnapshot()).rawRows[0].phone,'900000001');
});

test('failure after a partial SQL write rolls back the whole page and records safe error with prior success', async t => {
  const { repo, db } = await setup(t);
  const initial = await repo.startSyncRun({ runKey: 'old' });
  await repo.commitPageSync({ runId: initial.id, pageId: HN, completedAt: '2026-10-01T16:55:00Z', rows: [apiRow()] });
  await db.exec(`CREATE FUNCTION reject_second() RETURNS trigger AS $$ BEGIN IF NEW.source_key='bad' THEN RAISE EXCEPTION 'secret customer token'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql;
    CREATE TRIGGER reject_second BEFORE INSERT ON marketing_pancake_facts FOR EACH ROW EXECUTE FUNCTION reject_second();`);
  const run = await repo.startSyncRun({ runKey: 'broken' });
  await assert.rejects(repo.commitPageSync({ runId: run.id, pageId: HN, completedAt: '2026-10-02T16:55:00Z', rows: [apiRow({ sourceKey: 'new' }), apiRow({ sourceKey: 'bad' })] }), { code: 'MARKETING_STORAGE_ERROR' });
  const snap = await repo.readSnapshot();
  assert.equal(snap.rawRows.length, 1);
  const page = snap.pages.find(p => p.pageId === HN);
  assert.equal(page.status, 'error');
  assert.equal(page.lastSuccessAt, '2026-10-01T16:55:00.000Z');
  assert.equal(page.errorCode, 'MARKETING_STORAGE_ERROR');
  assert.equal((await repo.getSyncRun(run.id)).pages.find(p => p.pageId === HN).status, 'error');
  assert.equal(JSON.stringify(snap).includes('secret customer token'), false);
});

test('explicit fetch failure preserves rows, finished runs reflect partial errors and successful pages cannot be downgraded', async t => {
  const { repo } = await setup(t);
  const run = await repo.startSyncRun({ runKey: 'fetch-failure' });
  await repo.commitPageSync({ runId: run.id, pageId: HN, completedAt: '2026-10-01T16:55:00Z', rows: [apiRow()] });
  await repo.failPageSync({ runId: run.id, pageId: TT, errorCode: 'PANCAKE_UNAVAILABLE' });
  await assert.rejects(repo.failPageSync({ runId: run.id, pageId: HN, errorCode: 'secret token' }), { code: 'MARKETING_SYNC_CONFLICT' });
  const done = await repo.finishSyncRun(run.id);
  assert.equal(done.status, 'error');
  assert.equal(done.pages.length, 6);
  assert.equal((await repo.readSnapshot()).rawRows.length, 1);
  assert.equal((await repo.startSyncRun({ runKey: 'fetch-failure' })).id, run.id);
});

test('raw aliases map multiple names without changing history or guessing missing employee', async t => {
  const { repo } = await setup(t);
  await repo.importHistory({ batchKey: 'aliases', workbookId: 'book', rawRows: [historical({ employeeRaw: '' })], aliases: [{ rawName: 'Name 1', reportEmployee: 'Sale' }, { rawName: 'Name 2', reportEmployee: 'Sale' }] }, actor);
  await repo.upsertAlias({ rawName: 'Name 1', reportEmployee: 'Updated' }, actor);
  const snap = await repo.readSnapshot();
  assert.deepEqual(snap.aliases.map(a => [a.rawName, a.reportEmployee]), [['Name 1', 'Updated'], ['Name 2', 'Sale']]);
  assert.equal(snap.rawRows[0].employeeRaw, '');
});

test('monthly create and versioned edits separate report month from close date and atomically audit author', async t => {
  const { repo, db } = await setup(t);
  const row = await repo.createMonthlyRow(monthly, actor);
  assert.equal(row.version, '1');
  assert.equal(row.closedAt, '2026-09-30');
  assert.equal(row.reportMonth, 10);
  assert.equal('revenue' in row, false);
  const updated = await repo.updateMonthlyRow(row.id, '1', { ...monthly, note: 'Updated' }, actor);
  assert.equal(updated.version, '2');
  await assert.rejects(repo.updateMonthlyRow(row.id, '1', { ...monthly, note: 'Stale' }, actor), { code: 'MARKETING_VERSION_CONFLICT', statusCode: 409 });
  const audit = await repo.listMonthlyAudit(row.id);
  assert.equal(audit.length, 2);
  assert.equal(audit[0].actor.userId, '7');
  assert.equal(audit[1].before.note, '');
  assert.equal(audit[1].after.note, 'Updated');
  assert.equal((await repo.listMonthlyRows({ reportYear: 2026, reportMonth: 10 }))[0].note, 'Updated');
  assert.equal((await repo.listMonthlyRows({ reportYear: 2026, reportMonth: 9 })).length, 0);
  await assert.rejects(db.query('DELETE FROM marketing_monthly_audit'));
  await db.exec(`CREATE FUNCTION reject_audit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'audit failed'; END $$ LANGUAGE plpgsql;
    CREATE TRIGGER reject_audit BEFORE INSERT ON marketing_monthly_audit FOR EACH ROW EXECUTE FUNCTION reject_audit();`);
  await assert.rejects(repo.updateMonthlyRow(row.id, '2', { ...monthly, note: 'Unaudited' }, actor), { code: 'MARKETING_STORAGE_ERROR' });
  assert.equal((await repo.listMonthlyRows({ reportYear: 2026, reportMonth: 10 }))[0].version, '2');
});

test('history monthly import retains source identity and skips replay audit while rejecting conflicting source rows atomically', async t => {
  const { repo } = await setup(t);
  const batch = { batchKey: 'monthly-history', workbookId: 'book', rawRows: [historical()], monthlyRows: [{ ...monthly, sourceTab: 'BC tháng 10', sourceRow: 4 }] };
  await repo.importHistory(batch, actor);
  await repo.importHistory({ ...batch, batchKey: 'replay-new-key' }, actor);
  const [row] = await repo.listMonthlyRows({ reportYear: 2026, reportMonth: 10 });
  assert.equal(row.origin, 'sheet');
  assert.equal(row.sourceTab, 'BC tháng 10');
  assert.equal((await repo.listMonthlyAudit(row.id)).length, 1);
  await assert.rejects(repo.importHistory({ ...batch, batchKey: 'different-content', rawRows: [historical({ rowNumber: 99 })], monthlyRows: [{ ...monthly, sourceTab: 'BC tháng 10', sourceRow: 4, note: 'different' }] }, actor), { code: 'MARKETING_IMPORT_CONFLICT' });
  assert.equal((await repo.readSnapshot()).rawRows.length, 1);
});

test('adopted facts retain current API input without an observation and update it atomically on actual changes',async t=>{
 const {repo,db}=await setup(t);await repo.importHistory({batchKey:'canonical',workbookId:'book',rawRows:[historical({phone:'900000001',phoneKey:'900000001',employeeRaw:'First'})]},actor);
 const history=(await repo.readSnapshot()).rawRows[0];const row=apiRow({phone:'0900000001',phoneKey:history.phoneKey,historicalRowId:history.id});const run=await repo.startSyncRun({runKey:'canonical1'});await repo.commitPageSync({runId:run.id,pageId:HN,rows:[row]});
 let snapshot=await repo.readSnapshot();assert.equal(snapshot.facts[0].currentInput?.phone,'0900000001');assert.equal(snapshot.facts[0].currentInput?.employeeRaw,'First');assert.equal(snapshot.rawRows.length,1);
 const retry=await repo.startSyncRun({runKey:'canonical2'});const replay=await repo.commitPageSync({runId:retry.id,pageId:HN,rows:[row]});assert.equal(replay.newObservations,0);
 await db.exec("CREATE FUNCTION fail_canonical_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test atomic failure'; END $$; CREATE TRIGGER fail_canonical_update BEFORE UPDATE ON marketing_pancake_facts FOR EACH ROW EXECUTE FUNCTION fail_canonical_update();");
 const failed=await repo.startSyncRun({runKey:'canonical3'});await assert.rejects(repo.commitPageSync({runId:failed.id,pageId:HN,rows:[{...row,employeeRaw:'Changed'}]}),{code:'MARKETING_STORAGE_ERROR'});
 snapshot=await repo.readSnapshot();assert.equal(snapshot.facts[0].currentInput.employeeRaw,'First');assert.equal(snapshot.rawRows.length,1);
 await db.exec('DROP TRIGGER fail_canonical_update ON marketing_pancake_facts');const changed=await repo.startSyncRun({runKey:'canonical4'});await repo.commitPageSync({runId:changed.id,pageId:HN,rows:[{...row,employeeRaw:'Changed'}]});snapshot=await repo.readSnapshot();assert.equal(snapshot.facts[0].currentInput.employeeRaw,'Changed');assert.equal(snapshot.rawRows.length,2);
});

test('report snapshot excludes raw payloads and canonical facts but preserves aggregation provenance',async t=>{const {repo}=await setup(t);await repo.importHistory({batchKey:'lean',workbookId:'book',rawRows:[historical()],monthlyRows:[{...monthly,sourceTab:'BC tháng 10',sourceRow:3,raw:['private source']}]},actor);const full=await repo.readSnapshot(),lean=await repo.readSnapshot({includeRaw:false});assert.equal(lean.rawRows.length,full.rawRows.length);assert.equal(lean.rawRows[0].sourceOrder,full.rawRows[0].sourceOrder);assert.equal(lean.rawRows[0].raw,undefined);assert.equal(lean.monthlyRows[0].sourceRaw,undefined);assert.deepEqual(lean.facts,[]);assert.equal(lean.monthlyRows[0].id,full.monthlyRows[0].id);});

const independentCoverage={complete:true,since:0,until:1791000000,paginationExhausted:true};
test('Pancake independent store ignores imported baseline, preserves creation day, observes transitions and isolates failures',async t=>{
 const {repo,db}=await setup(t);
 await repo.importHistory({batchKey:'legacy',workbookId:'old',rawRows:[historical()],monthlyRows:[{...monthly,sourceRow:2,sourceTab:'BC'}]},actor);
 await repo.createMonthlyRow(monthly,actor);
 async function sync(key,employeeRaw,completedAt,pageId=HN){const run=await repo.startSyncRun({runKey:'pancake-independent:'+key});return repo.commitIndependentPageSync({runId:run.id,pageId,completedAt,rows:[apiRow({employeeRaw,sourceCreatedAt:'2026-09-30T17:30:00Z'})],coverage:independentCoverage});}
 await sync('one','A','2026-10-02T16:59:00Z');
 let snap=await repo.readIndependentSnapshot();assert.equal(snap.rawRows.length,1);assert.equal(snap.rawRows[0].creditedDate,'2026-10-01');assert.equal(snap.rawRows[0].observedAt,'2026-10-02T16:59:00.000Z');assert.equal(snap.monthlyRows.length,1);assert.equal(snap.monthlyRows[0].origin,'manual');assert.equal(snap.pages.find(p=>p.pageId===HN).coverage.complete,true);
 await sync('two','A','2026-10-02T17:01:00Z');assert.equal((await repo.readIndependentSnapshot()).rawRows.length,1);
 await sync('three','B','2026-10-02T17:02:00Z');await sync('four','A','2026-10-03T17:02:00Z');
 snap=await repo.readIndependentSnapshot();assert.deepEqual(snap.rawRows.map(r=>[r.employeeRaw,r.creditedDate]),[['A','2026-10-01'],['B','2026-10-03'],['A','2026-10-04']]);
 const failed=await repo.startSyncRun({runKey:'pancake-independent:failed'});await repo.failIndependentPageSync({runId:failed.id,pageId:HN,completedAt:'2026-10-04T17:02:00Z'});
 const after=await repo.readIndependentSnapshot({includeRaw:false});assert.equal(after.rawRows.length,3);assert.equal(after.pages.find(p=>p.pageId===HN).lastSuccessAt,'2026-10-03T17:02:00.000Z');assert.equal(after.pages.find(p=>p.pageId===HN).status,'error');assert.equal(after.rawRows[0].raw,undefined);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM marketing_pancake_observations')).rows[0].n,0);assert.equal((await db.query('SELECT count(*)::int AS n FROM marketing_history_rows')).rows[0].n,1);
 await sync('other-page','A','2026-10-04T17:03:00Z',TT);assert.equal((await repo.readIndependentSnapshot()).rawRows.length,4);
});
test('independent store rejects incomplete fetch and changed creation timestamps, and employee list reordering is idempotent',async t=>{
 const {repo}=await setup(t);const run=await repo.startSyncRun({runKey:'pancake-independent:first'});
 const args={runId:run.id,pageId:HN,completedAt:'2026-10-02T17:00:00Z',rows:[apiRow({employeeRaw:'A, B'})],coverage:independentCoverage};
 await assert.rejects(repo.commitIndependentPageSync({...args,coverage:{...independentCoverage,complete:false}}),{code:'INVALID_MARKETING_INPUT'});
 await repo.commitIndependentPageSync(args);
 const next=await repo.startSyncRun({runKey:'pancake-independent:next'});await repo.commitIndependentPageSync({...args,runId:next.id,rows:[apiRow({employeeRaw:'B, A'})]});assert.equal((await repo.readIndependentSnapshot()).rawRows.length,1);
 const third=await repo.startSyncRun({runKey:'pancake-independent:third'});await assert.rejects(repo.commitIndependentPageSync({...args,runId:third.id,rows:[apiRow({sourceCreatedAt:'2026-10-01T00:00:00Z'})]}),{code:'INVALID_MARKETING_INPUT'});assert.equal((await repo.readIndependentSnapshot()).rawRows.length,1);
});

test('independent commits batch thousands of facts with bounded queries and immutable observations',async t=>{
 const {db}=await setup(t);let queries=0;const query=async(...args)=>{queries++;return db.query(...args);};const repo=require(repositoryPath).createMarketingRepository({pool:{query,connect:async()=>({query,release(){}})}});
 const run=await repo.startSyncRun({runKey:'pancake-independent:bulk'});queries=0;
 const rows=Array.from({length:1001},(_,i)=>apiRow({sourceKey:'m'+String(i).padStart(4,'0'),messageId:'m'+i}));
 const saved=await repo.commitIndependentPageSync({runId:run.id,pageId:HN,rows,coverage:independentCoverage,completedAt:'2026-10-01T17:00:00Z'});assert.equal(saved.newFacts,1001);assert.equal(saved.newObservations,1001);assert.ok(queries<20,'batch SQL query count must not grow per row');
 await assert.rejects(db.query('UPDATE marketing_pancake_independent_observations SET credited_date=credited_date'));assert.equal((await repo.readIndependentSnapshot()).rawRows.length,1001);
});

test('assignment observation day precedes midnight publication and never shifts on repeated fetch',async t=>{
 const {repo}=await setup(t);
 async function sync(key,employeeRaw,assignmentObservedAt,completedAt){const run=await repo.startSyncRun({runKey:'pancake-independent:'+key});return repo.commitIndependentPageSync({runId:run.id,pageId:HN,rows:[apiRow({employeeRaw,raw:{assignmentObservedAt}})],coverage:independentCoverage,completedAt});}
 await sync('first-observation','A','2026-09-30T16:59:00Z','2026-09-30T17:30:00Z');
 await sync('second-observation','B','2026-10-01T16:59:00Z','2026-10-01T18:30:00Z');
 await sync('repeated-observation','B','2026-10-02T18:00:00Z','2026-10-02T18:30:00Z');
 const rows=(await repo.readIndependentSnapshot()).rawRows;assert.equal(rows.length,2);assert.equal(rows[1].observedAt,'2026-10-01T16:59:00.000Z');assert.equal(rows[1].creditedDate,'2026-10-01');assert.equal(rows[0].observedAt,'2026-09-30T16:59:00.000Z');
 await assert.rejects(sync('invalid-future','C','2026-10-03T18:00:00Z','2026-10-02T18:30:00Z'),{code:'INVALID_MARKETING_INPUT'});
});
