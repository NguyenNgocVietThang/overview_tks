'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('migration 0025 tao bang inventory_value_snapshots khoa (ngay, co so), co so chi hanoi/saigon', () => {
  const sql = fs.readFileSync(path.join(__dirname, 'migrations', '0025_inventory_value_snapshots.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE inventory_value_snapshots/);
  assert.match(sql, /snapshot_date\s+DATE NOT NULL/);
  assert.match(sql, /branch\s+TEXT NOT NULL CHECK \(branch IN \('hanoi', 'saigon'\)\)/);
  assert.match(sql, /stock_value\s+NUMERIC NOT NULL/);
  assert.match(sql, /captured_at\s+TIMESTAMPTZ NOT NULL DEFAULT now\(\)/);
  assert.match(sql, /PRIMARY KEY \(snapshot_date, branch\)/);
});
