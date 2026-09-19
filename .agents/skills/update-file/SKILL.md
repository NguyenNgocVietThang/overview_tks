---
name: update-file
description: >
  Khi cấu trúc thư mục dự án thay đổi (thêm file/thư mục, đổi tên, di chuyển, xóa),
  skill này hướng dẫn cách phát hiện và cập nhật đồng bộ TẤT CẢ các file liên quan
  như README.md, server/README.md, SCHEMA.md, package.json và các tài liệu docs/.
  Trigger: "cập nhật cấu trúc", "thêm file mới", "đổi tên thư mục", "update README",
  "thay đổi cây thư mục", "sync tài liệu", "update file liên quan".
---

# Skill: Update File — Đồng bộ file khi cấu trúc thư mục thay đổi

## Mục tiêu

Mỗi khi dự án thay đổi cấu trúc thư mục (thêm, xóa, đổi tên, di chuyển file/thư mục),
phải cập nhật **đồng bộ** tất cả các file phụ thuộc vào cấu trúc đó.

---

## Bước 1 — Phát hiện thay đổi

Chạy lệnh sau để lấy cây thư mục hiện tại của dự án:

```powershell
Get-ChildItem -Path "d:\Web TKS Dashboard" -Exclude "node_modules", ".git", ".worktrees", ".claude"
Get-ChildItem -Path "d:\Web TKS Dashboard\server" -Exclude "node_modules"
```

So sánh output với cây thư mục đang được mô tả trong `README.md` (mục "Cấu trúc chính") và `server/README.md`.
Nếu có sự khác biệt → tiến hành cập nhật các file bên dưới.

---

## Bước 2 — Danh sách file cần cập nhật

Dưới đây là tất cả file có thể bị ảnh hưởng khi cấu trúc thay đổi.
Đánh giá từng file và chỉ cập nhật những file **thực sự bị ảnh hưởng**.

### 2.1 `README.md` & `server/README.md`

**Vị trí:** `d:\Web TKS Dashboard\README.md` và `d:\Web TKS Dashboard\server\README.md`

**Phần cần cập nhật:** Section `## Cấu trúc chính` — cây ASCII tree, danh sách biến môi trường và nguồn dữ liệu.

**Quy tắc:**
- Thêm module/thư mục mới trong `server/` → thêm vào đúng vị trí trong cây
- Xóa module/tính năng → gỡ khỏi cây và ghi chú vào mục lịch sử thay đổi
- Đổi tên → cập nhật tên trong cây + comment giải thích bên cạnh
- Thêm biến môi trường mới → cập nhật bảng `## Biến môi trường chính` và `server/.env.example`
- Cập nhật dòng `## Cập nhật gần nhất` ở cuối file theo ngày hiện tại

### 2.2 `server/package.json`

**Vị trí:** `d:\Web TKS Dashboard\server\package.json`

**Khi nào cập nhật:**
- Thêm thư viện hoặc script chạy mới (ví dụ: job sync, migrate, test)
- Đổi tên script lệnh khởi chạy hoặc tác vụ nền

### 2.3 `server/db/SCHEMA.md` & `server/db/migrations/`

**Vị trí:** `d:\Web TKS Dashboard\server\db\SCHEMA.md`

**Khi nào cập nhật:**
- Thêm migration SQL mới trong `server/db/migrations/`
- Thêm bảng, thay đổi kiểu dữ liệu hoặc thêm index trên Supabase PostgreSQL
- Cập nhật bảng dữ liệu tổng hợp (rollup) hoặc bảng công nợ (`customer_debt_activity_periods` cho CN1/CN3/CN7)

### 2.4 `server/routes.js` & `server/index.js`

**Vị trí:** `d:\Web TKS Dashboard\server\routes.js` và `server\index.js`

**Khi nào cập nhật:**
- Thêm route API mới cho frontend hoặc webhook KiotViet
- Đổi đường dẫn endpoint hoặc thay đổi middleware phân quyền/cơ sở

### 2.5 `docs/04-planning/implementation_plan.md`

**Vị trí:** `d:\Web TKS Dashboard\docs\04-planning\implementation_plan.md`

**Khi nào cập nhật:**
- Thêm giai đoạn mới hoặc thay đổi lớn về kiến trúc
- Cập nhật trạng thái các task vận hành và triển khai

### 2.6 `docs/02-srs/SRS_Dashboard_GoogleSheets.md` & `docs/01-brd/BRD_Dashboard_GoogleSheets.md`

**Vị trí:** `d:\Web TKS Dashboard\docs\02-srs\SRS_Dashboard_GoogleSheets.md` và `docs\01-brd\BRD_Dashboard_GoogleSheets.md`

**Khi nào cập nhật:**
- Thêm/thay đổi module/tính năng mới → cập nhật danh sách tính năng (FR-xx)
- Thay đổi nguồn dữ liệu (PostgreSQL vs Google Sheets) hoặc yêu cầu phi chức năng (performance, security)

---

## Bước 3 — Quy trình thực hiện

```text
1. Liệt kê cấu trúc thư mục thực tế trong workspace
2. So sánh với README.md và server/README.md hiện tại
3. Xác định loại thay đổi:
   ├── Thêm module backend mới        → server/routes.js, README.md
   ├── Thêm migration SQL mới         → server/db/SCHEMA.md, README.md
   ├── Thêm biến môi trường mới       → server/.env.example, README.md
   ├── Thêm script npm mới            → server/package.json, server/README.md
   ├── Thay đổi nguồn/quy tắc dữ liệu → docs/ (BRD, SRS, implementation_plan)
   └── Xóa/gỡ bỏ tính năng cũ         → README.md, docs/
4. Cập nhật từng file bị ảnh hưởng
5. Chạy kiểm thử: cd server && npm test
6. Xác nhận bằng cách đọc lại từng file đã cập nhật
```

---

## Bước 4 — Kiểm tra sau cập nhật

Sau khi cập nhật xong, xác nhận:

```powershell
# 1. Chạy unit tests đảm bảo hệ thống ổn định
cd "d:\Web TKS Dashboard\server"; npm test

# 2. Xem phần cây trong README để đối chiếu
Select-String -Path "d:\Web TKS Dashboard\README.md" -Pattern "server/" -Context 0,20
```

---

## Ghi chú quan trọng

- **KHÔNG CÒN APPS SCRIPT**: Toàn bộ `src-dashboard` và `.clasp.json` đã được xóa/nghỉ hưu; không tạo lại hay nhắc đến clasp/Apps Script trong quy trình mới.
- **DỮ LIỆU CÔNG NỢ 1/3/7 NGÀY**: Thuật ngữ chuẩn hóa là **CN1/CN3/CN7**, lưu trữ trong bảng `customer_debt_activity_periods` của Supabase PostgreSQL.
- **GOOGLE SHEETS**: Chỉ sử dụng cho tab `Trả NCC` (read-only), `Bảng Công nợ`, `Vòng đời đơn hàng` (`ORDER_LIFECYCLE_SPREADSHEET_ID`), và `Nhân sự` (`HR_SPREADSHEET_ID`).
- Thứ tự ưu tiên cập nhật: `README.md` → `server/README.md` → `SCHEMA.md` → `docs/`.
- Luôn cập nhật ngày cập nhật mới nhất ở cuối `README.md`.
