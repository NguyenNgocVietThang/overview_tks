'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createKiotVietWebhookRouter, createWebhookJsonErrorHandler } = require('./kiotvietWebhookRoutes');

function handlerFor(router) {
  const layer = router.stack.find((item) => item.route?.path === '/api/kiotviet/webhook');
  return layer.route.stack.at(-1).handle;
}

function fakeRes(events) {
  const res = { statusCode:null, body:null };
  res.status=(code)=>(res.statusCode=code,res);
  res.json=(body)=>(events.push('response'),res.body=body,res);
  return res;
}

test('webhook responds 200 before handing parsed payload to background queue', () => {
  const events=[];
  const router=createKiotVietWebhookRouter({enabled:true,enqueue:(payload)=>events.push(['enqueue',payload])});
  const res=fakeRes(events);
  handlerFor(router)({body:{sample:true}},res);
  assert.equal(res.statusCode,200);
  assert.deepEqual(events,['response',['enqueue',{sample:true}]]);
});

test('webhook still responds 200 and queues an unparsed body for safe capture', () => {
  const queued=[];
  const router=createKiotVietWebhookRouter({enabled:true,enqueue:(payload)=>queued.push(payload)});
  const res=fakeRes([]);
  handlerFor(router)({body:'{not-json'},res);
  assert.equal(res.statusCode,200);
  assert.deepEqual(queued,['{not-json']);
});

test('disabled sync acknowledges webhook without touching the queue', () => {
  let touched=false;
  const router=createKiotVietWebhookRouter({enabled:false,enqueue:()=>{touched=true;}});
  const res=fakeRes([]);
  handlerFor(router)({body:{sample:true}},res);
  assert.equal(res.statusCode,200);
  assert.equal(touched,false);
});

test('malformed application/json is acknowledged and queued by the JSON error boundary', () => {
  const queued=[];
  const events=[];
  const handler=createWebhookJsonErrorHandler({enabled:true,enqueue:(body)=>queued.push(body)});
  const res=fakeRes(events);
  handler(new SyntaxError('Unexpected token'),{originalUrl:'/api/kiotviet/webhook',kiotvietRawBody:'{bad'},res,()=>events.push('next'));
  assert.equal(res.statusCode,200);
  assert.deepEqual(queued,['{bad']);
  assert.deepEqual(events,['response']);
});
