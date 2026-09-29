-- "Dat hang nhap" (phieu PDN..., KiotViet: Mua hang -> Dat hang nhap). Endpoint that:
-- /ordersuppliers (KHAC /purchaseorders = "Nhap hang") - xem kiotviet/API_ENDPOINTS.md.
-- Dung cho cot "Hang dang van chuyen" o khung Co cau ton kho: tong so luong cac
-- phieu trang thai "Da xac nhan NCC" cua Kiot Sai Gon.
--
-- Payload /ordersuppliers KHONG co modifiedDate va dong chi tiet KHONG co
-- productCode (chi productId) - nen bang cha khong co modified_date, con khi
-- doc phai noi `products` theo (branch, product_id).
CREATE TABLE order_suppliers (
  branch        TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  id            BIGINT NOT NULL,
  code          TEXT NOT NULL,
  order_date    TIMESTAMPTZ,
  supplier_id   BIGINT,
  total         NUMERIC,
  status        SMALLINT,
  created_date  TIMESTAMPTZ,
  raw           JSONB NOT NULL,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch, id),
  UNIQUE (branch, code)
);

CREATE TABLE order_supplier_details (
  branch            TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  order_supplier_id BIGINT NOT NULL,
  line_no           INT NOT NULL,
  product_id        BIGINT,
  quantity          NUMERIC,
  price             NUMERIC,
  raw               JSONB NOT NULL,
  PRIMARY KEY (branch, order_supplier_id, line_no),
  FOREIGN KEY (branch, order_supplier_id) REFERENCES order_suppliers (branch, id) ON DELETE CASCADE
);

-- Khong can GRANT rieng: ALTER DEFAULT PRIVILEGES o 0010 da tu cap SELECT cho
-- reporting_readonly cho moi bang tao sau no.
