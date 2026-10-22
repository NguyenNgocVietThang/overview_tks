-- Thong tin / ghi chu theo khach hang cho bang "Doanh so theo khach" (tab Khach hang, 2026-10-22).
--
-- Khoa khach: hang cua bang bao cao khong co id ben, chi co key = nameKey(ten khach)
-- (businessMonths.js: NFKC, bo ky tu rong, gop khoang trang, chu thuong). customer_key luu dung
-- khoa do, customer_name chup lai ten luc ghi. Han che da biet: khach doi ten => mat lien ket.
--
-- Nguoi dung (updated_by_id, author_id, user_id...) la app_users.id dang TEXT, KHONG FK: tai khoan
-- admin cung co id khong phai UUID va xoa mem tai khoan khong duoc lam mat ghi chu cu (tien le 0076).
-- Ten nguoi dung chup lai luc ghi de hien thi ca khi tai khoan da doi ten.
--
-- Phan quyen (xem server/auth/featureRegistry.js):
--   reports.business.customerNotes  xem
--   reports.business.customerManage Quan ly: sua Tiep khach lan cuoi, gan nguoi sua, sua moi khach
--   Nguoi sua hieu luc = customerManage HOAC (customerNotes VA co trong customer_editors cua khach do).

-- Thong tin chung: 1 dong / khach.
CREATE TABLE IF NOT EXISTS customer_profiles (
  customer_key       TEXT PRIMARY KEY,
  customer_name      TEXT NOT NULL DEFAULT '',
  warehouse_location TEXT NOT NULL DEFAULT '',
  warehouse_count    NUMERIC CHECK (warehouse_count IS NULL OR warehouse_count >= 0),
  warehouse_scale    TEXT NOT NULL DEFAULT 'none' CHECK (warehouse_scale IN ('none','small','medium','large')),
  competitor         TEXT NOT NULL DEFAULT '',
  sales_channels     TEXT[] NOT NULL DEFAULT '{}'
    CHECK (sales_channels <@ ARRAY['san','cua_hang','fb_ads','fb_live','sang_tay','kho_buon']::text[]),
  updated_by_id      TEXT,
  updated_by_name    TEXT NOT NULL DEFAULT '',
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- id UUID do server sinh (crypto.randomUUID), khong DEFAULT gen_random_uuid() (tien le 0009).
-- Anh kho: luu BYTEA nhu hr_rule_document_images (0061); toi da 5MB/anh, 10 anh/khach (kiem o server).
CREATE TABLE IF NOT EXISTS customer_profile_images (
  id              UUID PRIMARY KEY,
  customer_key    TEXT NOT NULL,
  content_type    TEXT NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp')),
  byte_size       INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 5242880),
  sha256          CHAR(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  data            BYTEA NOT NULL,
  created_by_id   TEXT,
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_profile_images_key_idx ON customer_profile_images(customer_key, created_at);

-- Note kieu tin nhan: toi da 1 note / khach / ngay (ngay theo gio VN, do server tinh), chi sua trong ngay.
CREATE TABLE IF NOT EXISTS customer_notes (
  id            UUID PRIMARY KEY,
  customer_key  TEXT NOT NULL,
  note_date     DATE NOT NULL,
  body          TEXT NOT NULL CHECK (btrim(body) <> ''),
  author_id     TEXT,
  author_name   TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT customer_notes_key_date_key UNIQUE (customer_key, note_date)
);

-- Cac ngay "da di" tiep khach; Tiep khach lan cuoi = max(visit_date). Chi Quan ly thay ca tap.
CREATE TABLE IF NOT EXISTS customer_visit_days (
  customer_key TEXT NOT NULL,
  visit_date   DATE NOT NULL,
  set_by_id    TEXT,
  set_by_name  TEXT NOT NULL DEFAULT '',
  set_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_key, visit_date)
);

-- Nguoi duoc Quan ly gan quyen sua Thong tin chung + Note cua tung khach.
CREATE TABLE IF NOT EXISTS customer_editors (
  customer_key   TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  user_name      TEXT NOT NULL DEFAULT '',
  assigned_by_id TEXT,
  assigned_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_key, user_id)
);

-- 0010 cap SELECT mac dinh cho reporting_readonly; cac bang nay la ghi chu noi bo (+ anh kho) nen chi doc qua API.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reporting_readonly') THEN
    REVOKE ALL ON customer_profiles, customer_profile_images, customer_notes, customer_visit_days, customer_editors FROM reporting_readonly;
  END IF;
END $$;
