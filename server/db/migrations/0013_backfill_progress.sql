-- Checkpoint theo trang (offset) rieng cho backfill lan dau, tach khoi
-- sync_checkpoints (danh cho vong lap incremental). Neu mot buoc backfill
-- (entity hoac entity:thang) bi dung giua chung, next_offset cho biet
-- chinh xac vi tri (currentItem) can tiep tuc, khong phai chay lai tu dau.
CREATE TABLE backfill_progress (
  branch_id   BIGINT NOT NULL REFERENCES branches(id),
  log_name    TEXT NOT NULL,
  next_offset INT NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, log_name)
);
