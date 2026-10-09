# CURRENT: BẢNG TRẠNG THÁI THỜI GIAN THỰC (REALTIME DASHBOARD)

> **Cập nhật gần nhất:** 09/10/2026 13:30 (Asia/Ho_Chi_Minh)  
> **Trạng thái Git:** Branch `main`, working tree clean, đồng bộ với upstream.  
> **Quy tắc:** Cập nhật liên tục vào đầu và cuối mỗi phiên làm việc để không bị đứt đoạn ngữ cảnh dự án.

---

## 1. Tổng quan trạng thái hiện tại (Current Status)

| Hạng mục | Trạng thái | Chi tiết |
|---|---|---|
| **Mã nguồn Backend** | Hoàn thành | Node.js Express, hỗ trợ 7 tab báo cáo, sổ quỹ, nhân sự, tài khoản, bot Telegram |
| **Cơ sở dữ liệu** | 0001 → 0042 | Đầy đủ 42 migration từ dữ liệu lõi đến trạng thái nhân sự và đơn nghỉ tài khoản nội bộ |
| **Kiểm thử tự động** | Xanh 100% | Toàn bộ unit tests backend & frontend JSDOM (1.790+ tests) đều vượt qua |
| **Knowledge Graph** | Đã cập nhật | Graphify updated ngày 09/10/2026 (6.254 nodes, 12.402 edges, 341 communities) |
| **Tài liệu hệ thống** | Đồng bộ 100% | `README.md`, `server/README.md`, `SCHEMA.md`, `implementation_plan.md`, SRS, BRD, MEMORY.md |

---

## 2. Các đầu việc vừa hoàn thành (Recently Completed — Tháng 10/2026)

1. **Nghỉ phép cho tài khoản nội bộ chưa gắn nhân sự (Migration `0042`):**
   - Cho phép mọi tài khoản nội bộ đang hoạt động (trừ Khách) tự gửi đơn xin nghỉ phép trên web ngay cả khi chưa gắn hồ sơ `hr_employee_id`.
   - Cơ sở lấy từ đơn, áp dụng giờ làm việc mặc định sáng 07:45 / chiều 12:30.
   - Bổ sung kiểm thử backend và frontend tương ứng.
2. **Quản lý trạng thái nhân sự (Migration `0041`):**
   - Phân biệt trạng thái làm việc `employment_status` (`active` / `resigned`) khỏi xóa mềm `is_active`.
   - Tự động khóa tài khoản liên kết với mã `lock_reason = 'hr_resigned'` khi nhân sự nghỉ việc; mở lại khi kích hoạt.
3. **Chuẩn hóa UI & Điều khiển bảng dùng chung (`table-controls` & `search-clear`):**
   - Áp dụng `table-controls.js` cho tất cả các bảng dữ liệu: ẩn/hiện cột, kéo chỉnh độ rộng cột, phân trang mượt mà.
   - Thêm tiện ích nút xóa nhanh `search-clear` cho các ô tìm kiếm.
   - Tắt điều khiển cột cho bảng quy định chế độ phúc lợi để bảo toàn bố cục tĩnh.
4. **Báo cáo Marketing (`/reports/#marketing`):**
   - Đọc dữ liệu từ 3 workbook Google Sheets (Trực page, SĐT, Ads).
   - Tích hợp cột Doanh số KiotViet đối chiếu theo tên khách hàng chuẩn hóa.
   - Hỗ trợ sửa trực tiếp ô Khách mới / Ghi chú đồng bộ ngược lại Google Sheets (`PUT /api/marketing-report/monthly/row`).
   - Bổ sung tính năng xuất báo cáo định dạng XLSX và HTML kèm hộp thoại chi tiết.
5. **Lịch sử chỉnh sửa tài khoản (Migration `0040`):**
   - Tạo bảng `account_audit_log` ghi nhận bất biến mọi thao tác tạo, sửa, đặt lại mật khẩu, xóa, phân quyền.
   - Xây dựng tab tra cứu `/account/#history` cho Quản trị viên.
6. **Quy định công ty — Tài liệu Chi tiêu & Phúc lợi (Migration `0039`):**
   - Bổ sung tài liệu dựng sẵn thứ 3 (`phuc-loi`) vào `hr_rule_documents`.
7. **Báo cáo kinh doanh (Migration `0036`, `0037`):**
   - Chốt cứng doanh số tháng vào `business_monthly_*` với job `businessMonthlyRefresh.js`.
   - Bổ sung cột Team của sale và bộ lọc Team (`sale_teams` nạp từ `chia team.xlsx`).
   - Gộp khách hàng theo tên chuẩn hóa và thêm modal chọn trường khi xuất file.
8. **Hạn đăng ký nghỉ phép & Lịch làm việc (Migration `0038`):**
   - Snapshot thời gian tại DB, giờ bắt đầu ca cố định 07:45 / 12:30, gán nhãn Đúng hạn / Xin muộn / Vi phạm.
9. **Sổ quỹ toàn công ty (Migration `0033`, `0034`, `0035`):**
   - Hiển thị số dư theo 5 nhóm tài khoản (`account_balance_groups`), phân tách cột ngân hàng riêng.
   - Cơ chế đối soát đánh dấu `source_missing_at` bảo toàn toàn vẹn lịch sử.
   - Kiểm tra revision tự động mỗi 15 giây khi tab hiển thị.

---

## 3. Hành động tiếp theo cần thực hiện (Next Steps & Operations)

- [ ] **Staging / Production Deployment:**
  - Áp dụng các migration mới (`0036` đến `0042`) lên cơ sở dữ liệu Supabase Production ngoài giờ cao điểm: `npm run db:migrate`.
  - Khởi động lại server để nạp scheduler và cấu hình mới.
- [ ] **Khởi tạo dữ liệu Báo cáo kinh doanh trên Production:**
  - Chạy tay lệnh backfill tháng lần đầu trong thư mục `server/`:
    ```bash
    node kiotvietSync/businessMonthlyRefresh.js
    ```
  - Kiểm tra bảng `business_monthly_state` để xác nhận các tháng từ T3/2026 đã chốt đủ.
- [ ] **Nạp danh mục Team của sale:**
  - Nếu có thay đổi danh sách chia team, chạy lệnh:
    ```bash
    node scripts/importSaleTeams.js "path/to/chia team.xlsx"
    ```
- [ ] **Vận hành Telegram Bot quản lý nghỉ phép:**
  - Đăng ký webhook Telegram production: `npm run telegram-manager:set-webhook`.
  - Hướng dẫn các Quản lý có Telegram ID bấm `/start` với bot quản lý để nhận thông báo duyệt đơn.
