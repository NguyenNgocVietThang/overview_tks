-- Form in dùng chung cho mọi tài khoản/cơ sở, không chứa nội dung đơn hàng.
CREATE TABLE IF NOT EXISTS shared_print_layouts (
  template TEXT PRIMARY KEY CHECK (template IN ('order', 'delivery')),
  layout JSONB NOT NULL CHECK (jsonb_typeof(layout) = 'object'),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
REVOKE SELECT ON shared_print_layouts FROM reporting_readonly;
