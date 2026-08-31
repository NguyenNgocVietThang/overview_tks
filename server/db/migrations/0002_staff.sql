-- staff: suy ra dan tu SoldById/CreatedById trong hoa don/don hang/tra hang/
-- nhap hang/thu chi -- khong can poll endpoint rieng o Phase 1.
CREATE TABLE staff (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id            BIGINT NOT NULL REFERENCES branches(id),
  kiotviet_id          BIGINT NULL,
  kiotviet_code        TEXT NULL,
  full_name            TEXT NOT NULL,
  phone                TEXT NULL,
  is_active            BOOLEAN NOT NULL DEFAULT true,
  discovered_via       TEXT NULL,                  -- 'invoice'|'order'|'return'|'purchase'|'cashflow'
  source               TEXT NOT NULL DEFAULT 'kiotviet' CHECK (source IN ('kiotviet','manual','import')),
  kiotviet_modified_at TIMESTAMPTZ NULL,
  kiotviet_synced_at   TIMESTAMPTZ NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX staff_branch_kiotviet_uq ON staff(branch_id, kiotviet_id) WHERE kiotviet_id IS NOT NULL;
