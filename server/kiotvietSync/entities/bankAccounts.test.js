'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
test('bank accounts from both retailers share an ID key and preserve actual names and raw', async t=>{
 const entity=require('./bankAccounts');
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE TABLE cash_book_accounts(id bigint primary key,bank_name text,account_no text,description text,raw jsonb not null,synced_at timestamptz default now())');
 await entity.upsertPage(db,'hanoi',[{id:11,bankName:'Bank HN',accountNumber:'001',description:'HN'}]);
 await entity.upsertPage(db,'saigon',[{Id:12,BankName:'Bank SG',AccountNumber:'002'},{id:11,bankName:'Updated'}]);
 const rows=(await db.query('SELECT id,bank_name,account_no,description,raw FROM cash_book_accounts ORDER BY id')).rows;
 assert.equal(rows.length,2);assert.equal(rows[0].bank_name,'Updated');assert.equal(rows[0].account_no,null);
 assert.equal(rows[1].bank_name,'Bank SG');assert.equal(rows[1].account_no,'002');assert.equal(rows[1].description,null);
 assert.equal(entity.endpoint,'bankaccounts');assert.equal(entity.pollFullSnapshot,true);assert.equal(entity.branchless,true);
});
