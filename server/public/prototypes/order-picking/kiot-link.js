(function(){
'use strict';
const hosts={HN:'chhanoi.kiotviet.vn',SG:'chsaigon.kiotviet.vn'};
function urlFor(order){
  const host=hosts[order?.branch],code=String(order?.orderCode||'').trim();
  return host&&code?'https://'+host+'/man/#/Orders?code='+encodeURIComponent(code):null;
}
function attach(){
  const body=document.getElementById('lcDetailBody');if(!body)return;
  const selected=typeof detailOrder!=='undefined'?detailOrder:null;
  const order=selected?window.PickingData.get().orders.find(o=>o.orderCode===selected.orderCode&&o.branch===selected.branch):null;
  const row=[...body.querySelectorAll('.lc-detail-row')].find(el=>el.querySelector('.lc-detail-label')?.textContent.trim()==='Trạng thái KiotViet');
  const holder=row?.querySelector('.lc-detail-value'),url=urlFor(order);
  if(!holder||!url){document.getElementById('openKiotOrder')?.remove();document.getElementById('kiotOrderDemoHint')?.remove();return;}
  let link=document.getElementById('openKiotOrder');
  if(!link){link=document.createElement('a');link.id='openKiotOrder';link.className='kiot-order-link';link.textContent='Mở đơn trên Kiot ↗';link.target='_blank';link.rel='noopener noreferrer';holder.append(link);}
  if(link.getAttribute('href')!==url)link.setAttribute('href',url);
  link.title='Mở Kiot '+(order.branch==='HN'?'Hà Nội':'Sài Gòn')+' và lọc theo mã '+order.orderCode+'. Kế toán kiểm tra rồi bấm Kết thúc trên Kiot.';
  if(/^DH-DEMO-/i.test(order.orderCode)){
    if(!document.getElementById('kiotOrderDemoHint')){const hint=document.createElement('small');hint.id='kiotOrderDemoHint';hint.className='kiot-order-demo';hint.textContent='Mã mô phỏng — không phải đơn thật trên Kiot';holder.append(hint);}
  }else document.getElementById('kiotOrderDemoHint')?.remove();
}
const body=document.getElementById('lcDetailBody');if(body)new MutationObserver(attach).observe(body,{childList:true,subtree:true});
window.PickingKiotLink={urlFor,attach};attach();
})();
