(function(){
'use strict';
const $=id=>document.getElementById(id),D=window.PickingData,I=window.PickingInventory;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let order,editing=false,lastKey;
$('pickingDialog').querySelector('.dp-head').insertAdjacentHTML('afterend',`<div id="workflowToolbar" style="padding:12px 22px;display:flex;gap:10px;flex-wrap:wrap;border-bottom:1px solid var(--border)"><select id="workflowPrintType" aria-label="Loại phiếu"><option value="pick">Phiếu nhặt ban đầu</option><option value="extra">Phiếu nhặt bổ sung mới nhất</option><option value="delivery">Phiếu giao hàng đã chốt</option></select><button id="workflowPrint">In phiếu</button><button id="workflowEdit">Nhập kho nhặt thực</button><button id="workflowDraft">Lưu nháp</button><button id="workflowConfirm" class="btn-primary">Xác nhận kết quả</button></div>`);
$('pickingRows').closest('.picking-table-wrap').insertAdjacentHTML('afterend','<div id="workflowResolution"></div><p id="workflowMessage" role="status" style="color:var(--amber)"></p>');
function rec(){return I.record(order);}
function refresh(){window.PickingPopup.refresh();}
function render(o){
order=o;if(lastKey!==D.key(o)){editing=false;lastKey=D.key(o);}
const record=rec();if(record){record.draft??={};record.jobs.forEach(j=>{j.batch??=1;j.planned??=j.taken+j.reserved;});}
const head=$('pickingRows').closest('table').querySelector('thead tr');if(!head.querySelector('[data-actual-head]'))head.insertAdjacentHTML('beforeend','<th data-actual-head>Kho nhặt thực</th><th>Còn thiếu</th>');
[...$('pickingRows').children].forEach((tr,i)=>{
  tr.querySelectorAll('[data-actual-cell]').forEach(e=>e.remove());
  const jobs=(record?.jobs||[]).map((j,index)=>({...j,index})).filter(j=>j.line===i),known=jobs.length&&jobs.every(j=>j.reported),taken=jobs.reduce((s,j)=>s+j.taken,0);
  const fields=jobs.map(j=>{
    const draft=record.draft[j.index],value=draft?.value??(j.reported?j.taken:j.planned),outcome=draft?.outcome??j.outcome??'continue',row=D.get().locations.find(r=>r.id===j.id);
    return `<label class="actual-text-field">${jobs.length>1?`<span>${esc(row.location)}</span>`:''}<input type="text" inputmode="decimal" value="${esc(value)}" placeholder="" data-actual-job="${j.index}" aria-label="Thực nhặt ${esc(o.lines[i].productCode)} ${esc(row.location)}" style="width:95px" ${!editing?'disabled':''}></label>`;
  }).join('');
  tr.insertAdjacentHTML('beforeend',`<td data-actual-cell>${fields||'—'}</td><td data-actual-cell>${known?Math.max(0,o.lines[i].quantity-taken):'—'}</td>`);
});
$('workflowPrint').disabled=!record;$('workflowEdit').disabled=!record;$('workflowDraft').disabled=!record||!editing;$('workflowConfirm').disabled=!record||!editing;
if(record){$('pickingConfirm').disabled=true;$('pickingConfirm').textContent='Đã xác nhận vị trí';$('pickingSuggest').disabled=true;$('pickingRows').querySelectorAll('[data-location],[data-confirm-stock]').forEach(e=>e.disabled=true);}
else{$('pickingConfirm').textContent='Xác nhận chỉ định';$('pickingSuggest').disabled=false;}
$('workflowEdit').textContent=editing?'Đang nhập theo phiếu giấy':'Nhập kho nhặt thực';
$('workflowResolution').innerHTML=record?`<h4 style="margin:20px 0 10px">Xử lý phần còn thiếu</h4>${o.lines.map((l,i)=>{
const js=record.jobs.filter(j=>j.line===i),taken=js.reduce((s,j)=>s+j.taken,0),held=js.reduce((s,j)=>s+j.reserved,0),missing=Math.max(0,l.quantity-taken-held);
return `<p>${esc(l.productCode)}: đã nhặt <strong>${taken}</strong> / ${l.quantity} · còn giữ ${held} · cần chỉ định bù ${missing} ${missing?`<button data-workflow-fill="${i}">Chỉ định lấy bù ${missing}</button>`:''}</p>`;
}).join('')}<p>Chốt giao: mọi vị trí phải có kết quả và đã kết thúc. Nếu giao thiếu, chọn cách xử lý phần còn lại và ghi lý do.</p><select id="workflowRemainder"><option value="">Chưa quyết định phần thiếu</option><option value="wait">Giữ phần thiếu chờ hàng</option><option value="cancel">Chấp thuận hủy phần thiếu</option></select><input id="workflowReason" placeholder="Lý do / người chấp thuận giao thiếu" style="max-width:300px"><button id="workflowDelivery">Chốt phiếu giao theo thực nhặt</button>${record.delivery?'<p class="picking-good">✓ Đã chốt phiếu giao — chọn loại phiếu giao để in.</p>':''}<details><summary>Kiểm đếm tồn vị trí (luồng riêng)</summary><p>Không cần hoàn tất kiểm đếm để nhập kết quả hoặc lấy bù tại vị trí khác.</p><button id="workflowAudit">Mở sổ tồn & kiểm đếm</button></details>`:'<p>Xác nhận vị trí trước để in và nhập kết quả kho nhặt.</p>';
}
function capture(){const record=rec();if(!record)return;record.draft??={};$('pickingRows').querySelectorAll('[data-actual-job]').forEach(input=>{record.draft[input.dataset.actualJob]={value:input.value,outcome:'end'};});}
function message(text){$('workflowMessage').textContent=text;}
$('pickingRows').addEventListener('input',capture);$('pickingRows').addEventListener('change',capture);
$('workflowEdit').onclick=()=>{editing=true;refresh();};
$('workflowDraft').onclick=()=>{capture();message('Đã lưu nháp trong phiên thử. Chưa ghi thực nhặt, chưa thay đổi tồn.');};
$('workflowConfirm').onclick=()=>{try{capture();const r=rec();I.confirmActual(order,r.jobs.map((j,i)=>r.draft[i]||{value:''}));r.draft={};editing=false;refresh();message('Đã xác nhận số lũy kế. Lưu lại cùng giá trị không trừ tồn lần nữa.');}catch(err){message(err.message);}};
$('workflowResolution').onclick=e=>{const button=e.target.closest('button');if(!button)return;try{
if(button.dataset.workflowFill!==undefined){if(editing)throw Error('Xác nhận hoặc kết thúc nhập kết quả trước khi lấy bù.');const result=I.fill(order,Number(button.dataset.workflowFill));refresh();message(result?.picks.length?'Đã giữ chỗ bổ sung. Chọn Phiếu nhặt bổ sung mới nhất để in.':'Chưa có vị trí đủ khả dụng. Giữ đơn chờ xử lý, không tự giảm SL đơn.');}
if(button.id==='workflowAudit')I.open(order,{auditOnly:true});
if(button.id==='workflowDelivery'){
const r=rec();if(editing)throw Error('Cần xác nhận kết quả nhập trước.');if(r.jobs.some(j=>!j.reported||j.reserved>0))throw Error('Còn vị trí chưa báo hoặc chưa kết thúc nhặt. Không coi ô trống là 0.');
const qty=order.lines.map((l,i)=>r.jobs.filter(j=>j.line===i).reduce((s,j)=>s+j.taken,0));if(!qty.some(q=>q>0))throw Error('Chưa có hàng thực nhặt để giao.');const short=qty.some((q,i)=>q<order.lines[i].quantity),reason=$('workflowReason').value.trim(),action=$('workflowRemainder').value;
if(short&&(!reason||!action))throw Error('Giao thiếu cần quyết định cho phần còn lại và lý do chấp thuận.');
r.delivery={qty,reason,action,at:new Date().toISOString(),version:(r.deliverySeq=(r.deliverySeq||0)+1)};refresh();message('Đã chốt số giao theo thực nhặt. SL đơn gốc không bị thay đổi; prototype không sửa KiotViet.');
}
}catch(err){message(err.message);}};
function print(){
const r=rec(),type=$('workflowPrintType').value;if(!r)return;
if(type==='delivery'&&!r.delivery)throw Error('Chưa chốt phiếu giao.');
const batch=type==='extra'?Math.max(...r.jobs.map(j=>j.batch)):1;if(type==='extra'&&batch===1)throw Error('Chưa có phiếu bổ sung.');
if(window.PickingInvoice){window.PickingInvoice.show(order,r,type,batch);return;}
const title=type==='delivery'?'PHIẾU GIAO HÀNG':type==='extra'?'PHIẾU NHẶT BỔ SUNG':'PHIẾU NHẶT BAN ĐẦU';
let body;
if(type==='delivery')body=order.lines.map((l,i)=>r.delivery.qty[i]>0?`<tr><td>${esc(l.productCode)}</td><td>${esc(l.productName)}</td><td>${l.quantity}</td><td>${r.delivery.qty[i]}</td><td>${l.quantity-r.delivery.qty[i]}</td></tr>`:'').join('');
else body=r.jobs.filter(j=>j.batch===batch).map(j=>{const l=order.lines[j.line],loc=D.get().locations.find(p=>p.id===j.id);return `<tr><td>${esc(l.productCode)}</td><td>${esc(l.productName)}</td><td>${esc(loc.location)}</td><td>${j.planned}</td><td>____________</td></tr>`;}).join('');
$('pickingPrintTitle').textContent=title+' · mẫu tạm';$('pickingPrintSheet').innerHTML=`<h2>TOKOSI · ${title}</h2><h3>${esc(order.orderCode)} · ${esc(order.branch)}</h3><p>${esc(order.customerName)}<br>Mã phiếu: ${esc(order.orderCode)}-${type}-${type==='delivery'?r.delivery.version:batch} · NGUỒN MÔ PHỎNG</p>${type==='extra'?'<p><strong>CHỈ NHẶT BỔ SUNG CÁC DÒNG DƯỚI ĐÂY. Không nhặt lại phần đã lấy.</strong></p>':''}<table><thead><tr><th>Mã hàng</th><th>Tên hàng</th>${type==='delivery'?'<th>SL đơn</th><th>SL giao lần này</th><th>Còn thiếu so đơn</th>':'<th>Vị trí</th><th>SL cần nhặt trên phiếu này</th><th>Kho nhặt thực</th>'}</tr></thead><tbody>${body}</tbody></table><p>${type==='delivery'?'Xử lý phần thiếu: '+esc(r.delivery.action||'Đủ hàng')+' · '+esc(r.delivery.reason):'Nhân viên nhặt ghi số thực tế vào cột Kho nhặt thực rồi trả phiếu cho Kế toán.'}</p><p>Mẫu thử chờ format chính thức. Chưa xác nhận đã giao hoặc ghi KiotViet. In lại không tạo thêm giữ chỗ.</p>`;
$('pickingPrintDialog').showModal();
}
$('workflowPrint').onclick=()=>{try{print();}catch(err){message(err.message);}};
window.PickingWorkflow={render};
})();
