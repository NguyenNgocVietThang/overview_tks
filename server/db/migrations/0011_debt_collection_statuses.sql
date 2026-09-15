-- Trạng thái xử lý công nợ là dữ liệu vận hành của dashboard, tách khỏi
-- workbook Google Sheets chỉ đọc. Một khách có trạng thái độc lập theo cơ sở.
CREATE TABLE debt_collection_statuses (
  branch                TEXT NOT NULL CHECK (branch IN ('hanoi', 'saigon')),
  customer_key          TEXT NOT NULL CHECK (char_length(customer_key) BETWEEN 1 AND 128),
  status                TEXT NOT NULL DEFAULT 'Chưa xử lý' CHECK (status IN (
                          'Chưa xử lý', 'Đang xử lý', 'Đã xử lý', 'Bỏ qua'
                        )),
  alert_signature       CHAR(64) NOT NULL CHECK (alert_signature ~ '^[0-9a-f]{64}$'),
  updated_by_user_id    UUID REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by_name       TEXT NOT NULL DEFAULT '',
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch, customer_key)
);

CREATE INDEX debt_collection_statuses_updated_at_idx
  ON debt_collection_statuses (updated_at DESC);
