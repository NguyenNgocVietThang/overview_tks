/**
 * three-loading.js — TKS Dashboard 3D Loading States
 *
 * Implements Task 10: Add 3D Loading States (3D Design.md)
 * - Replaces flat spinner / text veil with a 3D CSS cube loader
 * - Smooth entrance / exit animations
 * - Accessible: aria-live region, aria-hidden cube, reduced-motion fallback
 * - Theme-aware: reacts to [data-theme] attribute changes automatically
 * - Lightweight: pure CSS-3D, no Three.js dependency needed for the loader
 *
 * Public API (attached to window.TKSLoading):
 *   TKSLoading.show(message?)        — show the loading veil
 *   TKSLoading.hide()                — hide the loading veil
 *   TKSLoading.wrap(promise, msg?)   — show before promise, hide after; returns same promise
 *   TKSLoading.upgrade(el)           — inject 3D cube HTML into an existing veil element
 */

(function (root) {
  'use strict';

  if (typeof window === 'undefined') return;

  /* ------------------------------------------------------------------ */
  /* 1. Inline CSS injected once into <head>                              */
  /* ------------------------------------------------------------------ */
  const STYLE_ID = 'tks-loading-3d-styles';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
/* ====================================================================
   TKS 3D Loading States - three-loading.js
   ==================================================================== */

/* ---------- Veil overlay ---------- */
.loading-veil {
  position: fixed;
  inset: 0;
  background: var(--veil, rgba(9,13,22,0.82));
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0;
  z-index: 9000;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.3s cubic-bezier(0.23, 1, 0.32, 1);
}

.loading-veil.show {
  opacity: 1;
  pointer-events: all;
}

/* ---------- Loader wrapper ---------- */
.loader-3d {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  transform: translateY(20px) scale(0.9);
  opacity: 0;
  transition:
    transform 0.4s cubic-bezier(0.23, 1, 0.32, 1) 0.05s,
    opacity   0.4s cubic-bezier(0.23, 1, 0.32, 1) 0.05s;
}

.loading-veil.show .loader-3d {
  transform: translateY(0) scale(1);
  opacity: 1;
}

/* ---------- 3D cube scene ---------- */
.cube-scene {
  width: 64px;
  height: 64px;
  perspective: 260px;
}

.cube {
  width: 64px;
  height: 64px;
  position: relative;
  transform-style: preserve-3d;
  animation: tks-cube-rotate 2s infinite cubic-bezier(0.45, 0.05, 0.55, 0.95);
}

/* Faces */
.cube .face {
  position: absolute;
  width: 64px;
  height: 64px;
  border: 2px solid rgba(59, 130, 246, 0.6);
  border-radius: 6px;
  background: linear-gradient(
    135deg,
    rgba(59, 130, 246, 0.25) 0%,
    rgba(37, 99, 235, 0.12) 100%
  );
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  box-shadow:
    inset 0 0 12px rgba(59, 130, 246, 0.15),
    0 0 6px rgba(59, 130, 246, 0.2);
}

.cube .face.front  { transform: translateZ(32px); }
.cube .face.back   { transform: rotateY(180deg) translateZ(32px); }
.cube .face.left   { transform: rotateY(-90deg) translateZ(32px); }
.cube .face.right  { transform: rotateY(90deg)  translateZ(32px); }
.cube .face.top    { transform: rotateX(90deg)  translateZ(32px); }
.cube .face.bottom { transform: rotateX(-90deg) translateZ(32px); }

.cube .face.front,
.cube .face.top {
  background: linear-gradient(
    135deg,
    rgba(59, 130, 246, 0.40) 0%,
    rgba(37, 99, 235, 0.22) 100%
  );
  border-color: rgba(99, 160, 255, 0.75);
}

/* Pulsing inner core */
.cube-core {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.cube-core::before {
  content: '';
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--primary, #3B82F6);
  box-shadow:
    0 0 8px 3px rgba(59, 130, 246, 0.6),
    0 0 20px 6px rgba(59, 130, 246, 0.25);
  animation: tks-core-pulse 2s ease-in-out infinite;
}

/* ---------- Loader text ---------- */
.loader-text {
  font-family: var(--font-data, 'IBM Plex Mono', monospace);
  font-size: 12.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
  color: var(--primary, #3B82F6);
  text-align: center;
  opacity: 0.9;
  animation: tks-text-shimmer 2s ease-in-out infinite;
}

/* Animated ellipsis */
.loader-dots::after {
  content: '';
  display: inline-block;
  animation: tks-dots 1.4s steps(4, end) infinite;
  width: 1.2em;
  text-align: left;
}

/* SR-only utility */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0,0,0,0);
  white-space: nowrap;
  border: 0;
}

/* ---------- Shimmer progress bar ---------- */
.loader-ring {
  width: 80px;
  height: 4px;
  border-radius: 99px;
  background: rgba(59, 130, 246, 0.12);
  overflow: hidden;
  position: relative;
}

.loader-ring::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg,
    transparent 0%,
    var(--primary, #3B82F6) 40%,
    rgba(99, 160, 255, 0.9) 60%,
    transparent 100%
  );
  animation: tks-shimmer-bar 1.4s linear infinite;
}

/* ====================================================================
   Keyframes
   ==================================================================== */

@keyframes tks-cube-rotate {
  0%   { transform: rotateX(0deg)   rotateY(0deg)   rotateZ(0deg); }
  33%  { transform: rotateX(120deg) rotateY(80deg)  rotateZ(0deg); }
  66%  { transform: rotateX(240deg) rotateY(200deg) rotateZ(0deg); }
  100% { transform: rotateX(360deg) rotateY(360deg) rotateZ(0deg); }
}

@keyframes tks-core-pulse {
  0%, 100% { transform: scale(1);   opacity: 0.8; }
  50%       { transform: scale(1.5); opacity: 1;   }
}

@keyframes tks-text-shimmer {
  0%, 100% { opacity: 0.75; }
  50%       { opacity: 1;    }
}

@keyframes tks-dots {
  0%   { content: ''; }
  25%  { content: '.'; }
  50%  { content: '..'; }
  75%  { content: '...'; }
  100% { content: ''; }
}

@keyframes tks-shimmer-bar {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(200%);  }
}

/* ====================================================================
   Reduced motion — cube static, only fade; ring stops
   ==================================================================== */
@media (prefers-reduced-motion: reduce) {
  .cube {
    animation: none;
    transform: rotateX(25deg) rotateY(30deg);
  }
  .cube-core::before {
    animation: none;
    opacity: 0.9;
  }
  .loader-text {
    animation: none;
    opacity: 0.9;
  }
  .loader-ring::after {
    animation: none;
    background: var(--primary, #3B82F6);
    width: 40%;
    left: 30%;
    right: auto;
  }
  .loading-veil {
    transition: opacity 0.15s ease;
  }
  .loader-3d {
    transition:
      transform 0.15s ease,
      opacity   0.15s ease;
  }
}

/* ====================================================================
   Light theme adjustments
   ==================================================================== */
:root[data-theme="light"] .cube .face {
  border-color: rgba(37, 99, 235, 0.5);
  background: linear-gradient(
    135deg,
    rgba(37, 99, 235, 0.18) 0%,
    rgba(29, 78, 216, 0.08) 100%
  );
}
:root[data-theme="light"] .cube .face.front,
:root[data-theme="light"] .cube .face.top {
  background: linear-gradient(
    135deg,
    rgba(37, 99, 235, 0.30) 0%,
    rgba(29, 78, 216, 0.16) 100%
  );
  border-color: rgba(37, 99, 235, 0.65);
}
:root[data-theme="light"] .cube-core::before {
  background: var(--primary, #2563EB);
  box-shadow:
    0 0 8px 3px rgba(37, 99, 235, 0.5),
    0 0 20px 6px rgba(37, 99, 235, 0.18);
}
`;

    (document.head || document.documentElement).appendChild(style);
  }

  /* ------------------------------------------------------------------ */
  /* 2. Build 3D cube HTML                                               */
  /* ------------------------------------------------------------------ */
  function buildCubeHTML(message) {
    var msg = message || 'Đang tải dữ liệu';
    return (
      '<div class="loader-3d" role="status">' +
        '<div class="cube-scene" aria-hidden="true">' +
          '<div class="cube">' +
            '<div class="face front"></div>' +
            '<div class="face back"></div>' +
            '<div class="face left"></div>' +
            '<div class="face right"></div>' +
            '<div class="face top"></div>' +
            '<div class="face bottom"></div>' +
            '<div class="cube-core"></div>' +
          '</div>' +
        '</div>' +
        '<span class="loader-text"><span class="loader-dots">' + msg + '</span></span>' +
        '<div class="loader-ring" aria-hidden="true"></div>' +
        '<span class="sr-only" aria-live="polite" aria-atomic="true">' + msg + '</span>' +
      '</div>'
    );
  }

  /* ------------------------------------------------------------------ */
  /* 3. Upgrade an existing .loading-veil element                        */
  /* ------------------------------------------------------------------ */
  function upgradeVeil(el, message) {
    if (!el) return;
    if (el.dataset.tks3dUpgraded) {
      // Only update the message text
      if (message) {
        var dots = el.querySelector('.loader-dots');
        var sr   = el.querySelector('[aria-live]');
        if (dots) dots.textContent = message;
        if (sr)   sr.textContent   = message;
      }
      return;
    }

    el.dataset.tks3dUpgraded = '1';
    el.innerHTML = buildCubeHTML(message);
    el.setAttribute('aria-busy', 'false');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Đang tải');
  }

  /* ------------------------------------------------------------------ */
  /* 4. Show / hide helpers                                              */
  /* ------------------------------------------------------------------ */
  function getVeil() {
    return document.getElementById('veil') || document.querySelector('.loading-veil');
  }

  function show(message) {
    injectStyles();

    var el = getVeil();
    if (!el) {
      el = document.createElement('div');
      el.className = 'loading-veil';
      el.id = 'veil-dynamic';
      document.body.appendChild(el);
    }

    upgradeVeil(el, message);

    el.setAttribute('aria-busy', 'true');

    // Force reflow so CSS transition fires
    void el.offsetHeight;
    el.classList.add('show');
  }

  function hide() {
    var el = getVeil() || document.getElementById('veil-dynamic');
    if (!el) return;
    el.classList.remove('show');
    el.setAttribute('aria-busy', 'false');
  }

  /* ------------------------------------------------------------------ */
  /* 5. Promise wrapper                                                  */
  /* ------------------------------------------------------------------ */
  function wrap(promise, message) {
    show(message);
    var done = function () { hide(); };
    promise.then(done, done);
    return promise;
  }

  /* ------------------------------------------------------------------ */
  /* 6. Auto-upgrade existing veils on DOMContentLoaded                 */
  /* ------------------------------------------------------------------ */
  function autoUpgrade() {
    injectStyles();
    var veils = document.querySelectorAll('.loading-veil');
    veils.forEach(function (el) { upgradeVeil(el); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoUpgrade);
  } else {
    autoUpgrade();
  }

  /* ------------------------------------------------------------------ */
  /* 7. Export                                                           */
  /* ------------------------------------------------------------------ */
  var TKSLoading = {
    show:           show,
    hide:           hide,
    wrap:           wrap,
    upgrade:        upgradeVeil,
    _buildCubeHTML: buildCubeHTML,
    _injectStyles:  injectStyles,
    _getVeil:       getVeil,
  };

  root.TKSLoading = TKSLoading;

}(typeof globalThis !== 'undefined' ? globalThis : window));
