'use strict';

const { createHash } = require('node:crypto');

const PAGE_IDS = Object.freeze(['1184366971419195', '1144127138790204', '430840296781378', '1094883173717378', '1222318524308489', '1387564787764418']);
const PAGE_NAMES = Object.freeze(['Hữu Nghị', 'Tân Thanh', 'Bắc Lãm', 'Phú Lương', 'HN-SG', 'Dương Nội']);
const SAFE_FAILURES = new Set(['PANCAKE_UNAVAILABLE', 'PANCAKE_UNAUTHORIZED', 'PANCAKE_INVALID_RESPONSE', 'MARKETING_STORAGE_ERROR', 'INVALID_MARKETING_INPUT', 'MARKETING_SYNC_INTERRUPTED']);
function error(code, statusCode = 400) {
  return Object.assign(new Error(code === 'MARKETING_STORAGE_ERROR' ? 'Marketing storage operation failed.' : 'Marketing operation could not be completed.'), { code, statusCode });
}
function invalid() { throw error('INVALID_MARKETING_INPUT'); }
function text(value, fallback = '') {
  if (value == null) return fallback;
  if (typeof value !== 'string') invalid();
  return value;
}
function required(value) { const out = text(value); if (!out.trim()) invalid(); return out; }
function page(value) { if (!PAGE_IDS.includes(value)) invalid(); return value; }
function id(value) { if (!/^[1-9]\d*$/.test(String(value))) invalid(); return String(value); }
function date(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid();
  const d = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value) invalid();
  return value;
}
function timestamp(value, nullable = false) {
  if ((value == null || value === '') && nullable) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) invalid();
  date(value.slice(0, 10));
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) invalid();
  return d.toISOString();
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function hash(value) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function actorShape(actor) { return { userId: required(actor?.userId), username: text(actor?.username), name: text(actor?.name) }; }
function rawJson(value) { return value ?? {}; }
function iso(value) { return value == null ? null : new Date(value).toISOString(); }
function camel(row) {
  if (!row) return null;
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    const name = key.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
    out[name] = value instanceof Date ? value.toISOString() : value;
    if (value != null && ['id','runId','factId','batchId','historicalRowId','version','sourceOrder'].includes(name)) out[name] = String(value);
  }
  return out;
}
const monthlyColumns = `id::text AS id,report_year,report_month,sale,customer,customer_directory_id,phone,page_id,page,status,data_source,
 closed_at::text AS closed_at,new_customer,note,origin,workbook_id,source_tab,source_row,source_raw,version::text AS version,created_at,updated_at`;
function monthlyShape(row) { const out = camel(row); if (out) { out.createdAt = iso(out.createdAt); out.updatedAt = iso(out.updatedAt); } return out; }
function monthlyInput(input = {}) {
  if (!Number.isInteger(input.reportYear) || input.reportYear < 1900 || input.reportYear > 9999 || !Number.isInteger(input.reportMonth) || input.reportMonth < 1 || input.reportMonth > 12) invalid();
  return { reportYear: input.reportYear, reportMonth: input.reportMonth, sale: text(input.sale), customer: text(input.customer),
    customerDirectoryId: input.customerDirectoryId == null ? null : required(input.customerDirectoryId), phone: text(input.phone),
    pageId: input.pageId == null || input.pageId === '' ? null : page(input.pageId), page: text(input.page), status: text(input.status),
    dataSource: text(input.dataSource), closedAt: date(input.closedAt), newCustomer: text(input.newCustomer), note: text(input.note) };
}
function monthlyValues(row) { return [row.reportYear,row.reportMonth,row.sale,row.customer,row.customerDirectoryId,row.phone,row.pageId,row.page,row.status,row.dataSource,row.closedAt,row.newCustomer,row.note]; }
function historyInput(row) {
  if (!Number.isInteger(row.rowNumber) || row.rowNumber < 1) invalid();
  return { tab: required(row.tab), rowNumber: row.rowNumber, pageId: page(row.pageId), sourceCreatedAt: timestamp(row.sourceCreatedAt, true),
    sourceCreatedText: text(row.sourceCreatedText), phone: required(row.phone), phoneKey: required(row.phoneKey ?? row.phone), employeeRaw: text(row.employeeRaw), creditedDate: date(row.creditedDate), raw: rawJson(row.raw) };
}
const IDENTITY_RESOLUTIONS = ['unique','verified-notation','equivalent'];
function identityLinkInput(link) {
  if (!Number.isInteger(link.rowNumber) || link.rowNumber < 1 || !IDENTITY_RESOLUTIONS.includes(link.resolution)) invalid();
  return { tab: required(link.tab), rowNumber: link.rowNumber, pageId: page(link.pageId), messageId: required(link.messageId), conversationId: text(link.conversationId),
    createdAt: timestamp(link.createdAt), resolution: link.resolution, groupKey: link.groupKey == null ? null : required(link.groupKey), evidence: rawJson(link.evidence) };
}
function baselineInput(row) {
  return { pageId: page(row.pageId), messageId: required(row.messageId), conversationId: text(row.conversationId), createdAt: timestamp(row.createdAt), evidence: rawJson(row.evidence) };
}
function apiInput(row) {
  if (!['INBOX','COMMENT'].includes(row.type)) invalid();
  return { sourceKey: required(row.sourceKey), messageId: required(row.messageId), conversationId: text(row.conversationId), type: row.type,
    phone: required(row.phone), phoneKey: required(row.phoneKey ?? row.phone), employeeRaw: text(row.employeeRaw), sourceCreatedAt: timestamp(row.sourceCreatedAt), raw: rawJson(row.raw),
    historicalRowId: row.historicalRowId == null ? null : id(row.historicalRowId) };
}
// Ignore volatile raw API metadata for retry identity; retain the full payload on each actual observation.
function factHash(row) { const { raw, historicalRowId, ...facts } = row; return hash(facts); }

function createMarketingRepository({ pool = require('../db/pool').getPool() } = {}) {
  async function transaction(work, readOnly = false) {
    const client = await pool.connect();
    try {
      await client.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => {});
      throw cause;
    } finally { client.release(); }
  }
  function safe(fn) {
    return async (...args) => {
      try { return await fn(...args); }
      catch (cause) { if (cause?.code?.startsWith('MARKETING_') || cause?.code === 'INVALID_MARKETING_INPUT') throw cause; throw error('MARKETING_STORAGE_ERROR', 503); }
    };
  }
  async function writeAudit(client, row, author, action, before = null) {
    await client.query(`INSERT INTO marketing_monthly_audit(row_id,action,version,actor,before_row,after_row) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb)`,
      [row.id,action,row.version,JSON.stringify(author),before == null ? null : JSON.stringify(before),JSON.stringify(row)]);
  }
  async function insertMonthly(client, input, author, source = null) {
    const row = monthlyInput(input);
    const sourceHash = source ? hash({ row, raw: rawJson(input.raw) }) : null;
    if (source) {
      const existing = (await client.query('SELECT source_hash FROM marketing_monthly_rows WHERE workbook_id=$1 AND source_tab=$2 AND source_row=$3', [source.workbookId,source.tab,source.row])).rows[0];
      if (existing) { if (existing.source_hash !== sourceHash) throw error('MARKETING_IMPORT_CONFLICT',409); return null; }
    }
    const saved = monthlyShape((await client.query(`INSERT INTO marketing_monthly_rows(report_year,report_month,sale,customer,customer_directory_id,phone,page_id,page,status,data_source,closed_at,new_customer,note,origin,workbook_id,source_tab,source_row,source_hash,source_raw)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::date,$12,$13,$14,$15,$16,$17,$18,$19::jsonb) RETURNING ${monthlyColumns}`,
      [...monthlyValues(row),source ? 'sheet' : 'manual',source?.workbookId ?? null,source?.tab ?? null,source?.row ?? null,sourceHash,source ? JSON.stringify(rawJson(input.raw)) : null])).rows[0]);
    await writeAudit(client,saved,author,source ? 'import' : 'create');
    return saved;
  }
  async function aliasWrite(client, input, author) {
    return camel((await client.query(`INSERT INTO marketing_employee_aliases(raw_name,report_employee,actor) VALUES($1,$2,$3::jsonb)
      ON CONFLICT(raw_name) DO UPDATE SET report_employee=excluded.report_employee,actor=excluded.actor,updated_at=now() RETURNING raw_name,report_employee,updated_at,actor`,
      [required(input.rawName),required(input.reportEmployee),JSON.stringify(author)])).rows[0]);
  }
  async function importHistory(input, actor) {
    const batchKey = required(input.batchKey), workbookId = required(input.workbookId), author = actorShape(actor);
    const rows = (input.rawRows ?? []).map(historyInput).sort((a,b) => PAGE_IDS.indexOf(a.pageId)-PAGE_IDS.indexOf(b.pageId) || a.tab.localeCompare(b.tab) || a.rowNumber-b.rowNumber);
    const monthlyRows = input.monthlyRows ?? [], aliases = input.aliases ?? [];
    const contentHash = hash({ workbookId,rows,monthlyRows,aliases });
    return transaction(async client => {
      // Serializes workbook imports, including concurrent different batch keys.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`marketing-import:${workbookId}`]);
      const existing = (await client.query('SELECT id::text AS id,content_hash,imported_at FROM marketing_import_batches WHERE batch_key=$1',[batchKey])).rows[0];
      if (existing) { if (existing.content_hash !== contentHash) throw error('MARKETING_IMPORT_CONFLICT',409); return { id:existing.id,importedAt:iso(existing.imported_at),replayed:true }; }
      const batch = (await client.query('INSERT INTO marketing_import_batches(batch_key,workbook_id,content_hash,actor) VALUES($1,$2,$3,$4::jsonb) RETURNING id::text AS id,imported_at',[batchKey,workbookId,contentHash,JSON.stringify(author)])).rows[0];
      for (const row of rows) {
        const content = hash(row);
        const previous = (await client.query('SELECT content_hash FROM marketing_history_rows WHERE workbook_id=$1 AND source_tab=$2 AND source_row=$3',[workbookId,row.tab,row.rowNumber])).rows[0];
        if (previous) { if (previous.content_hash !== content) throw error('MARKETING_IMPORT_CONFLICT',409); continue; }
        await client.query(`INSERT INTO marketing_history_rows(batch_id,workbook_id,source_tab,source_row,page_id,source_created_at,source_created_text,phone,phone_key,employee_raw,credited_date,raw,content_hash)
          VALUES($1,$2,$3,$4,$5,$6::timestamptz,$7,$8,$9,$10,$11::date,$12::jsonb,$13)`,
          [batch.id,workbookId,row.tab,row.rowNumber,row.pageId,row.sourceCreatedAt,row.sourceCreatedText,row.phone,row.phoneKey,row.employeeRaw,row.creditedDate,JSON.stringify(row.raw),content]);
      }
      for (const row of monthlyRows) {
        if (!Number.isInteger(row.sourceRow) || row.sourceRow < 1) invalid();
        await insertMonthly(client,row,author,{ workbookId,tab:required(row.sourceTab),row:row.sourceRow });
      }
      for (const alias of aliases) await aliasWrite(client,alias,author);
      return { id:batch.id,importedAt:iso(batch.imported_at),replayed:false };
    });
  }
  // Records which Pancake message each Sheets history row came from (many rows may share one message, one row may
  // be equivalent to several) plus the messages the Sheets baseline never counted. Every link is verified against
  // the stored row (page and creation second) before it is written; nothing about the history itself changes.
  async function importIdentities(input, actor) {
    const batchKey = required(input.batchKey), workbookId = required(input.workbookId), author = actorShape(actor);
    const links = (input.links ?? []).map(identityLinkInput), baseline = (input.baselineMessages ?? []).map(baselineInput);
    const contentHash = hash({ workbookId, links, baseline });
    return transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`marketing-import:${workbookId}`]);
      const existing = (await client.query('SELECT id::text AS id,content_hash,imported_at FROM marketing_import_batches WHERE batch_key=$1',[batchKey])).rows[0];
      if (existing) { if (existing.content_hash !== contentHash) throw error('MARKETING_IMPORT_CONFLICT',409); return { id:existing.id,importedAt:iso(existing.imported_at),replayed:true }; }
      const batch = (await client.query('INSERT INTO marketing_import_batches(batch_key,workbook_id,content_hash,actor) VALUES($1,$2,$3,$4::jsonb) RETURNING id::text AS id,imported_at',[batchKey,workbookId,contentHash,JSON.stringify(author)])).rows[0];
      const refs = new Map();
      for (let i = 0; i < links.length; i += 2000) {
        const part = links.slice(i,i+2000);
        const found = (await client.query(`SELECT h.id::text AS id,h.source_tab,h.source_row,h.page_id,h.source_created_at FROM marketing_history_rows h
          JOIN jsonb_to_recordset($2::jsonb) AS t(tab text,row int) ON h.source_tab=t.tab AND h.source_row=t.row WHERE h.workbook_id=$1`,[workbookId,JSON.stringify(part.map(l=>({tab:l.tab,row:l.rowNumber})))])).rows;
        for (const row of found) refs.set(`${row.source_tab}\u0000${row.source_row}`,row);
      }
      const resolved = links.map(link => {
        const row = refs.get(`${link.tab}\u0000${link.rowNumber}`);
        if (!row || row.page_id !== link.pageId || iso(row.source_created_at) !== link.createdAt) throw error('MARKETING_IMPORT_CONFLICT',409);
        return { history_row_id: row.id, page_id: link.pageId, message_id: link.messageId, conversation_id: link.conversationId, resolution: link.resolution, group_key: link.groupKey, evidence: link.evidence };
      });
      for (let i = 0; i < resolved.length; i += 2000) {
        await client.query(`INSERT INTO marketing_history_identities(batch_id,history_row_id,page_id,message_id,conversation_id,resolution,group_key,evidence)
          SELECT $1,t.history_row_id,t.page_id,t.message_id,t.conversation_id,t.resolution,t.group_key,t.evidence
          FROM jsonb_to_recordset($2::jsonb) AS t(history_row_id bigint,page_id text,message_id text,conversation_id text,resolution text,group_key text,evidence jsonb)`,[batch.id,JSON.stringify(resolved.slice(i,i+2000))]);
      }
      for (let i = 0; i < baseline.length; i += 2000) {
        await client.query(`INSERT INTO marketing_baseline_messages(page_id,message_id,batch_id,conversation_id,source_created_at,classification,evidence)
          SELECT t.page_id,t.message_id,$1,t.conversation_id,t.created_at::timestamptz,'in-window-not-in-sheets',t.evidence
          FROM jsonb_to_recordset($2::jsonb) AS t(page_id text,message_id text,conversation_id text,created_at text,evidence jsonb)`,
          [batch.id,JSON.stringify(baseline.slice(i,i+2000).map(b=>({page_id:b.pageId,message_id:b.messageId,conversation_id:b.conversationId,created_at:b.createdAt,evidence:b.evidence})))]);
      }
      return { id:batch.id,importedAt:iso(batch.imported_at),replayed:false,links:links.length,baselineMessages:baseline.length };
    });
  }
  async function upsertAlias(input, actor) { return aliasWrite(pool,input,actorShape(actor)); }
  async function startSyncRun({ runKey, startedAt = new Date().toISOString() }) {
    required(runKey); timestamp(startedAt);
    return transaction(async client => {
      const run = (await client.query(`INSERT INTO marketing_sync_runs(run_key,started_at) VALUES($1,$2::timestamptz)
        ON CONFLICT(run_key) DO UPDATE SET run_key=excluded.run_key RETURNING id::text AS id,status,started_at,finished_at`,[runKey,startedAt])).rows[0];
      await client.query('INSERT INTO marketing_sync_pages(run_id,page_id) SELECT $1,page_id FROM marketing_pages ON CONFLICT DO NOTHING',[run.id]);
      return camel(run);
    });
  }
  async function lockPage(client, runId, pageId) {
    const run = (await client.query('SELECT status FROM marketing_sync_runs WHERE id=$1 FOR UPDATE',[runId])).rows[0];
    if (!run) throw error('MARKETING_SYNC_CONFLICT',409);
    await client.query('SELECT page_id FROM marketing_pages WHERE page_id=$1 FOR UPDATE',[pageId]);
    const result = (await client.query('SELECT * FROM marketing_sync_pages WHERE run_id=$1 AND page_id=$2 FOR UPDATE',[runId,pageId])).rows[0];
    if (!result) throw error('MARKETING_SYNC_CONFLICT',409);
    return { run,result };
  }
  async function failPageSync({ runId, pageId, completedAt = new Date().toISOString(), errorCode = 'PANCAKE_UNAVAILABLE' }) {
    runId=id(runId); pageId=page(pageId); completedAt=timestamp(completedAt);
    const code=SAFE_FAILURES.has(errorCode) ? errorCode : 'PANCAKE_UNAVAILABLE';
    return transaction(async client => {
      const {run,result}=await lockPage(client,runId,pageId);
      if (result.status==='success' || run.status!=='running') throw error('MARKETING_SYNC_CONFLICT',409);
      await client.query(`UPDATE marketing_sync_pages SET status='error',completed_at=$3::timestamptz,error_code=$4 WHERE run_id=$1 AND page_id=$2`,[runId,pageId,completedAt,code]);
      await client.query(`UPDATE marketing_pages SET status='error',last_attempt_at=$2::timestamptz,error_code=$3 WHERE page_id=$1`,[pageId,completedAt,code]);
      return { pageId,status:'error',errorCode:code };
    });
  }
  async function commitPageSync({ runId, pageId, completedAt = new Date().toISOString(), completionNow, rows, midnightAttempt = 0 }) {
    runId=id(runId); pageId=page(pageId); completedAt=timestamp(completedAt);
    if (!Array.isArray(rows)) invalid();
    const inputs=rows.map(apiInput), payloadHash=hash(inputs.map(factHash));
    if (new Set(inputs.map(r=>r.sourceKey)).size!==inputs.length) invalid();
    try {
      return await transaction(async client => {
        const {run,result}=await lockPage(client,runId,pageId);
        if (result.status==='success') {
          if (result.payload_hash!==payloadHash) throw error('MARKETING_SYNC_CONFLICT',409);
          return camel(result);
        }
        if (run.status!=='running') throw error('MARKETING_SYNC_CONFLICT',409);
        const creditedDate=(await client.query("SELECT ($1::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS date",[completedAt])).rows[0].date;
        let newFacts=0,newObservations=0;
        for (const row of inputs) {
          const content=factHash(row);
          let fact=(await client.query('SELECT id::text AS id,latest_hash FROM marketing_pancake_facts WHERE page_id=$1 AND source_key=$2 FOR UPDATE',[pageId,row.sourceKey])).rows[0];
          if (!fact) {
            let historical=null;
            if (row.historicalRowId) {
              historical=(await client.query('SELECT page_id,phone_key,employee_raw,source_created_at,credited_date::text AS credited_date FROM marketing_history_rows WHERE id=$1',[row.historicalRowId])).rows[0];
              if (!historical || historical.page_id!==pageId || historical.phone_key!==row.phoneKey) invalid();
              // Either the legacy exact creation time, or a verified identity link between this row and this message.
              if (iso(historical.source_created_at)!==row.sourceCreatedAt && !(await client.query('SELECT 1 FROM marketing_history_identities WHERE history_row_id=$1 AND message_id=$2',[row.historicalRowId,row.messageId])).rows.length) invalid();
            }
            fact=(await client.query(`INSERT INTO marketing_pancake_facts(page_id,source_key,historical_row_id,credited_date,first_seen_run_id,latest_hash,current_input)
              VALUES($1,$2,$3,$4::date,$5,$6,$7::jsonb) RETURNING id::text AS id,latest_hash`,[pageId,row.sourceKey,row.historicalRowId,historical ? historical.credited_date : creditedDate,runId,content,JSON.stringify(row)])).rows[0];
            newFacts++;
            if (historical && historical.employee_raw===row.employeeRaw) continue;
          } else if (fact.latest_hash===content) {
            await client.query('UPDATE marketing_pancake_facts SET current_input=$2::jsonb WHERE id=$1',[fact.id,JSON.stringify(row)]);
            continue;
          }
          await client.query(`INSERT INTO marketing_pancake_observations(fact_id,run_id,source_created_at,credited_date,message_id,conversation_id,type,phone,phone_key,employee_raw,raw,content_hash)
            VALUES($1,$2,$3::timestamptz,$4::date,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)`,[fact.id,runId,row.sourceCreatedAt,creditedDate,row.messageId,row.conversationId,row.type,row.phone,row.phoneKey,row.employeeRaw,JSON.stringify(row.raw),content]);
          await client.query('UPDATE marketing_pancake_facts SET latest_hash=$2,current_input=$3::jsonb WHERE id=$1',[fact.id,content,JSON.stringify(row)]);
          newObservations++;
        }
        // Sample after all source writes, immediately before publishing page success.
        if (completionNow) {
          completedAt=timestamp(completionNow().toISOString());
          const finalDate=(await client.query("SELECT ($1::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS date",[completedAt])).rows[0].date;
          // Immutable observations cannot be patched. Roll back the whole page and
          // repeat once with the successful-day timestamp when writes cross midnight.
          if(finalDate!==creditedDate)throw Object.assign(new Error('MARKETING_DAY_CHANGED'),{code:'MARKETING_DAY_CHANGED',completedAt});
        }
        const saved=(await client.query(`UPDATE marketing_sync_pages SET status='success',completed_at=$3::timestamptz,error_code=NULL,payload_hash=$4,input_count=$5,new_facts=$6,new_observations=$7
          WHERE run_id=$1 AND page_id=$2 RETURNING *`,[runId,pageId,completedAt,payloadHash,inputs.length,newFacts,newObservations])).rows[0];
        await client.query(`UPDATE marketing_pages SET status='success',last_success_at=$2::timestamptz,last_attempt_at=$2::timestamptz,error_code=NULL WHERE page_id=$1`,[pageId,completedAt]);
        return camel(saved);
      });
    } catch (cause) {
      if(cause?.code==='MARKETING_DAY_CHANGED'&&midnightAttempt<1)return commitPageSync({runId,pageId,rows,completedAt:cause.completedAt,completionNow,midnightAttempt:midnightAttempt+1});
      if (cause?.code==='MARKETING_SYNC_CONFLICT') throw cause;
      const code=cause?.code==='INVALID_MARKETING_INPUT' ? cause.code : 'MARKETING_STORAGE_ERROR';
      await failPageSync({runId,pageId,completedAt,errorCode:code}).catch(()=>{});
      throw error(code,code==='MARKETING_STORAGE_ERROR' ? 503 : 400);
    }
  }
  async function syncRun(client, runId) {
    const run=camel((await client.query('SELECT id::text AS id,run_key,started_at,finished_at,status FROM marketing_sync_runs WHERE id=$1',[runId])).rows[0]);
    if (!run) return null;
    run.pages=(await client.query('SELECT run_id::text AS run_id,page_id,status,completed_at,error_code,input_count,new_facts,new_observations FROM marketing_sync_pages WHERE run_id=$1 ORDER BY page_id',[runId])).rows.map(camel);
    return run;
  }
  async function getLatestSlotRun(runKey) {
    required(runKey);
    return transaction(async client => {
      const row=(await client.query('SELECT id::text AS id FROM marketing_sync_runs WHERE run_key=$1 OR starts_with(run_key,$2) ORDER BY id DESC LIMIT 1',[runKey,runKey+':retry:1'])).rows[0];
      return row ? syncRun(client,row.id) : null;
    },true);
  }
  async function getSyncRun(runId) { return transaction(client=>syncRun(client,id(runId)),true); }
  async function finishSyncRun(runId) {
    runId=id(runId);
    return transaction(async client => {
      const run=(await client.query('SELECT status,run_key FROM marketing_sync_runs WHERE id=$1 FOR UPDATE',[runId])).rows[0];
      if (!run) throw error('MARKETING_SYNC_CONFLICT',409);
      if (run.status==='running') {
        const pending=(await client.query(`SELECT page_id FROM marketing_sync_pages WHERE run_id=$1 AND status='pending' ORDER BY page_id`,[runId])).rows;
        for (const item of pending) {
          await client.query(`UPDATE ${run.run_key?.startsWith('pancake-independent:')?'marketing_pancake_independent_page_state':'marketing_pages'} SET status='error',last_attempt_at=now(),error_code='MARKETING_SYNC_INTERRUPTED' WHERE page_id=$1`,[item.page_id]);
        }
        await client.query(`UPDATE marketing_sync_pages SET status='error',completed_at=now(),error_code='MARKETING_SYNC_INTERRUPTED' WHERE run_id=$1 AND status='pending'`,[runId]);
        await client.query(`UPDATE marketing_sync_runs SET status=CASE WHEN EXISTS(SELECT 1 FROM marketing_sync_pages WHERE run_id=$1 AND status!='success') THEN 'error' ELSE 'success' END,finished_at=now() WHERE id=$1`,[runId]);
      }
      return syncRun(client,runId);
    });
  }
  async function createMonthlyRow(input, actor) { const author=actorShape(actor); return transaction(client=>insertMonthly(client,input,author)); }
  async function updateMonthlyRow(rowId, expectedVersion, input, actor) {
    rowId=id(rowId); expectedVersion=id(expectedVersion); const row=monthlyInput(input),author=actorShape(actor);
    return transaction(async client => {
      const before=monthlyShape((await client.query(`SELECT ${monthlyColumns} FROM marketing_monthly_rows WHERE id=$1 FOR UPDATE`,[rowId])).rows[0]);
      if (!before || before.version!==expectedVersion) throw error('MARKETING_VERSION_CONFLICT',409);
      const after=monthlyShape((await client.query(`UPDATE marketing_monthly_rows SET report_year=$1,report_month=$2,sale=$3,customer=$4,customer_directory_id=$5,phone=$6,page_id=$7,page=$8,status=$9,data_source=$10,closed_at=$11::date,new_customer=$12,note=$13,version=version+1,updated_at=now() WHERE id=$14 AND version=$15 RETURNING ${monthlyColumns}`,[...monthlyValues(row),rowId,expectedVersion])).rows[0]);
      if (!after) throw error('MARKETING_VERSION_CONFLICT',409);
      await writeAudit(client,after,author,'update',before);
      return after;
    });
  }
  async function listMonthlyRows({reportYear,reportMonth}) {
    monthlyInput({reportYear,reportMonth});
    return (await pool.query(`SELECT ${monthlyColumns} FROM marketing_monthly_rows WHERE report_year=$1 AND report_month=$2 ORDER BY id`,[reportYear,reportMonth])).rows.map(monthlyShape);
  }
  async function listMonthlyAudit(rowId) {
    return (await pool.query('SELECT id::text AS id,row_id::text AS row_id,action,version::text AS version,actor,before_row AS before,after_row AS after,created_at FROM marketing_monthly_audit WHERE row_id=$1 ORDER BY version',[id(rowId)])).rows.map(camel);
  }
  async function failIndependentPageSync({runId,pageId,completedAt=new Date().toISOString(),errorCode='PANCAKE_UNAVAILABLE'}) {
    runId=id(runId);pageId=page(pageId);completedAt=timestamp(completedAt);
    const code=SAFE_FAILURES.has(errorCode)?errorCode:'PANCAKE_UNAVAILABLE';
    return transaction(async client=>{
      const {run,result}=await lockPage(client,runId,pageId);
      if(run.status!=='running'||result.status==='success')throw error('MARKETING_SYNC_CONFLICT',409);
      await client.query("UPDATE marketing_sync_pages SET status='error',completed_at=$3::timestamptz,error_code=$4 WHERE run_id=$1 AND page_id=$2",[runId,pageId,completedAt,code]);
      await client.query("UPDATE marketing_pancake_independent_page_state SET status='error',last_attempt_at=$2::timestamptz,error_code=$3 WHERE page_id=$1",[pageId,completedAt,code]);
      return {pageId,status:'error',errorCode:code};
    });
  }
  async function commitIndependentPageSync({runId,pageId,rows,completedAt=new Date().toISOString(),coverage}) {
    runId=id(runId);pageId=page(pageId);completedAt=timestamp(completedAt);
    if(!Array.isArray(rows)||coverage?.complete!==true||coverage.since!==0||!Number.isInteger(coverage.until))invalid();
    const inputs=rows.map(apiInput).sort((a,b)=>a.sourceCreatedAt.localeCompare(b.sourceCreatedAt)||a.sourceKey.localeCompare(b.sourceKey));
    if(new Set(inputs.map(r=>r.sourceKey)).size!==inputs.length)invalid();
    const payloadHash=hash(inputs.map(factHash));
    return transaction(async client=>{
      const {run,result}=await lockPage(client,runId,pageId);
      const key=(await client.query('SELECT run_key FROM marketing_sync_runs WHERE id=$1',[runId])).rows[0]?.run_key;
      if(!key?.startsWith('pancake-independent:'))throw error('MARKETING_SYNC_CONFLICT',409);
      if(result.status==='success'){if(result.payload_hash!==payloadHash)throw error('MARKETING_SYNC_CONFLICT',409);return camel(result);}
      if(run.status!=='running')throw error('MARKETING_SYNC_CONFLICT',409);
      let newFacts=0,newObservations=0;
      // Page lock serializes writers; bounded bulk batches avoid one network round trip per message.
      for(let offset=0;offset<inputs.length;offset+=1000){
        const batch=inputs.slice(offset,offset+1000);
        const existing=(await client.query('SELECT id::text AS id,source_key,latest_hash,source_created_at FROM marketing_pancake_independent_facts WHERE page_id=$1 AND source_key=ANY($2::text[]) FOR UPDATE',[pageId,batch.map(r=>r.sourceKey)])).rows;
        const byKey=new Map(existing.map(f=>[f.source_key,f]));
        const changes=[];
        for(const row of batch){
          const fact=byKey.get(row.sourceKey);
          if(fact&&iso(fact.source_created_at)!==row.sourceCreatedAt)throw error('INVALID_MARKETING_INPUT');
          const content=hash({...row,raw:null,historicalRowId:null,employeeRaw:row.employeeRaw.split(', ').filter(Boolean).sort().join(', ')});
          if(fact?.latest_hash===content)continue;
          const observedAt=timestamp(row.raw?.assignmentObservedAt??completedAt);
          if(observedAt>completedAt)throw error('INVALID_MARKETING_INPUT');
          changes.push({observed_at:observedAt,source_key:row.sourceKey,source_created_at:row.sourceCreatedAt,content_hash:content,input:row,
            credited_date:new Date(+new Date(fact?observedAt:row.sourceCreatedAt)+7*3600000).toISOString().slice(0,10)});
          if(!fact)newFacts++;
        }
        if(!changes.length)continue;
        const savedFacts=(await client.query(`INSERT INTO marketing_pancake_independent_facts(page_id,source_key,source_created_at,latest_hash,current_input)
          SELECT $1,t.source_key,t.source_created_at::timestamptz,t.content_hash,t.input
          FROM jsonb_to_recordset($2::jsonb) AS t(source_key text,source_created_at text,content_hash text,input jsonb)
          ORDER BY t.source_created_at,t.source_key
          ON CONFLICT(page_id,source_key) DO UPDATE SET latest_hash=excluded.latest_hash,current_input=excluded.current_input
          RETURNING id::text AS id,source_key`,[pageId,JSON.stringify(changes)])).rows;
        const ids=new Map(savedFacts.map(f=>[f.source_key,f.id]));
        await client.query(`INSERT INTO marketing_pancake_independent_observations(fact_id,run_id,observed_at,credited_date,input)
          SELECT t.fact_id,$1,t.observed_at::timestamptz,t.credited_date::date,t.input
          FROM jsonb_to_recordset($2::jsonb) AS t(fact_id bigint,observed_at text,credited_date text,input jsonb) ORDER BY t.input->>'sourceCreatedAt',t.input->>'sourceKey'`,
          [runId,JSON.stringify(changes.map(change=>({fact_id:ids.get(change.source_key),observed_at:change.observed_at,credited_date:change.credited_date,input:change.input})))]);
        newObservations+=changes.length;
      }
      const saved=(await client.query("UPDATE marketing_sync_pages SET status='success',completed_at=$3::timestamptz,error_code=NULL,payload_hash=$4,input_count=$5,new_facts=$6,new_observations=$7 WHERE run_id=$1 AND page_id=$2 RETURNING *",[runId,pageId,completedAt,payloadHash,inputs.length,newFacts,newObservations])).rows[0];
      await client.query("UPDATE marketing_pancake_independent_page_state SET status='success',last_success_at=$2::timestamptz,last_attempt_at=$2::timestamptz,error_code=NULL,coverage=$3::jsonb WHERE page_id=$1",[pageId,completedAt,JSON.stringify(coverage)]);
      return camel(saved);
    });
  }
  async function readIndependentSnapshot({includeRaw=true}={}) {
    return transaction(async client=>{
      const pages=(await client.query('SELECT p.page_id,p.name,p.platform,s.status,s.last_success_at,s.last_attempt_at,s.error_code,s.coverage FROM marketing_pages p JOIN marketing_pancake_independent_page_state s ON s.page_id=p.page_id ORDER BY p.page_id')).rows.map(camel);
      const aliases=(await client.query('SELECT raw_name,report_employee,updated_at,actor FROM marketing_employee_aliases ORDER BY raw_name')).rows.map(camel);
      const observations=(await client.query(`SELECT o.id::text AS id,o.fact_id::text AS fact_id,o.run_id::text AS run_id,o.source_order::text AS source_order,o.observed_at,o.credited_date::text AS credited_date,${includeRaw?'o.input':"o.input - 'raw'"} AS input,f.page_id,f.source_key FROM marketing_pancake_independent_observations o JOIN marketing_pancake_independent_facts f ON f.id=o.fact_id ORDER BY o.source_order`)).rows;
      const rawRows=observations.map(row=>{const {input,...meta}=row;const out={...input,...camel(meta),origin:'pancake',independent:true};if(!includeRaw)delete out.raw;return out;});
      const monthlyRows=(await client.query(`SELECT ${includeRaw?monthlyColumns:monthlyColumns.replace(',source_raw','')} FROM marketing_monthly_rows WHERE origin='manual' ORDER BY report_year,report_month,id`)).rows.map(monthlyShape);
      const latest=(await client.query("SELECT id::text AS id FROM marketing_sync_runs WHERE starts_with(run_key,'pancake-independent:') ORDER BY id DESC LIMIT 1")).rows[0];
      return {pages,aliases,rawRows,monthlyRows,facts:[],latestRun:latest?await syncRun(client,latest.id):null};
    },true);
  }
  async function readSnapshot({ includeRaw = true, includeIdentities = false } = {}) {
    return transaction(async client => {
      const pages=(await client.query('SELECT page_id,name,platform,status,last_success_at,last_attempt_at,error_code FROM marketing_pages ORDER BY page_id')).rows.map(camel);
      const aliases=(await client.query('SELECT raw_name,report_employee,updated_at,actor FROM marketing_employee_aliases ORDER BY raw_name')).rows.map(camel);
      const facts=includeRaw ? (await client.query('SELECT id::text AS id,page_id,source_key,historical_row_id::text AS historical_row_id,credited_date::text AS credited_date,first_seen_run_id::text AS first_seen_run_id,current_input FROM marketing_pancake_facts ORDER BY id')).rows.map(camel) : [];
      const history=(await client.query(`SELECT id::text AS id,batch_id::text AS batch_id,workbook_id,source_tab AS tab,source_row AS row_number,source_order::text AS source_order,page_id,source_created_at,source_created_text,phone,phone_key,employee_raw,credited_date::text AS credited_date${includeRaw ? ",raw" : ""} FROM marketing_history_rows ORDER BY source_order`)).rows.map(row=>({...camel(row),origin:'sheet',sourceCreatedAt:iso(row.source_created_at)}));
      const observations=(await client.query(`SELECT o.id::text AS id,o.fact_id::text AS fact_id,o.run_id::text AS run_id,o.source_order::text AS source_order,f.page_id,f.source_key,f.historical_row_id::text AS historical_row_id,o.source_created_at,o.credited_date::text AS credited_date,o.message_id,o.conversation_id,o.type,o.phone,o.phone_key,o.employee_raw${includeRaw ? ",o.raw" : ""} FROM marketing_pancake_observations o JOIN marketing_pancake_facts f ON f.id=o.fact_id ORDER BY o.source_order`)).rows.map(row=>({...camel(row),origin:'pancake',sourceCreatedAt:iso(row.source_created_at)}));
      const rawRows=[...history,...observations].sort((a,b)=>BigInt(a.sourceOrder)<BigInt(b.sourceOrder) ? -1 : 1);
      const monthlyRows=(await client.query(`SELECT ${includeRaw ? monthlyColumns : monthlyColumns.replace(",source_raw", "")} FROM marketing_monthly_rows ORDER BY report_year,report_month,id`)).rows.map(monthlyShape);
      const latestRunId=(await client.query("SELECT id::text AS id FROM marketing_sync_runs WHERE NOT starts_with(run_key,'pancake-independent:') ORDER BY id DESC LIMIT 1")).rows[0]?.id;
      // Identity links are only needed by sync; report reads skip them.
      const identities=includeIdentities ? (await client.query('SELECT history_row_id::text AS history_row_id,page_id,message_id,resolution FROM marketing_history_identities')).rows.map(camel) : [];
      const baselineMessages=includeIdentities ? (await client.query('SELECT page_id,message_id FROM marketing_baseline_messages')).rows.map(camel) : [];
      return {pages,aliases,facts,rawRows,monthlyRows,identities,baselineMessages,latestRun:latestRunId ? await syncRun(client,latestRunId) : null};
    },true);
  }
  return Object.fromEntries(Object.entries({importHistory,importIdentities,readIndependentSnapshot,commitIndependentPageSync,failIndependentPageSync,upsertAlias,startSyncRun,commitPageSync,failPageSync,finishSyncRun,getSyncRun,getLatestSlotRun,readSnapshot,createMonthlyRow,updateMonthlyRow,listMonthlyRows,listMonthlyAudit}).map(([name,fn])=>[name,safe(fn)]));
}

module.exports={createMarketingRepository,PAGE_IDS,PAGE_NAMES};
