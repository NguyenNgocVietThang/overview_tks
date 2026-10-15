'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||= '{}';
process.env.JWT_SECRET ||= 'fixture';
const repository=require('./repository');
const router=require('../routes');
function handler(path){return router.stack.find(layer=>layer.route?.path===path).route.stack.at(-1).handle;}
function response(){return {statusCode:200,status(n){this.statusCode=n;return this;},json(data){this.body=data;return this;}};}
test('route never accepts fullAccess escalation from query and follows effective permission',async()=>{
  const original=repository.getContainerDetails;const calls=[];
  repository.getContainerDetails=async args=>{calls.push(args);return {rows:[],fullAccess:args.fullAccess};};
  try {
    const res=response();
    await handler('/api/product-report/containers')({user:{vaiTro:'Nhân viên sale'},query:{code:'SKU',fullAccess:'true'}},res);
    assert.equal(res.statusCode,200);assert.equal(calls[0].fullAccess,false);
    await handler('/api/product-report/containers')({user:{vaiTro:'Nhân viên sale',featurePermissions:{'reports.overview.containers.full':true}},query:{code:'SKU'}},response());
    assert.equal(calls[1].fullAccess,true);
    await handler('/api/product-report/containers')({user:{vaiTro:'Quản lý',featurePermissions:{'reports.overview.containers.full':false}},query:{code:'SKU'}},response());
    assert.equal(calls[2].fullAccess,false);
  } finally {repository.getContainerDetails=original;}
});
test('unexpected source/DB error is sanitized while unavailable snapshot retains metadata',async()=>{
  const original=repository.getContainerDetails;
  try {
    repository.getContainerDetails=async()=>{throw Error('postgres private credentials');};
    const res=response();await handler('/api/product-report/containers')({user:{},query:{code:'SKU'}},res);
    assert.equal(res.statusCode,503);assert.doesNotMatch(JSON.stringify(res.body),/credentials/);
    repository.getContainerDetails=async()=>{throw Object.assign(Error('Chưa sẵn sàng'),{statusCode:503,code:'CONTAINER_SNAPSHOT_UNAVAILABLE',containerSync:{available:false}});};
    await handler('/api/product-report/containers')({user:{},query:{code:'SKU'}},res);
    assert.equal(res.body.containerSync.available,false);
  } finally {repository.getContainerDetails=original;}
});
test('metadata endpoint only uses DB repository and sanitizes unexpected errors',async()=>{
  const original=repository.getContainerMeta;
  try {
    repository.getContainerMeta=async()=>({containerSync:{version:'v1'}});
    const res=response();await handler('/api/product-report/containers/meta')({},res);
    assert.equal(res.body.containerSync.version,'v1');
    repository.getContainerMeta=async()=>{throw Error('private');};
    await handler('/api/product-report/containers/meta')({},res);
    assert.equal(res.statusCode,503);assert.doesNotMatch(JSON.stringify(res.body),/private/);
  } finally {repository.getContainerMeta=original;}
});
