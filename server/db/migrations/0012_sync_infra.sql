-- Khoa tu nhien, khong can surrogate key vi day la bang bookkeeping, khong
-- phai entity nghiep vu.
CREATE TABLE sync_checkpoints (
  branch_id               BIGINT NOT NULL REFERENCES branches(id),
  entity_name             TEXT NOT NULL,
  last_checkpoint_at      TIMESTAMPTZ NULL,
  last_success_at         TIMESTAMPTZ NULL,
  last_error              TEXT NULL,
  last_error_at           TIMESTAMPTZ NULL,
  consecutive_error_count INT NOT NULL DEFAULT 0,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, entity_name)
);

CREATE TABLE sync_run_log (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id        BIGINT NOT NULL REFERENCES branches(id),
  entity_name      TEXT NOT NULL,
  started_at       TIMESTAMPTZ NOT NULL,
  finished_at      TIMESTAMPTZ NULL,
  status           TEXT NOT NULL,   -- 'success' | 'error'
  records_fetched  INT NULL,
  records_upserted INT NULL,
  error_message    TEXT NULL
);
CREATE INDEX sync_run_log_branch_entity_idx ON sync_run_log(branch_id, entity_name, started_at DESC);
