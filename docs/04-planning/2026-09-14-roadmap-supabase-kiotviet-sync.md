# Roadmap: Đưa dữ liệu KiotViet lên Supabase Postgres (cận thời gian thực, 2 cơ sở)

> **Đây là tài liệu roadmap (định hướng), KHÔNG PHẢI kế hoạch code chi tiết.** Mục đích: thống nhất hướng đi, các giai đoạn, và các quyết định kỹ thuật quan trọng trước khi bắt tay viết code. Chưa có dòng code nào được sửa trong tài liệu này.

## 1. Mục tiêu

Xây dựng một lớp lưu trữ dữ liệu **bền vững, ổn định, cập nhật gần như thời gian thực** trên **Supabase Postgres (gói miễn phí)**, đồng bộ toàn bộ dữ liệu bán hàng từ KiotViet — hóa đơn, đơn hàng, trả hàng, sản phẩm, khách hàng, nhà cung cấp, nhập hàng, thu chi, nhóm hàng — cho **cả 2 cơ sở Hà Nội và Sài Gòn**.

Đây là bước nền tảng. Dashboard hiện tại (đọc từ Google Sheets) **chưa bị thay đổi** ở giai đoạn này — việc chuyển Dashboard sang đọc Postgres và việc chuyển hosting sang Render là các bước làm **sau**, khi dữ liệu trên Supabase đã chạy ổn định.

## 2. Vì sao làm lại lần này (bối cảnh)

Việc này từng được thiết kế và xây gần xong một lần (tháng 8/2026), kể cả việc dò thực tế API KiotViet để biết chính xác cách đồng bộ tăng dần cho từng loại dữ liệu — nhưng bị hủy và xóa toàn bộ ngày 2026-09-08 khi quyết định ở lại với Google Sheets. Những phát hiện quan trọng từ lần đó (vẫn còn lưu trong `server/kiotviet/API_ENDPOINTS.md`) là nền tảng cho roadmap này, làm lại trên Supabase thay vì một gói Postgres chung chung.

Một vướng mắc kỹ thuật cần dọn trước khi bắt đầu: `server/config.js` hiện có một dòng cấu hình Postgres cũ (`DATABASE_URL`) sót lại từ lần trước — không còn được dùng ở đâu, nhưng khiến app **không khởi động được nếu thiếu biến này**. Cần dọn sạch trước khi thêm cấu hình Supabase mới, tránh xung đột.

## 3. Giới hạn thực tế của KiotViet API (đã xác nhận — dùng số này để thiết kế, không cần đo thử lại)

| Hạng mục | Giới hạn | Ghi chú áp dụng |
|---|---|---|
| Rate limit GET chính thức | **5.000 request / giờ / gian hàng (retailer)** | Mỗi cơ sở (Hà Nội, Sài Gòn) là 1 gian hàng riêng → **2 quota độc lập, không chia sẻ, không tranh chấp nhau**. |
| Throttling burst thực tế | Nên giữ **dưới ~10 request/giây (~600 request/phút)** | Vượt ngưỡng giờ hoặc burst đều trả `429 Too Many Requests` → bắt buộc có cơ chế retry kiểu Exponential Backoff (client `kiotVietApiClient.js` đã có sẵn cơ chế này). |
| `pageSize` | Mặc định 20, **tối đa 100** | Luôn truyền `pageSize=100` để giảm số lượt gọi. |
| Phân trang | Tham số `currentItem` (một số module gọi là `pageIndex`) | Kết hợp lọc `lastModifiedFrom` để không quét lại dữ liệu cũ mỗi lần đồng bộ tăng dần. |
| Thời hạn access token | `expires_in: 86400` giây (24 giờ) theo tài liệu chính thức | Phải cache token dùng lại trong 24h, **không gọi `/connect/token` trước mỗi request nghiệp vụ** (endpoint này cũng bị giới hạn riêng). Lưu ý: lần dò thực tế trước đây (8/2026) đo được ~3600s cho token — client hiện tại đã đọc `expires_in` động từ response nên tự thích ứng đúng dù con số thực tế là bao nhiêu, không cần sửa code. |
| Webhook | **Có hỗ trợ** — đẩy sự kiện real-time khi tạo/sửa đơn hàng, hàng hóa, tồn kho | Endpoint nhận phải trả `HTTP 200` nhanh (KiotViet timeout ngắn, ít retry nếu phía nhận lỗi). Cả 2 tài khoản KiotViet (Hà Nội, Sài Gòn) **đều đang dùng gói cao nhất** — chắc chắn có quyền dùng Webhook, không có rủi ro bị chặn tính năng theo gói. |

## 4. Yêu cầu "cập nhật thời gian thực" — cách tiếp cận (đã chốt)

Với việc **Webhook được xác nhận hỗ trợ**, thiết kế chính thức là **kết hợp 2 cơ chế**, không chỉ polling đơn thuần:

- **Webhook làm nguồn chính cho tốc độ:** đăng ký nhận sự kiện hóa đơn/đơn hàng/tồn kho từ cả 2 gian hàng KiotViet (Hà Nội, Sài Gòn — mỗi gian hàng đăng ký webhook riêng, trỏ về cùng 1 endpoint của server, phân biệt bằng thông tin gian hàng trong payload). Khi có sự kiện, ghi ngay vào Postgres → đạt độ trễ thấp nhất có thể, gần đúng nghĩa "thời gian thực".
- **Polling làm lớp dự phòng/đối soát (reconciliation), không phải nguồn chính:** vì đã có Webhook lo phần "nhanh", polling định kỳ có thể giãn ra nhiều — đề xuất **mỗi 5-10 phút** cho hóa đơn/đơn hàng (đề phòng webhook bị rớt/lỗi mạng), và **mỗi 15-30 phút** cho nhóm dữ liệu ít biến động (sản phẩm, khách hàng, nhà cung cấp, nhóm hàng, trả hàng, nhập hàng, thu chi). Với các mốc này, tổng số request/giờ nằm rất xa dưới ngưỡng 5.000/giờ/gian hàng, an toàn cho cả 2 cơ sở.
- **Vì sao không polling-only nữa:** với rate limit 5.000/giờ, polling mỗi 30-60 giây như đề xuất ban đầu vẫn khả thi về mặt số lượng request, nhưng Webhook cho độ trễ thấp hơn nhiều (giây, thay vì nửa phút) và tốn ít tài nguyên hơn — nên chọn Webhook làm chính, polling làm lưới an toàn.

## 5. Các giai đoạn (phases)

### Giai đoạn 0 — Dọn dẹp & chuẩn bị hạ tầng
- Dọn cấu hình Postgres cũ (chết) trong `server/config.js`/`server/.env.example`.
- Thêm cấu hình Supabase mới (`SUPABASE_DB_URL`, `PGSSL`, cờ bật/tắt `KIOTVIET_SYNC_ENABLED` mặc định TẮT).
- Tạo project Supabase (gói free), lấy connection string dạng "Direct connection" (cổng 5432, không dùng pooler 6543 — vì đây là 1 tiến trình server chạy liên tục, không phải serverless).
- Xác nhận đủ thông tin đăng nhập API KiotViet cho **cả 2 cơ sở** (Hà Nội đã có sẵn trong `apphosting.yaml`; Sài Gòn hiện chỉ có trong code kiểm tra đứt hàng, chưa khai báo secret production — cần bổ sung).
- Đăng ký Webhook trên KiotViet cho **cả 2 gian hàng** (Hà Nội, Sài Gòn), trỏ về 1 endpoint chung của server (endpoint này cần public HTTPS — trên Firebase App Hosting đã có sẵn domain public nên không phát sinh thêm hạ tầng).

### Giai đoạn 1 — Thiết kế & tạo schema dữ liệu
- Thiết kế bảng cho từng loại dữ liệu: nhóm hàng, sản phẩm, khách hàng, nhà cung cấp, hóa đơn (+ chi tiết dòng, + thanh toán), đơn hàng (+ chi tiết dòng), trả hàng (+ chi tiết dòng — thiếu ở lần trước, bổ sung lần này), nhập hàng (+ chi tiết dòng), thu chi, nhân viên (suy luận từ các bảng khác), và 1 bảng "checkpoint" theo dõi tiến độ đồng bộ của từng loại dữ liệu × từng cơ sở.
- Nguyên tắc quan trọng: khóa chính mọi bảng là cặp **(cơ sở, id)**, không dùng id đơn lẻ — vì Hà Nội/Sài Gòn là 2 tài khoản KiotViet riêng, id có thể trùng nhau.
- Cột tiền dùng kiểu số thập phân chính xác (không dùng số thực dấu phẩy động, tránh sai số).
- Viết migration SQL (thủ công, không dùng framework ORM) để tạo toàn bộ schema trên.

### Giai đoạn 2 — Xây dựng engine đồng bộ (Webhook + Polling đối soát)
- Dùng lại nguyên bản client gọi API KiotViet đã có sẵn trong dự án (`server/kiotviet/kiotVietApiClient.js`) — không viết lại. Bổ sung cache access token đúng theo `expires_in` KiotViet trả về (đã có sẵn trong client), tuyệt đối không gọi `/connect/token` trước mỗi request nghiệp vụ.
- **Endpoint nhận Webhook** (mới, quan trọng nhất cho mục tiêu "thời gian thực"): 1 route nhận POST từ KiotViet, xác định gian hàng/cơ sở nào gửi tới, trả `HTTP 200` ngay lập tức (trước khi xử lý xong, để tránh timeout phía KiotViet), rồi xử lý ghi dữ liệu vào Postgres ở hàng đợi nền (không chặn response).
- Xây "driver" đồng bộ dùng chung cho mọi loại dữ liệu: đọc checkpoint → gọi API (khi polling) hoặc nhận payload (khi qua webhook) → ghi dữ liệu vào Postgres → cập nhật checkpoint (chỉ tiến lên khi ghi thành công, để khi mất kết nối/khởi động lại thì tự đồng bộ đúng phần bị thiếu, không mất và không trùng dữ liệu).
- Viết module đồng bộ riêng cho từng loại dữ liệu, áp dụng đúng tham số đã dò thực tế trước đây (ví dụ: hóa đơn/đơn hàng/khách hàng dùng `lastModifiedFrom`; thu chi phải dùng `startDate`/`endDate` và gọi 2 lần cho thu/chi riêng; đơn hàng và trả hàng không có tham số chặn trên nên khi đồng bộ dữ liệu lịch sử phải chạy 1 lượt trọn vẹn thay vì chia nhỏ theo tháng). Luôn dùng `pageSize=100` (mức tối đa) để giảm số lượt gọi.
- Bộ lập lịch chạy **polling đối soát** tự động cho **cả 2 cơ sở song song, độc lập**, theo nhịp giãn (5-10 phút cho hóa đơn/đơn hàng, 15-30 phút cho nhóm còn lại) đã nêu ở mục 4 — vai trò là lưới an toàn, không phải nguồn chính.
- Toàn bộ engine này (cả webhook lẫn polling) **mặc định tắt**, chỉ bật bằng 1 cờ cấu hình — không ảnh hưởng gì đến Dashboard Sheets đang chạy cho tới khi chủ động bật.

### Giai đoạn 3 — Đồng bộ dữ liệu lịch sử (backfill)
- Sau khi engine chạy ổn với dữ liệu mới phát sinh, chạy thêm 1 lượt "backfill" để kéo dữ liệu lịch sử (ví dụ từ đầu năm) vào Postgres, cho cả 2 cơ sở.
- Đối chiếu số lượng bản ghi với số liệu đã biết trên KiotViet (tổng số hóa đơn/đơn hàng...) để xác nhận không bị thiếu/lặp.

### Giai đoạn 4 — Kiểm thử & xác minh
- Viết test tự động cho phần logic quan trọng (tính checkpoint, xử lý khi lỗi giữa chừng, xử lý riêng cho thu chi/đơn hàng/trả hàng) — không cần kết nối Postgres thật.
- 1 bộ test tích hợp (tùy chọn, tự bỏ qua nếu chưa cấu hình) chạy thật trên Supabase để xác nhận schema và câu lệnh ghi dữ liệu đúng.
- Thêm 1 API nội bộ (chỉ dùng để tự kiểm tra thủ công, có đăng nhập, không phải tính năng cho người dùng cuối) để xem tình trạng đồng bộ: checkpoint gần nhất, số bản ghi mỗi loại, vài dòng dữ liệu mẫu — dùng để đối chiếu thủ công với giao diện KiotViet.
- Xác nhận Dashboard Sheets hiện tại **vẫn hoạt động bình thường, không bị ảnh hưởng** trong suốt quá trình này.

### Giai đoạn 5 (tương lai, ngoài phạm vi roadmap này)
- Chuyển các trang Dashboard/báo cáo sang đọc dữ liệu từ Postgres thay vì Google Sheets.
- Chuyển hosting ứng dụng từ Firebase App Hosting sang Render (gói $25/tháng).
- Cân nhắc dùng API `/users` thật của KiotViet để có danh sách nhân viên đầy đủ hơn (hiện chỉ suy luận từ dữ liệu khác).

## 6. Những gì roadmap này KHÔNG bao gồm

- Không sửa Dashboard hiện tại (`dashboardData.js`, `debtReport.js`, `exportService.js`) — vẫn đọc Google Sheets như cũ.
- Không đụng đến Apps Script đồng bộ Sheets (`src-dashboard/`).
- Không làm việc chuyển hosting sang Render trong roadmap này.
- Không giải mã mã trạng thái số của KiotViet thành nhãn tiếng Việt (dữ liệu gốc đã biết là không nhất quán giữa 2 nguồn tài liệu cũ, giữ nguyên số thô cho an toàn).

## 7. Rủi ro & điều cần xác minh trước khi code

- **Webhook có thể bị rớt/trễ:** đây là lý do bắt buộc phải giữ polling đối soát song song, không tắt hẳn polling dù webhook là nguồn chính — nếu webhook lỗi mạng/timeout, polling định kỳ vẫn tự bắt kịp qua checkpoint `lastModifiedFrom`.
- **Endpoint webhook phải phản hồi rất nhanh (`HTTP 200`):** KiotViet timeout ngắn và ít retry — thiết kế phải tách "nhận + trả 200 ngay" ra khỏi "xử lý ghi Postgres" (xử lý nền/queue), không được xử lý đồng bộ trong cùng request.
- **Gói Supabase free có giới hạn:** 500MB dung lượng, project tự tạm ngưng sau ~1 tuần không hoạt động (không đáng lo vì có sync engine chạy thường xuyên), giới hạn số kết nối đồng thời — thiết kế dùng pool nhỏ (tối đa 5 kết nối) để an toàn.
- **Access token 24h nhưng cần theo dõi thực tế:** tài liệu chính thức ghi 86.400 giây, lần dò trước đây (8/2026) lại đo được ~3.600 giây trên tài khoản thật — client đã tự đọc `expires_in` động nên không cần sửa code, nhưng khi triển khai nên log lại giá trị thực tế nhận được để xác nhận không có bất ngờ.
- **Dữ liệu Sài Gòn:** thông tin đăng nhập API KiotViet của Sài Gòn hiện chưa được khai báo đầy đủ trong cấu hình production (`apphosting.yaml`) — cần bổ sung trước khi đồng bộ Sài Gòn (cả webhook lẫn polling) hoạt động được trên môi trường thật. Vì 2 cơ sở là 2 gian hàng riêng, cần đăng ký Webhook riêng cho từng gian hàng trên KiotViet.

## 8. Bước tiếp theo

Sau khi thống nhất roadmap này, bước kế tiếp là lập **kế hoạch triển khai chi tiết theo từng task (TDD, có code mẫu cụ thể)** cho Giai đoạn 0-4 (bao gồm cả endpoint Webhook), để bắt đầu code thật.
