CREATE TABLE categories (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id            BIGINT NOT NULL REFERENCES branches(id),
  kiotviet_id          BIGINT NULL,
  kiotviet_parent_id   BIGINT NULL,
  parent_category_id   BIGINT NULL REFERENCES categories(id),
  name                 TEXT NOT NULL,
  has_child            BOOLEAN NOT NULL DEFAULT false,
  source               TEXT NOT NULL DEFAULT 'kiotviet' CHECK (source IN ('kiotviet','manual','import')),
  kiotviet_modified_at TIMESTAMPTZ NULL,
  kiotviet_synced_at   TIMESTAMPTZ NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX categories_branch_kiotviet_uq ON categories(branch_id, kiotviet_id) WHERE kiotviet_id IS NOT NULL;
CREATE INDEX categories_parent_idx ON categories(parent_category_id);
