/* Nút In / Lưu file HTML cho hộp xem phiếu nhặt (#pickingPrintDialog, do pick-assign.js tạo). In qua iframe ẩn để không in cả giao diện;
   "Lưu file HTML" tải phiếu chỉ đọc đã nhúng CSS và ảnh. Chỉ cho chỉnh định dạng. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const printerIcon='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:middle;margin-right:6px"><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6zM18 12h.01"/></svg>';
// Tự chứa để dùng cùng tương tác trong file HTML tải về.
function formattingControls(host,restore=true,shared=null){
  const root=document.querySelector('#pickingPrintSheet .tokosi-invoice');
  if(!root)return;
  host.replaceChildren();
  const storageKey='tokosi.print-layout.v2.'+root.dataset.template;
  const cols=[...root.querySelectorAll('.invoice-goods col')];
  const rows=[...root.querySelectorAll('.invoice-goods tr')];
  const defaults={style:root.getAttribute('style')||'',widths:cols.map(c=>c.style.width)};
  let prefs={widths:[],heights:[],fonts:[]};
  const save=()=>{if(shared){shared.save(prefs);return;}try{localStorage.setItem(storageKey,JSON.stringify(prefs));}catch(error){/* Bộ nhớ bị chặn: vẫn cho chỉnh và in. */}};
  const pathOf=el=>{
    const parts=[];
    while(el!==root){
      parts.unshift(el.tagName.toLowerCase()+':nth-child('+([...el.parentElement.children].indexOf(el)+1)+')');
      el=el.parentElement;
    }
    return parts.join(' > ');
  };
  const textNodes=el=>{
    const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),nodes=[];
    while(walker.nextNode())nodes.push(walker.currentNode);
    return nodes;
  };
  const paint=op=>{
    if(typeof op.path!=='string'||!Number.isInteger(op.start)||!Number.isInteger(op.end)||op.start<0||op.end<=op.start||!Number.isFinite(op.size)||op.size<7||op.size>36)return;
    let block;try{block=op.path?root.querySelector(op.path):root;}catch(error){return;}
    if(!block)return;
    let offset=0;
    textNodes(block).forEach(node=>{
      const end=offset+node.length,start=Math.max(0,op.start-offset),stop=Math.min(node.length,op.end-offset);
      offset=end;
      if(stop<=start)return;
      const range=document.createRange();range.setStart(node,start);range.setEnd(node,stop);
      const span=document.createElement('span');span.dataset.printFont='';span.style.fontSize=op.size+'pt';
      range.surroundContents(span);
    });
  };
  try{
    const saved=shared?shared.layout:JSON.parse(localStorage.getItem(storageKey));
    if(restore&&saved&&Array.isArray(saved.widths)&&Array.isArray(saved.heights)&&Array.isArray(saved.fonts)){
      prefs=saved;
      const widths=saved.widths.map(Number);
      if(widths.length===cols.length&&widths.every(n=>Number.isFinite(n)&&n>=2)&&Math.abs(widths.reduce((a,b)=>a+b,0)-100)<.1)cols.forEach((c,i)=>c.style.width=widths[i]+'%');
      rows.forEach((r,i)=>{const h=Number(saved.heights[i]);if(Number.isFinite(h)&&h>=16&&h<=1200)r.style.height=h+'px';});
      saved.fonts.forEach(paint);
    }
  }catch(error){/* JSON cũ/hỏng hoặc localStorage không khả dụng. */}
  // Chạm ngay viền bảng: không thêm nút hoặc chữ vào nội dung phiếu.
  let edge=null,drag=null;
  const hit=event=>{
    const cell=event.target.closest?.('.invoice-goods td,.invoice-goods th');
    if(!cell||!root.contains(cell))return null;
    const rect=cell.getBoundingClientRect(),table=cell.closest('table');
    const index=cell.cellIndex;
    if(index<cols.length-1&&Math.abs(event.clientX-rect.right)<=5)return {type:'col',index,table};
    if(index>0&&Math.abs(event.clientX-rect.left)<=5)return {type:'col',index:index-1,table};
    if(Math.abs(event.clientY-rect.bottom)<=5)return {type:'row',row:cell.parentElement};
    if(Math.abs(event.clientY-rect.top)<=5&&cell.parentElement.previousElementSibling)return {type:'row',row:cell.parentElement.previousElementSibling};
    return null;
  };
  root.onpointermove=event=>{
    if(drag)return;
    edge=hit(event);root.style.cursor=edge?(edge.type==='col'?'col-resize':'row-resize'):'';
  };
  root.onpointerleave=()=>{if(!drag){edge=null;root.style.cursor='';}};
  root.onpointerdown=event=>{
    if(event.button!==0)return;
    edge=hit(event);if(!edge)return;
    event.preventDefault();
    drag={...edge,x:event.clientX,y:event.clientY,widths:cols.map(c=>parseFloat(c.style.width)),height:edge.row?.getBoundingClientRect().height};
    const oldSelect=root.style.userSelect;root.style.userSelect='none';
    const move=e=>{
      if(drag.type==='col'){
        const i=drag.index,total=drag.widths[i]+drag.widths[i+1],tableWidth=drag.table.getBoundingClientRect().width;
        if(!tableWidth)return;
        const width=Math.max(2,Math.min(total-2,drag.widths[i]+(e.clientX-drag.x)*100/tableWidth));
        cols[i].style.width=width+'%';cols[i+1].style.width=(total-width)+'%';
        prefs.widths=cols.map(c=>parseFloat(c.style.width));
      }else{
        drag.row.style.height=Math.max(16,Math.min(1200,drag.height+e.clientY-drag.y))+'px';
        prefs.heights=rows.map(r=>parseFloat(r.style.height)||null);
      }
    };
    const stop=()=>{
      document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',stop);document.removeEventListener('pointercancel',stop);window.removeEventListener('blur',stop);
      root.style.userSelect=oldSelect;root.style.cursor='';drag=null;save();
    };
    document.addEventListener('pointermove',move);document.addEventListener('pointerup',stop);document.addEventListener('pointercancel',stop);window.addEventListener('blur',stop);
  };
  // Chỉ bọc phần chữ được chọn, không bật contenteditable hoặc sửa số liệu.
  root.onkeydown=event=>{
    const delta=event.key===']'||event.code==='BracketRight'?1:event.key==='['||event.code==='BracketLeft'?-1:0;
    if(!event.ctrlKey||event.altKey||!delta)return;
    const selection=window.getSelection();
    if(!selection?.rangeCount||selection.isCollapsed)return;
    const selected=selection.getRangeAt(0);
    if(!root.contains(selected.startContainer)||!root.contains(selected.endContainer))return;
    event.preventDefault();
    const ops=[];
    textNodes(root).forEach(node=>{
      if(!selected.intersectsNode(node)||!node.textContent.trim())return;
      const start=node===selected.startContainer?selected.startOffset:0,end=node===selected.endContainer?selected.endOffset:node.length;
      if(end<=start)return;
      const block=node.parentElement.closest('td,th,p,h1,h2,h3,.invoice-title,.invoice-brand,.delivery-title')||root;
      let offset=0;for(const n of textNodes(block)){if(n===node)break;offset+=n.length;}
      const computed=getComputedStyle(node.parentElement).fontSize;
      const current=(parseFloat(computed)||16)*(computed.endsWith('pt')?1:.75);
      ops.push({path:pathOf(block),start:offset+start,end:offset+end,size:Math.max(7,Math.min(36,Math.round(current*2)/2+delta))});
    });
    // Dấu mốc giữ vùng bôi đen để có thể nhấn phím nhiều lần liên tiếp.
    const endMark=document.createComment('print-end'),startMark=document.createComment('print-start');
    const tail=selected.cloneRange();tail.collapse(false);tail.insertNode(endMark);
    const head=selected.cloneRange();head.collapse(true);head.insertNode(startMark);
    ops.forEach(paint);prefs.fonts.push(...ops);save();
    const next=document.createRange();next.setStartAfter(startMark);next.setEndBefore(endMark);
    selection.removeAllRanges();selection.addRange(next);startMark.remove();endMark.remove();
  };
  root.tabIndex=0;
  root.onpointerup=()=>{root.focus({preventScroll:true});};
  // Giữ tương thích font đã nhúng trong file HTML cũ, nhưng không ép cỡ chữ lên span được chọn.
  const reset=document.createElement('button');reset.type='button';reset.innerHTML='<span aria-hidden="true">↶</span> Khôi phục mặc định';host.append(reset);
  reset.onclick=()=>{
    prefs={widths:[],heights:[],fonts:[]};save();
    root.setAttribute('style',defaults.style);cols.forEach((c,i)=>c.style.width=defaults.widths[i]);rows.forEach(r=>r.style.removeProperty('height'));
    root.querySelectorAll('[data-print-font]').forEach(span=>span.replaceWith(...span.childNodes));
  };
}
const layoutWrites=new Map();
async function prepare(){
  const root=$('pickingPrintSheet')?.querySelector('.tokosi-invoice');if(!root)return;
  let host=$('pickingPrintFormatting');
  if(!host){host=document.createElement('div');host.id='pickingPrintFormatting';host.className='print-format-controls';$('pickingPrintSheet').before(host);}
  host.replaceChildren();
  const template=root.dataset.template,url='/api/shipment/pick/print-layout/'+template;
  const message=(text,state='')=>{if(root.isConnected&&$('pickingPrintMessage')){const el=$('pickingPrintMessage');el.textContent=text;el.dataset.state=state;}};
  message('Đang tải form chung…','loading');
  try{
    await layoutWrites.get(template);
    const res=await fetch(url,{credentials:'same-origin',cache:'no-store'});
    if(!res.ok)throw new Error('Không tải được form chung. Đóng rồi mở lại phiếu để thử lại.');
    const saved=await res.json();
    if(!root.isConnected)return;
    let version=saved.version,blocked=false;
    formattingControls(host,true,{layout:saved.layout,save:prefs=>{
      const layout=JSON.parse(JSON.stringify(prefs));
      message('Đang lưu form chung…','saving');
      const task=(layoutWrites.get(template)||Promise.resolve()).then(async()=>{
        if(blocked){message('Chưa lưu form chung. Đóng rồi mở lại phiếu trước khi chỉnh tiếp.','error');return;}
        const result=await fetch(url,{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({layout,version})});
        const data=await result.json();
        if(!result.ok)throw new Error(data.error||'Không lưu được form chung.');
        version=data.version;message('Đã lưu form chung','saved');
      }).catch(error=>{blocked=true;message(error.message+' Các chỉnh sửa trên phiếu này chưa được lưu chung.','error');});
      layoutWrites.set(template,task);
    }});
    const picker=$('pickingPrintTemplate');if(picker)picker.value=template;
    message(saved.version?'Đã lưu form chung':'Form mặc định','saved');
  }catch(error){message('Không tải được form chung. Đóng rồi mở lại phiếu để thử lại.','error');}
}
// Các nút này cũng được nhúng trong file đơn độc lập tải về.
function standaloneControls(){
  formattingControls(document.getElementById('pickingPrintFormatting'),false);
  async function sendToPrinter(){
    const images=[...document.images];
    await Promise.all(images.map(img=>img.complete?Promise.resolve():new Promise(resolve=>{img.addEventListener('load',resolve,{once:true});img.addEventListener('error',resolve,{once:true});})));
    window.focus();window.print();
  }
  document.getElementById('printDocument').onclick=sendToPrinter;
  if(window.__printOrderImmediately)sendToPrinter();
  document.getElementById('saveDocument').onclick=()=>{
    const blob=new Blob(['<!doctype html>\n'+document.documentElement.outerHTML],{type:'text/html;charset=utf-8'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=document.title.replace(/[\\/:*?"<>|]/g,'-')+'.html';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  };
}
function printDocument(){
  const css=[window.PickingPrintCSS||''];
  const content=$('pickingPrintSheet').cloneNode(true);
  content.querySelectorAll('[contenteditable]').forEach(el=>el.setAttribute('contenteditable','false'));
  const title=$('pickingPrintTitle').textContent;
  return '<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+'</title><style>'+css.join('\n')+'\nbody{margin:0;background:#eee;font-family:Arial,sans-serif}#pickingPrintDialog{max-width:794px;margin:20px auto;background:white}.print-controls{padding:12px;text-align:center}.print-controls button{padding:9px 14px;margin:4px;cursor:pointer}.print-controls p{font-size:12px} [contenteditable]:focus{outline:1px dashed #888}@media print{.print-controls{display:none!important}body{background:white}#pickingPrintDialog{margin:0;max-width:none}[contenteditable]:focus{outline:none}}</style></head><body><div class="print-controls"><button id="printDocument">'+printerIcon+'<span>In</span></button><button id="saveDocument">Lưu file HTML</button><p>Nội dung và số liệu chỉ đọc. Kéo viền chỉnh cột/hàng; bôi đen và Ctrl+] / Ctrl+[ chỉnh cỡ chữ. Bấm In để chọn máy in. Chỉnh form chung tại Dashboard; thay đổi trong file này chỉ áp dụng cho file này.</p></div><div id="pickingPrintFormatting" class="print-format-controls"></div><main id="pickingPrintDialog">'+content.outerHTML+'</main><script>'+formattingControls.toString()+';('+standaloneControls.toString()+')();<\/script></body></html>';
}
function save(){
  const blob=new Blob([printDocument()],{type:'text/html;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=$('pickingPrintTitle').textContent.replace(/[\\/:*?"<>|]/g,'-')+'.html';
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  $('pickingPrintMessage').textContent='Đã yêu cầu tải file HTML. Mở bằng Chrome hoặc Edge để căn định dạng và in / lưu PDF.';
}
function init(){
  const button=$('pickingPrintBtn');
  if(!button||button.dataset.ready)return;
  button.dataset.ready='1';
  button.innerHTML=printerIcon+'<span>In phiếu</span>';
  button.parentElement.classList.add('print-header-actions');
  button.insertAdjacentHTML('afterend',' <button id="pickingSavePrint" type="button"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></svg>Lưu HTML</button>');
  $('pickingPrintDialog').querySelector('.dp-head').insertAdjacentHTML('afterend',
    '<div class="print-toolbar"><label class="print-template-field" for="pickingPrintTemplate"><span>Mẫu in</span><select id="pickingPrintTemplate"><option value="order">Phiếu đặt hàng</option><option value="delivery">Phiếu xác nhận giao hàng</option></select></label>'
    +'<div class="print-save-status"><p id="pickingPrintMessage" role="status" aria-live="polite" data-state="loading">Đang tải form chung…</p><small>Định dạng dùng chung cho mọi người</small></div><div id="pickingPrintFormatting" class="print-format-controls"></div></div>'
    +'<div class="print-edit-hint"><span><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4m10-8 4 4-4 4"/></svg>Kéo viền để chỉnh cột / hàng</span><span class="print-shortcuts">Bôi đen chữ <kbd>Ctrl</kbd> + <kbd>]</kbd><span aria-hidden="true">/</span><kbd>Ctrl</kbd> + <kbd>[</kbd><span>Tăng / giảm cỡ chữ</span></span><span class="print-readonly">Nội dung chỉ đọc</span></div>');
  $('pickingPrintTemplate').onchange=async event=>{const picker=event.target;picker.disabled=true;try{await window.PickingInvoice.changeTemplate(picker.value);}catch(error){$('pickingPrintMessage').textContent='Không đổi được mẫu in. Hãy thử lại.';}finally{picker.disabled=false;}};
  button.onclick=()=>{
    $('pickingPrintFrame')?.remove();
    const frame=document.createElement('iframe');frame.id='pickingPrintFrame';frame.title='Nội dung gửi máy in';frame.setAttribute('aria-hidden','true');
    frame.style.cssText='position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0';
    frame.onload=async()=>{
      try{
        await Promise.all([...frame.contentDocument.images].map(img=>img.complete?Promise.resolve():new Promise(resolve=>{img.addEventListener('load',resolve,{once:true});img.addEventListener('error',resolve,{once:true});})));
        frame.contentWindow.focus();frame.contentWindow.print();
      }catch(error){$('pickingPrintMessage').textContent='Trình duyệt chưa mở được hộp in. Hãy mở file HTML bằng Chrome hoặc Edge rồi bấm In.';}
    };
    frame.srcdoc=printDocument();document.body.append(frame);
  };
  $('pickingSavePrint').onclick=save;
}
window.PickingPrint={init,prepare,document:printDocument,save};
})();
