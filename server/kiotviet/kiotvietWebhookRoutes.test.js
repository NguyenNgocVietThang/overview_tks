'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createKiotVietWebhookRouter, createWebhookJsonErrorHandler, isValidWebhookSecret, normalizeBranch } = require('./kiotvietWebhookRoutes');

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

test('webhook responds 200 before handing branch/eventType/payload to background queue', () => {
  const events=[];
  const router=createKiotVietWebhookRouter({enabled:true,secret:'shh',enqueue:(event)=>events.push(['enqueue',event])});
  const res=fakeRes(events);
  handlerFor(router)({body:{sample:true},query:{secret:'shh',branch:'hanoi',eventType:'invoice.update'}},res);
  assert.equal(res.statusCode,200);
  assert.deepEqual(events,['response',['enqueue',{branch:'hanoi',eventType:'invoice.update',payload:{sample:true}}]]);
});

test('webhook still responds 200 and queues an unparsed body for safe capture', () => {
  const queued=[];
  const router=createKiotVietWebhookRouter({enabled:true,secret:'shh',enqueue:(event)=>queued.push(event)});
  const res=fakeRes([]);
  handlerFor(router)({body:'{not-json',query:{secret:'shh',branch:'saigon',eventType:'order.update'}},res);
  assert.equal(res.statusCode,200);
  assert.deepEqual(queued,[{branch:'saigon',eventType:'order.update',payload:'{not-json'}]);
});

test('disabled sync acknowledges webhook without touching the queue', () => {
  let touched=false;
  const router=createKiotVietWebhookRouter({enabled:false,secret:'shh',enqueue:()=>{touched=true;}});
  const res=fakeRes([]);
  handlerFor(router)({body:{sample:true},query:{secret:'shh'}},res);
  assert.equal(res.statusCode,200);
  assert.equal(touched,false);
});

test('wrong or missing secret acknowledges 200 but never reaches the queue (KiotViet disables endpoints after repeated 4xx)', () => {
  let touched=false;
  const router=createKiotVietWebhookRouter({enabled:true,secret:'shh',enqueue:()=>{touched=true;}});
  const res=fakeRes([]);
  handlerFor(router)({body:{sample:true},query:{secret:'wrong'}},res);
  assert.equal(res.statusCode,200);
  assert.equal(touched,false);

  const res2=fakeRes([]);
  handlerFor(router)({body:{sample:true},query:{}},res2);
  assert.equal(res2.statusCode,200);
  assert.equal(touched,false);
});

test('no KIOTVIET_WEBHOOK_SECRET configured fails closed (rejects every request, never enqueues)', () => {
  let touched=false;
  const router=createKiotVietWebhookRouter({enabled:true,secret:null,enqueue:()=>{touched=true;}});
  const res=fakeRes([]);
  handlerFor(router)({body:{sample:true},query:{secret:'anything'}},res);
  assert.equal(res.statusCode,200);
  assert.equal(touched,false);
});

test('malformed application/json is acknowledged and queued by the JSON error boundary with branch/eventType from query', () => {
  const queued=[];
  const events=[];
  const handler=createWebhookJsonErrorHandler({enabled:true,secret:'shh',enqueue:(event)=>queued.push(event)});
  const res=fakeRes(events);
  handler(new SyntaxError('Unexpected token'),{originalUrl:'/api/kiotviet/webhook',kiotvietRawBody:'{bad',query:{secret:'shh',branch:'hanoi',eventType:'product.update'}},res,()=>events.push('next'));
  assert.equal(res.statusCode,200);
  assert.deepEqual(queued,[{branch:'hanoi',eventType:'product.update',payload:'{bad'}]);
  assert.deepEqual(events,['response']);
});

test('isValidWebhookSecret requires a non-empty configured secret and an exact match', () => {
  assert.equal(isValidWebhookSecret('shh','shh'),true);
  assert.equal(isValidWebhookSecret('shh','nope'),false);
  assert.equal(isValidWebhookSecret(null,'shh'),false);
  assert.equal(isValidWebhookSecret('','shh'),false);
  assert.equal(isValidWebhookSecret('shh',undefined),false);
});

test('normalizeBranch only accepts hanoi/saigon, case-insensitive, else null', () => {
  assert.equal(normalizeBranch('hanoi'),'hanoi');
  assert.equal(normalizeBranch('SAIGON'),'saigon');
  assert.equal(normalizeBranch('danang'),null);
  assert.equal(normalizeBranch(undefined),null);
});
