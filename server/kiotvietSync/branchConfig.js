'use strict';

// Doc truc tiep tu process.env (khong qua server/config.js) vi day la bien
// KIOTVIET_* da co san, khong dung required()/optional() cua config.js —
// dung quy uoc DI (env, logger) de test khong phai doi process.env that.
// Thieu bo _SG chi bo qua Sai Gon kem canh bao log, khong throw — dung
// nguyen tac PlanDB.md §5.1 (giong VC_SPREADSHEET_ID_SG/HR_SPREADSHEET_ID_SG).

function buildBranchConfig(env, code, suffix) {
  const clientId = env[`KIOTVIET_CLIENT_ID${suffix}`];
  const clientSecret = env[`KIOTVIET_CLIENT_SECRET${suffix}`];
  const retailer = env[`KIOTVIET_RETAILER${suffix}`];

  if (!clientId || !clientSecret || !retailer) return null;
  return { code, clientId, clientSecret, retailer };
}

function loadBranchConfigs(env = process.env, logger = console) {
  const branches = [];

  const hanoi = buildBranchConfig(env, 'hanoi', '');
  if (hanoi) {
    branches.push(hanoi);
  } else {
    logger.warn(
      '[branchConfig] Thieu KIOTVIET_CLIENT_ID/KIOTVIET_CLIENT_SECRET/KIOTVIET_RETAILER — bo qua chi nhanh Ha Noi.'
    );
  }

  const saigon = buildBranchConfig(env, 'saigon', '_SG');
  if (saigon) {
    branches.push(saigon);
  } else {
    logger.warn(
      '[branchConfig] Thieu KIOTVIET_CLIENT_ID_SG/KIOTVIET_CLIENT_SECRET_SG/KIOTVIET_RETAILER_SG — bo qua chi nhanh Sai Gon.'
    );
  }

  return branches;
}

module.exports = { loadBranchConfigs };
