ALTER TABLE product_container_lines ADD COLUMN IF NOT EXISTS other_note text DEFAULT '';
ALTER TABLE product_container_expected ADD COLUMN IF NOT EXISTS other_note text DEFAULT '';
