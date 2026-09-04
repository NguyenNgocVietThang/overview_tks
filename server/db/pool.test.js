'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('getPool tra ve cung mot instance khi goi nhieu lan (singleton)', async () => {
  const { getPool, closePool } = require('./pool');
  try {
    const first = getPool();
    const second = getPool();
    assert.equal(first, second);
  } finally {
    await closePool();
  }
});

test('getPool ket noi duoc va chay duoc truy van don gian', async () => {
  const { getPool, closePool } = require('./pool');
  try {
    const pool = getPool();
    const result = await pool.query('SELECT 1 AS value');
    assert.equal(result.rows[0].value, 1);
  } finally {
    await closePool();
  }
});

test('closePool giai phong pool, lan goi getPool tiep theo tao instance moi', async () => {
  const { getPool, closePool } = require('./pool');
  const first = getPool();
  await closePool();
  const second = getPool();
  assert.notEqual(first, second);
  await closePool();
});
