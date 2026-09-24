// ==========================================
// SHARED-NAV.JS — auth guard + user chip + logout dung chung cho moi trang.
// RANH GIOI BAO MAT THAT SU nam o server: authMiddleware (requireFeature tren
// /api/*) va pageGuard (chan mo trang HTML). Script nay la LOP THU HAI, lo
// phan UX — dung menu va dieu huong cho khop, tranh hien trang trong/loi.
//
// KHONG CON MANG VAI TRO NAO O DAY. Menu + dieu huong deu dua tren
// `permissions` (danh sach key tinh nang) va `pageFeatures` (duong dan -> quyen)
// do /api/auth/me tra ve, sinh tu server/auth/featureRegistry.js — mot nguon
// su that duy nhat cho ca giao dien lan API.
// ==========================================
(function(){
  'use strict';

  var TKSNav = {};

  // ---------- Quyen tinh nang cua phien hien tai ----------
  var currentPermissions = [];
  var currentPageFeatures = [];

  /** Nap quyen tu object user cua /api/auth/me. Goi tu authGuard/renderTopSidebar. */
  TKSNav.setPermissions = function setPermissions(user){
    currentPermissions = (user && Array.isArray(user.permissions)) ? user.permissions.slice() : [];
    currentPageFeatures = (user && Array.isArray(user.pageFeatures)) ? user.pageFeatures.slice() : [];
  };

  TKSNav.getPermissions = function getPermissions(){ return currentPermissions.slice(); };

  /** true neu co IT NHAT MOT trong cac quyen truyen vao. */
  TKSNav.can = function can(){
    for(var i = 0; i < arguments.length; i++){
      var key = arguments[i];
      if(Array.isArray(key)){
        if(TKSNav.can.apply(null, key)) return true;
      } else if(currentPermissions.indexOf(key) !== -1){
        return true;
      }
    }
    return false;
  };

  TKSNav._normalizePagePath = function _normalizePagePath(pathname){
    var cleaned = String(pathname || '')
      .split('?')[0]
      .split('#')[0]
      .replace(/\/index\.html$/, '')
      .replace(/\/+$/, '');
    // '/' phuc vu chinh public/index.html giong '/reports' (xem server/index.js).
    return cleaned || '/reports';
  };

  TKSNav._pageRuleFor = function _pageRuleFor(pathname){
    var normalized = TKSNav._normalizePagePath(pathname);
    for(var i = 0; i < currentPageFeatures.length; i++){
      if(currentPageFeatures[i].path === normalized) return currentPageFeatures[i];
    }
    return null;
  };

  /** Trang dau tien tai khoan nay vao duoc — dung khi phai dieu huong di noi khac. */
  TKSNav._landingPath = function _landingPath(){
    for(var i = 0; i < currentPageFeatures.length; i++){
      var rule = currentPageFeatures[i];
      if(rule && rule.anyOf && TKSNav.can(rule.anyOf)) return rule.href;
    }
    return '/account/';
  };

  // Tach rieng de test co the gia lap (khong thuc su dieu huong trong jsdom).
  TKSNav._navigate = function(url){ window.location.href = url; };
  TKSNav._reload = function(){ window.location.reload(); };

  // ---------- Do rong sidebar co the keo (resize) ----------
  var SIDEBAR_W_KEY = 'tks-sidebar-width';
  var SIDEBAR_W_MIN = 170;
  var SIDEBAR_W_MAX = 420;

  // Ap dung ngay khi script load (trang van dang visibility:hidden cho toi khi
  // authGuard xong) de tranh nhap nhay do rong sidebar mac dinh roi doi lai.
  (function applySavedSidebarWidth(){
    try{
      var saved = parseInt(localStorage.getItem(SIDEBAR_W_KEY), 10);
      if(saved && saved >= SIDEBAR_W_MIN && saved <= SIDEBAR_W_MAX){
        document.documentElement.style.setProperty('--sidebar-w', saved + 'px');
      }
    }catch(err){ /* localStorage khong kha dung (private mode...) — bo qua */ }
  })();

  /**
   * Gan thanh keo (resize handle) ngay sau #sidebar de nguoi dung keo ngang
   * mo rong/thu gon sidebar; phan .content ben canh tu thu gon vi la flex:1.
   * Chi goi 1 lan — an toan khi authGuard/renderTopSidebar chay lai vi ham
   * nay chi ghi de mountEl.innerHTML, khong dung toi sibling nay.
   */
  TKSNav._initSidebarResize = function _initSidebarResize(sidebarEl){
    if(!sidebarEl || document.getElementById('tksSidebarResizeHandle')) return;
    var parent = sidebarEl.parentNode;
    if(!parent) return;

    var handle = document.createElement('div');
    handle.className = 'sidebar-resize-handle';
    handle.id = 'tksSidebarResizeHandle';
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-label', 'Kéo để đổi độ rộng thanh điều hướng');
    parent.insertBefore(handle, sidebarEl.nextSibling);

    var dragging = false;
    var startX = 0;
    var startW = 0;

    function currentWidth(){
      var w = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w'), 10);
      return w || sidebarEl.getBoundingClientRect().width;
    }

    function setWidth(px){
      var clamped = Math.max(SIDEBAR_W_MIN, Math.min(SIDEBAR_W_MAX, px));
      document.documentElement.style.setProperty('--sidebar-w', clamped + 'px');
      return clamped;
    }

    function onPointerMove(e){
      if(!dragging) return;
      var dx = e.clientX - startX;
      setWidth(startW + dx);
    }

    function onPointerUp(e){
      if(!dragging) return;
      dragging = false;
      handle.classList.remove('is-dragging');
      document.body.classList.remove('tks-sidebar-resizing');
      var finalW = setWidth(startW + (e.clientX - startX));
      try{ localStorage.setItem(SIDEBAR_W_KEY, String(finalW)); }catch(err){}
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
    }

    handle.addEventListener('pointerdown', function(e){
      if(e.button !== undefined && e.button !== 0) return;
      dragging = true;
      startX = e.clientX;
      startW = currentWidth();
      handle.classList.add('is-dragging');
      document.body.classList.add('tks-sidebar-resizing');
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
    });

    // Ho tro ban phim: mui ten trai/phai chinh do rong theo buoc 16px.
    handle.tabIndex = 0;
    handle.addEventListener('keydown', function(e){
      if(e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      var step = e.key === 'ArrowRight' ? 16 : -16;
      var finalW = setWidth(currentWidth() + step);
      try{ localStorage.setItem(SIDEBAR_W_KEY, String(finalW)); }catch(err){}
    });
  };

  // ---------- Thu gon/mo rong sidebar tren desktop (width ve 0, van "liem" trong layout) ----------
  // Doc lap hoan toan voi co che drawer mobile (.open/#backdrop/#menuBtn) — cai do
  // van giu nguyen nhu truoc, chi danh cho man hinh nho (xem media query trong shared.css).
  var SIDEBAR_OPEN_KEY = 'tks-sidebar-open';

  TKSNav._isSidebarOpen = function _isSidebarOpen(){
    try{ return localStorage.getItem(SIDEBAR_OPEN_KEY) !== 'closed'; }
    catch(err){ return true; }
  };

  var chevronLeftSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>';
  var chevronRightSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>';

  /**
   * Nut tron nho (</>) gan canh sidebar de thu gon/mo rong tren desktop — sidebar
   * van nam trong flex flow binh thuong (khong overlay/backdrop), chi co width ve
   * 0 khi thu gon nen .content ben canh tu gian ra lap day khoang trong. An di
   * tren man hinh nho (xem shared.css) vi mobile da co #menuBtn/drawer rieng.
   * Mac dinh MO khi chua co localStorage — chi thu gon khi nguoi dung chu dong
   * bam an, va nho lai lua chon do cho lan tai trang sau.
   */
  TKSNav._initSidebarToggle = function _initSidebarToggle(sidebarEl){
    // Bo qua bien the sidebar rieng cua trang dispatch (.sidebar-disp) — trang do
    // co UX thu gon rieng, khong dung chung co che nay.
    if(!sidebarEl || !sidebarEl.classList.contains('sidebar')) return;
    if(document.getElementById('tksSidebarToggleBtn')) return;
    var parent = sidebarEl.parentNode;
    if(!parent) return;

    var collapsed = !TKSNav._isSidebarOpen();
    sidebarEl.classList.toggle('tks-collapsed', collapsed);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'tksSidebarToggleBtn';
    btn.className = 'sidebar-toggle-btn';
    parent.insertBefore(btn, sidebarEl.nextSibling);

    function sync(){
      var isCollapsed = sidebarEl.classList.contains('tks-collapsed');
      btn.classList.toggle('tks-collapsed', isCollapsed);
      btn.innerHTML = isCollapsed ? chevronRightSvg : chevronLeftSvg;
      btn.setAttribute('aria-expanded', String(!isCollapsed));
      btn.setAttribute('aria-label', isCollapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng');
      try{ localStorage.setItem(SIDEBAR_OPEN_KEY, isCollapsed ? 'closed' : 'open'); }catch(err){}
    }

    btn.addEventListener('click', function(){
      sidebarEl.classList.toggle('tks-collapsed');
      sync();
    });

    if(typeof MutationObserver !== 'undefined'){
      new MutationObserver(sync).observe(sidebarEl, { attributes: true, attributeFilter: ['class'] });
    }
    sync();
  };

  var eyeSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
  var eyeOffSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';

  TKSNav.togglePassword = function(inputId, btnEl){
    var input = document.getElementById(inputId);
    if(!input) return;
    var isPass = input.type === 'password';
    input.type = isPass ? 'text' : 'password';
    if(btnEl){
      btnEl.innerHTML = isPass ? eyeOffSvg : eyeSvg;
      btnEl.setAttribute('aria-label', isPass ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
    }
  };

  /**
   * Goi som nhat co the (truoc khi noi dung trang hien thi). Redirect ve
   * /login/?next=<trang hien tai> neu chua dang nhap/token het han.
   * Tra ve Promise<user> khi thanh cong.
   */
  TKSNav.authGuard = function authGuard(){
    return fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(function(res){
        if(!res.ok) throw new Error('unauthorized');
        return res.json();
      })
      .then(function(user){
        TKSNav.setPermissions(user);
        // Trang nay doi hoi quyen gi? Bang pageFeatures do server gui xuong,
        // KHONG chep lai o client (xem server/auth/featureRegistry.js).
        // server/auth/pageGuard.js da chan that bang cung bang do — nhanh duoi
        // day chi de trang khong hien ra rong roi moi nhay.
        var rule = TKSNav._pageRuleFor(window.location.pathname);
        if(rule && !TKSNav.can(rule.anyOf)){
          window.location.href = TKSNav._landingPath();
          return new Promise(function(){});
        }
        var sidebar = document.getElementById('sidebar');
        if(sidebar && sidebar.dataset.tksActiveTop){
          TKSNav.renderTopSidebar(sidebar, sidebar.dataset.tksActiveTop, user);
          TKSNav._initSidebarResize(sidebar);
          TKSNav._initSidebarToggle(sidebar);
        }
        document.documentElement.style.visibility = '';
        TKSNav.renderAccountChip(user);
        TKSNav.renderHeaderBranch(user);
        TKSNav.renderNotifBell(user);
        return user;
      })
      .catch(function(){
        document.documentElement.style.visibility = '';
        // Xoa cache dashboard + ket qua kiem tra dut hang (sessionStorage) de neu
        // nguoi dung khac dang nhap tren cung tab sau khi phien nay het han,
        // ho khong thay du lieu cu.
        try { sessionStorage.removeItem('tksDashboardCache'); } catch (err) { /* noop */ }
        try { sessionStorage.removeItem('recentStockout:lastState'); } catch (err) { /* noop */ }
        try { sessionStorage.removeItem('stockout90d:lastState'); } catch (err) { /* noop */ }
        var next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = '/login/?next=' + next;
        return new Promise(function(){});
      });
  };

  TKSNav.logout = function logout(){
    if(!window.confirm('Bạn có chắc chắn muốn đăng xuất?')){
      return Promise.resolve(false);
    }
    return fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
      .finally(function(){
        // Xoa cache dashboard + ket qua kiem tra dut hang (sessionStorage) de neu
        // nguoi dung khac dang nhap tren cung tab/thiet bi, ho khong thay thoang
        // qua du lieu cua nguoi truoc.
        try { sessionStorage.removeItem('tksDashboardCache'); } catch (err) { /* noop */ }
        try { sessionStorage.removeItem('recentStockout:lastState'); } catch (err) { /* noop */ }
        try { sessionStorage.removeItem('stockout90d:lastState'); } catch (err) { /* noop */ }
        window.location.href = '/login/';
      });
  };

  /**
   * Render phan tu chip nguoi dung vao phan tu co id="accountChip"
   */
  TKSNav.renderAccountChip = function renderAccountChip(user){
    var mount = document.getElementById('accountChip');
    if(!mount) return;
    var initial = String((user.hoTen || user.username || '?')).trim().charAt(0).toUpperCase() || '?';
    mount.innerHTML =
      '<button type="button" class="profile-trigger" id="tksProfileTrigger">' +
        '<span class="avatar-badge">' + initial + '</span>' +
        '<span class="who"><span class="name"></span><span class="role"></span></span>' +
      '</button>' +
      '<button type="button" class="tks-btn-danger" id="tksHeaderLogout">Đăng xuất</button>';
    mount.querySelector('.name').textContent = user.hoTen || user.username;
    mount.querySelector('.role').textContent = user.vaiTro || '';
    mount.querySelector('#tksProfileTrigger').addEventListener('click', function(){
      window.location.href = '/account/';
    });
    mount.querySelector('#tksHeaderLogout').addEventListener('click', TKSNav.logout);
  };

  // ---------- Chuong thong bao (dung chung moi trang, dat canh accountChip) ----------
  var notifPollTimer = null;

  /**
   * Chen nut chuong + dropdown ngay truoc phan tu #accountChip. Khong can sua
   * HTML tung trang vi #accountChip da co san o moi trang noi bo. Poll
   * /api/notifications/unread-count moi 30s (khong co ha tang websocket).
   */
  // Thong báo bấm vào sẽ điều hướng theo relatedType. Xem
  // server/notifications/notificationRepository.js cho các type đang phát ra.
  var NOTIF_NAV_TARGETS = {
    roleChangeRequest: '/account/#users',
    accountCreated: '/account/#users',
    leaveRequest: '/humanresources/#leave'
  };

  var trashSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>';

  TKSNav.renderNotifBell = function renderNotifBell(user){
    // Nut Duyet/Tu choi doi vai tro gac bang quyen 'account.users.manage' —
    // nap lai quyen tu user de ham nay goi doc lap duoc (khong phu thuoc
    // authGuard da chay truoc hay chua).
    if(user && Array.isArray(user.permissions)) TKSNav.setPermissions(user);
    var chipMount = document.getElementById('accountChip');
    if(!chipMount || !chipMount.parentNode) return;
    if(document.getElementById('tksNotifBell')) return;

    var wrap = document.createElement('div');
    wrap.className = 'tks-notif-wrap';
    wrap.id = 'tksNotifBell';
    wrap.innerHTML =
      '<button type="button" class="tks-notif-bell" id="tksNotifBellBtn" aria-label="Thông báo" aria-haspopup="true" aria-expanded="false">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"></path></svg>' +
        '<span class="tks-notif-badge" id="tksNotifBadge" hidden>0</span>' +
      '</button>' +
      '<div class="tks-notif-dropdown" id="tksNotifDropdown" hidden>' +
        '<div class="tks-notif-dropdown-header">' +
          '<span>Thông báo</span>' +
          '<div class="tks-notif-header-actions">' +
            '<button type="button" class="tks-notif-mark-all" id="tksNotifMarkAll">Đánh dấu đã đọc</button>' +
            '<button type="button" class="tks-notif-clear-all" id="tksNotifClearAll" hidden>Xóa tất cả</button>' +
          '</div>' +
        '</div>' +
        '<div class="tks-notif-list" id="tksNotifList"><p class="tks-notif-empty">Đang tải...</p></div>' +
      '</div>';
    chipMount.parentNode.insertBefore(wrap, chipMount);

    var btn = wrap.querySelector('#tksNotifBellBtn');
    var dropdown = wrap.querySelector('#tksNotifDropdown');
    var badge = wrap.querySelector('#tksNotifBadge');
    var list = wrap.querySelector('#tksNotifList');
    var markAllBtn = wrap.querySelector('#tksNotifMarkAll');
    var clearAllBtn = wrap.querySelector('#tksNotifClearAll');
    var isOpen = false;

    function renderBadge(count){
      if(count > 0){
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.hidden = false;
      } else {
        badge.hidden = true;
      }
    }

    function refreshCount(){
      fetch('/api/notifications/unread-count', { credentials: 'same-origin' })
        .then(function(res){ return res.ok ? res.json() : { count: 0 }; })
        .then(function(data){ renderBadge(data.count || 0); })
        .catch(function(){});
    }

    function escapeHtml(str){
      return String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function formatNotifDate(iso){
      if(!iso) return '';
      var d = new Date(iso);
      if(isNaN(d.getTime())) return '';
      var pad = function(n){ return n < 10 ? '0' + n : String(n); };
      return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
    }

    function renderList(notifications){
      clearAllBtn.hidden = !notifications.length;
      if(!notifications.length){
        list.innerHTML = '<p class="tks-notif-empty">Không có thông báo nào.</p>';
        return;
      }
      list.innerHTML = notifications.map(function(n){
        var actions = '';
        if(n.type === 'role_change_request' && !n.isRead && TKSNav.can('account.users.manage')){
          actions =
            '<div class="tks-notif-actions">' +
              '<button type="button" class="tks-notif-approve" data-request-id="' + escapeHtml(n.relatedId) + '">Duyệt</button>' +
              '<button type="button" class="tks-notif-reject" data-request-id="' + escapeHtml(n.relatedId) + '">Từ chối</button>' +
            '</div>';
        }
        var clickable = !!NOTIF_NAV_TARGETS[n.relatedType];
        var dateStr = formatNotifDate(n.createdAt);
        return '<div class="tks-notif-item' + (n.isRead ? '' : ' unread') + (clickable ? ' clickable' : '') + '"' +
          ' data-notif-id="' + escapeHtml(n.id) + '" data-related-type="' + escapeHtml(n.relatedType || '') + '">' +
          '<button type="button" class="tks-notif-delete" data-notif-id="' + escapeHtml(n.id) + '" aria-label="Xóa thông báo">' + trashSvg + '</button>' +
          '<p class="tks-notif-item-title">' + escapeHtml(n.title) + '</p>' +
          '<p class="tks-notif-item-msg">' + escapeHtml(n.message) + '</p>' +
          (dateStr ? '<p class="tks-notif-item-date">' + escapeHtml(dateStr) + '</p>' : '') +
          actions +
        '</div>';
      }).join('');
    }

    function loadList(){
      fetch('/api/notifications', { credentials: 'same-origin' })
        .then(function(res){ return res.json(); })
        .then(function(data){ renderList(data.notifications || []); })
        .catch(function(){ list.innerHTML = '<p class="tks-notif-empty">Không tải được thông báo.</p>'; });
    }

    function positionDropdown(){
      var rect = btn.getBoundingClientRect();
      var margin = 12;
      var width = Math.min(340, window.innerWidth - margin * 2);
      var left = Math.min(Math.max(rect.right - width, margin), window.innerWidth - width - margin);
      var top = Math.min(rect.bottom + 8, window.innerHeight - margin);
      dropdown.style.width = width + 'px';
      dropdown.style.top = top + 'px';
      dropdown.style.left = left + 'px';
    }

    function onViewportChange(){ if(isOpen) positionDropdown(); }

    function closeDropdown(){
      dropdown.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      isOpen = false;
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    }
    function openDropdown(){
      dropdown.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      isOpen = true;
      positionDropdown();
      window.addEventListener('resize', onViewportChange);
      window.addEventListener('scroll', onViewportChange, true);
      loadList();
    }

    btn.addEventListener('click', function(e){
      e.stopPropagation();
      if(isOpen) closeDropdown(); else openDropdown();
    });
    document.addEventListener('click', function(e){
      if(isOpen && !wrap.contains(e.target)) closeDropdown();
    });

    markAllBtn.addEventListener('click', function(){
      fetch('/api/notifications/read-all', { method: 'PATCH', credentials: 'same-origin' })
        .then(function(){ refreshCount(); loadList(); })
        .catch(function(){});
    });

    clearAllBtn.addEventListener('click', function(){
      fetch('/api/notifications', { method: 'DELETE', credentials: 'same-origin' })
        .then(function(){ refreshCount(); loadList(); })
        .catch(function(){});
    });

    list.addEventListener('click', function(e){
      var approveBtn = e.target.closest && e.target.closest('.tks-notif-approve');
      var rejectBtn = e.target.closest && e.target.closest('.tks-notif-reject');
      var deleteBtn = e.target.closest && e.target.closest('.tks-notif-delete');
      var actionBtn = approveBtn || rejectBtn;

      if(deleteBtn){
        var deleteId = deleteBtn.dataset.notifId;
        deleteBtn.disabled = true;
        fetch('/api/notifications/' + deleteId, { method: 'DELETE', credentials: 'same-origin' })
          .then(function(){ loadList(); refreshCount(); })
          .catch(function(){ deleteBtn.disabled = false; });
        return;
      }

      if(actionBtn){
        var requestId = actionBtn.dataset.requestId;
        var status = approveBtn ? 'Đã duyệt' : 'Từ chối';
        actionBtn.disabled = true;
        fetch('/api/role-requests/' + requestId + '/status', {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: status })
        })
          .then(function(res){ return res.json(); })
          .then(function(){ loadList(); refreshCount(); })
          .catch(function(){ actionBtn.disabled = false; });
        return;
      }

      var item = e.target.closest && e.target.closest('.tks-notif-item');
      if(!item) return;
      var notifId = item.dataset.notifId;
      var relatedType = item.dataset.relatedType;
      var target = NOTIF_NAV_TARGETS[relatedType];
      var wasUnread = item.classList.contains('unread');

      var markReadPromise = wasUnread
        ? fetch('/api/notifications/' + notifId + '/read', { method: 'PATCH', credentials: 'same-origin' }).catch(function(){})
        : Promise.resolve();

      if(target){
        markReadPromise.then(function(){ TKSNav._navigate(target); });
      } else if(wasUnread){
        markReadPromise.then(function(){ refreshCount(); loadList(); });
      }
    });

    refreshCount();
    if(notifPollTimer) window.clearInterval(notifPollTimer);
    notifPollTimer = window.setInterval(refreshCount, 30000);
  };

  // ---------- Modal Ho so ca nhan (dung chung moi trang) ----------
  var profileModalEls = null;

  function buildProfileModal(){
    var overlay = document.createElement('div');
    overlay.className = 'tks-profile-overlay';
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="tks-profile-dialog" role="dialog" aria-modal="true" aria-labelledby="tksProfileTitle">' +
        '<div class="tks-profile-header">' +
          '<h3 id="tksProfileTitle">Hồ sơ của tôi</h3>' +
          '<button type="button" class="tks-profile-close" aria-label="Đóng">✕</button>' +
        '</div>' +
        '<div class="tks-profile-body">' +
          '<p class="tks-profile-loading">Đang tải...</p>' +
          '<div class="tks-profile-content" hidden>' +
            '<section class="tks-profile-section">' +
              '<p class="tks-profile-section-title">Thông tin cơ bản</p>' +
              '<label class="tks-field"><span>Họ tên</span><input type="text" id="tksProfileHoTen" maxlength="100"></label>' +
              '<label class="tks-field"><span>Email</span><input type="email" id="tksProfileEmail" maxlength="254"></label>' +
              '<label class="tks-field tks-field-readonly"><span>Tài khoản đăng nhập</span><input type="text" id="tksProfileUsername" disabled></label>' +
              '<label class="tks-field tks-field-readonly"><span>Vai trò</span><input type="text" id="tksProfileRole" disabled></label>' +
              '<label class="tks-field tks-field-readonly"><span>Cơ sở phụ trách</span><input type="text" id="tksProfileFacility" disabled></label>' +
              '<p class="tks-field-error" id="tksProfileError" hidden></p>' +
              '<button type="button" class="tks-btn-primary" id="tksProfileSave">Lưu thay đổi</button>' +
            '</section>' +

            '<section class="tks-profile-section">' +
              '<p class="tks-profile-section-title">Thông tin khôi phục & Bảo mật</p>' +
              '<p class="tks-profile-hint">Dùng để nhận mã OTP khi quên mật khẩu hoặc xác minh đăng nhập.</p>' +
              '<label class="tks-field"><span>Email khôi phục</span><input type="email" id="tksProfileRecoveryEmail" maxlength="254" placeholder="vd: recovery@domain.com"></label>' +
              '<div class="tks-field" id="tksRecoveryPasswordField">' +
                '<span>Mật khẩu hiện tại (Bắt buộc để lưu)</span>' +
                '<div class="password-wrap">' +
                  '<input type="password" id="tksRecoveryConfirmPassword" autocomplete="current-password" placeholder="Nhập mật khẩu để xác nhận">' +
                  '<button type="button" class="password-toggle-btn" onclick="TKSNav.togglePassword(\'tksRecoveryConfirmPassword\', this)">' + eyeSvg + '</button>' +
                '</div>' +
              '</div>' +
              '<p class="tks-field-error" id="tksRecoveryError" hidden></p>' +
              '<button type="button" class="tks-btn-primary" id="tksRecoverySave">Lưu thông tin khôi phục</button>' +
            '</section>' +

            '<section class="tks-profile-section">' +
              '<p class="tks-profile-section-title">Đổi mật khẩu</p>' +
              '<p class="tks-profile-hint" id="tksPasswordHint" hidden>Tài khoản đăng nhập bằng Google — đặt mật khẩu để có thể đăng nhập bằng tài khoản/mật khẩu.</p>' +
              '<div class="tks-field" id="tksCurrentPasswordField">' +
                '<span>Mật khẩu hiện tại</span>' +
                '<div class="password-wrap">' +
                  '<input type="password" id="tksProfileCurrentPassword" autocomplete="current-password">' +
                  '<button type="button" class="password-toggle-btn" onclick="TKSNav.togglePassword(\'tksProfileCurrentPassword\', this)">' + eyeSvg + '</button>' +
                '</div>' +
              '</div>' +
              '<div class="tks-field">' +
                '<span>Mật khẩu mới</span>' +
                '<div class="password-wrap">' +
                  '<input type="password" id="tksProfileNewPassword" autocomplete="new-password">' +
                  '<button type="button" class="password-toggle-btn" onclick="TKSNav.togglePassword(\'tksProfileNewPassword\', this)">' + eyeSvg + '</button>' +
                '</div>' +
              '</div>' +
              '<div class="tks-field">' +
                '<span>Xác nhận mật khẩu mới</span>' +
                '<div class="password-wrap">' +
                  '<input type="password" id="tksProfileConfirmPassword" autocomplete="new-password">' +
                  '<button type="button" class="password-toggle-btn" onclick="TKSNav.togglePassword(\'tksProfileConfirmPassword\', this)">' + eyeSvg + '</button>' +
                '</div>' +
              '</div>' +
              '<p class="tks-field-error" id="tksPasswordError" hidden></p>' +
              '<button type="button" class="tks-btn-primary" id="tksProfileChangePassword">Đổi mật khẩu</button>' +
            '</section>' +

            '<section class="tks-profile-section">' +
              '<p class="tks-profile-section-title">Phiên làm việc</p>' +
              '<p class="tks-profile-hint">Đăng xuất khỏi phiên làm việc hiện tại trên thiết bị này.</p>' +
              '<button type="button" class="tks-btn-danger" id="tksProfileLogout">Đăng xuất</button>' +
            '</section>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    var els = {
      overlay: overlay,
      loading: overlay.querySelector('.tks-profile-loading'),
      content: overlay.querySelector('.tks-profile-content'),
      hoTen: overlay.querySelector('#tksProfileHoTen'),
      email: overlay.querySelector('#tksProfileEmail'),
      username: overlay.querySelector('#tksProfileUsername'),
      role: overlay.querySelector('#tksProfileRole'),
      facility: overlay.querySelector('#tksProfileFacility'),
      profileError: overlay.querySelector('#tksProfileError'),
      saveBtn: overlay.querySelector('#tksProfileSave'),
      // Recovery contacts
      recoveryEmail: overlay.querySelector('#tksProfileRecoveryEmail'),
      recoveryConfirmPassword: overlay.querySelector('#tksRecoveryConfirmPassword'),
      recoveryError: overlay.querySelector('#tksRecoveryError'),
      recoverySaveBtn: overlay.querySelector('#tksRecoverySave'),
      // Passwords
      passwordHint: overlay.querySelector('#tksPasswordHint'),
      currentPasswordField: overlay.querySelector('#tksCurrentPasswordField'),
      currentPassword: overlay.querySelector('#tksProfileCurrentPassword'),
      newPassword: overlay.querySelector('#tksProfileNewPassword'),
      confirmPassword: overlay.querySelector('#tksProfileConfirmPassword'),
      passwordError: overlay.querySelector('#tksPasswordError'),
      changePasswordBtn: overlay.querySelector('#tksProfileChangePassword'),
      logoutBtn: overlay.querySelector('#tksProfileLogout')
    };

    function close(){
      els.overlay.hidden = true;
      document.removeEventListener('keydown', onKeydown);
    }
    function onKeydown(e){
      if(e.key === 'Escape') close();
    }
    overlay.querySelector('.tks-profile-close').addEventListener('click', close);
    overlay.querySelector('#tksProfileLogout').addEventListener('click', TKSNav.logout);
    overlay.addEventListener('click', function(e){
      if(e.target === overlay) close();
    });
    els.close = close;
    els.onOpenKeydown = onKeydown;

    function showError(el, msg){
      el.classList.remove('tks-field-success');
      el.textContent = msg;
      el.hidden = !msg;
    }

    // Thong bao thanh cong hien inline ngay tren nut Luu (khong dung alert()).
    // Tu an sau vai giay hoac khi nguoi dung bat dau sua lai form.
    function showSuccess(el, msg){
      el.classList.add('tks-field-success');
      el.textContent = msg;
      el.hidden = !msg;
      window.clearTimeout(el._tksSuccessTimer);
      el._tksSuccessTimer = window.setTimeout(function(){
        if(el.classList.contains('tks-field-success')) showError(el, '');
      }, 4000);
    }

    els.saveBtn.addEventListener('click', function(){
      showError(els.profileError, '');
      var hoTen = els.hoTen.value.trim();
      var email = els.email.value.trim();
      if(!hoTen || !email){
        showError(els.profileError, 'Vui lòng nhập đầy đủ họ tên và email.');
        return;
      }
      els.saveBtn.disabled = true;
      fetch('/api/auth/profile', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hoTen: hoTen, email: email })
      })
        .then(function(res){ return res.json().then(function(data){ return { ok: res.ok, data: data }; }); })
        .then(function(result){
          if(!result.ok){
            showError(els.profileError, result.data.error || 'Không cập nhật được hồ sơ.');
            return;
          }
          var mount = document.getElementById('accountChip');
          if(mount){
            var nameEl = mount.querySelector('.name');
            if(nameEl) nameEl.textContent = result.data.hoTen;
            var badgeEl = mount.querySelector('.avatar-badge');
            if(badgeEl) badgeEl.textContent = (result.data.hoTen || '?').trim().charAt(0).toUpperCase() || '?';
          }
          showSuccess(els.profileError, 'Đã cập nhật thông tin cá nhân thành công.');
        })
        .catch(function(){ showError(els.profileError, 'Không cập nhật được hồ sơ, vui lòng thử lại.'); })
        .finally(function(){ els.saveBtn.disabled = false; });
    });

    els.recoverySaveBtn.addEventListener('click', function(){
      showError(els.recoveryError, '');
      var emailKhoiPhuc = els.recoveryEmail.value.trim();
      var matKhauXacNhan = els.recoveryConfirmPassword.value;

      els.recoverySaveBtn.disabled = true;
      fetch('/api/auth/recovery', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailKhoiPhuc: emailKhoiPhuc,
          matKhauXacNhan: matKhauXacNhan
        })
      })
        .then(function(res){ return res.json().then(function(data){ return { ok: res.ok, data: data }; }); })
        .then(function(result){
          if(!result.ok){
            showError(els.recoveryError, result.data.error || 'Không cập nhật được thông tin khôi phục.');
            return;
          }
          els.recoveryConfirmPassword.value = '';
          showSuccess(els.recoveryError, 'Đã cập nhật thông tin khôi phục thành công.');
        })
        .catch(function(){ showError(els.recoveryError, 'Lỗi kết nối, vui lòng thử lại.'); })
        .finally(function(){ els.recoverySaveBtn.disabled = false; });
    });

    els.changePasswordBtn.addEventListener('click', function(){
      showError(els.passwordError, '');
      var matKhauHienTai = els.currentPassword.value;
      var matKhauMoi = els.newPassword.value;
      var confirm = els.confirmPassword.value;
      if(matKhauMoi.length < 8){
        showError(els.passwordError, 'Mật khẩu mới phải có ít nhất 8 ký tự.');
        return;
      }
      if(matKhauMoi !== confirm){
        showError(els.passwordError, 'Xác nhận mật khẩu mới không khớp.');
        return;
      }
      els.changePasswordBtn.disabled = true;
      fetch('/api/auth/change-password', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matKhauHienTai: matKhauHienTai, matKhauMoi: matKhauMoi })
      })
        .then(function(res){ return res.json().then(function(data){ return { ok: res.ok, data: data }; }); })
        .then(function(result){
          if(!result.ok){
            showError(els.passwordError, result.data.error || 'Không đổi được mật khẩu.');
            return;
          }
          els.currentPassword.value = '';
          els.newPassword.value = '';
          els.confirmPassword.value = '';
          showSuccess(els.passwordError, 'Đổi mật khẩu thành công.');
        })
        .catch(function(){ showError(els.passwordError, 'Không đổi được mật khẩu, vui lòng thử lại.'); })
        .finally(function(){ els.changePasswordBtn.disabled = false; });
    });

    return els;
  }

  /**
   * Mo modal ho so ca nhan
   */
  TKSNav.openProfileModal = function openProfileModal(){
    if(!profileModalEls) profileModalEls = buildProfileModal();
    var els = profileModalEls;
    els.overlay.hidden = false;
    els.loading.hidden = false;
    els.content.hidden = true;
    document.addEventListener('keydown', els.onOpenKeydown);

    fetch('/api/auth/profile', { credentials: 'same-origin' })
      .then(function(res){
        if(!res.ok) throw new Error('load-failed');
        return res.json();
      })
      .then(function(profile){
        els.hoTen.value = profile.hoTen || '';
        els.email.value = profile.email || '';
        els.username.value = profile.username || '';
        els.role.value = profile.vaiTro || '';
        els.facility.value = profile.coSo || '';
        els.recoveryEmail.value = profile.emailKhoiPhuc || '';
        els.recoveryConfirmPassword.value = '';
        els.currentPasswordField.hidden = !profile.hasPassword;
        els.passwordHint.hidden = !!profile.hasPassword;
        els.loading.hidden = true;
        els.content.hidden = false;
      })
      .catch(function(){
        els.loading.textContent = 'Không tải được hồ sơ, vui lòng thử lại.';
      });
  };

  /**
   * Render sidebar theo QUYEN cua tai khoan — KHONG con mang vai tro nao o day.
   * Moi muc menu khai bao `feature` (hoac mang feature: co mot la du); muc
   * khong co quyen thi bi loc bo, va ca NHOM bi an neu khong con muc con nao.
   * Danh sach quyen den tu /api/auth/me (server/auth/featureRegistry.js).
   */
  var NAV_CHEVRON = '<svg class="nav-group-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>';

  function navIcon(inner){
    return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  }

  function navItemHtml(item){
    var attrs = item.dataAttr ? ' ' + item.dataAttr : '';
    return '<a href="' + item.href + '" class="nav-item' + (item.active ? ' active' : '') + '"' +
      (item.active ? ' aria-current="page"' : '') + attrs + '>' +
      navIcon(item.icon) + item.label + '</a>';
  }

  function navGroupHtml(group){
    var items = group.items.filter(function(item){ return TKSNav.can(item.feature); });
    if(!items.length) return '';
    var capitalized = group.key.charAt(0).toUpperCase() + group.key.slice(1);
    var expanded = group.active || TKSNav._isNavGroupOpen(group.key);
    return '<div class="nav-group">' +
      '<button type="button" class="nav-group-toggle' + (group.active ? ' has-active' : '') + '"' +
        ' id="tks' + capitalized + 'GroupToggle" data-tks-nav-group="' + group.key + '"' +
        ' aria-expanded="' + expanded + '" aria-controls="tks' + capitalized + 'GroupList">' +
        navIcon(group.icon) +
        '<span>' + group.label + '</span>' +
        NAV_CHEVRON +
      '</button>' +
      '<div class="nav-group-list" id="tks' + capitalized + 'GroupList"' + (expanded ? '' : ' hidden') + '>' +
        items.map(navItemHtml).join('') +
      '</div>' +
      '</div>';
  }

  TKSNav.renderTopSidebar = function renderTopSidebar(mountEl, activeTop, user){
    if(!mountEl) return;
    // Trang co the goi thang renderTopSidebar sau authGuard — nap lai quyen tu
    // user de khong phu thuoc thu tu goi.
    if(user && Array.isArray(user.permissions)) TKSNav.setPermissions(user);
    mountEl.dataset.tksActiveTop = activeTop;

    var currentPath = (typeof window !== 'undefined' && window.location.pathname)
      ? window.location.pathname.replace(/\/index\.html$/, '').replace(/\/$/, '')
      : '';
    var currentHash = (typeof window !== 'undefined' && window.location.hash)
      ? window.location.hash.replace('#', '')
      : '';

    // Nhom "Bao cao tong hop": cac tab con la view cua public/index.html (phuc
    // vu ca o "/" lan "/reports/" - xem server/index.js), dieu huong bang hash.
    var reportItems = [
      { feature: 'reports.overview', view: 'overview', label: 'Tổng quan', icon: '<rect width="7" height="9" x="3" y="3" rx="1"></rect><rect width="7" height="5" x="14" y="3" rx="1"></rect><rect width="7" height="9" x="14" y="12" rx="1"></rect><rect width="7" height="5" x="3" y="16" rx="1"></rect>' },
      { feature: 'reports.products', view: 'products', label: 'Hàng hóa', icon: '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73Z"></path><path d="M12 22V12"></path><polyline points="3.29 7 12 12 20.71 7"></polyline><path d="m7.5 4.27 9 5.15"></path>' },
      { feature: 'reports.invoices', view: 'invoices', label: 'Hóa đơn', icon: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"></path><path d="M14 8H8"></path><path d="M16 12H8"></path><path d="M13 16H8"></path>' },
      { feature: 'reports.customers', view: 'customers', label: 'Khách hàng', icon: '<path d="M16 2v2"></path><path d="M8 2v2"></path><rect x="3" y="4" width="18" height="18" rx="2"></rect><circle cx="12" cy="11" r="3"></circle><path d="M8 18a4 4 0 0 1 8 0"></path>' },
      { feature: 'reports.suppliers', view: 'suppliers', label: 'Nhà cung cấp', icon: '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"></path><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"></path><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"></path><path d="M10 6h4"></path><path d="M10 10h4"></path><path d="M10 14h4"></path><path d="M10 18h4"></path>' },
      { feature: 'reports.debt', view: 'debt', label: 'Quản lý công nợ', icon: '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"></path><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"></path><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"></path>' }
    ].map(function(v){
      return { feature: v.feature, href: '/reports/#' + v.view, label: v.label, icon: v.icon };
    });

    // Nhom "Quan ly don hang": 2 tab con cua cung trang /shipment/lifecycle/.
    // Muc dau tien mo cho ca Khach (quyen shipment.lookup) vi do la trang tra
    // cuu don duy nhat ho co.
    var isLifecyclePage = currentPath === '/shipment/lifecycle';
    var isLifecycleHistoryTab = isLifecyclePage && currentHash === 'history';
    var isLifecycleOrdersTab = isLifecyclePage && !isLifecycleHistoryTab;
    var shipmentItems = [
      {
        feature: ['shipment.lookup', 'shipment.lifecycle'],
        href: '/shipment/lifecycle/',
        label: 'Vòng đời đơn hàng',
        active: isLifecycleOrdersTab,
        dataAttr: 'data-shipment-subtab="orders"',
        icon: '<circle cx="12" cy="12" r="9"></circle><polyline points="12 7 12 12 15.5 14"></polyline>'
      },
      {
        feature: 'shipment.history',
        href: '/shipment/lifecycle/#history',
        label: 'Lịch sử cập nhật',
        active: isLifecycleHistoryTab,
        dataAttr: 'data-shipment-subtab="history"',
        icon: '<path d="M3 3v5h5"></path><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"></path><path d="M12 7v5l4 2"></path>'
      }
    ];

    var isHrPage = currentPath === '/humanresources';
    var isHrQuydinhTab = isHrPage && currentHash === 'quydinh';
    var isHrDanhSachTab = isHrPage && currentHash === 'danhsach';
    var isHrLeaveTab = isHrPage && !isHrQuydinhTab && !isHrDanhSachTab;
    var hrItems = [
      {
        feature: 'hr.rules', href: '/humanresources/#quydinh', label: 'Quy định công ty',
        active: isHrQuydinhTab, dataAttr: 'data-hr-subtab="quydinh"',
        icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><line x1="10" y1="9" x2="8" y2="9"></line>'
      },
      {
        feature: 'hr.employees', href: '/humanresources/#danhsach', label: 'Danh sách nhân sự',
        active: isHrDanhSachTab, dataAttr: 'data-hr-subtab="danhsach"',
        icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>'
      },
      {
        feature: 'hr.leave', href: '/humanresources/#leave', label: 'Nghỉ phép',
        active: isHrLeaveTab, dataAttr: 'data-hr-subtab="leave"',
        icon: '<rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>'
      }
    ];

    var isAccountPage = currentPath === '/account';
    var isUsersTab = isAccountPage && (currentHash === 'users' || currentHash === 'adminUsers');
    var isProfileTab = isAccountPage && !isUsersTab;
    var accountItems = [
      {
        feature: 'account.profile', href: '/account/#profile', label: 'Quản lý hồ sơ',
        active: isProfileTab, dataAttr: 'data-account-subtab="profile"',
        icon: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>'
      },
      {
        feature: 'account.users', href: '/account/#users', label: 'Quản lý người dùng',
        active: isUsersTab, dataAttr: 'data-account-subtab="users"',
        icon: '<circle cx="18" cy="15" r="3"></circle><circle cx="9" cy="7" r="4"></circle><path d="M10 15H6a4 4 0 0 0-4 4v2"></path><path d="m21.7 16.4-.9-.3"></path><path d="m15.2 13.9-.9-.3"></path><path d="m16.6 18.7.3-.9"></path><path d="m19.1 12.2.3-.9"></path><path d="m19.6 18.7-.4-.8"></path><path d="m16.8 12.3-.4-.8"></path><path d="m14.3 16.6.8-.4"></path><path d="m20.7 13.8.8-.4"></path>'
      }
    ];

    var groups = [
      {
        key: 'reports', label: 'Báo cáo tổng hợp', active: activeTop === 'reports', items: reportItems,
        icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="8" y1="18" x2="8" y2="14"></line><line x1="16" y1="18" x2="16" y2="16"></line>'
      },
      {
        key: 'shipment', label: 'Quản lý đơn hàng', active: activeTop === 'shipment', items: shipmentItems,
        icon: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"></path><path d="M15 18H9"></path><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"></path><circle cx="17" cy="18" r="2"></circle><circle cx="7" cy="18" r="2"></circle>'
      },
      {
        key: 'hr', label: 'Quản lý nhân sự', active: activeTop === 'hr', items: hrItems,
        icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>'
      },
      {
        key: 'account', label: 'Quản lý tài khoản', active: activeTop === 'account', items: accountItems,
        icon: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.8 17 5 19 5a1 1 0 0 1 1 1z"></path><path d="m9 12 2 2 4-4"></path>'
      }
    ];

    mountEl.innerHTML = groups.map(navGroupHtml).join('');
  };

  // ---------- Chon co so (Ha Noi / Sai Gon / Ca hai) ----------
  // Tai khoan co ca hai co so se thay ca ba lua chon, gom gia tri tong hop
  // "Cả hai"; mot co so thi
  // hien nhan tinh de nguoi dung luon biet dang xem du lieu cua co so nao.
  // Day chi la UX — server luon tu xac thuc lai co so theo coSo trong JWT.

  var currentBranch = null;

  TKSNav.getCurrentBranch = function getCurrentBranch(){ return currentBranch; };

  TKSNav.renderHeaderBranch = function renderHeaderBranch(user){
    var accountChip = document.getElementById('accountChip');
    if(!accountChip || !accountChip.parentNode) return;

    var oldMount = document.getElementById('tksBranchSwitcher');
    if(oldMount && oldMount.parentNode) oldMount.parentNode.removeChild(oldMount);

    var mount = document.createElement('div');
    mount.id = 'tksBranchSwitcher';
    mount.className = 'tks-branch-mount';
    mount.innerHTML = TKSNav._branchSwitcherHtml(user);
    accountChip.parentNode.insertBefore(mount, accountChip);
    TKSNav._bindBranchSwitcher(mount);
  };

  TKSNav._branchSwitcherHtml = function _branchSwitcherHtml(user){
    var branches = (user && user.branches) || [];
    currentBranch = (user && user.branch) || branches[0] || null;

    if(branches.length === 0){
      return '<div class="tks-branch tks-branch--none" title="Liên hệ Quản lý để được gán cơ sở">Chưa được gán cơ sở</div>';
    }
    if(branches.length === 1){
      return '<div class="tks-branch tks-branch--fixed"><span class="tks-branch-label">Cơ sở</span>' +
        '<span class="tks-branch-value">' + escapeHtml(branches[0]) + '</span></div>';
    }
    return '<div class="tks-branch tks-branch--switch">' +
      '<label class="tks-branch-label" for="tksBranchSelect">Cơ sở</label>' +
      '<select class="tks-branch-select" id="tksBranchSelect">' +
        branches.map(function(b){
          return '<option value="' + escapeHtml(b) + '"' + (b === currentBranch ? ' selected' : '') + '>' + escapeHtml(b) + '</option>';
        }).join('') +
      '</select>' +
    '</div>';
  };

  TKSNav._bindBranchSwitcher = function _bindBranchSwitcher(mountEl){
    var select = mountEl && mountEl.querySelector('#tksBranchSelect');
    if(!select) return;
    select.addEventListener('change', function(){
      var branch = select.value;
      select.disabled = true;
      fetch('/api/branch', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: branch })
      })
        .then(function(res){
          if(!res.ok) throw new Error('branch-switch-failed');
          // Tai lai ca trang thay vi refetch tung phan: moi tab dang giu cache/
          // state rieng cua co so cu (bo loc, ket qua tim kiem, SSE nhan su),
          // reload la cach chac chan nhat de khong tron du lieu hai co so.
          // Xoa cache dashboard (sessionStorage) de trang Bao cao tong hop khong
          // vo tinh doc lai du lieu cua co so cu khi dieu huong toi (khong reload).
          try { sessionStorage.removeItem('tksDashboardCache'); } catch (err) { /* noop */ }
          TKSNav._reload();
        })
        .catch(function(){
          select.disabled = false;
          select.value = currentBranch || select.value;
          window.alert('Không chuyển được cơ sở. Vui lòng thử lại.');
        });
    });
  };

  /**
   * Hien thong bao dung cho hai loi CO SO tra ve tu server. Tra ve true neu da
   * xu ly (goi khong can hien loi chung chung nua), false neu khong phai loi co so.
   */
  TKSNav.handleBranchError = function handleBranchError(payload){
    if(!payload || !payload.code) return false;
    if(payload.code === 'BRANCH_UNASSIGNED'){
      TKSNav.showBranchBanner(payload.error || 'Tài khoản chưa được gán cơ sở. Liên hệ Quản lý để được cấp quyền.');
      return true;
    }
    if(payload.code === 'BRANCH_NOT_CONFIGURED'){
      TKSNav.showBranchBanner(payload.error || 'Cơ sở này chưa được cấu hình nguồn dữ liệu.');
      return true;
    }
    return false;
  };

  TKSNav.showBranchBanner = function showBranchBanner(message){
    var banner = document.getElementById('tksBranchBanner');
    if(!banner){
      banner = document.createElement('div');
      banner.id = 'tksBranchBanner';
      banner.className = 'tks-branch-banner';
      banner.setAttribute('role', 'status');
      document.body.insertBefore(banner, document.body.firstChild);
    }
    banner.textContent = message;
    banner.hidden = false;
  };

  function escapeHtml(value){
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ---------- Nhom sidebar co the mo/dong (vd: "Quan ly nhan su"), nho trang thai qua lan tai lai ----------
  var NAV_GROUP_STORAGE_PREFIX = 'tks-dashboard-nav-group-';

  TKSNav._isNavGroupOpen = function _isNavGroupOpen(key){
    try{ return localStorage.getItem(NAV_GROUP_STORAGE_PREFIX + key) === 'open'; }
    catch(err){ return false; }
  };

  document.addEventListener('click', function(e){
    var toggle = e.target.closest && e.target.closest('[data-tks-nav-group]');
    if(!toggle) return;
    var key = toggle.dataset.tksNavGroup;
    var list = document.getElementById(toggle.getAttribute('aria-controls'));
    if(!list) return;
    var expanded = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(expanded));
    list.hidden = !expanded;
    try{ localStorage.setItem(NAV_GROUP_STORAGE_PREFIX + key, expanded ? 'open' : 'closed'); }
    catch(err){}
  });

  // Tự động nạp hiệu ứng sao băng nền dùng chung cho mọi trang
  if(typeof document !== 'undefined' && !window.__TKS_SHOOTING_STAR_INITIALIZED__){
    var starScript = document.createElement('script');
    starScript.src = '/shared/shooting-star.js?v=20260830';
    starScript.defer = true;
    document.head.appendChild(starScript);
  }

  window.TKSNav = TKSNav;
})();
