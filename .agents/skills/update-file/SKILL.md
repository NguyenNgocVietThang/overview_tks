---
name: update-file
description: >
  Khi cấu trúc thư mục dự án thay đổi (thêm file/thư mục, đổi tên, di chuyển, xóa),
  skill này hướng dẫn cách phát hiện và cập nhật đồng bộ TẤT CẢ các file liên quan
  như README.md, .clasp.json, .claspignore, appsscript.json và các tài liệu docs/.
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
tree "d:\Web TKS Dashboard" /F
```

So sánh output với cây thư mục đang được mô tả trong `README.md` (mục "Cấu trúc thư mục").
Nếu có sự khác biệt → tiến hành cập nhật các file bên dưới.

---

## Bước 2 — Danh sách file cần cập nhật

Dưới đây là tất cả file có thể bị ảnh hưởng khi cấu trúc thay đổi.
Đánh giá từng file và chỉ cập nhật những file **thực sự bị ảnh hưởng**.

### 2.1 `README.md`

**Vị trí:** `d:\Web TKS Dashboard\README.md`

**Phần cần cập nhật:** Section `## Cấu trúc thư mục` — cây ASCII tree.

**Quy tắc:**
- Thêm file/thư mục mới → thêm vào đúng chỗ trong cây
- Xóa file/thư mục → gỡ khỏi cây
- Đổi tên → cập nhật tên trong cây + comment giải thích bên cạnh
- Thêm module `future-phases/` mới → thêm vào cả mục `## Lộ trình mở rộng` (bảng)
- Thêm file `.gs` mới → ghi rõ tên hàm trong comment `← funcA(), funcB()`
- Cập nhật dòng `*Cập nhật lần cuối:*` ở cuối file theo ngày hiện tại

### 2.2 `.clasp.json` & `.clasp.saigon.json`

**Vị trí:** `d:\Web TKS Dashboard\.clasp.json` (KiotHN: `rootDir: "src-dashboard"`) và `d:\Web TKS Dashboard\.clasp.saigon.json` (KiotSG: `rootDir: "src-dashboard"`, dùng chung code với KiotHN).

**Khi nào cập nhật:**
- Thay đổi thư mục gốc chứa source code (`rootDir`)
- Cấu hình Script ID cho từng project độc lập

**Quy tắc:**
- Project Dashboard (KiotHN/KiotSG) load: `HuongDanSuDung.gs → config/ → kiotviet/ → sync/ → utils/`

### 2.3 `.claspignore` & `.claspignore.saigon`

**Vị trí:** `d:\Web TKS Dashboard\.claspignore` và `d:\Web TKS Dashboard\.claspignore.saigon`

**Khi nào cập nhật:**
- Thêm thư mục/file mới KHÔNG nên push lên Google Apps Script
  (ví dụ: thư mục tài liệu, scripts test, file config local)

**Quy tắc:**
```
# Thêm dòng mới cho mỗi thư mục/pattern cần loại trừ
ten-thu-muc/
*.extension-can-bo-qua
```

### 2.4 `appsscript.json`

**Vị trí:** `d:\Web TKS Dashboard\src-dashboard\appsscript.json`

**Khi nào cập nhật:**
- Thêm OAuth scope mới (khi code mới cần quyền truy cập service GAS chưa có)
- Thêm thư viện GAS (Libraries)
- Thêm advanced services (Drive, Sheets advanced API...)
- Thay đổi `webapp.executeAs` hoặc `webapp.access`

**Danh sách scope phổ biến cần bổ sung:**
| Tính năng mới | Scope cần thêm |
|---|---|
| Gửi email | `https://www.googleapis.com/auth/gmail.send` |
| Đọc Drive | `https://www.googleapis.com/auth/drive.readonly` |
| Calendar | `https://www.googleapis.com/auth/calendar` |
| BigQuery | `https://www.googleapis.com/auth/bigquery` |

### 2.5 `docs/04-planning/implementation_plan.md`

**Vị trí:** `d:\Web TKS Dashboard\docs\04-planning\implementation_plan.md`

**Khi nào cập nhật:**
- Thêm giai đoạn mới hoặc thay đổi lớn về kiến trúc
- Đánh dấu task đã hoàn thành (nếu file dùng checkbox `[ ]` / `[x]`)

### 2.6 `docs/02-srs/SRS_Dashboard_GoogleSheets.md`

**Vị trí:** `d:\Web TKS Dashboard\docs\02-srs\SRS_Dashboard_GoogleSheets.md`

**Khi nào cập nhật:**
- Thêm module/tính năng mới → cập nhật mục danh sách tính năng
- Thay đổi yêu cầu phi chức năng (performance, security)

---

## Bước 3 — Quy trình thực hiện

```
1. Chạy: tree "d:\Web TKS Dashboard" /F
2. So sánh với README.md hiện tại
3. Xác định loại thay đổi:
   ├── Thêm file .gs mới          → Cập nhật README.md (cây + tên hàm)
   ├── Thêm thư mục src/ mới      → README.md + .claspignore (nếu không cần push)
   ├── Thêm future-phases/ mới    → README.md (cây + bảng lộ trình)
   ├── Thêm scope GAS mới         → appsscript.json
   ├── Xóa/đổi tên file           → README.md
   └── Thay đổi rootDir           → .clasp.json
4. Cập nhật từng file bị ảnh hưởng
5. Xác nhận bằng cách đọc lại từng file đã cập nhật
```

---

## Bước 4 — Template cập nhật README.md

Khi thêm 1 file `.gs` mới vào `src/`, dùng format:

```
│   ├── ten-thu-muc/
│   │   └── TenFile.gs           # hamChinh(), hamPhu()
```

Khi thêm 1 thư mục `future-phases/` mới:
1. Thêm dòng trong cây:
```
    └── ten-module/              # Giai đoạn X: Mô tả ngắn
```
2. Thêm hàng trong bảng `## Lộ trình mở rộng`:
```
| **X** [Chua bat dau] | `future-phases/ten-module/` | Mô tả đầy đủ |
```

---

## Bước 5 — Kiểm tra sau cập nhật

Sau khi cập nhật xong, xác nhận:

```powershell
# 1. Xem cây thư mục thực tế
tree "d:\Web TKS Dashboard" /F

# 2. Kiểm tra .claspignore không bỏ sót thư mục docs/future-phases
Get-Content "d:\Web TKS Dashboard\.claspignore"

# 3. Xem phần cây trong README để đối chiếu
Select-String -Path "d:\Web TKS Dashboard\README.md" -Pattern "src/" -Context 0,30
```

---

## Ghi chú quan trọng

- **KHÔNG** cập nhật `docs/03-process/bpmn/*.bpmn` — đây là file nhị phân BPMN, không chứa đường dẫn cứng
- **KHÔNG** cập nhật `docs/01-brd/BRD*.md` trừ khi có thay đổi nghiệp vụ thực sự
- Thứ tự ưu tiên cập nhật: `README.md` → `.claspignore` → `appsscript.json` → `.clasp.json` → `docs/`
- Luôn cập nhật dòng `*Cập nhật lần cuối:*` ở cuối `README.md`
