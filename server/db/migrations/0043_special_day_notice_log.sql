-- Danh dau ngay le / sinh nhat DA bao len chuong thong bao (xem
-- server/notifications/specialDayNotifier.js, du lieu ngay tai public/shared/special-days.js).
--
-- Thong bao nam o notifications.json (nguoi dung co the xoa), nen khong dua vao do de
-- chong gui trung: job quet moi 5 phut va chay lai khi restart, chi lan CHEN DUOC dong
-- (day_key, event_key) moi duoc gui. Khong chua du lieu ca nhan.

CREATE TABLE special_day_notice_log (
  day_key    DATE NOT NULL,
  event_key  TEXT NOT NULL,
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (day_key, event_key)
);
