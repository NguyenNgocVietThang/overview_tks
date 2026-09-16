-- Vai tro chi-doc (Postgres role) de cap cho nhan vien trong cong ty truy van
-- truc tiep bang SQL client/BI tool, tach biet voi tai khoan dang nhap ung
-- dung (app_users). Chi grant SELECT tren cac bang bao cao KiotViet da co tu
-- migration 0001-0008 — LIET KE RO TUNG BANG (allow-list), KHONG dung
-- "GRANT ... ON ALL TABLES" roi revoke sau, de tranh lo password_hash
-- (app_users) hoac PII nhan su (hr_employees) neu quen revoke.
--
-- KHONG dat password o day — dat mat khau la 1 secret, khong duoc commit vao
-- git. Sau khi migration nay chay xong, mot nguoi van hanh phai tu chay 1 lan,
-- truc tiep tren Supabase (SQL editor hoac psql), NGOAI file nay:
--   ALTER ROLE reporting_readonly WITH PASSWORD '<mat-khau-tu-sinh>';
-- va luu mat khau do o noi quan ly credential cua cong ty.
--
-- Rui ro can xac minh (khong phai loi chan): connection SUPABASE_DB_URL ma
-- app dung de chay migration co the KHONG co quyen CREATEROLE tren
-- Supabase-hosted Postgres. Kiem tra truoc bang:
--   SELECT rolcreaterole FROM pg_roles WHERE rolname = current_user;
-- Neu false, chay noi dung file nay thu cong qua Supabase SQL editor (chay
-- bang role du quyen hon), roi tu them dong vao schema_migrations:
--   INSERT INTO schema_migrations (filename) VALUES ('0010_reporting_readonly_role.sql');
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reporting_readonly') THEN
    CREATE ROLE reporting_readonly LOGIN;
  END IF;
END $$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO reporting_readonly', current_database());
END $$;

GRANT USAGE ON SCHEMA public TO reporting_readonly;

GRANT SELECT ON
  categories, products, customers, suppliers, staff,
  invoices, invoice_details, invoice_payments,
  orders, order_details,
  returns, return_details,
  purchases, purchase_details,
  cash_flows
TO reporting_readonly;

-- Cac bang ky thuat/noi bo (sync_checkpoints, webhook_events_raw,
-- backfill_progress, schema_migrations) va 2 bang moi (app_users, hr_employees)
-- CO Y KHONG duoc grant o day.

-- Tu dong cap SELECT cho cac bang bao cao duoc tao SAU migration nay (chay
-- boi cung role chay migration). Moi migration tuong lai them bang chua du
-- lieu nhay cam PHAI tu REVOKE khoi reporting_readonly ngay trong migration do
-- — xem ghi chu trong server/db/SCHEMA.md.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO reporting_readonly;
