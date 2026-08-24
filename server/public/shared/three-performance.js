/**
 * three-performance.js — TKS Dashboard 3D Performance Monitor & Adaptive Quality
 *
 * Implements Task 12: Performance Optimization and Testing (3D Design.md)
 * - Real-time FPS tracking and performance monitoring
 * - Adaptive quality system based on device capability
 * - Memory usage tracking and WebGL context management
 * - Automatic quality degradation on low-end devices
 * - Performance reports and diagnostics
 */

(function(root) {
  'use strict';

  if (typeof window === 'undefined') {
    return;
  }

  const TKSPerformance = {
    // FPS tracking
    fps: 0,
    frames: 0,
    lastTime: null,
    fpsHistory: [],
    maxFpsHistory: 60,
    
    // Quality settings
    quality: 'high', // 'high', 'medium', 'low', 'minimal'
    autoAdjust: true,
    
    // Performance thresholds
    thresholds: {
      fpsGood: 55,      // Above this = good performance
      fpsMedium: 40,    // 40-55 = medium performance
      fpsLow: 25,       // 25-40 = low performance
      fpsMinimal: 25    // Below 25 = switch to minimal
    },
    
    // Device capabilities
    capabilities: {
      isMobile: false,
      isLowEnd: false,
      maxParticles: 300,
      pixelRatio: 1,
      webglSupported: false,
      reducedMotion: false
    },
    
    // Monitoring state
    monitoring: false,
    monitorInterval: null,
    performanceEntries: [],
    
    // Quality adjustment
    lastAdjustment: 0,
    adjustmentCooldown: 5000, // Don't adjust more than once per 5 seconds
    consecutiveLowFrames: 0,
    
    // Memory tracking
    memoryWarningShown: false,
    lastMemoryCheck: 0,
    
    init() {
      this.detectCapabilities();
      this.setInitialQuality();
      this.lastTime = performance.now();
      
      // Start monitoring if auto-adjust is enabled
      if (this.autoAdjust) {
        this.startMonitoring();
      }
      
      // Listen for visibility changes
      document.addEventListener('visibilitychange', () => this.onVisibilityChange());
      
      // Memory warning on low memory devices
      if (this.capabilities.isLowEnd) {
        console.info('[TKS Performance] Low-end device detected, running in optimized mode');
      }
      
      return this;
    },
    
    detectCapabilities() {
      const width = window.innerWidth || 1920;
      const userAgent = navigator.userAgent || '';
      
      // Detect mobile
      this.capabilities.isMobile = width < 768 || 
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
      
      // Detect low-end device
      const cores = navigator.hardwareConcurrency || 2;
      const memory = navigator.deviceMemory || 4;
      this.capabilities.isLowEnd = (cores <= 2 || memory <= 2) || this.capabilities.isMobile;
      
      // Set max particles based on device
      if (this.capabilities.isLowEnd) {
        this.capabilities.maxParticles = 100;
      } else if (this.capabilities.isMobile) {
        this.capabilities.maxParticles = 150;
      } else {
        this.capabilities.maxParticles = 300;
      }
      
      // Pixel ratio (cap at 2 for performance)
      this.capabilities.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      
      // WebGL support
      try {
        const canvas = document.createElement('canvas');
        this.capabilities.webglSupported = !!(
          canvas.getContext('webgl') || 
          canvas.getContext('experimental-webgl')
        );
      } catch (e) {
        this.capabilities.webglSupported = false;
      }
      
      // Reduced motion preference
      this.capabilities.reducedMotion = window.matchMedia && 
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    },
    
    setInitialQuality() {
      if (this.capabilities.reducedMotion) {
        this.quality = 'minimal';
        this.autoAdjust = false;
        return;
      }
      
      if (!this.capabilities.webglSupported) {
        this.quality = 'minimal';
        this.autoAdjust = false;
        return;
      }
      
      if (this.capabilities.isLowEnd) {
        this.quality = 'low';
      } else if (this.capabilities.isMobile) {
        this.quality = 'medium';
      } else {
        this.quality = 'high';
      }
    },
    
    update() {
      if (!this.monitoring) return;
      
      this.frames++;
      const now = performance.now();
      
      // Calculate FPS every second
      if (now >= this.lastTime + 1000) {
        this.fps = Math.round((this.frames * 1000) / (now - this.lastTime));
        this.frames = 0;
        this.lastTime = now;
        
        // Add to history
        this.fpsHistory.push(this.fps);
        if (this.fpsHistory.length > this.maxFpsHistory) {
          this.fpsHistory.shift();
        }
        
        // Check if FPS is low
        if (this.fps < this.thresholds.fpsLow) {
          this.consecutiveLowFrames++;
          
          if (this.fps < this.thresholds.fpsMinimal) {
            console.warn('[TKS Performance] Critical FPS detected:', this.fps);
          }
        } else {
          this.consecutiveLowFrames = 0;
        }
        
        // Auto-adjust quality if needed
        if (this.autoAdjust && this.shouldAdjustQuality()) {
          this.adjustQuality();
        }
      }
    },
    
    shouldAdjustQuality() {
      const now = performance.now();
      
      // Don't adjust too frequently
      if (now - this.lastAdjustment < this.adjustmentCooldown) {
        return false;
      }
      
      // Need at least 5 FPS samples
      if (this.fpsHistory.length < 5) {
        return false;
      }
      
      // Calculate average FPS
      const avgFps = this.getAverageFPS();
      
      // Adjust down if performance is poor
      if (avgFps < this.thresholds.fpsLow && this.quality !== 'minimal') {
        return true;
      }
      
      // Adjust up if performance is good and we're not at highest quality
      if (avgFps > this.thresholds.fpsGood && this.quality !== 'high' && !this.capabilities.isLowEnd) {
        return true;
      }
      
      return false;
    },
    
    adjustQuality() {
      const avgFps = this.getAverageFPS();
      const oldQuality = this.quality;
      
      if (avgFps < this.thresholds.fpsMinimal && this.quality !== 'minimal') {
        this.quality = 'minimal';
      } else if (avgFps < this.thresholds.fpsLow && this.quality === 'high') {
        this.quality = 'medium';
      } else if (avgFps < this.thresholds.fpsMedium && (this.quality === 'medium' || this.quality === 'high')) {
        this.quality = 'low';
      } else if (avgFps > this.thresholds.fpsGood && this.quality === 'low') {
        this.quality = 'medium';
      } else if (avgFps > this.thresholds.fpsGood && this.quality === 'medium' && !this.capabilities.isLowEnd) {
        this.quality = 'high';
      }
      
      if (oldQuality !== this.quality) {
        console.info(`[TKS Performance] Quality adjusted: ${oldQuality} → ${this.quality} (FPS: ${avgFps})`);
        this.lastAdjustment = performance.now();
        
        // Trigger quality change event
        this.applyQualitySettings();
      }
    },
    
    applyQualitySettings() {
      // Emit custom event that other components can listen to
      const event = new CustomEvent('tks-quality-change', {
        detail: {
          quality: this.quality,
          capabilities: this.capabilities,
          settings: this.getQualitySettings()
        }
      });
      window.dispatchEvent(event);
      
      // Update particle background if available
      if (window.ParticleBackground && window.ParticleBackground.initialized) {
        this.updateParticleQuality();
      }
    },
    
    updateParticleQuality() {
      const bg = window.ParticleBackground;
      if (!bg || !bg.particles) return;
      
      const settings = this.getQualitySettings();
      
      // Update particle count by recreating geometry
      if (bg.particles.geometry) {
        const currentCount = bg.particles.geometry.attributes.position.count;
        if (currentCount !== settings.particleCount) {
          console.info(`[TKS Performance] Updating particle count: ${currentCount} → ${settings.particleCount}`);
          // Trigger background recreation
          if (typeof bg.destroy === 'function' && typeof bg.init === 'function') {
            bg.destroy();
            setTimeout(() => bg.init(), 100);
          }
        }
      }
    },
    
    getQualitySettings() {
      const settings = {
        particleCount: 300,
        pixelRatio: 1,
        antialias: true,
        shadowsEnabled: true,
        particleSize: 2,
        animationSpeed: 1,
        glowEffects: true
      };
      
      switch (this.quality) {
        case 'high':
          settings.particleCount = this.capabilities.isLowEnd ? 150 : 300;
          settings.pixelRatio = Math.min(this.capabilities.pixelRatio, 2);
          settings.antialias = true;
          settings.shadowsEnabled = true;
          settings.particleSize = 2;
          settings.animationSpeed = 1;
          settings.glowEffects = true;
          break;
          
        case 'medium':
          settings.particleCount = this.capabilities.isMobile ? 100 : 200;
          settings.pixelRatio = Math.min(this.capabilities.pixelRatio, 1.5);
          settings.antialias = this.capabilities.pixelRatio < 2;
          settings.shadowsEnabled = true;
          settings.particleSize = 1.8;
          settings.animationSpeed = 1;
          settings.glowEffects = true;
          break;
          
        case 'low':
          settings.particleCount = 100;
          settings.pixelRatio = 1;
          settings.antialias = false;
          settings.shadowsEnabled = false;
          settings.particleSize = 1.5;
          settings.animationSpeed = 0.8;
          settings.glowEffects = false;
          break;
          
        case 'minimal':
          settings.particleCount = 50;
          settings.pixelRatio = 1;
          settings.antialias = false;
          settings.shadowsEnabled = false;
          settings.particleSize = 1;
          settings.animationSpeed = 0.5;
          settings.glowEffects = false;
          break;
      }
      
      return settings;
    },
    
    getAverageFPS() {
      if (this.fpsHistory.length === 0) return 60;
      const sum = this.fpsHistory.reduce((a, b) => a + b, 0);
      return Math.round(sum / this.fpsHistory.length);
    },
    
    getMinFPS() {
      if (this.fpsHistory.length === 0) return 60;
      return Math.min(...this.fpsHistory);
    },
    
    getMaxFPS() {
      if (this.fpsHistory.length === 0) return 60;
      return Math.max(...this.fpsHistory);
    },
    
    startMonitoring() {
      if (this.monitoring) return;
      
      this.monitoring = true;
      this.lastTime = performance.now();
      this.frames = 0;
      
      console.info('[TKS Performance] Monitoring started', {
        quality: this.quality,
        capabilities: this.capabilities
      });
    },
    
    stopMonitoring() {
      this.monitoring = false;
      if (this.monitorInterval) {
        clearInterval(this.monitorInterval);
        this.monitorInterval = null;
      }
    },
    
    onVisibilityChange() {
      if (document.hidden) {
        this.stopMonitoring();
        console.info('[TKS Performance] Tab hidden, pausing monitoring');
        
        // Notify all 3D components to pause
        window.dispatchEvent(new CustomEvent('tks-visibility-hidden'));
      } else {
        console.info('[TKS Performance] Tab visible, resuming monitoring');
        
        // Notify all 3D components to resume
        window.dispatchEvent(new CustomEvent('tks-visibility-visible'));
        
        if (this.autoAdjust) {
          // Resume monitoring after a short delay
          setTimeout(() => {
            this.startMonitoring();
          }, 500);
        }
      }
    },
    
    checkMemory() {
      if (!performance.memory) return null;
      
      const now = performance.now();
      if (now - this.lastMemoryCheck < 5000) {
        return null; // Don't check too frequently
      }
      
      this.lastMemoryCheck = now;
      
      const memory = {
        used: performance.memory.usedJSHeapSize,
        total: performance.memory.totalJSHeapSize,
        limit: performance.memory.jsHeapSizeLimit,
        usedMB: (performance.memory.usedJSHeapSize / 1048576).toFixed(2),
        totalMB: (performance.memory.totalJSHeapSize / 1048576).toFixed(2),
        limitMB: (performance.memory.jsHeapSizeLimit / 1048576).toFixed(2),
        percentage: ((performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit) * 100).toFixed(1)
      };
      
      // Warn if memory usage is high
      if (memory.percentage > 90 && !this.memoryWarningShown) {
        console.warn('[TKS Performance] High memory usage detected:', memory);
        this.memoryWarningShown = true;
        
        // Try to reduce quality
        if (this.quality !== 'minimal' && this.autoAdjust) {
          this.quality = 'low';
          this.applyQualitySettings();
        }
      }
      
      return memory;
    },
    
    getReport() {
      const memory = this.checkMemory();
      
      return {
        fps: {
          current: this.fps,
          average: this.getAverageFPS(),
          min: this.getMinFPS(),
          max: this.getMaxFPS(),
          history: [...this.fpsHistory]
        },
        quality: {
          current: this.quality,
          autoAdjust: this.autoAdjust,
          settings: this.getQualitySettings()
        },
        capabilities: { ...this.capabilities },
        memory: memory,
        thresholds: { ...this.thresholds },
        monitoring: this.monitoring,
        timestamp: new Date().toISOString()
      };
    },
    
    logReport() {
      const report = this.getReport();
      console.group('TKS Performance Report');
      console.log('FPS:', report.fps);
      console.log('Quality:', report.quality);
      console.log('Capabilities:', report.capabilities);
      if (report.memory) {
        console.log('Memory:', `${report.memory.usedMB}MB / ${report.memory.limitMB}MB (${report.memory.percentage}%)`);
      }
      console.groupEnd();
      return report;
    },
    
    // API for external usage
    setQuality(quality) {
      const validQualities = ['high', 'medium', 'low', 'minimal'];
      if (validQualities.includes(quality)) {
        this.quality = quality;
        this.autoAdjust = false; // Disable auto-adjust when manually set
        this.applyQualitySettings();
      }
    },
    
    enableAutoAdjust() {
      this.autoAdjust = true;
      this.startMonitoring();
    },
    
    disableAutoAdjust() {
      this.autoAdjust = false;
    },
    
    reset() {
      this.fps = 0;
      this.frames = 0;
      this.fpsHistory = [];
      this.consecutiveLowFrames = 0;
      this.lastAdjustment = 0;
      this.memoryWarningShown = false;
      this.detectCapabilities();
      this.setInitialQuality();
    }
  };

  // Expose globally
  root.TKSPerformance = TKSPerformance;
  root.TKSPerf = TKSPerformance; // Shorter alias

  // Auto-init on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => TKSPerformance.init());
  } else {
    TKSPerformance.init();
  }

  // Integrate with animation loops
  // Listen for custom events from animation systems
  window.addEventListener('tks-frame-rendered', () => {
    TKSPerformance.update();
  });

})(typeof window !== 'undefined' ? window : globalThis);
