'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const SHARED = path.join(__dirname, '..', '..', 'public', 'shared');
const STAR_SRC = fs.readFileSync(path.join(SHARED, 'shooting-star.js'), 'utf8');
const SPECIAL_SRC = fs.readFileSync(path.join(SHARED, 'special-days.js'), 'utf8');
const FIREWORKS_SRC = fs.readFileSync(path.join(SHARED, 'fireworks.js'), 'utf8');

const ORDINARY = '2026-10-09T05:00:00Z';
const BIRTHDAY = '2026-10-27T05:00:00Z';

// Context 2D giả: ghi lại màu stroke, nuốt mọi lời gọi vẽ.
function fakeCtx() {
  const strokes = [];
  const target = {
    strokes,
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} })
  };
  return new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop];
      return () => {};
    },
    set(obj, prop, value) {
      if (prop === 'strokeStyle' && typeof value === 'string') strokes.push(value);
      obj[prop] = value;
      return true;
    }
  });
}

async function makeWindow({ url = 'https://tokosi.example/', now = ORDINARY, preload = true, currentScriptSrc } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><button id="btn">x</button><p id="free">y</p></body></html>', {
    url,
    runScripts: 'outside-only'
  });
  const { window } = dom;
  await new Promise((resolve) => {
    if (window.document.readyState === 'complete') resolve();
    else window.addEventListener('load', resolve);
  });
  const ctx = fakeCtx();
  window.HTMLCanvasElement.prototype.getContext = () => ctx;
  const rafQueue = [];
  window.requestAnimationFrame = (fn) => { rafQueue.push(fn); return rafQueue.length; };
  const fixed = Date.parse(now);
  window.Date.now = () => fixed;
  if (currentScriptSrc) {
    Object.defineProperty(window.document, 'currentScript', { value: { src: currentScriptSrc }, configurable: true });
  }
  if (preload) {
    window.eval(SPECIAL_SRC);
    window.eval(FIREWORKS_SRC);
  }
  return { dom, window, ctx, rafQueue };
}

let clockTick = 0;
function click(window, target, x = 200, y = 200) {
  // Mỗi click cách nhau 500ms để không dính debounce 100ms của handler.
  const base = Date.parse(BIRTHDAY) + (clockTick += 500);
  window.Date.now = () => base;
  target.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, button: 0 }));
}

test('ngày thường: chạy sao băng, không khởi tạo pháo hoa', async () => {
  const { dom, window, rafQueue } = await makeWindow({ now: ORDINARY });
  try {
    let mounts = 0;
    const realMount = window.TKSFireworks.mount;
    window.TKSFireworks.mount = (...a) => { mounts++; return realMount(...a); };
    window.eval(STAR_SRC);
    assert.equal(mounts, 0);
    assert.equal(rafQueue.length, 1, 'vòng lặp sao băng chạy ngay');
    assert.equal(typeof window.spawnShootingStar, 'function');
  } finally { dom.window.close(); }
});

test('ngày sinh nhật 27/10: chạy pháo hoa, vòng lặp chỉ chạy sau khi click', async () => {
  const { dom, window, rafQueue } = await makeWindow({ now: BIRTHDAY });
  try {
    let mounts = 0;
    const realMount = window.TKSFireworks.mount;
    window.TKSFireworks.mount = (...a) => { mounts++; return realMount(...a); };
    window.eval(STAR_SRC);
    assert.equal(mounts, 1);
    assert.equal(rafQueue.length, 0, 'không có vòng lặp khi nhàn rỗi');
    click(window, window.document.getElementById('free'));
    assert.equal(rafQueue.length, 1, 'click khởi động vòng lặp');
  } finally { dom.window.close(); }
});

test('?fireworks=1 ép pháo hoa vào ngày thường', async () => {
  const { dom, window } = await makeWindow({ url: 'https://tokosi.example/?fireworks=1', now: ORDINARY });
  try {
    let mounts = 0;
    const realMount = window.TKSFireworks.mount;
    window.TKSFireworks.mount = (...a) => { mounts++; return realMount(...a); };
    window.eval(STAR_SRC);
    assert.equal(mounts, 1);
  } finally { dom.window.close(); }
});

test('chưa nạp special-days.js: chèn script cùng ?v= và quay về sao băng nếu nạp lỗi', async () => {
  const { dom, window, rafQueue } = await makeWindow({
    preload: false,
    now: BIRTHDAY,
    currentScriptSrc: 'https://tokosi.example/shared/shooting-star.js?v=20261019'
  });
  try {
    window.eval(STAR_SRC);
    const injected = window.document.head.querySelector('script[src*="special-days.js"]');
    assert.ok(injected, 'phải chèn special-days.js');
    assert.equal(injected.getAttribute('src'), '/shared/special-days.js?v=20261019');
    assert.equal(rafQueue.length, 0, 'chưa chọn hiệu ứng khi script chưa nạp xong');
    injected.onerror();
    assert.equal(rafQueue.length, 1, 'lỗi nạp -> sao băng');
  } finally { dom.window.close(); }
});

function mountDirect(window, ctx, extra = {}) {
  const canvas = window.document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = 800;
  const rafQueue = [];
  const fw = window.TKSFireworks.mount({
    canvas,
    ctx,
    raf: (fn) => rafQueue.push(fn),
    isInteractiveControl: (el) => !!(el && el.closest && el.closest('button')),
    ...extra
  });
  let ts = 0;
  function frames(n, step = 16) {
    for (let i = 0; i < n && rafQueue.length; i++) {
      const fn = rafQueue.shift();
      ts += step;
      fn(ts);
    }
  }
  return { fw, rafQueue, frames };
}

test('rocket bay lên rồi nổ thành hạt, sau đó vòng lặp tự dừng', async () => {
  const { dom, window, ctx } = await makeWindow({ now: BIRTHDAY });
  try {
    const { fw, rafQueue, frames } = mountDirect(window, ctx);
    fw.fire(500, 300);
    assert.equal(fw._state().rockets, 1);
    assert.equal(fw._state().running, true);

    let exploded = false;
    for (let i = 0; i < 80 && !exploded; i++) {
      frames(1);
      exploded = fw._state().rockets === 0 && fw._state().particles > 20;
    }
    assert.ok(exploded, 'rocket phải nổ ra nhiều hạt');

    frames(400);
    assert.deepEqual({ ...fw._state() }, { rockets: 0, particles: 0, flashes: 0, running: false });
    assert.equal(rafQueue.length, 0, 'không còn rAF khi hết hiệu ứng');

    fw.fire(300, 300);
    assert.equal(fw._state().running, true, 'click mới chạy lại vòng lặp');
    fw.stop();
  } finally { dom.window.close(); }
});

test('mỗi lần nổ dùng bảng màu khác lần trước, qua nhiều lần click có nhiều màu', async () => {
  const { dom, window, ctx } = await makeWindow({ now: BIRTHDAY });
  try {
    const { fw, frames } = mountDirect(window, ctx);
    const hueGroups = new Set();
    for (let shot = 0; shot < 14; shot++) {
      ctx.strokes.length = 0;
      fw.fire(300 + shot * 20, 300);
      frames(60);
      const hues = ctx.strokes
        .map(s => /^hsla\((\d+),/.exec(s))
        .filter(Boolean)
        .map(m => Math.floor(Number(m[1]) / 60));
      hues.forEach(h => hueGroups.add(h));
      frames(300);
    }
    assert.ok(hueGroups.size >= 4, `cần nhiều dải màu khác nhau, thấy ${hueGroups.size}`);
    fw.stop();
  } finally { dom.window.close(); }
});

test('click lên nút/ô tương tác không bắn; click vào vùng trống thì bắn; chuột phải bỏ qua', async () => {
  const { dom, window, ctx } = await makeWindow({ now: BIRTHDAY });
  try {
    const { fw } = mountDirect(window, ctx);
    click(window, window.document.getElementById('btn'));
    assert.equal(fw._state().rockets, 0);
    click(window, window.document.getElementById('free'));
    assert.equal(fw._state().rockets, 1);
    window.document.getElementById('free').dispatchEvent(
      new window.MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10, button: 2 })
    );
    assert.equal(fw._state().rockets, 1);
    fw.stop();
  } finally { dom.window.close(); }
});

test('giới hạn số rocket và số hạt đồng thời', async () => {
  const { dom, window, ctx } = await makeWindow({ now: BIRTHDAY });
  try {
    const { fw, frames } = mountDirect(window, ctx);
    for (let i = 0; i < 40; i++) fw.fire(100 + i * 10, 200);
    assert.ok(fw._state().rockets <= 6);
    for (let i = 0; i < 30; i++) { frames(3); fw.fire(200 + i * 15, 250); }
    frames(10);
    assert.ok(fw._state().particles <= 1400, `hạt ${fw._state().particles}`);
    fw.stop();
  } finally { dom.window.close(); }
});

test('prefers-reduced-motion: nổ ngay tại chỗ, ít hạt, không có rocket', async () => {
  const { dom, window, ctx } = await makeWindow({ now: BIRTHDAY });
  try {
    window.matchMedia = (q) => ({ matches: /reduce/.test(q) });
    const { fw, frames } = mountDirect(window, ctx);
    fw.fire(400, 300);
    const state = fw._state();
    assert.equal(state.rockets, 0);
    assert.ok(state.particles > 0 && state.particles <= 40, `hạt ${state.particles}`);
    frames(120);
    assert.equal(fw._state().running, false);
    fw.stop();
  } finally { dom.window.close(); }
});

test('theme sáng dùng source-over, theme tối dùng lighter', async () => {
  const { dom, window, ctx } = await makeWindow({ now: BIRTHDAY });
  try {
    const { fw, frames } = mountDirect(window, ctx);
    fw.fire(300, 300);
    frames(2);
    assert.equal(ctx.globalCompositeOperation, 'lighter');
    frames(300);
    window.document.documentElement.setAttribute('data-theme', 'light');
    fw.fire(300, 300);
    frames(2);
    assert.equal(ctx.globalCompositeOperation, 'source-over');
    fw.stop();
  } finally { dom.window.close(); }
});

test('mọi kiểu nổ trong PATTERNS đều tạo hạt, tự tàn hết và không ném lỗi', async () => {
  const { dom, window, ctx } = await makeWindow({ now: BIRTHDAY });
  try {
    const { fw, frames } = mountDirect(window, ctx);
    const names = [...new Set(window.TKSFireworks.PATTERNS)];
    assert.ok(names.length >= 12, `cần nhiều kiểu nổ, có ${names.length}`);
    for (const name of names) {
      fw.fire(500, 300, name);
      let seen = 0;
      for (let i = 0; i < 90; i++) { frames(1); seen = Math.max(seen, fw._state().particles); }
      assert.ok(seen > 20, `${name}: chỉ thấy ${seen} hạt`);
      frames(600);
      assert.deepEqual({ ...fw._state() }, { rockets: 0, particles: 0, flashes: 0, running: false }, name);
    }
    fw.stop();
  } finally { dom.window.close(); }
});

test('nổ 2 cấp: crossette/bloom/crackle sinh thêm hạt sau lần nổ đầu, twin nổ thêm quả thứ hai', async () => {
  const { dom, window, ctx } = await makeWindow({ now: BIRTHDAY });
  try {
    const { fw, frames } = mountDirect(window, ctx);
    for (const name of ['crossette', 'bloom', 'crackle', 'twin']) {
      fw.fire(500, 300, name);
      let first = 0;
      let peak = 0;
      let exploded = false;
      for (let i = 0; i < 200; i++) {
        frames(1);
        const s = fw._state();
        if (!exploded && s.rockets === 0 && s.particles > 0) { exploded = true; first = s.particles; }
        if (exploded) peak = Math.max(peak, s.particles);
      }
      assert.ok(exploded, `${name}: không nổ`);
      assert.ok(peak > first * 1.25, `${name}: cấp 2 không bổ sung hạt (đầu ${first}, đỉnh ${peak})`);
      frames(600);
    }
    fw.stop();
  } finally { dom.window.close(); }
});

test('bảng màu: nhiều bảng, hue hợp lệ', () => {
  const { JSDOM: J } = require('jsdom');
  const win = new J('<!doctype html><html></html>', { runScripts: 'outside-only' }).window;
  win.eval(FIREWORKS_SRC);
  const { PALETTES } = win.TKSFireworks;
  assert.ok(PALETTES.length >= 10);
  for (const p of PALETTES) {
    assert.ok(p.hues.length >= 3 && p.sat >= 80, p.name);
    p.hues.forEach(h => assert.ok(h >= 0 && h <= 360, p.name));
  }
  win.close();
});
