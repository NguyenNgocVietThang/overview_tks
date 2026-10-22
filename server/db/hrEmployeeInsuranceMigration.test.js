'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('migration lưu số bảo hiểm dạng text và chặn trùng giữa nhân sự hiện có', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE TABLE hr_employees (id BIGINT PRIMARY KEY, is_active BOOLEAN NOT NULL DEFAULT true)');
    const sql = fs.readFileSync(path.join(__dirname, 'migrations/0078_hr_employee_insurance_number.sql'), 'utf8');
    await db.exec(sql);
    await db.exec("INSERT INTO hr_employees(id, insurance_number) VALUES (1, '0123456789'), (2, '')");
    const result = await db.query('SELECT insurance_number FROM hr_employees WHERE id=1');
    assert.equal(result.rows[0].insurance_number, '0123456789');
    await assert.rejects(db.exec("UPDATE hr_employees SET insurance_number='0123456789' WHERE id=2"));
  } finally { await db.close(); }
});
