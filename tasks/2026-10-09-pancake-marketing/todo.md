# Checklist triển khai Pancake Marketing

Cập nhật 12/10/2026. Kế hoạch: [plan.md](plan.md).

Mã T3–T6 đã triển khai và qua kiểm thử; nguồn chính thức vẫn là Sheets. Ngày 12/10/2026 đã khôi phục ID tin nhắn từ sáu bản xuất đầy đủ (migration 0046): 18.304 dòng lịch sử thật đều có liên kết (18.294 duy nhất, 7 chỉ khác cách viết số +84/0 thừa đã kiểm cùng giây-cùng nhân viên, 3 dòng thuộc cặp tin tương đương = 6 liên kết); chỉ còn dòng tiêu đề lặp BL THÔ!1950 (không phải quan sát). 3.148 tin trong kỳ nằm ngoài nền Sheets được ghi sổ riêng, không tính. Đồng bộ thật đủ sáu page đạt (slot 12/10): 11.797 fact, 2.478 quan sát cùng ngày ghi nhận 12/10 (thay đổi nhân viên tích lũy từ lúc dán Sheets và 861 tin mới), 0 mục chưa giải quyết, 0 dòng lịch sử chưa liên kết; nền lịch sử khớp CHUẨN (11.942 nhóm SĐT); tổng khớp chi tiết 100/100 (T10) và 80/80 (T9). Công tắc job vẫn TẮT và nguồn vẫn Sheets: chưa có ba đợt hằng đêm đối soát, chưa cấu hình token trên Render. Lưu ý nghiệm thu: lần đồng bộ đầu dồn các thay đổi nhân viên cũ vào ngày 12/10 nên "chào lại" tháng 10 tăng mạnh (179 → 1.660); cần Quản lý xác nhận cách tính trước khi chuyển nguồn.

## T1–T3 — Kết nối, lưu DB và nhập lịch sử

- [x] Đủ sáu token, chỉ Facebook; T1 từng đối soát 462/462 dòng backup.
- [x] Migration 0044 và 0045 đã áp; 10 bảng Marketing, sáu page.
- [x] Nhập hai batch: 18.305 dòng THÔ, 459 BC tháng, 37 ánh xạ. CHUẨN 11.942 nhóm; giữ nguyên raw và ngày cũ. CHECK cũ có chênh lệch lưu tại reconciliation.json.

## T4 — Đồng bộ nền

- [x] Client GET có bộ lọc/ phân trang/ giới hạn, scheduler 23:55, khóa job, retry và lỗi từng page.
- [x] Kiểm thử ngày bất biến, A→B→A, qua nửa đêm và API sáu chữ số thập phân 0.
- [ ] Khôi phục ID từ bản xuất đầy đủ và đối soát các khóa lịch sử mơ hồ.
- [ ] Đồng bộ thật đủ sáu page thành công. Hai lượt 12/10 chưa đạt; facts/observations vẫn 0.
- [ ] Bật job trên Render và xác minh hoạt động thực tế.

## T5–T6 — Báo cáo DB và nhập BC tháng

- [x] Có báo cáo năm/tháng, SĐT/KPI tính từ DB, chi tiết nguồn, Excel/HTML và ADS Sheets.
- [x] Quản lý tạo/sửa chọn khách KiotViet, version/audit và ánh xạ nhân viên; API chặn mọi vai trò khác.
- [x] Giữ nguồn doanh số KiotViet; lịch sử thiếu page giữ trống.
- [x] Kiểm thử frontend và browser fixture 375px; tháng báo cáo tách ngày chốt.
- [ ] Bật chế độ DB cho người dùng sau nghiệm thu T7.

## T7 — Nghiệm thu và tích hợp

- [ ] Ít nhất ba đợt hằng ngày đối soát sáu page, không thay bằng ba lần cùng ngày.
- [x] Công tắc quay Sheets, token không vào Git và dữ liệu thử nghiệm không ghi DB thật.
- [x] Kiểm thử bản kết hợp main Claude: 2.276 test, 2.273 đạt, 3 skip cấu hình, 0 lỗi.
- [ ] Hoàn tất rà soát toàn nhánh, fast-forward main và push GitHub.

Nguồn chính thức Sheets, job mặc định tắt cho đến khi đối soát ID đạt.
