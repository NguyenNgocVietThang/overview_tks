# Todo: Tính sẵn báo cáo trong DB (2026-10-19)

Chi tiết: [plan.md](plan.md). Migration cấp trước: 0068 kinh doanh, 0069 marketing, 0070 sổ quỹ.

## Wave 1 (song song)
- [ ] A. Kinh doanh tháng hiện tại (0068, job làm mới, repository đọc bảng, fail-soft)
- [ ] B. Sổ quỹ view `v_cash_book_transactions` (0070)
- [ ] C. Đối chiếu và hoàn tất việc cũ trong `tasks/`
- [ ] D. Marketing: 3a bảng chi phí ADS, 3b view doanh số theo tên, 3c bảng tổng hợp Pancake (0069)

## Checkpoint 1
- [ ] Review diff từng mảng, test tập trung xanh, commit riêng từng mảng

## Wave 2
- [ ] Đồng bộ tài liệu (SCHEMA, README, server/README, implementation_plan, SRS, BRD, CURRENT)

## Checkpoint 2
- [ ] `npm test` toàn bộ xanh
- [ ] `graphify update .`

## Wave 3
- [ ] Tra `schema_migrations`, áp migration chưa có, đối chiếu chỉ đọc
- [ ] Push main

## Việc chỉ bạn làm được
- [ ] Thử bot Telegram thật, đo p95 tiếp nhận (hr-approval)
- [ ] Bật cấu hình/job trên Render, theo dõi 3 đợt đồng bộ hằng ngày (Pancake)
- [ ] Deploy
