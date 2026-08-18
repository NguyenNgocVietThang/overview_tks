/**
 * three-css-transforms.test.js
 * Test suite for Task 3: 3D CSS Transforms to Cards and Panels (3D Design.md)
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.join(__dirname, '..');
const sharedCssPath = path.join(publicDir, 'shared', 'shared.css');
const indexHtmlPath = path.join(publicDir, 'index.html');
const loginHtmlPath = path.join(publicDir, 'login', 'index.html');
const registerHtmlPath = path.join(publicDir, 'register', 'index.html');
const accountHtmlPath = path.join(publicDir, 'account', 'index.html');
const shipmentHtmlPath = path.join(publicDir, 'shipment', 'index.html');
const dispatchHtmlPath = path.join(publicDir, 'shipment', 'dispatch', 'index.html');
const mobileHtmlPath = path.join(publicDir, 'shipment', 'mobile', 'index.html');

test('shared.css exists and defines 3D perspective and transform rules', () => {
  assert.ok(fs.existsSync(sharedCssPath), 'shared.css must exist');
  const css = fs.readFileSync(sharedCssPath, 'utf8');

  // 1. Perspective container
  assert.match(css, /\.perspective-container/, 'shared.css must define .perspective-container');
  assert.match(css, /perspective:\s*1000px/, 'Perspective container must specify perspective: 1000px');
  assert.match(css, /perspective-origin:\s*50%\s+50%/, 'Perspective container must specify perspective-origin: 50% 50%');

  // 2. Card 3D transform-style and transition
  assert.match(css, /\.card-3d/, 'shared.css must define .card-3d');
  assert.match(css, /transform-style:\s*preserve-3d/, '3D cards/panels must have transform-style: preserve-3d');
  assert.match(css, /cubic-bezier\(0\.23,\s*1,\s*0\.32,\s*1\)/, '3D cards must use cubic-bezier transition easing');

  // 3. Hover 3D effects
  assert.match(css, /translateZ\(20px\)/, 'Hover state must translateZ(20px)');
  assert.match(css, /scale\(1\.02\)/, 'Hover state must scale(1.02)');
  assert.match(css, /var\(--primary\)/, 'Hover state must apply primary glow in box-shadow');

  // 4. Reduced motion support
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/, 'shared.css must have prefers-reduced-motion media query');
  assert.match(css, /transform:\s*none/, 'Reduced motion must reset transform to none');
  assert.match(css, /box-shadow:\s*0 0 0 2px var\(--primary\)/, 'Reduced motion must show highlight border box-shadow');
});

test('shared.css ensures proper z-index and positioning hierarchy', () => {
  const css = fs.readFileSync(sharedCssPath, 'utf8');

  // Canvas background layer z-index: -1
  assert.match(css, /\.tks-bg-canvas[\s\S]*?z-index:\s*-1/, 'Canvas must have z-index: -1');

  // Content / Shell layer z-index >= 1
  assert.match(css, /\.shell[\s\S]*?z-index:\s*1/, 'Shell must establish stacking context above canvas');
  assert.match(css, /\.content[\s\S]*?z-index:\s*1/, 'Content must establish stacking context above canvas');
});

test('index.html contains 3D CSS transforms and perspective rules in inline styles', () => {
  assert.ok(fs.existsSync(indexHtmlPath), 'index.html must exist');
  const html = fs.readFileSync(indexHtmlPath, 'utf8');

  assert.match(html, /\.perspective-container/, 'index.html must define .perspective-container');
  assert.match(html, /perspective:\s*1000px/, 'index.html must define perspective: 1000px');
  assert.match(html, /\.card-3d/, 'index.html must define .card-3d');
  assert.match(html, /transform-style:\s*preserve-3d/, 'index.html must define transform-style: preserve-3d');
  assert.match(html, /translateZ\(20px\)/, 'index.html must define translateZ(20px) on hover');
  assert.match(html, /prefers-reduced-motion:\s*reduce/, 'index.html must support prefers-reduced-motion');
});

test('login and register pages include perspective-container and card-3d classes', () => {
  const loginHtml = fs.readFileSync(loginHtmlPath, 'utf8');
  assert.match(loginHtml, /class="[^"]*perspective-container[^"]*"/, 'login page must contain perspective-container');
  assert.match(loginHtml, /class="[^"]*card-3d[^"]*"/, 'login page must contain card-3d');

  const registerHtml = fs.readFileSync(registerHtmlPath, 'utf8');
  assert.match(registerHtml, /class="[^"]*perspective-container[^"]*"/, 'register page must contain perspective-container');
  assert.match(registerHtml, /class="[^"]*card-3d[^"]*"/, 'register page must contain card-3d');
});

test('account page includes perspective-container and card-3d classes on profile and admin cards', () => {
  const accountHtml = fs.readFileSync(accountHtmlPath, 'utf8');
  assert.match(accountHtml, /class="[^"]*profile-grid[^"]*perspective-container[^"]*"/, 'account profile grid must have perspective-container');
  assert.match(accountHtml, /class="[^"]*profile-card[^"]*card-3d[^"]*"/, 'profile cards must have card-3d');
  assert.match(accountHtml, /class="[^"]*kpi-row[^"]*perspective-container[^"]*"/, 'admin kpi row must have perspective-container');
  assert.match(accountHtml, /class="[^"]*kpi-stat[^"]*card-3d[^"]*"/, 'kpi stats must have card-3d');
});

test('shipment pages include perspective-container and card-3d classes', () => {
  const shipmentHtml = fs.readFileSync(shipmentHtmlPath, 'utf8');
  assert.match(shipmentHtml, /class="[^"]*perspective-container[^"]*"/, 'shipment page must have perspective-container');
  assert.match(shipmentHtml, /class="[^"]*card-3d[^"]*"/, 'shipment page must have card-3d');

  const dispatchHtml = fs.readFileSync(dispatchHtmlPath, 'utf8');
  assert.match(dispatchHtml, /class="[^"]*perspective-container[^"]*"/, 'dispatch page must have perspective-container');
  assert.match(dispatchHtml, /class="[^"]*card-3d[^"]*"/, 'dispatch page must have card-3d');

  const mobileHtml = fs.readFileSync(mobileHtmlPath, 'utf8');
  assert.match(mobileHtml, /class="[^"]*perspective-container[^"]*"/, 'mobile page must have perspective-container');
});
