(function(){
'use strict';
const D=window.PickingData,R=window.PickingRules,C=window.PickingCarton,$=id=>document.getElementById(id);
const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={stock:{},orders:{},history:[],changes:{HN:[],SG:[]}};let current,auditOnly=false;
const stock=r=>state.stock[r.id]||(state.stock[r.id]={specText:undefined,locked:false});
const ledger=()=>window.PickingLedger;
/* SL của một vị trí LUÔN suy ra từ Ghi chú hàng hóa (5T x 100 = 500), kể cả khi import: cột SL của file hoặc số "khả dụng"
   của dữ liệu thử không phải nguồn chính. Ghi chú rỗng/sai định dạng thì không tính được SL (null) và vị trí không chỉ định được.
   Ghi chú hiện hành là chuỗi do lần nhập tay/trừ thùng gần nhất, nếu chưa có thì cột Ghi chú hàng hóa của file kiểm kê
   hoặc ghi chú của tab Vị trí hàng (lấy chuỗi đọc được trước). */
function specText(r){
  const s=stock(r);if(s.specText!==undefined)return s.specText;
  const opening=ledger()?.opening(r.branch,r.code,r.location);
  const texts=[opening?.spec,r.notes].map(v=>String(v??'').trim());
  return texts.find(t=>t&&C.parseSpec(t))??texts.find(Boolean)??'';
}
const specOf=r=>C.parseSpec(specText(r));
/* Khi đã nạp kiểm kê cho cơ sở, vị trí chưa có tồn đầu (khu chưa chốt giờ) vẫn là "chưa có tồn xác nhận". */
function onHand(r){
  const book=ledger();
  if(book&&book.has(r.branch)&&!r.manual&&!book.opening(r.branch,r.code,r.location))return null;
  return specOf(r)?.quantity??null;
}
// Khu đang kiểm kê thì không ra đơn ở khu đó: vị trí không khả dụng cho tới khi chốt kỳ kiểm kê.
const freeze=r=>ledger()?.frozen(r.branch,r.location)||null;
/* Lịch sử chỉnh sửa vị trí theo cơ sở (HN không lẫn SG), mới nhất lên đầu, tối đa 500 dòng mỗi cơ sở.
   Mọi thay đổi ghi chú/SL của vị trí đi qua setText() nên chỉ có MỘT chỗ ghi lịch sử. Người thực hiện: prototype chưa có đăng nhập. */
const HISTORY_KEY='tks-picking-location-history-v1',HISTORY_LIMIT=500,DEMO_USER='Người dùng demo';
try{const saved=JSON.parse(localStorage.getItem(HISTORY_KEY)||'null');if(saved&&Array.isArray(saved.HN)&&Array.isArray(saved.SG))state.changes=saved;}catch{}
function saveHistory(){try{localStorage.setItem(HISTORY_KEY,JSON.stringify(state.changes));}catch{/* Offline file may deny localStorage: keep the session copy. */}}
/* Danh mục mã hàng → tên của prototype (không có bảng sản phẩm riêng): tên từ dòng kiểm kê đã import, dòng vị trí có tên,
   rồi dòng đơn cùng mã (demo.js, kiem-ke-demo.js). Mã không tra được thì tên trống. */
const names=new Map(),nameKey=code=>String(code??'').trim().toLowerCase();
function nameOf(code){
  const key=nameKey(code);if(names.has(key))return names.get(key);
  const row=D.get().locations.find(r=>r.name&&nameKey(r.code)===key);if(row)return row.name;
  for(const o of D.get().orders||[])for(const l of o.lines||[])if(l.productName&&nameKey(l.productCode)===key)return l.productName;
  return '';
}
// Chỉ dòng nhập tay mới bị cảnh báo mã chưa có trong danh mục (dòng import/demo không mang tên riêng).
const isUnknownCode=r=>!!r.manual&&!r.name&&!nameOf(r.code);
// raw=true (hoàn tác) ghi lại đúng chuỗi gốc đã lưu, không chuẩn hóa. Chỉ khác khoảng trắng thì đổi chuỗi nhưng không ghi lịch sử thừa.
function setText(r,text,source,orderCode='',raw=false){
  const beforeText=specText(r),beforeQty=specOf(r)?.quantity??null;
  if(!raw)text=C.normalizeNote(text);
  stock(r).specText=text;
  const afterQty=specOf(r)?.quantity??null;
  if(beforeQty===afterQty&&beforeText.replace(/\s+/g,'')===text.replace(/\s+/g,''))return;
  pushChange(r,beforeText,beforeQty,text,afterQty,source,orderCode);
}
function pushChange(r,notesBefore,qtyBefore,notesAfter,qtyAfter,source,orderCode=''){
  const list=state.changes[r.branch]||(state.changes[r.branch]=[]);
  list.unshift({at:new Date().toISOString(),branch:r.branch,code:r.code,location:r.location,notesBefore,notesAfter,qtyBefore,qtyAfter,source,orderCode,user:DEMO_USER,warnings:C.warnings(notesAfter,{unknownCode:isUnknownCode(r)})});
  if(list.length>HISTORY_LIMIT)list.length=HISTORY_LIMIT;
  saveHistory();api.version++;
}
// Sổ kiểm kê chỉ ghi nhật ký biến động khi vị trí đã có tồn đầu; SL hiển thị vẫn do ghi chú quyết định.
function ledgerRecord(r,type,quantity){
  const book=ledger();
  if(book&&book.opening(r.branch,r.code,r.location))book.record({branch:r.branch,code:r.code,location:r.location,type,quantity:type==='adjust'?String(quantity):quantity});
}
// Trừ hàng khỏi ghi chú theo quy tắc thùng nguyên / phần trừ lẻ; ghi chú không đọc được thì không trừ được.
function applyPick(r,q,source,orderCode){
  const spec=specOf(r);
  if(!spec||q>spec.quantity+1e-6)throw Error('Vị trí '+r.location+' chưa có ghi chú hợp lệ hoặc không đủ SL để nhặt.');
  ledgerRecord(r,'pick',q);
  const d=C.deduct(spec,q);setText(r,d.text,source,orderCode);return d;
}
// Kiểm đếm một số tuyệt đối: ghi lại thành quy cách đầu tiên (thùng nguyên + phần trừ lẻ), không sinh số thùng thập phân.
function setCount(r,quantity,source='Sửa tay'){
  const before=onHand(r),spec=specOf(r),p=spec?spec.terms[0]?.perCarton:null;
  if(quantity===0)setText(r,C.EMPTY_NOTE,source);
  else{
    if(!(p>0))throw Error('Ghi chú vị trí chưa có quy cách thùng để quy đổi số kiểm đếm. Nhập ghi chú dạng 5T x 100 trước.');
    const full=Math.floor(quantity/p),rem=quantity-full*p;
    setText(r,rem===0?full+'T x '+p:(full+1)+'T x '+p+' - '+(p-rem),source);
  }
  if(ledger()?.opening(r.branch,r.code,r.location)&&before!==null)ledgerRecord(r,'adjust',quantity-before);
  return before;
}
const held=(id,except)=>Object.entries(state.orders).reduce((s,[k,o])=>s+(k===except?0:o.jobs.filter(j=>j.id===id).reduce((n,j)=>n+j.reserved,0)),0);
function summary(branch,code){
  const rows=D.get().locations.filter(r=>r.branch===branch&&R.key(r.code)===R.key(code));
  // Vị trí ghi chú sai định dạng không tính được SL: bị loại khỏi tổng (và không chỉ định được), không làm cả mã thành "chưa xác định".
  const counted=rows.filter(r=>specOf(r)),unknown=!counted.length||counted.some(r=>onHand(r)===null);
  return {onHand:unknown?null:counted.reduce((s,r)=>s+onHand(r),0),held:rows.reduce((s,r)=>s+held(r.id),0),available:unknown?null:counted.reduce((s,r)=>s+api.available(r),0)};
}
const api={version:0,/* available() là số CẤP ĐƯỢC cho đơn mới nên không âm — không lấy được âm sản phẩm.
   Nhưng số 0 ở đây có thể là "hết hàng" hoặc "đang giữ vượt tồn", hai việc khác nhau.
   Vì vậy chênh lệch giữ-vượt-tồn không bị clamp che: xem api.conflicts(). */
available(r,except){const s=stock(r),total=onHand(r);return freeze(r)?null:s.locked?0:total===null?null:Math.max(0,total-held(r.id,except));},
availableRaw(r,except){const total=onHand(r);return total===null?null:total-held(r.id,except);},
/* Vị trí đang giữ chỗ nhiều hơn tồn sổ. Xảy ra khi nạp kỳ kiểm kê mới có số thấp hơn
   lượng đã giữ cho các đơn đang xử lý, hoặc khi điều chỉnh giảm tồn. Phải báo để kế toán
   xử lý từng đơn; không tự hủy giữ chỗ của đơn đang nhặt. */
conflicts(branch){
  return D.get().locations.filter(r=>(!branch||r.branch===branch)).map(r=>{
    const total=onHand(r),reserved=held(r.id);
    return total===null?null:reserved>total+1e-6?{id:r.id,branch:r.branch,code:r.code,location:r.location,onHand:total,held:reserved,excess:Math.round((reserved-total)*1e6)/1e6,negative:total<0}:null;
  }).filter(Boolean);
},
orders(locationId){
  return Object.entries(state.orders).filter(([,o])=>o.jobs.some(j=>j.id===locationId&&j.reserved>0))
    .map(([key,o])=>({key,orderCode:o.order.orderCode,reserved:o.jobs.filter(j=>j.id===locationId).reduce((s,j)=>s+j.reserved,0)}));
},has(o){return !!state.orders[D.key(o)];},reserve(o,allocations){
  const key=D.key(o),old=state.orders[key];
  if(old&&old.status!=='cancelled'&&old.jobs.some(j=>j.taken>0))throw Error('Đơn đã bắt đầu nhặt. Dùng Kho nhặt hàng để lấy bù, không chỉ định lại toàn đơn.');
  const jobs=[];o.lines.forEach((l,i)=>(allocations[i]||[]).forEach(p=>jobs.push({id:p.id,line:i,reserved:p.quantity,planned:p.quantity,taken:0,closed:false})));
  const used={};for(const j of jobs)used[j.id]=(used[j.id]||0)+j.reserved;
  for(const [id,q]of Object.entries(used)){const r=D.get().locations.find(r=>r.id===id);const f=freeze(r);
    if(f)throw Error('Khu '+f.zone+' đang kiểm kê. Không chỉ định vị trí '+r.location+' đến khi chốt kỳ kiểm kê.');
    if(q>api.available(r,key))throw Error('Vị trí '+r.location+' không còn đủ khả dụng.');}
  // ST của từng nhiệm vụ tính ngay lúc chỉ định (trước khi trừ thùng) và giữ nguyên sau Xác nhận nhặt.
  jobs.forEach(j=>{j.st=api.cartonsFor(locationOf(j.id),j.reserved);});
  state.orders[key]={order:o,jobs,status:'picking'};log('Đang nhặt',o.orderCode+' · '+jobs.reduce((s,j)=>s+j.reserved,0)+' sản phẩm');
},open(o,options={}){current=state.orders[D.key(o)];auditOnly=!!options.auditOnly;render();$('inventoryDialog').showModal();}};
function log(type,text){state.history.unshift({type,text,at:new Date().toLocaleTimeString('vi-VN')});api.version++;}
document.body.insertAdjacentHTML('beforeend',`<dialog id="inventoryDialog" style="width:min(1150px,96vw);max-height:94vh;padding:0;background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:14px"><div class="dp-head"><div><p class="dp-kicker">KHO NHẶT HÀNG · MÔ PHỎNG</p><h2 id="inventoryTitle" class="dp-title"></h2><p class="dp-subtitle">Tồn vị trí − Giữ chỗ = Khả dụng. Chỉ trừ tồn theo số thực nhặt mới xác nhận.</p></div><button id="inventoryClose" class="dp-close">×</button></div><div id="inventoryBody" class="picking-body"></div></dialog>`);
$('inventoryClose').onclick=()=>$('inventoryDialog').close();
function render(){
const o=current.order,key=D.key(o),rows=D.get().locations.filter(r=>r.branch===o.branch),jobs=current.jobs;
$('inventoryTitle').textContent=o.orderCode+' · '+o.customerName;
$('inventoryBody').innerHTML=`<h3>1. Nhập số thực nhặt tại vị trí đã chỉ định</h3><p>Nhập số lấy thêm lần này. Nếu vị trí không đủ: chọn “Kết thúc tại vị trí này” để giải phóng phần giữ chỗ chưa lấy. Nếu báo hết, vị trí bị khóa chờ kiểm đếm.</p><div style="overflow:auto"><table class="dp-table"><thead><tr><th>Mã / vị trí</th><th>Đã nhặt</th><th>Còn giữ chỗ</th><th>Thực nhặt thêm</th><th>Xử lý</th></tr></thead><tbody>${jobs.map((j,i)=>{const r=rows.find(r=>r.id===j.id);return `<tr><td>${e(o.lines[j.line].productCode)} · ${e(r.location)}</td><td>${j.taken}</td><td>${j.reserved}</td><td><input aria-label="Thực nhặt dòng ${i}" id="taken-${i}" type="number" min="0" max="${j.reserved}" value="${j.reserved}" ${!j.reserved?'disabled':''} style="width:80px"></td><td>${j.reserved?`<label><input type="checkbox" id="finish-${i}"> Kết thúc tại vị trí này</label><br><label><input type="checkbox" id="empty-${i}"> Kho báo đã hết hàng</label><br><button data-take="${i}">Xác nhận thực nhặt</button>`:'Đã kết thúc'}</td></tr>`;}).join('')}</tbody></table></div><h3 style="margin-top:24px">2. Lấy bù số còn thiếu</h3>${o.lines.map((l,i)=>{
const taken=jobs.filter(j=>j.line===i).reduce((s,j)=>s+j.taken,0),reserved=jobs.filter(j=>j.line===i).reduce((s,j)=>s+j.reserved,0),missing=Math.max(0,l.quantity-taken-reserved);
return `<p><strong>${e(l.productCode)}</strong>: Đơn ${l.quantity} · Đã nhặt ${taken} · Đang giữ ${reserved} · <strong>Cần chỉ định bù ${missing}</strong> ${missing?`<button data-fill="${i}">Gợi ý & giữ chỗ lấy bù</button>`:taken===l.quantity?'✓ Đã nhặt đủ':''}</p>`;}).join('')}<h3>3. Sổ tồn vị trí & xử lý chênh lệch</h3><div style="overflow:auto"><table class="dp-table"><thead><tr><th>Mã / vị trí</th><th>Tồn sổ</th><th>Giữ chỗ mọi đơn</th><th>Khả dụng</th><th>Kiểm đếm & điều chỉnh</th></tr></thead><tbody>${rows.map(r=>{const s=stock(r);return `<tr><td>${e(r.code)} · ${e(r.location)}</td><td>${onHand(r)??'Chưa có tồn xác nhận'}</td><td>${held(r.id)}</td><td>${s.locked?'🔒 Chờ kiểm đếm':api.available(r)??'Chưa rõ'}${held(r.id)>(onHand(r)??Infinity)?`<br><strong style="color:var(--amber)">⚠ Giữ vượt tồn ${held(r.id)-onHand(r)}</strong>`:''}</td><td>${s.locked?`<label>Đếm còn <input id="count-${r.id}" type="number" min="0" placeholder="SL thực tế" style="width:90px"></label><input id="reason-${r.id}" placeholder="Lý do điều chỉnh" style="width:150px"><button data-count="${r.id}">Quản lý xác nhận</button>`:'Đang hoạt động'}</td></tr>`;}).join('')}</tbody></table></div><p id="inventoryError" style="color:var(--amber)" role="status"></p><h3 style="margin-top:24px">Lịch sử thao tác trong phiên thử</h3>${state.history.map(h=>`<p style="font-size:12px">${h.at} · <strong>${e(h.type)}</strong> · ${e(h.text)}</p>`).join('')}<p><small>Dữ liệu giữ trong bộ nhớ phiên thử. Tải lại trang sẽ đặt lại sổ tồn và giữ chỗ. Không ghi DB, không trừ tồn KiotViet.</small></p>`;
if(auditOnly){const body=$('inventoryBody'),heading=[...body.querySelectorAll('h3')].find(h=>h.textContent.startsWith('3.'));if(heading){while(body.firstChild!==heading)body.firstChild.remove();heading.textContent='Sổ tồn vị trí & xử lý chênh lệch';}}
}
$('inventoryBody').onclick=event=>{
try{
const b=event.target.closest('button');if(!b)return;
if(b.dataset.take!==undefined){const i=Number(b.dataset.take),j=current.jobs[i],input=$('taken-'+i).value,q=Number(input),r=D.get().locations.find(r=>r.id===j.id),s=stock(r);
if(input===''||!Number.isFinite(q)||q<0||q>j.reserved||onHand(r)===null||q>onHand(r))throw Error('Số thực nhặt phải từ 0 đến lượng còn giữ chỗ và tồn sổ.');
applyPick(r,q,'Xác nhận nhặt',current.order.orderCode);j.taken+=q;j.reserved-=q;
const end=$('finish-'+i).checked||$('empty-'+i).checked;if(end){j.reserved=0;j.closed=true;}
if($('empty-'+i).checked){s.locked=true;log('Khóa vị trí',r.code+' · '+r.location+' báo hết hàng, tồn sổ còn '+onHand(r));}
log('Thực nhặt',current.order.orderCode+' · '+r.location+' lấy '+q+(end?' · giải phóng giữ chỗ còn lại':''));
}else if(b.dataset.fill!==undefined){const i=Number(b.dataset.fill),l=current.order.lines[i],missing=l.quantity-current.jobs.filter(j=>j.line===i).reduce((s,j)=>s+j.taken+j.reserved,0),rows=D.get().locations.filter(r=>r.branch===current.order.branch&&R.key(r.code)===R.key(l.productCode)).map(r=>({...r,available:api.available(r)}));
const excluded=new Set(current.jobs.filter(j=>j.line===i&&j.closed).map(j=>j.id));
const result=R.suggest(missing,rows.filter(r=>!excluded.has(r.id)));for(const p of result.picks)current.jobs.push({id:p.id,line:i,reserved:p.quantity,taken:0});
log('Giữ chỗ lấy bù',l.productCode+' · giữ thêm '+(missing-result.shortage)+' · chưa phân bổ được '+result.shortage);
}else if(b.dataset.count){const id=b.dataset.count,r=D.get().locations.find(r=>r.id===id),raw=$('count-'+id).value,q=Number(raw),reason=$('reason-'+id).value.trim();
if(raw===''||!Number.isFinite(q)||q<0||!reason)throw Error('Nhập số kiểm đếm không âm và lý do điều chỉnh.');
if(held(id)>0)throw Error('Còn giữ chỗ của đơn khác. Cần xử lý các giữ chỗ trước khi điều chỉnh.');
const s=stock(r),before=setCount(r,q);s.locked=false;log('Quản lý điều chỉnh',r.code+' · '+r.location+' từ '+before+' → '+q+' · '+reason);
}render();window.PickingPopup?.attach();
}catch(err){$('inventoryError').textContent=err.message;}
};
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('inventoryDialog').open)event.stopImmediatePropagation();},true);
window.PickingInventory=api;
api.summary=summary;
api.record=o=>state.orders[D.key(o)];
/* Vòng đời nhặt của CẢ ĐƠN: Đang nhặt (giữ chỗ) → Xác nhận nhặt (trừ thùng thật) hoặc Hủy nhặt (trả giữ chỗ).
   Hủy nhặt cả sau Xác nhận (hoàn tác tồn và ghi chú). Trạng thái cuối nào cũng cho chỉ định lại (reopen). */
const STATUS={picking:'Đang nhặt',confirmed:'Xác nhận nhặt',cancelled:'Hủy nhặt'};
const locationOf=id=>D.get().locations.find(r=>r.id===id);
api.STATUS=STATUS;
api.status=o=>state.orders[D.key(o)]?.status||null;
api.statuses=()=>Object.fromEntries(Object.entries(state.orders).map(([k,v])=>[k,v.status]));
api.specText=specText;
/* ST của một dòng đơn (theo chỉ số trong order.lines): chỉ có khi đã chỉ định đủ SL của dòng và đơn chưa Hủy nhặt, ngược lại null (trống).
   Popup, bảng chi tiết đơn và phiếu in cùng đọc hàm này nên in lại ra cùng số. */
api.lineSt=(o,index)=>{
  const rec=state.orders[D.key(o)];if(!rec||rec.status==='cancelled')return null;
  const jobs=rec.jobs.filter(j=>j.line===index),need=o.lines[index]?.quantity;
  if(!jobs.length||!(need>0)||jobs.reduce((n,j)=>n+j.planned,0)<need-1e-6||jobs.some(j=>j.st===null||j.st===undefined))return null;
  return Math.round(jobs.reduce((n,j)=>n+j.st,0)*1e6)/1e6;
};
api.cartonInfo=r=>{const spec=specOf(r);return spec?{text:specText(r),terms:spec.terms,loose:spec.loose,multi:spec.multi,perCarton:spec.terms.length?Math.max(...spec.terms.map(t=>t.perCarton)):null}:null;};
// ST của một lượt nhặt: thùng nguyên theo từng quy cách, phần lẻ chia SL/thùng của số hạng đầu. null = vị trí chưa có quy cách.
api.cartonsFor=(r,quantity)=>{const spec=specOf(r);return spec&&spec.terms.length?C.cartonsFor(spec,quantity):null;};
// Một dòng của sổ vị trí: bảng Sổ kho/Kiểm kê, bộ lọc Cảnh báo và số đếm cùng đọc từ đây.
api.row=r=>{const text=specText(r),total=onHand(r);return {id:r.id,branch:r.branch,code:r.code,manual:!!r.manual,name:r.name||nameOf(r.code),location:r.location,arrivalDate:r.arrivalDate||'',notes:text,quantity:total,held:held(r.id),pickable:api.available(r),warnings:C.warnings(text,{unknownCode:isUnknownCode(r)})};};
api.rows=branch=>D.get().locations.filter(r=>r.branch===branch).map(api.row);
api.history=branch=>(state.changes[branch]||[]).slice();
// Lịch sử của một mã hàng trong một cơ sở (không lẫn cơ sở), mới nhất lên đầu.
api.historyFor=(branch,code)=>(state.changes[branch]||[]).filter(h=>nameKey(h.code)===nameKey(code));
/* Lần thay đổi gần nhất của từng vị trí, rút từ chính bản ghi lịch sử (một nguồn sự thật, không lưu trường riêng):
   khóa là mã hàng + vị trí viết hoa. Dòng chưa từng đổi không có mục. */
api.lastChanges=branch=>{
  const map=new Map();
  for(const h of state.changes[branch]||[]){const key=nameKey(h.code)+'|'+String(h.location).trim().toUpperCase();if(!map.has(key))map.set(key,h);}
  return map;
};
api.lastChangeKey=r=>nameKey(r.code)+'|'+String(r.location).trim().toUpperCase();
// Ghi chú mới do người dùng nhập tay: phải đọc được, nếu không thì từ chối và giữ ghi chú cũ.
api.setSpec=(r,text,source='Sửa tay',options={})=>{
  const value=String(text??'').trim(),spec=C.parseSpec(value);
  /* Giao diện cho phép lưu cả ghi chú sai định dạng/rỗng: dòng bị cảnh báo, SL không tính được, không chỉ định được cho tới khi sửa. */
  if(!spec&&options.allowInvalid){
    if(held(r.id)>0)throw Error('Vị trí '+r.location+' đang nhặt '+held(r.id)+', không để ghi chú sai định dạng.');
    const f=freeze(r);if(f)throw Error('Khu '+f.zone+' đang kiểm kê. Không sửa vị trí '+r.location+' đến khi chốt kỳ kiểm kê.');
    const before=onHand(r);setText(r,value,source);log('Nhập ghi chú',r.code+' · '+r.location+' "'+value+'" sai định dạng · SL '+(before??'—')+' → —');return;
  }
  if(!spec)throw Error('Ghi chú hàng hóa phải có dạng <số thùng>T x <SL/thùng> với số nguyên dương, ví dụ 5T x 100 hoặc 1Tx50 + 2Tx25.');
  const f=freeze(r);if(f)throw Error('Khu '+f.zone+' đang kiểm kê. Không sửa vị trí '+r.location+' đến khi chốt kỳ kiểm kê.');
  if(spec.quantity<held(r.id)-1e-6)throw Error('Vị trí '+r.location+' đang nhặt '+held(r.id)+', ghi chú không được nhỏ hơn số đang nhặt.');
  const before=onHand(r);setText(r,value,source);
  if(before!==null&&ledger()?.opening(r.branch,r.code,r.location)&&spec.quantity!==before)ledgerRecord(r,'adjust',spec.quantity-before);
  log('Nhập ghi chú',r.code+' · '+r.location+' '+value+' · SL '+(before??'—')+' → '+spec.quantity);
};
// Import file kiểm kê: cột Ghi chú hàng hóa của file thành ghi chú hiện hành (kể cả chuỗi sai định dạng, để cảnh báo).
api.importSpecs=(branch,lines)=>{
  let changed=0;
  for(const line of lines){
    const r=D.get().locations.find(x=>x.branch===branch&&R.key(x.code)===R.key(line.code)&&String(x.location).trim().toUpperCase()===String(line.location).trim().toUpperCase());
    if(line.name)names.set(nameKey(line.code),line.name);
    if(!r||!String(line.spec??'').trim())continue;
    const before=specText(r);setText(r,String(line.spec).trim(),'Import');if(specText(r)!==before)changed++;
  }
  return changed;
};
const sameKey=(r,branch,code,location)=>r.branch===branch&&nameKey(r.code)===nameKey(code)&&String(r.location).trim().toUpperCase()===String(location).trim().toUpperCase();
api.findLocation=(branch,code,location)=>D.get().locations.find(r=>sameKey(r,branch,code,location))||null;
/* Xem trước dòng nhập tay khi đang gõ: Tên hàng tra theo mã, SL tính từ ghi chú bằng cùng parser với import,
   cảnh báo tức thì (kể cả ghi chú gõ dở), và dòng trùng khóa (cơ sở, mã hàng, vị trí) nếu có. */
api.previewLocation=(branch,{code,notes,location})=>{
  const name=nameOf(code),text=String(notes??'').trim(),spec=C.parseSpec(text);
  return {name,quantity:spec?spec.quantity:null,warnings:C.warnings(text,{unknownCode:!name}),duplicate:String(code??'').trim()&&String(location??'').trim()?api.findLocation(branch,code,location):null};
};
// Thêm dòng bằng tay vào đúng cơ sở. Trùng khóa (cơ sở, mã hàng, vị trí) thì không tạo dòng thứ hai: báo trùng kèm dòng sẵn có (err.duplicate).
let manualSeq=0;
api.addLocation=(branch,{code,notes,location},source='Sửa tay')=>{
  const c=String(code??'').trim(),l=String(location??'').trim(),n=C.normalizeNote(notes);
  if(!['HN','SG'].includes(branch))throw Error('Cơ sở không hợp lệ.');
  if(!c)throw Error('Nhập Mã hàng.');
  if(!l)throw Error('Nhập Vị trí.');
  const existing=api.findLocation(branch,c,l);
  if(existing)throw Object.assign(Error('Đã có dòng '+existing.code+' tại '+existing.location+' ở '+branch+'. Sửa ghi chú trên dòng đó thay vì thêm mới.'),{duplicate:existing});
  const f=ledger()?.frozen(branch,l);if(f)throw Error('Khu '+f.zone+' đang kiểm kê. Không thêm vị trí '+l+' đến khi chốt kỳ kiểm kê.');
  // Ngày về mặc định là hôm nay theo giờ Việt Nam.
  const today=new Date(Date.now()+7*3600e3).toISOString().slice(0,10).split('-').reverse().join('/');
  const row={id:'loc-m'+(++manualSeq)+'-'+Date.now().toString(36),branch,code:c,location:l,name:nameOf(c),notes:n,arrivalDate:today,manual:true};
  D.get().locations.push(row);
  pushChange(row,'',null,n,specOf(row)?.quantity??null,source);
  log('Thêm vị trí',branch+' · '+c+' · '+l+' · '+(n||'ghi chú trống'));
  return row;
};
// Hàng nhập thêm (phiếu nhập Kiot / nhập sau giờ chốt): cộng vào ghi chú vì SL luôn lấy từ ghi chú.
api.noteReceipt=(branch,code,location,quantity)=>{
  const r=D.get().locations.find(x=>x.branch===branch&&R.key(x.code)===R.key(code)&&String(x.location).trim().toUpperCase()===String(location).trim().toUpperCase());
  const spec=r&&specOf(r);if(!r||!spec||!(quantity>0))return false;
  setText(r,C.restore(spec,quantity).text,'Import');return true;
};
api.confirmPick=o=>{
  const rec=state.orders[D.key(o)];
  if(!rec)throw Error('Đơn chưa chỉ định vị trí.');
  if(rec.status!=='picking')throw Error('Chỉ xác nhận nhặt được khi đơn đang ở trạng thái Đang nhặt.');
  const todo=rec.jobs.filter(j=>j.reserved>0).map(job=>({job,r:locationOf(job.id)})),need={};
  for(const {job,r} of todo)need[r.id]=(need[r.id]||0)+job.reserved;
  for(const [id,q] of Object.entries(need)){const r=locationOf(id),f=freeze(r);
    if(f)throw Error('Khu '+f.zone+' đang kiểm kê. Không xác nhận nhặt vị trí '+r.location+' đến khi chốt kỳ kiểm kê.');
    if(onHand(r)===null||q>onHand(r)+1e-6)throw Error('Vị trí '+r.location+' không đủ tồn để xác nhận nhặt.');}
  for(const {job,r} of todo){
    const q=job.reserved;job.specBefore=specText(r);
    const d=applyPick(r,q,'Xác nhận nhặt',o.orderCode);job.st=d.taken;
    job.specAfter=specText(r);job.picked=q;job.taken+=q;job.reserved=0;
  }
  rec.status='confirmed';log('Xác nhận nhặt',o.orderCode+' · '+todo.reduce((n,t)=>n+t.job.picked,0)+' sản phẩm');
};
// Hoàn tác các lượt đã trừ: khôi phục đúng chuỗi ghi chú gốc lưu theo job nếu vị trí chưa bị đổi tiếp, không thì cộng trả lại.
function undoPicks(rec,source,orderCode){
  let restored=0;
  for(const job of [...rec.jobs].reverse()){
    if(!(job.picked>0))continue;
    const r=locationOf(job.id),current=specText(r);
    if(job.specAfter!==undefined&&current===job.specAfter)setText(r,job.specBefore,source,orderCode,true);
    else{const spec=C.parseSpec(current);if(spec)setText(r,C.restore(spec,job.picked).text,source,orderCode);}
    ledgerRecord(r,'receipt',job.picked);
    job.taken-=job.picked;restored+=job.picked;job.picked=0;
  }
  return restored;
}
api.cancelPick=o=>{
  const rec=state.orders[D.key(o)];
  if(!rec)throw Error('Đơn chưa chỉ định vị trí.');
  if(rec.status==='cancelled')throw Error('Đơn đã hủy nhặt.');
  if(rec.status==='picking'&&rec.jobs.some(j=>j.taken>0))throw Error('Đơn đã nhặt một phần. Dùng Kho nhặt hàng thay vì hủy cả đơn.');
  const restored=undoPicks(rec,'Hủy/hoàn tác nhặt',o.orderCode),released=rec.jobs.reduce((n,j)=>n+j.reserved,0);
  rec.jobs.forEach(j=>{j.reserved=0;});rec.status='cancelled';
  log('Hủy nhặt',o.orderCode+(restored?' · hoàn tác '+restored+' sản phẩm':' · trả giữ chỗ '+released));
};
// Chỉ định lại: xóa chỉ định cũ (đang nhặt thì trả giữ chỗ, đã xác nhận thì hoàn tác tồn và ghi chú).
api.reopen=o=>{
  const key=D.key(o),rec=state.orders[key];
  if(!rec)return;
  if(rec.status==='picking'&&rec.jobs.some(j=>j.taken>0))throw Error('Đơn đã nhặt một phần. Dùng Kho nhặt hàng thay vì chỉ định lại.');
  const restored=undoPicks(rec,'Chỉ định lại',o.orderCode);
  rec.jobs.forEach(j=>{j.reserved=0;});delete state.orders[key];
  log('Chỉ định lại',o.orderCode+(restored?' · hoàn tác '+restored+' sản phẩm':''));
};
})();
