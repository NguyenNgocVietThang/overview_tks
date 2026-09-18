'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWebhookEventQueue } = require('./webhookEventQueue');

test('queue stores payloads sequentially using parameterized SQL', async () => {
  const calls=[];
  let releaseFirst;
  const firstBlocked=new Promise((resolve)=>{releaseFirst=resolve;});
  const pool={query:async (...args)=>{calls.push(args);if(calls.length===1)await firstBlocked;}};
  const queue=createWebhookEventQueue({pool,logger:{error(){}}});
  queue.enqueue({event:1});
  queue.enqueue({event:2});
  await new Promise(setImmediate);
  assert.equal(calls.length,1);
  releaseFirst();
  await queue.onIdle();
  assert.equal(calls.length,2);
  assert.match(calls[0][0],/VALUES \(\$1\)/);
  assert.deepEqual(calls.map((call)=>call[1][0]),[{event:1},{event:2}]);
});

test('malformed text is logged and captured without stopping later payloads', async () => {
  const saved=[];
  const errors=[];
  const queue=createWebhookEventQueue({pool:{query:async (_sql,params)=>saved.push(params[0])},logger:{error:(message)=>errors.push(message)}});
  queue.enqueue('{not-json');
  queue.enqueue({event:2});
  await queue.onIdle();
  assert.equal(errors.length,1);
  assert.deepEqual(saved,[{raw:'{not-json',parseError:true},{event:2}]);
});

test('a database failure does not drop or block later queued payloads', async () => {
  let attempt=0;
  const saved=[];
  const queue=createWebhookEventQueue({pool:{query:async (_sql,params)=>{attempt++;if(attempt===1)throw new Error('db down');saved.push(params[0]);}},logger:{error(){}}});
  queue.enqueue({event:1});queue.enqueue({event:2});
  await queue.onIdle();
  assert.deepEqual(saved,[{event:2}]);
});

test('enqueue({branch,eventType,payload}) preserves metadata and forwards it to processEvent after the raw insert', async () => {
  const inserted=[];
  const processed=[];
  const queue=createWebhookEventQueue({
    pool:{query:async (_sql,params)=>{inserted.push(params[0]);}},
    logger:{error(){}},
    processEvent:async (event)=>{processed.push(event);}
  });
  queue.enqueue({branch:'hanoi',eventType:'invoice.update',payload:{Id:1}});
  await queue.onIdle();
  assert.deepEqual(inserted,[{Id:1}]);
  assert.deepEqual(processed,[{branch:'hanoi',eventType:'invoice.update',payload:{Id:1}}]);
});

test('a processEvent failure is logged but does not stop later payloads (raw insert already durable)', async () => {
  const processed=[];
  const errors=[];
  const queue=createWebhookEventQueue({
    pool:{query:async ()=>{}},
    logger:{error:(message)=>errors.push(message)},
    processEvent:async (event)=>{
      processed.push(event.eventType);
      if (event.eventType==='order.update') throw new Error('boom');
    }
  });
  queue.enqueue({branch:'hanoi',eventType:'order.update',payload:{}});
  queue.enqueue({branch:'hanoi',eventType:'invoice.update',payload:{}});
  await queue.onIdle();
  assert.deepEqual(processed,['order.update','invoice.update']);
  assert.equal(errors.length,1);
});

test('bare payload without a "payload" key stays backward compatible (branch/eventType default to null)', async () => {
  const processed=[];
  const queue=createWebhookEventQueue({
    pool:{query:async ()=>{}},
    logger:{error(){}},
    processEvent:async (event)=>{processed.push(event);}
  });
  queue.enqueue({event:1});
  await queue.onIdle();
  assert.deepEqual(processed,[{branch:null,eventType:null,payload:{event:1}}]);
});
