/**
 * three-charts.js — TKS Dashboard 3D Chart Visualizations
 *
 * Provides `window.TKSCharts3D` with methods:
 *  - renderRevenue3D(canvasId, data)   — 3D bar chart for revenue
 *  - dispose(canvasId)                  — release WebGL resources
 *
 * Requirements (from 3D Design.md Task 5):
 *  - THREE.js must be loaded first (window.THREE)
 *  - BoxGeometry bars, height proportional to revenue
 *  - Ambient + Directional lighting, metalness material
 *  - Auto-rotating camera orbit
 *  - Canvas-texture axis labels
 *  - Reduced-motion: pause orbit
 *  - Empty-state fallback on 2D canvas
 *  - Resize-responsive
 */

(function () {
  'use strict';

  if (typeof window === 'undefined') return;

  window.TKSCharts3D = {
    /** Map of canvasId -> { renderer, scene, camera, animId, resizeHandler } */
    _contexts: {},

    /**
     * Render a 3D bar chart into <canvas id="canvasId">.
     * @param {string} canvasId
     * @param {Array<{label:string, revenue:number}>} data
     */
    renderRevenue3D: function (canvasId, data) {
      if (!window.THREE) {
        console.warn('[TKSCharts3D] THREE.js not loaded, skipping 3D chart');
        this._showEmptyState(canvasId, 'THREE.js unavailable');
        return;
      }

      var canvas = document.getElementById(canvasId);
      if (!canvas) {
        console.warn('[TKSCharts3D] Canvas not found:', canvasId);
        return;
      }

      if (!data || !data.length) {
        this._showEmptyState(canvasId, 'Chua co du lieu');
        return;
      }

      // Dispose any previous context on this canvas
      this.dispose(canvasId);

      var THREE = window.THREE;
      var w = canvas.clientWidth  || canvas.width  || 800;
      var h = canvas.clientHeight || canvas.height || 400;

      /* ---- Get quality settings ---- */
      var qualitySettings = { antialias: true, pixelRatio: 2 };
      if (window.TKSPerformance && typeof window.TKSPerformance.getQualitySettings === 'function') {
        qualitySettings = window.TKSPerformance.getQualitySettings();
      }

      /* ---- Scene ---- */
      var scene = new THREE.Scene();
      scene.background = null;

      /* ---- Camera ---- */
      var camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 2000);
      var orbitR = data.length * 2.5;
      camera.position.set(orbitR, data.length * 1.4, orbitR);
      camera.lookAt(0, 4, 0);

      /* ---- Renderer ---- */
      var renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        alpha: true,
        antialias: qualitySettings.antialias
      });
      renderer.setSize(w, h);
      renderer.setPixelRatio(Math.min(qualitySettings.pixelRatio || window.devicePixelRatio, 2));
      
      // Register with memory manager
      if (window.TKSMemory) {
        window.TKSMemory.registerContext(renderer, 'Chart3D-' + canvasId);
      }

      /* ---- Lighting ---- */
      var ambient = new THREE.AmbientLight(0xffffff, 0.65);
      scene.add(ambient);

      var dirLight = new THREE.DirectionalLight(0xffffff, 0.85);
      dirLight.position.set(8, 14, 10);
      scene.add(dirLight);

      var rimLight = new THREE.DirectionalLight(0x3B82F6, 0.4);
      rimLight.position.set(-8, 2, -6);
      scene.add(rimLight);

      /* ---- Grid ---- */
      var gridHelper = new THREE.GridHelper(data.length * 3, data.length, 0x334155, 0x1E293B);
      gridHelper.material.transparent = true;
      gridHelper.material.opacity = 0.45;
      scene.add(gridHelper);

      /* ---- Bars ---- */
      var maxVal = 0;
      for (var i = 0; i < data.length; i++) {
        var v = data[i].revenue || 0;
        if (v > maxVal) maxVal = v;
      }
      if (maxVal === 0) maxVal = 1;

      var BAR_W   = 1.6;
      var BAR_D   = 1.6;
      var MAX_H   = 14;
      var SPACING = 2.8;
      var offset  = -(data.length / 2) * SPACING + SPACING / 2;

      var colStart = new THREE.Color(0xF59E0B);
      var colEnd   = new THREE.Color(0x10B981);

      for (var j = 0; j < data.length; j++) {
        var pct    = data[j].revenue / maxVal;
        var barH   = Math.max(pct * MAX_H, 0.15);
        var geo    = new THREE.BoxGeometry(BAR_W, barH, BAR_D);

        var col = colStart.clone().lerp(colEnd, pct);
        var mat = new THREE.MeshStandardMaterial({
          color: col,
          metalness: 0.35,
          roughness: 0.38,
          emissive: col,
          emissiveIntensity: 0.18
        });

        var bar = new THREE.Mesh(geo, mat);
        bar.position.x = offset + j * SPACING;
        bar.position.y = barH / 2;
        scene.add(bar);

        // Label sprite
        this._addLabel(scene, data[j].label, bar.position.x, -0.6, 0);
      }

      /* ---- Animate ---- */
      var self  = this;
      var angle = 0;
      var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      var isVisible = !document.hidden;

      function animate() {
        if (!self._contexts[canvasId]) return;
        
        // Check if page is visible
        isVisible = !document.hidden;
        
        if (!reduced && isVisible) {
          self._contexts[canvasId].animId = requestAnimationFrame(animate);
          angle += 0.005;
          camera.position.x = Math.cos(angle) * orbitR;
          camera.position.z = Math.sin(angle) * orbitR;
          camera.lookAt(0, 4, 0);
        }
        
        // Always render at least once
        renderer.render(scene, camera);
      }

      animate();

      /* ---- Resize ---- */
      function onResize() {
        if (!self._contexts[canvasId]) return;
        var nw = canvas.clientWidth  || w;
        var nh = canvas.clientHeight || h;
        camera.aspect = nw / nh;
        camera.updateProjectionMatrix();
        renderer.setSize(nw, nh);
      }
      window.addEventListener('resize', onResize);
      
      /* ---- Visibility Change ---- */
      function onVisibilityChange() {
        if (!self._contexts[canvasId]) return;
        
        if (document.hidden) {
          // Pause animation
          if (self._contexts[canvasId].animId) {
            cancelAnimationFrame(self._contexts[canvasId].animId);
            self._contexts[canvasId].animId = null;
          }
        } else {
          // Resume animation
          isVisible = true;
          if (!reduced && !self._contexts[canvasId].animId) {
            animate();
          }
        }
      }
      document.addEventListener('visibilitychange', onVisibilityChange);

      this._contexts[canvasId] = {
        renderer: renderer,
        scene:    scene,
        camera:   camera,
        animId:   null,
        onResize: onResize,
        onVisibilityChange: onVisibilityChange
      };
    },

    _addLabel: function (scene, text, x, y, z) {
      if (!text || !window.THREE) return;
      var offscreen = document.createElement('canvas');
      offscreen.width  = 128;
      offscreen.height = 32;
      var ctx = offscreen.getContext('2d');
      ctx.clearRect(0, 0, 128, 32);
      ctx.fillStyle = 'rgba(248,250,252,0.9)';
      ctx.font = 'bold 13px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(text).slice(0, 10), 64, 16);
      var texture   = new window.THREE.CanvasTexture(offscreen);
      var spriteMat = new window.THREE.SpriteMaterial({ map: texture, transparent: true });
      var sprite    = new window.THREE.Sprite(spriteMat);
      sprite.position.set(x, y, z);
      sprite.scale.set(2.2, 0.55, 1);
      scene.add(sprite);
    },

    _showEmptyState: function (canvasId, msg) {
      var canvas = document.getElementById(canvasId);
      if (!canvas) return;
      var ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#94A3B8';
      ctx.font = '14px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(msg || 'Chua co du lieu', canvas.width / 2, canvas.height / 2);
    },

    dispose: function (canvasId) {
      var ctx = this._contexts[canvasId];
      if (!ctx) return;
      if (ctx.animId)   cancelAnimationFrame(ctx.animId);
      if (ctx.onResize) window.removeEventListener('resize', ctx.onResize);
      if (ctx.onVisibilityChange) document.removeEventListener('visibilitychange', ctx.onVisibilityChange);
      if (ctx.scene && window.THREE) {
        ctx.scene.traverse(function (obj) {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) {
            if (Array.isArray(obj.material)) {
              obj.material.forEach(function (m) { if (m.map) m.map.dispose(); m.dispose(); });
            } else {
              if (obj.material.map) obj.material.map.dispose();
              obj.material.dispose();
            }
          }
        });
      }
      if (ctx.renderer) {
        // Unregister from memory manager
        if (window.TKSMemory) {
          window.TKSMemory.unregisterContext(ctx.renderer);
        }
        ctx.renderer.dispose();
      }
      delete this._contexts[canvasId];
    },

    disposeAll: function () {
      for (var id in this._contexts) {
        if (Object.prototype.hasOwnProperty.call(this._contexts, id)) {
          this.dispose(id);
        }
      }
    }
  };

  window.addEventListener('beforeunload', function () {
    window.TKSCharts3D.disposeAll();
  });

})();
