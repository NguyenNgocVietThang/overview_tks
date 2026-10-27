-- "Da xu ly" canh bao lech SL cua don Dang boc / Da boc (trang Vong doi don hang, 2026-10-27).
-- Nguoi dung bam "Da xu ly" (khong doi so luong): ghi 1 dong lich su 'mismatch_ack' kem chu ky so lech luc bam
-- (order_pick_history.summary.signature). Khong them cot/bang; chi mo rong CHECK cua action.
ALTER TABLE order_pick_history DROP CONSTRAINT IF EXISTS order_pick_history_action_check;
ALTER TABLE order_pick_history ADD CONSTRAINT order_pick_history_action_check
  CHECK (action IN ('assign', 'confirm', 'cancel', 'mismatch_ack'));
