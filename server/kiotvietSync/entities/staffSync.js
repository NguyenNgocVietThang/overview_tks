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

// Ban batch cua upsertStaffFromEntity -- dung cho fast entities (invoices/
// orders) de gop N query rieng (1 nhan vien/dong) thanh 3 query cho ca 1
// trang ~100 dong, tranh N round-trip toi Postgres o xa (Render). Giu dung
// ngu nghia "khong ghi de ten/sdt that bang gia tri rong" cua ban don le:
// tach rieng gia tri "an toan" (dat placeholder khi rong, chi dung cho INSERT
// lan dau) voi gia tri "tho" (dung de quyet dinh co ghi de khi UPDATE khong).
async function upsertStaffBatch(pool, branch, entries, discoveredVia) {
  const seen = new Map();
  for (const { kiotvietId, fullName, phone } of entries) {
    if (!kiotvietId) continue;
    const key = String(kiotvietId);
    if (!seen.has(key)) seen.set(key, { kiotvietId, fullName: fullName || '', phone: phone || null });
  }
  if (seen.size === 0) return new Map();

  const kiotvietIds = [];
  const safeFullNames = [];
  const rawFullNames = [];
  const phones = [];
  for (const entry of seen.values()) {
    kiotvietIds.push(entry.kiotvietId);
    safeFullNames.push(entry.fullName || `Nhân viên #${entry.kiotvietId}`);
    rawFullNames.push(entry.fullName);
    phones.push(entry.phone);
  }

  // [1] Chen moi nhung dong chua ton tai, dung gia tri "an toan" (co
  // placeholder) -- bo qua neu da co (DO NOTHING), tranh dung 1 cau upsert
  // duy nhat vi EXCLUDED.full_name luc do se la gia tri an toan chu khong
  // phai gia tri tho, lam sai logic "khong ghi de bang rong" o buoc [2].
  await pool.query(
    `INSERT INTO staff (branch_id, kiotviet_id, full_name, phone, discovered_via, kiotviet_synced_at, updated_at)
     SELECT $1, u.kiotviet_id, u.safe_full_name, u.phone, $5, now(), now()
     FROM unnest($2::bigint[], $3::text[], $4::text[]) AS u(kiotviet_id, safe_full_name, phone)
     ON CONFLICT (branch_id, kiotviet_id) WHERE kiotviet_id IS NOT NULL DO NOTHING`,
    [branch.id, kiotvietIds, safeFullNames, phones, discoveredVia || null]
  );

  // [2] Cap nhat toan bo (ca dong vua chen lan dong da ton tai truoc do)
  // bang gia tri THO -- COALESCE/NULLIF dam bao khong ghi de ten/sdt that
  // bang chuoi rong tu 1 entity thieu field, dung nguyen tac cua ban don le.
  await pool.query(
    `UPDATE staff SET
       full_name = COALESCE(NULLIF(u.raw_full_name, ''), staff.full_name),
       phone = COALESCE(NULLIF(u.phone, ''), staff.phone),
       kiotviet_synced_at = now(),
       updated_at = now()
     FROM unnest($2::bigint[], $3::text[], $4::text[]) AS u(kiotviet_id, raw_full_name, phone)
     WHERE staff.branch_id = $1 AND staff.kiotviet_id = u.kiotviet_id`,
    [branch.id, kiotvietIds, rawFullNames, phones]
  );

  const result = await pool.query(
    'SELECT kiotviet_id, id FROM staff WHERE branch_id = $1 AND kiotviet_id = ANY($2::bigint[])',
    [branch.id, kiotvietIds]
  );
  const map = new Map();
  for (const row of result.rows) map.set(String(row.kiotviet_id), row.id);
  return map;
}

module.exports = { upsertStaffFromEntity, upsertStaffBatch };
