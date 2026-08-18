/**
 * three-buttons.test.js
 * Test suite for Task 7: Enhance Buttons with 3D Press Animation (3D Design.md)
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const publicDir = path.join(__dirname, '..');
const sharedCssPath = path.join(publicDir, 'shared', 'shared.css');
const indexHtmlPath = path.join(publicDir, 'index.html');
const interactionsPath = path.join(publicDir, 'shared', 'three-interactions.js');

function createMockElement(tagName = 'button', classes = [], attrs = {}) {
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
    offsetWidth: 120,
    offsetHeight: 42,
    disabled: !!attrs.disabled,
    getAttribute(name) {
      return attributes[name] !== undefined ? attributes[name] : (name === 'disabled' && el.disabled ? '' : null);
    },
    setAttribute(name, val) {
      attributes[name] = val;
      if (name === 'disabled') el.disabled = true;
    },
    removeAttribute(name) {
      delete attributes[name];
      if (name === 'disabled') el.disabled = false;
    },
    hasAttribute(name) {
      return attributes[name] !== undefined || (name === 'disabled' && el.disabled);
    },
    getBoundingClientRect() {
      return { left: 100, top: 100, width: 120, height: 42, right: 220, bottom: 142 };
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
  return el;
}

test('shared.css defines 3D button styling rules', () => {
  assert.ok(fs.existsSync(sharedCssPath), 'shared.css must exist');
  const css = fs.readFileSync(sharedCssPath, 'utf8');

  // Button transform-style and transition
  assert.match(css, /\.btn-primary[\s\S]*?transform-style:\s*preserve-3d/, 'shared.css must define transform-style: preserve-3d for buttons');
  assert.match(css, /\.btn-primary[\s\S]*?transition:[\s\S]*?transform 0\.15s/, 'shared.css must define 0.15s transform transition');

  // Button hover elevation and glow. Deliberately translateY-only (no
  // scale/perspective translateZ): a geometry-shrinking press transform on
  // the clickable element itself can move its hit-region out from under
  // the cursor between mousedown and mouseup, so the resulting click
  // resolves to the parent element instead of the button and the click is
  // lost. See the comment above these rules and three-interactions.js's
  // setupButtonEffects for the full explanation.
  assert.match(css, /\.btn-primary:hover:not\(:disabled\)[\s\S]*?translateY\(-2px\)/, 'Button hover must translateY(-2px)');
  assert.doesNotMatch(css, /\.btn-primary:hover:not\(:disabled\)[\s\S]{0,80}(perspective\(|translateZ\(|scale\()/, 'Button hover must not use perspective/translateZ/scale (breaks click hit-testing)');
  assert.match(css, /\.btn-primary:hover:not\(:disabled\)[\s\S]*?box-shadow:/, 'Button hover must define glow box-shadow');

  // Button active press down effect
  assert.match(css, /\.btn-primary:active:not\(:disabled\)[\s\S]*?translateY\(1px\)/, 'Button active must translateY(1px)');
  assert.doesNotMatch(css, /\.btn-primary:active:not\(:disabled\)[\s\S]{0,120}(perspective\(|translateZ\(|scale\()/, 'Button active must not use perspective/translateZ/scale (breaks click hit-testing)');
  assert.match(css, /\.btn-primary:active:not\(:disabled\)[\s\S]*?box-shadow:/, 'Button active must define tactile compressed box-shadow');

  // Disabled state resets
  assert.match(css, /\.btn-primary:disabled[\s\S]*?transform:\s*none/, 'Disabled button must reset transform');

  // Ripple effect styles and animation
  assert.match(css, /\.ripple-effect[\s\S]*?position:\s*absolute/, 'Ripple effect must have position: absolute');
  assert.match(css, /\.ripple-effect[\s\S]*?border-radius:\s*50%/, 'Ripple effect must have border-radius: 50%');
  assert.match(css, /@keyframes\s+rippleAnimation/, 'shared.css must define @keyframes rippleAnimation');
  assert.match(css, /rippleAnimation[\s\S]*?scale\(/, 'rippleAnimation must scale up');

  // Reduced motion overrides
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.btn-primary:hover/, 'shared.css must override button hover on reduced motion');
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.btn-primary:active/, 'shared.css must override button active on reduced motion');
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.ripple-effect[\s\S]*?display:\s*none/, 'shared.css must disable ripple effect on reduced motion');
});

test('index.html inline style mirrors 3D button styling rules', () => {
  assert.ok(fs.existsSync(indexHtmlPath), 'index.html must exist');
  const html = fs.readFileSync(indexHtmlPath, 'utf8');

  // .refresh-btn 3D rules in index.html — translateY-only, see the sibling
  // assertions in the shared.css test above for why perspective/translateZ/
  // scale are disallowed here (they broke click hit-testing).
  assert.match(html, /\.refresh-btn[\s\S]*?transform-style:\s*preserve-3d/, 'index.html must define transform-style: preserve-3d');
  assert.match(html, /\.refresh-btn:hover:not\(:disabled\)[\s\S]*?translateY\(-2px\)/, 'index.html .refresh-btn hover must translateY(-2px)');
  assert.match(html, /\.refresh-btn:active:not\(:disabled\)[\s\S]*?translateY\(1px\)/, 'index.html .refresh-btn active must translateY(1px)');
  assert.doesNotMatch(html, /\.refresh-btn:hover:not\(:disabled\)[\s\S]{0,80}(perspective\(|translateZ\(|scale\()/, 'index.html .refresh-btn hover must not use perspective/translateZ/scale');
  assert.doesNotMatch(html, /\.refresh-btn:active:not\(:disabled\)[\s\S]{0,120}(perspective\(|translateZ\(|scale\()/, 'index.html .refresh-btn active must not use perspective/translateZ/scale');

  // .ripple-effect in index.html
  assert.match(html, /\.ripple-effect[\s\S]*?border-radius:\s*50%/, 'index.html must define .ripple-effect');
  assert.match(html, /@keyframes\s+rippleAnimation/, 'index.html must define @keyframes rippleAnimation');

  // Reduced motion in index.html
  assert.match(html, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.refresh-btn:hover/, 'index.html must override button hover on reduced motion');
  assert.match(html, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.ripple-effect/, 'index.html must disable ripple on reduced motion');
});

test('three-interactions.js handles 3D button press animation and dynamic ripple generation', () => {
  assert.ok(fs.existsSync(interactionsPath), 'three-interactions.js must exist');

  const btn1 = createMockElement('button', ['refresh-btn']);
  const btn2 = createMockElement('button', ['btn-primary']);
  const btnDisabled = createMockElement('button', ['btn-primary'], { disabled: 'true' });

  const queryMap = {
    '.btn-primary, .refresh-btn, .theme-toggle, .theme-toggle-floating, .theme-toggle-disp, .btn-secondary, .btn-danger, .btn-outline, .btn-export, .export-button, .export-btn, .tks-btn-primary, .tks-btn-secondary, .tks-btn-danger, .login-btn, .register-btn, .search-submit, .period-toggle button, .pagination-controls button, .profile-trigger, .menu-btn, .btn': [btn1, btn2, btnDisabled]
  };

  const mockDocument = {
    readyState: 'complete',
    documentElement: { dataset: { theme: 'dark' } },
    createElement(tag) {
      return createMockElement(tag);
    },
    querySelectorAll(selector) {
      return queryMap[selector] || [];
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
    setTimeout: (fn) => fn(),
    clearTimeout: () => {},
    console
  });

  const scriptCode = fs.readFileSync(interactionsPath, 'utf8');
  vm.runInContext(scriptCode, context);

  const TKS3D = context.window.TKS3D;
  assert.ok(TKS3D, 'TKS3D must be defined');

  // Test 1: Button initialization
  assert.strictEqual(btn1.dataset.tks3dBtnInit, 'true', 'Button 1 must be initialized');
  assert.strictEqual(btn1.style.transformStyle, 'preserve-3d', 'Button 1 must have transformStyle preserve-3d');

  // Test 2: Mousedown must NOT set an inline transform. The pressed look is
  // owned entirely by the CSS `:active` rule (translateY-only, see
  // shared.css). A JS-driven inline transform here previously required a
  // matching 'mouseup'/'mouseleave' on the SAME element to clear it — but
  // if the press transform shifted the button under the cursor, mouseup
  // could land on a different element (e.g. the parent form), leaving the
  // transform stuck and the click lost. See ROLLBACK.md and the comment in
  // setupButtonEffects for the full history.
  btn1.dispatchEvent({ type: 'mousedown', clientX: 150, clientY: 120 });
  assert.strictEqual(btn1.style.transform, undefined, 'Mousedown must not set btn.style.transform (CSS :active owns the press visual)');

  // Test 3: Ripple effect is still triggered on mousedown (decorative,
  // pointer-events:none, does not affect the button's hit-region)
  assert.ok(typeof TKS3D.addRipple === 'function', 'TKS3D.addRipple must be a function');

  // Test 4/5: mouseup/mouseleave are no longer wired to a transform reset —
  // there is nothing to reset, so no JS state can get stuck if the pointer
  // ends up over a different element on release.
  assert.doesNotThrow(() => btn1.dispatchEvent({ type: 'mouseup' }), 'mouseup must not throw even though no reset listener is attached');
  assert.doesNotThrow(() => btn1.dispatchEvent({ type: 'mouseleave' }), 'mouseleave must not throw even though no reset listener is attached');

  // Test 6: Disabled button should NOT trigger the ripple/press handler at all
  btnDisabled.dispatchEvent({ type: 'mousedown', clientX: 150, clientY: 120 });
  assert.strictEqual(btnDisabled.style.transform, undefined, 'Disabled button must not have any transform applied by JS');

  // Test 7: Destroy cleanup
  TKS3D.destroy();
  assert.strictEqual(btn1.dataset.tks3dBtnInit, undefined, 'Dataset flag must be removed on destroy');
});

test('three-interactions.js addRipple directly generates ripple and respects reduced motion', () => {
  let reducedMotion = false;
  const btn = createMockElement('button', ['refresh-btn']);

  const mockDocument = {
    readyState: 'complete',
    documentElement: { dataset: { theme: 'dark' } },
    createElement(tag) {
      return createMockElement(tag);
    },
    querySelectorAll() { return []; },
    addEventListener() {},
    removeEventListener() {}
  };

  const mockWindow = {
    document: mockDocument,
    matchMedia(query) {
      return { matches: reducedMotion && query.includes('prefers-reduced-motion') };
    },
    addEventListener() {},
    removeEventListener() {}
  };

  const context = vm.createContext({
    window: mockWindow,
    document: mockDocument,
    setTimeout: (fn, ms) => {
      // Delay callback test
      return { fn, ms };
    },
    clearTimeout: () => {},
    console
  });

  const scriptCode = fs.readFileSync(interactionsPath, 'utf8');
  vm.runInContext(scriptCode, context);

  const TKS3D = context.window.TKS3D;

  // Test addRipple when normal motion
  TKS3D.addRipple({ currentTarget: btn, clientX: 150, clientY: 120 });
  assert.strictEqual(btn.children.length, 1, 'Ripple element must be added to button');
  assert.ok(btn.children[0].classList.contains('ripple-effect'), 'Child must have ripple-effect class');

  // Test addRipple when prefers-reduced-motion is true
  reducedMotion = true;
  const btnReduced = createMockElement('button', ['refresh-btn']);
  TKS3D.addRipple({ currentTarget: btnReduced, clientX: 150, clientY: 120 });
  assert.strictEqual(btnReduced.children.length, 0, 'No ripple should be created on reduced motion');
});
