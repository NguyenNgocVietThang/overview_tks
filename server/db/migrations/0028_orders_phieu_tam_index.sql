-- Chi muc MOT PHAN cho don dat hang o trang thai 'Phiếu tạm' (bang orders).
--
-- Trang "Vong doi don hang" (server/shipment/kiotPendingOrdersRepository.js) gop ~1,1 nghin don
-- Phieu tam cua Kiot vao danh sach moi lan tai (cache 60 giay). Truoc day bo loc
-- `raw->>'statusValue' = 'Phiếu tạm'` khong co index nen phai quet ~46 nghin dong `orders` cung
-- cot JSON `raw` lon (do that 2026-10-01: 1,5-1,8 giay, nguoi 3-6 giay). Index mot phan chi chua
-- cac don Phieu tam (~1,1 nghin dong) nen truy van chi con doc dung cac don do.
--
-- Dieu kien WHERE cua index PHAI trung nguyen van bieu thuc trong truy van (khong boc COALESCE...)
-- thi planner moi dung. Chi them index, khong doi/xoa du lieu; code van chay duoc khi chua ap
-- migration nay (chi cham hon). Bang nho nen tao index trong 1 giao dich chi khoa ghi vai giay.

CREATE INDEX IF NOT EXISTS idx_orders_phieu_tam
  ON orders (branch, id)
  WHERE raw->>'statusValue' = 'Phiếu tạm';
