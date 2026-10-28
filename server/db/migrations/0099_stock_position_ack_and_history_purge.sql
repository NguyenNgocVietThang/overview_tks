-- VT Ha Noi / VT Sai Gon (2026-10-28): co "Da sua", hanh dong lich su moi, xoa lich su co kiem soat.
--
-- format_ack: nguoi dung xac nhan canh bao cua dong (moi loai canh bao) da duoc xu ly. Giu mai cho den khi bo tay;
-- sua ghi chu KHONG tu bo co. Canh bao van duoc tinh tu ghi chu (carton.js), co chi doi cach hien thi/dem.
ALTER TABLE stock_positions ADD COLUMN IF NOT EXISTS format_ack BOOLEAN NOT NULL DEFAULT false;

-- ack / unack: bat/tat co Da sua. history_purged: dau vet moi lan xoa lich su (summary = {deleted, from, to}).
ALTER TABLE stock_position_history DROP CONSTRAINT IF EXISTS stock_position_history_action_check;
ALTER TABLE stock_position_history ADD CONSTRAINT stock_position_history_action_check
  CHECK (action IN ('seed', 'create', 'edit', 'delete', 'auto_delete', 'deduct', 'import_replace', 'import_add', 'pick', 'pick_revert', 'ack', 'unack', 'history_purged'));

-- Trigger van chan moi UPDATE; DELETE chi qua duoc khi giao dich dat app.history_purge = 'on'
-- (chi stockPositionsService.purgeHistory dat, bang set_config(..., true) nen chi co hieu luc trong giao dich do).
CREATE OR REPLACE FUNCTION stock_position_history_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.history_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Stock position history is immutable';
END;
$$ LANGUAGE plpgsql;
