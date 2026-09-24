-- Ghi de quyen theo TUNG TAI KHOAN cho he phan quyen theo tinh nang
-- (server/auth/featureRegistry.js). Chi luu DELTA so voi quyen mac dinh cua
-- vai tro, vi du {"reports.debt": false, "reports.overview": true} — nho vay
-- khi bang mac dinh theo vai tro doi thi tai khoan cu van huong theo, khong
-- bi dong bang mot snapshot cu.
ALTER TABLE app_users
  ADD COLUMN feature_permissions JSONB NOT NULL DEFAULT '{}'::jsonb;
