-- Chuyen 3 tab Google Sheets nghi phep sang Postgres:
--   "Yeu cau nghi phep"  -> hr_leave_requests
--   "_HR_TELEGRAM_LINKS"   -> hr_telegram_links
--   "_HR_TELEGRAM_SESSIONS" -> hr_telegram_sessions
--
-- Bot Telegram chay ngoai repo nay (VPS rieng) va doc/ghi thang 3 bang qua SQL;
-- web chi doc hr_leave_requests va doi trang thai phe duyet. Hop dong giua hai
-- ben nam trong server/db/SCHEMA.md — sua bang o day thi phai cap nhat ca do.
--
-- Ca 3 bang chua PII/noi dung tin nhan, nen REVOKE khoi reporting_readonly o
-- cuoi file (migration 0010 tu dong cap SELECT cho bang moi).

-- Trigger dung chung: bot ben ngoai co the quen set updated_at, nen de DB tu lam.
CREATE FUNCTION hr_touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 1. Yeu cau nghi phep
-- ---------------------------------------------------------------------------
-- request_id la ma hien thi ("NP-20260919-0001") — DB tu sinh de bot khong phai
-- tu tao ma (cach cu dung so ngau nhien 4 chu so, co the trung). Sequence khong
-- reset theo ngay, nen ma luon duy nhat; ngay chi de nguoi doc de nhin.
CREATE SEQUENCE hr_leave_request_no_seq;

CREATE TABLE hr_leave_requests (
  id                    BIGSERIAL PRIMARY KEY,
  request_id            TEXT NOT NULL UNIQUE DEFAULT (
                          'NP-' || to_char(now() AT TIME ZONE 'Asia/Bangkok', 'YYYYMMDD')
                          || '-' || lpad(nextval('hr_leave_request_no_seq')::text, 4, '0')
                        ),
  branch                TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  source                TEXT NOT NULL DEFAULT 'telegram' CHECK (source IN ('telegram', 'web')),

  -- Nguoi xin nghi. user_id/hr_employee_id la khoa that (SET NULL khi tai khoan/
  -- nhan su bi xoa cung); ho_ten/chuc_vu/web_username la BAN CHUP tai thoi diem
  -- gui, giu lich su on dinh du ho so doi sau nay.
  user_id               UUID REFERENCES app_users(id) ON DELETE SET NULL,
  hr_employee_id        BIGINT REFERENCES hr_employees(id) ON DELETE SET NULL,
  web_username          TEXT NOT NULL DEFAULT '',
  ho_ten                TEXT NOT NULL DEFAULT '',
  chuc_vu               TEXT NOT NULL DEFAULT '',
  telegram_chat_id      TEXT NOT NULL DEFAULT '',
  telegram_username     TEXT NOT NULL DEFAULT '',

  loai_yeu_cau          TEXT NOT NULL DEFAULT 'Xin nghỉ phép' CHECK (loai_yeu_cau IN (
                          'Xin nghỉ phép', 'Tự ý nghỉ (HR ghi nhận)'
                        )),
  ly_do                 TEXT NOT NULL DEFAULT '',
  tin_nhan              TEXT NOT NULL DEFAULT '',
  nguoi_ban_giao        TEXT NOT NULL DEFAULT '',
  thoi_gian_gui         TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Khoang nghi: ngay + buoi (thay cho chuoi "Sáng 22/08/2026" trong Sheet) de
  -- loc/so sanh bang SQL. Moi ngay co 2 buoi; khoang tinh gom ca buoi dau va cuoi.
  start_date            DATE NOT NULL,
  start_session         TEXT NOT NULL CHECK (start_session IN ('Sáng', 'Chiều')),
  end_date              DATE NOT NULL,
  end_session           TEXT NOT NULL CHECK (end_session IN ('Sáng', 'Chiều')),
  tong_buoi_nghi        INTEGER NOT NULL CHECK (tong_buoi_nghi > 0),
  tong_ngay_nghi        NUMERIC(6, 1) GENERATED ALWAYS AS (tong_buoi_nghi / 2.0) STORED,
  CONSTRAINT hr_leave_requests_range_check CHECK (
    end_date > start_date
    OR (end_date = start_date AND NOT (start_session = 'Chiều' AND end_session = 'Sáng'))
  ),

  trang_thai            TEXT NOT NULL DEFAULT 'Chưa duyệt' CHECK (trang_thai IN (
                          'Chưa duyệt', 'Tạm duyệt', 'Đã duyệt', 'Từ chối', 'Vi phạm'
                        )),
  nguoi_duyet           TEXT NOT NULL DEFAULT '',
  approver_user_id      UUID REFERENCES app_users(id) ON DELETE SET NULL,
  thoi_diem_duyet       TIMESTAMPTZ,
  ghi_chu_duyet         TEXT NOT NULL DEFAULT '',
  -- NULL = nhan vien chua duoc bao ket qua phe duyet HIEN TAI. Bot quet
  -- "thoi_diem_duyet IS NOT NULL AND decision_notified_at IS NULL", nhan tin
  -- roi set cot nay. Trigger ben duoi tu xoa cot nay khi trang_thai doi, nen
  -- duyet -> tu choi lan 2 se duoc bao lai.
  decision_notified_at  TIMESTAMPTZ,

  co_nghi_gap           BOOLEAN NOT NULL DEFAULT false,
  co_tu_y_nghi          BOOLEAN NOT NULL DEFAULT false,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX hr_leave_requests_branch_sent_idx
  ON hr_leave_requests (branch, thoi_gian_gui DESC);
CREATE INDEX hr_leave_requests_branch_status_idx
  ON hr_leave_requests (branch, trang_thai, thoi_gian_gui DESC);
CREATE INDEX hr_leave_requests_branch_range_idx
  ON hr_leave_requests (branch, start_date, end_date);
CREATE INDEX hr_leave_requests_user_idx
  ON hr_leave_requests (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX hr_leave_requests_pending_notice_idx
  ON hr_leave_requests (updated_at)
  WHERE thoi_diem_duyet IS NOT NULL AND decision_notified_at IS NULL;

CREATE FUNCTION hr_leave_requests_before_update() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  -- Doi trang thai ma khong chu dong dat decision_notified_at => phai bao lai.
  IF NEW.trang_thai IS DISTINCT FROM OLD.trang_thai
     AND NEW.decision_notified_at IS NOT DISTINCT FROM OLD.decision_notified_at THEN
    NEW.decision_notified_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER hr_leave_requests_before_update
  BEFORE UPDATE ON hr_leave_requests
  FOR EACH ROW EXECUTE FUNCTION hr_leave_requests_before_update();

-- ---------------------------------------------------------------------------
-- 2. Lien ket Telegram <-> tai khoan
-- ---------------------------------------------------------------------------
-- Mot dong = mot lan lien ket cua mot tai khoan. Vong doi:
--   pending (co ma, cho nhan vien go /lienket) -> linked -> revoked (bi thay/huy)
--   pending -> expired (qua han). Bot cung tu tao dong 'linked' truc tiep khi
--   khop hr_employees.telegram_id (link_method = 'hr_directory') — khong can ma.
CREATE TABLE hr_telegram_links (
  id                 BIGSERIAL PRIMARY KEY,
  user_id            UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                       'pending', 'linked', 'expired', 'revoked'
                     )),
  link_method        TEXT NOT NULL DEFAULT 'code' CHECK (link_method IN (
                       'code', 'hr_directory', 'manual'
                     )),
  link_code          TEXT,
  code_expires_at    TIMESTAMPTZ,
  telegram_chat_id   TEXT,
  telegram_username  TEXT NOT NULL DEFAULT '',
  linked_at          TIMESTAMPTZ,
  revoked_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT hr_telegram_links_linked_check CHECK (
    status <> 'linked'
    OR (telegram_chat_id IS NOT NULL AND telegram_chat_id <> '' AND linked_at IS NOT NULL)
  ),
  CONSTRAINT hr_telegram_links_pending_check CHECK (
    status <> 'pending' OR (link_code IS NOT NULL AND code_expires_at IS NOT NULL)
  )
);

-- Mot chat chi thuoc mot tai khoan, mot tai khoan chi co mot chat dang lien ket.
-- Muon doi: revoke dong cu TRUOC (cung transaction) roi moi them dong linked moi.
CREATE UNIQUE INDEX hr_telegram_links_chat_linked_key
  ON hr_telegram_links (telegram_chat_id) WHERE status = 'linked';
CREATE UNIQUE INDEX hr_telegram_links_user_linked_key
  ON hr_telegram_links (user_id) WHERE status = 'linked';
CREATE UNIQUE INDEX hr_telegram_links_code_pending_key
  ON hr_telegram_links (link_code) WHERE status = 'pending';
CREATE INDEX hr_telegram_links_user_idx ON hr_telegram_links (user_id);

-- app_users.telegram_id (migration 0015) la BAN DOC cho phan con lai cua web
-- (req.user.telegramId). Nguon su that la bang nay; trigger giu hai ben khop
-- nhau nen bot chi can ghi hr_telegram_links.
CREATE FUNCTION hr_telegram_links_sync_app_user() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.status = 'linked'
     AND (TG_OP = 'DELETE' OR NEW.status <> 'linked' OR NEW.user_id <> OLD.user_id) THEN
    UPDATE app_users SET telegram_id = '', updated_at = now()
     WHERE id = OLD.user_id AND telegram_id = OLD.telegram_chat_id;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.status = 'linked' THEN
    UPDATE app_users SET telegram_id = NEW.telegram_chat_id, updated_at = now()
     WHERE id = NEW.user_id AND telegram_id IS DISTINCT FROM NEW.telegram_chat_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Dua cac Telegram ID da nam san tren app_users vao bang moi truoc khi gan
-- trigger (khong can dong bo nguoc lai chinh gia tri do).
INSERT INTO hr_telegram_links (user_id, status, link_method, telegram_chat_id, linked_at)
SELECT id, 'linked', 'manual', telegram_id, now()
  FROM app_users
 WHERE telegram_id <> '' AND NOT is_deleted;

CREATE TRIGGER hr_telegram_links_touch
  BEFORE UPDATE ON hr_telegram_links
  FOR EACH ROW EXECUTE FUNCTION hr_touch_updated_at();

CREATE TRIGGER hr_telegram_links_sync_app_user
  AFTER INSERT OR UPDATE OR DELETE ON hr_telegram_links
  FOR EACH ROW EXECUTE FUNCTION hr_telegram_links_sync_app_user();

-- ---------------------------------------------------------------------------
-- 3. Phien hoi thoai Telegram
-- ---------------------------------------------------------------------------
-- Trang thai hoi thoai xin nghi dang do dang, khoa theo chat. `step` de sang
-- rieng cho de debug/truy van; `data` la JSON tu do cua bot (ngay thang luu
-- dang chuoi ISO). Khong CHECK gia tri `step` vi ten buoc thuoc ve bot ben
-- ngoai. Phien het han sau 60 phut khong hoat dong: bot gia han expires_at moi
-- lan ghi va coi dong qua han la khong ton tai, xoa dinh ky bang
--   DELETE FROM hr_telegram_sessions WHERE expires_at < now();
CREATE TABLE hr_telegram_sessions (
  telegram_chat_id  TEXT PRIMARY KEY,
  step              TEXT NOT NULL DEFAULT '',
  data              JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '60 minutes'),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX hr_telegram_sessions_expires_idx ON hr_telegram_sessions (expires_at);

CREATE TRIGGER hr_telegram_sessions_touch
  BEFORE UPDATE ON hr_telegram_sessions
  FOR EACH ROW EXECUTE FUNCTION hr_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Khong cho role BI doc: don nghi phep/tin nhan/lien ket la du lieu ca nhan.
-- ---------------------------------------------------------------------------
REVOKE SELECT ON hr_leave_requests, hr_telegram_links, hr_telegram_sessions FROM reporting_readonly;
