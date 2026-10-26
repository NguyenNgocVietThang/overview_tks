(function(){
'use strict';
const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('vi-VN'):'—';
const replace=(html,values)=>html.replace(/\{([^{}]+)\}/g,(token,key)=>Object.hasOwn(values,key)?esc(values[key]):token);
function show(order,record,type,batch=1){
  const delivery=type==='delivery',root=document.createElement('div');
  root.className='tokosi-invoice';root.innerHTML=window.PickingInvoiceTemplate;
  // The supplied template has global selectors; the popup stylesheet scopes them instead.
  root.querySelectorAll('style').forEach(el=>el.remove());
  const row=[...root.querySelectorAll('tr')].find(el=>el.textContent.includes('{STT}'));
  const table=row.closest('table');table.classList.add('invoice-goods');
  let total=0,totalKnown=true,index=0;
  const locations=window.PickingData.get().locations;
  order.lines.forEach((line,i)=>{
    const jobs=record.jobs.filter(j=>j.line===i&&(delivery||j.batch===batch));
    const qty=type==='extra'?jobs.reduce((sum,j)=>sum+j.planned,0):line.quantity;
    if(!(qty>0))return;
    const unit=typeof line.price==='number'&&Number.isFinite(line.price)?line.price-(line.discount??0):null;
    const amount=unit===null?null:unit*qty;
    if(amount===null)totalKnown=false;else total+=amount;
    const assigned=jobs.map(j=>{
      const location=locations.find(l=>l.id===j.id);
      return location?.location||'—';
    });
    const actual=delivery?record.delivery.qty[i]:null;
    // Multiple locations stay identifiable when the accountant reports each location.
    const actualText=actual===null?'':jobs.length>1?jobs.map(j=>(locations.find(l=>l.id===j.id)?.location||'—')+': '+j.taken).join(' / '):String(actual);
    const rendered=document.createElement('tbody');
    rendered.innerHTML=replace(row.outerHTML,{
      STT:++index,Ten_Hang_Hoa_Don_Gian:line.productName+' ('+line.productCode+')',
      So_Luong:qty.toLocaleString('vi-VN'),Don_Gia_Sau_Chiet_Khau:money(unit),Thanh_Tien:money(amount),
      Vi_Tri:[...new Set(assigned)].join(' / '),Vi_Tri_Hang_Hoa:[...new Set(assigned)].join(' / '),Ghi_Chu_Hang_Hoa:line.note||'',Thuc_Te_Nhat:actualText
    });
    const item=rendered.firstElementChild;
    row.before(item);
  });
  row.remove();
  const discount=order.invoiceDiscount,prior=order.priorDebt;
  const payable=totalKnown&&typeof discount==='number'&&Number.isFinite(discount)?total-discount:null;
  const now=new Date();
  const notes=[order.note,delivery?record.delivery.action:''].filter(Boolean).join(' · ');
  root.innerHTML=replace(root.innerHTML,{
    // Bản in ghi cả ID Telegram cạnh tên sale, đúng dạng KiotViet lưu: "<tên> - <ID>".
    Nhan_Vien_Ban_Hang:order.saleName+(order.saleTelegramId?' - '+order.saleTelegramId:''),Dien_Thoai_Nguoi_Ban:order.sellerPhone,
    Ten_Chi_Nhanh:order.branch==='SG'?' TP.HCM':'',
    Dia_Chi_Chi_Nhanh:order.branchAddress||(order.branch==='SG'?'Lô 13 KCN Tân Bình, Tân Phú, HCM':'Cụm CN Cầu Nổi, Hoài Đức, HN'),
    Ma_Don_Hang:order.orderCode,Khach_Hang:order.customerName,So_Dien_Thoai:order.customerPhone,Dia_Chi_Khach_Hang:order.customerAddress,
    Tong_Tien_Hang:money(totalKnown?total:null),Chiet_Khau_Hoa_Don:money(discount),Tong_Cong:money(payable),Du_No_Truoc:money(prior),
    Du_No_Hoa_Don:money(payable!==null&&typeof prior==='number'&&Number.isFinite(prior)?payable+prior:null),
    Du_No_Tam_Tinh:money(payable!==null&&typeof prior==='number'&&Number.isFinite(prior)?payable+prior:null),
    Ghi_Chu:notes,Ngay:now.getDate(),Thang:now.getMonth()+1,Nam:now.getFullYear()
  });
  const title=type==='extra'?'PHIẾU NHẶT BỔ SUNG':'PHIẾU ĐẶT HÀNG';
  const heading=[...root.querySelectorAll('strong')].find(el=>/HÓA ĐƠN\s*BÁN\s*HÀNG/.test(el.textContent.replace(/\u00a0/g,' ')));
  if(heading)heading.textContent=title;
  const marker=document.createElement('p');marker.className='invoice-demo';
  marker.textContent='MÔ PHỎNG · '+order.orderCode+' · '+order.branch+' · '+(delivery?'Đã ghi thực tế nhặt':'Chưa ghi thực tế nhặt')+' · Giá minh họa; trường chưa có dữ liệu hiển thị —.';
  root.prepend(marker);
  root.setAttribute('contenteditable','true');
  root.setAttribute('aria-label','Nội dung phiếu có thể chỉnh sửa trước khi in');
  root.setAttribute('spellcheck','false');
  const printMessage=document.getElementById('pickingPrintMessage');if(printMessage)printMessage.textContent='';
  document.getElementById('pickingPrintTitle').textContent=title+' · '+order.orderCode;
  document.getElementById('pickingPrintSheet').replaceChildren(root);
  document.getElementById('pickingPrintDialog').showModal();
}
window.PickingInvoice={show};
})();
