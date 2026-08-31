-- branches: KHONG den tu KiotViet, la khai niem cua chung ta. Them chi nhanh
-- moi sau nay chi can 1 INSERT + 1 bo env var moi, khong doi schema.
CREATE TABLE branches (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code              TEXT NOT NULL UNIQUE,          -- 'hanoi' | 'saigon'
  name              TEXT NOT NULL,                 -- 'Hà Nội' | 'Sài Gòn'
  kiotviet_retailer TEXT NOT NULL,                 -- 'CHhanoi' | 'CHsaigon'
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO branches (code, name, kiotviet_retailer) VALUES
  ('hanoi', 'Hà Nội', 'CHhanoi'),
  ('saigon', 'Sài Gòn', 'CHsaigon')
ON CONFLICT (code) DO NOTHING;
