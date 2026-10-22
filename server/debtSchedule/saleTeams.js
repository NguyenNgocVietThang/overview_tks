'use strict';

const { NO_TEAM, nameKey } = require('../businessReport/businessMonths');

// Shared live source with Customers. Enrich after reading cached debt/saved rewards;
// never persist a second copy of the team or mutate the cached financial rows.
async function attachSaleTeams(rows, pool) {
  let teams;
  try { teams = (await pool.query('SELECT sale_name, team_name FROM sale_teams')).rows; }
  catch (error) {
    if (error.code !== '42P01') throw error;
    teams = []; // Same pre-migration fallback as the Customers report.
  }
  const index = new Map(teams.map(row => [nameKey(row.sale_name), row.team_name]));
  return rows.map(row => ({ ...row, saleTeam: index.get(nameKey(row.sale)) || NO_TEAM }));
}

module.exports = { attachSaleTeams };
