-- Lich su gia tri ton kho theo ngay - nguon cho bieu do cot "Gia tri ton kho theo
-- ngay" (tab Tong quan, muc 1 Xu huong). Ton kho trong DB (products.raw->'inventories')
-- chi la trang thai HIEN TAI, khong dung lai duoc qua khu, nen job
-- server/kiotvietSync/inventoryValueSnapshot.js chup 1 LAN/NGAY luc 23:59 (gio VN)
-- va ghi vao bang nay. Bat dau tu 2026-09-30; truoc ngay do khong co so lieu.
--
-- Moi dong = 1 co so trong 1 ngay. stock_value dung CUNG cong thuc voi KPI "Gia tri
-- ton kho" cua tab Hang hoa: tong theo ma hang cua max(ton, 0) * max(gia von, 0),
-- chi hang dang kinh doanh, bo ma bat dau bang VAT. Tong 2 co so = so "Ca hai".
--
-- snapshot_date la ngay lich VN ma ban chup dai dien. Neu server tat dung 23:59 thi
-- job chup muon vao sang hom sau (truoc 12:00) va van gan snapshot_date = ngay bi
-- lo; captured_at luu thoi diem chup THAT de biet do la ban chup bu.
CREATE TABLE inventory_value_snapshots (
  snapshot_date DATE NOT NULL,
  branch        TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  stock_value   NUMERIC NOT NULL,
  captured_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_date, branch)
);

-- Khong can GRANT rieng: ALTER DEFAULT PRIVILEGES o 0010 da tu cap SELECT cho
-- reporting_readonly cho moi bang tao sau no.
