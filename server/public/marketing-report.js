/* Read-only Marketing reports. Section requests and detail snapshots are independent. */
(function () {
  'use strict';
  const definitions = {
    monthly: { title: 'BC tháng', monthKey: 'monthly', filters: ['page', 'employee', 'status', 'dataSource'], columns: [['sale','Sale'],['customer','Khách Kiot'],['phone','SĐT'],['page','Page'],['status','Tình trạng'],['dataSource','Nguồn data'],['closedAt','Ngày chốt'],['revenue','Doanh số','money'],['newCustomer','Khách mới'],['note','Ghi chú']] },
    'receipt-check': { title: 'Check tỷ lệ nhận số', monthKey: 'check', filters: ['page', 'employee'], columns: [['name','Nhân viên'],['page','Page'],['first','Lần đầu','number'],['repeat','Chào lại','number'],['equivalent','Quy đổi','number'],['closed','Khách chốt','number'],['rate','Tỷ lệ chốt','percent']] },
    phones: { title: 'Sao lưu SĐT', filters: ['page', 'employee'], columns: [['phone','SĐT'],['page','Page'],['firstEmployee','Nhân viên lần đầu'],['currentEmployee','Nhân viên hiện tại'],['repeatEmployee','Nhân viên chào lại'],['firstAt','Ngày lần đầu'],['currentAt','Ngày hiện tại'],['repeatAt','Ngày chào lại']] },
    costs: { title: 'Báo cáo chi phí', monthKey: 'costs', filters: ['page'], columns: [['page','Page'],['date','Ngày'],['adCost','Chi phí ADS','money'],['totalCost','Chi phí gồm phí thuê/VAT','money'],['totalLabel','Nhãn chi phí nguồn'],['messages','Mess','number'],['costPerMessage','Chi phí/mess','money'],['phones','SĐT','number'],['costPerPhone','Chi phí/SĐT','money']] }
  };
  const filterLabels = { page:'Page', employee:'Nhân viên', status:'Tình trạng', dataSource:'Nguồn data' };
  const filterKeys = { page:'pages', employee:'employees', status:'statuses', dataSource:'dataSources' };
  const summaryColumns = [['label','Đối tượng'],['page','Page'],['employee','Nhân viên'],['count','Số dòng','number'],['revenue','Doanh số','money'],['first','Lần đầu','number'],['repeat','Chào lại','number'],['equivalent','Quy đổi','number'],['closed','Khách chốt','number'],['rate','Tỷ lệ chốt','percent'],['totalCost','Tổng chi phí','money'],['messages','Mess','number'],['phones','SĐT','number']];
  const sections = {};
  const chartInstances = new Map();
  let initialized = false, metadata = null, metadataRequest = null, detailSeq = 0, detailContext = null, opener = null;
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const normalize = value => String(value == null ? '' : value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase();
  function format(value, type) {
    if (value === null || value === undefined || value === '' || (typeof value === 'string' && value.startsWith('#'))) return '—';
    if (!type || !Number.isFinite(Number(value))) return String(value);
    return new Intl.NumberFormat('vi-VN', { maximumFractionDigits:type === 'money' ? 0 : 2 }).format(Number(value) * (type === 'percent' ? 100 : 1)) + (type === 'percent' ? '%' : type === 'money' ? ' ₫' : '');
  }
  function time(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('vi-VN', {timeZone:'Asia/Saigon'}); }
  function kpis(items) {
    const cards = items || [], span = cards.length <= 2 ? 'col-6' : cards.length === 3 ? 'col-4' : 'col-3';
    return cards.map((k, i) => '<div class="kpi-card '+span+' accent-' + (i % 2 ? 'blue' : 'amber') + '"><div class="eyebrow">' + escape(k.label) + '</div><div class="value">' + escape(format(k.value,k.format || k.type)) + '</div></div>').join('');
  }
  async function request(path, params) {
    const response = await fetch('/api/marketing-report/' + path + '?' + params.toString(), { credentials:'same-origin' });
    if (response.status === 401) { window.location.href = '/login/?next=' + encodeURIComponent(location.pathname + location.hash); throw new Error('Phiên đăng nhập đã hết hạn.'); }
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || payload.message || 'Không đọc được nguồn báo cáo.');
    return payload;
  }
  function active() { return document.getElementById('view-marketing')?.classList.contains('active') && !document.hidden && window.TKSNav?.can('reports.marketing'); }
  function initialize() {
    if (initialized) return;
    initialized = true;
    const root = document.getElementById('marketingSections');
    root.innerHTML = Object.entries(definitions).map(([kind, def], i) => '<section class="section marketing-section" id="marketing-' + kind + '"><div class="section-head"><span class="section-step">' + (i+1) + '</span><h2>' + def.title + '</h2></div><div class="marketing-filters" id="marketing-' + kind + '-filters"></div><div class="marketing-status" id="marketing-' + kind + '-status" role="status" aria-live="polite">Chưa tải dữ liệu.</div><div class="marketing-warnings" id="marketing-' + kind + '-warnings" role="status"></div><div class="kpi-grid section-kpis" id="marketing-' + kind + '-kpis"></div><div class="grid" id="marketing-' + kind + '-charts"></div><div id="marketing-' + kind + '-summary"></div><div id="marketing-' + kind + '-rows"></div></section>').join('');
    Object.keys(definitions).forEach(kind => { sections[kind] = { seq:0, filters:{}, data:null, loadedAt:0 }; });
    document.getElementById('marketingRefresh').addEventListener('click', () => load(true));
    const dialog = document.getElementById('marketingDetailDialog');
    document.getElementById('marketingDetailClose').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => { const box = dialog.getBoundingClientRect(); if (event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) dialog.close(); });
    dialog.addEventListener('close', () => {
      ++detailSeq; detailContext = null;
      if (opener?.isConnected) opener.focus();
      else if (opener?.dataset.detailKey) {
        const replacement = Array.from(document.querySelectorAll('#view-marketing [data-detail-key]')).find(row => row.dataset.detailKey === opener.dataset.detailKey);
        (replacement || document.getElementById('marketingRefresh')).focus();
      }
    });
    document.getElementById('marketingDetailRefresh').addEventListener('click', () => { if (detailContext) openDetail(detailContext.kind, detailContext.key, opener, true); });
    document.addEventListener('visibilitychange', () => { if (active()) load(false); });
    new MutationObserver(() => { if (active()) redrawCharts(); else if (dialog.open) dialog.close(); }).observe(document.getElementById('view-marketing'), { attributes:true, attributeFilter:['class'] });
    new MutationObserver(redrawCharts).observe(document.documentElement, { attributes:true, attributeFilter:['data-theme'] });
    setInterval(() => { if (active()) load(true); }, 300000);
    document.querySelectorAll('.marketing-toc a').forEach(link => link.addEventListener('click', event => { event.preventDefault(); document.getElementById(link.dataset.target).scrollIntoView({ behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }));
  }
  function renderFilters(kind) {
    const section = sections[kind], def = definitions[kind], host = document.getElementById('marketing-' + kind + '-filters');
    const monthValues = metadata?.months?.[def.monthKey] || [];
    let html = def.monthKey ? '<label for="marketing-' + kind + '-month">Tháng<select id="marketing-' + kind + '-month" data-filter="month">' + [...new Set([Number(section.filters.month), ...monthValues.map(Number)])].filter(Boolean).sort((a,b) => a-b).map(month => '<option value="'+month+'"'+(Number(section.filters.month)===month?' selected':'')+'>Tháng '+month+(monthValues.map(Number).includes(month)?'':' · Chưa có dữ liệu')+'</option>').join('') + '</select></label>' : '';
    html += def.filters.map(name => '<label for="marketing-' + kind + '-filter-' + name + '">' + filterLabels[name] + '<select id="marketing-' + kind + '-filter-' + name + '" data-filter="' + name + '"><option value="">Tất cả</option>' + [...new Set([...(section.data?.filters?.[filterKeys[name]] || []), section.filters[name]])].filter(Boolean).map(value => '<option value="'+escape(value)+'"'+(section.filters[name]===value?' selected':'')+'>'+escape(value)+'</option>').join('')+'</select></label>').join('');
    host.innerHTML = html;
    host.querySelectorAll('select').forEach(select => select.addEventListener('change', () => { section.filters[select.dataset.filter] = select.value; loadSection(kind, true); }));
  }
  async function load(force) {
    if (!window.TKSNav?.can('reports.marketing')) return;
    initialize();
    if (!metadata) {
      if (!metadataRequest) metadataRequest = request('metadata',new URLSearchParams()).finally(() => { metadataRequest = null; });
      try { metadata = await metadataRequest; }
      catch(error) { document.getElementById('marketingSourceStatus').textContent = error.message; return; }
      Object.entries(definitions).forEach(([kind,def]) => { if (def.monthKey) sections[kind].filters.month = metadata.currentMonth || Number(new Intl.DateTimeFormat('en',{month:'numeric',timeZone:'Asia/Saigon'}).format(new Date())); renderFilters(kind); });
      document.getElementById('marketingSourceStatus').textContent = 'Chỉ đọc Google Sheets · tự cập nhật mỗi 5 phút';
    }
    await Promise.allSettled(Object.keys(definitions).map(kind => loadSection(kind,force)));
  }
  async function loadSection(kind, force) {
    const section = sections[kind];
    if (!force && (section.pending || Date.now()-section.loadedAt < 300000)) return;
    const seq = ++section.seq, params = new URLSearchParams(section.filters);
    if (force) params.set('refresh','1');
    const status = document.getElementById('marketing-' + kind + '-status');
    section.pending = true;
    status.textContent = section.data ? 'Đang làm mới · Dữ liệu đọc lúc ' + time(section.data.computedAt) : 'Đang đọc Google Sheets…';
    document.getElementById('marketing-' + kind).setAttribute('aria-busy','true');
    try {
      const data = await request(kind,params);
      if (seq !== section.seq) return;
      section.data = data; section.loadedAt = Date.now();
      renderSection(kind);
    } catch(error) { if (seq === section.seq) status.textContent = error.message + (section.data ? ' · Giữ dữ liệu đọc lúc ' + time(section.data.computedAt) : ' · Bấm Làm mới để thử lại.'); }
    finally { if (seq === section.seq) { section.pending = false; document.getElementById('marketing-' + kind).setAttribute('aria-busy','false'); } }
  }
  function renderSection(kind) {
    const data = sections[kind].data;
    renderFilters(kind);
    document.getElementById('marketing-' + kind + '-status').textContent = 'Đọc nguồn lúc ' + time(data.computedAt) + ' · Bấm dòng tổng quan để xem chi tiết';
    document.getElementById('marketing-' + kind + '-warnings').textContent = (data.warnings || []).join(' · ');
    document.getElementById('marketing-' + kind + '-kpis').innerHTML = kpis(data.kpis);
    renderCharts(kind);
    const summary = data.summaryRows || [];
    const columns = summaryColumns.filter(([key]) => key === 'label' || summary.some(row => row[key] !== undefined));
    mountTable(document.getElementById('marketing-' + kind + '-summary'), 'marketing-' + kind + '-summary-table', 'Tổng quan', summary, columns, row => openDetail(kind,row.key,document.activeElement));
    mountTable(document.getElementById('marketing-' + kind + '-rows'), 'marketing-' + kind + '-data-table', 'Dữ liệu chi tiết', data.rows || [], definitions[kind].columns, kind === 'phones' || kind === 'receipt-check' ? row => openDetail(kind,row.key,document.activeElement) : null);
  }
  function renderCharts(kind) {
    const host = document.getElementById('marketing-' + kind + '-charts');
    const charts = sections[kind].data?.charts || [];
    chartInstances.get(kind)?.forEach(chart => chart.destroy());
    host.innerHTML = charts.map((chart,i) => '<div class="panel '+(charts.length === 1 || (chart.labels || []).length > 20 ? 'col-12' : 'col-6')+'"><div class="panel-head"><h3>'+escape(chart.title)+'</h3></div><div class="marketing-chart-box"><canvas id="marketing-'+kind+'-chart-'+i+'" role="img" aria-label="'+escape(chart.title)+'"></canvas></div></div>').join('');
    const style = getComputedStyle(document.documentElement), instances = [];
    charts.forEach((chart,i) => {
      if (typeof Chart === 'undefined') return;
      const color = style.getPropertyValue('--primary').trim() || style.getPropertyValue('--blue').trim();
      instances.push(new Chart(document.getElementById('marketing-'+kind+'-chart-'+i), {
        type:'bar',
        data:{labels:chart.labels || [],datasets:[{label:chart.title,data:(chart.values || []).map(value => value == null || !Number.isFinite(Number(value)) ? null : Number(value)),backgroundColor:color,borderRadius:4}]},
        options:{responsive:true,maintainAspectRatio:false,animation:matchMedia('(prefers-reduced-motion: reduce)').matches ? false : {duration:200},plugins:{legend:{display:false}},
          scales:{x:{ticks:{color:style.getPropertyValue('--muted').trim()},grid:{display:false}},y:{beginAtZero:true,ticks:{color:style.getPropertyValue('--muted').trim()},grid:{color:style.getPropertyValue('--border').trim()}}}
        }
      }));
    });
    chartInstances.set(kind,instances);
  }
  function redrawCharts() { if (initialized && active()) Object.keys(sections).forEach(kind => { if (sections[kind].data) renderCharts(kind); }); }
  function mountTable(host, id, title, rows, columns, onOpen) {
    const saved = host._marketingState || { search:'', sort:null, direction:1, page:1, hidden:[] };
    host._marketingState = saved;
    host.innerHTML = '<div class="marketing-table"><h3>'+escape(title)+'</h3><div class="marketing-table-tools"><input id="'+id+'-search" type="search" aria-label="Tìm trong '+escape(title)+'" placeholder="Tìm kiếm không dấu…" value="'+escape(saved.search)+'"><details class="marketing-columns"><summary id="'+id+'-columns">Hiện/ẩn cột</summary><div class="marketing-columns-list">'+columns.map(([key,label]) => '<label><input id="'+id+'-column-'+key+'" type="checkbox" data-column="'+key+'"'+(saved.hidden.includes(key)?'':' checked')+'>'+escape(label)+'</label>').join('')+'</div></details></div><div class="marketing-table-scroll"><table aria-label="'+escape(title)+'"><thead></thead><tbody></tbody></table></div><div class="marketing-pages"><span></span><button class="marketing-btn" id="'+id+'-prev" aria-label="Trang trước">Trước</button><button class="marketing-btn" id="'+id+'-next" aria-label="Trang sau">Sau</button></div></div>';
    function draw() {
      const visible = columns.filter(([key]) => !saved.hidden.includes(key));
      let found = rows.filter(row => normalize(Object.values(row).join(' ')).includes(normalize(saved.search)));
      if (saved.sort) found = found.slice().sort((a,b) => { const av=a[saved.sort], bv=b[saved.sort]; if(av==null) return 1; if(bv==null) return -1; return saved.direction * (typeof av === 'number' && typeof bv === 'number' ? av-bv : String(av).localeCompare(String(bv),'vi',{numeric:true})); });
      const pages = Math.max(1,Math.ceil(found.length/100)); saved.page = Math.min(saved.page,pages);
      host.querySelector('thead').innerHTML = '<tr>'+visible.map(([key,label]) => '<th aria-sort="'+(saved.sort===key?(saved.direction===1?'ascending':'descending'):'none')+'"><button id="'+id+'-sort-'+key+'" data-sort="'+key+'">'+escape(label)+(saved.sort===key?(saved.direction===1?' ↑':' ↓'):'')+'</button></th>').join('')+'</tr>';
      const slice = found.slice((saved.page-1)*100,saved.page*100);
      host.querySelector('tbody').innerHTML = slice.length ? slice.map((row,i) => '<tr'+(onOpen&&row.key?' tabindex="0" data-detail-key="'+escape(row.key)+'" data-index="'+i+'" title="Bấm hoặc nhấn Enter để xem chi tiết"':'')+'>'+visible.map(([key,,type]) => '<td'+(type?' class="marketing-numeric"':'')+'>'+escape(format(row[key],type))+'</td>').join('')+'</tr>').join('') : '<tr><td colspan="'+Math.max(1,visible.length)+'" class="table-note">Chưa có dữ liệu phù hợp.</td></tr>';
      host.querySelector('.marketing-pages span').textContent = found.length + ' dòng · Trang '+saved.page+'/'+pages;
      host.querySelector('#'+id+'-prev').disabled=saved.page<=1; host.querySelector('#'+id+'-next').disabled=saved.page>=pages;
      host.querySelectorAll('[data-sort]').forEach(button => button.addEventListener('click', () => { saved.direction=saved.sort===button.dataset.sort?-saved.direction:1; saved.sort=button.dataset.sort; saved.page=1; draw(); }));
      host.querySelectorAll('[data-index]').forEach(element => { const open = () => { element.focus(); onOpen(slice[Number(element.dataset.index)]); }; element.addEventListener('click',open); element.addEventListener('keydown',event => { if(event.key==='Enter'||event.key===' ') { event.preventDefault(); open(); } }); });
    }
    host.querySelector('input[type="search"]').addEventListener('input',event => { saved.search=event.target.value; saved.page=1; draw(); });
    host.querySelectorAll('[data-column]').forEach(input => input.addEventListener('change', () => { if (!input.checked && columns.length-saved.hidden.length<=1) {input.checked=true; return;} saved.hidden=saved.hidden.filter(key=>key!==input.dataset.column); if(!input.checked) saved.hidden.push(input.dataset.column); draw(); }));
    host.querySelector('#'+id+'-prev').addEventListener('click', () => { --saved.page; draw(); });
    host.querySelector('#'+id+'-next').addEventListener('click', () => { ++saved.page; draw(); }); draw();
  }
  async function openDetail(kind,key,source,refresh,nested) {
    const section=sections[kind], dialog=document.getElementById('marketingDetailDialog'), seq=++detailSeq;
    if(!refresh) {
      detailContext={kind,key,filters:nested?{...detailContext.filters}:{...section.filters},snapshotId:nested?detailContext.snapshotId:section.data.snapshotId};
      if(!nested) opener=source;
    }
    const context=detailContext;
    const params=new URLSearchParams({...context.filters,kind,key});
    if(!refresh && context.snapshotId) params.set('snapshotId',context.snapshotId);
    if(refresh) params.set('refresh','1');
    document.getElementById('marketingDetailTitle').textContent=definitions[kind].title+' · Chi tiết';
    document.getElementById('marketingDetailSubtitle').textContent='Phạm vi theo bộ lọc khi mở · '+(context.filters.month?'Tháng '+context.filters.month:'Toàn bộ');
    const body=document.getElementById('marketingDetailBody');
    if(!refresh) body.innerHTML='<p role="status">Đang đọc chi tiết…</p>';
    document.getElementById('marketingDetailStatus').textContent=refresh?'Đang cập nhật chi tiết…':'';
    if(!dialog.open) dialog.showModal();
    try {
      const data=await request('detail',params);
      if(seq!==detailSeq||!dialog.open) return;
      context.snapshotId=data.snapshotId;
      document.getElementById('marketingDetailTitle').textContent=data.title || definitions[kind].title;
      document.getElementById('marketingDetailSubtitle').textContent=(data.subtitle || '')+' · Đọc nguồn lúc '+time(data.computedAt);
      document.getElementById('marketingDetailStatus').textContent='';
      body.innerHTML='<div class="marketing-warnings" role="status">'+escape((data.warnings||[]).join(' · '))+'</div>'+(data.formula?'<p class="marketing-status">Công thức quy đổi nguồn: '+escape(data.formula)+'</p>':'')+'<div class="kpi-grid">'+kpis(data.kpis)+'</div>'+ (data.groups||[]).map((group,i)=>'<div id="marketing-detail-group-'+i+'"></div>').join('');
      (data.groups||[]).forEach((group,i) => {
        const groupKind=definitions[group.kind]?group.kind:kind;
        const navigatePhone=kind==='phones' && groupKind==='phones' && (group.rows || []).some(row=>row.key!==key) ? row=>openDetail('phones',row.key,null,false,true) : null;
        mountTable(document.getElementById('marketing-detail-group-'+i),'marketing-detail-'+i,group.title,group.rows||[],definitions[groupKind].columns,navigatePhone);
      });
    } catch(error) { if(seq===detailSeq&&dialog.open) document.getElementById('marketingDetailStatus').textContent=error.message+(refresh?' · Giữ chi tiết trước lần cập nhật.':''); }
  }
  window.TKSMarketing={load};
})();
