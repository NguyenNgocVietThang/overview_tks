-- Theo doi tien do backfill (Giai doan 3) theo tung chunk (thang, hoac 'full'
-- cho entity khong chia chunk). Doc lap voi sync_checkpoints (Giai doan 2) -
-- khong dung chung bang voi polling, tranh lam lech moc dang chay.
CREATE TABLE backfill_progress (
  branch          TEXT NOT NULL CHECK (branch IN ('hanoi','saigon')),
  entity          TEXT NOT NULL,
  chunk_key       TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','error')),
  next_item       INT NOT NULL DEFAULT 0,
  records_synced  INT NOT NULL DEFAULT 0,
  last_error      TEXT,
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch, entity, chunk_key)
);
