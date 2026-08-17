# Kế hoạch: Web App Kiểm Soát & Tự Động Hóa Quy Trình Vận Chuyển Hàng Hóa

## 1. Context / Bối cảnh

Công ty vận hành quy trình vận chuyển hàng hóa qua **4 luồng giao hàng**:

1. HN (An Khánh) -> miền Bắc/Trung bằng xe công ty
2. SG (Tân Phú) -> miền Nam bằng xe công ty
3. HN (An Khánh) -> thẳng miền Nam qua đường tàu, không qua trung gian
4. SG (Tân Phú) -> miền Nam qua shipper

> Luồng 2 và 4 đều xuất phát từ Tân Phú/SG, bản chất giống nhau — chỉ khác đơn vị giao hàng (xe công ty hay shipper).

Toàn bộ quy trình hiện điều phối qua các **nhóm chat Telegram đánh số 20-28**, mỗi nhóm ứng với 1 khâu/sự kiện cụ thể (Sale gửi đơn, lái xe chụp đơn đã nhặt, bill ký nhận, đơn hoàn thành...). Đơn hàng gốc được tạo trên **KiotViet** (xác nhận qua URL `chhanoi.kiotviet.vn/sale` trên các phiếu mẫu), sau đó Sale in/chụp phiếu gửi vào nhóm để Kế toán in đơn cho lái xe; Kho chụp ảnh hàng đã nhặt; lái xe/shipper chụp ảnh giao hàng và bill ký nhận (nếu có) gửi lại nhóm.

### Vấn đề cần giải quyết

- Không có trạng thái đơn hàng tập trung, khó truy vết realtime.
- Sai sót/thiếu ảnh khi soát cuối ngày.
- Nhặt nhầm/thừa/thiếu hàng không được phát hiện sớm.
- Không có dashboard/số liệu tổng hợp (KPI, tiến độ giao hàng, công nợ, hiệu suất xe).
- Toàn bộ vận hành phụ thuộc vào việc theo dõi thủ công nhiều nhóm chat cùng lúc.

### Mục tiêu tổng thể

Xây dựng hệ thống quản lý & truy vết đơn hàng theo thời gian thực:
- **Giai đoạn trước mắt (Kế hoạch thay thế Web-First):** Vận hành, cập nhật trạng thái và upload ảnh chứng từ trực tiếp qua Web Portal / Mobile Web 1-chạm mà **không phụ thuộc vào Telegram Bot**.
- **Giai đoạn tiếp theo (Khi có đủ Telegram Bot):** Tích hợp Bot Telegram tự động (OCR ảnh + webhook nạp dữ liệu từ 9 nhóm chat vào hệ thống).
- **Dashboard & Báo cáo:** Dashboard KPI vận chuyển, lọc/tìm kiếm đa năng, đối soát cuối ngày tự động lọc đơn thiếu ảnh, phân quyền RBAC và trang tra cứu công khai cho khách hàng.

**Quy mô:** ~100 người dùng, ~200 đơn hàng/ngày.

---

## 2. Quyết định kiến trúc & Chiến lược Chuyển tiếp (Interim Web-First)

### 2.1. Quyết định kiến trúc cốt lõi

| Vấn đề | Quyết định |
|---|---|
| Nguồn dữ liệu đơn hàng | **Hóa đơn KiotViet** được Apps Script nhận trực tiếp qua webhook `invoice.update` và upsert vào `Đơn vận chuyển` + `Chi tiết vận chuyển` ở trạng thái `Mới tạo`. Một lượt đối soát 7 ngày có thể chạy riêng để tránh giới hạn thời gian Apps Script. |
| **Xử lý khi chưa đủ Bot Telegram** | **Áp dụng Kế hoạch thay thế Web-First**: Thay vì chờ Bot Telegram cho đủ 9 nhóm chat, các bộ phận (*Kế toán, Thủ kho, Lái xe/Shipper*) thao tác cập nhật trạng thái và upload ảnh trực tiếp qua **Giao diện Web tối ưu Mobile (1-2 chạm)**. |
| Tương thích với Bot Telegram sau này | **Forward-Compatible (Tương thích 100%)**: Backend API và State Machine được chuẩn hóa. Khi Bot Telegram & OCR sẵn sàng, Bot chỉ đóng vai trò là kênh nạp sự kiện tự động gọi vào đúng API này mà không cần thay đổi dữ liệu. |
| Hạ tầng lưu trữ & Database | **Google Sheets độc lập (`VC_*`)** làm DB trung gian + **Google Drive API** lưu trữ ảnh chứng từ theo mã đơn/ngày. Backend Node.js/Express (Render) quản lý nghiệp vụ và cache. |
| Vai trò Google Sheets | Lưu trữ dữ liệu vận hành phân luồng, xuất báo cáo định kỳ, dễ dàng kiểm tra thủ công khi cần. |

Sheet tổng hợp KiotViet cũ và sheet vận chuyển là hai Spreadsheet/hai Apps Script project độc lập. Project cũ giữ chế độ `FULL_DASHBOARD` và webhook `invoice.update` duy nhất mà KiotViet cho phép; sau khi xử lý, queue cũ chuyển tiếp cùng payload sang Web App của project `SHIPMENT_LIFECYCLE`. Hai sheet vì vậy cùng cập nhật gần realtime mà không tranh đăng ký webhook.

---

## 3. Ma trận chuyển đổi quy trình: Chat Telegram <-> Web Thay Thế <-> Bot Tương Lai

| Khâu nghiệp vụ / Nhóm chat | Hiện tại (Thủ công qua Chat) | **Kế hoạch Thay thế (Web Portal 1-chạm)** | **Tương lai (Bot Telegram + OCR)** |
|---|---|---|---|
| **1. Khởi tạo đơn & Gán luồng/xe** *(Nhóm 20, 21)* | Sale gửi đơn, Kế toán đọc tin nhắn và in phiếu | Kế toán mở Web Điều phối, chọn hóa đơn KiotViet có sẵn, gán Kho + Luồng (1-4) + Xe -> Bấm **"Tạo đơn / Đã in"** | KiotViet API nạp tự động hoặc Bot đọc tin nhắn nhóm 20/21 |
| **2. Kho nhặt hàng & Chụp ảnh** *(Nhóm 22, 23)* | Kho nhặt xong chụp ảnh gửi vào nhóm chat | Kho mở Web trên điện thoại -> Chọn đơn -> Chụp ảnh hàng nhặt -> Bấm **"Đã nhặt hàng"** | Kho chụp gửi nhóm -> Bot tự lưu Drive và cập nhật |
| **3. Lái xe nhận hàng & Giao** *(Nhóm 24)* | Lái xe nhắn/chụp ảnh xác nhận nhận đơn | Lái xe mở Mobile Web -> Thấy danh sách đơn của mình -> Bấm **"Bắt đầu giao"** | Bot ghi nhận khi tài xế gửi ảnh/tin nhắn nhóm 24 |
| **4. Giao hàng & Ký nhận bill** *(Nhóm 25, 26)* | Lái xe chụp ảnh giao / bill ký gửi nhóm chat | Lái xe bấm **[Chụp bill ký / ảnh giao]** -> Bấm **"Đã giao / Hoàn thành"** | Bot OCR bill ký nhận -> Tự động khớp mã và hoàn thành đơn |
| **5. Đơn hoàn thành & Xử lý sự cố** *(Nhóm 27, 28)* | Soát thủ công từng nhóm chat để tìm đơn lỗi/thiếu ảnh | Trang **Đối soát cuối ngày** tự động lọc đơn thiếu ảnh. Gặp sự cố bấm form **"Báo cáo sự cố"** | Bot tự động cảnh báo vào nhóm điều phối khi đơn trễ hoặc ảnh mờ |

---

## 4. Data Model (Bảng dữ liệu Google Sheets Vận chuyển)

Spreadsheet vận chuyển độc lập gồm **6 tab tiếng Việt** trực quan, thân thiện cho người dùng:

- **`Đơn vận chuyển` (Theo dõi đơn chính):**
  - `Mã vận đơn` (`order_id`): Mã vận đơn nội bộ (`VC-YYYYMMDD-XXXX`).
  - `Mã hóa đơn KiotViet` (`kiotviet_code`): Mã hóa đơn KiotViet (`HD...`).
  - `Kho xuất` (`warehouse`): Cơ sở xuất hàng (`An Khánh` / `Tân Phú`).
  - `Luồng giao hàng` (`flow`): Luồng giao hàng (`1`: HN xe cty, `2`: SG xe cty, `3`: HN tàu hỏa Nam, `4`: SG shipper).
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

## 5. State Machine trạng thái đơn hàng

```
CHO_XAC_NHAN -> DA_XAC_NHAN -> DANG_DONG_GOI -> DA_DONG_GOI -> DANG_GIAO_HANG -> DA_GIAO_HANG
```

- **Nhánh ngoại lệ — Sự cố / Trả hàng:** Có thể chuyển sang `THAT_BAI` hoặc `DA_HUY` khi gặp sự cố, kèm theo lý do hủy và ảnh minh chứng, bảo toàn đầy đủ nhật ký trạng thái (`VC_StatusHistory`).
- **Quy tắc "Coi như đã ký":** Nếu có ảnh chụp bill hoặc ảnh xác nhận giao hàng hợp lệ -> Hệ thống chuyển trạng thái sang `DA_GIAO_HANG`.

---

## 6. Thiết kế Giao diện Web Chuyển tiếp (Web-First Portal)

### 6.1. Web Desktop: Điều phối & Quản lý đơn (`/shipment/dispatch`)
- **Tạo đơn 1-click từ KiotViet:** Danh sách hóa đơn mới từ sheet `Hóa đơn`, Kế toán chỉ cần tick chọn -> Gán Luồng & Xe -> Bấm tạo đơn.
- **Bảng Kanban trực quan:** Theo dõi đơn theo từng cột trạng thái (*Chờ xác nhận -> Đã xác nhận -> Đang đóng gói -> Đã đóng gói -> Đang giao hàng -> Đã giao hàng / Sự cố*).
- **Bộ lọc & Tìm kiếm:** Lọc theo Ngày, Kho, Luồng 1-4, Lái xe, Trạng thái đơn.

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
| Phase 0: Nền tảng Auth & Phân quyền RBAC 5 vai trò                     | [DA HOAN THANH]
+------------------------------------------------------------------------+
| Phase 0.5: Tra cứu vận chuyển Khách hàng (API + UI /shipment/)         | [DA HOAN THANH]
+------------------------------------------------------------------------+
| Phase 1: MVP Quản lý Vận chuyển Web-First (Kế hoạch thay thế)          | [DANG TRIEN KHAI]
|  |-- 1A: Khởi tạo Spreadsheet VC_* & Google Drive Service lưu ảnh      | [DA HOAN THANH]
|  |-- 1B: Backend State Machine & API CRUD đơn vận chuyển               | [DA HOAN THANH]
|  |-- 1C: Web Desktop Điều phối (Kế toán) & Mobile Web (Kho/Lái xe)     | [DA HOAN THANH]
|  `-- 1D: Báo cáo Đối soát cuối ngày tự động lọc đơn thiếu ảnh          | [DA HOAN THANH]
+------------------------------------------------------------------------+
| Phase 2: Tự động hóa Bot Telegram & OCR (Khi chuẩn bị đủ Bot 9 nhóm)   | [GIAI DOAN TIEP THEO]
|  |-- 2A: Bot Telegram lắng nghe 9 nhóm chat (20-28) -> gọi API Phase 1 |
|  |-- 2B: Tích hợp OCR (Google Cloud Vision) đọc bill ký nhận           |
|  `-- 2C: Hàng đợi cảnh báo thủ công khi ảnh mờ / không khớp mã         |
+------------------------------------------------------------------------+
| Phase 3: Vận hành nâng cao & Mở rộng                                   | [TUONG LAI]
|  |-- Dashboard KPI vận chuyển chuyên sâu (doanh thu, hiệu suất xe)     |
|  |-- Quản lý xe/tài xế & phân bổ tuyến tối ưu                          |
|  `-- Module cước phí vận chuyển (khi có công thức)                     |
+------------------------------------------------------------------------+
```

---

## 8. Tài liệu tham chiếu trong dự án

- [`docs/04-planning/implementation_plan.md`](docs/04-planning/implementation_plan.md) — Kế hoạch tổng thể hệ thống TOKOSI
- [`docs/01-brd/BRD_Dashboard_GoogleSheets.md`](docs/01-brd/BRD_Dashboard_GoogleSheets.md) — Yêu cầu nghiệp vụ BRD v1.5
- [`docs/02-srs/SRS_Dashboard_GoogleSheets.md`](docs/02-srs/SRS_Dashboard_GoogleSheets.md) — Đặc tả kỹ thuật SRS v1.7
- `Mẫu đơn sale gửi.jpg` — mẫu đơn hàng xuất từ KiotViet
- `Phiếu đặt hàng lái xe gửi.jpg` — mẫu phiếu đặt hàng kho gửi lái xe
- `Phiếu xác nhận giao hàng láy xe gửi.jpg` — mẫu phiếu lái xe chụp xác nhận giao hàng
