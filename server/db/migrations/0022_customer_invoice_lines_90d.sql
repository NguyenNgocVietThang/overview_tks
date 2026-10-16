-- Chi tiet hoa don 90 ngay gan nhat, da gan san ma khach - nguon cho bao cao
-- "Bao cao doanh thu theo khach" (tab Khach hang, phan 3). Truoc day moi lan
-- chon 1 khach, /api/customer-product-revenue phai nap ca 3 bang sheet
-- (khach hang, hoa don, chi tiet hoa don) vao bo nho roi duyet tung dong de doi
-- chieu ma khach (ma -> ten chuan hoa) - rat cham. Bang nay do
-- server/kiotvietSync/customerInvoiceLinesRefresh.js dung lai 1 LAN/DEM (sau
-- 0h VN), nen luc doc chi con la tra cuu theo index (branch, customer_code).
--
-- Moi dong = 1 dong chi tiet hoa don (invoice_details) cua hoa don "Hoan thanh"
-- trong cua so 90 ngay ket thuc HOM QUA (window_start..window_end o bang
-- customer_invoice_lines_state). Khong co cot `raw`: bang la ban tong hop, khong
-- phai ban sao 1-1 tu KiotViet, nen PK theo (branch, invoice_id, line_no) chi de
-- job dung lai so sanh/cap nhat theo dong (xem customerInvoiceLinesRefresh.js).
--
-- Quy uoc dinh nghia giu NGUYEN nhu luong doc sheet cu (dashboardPgReader.js):
--   - sold_date: ngay (theo "gio treo tuong VN mang nhan UTC" cua purchase_date).
--   - customer_code: raw->>'customerCode'; neu trong thi doi chieu ten khach
--     (chuan hoa) voi ten trong bang customers cung co so.
--   - item_code/item_name: luu gia tri tho, phia doc tu trim + fallback '—'.
--   - revenue: "thanh tien" dong hang (subTotal neu co, khong thi gia*SL-giam).
CREATE TABLE customer_invoice_lines_90d (
  branch        TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  invoice_id    BIGINT NOT NULL,
  line_no       INT NOT NULL,
  invoice_code  TEXT NOT NULL,
  sold_date     DATE NOT NULL,
  customer_code TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  item_code     TEXT NOT NULL DEFAULT '',
  item_name     TEXT NOT NULL DEFAULT '',
  quantity      NUMERIC NOT NULL DEFAULT 0,
  revenue       NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (branch, invoice_id, line_no)
);

CREATE INDEX idx_customer_invoice_lines_customer
  ON customer_invoice_lines_90d (branch, customer_code);

-- 1 dong duy nhat: cua so + thoi diem dung lai gan nhat. Doc cung luc voi dong
-- chi tiet (1 cau SQL) de bao cao luon khop cua so voi du lieu; chua co dong nao
-- = bang chua tung duoc dung => phia doc quay ve cach tinh cu tu sheet.
CREATE TABLE customer_invoice_lines_state (
  id           SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  window_start DATE NOT NULL,
  window_end   DATE NOT NULL,
  row_count    INT NOT NULL,
  computed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Khong can GRANT rieng: ALTER DEFAULT PRIVILEGES o 0010 da tu cap SELECT cho
-- reporting_readonly cho moi bang tao sau no.
