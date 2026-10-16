-- T0 (2026-10-05): kiểm tra xem lỗ hổng tự đổi email đã bị khai thác chưa.
-- CHỈ ĐỌC. Chạy từng khối trên DB production (Supabase SQL editor), gửi lại kết quả.
-- Lưu ý: sau khi bị khai thác, resolver đã ghi đè app_users.email bằng email của
-- dòng nhân sự bị chiếm, nên "email lệch" KHÔNG còn là dấu hiệu. Dấu hiệu thật là
-- ràng buộc nhân sự bất thường.

-- 1) Hai tài khoản trở lên cùng gắn một nhân sự (sau khai thác, TK kẻ tấn công và
--    TK thật cùng trỏ một hr_employee_id, hoặc TK thật bị lỗi 409).
SELECT u.hr_employee_id, e.ho_ten, e.bo_phan, e.email AS hr_email,
       array_agg(u.id ORDER BY u.id) AS user_ids,
       array_agg(u.username ORDER BY u.id) AS usernames
FROM app_users u
JOIN hr_employees e ON e.id = u.hr_employee_id
WHERE NOT u.is_deleted
GROUP BY u.hr_employee_id, e.ho_ten, e.bo_phan, e.email
HAVING count(*) > 1;

-- 2) Hai tài khoản trở lên trùng email (không phân biệt hoa thường).
SELECT lower(email) AS email, array_agg(id ORDER BY id) AS user_ids,
       array_agg(username ORDER BY id) AS usernames
FROM app_users
WHERE NOT is_deleted AND email <> ''
GROUP BY lower(email)
HAVING count(*) > 1;

-- 3) Tài khoản nhân sự có username (tên đăng nhập gốc) không khớp email/SĐT của
--    dòng nhân sự đang gắn, hoặc SĐT rỗng — dấu hiệu đã đổi liên hệ để nhảy dòng.
SELECT u.id, u.username, u.email, u.so_dien_thoai, u.vai_tro, u.role_source,
       u.hr_employee_id, e.ho_ten AS hr_ho_ten, e.bo_phan, e.email AS hr_email,
       e.so_dien_thoai AS hr_phone, u.hr_matched_at, u.updated_at
FROM app_users u
JOIN hr_employees e ON e.id = u.hr_employee_id
WHERE NOT u.is_deleted AND u.hr_managed
  AND (
    u.so_dien_thoai = ''
    OR (position('@' IN u.username) > 0 AND lower(u.username) <> lower(e.email))
    OR (position('@' IN u.username) = 0 AND u.username <> e.so_dien_thoai)
  )
ORDER BY u.updated_at DESC;

-- 4) Danh sách tài khoản có quyền cao để xem bằng mắt: ai đang là Quản lý /
--    Kế toán / Trưởng kho / Trợ lý, gắn với nhân sự nào, đăng nhập gần nhất khi nào.
SELECT u.id, u.username, u.ho_ten, u.email, u.so_dien_thoai, u.vai_tro, u.co_so,
       u.role_source, u.vai_tro_override, u.hr_managed, u.hr_employee_id,
       e.ho_ten AS hr_ho_ten, e.bo_phan, u.hr_matched_at, u.dang_nhap_gan_nhat, u.updated_at
FROM app_users u
LEFT JOIN hr_employees e ON e.id = u.hr_employee_id
WHERE NOT u.is_deleted AND u.vai_tro IN ('Quản lý', 'Kế toán', 'Trưởng kho', 'Trợ lý')
ORDER BY u.vai_tro, u.updated_at DESC;
