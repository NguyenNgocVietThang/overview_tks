'use strict';
const fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
function prepare(){
  const dir=path.join(__dirname,'public/prototypes/order-picking');
  const dom=new JSDOM(fs.readFileSync(path.join(dir,'order-template-source.html'),'utf8')),d=dom.window.document;
  d.querySelectorAll('style').forEach(el=>el.remove());
  // Shared dashboard controls otherwise resize the printable goods table after mounting.
  d.querySelectorAll('table').forEach(table=>{table.dataset.tableControls='off';table.dataset.tableSort='off';});
  // Retain the supplied content and alignment; use one A4 typography scale.
  d.querySelectorAll('[style]').forEach(el=>{el.style.removeProperty('font-size');el.style.removeProperty('font-family');});
  const boxes=d.querySelectorAll('.printBox'),top=boxes[0].firstElementChild;
  top.classList.add('invoice-top');top.removeAttribute('style');
  const header=top.querySelector('table');header.classList.add('invoice-header');
  const brand=[...header.querySelectorAll('strong')].find(el=>el.textContent.includes('KHO SỈ'));
  brand.classList.add('invoice-brand');
  const title=[...header.querySelectorAll('strong')].find(el=>el.textContent.includes('PHIẾU ĐẶT HÀNG'));
  title.classList.add('invoice-title');
  const qr=header.querySelector('table');qr.classList.add('invoice-qr');qr.style.removeProperty('height');
  qr.querySelectorAll('img').forEach(el=>el.removeAttribute('style'));
  top.querySelectorAll('table')[2].classList.add('invoice-customer');
  const row=[...d.querySelectorAll('tr')].find(el=>el.textContent.includes('{STT}')),goods=row.closest('table');
  goods.classList.add('invoice-goods');
  const head=d.createElement('thead');head.append(goods.rows[0]);goods.prepend(head);
  for(const tr of goods.rows)tr.cells[0].remove();
  goods.querySelectorAll('td').forEach(el=>el.style.removeProperty('width'));
  const cols=d.createElement('colgroup');
  [4,27,7,6,10,12,10,11,13].forEach(width=>{const col=d.createElement('col');col.style.width=width+'%';cols.append(col);});goods.prepend(cols);
  row.cells[5].className='invoice-location';
  row.cells[7].className='invoice-actual';row.cells[7].textContent='{Thuc_Te_Nhat}';
  // Cột ST ngay bên phải cột SL: số thùng của dòng, lấy từ record chỉ định (trống khi chưa chỉ định đủ SL).
  for(const tr of goods.rows){const st=tr.cells[2].cloneNode(true);st.removeAttribute('class');st.className='invoice-st';st.textContent=tr===row?'{ST}':'ST';tr.cells[2].after(st);}
  boxes[1].classList.add('invoice-footer');
  const summary=boxes[1].querySelector('table');summary.classList.add('invoice-summary');
  summary.querySelectorAll('td').forEach(el=>el.style.removeProperty('width'));
  const summaryCols=d.createElement('colgroup');
  [47,20,5,28].forEach(width=>{const col=d.createElement('col');col.style.width=width+'%';summaryCols.append(col);});summary.prepend(summaryCols);
  if(!summary.rows[0].textContent.trim())summary.rows[0].remove();
  boxes[1].querySelectorAll('table')[1].classList.add('invoice-signatures');
  for(const p of [...d.body.children].filter(el=>el.tagName==='P')){
    if(!p.textContent.trim()||/^_+$/.test(p.textContent.trim()))p.remove();
    else p.classList.add('invoice-notice');
  }
  fs.writeFileSync(path.join(dir,'order-template.html'),d.body.innerHTML);
  dom.window.close();
}
if(require.main===module)prepare();
module.exports={prepare};
