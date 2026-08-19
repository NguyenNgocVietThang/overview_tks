'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const vendorThreePath = path.join(__dirname, '..', '..', 'public', 'vendor', 'three.min.js');

test('THREE.js r159 vendor bundle exists and has expected size', () => {
  assert.ok(fs.existsSync(vendorThreePath), 'vendor/three.min.js phai ton tai');
  const stats = fs.statSync(vendorThreePath);
  assert.ok(stats.size > 500000 && stats.size < 1000000, `Kich thuoc file hop ly (~580KB - ~700KB), thuc te: ${stats.size} bytes`);
});

test('THREE.js r159 vendor bundle loads window.THREE and initializes 3D core components', () => {
  const code = fs.readFileSync(vendorThreePath, 'utf8');
  const sandbox = { console };
  vm.createContext(sandbox);
  assert.doesNotThrow(() => {
    vm.runInContext(code, sandbox);
  }, 'three.min.js phai thuc thi khong co loi');

  assert.ok(sandbox.THREE, 'window/global.THREE phai duoc dinh nghia');
  assert.equal(sandbox.THREE.REVISION, '159', 'Phien ban THREE.js phai la r159');

  const scene = new sandbox.THREE.Scene();
  assert.equal(scene.isScene, true, 'THREE.Scene phai khoi tao thanh cong');

  const camera = new sandbox.THREE.PerspectiveCamera(60, 1.5, 0.1, 1000);
  assert.equal(camera.isPerspectiveCamera, true, 'THREE.PerspectiveCamera phai khoi tao thanh cong');

  const geometry = new sandbox.THREE.BufferGeometry();
  assert.equal(geometry.isBufferGeometry, true, 'THREE.BufferGeometry phai khoi tao thanh cong');
});
