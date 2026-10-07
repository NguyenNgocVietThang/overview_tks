// ==========================================
// IMPORT SALE TEAMS — nap lai bang sale_teams tu file Excel "chia team".
//
// Dung:  node scripts/importSaleTeams.js <duong-dan-file.xlsx>   (trong server/)
// File: sheet dau tien, hang 1 la tieu de, cot A = Sale, cot B = Team.
// THAY THE toan bo bang trong 1 giao dich (sale khong con trong file bi xoa).
// ==========================================
'use strict';

const ExcelJS = require('exceljs');

async function readTeams(file) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const teams = new Map();
  workbook.worksheets[0].eachRow((row, index) => {
    if (index === 1) return;
    const sale = String(row.getCell(1).value == null ? '' : row.getCell(1).value).trim();
    const team = String(row.getCell(2).value == null ? '' : row.getCell(2).value).trim();
    if (sale && team) teams.set(sale, team);
  });
  return teams;
}

async function replaceTeams(pool, teams) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM sale_teams');
    for (const [sale, team] of teams) {
      await client.query('INSERT INTO sale_teams (sale_name, team_name) VALUES ($1, $2)', [sale, team]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Thieu duong dan file: node scripts/importSaleTeams.js <file.xlsx>');
    process.exitCode = 1;
    return;
  }
  require('dotenv').config();
  const { getPool } = require('../db/pool');
  const teams = await readTeams(file);
  if (!teams.size) throw new Error('File khong co dong Sale/Team nao.');
  await replaceTeams(getPool(), teams);
  console.log(`[sale-teams] Da nap ${teams.size} sale, ${new Set(teams.values()).size} team.`);
  process.exit(0);
}

if (require.main === module) {
  main().catch((error) => { console.error(`[sale-teams] That bai: ${error.message}`); process.exit(1); });
}

module.exports = { readTeams, replaceTeams };
