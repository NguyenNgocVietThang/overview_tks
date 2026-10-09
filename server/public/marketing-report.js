/* Báo cáo Marketing. Chỉ BC tháng cho sửa Khách mới/Ghi chú (ghi ngược Sheets, cần reports.marketing.edit). */
(function () {
  'use strict';
  const definitions = {
    monthly: { title: 'BC tháng', note: 'doanh số và khách chốt theo tháng đã chọn', monthKey: 'monthly', filters: ['page', 'employee', 'status', 'dataSource'], columns: [['sale','Sale'],['customer','Khách Kiot'],['phone','SĐT'],['page','Page'],['status','Tình trạng'],['dataSource','Nguồn data'],['closedAt','Ngày chốt'],['revenue','Doanh số','money'],['newCustomer','Khách mới'],['note','Ghi chú']] },
    'receipt-check': { title: 'Check tỷ lệ nhận số', note: 'số nhận, chào lại và tỷ lệ chốt theo nhân viên', monthKey: 'check', filters: ['page', 'employee'], columns: [['name','Nhân viên'],['page','Page'],['first','Lần đầu','number'],['repeat','Chào lại','number'],['equivalent','Quy đổi','number'],['closed','Khách chốt','number'],['rate','Tỷ lệ chốt','percent']] },
    phones: { title: 'Sao lưu SĐT', note: 'số điện thoại đã nhận theo page và nhân viên', filters: ['page', 'employee'], columns: [['phone','SĐT'],['page','Page'],['firstEmployee','Nhân viên lần đầu'],['currentEmployee','Nhân viên hiện tại'],['repeatEmployee','Nhân viên chào lại'],['firstAt','Ngày lần đầu'],['currentAt','Ngày hiện tại'],['repeatAt','Ngày chào lại']] },
    costs: { title: 'Báo cáo chi phí', note: 'chi phí quảng cáo, mess và SĐT theo ngày', monthKey: 'costs', beside: true, filters: ['page'], columns: [['page','Page'],['date','Ngày'],['adCost','Chi phí ADS','money'],['totalCost','Chi phí gồm phí thuê/VAT','money'],['totalLabel','Nhãn chi phí nguồn'],['messages','Mess','number'],['costPerMessage','Chi phí/mess','money'],['phones','SĐT','number'],['costPerPhone','Chi phí/SĐT','money']] }
  };
  const filterLabels = { page:'Page', employee:'Nhân viên', status:'Tình trạng', dataSource:'Nguồn data' };
  const filterKeys = { page:'pages', employee:'employees', status:'statuses', dataSource:'dataSources' };
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
  // Tên nhân viên đuôi MKT hiện màu vàng (cột Sale/Nhân viên của mọi bảng).
  const NAME_KEYS = new Set(['sale','employee','firstEmployee','currentEmployee','repeatEmployee']);
  const isMkt = value => /(^|\s)MKT$/i.test(String(value == null ? '' : value).trim());
  const canEdit = () => !!window.TKSNav?.can?.('reports.marketing.edit');
  const EDIT_KEYS = new Set(['newCustomer','note']);
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
    root.innerHTML = Object.entries(definitions).map(([kind, def], i) => '<section class="section marketing-section" id="marketing-' + kind + '"><div class="section-head"><span class="section-step">' + (i+1) + '</span><h2>' + def.title + ' <span class="section-note">' + def.note + '</span></h2></div><div class="debt-filter-controls marketing-filters" id="marketing-' + kind + '-filters" aria-label="Bộ lọc ' + def.title + '"></div><div class="marketing-status" id="marketing-' + kind + '-status" role="status" aria-live="polite">Chưa tải dữ liệu.</div><div class="marketing-warnings" id="marketing-' + kind + '-warnings" role="status"></div><div class="kpi-grid section-kpis" id="marketing-' + kind + '-kpis"></div>' + (def.split ? '<div class="marketing-split">' : '') + (def.beside ? '<div class="grid" id="marketing-' + kind + '-charts-wide"></div><div class="marketing-split">' : '') + '<div class="grid" id="marketing-' + kind + '-charts"></div>' + (def.split ? '</div>' : '') + '<div id="marketing-' + kind + '-rows"></div>' + (def.beside ? '</div>' : '') + '</section>').join('');
    Object.keys(definitions).forEach(kind => { sections[kind] = { seq:0, filters:{}, data:null, loadedAt:0, filtersEl:document.getElementById('marketing-' + kind + '-filters') }; });
    const dialog = document.getElementById('marketingDetailDialog');
    document.getElementById('marketingDetailClose').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => { const box = dialog.getBoundingClientRect(); if (event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) dialog.close(); });
    dialog.addEventListener('close', () => {
      ++detailSeq; detailContext = null;
      if (opener?.isConnected) opener.focus();
      else if (opener?.dataset.detailKey) {
        const replacement = Array.from(document.querySelectorAll('#view-marketing [data-detail-key]')).find(row => row.dataset.detailKey === opener.dataset.detailKey);
        (replacement || document.getElementById('view-marketing')).focus?.();
      }
    });
    document.getElementById('marketingDetailRefresh').addEventListener('click', () => { if (detailContext) openDetail(detailContext.kind, detailContext.key, opener, true); });
    document.addEventListener('visibilitychange', () => { if (active()) load(false); });
    new MutationObserver(() => { if (active()) redrawCharts(); else if (dialog.open) dialog.close(); }).observe(document.getElementById('view-marketing'), { attributes:true, attributeFilter:['class'] });
    new MutationObserver(redrawCharts).observe(document.documentElement, { attributes:true, attributeFilter:['data-theme'] });
    setInterval(() => { if (active()) load(true); }, 300000);
  }
  function renderFilters(kind) {
    const section = sections[kind], def = definitions[kind], host = section.filtersEl;
    const monthValues = metadata?.months?.[def.monthKey] || [];
    let html = def.monthKey ? '<div class="debt-filter-field"><label for="marketing-' + kind + '-month">Tháng</label><select id="marketing-' + kind + '-month" data-filter="month">' + [...new Set([Number(section.filters.month), ...monthValues.map(Number)])].filter(Boolean).sort((a,b) => a-b).map(month => '<option value="'+month+'"'+(Number(section.filters.month)===month?' selected':'')+'>Tháng '+month+(monthValues.map(Number).includes(month)?'':' · Chưa có dữ liệu')+'</option>').join('') + '</select></div>' : '';
    html += def.filters.map(name => '<div class="debt-filter-field"><label for="marketing-' + kind + '-filter-' + name + '">' + filterLabels[name] + '</label><select id="marketing-' + kind + '-filter-' + name + '" data-filter="' + name + '"><option value="">Tất cả</option>' + [...new Set([...(section.data?.filters?.[filterKeys[name]] || []), section.filters[name]])].filter(Boolean).map(value => '<option value="'+escape(value)+'"'+(section.filters[name]===value?' selected':'')+'>'+escape(value)+'</option>').join('')+'</select></div>').join('');
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
      Object.entries(definitions).forEach(([kind,def]) => { if (def.monthKey) sections[kind].filters.month = metadata.currentMonth || Number(new Intl.DateTimeFormat('en',{month:'numeric',timeZone:'Asia/Saigon'}).format(new Date())); });
      document.getElementById('marketingSourceStatus').textContent = (canEdit() ? 'Đọc và ghi Khách mới/Ghi chú vào Google Sheets' : 'Chỉ đọc Google Sheets') + ' · tự cập nhật mỗi 5 phút';
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
    document.getElementById('marketing-' + kind + '-status').textContent = 'Đọc nguồn lúc ' + time(data.computedAt) + '';
    document.getElementById('marketing-' + kind + '-warnings').textContent = (data.warnings || []).join(' · ');
    document.getElementById('marketing-' + kind + '-kpis').innerHTML = kpis(data.kpis);
    renderCharts(kind);
    mountTable(document.getElementById('marketing-' + kind + '-rows'), 'marketing-' + kind + '-data-table', definitions[kind].title, data.rows || [], definitions[kind].columns, kind === 'phones' || kind === 'receipt-check' ? row => openDetail(kind,row.key,document.activeElement) : null, { kind, table:'rows' });
    // Thanh lọc nằm cạnh tên bảng (mountTable dựng lại bảng nên phải gắn lại sau mỗi lần vẽ).
    document.querySelector('#marketing-' + kind + '-rows .panel-head')?.insertBefore(sections[kind].filtersEl, document.querySelector('#marketing-' + kind + '-rows .panel-head-actions'));
  }
  // Biểu đồ theo ngày của mục có `beside` luôn là cột dọc, xếp riêng cả hàng phía trên.
  const wide = (chart, kind) => !!definitions[kind]?.beside && /ngày/i.test(chart.title || '');
  const horizontal = (chart, kind) => !wide(chart, kind) && (!!definitions[kind]?.horizontal || (chart.labels || []).length > 8);
  // Vệt sáng theo cột đang hover (dọc hoặc ngang tùy hướng biểu đồ), vẽ dưới các cột.
  const hoverBand = {
    id: 'hoverBand',
    beforeDatasetsDraw(chart) {
      const active = chart.getActiveElements();
      if (!active.length) return;
      const { ctx, chartArea } = chart, bar = active[0].element, hz = chart.options.indexAxis === 'y';
      const size = hz ? bar.height : bar.width, pad = 6;
      ctx.save(); ctx.fillStyle = 'rgba(148,163,184,0.14)';
      if (hz) ctx.fillRect(chartArea.left, bar.y - size / 2 - pad, chartArea.right - chartArea.left, size + pad * 2);
      else ctx.fillRect(bar.x - size / 2 - pad, chartArea.top, size + pad * 2, chartArea.bottom - chartArea.top);
      ctx.restore();
    }
  };
  function renderCharts(kind) {
    const host = document.getElementById('marketing-' + kind + '-charts'), wideHost = document.getElementById('marketing-' + kind + '-charts-wide');
    const charts = sections[kind].data?.charts || [];
    chartInstances.get(kind)?.forEach(chart => chart.destroy());
    const panel = (chart,i) => '<div class="panel '+(wide(chart,kind) || charts.length === 1 || definitions[kind].beside ? 'col-12' : 'col-6')+'"><div class="panel-head"><h2>'+escape(chart.title)+'</h2></div><div class="chart-box marketing-chart-scroll"><div class="marketing-chart-inner" style="height:'+(horizontal(chart,kind)?Math.max(260,(chart.labels||[]).length*24):260)+'px"><canvas id="marketing-'+kind+'-chart-'+i+'" role="img" aria-label="'+escape(chart.title)+'"></canvas></div></div></div>';
    host.innerHTML = charts.map((chart,i) => wide(chart,kind) ? '' : panel(chart,i)).join('');
    if (wideHost) wideHost.innerHTML = charts.map((chart,i) => wide(chart,kind) ? panel(chart,i) : '').join('');
    const style = getComputedStyle(document.documentElement), instances = [];
    charts.forEach((chart,i) => {
      if (typeof Chart === 'undefined') return;
      const palette = ['--blue','--amber','--green','--red'], color = style.getPropertyValue(palette[i % palette.length]).trim() || style.getPropertyValue('--primary').trim();
      const hz = horizontal(chart,kind), muted = style.getPropertyValue('--muted').trim(), grid = style.getPropertyValue('--border').trim();
      instances.push(new Chart(document.getElementById('marketing-'+kind+'-chart-'+i), {
        type:'bar',
        plugins:[hoverBand],
        data:{labels:chart.labels || [],datasets:[{label:chart.title,data:(chart.values || []).map(value => value == null || !Number.isFinite(Number(value)) ? null : Number(value)),backgroundColor:color,borderRadius:4,maxBarThickness:48}]},
        options:{responsive:true,maintainAspectRatio:false,animation:matchMedia('(prefers-reduced-motion: reduce)').matches ? false : {duration:200},interaction:{mode:'index',axis:hz?'y':'x',intersect:false},plugins:{legend:{display:false},tooltip:{mode:'index',axis:hz?'y':'x',intersect:false}},
          indexAxis:hz?'y':'x',scales:{[hz?'y':'x']:{ticks:{color:muted,autoSkip:false,maxRotation:hz?0:60},grid:{display:false}},[hz?'x':'y']:{beginAtZero:true,ticks:{color:muted},grid:{color:grid}}}
        }
      }));
    });
    chartInstances.set(kind,instances);
  }
  function redrawCharts() { if (initialized && active()) Object.keys(sections).forEach(kind => { if (sections[kind].data) renderCharts(kind); }); }
  function mountTable(host, id, title, rows, columns, onOpen, exportInfo) {
    const saved = host._marketingState || { search:'', sort:null, direction:1, page:1 };
    host._marketingState = saved;
    host.innerHTML = '<div class="panel marketing-table"><div class="panel-head"><h2>'+escape(title)+'</h2><div class="panel-head-actions"><span class="drill-hint" data-count>—</span>'+(exportInfo?'<button class="export-button" type="button" id="'+id+'-export"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>Xuất file</button>':'')+'</div><div class="table-search-tools"><div class="table-search-input-wrap"><input class="table-search-input" id="'+id+'-search" type="search" autocomplete="off" aria-label="Tìm trong '+escape(title)+'" placeholder="Tìm kiếm không dấu…" value="'+escape(saved.search)+'"></div>'+'</div></div><div class="table-wrap marketing-table-scroll"><table data-table-key="'+id+'" aria-label="'+escape(title)+'"><thead></thead><tbody></tbody></table></div><div class="pagination-controls marketing-pages" hidden><button type="button" id="'+id+'-first" aria-label="Trang đầu" title="Trang đầu">&lt;&lt;</button><button type="button" id="'+id+'-prev" aria-label="Trang trước" title="Trang trước">&lt;</button><span data-page-label></span><button type="button" id="'+id+'-next" aria-label="Trang sau" title="Trang sau">&gt;</button><button type="button" id="'+id+'-last" aria-label="Trang cuối" title="Trang cuối">&gt;&gt;</button></div></div>';
    const editing = !!exportInfo && exportInfo.kind === 'monthly' && exportInfo.table === 'rows' && canEdit();
    function cellHtml(row, key, type, edit, index) {
      if (edit && EDIT_KEYS.has(key) && row.key) return '<td class="marketing-edit-cell"><textarea class="marketing-edit" rows="1" wrap="soft" maxlength="500" data-edit="'+key+'" data-edit-index="'+index+'" aria-label="'+escape(columns.find(c => c[0] === key)[1])+' của '+escape(row.customer || row.phone || 'dòng này')+'">'+escape(row[key] || '')+'</textarea></td>';
      const text = escape(format(row[key],type));
      if (NAME_KEYS.has(key) && isMkt(row[key])) return '<td><span class="mkt-name">'+text+'</span></td>';
      return '<td'+(type?' class="mono col-num"':'')+'>'+text+'</td>';
    }
    function draw() {
      const visible = columns;
      let found = rows.filter(row => normalize(Object.values(row).join(' ')).includes(normalize(saved.search)));
      if (saved.sort) found = found.slice().sort((a,b) => { const av=a[saved.sort], bv=b[saved.sort]; if(av==null) return 1; if(bv==null) return -1; return saved.direction * (typeof av === 'number' && typeof bv === 'number' ? av-bv : String(av).localeCompare(String(bv),'vi',{numeric:true})); });
      const pages = Math.max(1,Math.ceil(found.length/100)); saved.page = Math.min(saved.page,pages);
      host.querySelector('thead').innerHTML = '<tr>'+visible.map(([key,label,type]) => '<th data-column-key="'+key+'" data-column-type="'+(type || 'text')+'" class="sortable'+(type?' col-num':'')+'" aria-sort="'+(saved.sort===key?(saved.direction===1?'ascending':'descending'):'none')+'"><button type="button" class="sort-button" id="'+id+'-sort-'+key+'" data-sort="'+key+'"><span>'+escape(label)+'</span><span class="sort-indicator" aria-hidden="true">'+(saved.sort===key?(saved.direction===1?'▼':'▲'):'↕')+'</span></button></th>').join('')+'</tr>';
      const slice = found.slice((saved.page-1)*100,saved.page*100);
      host.querySelector('tbody').innerHTML = slice.length ? slice.map((row,i) => '<tr'+(onOpen&&row.key?' class="marketing-row-link" tabindex="0" data-detail-key="'+escape(row.key)+'" data-index="'+i+'" title="Bấm hoặc nhấn Enter để xem chi tiết"':'')+'>'+visible.map(([key,,type]) => cellHtml(row,key,type,editing,slice.indexOf(row))).join('')+'</tr>').join('') : '<tr><td colspan="'+Math.max(1,visible.length)+'" class="table-note">Chưa có dữ liệu phù hợp.</td></tr>';
      host.querySelector('[data-count]').textContent = found.length + ' dòng';
      host.querySelector('.marketing-pages').hidden = pages<=1;
      host.querySelector('[data-page-label]').textContent = 'Trang '+saved.page+'/'+pages;
      ['first','prev'].forEach(name => { host.querySelector('#'+id+'-'+name).disabled=saved.page<=1; });
      ['next','last'].forEach(name => { host.querySelector('#'+id+'-'+name).disabled=saved.page>=pages; });
      host.querySelectorAll('[data-sort]').forEach(button => button.addEventListener('click', () => { saved.direction=saved.sort===button.dataset.sort?-saved.direction:1; saved.sort=button.dataset.sort; saved.page=1; draw(); }));
      host.querySelectorAll('[data-edit]').forEach(input => {
        const row = slice[Number(input.dataset.editIndex)];
        growEditor(input);
        input.addEventListener('input', () => growEditor(input));
        input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); input.blur(); } if (event.key === 'Escape') { event.preventDefault(); input.value = row[input.dataset.edit] || ''; growEditor(input); input.blur(); } });
        input.addEventListener('change', () => saveCell(input, row));
      });
      if (window.TKSTables) window.TKSTables.enhance(host.querySelector('table'), { key: id, columns: columns.map(([key, label]) => ({ key, label })) });
      host.querySelectorAll('[data-index]').forEach(element => { const open = () => { element.focus(); onOpen(slice[Number(element.dataset.index)]); }; element.addEventListener('click',open); element.addEventListener('keydown',event => { if(event.key==='Enter'||event.key===' ') { event.preventDefault(); open(); } }); });
    }
    host.querySelector('input[type="search"]').addEventListener('input',event => { saved.search=event.target.value; saved.page=1; draw(); });
    if (exportInfo) host.querySelector('#'+id+'-export').addEventListener('click', () => openExport(exportInfo.kind, exportInfo.table, saved.search));
    host.querySelector('#'+id+'-first').addEventListener('click', () => { saved.page=1; draw(); });
    host.querySelector('#'+id+'-prev').addEventListener('click', () => { --saved.page; draw(); });
    host.querySelector('#'+id+'-next').addEventListener('click', () => { ++saved.page; draw(); });
    host.querySelector('#'+id+'-last').addEventListener('click', () => { saved.page=Infinity; draw(); }); draw();
  }
  function growEditor(input) { input.style.height = 'auto'; input.style.height = Math.max(30, input.scrollHeight) + 'px'; }
  // Sửa tại chỗ Khách mới / Ghi chú của BC tháng và ghi ngược Google Sheets.
  async function saveCell(input, row) {
    const field = input.dataset.edit, previous = row[field] || '', value = input.value.trim();
    const status = document.getElementById('marketing-monthly-status');
    if (value === previous) { input.value = previous; return; }
    input.disabled = true; input.classList.remove('is-error');
    try {
      const response = await fetch('/api/marketing-report/monthly/row', { method:'PUT', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ snapshotId:sections.monthly.data?.snapshotId, key:row.key, field, value }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Không ghi được vào Google Sheets.');
      row[field] = payload.value; input.value = payload.value;
      input.classList.add('is-saved'); setTimeout(() => input.classList.remove('is-saved'), 1500);
      status.textContent = 'Đã ghi vào Google Sheets lúc ' + time(Date.now());
    } catch (error) {
      input.value = previous; input.classList.add('is-error');
      status.textContent = error.message;
    } finally { input.disabled = false; growEditor(input); }
  }
  // Nguồn cho hộp thoại "Xuất file" dùng chung (startExportDialog/exportFetch ở index.html): bộ lọc chốt lúc mở.
  const EXPORT_SOURCE = {
    fields: (payload, request) => exportFetch('/api/marketing-report/export/fields?' + payload.query, null, request),
    file: (payload, request) => {
      const params = new URLSearchParams(payload.query);
      params.set('format', payload.format === 'html' ? 'html' : 'xlsx');
      const columns = payload.columns && payload.columns[payload.table];
      if (columns) params.set('columns', columns.join(','));
      return exportFetch('/api/marketing-report/export?' + params.toString(), null, request);
    }
  };
  function openExport(kind, table, search) {
    if (!window.TKSNav?.can('reports.export') || typeof startExportDialog !== 'function') return;
    const params = new URLSearchParams({ ...sections[kind].filters, kind, table });
    if (search && search.trim()) params.set('q', search.trim());
    return startExportDialog({ kind, table, query: params.toString() }, EXPORT_SOURCE);
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
      body.innerHTML='<div class="marketing-warnings" role="status">'+escape((data.warnings||[]).join(' · '))+'</div>'+(data.formula?'<p class="marketing-status">Công thức quy đổi nguồn: '+escape(data.formula)+'</p>':'')+'<div class="kpi-grid section-kpis">'+kpis(data.kpis)+'</div>'+ (data.groups||[]).map((group,i)=>'<div id="marketing-detail-group-'+i+'"></div>').join('');
      (data.groups||[]).forEach((group,i) => {
        const groupKind=definitions[group.kind]?group.kind:kind;
        const navigatePhone=kind==='phones' && groupKind==='phones' && (group.rows || []).some(row=>row.key!==key) ? row=>openDetail('phones',row.key,null,false,true) : null;
        mountTable(document.getElementById('marketing-detail-group-'+i),'marketing-detail-'+groupKind+'-'+i,group.title,group.rows||[],definitions[groupKind].columns,navigatePhone);
      });
    } catch(error) { if(seq===detailSeq&&dialog.open) document.getElementById('marketingDetailStatus').textContent=error.message+(refresh?' · Giữ chi tiết trước lần cập nhật.':''); }
  }
  window.TKSMarketing={load};
})();
