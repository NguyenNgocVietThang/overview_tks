// ==========================================
// SHARED-NAV.JS — auth guard + user chip + logout dung chung cho moi trang.
// RANH GIOI BAO MAT THAT SU nam o server (authMiddleware tren /api/*) — script
// nay CHI de dieu huong UX (an noi dung/redirect ve /login/ khi chua dang nhap),
// khong phai lop bao ve du lieu.
// ==========================================
(function(){
  'use strict';

  var TKSNav = {};

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
        var path = window.location.pathname.replace(/\/index\.html$/, '').replace(/\/$/, '') || '/';
        var isGuestAllowed = (path === '/shipment' || path === '/account');
        if(user.vaiTro === 'Khách' && !isGuestAllowed){
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
        return new Promise(function(){});
      });
  };

  TKSNav.logout = function logout(){
    if(!window.confirm('Bạn có chắc chắn muốn đăng xuất?')){
      return Promise.resolve(false);
    }
    return fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
      .finally(function(){ window.location.href = '/login/'; });
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
      '</button>';
    mount.querySelector('.name').textContent = user.hoTen || user.username;
    mount.querySelector('.role').textContent = user.vaiTro || '';
    mount.querySelector('#tksProfileTrigger').addEventListener('click', function(){
      window.location.href = '/account/';
    });
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
              '<label class="tks-field"><span>Số điện thoại chính</span><input type="tel" id="tksProfilePhone" maxlength="12" placeholder="vd: 0912345678"></label>' +
              '<label class="tks-field"><span>Email khôi phục</span><input type="email" id="tksProfileRecoveryEmail" maxlength="254" placeholder="vd: recovery@domain.com"></label>' +
              '<label class="tks-field"><span>Số điện thoại khôi phục</span><input type="tel" id="tksProfileRecoveryPhone" maxlength="12" placeholder="vd: 0987654321"></label>' +
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
      phone: overlay.querySelector('#tksProfilePhone'),
      recoveryEmail: overlay.querySelector('#tksProfileRecoveryEmail'),
      recoveryPhone: overlay.querySelector('#tksProfileRecoveryPhone'),
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
      el.textContent = msg;
      el.hidden = !msg;
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
          alert('Đã cập nhật thông tin cá nhân thành công!');
        })
        .catch(function(){ showError(els.profileError, 'Không cập nhật được hồ sơ, vui lòng thử lại.'); })
        .finally(function(){ els.saveBtn.disabled = false; });
    });

    els.recoverySaveBtn.addEventListener('click', function(){
      showError(els.recoveryError, '');
      var soDienThoai = els.phone.value.trim();
      var emailKhoiPhuc = els.recoveryEmail.value.trim();
      var sdtKhoiPhuc = els.recoveryPhone.value.trim();
      var matKhauXacNhan = els.recoveryConfirmPassword.value;

      els.recoverySaveBtn.disabled = true;
      fetch('/api/auth/recovery', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          soDienThoai: soDienThoai,
          emailKhoiPhuc: emailKhoiPhuc,
          sdtKhoiPhuc: sdtKhoiPhuc,
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
          alert('Đã cập nhật thông tin liên hệ và khôi phục thành công!');
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
          showError(els.passwordError, '');
          alert('Đổi mật khẩu thành công!');
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
        els.phone.value = profile.soDienThoai || '';
        els.recoveryEmail.value = profile.emailKhoiPhuc || '';
        els.recoveryPhone.value = profile.sdtKhoiPhuc || '';
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
   * Render sidebar 3 muc cap cao nhat
   */
  TKSNav.renderTopSidebar = function renderTopSidebar(mountEl, activeTop, user){
    if(!mountEl) return;
    mountEl.dataset.tksActiveTop = activeTop;
    var reportsActive = activeTop === 'reports';
    var shipmentActive = activeTop === 'shipment';
    var accountActive = activeTop === 'account';
    var reportsLink = user && user.vaiTro === 'Khách' ? '' :
      '<a href="/" class="nav-item' + (reportsActive ? ' active' : '') + '"' +
        (reportsActive ? ' aria-current="page"' : '') + '>' +
        '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="8" y1="18" x2="8" y2="14"></line><line x1="16" y1="18" x2="16" y2="16"></line></svg>' +
        'Báo cáo tổng hợp</a>';
    var shipmentLink =
      '<a href="/shipment/" class="nav-item' + (shipmentActive ? ' active' : '') + '"' +
        (shipmentActive ? ' aria-current="page"' : '') + '>' +
        '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"></path><path d="M15 18H9"></path><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"></path><circle cx="17" cy="18" r="2"></circle><circle cx="7" cy="18" r="2"></circle></svg>' +
        'Quản lý vận chuyển</a>';
    var accountLink =
      '<a href="/account/" class="nav-item' + (accountActive ? ' active' : '') + '"' +
        (accountActive ? ' aria-current="page"' : '') + '>' +
        '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>' +
        'Quản lý tài khoản</a>';
    mountEl.innerHTML = reportsLink + shipmentLink + accountLink;
  };

  window.TKSNav = TKSNav;
})();
