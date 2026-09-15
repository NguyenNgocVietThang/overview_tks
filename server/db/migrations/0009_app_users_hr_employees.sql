-- Chuyen danh sach tai khoan dang nhap ("Users" sheet) va danh sach nhan su
-- ("Danh sach nhan su" sheet) tu Google Sheets sang Postgres. hr_employees
-- tao truoc vi app_users co FK tro vao.
--
-- hr_employees thay cho con tro (sourceBranch, rowIndex-vao-sheet) cu bang
-- mot khoa thay the thuc su. is_active thay cho "xoa hang khoi sheet" — giu
-- lai de logic khoa tai khoan hr_removed trong effectiveUserResolver.js con
-- chay duoc (can hang app_users con ton tai de khoa, khong CASCADE xoa).
CREATE TABLE hr_employees (
  id             BIGSERIAL PRIMARY KEY,
  branch         TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  ho_ten         TEXT NOT NULL DEFAULT '',
  bo_phan        TEXT NOT NULL DEFAULT '',
  so_dien_thoai  TEXT NOT NULL DEFAULT '',
  email          TEXT NOT NULL DEFAULT '',
  telegram_id    TEXT NOT NULL DEFAULT '',
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Duy nhat theo lien he CHI trong so hang dang hoat dong — mot email/SDT cua
-- nhan su da nghi viec (is_active = false) duoc phep nhan su moi dung lai.
CREATE UNIQUE INDEX hr_employees_email_active_key
  ON hr_employees (email) WHERE is_active AND email <> '';
CREATE UNIQUE INDEX hr_employees_phone_active_key
  ON hr_employees (so_dien_thoai) WHERE is_active AND so_dien_thoai <> '';
CREATE INDEX hr_employees_branch_idx ON hr_employees (branch);

-- app_users thay cho tab "Users" (Google Sheets) + cache server/data/users.json.
-- id la UUID sinh o phia app (crypto.randomUUID(), nhu localUserStore.js dang
-- lam) — KHONG dat DEFAULT gen_random_uuid() de khong phai bat them extension
-- pgcrypto (repo nay chua dung UUID/pgcrypto o dau ca).
CREATE TABLE app_users (
  id                        UUID PRIMARY KEY,
  ho_ten                    TEXT NOT NULL DEFAULT '',
  username                  TEXT NOT NULL,
  password_hash             TEXT NOT NULL DEFAULT '',
  vai_tro                   TEXT NOT NULL DEFAULT 'Khách' CHECK (vai_tro IN (
                               'Quản lý', 'Kế toán', 'Trưởng kho', 'Trợ lý', 'Lái xe',
                               'Nhân viên kho', 'Nhân viên sale', 'Nhân viên mua hàng', 'Khách'
                             )),
  co_so                     TEXT NOT NULL DEFAULT '' CHECK (co_so IN ('hanoi', 'saigon', 'both', '')),
  trang_thai                TEXT NOT NULL DEFAULT 'Đang hoạt động' CHECK (trang_thai IN (
                               'Đang hoạt động', 'Không hoạt động', 'Khóa', 'Chờ duyệt', 'Đã xóa'
                             )),
  ngay_tao                  TEXT NOT NULL DEFAULT '',
  dang_nhap_gan_nhat        TEXT NOT NULL DEFAULT '',
  email                     TEXT NOT NULL DEFAULT '',
  so_dien_thoai             TEXT NOT NULL DEFAULT '',
  email_khoi_phuc           TEXT NOT NULL DEFAULT '',
  sdt_khoi_phuc             TEXT NOT NULL DEFAULT '',
  is_deleted                BOOLEAN NOT NULL DEFAULT false,
  lock_reason               TEXT NOT NULL DEFAULT '',
  hr_managed                BOOLEAN NOT NULL DEFAULT false,
  hr_employee_id            BIGINT REFERENCES hr_employees(id) ON DELETE SET NULL,
  hr_matched_at             TIMESTAMPTZ,
  sheet_vai_tro             TEXT NOT NULL DEFAULT '',
  sheet_co_so               TEXT NOT NULL DEFAULT '',
  vai_tro_override          TEXT NOT NULL DEFAULT '',
  co_so_override            TEXT NOT NULL DEFAULT '',
  role_source               TEXT NOT NULL DEFAULT '',
  legacy_override           BOOLEAN NOT NULL DEFAULT false,
  verified_email            BOOLEAN NOT NULL DEFAULT false,
  verified_phone            BOOLEAN NOT NULL DEFAULT false,
  hr_verification_required  BOOLEAN NOT NULL DEFAULT false,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Duy nhat CHI trong so tai khoan chua xoa mem — username/email/SDT duoc phep
-- tai su dung sau khi tai khoan cu bi xoa mem, dung hanh vi createUser() hien tai.
CREATE UNIQUE INDEX app_users_username_key ON app_users (lower(username)) WHERE NOT is_deleted;
CREATE INDEX app_users_email_idx ON app_users (lower(email)) WHERE email <> '';
CREATE INDEX app_users_phone_idx ON app_users (so_dien_thoai) WHERE so_dien_thoai <> '';
CREATE INDEX app_users_recovery_email_idx ON app_users (lower(email_khoi_phuc)) WHERE email_khoi_phuc <> '';
CREATE INDEX app_users_recovery_phone_idx ON app_users (sdt_khoi_phuc) WHERE sdt_khoi_phuc <> '';
CREATE INDEX app_users_hr_employee_idx ON app_users (hr_employee_id);
