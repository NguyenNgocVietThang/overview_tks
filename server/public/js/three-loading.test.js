/**
 * three-loading.test.js — Unit tests for TKS 3D Loading States
 *
 * Tests for Task 10: Add 3D Loading States (3D Design.md)
 * Run via: node --test server/public/js/three-loading.test.js
 *          (from the `server/` directory)
 *
 * Uses Node.js built-in test runner (node:test) + jsdom for DOM emulation.
 * Install jsdom if not present: npm install --save-dev jsdom
 */

'use strict';

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

// ─── jsdom shim ───────────────────────────────────────────────────────────────
let JSDOM;
try {
  JSDOM = require('jsdom').JSDOM;
} catch (_) {
  console.error('[three-loading.test] jsdom not found. Run: npm install --save-dev jsdom');
  process.exit(1);
}

// ─── Module source ────────────────────────────────────────────────────────────
const MODULE_PATH = path.resolve(__dirname, '../shared/three-loading.js');
const moduleSource = fs.readFileSync(MODULE_PATH, 'utf8');

// ─── Factory: create a fresh jsdom + eval module ──────────────────────────────
function createEnv(bodyHTML) {
  const dom = new JSDOM(
    `<!DOCTYPE html><html><head></head><body>${bodyHTML || ''}</body></html>`,
    { runScripts: 'dangerously' }
  );
  const { window } = dom;
  // Expose module source into the window context
  window.eval(moduleSource);
  return { dom, window, document: window.document };
}

// ═════════════════════════════════════════════════════════════════════════════
// Test suites
// ═════════════════════════════════════════════════════════════════════════════

describe('TKSLoading — module load', () => {
  it('exposes TKSLoading on window', () => {
    const { window } = createEnv('');
    assert.equal(typeof window.TKSLoading, 'object');
  });

  it('has show, hide, wrap, upgrade methods', () => {
    const { window } = createEnv('');
    const api = window.TKSLoading;
    assert.equal(typeof api.show, 'function');
    assert.equal(typeof api.hide, 'function');
    assert.equal(typeof api.wrap, 'function');
    assert.equal(typeof api.upgrade, 'function');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('TKSLoading — injectStyles', () => {
  it('injects a <style> tag with id=tks-loading-3d-styles', () => {
    const { window, document } = createEnv('');
    window.TKSLoading._injectStyles();
    const tag = document.getElementById('tks-loading-3d-styles');
    assert.ok(tag, 'Style tag should exist');
    assert.equal(tag.tagName.toLowerCase(), 'style');
  });

  it('does not inject duplicate style tags', () => {
    const { window, document } = createEnv('');
    window.TKSLoading._injectStyles();
    window.TKSLoading._injectStyles();
    const tags = document.querySelectorAll('#tks-loading-3d-styles');
    assert.equal(tags.length, 1);
  });

  it('style content includes cube keyframe', () => {
    const { window, document } = createEnv('');
    window.TKSLoading._injectStyles();
    const tag = document.getElementById('tks-loading-3d-styles');
    assert.ok(tag.textContent.includes('tks-cube-rotate'), 'Should define cube keyframe');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('TKSLoading — _buildCubeHTML', () => {
  it('returns a non-empty string', () => {
    const { window } = createEnv('');
    const html = window.TKSLoading._buildCubeHTML();
    assert.equal(typeof html, 'string');
    assert.ok(html.length > 0);
  });

  it('contains all 6 face divs', () => {
    const { window } = createEnv('');
    const html = window.TKSLoading._buildCubeHTML();
    const matches = html.match(/class="face/g) || [];
    assert.equal(matches.length, 6);
  });

  it('contains .loader-text with the provided message', () => {
    const { window } = createEnv('');
    const html = window.TKSLoading._buildCubeHTML('Kiểm tra');
    assert.ok(html.includes('loader-text'), 'Should contain loader-text class');
    assert.ok(html.includes('Kiểm tra'), 'Should include the message');
  });

  it('uses default message when none provided', () => {
    const { window } = createEnv('');
    const html = window.TKSLoading._buildCubeHTML();
    assert.ok(html.includes('Đang tải'), 'Should have default message');
  });

  it('has aria-live region for screen readers', () => {
    const { window } = createEnv('');
    const html = window.TKSLoading._buildCubeHTML('Msg');
    assert.ok(html.includes('aria-live="polite"'), 'Should have aria-live region');
  });

  it('cube-scene is aria-hidden', () => {
    const { window } = createEnv('');
    const html = window.TKSLoading._buildCubeHTML();
    assert.ok(html.includes('aria-hidden="true"'), 'Cube scene should be aria-hidden');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('TKSLoading — upgrade', () => {
  it('injects 3D cube into the veil element', () => {
    const { window, document } = createEnv('<div class="loading-veil" id="veil"></div>');
    const el = document.getElementById('veil');
    window.TKSLoading.upgrade(el);
    assert.ok(el.querySelector('.cube'), '.cube should be injected');
    assert.ok(el.querySelector('.loader-3d'), '.loader-3d should be injected');
  });

  it('sets data-tks3d-upgraded attribute', () => {
    const { window, document } = createEnv('<div class="loading-veil" id="veil"></div>');
    const el = document.getElementById('veil');
    window.TKSLoading.upgrade(el);
    assert.equal(el.dataset.tks3dUpgraded, '1');
  });

  it('does not double-upgrade on second call', () => {
    const { window, document } = createEnv('<div class="loading-veil" id="veil"></div>');
    const el = document.getElementById('veil');
    window.TKSLoading.upgrade(el);
    const firstHTML = el.innerHTML;
    window.TKSLoading.upgrade(el);
    assert.equal(el.innerHTML, firstHTML, 'HTML should not change on second call');
  });

  it('updates message text on second call without re-injecting HTML', () => {
    const { window, document } = createEnv('<div class="loading-veil" id="veil"></div>');
    const el = document.getElementById('veil');
    window.TKSLoading.upgrade(el, 'Msg 1');
    window.TKSLoading.upgrade(el, 'Msg 2');
    const dots = el.querySelector('.loader-dots');
    assert.equal(dots.textContent, 'Msg 2');
  });

  it('is a no-op on null element (no throw)', () => {
    const { window } = createEnv('');
    assert.doesNotThrow(() => window.TKSLoading.upgrade(null));
  });

  it('sets role="dialog" on the veil', () => {
    const { window, document } = createEnv('<div class="loading-veil" id="veil"></div>');
    const el = document.getElementById('veil');
    window.TKSLoading.upgrade(el);
    assert.equal(el.getAttribute('role'), 'dialog');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('TKSLoading — show / hide', () => {
  it('show() adds .show class to veil', () => {
    const { window, document } = createEnv('<div class="loading-veil" id="veil"></div>');
    window.TKSLoading.show();
    const el = document.getElementById('veil');
    assert.ok(el.classList.contains('show'), '.show should be added');
  });

  it('show() sets aria-busy="true"', () => {
    const { window, document } = createEnv('<div class="loading-veil" id="veil"></div>');
    window.TKSLoading.show();
    const el = document.getElementById('veil');
    assert.equal(el.getAttribute('aria-busy'), 'true');
  });

  it('hide() removes .show class', () => {
    const { window, document } = createEnv('<div class="loading-veil" id="veil"></div>');
    window.TKSLoading.show();
    window.TKSLoading.hide();
    const el = document.getElementById('veil');
    assert.ok(!el.classList.contains('show'), '.show should be removed');
  });

  it('hide() sets aria-busy="false"', () => {
    const { window, document } = createEnv('<div class="loading-veil" id="veil"></div>');
    window.TKSLoading.show();
    window.TKSLoading.hide();
    const el = document.getElementById('veil');
    assert.equal(el.getAttribute('aria-busy'), 'false');
  });

  it('show() creates #veil-dynamic when no .loading-veil exists', () => {
    const { window, document } = createEnv(''); // no veil in DOM
    window.TKSLoading.show('Dynamic');
    const dynamic = document.getElementById('veil-dynamic');
    assert.ok(dynamic, '#veil-dynamic should be created');
    assert.ok(dynamic.classList.contains('show'), 'Dynamic veil should have .show');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('TKSLoading — wrap', () => {
  it('returns the original promise', async () => {
    const { window } = createEnv('<div class="loading-veil" id="veil"></div>');
    const p = Promise.resolve(42);
    const result = window.TKSLoading.wrap(p);
    assert.equal(result, p);
    const val = await result;
    assert.equal(val, 42);
  });

  it('shows veil immediately (before promise resolves)', () => {
    const { window, document } = createEnv('<div class="loading-veil" id="veil"></div>');
    let resolve;
    const p = new Promise(r => { resolve = r; });
    window.TKSLoading.wrap(p, 'Wrap test');
    const el = document.getElementById('veil');
    assert.ok(el.classList.contains('show'), 'Veil should show immediately');
    resolve();
    return p;
  });

  it('hides veil after promise resolves', async () => {
    const { window, document } = createEnv('<div class="loading-veil" id="veil"></div>');
    const p = Promise.resolve();
    window.TKSLoading.wrap(p);
    await p;
    // Flush microtask queue
    await new Promise(r => setTimeout(r, 0));
    const el = document.getElementById('veil');
    assert.ok(!el.classList.contains('show'), 'Veil should be hidden after resolve');
  });

  it('hides veil even if promise rejects', async () => {
    const { window, document } = createEnv('<div class="loading-veil" id="veil"></div>');
    const p = Promise.reject(new Error('test error'));
    window.TKSLoading.wrap(p);
    try { await p; } catch (_) { /* expected */ }
    await new Promise(r => setTimeout(r, 0));
    const el = document.getElementById('veil');
    assert.ok(!el.classList.contains('show'), 'Veil should be hidden after reject');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('TKSLoading — cube DOM structure', () => {
  it('cube has .cube-core element', () => {
    const { window, document } = createEnv('<div class="loading-veil" id="veil"></div>');
    window.TKSLoading.upgrade(document.getElementById('veil'));
    assert.ok(document.querySelector('.cube-core'), '.cube-core should exist');
  });

  it('cube has .loader-ring element', () => {
    const { window, document } = createEnv('<div class="loading-veil" id="veil"></div>');
    window.TKSLoading.upgrade(document.getElementById('veil'));
    assert.ok(document.querySelector('.loader-ring'), '.loader-ring should exist');
  });

  it('cube has .cube-scene perspective wrapper', () => {
    const { window, document } = createEnv('<div class="loading-veil" id="veil"></div>');
    window.TKSLoading.upgrade(document.getElementById('veil'));
    assert.ok(document.querySelector('.cube-scene'), '.cube-scene should exist');
  });

  it('loader-3d has role="status"', () => {
    const { window, document } = createEnv('<div class="loading-veil" id="veil"></div>');
    window.TKSLoading.upgrade(document.getElementById('veil'));
    const loader = document.querySelector('.loader-3d');
    assert.equal(loader.getAttribute('role'), 'status');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('TKSLoading — auto-upgrade on load', () => {
  it('auto-upgrades .loading-veil after DOMContentLoaded fires', () => {
    // jsdom readyState is 'loading' when HTML is passed as string,
    // so the module registers a DOMContentLoaded listener.
    // We fire the event manually to simulate the browser's load sequence.
    const { window, document } = createEnv('<div class="loading-veil" id="veil"></div>');

    // Dispatch DOMContentLoaded to trigger auto-upgrade
    const evt = new window.Event('DOMContentLoaded', { bubbles: true, cancelable: false });
    document.dispatchEvent(evt);

    const el = document.getElementById('veil');
    assert.ok(el.querySelector('.cube'), 'Auto-upgrade should inject the cube after DOMContentLoaded');
    assert.ok(el.innerHTML.includes('loader-3d'), 'loader-3d should be present');
  });
});
