-- Bo tab "Nha cung cap" khoi dashboard: khong con doc/ghi 2 bang duoi day nen xoa han.
--   * suppliers: danh muc NCC dong bo tu KiotViet (entity `suppliers` da bo khoi
--     scheduler/backfill). Ten NCC cua phieu nhap luon nam san trong purchases.raw,
--     khong bang nao khac join toi suppliers (cash_flows.supplier_id va
--     order_suppliers.supplier_id chi la cot BIGINT, khong co khoa ngoai).
--   * daily_purchase_summary: rollup tong tien/so phieu nhap theo NCC + ngay, chi phuc
--     vu KPI va bieu do cua tab Nha cung cap (job dashboardRollupRefresh da bo cau gop nay).
-- GIU NGUYEN purchases/purchase_details/product_first_purchase: kiem tra dut hang va
-- "Hang moi nhap" (tab Hang hoa) van dung; `purchases` van duoc dong bo.
--
-- Thu tu trien khai: deploy code truoc, chay migration sau (ban code cu con doc 2 bang nay).
DROP TABLE IF EXISTS daily_purchase_summary;
DROP TABLE IF EXISTS suppliers;

-- Moc dong bo/backfill cua entity `suppliers` khong con y nghia.
DELETE FROM sync_checkpoints WHERE entity = 'suppliers';
DELETE FROM backfill_progress WHERE entity = 'suppliers';
