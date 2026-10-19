/**
 * ============================================================================
 * FIREWORKS ENGINE — TOKOSI DASHBOARD
 * Pháo hoa thay hiệu ứng sao băng vào các ngày đặc biệt (ngày lễ, sinh nhật —
 * xem special-days.js). Dùng lại canvas #shooting-star-canvas của shooting-star.js:
 * cùng tầng nền (z-index: 0, pointer-events: none), không đè lên panel/bảng.
 *
 * Mỗi lần click: rocket bay từ mép dưới lên điểm click rồi nổ. Mỗi lần một bảng
 * màu và một kiểu nổ khác nhau (PATTERNS), trong đó có các kiểu nổ 2 cấp:
 *   - crossette: mỗi tia tách tiếp thành 4 tia hình chữ thập
 *   - bloom:     mỗi tia nổ tiếp thành chùm pháo nhỏ khác màu
 *   - crackle:   tia tàn nổ lách tách những đốm trắng
 *   - twin:      quả đầu nổ xong, tâm nổ thêm quả thứ hai khác màu/khác hình
 * Không dùng shadowBlur; vòng lặp rAF tự dừng khi hết hạt và tôn trọng
 * prefers-reduced-motion.
 * ============================================================================
 */
(function (root) {
  'use strict';

  var MAX_PARTICLES = 1400;
  var MAX_ROCKETS = 6;
  var MAX_FLASHES = 10;

  // Bảng màu: danh sách hue (0-360) + độ bão hòa. Mỗi lần nổ chọn 1 bảng khác lần trước.
  var PALETTES = [
    { name: 'ruby-gold', hues: [0, 8, 18, 42, 50], sat: 95 },
    { name: 'ocean', hues: [185, 200, 215, 228], sat: 95 },
    { name: 'orchid', hues: [285, 300, 320, 335], sat: 90 },
    { name: 'emerald', hues: [120, 140, 155, 170], sat: 85 },
    { name: 'rainbow', hues: [0, 40, 60, 120, 190, 260, 320], sat: 95 },
    { name: 'champagne', hues: [38, 45, 52], sat: 100 },
    { name: 'sunset', hues: [8, 22, 35, 330, 345], sat: 95 },
    { name: 'neon', hues: [160, 180, 300, 320, 70], sat: 100 },
    { name: 'candy', hues: [330, 180, 50, 280, 140], sat: 92 },
    { name: 'aurora', hues: [150, 170, 195, 265, 290], sat: 90 },
    { name: 'fire', hues: [0, 12, 24, 36, 48], sat: 100 },
    { name: 'sapphire-gold', hues: [215, 230, 245, 45, 52], sat: 96 }
  ];

  var PATTERNS = [
    'peony', 'peony', 'ring', 'willow', 'heart', 'double',
    'star', 'spiral', 'saturn', 'colorChange',
    'crossette', 'bloom', 'crackle', 'twin', 'palm'
  ];

  function rand(min, max) { return min + Math.random() * (max - min); }
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function sign() { return Math.random() < 0.5 ? -1 : 1; }

  function mount(opts) {
    opts = opts || {};
    var canvas = opts.canvas;
    var ctx = opts.ctx || canvas.getContext('2d');
    var isInteractiveControl = opts.isInteractiveControl || function () { return false; };
    var raf = opts.raf || function (fn) { return root.requestAnimationFrame(fn); };

    var rockets = [];
    var particles = [];
    var flashes = [];
    var timers = [];
    var welcomeTimers = [];
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
      return 'hsla(' + Math.round(h) + ',' + Math.round(s) + '%,' + l + '%,' + a.toFixed(3) + ')';
    }

    // Hẹn giờ theo thời gian của vòng lặp (dừng/chạy cùng canvas, không dùng setTimeout).
    function schedule(delay, fn) {
      timers.push({ t: delay, fn: fn });
      ensureLoop();
    }

    function addFlash(x, y, hue, life, radius) {
      if (flashes.length >= MAX_FLASHES) return;
      flashes.push({ x: x, y: y, hue: hue, age: 0, life: life, radius: radius });
    }

    function addParticle(x, y, vx, vy, hue, sat, o) {
      if (particles.length >= MAX_PARTICLES) return;
      particles.push({
        x: x, y: y, vx: vx, vy: vy,
        hue: hue, sat: sat,
        hue2: o.hue2,        // có giá trị: đổi màu dần từ hue sang hue2
        age: 0,
        life: o.life,
        size: o.size,
        drag: o.drag,
        gravity: o.gravity,
        streak: o.streak,
        glitter: !!o.glitter,
        trail: o.trail || 0, // >0: khoảng thời gian giữa 2 đốm lửa rơi theo sau
        trailT: 0,
        burst: o.burst || null // {at, kind, shift, scale}: nổ cấp 2 khi đủ tuổi
      });
    }

    // ---- Nổ cấp 2 ----------------------------------------------------------
    function miniBurst(x, y, hue, sat, kind, scale) {
      var i, n, a, sp;
      var s = Math.max(scale, 0.7);
      if (kind === 'pop') {
        n = 4;
        for (i = 0; i < n; i++) {
          a = Math.random() * Math.PI * 2;
          sp = rand(50, 120) * s;
          addParticle(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 50, 8,
            { life: rand(0.2, 0.36), size: rand(1.4, 2), drag: 2, gravity: 30, streak: 0, glitter: false });
        }
        addFlash(x, y, 50, 0.1, 34 * s);
      } else if (kind === 'cross') {
        var rot = rand(0, Math.PI);
        var speeds = [70, 115, 160];
        for (var arm = 0; arm < 4; arm++) {
          var ang = rot + arm * Math.PI / 2;
          for (i = 0; i < speeds.length; i++) {
            sp = speeds[i] * s;
            addParticle(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, hue + i * 14, sat,
              { life: rand(0.8, 1.15), size: rand(1.8, 2.5) * s, drag: 1.7, gravity: 60, streak: 0.05, glitter: true });
          }
        }
        addFlash(x, y, hue, 0.16, 70 * s);
      } else { // 'sphere'
        n = Math.round(rand(14, 20));
        for (i = 0; i < n; i++) {
          a = Math.random() * Math.PI * 2;
          sp = rand(90, 160) * s * (0.6 + 0.4 * Math.random());
          addParticle(x, y, Math.cos(a) * sp, Math.sin(a) * sp, hue + rand(-12, 12), sat,
            { life: rand(0.7, 1.15), size: rand(1.8, 2.6) * s, drag: 1.6, gravity: 70, streak: 0.04, glitter: true });
        }
        addFlash(x, y, hue, 0.2, 90 * s);
      }
    }

    // ---- Các kiểu nổ (c = {x, y, base, scale, palette}) ----------------------
    function hueOf(c, k) { return c.palette.hues[k % c.palette.hues.length] + rand(-6, 6); }
    function randomHue(c) { return pick(c.palette.hues) + rand(-6, 6); }
    function common(c, extra) {
      var o = {
        life: rand(1.2, 1.9), size: rand(2.3, 3.4) * Math.max(c.scale, 0.8),
        drag: 1.35, gravity: 90, streak: 0.04, glitter: true
      };
      for (var k in extra) o[k] = extra[k];
      return o;
    }
    // Tia "ngôi sao" của kiểu 2 cấp: bay ra, đi chậm rồi nổ tiếp.
    function shellStar(c, hue, vx, vy, burst) {
      addParticle(c.x, c.y, vx, vy, hue, c.palette.sat,
        common(c, { life: burst.at + 0.3, drag: 1.7, gravity: 40, streak: 0.06, size: rand(3, 4) * Math.max(c.scale, 0.8), trail: 0.05, burst: burst }));
    }

    var SHAPES = {
      // Cầu nhiều màu: mỗi tia một màu ngẫu nhiên trong bảng
      peony: function (c) {
        var n = Math.round(rand(130, 170));
        for (var i = 0; i < n; i++) {
          var a = Math.random() * Math.PI * 2;
          var sp = c.base * (0.45 + 0.55 * Math.sqrt(Math.random()));
          addParticle(c.x, c.y, Math.cos(a) * sp, Math.sin(a) * sp, randomHue(c), c.palette.sat, common(c, {}));
        }
      },
      // Đổi màu giữa chừng: bắt đầu một màu, tàn bằng màu khác
      colorChange: function (c) {
        var n = Math.round(rand(120, 150));
        var h1 = pick(c.palette.hues);
        var h2 = (h1 + rand(70, 150)) % 360;
        for (var i = 0; i < n; i++) {
          var a = Math.random() * Math.PI * 2;
          var sp = c.base * (0.5 + 0.5 * Math.random());
          addParticle(c.x, c.y, Math.cos(a) * sp, Math.sin(a) * sp, h1 + rand(-8, 8), c.palette.sat,
            common(c, { hue2: h2 + rand(-8, 8), life: rand(1.5, 2.1) }));
        }
      },
      ring: function (c) {
        var n = 90;
        var tilt = rand(0.3, 1);
        var rot = rand(0, Math.PI);
        var h1 = hueOf(c, 0);
        var h2 = hueOf(c, 2);
        for (var i = 0; i < n; i++) {
          var ar = (i / n) * Math.PI * 2;
          var rx = Math.cos(ar) * c.base;
          var ry = Math.sin(ar) * c.base * tilt;
          addParticle(c.x, c.y,
            rx * Math.cos(rot) - ry * Math.sin(rot),
            rx * Math.sin(rot) + ry * Math.cos(rot),
            i % 2 ? h2 : h1, c.palette.sat, common(c, { life: rand(1.3, 1.8), drag: 1.15 }));
        }
      },
      willow: function (c) {
        var n = 100;
        var hue = pick([38, 45, 50]);
        for (var i = 0; i < n; i++) {
          var aw = Math.random() * Math.PI * 2;
          var sw = c.base * rand(0.3, 0.6);
          addParticle(c.x, c.y, Math.cos(aw) * sw, Math.sin(aw) * sw, hue + rand(-5, 5), 100,
            common(c, { life: rand(2.3, 3.2), drag: 0.9, gravity: 130, streak: 0.07, size: rand(1.9, 2.6) }));
        }
      },
      heart: function (c) {
        var n = 76;
        var h1 = pick([345, 350, 0, 330]);
        var k = c.base * 0.8 / 17;
        for (var i = 0; i < n; i++) {
          var t = (i / n) * Math.PI * 2;
          var hx = 16 * Math.pow(Math.sin(t), 3);
          var hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
          addParticle(c.x, c.y, hx * k, hy * k, h1 + rand(-6, 6), 95, common(c, { life: rand(1.4, 1.9), drag: 1.5, gravity: 50 }));
        }
        // tâm trái tim lấp lánh
        for (var j = 0; j < 14; j++) {
          var ac = Math.random() * Math.PI * 2;
          var sc = c.base * rand(0.05, 0.3);
          addParticle(c.x, c.y, Math.cos(ac) * sc, Math.sin(ac) * sc, 45, 100, common(c, { life: rand(1.0, 1.5), drag: 1.5, gravity: 40, size: 2 }));
        }
      },
      // Hai lớp đồng tâm: cầu lớn + vòng nhỏ khác bảng màu
      double: function (c) {
        var inner = pickPalette();
        var i;
        for (i = 0; i < 90; i++) {
          var ad = Math.random() * Math.PI * 2;
          var sd = c.base * (0.75 + 0.25 * Math.random());
          addParticle(c.x, c.y, Math.cos(ad) * sd, Math.sin(ad) * sd, hueOf(c, i), c.palette.sat, common(c, {}));
        }
        for (i = 0; i < 54; i++) {
          var ai = (i / 54) * Math.PI * 2;
          addParticle(c.x, c.y, Math.cos(ai) * c.base * 0.42, Math.sin(ai) * c.base * 0.42,
            inner.hues[i % inner.hues.length], inner.sat, common(c, { life: rand(0.9, 1.3) }));
        }
      },
      // Ngôi sao 5 cánh, mỗi cạnh một màu
      star: function (c) {
        var R = c.base * 0.85;
        var r = R * 0.42;
        var per = 9;
        var rot = -Math.PI / 2 + rand(-0.35, 0.35);
        for (var e = 0; e < 10; e++) {
          var a1 = rot + e * Math.PI / 5;
          var a2 = rot + (e + 1) * Math.PI / 5;
          var r1 = e % 2 === 0 ? R : r;
          var r2 = e % 2 === 0 ? r : R;
          var x1 = Math.cos(a1) * r1, y1 = Math.sin(a1) * r1;
          var x2 = Math.cos(a2) * r2, y2 = Math.sin(a2) * r2;
          var hue = hueOf(c, Math.floor(e / 2));
          for (var k = 0; k < per; k++) {
            var f = k / per;
            addParticle(c.x, c.y, x1 + (x2 - x1) * f, y1 + (y2 - y1) * f, hue, c.palette.sat,
              common(c, { life: rand(1.4, 1.8), drag: 1.3, gravity: 40 }));
          }
        }
        for (var j = 0; j < 14; j++) {
          var ac = Math.random() * Math.PI * 2;
          var sc = c.base * rand(0.05, 0.3);
          addParticle(c.x, c.y, Math.cos(ac) * sc, Math.sin(ac) * sc, 48, 40, common(c, { life: rand(1.0, 1.5), drag: 1.3, gravity: 40, size: 2 }));
        }
      },
      // Xoáy ốc 3 nhánh
      spiral: function (c) {
        var per = 42;
        var turn = sign() * rand(1.2, 1.8) * Math.PI;
        var off = rand(0, Math.PI * 2);
        for (var arm = 0; arm < 3; arm++) {
          var hue = hueOf(c, arm);
          for (var i = 0; i < per; i++) {
            var f = i / per;
            var ang = off + arm * (Math.PI * 2 / 3) + f * turn;
            var sp = c.base * (0.18 + 0.82 * f);
            addParticle(c.x, c.y, Math.cos(ang) * sp, Math.sin(ang) * sp, hue + f * 24, c.palette.sat,
              common(c, { life: rand(1.4, 1.9), drag: 1.3, gravity: 50 }));
          }
        }
      },
      // Hành tinh: cầu lõi + vành nghiêng khác màu
      saturn: function (c) {
        var i;
        var h1 = hueOf(c, 0);
        var h2 = (h1 + rand(90, 180)) % 360;
        for (i = 0; i < 70; i++) {
          var a = Math.random() * Math.PI * 2;
          var sp = c.base * 0.52 * Math.sqrt(Math.random() * 0.9 + 0.1);
          addParticle(c.x, c.y, Math.cos(a) * sp, Math.sin(a) * sp, h1 + rand(-8, 8), c.palette.sat, common(c, {}));
        }
        var tilt = rand(0.2, 0.38);
        var rot = rand(-0.7, 0.7);
        for (i = 0; i < 80; i++) {
          var ar = (i / 80) * Math.PI * 2;
          var rx = Math.cos(ar) * c.base * 1.08;
          var ry = Math.sin(ar) * c.base * 1.08 * tilt;
          addParticle(c.x, c.y,
            rx * Math.cos(rot) - ry * Math.sin(rot),
            rx * Math.sin(rot) + ry * Math.cos(rot),
            h2, c.palette.sat, common(c, { life: rand(1.4, 1.8), drag: 1.15, gravity: 60 }));
        }
      },
      // 2 cấp: mỗi tia tách thành 4 tia chữ thập
      crossette: function (c) {
        var n = Math.round(rand(10, 13));
        var rot = rand(0, Math.PI * 2);
        for (var i = 0; i < n; i++) {
          var a = rot + (i / n) * Math.PI * 2;
          var sp = c.base * rand(0.55, 0.75);
          shellStar(c, hueOf(c, i), Math.cos(a) * sp, Math.sin(a) * sp,
            { at: rand(0.62, 0.82), kind: 'cross', shift: 0, scale: c.scale });
        }
        for (var j = 0; j < 30; j++) {
          var ac = Math.random() * Math.PI * 2;
          var sc = c.base * rand(0.05, 0.35);
          addParticle(c.x, c.y, Math.cos(ac) * sc, Math.sin(ac) * sc, 48, 60, common(c, { life: rand(0.8, 1.3), size: 2 }));
        }
      },
      // 2 cấp: mỗi tia nổ tiếp thành một chùm pháo nhỏ khác màu
      bloom: function (c) {
        var n = Math.round(rand(13, 17));
        for (var i = 0; i < n; i++) {
          var a = (i / n) * Math.PI * 2 + rand(-0.1, 0.1);
          var sp = c.base * rand(0.55, 0.78);
          shellStar(c, hueOf(c, i), Math.cos(a) * sp, Math.sin(a) * sp,
            { at: rand(0.6, 0.9), kind: 'sphere', shift: sign() * rand(35, 110), scale: c.scale });
        }
      },
      // 2 cấp: tia tàn nổ lách tách những đốm trắng
      crackle: function (c) {
        var n = Math.round(rand(95, 120));
        for (var i = 0; i < n; i++) {
          var a = Math.random() * Math.PI * 2;
          var sp = c.base * (0.45 + 0.55 * Math.random());
          var life = rand(1.6, 2.1);
          addParticle(c.x, c.y, Math.cos(a) * sp, Math.sin(a) * sp, randomHue(c), c.palette.sat,
            common(c, {
              life: life, drag: 1.2, gravity: 80,
              burst: Math.random() < 0.45 ? { at: life * rand(0.78, 0.95), kind: 'pop', shift: 0, scale: c.scale } : null
            }));
        }
      },
      // 2 cấp: quả thứ hai nổ ra từ cùng tâm sau 0.45s, khác bảng màu và khác hình
      twin: function (c) {
        SHAPES.peony(c);
        var x = c.x, y = c.y, base = c.base, scale = c.scale;
        schedule(0.45, function () {
          var p2 = pickPalette();
          var shape = pick(['ring', 'star', 'spiral', 'heart', 'saturn']);
          SHAPES[shape]({ x: x, y: y, base: base * 1.12, scale: scale, palette: p2 });
          addFlash(x, y, p2.hues[0], 0.28, 240 * scale);
        });
      },
      // Cọ dừa: ít tia dày, rơi đốm lửa lấp lánh dọc đường
      palm: function (c) {
        var n = Math.round(rand(10, 13));
        var rot = rand(0, Math.PI * 2);
        var hue = pick([40, 45, 50, 30]);
        for (var i = 0; i < n; i++) {
          var a = rot + (i / n) * Math.PI * 2;
          var sp = c.base * rand(0.7, 0.95);
          addParticle(c.x, c.y, Math.cos(a) * sp, Math.sin(a) * sp, hue + rand(-5, 5), 100,
            common(c, { life: rand(2.1, 2.6), drag: 0.95, gravity: 110, streak: 0.08, size: rand(3.2, 4.2), trail: 0.045 }));
        }
        for (var j = 0; j < 40; j++) {
          var ac = Math.random() * Math.PI * 2;
          var sc = c.base * rand(0.05, 0.4);
          addParticle(c.x, c.y, Math.cos(ac) * sc, Math.sin(ac) * sc, 48, 60, common(c, { life: rand(0.9, 1.5), size: 2 }));
        }
      }
    };

    function explode(x, y, scale, reduced, forced) {
      var palette = pickPalette();
      var base = rand(260, 380) * scale;
      var c = { x: x, y: y, base: base, scale: scale, palette: palette };

      if (reduced) {
        var count = 28;
        for (var i = 0; i < count; i++) {
          var ra = (i / count) * Math.PI * 2;
          addParticle(x, y, Math.cos(ra) * base * 0.8, Math.sin(ra) * base * 0.8, hueOf(c, i), palette.sat,
            { life: 0.9, size: rand(2.3, 3.4) * Math.max(scale, 0.8), drag: 1.35, gravity: 90, streak: 0, glitter: false });
        }
        addFlash(x, y, palette.hues[0], 0.18, 90 * scale);
        return;
      }

      var shape = SHAPES[forced] || SHAPES[pick(PATTERNS)];
      shape(c);
      addFlash(x, y, palette.hues[0], 0.3, 270 * scale);
      // Vòng sáng trắng-nóng thoáng qua ở tâm nổ
      addFlash(x, y, 50, 0.12, 120 * scale);
    }

    function fire(targetX, targetY, pattern) {
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
        pattern: pattern,
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

      // Hẹn giờ (quả nổ thứ hai, loạt bắn thêm)
      for (i = timers.length - 1; i >= 0; i--) {
        var tm = timers[i];
        tm.t -= dt;
        if (tm.t <= 0) {
          timers.splice(i, 1);
          tm.fn();
        }
      }

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
        if (r.sparkTimer > 0.025) {
          r.sparkTimer = 0;
          addParticle(r.x, r.y, rand(-18, 18), rand(10, 50), rand(25, 55), 100,
            { life: rand(0.25, 0.5), size: rand(1, 1.8), drag: 1, gravity: 80, streak: 0, glitter: false });
        }

        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(r.x, r.y);
        ctx.lineWidth = 2.4;
        ctx.strokeStyle = light ? hsla(35, 100, 45, 0.9) : hsla(45, 100, 85, 0.95);
        ctx.stroke();

        if (p >= 1) {
          rockets.splice(i, 1);
          explode(r.tx, r.ty, r.scale, false, r.pattern);
        }
      }

      // Hạt pháo hoa
      for (i = particles.length - 1; i >= 0; i--) {
        var pt = particles[i];
        pt.age += dt;
        if (pt.age >= pt.life) { particles.splice(i, 1); continue; }

        // Nổ cấp 2: hạt biến mất và sinh ra chùm mới tại chỗ
        if (pt.burst && pt.age >= pt.burst.at) {
          miniBurst(pt.x, pt.y, pt.hue + pt.burst.shift, pt.sat, pt.burst.kind, pt.burst.scale);
          particles.splice(i, 1);
          continue;
        }

        var damp = Math.max(0, 1 - pt.drag * dt);
        pt.vx *= damp;
        pt.vy = pt.vy * damp + pt.gravity * dt;
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;

        if (pt.trail) {
          pt.trailT += dt;
          if (pt.trailT >= pt.trail) {
            pt.trailT = 0;
            addParticle(pt.x, pt.y, rand(-14, 14), rand(-10, 18), pt.hue, pt.sat,
              { life: rand(0.3, 0.55), size: pt.size * 0.55, drag: 1.2, gravity: 60, streak: 0, glitter: false });
          }
        }

        var t = pt.age / pt.life;
        var alpha = Math.pow(1 - t, 1.3);
        if (pt.glitter && t > 0.7 && Math.random() < 0.4) alpha *= 0.35; // lấp lánh lúc tàn
        var hue = pt.hue2 === undefined ? pt.hue : pt.hue + (pt.hue2 - pt.hue) * Math.min(1, t * 1.4);
        // Mới nổ thì trắng-nóng, nguội dần thành màu thật
        var sat = t < 0.14 ? pt.sat * (0.35 + 0.65 * (t / 0.14)) : pt.sat;
        var tailX = pt.x - pt.vx * pt.streak;
        var tailY = pt.y - pt.vy * pt.streak;
        var width = pt.size * (0.6 + 0.4 * (1 - t));
        ctx.beginPath();
        ctx.moveTo(tailX, tailY);
        ctx.lineTo(pt.x, pt.y);
        // Quầng sáng mờ (nét rộng) rồi lõi sáng: thay cho shadowBlur vốn rất tốn.
        ctx.lineWidth = width * 3;
        ctx.strokeStyle = hsla(hue, pt.sat, lightness, alpha * 0.22);
        ctx.stroke();
        ctx.lineWidth = width;
        ctx.strokeStyle = hsla(hue, sat, light ? lightness : lightness + 14, alpha);
        ctx.stroke();
      }

      ctx.restore();

      if (rockets.length || particles.length || flashes.length || timers.length) {
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
      // Thỉnh thoảng bắn thêm một quả nữa ngay sau đó cho rộn ràng
      if (Math.random() < 0.3) {
        schedule(rand(0.15, 0.3), function () {
          fire(clientX + rand(-140, 140), clientY + rand(-70, 50));
        });
      }
    }

    function onPointerDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      handleTrigger(e.clientX, e.clientY, e.target);
    }
    root.document.addEventListener('pointerdown', onPointerDown);

    // Loạt chào mừng 1 giây sau khi tải trang (tương ứng sao băng chào mừng).
    [[1000, 0.25, 0.28], [1250, 0.72, 0.22], [1550, 0.48, 0.35]].forEach(function (s) {
      welcomeTimers.push(root.setTimeout(function () {
        var vp = viewport();
        fire(vp.w * s[1], vp.h * s[2]);
      }, s[0]));
    });

    function stop() {
      root.document.removeEventListener('pointerdown', onPointerDown);
      welcomeTimers.forEach(function (id) { root.clearTimeout(id); });
      welcomeTimers.length = 0;
      rockets.length = 0;
      particles.length = 0;
      flashes.length = 0;
      timers.length = 0;
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
