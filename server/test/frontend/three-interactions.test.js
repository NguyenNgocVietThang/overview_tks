/**
 * three-interactions.test.js
 * Test suite for Task 4: Implement Interactive Hover Handler (3D Design.md)
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const publicDir = path.join(__dirname, '..', '..', 'public');
const interactionsPath = path.join(publicDir, 'shared', 'three-interactions.js');
const indexHtmlPath = path.join(publicDir, 'index.html');
const loginHtmlPath = path.join(publicDir, 'login', 'index.html');
const registerHtmlPath = path.join(publicDir, 'register', 'index.html');
const accountHtmlPath = path.join(publicDir, 'account', 'index.html');
const shipmentHtmlPath = path.join(publicDir, 'shipment', 'index.html');
const dispatchHtmlPath = path.join(publicDir, 'shipment', 'dispatch', 'index.html');
const mobileHtmlPath = path.join(publicDir, 'shipment', 'mobile', 'index.html');

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
    },
    getBoundingClientRect() {
      return {
        left: 100,
        top: 100,
        width: 300,
        height: 200,
        right: 400,
        bottom: 300
      };
    }
  };
  return el;
}

function createMockDOMEnvironment(options = {}) {
  const elements = {
    cards: [
      createMockElement('div', ['kpi-card', 'card-3d']),
      createMockElement('div', ['panel', 'card-3d']),
      createMockElement('div', ['profile-card', 'card-3d']),
      createMockElement('div', ['kpi-stat', 'card-3d'])
    ],
    buttons: [
      createMockElement('button', ['btn-primary']),
      createMockElement('button', ['refresh-btn']),
      createMockElement('button', ['theme-toggle'])
    ],
    navItems: [
      createMockElement('a', ['nav-item']),
      createMockElement('a', ['nav-item', 'active']),
      createMockElement('a', ['nav-subitem'])
    ]
  };

  const documentListeners = {};
  const mockDocument = {
    readyState: 'complete',
    documentElement: {
      dataset: {
        theme: options.theme || 'dark'
      }
    },
    querySelectorAll(selector) {
      const result = [];
      if (selector.includes('kpi-card') || selector.includes('panel') || selector.includes('card-3d')) {
        result.push(...elements.cards);
      }
      if (selector.includes('btn-primary') || selector.includes('refresh-btn') || selector.includes('theme-toggle')) {
        result.push(...elements.buttons);
      }
      if (selector.includes('nav-item') || selector.includes('nav-subitem')) {
        result.push(...elements.navItems);
      }
      return result;
    },
    addEventListener(type, fn) {
      if (!documentListeners[type]) documentListeners[type] = [];
      documentListeners[type].push(fn);
    },
    removeEventListener(type, fn) {
      if (!documentListeners[type]) return;
      documentListeners[type] = documentListeners[type].filter(f => f !== fn);
    }
  };

  const mockWindow = {
    document: mockDocument,
    matchMedia(query) {
      return {
        matches: options.reducedMotion && query.includes('prefers-reduced-motion')
      };
    },
    addEventListener() {},
    removeEventListener() {}
  };

  const context = vm.createContext({
    window: mockWindow,
    document: mockDocument,
    console,
    requestAnimationFrame: (cb) => { cb(); return 1; },
    cancelAnimationFrame: () => {}
  });

  const scriptCode = fs.readFileSync(interactionsPath, 'utf8');
  vm.runInContext(scriptCode, context);

  return {
    window: context.window,
    TKS3D: context.window.TKS3D,
    elements
  };
}

test('three-interactions.js file exists and is non-empty', () => {
  assert.ok(fs.existsSync(interactionsPath), 'shared/three-interactions.js must exist');
  const code = fs.readFileSync(interactionsPath, 'utf8');
  assert.ok(code.length > 500, 'three-interactions.js should contain complete implementation');
});

test('three-interactions.js initializes TKS3D and TKSInteractions namespaces', () => {
  const env = createMockDOMEnvironment();
  assert.ok(env.TKS3D, 'window.TKS3D must be defined');
  assert.strictEqual(typeof env.TKS3D.init, 'function', 'TKS3D.init must be a function');
  assert.strictEqual(typeof env.TKS3D.onCardHover, 'function', 'TKS3D.onCardHover must be a function');
  assert.strictEqual(typeof env.TKS3D.onCardLeave, 'function', 'TKS3D.onCardLeave must be a function');
  assert.strictEqual(typeof env.TKS3D.destroy, 'function', 'TKS3D.destroy must be a function');
  assert.strictEqual(env.window.TKSInteractions, env.TKS3D, 'TKSInteractions should alias TKS3D');
});

test('three-interactions.js applies lift (no tilt) and box-shadow on card mouseenter', () => {
  const env = createMockDOMEnvironment();
  const card = env.elements.cards[0];

  assert.strictEqual(card.style.transformStyle, 'preserve-3d', 'Card should have transformStyle preserve-3d');
  assert.ok(card.style.transition.includes('transform'), 'Card should have transform transition');

  card.dispatchEvent({ type: 'mouseenter' });

  assert.ok(card.style.transform.includes('perspective(1000px)'), 'Transform must include perspective(1000px)');
  assert.ok(card.style.transform.includes('translateZ(20px)'), 'Transform must include translateZ(20px)');
  assert.ok(card.style.transform.includes('scale(1.02)'), 'Transform must include scale(1.02)');
  assert.ok(!card.style.transform.includes('rotateX'), 'Transform must not include any rotateX tilt');
  assert.ok(!card.style.transform.includes('rotateY'), 'Transform must not include any rotateY tilt');
  assert.ok(card.style.boxShadow.includes('rgba(59, 130, 246'), 'Card box-shadow should glow with primary color');
});

test('three-interactions.js resets transform and shadow on card mouseleave', () => {
  const env = createMockDOMEnvironment();
  const card = env.elements.cards[0];

  card.dispatchEvent({ type: 'mouseenter' });
  assert.notStrictEqual(card.style.transform, '');

  card.dispatchEvent({ type: 'mouseleave' });
  assert.strictEqual(card.style.transform, '', 'Transform should be reset on mouseleave');
  assert.strictEqual(card.style.boxShadow, '', 'BoxShadow should be reset on mouseleave');
});

test('three-interactions.js does not apply a JS press transform on mousedown (CSS :active owns it)', () => {
  const env = createMockDOMEnvironment();
  const btn = env.elements.buttons[0];

  assert.strictEqual(btn.style.transformStyle, 'preserve-3d');

  // Mousedown must NOT set an inline transform. A JS-driven press transform
  // that shrinks/foreshortens the button (translateZ + scale) can move the
  // button's hit-region out from under the cursor before mouseup fires; per
  // the DOM click spec the resulting click then targets the nearest common
  // ancestor of the mousedown/mouseup targets (e.g. the parent <form>), not
  // the button — so the click, and any submit handler bound to it, is
  // silently lost. Because the reset also lived on the button's own
  // mouseup/mouseleave listeners, that one bad release left the transform
  // stuck forever, making the button visually "pressed" and even easier to
  // mis-hit on every subsequent click. The press visual is now handled
  // entirely by CSS `:active` (translateY-only, see shared.css), which the
  // browser always clears on release regardless of where the pointer ends
  // up — so there is no JS state left to get stuck.
  btn.dispatchEvent({ type: 'mousedown' });
  assert.strictEqual(btn.style.transform, undefined, 'Mousedown must not set btn.style.transform');

  btn.dispatchEvent({ type: 'mouseup' });
  assert.strictEqual(btn.style.transform, undefined, 'Mouseup must not set btn.style.transform');

  btn.dispatchEvent({ type: 'mousedown' });
  btn.dispatchEvent({ type: 'mouseleave' });
  assert.strictEqual(btn.style.transform, undefined, 'Mouseleave must not set btn.style.transform');
});

test('three-interactions.js handles navigation slide and tilt on hover for inactive items', () => {
  const env = createMockDOMEnvironment();
  const inactiveNav = env.elements.navItems[0];
  const activeNav = env.elements.navItems[1];

  // Inactive nav hover
  inactiveNav.dispatchEvent({ type: 'mouseenter' });
  assert.ok(inactiveNav.style.transform.includes('translateX(8px)'), 'Inactive nav item should slide translateX(8px)');
  assert.ok(inactiveNav.style.transform.includes('translateZ(10px)'), 'Inactive nav item should translateZ(10px)');

  inactiveNav.dispatchEvent({ type: 'mouseleave' });
  assert.strictEqual(inactiveNav.style.transform, '', 'Mouseleave should reset nav transform');

  // Active nav item should not slide
  activeNav.dispatchEvent({ type: 'mouseenter' });
  assert.strictEqual(activeNav.style.transform || '', '', 'Active nav item should not transform');
});

test('three-interactions.js respects prefers-reduced-motion and suppresses transforms', () => {
  const env = createMockDOMEnvironment({ reducedMotion: true });
  const card = env.elements.cards[0];
  const btn = env.elements.buttons[0];
  const nav = env.elements.navItems[0];

  card.dispatchEvent({ type: 'mousemove', clientX: 350, clientY: 250 });
  assert.strictEqual(card.style.transform || '', '', 'Card transform must remain empty when reduced motion is on');

  btn.dispatchEvent({ type: 'mousedown' });
  assert.strictEqual(btn.style.transform || '', '', 'Button transform must remain empty when reduced motion is on');

  nav.dispatchEvent({ type: 'mouseenter' });
  assert.strictEqual(nav.style.transform || '', '', 'Nav transform must remain empty when reduced motion is on');
});

test('three-interactions.js destroy cleanly removes listeners and resets styles', () => {
  const env = createMockDOMEnvironment();
  const card = env.elements.cards[0];
  const btn = env.elements.buttons[0];

  card.dispatchEvent({ type: 'mousemove', clientX: 350, clientY: 250 });
  assert.notStrictEqual(card.style.transform, '');

  env.TKS3D.destroy();
  assert.strictEqual(card.style.transform, '', 'Destroy should reset card styles');
  assert.strictEqual(env.TKS3D.initialized, false, 'Initialized flag should be false after destroy');

  // Subsequent events should have no effect
  card.dispatchEvent({ type: 'mousemove', clientX: 350, clientY: 250 });
  assert.strictEqual(card.style.transform, '', 'Card should no longer react to mousemove after destroy');
});

test('all major HTML pages (except login/register) load shared/three-interactions.js script', () => {
  // login/index.html and register/index.html intentionally do NOT load the 3D
  // stack — Task 1.4 removed it from those pages since they don't need it
  // (see ROLLBACK.md). See the companion test below that locks that in.
  const htmlFiles = [
    { name: 'index.html', path: indexHtmlPath },
    { name: 'account/index.html', path: accountHtmlPath },
    { name: 'shipment/index.html', path: shipmentHtmlPath },
    { name: 'shipment/dispatch/index.html', path: dispatchHtmlPath },
    { name: 'shipment/mobile/index.html', path: mobileHtmlPath }
  ];

  htmlFiles.forEach(({ name, path: filePath }) => {
    assert.ok(fs.existsSync(filePath), `${name} must exist`);
    const content = fs.readFileSync(filePath, 'utf8');
    assert.match(content, /src=["']\/shared\/three-interactions\.js["']/, `${name} must include three-interactions.js script tag`);
  });
});

test('login/register pages do NOT load shared/three-interactions.js (Task 1.4 removed 3D from those pages)', () => {
  const htmlFiles = [
    { name: 'login/index.html', path: loginHtmlPath },
    { name: 'register/index.html', path: registerHtmlPath }
  ];

  htmlFiles.forEach(({ name, path: filePath }) => {
    assert.ok(fs.existsSync(filePath), `${name} must exist`);
    const content = fs.readFileSync(filePath, 'utf8');
    assert.doesNotMatch(content, /src=["']\/shared\/three-interactions\.js["']/, `${name} must NOT include three-interactions.js script tag`);
  });
});
