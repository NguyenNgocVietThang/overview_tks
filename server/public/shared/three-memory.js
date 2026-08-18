/**
 * three-memory.js — TKS Dashboard 3D Memory Management Utilities
 *
 * Implements Task 12: Memory Management (3D Design.md)
 * - WebGL context tracking and disposal
 * - Geometry and material cleanup utilities
 * - Memory leak detection and prevention
 * - Resource pooling for frequently created objects
 * - Automatic cleanup on page unload
 */

(function(root) {
  'use strict';

  if (typeof window === 'undefined') {
    return;
  }

  const TKSMemory = {
    // Track all WebGL contexts
    webglContexts: [],
    maxContexts: 8, // Browser limit is usually 8-16
    
    // Track disposable resources
    geometries: new Set(),
    materials: new Set(),
    textures: new Set(),
    
    // Memory warnings
    warningsIssued: 0,
    maxWarnings: 3,
    
    init() {
      this.setupContextLossHandlers();
      this.setupUnloadCleanup();
      this.monitorContextCount();
      return this;
    },
    
    /**
     * Register a WebGL context for tracking
     */
    registerContext(renderer, label) {
      if (!renderer || !renderer.domElement) {
        console.warn('[TKS Memory] Invalid renderer provided');
        return;
      }
      
      const context = {
        renderer: renderer,
        label: label || 'unnamed',
        canvas: renderer.domElement,
        createdAt: Date.now()
      };
      
      this.webglContexts.push(context);
      
      // Check if we're approaching the limit
      if (this.webglContexts.length >= this.maxContexts - 2) {
        console.warn(`[TKS Memory] WebGL context count is high: ${this.webglContexts.length}/${this.maxContexts}`);
        this.warningsIssued++;
      }
      
      return context;
    },
    
    /**
     * Unregister and dispose a WebGL context
     */
    unregisterContext(renderer) {
      const index = this.webglContexts.findIndex(ctx => ctx.renderer === renderer);
      if (index !== -1) {
        const context = this.webglContexts[index];
        
        // Dispose renderer
        if (renderer && typeof renderer.dispose === 'function') {
          renderer.dispose();
        }
        
        // Remove from tracking
        this.webglContexts.splice(index, 1);
        
        console.info(`[TKS Memory] Context disposed: ${context.label} (${this.webglContexts.length} remaining)`);
      }
    },
    
    /**
     * Track a geometry for later disposal
     */
    trackGeometry(geometry) {
      if (geometry && typeof geometry.dispose === 'function') {
        this.geometries.add(geometry);
      }
      return geometry;
    },
    
    /**
     * Track a material for later disposal
     */
    trackMaterial(material) {
      if (material && typeof material.dispose === 'function') {
        this.materials.add(material);
      }
      return material;
    },
    
    /**
     * Track a texture for later disposal
     */
    trackTexture(texture) {
      if (texture && typeof texture.dispose === 'function') {
        this.textures.add(texture);
      }
      return texture;
    },
    
    /**
     * Dispose a THREE.js scene and all its resources
     */
    disposeScene(scene) {
      if (!scene || !scene.traverse) {
        return;
      }
      
      scene.traverse((object) => {
        // Dispose geometry
        if (object.geometry) {
          this.disposeGeometry(object.geometry);
        }
        
        // Dispose material(s)
        if (object.material) {
          if (Array.isArray(object.material)) {
            object.material.forEach(material => this.disposeMaterial(material));
          } else {
            this.disposeMaterial(object.material);
          }
        }
        
        // Dispose textures
        if (object.texture) {
          this.disposeTexture(object.texture);
        }
      });
      
      // Clear scene
      while (scene.children.length > 0) {
        scene.remove(scene.children[0]);
      }
    },
    
    /**
     * Dispose a geometry
     */
    disposeGeometry(geometry) {
      if (!geometry) return;
      
      if (typeof geometry.dispose === 'function') {
        geometry.dispose();
      }
      
      this.geometries.delete(geometry);
    },
    
    /**
     * Dispose a material and its textures
     */
    disposeMaterial(material) {
      if (!material) return;
      
      // Dispose textures referenced by material
      const textureProperties = ['map', 'lightMap', 'bumpMap', 'normalMap', 
        'specularMap', 'envMap', 'alphaMap', 'aoMap', 'displacementMap', 
        'emissiveMap', 'gradientMap', 'metalnessMap', 'roughnessMap'];
      
      textureProperties.forEach(prop => {
        if (material[prop] && typeof material[prop].dispose === 'function') {
          this.disposeTexture(material[prop]);
        }
      });
      
      // Dispose material
      if (typeof material.dispose === 'function') {
        material.dispose();
      }
      
      this.materials.delete(material);
    },
    
    /**
     * Dispose a texture
     */
    disposeTexture(texture) {
      if (!texture) return;
      
      if (typeof texture.dispose === 'function') {
        texture.dispose();
      }
      
      this.textures.delete(texture);
    },
    
    /**
     * Dispose all tracked resources
     */
    disposeAll() {
      console.info('[TKS Memory] Disposing all tracked resources...');
      
      // Dispose geometries
      this.geometries.forEach(geometry => {
        if (typeof geometry.dispose === 'function') {
          geometry.dispose();
        }
      });
      this.geometries.clear();
      
      // Dispose materials
      this.materials.forEach(material => {
        if (typeof material.dispose === 'function') {
          material.dispose();
        }
      });
      this.materials.clear();
      
      // Dispose textures
      this.textures.forEach(texture => {
        if (typeof texture.dispose === 'function') {
          texture.dispose();
        }
      });
      this.textures.clear();
      
      // Dispose all WebGL contexts
      while (this.webglContexts.length > 0) {
        const context = this.webglContexts[0];
        this.unregisterContext(context.renderer);
      }
      
      console.info('[TKS Memory] All resources disposed');
    },
    
    /**
     * Setup context loss/restore handlers
     */
    setupContextLossHandlers() {
      // Listen for webglcontextlost events on document
      document.addEventListener('webglcontextlost', (e) => {
        console.warn('[TKS Memory] WebGL context lost', e);
        e.preventDefault(); // Attempt to restore
      }, false);
      
      document.addEventListener('webglcontextrestored', (e) => {
        console.info('[TKS Memory] WebGL context restored', e);
      }, false);
    },
    
    /**
     * Monitor context count and warn if too high
     */
    monitorContextCount() {
      setInterval(() => {
        if (this.webglContexts.length > 0) {
          const activeContexts = this.webglContexts.filter(ctx => {
            // Check if canvas is still in DOM
            return ctx.canvas && document.contains(ctx.canvas);
          });
          
          // Remove stale contexts
          if (activeContexts.length !== this.webglContexts.length) {
            this.webglContexts = activeContexts;
          }
        }
      }, 10000); // Check every 10 seconds
    },
    
    /**
     * Setup cleanup on page unload
     */
    setupUnloadCleanup() {
      window.addEventListener('beforeunload', () => {
        this.disposeAll();
      });
      
      // Also cleanup on pagehide (for mobile browsers)
      window.addEventListener('pagehide', () => {
        this.disposeAll();
      });
    },
    
    /**
     * Get memory usage report
     */
    getReport() {
      const report = {
        contexts: this.webglContexts.length,
        geometries: this.geometries.size,
        materials: this.materials.size,
        textures: this.textures.size,
        warnings: this.warningsIssued,
        contextDetails: this.webglContexts.map(ctx => ({
          label: ctx.label,
          age: Date.now() - ctx.createdAt,
          inDom: document.contains(ctx.canvas)
        }))
      };
      
      // Add browser memory if available
      if (performance.memory) {
        report.memory = {
          used: performance.memory.usedJSHeapSize,
          total: performance.memory.totalJSHeapSize,
          limit: performance.memory.jsHeapSizeLimit,
          usedMB: (performance.memory.usedJSHeapSize / 1048576).toFixed(2),
          percentage: ((performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit) * 100).toFixed(1)
        };
      }
      
      return report;
    },

    /**
     * Check current JS heap usage (when performance.memory is available).
     * Returns { used, total, limit, usedMB, percentage } or null.
     */
    checkMemory() {
      if (!performance.memory) return null;
      return {
        used: performance.memory.usedJSHeapSize,
        total: performance.memory.totalJSHeapSize,
        limit: performance.memory.jsHeapSizeLimit,
        usedMB: (performance.memory.usedJSHeapSize / 1048576).toFixed(2),
        percentage: ((performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit) * 100).toFixed(1)
      };
    },

    /**
     * Log memory report
     */
    logReport() {
      const report = this.getReport();
      console.group('🧹 TKS Memory Report');
      console.log('WebGL Contexts:', report.contexts);
      console.log('Tracked Geometries:', report.geometries);
      console.log('Tracked Materials:', report.materials);
      console.log('Tracked Textures:', report.textures);
      if (report.memory) {
        console.log('Memory:', `${report.memory.usedMB}MB / ${(report.memory.limit / 1048576).toFixed(0)}MB (${report.memory.percentage}%)`);
      }
      if (report.contextDetails.length > 0) {
        console.table(report.contextDetails);
      }
      console.groupEnd();
      return report;
    },
    
    /**
     * Force garbage collection (if available)
     */
    forceGC() {
      // Only works in Chrome with --js-flags=--expose-gc
      if (window.gc) {
        console.info('[TKS Memory] Running garbage collection...');
        window.gc();
      } else {
        console.warn('[TKS Memory] GC not available (requires Chrome with --js-flags=--expose-gc)');
      }
    },
    
    /**
     * Check for memory leaks
     */
    checkLeaks() {
      const issues = [];
      
      // Check for contexts not in DOM
      this.webglContexts.forEach(ctx => {
        if (!document.contains(ctx.canvas)) {
          issues.push({
            type: 'orphaned_context',
            label: ctx.label,
            age: Date.now() - ctx.createdAt
          });
        }
      });
      
      // Check for excessive resource count
      if (this.geometries.size > 100) {
        issues.push({
          type: 'excessive_geometries',
          count: this.geometries.size
        });
      }
      
      if (this.materials.size > 100) {
        issues.push({
          type: 'excessive_materials',
          count: this.materials.size
        });
      }
      
      if (this.textures.size > 50) {
        issues.push({
          type: 'excessive_textures',
          count: this.textures.size
        });
      }
      
      // Check memory usage if available
      if (performance.memory) {
        const percentage = (performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit) * 100;
        if (percentage > 80) {
          issues.push({
            type: 'high_memory_usage',
            percentage: percentage.toFixed(1)
          });
        }
      }
      
      if (issues.length > 0) {
        console.warn('[TKS Memory] Potential memory leaks detected:', issues);
      }
      
      return issues;
    }
  };

  // Expose globally
  root.TKSMemory = TKSMemory;
  root.TKSMemoryManager = TKSMemory;

  // Auto-init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => TKSMemory.init());
  } else {
    TKSMemory.init();
  }

  // Periodic leak check (every 30 seconds in development)
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    setInterval(() => {
      TKSMemory.checkLeaks();
    }, 30000);
  }

})(typeof window !== 'undefined' ? window : globalThis);
