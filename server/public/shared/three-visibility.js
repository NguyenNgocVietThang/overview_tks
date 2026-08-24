/**
 * three-visibility.js — TKS Dashboard 3D Visibility Manager
 *
 * Implements Task 12: Tab Visibility Handling (3D Design.md)
 * - Centralized visibility state management
 * - Automatic pause/resume of all 3D animations when tab is hidden/shown
 * - Battery and resource optimization
 * - Coordination between all 3D components
 */

(function(root) {
  'use strict';

  if (typeof window === 'undefined') {
    return;
  }

  const TKSVisibility = {
    isVisible: true,
    wasVisible: true,
    hiddenAt: null,
    visibleAt: null,
    totalHiddenTime: 0,
    
    // Registered components
    components: new Map(),
    
    init() {
      this.isVisible = !document.hidden;
      this.visibleAt = Date.now();
      
      // Listen for visibility changes
      document.addEventListener('visibilitychange', () => this.onVisibilityChange());
      
      // Also listen for page focus/blur as backup
      window.addEventListener('focus', () => this.onFocus());
      window.addEventListener('blur', () => this.onBlur());
      
      console.info('[TKS Visibility] Manager initialized, page is', this.isVisible ? 'visible' : 'hidden');
      
      return this;
    },
    
    /**
     * Register a component for visibility management
     */
    register(name, pauseCallback, resumeCallback) {
      if (!name) {
        console.warn('[TKS Visibility] Component name required');
        return;
      }
      
      this.components.set(name, {
        name: name,
        pause: pauseCallback,
        resume: resumeCallback,
        isPaused: false,
        registeredAt: Date.now()
      });
      
      console.info(`[TKS Visibility] Registered component: ${name} (${this.components.size} total)`);
      
      // If page is currently hidden, immediately pause this component
      if (!this.isVisible && typeof pauseCallback === 'function') {
        pauseCallback();
      }
    },
    
    /**
     * Unregister a component
     */
    unregister(name) {
      if (this.components.has(name)) {
        this.components.delete(name);
        console.info(`[TKS Visibility] Unregistered component: ${name} (${this.components.size} remaining)`);
      }
    },
    
    /**
     * Handle visibility change
     */
    onVisibilityChange() {
      const nowVisible = !document.hidden;
      
      // Only process if state actually changed
      if (nowVisible === this.isVisible) {
        return;
      }
      
      this.wasVisible = this.isVisible;
      this.isVisible = nowVisible;
      
      if (nowVisible) {
        // Page became visible
        const now = Date.now();
        this.visibleAt = now;
        
        if (this.hiddenAt) {
          const hiddenDuration = now - this.hiddenAt;
          this.totalHiddenTime += hiddenDuration;
          console.info(`[TKS Visibility] Page visible (was hidden for ${(hiddenDuration / 1000).toFixed(1)}s)`);
        } else {
          console.info('[TKS Visibility] Page visible');
        }
        
        this.resumeAll();
      } else {
        // Page became hidden
        this.hiddenAt = Date.now();
        console.info('[TKS Visibility] Page hidden');
        
        this.pauseAll();
      }
    },
    
    /**
     * Handle window focus
     */
    onFocus() {
      // Backup mechanism in case visibilitychange doesn't fire
      if (!this.isVisible) {
        console.info('[TKS Visibility] Window focused (backup trigger)');
        this.isVisible = true;
        this.visibleAt = Date.now();
        this.resumeAll();
      }
    },
    
    /**
     * Handle window blur
     */
    onBlur() {
      // Note: We don't automatically pause on blur because user might be
      // looking at the page in the background. Only pause on actual visibility loss.
    },
    
    /**
     * Pause all registered components
     */
    pauseAll() {
      let pausedCount = 0;
      
      this.components.forEach((component) => {
        if (!component.isPaused && typeof component.pause === 'function') {
          try {
            component.pause();
            component.isPaused = true;
            pausedCount++;
          } catch (err) {
            console.error(`[TKS Visibility] Error pausing ${component.name}:`, err);
          }
        }
      });
      
      if (pausedCount > 0) {
        console.info(`[TKS Visibility] Paused ${pausedCount} component(s)`);
      }
      
      // Dispatch global event
      window.dispatchEvent(new CustomEvent('tks-all-paused'));
    },
    
    /**
     * Resume all registered components
     */
    resumeAll() {
      let resumedCount = 0;
      
      this.components.forEach((component) => {
        if (component.isPaused && typeof component.resume === 'function') {
          try {
            component.resume();
            component.isPaused = false;
            resumedCount++;
          } catch (err) {
            console.error(`[TKS Visibility] Error resuming ${component.name}:`, err);
          }
        }
      });
      
      if (resumedCount > 0) {
        console.info(`[TKS Visibility] Resumed ${resumedCount} component(s)`);
      }
      
      // Dispatch global event
      window.dispatchEvent(new CustomEvent('tks-all-resumed'));
    },
    
    /**
     * Manually pause a specific component
     */
    pause(name) {
      const component = this.components.get(name);
      if (component && !component.isPaused && typeof component.pause === 'function') {
        try {
          component.pause();
          component.isPaused = true;
          console.info(`[TKS Visibility] Manually paused: ${name}`);
        } catch (err) {
          console.error(`[TKS Visibility] Error pausing ${name}:`, err);
        }
      }
    },
    
    /**
     * Manually resume a specific component
     */
    resume(name) {
      const component = this.components.get(name);
      if (component && component.isPaused && typeof component.resume === 'function') {
        try {
          component.resume();
          component.isPaused = false;
          console.info(`[TKS Visibility] Manually resumed: ${name}`);
        } catch (err) {
          console.error(`[TKS Visibility] Error resuming ${name}:`, err);
        }
      }
    },
    
    /**
     * Get visibility statistics
     */
    getStats() {
      const now = Date.now();
      const currentSessionDuration = now - (this.visibleAt || now);
      
      return {
        isVisible: this.isVisible,
        currentState: this.isVisible ? 'visible' : 'hidden',
        hiddenAt: this.hiddenAt,
        visibleAt: this.visibleAt,
        totalHiddenTime: this.totalHiddenTime,
        totalHiddenSeconds: (this.totalHiddenTime / 1000).toFixed(1),
        currentSessionDuration: currentSessionDuration,
        currentSessionSeconds: (currentSessionDuration / 1000).toFixed(1),
        registeredComponents: Array.from(this.components.keys()),
        componentCount: this.components.size,
        pausedComponents: Array.from(this.components.values())
          .filter(c => c.isPaused)
          .map(c => c.name)
      };
    },
    
    /**
     * Log visibility report
     */
    logReport() {
      const stats = this.getStats();
      console.group('TKS Visibility Report');
      console.log('Current State:', stats.currentState);
      console.log('Total Hidden Time:', stats.totalHiddenSeconds + 's');
      console.log('Registered Components:', stats.componentCount);
      console.log('Component Names:', stats.registeredComponents);
      console.log('Paused Components:', stats.pausedComponents);
      console.groupEnd();
      return stats;
    },
    
    /**
     * Check if page is currently visible
     */
    isPageVisible() {
      return this.isVisible;
    },
    
    /**
     * Clean up
     */
    destroy() {
      this.components.clear();
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
      window.removeEventListener('focus', this.onFocus);
      window.removeEventListener('blur', this.onBlur);
    }
  };

  // Expose globally
  root.TKSVisibility = TKSVisibility;
  root.TKSVisibilityManager = TKSVisibility;

  // Auto-init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => TKSVisibility.init());
  } else {
    TKSVisibility.init();
  }

})(typeof window !== 'undefined' ? window : globalThis);
