(function(){
  'use strict';
  const $=id=>document.getElementById(id),R=window.PickingRules,D=window.PickingData;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=v=>Number(v||0).toLocaleString('vi-VN',{maximumFractionDigits:3});
  const fmtSt=v=>Number(v).toLocaleString('en-US',{maximumFractionDigits:2});
  const C=window.PickingCarton||null;
  const STATUS_LABEL={picking:'Đang nhặt',confirmed:'Xác nhận nhặt',cancelled:'Hủy nhặt'};
  let order=null,allocations={},suggestions={},saved={};
  try{saved=JSON.parse(localStorage.getItem('tks-picking-popup-v2')||'{}');}catch{}
  /* Chỉ vị trí của đúng cơ sở của đơn (HN không lẫn SG). SL khả dụng và quy cách thùng lấy từ sổ vị trí; vị trí có ghi chú
     sai định dạng không tính được SL nên không chọn được. */
  const locations=o=>D.get().locations.filter(r=>r.branch===o.branch).map(r=>{
    const I=window.PickingInventory;if(!I)return r;
    const info=I.cartonInfo(r),row=I.row(r);
    return {...r,available:I.available(r,D.key(o)),perCarton:info?.perCarton??null,terms:info?.terms,loose:info?.loose??0,specText:row.notes,warnings:row.warnings};
  });
  // ST của một dòng: chỉ hiện khi đã chỉ định đủ SL của dòng (R.validate đạt) và đơn chưa Hủy nhặt; lẻ thì hiện đỏ.
  const stOfLine=(i,l,picks)=>{
    const I=window.PickingInventory;if(!I)return null;
    const record=I.record(order);
    if(record)return record.status==='cancelled'?null:I.lineSt(order,i);
    if(R.validate([l],locations(order),{0:picks}).length)return null;
    const parts=picks.map(p=>I.cartonsFor(D.get().locations.find(r=>r.id===p.id),p.quantity));
    return parts.some(v=>v===null)?null:Math.round(parts.reduce((n,v)=>n+v,0)*1e6)/1e6;
  };
  const lines=o=>o.lines.filter(l=>!R.key(l.productCode).startsWith('vat'));
  const candidates=(o,l)=>locations(o).filter(r=>R.key(r.code)===R.key(l.productCode));
  const eligible=o=>o?.summary?.code==='SENT_TO_ACCOUNTANT';
  const fingerprint=o=>JSON.stringify({algorithm:R.version,source:D.source,order:o,locations:locations(o)});
  function current(){
    if(typeof detailOrder!=='undefined'&&detailOrder)return D.get().orders.find(o=>o.orderCode===detailOrder.orderCode&&o.branch===detailOrder.branch);
    return D.get().orders.find(o=>o.orderCode===$('lcDetailTitle')?.textContent.trim());
  }
  function validSaved(o){if(window.PickingInventory&&!window.PickingInventory.has(o))return null;const s=saved[D.key(o)];return s?.fingerprint===fingerprint(o)&&!R.validate(lines(o),locations(o),s.allocations).length?s:null;}
  /* Cột ST ngay bên phải cột SL đặt của bảng Hàng hóa trong đơn: trống khi chưa chỉ định hoặc dòng chưa đủ SL phân bổ,
     có số khi đã chỉ định đủ (đỏ khi lẻ), trống lại sau Hủy nhặt. Cùng nguồn với phiếu in: PickingInventory.lineSt. */
  function injectSt(o,holder){
    const table=holder.querySelector('table.lc-lines');if(!table||!o)return;
    const I=window.PickingInventory,marker=D.key(o)+'|'+(I?.version||0)+'|'+table.tBodies[0]?.rows.length;
    if(table.dataset.stMarker===marker&&table.querySelector('th[data-st-col]'))return;
    table.querySelectorAll('[data-st-col]').forEach(el=>el.remove());
    const headRow=table.tHead.rows[0];
    const th=document.createElement('th');th.className='num';th.dataset.stCol='1';th.textContent='ST';th.title='Số thùng thực nhặt theo chỉ định (SL nhặt / SL mỗi thùng). Trống khi chưa chỉ định đủ SL.';
    headRow.cells[2].after(th);
    [...table.tBodies[0].rows].forEach((row,index)=>{
      const td=document.createElement('td');td.className='num lc-st';td.dataset.stCol='1';
      const line=row.dataset.lineIndex!==undefined?Number(row.dataset.lineIndex):index,info=I?I.lineSt(o,line):null;
      if(info!==null&&info!==undefined){td.textContent=fmtSt(info);td.dataset.st=info;if(!C.isWhole(info))td.classList.add('picking-st-frac');}
      row.cells[2].after(td);
    });
    table.dataset.stMarker=marker;
  }
  /* Chip lọc trạng thái nhặt của cả đơn trên danh sách Vòng đời: Đang nhặt / Xác nhận nhặt / Hủy nhặt, kèm số đơn.
     Lọc ở máy khách trên các dòng đang hiển thị (trang hiện tại); số đếm tính trên mọi đơn đã chỉ định trong phiên. */
  let pickFilter='';
  function statusFilter(){
    const table=$('bulkTable'),I=window.PickingInventory;if(!table||!I||!table.tBodies[0])return;
    let bar=$('pickingStatusFilter');
    if(!bar){
      bar=document.createElement('div');bar.id='pickingStatusFilter';bar.className='picking-status-filter';bar.setAttribute('role','group');bar.setAttribute('aria-label','Lọc trạng thái nhặt');
      (table.closest('.table-wrap,.dp-table-wrap')||table).before(bar);
      bar.onclick=event=>{const button=event.target.closest('[data-pick-status]');if(!button)return;pickFilter=button.dataset.pickStatus;statusFilter();};
    }
    const statuses=I.statuses(),counts={picking:0,confirmed:0,cancelled:0};Object.values(statuses).forEach(v=>{counts[v]++;});
    bar.innerHTML=[['','Tất cả'],['picking','Đang nhặt'],['confirmed','Xác nhận nhặt'],['cancelled','Hủy nhặt']].map(([key,label])=>`<button type="button" data-pick-status="${key}" aria-pressed="${pickFilter===key}" class="picking-chip${pickFilter===key?' active':''}">${label}${key?' ('+counts[key]+')':''}</button>`).join('');
    [...table.tBodies[0].rows].forEach(row=>{
      const code=row.cells[0]?.textContent.trim(),branch=/Sài Gòn|SG/.test(row.cells[1]?.textContent||'')?'SG':'HN';
      row.hidden=!!pickFilter&&statuses[branch+'|'+code]!==pickFilter;
    });
  }
  function attach(){
    statusFilter();
    const o=current(),holder=$('lcDetailKiot');if(!holder)return;
    injectSt(o,holder);
    const head=holder.querySelector('.dp-section-head');if(!head)return;
    let controls=$('pickingActions');
    if(!eligible(o)){controls?.remove();return;}
    if(!controls){controls=document.createElement('span');controls.id='pickingActions';controls.className='picking-actions';head.appendChild(controls);}
    const marker=D.key(o)+'|'+!!validSaved(o)+'|'+(window.PickingInventory?.version||0);if(controls.dataset.marker===marker)return;
    controls.dataset.marker=marker;
    controls.innerHTML='<button id="openPickingBtn" class="btn-primary picking-open-btn">Chỉ định vị trí</button>'+(window.PickingInventory?.has(o)?'<span class="picking-confirmed" data-status="'+window.PickingInventory.status(o)+'">✓ Đã chỉ định · '+STATUS_LABEL[window.PickingInventory.status(o)]+'</span>':'');
    $('openPickingBtn').onclick=()=>open(o);
    if($('openPickingPrint'))$('openPickingPrint').onclick=()=>print(o);
  }
  function suggest(){
    allocations={};const used=new Map();
    lines(order).forEach((line,i)=>{
      const available=candidates(order,line).map(r=>({...r,available:R.quantity(r.available)===null?null:Math.max(0,r.available-(used.get(r.id)||0))}));
      const cartoned=C?available.filter(c=>c.available>0):[];
      const byCarton=cartoned.length&&cartoned.every(c=>c.terms&&c.terms.length)?C.suggest(line.quantity,cartoned.map(c=>({id:c.id,available:c.available,terms:c.terms,loose:c.loose}))):null;
      allocations[i]=(byCarton||R.suggest(line.quantity,available)).picks;
      allocations[i].forEach(p=>used.set(p.id,(used.get(p.id)||0)+p.quantity));
    });
    suggestions=structuredClone(allocations);
  }
  function open(o){
    if(!eligible(o))return;
    order=o;suggest();const entry=validSaved(o);if(entry)allocations=structuredClone(entry.allocations);
    const record=window.PickingInventory?.record(o);if(record){allocations={};record.jobs.forEach(j=>{(allocations[j.line]??=[]).push({id:j.id,quantity:(j.taken+j.reserved)||(record.status==='cancelled'?j.planned:0)||0});});}
    $('pickingNote').value=entry?.note||'';$('pickingTitle').innerHTML=esc(o.orderCode+' · '+(o.branch==='HN'?'Hà Nội':'Sài Gòn'))+(D.source==='MÔ PHỎNG'?' <span class="picking-badge">Mô phỏng</span>':'');
    $('pickingSource').textContent='Bản '+R.version+' · Nguồn: '+D.source+' · '+(entry?'Đang khôi phục chỉ định đã xác nhận. Bấm “Gợi ý lại” để tính phương án mới.':'Gợi ý mới: chọn vị trí đủ hàng có lượng khả dụng sát số cần nhất.');
    render();$('pickingDialog').showModal();
  }
  // Dòng đã phân bổ đủ: đúng SL cần, hoặc làm tròn lên thùng nguyên (vượt chưa tới một thùng) — cùng luật với R.validate.
  const lineOk=i=>!R.validate([lines(order)[i]],locations(order),{0:allocations[i]||[]}).length;
  function render(){
    $('pickingRows').innerHTML=lines(order).map((l,i)=>{
      const picks=allocations[i]||[],total=picks.reduce((s,p)=>s+p.quantity,0),rows=candidates(order,l);
      const unknown=rows.some(r=>R.quantity(r.available)===null);
      const before=rows.reduce((s,r)=>s+(R.quantity(r.available)||0),0);
      const selected=lines(order).reduce((s,line,j)=>s+(R.key(line.productCode)===R.key(l.productCode)?(allocations[j]||[]).reduce((n,p)=>n+p.quantity,0):0),0);
      const remaining=before-selected;
      const shared=window.PickingInventory?.summary(order.branch,l.productCode)||{onHand:unknown?null:before,held:0,available:unknown?null:before};
      const st=stOfLine(i,l,picks);
      return `<tr><td class="picking-code">${esc(l.productCode)}</td><td>${esc(l.productName)}</td><td class="picking-need"><strong>${fmt(l.quantity)}</strong><small class="${lineOk(i)?'picking-good':'picking-bad'}" data-allocated="${total}">${fmt(total)}/${fmt(l.quantity)}</small></td><td class="picking-st" data-st="${st===null?'':st}"><strong class="${st!==null&&!C?.isWhole(st)?'picking-st-frac':''}">${st===null?'':fmtSt(st)}</strong></td><td class="picking-total" data-total-code="${esc(l.productCode)}" data-shared-available="${shared.available??'unknown'}" data-remaining="${unknown?'unknown':remaining}"><strong class="${shared.available===null?'picking-bad':'picking-good'}">${shared.available===null?'Chưa xác định':fmt(shared.available)}</strong></td><td><div class="picking-locations">${rows.map(r=>{
        const take=picks.find(p=>p.id===r.id)?.quantity||0,available=R.quantity(r.available),hint=(suggestions[i]||[]).some(p=>p.id===r.id);
        const off=available===null||!r.location||!available?'disabled':'';
        const locSt=take&&window.PickingInventory?window.PickingInventory.cartonsFor(D.get().locations.find(x=>x.id===r.id),take):null;
        return `<div class="picking-loc ${take?'selected':''}" data-zone="${esc(String(r.location||'').trim().charAt(0).toUpperCase())}"><button type="button" class="picking-location ${take?'selected':''} ${hint?'suggested':''}" data-line="${i}" data-location="${esc(r.id)}" aria-pressed="${!!take}" ${off}><strong>${esc(r.location||'Chưa có vị trí')}</strong><span>${available===null?(r.warnings?.length?esc(C.WARNING_LABEL[r.warnings[0]]):'Chưa rõ SL'):fmt(available)}</span>${r.specText?`<small class="picking-spec ${r.warnings?.length?'picking-st-frac':''}" title="${esc((r.warnings||[]).map(w=>C.WARNING_LABEL[w]).join(', '))}">${esc(r.specText)}</small>`:''}</button><div class="picking-qty"><div class="picking-stepper"><button type="button" data-step="-1" data-qline="${i}" data-qloc="${esc(r.id)}" aria-label="Giảm SL nhặt ${esc(l.productCode)} ${esc(r.location)}" ${off}>−</button><input type="text" inputmode="decimal" data-qty data-qline="${i}" data-qloc="${esc(r.id)}" value="${fmt(take)}" aria-label="SL nhặt ${esc(l.productCode)} ${esc(r.location)}" ${off}><button type="button" data-step="1" data-qline="${i}" data-qloc="${esc(r.id)}" aria-label="Tăng SL nhặt ${esc(l.productCode)} ${esc(r.location)}" ${off}>+</button></div></div>${locSt===null?'':`<small class="picking-loc-st ${C.isWhole(locSt)?'':'picking-st-frac'}" data-loc-st="${locSt}">ST ${fmtSt(locSt)}</small>`}</div>`;
      }).join('')||'<span class="picking-bad">Chưa tìm thấy vị trí của mã này.</span>'}</div></td></tr>`;
    }).join('');
    const errors=R.validate(lines(order),locations(order),allocations);
    const count=lines(order).filter((l,i)=>lineOk(i)).length;
    $('pickingProgress').textContent=count+'/'+lines(order).length+' mã hàng đã phân bổ đủ';
    $('pickingConfirm').disabled=!!errors.length;$('pickingStatus').textContent=errors.length?'Chọn đủ vị trí cho tất cả mã để xác nhận.':'';
    // Đã giữ chỗ: khóa chỉ định, chỉ còn in lại phiếu nhặt.
    const record=window.PickingInventory?.record(order);
    $('pickingSuggest').disabled=!!record;
    if(record){
      $('pickingConfirm').disabled=true;$('pickingConfirm').textContent='Đã xác nhận vị trí';
      $('pickingRows').querySelectorAll('[data-location],[data-confirm-stock],[data-qty],[data-step]').forEach(e=>e.disabled=true);
    }else $('pickingConfirm').textContent='Xác nhận & In phiếu nhặt';
    const status=window.PickingInventory?.status(order);
    $('pickingOrderStatus').textContent=status?STATUS_LABEL[status]:'Chưa chỉ định';$('pickingOrderStatus').dataset.status=status||'';
    $('pickingConfirmPick').hidden=status!=='picking';
    $('pickingCancelPick').hidden=!(status==='picking'||status==='confirmed');
    $('pickingReopen').hidden=!(status==='confirmed'||status==='cancelled');
    $('pickingReopen').dataset.armed='';$('pickingReopen').textContent='Chỉ định lại';
    let reprint=$('pickingReprint');
    if(record&&!reprint){reprint=document.createElement('button');reprint.id='pickingReprint';reprint.type='button';reprint.textContent='In đơn';reprint.onclick=()=>printPick();$('pickingConfirm').after(reprint);}
    if(reprint)reprint.hidden=!record||record.status==='cancelled';
  }
  const parseQty=text=>{const n=Number(String(text).trim().replace(/\./g,'').replace(',','.'));return Number.isFinite(n)?n:0;};
  // SL nhặt tại một vị trí: không âm, không vượt tồn khả dụng của vị trí và không làm tổng của dòng vượt SL cần nhặt.
  function setQty(i,id,value){
    const line=lines(order)[i],row=locations(order).find(r=>r.id===id),available=R.quantity(row?.available);
    if(!line||available===null)return;
    const picks=allocations[i]||[],others=picks.filter(p=>p.id!==id).reduce((s,p)=>s+p.quantity,0);
    const usedByOtherLines=lines(order).reduce((s,_,j)=>s+(j===i?0:(allocations[j]||[]).filter(p=>p.id===id).reduce((n,p)=>n+p.quantity,0)),0);
    const cap=Math.max(0,Math.min(available-usedByOtherLines,line.quantity-others+(row.perCarton?row.perCarton-1:0)));
    const qty=Math.round(Math.min(Math.max(0,value),cap)*1e6)/1e6;
    allocations[i]=[...picks.filter(p=>p.id!==id),...(qty>0?[{id,quantity:qty}]:[])].sort((a,b)=>candidates(order,line).findIndex(r=>r.id===a.id)-candidates(order,line).findIndex(r=>r.id===b.id));
  }
  $('pickingRows').onclick=event=>{
    const step=event.target.closest('[data-step]');
    if(step){const i=Number(step.dataset.qline),id=step.dataset.qloc,now=(allocations[i]||[]).find(p=>p.id===id)?.quantity||0;const unit=locations(order).find(r=>r.id===id)?.perCarton||1;setQty(i,id,now+Number(step.dataset.step)*unit);render();return;}
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
    if(event.target.matches('[data-qty]')){setQty(Number(event.target.dataset.qline),event.target.dataset.qloc,parseQty(event.target.value));render();return;}
  };
  $('pickingSuggest').onclick=()=>{suggest();render();};
  // Trạng thái nhặt thuộc cả đơn: Đang nhặt → Xác nhận nhặt (trừ thùng) hoặc Hủy nhặt (trả lại); cả hai cho chỉ định lại.
  function changeStatus(action){
    try{action();}catch(err){$('pickingStatus').textContent=err.message;return;}
    $('pickingStatus').textContent='';
    const controls=$('pickingActions');if(controls)controls.dataset.marker='';
    window.PickingPopup.refresh();attach();
  }
  $('pickingConfirmPick').onclick=()=>changeStatus(()=>window.PickingInventory.confirmPick(order));
  $('pickingCancelPick').onclick=()=>changeStatus(()=>window.PickingInventory.cancelPick(order));
  $('pickingReopen').onclick=()=>{
    const confirmed=window.PickingInventory.status(order)==='confirmed',button=$('pickingReopen');
    // Sau Xác nhận nhặt, chỉ định lại sẽ hoàn tác số thùng đã trừ: bấm hai lần để xác nhận.
    if(confirmed&&!button.dataset.armed){button.dataset.armed='1';button.textContent='Bấm lại để hoàn tác nhặt và chỉ định lại';return;}
    changeStatus(()=>{window.PickingInventory.reopen(order);delete saved[D.key(order)];suggest();});
  };
  $('pickingConfirm').onclick=()=>{
    if(!eligible(order)||R.validate(lines(order),locations(order),allocations).length)return;
    if(window.PickingInventory){try{window.PickingInventory.reserve(order,allocations);}catch(err){$('pickingStatus').textContent=err.message;return;}}
    const entry={fingerprint:fingerprint(order),allocations:structuredClone(allocations),note:$('pickingNote').value,at:new Date().toISOString()};
    const updated={...saved,[D.key(order)]:entry};
    try{localStorage.setItem('tks-picking-popup-v2',JSON.stringify(updated));}catch{/* Offline file may deny localStorage: retain the confirmed prototype state in memory. */}
    saved=updated;
    $('pickingDialog').close();const controls=$('pickingActions');if(controls)controls.dataset.marker='';attach();
    printPick();
  };
  function printPick(){
    const record=window.PickingInventory?.record(order);
    if(record&&window.PickingInvoice)window.PickingInvoice.show(order,record);else print(order);
  }
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
  if($('bulkBody'))new MutationObserver(statusFilter).observe($('bulkBody'),{childList:true});
  if($('lcDetailBody'))new MutationObserver(attach).observe($('lcDetailBody'),{childList:true,subtree:true});
  else if($('lcDetailKiot'))new MutationObserver(attach).observe($('lcDetailKiot'),{childList:true,subtree:true});
  window.PickingPopup={open,attach,refresh(){const r=window.PickingInventory?.record(order);if(r){allocations={};r.jobs.forEach(j=>(allocations[j.line]??=[]).push({id:j.id,quantity:(j.taken+j.reserved)||(r.status==='cancelled'?j.planned:0)||0}));}render();},getAllocations:()=>structuredClone(allocations)};
})();
