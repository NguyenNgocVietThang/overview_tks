/**
 * three-tables.test.js
 * Test suite for Task 8: Add 3D Table Row Hover Effects (3D Design.md)
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const publicDir = path.join(__dirname, '..', '..', 'public');
const sharedCssPath = path.join(publicDir, 'shared', 'shared.css');
const indexHtmlPath = path.join(publicDir, 'index.html');
const interactionsPath = path.join(publicDir, 'shared', 'three-interactions.js');
const accountHtmlPath = path.join(publicDir, 'account', 'index.html');
const shipmentHtmlPath = path.join(publicDir, 'shipment', 'index.html');

function createMockElement(tagName = 'tr', classes = [], attrs = {}) {
  const classListSet = new Set(classes);
  const listeners = {};
  const dataset = {};
  const children = [];
  const attributes = { ...attrs };

  const el = {
    tagName: tagName.toUpperCase(),
    dataset,
    style: {},
    children,
    offsetWidth: 600,
    offsetHeight: 40,
    getAttribute(name) {
      return attributes[name] !== undefined ? attributes[name] : null;
    },
    setAttribute(name, val) {
      attributes[name] = val;
    },
    removeAttribute(name) {
      delete attributes[name];
    },
    hasAttribute(name) {
      return attributes[name] !== undefined;
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 600, height: 40, right: 600, bottom: 40 };
    },
    appendChild(child) {
      child.parentNode = el;
      children.push(child);
      return child;
    },
    removeChild(child) {
      const idx = children.indexOf(child);
      if (idx !== -1) {
        children.splice(idx, 1);
        child.parentNode = null;
      }
      return child;
    },
    querySelectorAll(selector) {
      if (selector === 'tbody tr' || selector === 'tr') {
        const result = [];
        if (el.tagName === 'TBODY') {
          children.forEach(c => { if (c.tagName === 'TR') result.push(c); });
        } else {
          children.forEach(c => {
            if (c.tagName === 'TBODY') {
              c.children.forEach(tr => { if (tr.tagName === 'TR') result.push(tr); });
            } else if (c.tagName === 'TR') {
              result.push(c);
            }
          });
        }
        return result;
      }
      return [];
    },
    classList: {
      contains(cls) { return classListSet.has(cls); },
      add(cls) { classListSet.add(cls); },
      remove(cls) { classListSet.delete(cls); },
      toggle(cls, force) {
        if (force === undefined) {
          if (classListSet.has(cls)) { classListSet.delete(cls); return false; }
          classListSet.add(cls); return true;
        }
        if (force) classListSet.add(cls);
        else classListSet.delete(cls);
        return force;
      }
    },
    addEventListener(type, fn) {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(fn);
    },
    removeEventListener(type, fn) {
      if (!listeners[type]) return;
      listeners[type] = listeners[type].filter(f => f !== fn);
    },
    dispatchEvent(event) {
      event.currentTarget = el;
      event.target = el;
      if (listeners[event.type]) {
        listeners[event.type].forEach(fn => fn(event));
      }
    }
  };

  if (tagName.toUpperCase() === 'TBODY') {
    el.rows = children;
  }

  return el;
}

test('shared.css defines 3D table row styling rules', () => {
  assert.ok(fs.existsSync(sharedCssPath), 'shared.css must exist');
  const css = fs.readFileSync(sharedCssPath, 'utf8');

  // tbody tr transform-style and transition
  assert.match(css, /tbody\s+tr[\s\S]*?transform-style:\s*preserve-3d/, 'shared.css must define transform-style: preserve-3d for tbody tr');
  assert.match(css, /tbody\s+tr[\s\S]*?transition:[\s\S]*?transform 0\.2s/, 'shared.css must define 0.2s transform transition for tbody tr');

  // tbody tr hover elevation and glow
  assert.match(css, /tbody\s+tr:hover[\s\S]*?perspective\(1000px\)/, 'tbody tr:hover must use perspective(1000px)');
  assert.match(css, /tbody\s+tr:hover[\s\S]*?translateZ\(5px\)/, 'tbody tr:hover must translateZ(5px)');
  assert.match(css, /tbody\s+tr:hover[\s\S]*?box-shadow:/, 'tbody tr:hover must define elevation box-shadow');
  assert.match(css, /tbody\s+tr:hover[\s\S]*?background:\s*var\(--panel-2\)/, 'tbody tr:hover must use var(--panel-2) background');

  // Light theme support
  assert.match(css, /:root\[data-theme="light"\]\s+tbody\s+tr:hover[\s\S]*?box-shadow:/, 'Light theme tbody tr:hover must define tailored box-shadow');

  // Reduced motion override
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?tbody\s+tr:hover/, 'shared.css must override tbody tr:hover on reduced motion');
});

test('index.html inline style mirrors 3D table row styling rules', () => {
  assert.ok(fs.existsSync(indexHtmlPath), 'index.html must exist');
  const html = fs.readFileSync(indexHtmlPath, 'utf8');

  assert.match(html, /tbody\s+tr[\s\S]*?transform-style:\s*preserve-3d/, 'index.html must define transform-style: preserve-3d for tbody tr');
  assert.match(html, /tbody\s+tr:hover[\s\S]*?perspective\(1000px\)/, 'index.html tbody tr:hover must apply perspective(1000px)');
  assert.match(html, /tbody\s+tr:hover[\s\S]*?translateZ\(5px\)/, 'index.html tbody tr:hover must translateZ(5px)');
  assert.match(html, /tbody\s+tr:hover[\s\S]*?box-shadow:/, 'index.html tbody tr:hover must define box-shadow');
  assert.match(html, /:root\[data-theme="light"\]\s+tbody\s+tr:hover/, 'index.html must define light theme table row hover shadow');
  assert.match(html, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?tbody\s+tr:hover/, 'index.html must override tbody tr:hover on reduced motion');
});

test('three-interactions.js handles 3D table row setup and staggered animation', () => {
  assert.ok(fs.existsSync(interactionsPath), 'three-interactions.js must exist');

  const row1 = createMockElement('tr');
  const row2 = createMockElement('tr');
  const row3 = createMockElement('tr');
  const tbody = createMockElement('tbody');
  tbody.appendChild(row1);
  tbody.appendChild(row2);
  tbody.appendChild(row3);

  const queryMap = {
    'tbody tr': [row1, row2, row3],
    '.kpi-card, .panel, .card-3d, .profile-card, .kpi-stat, .int-nav-card, .users-table-panel, .section-panel': [],
    '.btn-primary, .refresh-btn, .theme-toggle, .theme-toggle-floating, .theme-toggle-disp, .btn-secondary, .btn-danger, .btn-outline, .btn-export, .export-button, .export-btn, .tks-btn-primary, .tks-btn-secondary, .tks-btn-danger, .login-btn, .register-btn, .search-submit, .period-toggle button, .pagination-controls button, .profile-trigger, .menu-btn, .btn': [],
    '.nav-item, .nav-subitem, .nav-group-toggle, .tks-top-nav-link': []
  };

  const timeouts = [];
  const mockDocument = {
    readyState: 'complete',
    documentElement: { dataset: { theme: 'dark' } },
    querySelectorAll(selector) {
      return queryMap[selector] || [];
    },
    querySelector(selector) {
      if (selector === '#myTbody') return tbody;
      return null;
    },
    getElementById(id) {
      if (id === 'myTbody') return tbody;
      return null;
    },
    addEventListener() {},
    removeEventListener() {}
  };

  const mockWindow = {
    document: mockDocument,
    matchMedia() {
      return { matches: false };
    },
    addEventListener() {},
    removeEventListener() {}
  };

  const context = vm.createContext({
    window: mockWindow,
    document: mockDocument,
    setTimeout: (fn, delay) => {
      const handle = { fn, delay, executed: false };
      timeouts.push(handle);
      return handle;
    },
    clearTimeout: (handle) => {
      if (handle) handle.cancelled = true;
    },
    console
  });

  const scriptCode = fs.readFileSync(interactionsPath, 'utf8');
  vm.runInContext(scriptCode, context);

  const TKS3D = context.window.TKS3D;
  assert.ok(TKS3D, 'TKS3D must be defined');
  assert.ok(typeof TKS3D.setupTableRowEffects === 'function', 'TKS3D.setupTableRowEffects must be a function');
  assert.ok(typeof TKS3D.animateTableRows === 'function', 'TKS3D.animateTableRows must be a function');
  assert.ok(typeof context.window.animateTableRows === 'function', 'window.animateTableRows must be exposed globally');

  // Test 1: Setup table row effects
  assert.strictEqual(row1.dataset.tks3dRowInit, 'true', 'Row 1 must be initialized with dataset flag');
  assert.strictEqual(row1.style.transformStyle, 'preserve-3d', 'Row 1 must have preserve-3d');

  // Test 2: Trigger staggered table row animation
  TKS3D.animateTableRows(tbody);

  // Rows should immediately start at opacity 0 and translateZ(-20px)
  assert.strictEqual(row1.style.opacity, '0', 'Row 1 initial animation state should be opacity: 0');
  assert.match(row1.style.transform, /translateZ\(-20px\)/, 'Row 1 initial animation state should translateZ(-20px)');
  assert.strictEqual(row2.style.opacity, '0', 'Row 2 initial opacity 0');
  assert.strictEqual(row3.style.opacity, '0', 'Row 3 initial opacity 0');

  // Staggered timeouts generated with increasing delays (0ms, 30ms, 60ms)
  assert.strictEqual(timeouts.length, 3, 'Should generate 3 timeout callbacks for 3 rows');
  assert.strictEqual(timeouts[0].delay, 0, 'First row delay should be 0ms');
  assert.strictEqual(timeouts[1].delay, 30, 'Second row delay should be 30ms');
  assert.strictEqual(timeouts[2].delay, 60, 'Third row delay should be 60ms');

  // Execute timeouts
  timeouts.forEach(t => t.fn());

  // After transition finishes, rows are visible and transform reset
  assert.strictEqual(row1.style.opacity, '1', 'Row 1 should become visible');
  assert.strictEqual(row1.style.transform, '', 'Row 1 transform should reset to clean state');
  assert.strictEqual(row2.style.opacity, '1', 'Row 2 should become visible');
  assert.strictEqual(row3.style.opacity, '1', 'Row 3 should become visible');
});

test('three-interactions.js respects prefers-reduced-motion for table animations', () => {
  const row1 = createMockElement('tr');
  const tbody = createMockElement('tbody');
  tbody.appendChild(row1);

  const mockDocument = {
    readyState: 'complete',
    documentElement: { dataset: { theme: 'dark' } },
    querySelectorAll() { return [row1]; },
    addEventListener() {},
    removeEventListener() {}
  };

  const mockWindow = {
    document: mockDocument,
    matchMedia(q) {
      return { matches: q.includes('reduced-motion') };
    },
    addEventListener() {},
    removeEventListener() {}
  };

  const context = vm.createContext({
    window: mockWindow,
    document: mockDocument,
    setTimeout: (fn) => fn(),
    clearTimeout: () => {},
    console
  });

  const scriptCode = fs.readFileSync(interactionsPath, 'utf8');
  vm.runInContext(scriptCode, context);

  const TKS3D = context.window.TKS3D;

  TKS3D.animateTableRows(tbody);

  // In reduced motion, row remains visible without staggered delay
  assert.strictEqual(row1.style.opacity, '1', 'Reduced motion should ensure opacity: 1');
  assert.strictEqual(row1.style.transform, '', 'Reduced motion should not apply translateZ(-20px)');
});

test('three-interactions.js destroy cleans up table row handlers', () => {
  const row1 = createMockElement('tr');
  const mockDocument = {
    readyState: 'complete',
    documentElement: { dataset: { theme: 'dark' } },
    querySelectorAll(sel) {
      if (sel === 'tbody tr') return [row1];
      return [];
    },
    addEventListener() {},
    removeEventListener() {}
  };

  const mockWindow = {
    document: mockDocument,
    matchMedia() { return { matches: false }; },
    addEventListener() {},
    removeEventListener() {}
  };

  const context = vm.createContext({
    window: mockWindow,
    document: mockDocument,
    setTimeout: () => {},
    clearTimeout: () => {},
    console
  });

  const scriptCode = fs.readFileSync(interactionsPath, 'utf8');
  vm.runInContext(scriptCode, context);

  const TKS3D = context.window.TKS3D;
  assert.strictEqual(row1.dataset.tks3dRowInit, 'true', 'Row should be initialized');

  TKS3D.destroy();
  assert.strictEqual(row1.dataset.tks3dRowInit, undefined, 'Dataset flag should be removed on destroy');
});

test('all major pages with tables have valid table structure and animate hooks', () => {
  const pages = [
    { name: 'index.html', path: indexHtmlPath },
    { name: 'account/index.html', path: accountHtmlPath },
    { name: 'shipment/index.html', path: shipmentHtmlPath }
  ];

  pages.forEach(({ name, path: p }) => {
    const html = fs.readFileSync(p, 'utf8');
    assert.match(html, /<tbody[\s>]/, `${name} must contain tbody elements`);
    assert.match(html, /animateTableRows/, `${name} must invoke animateTableRows when rendering table data`);
  });
});
