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
// Decimal strings from snapshot v2 are rounded only for display, without losing large integer digits.
const decimal=v=>{
  if(v===null||v===undefined||v==='')return null;
  const s=String(v),m=/^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  return m?{negative:m[1]==='-',whole:m[2],fraction:m[3]||''}:null;
};
const money=v=>{
  const d=decimal(v);if(!d)return '—';
  let whole=BigInt(d.whole);if(d.fraction[0]>='5')whole+=1n;
  return(d.negative&&whole!==0n?'-':'')+whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g,',');
};
const sumMoney=(a,b)=>{
  const x=decimal(a),y=decimal(b);if(!x||!y)return null;
  const scale=Math.max(x.fraction.length,y.fraction.length);
  const coefficient=d=>BigInt(d.whole+d.fraction.padEnd(scale,'0'))*(d.negative?-1n:1n);
  const n=coefficient(x)+coefficient(y),digits=(n<0n?-n:n).toString().padStart(scale+1,'0');
  return(n<0n?'-':'')+(scale?digits.slice(0,-scale)+'.'+digits.slice(-scale):digits);
};
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
  let style=document.getElementById('pickingInvoiceStyle');
  if(!style){style=document.createElement('style');style.id='pickingInvoiceStyle';document.head.append(style);}
  style.textContent=window.PickingPrintCSS;
  const root=document.createElement('div');
  root.className='tokosi-invoice';root.innerHTML=window.PickingInvoiceTemplate;
  // Mẫu có selector toàn cục; stylesheet của popup đã giới hạn phạm vi cho nó.
  root.querySelectorAll('style').forEach(el=>el.remove());
  const row=[...root.querySelectorAll('tr')].find(el=>el.textContent.includes('{STT}'));
  const table=row.closest('table');table.classList.add('invoice-goods');
  let total=0,totalKnown=true,index=0;
  const v2=order.schemaVersion===2,seenCodes=new Map();
  (order.lines||[]).forEach(line=>{
    const jobs=(record.lines||[]).filter(j=>key(j.productCode)===key(line.productCode));
    const qty=Number(line.quantity);
    if(!(qty>0))return;
    const unit=v2?line.unitPrice:(typeof line.price==='number'&&Number.isFinite(line.price)?line.price-(line.discount??0):null);
    const amount=v2?line.amount:(unit===null?null:unit*qty);
    if(amount===null||amount===undefined)totalKnown=false;else if(!v2)total+=amount;
    // Cùng tên vị trí cộng gộp SL. Một vị trí: chỉ tên vị trí (số thùng đã có ở cột Thùng). Từ hai vị trí: mỗi vị trí một dòng "VT: SL", SL in đậm.
    const zones=[];
    jobs.forEach(j=>{
      const name=j.location||'—',zone=zones.find(z=>z.name===name),planned=Number(j.plannedQty)||0;
      if(zone)zone.qty+=planned;else zones.push({name,qty:planned});
    });
    const multiZone=zones.length>1;
    const priorLine=seenCodes.get(key(line.productCode));
    const placement=priorLine?'Vị trí/Thùng: xem dòng '+priorLine:zones.map(z=>z.name).join(' / ');
    // ST lấy từ bản ghi chỉ định nên in lại ra cùng số; trống khi đã Hủy nhặt hoặc chưa có quy cách thùng.
    const cancelled=record.status==='cancelled';
    const stLabel=cancelled||priorLine?'':jobs.map(j=>j.stText).filter(Boolean).join(' + ');
    const cartons=jobs.every(j=>typeof j.stCartons==='number')&&jobs.length?jobs.reduce((n,j)=>n+j.stCartons,0):null;
    const rendered=document.createElement('tbody');
    rendered.innerHTML=replace(row.outerHTML,{
      STT:++index,Ten_Hang_Hoa_Don_Gian:line.productName+' ('+line.productCode+')',
      So_Luong:qtyText(qty),Don_Gia_Sau_Chiet_Khau:money(unit),Thanh_Tien:money(amount),
      Vi_Tri_Hang_Hoa:placement,Ghi_Chu_Hang_Hoa:line.note||'',Thuc_Te_Nhat:'',ST:cancelled||priorLine?'':(stLabel||stText(cartons))
    });
    const item=rendered.firstElementChild;
    if(!priorLine&&!cancelled&&(stLabel?stLabel.includes('-'):cartons!==null&&!Number.isInteger(cartons)))item.querySelector('td.invoice-st')?.classList.add('invoice-st-frac');
    const locationCell=item.querySelector('td.invoice-location');
    if(multiZone&&!priorLine&&locationCell)locationCell.replaceChildren(...zones.map(z=>{
      const div=document.createElement('div'),qtyNode=document.createElement('b');
      div.className='invoice-loc-line';qtyNode.textContent=qtyText(z.qty);
      div.append(z.name+': ',qtyNode);return div;
    }));
    row.before(item);
    if(!priorLine)seenCodes.set(key(line.productCode),index);
  });
  row.remove();
  const discount=order.invoiceDiscount,prior=order.priorDebt;
  if(v2){total=order.goodsTotal;totalKnown=decimal(total)!==null;}
  const payable=v2?order.payable:(totalKnown&&typeof discount==='number'&&Number.isFinite(discount)?total-discount:null);
  const debt=sumMoney(payable,prior);
  const now=new Date();
  const dateParts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Ho_Chi_Minh',day:'numeric',month:'numeric',year:'numeric'}).formatToParts(now);
  const datePart=name=>dateParts.find(part=>part.type===name).value;
  root.innerHTML=replace(root.innerHTML,{
    // Bản in ghi cả ID Telegram cạnh tên sale, đúng dạng KiotViet lưu: "<tên> - <ID>".
    Nhan_Vien_Ban_Hang:(order.saleName||'')+(order.saleTelegramId?' - '+order.saleTelegramId:''),Dien_Thoai_Nguoi_Ban:order.sellerPhone,
    Ma_Don_Hang:order.orderCode,Khach_Hang:order.customerName,So_Dien_Thoai:order.customerPhone,Dia_Chi_Khach_Hang:order.customerAddress,
    Tong_Tien_Hang:money(totalKnown?total:null),Chiet_Khau_Hoa_Don:money(discount),Tong_Cong:money(payable),Du_No_Truoc:money(prior),
    Du_No_Hoa_Don:money(debt),Du_No_Tam_Tinh:money(debt),
    Ghi_Chu:order.note||'',Ngay:datePart('day'),Thang:datePart('month'),Nam:datePart('year')
  });
  const title='PHIẾU ĐẶT HÀNG';
  const heading=[...root.querySelectorAll('strong')].find(el=>/HÓA ĐƠN\s*BÁN\s*HÀNG/.test(el.textContent.replace(/ /g,' ')));
  if(heading)heading.textContent=title;
  const marker=document.createElement('p');marker.className='invoice-demo';
  marker.textContent=order.orderCode+' · '+(order.branch==='SG'?'Sài Gòn':'Hà Nội')+' · Chưa ghi thực tế nhặt'+(record.assignedByName?' · Chỉ định bởi '+record.assignedByName:'')+'.';
  root.append(marker);
  if(!v2){const warning=document.createElement('p');warning.className='invoice-legacy';warning.textContent='Phiếu cũ chưa lưu dòng gốc; tiền hiển thị theo dữ liệu đã lưu, chưa đối chiếu được chi tiết ban đầu.';root.prepend(warning);}
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
