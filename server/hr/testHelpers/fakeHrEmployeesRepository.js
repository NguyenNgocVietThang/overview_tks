// ==========================================
// FAKE HR EMPLOYEES REPOSITORY — thay the hrEmployeesRepository.js (Postgres)
// trong unit test cho employeeDirectory.js khi khong co SUPABASE_DB_URL that.
// Rows dung dung hinh dang camelCase ma hrEmployeesRepository.rowToEmployee()
// tra ve: { id, branch (ma noi bo 'hanoi'/'saigon'), hoTen, boPhan,
// soDienThoai, email, telegramId }.
// ==========================================
'use strict';

function createFakeHrEmployeesRepository(initialRows = []) {
  let rows = initialRows.map(r => ({ ...r }));
  let shouldFail = false;
  let calls = 0;

  function setRows(newRows) {
    rows = newRows.map(r => ({ ...r }));
  }

  function setShouldFail(value) {
    shouldFail = value;
  }

  async function selectAllActive() {
    calls += 1;
    if (shouldFail) throw new Error('Giả lập lỗi kết nối.');
    return rows.map(r => ({ ...r }));
  }

  async function updateContactById(id, field, value) {
    const index = rows.findIndex(r => r.id === id);
    if (index < 0) return null;
    const column = field === 'email' ? 'email' : 'soDienThoai';
    rows[index] = { ...rows[index], [column]: value };
    return { ...rows[index] };
  }

  async function updateDepartmentById(id, boPhan) {
    const index = rows.findIndex(r => r.id === id);
    if (index < 0) return null;
    rows[index] = { ...rows[index], boPhan };
    return { ...rows[index] };
  }

  return {
    setRows,
    setShouldFail,
    get calls() { return calls; },
    selectAllActive,
    updateContactById,
    updateDepartmentById
  };
}

module.exports = { createFakeHrEmployeesRepository };
