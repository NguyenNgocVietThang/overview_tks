-- Tên ngân hàng của từng số tài khoản do Quản lý nhập tay (KiotViet không có trường này).
-- Khóa theo số tài khoản: HN và SG cùng số TK dùng chung một giá trị; đồng bộ KiotViet không ghi đè.
CREATE TABLE cash_book_account_banks (
 account_no TEXT PRIMARY KEY,
 bank TEXT NOT NULL,
 updated_by TEXT,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
