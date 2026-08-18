/**
 * three-bg.js — TKS Dashboard 3D Background Particle System
 *
 * Requirements:
 * - Three.js WebGL particle field (200-400 particles on desktop, 100 on mobile)
 * - Auto theme synchronization (Dark / Light) via MutationObserver
 * - Lifecycle management (pause when tab hidden, resize handler, reduced-motion)
 * - Transparent canvas with zero interaction blocking (z-index: -1, pointer-events: none)
 */

(function() {
  'use strict';

  if (typeof window === 'undefined') {
    return;
  }

  const ParticleBackground = {
    scene: null,
    camera: null,
    renderer: null,
    particles: null,
    animationId: null,
    themeObserver: null,
    initialized: false,
    running: false,
    _onResize: null,
    _onVisibilityChange: null,

    init() {
      if (this.initialized) {
        return;
      }

      if (!window.THREE) {
        console.warn('[TKS 3D] THREE.js not loaded, skipping background');
        return;
      }

      const THREE = window.THREE;
      const width = window.innerWidth || 1920;
      const height = window.innerHeight || 1080;

      // 1. Scene setup with transparent background
      this.scene = new THREE.Scene();

      // 2. Perspective camera
      this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
      this.camera.position.z = 200;

      // 3. Transparent WebGL renderer
      const isMobile = width < 768;
      const dpr = window.devicePixelRatio || 1;
      this.renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: dpr < 2,
        powerPreference: 'low-power'
      });
      this.renderer.setPixelRatio(Math.min(dpr, 2));
      this.renderer.setSize(width, height);
      
      // Register with memory manager
      if (window.TKSMemory) {
        window.TKSMemory.registerContext(this.renderer, 'ParticleBackground');
      }

      // 4. Attach canvas to DOM
      const canvas = this.renderer.domElement;
      canvas.classList.add('tks-bg-canvas');
      canvas.setAttribute('aria-hidden', 'true');
      canvas.setAttribute('role', 'presentation');
      if (document.body) {
        document.body.insertBefore(canvas, document.body.firstChild);
      }

      // 5. Create particle system
      this.createParticles();

      // 6. Synchronize initial theme & listen for changes
      this.syncTheme();
      this.watchTheme();

      // 7. Event listeners (resize & visibility)
      this.bindEvents();

      this.initialized = true;
      this.running = true;
      
      // Listen for quality changes
      this.setupQualityListener();
      
      // Register with visibility manager
      if (window.TKSVisibility) {
        window.TKSVisibility.register(
          'ParticleBackground',
          () => this.pauseAnimation(),
          () => this.resumeAnimation()
        );
      }

      // 8. Reduced-motion check
      if (this.shouldReduceMotion()) {
        this.renderer.render(this.scene, this.camera);
      } else {
        this.animate();
      }
    },

    createParticles() {
      const THREE = window.THREE;
      if (!THREE || !this.scene) return;

      // Get quality settings from performance monitor
      let settings = { particleCount: 300, particleSize: 2 };
      if (window.TKSPerformance && typeof window.TKSPerformance.getQualitySettings === 'function') {
        settings = window.TKSPerformance.getQualitySettings();
      } else {
        // Fallback to manual detection
        const width = window.innerWidth || 1920;
        const isMobile = width < 768;
        settings.particleCount = isMobile ? 100 : 300;
        settings.particleSize = isMobile ? 1.5 : 2;
      }

      const count = settings.particleCount;
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(count * 3);
      const velocities = new Float32Array(count * 3);

      for (let i = 0; i < count * 3; i += 3) {
        positions[i] = (Math.random() - 0.5) * 500;
        positions[i + 1] = (Math.random() - 0.5) * 500;
        positions[i + 2] = (Math.random() - 0.5) * 200;

        velocities[i] = (Math.random() - 0.5) * 0.5;
        velocities[i + 1] = (Math.random() - 0.5) * 0.5;
        velocities[i + 2] = (Math.random() - 0.5) * 0.2;
      }

      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));

      const material = new THREE.PointsMaterial({
        size: settings.particleSize,
        color: new THREE.Color(0x3B82F6),
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });

      this.particles = new THREE.Points(geometry, material);
      this.scene.add(this.particles);
      
      // Track resources with memory manager
      if (window.TKSMemory) {
        window.TKSMemory.trackGeometry(geometry);
        window.TKSMemory.trackMaterial(material);
      }
    },

    syncTheme() {
      if (!this.particles || !this.particles.material) return;
      const isLight = document.documentElement &&
                      document.documentElement.dataset &&
                      document.documentElement.dataset.theme === 'light';

      let primaryColor = '';
      if (typeof getComputedStyle === 'function' && document.documentElement) {
        try {
          primaryColor = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
        } catch (e) {}
      }

      const targetColor = primaryColor || (isLight ? '#2563EB' : '#3B82F6');
      if (this.particles.material.color && typeof this.particles.material.color.set === 'function') {
        this.particles.material.color.set(targetColor);
      }
      this.particles.material.opacity = isLight ? 0.4 : 0.6;

      if (this.renderer && this.scene && this.camera && this.shouldReduceMotion()) {
        this.renderer.render(this.scene, this.camera);
      }
    },

    watchTheme() {
      if (typeof MutationObserver === 'undefined' || !document.documentElement) return;
      if (this.themeObserver) {
        this.themeObserver.disconnect();
      }
      this.themeObserver = new MutationObserver(() => this.syncTheme());
      this.themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme']
      });
    },

    animate() {
      if (!this.running || !this.renderer || !this.scene || !this.camera || !this.particles) return;

      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        this.animationId = window.requestAnimationFrame(() => this.animate());
      }

      const posAttr = this.particles.geometry && this.particles.geometry.attributes
        ? this.particles.geometry.attributes.position
        : null;
      const velAttr = this.particles.geometry && this.particles.geometry.attributes
        ? this.particles.geometry.attributes.velocity
        : null;

      if (posAttr && velAttr) {
        const positions = posAttr.array;
        const velocities = velAttr.array;

        for (let i = 0; i < positions.length; i += 3) {
          positions[i] += velocities[i];
          positions[i + 1] += velocities[i + 1];
          positions[i + 2] += velocities[i + 2];

          // Boundary wrapping inside [-250, 250] on X/Y and [-100, 100] on Z
          if (Math.abs(positions[i]) > 250) positions[i] *= -1;
          if (Math.abs(positions[i + 1]) > 250) positions[i + 1] *= -1;
          if (Math.abs(positions[i + 2]) > 100) positions[i + 2] *= -1;
        }

        posAttr.needsUpdate = true;
      }

      this.particles.rotation.y += 0.0005;
      this.renderer.render(this.scene, this.camera);
      
      // Notify performance monitor
      if (typeof window !== 'undefined' && window.TKSPerformance) {
        window.TKSPerformance.update();
      }
    },

    shouldReduceMotion() {
      return typeof window !== 'undefined' &&
             window.matchMedia &&
             window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    },

    bindEvents() {
      this._onResize = () => this.onResize();
      this._onVisibilityChange = () => this.onVisibilityChange();

      window.addEventListener('resize', this._onResize);
      document.addEventListener('visibilitychange', this._onVisibilityChange);
    },
    
    setupQualityListener() {
      // Listen for quality change events from performance monitor
      window.addEventListener('tks-quality-change', (e) => {
        if (e.detail && e.detail.settings) {
          console.info('[TKS Particle Background] Quality changed, recreating particles...');
          // Recreate particles with new quality settings
          if (this.initialized && !this.shouldReduceMotion()) {
            this.destroy();
            setTimeout(() => this.init(), 100);
          }
        }
      });
    },

    onResize() {
      if (!this.camera || !this.renderer) return;
      const width = window.innerWidth || 1;
      const height = window.innerHeight || 1;

      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);

      if (this.shouldReduceMotion()) {
        this.renderer.render(this.scene, this.camera);
      }
    },

    onVisibilityChange() {
      if (document.hidden) {
        this.pauseAnimation();
      } else if (!this.shouldReduceMotion()) {
        this.resumeAnimation();
      }
    },
    
    pauseAnimation() {
      if (this.animationId) {
        if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
          window.cancelAnimationFrame(this.animationId);
        }
        this.animationId = null;
      }
    },
    
    resumeAnimation() {
      if (!this.animationId && this.running && !this.shouldReduceMotion()) {
        this.animate();
      }
    },

    destroy() {
      this.running = false;
      
      // Unregister from visibility manager
      if (window.TKSVisibility) {
        window.TKSVisibility.unregister('ParticleBackground');
      }
      
      if (this.animationId) {
        if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
          window.cancelAnimationFrame(this.animationId);
        }
        this.animationId = null;
      }
      if (this.themeObserver) {
        this.themeObserver.disconnect();
        this.themeObserver = null;
      }
      if (typeof window !== 'undefined' && this._onResize) {
        window.removeEventListener('resize', this._onResize);
      }
      if (typeof document !== 'undefined' && this._onVisibilityChange) {
        document.removeEventListener('visibilitychange', this._onVisibilityChange);
      }
      if (this.particles) {
        if (this.particles.geometry && typeof this.particles.geometry.dispose === 'function') {
          this.particles.geometry.dispose();
        }
        if (this.particles.material && typeof this.particles.material.dispose === 'function') {
          this.particles.material.dispose();
        }
        if (this.scene && typeof this.scene.remove === 'function') {
          this.scene.remove(this.particles);
        }
        this.particles = null;
      }
      if (this.renderer) {
        const canvas = this.renderer.domElement;
        if (canvas && canvas.parentNode) {
          canvas.parentNode.removeChild(canvas);
        }
        
        // Unregister from memory manager
        if (window.TKSMemory) {
          window.TKSMemory.unregisterContext(this.renderer);
        }
        
        if (typeof this.renderer.dispose === 'function') {
          this.renderer.dispose();
        }
        this.renderer = null;
      }
      this.scene = null;
      this.camera = null;
      this.initialized = false;
    }
  };

  // Expose globally
  window.ParticleBackground = ParticleBackground;
  window.TKSParticleBackground = ParticleBackground;

  // Memory management utilities
  window.addEventListener('beforeunload', function() {
    if (ParticleBackground && typeof ParticleBackground.destroy === 'function') {
      ParticleBackground.destroy();
    }
  });

  // Auto-init on DOM ready
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        ParticleBackground.init();
      });
    } else {
      ParticleBackground.init();
    }
  }
})();
