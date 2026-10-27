-- Dau vet luc chi dinh, tach khoi position_snapshot luc xac nhan/hoan tac.
-- Khong backfill tu ton hien tai: khong the suy ra quy cach tren phieu cu.
ALTER TABLE order_pick_lines ADD COLUMN IF NOT EXISTS allocation_snapshot JSONB;
COMMENT ON COLUMN order_pick_lines.allocation_snapshot IS
  'Vi tri, quy cach va cach lay hang luc chi dinh; NULL voi phieu cu';
