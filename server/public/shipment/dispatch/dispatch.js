// ==========================================
// DISPATCH.JS — Trang Desktop Điều phối vận chuyển (Phase 1C).
//
// Dùng chung: shared.css, shared-nav.js, image-compress.js
// Yêu cầu: INTERNAL_ROLES (authDispatch cho tạo đơn/xe)
// ==========================================
'use strict';

// ---- Hằng số ----------------------------------------------------------------

const FLOWS_LABEL = {
  1: 'Luồng 1 — HN xe công ty',
  2: 'Luồng 2 — SG xe công ty',
  3: 'Luồng 3 — HN tàu hỏa',
  4: 'Luồng 4 — SG shipper'
};

const STATUS_ORDER = [
  'Mới tạo',
  'Đã in',
  'Đã nhặt hàng',
  'Đang chuyển kho',
  'Đang giao',
  'Đã giao',
  'Hoàn thành',
  'Sự cố',
  'Đã hủy'
];

const STATUS_COLOR = {
  'Mới tạo':        { bg: 'rgba(99,102,241,.13)', border: 'rgba(99,102,241,.35)', text: '#818CF8' },
  'Đã in':          { bg: 'rgba(234,179,8,.13)',  border: 'rgba(234,179,8,.35)',  text: '#FCD34D' },
  'Đã nhặt hàng':   { bg: 'rgba(59,130,246,.13)', border: 'rgba(59,130,246,.35)', text: '#60A5FA' },
  'Đang chuyển kho':{ bg: 'rgba(249,115,22,.13)', border: 'rgba(249,115,22,.35)', text: '#FB923C' },
  'Đang giao':      { bg: 'rgba(16,185,129,.13)', border: 'rgba(16,185,129,.35)', text: '#34D399' },
  'Đã giao':        { bg: 'rgba(16,185,129,.22)', border: 'rgba(16,185,129,.5)',  text: '#6EE7B7' },
  'Hoàn thành':     { bg: 'rgba(16,185,129,.3)',  border: 'rgba(16,185,129,.6)',  text: '#A7F3D0' },
  'Sự cố':          { bg: 'rgba(239,68,68,.15)',  border: 'rgba(239,68,68,.4)',  text: '#FCA5A5' },
  'Đã hủy':         { bg: 'rgba(100,116,139,.13)',border: 'rgba(100,116,139,.3)', text: '#94A3B8' }
};

const NEXT_TRANSITIONS = {
  'Mới tạo':         ['Đã in'],
  'Đã in':           ['Đã nhặt hàng'],
  'Đã nhặt hàng':    ['Đang chuyển kho', 'Đang giao'],
  'Đang chuyển kho': ['Đang giao'],
  'Đang giao':       ['Đã giao'],
  'Đã giao':         ['Hoàn thành']
};

const EXCEPTION_ELIGIBLE = new Set(['Đã nhặt hàng', 'Đang chuyển kho', 'Đang giao', 'Đã giao']);

// ---- State ------------------------------------------------------------------

let currentUser = null;
let allOrders   = [];
let vehicles    = [];
let activeOrderId = null;
let pollTimer   = null;
const POLL_MS   = 30000;

// ---- Bootstrap --------------------------------------------------------------

async function init() {
  currentUser = await TKSNav.authGuard();

  // Chỉ Quản lý / Kế toán mới thấy panel tạo đơn + quản lý xe
  const isDispatch = ['Quản lý', 'Kế toán'].includes(currentUser.vaiTro);
  document.getElementById('panelCreate').hidden   = !isDispatch;
  document.getElementById('panelVehicles').hidden = !isDispatch;

  await Promise.all([loadVehicles(), loadOrders()]);
  renderKanban();
  startPoll();

  // Link to internal pages
  addInternalLinks();
}

function addInternalLinks() {
  const chip = document.getElementById('internalLinks');
  if (!chip) return;
  chip.innerHTML =
    '<a href="/shipment/mobile/" class="link-chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;display:inline-block;vertical-align:-2px;margin-right:4px;"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"></rect><path d="M12 18h.01"></path></svg>Mobile</a>' +
    '<a href="/shipment/" class="link-chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;display:inline-block;vertical-align:-2px;margin-right:4px;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>Tra cứu</a>';
}

function startPoll() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    await loadOrders();
    renderKanban();
    if (activeOrderId) await refreshModalOrder(activeOrderId);
  }, POLL_MS);
}

// ---- API calls --------------------------------------------------------------

async function apiFetch(url, opts) {
  const res = await fetch(url, Object.assign({ credentials: 'same-origin' }, opts));
  if (res.status === 401) { window.location.href = '/login/?next=' + encodeURIComponent(location.pathname); throw new Error('unauthorized'); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Loi CO SO hien bang thong bao rieng o dau trang thay vi toast chung chung.
    if (window.TKSNav && TKSNav.handleBranchError(body)) {
      throw Object.assign(new Error(body.error), { code: body.code, handled: true });
    }
    throw Object.assign(new Error(body.error || 'Lỗi không xác định'), { code: body.code });
  }
  return body;
}

async function loadVehicles() {
  try {
    const data = await apiFetch('/api/shipment/vehicles');
    vehicles = data.vehicles || [];
    renderVehiclesList();
    populateVehicleSelects();
  } catch (e) {
    console.error('loadVehicles:', e.message);
  }
}

async function loadOrders() {
  try {
    const params = buildFilterParams();
    const data = await apiFetch('/api/shipment/orders?' + new URLSearchParams(params));
    allOrders = data.orders || [];
  } catch (e) {
    console.error('loadOrders:', e.message);
  }
}

async function loadPendingInvoices() {
  const dateFrom = document.getElementById('filterInvFrom').value;
  const dateTo   = document.getElementById('filterInvTo').value;
  const params   = {};
  if (dateFrom) params.dateFrom = dateFrom;
  if (dateTo)   params.dateTo   = dateTo;
  return apiFetch('/api/shipment/invoices/pending?' + new URLSearchParams(params));
}

// ---- Filter -----------------------------------------------------------------

function buildFilterParams() {
  const p = {};
  const w = document.getElementById('fWarehouse').value;
  const f = document.getElementById('fFlow').value;
  const s = document.getElementById('fStatus').value;
  const d = document.getElementById('fDriver').value;
  const from = document.getElementById('fDateFrom').value;
  const to   = document.getElementById('fDateTo').value;
  if (w) p.warehouse  = w;
  if (f) p.flow       = f;
  if (s) p.status     = s;
  if (d) p.driverName = d;
  if (from) p.dateFrom = from;
  if (to)   p.dateTo   = to;
  return p;
}

document.getElementById('filterForm').addEventListener('submit', async e => {
  e.preventDefault();
  await loadOrders();
  renderKanban();
});
document.getElementById('btnRefresh').addEventListener('click', async () => {
  await loadOrders();
  renderKanban();
  showToast('Đã làm mới dữ liệu.');
});

// ---- Kanban -----------------------------------------------------------------

function renderKanban() {
  const board = document.getElementById('kanbanBoard');
  board.innerHTML = '';

  const byStatus = {};
  STATUS_ORDER.forEach(s => { byStatus[s] = []; });
  allOrders.forEach(o => {
    if (byStatus[o.current_status] !== undefined) byStatus[o.current_status].push(o);
  });

  // Ẩn cột "Đang chuyển kho" nếu không có đơn
  const showCols = STATUS_ORDER.filter(s => s !== 'Đang chuyển kho' || byStatus[s].length > 0);

  showCols.forEach(status => {
    const orders = byStatus[status] || [];
    const col = document.createElement('div');
    col.className = 'kanban-col';
    const sc = STATUS_COLOR[status] || {};

    col.innerHTML = `
      <div class="kanban-col-header" style="border-color:${sc.border || '#3b4556'}">
        <span class="kanban-col-title" style="color:${sc.text || 'var(--text)'}">${status}</span>
        <span class="kanban-col-count">${orders.length}</span>
      </div>
      <div class="kanban-cards" id="col-${status.replace(/\s/g,'_')}"></div>
    `;
    board.appendChild(col);

    const cardsEl = col.querySelector('.kanban-cards');
    orders.forEach(order => {
      cardsEl.appendChild(buildCard(order, sc));
    });
  });
}

function buildCard(order, sc) {
  const card = document.createElement('div');
  card.className = 'kanban-card';
  card.dataset.orderId = order.id;
  card.style.borderColor = sc.border || '#3b4556';
  card.innerHTML = `
    <div class="card-code">${escHtml(order.kiotviet_code || order.id)}</div>
    <div class="card-customer">${escHtml(order.customer_name || '—')}</div>
    <div class="card-meta">
      <span>Luồng ${order.flow || '?'}</span>
      <span>${escHtml(order.warehouse || '')}</span>
    </div>
    ${order.driver_name ? `<div class="card-driver"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;display:inline-block;vertical-align:-2px;margin-right:4px;"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"></path><path d="M15 18H9"></path><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"></path><circle cx="17" cy="18" r="2"></circle><circle cx="7" cy="18" r="2"></circle></svg>${escHtml(order.driver_name)}</div>` : ''}
  `;
  card.addEventListener('click', () => openModal(order.id));
  return card;
}

// ---- Panel Tạo đơn ----------------------------------------------------------

const panelCreate = document.getElementById('panelCreate');
const btnLoadInvoices = document.getElementById('btnLoadInvoices');
const invoicesTable   = document.getElementById('invoicesTable');
const invoicesTbody   = document.getElementById('invoicesTbody');
const createOrderBtn  = document.getElementById('createOrderBtn');
const createResult    = document.getElementById('createResult');

btnLoadInvoices.addEventListener('click', async () => {
  btnLoadInvoices.disabled = true;
  btnLoadInvoices.textContent = 'Đang tải...';
  invoicesTable.hidden = true;
  createResult.innerHTML = '';
  try {
    const data = await loadPendingInvoices();
    renderInvoicesTable(data.invoices || []);
  } catch (e) {
    showToast('Lỗi: ' + e.message, 'error');
  } finally {
    btnLoadInvoices.disabled = false;
    btnLoadInvoices.textContent = 'Tải hóa đơn chờ';
  }
});

function renderInvoicesTable(invoices) {
  invoicesTbody.innerHTML = '';
  if (!invoices.length) {
    invoicesTable.hidden = false;
    invoicesTbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:20px">Không có hóa đơn chờ tạo đơn.</td></tr>';
    return;
  }
  invoices.forEach(inv => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="checkbox" class="inv-check" data-code="${escAttr(inv.kiotviet_code)}"
          data-name="${escAttr(inv.customer_name)}" data-phone="${escAttr(inv.customer_phone)}"
          data-address="${escAttr(inv.address)}" aria-label="Chọn ${escAttr(inv.kiotviet_code)}"></td>
      <td class="mono">${escHtml(inv.kiotviet_code)}</td>
      <td>${escHtml(inv.customer_name)}</td>
      <td>${escHtml(inv.customer_phone)}</td>
      <td>${escHtml(inv.address)}</td>
    `;
    invoicesTbody.appendChild(tr);
  });
  invoicesTable.hidden = false;
}

// Chọn tất cả
document.getElementById('checkAllInv').addEventListener('change', function () {
  document.querySelectorAll('.inv-check').forEach(c => { c.checked = this.checked; });
});

createOrderBtn.addEventListener('click', async () => {
  const checked = [...document.querySelectorAll('.inv-check:checked')];
  if (!checked.length) { showToast('Chọn ít nhất một hóa đơn.', 'warn'); return; }

  const flow     = document.getElementById('selectFlow').value;
  const vehicleId = document.getElementById('selectVehicle').value;
  const driverName = document.getElementById('inputDriver').value.trim();
  const warehouse = document.getElementById('selectWarehouse').value;

  if (!flow || !warehouse) { showToast('Vui lòng chọn Luồng và Kho.', 'warn'); return; }

  createOrderBtn.disabled = true;
  createOrderBtn.textContent = 'Đang tạo...';
  createResult.innerHTML = '';

  const results = [];
  for (const cb of checked) {
    const { code, name, phone, address } = cb.dataset;
    try {
      const data = await apiFetch('/api/shipment/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kiotviet_code:  code,
          warehouse,
          flow:           Number(flow),
          vehicle_id:     vehicleId || undefined,
          driver_name:    driverName || undefined,
          customer_name:  name,
          customer_phone: phone,
          address
        })
      });
      results.push({ code, success: true, id: data.order && data.order.id });
    } catch (e) {
      results.push({ code, success: false, error: e.message });
    }
  }

  // Hiện kết quả
  createResult.innerHTML = results.map(r =>
    r.success
      ? `<div class="result-row ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;display:inline-block;vertical-align:-2px;margin-right:4px;"><polyline points="20 6 9 17 4 12"></polyline></svg><b>${escHtml(r.code)}</b> — Tạo đơn thành công (${escHtml(r.id)})</div>`
      : `<div class="result-row err"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;display:inline-block;vertical-align:-2px;margin-right:4px;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg><b>${escHtml(r.code)}</b> — ${escHtml(r.error)}</div>`
  ).join('');

  createOrderBtn.disabled = false;
  createOrderBtn.textContent = 'Tạo đơn';
  await loadOrders();
  renderKanban();
});

// ---- Vehicles ---------------------------------------------------------------

function renderVehiclesList() {
  const tbody = document.getElementById('vehiclesTbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  vehicles.forEach(v => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="mono">${escHtml(v.vehicle_id)}</td>
      <td>${escHtml(v.plate_number)}</td>
      <td>${escHtml(v.vehicle_type)}</td>
      <td>${escHtml(v.default_driver || '—')}</td>
      <td>
        <button class="btn-sm" onclick="openEditVehicle('${escAttr(v.vehicle_id)}')">Sửa</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function populateVehicleSelects() {
  ['selectVehicle', 'modalVehicle'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = el.value;
    el.innerHTML = '<option value="">— Chọn xe —</option>';
    vehicles.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.vehicle_id;
      opt.textContent = `${v.plate_number} (${v.vehicle_id})`;
      el.appendChild(opt);
    });
    el.value = cur;
  });
}

// Thêm xe
document.getElementById('addVehicleForm').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());
  try {
    await apiFetch('/api/shipment/vehicles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    showToast('Đã thêm xe thành công.');
    e.target.reset();
    await loadVehicles();
  } catch (err) {
    showToast('Lỗi: ' + err.message, 'error');
  }
});

// Sửa xe
window.openEditVehicle = function (vehicleId) {
  const v = vehicles.find(x => x.vehicle_id === vehicleId);
  if (!v) return;
  document.getElementById('editVehicleId').value         = v.vehicle_id;
  document.getElementById('editPlateNumber').value       = v.plate_number;
  document.getElementById('editVehicleType').value       = v.vehicle_type;
  document.getElementById('editDefaultDriver').value     = v.default_driver || '';
  document.getElementById('editMaxWeight').value         = v.max_weight || '';
  document.getElementById('editVehicleNotes').value      = v.notes || '';
  openDialog('dialogEditVehicle');
};

document.getElementById('editVehicleForm').addEventListener('submit', async e => {
  e.preventDefault();
  const vehicleId = document.getElementById('editVehicleId').value;
  const body = {
    plate_number:   document.getElementById('editPlateNumber').value,
    vehicle_type:   document.getElementById('editVehicleType').value,
    default_driver: document.getElementById('editDefaultDriver').value,
    max_weight:     document.getElementById('editMaxWeight').value,
    notes:          document.getElementById('editVehicleNotes').value
  };
  try {
    await apiFetch('/api/shipment/vehicles/' + vehicleId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    showToast('Đã cập nhật xe.');
    closeDialog('dialogEditVehicle');
    await loadVehicles();
  } catch (err) {
    showToast('Lỗi: ' + err.message, 'error');
  }
});

// ---- Modal chi tiết đơn -----------------------------------------------------

async function openModal(orderId) {
  activeOrderId = orderId;
  document.getElementById('modalLoading').hidden = false;
  document.getElementById('modalBody').hidden    = true;
  openDialog('dialogOrder');
  await refreshModalOrder(orderId);
}

async function refreshModalOrder(orderId) {
  try {
    const [orderData, attachData] = await Promise.all([
      apiFetch('/api/shipment/orders/' + orderId),
      apiFetch('/api/shipment/orders/' + orderId + '/attachments')
    ]);
    renderModalOrder(orderData.order, attachData.attachments || []);
  } catch (e) {
    showToast('Lỗi tải đơn: ' + e.message, 'error');
    closeDialog('dialogOrder');
  }
}

function renderModalOrder(order, attachments) {
  document.getElementById('modalLoading').hidden = true;
  document.getElementById('modalBody').hidden    = false;

  document.getElementById('modalTitle').textContent   = order.kiotviet_code || order.id;
  document.getElementById('modalStatus').textContent  = order.current_status;
  document.getElementById('modalCustomer').textContent = order.customer_name || '—';
  document.getElementById('modalPhone').textContent   = order.customer_phone || '—';
  document.getElementById('modalAddress').textContent = order.address || '—';
  document.getElementById('modalFlow').textContent    = FLOWS_LABEL[order.flow] || ('Luồng ' + order.flow);
  document.getElementById('modalWarehouse').textContent = order.warehouse || '—';
  document.getElementById('modalDriver').textContent  = order.driver_name || '—';
  document.getElementById('modalVehicle').value       = order.vehicle_id || '';
  document.getElementById('modalDriverInput').value   = order.driver_name || '';

  // Trạng thái màu
  const sc = STATUS_COLOR[order.current_status] || {};
  const badge = document.getElementById('modalStatusBadge');
  badge.textContent = order.current_status;
  badge.style.background = sc.bg || '';
  badge.style.borderColor = sc.border || '';
  badge.style.color = sc.text || '';

  // Nút transition
  const btns = document.getElementById('modalTransitions');
  btns.innerHTML = '';
  const nexts = NEXT_TRANSITIONS[order.current_status] || [];
  nexts.forEach(toStatus => {
    const btn = document.createElement('button');
    btn.className = 'btn-primary btn-sm-action';
    btn.textContent = '→ ' + toStatus;
    btn.addEventListener('click', () => doTransition(order.id, toStatus));
    btns.appendChild(btn);
  });

  // Nút sự cố
  const btnExc = document.getElementById('btnReportException');
  btnExc.hidden = !EXCEPTION_ELIGIBLE.has(order.current_status);

  // Lịch sử
  const hist = document.getElementById('modalHistory');
  hist.innerHTML = '';
  (order.history || []).slice().reverse().forEach(h => {
    const li = document.createElement('li');
    li.className = 'history-item';
    li.innerHTML = `<span class="history-status">${escHtml(h.status)}</span>
      <span class="history-by">${escHtml(h.changed_by || '')}</span>
      <span class="history-time">${escHtml(h.changed_at || '')}</span>
      ${h.note ? `<span class="history-note">${escHtml(h.note)}</span>` : ''}`;
    hist.appendChild(li);
  });

  // Ảnh
  const gallery = document.getElementById('modalGallery');
  gallery.innerHTML = '';
  attachments.forEach(a => {
    const img = document.createElement('a');
    img.href = a.drive_view_url;
    img.target = '_blank';
    img.rel = 'noopener';
    img.innerHTML = `<img src="${escAttr(a.drive_thumbnail_url || a.drive_view_url)}"
      alt="${escAttr(a.type)}" class="gallery-thumb" loading="lazy">`;
    gallery.appendChild(img);
  });
}

async function doTransition(orderId, toStatus) {
  const note = prompt(`Ghi chú khi chuyển sang "${toStatus}" (tùy chọn):`) || '';
  try {
    await apiFetch('/api/shipment/orders/' + orderId + '/transition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to_status: toStatus, note })
    });
    showToast('Đã chuyển trạng thái → ' + toStatus);
    await refreshModalOrder(orderId);
    await loadOrders();
    renderKanban();
  } catch (e) {
    showToast('Lỗi: ' + e.message, 'error');
  }
}

// Sửa metadata đơn
document.getElementById('saveMeta').addEventListener('click', async () => {
  if (!activeOrderId) return;
  const body = {
    vehicle_id:  document.getElementById('modalVehicle').value   || undefined,
    driver_name: document.getElementById('modalDriverInput').value.trim() || undefined
  };
  try {
    await apiFetch('/api/shipment/orders/' + activeOrderId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    showToast('Đã lưu thông tin.');
    await refreshModalOrder(activeOrderId);
    await loadOrders();
    renderKanban();
  } catch (e) {
    showToast('Lỗi: ' + e.message, 'error');
  }
});

// Báo sự cố
document.getElementById('btnReportException').addEventListener('click', () => {
  openDialog('dialogException');
});

document.getElementById('exceptionForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!activeOrderId) return;
  const type        = document.getElementById('excType').value;
  const description = document.getElementById('excDescription').value.trim();
  try {
    await apiFetch('/api/shipment/orders/' + activeOrderId + '/exceptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, description })
    });
    showToast('Đã tạo sự cố.');
    closeDialog('dialogException');
    e.target.reset();
    await refreshModalOrder(activeOrderId);
    await loadOrders();
    renderKanban();
  } catch (err) {
    showToast('Lỗi: ' + err.message, 'error');
  }
});

// ---- Dialog helpers ---------------------------------------------------------

function openDialog(id) {
  const el = document.getElementById(id);
  if (el) { el.hidden = false; el.setAttribute('aria-modal', 'true'); }
  document.getElementById('modalOverlay').hidden = false;
}

function closeDialog(id) {
  const el = document.getElementById(id);
  if (el) el.hidden = true;
  // Đóng overlay nếu ko có dialog nào mở
  const anyOpen = ['dialogOrder', 'dialogEditVehicle', 'dialogException']
    .some(d => !document.getElementById(d).hidden);
  if (!anyOpen) { document.getElementById('modalOverlay').hidden = true; activeOrderId = null; }
}

document.getElementById('modalOverlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) {
    ['dialogOrder', 'dialogEditVehicle', 'dialogException'].forEach(closeDialog);
  }
});
document.getElementById('btnCloseModal').addEventListener('click', () => closeDialog('dialogOrder'));
document.getElementById('btnCloseEditVehicle').addEventListener('click', () => closeDialog('dialogEditVehicle'));
document.getElementById('btnCloseException').addEventListener('click', () => closeDialog('dialogException'));

// ---- Toast ------------------------------------------------------------------

function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (type === 'error' ? ' toast-error' : type === 'warn' ? ' toast-warn' : '');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = 'toast'; }, 3500);
}

// ---- Utilities --------------------------------------------------------------

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(s) { return escHtml(s); }

// ---- Start ------------------------------------------------------------------
init();
