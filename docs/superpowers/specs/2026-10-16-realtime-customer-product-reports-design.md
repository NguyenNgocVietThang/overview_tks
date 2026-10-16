# Báo cáo doanh thu khách (90 ngày) + Báo cáo hàng hóa cận thời gian thực

Ngày: 2026-10-16 · Trạng thái: **kế hoạch, chưa sửa mã** · Đo trên DB thật bằng giao dịch `READ ONLY` + `ROLLBACK` (không ghi gì).

## 1. Ý định đã chốt

- **Mục tiêu:** hóa đơn, trả hàng, tồn kho và "Hàng dự kiến" (6 sheet CONT) xuất hiện ở hai báo cáo trong tối đa ~10 phút. Hiện doanh số/tồn chốt 1 lần mỗi đêm, Hàng dự kiến 2 giờ/lần.
- **Cửa sổ 90 ngày gồm hôm nay**, kèm nhãn "cập nhật lúc HH:mm".
- **Ràng buộc:** không tái diễn sự cố Disk IO 28/09 (mọi lượt làm mới chỉ ghi dòng thật sự đổi), tận dụng rollup "nóng" 7 ngày + sync tồn đã có, không bắt app server đọc thêm bảng lớn.
- **Ngoài phạm vi:** cập nhật từng giây qua webhook, đổi giao diện ngoài nhãn thời điểm, sửa tab khác, áp migration/deploy production.

## 2. Số đo trên DB thật (2026-10-16)

| Hạng mục | Hiện tại | Phát hiện |
|---|---|---|
| Sync nguồn | invoices/orders/tồn: 1–10 s trước lúc đo | Nguồn đã gần real-time, **chỉ hai báo cáo bị chốt đêm** |
| Dựng `customer_invoice_lines_90d` (hóa đơn, 90 ngày) | 2,8 s, 394K buffer hit | OK cho 1 lần/đêm |
| Cùng truy vấn nhưng cửa sổ **7 ngày** | **41 s** (6.005 dòng) | Bẫy: planner chọn *Merge Left Join* theo `branch` rồi lọc bằng biểu thức `normalize/regexp` trên ~7.300 tên khách cho từng hóa đơn. Thu hẹp cửa sổ làm **chậm hơn 15 lần** |
| Phần phiếu trả (90 ngày, 1.294 dòng) | **26 s** | Cùng nguyên nhân, đang chạy mỗi đêm |
| Cả hai với `SET LOCAL enable_mergejoin = off` | 7 ngày 0,68 s · trả hàng 90 ngày **0,19 s** · 90 ngày hóa đơn 3,1 s | Sửa gọn, không đổi kết quả |
| Hóa đơn chọn theo `modified_date` (có index) | 1 giờ 0,15 s · 1 ngày 0,25 s · 7 ngày 0,67 s (161 hóa đơn) | Cách chọn tập thay đổi tốt nhất |
| Sửa hóa đơn cũ hơn 7 ngày | 70 trong 7 ngày gần nhất; 662 trong 30 ngày | Cửa sổ theo ngày bán **bỏ sót** sửa muộn → phải chọn theo `modified_date` |
| `product_report` toàn bộ (SELECT) | 4,2–4,5 s, 336K hit, **13–15K block đọc đĩa** (~110 MB) | Chạy mỗi 7 phút = ~22 GB đọc/ngày, tệ hơn cả sự cố cũ → không được chạy nguyên khối |
| Trong đó `pending_orders` | 0,75–0,86 s, **13,5K block đọc đĩa** | Điều kiện `COALESCE(raw->>'statusValue','')='Phiếu tạm'` **không khớp** index riêng `idx_orders_phieu_tam`. Viết `(raw->>'statusValue')='Phiếu tạm'` → **37 ms, 0 đọc đĩa** |
| Trong đó tồn HN/SG | 68 ms + 20 ms | Rẻ |
| Trong đó `customer_agg` (khách lớn nhất, đếm khách) | ~2,7 s, 260K hit, 169 đọc đĩa | Chỉ tốn CPU; chấp nhận được nếu bỏ qua khi không có hóa đơn đổi |
| Rollup nóng 7 ngày `daily_product_sales` | 25 ms/cơ sở | Đã chạy sau mỗi lượt sync, đã gồm hôm nay |
| Ghi hiện tại của `product_report` | `TRUNCATE` + nạp lại 10,9K + 36,5K dòng | `TRUNCATE` khóa `ACCESS EXCLUSIVE` (chặn đọc) và sinh WAL cỡ vài chục MB nếu chạy mỗi 7 phút |
| Hàng dự kiến | `DELETE` hết + `INSERT` 11.618 dòng mỗi lần, `version` = UUID mới **mỗi lần** | Chạy 10 phút ⇒ mọi người xem tải lại cả báo cáo 10 phút/lần (client so `version`) |
| Client | `/api/product-report/containers/meta` được poll 60 s; đổi `version` ⇒ `SELECT *` 10,9K dòng | `/api/product-report` **không có cache máy chủ** |

## 3. Thiết kế

Một chuỗi duy nhất chạy ngay sau lượt sync fast + rollup nóng (`scheduler.js: runFastGroupAndRollup`), tuần tự, mỗi bước bọc `try/catch` riêng để lỗi không làm hỏng sync:

`sync fast → rollup nóng 7 ngày (có sẵn) → customer lines tăng dần → product report tăng dần → SSE 'updated'`

Hàng dự kiến chạy timer riêng 10 phút (nguồn là Google Sheets, không gắn với KiotViet).

### A. Doanh thu theo khách (`customer_invoice_lines_90d`)
1. Không đổi bảng/đọc: `customerInvoiceLinesRepository` giữ nguyên (đọc 1 khách ~70 ms).
2. Lượt tăng dần: lấy hóa đơn/phiếu trả có `modified_date >= computed_at - 30 phút` (dùng `idx_invoices_modified`/`idx_returns_modified`), dựng lại dòng của đúng các chứng từ đó vào bảng tạm, rồi `DELETE` dòng đã đổi/mất + `INSERT` dòng mới (cùng mẫu `DELETE_STALE_SQL`/`INSERT_MISSING_SQL`, nhưng giới hạn theo `(branch, invoice_id)` thay đổi). Hóa đơn bị hủy tự biến mất vì không còn thỏa `Hoàn thành`.
3. Cửa sổ trượt: `end = hôm nay`, `start = end - 89`; mỗi lượt xóa dòng `sold_date < start`. `computed_at` = lần kiểm tra gần nhất. Nếu `computed_at` cũ hơn 7 ngày ⇒ dựng lại toàn bộ (hàm hiện có).
4. Giữ lượt dựng đầy đủ lúc ≥00:10 mỗi đêm làm **chốt đối soát** (bắt đổi tên/đổi mã khách vì mã khách khớp theo tên chuẩn hóa).
5. Cả hai lượt (đầy đủ + tăng dần) thêm `SET LOCAL enable_mergejoin = off` và `statement_timeout`. Hưởng lợi ngay: lượt đêm phần trả hàng 26 s → 0,2 s.
6. UI: `#cpWindowHint` đổi thành "90 ngày đến hôm nay, cập nhật lúc HH:mm"; khi có sự kiện SSE và đang hiển thị 1 khách thì tải lại đúng báo cáo đó (1 truy vấn ~70 ms).

### B. Báo cáo hàng hóa (`product_report`, `product_report_customers`)
1. Thay `TRUNCATE + INSERT` bằng bảng tạm + ghi khác biệt: `INSERT … LEFT JOIN … IS DISTINCT FROM`, `UPDATE` dòng đổi, `DELETE` dòng mất (đúng mẫu đã rút ra ở sự cố IO). Không `TRUNCATE` nữa ⇒ không khóa đọc.
2. Sửa nguồn: `pending_orders` dùng điều kiện khớp `idx_orders_phieu_tam`; doanh số 30/90 ngày và `sales90_lines` gồm hôm nay (`≤ hôm nay`).
3. Bỏ qua khâu nặng `customer_agg` khi chưa có hóa đơn/phiếu trả đổi từ lần trước và vẫn cùng ngày (kiểm bằng `max(modified_date)` có index). Lượt đêm vẫn tính đầy đủ.
4. Bảng trạng thái 1 dòng `product_report_state(id, computed_at, version)` (migration 0054): `computed_at` cập nhật mỗi lượt, `version` chỉ tăng khi có dòng đổi. `computed_at` từng dòng chỉ còn là "lần đổi gần nhất".
5. Giai đoạn 2 (chỉ nếu đo thấy cần): rollup `daily_product_customer_sales` nóng 7 ngày để `customer_agg` không còn quét `invoice_details`.

### C. Hàng dự kiến (CONT)
1. `INTERVAL_MS` 2 giờ → 10 phút (đặt qua env), ngưỡng "stale" = 3 × chu kỳ.
2. Ghi khác biệt: bảng tạm `jsonb_populate_recordset` → xóa dòng mất/đổi, chèn dòng mới; cập nhật `last_success_at` mỗi lượt nhưng **`version` chỉ đổi khi nội dung đổi** (băm nội dung đã chuẩn hóa, gồm `warnings`).
3. Chốt an toàn: nếu số dòng giảm >30% so với lần trước (sheet đang sửa dở/bị xóa nhầm) thì giữ bản cũ, ghi cảnh báo, chỉ chấp nhận khi 2 lượt liên tiếp cho cùng kết quả.
4. Google Sheets API: 13 lệnh gọi/10 phút/instance, xa mức 60 lệnh/phút/người dùng. Giữ khóa advisory + cổng `last_attempt_at` đã có.

### D. Phía đọc và Egress
1. `/api/product-report/containers/meta` trả thêm `reportVersion` (= `product_report_state.version` + `container.version`); client chỉ tải lại bảng khi `reportVersion` đổi (cơ chế poll 60 s có sẵn). Ban đêm không có thay đổi ⇒ 0 lần tải lại.
2. Cache trong bộ nhớ ở `getProductReport` theo `reportVersion`: nhiều người xem chỉ tốn **1 lần đọc DB mỗi phiên bản** (~2 MB: 10,9K dòng + tổng CONT + hàng vận chuyển). Hàng đang vận chuyển (đọc lúc xem) lấy qua TTL ngắn.
3. Ước lượng trần Egress DB→app: ~2 MB × số phiên bản/ngày (≤ ~200, thực tế thấp hơn nhiều vì có đêm/giờ nghỉ) ≈ ≤0,4 GB/ngày, **không phụ thuộc số người xem**. Báo cáo theo khách không đổi mô hình đọc (đã đọc 1 khách/lần).

## 4. Đánh giá rủi ro

| # | Rủi ro | Mức | Bằng chứng | Giảm thiểu | Chỉ số theo dõi / ngưỡng |
|---|---|---|---|---|---|
| R1 | Ghi quá nhiều ⇒ lặp lại sự cố IO (WAL, dirty page, autovacuum) | Cao | sự cố 28/09; `product_report` hiện TRUNCATE+nạp | Mọi bước ghi khác biệt; 3 bảng + CONT không còn xóa-nạp lại | `pg_stat_wal` và `n_tup_ins/upd/del` mỗi lượt: lượt nhàn rỗi ≈ 0 (chỉ dòng trạng thái); 10 hóa đơn đổi < 200 KB WAL |
| R2 | Planner chọn nhầm Merge Join ⇒ 40 s | Cao | đo 41 s / 26 s | `enable_mergejoin=off` cục bộ giao dịch + `statement_timeout` 30 s + log thời lượng | Thời lượng lượt > 5 s ⇒ cảnh báo log |
| R3 | Thiếu kết nối (pool tối đa 7) khi chuỗi mới chồng sync/rollup/request | Trung bình | ghi chú `pool.js` (EMAXCONNSESSION 28/09) | Chạy tuần tự trong 1 chuỗi, mỗi bước 1 kết nối, giải phóng ngay; dùng chung khóa tuần tự với rollup | chờ kết nối của pool, lỗi `EMAXCONNSESSION` |
| R4 | Deadlock/khóa giữa lượt đêm đầy đủ, lượt tăng dần, rollup nóng, request | Trung bình | rollup từng deadlock (ghi chú `runRollupExclusive`) | Bỏ TRUNCATE; lượt đầy đủ và tăng dần cùng khóa advisory/ chuỗi; mỗi lượt 1 giao dịch ngắn | lỗi `40P01`, thời gian chờ khóa |
| R5 | Tăng dần bỏ sót thay đổi ⇒ lệch số | Cao | 662 hóa đơn sửa muộn / 30 ngày | Chọn theo `modified_date` (không theo ngày bán), chồng 30 phút, `computed_at` cũ >7 ngày ⇒ dựng lại, lượt đêm đối soát | Job đối soát hằng đêm ghi log số dòng khác biệt (kỳ vọng 0); test so tăng dần với dựng đầy đủ |
| R6 | Đổi tên/gộp/đổi mã khách không đi qua `modified_date` hóa đơn | Thấp | mã khách khớp theo tên chuẩn hóa | Chấp nhận trễ tới 00:10; ghi rõ trong tài liệu | số dòng sửa bởi lượt đêm |
| R7 | Số hôm nay dở dang bị đọc nhầm là cả ngày | Thấp | cửa sổ gồm hôm nay | Nhãn "cập nhật lúc HH:mm" | — |
| R8 | Hai báo cáo lệch nhau (hóa đơn "Hoàn thành" vs `≠ Đã hủy`) | Thấp | khác biệt sẵn có (xem `productReportRefresh.js`) | Giữ nguyên định nghĩa, ghi rõ; cùng cửa sổ có hôm nay | — |
| R9 | Egress tăng do client tải lại 10,9K dòng | Cao | không có cache, `version` CONT đổi mỗi lượt | `reportVersion` ổn định (chỉ đổi khi dữ liệu đổi) + cache máy chủ theo phiên bản | KB DB→app mỗi ngày (dashboard Supabase), số lần `SELECT * FROM product_report` |
| R10 | Sheet CONT sửa dở / xóa nhầm ⇒ báo cáo sai ngay | Trung bình | 10 phút bắt kịp mọi thao tác trên sheet | Chốt an toàn giảm >30% + đồng thuận 2 lượt; giữ bản thành công gần nhất khi lỗi (đã có) | cờ `warnings`, `last_error` |
| R11 | Quota Google Sheets / chậm | Thấp | 13 lệnh/10 phút | giữ cổng `last_attempt_at` + khóa advisory | `last_error` |
| R12 | Triển khai sai thứ tự (code trước migration) | Trung bình | tiền lệ 0022/0023/0053 | Code chịu `42P01` và rơi về luồng chốt đêm; cờ `REPORTS_INCREMENTAL_ENABLED` mặc định tắt | — |
| R13 | `.env` local trỏ DB production | Cao | ghi chú sự cố | Chỉ thử trong giao dịch `ROLLBACK`; không bật sync local; kiểm thử ghi dùng PGlite/DB test | — |
| R14 | Working tree đang có thay đổi dở của phiên khác (`dashboardData.js`, `index.html`, `routes.js`…) cùng file sẽ sửa | Trung bình | `git status` | Làm trên nhánh/worktree riêng, commit từng giai đoạn nhỏ | — |

**Đường lùi:** tắt cờ `REPORTS_INCREMENTAL_ENABLED` ⇒ trở về chốt 1 lần/đêm (lượt đêm vẫn nguyên); các bước ghi khác biệt tương thích ngược với dữ liệu hiện có nên không cần xóa bảng.

## 5. Lộ trình

0. **Sửa không đổi hành vi** (rủi ro thấp, có lợi ngay): `enable_mergejoin=off` ở lượt đêm customer lines; điều kiện `pending_orders` khớp index; CONT chỉ đổi `version` khi nội dung đổi.
1. **CONT 10 phút** (ghi khác biệt + chốt an toàn). Độc lập, nhỏ nhất.
2. **Customer lines tăng dần + gồm hôm nay + nhãn UI + SSE tải lại.**
3. **Product report ghi khác biệt + tăng dần + migration 0054 + `reportVersion` + cache máy chủ + gồm hôm nay.**
4. **Quan sát 48 giờ** với cờ bật ở production: kiểm các ngưỡng ở mục 4; chỉ khi đạt mới coi là xong. Giai đoạn 2 của mục B.5 chỉ làm nếu CPU/thời lượng vượt ngưỡng.

Mỗi giai đoạn: test đơn vị + đối chiếu "tăng dần = dựng đầy đủ" trong giao dịch `ROLLBACK` trên dữ liệu thật (cách đã dùng ở đợt 0022: 132 báo cáo, 0 khác biệt), `npm test` xanh, cập nhật `README.md`, `server/README.md`, `server/db/SCHEMA.md`, `CURRENT.md`, BRD/SRS theo `update-file`, rồi `graphify update .`.

## 6. Cần bạn duyệt trước khi làm

1. Cho phép **migration 0054** (`product_report_state`, 1 dòng).
2. Ngưỡng chốt an toàn CONT: giảm >30% dòng thì giữ bản cũ — đồng ý hay đổi?
3. Làm tuần tự theo giai đoạn 0 → 3 và bật cờ ở production sau khi đã quan sát — đồng ý?
