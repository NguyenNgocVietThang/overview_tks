# Kế hoạch: Web App Kiểm Soát & Tự Động Hóa Quy Trình Vận Chuyển Hàng Hóa

## 1. Context / Bối cảnh

Công ty vận hành quy trình vận chuyển hàng hóa qua **5 luồng giao hàng**:

1. HN (An Khánh) -> miền Bắc/Trung, đơn to, bằng xe công ty (lái xe của công ty vận chuyển)
2. SG (Tân Phú) -> miền Nam, đơn to, bằng xe công ty (lái xe của công ty vận chuyển)
3. HN (An Khánh) -> thẳng miền Nam qua đường tàu, không qua trung gian, giao thẳng tới nơi khách
4. SG (Tân Phú) -> miền Nam, đơn bé, qua shipper
5. HN (An Khánh) -> miền Bắc/Trung, đơn bé, qua shipper

> Luồng 1-2 (xe công ty) và luồng 4-5 (shipper) khác nhau chỉ ở đơn vị giao hàng — mỗi kho (An Khánh/Tân Phú) đều có cả hai kiểu, tùy đơn to hay bé. Luồng 3 là ngoại lệ riêng: đi tàu hỏa thẳng tới khách, không tách đơn to/bé.

Toàn bộ quy trình hiện điều phối qua các **nhóm chat Telegram theo tên nghiệp vụ cụ thể** (trước đây gọi chung là "9 nhóm chat đánh số 20-28"), mỗi nhóm ứng với 1 khâu/sự kiện cụ thể theo từng luồng — xem bảng chi tiết ở §3. Đơn hàng gốc được tạo trên **KiotViet** (xác nhận qua URL `chhanoi.kiotviet.vn/sale` trên các phiếu mẫu), sau đó Sale gửi đơn vào nhóm "Đơn An Khánh" / "Đơn Tân Phú" / "Đơn miền Nam" tương ứng để Kế toán xác nhận đơn; tùy luồng, hàng được lên xe công ty, giao shipper, hoặc đưa ra tàu; lái xe/shipper xác nhận nhận đơn và chụp ảnh giao hàng/bill ký nhận (nếu có) gửi lại nhóm xác nhận hoàn thành tương ứng.

### Vấn đề cần giải quyết

- Không có trạng thái đơn hàng tập trung, khó truy vết realtime.
- Sai sót/thiếu ảnh khi soát cuối ngày.
- Nhặt nhầm/thừa/thiếu hàng không được phát hiện sớm.
- Không có dashboard/số liệu tổng hợp (KPI, tiến độ giao hàng, công nợ, hiệu suất xe).
- Toàn bộ vận hành phụ thuộc vào việc theo dõi thủ công nhiều nhóm chat cùng lúc.

### Mục tiêu tổng thể

Xây dựng hệ thống quản lý & truy vết đơn hàng theo thời gian thực:
- **Nền tảng Quản lý Vận chuyển (Web-First):** Vận hành, điều phối, cập nhật trạng thái và upload ảnh chứng từ trực tiếp qua Web Portal / Mobile Web 1-chạm.
- **Tự động hóa Bot Telegram & OCR (Đã hoàn thành bởi dev khác):** Bot Telegram tự động trích xuất OCR mã đơn, bill ký nhận và nạp/cập nhật trực tiếp dữ liệu từ 9 nhóm chat (20-28) vào Google Sheets (`VC_*`) và lưu trữ Google Drive.
- **Mô hình tích hợp Web Dashboard:** Hệ thống Web Dashboard chỉ cần **đọc dữ liệu từ Google Sheets (`VC_*`)** và Google Drive để phục vụ Dashboard KPI vận chuyển, tra cứu vận chuyển cho khách hàng, bảng điều phối kế toán, đối soát cuối ngày tự động và quản lý vận đơn.

**Quy mô:** ~100 người dùng, ~200 đơn hàng/ngày.

---

## 2. Quyết định kiến trúc & Mô hình tích hợp (Google Sheets-Centric)

### 2.1. Quyết định kiến trúc cốt lõi

| Vấn đề | Quyết định |
|---|---|
| Nguồn dữ liệu đơn hàng | **Hóa đơn KiotViet** được Apps Script nhận trực tiếp qua webhook `invoice.update` và upsert vào `Đơn vận chuyển` + `Chi tiết vận chuyển` ở trạng thái `Mới tạo`. Một lượt đối soát 7 ngày có thể chạy riêng để tránh giới hạn thời gian Apps Script. |
| **Bot Telegram & OCR (Đã hoàn thành)** | **Đã hoàn thành bởi dev khác**: Bot Telegram & OCR độc lập lắng nghe 9 nhóm chat (20-28), tự động nạp sự kiện, trạng thái đơn, upload ảnh chứng từ vào Google Drive và ghi trực tiếp vào các tab `VC_*` trên Google Sheet. |
| **Cơ chế hoạt động của Web Dashboard** | **Đọc trực tiếp từ Google Sheets (`VC_*`)**: Web Dashboard (Node.js/Express) đóng vai trò là **lớp đọc dữ liệu (Read-Layer & Management Layer)** qua Google Sheets API (`vcSheetsClient.js` / `vcOrderRepository.js`), đồng thời cung cấp giao diện Điều phối, Tra cứu, Báo cáo đối soát cuối ngày và Mobile Web. |
| Hạ tầng lưu trữ & Database | **Google Sheets độc lập (`VC_*`)** làm DB trung gian + **Google Drive API** lưu trữ ảnh chứng từ theo mã đơn/ngày. Backend Node.js/Express (Render) quản lý nghiệp vụ, cache (TTL 12s + write invalidation) và đối soát. |
| Vai trò Google Sheets | Lưu trữ dữ liệu vận hành phân luồng, xuất báo cáo định kỳ, dễ dàng kiểm tra thủ công khi cần. |

Sheet tổng hợp KiotViet cũ và sheet vận chuyển là hai Spreadsheet/hai Apps Script project độc lập. Project cũ giữ chế độ `FULL_DASHBOARD` và webhook `invoice.update` duy nhất mà KiotViet cho phép; sau khi xử lý, queue cũ chuyển tiếp cùng payload sang Web App của project `SHIPMENT_LIFECYCLE`. Hai sheet vì vậy cùng cập nhật gần realtime mà không tranh đăng ký webhook.

---

## 3. Ma trận chuyển đổi quy trình theo từng luồng: Nhóm Chat Telegram <-> Web Điều Phối <-> Bot Tự Động & Google Sheets

Mỗi luồng có bộ nhóm chat Telegram riêng theo tên nghiệp vụ (không dùng số nhóm chung 20-28 để mô tả quy trình nữa — số nhóm chỉ còn là chi tiết cấu hình nội bộ của Bot Telegram & OCR ở §2/§7).

### 3.1. Luồng 1 & 2 — Đơn to, xe công ty (An Khánh->HN/Trung, Tân Phú->Nam)

| Khâu | Nhóm chat (Luồng 1 - An Khánh / Luồng 2 - Tân Phú) | Trước đây (Thủ công qua Chat) | **Web Điều phối & Mobile 1-chạm** | **Bot Telegram & OCR (ghi Sheet)** |
|---|---|---|---|---|
| 1. Khởi tạo đơn & xác nhận | **"Đơn An Khánh"** / **"Đơn Tân Phú"** | Sale gửi đơn vào nhóm, Kế toán xác nhận đơn, hàng được xếp lên xe | Kế toán mở Web Điều phối, chọn hóa đơn KiotViet, gán Kho + Luồng (1/2) + Xe -> Bấm **"Tạo đơn / Đã in"** | KiotViet webhook / Apps Script nạp tự động vào Sheet `VC_Orders` và `VC_OrderItems` |
| 2. Lái xe xác nhận nhận hàng | **"[HN]-Lái xe chụp đơn"** / **"[SG]-Lái xe chụp đơn"** | Lái xe chụp ảnh đơn xác nhận đã nhận, đơn bị khóa (không cho thay đổi nữa) | Lái xe mở Mobile Web -> Thấy danh sách đơn của mình -> Bấm **"Bắt đầu giao"** | Bot ghi nhận ảnh xác nhận từ nhóm -> khóa đơn, cập nhật trạng thái `Đang giao` trên Sheet |
| 3. Giao hàng & hoàn thành | **"Chụp bill ký nhận [HN]"** / **"Chụp bill ký nhận [SG]"** | Lái xe chụp bill ký nhận xác nhận hàng đã giao tới nơi -> Hoàn thành đơn | Lái xe bấm **[Chụp bill ký]** -> Bấm **"Đã giao / Hoàn thành"** | Bot OCR bill ký nhận -> khớp mã, lưu Drive, cập nhật `Đã giao` -> `Hoàn thành` trên Sheet |

### 3.2. Luồng 5 & 4 — Đơn bé, giao qua shipper (An Khánh->HN/Trung, Tân Phú->Nam)

| Khâu | Nhóm chat (Luồng 5 - An Khánh / Luồng 4 - Tân Phú) | Trước đây (Thủ công qua Chat) | **Web Điều phối & Mobile 1-chạm** | **Bot Telegram & OCR (ghi Sheet)** |
|---|---|---|---|---|
| 1. Khởi tạo đơn & xác nhận | **"Đơn An Khánh"** / **"Đơn Tân Phú"** | Sale gửi đơn vào nhóm, Kế toán xác nhận đơn, hàng được giao cho shipper | Kế toán mở Web Điều phối, chọn hóa đơn KiotViet, gán Kho + Luồng (5/4) -> Bấm **"Tạo đơn / Đã in"** | KiotViet webhook / Apps Script nạp tự động vào Sheet `VC_Orders` và `VC_OrderItems` |
| 2. Shipper nhận đơn & hoàn thành | **"[HN] Ship nhận đơn"** / **"[SG] Ship nhận đơn"** | Shipper xác nhận đã nhận đơn trong nhóm -> Coi như hoàn thành đơn | Shipper/Kế toán bấm **"Đã giao / Hoàn thành"** trên Mobile Web | Bot ghi nhận xác nhận từ nhóm -> cập nhật thẳng `Hoàn thành` trên Sheet (bỏ qua bước ký bill riêng) |

### 3.3. Luồng 3 — Đơn đi tàu hỏa (An Khánh -> thẳng khách miền Nam)

| Khâu | Nhóm chat | Trước đây (Thủ công qua Chat) | **Web Điều phối & Mobile 1-chạm** | **Bot Telegram & OCR (ghi Sheet)** |
|---|---|---|---|---|
| 1. Khởi tạo đơn & xác nhận | **"Đơn miền Nam"** | Sale gửi đơn vào nhóm, Kế toán xác nhận đơn, hàng được đưa ra tàu | Kế toán mở Web Điều phối, gán Kho An Khánh + Luồng 3 -> Bấm **"Tạo đơn / Đã in"** | Nạp tự động vào Sheet; đơn chuyển trạng thái `Đang chuyển kho` (giữ hàng tàu hỏa) |
| 2. Giao tới nơi & hoàn thành | **"Hoàn thành đơn (Đi tàu)"** | Xác nhận trong nhóm khi hàng đã giao tới tay khách -> Coi như hoàn thành đơn | Kế toán/điều phối bấm **"Đã giao / Hoàn thành"** trên Web Điều phối | Bot ghi nhận xác nhận từ nhóm -> cập nhật `Đã giao` -> `Hoàn thành` trên Sheet |

---

## 4. Data Model (Bảng dữ liệu Google Sheets Vận chuyển)

Spreadsheet vận chuyển độc lập gồm **6 tab tiếng Việt** trực quan, thân thiện cho người dùng:

- **`Đơn vận chuyển` (Theo dõi đơn chính):**
  - `Mã vận đơn` (`order_id`): Mã vận đơn nội bộ (`VC-YYYYMMDD-XXXX`).
  - `Mã hóa đơn KiotViet` (`kiotviet_code`): Mã hóa đơn KiotViet (`HD...`).
  - `Kho xuất` (`warehouse`): Cơ sở xuất hàng (`An Khánh` / `Tân Phú`).
  - `Luồng giao hàng` (`flow`): Luồng giao hàng (`1`: HN/An Khánh xe cty, `2`: SG/Tân Phú xe cty, `3`: HN/An Khánh tàu hỏa Nam, `4`: SG/Tân Phú shipper, `5`: HN/An Khánh shipper).
  - `Mã xe` (`vehicle_id`) / `Tên tài xế` (`driver_name`): Xe & tài xế phụ trách.
  - `Tên khách hàng` (`customer_name`), `Số điện thoại` (`customer_phone`), `Địa chỉ nhận hàng` (`address`): Thông tin nhận hàng.
  - `Trạng thái hiện tại` (`current_status`): Trạng thái đơn hàng.
  - `Giữ hàng tàu hỏa` (`is_transit_held`): Cờ giữ hàng trung gian (Luồng 3 - Tàu hỏa).
  - `Tiền cước` (`freight_amount`), `Ghi chú cước` (`freight_note`): Cước phí & ghi chú.
  - `Thời gian tạo` (`created_at`), `Cập nhật lần cuối` (`updated_at`).

- **`Chi tiết vận chuyển` (Mặt hàng trong đơn):**
  - `Mã vận đơn` (`order_id`), `Mã hàng` (`product_code`), `Tên hàng hóa` (`product_name`), `Số lượng đặt` (`quantity_ordered`), `Số lượng đã nhặt` (`quantity_picked`), `Đơn vị tính` (`unit`), `Ghi chú` (`notes`).

- **`Lịch sử trạng thái` (Nhật ký trạng thái & Audit Log):**
  - `Mã lịch sử` (`history_id`), `Mã vận đơn` (`order_id`), `Trạng thái trước` (`from_status`), `Trạng thái mới` (`to_status`), `Người thực hiện` (`changed_by`), `Thời gian cập nhật` (`changed_at`), `Ghi chú` (`note`).

- **`Ảnh chứng từ` (Quản lý Ảnh chứng từ & Drive):**
  - `Mã chứng từ` (`attachment_id`), `Mã vận đơn` (`order_id`), `Loại chứng từ` (`type`: `PICKUP_PHOTO` - ảnh nhặt, `DELIVERY_PHOTO` - ảnh giao, `SIGNED_BILL` - bill ký nhận, `EXCEPTION_PHOTO` - ảnh sự cố).
  - `Google Drive File ID` (`drive_file_id`), `Link xem ảnh` (`drive_view_url`), `Link thumbnail` (`drive_thumbnail_url`): Link ảnh lưu trên Google Drive công ty (tự động phân thư mục theo Ngày/Mã đơn).
  - `Người tải lên` (`uploaded_by`), `Thời gian tải lên` (`uploaded_at`), `Nội dung OCR` (`ocr_text`).

- **`Sự cố vận chuyển` (Xử lý sự cố / Trả hàng):**
  - `Mã sự cố` (`exception_id`), `Mã vận đơn` (`order_id`), `Khâu phát sinh` (`stage`), `Loại sự cố` (`type`: Trả hàng / Thiếu hàng / Hư hỏng...), `Mô tả chi tiết` (`description`), `Người xử lý` (`resolver`), `Trạng thái xử lý` (`status`), `Thời gian báo cáo` (`created_at`), `Thời gian xử lý xong` (`resolved_at`).

- **`Danh mục xe` (Phương tiện & Tài xế):**
  - `Mã xe` (`vehicle_id`), `Biển số xe` (`plate_number`), `Loại xe` (`vehicle_type`), `Tài xế mặc định` (`default_driver`), `Tải trọng tối đa (kg)` (`max_weight`), `Ghi chú` (`notes`).

---

## 5. State Machine trạng thái đơn hàng (9 trạng thái)

```
[Mới tạo] ──▶ [Đã in] ──▶ [Đã nhặt hàng] ──┬──(Luồng 3: Tàu hỏa)──▶ [Đang chuyển kho] ──┐
                                          │                                             │
                                          └──(Luồng 1, 2, 4, 5)───▶ [Đang giao] ◀───────┘
                                                                        │
                                                                        ▼
                                                                   [Đã giao]
                                                                        │
                                                                        ▼
                                                                  [Hoàn thành]
```

- **Nhánh ngoại lệ — Sự cố (`SU_CO`) & Đã hủy (`DA_HUY`):**
  - Đơn có thể báo cáo sự cố (`SU_CO`) từ các trạng thái vận hành (`DA_IN`, `DA_NHAT_HANG`, `DANG_CHUYEN_KHO`, `DANG_GIAO`), kèm mô tả sự cố và ảnh chứng từ lưu Drive.
  - Khi xử lý sự cố xong, đơn được khôi phục về trạng thái trước đó.
  - Đơn có thể hủy (`DA_HUY`) khi có quyết định hủy đơn từ kế toán/quản lý.
- **Quy tắc "Coi như đã ký":** Nếu có ảnh chụp bill hoặc ảnh xác nhận giao hàng hợp lệ -> Hệ thống chuyển trạng thái sang `DA_GIAO` -> `HOAN_THANH`.
  - Áp dụng cho Luồng 4 & 5 (shipper): shipper xác nhận nhận đơn trong nhóm "[SG]/[HN] Ship nhận đơn" -> hệ thống coi như đã ký, chuyển thẳng `DA_GIAO` -> `HOAN_THANH`, không yêu cầu bill ký nhận riêng như Luồng 1 & 2.

---

## 6. Thiết kế Giao diện Web Chuyển tiếp (Web-First Portal)

### 6.1. Web Desktop: Điều phối & Quản lý đơn (`/shipment/dispatch`)
- **Tạo đơn 1-click từ KiotViet:** Danh sách hóa đơn mới từ sheet `Hóa đơn`, Kế toán chỉ cần tick chọn -> Gán Luồng & Xe -> Bấm tạo đơn.
- **Bảng Kanban trực quan:** Theo dõi đơn theo từng cột trạng thái (*Mới tạo -> Đã in -> Đã nhặt hàng -> Đang chuyển kho / Đang giao -> Đã giao -> Hoàn thành / Sự cố*).
- **Bộ lọc & Tìm kiếm:** Lọc theo Ngày, Kho, Luồng 1-5, Lái xe, Trạng thái đơn.

### 6.2. Mobile Web 1-Chạm: Dành cho Thủ kho & Lái xe (`/shipment/mobile`)
- **Tối ưu điện thoại:** Nút bấm lớn, thao tác nhanh, tích hợp trực tiếp Camera điện thoại qua HTML5 File/Camera API.
- **Tự động nén ảnh client-side:** Resize và nén ảnh trước khi tải lên (`image-compress.js`) để tiết kiệm băng thông 4G và upload cực nhanh (<1s).
- **Dành cho Kho:** Xem danh sách đơn cần nhặt -> Bấm **[Chụp ảnh hàng nhặt]** -> Bấm **[Xác nhận đã nhặt]**.
- **Dành cho Lái xe / Shipper:** Xem danh sách đơn của mình -> Bấm **[Bắt đầu giao]** -> Đến nơi chụp ảnh bill/hàng -> Bấm **[Hoàn thành]**.

### 6.3. Báo cáo Đối soát Cuối ngày (`/shipment/audit`)
- Tự động liệt kê danh sách kiểm tra:
  - [Thieu anh kho] Đơn nào chưa có ảnh nhặt hàng kho?
  - [Thieu bill ky] Đơn nào giao thành công nhưng thiếu ảnh bill ký nhận?
  - [Tre han] Đơn nào đang giao quá thời gian quy định (đơn trễ)?

---

## 7. Roadmap triển khai theo từng giai đoạn

```
+------------------------------------------------------------------------+
| Phase 0: Nền tảng Auth, RBAC 5 vai trò & Quản lý tài khoản / OTP Reset | [DA HOAN THANH]
+------------------------------------------------------------------------+
| Phase 0.5: Tra cứu vận chuyển Khách hàng (API + UI /shipment/)         | [DA HOAN THANH]
+------------------------------------------------------------------------+
| Phase 1: MVP Quản lý Vận chuyển Web-First (Nền tảng Quản lý Vận đơn)   | [DA HOAN THANH]
|  |-- 1A: Khởi tạo Spreadsheet VC_* & Google Drive Service lưu ảnh      | [DA HOAN THANH]
|  |-- 1B: Backend State Machine 9 trạng thái & API CRUD đơn vận chuyển  | [DA HOAN THANH]
|  |-- 1C: Web Desktop Điều phối (Kế toán) & Mobile Web (Kho/Lái xe)     | [DA HOAN THANH]
|  `-- 1D: Báo cáo Đối soát cuối ngày tự động lọc đơn thiếu ảnh          | [DA HOAN THANH]
+------------------------------------------------------------------------+
| Phase 2: Tự động hóa Bot Telegram & OCR (Đã hoàn thành bởi dev khác)   | [DA HOAN THANH]
|  |-- 2A: Bot Telegram lắng nghe 9 nhóm chat (20-28) nạp vào Sheet VC_* | [DA HOAN THANH]
|  |-- 2B: OCR đọc bill ký nhận / ảnh chụp -> Google Sheets & Drive      | [DA HOAN THANH]
|  `-- 2C: Web Dashboard đọc trực tiếp dữ liệu từ Google Sheets VC_*     | [DA HOAN THANH]
+------------------------------------------------------------------------+
| Phase 3: Vận hành nâng cao & Mở rộng (Giai đoạn tiếp theo)             | [GIAI DOAN TIEP THEO]
|  |-- Dashboard KPI vận chuyển chuyên sâu (doanh thu, hiệu suất xe)     |
|  |-- Quản lý xe/tài xế & phân bổ tuyến tối ưu                          |
|  `-- Module cước phí vận chuyển (khi có công thức)                     |
+------------------------------------------------------------------------+
```

---

## 8. Tài liệu tham chiếu trong dự án

- [`docs/04-planning/implementation_plan.md`](docs/04-planning/implementation_plan.md) — Kế hoạch tổng thể hệ thống TOKOSI v2.0
- [`docs/01-brd/BRD_Dashboard_GoogleSheets.md`](docs/01-brd/BRD_Dashboard_GoogleSheets.md) — Yêu cầu nghiệp vụ BRD v1.7
- [`docs/02-srs/SRS_Dashboard_GoogleSheets.md`](docs/02-srs/SRS_Dashboard_GoogleSheets.md) — Đặc tả kỹ thuật SRS v1.9
- [`docs/03-process/BPMN_Dashboard_GoogleSheets.md`](docs/03-process/BPMN_Dashboard_GoogleSheets.md) — Sơ đồ quy trình nghiệp vụ BPMN v1.8
- [`3D Design.md`](3D%20Design.md) — Kế hoạch thiết kế hiệu ứng 3D toàn site
- [`ROLLBACK.md`](ROLLBACK.md) — Hướng dẫn tắt & khôi phục nhanh hiệu ứng 3D
- [`docs/performance-optimization-report.md`](docs/performance-optimization-report.md) — Báo cáo tối ưu hóa hiệu năng 3D, FPS & WebGL
- `Mẫu đơn sale gửi.jpg` — mẫu đơn hàng xuất từ KiotViet
- `Phiếu đặt hàng lái xe gửi.jpg` — mẫu phiếu đặt hàng kho gửi lái xe
- `Phiếu xác nhận giao hàng láy xe gửi.jpg` — mẫu phiếu lái xe chụp xác nhận giao hàng
