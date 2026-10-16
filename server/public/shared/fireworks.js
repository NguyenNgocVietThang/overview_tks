/**
 * ============================================================================
 * FIREWORKS ENGINE — TOKOSI DASHBOARD
 * Pháo hoa thay hiệu ứng sao băng vào các ngày đặc biệt (ngày lễ, sinh nhật —
 * xem special-days.js). Dùng lại canvas #shooting-star-canvas của shooting-star.js:
 * cùng tầng nền (z-index: 0, pointer-events: none), không đè lên panel/bảng.
 *
 * Mỗi lần click: rocket bay từ mép dưới lên điểm click rồi nổ, mỗi lần một bảng
 * màu và một kiểu nổ khác nhau. Không dùng shadowBlur; vòng lặp rAF tự dừng khi
 * hết hạt và tôn trọng prefers-reduced-motion.
 * ============================================================================
 */
(function (root) {
  'use strict';

  var MAX_PARTICLES = 900;
  var MAX_ROCKETS = 6;
  var MAX_FLASHES = 6;

  // Bảng màu: danh sách hue (0-360) + độ bão hòa. Mỗi lần nổ chọn 1 bảng khác lần trước.
  var PALETTES = [
    { name: 'ruby-gold', hues: [0, 8, 18, 42, 50], sat: 95 },
    { name: 'ocean', hues: [190, 200, 215, 225], sat: 95 },
    { name: 'orchid', hues: [285, 300, 320, 335], sat: 90 },
    { name: 'emerald', hues: [120, 140, 155, 170], sat: 85 },
    { name: 'rainbow', hues: [0, 50, 120, 190, 260, 320], sat: 95 },
    { name: 'champagne', hues: [38, 45, 52], sat: 100 },
    { name: 'sunset', hues: [8, 22, 35, 330], sat: 95 }
  ];

  var PATTERNS = ['sphere', 'sphere', 'ring', 'willow', 'heart', 'double'];

  function rand(min, max) { return min + Math.random() * (max - min); }
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function mount(opts) {
    opts = opts || {};
    var canvas = opts.canvas;
    var ctx = opts.ctx || canvas.getContext('2d');
    var isInteractiveControl = opts.isInteractiveControl || function () { return false; };
    var raf = opts.raf || function (fn) { return root.requestAnimationFrame(fn); };

    var rockets = [];
    var particles = [];
    var flashes = [];
    var running = false;
    var lastTime = null;
    var lastPalette = -1;
    var lastTriggerTime = 0;

    function viewport() {
      var dpr = root.devicePixelRatio || 1;
      return { w: canvas.width / dpr, h: canvas.height / dpr, dpr: dpr };
    }

    function isReducedMotion() {
      try {
        return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
      } catch (e) {
        return false;
      }
    }

    function isLightTheme() {
      var el = root.document && root.document.documentElement;
      return !!el && el.getAttribute('data-theme') === 'light';
    }

    function pickPalette() {
      var idx;
      do { idx = Math.floor(Math.random() * PALETTES.length); } while (idx === lastPalette && PALETTES.length > 1);
      lastPalette = idx;
      return PALETTES[idx];
    }

    function hsla(h, s, l, a) {
      return 'hsla(' + Math.round(h) + ',' + s + '%,' + l + '%,' + a.toFixed(3) + ')';
    }

    function addParticle(x, y, vx, vy, hue, sat, o) {
      if (particles.length >= MAX_PARTICLES) return;
      particles.push({
        x: x, y: y, vx: vx, vy: vy,
        hue: hue, sat: sat,
        age: 0,
        life: o.life,
        size: o.size,
        drag: o.drag,
        gravity: o.gravity,
        streak: o.streak,
        glitter: !!o.glitter
      });
    }

    // ---- Các kiểu nổ -------------------------------------------------------
    function explode(x, y, scale, reduced) {
      var palette = pickPalette();
      var pattern = pick(PATTERNS);
      var count = reduced ? 28 : 1;
      var base = rand(260, 380) * scale;
      var hue;
      var i;

      function hueOf(k) { return palette.hues[k % palette.hues.length] + rand(-6, 6); }
      function common(extra) {
        var o = { life: rand(1.2, 1.9), size: rand(2.3, 3.4) * Math.max(scale, 0.8), drag: 1.35, gravity: 90, streak: 0.04, glitter: !reduced };
        for (var k in extra) o[k] = extra[k];
        if (reduced) { o.life = 0.9; o.streak = 0; o.glitter = false; }
        return o;
      }

      if (reduced) {
        for (i = 0; i < count; i++) {
          var ra = (i / count) * Math.PI * 2;
          addParticle(x, y, Math.cos(ra) * base * 0.8, Math.sin(ra) * base * 0.8, hueOf(i), palette.sat, common({}));
        }
        flashes.push({ x: x, y: y, hue: palette.hues[0], age: 0, life: 0.18, radius: 90 * scale });
        return;
      }

      if (pattern === 'sphere') {
        count = Math.round(rand(110, 140));
        for (i = 0; i < count; i++) {
          var a = Math.random() * Math.PI * 2;
          var sp = base * (0.5 + 0.5 * Math.random());
          addParticle(x, y, Math.cos(a) * sp, Math.sin(a) * sp, hueOf(i), palette.sat, common({}));
        }
      } else if (pattern === 'ring') {
        count = 80;
        var tilt = rand(0.35, 1);
        var rot = rand(0, Math.PI);
        hue = hueOf(0);
        for (i = 0; i < count; i++) {
          var ar = (i / count) * Math.PI * 2;
          var rx = Math.cos(ar) * base;
          var ry = Math.sin(ar) * base * tilt;
          addParticle(x, y,
            rx * Math.cos(rot) - ry * Math.sin(rot),
            rx * Math.sin(rot) + ry * Math.cos(rot),
            hue + (i % 2 ? 12 : 0), palette.sat, common({ life: rand(1.3, 1.8), drag: 1.15 }));
        }
      } else if (pattern === 'willow') {
        count = 90;
        hue = pick([38, 45, 50]);
        for (i = 0; i < count; i++) {
          var aw = Math.random() * Math.PI * 2;
          var sw = base * rand(0.3, 0.6);
          addParticle(x, y, Math.cos(aw) * sw, Math.sin(aw) * sw, hue + rand(-5, 5), 100,
            common({ life: rand(2.2, 3.0), drag: 0.9, gravity: 130, streak: 0.07, size: rand(1.9, 2.6) }));
        }
      } else if (pattern === 'heart') {
        count = 72;
        hue = pick([345, 350, 0, 330]);
        var k = base * 0.8 / 17;
        for (i = 0; i < count; i++) {
          var t = (i / count) * Math.PI * 2;
          var hx = 16 * Math.pow(Math.sin(t), 3);
          var hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
          addParticle(x, y, hx * k, hy * k, hue + rand(-6, 6), 95, common({ life: rand(1.4, 1.9), drag: 1.5, gravity: 50 }));
        }
      } else { // double: cầu lớn + vòng nhỏ khác màu
        var inner = pickPalette();
        count = 80;
        for (i = 0; i < count; i++) {
          var ad = Math.random() * Math.PI * 2;
          var sd = base * (0.75 + 0.25 * Math.random());
          addParticle(x, y, Math.cos(ad) * sd, Math.sin(ad) * sd, hueOf(i), palette.sat, common({}));
        }
        for (i = 0; i < 48; i++) {
          var ai = (i / 48) * Math.PI * 2;
          addParticle(x, y, Math.cos(ai) * base * 0.42, Math.sin(ai) * base * 0.42,
            inner.hues[i % inner.hues.length], inner.sat, common({ life: rand(0.9, 1.3) }));
        }
      }

      if (flashes.length < MAX_FLASHES) {
        flashes.push({ x: x, y: y, hue: palette.hues[0], age: 0, life: 0.28, radius: 260 * scale });
      }
    }

    function fire(targetX, targetY) {
      if (rockets.length >= MAX_ROCKETS) return;
      var vp = viewport();
      var reduced = isReducedMotion();
      var scale = clamp(Math.min(vp.w, vp.h) / 900, 0.6, 1.1);
      var tx = clamp(targetX, 20, Math.max(vp.w - 20, 20));
      var ty = clamp(targetY, 20, Math.max(vp.h - 20, 20));

      if (reduced) {
        explode(tx, ty, scale, true);
        ensureLoop();
        return;
      }

      var sx = clamp(tx + rand(-50, 50), 10, Math.max(vp.w - 10, 10));
      var sy = vp.h + 10;
      var dist = Math.sqrt((tx - sx) * (tx - sx) + (ty - sy) * (ty - sy));
      rockets.push({
        sx: sx, sy: sy, tx: tx, ty: ty,
        x: sx, y: sy,
        age: 0,
        life: clamp(dist / 1000, 0.3, 0.85),
        scale: scale,
        sparkTimer: 0
      });
      ensureLoop();
    }

    // ---- Vòng lặp ---------------------------------------------------------
    function ensureLoop() {
      if (running) return;
      running = true;
      lastTime = null;
      raf(loop);
    }

    function loop(ts) {
      if (lastTime === null) lastTime = ts;
      var dt = clamp((ts - lastTime) / 1000, 0, 0.05);
      lastTime = ts;

      var vp = viewport();
      var light = isLightTheme();
      var i;

      ctx.save();
      ctx.scale(vp.dpr, vp.dpr);
      ctx.clearRect(0, 0, vp.w, vp.h);
      // Nền tối: cộng sáng cho rực; nền sáng: vẽ thường với màu đậm hơn.
      ctx.globalCompositeOperation = light ? 'source-over' : 'lighter';
      ctx.lineCap = 'round';
      var lightness = light ? 48 : 62;

      // Quầng sáng khi nổ
      for (i = flashes.length - 1; i >= 0; i--) {
        var f = flashes[i];
        f.age += dt;
        if (f.age >= f.life) { flashes.splice(i, 1); continue; }
        var fa = (1 - f.age / f.life) * (light ? 0.16 : 0.28);
        var g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.radius);
        g.addColorStop(0, hsla(f.hue, 100, light ? 55 : 70, fa));
        g.addColorStop(1, hsla(f.hue, 100, light ? 55 : 70, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // Rocket đang bay lên
      for (i = rockets.length - 1; i >= 0; i--) {
        var r = rockets[i];
        r.age += dt;
        var p = clamp(r.age / r.life, 0, 1);
        var e = 1 - Math.pow(1 - p, 2); // ease-out: nhanh rồi chậm dần khi tới đích
        var px = r.x;
        var py = r.y;
        r.x = r.sx + (r.tx - r.sx) * e;
        r.y = r.sy + (r.ty - r.sy) * e;

        r.sparkTimer += dt;
        if (r.sparkTimer > 0.03) {
          r.sparkTimer = 0;
          addParticle(r.x, r.y, rand(-14, 14), rand(10, 40), rand(30, 50), 100,
            { life: rand(0.25, 0.45), size: rand(1, 1.6), drag: 1, gravity: 80, streak: 0, glitter: false });
        }

        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(r.x, r.y);
        ctx.lineWidth = 2.4;
        ctx.strokeStyle = light ? hsla(35, 100, 45, 0.9) : hsla(45, 100, 85, 0.95);
        ctx.stroke();

        if (p >= 1) {
          rockets.splice(i, 1);
          explode(r.tx, r.ty, r.scale, false);
        }
      }

      // Hạt pháo hoa
      for (i = particles.length - 1; i >= 0; i--) {
        var pt = particles[i];
        pt.age += dt;
        if (pt.age >= pt.life) { particles.splice(i, 1); continue; }
        var damp = Math.max(0, 1 - pt.drag * dt);
        pt.vx *= damp;
        pt.vy = pt.vy * damp + pt.gravity * dt;
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;

        var t = pt.age / pt.life;
        var alpha = Math.pow(1 - t, 1.3);
        if (pt.glitter && t > 0.7 && Math.random() < 0.4) alpha *= 0.35; // lấp lánh lúc tàn
        var tailX = pt.x - pt.vx * pt.streak;
        var tailY = pt.y - pt.vy * pt.streak;
        var width = pt.size * (0.6 + 0.4 * (1 - t));
        ctx.beginPath();
        ctx.moveTo(tailX, tailY);
        ctx.lineTo(pt.x, pt.y);
        // Quầng sáng mờ (nét rộng) rồi lõi sáng: thay cho shadowBlur vốn rất tốn.
        ctx.lineWidth = width * 3;
        ctx.strokeStyle = hsla(pt.hue, pt.sat, lightness, alpha * 0.22);
        ctx.stroke();
        ctx.lineWidth = width;
        ctx.strokeStyle = hsla(pt.hue, pt.sat, light ? lightness : lightness + 14, alpha);
        ctx.stroke();
      }

      ctx.restore();

      if (rockets.length || particles.length || flashes.length) {
        raf(loop);
      } else {
        running = false; // hết hiệu ứng: dừng hẳn, không tốn CPU khi nhàn rỗi
      }
    }

    // ---- Điều khiển bằng click --------------------------------------------
    function handleTrigger(clientX, clientY, target) {
      var now = Date.now();
      if (now - lastTriggerTime < 100) return; // tránh double trigger pointer + touch + click
      lastTriggerTime = now;
      if (isInteractiveControl(target)) return;
      fire(clientX, clientY);
    }

    function onPointerDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      handleTrigger(e.clientX, e.clientY, e.target);
    }
    root.document.addEventListener('pointerdown', onPointerDown);

    // Chùm chào mừng 1 giây sau khi tải trang (tương ứng sao băng chào mừng).
    var welcomeTimer = root.setTimeout(function () {
      var vp = viewport();
      fire(vp.w * 0.25, vp.h * 0.28);
    }, 1000);

    function stop() {
      root.document.removeEventListener('pointerdown', onPointerDown);
      root.clearTimeout(welcomeTimer);
      rockets.length = 0;
      particles.length = 0;
      flashes.length = 0;
    }

    return {
      fire: fire,
      stop: stop,
      _state: function () {
        return { rockets: rockets.length, particles: particles.length, flashes: flashes.length, running: running };
      }
    };
  }

  root.TKSFireworks = { mount: mount, PALETTES: PALETTES, PATTERNS: PATTERNS };
})(typeof window !== 'undefined' ? window : this);
