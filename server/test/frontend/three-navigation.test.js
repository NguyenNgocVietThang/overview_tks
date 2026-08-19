/**
 * three-navigation.test.js
 * Test suite for Task 6: Add 3D Effects to Navigation and Sidebar (3D Design.md)
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
const sharedNavPath = path.join(publicDir, 'shared', 'shared-nav.js');
const accountHtmlPath = path.join(publicDir, 'account', 'index.html');
const shipmentHtmlPath = path.join(publicDir, 'shipment', 'index.html');
const dispatchHtmlPath = path.join(publicDir, 'shipment', 'dispatch', 'index.html');

function createMockElement(tagName = 'div', classes = []) {
  const classListSet = new Set(classes);
  const listeners = {};
  const dataset = {};

  const el = {
    tagName: tagName.toUpperCase(),
    dataset,
    style: {},
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
      if (listeners[event.type]) {
        listeners[event.type].forEach(fn => fn(event));
      }
    }
  };
  return el;
}

test('shared.css defines 3D navigation and sidebar rules', () => {
  assert.ok(fs.existsSync(sharedCssPath), 'shared.css must exist');
  const css = fs.readFileSync(sharedCssPath, 'utf8');

  // Sidebar perspective
  assert.match(css, /\.sidebar[\s\S]*?perspective:\s*1000px/, 'sidebar must define perspective: 1000px');
  assert.match(css, /\.sidebar[\s\S]*?perspective-origin:\s*center center/, 'sidebar must define perspective-origin');

  // .nav-item transform-style and transitions
  assert.match(css, /\.nav-item[\s\S]*?transform-style:\s*preserve-3d/, '.nav-item must define transform-style: preserve-3d');
  assert.match(css, /\.nav-item[\s\S]*?transition:[\s\S]*?transform 0\.3s/, '.nav-item must define 0.3s transform transition');

  // .nav-item hover effect
  assert.match(css, /\.nav-item:hover:not\(\.active\)[\s\S]*?perspective\(800px\)/, '.nav-item:hover:not(.active) must apply perspective(800px)');
  assert.match(css, /\.nav-item:hover:not\(\.active\)[\s\S]*?translateZ\(10px\)/, '.nav-item:hover:not(.active) must translateZ(10px)');
  assert.match(css, /\.nav-item:hover:not\(\.active\)[\s\S]*?translateX\(8px\)/, '.nav-item:hover:not(.active) must translateX(8px)');

  // .nav-item active state 3D depth and shadow
  assert.match(css, /\.nav-item\.active[\s\S]*?perspective\(800px\)/, '.nav-item.active must apply perspective(800px)');
  assert.match(css, /\.nav-item\.active[\s\S]*?translateZ\(15px\)/, '.nav-item.active must translateZ(15px)');
  assert.match(css, /\.nav-item\.active[\s\S]*?box-shadow:/, '.nav-item.active must define box-shadow depth');

  // Icon animation
  assert.match(css, /@keyframes\s+iconBounce/, 'shared.css must define @keyframes iconBounce');
  assert.match(css, /iconBounce[\s\S]*?translateZ\(8px\)\s+rotateY\(15deg\)/, 'iconBounce keyframe must rotateY(15deg) and translateZ(8px)');
  assert.match(css, /\.nav-item:hover\s+\.ic[\s\S]*?animation:\s*iconBounce\s+0\.6s/, '.nav-item:hover .ic must trigger iconBounce animation');

  // .nav-group-toggle 3D hover
  assert.match(css, /\.nav-group-toggle[\s\S]*?transform-style:\s*preserve-3d/, '.nav-group-toggle must have transform-style: preserve-3d');
  assert.match(css, /\.nav-group-toggle:hover[\s\S]*?perspective\(800px\)/, '.nav-group-toggle:hover must have perspective(800px)');
  assert.match(css, /\.nav-group-toggle:hover\s+\.ic[\s\S]*?animation:\s*iconBounce/, '.nav-group-toggle:hover .ic must trigger iconBounce');

  // Reduced motion
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.nav-item:hover:not\(\.active\)/, 'shared.css must override nav hover on reduced motion');
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?animation:\s*none/, 'shared.css must disable icon animation on reduced motion');
});

test('index.html inline style mirrors 3D navigation and sidebar rules', () => {
  assert.ok(fs.existsSync(indexHtmlPath), 'index.html must exist');
  const html = fs.readFileSync(indexHtmlPath, 'utf8');

  assert.match(html, /\.sidebar[\s\S]*?perspective:\s*1000px/, 'index.html sidebar must define perspective: 1000px');
  assert.match(html, /\.nav-item[\s\S]*?transform-style:\s*preserve-3d/, 'index.html .nav-item must define transform-style: preserve-3d');
  assert.match(html, /\.nav-item:hover:not\(\.active\)[\s\S]*?translateZ\(10px\)/, 'index.html .nav-item hover must translateZ(10px)');
  assert.match(html, /\.nav-item\.active[\s\S]*?translateZ\(15px\)/, 'index.html .nav-item.active must translateZ(15px)');
  assert.match(html, /@keyframes\s+iconBounce/, 'index.html must define @keyframes iconBounce');
  assert.match(html, /\.nav-item:hover\s+\.ic[\s\S]*?animation:\s*iconBounce/, 'index.html must animate icon on hover');
});

test('three-interactions.js handles 3D navigation slide and tilt for nav-item and nav-group-toggle', () => {
  const code = fs.readFileSync(interactionsPath, 'utf8');

  const navItem1 = createMockElement('button', ['nav-item']);
  const navItemActive = createMockElement('button', ['nav-item', 'active']);
  const navGroupToggle = createMockElement('button', ['nav-group-toggle']);

  const elementsMap = {
    '.kpi-card, .panel, .card-3d, .profile-card, .kpi-stat, .int-nav-card, .users-table-panel, .section-panel': [],
    '.btn-primary, .refresh-btn, .theme-toggle, .btn-secondary, .btn-outline, .btn-export, .login-btn, .register-btn, .btn': [],
    '.nav-item, .nav-subitem, .nav-group-toggle, .tks-top-nav-link': [navItem1, navItemActive, navGroupToggle]
  };

  const mockDoc = {
    readyState: 'complete',
    documentElement: { dataset: { theme: 'dark' } },
    querySelectorAll: (sel) => elementsMap[sel] || [],
    addEventListener: () => {}
  };

  const sandbox = {
    window: {
      matchMedia: (q) => ({ matches: false }),
      document: mockDoc,
      addEventListener: () => {},
      removeEventListener: () => {}
    },
    document: mockDoc
  };
  sandbox.globalThis = sandbox.window;

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  const TKS3D = sandbox.window.TKS3D;
  assert.ok(TKS3D, 'TKS3D must be defined');

  // Test 1: Inactive nav-item hover -> translateZ(10px) translateX(8px)
  navItem1.dispatchEvent({ type: 'mouseenter' });
  assert.match(navItem1.style.transform, /translateZ\(10px\)\s+translateX\(8px\)/, 'Inactive nav-item should slide out on mouseenter');

  navItem1.dispatchEvent({ type: 'mouseleave' });
  assert.equal(navItem1.style.transform, '', 'Nav-item transform should reset on mouseleave');

  // Test 2: Active nav-item hover -> should NOT override with inactive hover transform
  navItemActive.dispatchEvent({ type: 'mouseenter' });
  assert.equal(navItemActive.style.transform || '', '', 'Active nav-item should keep its CSS active transform');

  // Test 3: Nav group toggle hover -> translateZ(8px) translateX(6px)
  navGroupToggle.dispatchEvent({ type: 'mouseenter' });
  assert.match(navGroupToggle.style.transform, /translateZ\(8px\)\s+translateX\(6px\)/, 'Nav group toggle should slide on hover');

  navGroupToggle.dispatchEvent({ type: 'mouseleave' });
  assert.equal(navGroupToggle.style.transform, '', 'Nav group toggle transform should reset on mouseleave');

  // Test 4: Reduced motion suppresses transform
  sandbox.window.matchMedia = (q) => ({ matches: q.includes('reduced-motion') });
  navItem1.dispatchEvent({ type: 'mouseenter' });
  assert.equal(navItem1.style.transform, '', 'prefers-reduced-motion must suppress hover transform in JS');
});

test('shared-nav.js triggers TKS3D.refresh on renderTopSidebar', () => {
  const sharedNavCode = fs.readFileSync(sharedNavPath, 'utf8');
  assert.match(sharedNavCode, /TKS3D\.refresh/, 'renderTopSidebar should call TKS3D.refresh');
});

test('all major pages with sidebar have valid navigation structure', () => {
  const pages = [
    { name: 'index.html', path: indexHtmlPath },
    { name: 'account/index.html', path: accountHtmlPath },
    { name: 'shipment/index.html', path: shipmentHtmlPath },
    { name: 'shipment/dispatch/index.html', path: dispatchHtmlPath }
  ];

  pages.forEach(({ name, path: p }) => {
    const html = fs.readFileSync(p, 'utf8');
    assert.match(html, /id=["']sidebar["']/, `${name} must contain sidebar element`);
  });
});
