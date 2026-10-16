'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ROLES } = require('../auth/userRepository');

function readMigration(filename) {
  return fs.readFileSync(path.join(__dirname, 'migrations', filename), 'utf8');
}

const roleSql = readMigration('0019_app_users_role_marketing.sql');
const permissionsSql = readMigration('0020_app_users_feature_permissions.sql');

test('migration 0019 thay CHECK vai_tro de chap nhan "Nhân viên marketing"', () => {
  // CHECK duoc khai bao inline trong 0009 nen Postgres tu dat ten
  // app_users_vai_tro_check — phai DROP dung ten do roi tao lai.
  assert.match(roleSql, /ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_vai_tro_check;/);
  assert.match(roleSql, /ADD CONSTRAINT app_users_vai_tro_check/);
  assert.match(roleSql, /'Nhân viên marketing'/);
});

test('migration 0019 liet ke DUNG va DU moi vai tro trong ROLES (khong bo sot khi them vai tro moi)', () => {
  const listed = [...roleSql.matchAll(/'([^']+)'/g)]
    .map(match => match[1])
    .filter(value => value !== 'app_users_vai_tro_check');
  const expected = Object.values(ROLES);

  assert.deepEqual([...listed].sort(), [...expected].sort());
});

test('migration 0020 them cot feature_permissions dang JSONB, mac dinh object rong', () => {
  assert.match(permissionsSql, /ALTER TABLE app_users/);
  assert.match(permissionsSql, /ADD COLUMN feature_permissions JSONB NOT NULL DEFAULT '\{\}'::jsonb/);
});

test('cot feature_permissions duoc anh xa hai chieu trong appUsersRepository', () => {
  const repo = fs.readFileSync(path.join(__dirname, '..', 'auth', 'appUsersRepository.js'), 'utf8');
  assert.match(repo, /featurePermissions: \(row\.feature_permissions/, 'doc: row -> object JS');
  assert.match(repo, /\['featurePermissions', 'feature_permissions'/, 'ghi: object JS -> cot');
});

test('khong co migration nao khac cung so thu tu 0019/0020', () => {
  const files = fs.readdirSync(path.join(__dirname, 'migrations')).filter(name => name.endsWith('.sql'));
  for (const prefix of ['0019', '0020']) {
    const matching = files.filter(name => name.startsWith(prefix));
    assert.equal(matching.length, 1, `${prefix}: ${matching.join(', ')}`);
  }
});
