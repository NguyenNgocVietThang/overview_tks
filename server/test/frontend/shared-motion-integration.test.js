'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const publicDir = path.resolve(__dirname, '../../public');

function entrypoints(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name === 'prototypes') return [];
    return entry.isDirectory() ? entrypoints(file) : entry.name.endsWith('.html') ? [file] : [];
  });
}

test('application HTML entrypoints load shared entrance motion except the static login page', () => {
  const files = entrypoints(publicDir);
  assert.ok(files.length >= 13, 'cover dashboard, standalone tools, auth, error and Telegram pages');
  for (const file of files) {
    const dom = new JSDOM(fs.readFileSync(file, 'utf8'));
    const scripts = dom.window.document.querySelectorAll('script[src^="/shared/motion.js"]');
    if (path.relative(publicDir, file).split(path.sep).join('/') === 'login/index.html') {
      assert.equal(scripts.length, 0, 'login stays static');
      dom.window.close();
      continue;
    }
    assert.equal(scripts.length, 1, path.relative(publicDir, file));
    assert.equal(scripts[0].defer, true, path.relative(publicDir, file));
    assert.ok(fs.existsSync(path.join(publicDir, scripts[0].getAttribute('src').split('?')[0])));
    dom.window.close();
  }
});
