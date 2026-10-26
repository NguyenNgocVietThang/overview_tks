(function(){
'use strict';
const $=id=>document.getElementById(id);
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=$('pickingPrintBtn');
const printerIcon='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:middle;margin-right:6px"><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6zM18 12h.01"/></svg>';
button.innerHTML=printerIcon+'<span>In</span>';
button.insertAdjacentHTML('afterend',' <button id="pickingSavePrint" type="button">Lưu file HTML</button>');
$('pickingPrintDialog').querySelector('.dp-head').insertAdjacentHTML('afterend','<p class="print-edit-hint">Bấm vào nội dung phiếu để sửa trước khi in hoặc lưu. Sửa tại đây chỉ áp dụng bản in; số thực nhặt ghi nhận tại bảng chỉ định vị trí.</p><p id="pickingPrintMessage" role="status"></p>');
// These controls are also embedded in the downloaded, independent order file.
function standaloneControls(){
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
  const css=[window.PickingPrintCSS];
  const content=$('pickingPrintSheet').cloneNode(true);
  content.querySelectorAll('[contenteditable]').forEach(el=>el.setAttribute('contenteditable','true'));
  const title=$('pickingPrintTitle').textContent;
  return '<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+'</title><style>'+css.join('\n')+'\nbody{margin:0;background:#eee;font-family:Arial,sans-serif}#pickingPrintDialog{max-width:794px;margin:20px auto;background:white}.print-controls{padding:12px;text-align:center}.print-controls button{padding:9px 14px;margin:4px;cursor:pointer}.print-controls p{font-size:12px} [contenteditable]:focus{outline:1px dashed #888}@media print{.print-controls{display:none!important}body{background:white}#pickingPrintDialog{margin:0;max-width:none}[contenteditable]:focus{outline:none}}</style></head><body><div class="print-controls"><button id="printDocument">'+printerIcon+'<span>In</span></button><button id="saveDocument">Lưu file HTML</button><p>Bấm nội dung để sửa. Bấm In để chọn máy in.</p></div><main id="pickingPrintDialog">'+content.outerHTML+'</main><script>('+standaloneControls.toString()+')();<\/script></body></html>';
}
function save(){
  const blob=new Blob([printDocument()],{type:'text/html;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=$('pickingPrintTitle').textContent.replace(/[\\/:*?"<>|]/g,'-')+'.html';
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  $('pickingPrintMessage').textContent='Đã yêu cầu tải file HTML. Mở file bằng Chrome hoặc Edge để sửa và in / lưu PDF.';
}
button.onclick=()=>{
  $('pickingPrintFrame')?.remove();
  const frame=document.createElement('iframe');frame.id='pickingPrintFrame';frame.title='Nội dung gửi máy in';frame.setAttribute('aria-hidden','true');
  frame.style.cssText='position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0';
  frame.onload=async()=>{
    try{
      await Promise.all([...frame.contentDocument.images].map(img=>img.complete?Promise.resolve():new Promise(resolve=>{img.addEventListener('load',resolve,{once:true});img.addEventListener('error',resolve,{once:true});})));
      frame.contentWindow.focus();frame.contentWindow.print();
      $('pickingPrintMessage').textContent='';
    }catch(error){$('pickingPrintMessage').textContent='Trình duyệt chưa mở được hộp in. Hãy mở file HTML bằng Chrome hoặc Edge rồi bấm In.';}
  };
  frame.srcdoc=printDocument();document.body.append(frame);
};
$('pickingSavePrint').onclick=save;
window.PickingPrint={document:printDocument,save};
})();
