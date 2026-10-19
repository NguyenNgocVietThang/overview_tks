# Todo: Tính sẵn báo cáo trong DB (2026-10-19)

Chi tiết: [plan.md](plan.md). Migration: 0068 kinh doanh, 0069 marketing, 0070 sổ quỹ (đã áp DB 19/10/2026).

## Wave 1 (song song)
- [x] A. Kinh doanh tháng hiện tại (0068, job làm mới, repository đọc bảng, fail-soft) — commit f5c7074
- [x] B. Sổ quỹ view `v_cash_book_transactions` (0070) — commit 55a4b31
- [x] C. Đối chiếu và hoàn tất việc cũ trong `tasks/` — commit 948ac46 (không cần sửa code, chỉ tick lại)
- [x] D. Marketing: bảng chi phí ADS, view doanh số theo tên, bảng tổng hợp Pancake (0069) — commit 4c79124

## Checkpoint 1
- [x] Review diff từng mảng, test tập trung xanh, commit riêng từng mảng

## Wave 2
- [x] Đồng bộ tài liệu (SCHEMA, README, server/README, implementation_plan, SRS, BRD, CURRENT)

## Checkpoint 2
- [x] `npm test` toàn bộ: 2842 chạy, 2839 đạt, 0 lỗi, 3 bỏ qua
- [x] `graphify update .`

## Wave 3
- [x] Tra `schema_migrations`: chỉ 0068, 0069, 0070 đang chờ; đã áp bằng `npm run db:migrate`
- [x] Đối chiếu chỉ đọc: tồn quỹ theo quỹ × cơ sở của view khớp 100% truy vấn cũ (61 nhóm); view doanh số marketing chạy được
- [x] Push `tks_web/main` (a6bc293)

## Chưa đo được (cần deploy + lượt job đầu)
- [ ] `snapshot()` tháng hiện tại đọc từ bảng < 50 ms (bảng `business_current_month_*` đang rỗng tới lượt sync đầu sau deploy)
- [ ] So số `business_current_month_*` với `live()` trên dữ liệu thật
- [ ] Lượt Pancake đầu tiên dựng `marketing_phone_summary`; lượt đồng bộ ADS đầu tiên (chỉ khi `PANCAKE_MARKETING_SYNC_ENABLED=true`)
- [ ] Mở thử `#business`, `#marketing`, `/cashbook/` trên môi trường thật sau deploy

## Việc chỉ bạn làm được
- [ ] Deploy
- [ ] Thử bot Telegram thật, đo p95 tiếp nhận (hr-approval)
- [ ] Xác nhận biến môi trường Render, theo dõi đối soát Pancake
- [ ] Quản lý xem 3 tài khoản nghi vấn (tongkhotokosi@gmail.com, phuongluuxuan10@gmail.com, tkscongty303@gmail.com)

## Việc mở
- [ ] Bỏ `trace` khỏi JSON phones (~11,5 MB trong ~13 MB, frontend không đọc)
- [ ] Thay `normalizedNameSql` bằng `tks_name_key`; dọn bảng `cash_book_account_banks` (0034, không dùng)
- [ ] Cân nhắc index `cash_flows(trans_date) WHERE source_missing_at IS NULL` sau khi EXPLAIN
