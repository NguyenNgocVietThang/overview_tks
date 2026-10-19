# Checklist triển khai Pancake Marketing

Cập nhật 12/10/2026; đối chiếu lại với DB thật (chỉ đọc) và git ngày 19/10/2026. Kế hoạch: [plan.md](plan.md).

**Trạng thái 19/10/2026 (SUPERSEDED một phần):** phương án A (đọc lại ID/khóa lịch sử từ Sheets, migration 0044–0046) đã được thay bằng **phương án B độc lập** ngày 16/10/2026 (migration 0056, bảng `marketing_pancake_independent_*`, nguồn `MARKETING_REPORT_SOURCE=pancake`) — thiết kế và quyết định: [docs/superpowers/specs/2026-10-16-marketing-pancake-independent-design.md](../../docs/superpowers/specs/2026-10-16-marketing-pancake-independent-design.md). Các mục dưới đây về khôi phục ID / ba đợt đối soát với nền Sheets được đánh dấu theo hiện trạng đó. Bằng chứng DB 19/10: `marketing_pancake_independent_page_state` đủ 6 page `status=success` (lần thành công cuối 2026-10-18 từ 16:55Z đến 18:11Z); `marketing_sync_runs` có `pancake-independent:2026-10-16`, `…-10-17`, `…-10-18` đều `success` (run 28, 44, 45; run 45 bắt đầu đúng 16:55:00Z = 23:55 giờ VN, tức scheduler đang chạy), cùng 2 lượt lỗi có retry rồi `recovery` thành công cho slot 10-15 (run 29, 31, 33); `marketing_pancake_independent_facts` 30.143 dòng, `…_observations` 30.308 dòng; migration 0044, 0045, 0046, 0056 đã ghi trong `schema_migrations`.

Mã T3–T6 đã triển khai và qua kiểm thử; nguồn chính thức vẫn là Sheets. Ngày 12/10/2026 đã khôi phục ID tin nhắn từ sáu bản xuất đầy đủ (migration 0046): 18.304 dòng lịch sử thật đều có liên kết (18.294 duy nhất, 7 chỉ khác cách viết số +84/0 thừa đã kiểm cùng giây-cùng nhân viên, 3 dòng thuộc cặp tin tương đương = 6 liên kết); chỉ còn dòng tiêu đề lặp BL THÔ!1950 (không phải quan sát). 3.148 tin trong kỳ nằm ngoài nền Sheets được ghi sổ riêng, không tính. Đồng bộ thật đủ sáu page đạt (slot 12/10): 11.797 fact, 2.478 quan sát cùng ngày ghi nhận 12/10 (thay đổi nhân viên tích lũy từ lúc dán Sheets và 861 tin mới), 0 mục chưa giải quyết, 0 dòng lịch sử chưa liên kết; nền lịch sử khớp CHUẨN (11.942 nhóm SĐT); tổng khớp chi tiết 100/100 (T10) và 80/80 (T9). Công tắc job vẫn TẮT và nguồn vẫn Sheets: chưa có ba đợt hằng đêm đối soát, chưa cấu hình token trên Render. Lưu ý nghiệm thu: lần đồng bộ đầu dồn các thay đổi nhân viên cũ vào ngày 12/10 nên "chào lại" tháng 10 tăng mạnh (179 → 1.660); cần Quản lý xác nhận cách tính trước khi chuyển nguồn.

## T1–T3 — Kết nối, lưu DB và nhập lịch sử

- [x] Đủ sáu token, chỉ Facebook; T1 từng đối soát 462/462 dòng backup.
- [x] Migration 0044 và 0045 đã áp; 10 bảng Marketing, sáu page.
- [x] Nhập hai batch: 18.305 dòng THÔ, 459 BC tháng, 37 ánh xạ. CHUẨN 11.942 nhóm; giữ nguyên raw và ngày cũ. CHECK cũ có chênh lệch lưu tại reconciliation.json.

## T4 — Đồng bộ nền

- [x] Client GET có bộ lọc/ phân trang/ giới hạn, scheduler 23:55, khóa job, retry và lỗi từng page.
- [x] Kiểm thử ngày bất biến, A→B→A, qua nửa đêm và API sáu chữ số thập phân 0.
- [x] Khôi phục ID từ bản xuất đầy đủ và đối soát các khóa lịch sử mơ hồ. — làm xong 12/10 (migration 0046 đã áp: `schema_migrations` có `0046_pancake_history_identity.sql`; xem đầu file). SUPERSEDED bởi phương án B độc lập ngày 16/10 (không còn phụ thuộc khóa lịch sử Sheets): xem spec `docs/superpowers/specs/2026-10-16-marketing-pancake-independent-design.md`.
- [x] Đồng bộ thật đủ sáu page thành công. — 12/10 đạt 6/6 (xem đầu file); 19/10 DB: 6/6 page `success` ở `marketing_pancake_independent_page_state`, facts 30.143 / observations 30.308 (không còn 0).
- [x] Bật job trên Render và xác minh hoạt động thực tế. — spec phương án B ghi bật production Render 16/10 14:51 (source=pancake, scheduler=true); hoạt động thực tế xác minh qua DB: run 45 `pancake-independent:2026-10-18` khởi động đúng 16:55:00Z. (Biến môi trường Render không xem trực tiếp được từ đây; chỉ suy ra từ DB.)

## T5–T6 — Báo cáo DB và nhập BC tháng

- [x] Có báo cáo năm/tháng, SĐT/KPI tính từ DB, chi tiết nguồn, Excel/HTML và ADS Sheets.
- [x] Quản lý tạo/sửa chọn khách KiotViet, version/audit và ánh xạ nhân viên; API chặn mọi vai trò khác.
- [x] Giữ nguồn doanh số KiotViet; lịch sử thiếu page giữ trống.
- [x] Kiểm thử frontend và browser fixture 375px; tháng báo cáo tách ngày chốt.
- [x] Bật chế độ DB cho người dùng sau nghiệm thu T7. — SUPERSEDED bởi quyết định phương án B 16/10: `MARKETING_REPORT_SOURCE=pancake` đã bật (spec dòng 4; `server/.env` hiện `pancake`). Xem `docs/superpowers/specs/2026-10-16-marketing-pancake-independent-design.md`.

## T7 — Nghiệm thu và tích hợp

- [x] Ít nhất ba đợt hằng ngày đối soát sáu page, không thay bằng ba lần cùng ngày. — SUPERSEDED/đã đủ số đợt theo phương án B: ba slot ngày khác nhau 16/10, 17/10, 18/10 đều `success` (run 28, 44, 45). Lưu ý trung thực: chỉ run 45 chạy đúng giờ lịch 23:55; run 28 (07:24Z) và 44 (07:59Z) chạy lệch giờ (chạy tay/bù).
  - [ ] (chờ người dùng/ngoài phạm vi) Quản lý duyệt số liệu đối soát (cách tính "chào lại" tháng 10 nêu ở đầu file) — quyết định nghiệp vụ, agent không tự chốt.
- [x] Công tắc quay Sheets, token không vào Git và dữ liệu thử nghiệm không ghi DB thật.
- [x] Kiểm thử bản kết hợp main Claude: 2.276 test, 2.273 đạt, 3 skip cấu hình, 0 lỗi.
- [x] Hoàn tất rà soát toàn nhánh, fast-forward main và push GitHub. — `git merge-base --is-ancestor 89d8828` đúng cho `main`, `origin/main`, `tks_web/main` (89d8828 = merge của nhánh `codex/pancake-marketing`).

Nguồn chính thức Sheets, job mặc định tắt cho đến khi đối soát ID đạt.
