# Kế hoạch: Xuất Excel kèm biểu đồ native (có thể chỉnh sửa trong Excel)

- Ngày lập: 2026-09-25 · Trạng thái: **KẾ HOẠCH — chưa sửa code**
- Phạm vi: `POST /api/export` (Báo cáo tổng hợp, tìm kiếm, báo cáo khách–hàng, báo cáo hàng hóa, đứt hàng).
- Không thuộc phạm vi: xuất Excel HR (`server/hr/hrLeaveExportService.js`), dùng chung `excelTableStyle.js` nhưng không đổi.

> Ghi chú: working tree hiện có thay đổi chưa commit ở `exportService.js` (`customerRevenueRows` dùng `topRevenue.all || top50`) và `index.html`. Kế hoạch này giả định các thay đổi đó được commit trước khi bắt đầu Bước 1.

---

## 0. Tóm tắt khuyến nghị

| Hạng mục | Quyết định khuyến nghị |
|---|---|
| Engine ghi workbook | **Python 3.12 + XlsxWriter 3.2.x làm writer DUY NHẤT** cho file xuất khi bật cờ; Node vẫn làm toàn bộ nạp dữ liệu/lọc/phân quyền/định dạng logic. ExcelJS giữ làm đường **fallback** (không biểu đồ) khi cờ tắt hoặc engine Python lỗi khởi động. |
| Không làm | Không tạo bằng ExcelJS rồi mở/ghi lại bằng engine khác (spike ở §4.1 chứng minh ExcelJS **xóa** chart khi round-trip). Không vá OOXML thủ công làm phương án chính. Không ảnh, không Pivot. |
| Nguồn chart | Sheet **"Dữ liệu biểu đồ"** (hiển thị, đặt cuối) do Node tổng hợp từ dataset **đầy đủ cột, đã lọc + đã tìm kiếm**, độc lập với cột người dùng chọn. |
| Deployment | Render chuyển sang **Docker** (`node:22-bookworm-slim` + `python3` + `xlsxwriter` pin phiên bản). Repo hiện **không có** `render.yaml`/`Dockerfile`/`requirements.txt`; Render đang chạy native Node runtime (`server/package.json` → `engines.node 22.x`, `start: node --max-old-space-size=512 index.js`). |
| Rollout | Cờ `EXPORT_CHARTS_ENGINE=xlsxwriter|exceljs` (mặc định `exceljs` cho tới khi nghiệm thu), rollback = đổi biến môi trường, không cần deploy lại. |

---

## 1. Kiến trúc xuất Excel hiện tại

### 1.1 Luồng request

```
index.html  openExportDialog(tableKey)          (dòng ~6558)
  └─ buildExportPayload(tableKey)               (dòng 6367) → {tableKey, filters, context, tableSearch?, search?}
  └─ POST /api/export/fields  (timeout 30s)     → getExportFields()  — KHÔNG I/O với bảng cố định (rowCount=null)
  └─ renderExportFields() → checkbox data-export-sheet/value
  └─ downloadExportFile() → payload.columns = {worksheetKey: [colKey...]}
     POST /api/export (timeout 180s, AbortController, token chống phản hồi trễ)

server/routes.js
  router.use('/api/export', requireAuth, requireFeature('reports.export'), resolveBranch)   (dòng 102)
  POST /api/export/fields  (dòng 351) → getExportFields(body, req.branch)
  POST /api/export         (dòng 360) → AbortController gắn res.on('close') → createExportWorkbook(body, req.branch, {signal})
                                       → res.send(file.buffer) + Content-Disposition
  sendExportError() → buildExportErrorBody() (chỉ trả detail với code EXPORT_* / INVALID_BRANCH)

server/dashboard/exportService.js  createExportWorkbook() (dòng 1309)
  1. describeExport()      — validate tableKey (TABLE_TITLES), normalizeFilters(), getTableSpec(); stockout dựng dataset luôn từ payload
  2. resolveSelection()    — validate payload.columns theo worksheet (TRƯỚC khi xin slot, không chạm DB)
  3. acquireExportSlot(signal) — semaphore EXPORT_MAX_CONCURRENT=2, EXPORT_MAX_QUEUED=8, tràn → 503 EXPORT_BUSY
  4. buildExportDataset()  — rẽ nhánh:
       search.results               → buildSearchDataset() (dashboardData.searchDashboardRecords / searchTopCustomersByProducts)
       stockout.*                   → description.dataset (từ payload.recent/90d/30dResult)
       customers.product*           → buildCustomerProductRevenueDataset() (getCustomerProductRevenueReport + filterTableItems)
       overview.productReport       → buildProductReportDataset() (productReportRepository.getProductReport + applyTableSearchToDataset)
       còn lại                      → dashboardData.getDashboardData(filters, branch) → buildFixedDataset()
                                        spec.loadRows(env, activeFor) → loadSourceRowsForItems() → dashboardPgReader.readRowsByCodes()
                                        → applyTableSearchToWorksheets() → projectWorksheetRows() (khi tìm kiếm)
  5. ExcelJS: addWorksheet(safeWorksheetName) → addRow(toExcelValue) → styleWorksheet() → writeBuffer()
  6. fileName = `${branchFilePrefix(sourceBranch||branch)}_${fileSlug(title)}_${fileTimestamp()}.xlsx`
  7. finally release()
```

### 1.2 Điểm then chốt ảnh hưởng thiết kế chart

1. **Chọn cột cắt dữ liệu sớm.** `buildFixedDataset()` gọi `activeColumns(worksheet, selection, searching)`: khi **không** tìm kiếm, `loadRows` chỉ dựng các cột đã chọn (`buildLogicalRows`/`pickAggregateRows`). Nếu người dùng bỏ cột "Doanh thu" (`d_sales_revenue`) thì dòng dataset **không còn** giá trị đó → chart không thể dựng từ dataset sau chọn cột. Khi có tìm kiếm thì đã nạp đủ cột rồi mới `projectWorksheetRows()`.
   - `readRowsByCodes()` (`dashboardPgReader.js:645`) luôn SELECT đủ `tab.columns` rồi mới chiếu → nạp đủ cột **không tăng truy vấn DB**, chỉ tăng object JS.
2. **Tìm kiếm trên bảng lọc theo dòng worksheet** (`filterWorksheetRows` dùng `filterTableItems` của `public/js/table-explorer.js`), với nhập hàng thì chi tiết đi theo phiếu tổng hợp (`applyTableSearchToWorksheets`). ⇒ Nguồn chart phải lấy **sau** bước này.
3. **"Cả hai" cơ sở**: bảng giao dịch thêm cột `d_branch`, ghép theo `compositeKey(branch, code)`; bảng thực thể gộp theo `mergeEntitySourceRows()`; công nợ tách dòng theo cơ sở; stockout thêm cột `branch` theo `result.branch`.
4. **Định dạng** (`styleWorksheet`, `excelTableStyle.js`): freeze 1 dòng + tắt gridline, AutoFilter toàn bảng, header cao 24 / đậm đen / căn giữa / wrap, viền mỏng `FFB8C4CE` mọi ô, độ rộng cột 12–42 theo 100 dòng đầu, `#,##0;[Red]-#,##0` hoặc `#,##0.00;…` (theo `columnHasFraction`), `0.00%`, `dd/mm/yyyy hh:mm:ss`, căn top + wrap theo `column.wrapText`.
5. **An toàn giá trị** (`toExcelValue`): text bắt đầu `= + - @` được tiền tố `'` (`neutralizeFormulaText`), mã giữ 0 đầu (type `text`), ngày parse `dd/mm/yyyy[ hh:mm[:ss]]` hoặc ISO → `Date.UTC`.
6. **Hủy**: `throwIfAborted` sau từng bước; `readRowsByCodes` kiểm tra signal giữa các lô; `writeBuffer()` **không hủy được** (chạy tới hết).

### 1.3 Bằng chứng giới hạn ExcelJS 4.4.0

- `server/node_modules/exceljs/lib`: không có xform nào cho `c:chart`; `drawing-xform` chỉ phục vụ ảnh; `workbook-xform.js:174-177` ghi rõ *"we don't have the infrastructure to support chartsheets"*. README ExcelJS không có API chart.
- Spike round-trip (scratchpad, 2026-09-25): file tạo bằng XlsxWriter có `xl/charts/chart1.xml`, `xl/drawings/drawing1.xml` → `ExcelJS.load()` + `writeBuffer()` → **mất toàn bộ** phần chart/drawing. ⇒ Mọi thiết kế "ExcelJS ghi sau engine khác" hoặc "engine khác mở lại file ExcelJS rồi thêm chart" (openpyxl cũng không bảo toàn đầy đủ style/metadata) đều bị loại.

---

## 2. tableKey và worksheet hiện có

| tableKey | Worksheet key → tên sheet | Nguồn dòng | Cột chart cần (khóa dòng) |
|---|---|---|---|
| `overview.transactions` | `transactions` → Chi tiết giao dịch | `invoices.transactionsReport.transactions` + PG `invoices` (+`d_branch` khi Cả hai) | `ngay_ban`, `tong_tien_hang`, `trang_thai`, `khach_hang`, `d_branch` |
| `overview.purchases` | `purchase_summary` → Tổng hợp phiếu; `purchase_details` → Chi tiết mặt hàng | `newPurchases.orders` + PG `purchases` | summary: `thoi_gian`, `ten_nha_cung_cap`, `can_tra_ncc`/`tong_tien_hang`, `d_branch` |
| `overview.new-products` | `new_products` → Mã mới tạo | `products.newProducts.products` + PG `products` | `nhom_hang` |
| `products.top-selling` (productAnalysis=product) | `top_products` → Top sản phẩm | `products.topSellingProducts` | `ten_hang`, `ma_hang`, `d_sales_revenue`, `d_sold_qty` |
| `products.top-selling` (parentCategory) | `top_parent_categories` → Top nhóm cha | `products.topSellingParentCategories` | `name`, `revenue`, `qty` |
| `products.low-stock` | `low_stock` → Hàng đã hết | `lowStock` | — |
| `products.all` | `all_products` → Tất cả mã hàng | `allProducts` | `ten_hang`, `ma_hang`, `ton_kho` |
| `products.newly-imported` | `newly_imported` → Hàng mới nhập | `products.newlyImported.products` | `ten_hang`, `ma_hang`, `d_revenue` |
| `products.child-categories` | `child_categories` → Chi tiết nhóm con | `childCategorySalesByParent[parent]` | `name`, `revenue` |
| `invoices.orders` | `orders` → Đặt hàng | `invoices.periodOrders` | `ngay_dat`, `tong_tien`, `trang_thai`, `d_branch` |
| `invoices.returns` | `returns` → Trả hàng | `invoices.periodReturns` | `ngay_tra`, `tong_tien_tra`, `khach_hang`, `d_branch` |
| `customers.revenue` | `customer_revenue` → Doanh thu theo khách | `customers.topRevenue.all\|top50` | `ten_khach_hang`, `ma_khach_hang`, `d_period_revenue` |
| `customers.debt` | `customer_debt` → Khách còn nợ | `customers.topDebt` | `ten_khach_hang`, `ma_khach_hang`, `no_hien_tai` |
| `suppliers.list` | `suppliers` → Nhà cung cấp | `suppliers` | `ten_ncc`, `ma_ncc`, `no_can_tra` |
| `debt.management` | `debt_management` → Quản lý công nợ (tên có thể = `debt.sourceSheet`) | `debtManagementRows()` | `customerName`, `currentDebt`, `overdueDebt`, `sale`, `workflowStatus`, `branch` |
| `customers.productDetail` | `customer_product_detail` | `getCustomerProductRevenueReport` | `name`, `revenue` |
| `customers.productMonthlyCompare` | `customer_product_monthly_compare` | như trên | `name`, `month1Revenue..month3Revenue` |
| `overview.productReport` | `product_report` → Báo cáo hàng hóa | `productReportRepository.getProductReport` | `name`, `code`, `revenue90d`, `stockHanoi`, `stockSaigon` |
| `stockout.recentScan` | `recent_stockout_result` | `payload.recentStockoutResult` | `name`, `code`, `daysOutOfStock`, `branch` |
| `stockout.check90d` / `check30d` | `stockout_90d_result` / `stockout_30d_result` | `payload.stockout90d/30dResult` | `name`, `code`, `totalStockoutDays`, `stockoutCount` |
| `search.results` | `search_<source>` (động) / `customer_product_top` | `buildSearchDataset` | — (xem §3) |

Registry test hiện có: `exportService.test.js` "registry dung du 14 bang…" (dòng 204) dùng `__test__.TABLE_SPEC_KEYS`.

---

## 3. Ma trận tableKey → tổng hợp → loại chart → Top N → không tạo chart

Quy ước chung (áp cho mọi dòng):

- **Chỉ tổng hợp từ dataset cuối cùng** (sau cơ sở + thời gian + bộ lọc nghiệp vụ + tìm kiếm), trước khi chiếu cột.
- **Top N hạng mục** (bar ngang): N = 10 mặc định; sắp giảm dần theo chỉ tiêu; phần còn lại cộng vào **"Khác (k mục)"** chỉ khi chỉ tiêu **cộng được** (tổng tiền, số lượng, số ngày); nếu tổng số hạng mục ≤ N+1 thì hiển thị hết, không có "Khác". Chỉ tiêu không cộng được (trung bình, tỷ lệ) → chỉ Top N, không "Khác".
- **Doughnut** chỉ khi ≤ 6 lát sau gom (Top 5 + Khác) và mọi giá trị > 0; nếu không → chuyển sang bar.
- **Chuỗi thời gian**: khoảng ngày thực của dữ liệu ≤ 62 ngày → theo **ngày**; ≤ 26 tuần → theo **tuần** (nhãn "Tuần dd/mm"); còn lại → theo **tháng** ("MM/yyyy"). Trần 60 điểm; điền 0 cho bucket trống để trục liên tục. Múi giờ `Asia/Ho_Chi_Minh` (giống `fileTimestamp`).
- **Nhãn**: cắt 40 ký tự + "…"; trùng tên → "Tên (mã)". Cột "Tên đầy đủ" giữ trong sheet dữ liệu biểu đồ.
- **Giá trị âm/rỗng**: rỗng/không phải số → bỏ khỏi tổng; âm → **loại** khỏi chart "Top nợ"/"Top doanh thu" (ghi chú số mục bị loại dưới bảng nguồn), giữ nguyên trong chuỗi thời gian.
- **Không tạo chart** khi: 0 dòng, hoặc tổng chỉ tiêu = 0, hoặc < 2 hạng mục/điểm thời gian có giá trị. Khi bảng có spec chart nhưng không vẽ được → sheet "Biểu đồ" vẫn có, ghi dòng lý do (xem §13-Q3).
- **"Cả hai" cơ sở**: chuỗi thời gian và cột tổng dùng **2 series (Hà Nội, Sài Gòn)** dạng cột chồng (stacked) khi dòng có `d_branch`/`branch`; Top N gộp cả hai cơ sở.

| tableKey | Dữ liệu tổng hợp | Chart | Top N / Bucket | Không tạo chart khi |
|---|---|---|---|---|
| `overview.transactions` | (A) Σ`tong_tien_hang` theo bucket `ngay_ban`, **chỉ `trang_thai = 'Hoàn thành'`** (khớp `buildTransactionsReport.summary`); (B) Σ theo `khach_hang` | A: Column (stacked theo cơ sở khi Cả hai); B: Bar ngang | A: ngày/tuần/tháng; B: Top 10 + Khác | Không có hóa đơn Hoàn thành |
| `overview.purchases` | (A) Σ`can_tra_ncc` theo bucket `thoi_gian`; (B) Σ theo `ten_nha_cung_cap` (từ **Tổng hợp phiếu**, không từ chi tiết để không nhân đôi) | A: Column; B: Bar | Top 10 + Khác | 0 phiếu |
| `overview.new-products` | Đếm mã theo `nhom_hang` (rỗng → "Chưa phân nhóm") | Bar | Top 10 + Khác | < 2 nhóm |
| `products.top-selling` (product) | `d_sales_revenue` theo sản phẩm (danh sách đã là top, `TOP_SELLING_LIMIT`) | Bar | Top 10 (không "Khác" — danh sách vốn đã cắt) | 0 dòng |
| `products.top-selling` (parentCategory) | `revenue` theo nhóm cha | Bar + Doughnut tỷ trọng (nếu đủ điều kiện) | Top 10 + Khác / Top 5 + Khác | 0 dòng |
| `products.low-stock` | — | **Không chart** (mọi dòng tồn = 0, không có chỉ tiêu phân biệt) | — | luôn |
| `products.all` | `ton_kho` theo sản phẩm | Bar | Top 15 (không "Khác": "Khác" của hàng nghìn mã vô nghĩa) | 0 dòng / tổng tồn ≤ 0 |
| `products.newly-imported` | `d_revenue` theo sản phẩm | Bar | Top 10 | tổng doanh thu = 0 |
| `products.child-categories` | `revenue` theo nhóm con | Bar | Top 10 + Khác | 0 dòng |
| `invoices.orders` | (A) Σ`tong_tien` theo bucket `ngay_dat`; (B) Đếm đơn theo `trang_thai` | A: Column; B: Doughnut (≤6) / Bar | bucket / Top 5 + Khác | 0 đơn |
| `invoices.returns` | (A) Σ`tong_tien_tra` theo bucket `ngay_tra`; (B) Σ theo `khach_hang` | A: Column; B: Bar | Top 10 + Khác | 0 phiếu |
| `customers.revenue` | `d_period_revenue` theo khách | Bar | Top 10 + Khác | tổng = 0 |
| `customers.debt` | `no_hien_tai` > 0 theo khách | Bar | Top 10 + Khác | không khách nợ dương |
| `suppliers.list` | `no_can_tra` > 0 theo NCC | Bar | Top 10 + Khác | không NCC nợ dương |
| `debt.management` | (A) `currentDebt` & `overdueDebt` theo khách (dòng Cả hai cộng lại theo khách); (B) Σ`currentDebt` theo `sale`; (C) Đếm theo `workflowStatus` | A: Bar cụm 2 series; B: Bar; C: Doughnut/Bar | A: Top 10 (theo nợ hiện tại, không "Khác" vì 2 series); B: Top 10 + Khác; C: Top 5 + Khác | 0 dòng |
| `customers.productDetail` | `revenue` theo mặt hàng | Bar | Top 10 + Khác | 0 dòng |
| `customers.productMonthlyCompare` | 3 series: 2 tháng trước → tháng trước → tháng này, theo mặt hàng | Column cụm | Top 10 theo tổng 3 tháng | 0 dòng |
| `overview.productReport` | `revenue90d` theo sản phẩm | Bar | Top 10 (không "Khác") | tổng = 0 |
| `stockout.recentScan` | `daysOutOfStock` theo mã | Bar | Top 15 | 0 dòng |
| `stockout.check90d` / `check30d` | `totalStockoutDays` theo mã | Bar | Top 15 | 0 dòng |
| `search.results` (mọi mode) | — | **Không chart** giai đoạn 1: nhiều nguồn, cột động (`c0..cN`), `selectionMode: all-only` | — | luôn |

Chỉ tiêu tiền = VNĐ. "Doanh thu" hóa đơn: `tong_tien_hang` — **phải đối chiếu** với `invTotalIdx` trong `dashboardData.js:1371` ở Bước 2 (xem §13-Q5).

---

## 4. So sánh phương án kỹ thuật

### 4.1 Số đo spike (máy dev Windows, 2026-09-25, scratchpad — không nằm trong repo)

| Kịch bản 100.000 dòng × 20 cột | Thời gian | Bộ nhớ | Kích thước |
|---|---|---|---|
| ExcelJS 4.4.0 `writeBuffer()` (như hiện tại) | 8,4 s | **heap 686 MB** (vượt `--max-old-space-size=512` của `npm start`) | 12,3 MB |
| XlsxWriter 3.2.9 `constant_memory=True` + 1 bar chart | 5,8 s | **RSS peak 19 MB** (process Python) | 12,2 MB |
| ExcelJS load + write file có chart | — | — | chart/drawing **bị xóa** |

Ngoài ra đã xác nhận: XlsxWriter với `strings_to_formulas=False` ghi `=x0` dạng chuỗi (`inlineStr`), không thành công thức.

### 4.2 Bảng đánh giá

| Tiêu chí | PA1: ExcelJS + tự chèn OOXML chart (hậu xử lý zip bằng JSZip) | **PA2: Python + XlsxWriter (writer duy nhất)** | PA3: Thư viện thương mại Node (Aspose.Cells for Node.js via Java/C++, MESCIUS SpreadJS server-side, SheetJS Pro) |
|---|---|---|---|
| Tạo/chỉnh chart native | Được nhưng tự viết `chart*.xml`, `drawing*.xml`, rels, `[Content_Types].xml`, chèn `<drawing r:id>` đúng vị trí trong `sheetN.xml` (thứ tự phần tử CT_Worksheet bắt buộc) | Có, API chart đầy đủ (bar/column/line/pie/doughnut, stacked, data labels, num_format trục, legend, secondary axis), đã được kiểm chứng rộng rãi với Excel | Có, API rất đầy đủ (Aspose mạnh nhất) |
| Giữ định dạng hiện tại | 100% (không đổi writer) | Phải **port** `styleWorksheet` sang Python; kiểm chứng bằng test parity đọc lại bằng ExcelJS (§10.4) | Phải port sang API mới; Aspose có thể tái tạo đủ |
| Kiến trúc / deployment | Không thêm runtime; thêm module XML ~600–900 dòng tự bảo trì | Thêm runtime Python + 1 gói pip; child process; cần Dockerfile hoặc bước pip trong build | Aspose via Java cần JRE (~200 MB image); via C++ là native addon, phụ thuộc glibc; SpreadJS cần jsdom/canvas, nặng |
| RAM/CPU/thời gian | Như hiện tại (686 MB heap ở 100k dòng — **đã là rủi ro OOM**) + unzip/rezip thêm ~1–2 s | Tốt nhất đo được: constant_memory, RAM Node giảm vì không giữ model ExcelJS; +~150 ms spawn | Aspose thường giữ toàn workbook trong RAM (JVM heap riêng); cần đo |
| Kích thước file | Như hiện tại | Tương đương (inlineStr ở constant_memory; đo 12,2 vs 12,3 MB) | Tương đương |
| Bảo mật truyền dữ liệu | Trong process | stdin/stdout của child process, `shell:false`, env tối giản (không lộ `SUPABASE_DB_URL`, `JWT_SECRET`), không file đầu vào trên đĩa | Trong process (Aspose via Java: bridge JNI trong process) |
| Hủy / giải phóng slot | `writeBuffer` không hủy được | **Hủy thật**: `child.kill()` dừng CPU ngay; slot nhả sau khi process thoát | Tùy thư viện, thường không hủy được giữa lúc save |
| Bản quyền | Miễn phí (MIT) | XlsxWriter BSD-2, Python PSF — miễn phí | Trả phí theo developer + deployment; **cần xin báo giá**, thường hàng nghìn USD/năm; khóa license trong môi trường |
| Kiểm thử tự động | Phải tự viết validator XML; khó chứng minh Excel mở được (Excel "repair" chỉ lộ khi mở tay) | Test Node đọc lại xlsx bằng ExcelJS + JSZip kiểm tra XML chart; pytest cho builder; engine đã tự có test suite lớn đối chiếu file Excel thật | Tốt, nhưng test cần license (trial watermark) |
| Tương thích | Excel Desktop/Online OK nếu XML đúng; sai một phần tử → "We found a problem with some content" | Excel Desktop/Online: đầy đủ; LibreOffice: hiển thị và sửa được, một số style nhỏ khác; Google Sheets: import chart thành chart Google (sửa được, mất một phần định dạng/data label) | Tương tự PA2 |
| Bảo trì | **Kém**: ta sở hữu đặc tả OOXML; mỗi loại chart mới là XML mới | Tốt: chart khai báo bằng dict; 1 file Python ~300 dòng | Tốt về API, phụ thuộc nhà cung cấp |

### 4.3 Kết luận

**Chọn PA2**, vì: (1) chart native thật, trưởng thành, không tự bảo trì đặc tả OOXML; (2) giải quyết luôn rủi ro bộ nhớ sẵn có của ExcelJS (686 MB ở 100k dòng); (3) hủy được thật sự; (4) miễn phí. Chi phí chính là thêm runtime Python vào deployment và port logic style — cả hai đều kiểm chứng được bằng test tự động và spike deploy.

PA1 được giữ làm **phương án dự phòng** nếu spike deploy (Bước 0) cho thấy không thể đưa Python lên Render. PA3 bị loại vì chi phí license và image nặng mà không có lợi ích rõ so với PA2.

---

## 5. Luồng dữ liệu từ request đến workbook (thiết kế mới)

```
POST /api/export  (routes.js — KHÔNG đổi hợp đồng)
 └─ createExportWorkbook(payload, branch, {signal})
     1. describeExport()                    (không đổi)
     2. resolveSelection()                  (không đổi)
     3. release = acquireExportSlot(signal) (không đổi)
     4. dataset = buildExportDataset(request, branch, {signal, description, selection, loadAllColumns: chartsEnabled})
          - buildFixedDataset: activeFor = activeColumns(ws, selection, searching || loadAllColumns)
          - sau applyTableSearchToWorksheets(): fullWorksheets = worksheets  (giữ tham chiếu, KHÔNG sao chép)
          - worksheets = projectWorksheetRows(ws, selection[ws.key]) khi (searching || loadAllColumns) && selection
          - trả thêm dataset.chartSource = { worksheets: fullWorksheets, branch, filters, context }
     5. charts = chartSpecs.buildCharts(dataset.tableKey, dataset.chartSource, description.context)   ← MỚI, thuần JS, không I/O
          → [{ id, title, type, blocks: [{header, rows}], series:[...], axes, notes }]  hoặc { skippedReason }
     6. workbookModel = workbookModel.build(dataset, request.columns, charts)                       ← MỚI
          → sheets (tên an toàn, cột, width, numFmt, wrap, hàng đã qua toExcelValue → giá trị thuần + kiểu),
            sheet "Biểu đồ" + "Dữ liệu biểu đồ" với địa chỉ range tính sẵn
     7. engine = EXPORT_CHARTS_ENGINE === 'xlsxwriter' && charts.length ? xlsxEngine : exceljsWriter
          xlsxEngine.write(workbookModel, {signal, timeoutMs}) → spawn python, stream NDJSON vào stdin,
            Python ghi vào tmp file → Node đọc buffer → xóa tmp
          exceljsWriter.write(workbookModel) → code ExcelJS hiện tại (tách hàm), bỏ qua sheet chart
     8. return { buffer, mimeType, fileName }  (fileName giữ nguyên quy tắc)
     finally: release() — CHỈ sau khi child process đã thoát
```

Nguyên tắc: **Node là nguồn sự thật duy nhất** cho giá trị ô, kiểu, số định dạng, độ rộng, tên sheet và range chart. Python chỉ "vẽ" model — không có logic nghiệp vụ, không tự tính tổng.

Tác động chi phí khi `loadAllColumns`: chỉ bảng không tìm kiếm mới đổi (thêm thuộc tính object); không thêm truy vấn DB vì `readRowsByCodes` vốn SELECT đủ cột.

---

## 6. Cấu trúc workbook và tham chiếu range

Thứ tự sheet (khi có chart):

1. Các sheet dữ liệu hiện tại — **cùng tên, cùng thứ tự, cùng định dạng**; sheet đầu vẫn là sheet active khi mở.
2. **"Biểu đồ"** — lưới chart, tắt gridline, zoom 100%:
   - A1: tiêu đề `"<TABLE_TITLES[tableKey]> — <Cơ sở> — <khoảng thời gian>"` (đậm 14pt); A2: "Nguồn: sheet Dữ liệu biểu đồ · Đã áp dụng tìm kiếm: '<query>'" (nếu có).
   - Mỗi chart 720×380 px (`insert_chart` với `x_scale/y_scale`), xếp dọc, cách nhau 2 dòng, bắt đầu B4; tối đa 3 chart/bảng.
   - Dòng lý do nếu một chart không vẽ được.
3. **"Dữ liệu biểu đồ"** — hiển thị (mặc định, xem §13-Q2), đặt cuối:
   - Mỗi chart một **khối**: dòng tiêu đề khối (đậm), dòng header, các dòng dữ liệu, 1 dòng ghi chú (Top N / số mục gộp "Khác" / số mục âm bị loại), 1 dòng trống.
   - Cột: `Hạng mục` (text) | `Tên đầy đủ` (text, chỉ khi có cắt nhãn) | series 1..k (number). Chuỗi thời gian: `Mốc` là **ngày thật** (numFmt `dd/mm/yyyy`, tuần/tháng: ngày đầu bucket với numFmt `"Tuần "dd/mm` / `mm/yyyy`).
   - Định dạng dùng lại quy tắc bảng (viền, header đậm, `#,##0`).
   - Sheet được **bảo vệ? Không** — để người dùng sửa số liệu và thấy chart cập nhật.

Tham chiếu chart (XlsxWriter tự quote tên sheet có dấu cách/Unicode):

```
categories: ['Dữ liệu biểu đồ', r0, 0, r1, 0]      → ='Dữ liệu biểu đồ'!$A$6:$A$16
values:     ['Dữ liệu biểu đồ', r0, 2, r1, 2]      → ='Dữ liệu biểu đồ'!$C$6:$C$16
name:       ['Dữ liệu biểu đồ', rHeader, 2]        → tên series lấy từ ô header
```

Không có mảng số tĩnh: XlsxWriter vẫn ghi `numCache` (bộ đệm hiển thị bắt buộc theo OOXML) nhưng công thức `c:f` trỏ range → Excel tính lại khi mở/sửa. Test §10.3 khẳng định mọi `<c:val>`/`<c:cat>` có `<c:f>`.

Trình bày chart:
- Tiêu đề tiếng Việt, ví dụ "Doanh thu theo ngày (VNĐ)", "Top 10 khách hàng theo doanh thu".
- Trục tiền: `num_format '#,##0.0,,"tr"'` (triệu) khi max ≥ 10.000.000, ngược lại `#,##0`; data labels `#,##0` (bar ≤ 15 mục), tắt data labels cho chuỗi thời gian > 31 điểm.
- Trục số lượng/ngày: `#,##0`; doughnut: nhãn `0.0%` + category.
- Bar ngang: `reverse` trục hạng mục để mục lớn nhất ở trên; legend ẩn khi 1 series, `bottom` khi ≥ 2.
- Trục ngày dùng `date_axis` + `num_format` như cột mốc; khoảng nhãn tự động.
- Màu: series 1 `#2F6FB0`, Hà Nội `#2F6FB0`, Sài Gòn `#E08A2E`, "Khác" `#A6AEB8` (point-level fill); doughnut 6 màu cố định.

---

## 7. Thay đổi theo file/module

### Backend (Node)

| File | Thay đổi |
|---|---|
| `server/dashboard/exportService.js` | (a) `buildFixedDataset(…, selection, options)` thêm `options.loadAllColumns`; trả `chartSource`. (b) `buildExportDataset` truyền cờ; các nhánh `productReport`/`customers.product*`/stockout/debt đã có đủ cột → `chartSource = { worksheets }` trước khi chiếu. (c) Tách phần ExcelJS trong `createExportWorkbook` thành `writeWithExcelJS(model)` (hành vi y hệt). (d) `createExportWorkbook` gọi `buildCharts` → `buildWorkbookModel` → chọn engine. (e) Export thêm `__test__.buildWorkbookModel`, `__test__.buildCharts`. |
| `server/dashboard/exportChartSpecs.js` (**mới**) | Bảng `CHART_SPECS: tableKey → (context) → [chartDef]`; hàm thuần `aggregateTopN`, `bucketTimeSeries`, `groupByBranch`, `truncateLabel`, `disambiguate`; `buildCharts(tableKey, chartSource, context)` trả block dữ liệu + định nghĩa chart hoặc `skippedReason`. Không I/O. |
| `server/dashboard/exportWorkbookModel.js` (**mới**) | Chuyển dataset + selection + charts → model trung lập engine: `{properties, sheets:[{name, kind:'data'|'chart'|'chartData', columns:[{label,type,numFmt,width,wrap}], rowCount, freeze, autoFilter, rows(iterator)}], charts:[{sheet, anchor, type, title, series:[{name:[s,r,c], categories:[s,r0,c,r1,c], values:[…], color}], axes}]}`. Di chuyển `toExcelValue`, `parseExcelDate`, `safeWorksheetName`, `columnHasFraction`, logic width từ `styleWorksheet` vào đây (re-export để test cũ vẫn dùng `__test__.toExcelValue`). Ngày → **Excel serial** tính ở Node (`25569 + ms/86400000`, cùng công thức ExcelJS dùng) để hai engine ra cùng giá trị. |
| `server/dashboard/xlsxEngine.js` (**mới**) | `write(model, {signal, timeoutMs})`: `mkdtemp(os.tmpdir()/'tks-xlsx-')`; `spawn(PYTHON_BIN, ['-I','-X','utf8', ENGINE_SCRIPT, '--out', tmpFile], {shell:false, env:{PATH, LANG:'C.UTF-8', PYTHONIOENCODING:'utf-8'}, stdio:['pipe','pipe','pipe'], windowsHide:true})`; ghi NDJSON có backpressure (`stdin.write` + `drain`); stderr giới hạn 64 KB; timeout → `SIGKILL`; abort → `SIGKILL`; exit code ≠ 0 → lỗi `EXPORT_ENGINE_FAILED`; đọc file → Buffer; `rm(tmpDir, {recursive, force})` trong `finally`. Hàm `probe()` (chạy `--version`) dùng lúc khởi động/health. |
| `server/excelEngine/build_workbook.py` (**mới**) | Đọc NDJSON từ stdin: dòng `{"t":"wb",…}`, `{"t":"sheet",…}`, `{"t":"row","v":[…]}`, `{"t":"chart",…}`, `{"t":"end"}`. `Workbook(out, {'constant_memory':True,'strings_to_formulas':False,'strings_to_numbers':False,'strings_to_urls':False,'default_date_format':'dd/mm/yyyy hh:mm:ss'})`. Luôn `write_string`/`write_number`/`write_blank` theo kiểu do Node chỉ định (không dùng `write()` tự đoán). Cache `add_format` theo (numFmt, wrap, header, border). Không import gì ngoài stdlib + xlsxwriter. |
| `server/excelEngine/requirements.txt` (**mới**) | `XlsxWriter==3.2.9` (pin chính xác, kèm `--require-hashes` ở Dockerfile). |
| `server/excelEngine/test_build_workbook.py` (**mới**) | pytest/unittest: model nhỏ → file mở lại bằng `zipfile` kiểm tra chart XML. |
| `server/config.js` | `EXPORT_CHARTS_ENGINE` (`exceljs` mặc định), `EXPORT_PYTHON_BIN` (mặc định `python3`, Windows dev `python`), `EXPORT_ENGINE_TIMEOUT_MS` (90000). |
| `server/routes.js` | **Không đổi** hợp đồng. Tùy chọn: `/api/debug` hiển thị `xlsxEngine.probe()` (không lộ path). |
| `server/index.js` | Gọi `xlsxEngine.probe()` khi khởi động, log 1 dòng; nếu cờ bật mà probe lỗi → log cảnh báo, export tự rơi về ExcelJS. |
| `server/excelTableStyle.js` | Thêm hằng số `TABLE_BORDER_ARGB`, `HEADER_ROW_HEIGHT` để model truyền sang Python (không đổi hàm cũ; HR export không bị ảnh hưởng). |

### Frontend (`server/public/index.html`)

- **Không đổi payload** (`buildExportPayload`, `selectedExportColumns`, `downloadExportFile`).
- Thêm 1 dòng gợi ý dưới tiêu đề modal khi `metadata.charts` có (vd. "File sẽ kèm sheet Biểu đồ (2 biểu đồ)"): `getExportFields` trả thêm trường **tùy chọn** `charts: [{title}]` tính từ `CHART_SPECS` tĩnh (không I/O). Client cũ bỏ qua trường lạ.
- Không thêm checkbox bật/tắt biểu đồ ở giai đoạn 1 (xem §13-Q1).
- `EXPORT_FILE_TIMEOUT_MS` (180s) giữ nguyên.

### Dependency & deployment

- `server/package.json`: **không thêm** dependency Node (JSZip đã có sẵn qua exceljs cho test; nếu test cần require trực tiếp thì thêm `jszip` vào devDependencies).
- **Dockerfile (mới, gốc repo hoặc `server/`)**: `FROM node:22-bookworm-slim` → `apt-get install -y --no-install-recommends python3 python3-venv` → venv `/opt/xlsx` + `pip install --require-hashes -r server/excelEngine/requirements.txt` → `ENV EXPORT_PYTHON_BIN=/opt/xlsx/bin/python` → `npm ci --omit=dev` trong `server/` → `CMD ["node","--max-old-space-size=512","index.js"]`.
- **Render**: đổi service từ runtime Node sang Docker (hoặc tạo service Docker mới song song để thử, xem §11). Biến môi trường giữ nguyên + thêm `EXPORT_CHARTS_ENGINE`, `EXPORT_PYTHON_BIN`. Health check `/health` giữ nguyên.
- Phương án không Docker (cần spike xác nhận): native Node runtime của Render có `python3` trong image build/runtime hay không **chưa được chứng minh** trong repo; nếu có thì build command `pip install --target server/.pylib -r server/excelEngine/requirements.txt && cd server && npm ci`, và `PYTHONPATH` trỏ `.pylib`. Không chọn làm mặc định.
- Dev Windows: `python -m pip install -r server/excelEngine/requirements.txt` (README cập nhật).

---

## 8. Tương thích ngược

- **API**: request/response `/api/export` và `/api/export/fields` giữ nguyên; `fields` chỉ thêm trường tùy chọn `charts`. Mã lỗi cũ giữ nguyên; thêm `EXPORT_ENGINE_FAILED` (500, detail an toàn) và `EXPORT_ENGINE_TIMEOUT` (504).
- **File**: sheet dữ liệu cùng tên, thứ tự, cột (theo selection), giá trị, numFmt, freeze, autofilter, viền, độ rộng → khẳng định bằng test parity (§10.4) chạy trên **cả hai engine**. Sheet mới chỉ nối **sau** các sheet dữ liệu; sheet đầu vẫn active.
- **Bảng không có chart** (`products.low-stock`, `search.results`): workbook giữ đúng như hiện tại (không thêm sheet) — kể cả khi dùng engine Python.
- **Tên file**: không đổi (`branchFilePrefix`, `fileSlug`, `fileTimestamp`).
- **Cờ tắt** (`EXPORT_CHARTS_ENGINE=exceljs`): đường code cũ, không có sheet chart, `loadAllColumns=false` → hành vi byte-tương-đương hiện tại (trừ timestamp).
- Toàn bộ test hiện có trong `exportService.test.js` (dòng 204–1577) phải xanh **không sửa kỳ vọng**, chỉ được thêm tham số engine.

---

## 9. Lỗi, timeout, hủy, file tạm, dọn dẹp

| Tình huống | Xử lý |
|---|---|
| Client đóng modal / hủy (routes.js `res.on('close')` → abort) | `xlsxEngine` nghe `signal`: `child.kill('SIGKILL')`, chờ `'close'`, xóa tmp, ném `EXPORT_ABORTED` → `release()` trong `finally` chỉ chạy **sau** khi process đã chết ⇒ không vượt `EXPORT_MAX_CONCURRENT`. |
| Treo engine | `EXPORT_ENGINE_TIMEOUT_MS` (90s < 180s client) → kill → 504 `EXPORT_ENGINE_TIMEOUT`. |
| Python không có / import lỗi (ENOENT, exit 1 ngay) | Nếu lỗi xảy ra **trước khi ghi dòng đầu** (spawn error/`probe` fail) → rơi về ExcelJS không chart, log `warn`, header phản hồi `X-Export-Charts: fallback` (debug). Lỗi giữa chừng → 500 `EXPORT_ENGINE_FAILED` (không thử lại tự động để tránh nhân đôi tải). |
| stdin `EPIPE` (Python chết giữa chừng) | Bắt lỗi stream, chờ exit code, báo `EXPORT_ENGINE_FAILED`, stderr (≤64 KB, đã cắt) chỉ ghi log server, không trả client. |
| Output quá lớn | Kiểm tra `stat.size` ≤ 200 MB trước khi đọc; vượt → 413 `EXPORT_TOO_LARGE`. |
| File tạm | `fs.mkdtemp` riêng mỗi request (quyền 0700), tên file cố định `out.xlsx`, `rm -rf` trong `finally` kể cả khi lỗi; khi khởi động dọn thư mục `tks-xlsx-*` cũ hơn 1 giờ (sót do crash). |
| Tiến trình mồ côi khi Node chết | Python đọc stdin: EOF bất thường (không có `{"t":"end"}`) → thoát mã 3 và xóa file out; Node dùng `detached:false`. |
| Bảo mật | `shell:false`, đối số cố định, env chỉ có PATH/LANG (không secret); dữ liệu chỉ đi qua pipe; Python không mở mạng; tên sheet đã được `safeWorksheetName` làm sạch; mọi chuỗi ghi bằng `write_string` + `strings_to_formulas=False` (giữ chống CSV/formula injection hiện có); tiêu đề chart chỉ lấy từ hằng số server + tên cơ sở + ngày, không lấy text tự do (query tìm kiếm chỉ ghi vào ô, qua `neutralizeFormulaText`). |

---

## 10. Kế hoạch kiểm thử

Chạy bằng `npm test` (node:test) trong `server/`; test Python chạy bằng `python -m unittest server/excelEngine/test_build_workbook.py`. Test Node gọi engine thật được đánh dấu `skip` khi `probe()` thất bại (để máy không có Python vẫn xanh), nhưng CI/Docker bắt buộc chạy.

### 10.1 Unit test tổng hợp — `server/dashboard/exportChartSpecs.test.js` (mới)
- `aggregateTopN`: 25 mục → 10 + "Khác (15 mục)" với tổng đúng; ≤ 11 mục → không "Khác"; giá trị âm/rỗng bị loại và được đếm trong ghi chú; tie-break ổn định theo tên `localeCompare('vi')`.
- `bucketTimeSeries`: 10 ngày → theo ngày, điền 0; 120 ngày → theo tuần; 400 ngày → theo tháng; ranh giới múi giờ 23:30 ngày 31/08 (+07) nằm đúng tháng 8; trần 60 điểm.
- Mỗi tableKey trong ma trận §3: dataset giả (tái dùng `buildRowsBySheet`/stub trong `exportService.test.js`) → số khối, header, tổng khớp tay; hóa đơn "Đã hủy" bị loại.
- **Độc lập chọn cột**: `products.top-selling` chọn chỉ `ma_hang` → chart vẫn có `d_sales_revenue` đúng.
- **Tìm kiếm**: `tableSearch.query` giữ 2/5 dòng → chart chỉ có 2 hạng mục.
- **Cả hai**: giao dịch trùng mã ở 2 cơ sở → 2 series Hà Nội/Sài Gòn đúng tổng.
- Không chart: `products.low-stock`, `search.results`, dataset rỗng → `skippedReason`.

### 10.2 Test cấu trúc workbook — `server/dashboard/exportWorkbookModel.test.js` (mới) + mở rộng `exportService.test.js`
- Thứ tự sheet: dữ liệu… → "Biểu đồ" → "Dữ liệu biểu đồ"; sheet đầu active; tên trùng (`safeWorksheetName`) không đụng tên sheet chart.
- Ô tiêu đề sheet "Biểu đồ" chứa cơ sở + khoảng thời gian.
- Workbook engine Python đọc lại bằng `ExcelJS.load()`: đọc được mọi sheet dữ liệu (dùng làm oracle cho parity).

### 10.3 Kiểm tra chart XML & range (JSZip trên buffer)
- Có `xl/charts/chartN.xml` đúng số chart; `xl/drawings/drawing1.xml` gắn vào sheet "Biểu đồ" qua rels; `[Content_Types].xml` có `application/vnd.openxmlformats-officedocument.drawingml.chart+xml`.
- Mỗi `<c:ser>` có `<c:cat><c:strRef|numRef><c:f>` và `<c:val><c:numRef><c:f>`; parse `c:f` → sheet = "Dữ liệu biểu đồ", range nằm **trong** khối đã ghi, số điểm = số dòng khối; đọc giá trị ô tại range bằng ExcelJS = số tổng hợp kỳ vọng.
- Loại chart (`c:barChart` + `c:barDir val="bar|col"`, `c:doughnutChart`, `grouping stacked|clustered`), tiêu đề tiếng Việt, `numFmt formatCode` của trục.
- Không có `xl/media/*` (không ảnh), không `pivotCache`.

### 10.4 Hồi quy sheet dữ liệu (parity)
- Helper `snapshotWorkbook(buffer)` (ExcelJS load): với mỗi sheet dữ liệu → tên, `views`, `autoFilter`, chiều cao header, font header, với mỗi cột → width, numFmt, alignment; mỗi ô → `value` (Date so sánh theo serial), `type`, border.
- Chạy **toàn bộ** tableKey của test "ca 14 bang tao duoc file xlsx…" (dòng 511) trên engine ExcelJS và Python → `deepStrictEqual(snapshot(A), snapshot(B))` cho các sheet dữ liệu.
- Giữ nguyên các test cụ thể: 0 đầu mã/điện thoại (592), chặn công thức (572), `.00` (604/616), header không nền (630), wrap stockout (1053), tên file HN_/SG_ (651, 975).

### 10.5 Tải lớn & đồng thời — `server/dashboard/exportLoad.test.js` (mới, chạy khi `EXPORT_LOAD_TEST=1`)
- 100.000 dòng × 30 cột + 3 chart: thời gian < 20 s, `process.memoryUsage().heapUsed` Node tăng < 150 MB, RSS Python < 100 MB (đo qua `/proc/<pid>/status` trên Linux/Docker).
- 5 request song song: tối đa 2 process Python cùng lúc (đếm spawn), 3 đợi; request thứ 11 → 503 (tái dùng kịch bản test dòng 1094/1120).
- Abort giữa lúc Python đang ghi → process bị kill < 1 s, tmp dir biến mất, `limiterState().active` về 0 (mở rộng test dòng 1169/1200).
- Timeout giả (`EXPORT_ENGINE_TIMEOUT_MS=50` + script ngủ) → 504, slot được nhả.
- Python không tồn tại (`EXPORT_PYTHON_BIN=/nonexistent`) → fallback ExcelJS, file vẫn đúng dữ liệu.

### 10.6 Checklist thủ công (Excel Desktop 365 Windows, + Excel Online, LibreOffice 24.x, Google Sheets)
1. Mở file không có hộp thoại "repair".
2. Sheet đầu là dữ liệu; tab "Biểu đồ" và "Dữ liệu biểu đồ" ở cuối.
3. Click chart → Select Data: range trỏ `'Dữ liệu biểu đồ'!…`, không phải hằng số.
4. Sửa 1 số trong "Dữ liệu biểu đồ" → chart cập nhật ngay.
5. Đổi loại chart (Change Chart Type) được, đổi màu/tiêu đề được, lưu lại mở lại giữ nguyên.
6. Tiếng Việt có dấu hiển thị đúng ở tiêu đề, trục, legend.
7. Trục tiền hiển thị "tr"; data label có dấu phân cách nghìn; doughnut hiển thị %.
8. Chuỗi thời gian: nhãn ngày/tuần/tháng đúng, không chồng chữ ở 60 điểm.
9. So số: tổng "Top 10 + Khác" = tổng cột tương ứng ở sheet dữ liệu (SUM thủ công, với bộ lọc Hoàn thành cho hóa đơn).
10. Lặp với: Hà Nội / Sài Gòn / Cả hai; 1 ngày / 30 ngày / khoảng 1 năm; có & không tìm kiếm; bỏ chọn cột chỉ tiêu.
11. In/Print Preview trang "Biểu đồ" vừa khổ A4 ngang.
12. Excel Online: chart hiển thị & chỉnh được; LibreOffice: hiển thị đúng số; Google Sheets: import được chart (ghi nhận khác biệt định dạng, không chặn nghiệm thu).

---

## 11. Rủi ro, giảm thiểu, rollback

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Render không chạy được Python/Docker như mong đợi | Cao | Bước 0: spike deploy service Docker **tách biệt** (staging) trước mọi thay đổi code; nếu thất bại → chuyển PA1 (đã có thiết kế model trung lập engine nên chỉ thay `xlsxEngine`). |
| Lệch định dạng giữa 2 engine | Trung bình | Test parity §10.4 bắt buộc xanh trước khi bật cờ. |
| Tăng thời gian build/kích thước image | Thấp | `bookworm-slim` + venv chỉ 1 gói; đo trong Bước 0. |
| Tăng RAM do `loadAllColumns` | Thấp–TB | Chỉ bật khi bảng có chart; đo heap trong §10.5; nếu vượt ngưỡng, chuyển sang tính tổng trực tiếp từ `items` logic cho bảng nặng. |
| Số liệu chart lệch KPI màn hình (định nghĩa doanh thu) | TB | Q5 + test so tổng với `transactionsReport.summary.revenue` trong stub. |
| Google Sheets hiển thị khác | Thấp | Ghi rõ trong tài liệu người dùng; không phải mục tiêu chính. |
| Nhiều phiên Claude ghi đè file (`multi_session_overwrite_risk`) | TB | Mỗi bước 1 commit nhỏ, kiểm `git diff` trước commit. |

**Rollback**: (1) tức thì: `EXPORT_CHARTS_ENGINE=exceljs` trên Render → đường cũ (không deploy). (2) Nếu Docker có vấn đề: đổi Render service về runtime Node cũ (build/start command cũ vẫn hợp lệ vì `package.json` không đổi) — engine tự fallback khi `probe()` fail. (3) `git revert` các commit theo thứ tự ngược; các module mới độc lập nên revert không xung đột.

---

## 12. Các bước triển khai (commit nhỏ)

| # | Commit | Nội dung | Tiêu chí hoàn thành |
|---|---|---|---|
| 0 | `chore(deploy): spike Dockerfile node22 + python3 + xlsxwriter` | Dockerfile + `requirements.txt` + script `excelEngine/hello.py` tạo file 1 chart; deploy lên **service staging** Render | Service staging chạy `/health` OK; tải file có chart mở được trong Excel; ghi lại thời gian build, dung lượng image, RAM idle |
| 1 | `refactor(export): tach writer ExcelJS va workbook model` | `exportWorkbookModel.js` (di chuyển `toExcelValue`, `parseExcelDate`, `safeWorksheetName`, width/numFmt) + `writeWithExcelJS(model)` | Toàn bộ `exportService.test.js` xanh **không sửa kỳ vọng**; file xuất byte-tương-đương (so sánh snapshot) |
| 2 | `feat(export): chartSource doc lap voi lua chon cot` | `loadAllColumns` trong `buildFixedDataset`/`buildExportDataset`; `chartSource` cho mọi nhánh | Test mới: chọn 1 cột nhưng `chartSource` đủ cột, đã tìm kiếm; sheet dữ liệu không đổi |
| 3 | `feat(export): exportChartSpecs tong hop Top N/bucket` | Module thuần + test §10.1 cho toàn ma trận §3 | Tất cả case §10.1 xanh; Q5 đã đối chiếu |
| 4 | `feat(export): engine python xlsxwriter cho sheet du lieu` | `build_workbook.py` (chỉ sheet dữ liệu) + `xlsxEngine.js` (spawn/stream/abort/timeout/tmp) | Parity §10.4 xanh cho mọi tableKey; test abort/timeout/fallback §10.5 xanh |
| 5 | `feat(export): sheet Bieu do + Du lieu bieu do` | Model + Python vẽ chart, định dạng trục/nhãn | Test §10.2, §10.3 xanh |
| 6 | `feat(export): cau hinh co EXPORT_CHARTS_ENGINE + probe` | `config.js`, `index.js`, `/api/debug` | Cờ tắt → hành vi cũ; cờ bật + không Python → fallback, log cảnh báo |
| 7 | `feat(ui): goi y bieu do trong modal Xuat Excel` | `getExportFields` trả `charts`; `index.html` hiển thị 1 dòng | Test frontend (jsdom) hiển thị/ẩn đúng; payload không đổi |
| 8 | `test(export): tai lon va dong thoi` | `exportLoad.test.js` | Đạt ngưỡng §10.5 trên container Docker |
| 9 | `docs(export): README + huong dan van hanh` | README server, biến môi trường, rollback | Có checklist §10.6 đã chạy tay, đính kèm ảnh chụp |
| 10 | Chuyển service production sang Docker, `EXPORT_CHARTS_ENGINE=xlsxwriter` | Vận hành | 1 tuần không lỗi `EXPORT_ENGINE_*`; p95 thời gian xuất không tăng > 20% |

---

## 13. Quyết định cần anh/chị xác nhận (kèm mặc định)

| # | Câu hỏi | Mặc định khuyến nghị |
|---|---|---|
| Q1 | Có cho người dùng tắt biểu đồ trong modal không? | **Không** ở giai đoạn 1 — luôn kèm khi bảng có chart; thêm sau nếu có phản hồi. |
| Q2 | Sheet "Dữ liệu biểu đồ" ẩn hay hiện? | **Hiện**, đặt cuối (minh bạch, dễ sửa; Google Sheets/LibreOffice xử lý sheet ẩn không đồng nhất). |
| Q3 | Bảng có chart nhưng dữ liệu không đủ vẽ: bỏ sheet hay giữ sheet "Biểu đồ" kèm lý do? | **Giữ sheet + dòng lý do** (người dùng hiểu vì sao trống). |
| Q4 | Chuyển Render sang Docker có được không? | **Có**, qua service staging trước (Bước 0). Nếu không được → PA1. |
| Q5 | "Doanh thu" hóa đơn trên chart = `tong_tien_hang` của hóa đơn Hoàn thành (khớp KPI) hay "Khách cần trả"? | **Khớp KPI màn hình** — xác minh cột `invTotalIdx` (`dashboardData.js:1371`) ở Bước 3. |
| Q6 | Top N = 10 (15 cho tồn kho/đứt hàng) có phù hợp? | **Có**; cấu hình trong `CHART_SPECS`. |
| Q7 | Trục tiền hiển thị theo "triệu" (`tr`) khi ≥ 10 triệu? | **Có**; data label vẫn đủ số. |
| Q8 | `search.results` có cần chart không? | **Không** ở giai đoạn 1. |
| Q9 | Sau khi ổn định có dùng engine Python cho **mọi** export (kể cả bảng không chart) để giảm RAM không? | **Có, giai đoạn 2** (sau 1 tuần ổn định) — lợi RAM rất lớn (686 MB → ~19 MB ở 100k dòng). |
