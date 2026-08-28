/**
 * no-3d-effects.test.js
 *
 * The dashboard used to ship a full 3D layer: a Three.js WebGL particle
 * background, a CSS-3D cube loader, and perspective/translateZ hover effects on
 * cards, nav items, search boxes and — worst of all — every single <tbody> row.
 * It was removed because it made the dashboard unusably slow on ordinary
 * hardware (see the 3D Design.md plan for what used to be there).
 *
 * These tests replace the old three-*.test.js suite. They are regression
 * guards: they fail if any part of that layer comes back, or if the related
 * scroll-performance fixes are undone. The structural assertions the old suite
 * also carried (sidebar/table markup, stacking hierarchy) are kept here.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.join(__dirname, '..', '..', 'public');
const sharedCssPath = path.join(publicDir, 'shared', 'shared.css');

const PAGES = [
  { name: 'index.html', file: 'index.html' },
  { name: 'account/index.html', file: 'account/index.html' },
  { name: 'humanresources/index.html', file: 'humanresources/index.html' },
  { name: 'login/index.html', file: 'login/index.html' },
  { name: 'register/index.html', file: 'register/index.html' },
  { name: 'shipment/index.html', file: 'shipment/index.html' },
  { name: 'shipment/dispatch/index.html', file: 'shipment/dispatch/index.html' },
  { name: 'shipment/mobile/index.html', file: 'shipment/mobile/index.html' },
  { name: '404.html', file: '404.html' }
];

const readPage = (file) => fs.readFileSync(path.join(publicDir, file), 'utf8');

/* Strip comments so an explanatory note about the removal does not read as the
   thing itself coming back. */
const stripHtmlComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '');
const stripCssComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

test('the Three.js bundle and its helper scripts are gone from the repo', () => {
  const removed = [
    'vendor/three.min.js',
    'shared/three-bg.js',
    'shared/three-interactions.js',
    'shared/three-loading.js',
    'shared/three-memory.js',
    'shared/three-performance.js',
    'shared/three-visibility.js',
    'performance-test.html'
  ];

  removed.forEach((rel) => {
    assert.ok(
      !fs.existsSync(path.join(publicDir, rel)),
      `${rel} must stay deleted — it is part of the removed 3D layer`
    );
  });
});

test('no page loads a three-* script or the Three.js vendor bundle', () => {
  PAGES.forEach(({ name, file }) => {
    const html = stripHtmlComments(readPage(file));
    assert.ok(
      !/<script[^>]+src=["'][^"']*three[-.]/i.test(html),
      `${name} must not load any three-* script`
    );
  });
});

test('no page references the removed 3D JS globals', () => {
  const globals = ['TKS3D', 'TKSInteractions', 'TKSLoading', 'TKSMemory', 'TKSVisibility', 'TKSPerformance', 'animateTableRows'];
  const extraJs = ['shared/shared-nav.js', 'js/pagination.js', 'shared/image-compress.js'];

  [...PAGES.map((p) => p.file), ...extraJs].forEach((file) => {
    const src = stripHtmlComments(readPage(file));
    globals.forEach((g) => {
      assert.ok(
        !new RegExp('\\b' + g + '\\b').test(src),
        `${file} must not reference the removed global ${g}`
      );
    });
  });
});

test('no stylesheet uses 3D transforms, perspective or preserve-3d', () => {
  const forbidden = [
    { re: /transform-style\s*:\s*preserve-3d/i, why: 'transform-style: preserve-3d' },
    { re: /(^|[^-\w])perspective\s*:/im, why: 'perspective property' },
    { re: /perspective-origin\s*:/i, why: 'perspective-origin property' },
    { re: /translateZ\s*\(/i, why: 'translateZ()' },
    { re: /perspective\s*\(/i, why: 'perspective() transform function' },
    { re: /rotate[XY]\s*\(/i, why: 'rotateX()/rotateY()' }
  ];

  const sources = [
    { name: 'shared/shared.css', src: stripCssComments(fs.readFileSync(sharedCssPath, 'utf8')) },
    ...PAGES.map(({ name, file }) => ({ name, src: stripCssComments(stripHtmlComments(readPage(file))) }))
  ];

  sources.forEach(({ name, src }) => {
    forbidden.forEach(({ re, why }) => {
      assert.ok(!re.test(src), `${name} must not use ${why} — it forces per-element compositor layers`);
    });
  });
});

test('no markup carries the removed .card-3d / .perspective-container hooks', () => {
  PAGES.forEach(({ name, file }) => {
    const html = stripHtmlComments(readPage(file));
    assert.ok(!/card-3d/.test(html), `${name} must not use the .card-3d class`);
    assert.ok(!/perspective-container/.test(html), `${name} must not use the .perspective-container class`);
  });
});

test('the page background is not painted with background-attachment: fixed', () => {
  // `fixed` forces a full-viewport repaint (including rescaling the cover
  // photo) on every scroll frame. The background lives on a fixed
  // `body::before` layer instead.
  const sources = [
    { name: 'shared/shared.css', src: stripCssComments(fs.readFileSync(sharedCssPath, 'utf8')) },
    ...PAGES.map(({ name, file }) => ({ name, src: stripCssComments(stripHtmlComments(readPage(file))) }))
  ];

  sources.forEach(({ name, src }) => {
    assert.ok(
      !/background-attachment\s*:\s*fixed/i.test(src),
      `${name} must not use background-attachment: fixed`
    );
    assert.ok(
      !/no-repeat\s+fixed/i.test(src),
      `${name} must not use the \`fixed\` keyword in a background shorthand`
    );
  });

  const shared = fs.readFileSync(sharedCssPath, 'utf8');
  assert.match(shared, /body::before\s*\{[\s\S]*?position\s*:\s*fixed/, 'shared.css must paint the page background on a fixed body::before layer');
  assert.match(shared, /body::before\s*\{[\s\S]*?z-index\s*:\s*-1/, 'the body::before background layer must sit behind content');
});

test('the loading veil uses the plain CSS spinner, not the removed 3D cube', () => {
  const shared = fs.readFileSync(sharedCssPath, 'utf8');
  assert.match(shared, /\.loading-veil\s*\{/, 'shared.css must still style .loading-veil');
  assert.match(shared, /\.loader-spinner\s*\{/, 'shared.css must define the replacement .loader-spinner');
  assert.ok(!/\.cube\b/.test(stripCssComments(shared)), 'the CSS-3D cube loader must stay removed');

  const index = readPage('index.html');
  assert.match(index, /id="veil"/, 'index.html must still have the loading veil element');
  assert.match(index, /class="loader-spinner"/, 'the veil must contain the static spinner markup');
  // The veil markup used to be injected at runtime by three-loading.js; it is
  // now static, so it must be present in the served HTML itself.
  assert.match(index, /<div class="loading-veil"[\s\S]*?loader-spinner[\s\S]*?<\/div>/, 'veil markup must be static in the HTML');
});

test('the full-screen loading veil does not blur its backdrop', () => {
  // A backdrop-filter here re-renders the whole viewport every time the veil
  // fades in, and the dashboard shows it on every auto-refresh.
  const shared = stripCssComments(fs.readFileSync(sharedCssPath, 'utf8'));
  const veilBlock = shared.match(/\.loading-veil\s*\{[\s\S]*?\}/);
  assert.ok(veilBlock, 'shared.css must define a .loading-veil block');
  assert.ok(!/backdrop-filter/i.test(veilBlock[0]), '.loading-veil must not use backdrop-filter');
});

test('stacking hierarchy keeps content above the background layer', () => {
  const css = fs.readFileSync(sharedCssPath, 'utf8');
  assert.match(css, /\.shell\{[\s\S]*?z-index:\s*1/, 'shell must establish a stacking context above the background layer');
  assert.match(css, /\.content\{[\s\S]*?z-index:\s*1/, 'content must establish a stacking context above the background layer');
});

test('pages with a sidebar still have valid navigation structure', () => {
  ['index.html', 'account/index.html', 'shipment/index.html', 'shipment/dispatch/index.html'].forEach((file) => {
    assert.match(readPage(file), /id=["']sidebar["']/, `${file} must contain a sidebar element`);
  });
});

test('pages with tables still have valid table structure', () => {
  ['index.html', 'account/index.html', 'shipment/index.html'].forEach((file) => {
    assert.match(readPage(file), /<tbody[\s>]/, `${file} must contain tbody elements`);
  });
});
