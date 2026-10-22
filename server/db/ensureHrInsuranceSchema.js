'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getPool } = require('./pool');

const FILENAME = '0078_hr_employee_insurance_number.sql';

async function ensureHrInsuranceSchema({ pool = getPool(), logger = console } = {}) {
  const client = await pool.connect();
  let didApply = false;
  try {
    await client.query('BEGIN');
    try {
      // Multiple Render instances can start together. Serialize this one migration.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('tokosi'), hashtext('hr_employee_insurance'))");
      const applied = await client.query(
        'SELECT 1 FROM schema_migrations WHERE filename=$1', [FILENAME]
      );
      if (!applied.rowCount) {
        const sql = fs.readFileSync(path.join(__dirname, 'migrations', FILENAME), 'utf8');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [FILENAME]);
        didApply = true;
      }
      await client.query('COMMIT');
      if (didApply) logger.log(`[db:migrate] Applied ${FILENAME} before HTTP startup`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    client.release();
  }
}

module.exports = { ensureHrInsuranceSchema };
