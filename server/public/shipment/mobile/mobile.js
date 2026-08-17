// ==========================================
// MOBILE.JS — Trang Mobile Web 1-chạm (Phase 1C).
//
// Dùng chung: shared-nav.js, image-compress.js
// Thủ kho (Trưởng kho): danh sách đơn "Đã in", chụp ảnh, xác nhận nhặt.
// Lái xe: danh sách đơn của mình, bắt đầu giao, upload bill/ảnh, báo sự cố.
// ==========================================
'use strict';

// ---- State ------------------------------------------------------------------
let currentUser  = null;
let orders       = [];
let pollTimer    = null;
const POLL_MS    = 25000;

// ---- Bootstrap --------------------------------------------------------------
async function init() {
  // TKSNav.authGuard() da tu render #accountChip (ten/vai tro + nut ho so/dang
  // xuat rieng) — xem server/public/shared/shared-nav.js.
  currentUser = await TKSNav.authGuard();

  await loadOrders();
  renderOrders();
  startPoll();
}

function startPoll() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    await loadOrders();
    renderOrders();
  }, POLL_MS);
}

// ---- API --------------------------------------------------------------------
async function apiFetch(url, opts) {
  const res = await fetch(url, Object.assign({ credentials: 'same-origin' }, opts || {}));
  if (res.status === 401) {
    window.location.href = '/login/?next=' + encodeURIComponent(location.pathname);
    throw new Error('unauthorized');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || 'Lỗi không xác định'), { code: body.code });
  return body;
}

async function loadOrders() {
  try {
    const role = currentUser.vaiTro;
    let url = '/api/shipment/orders?';

    if (role === 'Trưởng kho') {
      url += new URLSearchParams({ status: 'Đã in' });
    } else if (role === 'Lái xe') {
      // Lấy đơn của lái xe này, nhiều trạng thái
      const statuses = ['Đã nhặt hàng', 'Đang chuyển kho', 'Đang giao'];
      const name = currentUser.hoTen || currentUser.username;
      // Gọi 1 lần không có lọc status (API chưa hỗ trợ multi-status), lọc client
      const data = await apiFetch('/api/shipment/orders?' + new URLSearchParams({ driverName: name }));
      orders = (data.orders || []).filter(o => statuses.includes(o.current_status));
      return;
    } else {
      // Vai trò khác: xem tất cả đơn active
      url += new URLSearchParams({});
    }

    const data = await apiFetch(url);
    orders = data.orders || [];
  } catch (e) {
    console.error('loadOrders:', e.message);
  }
}

// ---- Render list ------------------------------------------------------------
const STATUS_COLOR = {
  'Đã in':           { bg: 'rgba(234,179,8,.15)',  border: 'rgba(234,179,8,.4)',  text: '#FCD34D' },
  'Đã nhặt hàng':   { bg: 'rgba(59,130,246,.15)', border: 'rgba(59,130,246,.4)', text: '#60A5FA' },
  'Đang chuyển kho': { bg: 'rgba(249,115,22,.15)', border: 'rgba(249,115,22,.4)', text: '#FB923C' },
  'Đang giao':       { bg: 'rgba(16,185,129,.15)', border: 'rgba(16,185,129,.4)', text: '#34D399' },
  'Đã giao':         { bg: 'rgba(16,185,129,.25)', border: 'rgba(16,185,129,.5)', text: '#6EE7B7' },
  'Hoàn thành':      { bg: 'rgba(16,185,129,.35)', border: 'rgba(16,185,129,.6)', text: '#A7F3D0' },
  'Sự cố':           { bg: 'rgba(239,68,68,.15)',  border: 'rgba(239,68,68,.4)', text: '#FCA5A5' }
};

function renderOrders() {
  const list   = document.getElementById('orderList');
  const empty  = document.getElementById('emptyState');
  const role   = currentUser.vaiTro;
  list.innerHTML = '';

  if (!orders.length) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  orders.forEach(order => {
    const card = buildOrderCard(order, role);
    list.appendChild(card);
  });
}

function buildOrderCard(order, role) {
  const sc = STATUS_COLOR[order.current_status] || {};
  const wrap = document.createElement('div');
  wrap.className = 'order-card';
  wrap.style.borderColor = sc.border || '#334155';

  wrap.innerHTML = `
    <div class="card-head">
      <div>
        <div class="card-code">${escHtml(order.kiotviet_code || order.id)}</div>
        <div class="card-customer">${escHtml(order.customer_name || '—')}</div>
      </div>
      <span class="status-dot" style="background:${sc.border || '#64748b'};color:${sc.text || '#94a3b8'};background-color:${sc.bg || 'transparent'};border-color:${sc.border || '#334155'}">
        ${escHtml(order.current_status)}
      </span>
    </div>
    <div class="card-address">${escHtml(order.address || '—')}</div>
    <div class="card-phone"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;display:inline-block;vertical-align:-2px;margin-right:4px;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>${escHtml(order.customer_phone || '—')}</div>
    <div class="card-actions" id="actions-${escAttr(order.id)}"></div>
  `;

  const actions = wrap.querySelector('.card-actions');

  const icCamera = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;display:inline-block;vertical-align:-2px;margin-right:6px;"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>';
  const icCheck = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;display:inline-block;vertical-align:-2px;margin-right:6px;"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  const icTruck = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;display:inline-block;vertical-align:-2px;margin-right:6px;"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"></path><path d="M15 18H9"></path><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"></path><circle cx="17" cy="18" r="2"></circle><circle cx="7" cy="18" r="2"></circle></svg>';
  const icAlert = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;display:inline-block;vertical-align:-2px;margin-right:6px;"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';

  // ── Thủ kho ──
  if (role === 'Trưởng kho' && order.current_status === 'Đã in') {
    const label  = document.createElement('label');
    label.className = 'btn-photo';
    label.setAttribute('for', 'photo-' + order.id);
    label.innerHTML = icCamera + 'Chụp ảnh hàng nhặt';
    const input = document.createElement('input');
    input.type    = 'file';
    input.accept  = 'image/*';
    input.capture = 'environment';
    input.id      = 'photo-' + order.id;
    input.hidden  = true;
    input.addEventListener('change', () => handlePickupPhoto(order.id, input));

    const confirmBtn = document.createElement('button');
    confirmBtn.className  = 'btn-confirm';
    confirmBtn.innerHTML  = icCheck + 'Xác nhận đã nhặt';
    confirmBtn.id          = 'confirm-' + order.id;
    confirmBtn.disabled    = true;
    confirmBtn.addEventListener('click', () => confirmPickup(order.id, confirmBtn));

    actions.appendChild(label);
    actions.appendChild(input);
    actions.appendChild(confirmBtn);
  }

  // ── Lái xe ──
  if (role === 'Lái xe') {
    if (order.current_status === 'Đã nhặt hàng' || order.current_status === 'Đang chuyển kho') {
      const startBtn = document.createElement('button');
      startBtn.className  = 'btn-confirm';
      startBtn.innerHTML  = icTruck + 'Bắt đầu giao';
      startBtn.addEventListener('click', () => startDelivery(order.id, startBtn));
      actions.appendChild(startBtn);
    }

    if (order.current_status === 'Đang giao') {
      // Upload ảnh bill ký nhận
      const labelBill  = document.createElement('label');
      labelBill.className = 'btn-photo';
      labelBill.setAttribute('for', 'bill-' + order.id);
      labelBill.innerHTML = icCamera + 'Chụp bill ký nhận';
      const inputBill = document.createElement('input');
      inputBill.type    = 'file';
      inputBill.accept  = 'image/*';
      inputBill.capture = 'environment';
      inputBill.id      = 'bill-' + order.id;
      inputBill.hidden  = true;
      inputBill.addEventListener('change', () => handleDeliveryPhoto(order.id, inputBill, 'SIGNED_BILL'));

      const labelProof = document.createElement('label');
      labelProof.className = 'btn-photo btn-photo-secondary';
      labelProof.setAttribute('for', 'proof-' + order.id);
      labelProof.innerHTML = icCamera + 'Ảnh giao hàng';
      const inputProof = document.createElement('input');
      inputProof.type    = 'file';
      inputProof.accept  = 'image/*';
      inputProof.capture = 'environment';
      inputProof.id      = 'proof-' + order.id;
      inputProof.hidden  = true;
      inputProof.addEventListener('change', () => handleDeliveryPhoto(order.id, inputProof, 'DELIVERY_PHOTO'));

      actions.appendChild(labelBill);
      actions.appendChild(inputBill);
      actions.appendChild(labelProof);
      actions.appendChild(inputProof);
    }
  }

  // Báo sự cố (Thủ kho & Lái xe) — khi đơn đang trong trạng thái thực địa
  const excEligible = ['Đã nhặt hàng', 'Đang chuyển kho', 'Đang giao', 'Đã giao'];
  if (excEligible.includes(order.current_status)) {
    const excBtn = document.createElement('button');
    excBtn.className  = 'btn-danger';
    excBtn.innerHTML  = icAlert + 'Báo sự cố';
    excBtn.addEventListener('click', () => openExceptionDialog(order.id));
    actions.appendChild(excBtn);
  }

  return wrap;
}

// ---- Thủ kho: chụp + xác nhận nhặt hàng ------------------------------------
const uploadingSet = new Set();

async function handlePickupPhoto(orderId, input) {
  if (!input.files || !input.files[0]) return;
  const confirmBtn = document.getElementById('confirm-' + orderId);
  try {
    input.disabled = true;
    showStatus('Đang nén ảnh...', 'info');
    const blob = await TKSImageCompress.compress(input.files[0]);
    const fd = new FormData();
    fd.append('file', blob, 'pickup.jpg');
    fd.append('type', 'PICKUP_PHOTO');
    showStatus('Đang tải ảnh lên...', 'info');
    await apiFetch('/api/shipment/orders/' + orderId + '/attachments', { method: 'POST', body: fd });
    if (confirmBtn) confirmBtn.disabled = false;
    showStatus('Đã tải ảnh. Bấm "Xác nhận đã nhặt" để hoàn tất.', 'ok');
  } catch (e) {
    showStatus('Lỗi tải ảnh: ' + e.message, 'error');
    input.disabled = false;
  }
}

async function confirmPickup(orderId, btn) {
  btn.disabled = true;
  btn.textContent = 'Đang xác nhận...';
  try {
    await apiFetch('/api/shipment/orders/' + orderId + '/transition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to_status: 'Đã nhặt hàng' })
    });
    showStatus('Đã xác nhận nhặt hàng!', 'ok');
    await loadOrders();
    renderOrders();
  } catch (e) {
    showStatus('Lỗi: ' + e.message, 'error');
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;display:inline-block;vertical-align:-2px;margin-right:6px;"><polyline points="20 6 9 17 4 12"></polyline></svg>Xác nhận đã nhặt';
  }
}

// ---- Lái xe: bắt đầu giao --------------------------------------------------
async function startDelivery(orderId, btn) {
  btn.disabled = true;
  btn.textContent = 'Đang cập nhật...';
  try {
    await apiFetch('/api/shipment/orders/' + orderId + '/transition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to_status: 'Đang giao' })
    });
    showStatus('Đã bắt đầu giao hàng!', 'ok');
    await loadOrders();
    renderOrders();
  } catch (e) {
    showStatus('Lỗi: ' + e.message, 'error');
    btn.disabled = false;
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;display:inline-block;vertical-align:-2px;margin-right:6px;"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"></path><path d="M15 18H9"></path><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"></path><circle cx="17" cy="18" r="2"></circle><circle cx="7" cy="18" r="2"></circle></svg>Bắt đầu giao';
  }
}

// ---- Lái xe: upload bill / ảnh giao hàng ------------------------------------
async function handleDeliveryPhoto(orderId, input, type) {
  if (!input.files || !input.files[0]) return;
  input.disabled = true;
  try {
    showStatus('Đang nén ảnh...', 'info');
    const blob = await TKSImageCompress.compress(input.files[0]);
    const fd = new FormData();
    fd.append('file', blob, type === 'SIGNED_BILL' ? 'bill.jpg' : 'delivery.jpg');
    fd.append('type', type);
    showStatus('Đang tải ảnh lên...', 'info');
    const data = await apiFetch('/api/shipment/orders/' + orderId + '/attachments', { method: 'POST', body: fd });

    // Nếu backend tự complete đơn
    if (data.order && data.order.current_status === 'Hoàn thành') {
      showStatus('Đơn đã hoàn thành!', 'ok');
    } else {
      showStatus('Đã tải ảnh lên thành công.', 'ok');
    }
    await loadOrders();
    renderOrders();
  } catch (e) {
    showStatus('Lỗi: ' + e.message, 'error');
    input.disabled = false;
  }
}

// ---- Sự cố ------------------------------------------------------------------
let activeExcOrderId = null;

function openExceptionDialog(orderId) {
  activeExcOrderId = orderId;
  document.getElementById('excDialog').hidden = false;
  document.getElementById('excOverlay').hidden = false;
  document.getElementById('excDescription').value = '';
  document.getElementById('excType').value = '';
}

function closeExceptionDialog() {
  document.getElementById('excDialog').hidden = true;
  document.getElementById('excOverlay').hidden = true;
  activeExcOrderId = null;
}

document.getElementById('excOverlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeExceptionDialog();
});
document.getElementById('btnCloseExc').addEventListener('click', closeExceptionDialog);

document.getElementById('excForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!activeExcOrderId) return;
  const type        = document.getElementById('excType').value;
  const description = document.getElementById('excDescription').value.trim();
  const submitBtn   = e.target.querySelector('[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Đang gửi...';
  try {
    await apiFetch('/api/shipment/orders/' + activeExcOrderId + '/exceptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, description })
    });
    showStatus('Đã báo sự cố thành công.', 'ok');
    closeExceptionDialog();
    await loadOrders();
    renderOrders();
  } catch (err) {
    showStatus('Lỗi: ' + err.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Gửi báo cáo';
  }
});

// ---- Status toast -----------------------------------------------------------
function showStatus(msg, type) {
  const el = document.getElementById('statusBar');
  el.textContent = msg;
  el.className = 'status-bar show status-' + (type || 'info');
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = 'status-bar'; }, 4000);
}

// ---- Utils ------------------------------------------------------------------
function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(s) { return escHtml(s); }

// ---- Start ------------------------------------------------------------------
init();
