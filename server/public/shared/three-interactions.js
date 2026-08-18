/**
 * three-interactions.js — TKS Dashboard 3D Interactive Hover & Tilt Handler
 *
 * Implements Task 4: Interactive Hover Handler (3D Design.md)
 * - Dynamic 3D tilt effects on cards & panels based on cursor coordinates
 * - Realistic button press down micro-interaction
 * - Navigation item 3D slide & tilt
 * - Full prefers-reduced-motion accessibility support
 * - Graceful cleanup & DOM re-scanning capabilities
 */

(function(root) {
  'use strict';

  if (typeof window === 'undefined') {
    return;
  }

  const TKS3D = {
    initialized: false,
    _cleanups: [],
    currentQuality: 'high',

    init() {
      if (this.initialized) {
        this.refresh();
        return this;
      }
      
      // Get initial quality from performance monitor
      if (window.TKSPerformance) {
        this.currentQuality = window.TKSPerformance.quality || 'high';
      }

      this.setupCardEffects();
      this.setupButtonEffects();
      this.setupNavigationEffects();
      this.setupTableRowEffects();
      this.setupSearchEffects();
      this.setupQualityListener();

      this.initialized = true;
      return this;
    },

    shouldReduceMotion() {
      try {
        return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      } catch (err) {
        return false;
      }
    },

    setupCardEffects(rootEl) {
      const scope = rootEl || document;
      const selector = '.kpi-card, .panel, .card-3d, .profile-card, .kpi-stat, .int-nav-card, .users-table-panel, .section-panel';
      const cards = scope.querySelectorAll(selector);

      cards.forEach(card => {
        if (card.dataset.tks3dCardInit) return;
        card.dataset.tks3dCardInit = 'true';

        card.style.transformStyle = 'preserve-3d';
        if (!card.style.transition) {
          card.style.transition = 'transform 0.4s cubic-bezier(0.23, 1, 0.32, 1), box-shadow 0.4s ease';
        }

        const onMouseMove = (e) => this.onCardHover(e, card);
        const onMouseLeave = () => this.onCardLeave(card);

        card.addEventListener('mousemove', onMouseMove);
        card.addEventListener('mouseleave', onMouseLeave);

        this._cleanups.push(() => {
          card.removeEventListener('mousemove', onMouseMove);
          card.removeEventListener('mouseleave', onMouseLeave);
          delete card.dataset.tks3dCardInit;
          this.onCardLeave(card);
        });
      });
    },

    onCardHover(e, card) {
      if (this.shouldReduceMotion()) return;
      if (!card) return;

      const rect = card.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      // Adjust tilt intensity based on quality
      let maxTilt = 5;
      if (this.currentQuality === 'low') {
        maxTilt = 3;
      } else if (this.currentQuality === 'minimal') {
        maxTilt = 0; // No tilt on minimal
        return;
      }

      const rotateX = ((y - centerY) / centerY) * -maxTilt;
      const rotateY = ((x - centerX) / centerX) * maxTilt;

      const isLight = document.documentElement && document.documentElement.dataset.theme === 'light';
      const glowColor = isLight ? 'rgba(37, 99, 235, 0.2)' : 'rgba(59, 130, 246, 0.3)';
      const ambientBorder = isLight ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.1)';

      // Disable glow effects on low/minimal quality
      const useGlow = this.currentQuality !== 'low' && this.currentQuality !== 'minimal';

      card.style.transform = `perspective(1000px) translateZ(20px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) scale(1.02)`;
      
      if (useGlow) {
        card.style.boxShadow = `0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 30px ${glowColor}, 0 0 1px 1px ${ambientBorder}`;
      } else {
        card.style.boxShadow = `0 10px 25px -8px rgba(0, 0, 0, 0.3)`;
      }
    },

    onCardLeave(card) {
      if (!card) return;
      card.style.transform = '';
      card.style.boxShadow = '';
    },

    addRipple(e) {
      if (this.shouldReduceMotion()) return;
      const button = (e && e.currentTarget) || (e && e.target);
      if (!button || button.disabled || (typeof button.getAttribute === 'function' && button.getAttribute('disabled') !== null) || (button.classList && typeof button.classList.contains === 'function' && button.classList.contains('disabled'))) {
        return;
      }

      const ripple = document.createElement('span');
      const rect = (button.getBoundingClientRect && button.getBoundingClientRect()) || { left: 0, top: 0, width: button.offsetWidth || 100, height: button.offsetHeight || 40 };
      const size = Math.max(rect.width || 0, rect.height || 0) || 60;
      const clientX = (e && typeof e.clientX === 'number') ? e.clientX : (rect.left + size / 2);
      const clientY = (e && typeof e.clientY === 'number') ? e.clientY : (rect.top + size / 2);
      const x = clientX - rect.left - size / 2;
      const y = clientY - rect.top - size / 2;

      ripple.style.width = size + 'px';
      ripple.style.height = size + 'px';
      ripple.style.left = x + 'px';
      ripple.style.top = y + 'px';
      ripple.classList.add('ripple-effect');

      button.appendChild(ripple);
      setTimeout(() => {
        if (ripple.parentNode === button) {
          button.removeChild(ripple);
        } else if (ripple.remove) {
          ripple.remove();
        }
      }, 600);
    },

    setupButtonEffects(rootEl) {
      const scope = rootEl || document;
      const selector = '.btn-primary, .refresh-btn, .theme-toggle, .theme-toggle-floating, .theme-toggle-disp, .btn-secondary, .btn-danger, .btn-outline, .btn-export, .export-button, .export-btn, .tks-btn-primary, .tks-btn-secondary, .tks-btn-danger, .login-btn, .register-btn, .search-submit, .period-toggle button, .pagination-controls button, .profile-trigger, .menu-btn, .btn';
      const buttons = scope.querySelectorAll(selector);

      buttons.forEach(btn => {
        if (btn.dataset.tks3dBtnInit) return;
        btn.dataset.tks3dBtnInit = 'true';

        btn.style.transformStyle = 'preserve-3d';
        if (!btn.style.transition) {
          btn.style.transition = 'transform 0.15s cubic-bezier(0.23, 1, 0.32, 1), box-shadow 0.15s ease';
        }

        const isBtnDisabled = () => {
          return btn.disabled || (typeof btn.getAttribute === 'function' && btn.getAttribute('disabled') !== null) || (btn.classList && typeof btn.classList.contains === 'function' && btn.classList.contains('disabled'));
        };

        // NOTE: the pressed-state visual (translateY) is owned entirely by
        // the CSS `:active` rule in shared.css — it is intentionally NOT
        // duplicated here via btn.style.transform.
        //
        // Previously this handler set btn.style.transform on 'mousedown'
        // and relied on 'mouseup'/'mouseleave'/'blur' on the SAME button to
        // clear it. That is fragile: per the DOM click spec, if the button
        // visually shifts under the cursor during the mousedown->mouseup
        // gesture, mouseup can resolve to a different element (e.g. the
        // parent <form> or panel), so the button's own mouseup listener
        // never fires. The click event then targets the nearest common
        // ancestor of the two — not the button — so the click (and, for
        // submit buttons, the form submit) is silently swallowed, AND the
        // inline transform is left stuck on the button forever, making it
        // visually "pressed" and prone to mis-hit on every future click too.
        // Letting the browser manage `:active` natively avoids all of that:
        // it always clears on release regardless of where the pointer ends
        // up, so there is no JS state that can get stuck.
        const onMouseDown = (e) => {
          if (this.shouldReduceMotion() || isBtnDisabled()) return;
          this.addRipple(e);
        };

        btn.addEventListener('mousedown', onMouseDown);

        this._cleanups.push(() => {
          btn.removeEventListener('mousedown', onMouseDown);
          delete btn.dataset.tks3dBtnInit;
        });
      });
    },

    setupNavigationEffects(rootEl) {
      const scope = rootEl || document;
      const selector = '.nav-item, .nav-subitem, .nav-group-toggle, .tks-top-nav-link';
      const navItems = scope.querySelectorAll(selector);

      navItems.forEach(item => {
        if (item.dataset.tks3dNavInit) return;
        item.dataset.tks3dNavInit = 'true';

        item.style.transformStyle = 'preserve-3d';
        if (!item.style.transition) {
          item.style.transition = 'transform 0.3s cubic-bezier(0.23, 1, 0.32, 1), background-color 0.2s ease, box-shadow 0.3s ease';
        }

        const onMouseEnter = () => {
          if (this.shouldReduceMotion()) return;
          if (!item.classList.contains('active')) {
            const isGroupToggle = item.classList.contains('nav-group-toggle');
            const tz = isGroupToggle ? 8 : 10;
            const tx = isGroupToggle ? 6 : 8;
            item.style.transform = `perspective(800px) translateZ(${tz}px) translateX(${tx}px)`;
          }
        };

        const onMouseLeave = () => {
          item.style.transform = '';
        };

        item.addEventListener('mouseenter', onMouseEnter);
        item.addEventListener('mouseleave', onMouseLeave);

        this._cleanups.push(() => {
          item.removeEventListener('mouseenter', onMouseEnter);
          item.removeEventListener('mouseleave', onMouseLeave);
          delete item.dataset.tks3dNavInit;
          onMouseLeave();
        });
      });
    },

    setupTableRowEffects(rootEl) {
      const scope = rootEl || document;
      const rows = scope.querySelectorAll('tbody tr');

      rows.forEach(row => {
        if (row.dataset.tks3dRowInit) return;
        row.dataset.tks3dRowInit = 'true';

        row.style.transformStyle = 'preserve-3d';
        if (!row.style.transition) {
          row.style.transition = 'transform 0.2s cubic-bezier(0.23, 1, 0.32, 1), box-shadow 0.2s ease, background-color 0.2s ease';
        }

        this._cleanups.push(() => {
          delete row.dataset.tks3dRowInit;
          row.style.transform = '';
          row.style.boxShadow = '';
        });
      });
    },

    animateTableRows(scopeOrTbody) {
      let targetEl = scopeOrTbody;
      if (typeof targetEl === 'string') {
        targetEl = document.querySelector(targetEl) || document.getElementById(targetEl);
      }

      let rows = [];
      if (targetEl) {
        if (targetEl.tagName === 'TBODY') {
          rows = Array.from(targetEl.rows || targetEl.querySelectorAll('tr'));
        } else if (targetEl.tagName === 'TABLE') {
          rows = Array.from(targetEl.querySelectorAll('tbody tr'));
        } else if (targetEl.querySelectorAll) {
          rows = Array.from(targetEl.querySelectorAll('tbody tr'));
        }
      } else {
        rows = Array.from(document.querySelectorAll('tbody tr'));
      }

      if (!rows || rows.length === 0) return;

      if (this.shouldReduceMotion()) {
        rows.forEach(row => {
          row.style.opacity = '1';
          row.style.transform = '';
        });
        return;
      }
      
      // Skip animation on minimal quality
      if (this.currentQuality === 'minimal') {
        rows.forEach(row => {
          row.style.opacity = '1';
          row.style.transform = '';
        });
        return;
      }

      this._rowTimers = this._rowTimers || [];

      // Faster animation on low quality
      const delay = this.currentQuality === 'low' ? 15 : 30;

      rows.forEach((row, i) => {
        row.style.opacity = '0';
        row.style.transform = 'perspective(1000px) translateZ(-20px)';

        const timer = setTimeout(() => {
          row.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
          row.style.opacity = '1';
          row.style.transform = '';
        }, i * delay);

        this._rowTimers.push(timer);
      });
    },
    
    setupQualityListener() {
      // Listen for quality changes and update behavior
      window.addEventListener('tks-quality-change', (e) => {
        if (e.detail && e.detail.quality) {
          this.currentQuality = e.detail.quality;
          console.info(`[TKS 3D Interactions] Quality adjusted to: ${this.currentQuality}`);
        }
      });
    },

    setupSearchEffects(rootEl) {
      const scope = rootEl || document;
      const selector = '.search-input, .search-box input, .export-field-search';
      const inputs = scope.querySelectorAll(selector);

      inputs.forEach(input => {
        if (input.dataset.tks3dSearchInit) return;
        input.dataset.tks3dSearchInit = 'true';

        input.style.transformStyle = 'preserve-3d';
        if (!input.style.transition) {
          input.style.transition = 'transform 0.3s cubic-bezier(0.23, 1, 0.32, 1), box-shadow 0.3s ease, border-color 0.3s ease, background-color 0.2s ease';
        }

        const parent = input.parentElement;
        if (parent && (parent.classList.contains('search-input-wrap') || parent.classList.contains('search-box') || parent.classList.contains('export-search-wrap'))) {
          parent.style.transformStyle = 'preserve-3d';
          if (!parent.style.perspective) {
            parent.style.perspective = '800px';
          }
        }

        const onFocus = () => {
          if (this.shouldReduceMotion()) return;
        };

        const onBlur = () => {
          if (this.shouldReduceMotion()) return;
        };

        input.addEventListener('focus', onFocus);
        input.addEventListener('blur', onBlur);

        this._cleanups.push(() => {
          input.removeEventListener('focus', onFocus);
          input.removeEventListener('blur', onBlur);
          delete input.dataset.tks3dSearchInit;
        });
      });
    },

    refresh(rootEl) {
      this.setupCardEffects(rootEl);
      this.setupButtonEffects(rootEl);
      this.setupNavigationEffects(rootEl);
      this.setupTableRowEffects(rootEl);
      this.setupSearchEffects(rootEl);
    },

    destroy() {
      if (this._rowTimers && this._rowTimers.length > 0) {
        this._rowTimers.forEach(t => clearTimeout(t));
        this._rowTimers = [];
      }

      while (this._cleanups.length > 0) {
        const cleanup = this._cleanups.pop();
        try {
          cleanup();
        } catch (err) {
          // ignore cleanup errors
        }
      }
      this.initialized = false;
    }
  };

  // Expose methods globally
  root.TKS3D = TKS3D;
  root.TKSInteractions = TKS3D;
  root.animateTableRows = function(scope) {
    return TKS3D.animateTableRows(scope);
  };

  // Memory management: cleanup on page unload
  root.addEventListener('beforeunload', () => {
    if (TKS3D && typeof TKS3D.destroy === 'function') {
      TKS3D.destroy();
    }
  });

  // Auto-init on DOM readiness
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => TKS3D.init());
  } else {
    TKS3D.init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
