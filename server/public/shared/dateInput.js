/*
 * Chuyen tat ca <input type="date"> sang hien thi dd/mm/yyyy.
 *
 * Ly do can file nay: dinh dang hien thi cua input[type=date] do CHINH TRINH
 * DUYET/HE DIEU HANH cua nguoi dung quyet dinh (khong phai do trang web, khong
 * phai do thuoc tinh lang) — Chrome/Edge/Firefox deu lay theo locale OS. Vi vay
 * khong the chi sua CSS/HTML de ep dd/mm/yyyy cho moi nguoi dung; phai thay the
 * bang mot o nhap van ban co dinh dang rieng + lich chon ngay.
 *
 * De khong phai sua lai tung noi dang doc/ghi input.value (luon ky vong chuoi
 * ISO yyyy-mm-dd giong input[type=date] goc), thuoc tinh `value` cua chinh
 * phan tu <input> duoc ghi de: getter/setter lam viec voi ISO, con van ban
 * hien thi thuc su tren man hinh la dd/mm/yyyy.
 */
(function () {
  'use strict';

  function pad2(n) { return String(n).padStart(2, '0'); }

  function isoFromParts(d, m, y) { return y + '-' + pad2(m) + '-' + pad2(d); }

  function partsFromIso(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return null;
    return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  }

  function dmyFromIso(iso) {
    var p = partsFromIso(iso);
    if (!p) return '';
    return pad2(p.d) + '/' + pad2(p.m) + '/' + p.y;
  }

  function isValidDate(y, m, d) {
    if (!y || !m || !d) return false;
    var dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }

  function isoToday() {
    var t = new Date();
    return isoFromParts(t.getDate(), t.getMonth() + 1, t.getFullYear());
  }

  var CAL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" width="14" height="14">' +
    '<rect x="3" y="4" width="18" height="18" rx="2"></rect>' +
    '<path d="M16 2v4M8 2v4M3 10h18"></path></svg>';

  var nativeValueDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

  function buildCalendar(input, wrap, getIso, setIso) {
    var viewY, viewM;
    var popup = document.createElement('div');
    popup.className = 'dmy-calendar-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-hidden', 'true');
    document.body.appendChild(popup);

    var WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

    function render() {
      var todayP = partsFromIso(isoToday());
      var selP = partsFromIso(getIso());
      var startWeekday = (new Date(viewY, viewM - 1, 1).getDay() + 6) % 7;
      var daysInMonth = new Date(viewY, viewM, 0).getDate();
      var daysInPrevMonth = new Date(viewY, viewM - 1, 0).getDate();
      var html = '';

      html += '<div class="dmy-cal-head">';
      html += '<button type="button" class="dmy-cal-nav" data-nav="-1" aria-label="Thang truoc">&#8249;</button>';
      html += '<span class="dmy-cal-title">Thang ' + viewM + '/' + viewY + '</span>';
      html += '<button type="button" class="dmy-cal-nav" data-nav="1" aria-label="Thang sau">&#8250;</button>';
      html += '</div>';

      html += '<div class="dmy-cal-grid dmy-cal-weekdays">';
      for (var w = 0; w < 7; w++) html += '<span>' + WEEKDAYS[w] + '</span>';
      html += '</div>';

      html += '<div class="dmy-cal-grid dmy-cal-days">';
      for (var i = 0; i < startWeekday; i++) {
        html += '<button type="button" class="dmy-cal-day dmy-cal-outside" tabindex="-1" disabled>' +
          (daysInPrevMonth - startWeekday + 1 + i) + '</button>';
      }
      for (var d = 1; d <= daysInMonth; d++) {
        var isToday = todayP && todayP.y === viewY && todayP.m === viewM && todayP.d === d;
        var isSel = selP && selP.y === viewY && selP.m === viewM && selP.d === d;
        html += '<button type="button" class="dmy-cal-day' + (isToday ? ' dmy-cal-today' : '') +
          (isSel ? ' dmy-cal-selected' : '') + '" data-day="' + d + '">' + d + '</button>';
      }
      var totalCells = startWeekday + daysInMonth;
      var trailing = (7 - (totalCells % 7)) % 7;
      for (var j = 1; j <= trailing; j++) {
        html += '<button type="button" class="dmy-cal-day dmy-cal-outside" tabindex="-1" disabled>' + j + '</button>';
      }
      html += '</div>';

      html += '<div class="dmy-cal-foot">';
      html += '<button type="button" class="dmy-cal-link" data-action="today">Hom nay</button>';
      html += '<button type="button" class="dmy-cal-link" data-action="clear">Xoa</button>';
      html += '</div>';

      popup.innerHTML = html;
    }

    function position() {
      var r = input.getBoundingClientRect();
      popup.style.left = Math.round(r.left + window.scrollX) + 'px';
      popup.style.top = Math.round(r.bottom + window.scrollY + 4) + 'px';
      var popRect = popup.getBoundingClientRect();
      if (popRect.right > window.innerWidth) {
        popup.style.left = Math.max(4, Math.round(window.innerWidth - popRect.width - 8)) + 'px';
      }
    }

    function onDocMouseDown(e) {
      if (popup.contains(e.target) || wrap.contains(e.target)) return;
      close();
    }

    function onDocKeyDown(e) {
      if (e.key === 'Escape') { close(); input.focus(); }
    }

    function open() {
      if (popup.classList.contains('open')) return;
      var cur = partsFromIso(getIso()) || partsFromIso(isoToday());
      viewY = cur.y;
      viewM = cur.m;
      render();
      popup.classList.add('open');
      popup.setAttribute('aria-hidden', 'false');
      position();
      document.addEventListener('mousedown', onDocMouseDown, true);
      document.addEventListener('keydown', onDocKeyDown, true);
      window.addEventListener('scroll', position, true);
      window.addEventListener('resize', position);
    }

    function close() {
      if (!popup.classList.contains('open')) return;
      popup.classList.remove('open');
      popup.setAttribute('aria-hidden', 'true');
      document.removeEventListener('mousedown', onDocMouseDown, true);
      document.removeEventListener('keydown', onDocKeyDown, true);
      window.removeEventListener('scroll', position, true);
      window.removeEventListener('resize', position);
    }

    popup.addEventListener('click', function (e) {
      var dayBtn = e.target.closest('.dmy-cal-day:not([disabled])');
      if (dayBtn) {
        setIso(isoFromParts(Number(dayBtn.dataset.day), viewM, viewY), { fireChange: true });
        close();
        return;
      }
      var navBtn = e.target.closest('.dmy-cal-nav');
      if (navBtn) {
        var dir = Number(navBtn.dataset.nav);
        viewM += dir;
        if (viewM < 1) { viewM = 12; viewY--; }
        if (viewM > 12) { viewM = 1; viewY++; }
        render();
        return;
      }
      var action = e.target.closest('[data-action]');
      if (action) {
        if (action.dataset.action === 'today') setIso(isoToday(), { fireChange: true });
        else if (action.dataset.action === 'clear') setIso('', { fireChange: true });
        close();
      }
    });

    return { open: open, close: close };
  }

  function enhance(input) {
    if (input.dataset.dmyEnhanced) return;
    input.dataset.dmyEnhanced = '1';

    var initialIso = nativeValueDesc.get.call(input) || '';
    var isoValue = '';

    input.type = 'text';
    input.setAttribute('inputmode', 'numeric');
    input.setAttribute('autocomplete', 'off');
    if (!input.getAttribute('placeholder')) input.setAttribute('placeholder', 'dd/mm/yyyy');
    input.setAttribute('maxlength', '10');
    input.classList.add('dmy-date-input');

    var wrap = document.createElement('span');
    wrap.className = 'dmy-date-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'dmy-date-trigger';
    trigger.setAttribute('aria-label', 'Chon ngay');
    trigger.tabIndex = -1;
    trigger.innerHTML = CAL_SVG;
    wrap.appendChild(trigger);

    function setNativeText(str) { nativeValueDesc.set.call(input, str); }
    function getNativeText() { return nativeValueDesc.get.call(input); }

    function setIso(iso, opts) {
      opts = opts || {};
      isoValue = iso || '';
      setNativeText(isoValue ? dmyFromIso(isoValue) : '');
      if (opts.fireChange) {
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    Object.defineProperty(input, 'value', {
      get: function () { return isoValue; },
      set: function (v) { setIso(v); },
      configurable: true
    });

    if (initialIso) setIso(initialIso);

    var calendar = buildCalendar(input, wrap, function () { return isoValue; }, setIso);

    input.addEventListener('input', function () {
      var digits = getNativeText().replace(/\D/g, '').slice(0, 8);
      var formatted = digits;
      if (digits.length > 4) formatted = digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4);
      else if (digits.length > 2) formatted = digits.slice(0, 2) + '/' + digits.slice(2);
      setNativeText(formatted);
      if (digits.length === 8) {
        var day = Number(digits.slice(0, 2));
        var month = Number(digits.slice(2, 4));
        var year = Number(digits.slice(4, 8));
        if (isValidDate(year, month, day)) {
          isoValue = isoFromParts(day, month, year);
          input.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          isoValue = '';
        }
      } else {
        isoValue = '';
      }
    });

    input.addEventListener('focus', function () { calendar.open(); });
    trigger.addEventListener('click', function () { input.focus(); calendar.open(); });
  }

  function enhanceAll(root) {
    (root || document).querySelectorAll('input[type="date"]').forEach(enhance);
  }

  enhanceAll(document);
  window.TKSDateInput = { enhanceAll: enhanceAll };
})();
