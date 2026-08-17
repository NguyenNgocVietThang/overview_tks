// ==========================================
// SHARED-NAV.JS — auth guard + user chip + logout dung chung cho moi trang.
// RANH GIOI BAO MAT THAT SU nam o server (authMiddleware tren /api/*) — script
// nay CHI de dieu huong UX (an noi dung/redirect ve /login/ khi chua dang nhap),
// khong phai lop bao ve du lieu.
// ==========================================
(function(){
  'use strict';

  var TKSNav = {};

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
        if(user.vaiTro === 'Khách' && window.location.pathname !== '/shipment/' && window.location.pathname !== '/shipment'){
          window.location.href = '/shipment/';
          return new Promise(function(){});
        }
        var sidebar = document.getElementById('sidebar');
        if(sidebar && sidebar.dataset.tksActiveTop){
          TKSNav.renderTopSidebar(sidebar, sidebar.dataset.tksActiveTop, user);
        }
        document.documentElement.style.visibility = '';
        TKSNav.renderAccountChip(user);
        return user;
      })
      .catch(function(){
        var next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = '/login/?next=' + next;
        // Promise khong bao gio resolve — trang dang dieu huong di.
        return new Promise(function(){});
      });
  };

  TKSNav.logout = function logout(){
    return fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
      .finally(function(){ window.location.href = '/login/'; });
  };

  /**
   * Render 1 the nho hien ten/vai tro + nut dang xuat vao phan tu co
   * id="accountChip" (neu trang co san cho). Trang nao khong co thi bo qua.
   */
  TKSNav.renderAccountChip = function renderAccountChip(user){
    var mount = document.getElementById('accountChip');
    if(!mount) return;
    mount.innerHTML =
      '<span class="who"><span class="name"></span><span class="role"></span></span>' +
      '<button type="button" class="logout-btn">Đăng xuất</button>';
    mount.querySelector('.name').textContent = user.hoTen || user.username;
    mount.querySelector('.role').textContent = user.vaiTro || '';
    mount.querySelector('.logout-btn').addEventListener('click', TKSNav.logout);
  };

  /**
   * Render sidebar 2 muc cap cao nhat (Bao cao tong hop / Quan ly van chuyen)
   * cho cac trang MOI (vd shipment/index.html). index.html hien tai co sidebar
   * rieng (tich hop voi switchView()) nen KHONG dung ham nay.
   * @param {string} activeTop 'reports' | 'shipment'
   */
  TKSNav.renderTopSidebar = function renderTopSidebar(mountEl, activeTop, user){
    if(!mountEl) return;
    mountEl.dataset.tksActiveTop = activeTop;
    var reportsActive = activeTop === 'reports';
    var shipmentActive = activeTop === 'shipment';
    var reportsLink = user && user.vaiTro === 'Khách' ? '' :
      '<a href="/" class="nav-item' + (reportsActive ? ' active' : '') + '"' +
        (reportsActive ? ' aria-current="page"' : '') + '>' +
        '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="7" height="9" x="3" y="3" rx="1"></rect><rect width="7" height="5" x="14" y="3" rx="1"></rect><rect width="7" height="9" x="14" y="12" rx="1"></rect><rect width="7" height="5" x="3" y="16" rx="1"></rect></svg>' +
        'Báo cáo tổng hợp</a>';
    mountEl.innerHTML = reportsLink +
      '<a href="/shipment/" class="nav-item' + (shipmentActive ? ' active' : '') + '"' +
        (shipmentActive ? ' aria-current="page"' : '') + '>' +
        '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"></path><path d="M15 18H9"></path><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"></path><circle cx="17" cy="18" r="2"></circle><circle cx="7" cy="18" r="2"></circle></svg>' +
        'Quản lý vận chuyển</a>';
  };

  window.TKSNav = TKSNav;
})();
