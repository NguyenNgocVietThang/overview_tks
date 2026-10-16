'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createKiotVietWebhookRouter, createWebhookJsonErrorHandler, captureWebhookRawBody, isWebhookUrl } = require('./kiotvietWebhookRoutes');

function handlerFor(router) {
  const layer = router.stack.find((item) => item.route?.path === '/api/kiotviet/webhook');
  return layer.route.stack.at(-1).handle;
}

/** Route co secret: POST /api/kiotviet/webhook/:secret */
function secretHandlerFor(router) {
  const layer = router.stack.find((item) => item.route?.path === '/api/kiotviet/webhook/:secret');
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

// ---------------------------------------------------------------------------
// Xac thuc bang secret tren duong dan (KiotViet khong gui header tuy y duoc)
// ---------------------------------------------------------------------------

test('secret dung -> 200 va day su kien vao hang doi', () => {
  const events = [];
  const router = createKiotVietWebhookRouter({ enabled: true, secret: 's3cret', enqueue: (p) => events.push(['enqueue', p]) });
  const res = fakeRes(events);
  secretHandlerFor(router)({ params: { secret: 's3cret' }, body: { sample: true } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(events, ['response', ['enqueue', { sample: true }]]);
});

test('secret sai -> 404 va KHONG day gi vao hang doi', () => {
  let touched = false;
  const router = createKiotVietWebhookRouter({ enabled: true, secret: 's3cret', enqueue: () => { touched = true; } });
  const res = fakeRes([]);
  secretHandlerFor(router)({ params: { secret: 'sai-secret' }, body: { sample: true } }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(touched, false);
});

test('secret do dai khac nhau khong lam no timingSafeEqual', () => {
  const router = createKiotVietWebhookRouter({ enabled: true, secret: 'secret-rat-dai', enqueue: () => {} });
  const res = fakeRes([]);
  assert.doesNotThrow(() => secretHandlerFor(router)({ params: { secret: 'x' }, body: {} }, res));
  assert.equal(res.statusCode, 404);
});

test('chua cau hinh secret -> duong dan co secret luon 404', () => {
  let touched = false;
  const router = createKiotVietWebhookRouter({ enabled: true, secret: '', enqueue: () => { touched = true; } });
  const res = fakeRes([]);
  secretHandlerFor(router)({ params: { secret: 'bat-ky' }, body: {} }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(touched, false);
});

test('duong dan cu khong secret: tat bang co thi tra 404', () => {
  let touched = false;
  const router = createKiotVietWebhookRouter({ enabled: true, legacyPathEnabled: false, enqueue: () => { touched = true; } });
  const res = fakeRes([]);
  handlerFor(router)({ body: { sample: true } }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(touched, false);
});

test('JSON hong tren URL co secret: dung secret thi van vao hang doi raw', () => {
  const queued = [];
  const handler = createWebhookJsonErrorHandler({ enabled: true, secret: 's3cret', enqueue: (b) => queued.push(b) });
  const res = fakeRes([]);
  handler(new SyntaxError('x'), { originalUrl: '/api/kiotviet/webhook/s3cret', kiotvietRawBody: '{bad' }, res, () => {});
  assert.equal(res.statusCode, 200);
  assert.deepEqual(queued, ['{bad']);
});

test('JSON hong tren URL co secret SAI: 404, khong ai nhet duoc rac vao hang doi', () => {
  const queued = [];
  const handler = createWebhookJsonErrorHandler({ enabled: true, secret: 's3cret', enqueue: (b) => queued.push(b) });
  const res = fakeRes([]);
  handler(new SyntaxError('x'), { originalUrl: '/api/kiotviet/webhook/sai', kiotvietRawBody: '{bad' }, res, () => {});
  assert.equal(res.statusCode, 404);
  assert.deepEqual(queued, []);
});

test('captureWebhookRawBody nhan ca duong dan co secret lan duong dan cu', () => {
  assert.equal(isWebhookUrl('/api/kiotviet/webhook'), true);
  assert.equal(isWebhookUrl('/api/kiotviet/webhook/abc?x=1'), true);
  assert.equal(isWebhookUrl('/api/kiotviet/webhook-gia'), false);
  assert.equal(isWebhookUrl('/api/auth/me'), false);

  const req = { originalUrl: '/api/kiotviet/webhook/abc' };
  captureWebhookRawBody(req, null, Buffer.from('{raw}', 'utf8'));
  assert.equal(req.kiotvietRawBody, '{raw}');
});
