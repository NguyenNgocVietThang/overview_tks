-- Index theo ngay dat hang cho trang Ke toan - Nhap VAT (server/vatDraft/documentsRepository.js):
-- danh sach "don dat hang chua len hoa don" loc orders theo order_date trong khoang ngay
-- ke toan chon. Chua co index nay thi phai quet ca bang orders (~65.000 dong, cot raw rong)
-- ~650 ms moi lan mo danh sach (EXPLAIN ANALYZE tren DB that 16/10/2026).
--
-- Chi them index, khong doi/xoa du lieu; bang nho nen tao index trong 1 giao dich chi
-- khoa ghi vai giay. Code van chay dung khi chua ap migration (chi cham hon).

CREATE INDEX IF NOT EXISTS idx_orders_order_date ON orders (branch, order_date);
