(function(){
  'use strict';
  const $=id=>document.getElementById(id),R=window.PickingRules,D=window.PickingData;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=v=>Number(v||0).toLocaleString('vi-VN',{maximumFractionDigits:3});
  let order=null,allocations={},suggestions={},saved={};
  try{saved=JSON.parse(localStorage.getItem('tks-picking-popup-v2')||'{}');}catch{}
  const locations=o=>D.get().locations.filter(r=>r.branch===o.branch).map(r=>window.PickingInventory?{...r,available:window.PickingInventory.available(r,D.key(o))}:r);
  const lines=o=>o.lines.filter(l=>!R.key(l.productCode).startsWith('vat'));
  const candidates=(o,l)=>locations(o).filter(r=>R.key(r.code)===R.key(l.productCode));
  const eligible=o=>o?.summary?.code==='SENT_TO_ACCOUNTANT';
  const fingerprint=o=>JSON.stringify({algorithm:R.version,source:D.source,order:o,locations:locations(o)});
  function current(){
    if(typeof detailOrder!=='undefined'&&detailOrder)return D.get().orders.find(o=>o.orderCode===detailOrder.orderCode&&o.branch===detailOrder.branch);
    return D.get().orders.find(o=>o.orderCode===$('lcDetailTitle')?.textContent.trim());
  }
  function validSaved(o){if(window.PickingInventory&&!window.PickingInventory.has(o))return null;const s=saved[D.key(o)];return s?.fingerprint===fingerprint(o)&&!R.validate(lines(o),locations(o),s.allocations).length?s:null;}
  function attach(){
    const o=current(),holder=$('lcDetailKiot');if(!holder)return;
    const head=holder.querySelector('.dp-section-head');if(!head)return;
    let controls=$('pickingActions');
    if(!eligible(o)){controls?.remove();return;}
    if(!controls){controls=document.createElement('span');controls.id='pickingActions';controls.className='picking-actions';head.appendChild(controls);}
    const marker=D.key(o)+'|'+!!validSaved(o)+'|'+(window.PickingInventory?.version||0);if(controls.dataset.marker===marker)return;
    controls.dataset.marker=marker;
    controls.innerHTML='<button id="openPickingBtn" class="btn-primary picking-open-btn">Chỉ định vị trí</button>'+(window.PickingInventory?.has(o)?'<span class="picking-confirmed">✓ Đã xác nhận</span>':'');
    $('openPickingBtn').onclick=()=>open(o);
    if($('openPickingPrint'))$('openPickingPrint').onclick=()=>print(o);
  }
  function suggest(){
    allocations={};const used=new Map();
    lines(order).forEach((line,i)=>{
      const available=candidates(order,line).map(r=>({...r,available:R.quantity(r.available)===null?null:Math.max(0,r.available-(used.get(r.id)||0))}));
      allocations[i]=R.suggest(line.quantity,available).picks;
      allocations[i].forEach(p=>used.set(p.id,(used.get(p.id)||0)+p.quantity));
    });
    suggestions=structuredClone(allocations);
  }
  function open(o){
    if(!eligible(o))return;
    order=o;suggest();const entry=validSaved(o);if(entry)allocations=structuredClone(entry.allocations);
    const record=window.PickingInventory?.record(o);if(record){allocations={};record.jobs.forEach(j=>{(allocations[j.line]??=[]).push({id:j.id,quantity:j.taken+j.reserved});});}
    $('pickingNote').value=entry?.note||'';$('pickingTitle').textContent=o.orderCode+' · '+(o.branch==='HN'?'Hà Nội':'Sài Gòn');
    $('pickingSource').textContent='Bản '+R.version+' · Nguồn: '+D.source+' · '+(entry?'Đang khôi phục chỉ định đã xác nhận. Bấm “Gợi ý lại” để tính phương án mới.':'Gợi ý mới: chọn vị trí đủ hàng có lượng khả dụng sát số cần nhất.');
    render();$('pickingDialog').showModal();
  }
  function render(){
    $('pickingRows').innerHTML=lines(order).map((l,i)=>{
      const picks=allocations[i]||[],total=picks.reduce((s,p)=>s+p.quantity,0),rows=candidates(order,l);
      const unknown=rows.some(r=>R.quantity(r.available)===null);
      const before=rows.reduce((s,r)=>s+(R.quantity(r.available)||0),0);
      const selected=lines(order).reduce((s,line,j)=>s+(R.key(line.productCode)===R.key(l.productCode)?(allocations[j]||[]).reduce((n,p)=>n+p.quantity,0):0),0);
      const remaining=before-selected;
      const shared=window.PickingInventory?.summary(order.branch,l.productCode)||{onHand:unknown?null:before,held:0,available:unknown?null:before};
      return `<tr><td class="picking-code">${esc(l.productCode)}</td><td>${esc(l.productName)}</td><td class="num">${fmt(l.quantity)}</td><td class="picking-total" data-total-code="${esc(l.productCode)}" data-shared-available="${shared.available??'unknown'}" data-remaining="${unknown?'unknown':remaining}"><strong class="${shared.available===null?'picking-bad':'picking-good'}">${shared.available===null?'Chưa xác định':fmt(shared.available)}</strong><small>Khả dụng chung mọi đơn<br>Tồn vị trí: ${shared.onHand===null?'Chưa rõ':fmt(shared.onHand)}<br>Đã giữ: ${fmt(shared.held)}<br>Đơn này chọn: ${fmt(selected)}<br>Dự kiến sau xác nhận: ${unknown?'Chưa rõ':fmt(remaining)}</small></td><td><div class="picking-locations">${rows.map(r=>{
        const take=picks.find(p=>p.id===r.id)?.quantity||0,available=R.quantity(r.available),hint=(suggestions[i]||[]).some(p=>p.id===r.id);
        return `<div><button type="button" class="picking-location ${take?'selected':''} ${hint?'suggested':''}" data-line="${i}" data-location="${esc(r.id)}" aria-pressed="${!!take}" ${available===null||!r.location||!available?'disabled':''}><strong>${esc(r.location||'Chưa có vị trí')}: ${available===null?'Chưa rõ SL':fmt(available)}</strong><span>${take?'✓ Lấy '+fmt(take):hint?'Gợi ý ban đầu':'Bấm để chọn'}</span></button>${available===null&&r.location?`<label><small>Xác nhận khả dụng</small><input type="number" min="0" step="any" class="picking-unknown" data-confirm-stock="${esc(r.id)}" aria-label="Khả dụng ${esc(l.productCode)} ${esc(r.location)}"></label>`:''}</div>`;
      }).join('')||'<span class="picking-bad">Chưa tìm thấy vị trí của mã này.</span>'}</div><p class="picking-line-status ${Math.abs(total-l.quantity)<1e-6?'picking-good':'picking-bad'}">${Math.abs(total-l.quantity)<1e-6?'✓ Đã chọn đủ':'Còn thiếu '+fmt(l.quantity-total)} · ${fmt(total)}/${fmt(l.quantity)}</p></td></tr>`;
    }).join('');
    const errors=R.validate(lines(order),locations(order),allocations);
    const count=lines(order).filter((l,i)=>Math.abs((allocations[i]||[]).reduce((s,p)=>s+p.quantity,0)-l.quantity)<1e-6).length;
    $('pickingProgress').textContent=count+'/'+lines(order).length+' mã đã chọn đủ vị trí';
    $('pickingConfirm').disabled=!!errors.length;$('pickingStatus').textContent=errors.length?'Chọn đủ vị trí cho tất cả mã để xác nhận.':'';
    window.PickingWorkflow?.render(order);
  }
  $('pickingRows').onclick=event=>{
    const button=event.target.closest('[data-location]');if(!button)return;
    const i=Number(button.dataset.line),line=lines(order)[i],row=locations(order).find(r=>r.id===button.dataset.location),picks=allocations[i]||[];
    if(picks.some(p=>p.id===row.id))allocations[i]=picks.filter(p=>p.id!==row.id);
    else if(row.available>=line.quantity)allocations[i]=[{id:row.id,quantity:line.quantity}];
    else{
      const total=picks.reduce((s,p)=>s+p.quantity,0);
      // Switching away from a sufficient location starts a manual split.
      const base=total>=line.quantity?[]:picks;
      allocations[i]=[...base,{id:row.id,quantity:Math.min(row.available,line.quantity-base.reduce((s,p)=>s+p.quantity,0))}];
    }
    render();
  };
  $('pickingRows').onchange=event=>{
    if(!event.target.matches('[data-confirm-stock]'))return;
    const qty=R.quantity(Number(event.target.value));if(qty===null)return;
    const row=D.get().locations.find(r=>r.id===event.target.dataset.confirmStock);row.available=qty;if(window.PickingInventory)window.PickingInventory.confirmStock(row,qty);suggest();render();
  };
  $('pickingSuggest').onclick=()=>{suggest();render();};
  $('pickingConfirm').onclick=()=>{
    if(!eligible(order)||R.validate(lines(order),locations(order),allocations).length)return;
    if(window.PickingInventory){try{window.PickingInventory.reserve(order,allocations);}catch(err){$('pickingStatus').textContent=err.message;return;}}
    const entry={fingerprint:fingerprint(order),allocations:structuredClone(allocations),note:$('pickingNote').value,at:new Date().toISOString()};
    const updated={...saved,[D.key(order)]:entry};
    try{localStorage.setItem('tks-picking-popup-v2',JSON.stringify(updated));}catch{/* Offline file may deny localStorage: retain the confirmed prototype state in memory. */}
    saved=updated;
    if(window.PickingWorkflow)render();else $('pickingDialog').close();const controls=$('pickingActions');if(controls)controls.dataset.marker='';attach();
  };
  function print(o){
    const entry=validSaved(o);if(!eligible(o)||!entry)return;
    $('pickingPrintSheet').innerHTML=`<h2>TOKOSI · PHIẾU NHẶT HÀNG</h2><h3>${esc(o.orderCode)}</h3><p>${esc(o.customerName)}<br>Cơ sở ${esc(o.branch)} · Sale: ${esc(o.saleName)}<br>Nguồn ${esc(D.source)} · ${new Date(entry.at).toLocaleString('vi-VN')}</p><table><thead><tr><th>Mã hàng</th><th>Tên hàng</th><th>SL đơn</th><th>Vị trí kho</th><th>SL lấy</th></tr></thead><tbody>${lines(o).map((l,i)=>(entry.allocations[i]||[]).map(p=>`<tr><td>${esc(l.productCode)}</td><td>${esc(l.productName)}</td><td>${fmt(l.quantity)}</td><td>${esc(locations(o).find(r=>r.id===p.id).location)}</td><td>${fmt(p.quantity)}</td></tr>`).join('')).join('')}</tbody></table><p>Ghi chú: ${esc(entry.note||'—')}</p><div class="picking-signatures"><span>Kế toán chỉ định</span><span>Người nhặt hàng</span><span>Người kiểm hàng</span></div><small>Mẫu tạm chờ format chính thức. Prototype chỉ lưu trên máy, không giữ hàng hoặc trừ tồn.</small>`;
    $('pickingPrintDialog').showModal();
  }
  $('pickingClose').onclick=()=>$('pickingDialog').close();$('pickingPrintClose').onclick=()=>$('pickingPrintDialog').close();$('pickingPrintBtn').onclick=()=>window.print();
  $('pickingDataBtn').onclick=()=>$('pickingDataDialog').showModal();$('pickingDataClose').onclick=()=>$('pickingDataDialog').close();
  $('pickingDownload').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(window.PickingDemo,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='order-picking-sample.json';a.click();URL.revokeObjectURL(url);};
  $('pickingImport').onchange=async event=>{
    try{const f=event.target.files[0];if(!f)return;if(f.size>10e6)throw Error('File tối đa 10 MB.');const input=JSON.parse(await f.text());
      if(!Array.isArray(input.orders)||!input.orders.length||input.orders.length>1000||!Array.isArray(input.locations)||input.locations.length>50000)throw Error('Cần orders và locations hợp lệ.');
      input.orders.forEach(o=>{if(!['HN','SG'].includes(o.branch)||!o.orderCode||!o.status?.code||!o.lines?.length||o.lines.some(l=>!l.productCode||R.quantity(l.quantity)===null||l.quantity<=0))throw Error('Đơn thiếu thông tin, mã hàng hoặc SL dương.');});
      input.locations.forEach(r=>{if(!['HN','SG'].includes(r.branch)||!r.code)throw Error('Vị trí thiếu cơ sở/mã hàng.');r.available=r.location?R.quantity(r.available):null;});
      D.replace(input);D.source='JSON NHẬP';
      if(typeof loadBulkOrders==='function')loadBulkOrders(true);
      $('pickingDataDialog').close();
    }catch(err){$('pickingDataError').textContent=err.message;}finally{event.target.value='';}
  };
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&['pickingDialog','pickingPrintDialog','pickingDataDialog'].some(id=>$(id).open))e.stopImmediatePropagation();},true);
  if($('lcDetailBody'))new MutationObserver(attach).observe($('lcDetailBody'),{childList:true,subtree:true});
  else if($('lcDetailKiot'))new MutationObserver(attach).observe($('lcDetailKiot'),{childList:true,subtree:true});
  window.PickingPopup={open,attach,refresh(){const r=window.PickingInventory?.record(order);if(r){allocations={};r.jobs.forEach(j=>(allocations[j.line]??=[]).push({id:j.id,quantity:j.taken+j.reserved}));}render();},getAllocations:()=>structuredClone(allocations)};
})();
