# Kế hoạch: Web App Kiểm Soát & Tự Động Hóa Quy Trình Vận Chuyển Hàng Hóa

## 1. Context / Bối cảnh

Công ty vận hành quy trình vận chuyển hàng hóa qua **4 luồng giao hàng**:

1. HN (An Khánh) → miền Bắc/Trung bằng xe công ty
2. SG (Tân Phú) → miền Nam bằng xe công ty
3. HN (An Khánh) → thẳng miền Nam qua đường tàu, không qua trung gian
4. SG (Tân Phú) → miền Nam qua shipper

> Luồng 2 và 4 đều xuất phát từ Tân Phú/SG, bản chất giống nhau — chỉ khác đơn vị giao hàng (xe công ty hay shipper).

Toàn bộ quy trình hiện điều phối qua các **nhóm chat Telegram đánh số 20-28**, mỗi nhóm ứng với 1 khâu/sự kiện cụ thể (Sale gửi đơn, lái xe chụp đơn đã nhặt, bill ký nhận, đơn hoàn thành...). Đơn hàng gốc được tạo trên **KiotViet** (xác nhận qua URL `chhanoi.kiotviet.vn/sale` trên các phiếu mẫu), sau đó Sale in/chụp phiếu gửi vào nhóm để Kế toán in đơn cho lái xe; Kho chụp ảnh hàng đã nhặt; lái xe/shipper chụp ảnh giao hàng và bill ký nhận (nếu có) gửi lại nhóm.

### Vấn đề cần giải quyết

- Không có trạng thái đơn hàng tập trung, khó truy vết realtime.
- Sai sót/thiếu ảnh khi soát cuối ngày.
- Nhặt nhầm/thừa/thiếu hàng không được phát hiện sớm.
- Không có dashboard/số liệu tổng hợp (KPI, doanh thu, công nợ, tồn kho).
- Toàn bộ vận hành phụ thuộc vào việc theo dõi thủ công nhiều nhóm chat cùng lúc.

### Mục tiêu

Xây dựng một web app: theo dõi/truy vết đơn hàng theo thời gian thực, có **bot Telegram tự động** xử lý các nhóm hiện tại (OCR ảnh + tự cập nhật trạng thái), **dashboard KPI** với bộ lọc/tìm kiếm, **phân quyền theo 9 vai trò** nội bộ + trang tra cứu công khai cho khách hàng, tích hợp **KiotViet API** làm nguồn dữ liệu đơn hàng chính, và xuất báo cáo định kỳ ra **Google Sheets**.

**Quy mô:** ~100 người dùng, ~200 đơn hàng/ngày.

---

## 2. Quyết định kiến trúc đã chốt

| Vấn đề | Quyết định |
|---|---|
| Nguồn dữ liệu đơn hàng | **API KiotViet** làm nguồn chính (đơn, khách hàng, sản phẩm, công nợ). OCR chỉ dùng cho ảnh phiếu xác nhận giao hàng/bill ký nhận — dữ liệu không có sẵn trong KiotViet. |
| Mức độ tự động của bot Telegram | **Tự động hoàn toàn**: bot đọc ảnh/tin nhắn trong nhóm 20-28, tự OCR, tự đối chiếu và cập nhật trạng thái đơn hàng. Chỉ cảnh báo người dùng xử lý thủ công khi không chắc chắn (ảnh mờ, không khớp mã đơn...). |
| Vai trò Google Sheets | **Chỉ xuất báo cáo định kỳ** (một chiều), không phải nguồn dữ liệu chính của hệ thống. |

---

## 3. Đề xuất công nghệ

| Thành phần | Lựa chọn | Lý do |
|---|---|---|
| Frontend | **Next.js** (React + TypeScript) | 1 codebase cho dashboard nội bộ + trang tra cứu khách hàng công khai; SSR tốt cho tải nhanh trên mobile của lái xe/kho |
| Backend API | **NestJS** (Node.js + TypeScript) | Cùng ngôn ngữ với frontend; cấu trúc module rõ ràng (Orders, Users, Telegram, OCR, Reports); dễ bảo trì với đội nhỏ |
| Database | **PostgreSQL** | Quan hệ rõ ràng giữa đơn/khách/kho/xe/lịch sử trạng thái; transaction an toàn cho state machine |
| Hàng đợi tác vụ nền | **Redis + BullMQ** | Xử lý OCR, gọi KiotViet API, đồng bộ Google Sheets bất đồng bộ — tránh chặn bot Telegram khi xử lý ảnh |
| Lưu trữ ảnh | **Object storage** (Cloudflare R2 / AWS S3) | Ảnh đơn hàng, ảnh nhặt hàng, ảnh giao hàng, bill ký nhận — dung lượng lớn, cần CDN phân phối nhanh |
| OCR | **Google Cloud Vision API** (hoặc FPT.AI OCR cho chữ viết tay tiếng Việt) | Đọc mã đơn, số lượng, chữ ký trên phiếu chụp gửi vào Telegram |
| Bot Telegram | **grammY** (Node.js), chạy qua webhook | Nghe đồng thời 9 nhóm, tải ảnh, gọi OCR, gọi API cập nhật trạng thái |
| Tích hợp KiotViet | **KiotViet Public API** (OAuth2) | Đồng bộ đơn hàng/khách hàng/sản phẩm/công nợ qua webhook hoặc polling định kỳ |
| Xuất Google Sheets | **Google Sheets API** (service account) | Cron job đẩy báo cáo doanh thu/công nợ/KPI theo ngày/tuần |
| Xác thực & phân quyền | **JWT + RBAC** (9 vai trò nội bộ); khách hàng tra cứu công khai theo mã đơn, không cần tài khoản | Đơn giản, đủ cho quy mô 100 người dùng |
| Hosting/Triển khai | **Docker Compose** trên 1 VPS (tách container nếu cần scale sau); CI/CD đơn giản qua GitHub Actions | Chi phí thấp, phù hợp quy mô hiện tại |
| Thông báo real-time | **WebSocket (Socket.IO)** cho notification center trên web | Cảnh báo tức thời cho Kế toán/Trưởng kho khi đơn trễ hoặc thiếu ảnh |

---

## 4. Vai trò & phân quyền

| Vai trò | Quyền trên web app |
|---|---|
| **Quản lý** | Full quyền: xem, sửa, duyệt, báo cáo, quản trị người dùng |
| **Kế toán** | Xem/sửa trạng thái, duyệt đơn, quản lý công nợ/cước, xem tồn kho theo cơ sở |
| **Trưởng kho** | Xem/sửa trạng thái, duyệt đơn, quản lý tồn kho/đơn treo tạm giữa 2 cơ sở HN-SG |
| **Trợ lý** | Chỉ xem toàn bộ trạng thái đơn hàng, không có quyền sửa |
| **Khách hàng** | Tra cứu công khai theo mã đơn, không cần đăng nhập |
| **Sale, Nhân viên kho, Lái xe, Shipper, Nhân viên mua hàng** | Không có tài khoản/quyền trên web — tương tác hoàn toàn qua chat Telegram, bot xử lý thay |

---

## 5. Data model (cốt lõi)

- **Order**: mã đơn KiotViet, mã vận đơn, kho xuất (An Khánh/Tân Phú), luồng giao hàng (1-4), khách hàng, NV bán hàng, tổng tiền, công nợ, trạng thái hiện tại, xe/lái xe được gán (kèm ghi chú), cờ "đang treo tạm giữa 2 cơ sở" (luồng 3)
- **OrderItem**: tên hàng, SL đặt, đơn giá, thành tiền, vị trí kho, SL thực nhặt (đối chiếu qua OCR), ghi chú/số thùng
- **OrderStatusHistory**: trạng thái, thời điểm, người/nguồn thực hiện (web / bot / OCR), ảnh đính kèm
- **Attachment**: loại ảnh (đơn sale, phiếu nhặt hàng, phiếu xác nhận giao hàng, bill ký nhận), url, kết quả OCR, nguồn tin nhắn Telegram (message id, group id)
- **ReturnException**: đơn liên quan, khâu xảy ra (nhặt hàng/đang giao/đã giao...), loại (trả hàng/thiếu/thừa/hư hỏng), mô tả, người xử lý, trạng thái xử lý
- **Vehicle**: biển số, loại xe, tài xế phụ trách, ghi chú tải trọng/hàng hóa
- **User**: tên, SĐT, vai trò, cơ sở phụ trách
- **TelegramGroupMapping**: chat_id Telegram ↔ mã nhóm (20-28) ↔ cơ sở/loại sự kiện tương ứng

---

## 6. State machine trạng thái đơn hàng

```
Mới tạo → Đã in → Đã nhặt hàng → (Đang chuyển kho nội bộ — chỉ luồng 3, tùy chọn) → Đang giao → Đã giao → Hoàn thành
```

**Nhánh ngoại lệ — Trả hàng:** có thể xảy ra từ bất kỳ trạng thái nào từ "Đã nhặt hàng" trở đi. Khi xảy ra, hệ thống lưu lại trạng thái trước đó + lý do + người xử lý, không xóa lịch sử trạng thái đã có.

**Quy tắc "coi như đã ký":** nếu khách không ký nhưng kho có chụp ảnh bill lên nhóm 25 (Nhóm chụp bill ký nhận) → hệ thống tự động đánh dấu đơn Hoàn thành.

---

## 7. Tính năng chính

1. **Dashboard & KPI**: tổng đơn theo trạng thái/luồng/kho, đơn trễ, doanh thu/công nợ theo ngày-tuần-tháng, bộ lọc (mã đơn, khách hàng, trạng thái, luồng, kho, ngày, lái xe, sale) + tìm kiếm nhanh theo mã đơn.
2. **Bot Telegram tự động**: nghe 9 nhóm (20-28), OCR ảnh, đối chiếu mã đơn với KiotViet, tự cập nhật trạng thái tương ứng; cảnh báo thủ công khi không chắc chắn (ảnh mờ, không khớp mã đơn).
3. **Đối chiếu số lượng tự động**: so sánh SL đặt (từ KiotViet) với SL thực nhặt/giao (từ OCR phiếu) → gắn cờ cảnh báo khi có chênh lệch — giải quyết pain-point "nhặt nhầm/thừa/thiếu hàng".
4. **Đối soát cuối ngày**: báo cáo tự động liệt kê các đơn còn thiếu ảnh xác nhận ở bất kỳ khâu nào — giải quyết pain-point "thiếu ảnh khi soát cuối ngày".
5. **Quản lý xe & tài xế**: danh sách xe, tài xế, trường ghi chú tải trọng/hàng hóa cho từng chuyến.
6. **Cảnh báo real-time**: notification center trên web (cho Kế toán, Trưởng kho, Quản lý), có thể kèm gửi qua bot Telegram.
7. **Tra cứu khách hàng**: trang công khai tìm theo mã đơn, xem trạng thái hiện tại (không hiển thị dữ liệu nhạy cảm khác).
8. **Luồng ngoại lệ trả hàng**: ghi nhận tại bất kỳ khâu nào, không phá vỡ lịch sử trạng thái đơn.
9. **Xuất báo cáo Google Sheets**: cron job định kỳ đẩy báo cáo doanh thu/công nợ/KPI.
10. **Module cước phí**: để trống công thức tính, chờ người dùng cung cấp sau; thiết kế sẵn field mở rộng (`Order.freight_amount`, `Order.freight_formula_version`) để không phải đổi schema khi bổ sung.

---

## 8. Cấu trúc thư mục dự kiến (khi bắt đầu code)

```
Process Automation/
├── Plan.md                     # tài liệu này
├── apps/
│   ├── web/                    # Next.js: dashboard nội bộ + trang tra cứu khách hàng
│   ├── api/                    # NestJS: REST API, state machine, RBAC
│   └── bot/                    # grammY: Telegram bot worker
├── packages/
│   ├── db/                     # Prisma schema + migrations (Postgres)
│   └── shared/                 # types dùng chung (Order, Status enum...)
└── docker-compose.yml
```

---

## 9. Roadmap theo giai đoạn

- **Phase 0 — Nền tảng**: setup repo, DB schema, auth/RBAC, kết nối KiotViet API (đồng bộ đơn/khách/sản phẩm), CRUD đơn hàng cơ bản trên web.
- **Phase 1 — MVP**: bot Telegram tự động cho 9 nhóm (OCR + cập nhật trạng thái), state machine đầy đủ + luồng trả hàng, trang tra cứu khách hàng, cảnh báo cơ bản trên web.
- **Phase 2 — Vận hành đầy đủ**: dashboard KPI + bộ lọc, đối soát cuối ngày tự động, đối chiếu số lượng tự động, quản lý xe/tài xế, xuất báo cáo Google Sheets, module cước phí (khi có công thức).
- **Phase 3 — Mở rộng**: hỗ trợ nhiều kho hơn 2 cơ sở hiện tại, gợi ý tối ưu (ghép xe/tuyến, nếu cần sau này), PWA riêng cho lái xe (chụp ảnh offline-friendly).

Timeline cụ thể: chờ người dùng quy định sau.

---

## 10. Rủi ro & giả định

- Cần xin quyền API KiotViet (gói phù hợp) — nếu công ty chưa có, cần liên hệ KiotViet trước khi bắt đầu Phase 0.
- OCR tiếng Việt viết tay không chính xác 100% → thiết kế hàng đợi "cần soát thủ công" thay vì tự tin cập nhật sai trạng thái đơn.
- Bot cần được thêm làm admin vào 9 nhóm Telegram hiện tại, và cần thu thập chat_id thực tế của từng nhóm khi triển khai.
- Giả định mỗi nhóm Telegram map 1-1 với 1 loại sự kiện/cơ sở như mô tả trong file `Luồng cơ bản vận chuyển hàng.txt`.

---

## 11. Tài liệu tham chiếu trong dự án

- [`Luồng cơ bản vận chuyển hàng.txt`](./Luồng%20cơ%20bản%20vận%20chuyển%20hàng.txt) — mô tả gốc 4 luồng nghiệp vụ và 9 nhóm chat Telegram
- `Mẫu đơn sale gửi.jpg` — mẫu đơn hàng xuất từ KiotViet
- `Phiếu đặt hàng lái xe gửi.jpg` — mẫu phiếu đặt hàng kho gửi lái xe
- `Phiếu xác nhận giao hàng láy xe gửi.jpg` — mẫu phiếu lái xe chụp xác nhận giao hàng
