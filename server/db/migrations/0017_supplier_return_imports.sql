-- Tra NCC (tra hang nhap ve nha cung cap) chuyen tu dan tay Google Sheet sang
-- nguoi dung tu export Excel tu KiotViet ("Tra hang nhap") roi upload len
-- dashboard. Bang phang (khong parent+detail nhu invoices/purchases/returns)
-- vi day la du lieu IMPORT tu file, khong phai chung tu dong bo tung dong qua
-- webhook/polling.
--
-- Moi lan upload cho 1 co so THAY THE toan bo du lieu cu cua co so do (xoa het
-- roi chen lai — xem supplierReturnImportService.js) — giu dung ban chat "dan
-- de" cua tab Sheet cu, tranh cong don/trung lap giua cac lan import.
CREATE TABLE supplier_return_imports (
  id            BIGSERIAL PRIMARY KEY,
  branch        TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  product_code  TEXT NOT NULL,
  product_name  TEXT NOT NULL DEFAULT '',
  return_date   DATE NOT NULL,
  quantity      NUMERIC NOT NULL,
  imported_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  imported_by   TEXT NOT NULL DEFAULT '',
  source_file   TEXT NOT NULL DEFAULT ''
);

CREATE INDEX supplier_return_imports_branch_code_date_idx
  ON supplier_return_imports (branch, product_code, return_date);

-- Khong PII/du lieu nhay cam (giong purchases/returns) nen KHONG revoke khoi
-- reporting_readonly — migration 0010 tu cap SELECT qua ALTER DEFAULT PRIVILEGES.
