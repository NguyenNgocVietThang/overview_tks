// ==========================================
// MIGRATE USER BRANCHES — doi gia tri "Co so phu trach" cu (ten kho: 'An
// Khanh' / 'Tan Phu') sang ten co so moi ('Hà Nội' / 'Sài Gòn').
//
// Chay MOT LAN sau khi deploy:  npm run migrate:user-branches
// Idempotent — chay lai khong doi gi them.
//
// Tai khoan co gia tri co so KHONG hop le se bi dat ve rong ('') va can Quan ly
// gan lai; script in ro danh sach nay o cuoi.
// ==========================================
'use strict';

const { normalizeCoSo } = require('../branch/branches');
const localUserStore = require('../auth/localUserStore');

async function main() {
  const users = await localUserStore.getAllUsers();
  let changed = 0;
  const cleared = [];

  for (const user of users) {
    const next = normalizeCoSo(user.coSo);
    if (next === user.coSo) continue;

    await localUserStore.updateUser(user.id, { coSo: next });
    console.log(`  ${user.username}: "${user.coSo || '(rong)'}" -> "${next || '(rong)'}"`);
    changed += 1;
    if (!next) cleared.push(user.username);
  }

  console.log(`\nDa cap nhat ${changed}/${users.length} tai khoan.`);
  if (cleared.length) {
    console.log('\nCAN QUAN LY GAN LAI CO SO cho cac tai khoan sau (gia tri cu khong hop le):');
    cleared.forEach(username => console.log(`  - ${username}`));
  }
}

main().catch(err => {
  console.error('[migrateUserBranches] That bai:', err.message);
  process.exit(1);
});
