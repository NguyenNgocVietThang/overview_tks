(function(){
'use strict';
const $=id=>document.getElementById(id),I=window.PickingInventory,D=window.PickingData;
const oldRender=window.PickingWorkflow.render;
let order;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const error=text=>$('workflowMessage').textContent=text;
function record(){return I.record(order);}
function refresh(){window.PickingPopup.refresh();}
function print(type){$('workflowPrintType').value=type;$('workflowPrint').click();}
function capture(event){const r=record();if(!r)return;r.draft??={};$('pickingRows').querySelectorAll('[data-actual-job]').forEach(input=>{r.draft[input.dataset.actualJob]={value:input.value,outcome:'end'};});if(event?.target?.matches('[data-actual-job]')&&$('simpleShortage'))$('simpleShortage').hidden=true;updateShortage();}
function updateShortage(){
const r=record();if(!r)return;
[...$('pickingRows').children].forEach((tr,i)=>{const jobs=r.jobs.map((j,index)=>({...j,index})).filter(j=>j.line===i);let known=true,total=0;
for(const j of jobs){const value=r.draft?.[j.index]?.value??(j.reported?j.taken:j.planned);if(value==='')known=false;else total+=Number(value);}
const cells=tr.querySelectorAll('[data-actual-cell]');if(cells[1])cells[1].textContent=known?Math.max(0,order.lines[i].quantity-total):'—';
const strong=cells[0]?.querySelector('strong');if(strong)strong.textContent=known?total:'Chờ kết quả';
});
}
function render(o){order=o;oldRender(o);const r=record();$('workflowToolbar').hidden=true;$('workflowToolbar').style.display='none';
$('pickingNote').closest('label').hidden=true;$('workflowMessage').textContent='';
if(r){
$('pickingRows').querySelectorAll('[data-actual-job]').forEach(input=>{input.disabled=false;input.style.width='95px';});
$('pickingRows').querySelectorAll('[data-outcome-job]').forEach(select=>{select.value='end';select.hidden=true;});
$('pickingRows').querySelectorAll('details').forEach(details=>details.open=false);
$('pickingRows').querySelectorAll('[data-actual-cell]').forEach(cell=>{if(cell.querySelectorAll('[data-actual-job]').length===1&&cell.querySelector('strong'))cell.querySelector('strong').hidden=true;});
$('pickingConfirm').hidden=true;$('pickingSuggest').hidden=true;
$('workflowResolution').innerHTML='<div class="simple-main-actions" style="justify-content:flex-end"><button id="simpleFinish" class="btn-primary">In đơn</button></div>';
$('simpleFinish').onclick=finish;
}else{$('pickingConfirm').hidden=false;$('pickingConfirm').textContent='Xác nhận & In phiếu nhặt';$('pickingSuggest').hidden=false;$('workflowResolution').innerHTML='';}
updateShortage();
}
function entries(){capture();const r=record();return r.jobs.map((j,i)=>r.draft[i]||{value:String(j.reported?j.taken:j.planned),outcome:'end'});}
function validate(values){const r=record();for(let i=0;i<values.length;i++){const v=values[i].value,j=r.jobs[i],n=Number(v);if(v==='')throw Error('Còn vị trí chưa có kết quả. Nhập 0 nếu kho xác nhận không nhặt được.');if(!Number.isFinite(n)||n<j.taken||n>j.taken+j.reserved)throw Error('Số thực nhặt không hợp lệ; không được vượt chỉ định hoặc sửa giảm số đã xác nhận.');}}
function save(values){I.confirmActual(order,values);record().draft={};}
function totals(values){return order.lines.map((l,i)=>record().jobs.reduce((s,j,k)=>s+(j.line===i?Number(values[k].value):0),0));}
function closeDelivery(qty,action='',reason=''){
const r=record();r.delivery={qty,action,reason,at:new Date().toISOString(),version:(r.deliverySeq=(r.deliverySeq||0)+1)};refresh();print('delivery');
}
function finish(){try{const values=entries();validate(values);const qty=totals(values);
if(!qty.some(q=>q>0))throw Error('Chưa có số lượng thực nhặt để in giao hàng.');
save(values);closeDelivery(qty,qty.some((q,i)=>q<order.lines[i].quantity)?'Phần thiếu chưa xử lý':'');
}catch(err){error(err.message);}}
const confirm=$('pickingConfirm'),oldConfirm=confirm.onclick;
confirm.onclick=()=>{const before=record();oldConfirm();if(!before&&record())print('pick');};
$('pickingRows').addEventListener('input',capture);$('pickingRows').addEventListener('change',capture);
window.PickingWorkflow.render=render;
})();
