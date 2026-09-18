-- Rollup theo ngay cho trang "Bao cao tong hop" cua Dashboard - tinh san trong
-- Postgres de /api/dashboard doc thang ket qua da tong hop thay vi quet lai
-- toan bo lich su hoa don/chi tiet hoa don/nhap hang trong Node.js moi request
-- (xem docs/superpowers/plans/... roadmap va ke hoach da duyet
-- "melodic-juggling-karp"). Refresh moi 5 phut boi
-- server/kiotvietSync/dashboardRollupRefresh.js, cua so 400 ngay gan nhat (du
-- cho moi bo loc 1/7/30/90 ngay/tuy chinh + du du).
--
-- Quy uoc ngay: dung dung convention da xac lap o dashboardPgReader.js - cac
-- cot TIMESTAMPTZ trong bang nguon luu "gio treo tuong VN mang nhan UTC", nen
-- lay ngay lich VN dung bang (cot AT TIME ZONE 'UTC')::date (KHONG dung
-- 'Asia/Ho_Chi_Minh', se lech +7h).
--
-- Ca 4 bang chi luu so tong hop (khong co raw JSONB) - uoc tinh dung luong
-- duoi 10MB, khong dang lo so voi dung luong Supabase free-tier con trong.
--
-- Khong REVOKE SELECT FROM reporting_readonly - du lieu khong nhay cam, giu
-- mac dinh duoc GRANT nhu quy uoc o 0010_reporting_readonly_role.sql.

CREATE TABLE daily_invoice_summary (
  branch          TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  sale_date       DATE NOT NULL,
  revenue         NUMERIC NOT NULL DEFAULT 0,   -- SUM(invoices.total) WHERE raw->>'statusValue'='Hoàn thành'
  invoice_count   INT NOT NULL DEFAULT 0,
  cancelled_count INT NOT NULL DEFAULT 0,       -- statusValue='Đã hủy', chi dung cho KPI "hom nay"
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch, sale_date)
);

CREATE TABLE daily_product_sales (
  branch     TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  sale_date  DATE NOT NULL,
  product_id BIGINT NOT NULL,
  qty        NUMERIC NOT NULL DEFAULT 0,
  revenue    NUMERIC NOT NULL DEFAULT 0,   -- SUM(Thanh tien) tren invoice_details cua hoa don co statusValue != 'Đã hủy'
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch, sale_date, product_id)
);
CREATE INDEX idx_daily_product_sales_date ON daily_product_sales (branch, sale_date);

CREATE TABLE daily_purchase_summary (
  branch        TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  purchase_date DATE NOT NULL,
  supplier_id   BIGINT NOT NULL DEFAULT 0,  -- 0 = "(Khong xac dinh)", KiotViet khong dung id that = 0
  order_count   INT NOT NULL DEFAULT 0,
  total         NUMERIC NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch, purchase_date, supplier_id)
);

-- Nho, doc lap: "Hang moi nhap" (dashboardData.js khoi 2) can ngay nhap SOM
-- NHAT cua tung ma hang de biet san pham nao "moi" - khong the suy tu
-- daily_purchase_summary (gom theo NCC, khong theo san pham). Khong gioi han
-- cua so 400 ngay khi refresh bang nay - ngay nhap dau tien co the xa hon 400
-- ngay va van can dung.
CREATE TABLE product_first_purchase (
  branch              TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  product_id          BIGINT NOT NULL,
  first_purchase_date TIMESTAMPTZ NOT NULL,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch, product_id)
);
