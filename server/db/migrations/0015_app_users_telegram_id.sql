-- Luu Telegram user/chat ID lau dai ngay tren tai khoan ung dung. Bot Telegram
-- se doc/ghi cot nay truc tiep qua Postgres; luong lien ket bang tab
-- _HR_TELEGRAM_LINKS cua Google Sheets da dung su dung.
ALTER TABLE app_users
  ADD COLUMN telegram_id TEXT NOT NULL DEFAULT '';

-- Mot Telegram ID chi duoc gan cho mot tai khoan dang ton tai. Partial index
-- cho phep nhieu tai khoan chua lien ket cung mang gia tri rong.
CREATE UNIQUE INDEX app_users_telegram_id_key
  ON app_users (telegram_id)
  WHERE telegram_id <> '' AND NOT is_deleted;
