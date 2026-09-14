'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const CONFIG=require('../config');
const {getPool}=require('../db/pool');
const {runMigrations}=require('../db/migrate');
test('webhook_events_raw migration is present on configured Supabase',{skip:CONFIG.SUPABASE_DB_URL?false:'SUPABASE_DB_URL chưa cấu hình — bỏ qua test tích hợp'},async(t)=>{
  const pool=getPool();t.after(()=>pool.end());
  await runMigrations({pool,logger:{log(){}}});
  const result=await pool.query("SELECT to_regclass('public.webhook_events_raw') AS table_name");
  assert.equal(result.rows[0].table_name,'webhook_events_raw');
});
