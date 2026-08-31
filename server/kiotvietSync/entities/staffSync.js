'use strict';

// Helper dung chung, KHONG tu chay doc lap, khong co checkpoint rieng --
// dung theo PlanDB-Phase1-Spec.md §5/§9.2. Suy ra nhan vien tu SoldById/
// CreatedById/UserId... trong invoices/orders/returns/purchases/cash_flows.
// Quyet dinh giu nguyen thiet ke nay dua tren du lieu tu SheetSchemas.gs, du
// GET /users da xac nhan ton tai (xem kiotviet/API_ENDPOINTS.md) -- nguoi
// dung chon khong doi pham vi Phase 1 (2026-08-30).

async function upsertStaffFromEntity(pool, branch, { kiotvietId, fullName, phone, discoveredVia }) {
  if (!kiotvietId) return null;

  // full_name la NOT NULL: dam bao gia tri hop le cho lan INSERT dau tien khi
  // entity nguon khong co ten (hiem). Nhung gia tri "an toan" nay KHONG duoc
  // dung de quyet dinh UPDATE hay khong -- neu khong, moi lan sync 1 entity
  // thieu ten se ghi de placeholder len ten that da luu truoc do. Vi vay
  // truyen ca gia tri goc (co the rong) rieng, chi dung trong nhanh UPDATE.
  const safeFullName = fullName || `Nhân viên #${kiotvietId}`;

  const result = await pool.query(
    `INSERT INTO staff (branch_id, kiotviet_id, full_name, phone, discovered_via, kiotviet_synced_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, now(), now())
     ON CONFLICT (branch_id, kiotviet_id) WHERE kiotviet_id IS NOT NULL DO UPDATE SET
       full_name = COALESCE(NULLIF($6, ''), staff.full_name),
       phone = COALESCE(NULLIF(EXCLUDED.phone, ''), staff.phone),
       kiotviet_synced_at = now(),
       updated_at = now()
     RETURNING id`,
    [branch.id, kiotvietId, safeFullName, phone || null, discoveredVia || null, fullName || '']
  );
  return result.rows[0].id;
}

module.exports = { upsertStaffFromEntity };
