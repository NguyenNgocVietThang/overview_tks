/* Phiếu nhặt hàng (mẫu "PHIẾU ĐẶT HÀNG" 9 cột) cho Chỉ định vị trí của trang Vòng đời.
   Dữ liệu từ bản ghi chỉ định trên máy chủ: assignment.snapshot (đơn lúc chỉ định) + assignment.lines (vị trí đã chỉ định),
   nên in lại luôn ra đúng nội dung. Mẫu HTML, CSS và 3 ảnh QR nằm cạnh file này; ảnh được nhúng dạng data URI để file HTML tải về vẫn đủ ảnh. */
(function(){
'use strict';
const BASE='/shipment/lifecycle/pick/';
const CDN=/https:\/\/cdn2-retail-images\.kiotviet\.vn\/2026\/10\/05\/chhanoi\/([a-f0-9]+)\.jpg/g;
const key=v=>String(v??'').trim().toLowerCase();
const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const qtyText=v=>Number(v).toLocaleString('en-US',{maximumFractionDigits:3});
const stText=v=>v===null||v===undefined?'':Number(v).toLocaleString('en-US',{maximumFractionDigits:2});
const money=v=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('en-US',{maximumFractionDigits:0}):'—';
const replace=(html,values)=>html.replace(/\{([^{}]+)\}/g,(token,k)=>Object.hasOwn(values,k)?esc(values[k]):token);
let assetsPromise=null;

async function fetchText(url){
  const res=await fetch(url,{credentials:'same-origin'});
  if(!res.ok)throw new Error('Không tải được '+url);
  return res.text();
}
// Ảnh → data URI; lỗi thì giữ đường dẫn (bản in trực tiếp vẫn hiện, chỉ file HTML tải về thiếu ảnh).
async function dataUri(url){
  try{
    const res=await fetch(url,{credentials:'same-origin'});
    if(!res.ok||typeof res.blob!=='function')return url;
    const blob=await res.blob();
    return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(blob);});
  }catch(error){return url;}
}
function loadAssets(){
  if(window.PickingInvoiceTemplate&&window.PickingPrintCSS)return Promise.resolve();
  if(!assetsPromise){
    assetsPromise=(async()=>{
      const [template,css]=await Promise.all([fetchText(BASE+'order-template.tpl'),fetchText(BASE+'invoice-a4.css')]);
      let out=template;
      for(const id of new Set([...template.matchAll(CDN)].map(m=>m[1]))){
        const uri=await dataUri(BASE+'invoice-assets/'+id+'.jpg');
        out=out.split('https://cdn2-retail-images.kiotviet.vn/2026/10/05/chhanoi/'+id+'.jpg').join(uri);
      }
      window.PickingInvoiceTemplate=out;
      window.PickingPrintCSS=css;
    })().catch(error=>{assetsPromise=null;throw error;});
  }
  return assetsPromise;
}

/* order: assignment.snapshot (+ orderCode, branch); record: assignment. Trả Promise (nạp mẫu lần đầu cần mạng). */
async function show(order,record){
  await loadAssets();
  const root=document.createElement('div');
  root.className='tokosi-invoice';root.innerHTML=window.PickingInvoiceTemplate;
  // Mẫu có selector toàn cục; stylesheet của popup đã giới hạn phạm vi cho nó.
  root.querySelectorAll('style').forEach(el=>el.remove());
  const row=[...root.querySelectorAll('tr')].find(el=>el.textContent.includes('{STT}'));
  const table=row.closest('table');table.classList.add('invoice-goods');
  let total=0,totalKnown=true,index=0;
  (order.lines||[]).forEach(line=>{
    const jobs=(record.lines||[]).filter(j=>key(j.productCode)===key(line.productCode));
    const qty=Number(line.quantity);
    if(!(qty>0))return;
    const unit=typeof line.price==='number'&&Number.isFinite(line.price)?line.price-(line.discount??0):null;
    const amount=unit===null?null:unit*qty;
    if(amount===null)totalKnown=false;else total+=amount;
    const assigned=jobs.map(j=>j.location||'—');
    // Một khu: chỉ tên khu. Từ hai khu trở lên: mỗi khu một dòng "Tên khu: số thùng" (vd "A07: 1Tx50" / "B06: 2Tx60-20"); thiếu quy cách thì ghi SL.
    const multiZone=new Set(assigned).size>1;
    const placement=multiZone?jobs.map((j,n)=>assigned[n]+': '+(j.stText||j.plannedQty)).join('\n'):[...new Set(assigned)].join(' / ');
    // ST lấy từ bản ghi chỉ định nên in lại ra cùng số; trống khi đã Hủy nhặt hoặc chưa có quy cách thùng.
    const cancelled=record.status==='cancelled';
    const stLabel=cancelled?'':jobs.map(j=>j.stText).filter(Boolean).join(' + ');
    const cartons=jobs.every(j=>typeof j.stCartons==='number')&&jobs.length?jobs.reduce((n,j)=>n+j.stCartons,0):null;
    const rendered=document.createElement('tbody');
    rendered.innerHTML=replace(row.outerHTML,{
      STT:++index,Ten_Hang_Hoa_Don_Gian:line.productName+' ('+line.productCode+')',
      So_Luong:qtyText(qty),Don_Gia_Sau_Chiet_Khau:money(unit),Thanh_Tien:money(amount),
      Vi_Tri_Hang_Hoa:placement,Ghi_Chu_Hang_Hoa:line.note||'',Thuc_Te_Nhat:'',ST:cancelled?'':(stLabel||stText(cartons))
    });
    const item=rendered.firstElementChild;
    if(stLabel?stLabel.includes('-'):cartons!==null&&!Number.isInteger(cartons))item.querySelector('td.invoice-st')?.classList.add('invoice-st-frac');
    if(multiZone)[...item.querySelectorAll('td')].filter(td=>td.textContent.includes(assigned[0]+': ')).forEach(td=>{td.style.whiteSpace='pre-line';});
    row.before(item);
  });
  row.remove();
  const discount=order.invoiceDiscount,prior=order.priorDebt;
  const payable=totalKnown&&typeof discount==='number'&&Number.isFinite(discount)?total-discount:null;
  const now=new Date();
  root.innerHTML=replace(root.innerHTML,{
    // Bản in ghi cả ID Telegram cạnh tên sale, đúng dạng KiotViet lưu: "<tên> - <ID>".
    Nhan_Vien_Ban_Hang:(order.saleName||'')+(order.saleTelegramId?' - '+order.saleTelegramId:''),Dien_Thoai_Nguoi_Ban:order.sellerPhone,
    Ma_Don_Hang:order.orderCode,Khach_Hang:order.customerName,So_Dien_Thoai:order.customerPhone,Dia_Chi_Khach_Hang:order.customerAddress,
    Tong_Tien_Hang:money(totalKnown?total:null),Chiet_Khau_Hoa_Don:money(discount),Tong_Cong:money(payable),Du_No_Truoc:money(prior),
    Du_No_Hoa_Don:money(payable!==null&&typeof prior==='number'&&Number.isFinite(prior)?payable+prior:null),
    Du_No_Tam_Tinh:money(payable!==null&&typeof prior==='number'&&Number.isFinite(prior)?payable+prior:null),
    Ghi_Chu:order.note||'',Ngay:now.getDate(),Thang:now.getMonth()+1,Nam:now.getFullYear()
  });
  const title='PHIẾU ĐẶT HÀNG';
  const heading=[...root.querySelectorAll('strong')].find(el=>/HÓA ĐƠN\s*BÁN\s*HÀNG/.test(el.textContent.replace(/ /g,' ')));
  if(heading)heading.textContent=title;
  const marker=document.createElement('p');marker.className='invoice-demo';
  marker.textContent=order.orderCode+' · '+(order.branch==='SG'?'Sài Gòn':'Hà Nội')+' · Chưa ghi thực tế nhặt'+(record.assignedByName?' · Chỉ định bởi '+record.assignedByName:'')+'.';
  root.prepend(marker);
  root.setAttribute('contenteditable','true');
  root.setAttribute('aria-label','Nội dung phiếu có thể chỉnh sửa trước khi in');
  root.setAttribute('spellcheck','false');
  const printMessage=document.getElementById('pickingPrintMessage');if(printMessage)printMessage.textContent='';
  document.getElementById('pickingPrintTitle').textContent=title+' · '+order.orderCode;
  document.getElementById('pickingPrintSheet').replaceChildren(root);
  document.getElementById('pickingPrintDialog').showModal();
}
window.PickingInvoice={show,loadAssets};
})();
