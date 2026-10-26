(function(){
'use strict';
const D=window.PickingData,R=window.PickingRules,$=id=>document.getElementById(id);
const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={stock:{},orders:{},history:[]};let current,auditOnly=false;
const stock=r=>state.stock[r.id]||(state.stock[r.id]={onHand:R.quantity(r.available),locked:false});
const held=(id,except)=>Object.entries(state.orders).reduce((s,[k,o])=>s+(k===except?0:o.jobs.filter(j=>j.id===id).reduce((n,j)=>n+j.reserved,0)),0);
function summary(branch,code){
  const rows=D.get().locations.filter(r=>r.branch===branch&&R.key(r.code)===R.key(code));
  const unknown=!rows.length||rows.some(r=>stock(r).onHand===null);
  return {onHand:unknown?null:rows.reduce((s,r)=>s+stock(r).onHand,0),held:rows.reduce((s,r)=>s+held(r.id),0),available:unknown?null:rows.reduce((s,r)=>s+api.available(r),0)};
}
const api={version:0,confirmStock(r,q){const s=stock(r);if(s.onHand===null&&held(r.id)===0){s.onHand=q;log('Xác nhận khả dụng',r.location+' · '+q);}},available(r,except){const s=stock(r);return s.locked?0:s.onHand===null?null:Math.max(0,s.onHand-held(r.id,except));},has(o){return !!state.orders[D.key(o)];},reserve(o,allocations){
  const key=D.key(o),old=state.orders[key];
  if(old?.jobs.some(j=>j.taken>0))throw Error('Đơn đã bắt đầu nhặt. Dùng Kho nhặt hàng để lấy bù, không chỉ định lại toàn đơn.');
  const jobs=[];o.lines.forEach((l,i)=>(allocations[i]||[]).forEach(p=>jobs.push({id:p.id,line:i,reserved:p.quantity,taken:0,closed:false})));
  const used={};for(const j of jobs)used[j.id]=(used[j.id]||0)+j.reserved;
  for(const [id,q]of Object.entries(used)){const r=D.get().locations.find(r=>r.id===id);if(q>api.available(r,key))throw Error('Vị trí '+r.location+' không còn đủ khả dụng.');}
  state.orders[key]={order:o,jobs};log('Giữ chỗ',o.orderCode+' · '+jobs.reduce((s,j)=>s+j.reserved,0)+' sản phẩm');
},open(o,options={}){current=state.orders[D.key(o)];auditOnly=!!options.auditOnly;render();$('inventoryDialog').showModal();}};
function log(type,text){state.history.unshift({type,text,at:new Date().toLocaleTimeString('vi-VN')});api.version++;}
document.body.insertAdjacentHTML('beforeend',`<dialog id="inventoryDialog" style="width:min(1150px,96vw);max-height:94vh;padding:0;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:14px"><div class="dp-head"><div><p class="dp-kicker">KHO NHẶT HÀNG · MÔ PHỎNG</p><h2 id="inventoryTitle" class="dp-title"></h2><p class="dp-subtitle">Tồn vị trí − Giữ chỗ = Khả dụng. Chỉ trừ tồn theo số thực nhặt mới xác nhận.</p></div><button id="inventoryClose" class="dp-close">×</button></div><div id="inventoryBody" class="picking-body"></div></dialog>`);
$('inventoryClose').onclick=()=>$('inventoryDialog').close();
function render(){
const o=current.order,key=D.key(o),rows=D.get().locations.filter(r=>r.branch===o.branch),jobs=current.jobs;
$('inventoryTitle').textContent=o.orderCode+' · '+o.customerName;
$('inventoryBody').innerHTML=`<h3>1. Nhập số thực nhặt tại vị trí đã chỉ định</h3><p>Nhập số lấy thêm lần này. Nếu vị trí không đủ: chọn “Kết thúc tại vị trí này” để giải phóng phần giữ chỗ chưa lấy. Nếu báo hết, vị trí bị khóa chờ kiểm đếm.</p><div style="overflow:auto"><table class="dp-table"><thead><tr><th>Mã / vị trí</th><th>Đã nhặt</th><th>Còn giữ chỗ</th><th>Thực nhặt thêm</th><th>Xử lý</th></tr></thead><tbody>${jobs.map((j,i)=>{const r=rows.find(r=>r.id===j.id);return `<tr><td>${e(o.lines[j.line].productCode)} · ${e(r.location)}</td><td>${j.taken}</td><td>${j.reserved}</td><td><input aria-label="Thực nhặt dòng ${i}" id="taken-${i}" type="number" min="0" max="${j.reserved}" value="${j.reserved}" ${!j.reserved?'disabled':''} style="width:80px"></td><td>${j.reserved?`<label><input type="checkbox" id="finish-${i}"> Kết thúc tại vị trí này</label><br><label><input type="checkbox" id="empty-${i}"> Kho báo đã hết hàng</label><br><button data-take="${i}">Xác nhận thực nhặt</button>`:'Đã kết thúc'}</td></tr>`;}).join('')}</tbody></table></div><h3 style="margin-top:24px">2. Lấy bù số còn thiếu</h3>${o.lines.map((l,i)=>{
const taken=jobs.filter(j=>j.line===i).reduce((s,j)=>s+j.taken,0),reserved=jobs.filter(j=>j.line===i).reduce((s,j)=>s+j.reserved,0),missing=Math.max(0,l.quantity-taken-reserved);
return `<p><strong>${e(l.productCode)}</strong>: Đơn ${l.quantity} · Đã nhặt ${taken} · Đang giữ ${reserved} · <strong>Cần chỉ định bù ${missing}</strong> ${missing?`<button data-fill="${i}">Gợi ý & giữ chỗ lấy bù</button>`:taken===l.quantity?'✓ Đã nhặt đủ':''}</p>`;}).join('')}<h3>3. Sổ tồn vị trí & xử lý chênh lệch</h3><div style="overflow:auto"><table class="dp-table"><thead><tr><th>Mã / vị trí</th><th>Tồn sổ</th><th>Giữ chỗ mọi đơn</th><th>Khả dụng</th><th>Kiểm đếm & điều chỉnh</th></tr></thead><tbody>${rows.map(r=>{const s=stock(r);return `<tr><td>${e(r.code)} · ${e(r.location)}</td><td>${s.onHand??'Chưa rõ'}</td><td>${held(r.id)}</td><td>${s.locked?'🔒 Chờ kiểm đếm':api.available(r)??'Chưa rõ'}</td><td>${s.locked?`<label>Đếm còn <input id="count-${r.id}" type="number" min="0" placeholder="SL thực tế" style="width:90px"></label><input id="reason-${r.id}" placeholder="Lý do điều chỉnh" style="width:150px"><button data-count="${r.id}">Quản lý xác nhận</button>`:'Đang hoạt động'}</td></tr>`;}).join('')}</tbody></table></div><p id="inventoryError" style="color:var(--amber)" role="status"></p><h3 style="margin-top:24px">Lịch sử thao tác trong phiên thử</h3>${state.history.map(h=>`<p style="font-size:12px">${h.at} · <strong>${e(h.type)}</strong> · ${e(h.text)}</p>`).join('')}<p><small>Dữ liệu giữ trong bộ nhớ phiên thử. Tải lại trang sẽ đặt lại sổ tồn và giữ chỗ. Không ghi DB, không trừ tồn KiotViet.</small></p>`;
if(auditOnly){const body=$('inventoryBody'),heading=[...body.querySelectorAll('h3')].find(h=>h.textContent.startsWith('3.'));if(heading){while(body.firstChild!==heading)body.firstChild.remove();heading.textContent='Sổ tồn vị trí & xử lý chênh lệch';}}
}
$('inventoryBody').onclick=event=>{
try{
const b=event.target.closest('button');if(!b)return;
if(b.dataset.take!==undefined){const i=Number(b.dataset.take),j=current.jobs[i],input=$('taken-'+i).value,q=Number(input),r=D.get().locations.find(r=>r.id===j.id),s=stock(r);
if(input===''||!Number.isFinite(q)||q<0||q>j.reserved||s.onHand===null||q>s.onHand)throw Error('Số thực nhặt phải từ 0 đến lượng còn giữ chỗ và tồn sổ.');
s.onHand-=q;j.taken+=q;j.reserved-=q;
const end=$('finish-'+i).checked||$('empty-'+i).checked;if(end){j.reserved=0;j.closed=true;}
if($('empty-'+i).checked){s.locked=true;log('Khóa vị trí',r.code+' · '+r.location+' báo hết hàng, tồn sổ còn '+s.onHand);}
log('Thực nhặt',current.order.orderCode+' · '+r.location+' lấy '+q+(end?' · giải phóng giữ chỗ còn lại':''));
}else if(b.dataset.fill!==undefined){const i=Number(b.dataset.fill),l=current.order.lines[i],missing=l.quantity-current.jobs.filter(j=>j.line===i).reduce((s,j)=>s+j.taken+j.reserved,0),rows=D.get().locations.filter(r=>r.branch===current.order.branch&&R.key(r.code)===R.key(l.productCode)).map(r=>({...r,available:api.available(r)}));
const excluded=new Set(current.jobs.filter(j=>j.line===i&&j.closed).map(j=>j.id));
const result=R.suggest(missing,rows.filter(r=>!excluded.has(r.id)));for(const p of result.picks)current.jobs.push({id:p.id,line:i,reserved:p.quantity,taken:0});
log('Giữ chỗ lấy bù',l.productCode+' · giữ thêm '+(missing-result.shortage)+' · chưa phân bổ được '+result.shortage);
}else if(b.dataset.count){const id=b.dataset.count,r=D.get().locations.find(r=>r.id===id),raw=$('count-'+id).value,q=Number(raw),reason=$('reason-'+id).value.trim();
if(raw===''||!Number.isFinite(q)||q<0||!reason)throw Error('Nhập số kiểm đếm không âm và lý do điều chỉnh.');
if(held(id)>0)throw Error('Còn giữ chỗ của đơn khác. Cần xử lý các giữ chỗ trước khi điều chỉnh.');
const s=stock(r),before=s.onHand;s.onHand=q;s.locked=false;log('Quản lý điều chỉnh',r.code+' · '+r.location+' từ '+before+' → '+q+' · '+reason);
}render();window.PickingPopup?.attach();
}catch(err){$('inventoryError').textContent=err.message;}
};
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('inventoryDialog').open)event.stopImmediatePropagation();},true);
window.PickingInventory=api;
api.summary=summary;
api.record=o=>state.orders[D.key(o)];
api.confirmActual=(o,entries)=>{
  const record=api.record(o),changes=[],used={};if(!record)throw Error('Cần xác nhận chỉ định trước.');
  entries.forEach((entry,i)=>{
    if(entry.value===undefined||entry.value==='')return;
    const job=record.jobs[i],value=Number(entry.value),delta=value-job.taken;
    if(!Number.isFinite(value)||delta<0||delta>job.reserved)throw Error('Thực nhặt lũy kế phải từ số đã xác nhận đến số đã chỉ định. Sửa giảm cần xử lý hoàn/sửa sai riêng.');
    used[job.id]=(used[job.id]||0)+delta;changes.push({job,value,delta,outcome:entry.outcome||'continue'});
  });
  Object.entries(used).forEach(([id,q])=>{const row=D.get().locations.find(r=>r.id===id);if(stock(row).onHand===null||q>stock(row).onHand)throw Error('Không đủ tồn vị trí để xác nhận thực nhặt.');});
  let changed=false;
  for(const c of changes){const row=D.get().locations.find(r=>r.id===c.job.id),s=stock(row);const end=['end','empty'].includes(c.outcome);
    if(c.delta||!c.job.reported||c.job.outcome!==c.outcome){s.onHand-=c.delta;c.job.taken=c.value;c.job.reserved-=c.delta;c.job.reported=true;c.job.outcome=c.outcome;if(end){c.job.reserved=0;c.job.closed=true;}if(c.outcome==='empty')s.locked=true;changed=true;log('Xác nhận thực nhặt',o.orderCode+' · '+row.location+' lũy kế '+c.value+' (tăng '+c.delta+')');}
  }
  if(changed)record.delivery=null;return changed;
};
api.fill=(o,line,options={})=>{
  const record=api.record(o),item=o.lines[line],missing=item.quantity-record.jobs.filter(j=>j.line===line).reduce((s,j)=>s+j.taken+j.reserved,0);
  if(missing<=0)return;
  const excluded=new Set(record.jobs.filter(j=>j.line===line&&j.closed).map(j=>j.id));
  const rows=D.get().locations.filter(r=>r.branch===o.branch&&R.key(r.code)===R.key(item.productCode)&&!excluded.has(r.id)).map(r=>({...r,available:api.available(r)}));
  const result=R.suggest(missing,rows),batch=options.batch||Math.max(1,...record.jobs.map(j=>j.batch||1))+1;
  result.picks.forEach(p=>record.jobs.push({id:p.id,line,reserved:p.quantity,taken:0,planned:p.quantity,batch,closed:false}));
  if(result.picks.length){record.delivery=null;log('Phiếu bổ sung',o.orderCode+' · '+item.productCode+' giữ '+(missing-result.shortage)+' · thiếu '+result.shortage);}
  return result;
};
})();
