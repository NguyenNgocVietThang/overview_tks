/**
 * ============================================================================
 * SHOOTING STAR ENGINE — TOKOSI DASHBOARD
 * Hiệu ứng sao băng rơi theo hướng 4 giờ (120°) có quỹ đạo uốn cong nhẹ,
 * vệt sáng lấp lánh và bụi sao. Hoạt động trên mọi trang/tab của hệ thống.
 * Chạy ở tầng nền (z-index: 0), không đè lên các khung/panel/thẻ/bảng.
 * ============================================================================
 */
(function() {
  'use strict';

  function initShootingStar() {
    // Đảm bảo không khởi tạo 2 lần trên cùng 1 trang
    if (window.__TKS_SHOOTING_STAR_INITIALIZED__) return;
    window.__TKS_SHOOTING_STAR_INITIALIZED__ = true;

    // Tìm hoặc tự động tạo thẻ canvas nếu trang chưa có
    var canvas = document.getElementById('shooting-star-canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'shooting-star-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      if (document.body) {
        document.body.insertBefore(canvas, document.body.firstChild);
      } else {
        document.addEventListener('DOMContentLoaded', function() {
          document.body.insertBefore(canvas, document.body.firstChild);
        });
      }
    }

    var ctx = canvas.getContext('2d');
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;';

    var dpr = window.devicePixelRatio || 1;
    function resize() {
      dpr = window.devicePixelRatio || 1;
      var w = window.innerWidth;
      var h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
    }
    resize();
    window.addEventListener('resize', resize);

    var MAX_STARS = 10;
    var stars = [];
    var particles = [];

    // Hướng 4 giờ = 120° từ 12h theo chiều kim đồng hồ
    var BASE_ANGLE = 120 * Math.PI / 180;

    function spawnStar(originX, originY) {
      if (stars.length >= MAX_STARS) return;

      var jitter = (Math.random() - 0.5) * 14 * Math.PI / 180; // Dao động nhẹ ±7°
      var angle = BASE_ANGLE + jitter;
      var speed = 480 + Math.random() * 200; // Tốc độ (px/s)
      // Lùi điểm xuất phát 1 đoạn nhỏ để đầu sao mượt mà
      var startOffset = 20 + Math.random() * 25;
      var sx = originX - Math.sin(angle) * startOffset;
      var sy = originY - (-Math.cos(angle)) * startOffset;

      stars.push({
        x: sx,
        y: sy,
        vx: Math.sin(angle),
        vy: -Math.cos(angle),
        speed: speed,
        ax: (Math.random() - 0.3) * 35, // Quỹ đạo cong nhẹ
        ay: 26 + Math.random() * 18,    // Trọng lực rơi
        age: 0,
        lifetime: 0.75 + Math.random() * 0.35,
        length: 120 + Math.random() * 80,
        width: 2.8 + Math.random() * 1.6,
        colorCore: '255, 255, 255',
        colorGlow: '140, 200, 255',
        sparkleTimer: 0
      });

      // Lóe sáng nhẹ tại điểm chạm
      for (var i = 0; i < 4; i++) {
        var pAngle = Math.random() * Math.PI * 2;
        var pSpeed = 20 + Math.random() * 50;
        particles.push({
          x: originX,
          y: originY,
          vx: Math.cos(pAngle) * pSpeed,
          vy: Math.sin(pAngle) * pSpeed,
          age: 0,
          lifetime: 0.35 + Math.random() * 0.25,
          size: 1.5 + Math.random() * 1.5,
          color: '200, 230, 255'
        });
      }
    }

    var lastTime = null;
    function loop(ts) {
      if (lastTime === null) lastTime = ts;
      var dt = Math.min((ts - lastTime) / 1000, 0.05);
      lastTime = ts;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

      var w = canvas.width / dpr;
      var h = canvas.height / dpr;

      // 1. Cập nhật và vẽ các hạt bụi sao lấp lánh (particles)
      for (var p = particles.length - 1; p >= 0; p--) {
        var pt = particles[p];
        pt.age += dt;
        if (pt.age >= pt.lifetime) {
          particles.splice(p, 1);
          continue;
        }
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        var pAlpha = 1 - (pt.age / pt.lifetime);
        ctx.save();
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(' + pt.color + ',' + (pAlpha * 0.8).toFixed(3) + ')';
        ctx.shadowBlur = 6;
        ctx.shadowColor = 'rgba(' + pt.color + ',' + pAlpha.toFixed(3) + ')';
        ctx.fill();
        ctx.restore();
      }

      // 2. Cập nhật và vẽ các sao băng (shooting stars)
      for (var i = stars.length - 1; i >= 0; i--) {
        var s = stars[i];
        s.age += dt;

        s.vx += s.ax * dt / s.speed;
        s.vy += s.ay * dt / s.speed;
        var mag = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
        if (mag > 0) { s.vx /= mag; s.vy /= mag; }

        s.x += s.vx * s.speed * dt;
        s.y += s.vy * s.speed * dt;

        s.sparkleTimer += dt;
        if (s.sparkleTimer > 0.04) {
          s.sparkleTimer = 0;
          particles.push({
            x: s.x - s.vx * (10 + Math.random() * 20),
            y: s.y - s.vy * (10 + Math.random() * 20),
            vx: (Math.random() - 0.5) * 15,
            vy: (Math.random() - 0.5) * 15,
            age: 0,
            lifetime: 0.25 + Math.random() * 0.2,
            size: 1.2 + Math.random() * 1.2,
            color: s.colorGlow
          });
        }

        var t = s.age / s.lifetime;
        var fadeIn = Math.min(t / 0.12, 1);
        var fadeOut = Math.max(1 - (t - 0.50) / 0.50, 0);
        var alpha = fadeIn * fadeOut;
        if (alpha <= 0) {
          stars.splice(i, 1);
          continue;
        }

        var tailX = s.x - s.vx * s.length;
        var tailY = s.y - s.vy * s.length;

        var grad = ctx.createLinearGradient(tailX, tailY, s.x, s.y);
        grad.addColorStop(0, 'rgba(' + s.colorGlow + ', 0)');
        grad.addColorStop(0.5, 'rgba(' + s.colorGlow + ', ' + (alpha * 0.45).toFixed(3) + ')');
        grad.addColorStop(0.85, 'rgba(' + s.colorCore + ', ' + (alpha * 0.85).toFixed(3) + ')');
        grad.addColorStop(1, 'rgba(255, 255, 255, ' + alpha.toFixed(3) + ')');

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(tailX, tailY);
        ctx.lineTo(s.x, s.y);
        ctx.lineWidth = s.width;
        ctx.lineCap = 'round';
        ctx.strokeStyle = grad;
        ctx.shadowBlur = 14;
        ctx.shadowColor = 'rgba(' + s.colorGlow + ', ' + (alpha * 0.9).toFixed(3) + ')';
        ctx.stroke();

        var headTailX = s.x - s.vx * (s.length * 0.35);
        var headTailY = s.y - s.vy * (s.length * 0.35);
        var headGrad = ctx.createLinearGradient(headTailX, headTailY, s.x, s.y);
        headGrad.addColorStop(0, 'rgba(' + s.colorGlow + ', 0)');
        headGrad.addColorStop(1, 'rgba(255, 255, 255, ' + alpha.toFixed(3) + ')');
        ctx.beginPath();
        ctx.moveTo(headTailX, headTailY);
        ctx.lineTo(s.x, s.y);
        ctx.lineWidth = s.width * 1.5;
        ctx.strokeStyle = headGrad;
        ctx.shadowBlur = 20;
        ctx.shadowColor = 'rgba(' + s.colorCore + ', ' + alpha.toFixed(3) + ')';
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(s.x, s.y, s.width * 1.3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, ' + alpha.toFixed(3) + ')';
        ctx.shadowBlur = 16;
        ctx.shadowColor = 'rgba(' + s.colorGlow + ', 1)';
        ctx.fill();
        ctx.restore();

        if (s.age >= s.lifetime || s.x > w + 250 || s.y > h + 250) {
          stars.splice(i, 1);
        }
      }

      ctx.restore();
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);

    // Chỉ bỏ qua khi người dùng đang thao tác trên các control tương tác (nút bấm, ô nhập liệu, link)
    function isInteractiveControl(el) {
      if (!el || el === canvas) return false;
      if (el.closest && el.closest('button, input, select, textarea, a, [role="button"], [contenteditable]')) {
        return true;
      }
      return false;
    }

    var lastTriggerTime = 0;
    function handleTrigger(clientX, clientY, target) {
      var now = Date.now();
      if (now - lastTriggerTime < 100) return; // Tránh double trigger từ pointer + touch + click
      lastTriggerTime = now;

      if (isInteractiveControl(target)) return;

      var spawnX = clientX;
      var spawnY = clientY;
      var w = window.innerWidth;
      var h = window.innerHeight;
      if (spawnX > w * 0.65 || spawnY > h * 0.65) {
        spawnX = Math.max(spawnX - 160, 40);
        spawnY = Math.max(spawnY - 120, 40);
      }

      spawnStar(spawnX, spawnY);
    }

    document.addEventListener('pointerdown', function(e) {
      if (e.button !== undefined && e.button !== 0) return;
      handleTrigger(e.clientX, e.clientY, e.target);
    });

    // Tự động bắn 1 ngôi sao băng chào mừng nhẹ sau khi trang tải 1 giây
    setTimeout(function() {
      spawnStar(window.innerWidth * 0.25, window.innerHeight * 0.15);
    }, 1000);

    window.spawnShootingStar = spawnStar;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initShootingStar);
  } else {
    initShootingStar();
  }
})();
