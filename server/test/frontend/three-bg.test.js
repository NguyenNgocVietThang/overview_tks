'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const threeBgPath = path.join(__dirname, '..', '..', 'public', 'shared', 'three-bg.js');
const vendorThreePath = path.join(__dirname, '..', '..', 'public', 'vendor', 'three.min.js');

test('three-bg.js file exists and is non-empty', () => {
  assert.ok(fs.existsSync(threeBgPath), 'shared/three-bg.js phai ton tai');
  const content = fs.readFileSync(threeBgPath, 'utf8');
  assert.ok(content.length > 500, 'shared/three-bg.js phai co noi dung day du');
});

test('three-bg.js handles absence of window.THREE gracefully without errors', () => {
  const code = fs.readFileSync(threeBgPath, 'utf8');
  let warned = false;
  const sandbox = {
    window: { addEventListener: () => {}, removeEventListener: () => {} },
    document: { readyState: 'complete' },
    console: {
      warn: (msg) => {
        if (msg && msg.includes('[TKS 3D]')) warned = true;
      },
      log: () => {}
    }
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);

  assert.doesNotThrow(() => {
    vm.runInContext(code, sandbox);
  });

  assert.ok(sandbox.window.ParticleBackground, 'ParticleBackground object phai duoc export');
  assert.doesNotThrow(() => {
    sandbox.window.ParticleBackground.init();
  });
  assert.equal(warned, true, 'Canh bao [TKS 3D] phai duoc log khi THREE.js chua load');
  assert.equal(sandbox.window.ParticleBackground.initialized, false, 'initialized phai la false khi khong co THREE');
});

function createMockEnvironment(options = {}) {
  const threeCode = fs.readFileSync(vendorThreePath, 'utf8');
  const threeBgCode = fs.readFileSync(threeBgPath, 'utf8');

  const eventListeners = new Map();
  const docEventListeners = new Map();
  const createdElements = [];

  const bodyChildren = [];
  const mockBody = {
    children: bodyChildren,
    insertBefore(newChild, refChild) {
      bodyChildren.unshift(newChild);
      newChild.parentNode = mockBody;
      return newChild;
    },
    removeChild(child) {
      const idx = bodyChildren.indexOf(child);
      if (idx !== -1) bodyChildren.splice(idx, 1);
      child.parentNode = null;
      return child;
    }
  };

  const mockDocElement = {
    dataset: { theme: options.theme || 'dark' }
  };

  const animationCallbacks = [];
  let rafIdCounter = 1;

  const mockWindow = {
    innerWidth: options.innerWidth !== undefined ? options.innerWidth : 1280,
    innerHeight: options.innerHeight !== undefined ? options.innerHeight : 800,
    devicePixelRatio: options.dpr || 1,
    matchMedia: (query) => ({
      matches: query.includes('prefers-reduced-motion: reduce') ? !!options.reducedMotion : false
    }),
    addEventListener: (type, fn) => {
      if (!eventListeners.has(type)) eventListeners.set(type, []);
      eventListeners.get(type).push(fn);
    },
    removeEventListener: (type, fn) => {
      if (!eventListeners.has(type)) return;
      const arr = eventListeners.get(type).filter(f => f !== fn);
      eventListeners.set(type, arr);
    },
    requestAnimationFrame: (cb) => {
      const id = rafIdCounter++;
      animationCallbacks.push({ id, cb, cancelled: false });
      return id;
    },
    cancelAnimationFrame: (id) => {
      const item = animationCallbacks.find(x => x.id === id);
      if (item) item.cancelled = true;
    }
  };
  mockWindow.window = mockWindow;

  const mockDocument = {
    readyState: 'complete',
    hidden: false,
    body: mockBody,
    documentElement: mockDocElement,
    addEventListener: (type, fn) => {
      if (!docEventListeners.has(type)) docEventListeners.set(type, []);
      docEventListeners.get(type).push(fn);
    },
    removeEventListener: (type, fn) => {
      if (!docEventListeners.has(type)) return;
      const arr = docEventListeners.get(type).filter(f => f !== fn);
      docEventListeners.set(type, arr);
    },
    createElement: (tag) => {
      const el = {
        tagName: tag.toUpperCase(),
        classList: {
          classes: new Set(),
          add(c) { this.classes.add(c); },
          contains(c) { return this.classes.has(c); }
        },
        attributes: {},
        setAttribute(k, v) { this.attributes[k] = String(v); },
        getAttribute(k) { return this.attributes[k]; },
        getContext: () => ({
          fillRect: () => {},
          clearRect: () => {},
          getImageData: () => ({ data: [] }),
          putImageData: () => {},
          createImageData: () => ({ data: [] }),
          setTransform: () => {},
          drawImage: () => {},
          save: () => {},
          fillText: () => {},
          restore: () => {},
          beginPath: () => {},
          moveTo: () => {},
          lineTo: () => {},
          closePath: () => {},
          stroke: () => {},
          translate: () => {},
          scale: () => {},
          rotate: () => {},
          arc: () => {},
          fill: () => {}
        }),
        style: {}
      };
      createdElements.push(el);
      return el;
    }
  };

  class MockMutationObserver {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {}
    disconnect() {}
    trigger() {
      this.callback();
    }
  }

  const sandbox = {
    window: mockWindow,
    document: mockDocument,
    MutationObserver: MockMutationObserver,
    getComputedStyle: () => ({
      getPropertyValue: (prop) => (prop === '--primary' ? (mockDocument.documentElement.dataset.theme === 'light' ? '#2563EB' : '#3B82F6') : '')
    }),
    console: {
      log: () => {},
      warn: () => {},
      error: () => {}
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(threeCode, sandbox);
  sandbox.window.THREE = sandbox.THREE;

  // Mock WebGLRenderer in THREE for testing
  sandbox.THREE.WebGLRenderer = function(params) {
    this.domElement = mockDocument.createElement('canvas');
    this.setPixelRatio = function(r) { this.pixelRatio = r; };
    this.setSize = function(w, h) { this.width = w; this.height = h; };
    this.render = function(scene, camera) { this.rendered = true; };
    this.dispose = function() { this.disposed = true; };
  };

  return { sandbox, threeBgCode, mockWindow, mockDocument, mockBody, animationCallbacks, eventListeners, docEventListeners };
}

test('three-bg.js initializes particle background system in desktop viewport', () => {
  const { sandbox, threeBgCode, mockBody } = createMockEnvironment({ innerWidth: 1200 });
  vm.runInContext(threeBgCode, sandbox);

  const bg = sandbox.window.ParticleBackground;
  assert.ok(bg, 'ParticleBackground phai ton tai');
  assert.equal(bg.initialized, true, 'ParticleBackground phai duoc init tu dong khi DOM ready');
  assert.equal(bg.running, true, 'ParticleBackground phai dang chay');
  assert.ok(bg.scene, 'Scene phai duoc khoi tao');
  assert.ok(bg.camera, 'Camera phai duoc khoi tao');
  assert.ok(bg.particles, 'Particles Points object phai duoc khoi tao');

  // Check canvas properties
  assert.equal(mockBody.children.length, 1, 'Canvas phai duoc them vao body');
  const canvas = mockBody.children[0];
  assert.ok(canvas.classList.contains('tks-bg-canvas'), 'Canvas phai co class tks-bg-canvas');
  assert.equal(canvas.getAttribute('aria-hidden'), 'true', 'Canvas phai co aria-hidden=true');
  assert.equal(canvas.getAttribute('role'), 'presentation', 'Canvas phai co role=presentation');

  // Check desktop particle count (300 particles = 900 floats)
  const posArray = bg.particles.geometry.attributes.position.array;
  assert.equal(posArray.length, 300 * 3, 'Desktop phai co 300 particles');
  assert.equal(bg.particles.material.size, 2, 'Material size desktop phai la 2');
});

test('three-bg.js adapts particle count and size for mobile viewport (<768px)', () => {
  const { sandbox, threeBgCode } = createMockEnvironment({ innerWidth: 480 });
  vm.runInContext(threeBgCode, sandbox);

  const bg = sandbox.window.ParticleBackground;
  assert.ok(bg.initialized, 'ParticleBackground phai duoc khoi tao tren mobile');

  const posArray = bg.particles.geometry.attributes.position.array;
  assert.equal(posArray.length, 100 * 3, 'Mobile phai co 100 particles');
  assert.equal(bg.particles.material.size, 1.5, 'Material size mobile phai la 1.5');
});

test('three-bg.js syncTheme updates material color and opacity between Dark and Light mode', () => {
  const { sandbox, threeBgCode, mockDocument } = createMockEnvironment({ theme: 'dark' });
  vm.runInContext(threeBgCode, sandbox);

  const bg = sandbox.window.ParticleBackground;
  assert.equal(bg.particles.material.opacity, 0.6, 'Dark mode opacity phai la 0.6');

  // Switch to light theme
  mockDocument.documentElement.dataset.theme = 'light';
  bg.syncTheme();

  assert.equal(bg.particles.material.opacity, 0.4, 'Light mode opacity phai la 0.4');
  assert.equal(bg.particles.material.color.getHexString().toUpperCase(), '2563EB', 'Light mode color phai la #2563EB');

  // Switch back to dark theme
  mockDocument.documentElement.dataset.theme = 'dark';
  bg.syncTheme();

  assert.equal(bg.particles.material.opacity, 0.6, 'Dark mode opacity phai tro lai 0.6');
  assert.equal(bg.particles.material.color.getHexString().toUpperCase(), '3B82F6', 'Dark mode color phai la #3B82F6');
});

test('three-bg.js performs boundary wrapping during animation steps', () => {
  const { sandbox, threeBgCode } = createMockEnvironment({ innerWidth: 1000 });
  vm.runInContext(threeBgCode, sandbox);

  const bg = sandbox.window.ParticleBackground;
  const positions = bg.particles.geometry.attributes.position.array;
  const velocities = bg.particles.geometry.attributes.velocity.array;

  // Place first particle beyond boundary
  positions[0] = 260; // X > 250
  velocities[0] = 0.5;

  positions[1] = -270; // Y < -250
  velocities[1] = -0.5;

  positions[2] = 110; // Z > 100
  velocities[2] = 0.2;

  bg.animate();

  // Coordinates should wrap around (inverted sign)
  assert.ok(positions[0] < 0, 'X vuot 250 phai duoc wrap sang am');
  assert.ok(positions[1] > 0, 'Y vuot -250 phai duoc wrap sang duong');
  assert.ok(positions[2] < 0, 'Z vuot 100 phai duoc wrap sang am');
});

test('three-bg.js handles visibility change by pausing animation on hide and resuming on show', () => {
  const { sandbox, threeBgCode, mockDocument } = createMockEnvironment({ innerWidth: 1000 });
  vm.runInContext(threeBgCode, sandbox);

  const bg = sandbox.window.ParticleBackground;
  assert.ok(bg.animationId !== null, 'animationId phai duoc cap khi dang chay');

  // Simulate tab hidden
  mockDocument.hidden = true;
  bg.onVisibilityChange();
  assert.equal(bg.animationId, null, 'animationId phai la null khi tab hidden');

  // Simulate tab visible again
  mockDocument.hidden = false;
  bg.onVisibilityChange();
  assert.ok(bg.animationId !== null, 'animationId phai duoc khoi phuc khi tab hien lai');
});

test('three-bg.js respects prefers-reduced-motion by rendering a static frame without animation loop', () => {
  const { sandbox, threeBgCode } = createMockEnvironment({ reducedMotion: true });
  vm.runInContext(threeBgCode, sandbox);

  const bg = sandbox.window.ParticleBackground;
  assert.equal(bg.shouldReduceMotion(), true, 'shouldReduceMotion phai tra ve true');
  assert.equal(bg.animationId, null, 'Khong duoc khoi dong requestAnimationFrame khi reducedMotion bat');
  assert.equal(bg.renderer.rendered, true, 'Renderer phai render 1 frame tinh');
});

test('three-bg.js destroy method cleans up resources and DOM elements cleanly', () => {
  const { sandbox, threeBgCode, mockBody } = createMockEnvironment();
  vm.runInContext(threeBgCode, sandbox);

  const bg = sandbox.window.ParticleBackground;
  assert.equal(mockBody.children.length, 1);

  bg.destroy();

  assert.equal(bg.initialized, false, 'initialized phai la false sau khi destroy');
  assert.equal(bg.running, false, 'running phai la false sau khi destroy');
  assert.equal(bg.particles, null, 'particles phai duoc dispose va null');
  assert.equal(bg.renderer, null, 'renderer phai duoc dispose va null');
  assert.equal(bg.scene, null, 'scene phai duoc null');
  assert.equal(mockBody.children.length, 0, 'Canvas phai duoc go bo khoi DOM');
});
