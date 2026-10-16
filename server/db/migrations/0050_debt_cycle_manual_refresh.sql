-- Tinh lai cong no bang tay (2026-10-14), mo rong cong no theo lich TT (0047/0048).
--
-- Nut "Tinh lai cong no" (quyen reports.debt.refresh) ghi de chu ky DANG MO (ban chot moi
-- nhat) bang so lieu tai luc bam: no hien tai + tien theo ngay + no qua han. Giu nguyen
-- cycle_date nen phan hoi / trang thai / tien phat khong mat; so phien lien tiep van tinh
-- theo chu ky truoc (bam nhieu lan khong cong them phien).
-- * refreshed_at / refreshed_by_name: lan tinh lai gan nhat (NULL = chua tinh lai, so lieu
--   la ban chot goc luc taken_at).

ALTER TABLE debt_cycle_runs
  ADD COLUMN refreshed_at       TIMESTAMPTZ,
  ADD COLUMN refreshed_by_name  TEXT;
