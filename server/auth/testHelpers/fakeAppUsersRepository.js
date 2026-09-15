// ==========================================
// FAKE APP USERS REPOSITORY — thay the appUsersRepository.js (Postgres) trong
// unit test cho localUserStore.js/adminUserRoutes.js/roleChangeRequestRoutes.js
// khi khong co SUPABASE_DB_URL that. Cung interface (selectAllRows/insertUser/
// updateUserRow/softDeleteUser) + 1 ham rieng `seed()` de test nap san du lieu
// gia — dung boi localUserStore.setInMemoryUsers() (xem localUserStore.js).
// ==========================================
'use strict';

function createFakeAppUsersRepository() {
  let rows = [];

  function seed(users) {
    rows = users.map(u => ({ ...u }));
  }

  async function selectAllRows() {
    return rows.filter(u => !u.isDeleted).map(u => ({ ...u }));
  }

  async function insertUser(user) {
    const row = { ...user };
    rows.push(row);
    return { ...row };
  }

  async function updateUserRow(id, patch) {
    const index = rows.findIndex(u => String(u.id) === String(id));
    if (index < 0) return null;
    rows[index] = { ...rows[index], ...patch };
    return { ...rows[index] };
  }

  async function softDeleteUser(id) {
    const index = rows.findIndex(u => String(u.id) === String(id));
    if (index < 0) return null;
    rows[index] = { ...rows[index], isDeleted: true, trangThai: 'Đã xóa' };
    return { ...rows[index] };
  }

  return { seed, selectAllRows, insertUser, updateUserRow, softDeleteUser };
}

module.exports = { createFakeAppUsersRepository };
