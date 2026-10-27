'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('./locations-source.js');
const C=require('../../shared/carton.js');
test('mapRows: map dòng API sang dòng vị trí, bỏ dòng thiếu mã, SL không lấy từ totalQuantity',()=>{
  const rows=S.mapRows('HN',[{code:' A1 ',name:'Hàng A',totalQuantity:'999',notes:'5T x 100',location:'A01',arrivalDate:'4/10'},{code:'',notes:'x'},null,{code:'B2',name:null,notes:null,location:null,arrivalDate:null,totalQuantity:3}]);
  assert.equal(rows.length,2);
  assert.deepEqual([rows[0].branch,rows[0].code,rows[0].name,rows[0].location,rows[0].notes,rows[0].arrivalDate,rows[0].id],['HN','A1','Hàng A','A01','5T x 100','4/10','api-HN-0']);
  assert.equal(C.parseSpec(rows[0].notes).quantity,500,'SL từ ghi chú, không phải totalQuantity 999');
  assert.deepEqual([rows[1].name,rows[1].notes,rows[1].location],['','','']);
  assert.deepEqual(S.mapRows('SG',undefined),[]);
});
test('apply thay dòng demo bằng dòng thật của cả hai cơ sở, id không trùng giữa HN và SG',()=>{
  const data={locations:[{id:'loc-1',branch:'HN',code:'DEMO'}]};
  const label=S.apply(data,{HN:{rows:[{code:'A',notes:'1T x 1',location:'A1'}]},SG:{rows:[{code:'A',notes:'2T x 1',location:'A1'}]}});
  assert.equal(label,'Từ Vị trí hàng');assert.deepEqual(data.locations.map(r=>r.id),['api-HN-0','api-SG-0']);
});
test('load: file:// hoặc API lỗi/401 thì dự phòng dữ liệu demo; API tốt thì Từ Vị trí hàng',async()=>{
  assert.deepEqual(await S.load(async()=>{throw Error('không gọi');},'file:'),{label:'Dữ liệu demo',results:null});
  const bad=await S.load(async()=>({ok:false,status:401}),'http:');assert.equal(bad.label,'Dữ liệu demo');assert.equal(bad.results,null);
  const thrown=await S.load(async()=>{throw Error('mạng');},'https:');assert.equal(thrown.label,'Dữ liệu demo');
  const half=await S.load(async url=>url.includes('SG')?{ok:false,status:503}:{ok:true,json:async()=>({rows:[]})},'http:');assert.equal(half.label,'Dữ liệu demo','một cơ sở lỗi thì dùng demo cho cả hai, không trộn');
  const calls=[];const good=await S.load(async(url,opt)=>{calls.push([url,opt.credentials]);return {ok:true,json:async()=>({rows:[{code:'A'}]})};},'http:');
  assert.equal(good.label,'Từ Vị trí hàng');assert.deepEqual(calls.sort(),[['/api/stock-locations?branch=HN','same-origin'],['/api/stock-locations?branch=SG','same-origin']]);
});
