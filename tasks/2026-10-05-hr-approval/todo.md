# Nghiệm thu triển khai

- [x] Dữ liệu và quyền dùng chung
- [x] Phân quyền tài khoản và chọn cột
- [x] Form xin nghỉ web
- [x] Telegram Mini App, lọc đơn, tách xử lý thao tác/giao tin và đo stage
- [x] Kiểm thử tích hợp và review độc lập
- [x] Tài liệu và toàn bộ npm test

## Kết quả tại worktree

Branch: codex/hr-leave-approval; base ceeffd4. Kế hoạch tasks có trước đợt này giữ nguyên.

- Baseline: 1.735 đạt, 3 bỏ qua, 0 lỗi.
- Mã cuối cùng: npm test trong server — 1.793 đạt, 3 bỏ qua, 0 lỗi; 1.796 test tổng, khoảng49 giây. Node24.19.0 cục bộ; engines dự án22.x. Chỉ dùng cấu hình test giả.
- PGlite áp migration0016/0029/0030/0031: backfill/grant, INSERT bot nhân viên giữ hợp đồng, snapshot bất biến, đua web/Telegram chỉ một quyết định, mở lại và thu hồi quyền. Web thiếu chat không vào lượt báo Telegram; web có chat vẫn dùng chu kỳ báo kết quả cũ.
- Telegram: initData giả/hết hạn/duplicate, phiên bản cũ, OK trống/có lý do, Hủy, lỗi giữ nội dung, callback ACK sau enqueue, inbox xử lý khi delivery bị chặn, retry/restart/dedupe, card danh sách đồng bộ kết quả/mở lại, gửi bù Vi phạm khi có người duyệt sau.
- Frontend jsdom và Chrome headless với API giả localhost:4 cột mặc định,26 trường tùy chọn, tên cố định, lọc hoạt động/tất cả, lưu/reset lựa chọn, form hồ sơ tin cậy, tổng4 buổi/2 ngày, gửi đơn. Browser tool của app lỗi môi trường, Chrome dùng profile tạm riêng.
- Review độc lập: không còn phát hiện cần sửa;17 regression test reviewer chạy đạt.
- git diff --check sạch; checkout gốc không thay đổi. Không thêm dependency.

## Nghiệm thu môi trường triển khai còn lại

- [ ] Áp migration0031 trên database staging và thử bot nhân viên bên ngoài/Telegram thật.
- [ ] Đo trên service đang chạy:p95 tiếp nhận<1giây, kết quả thường<2giây; thử Telegram chậm/429.
- [x] Gộp fast-forward vào main theo yêu cầu; npm test sau gộp: 1.793 đạt, 3 bỏ qua, 0 lỗi.
- [ ] Migration và deploy theo quy trình môi trường sau nghiệm thu staging.

Không dùng database/bot production, không đăng ký lại webhook và không deploy trong phiên thực hiện này.
