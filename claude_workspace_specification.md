# HỆ THỐNG CẤU TRÚC THƯ MỤC CLAUDE WORKSPACE

Tài liệu chuẩn hóa kiến trúc thư mục và quy tắc vận hành khi làm việc cùng AI Assistant (Claude Code / Claude Workspace).

---

## 1. Cây thư mục tổng quan (Directory Tree)

```text
CLAUDE_WORKSPACE/
│
├── CLAUDE.md                 # Bộ luật vận hành hệ thống (Hệ quy tắc làm việc của Claude)
├── MEMORY.md                 # Bộ nhớ dài hạn (Hồ sơ bản thân, phong cách, nguyên tắc cố định)
├── CURRENT.md                # Bảng trạng thái thời gian thực (Dự án đang chạy, việc tiếp theo)
│
├── PROJECTS/                 # Khu vực chứa các dự án đang triển khai tích cực
│   └── [TEN_DU_AN]/
│       ├── PROJECT.md        # File tổng quan & mục tiêu cụ thể của dự án
│       ├── INPUT/            # Dữ liệu đầu vào, tài liệu thô cung cấp cho Claude
│       ├── TEMPLATES/        # Mẫu định dạng chuẩn (slide, báo cáo, bài viết...)
│       ├── REFERENCES/       # Tài liệu tham khảo, guideline, nghiên cứu mẫu
│       ├── WORKING/          # Không gian nháp, lưu lịch sử phiên bản (v1, v2, v3...)
│       └── OUTPUT/           # Sản phẩm hoàn thiện cuối cùng (final) đã phê duyệt
│
└── ARCHIVE/                  # Khu vực lưu trữ các dự án đã hoàn thành hoặc tạm dừng
    └── [TEN_DU_AN_DA_DONG]/
```

---

## 2. Chi tiết chức năng & Quy tắc vận hành

### A. Tầng điều khiển trung tâm (Root Directory)

| File | Vai trò chính | Nội dung cốt lõi | Quy tắc cập nhật & Lưu ý |
| :--- | :--- | :--- | :--- |
| **`CLAUDE.md`** | **Bộ luật vận hành** *(Cách Claude làm việc)* | - Danh sách file cần đọc khi khởi động.<br>- Quy tắc đặt tên file/folder.<br>- Quy trình xử lý bản nháp.<br>- Thao tác kết thúc phiên làm việc. | Đóng vai trò như bản mô tả công việc (Job Description). Bất biến trừ khi thay đổi toàn bộ workflow. |
| **`MEMORY.md`** | **Bộ nhớ dài hạn** *(Bạn là ai?)* | - Vai trò, lĩnh vực chuyên môn.<br>- Tông giọng (Tone of voice), phong cách giao tiếp.<br>- Các nguyên tắc đạo đức/công việc cố định.<br>- Danh sách điều cấm kỵ (Do's & Don'ts). | Phải có giá trị đúng ít nhất 3 tháng. **Tuyệt đối không** ghi deadline ngắn hạn hay task vụn vặt vào đây. |
| **`CURRENT.md`** | **Dashboard realtime** *(Bạn đang làm gì?)* | - Danh sách dự án đang kích hoạt.<br>- Tiến độ từng đầu việc.<br>- Hành động tiếp theo cần thực hiện (Next steps). | Cập nhật thường xuyên vào đầu/cuối mỗi phiên làm việc để không bị đứt đoạn bối cảnh. |

---

### B. Tầng dự án đang thực hiện (`PROJECTS/`)

Mỗi dự án là một thư mục con khép kín nhằm cô lập ngữ cảnh, tránh việc AI đọc nhầm bối cảnh chéo giữa các dự án khác nhau.

* **`PROJECT.md`**: Bản đồ tóm tắt dự án gồm:
  * Mục tiêu cốt lõi (Objective)
  * Đối tượng mục tiêu (Target Audience)
  * Định dạng đầu ra mong muốn & Thời hạn hoàn thành (Deadline)
  * Thông điệp chủ đạo (Key Messages)
  * Trạng thái hiện tại
* **`INPUT/`**: Lưu toàn bộ dữ liệu thô đầu vào (file văn bản, báo cáo, dữ liệu nghiên cứu, transcript phỏng vấn...).
* **`TEMPLATES/`**: Nơi lưu cấu trúc chuẩn của tổ chức/cá nhân để Claude tái sử dụng khuôn mẫu chính xác.
* **`REFERENCES/`**: Các tài liệu nền tảng đi kèm để Claude đối chiếu chất lượng và thông tin.
* **`WORKING/`**: 
  * Nơi diễn ra các phiên bản phát triển nội dung.
  * **Quy tắc vàng**: Không ghi đè trực tiếp lên file cũ (`project_v1.md`, `project_v2.md`...). Giữ nguyên lịch sử để dễ dàng đối chiếu hoặc khôi phục ý tưởng.
* **`OUTPUT/`**: Chỉ chứa phiên bản cuối cùng đã được người dùng kiểm duyệt và chốt nghiệm thu (`final.md`, `presentation_final.pptx`...).

---

### C. Tầng lưu trữ lịch sử (`ARCHIVE/`)

* **Nguyên tắc "Dọn bàn làm việc"**: Các dự án hoàn thành hoặc đóng lại phải lập tức được chuyển về đây để không gian `PROJECTS/` luôn tinh gọn, giúp AI tập trung xử lý bối cảnh hiện tại.
* **Quy trình lưu trữ an toàn**:
  1. Kiểm tra thư mục `OUTPUT/` của dự án xem đã có bản `final` hay chưa (nếu chưa có, Claude cần xác nhận lại với người dùng trước khi đóng).
  2. Cập nhật dòng tổng kết (kết quả thực tế, ngày hoàn thành) vào cuối file `PROJECT.md`.
  3. Xóa hoặc đánh dấu hoàn thành dự án trong `CURRENT.md`.
  4. Di chuyển toàn bộ thư mục dự án từ `PROJECTS/` sang `ARCHIVE/`.