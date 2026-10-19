-- Xoa nhan giao dien "Cot hien thi" tung bi shared/table-controls.js chen nham
-- vao rich-text editor. Khi luu, sanitizer cu bo button/svg nhung giu lai nhan
-- thanh <div>Cot hien thi</div>, nen no tro thanh van ban trong body.
--
-- Chi xoa phan tu div/p/span doc lap co dung nhan nay; khong thay chu nam trong
-- cau van hop le. Giu nguyen updated_at/updated_by_name vi day la sua du lieu ky
-- thuat, khong phai nguoi dung sua noi dung quy dinh.

UPDATE hr_rule_documents
SET body = regexp_replace(
  body,
  $pattern$<(div|p|span)>[[:space:]]*Cột hiển thị[[:space:]]*</\1>$pattern$,
  '',
  'gi'
)
WHERE kind = 'text'
  AND body IS NOT NULL
  AND body LIKE '%Cột hiển thị%';
