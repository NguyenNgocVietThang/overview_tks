'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');

test('debt teams use current customer team names and never mutate cached rows', async () => {
  const { attachSaleTeams } = require('./saleTeams');
  const db = new PGlite();
  try {
    await db.exec('CREATE TABLE sale_teams (sale_name text, team_name text)');
    await db.query('INSERT INTO sale_teams VALUES ($1, $2)', ['Duy Thái', 'Team Lê']);
    const rows = [{ sale: ' DUY   THÁI ' }, { sale: 'Khác' }];
    assert.deepEqual((await attachSaleTeams(rows, db)).map(r => r.saleTeam), ['Team Lê', 'Chưa có team']);
    await db.exec("UPDATE sale_teams SET team_name = 'Team mới'");
    assert.equal((await attachSaleTeams(rows, db))[0].saleTeam, 'Team mới');
    assert.equal(rows[0].saleTeam, undefined);
  } finally { await db.close(); }
});


test('both main customer debt services reflect changed teams after cached financial rows', async () => {
  const { attachSaleTeams } = require('./saleTeams');
  const { buildDebtManagement, buildDebtAging } = require('./debtScheduleService');
  const { BRANCHES } = require('../branch/branches');
  const db = new PGlite();
  try {
    await db.exec("CREATE TABLE sale_teams (sale_name text, team_name text); INSERT INTO sale_teams VALUES ('An','Team A')");
    const rows = [{branch:'hanoi', branchCode:'hanoi', customerId:'1', customerName:'Khách A', sale:'An', currentDebt:100, scheduleDays:1}];
    const repository = {attachSaleTeams: rows => attachSaleTeams(rows, db),
      readReport: async () => ({cycle:{cycleDate:'2026-10-21'}, rows, amountsByCustomer:new Map()}),
      readAging: async () => ({state:{asOfDay:'2026-10-21'}, rows})};
    const management = () => buildDebtManagement([BRANCHES.HANOI], null, {repository});
    const aging = () => buildDebtAging(['hanoi'], {repository});
    assert.equal((await management()).customers[0].saleTeam, 'Team A');
    assert.equal((await aging()).customers[0].saleTeam, 'Team A');
    await db.exec("UPDATE sale_teams SET team_name = 'Team B'");
    assert.equal((await management()).customers[0].saleTeam, 'Team B');
    assert.equal((await aging()).customers[0].saleTeam, 'Team B');
    assert.equal(rows[0].saleTeam, undefined);
  } finally { await db.close(); }
});
