# Stockout KiotViet API Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dùng API KiotViet làm nguồn chính cho Hóa đơn, Nhập hàng và Khách trả hàng trong cả ba tính năng stockout, với fallback độc lập sang Sheet cho Hóa đơn/Nhập hàng và giữ Trả NCC từ Sheet.

**Architecture:** Một `stockoutEventLoader` dùng chung sẽ tải từng nguồn vào event map tạm và chỉ merge sau khi nguồn hoàn tất, tránh cộng trùng khi lỗi giữa phân trang. Ba service giữ trách nhiệm chọn sản phẩm và phân tích timeline; loader trả thêm `sources` và `warnings` để API nội bộ và giao diện giải thích nguồn thực tế.

**Tech Stack:** Node.js CommonJS, KiotViet Public API client hiện có, Google Sheets client hiện có, `node:test`, HTML/JavaScript thuần, ExcelJS.

## Global Constraints

- API thành công nhưng trả danh sách rỗng là thành công, không fallback.
- Hóa đơn và Nhập hàng fallback độc lập sang Sheet khi API lỗi hoặc sai cấu trúc.
- Khách trả hàng lỗi API làm job thất bại vì Sheet không có mã hàng và số lượng chi tiết.
- Trả NCC và tồn hiện tại luôn đọc từ Google Sheets.
- Không trộn dữ liệu API và Sheet trong cùng một nguồn.
- Chỉ chứng từ hoàn thành, mã trim và khớp chính xác có phân biệt hoa/thường mới ảnh hưởng tồn kho.
- Mọi nguồn chỉ đóng góp sự kiện trong cửa sổ tính toán, gồm 4 ngày đệm.

---

### Task 1: Chuẩn hóa bộ dựng sự kiện theo từng nguồn

**Files:**
- Modify: `server/dashboard/stockoutCheck/timelineBuilder.js`
- Modify: `server/dashboard/stockoutCheck/timelineBuilder.test.js`
- Modify: `server/dashboard/stockoutCheck/sheetTimelineBuilder.js`
- Modify: `server/dashboard/stockoutCheck/sheetTimelineBuilder.test.js`

**Interfaces:**
- Produces: `accumulateInvoiceEvents(map, items, codes, fromDate, toDate)`, `accumulatePurchaseOrderEvents(...)`, `accumulateReturnEvents(...)`.
- Produces: `buildInvoiceEventMapFromSheets`, `buildPurchaseEventMapFromSheets`, `buildSupplierReturnEventMapFromSheets`.

- [ ] **Step 1: Viết test thất bại cho trim mã, lọc khoảng ngày và tách nguồn Sheet**

```js
test('API accumulators trim mã và bỏ sự kiện ngoài kỳ', () => {
  const events = new Map();
  accumulateInvoiceEvents(events, [{
    status: 1,
    purchaseDate: '2026-01-10T00:00:00Z',
    invoiceDetails: [{ productCode: ' SP01 ', quantity: 2 }]
  }], new Set(['SP01']), '2026-01-09', '2026-01-11');
  assert.deepEqual(events.get('SP01'), [{ dateKey: '2026-01-10', delta: -2 }]);
});
```

- [ ] **Step 2: Chạy test và xác nhận RED**

Run: `cd server && node --test dashboard/stockoutCheck/timelineBuilder.test.js dashboard/stockoutCheck/sheetTimelineBuilder.test.js`

- [ ] **Step 3: Thêm lọc ngày/mã và các hàm dựng Sheet độc lập**

```js
function inDateRange(dateKey, fromDate, toDate) {
  return (!fromDate || dateKey >= fromDate) && (!toDate || dateKey <= toDate);
}

function mergeEventMaps(target, source) {
  for (const [code, events] of source) {
    if (!target.has(code)) target.set(code, []);
    target.get(code).push(...events);
  }
  return target;
}
```

- [ ] **Step 4: Chạy test và xác nhận GREEN**

Run: `cd server && node --test dashboard/stockoutCheck/timelineBuilder.test.js dashboard/stockoutCheck/sheetTimelineBuilder.test.js`

### Task 2: Tạo loader API-first và fallback nguyên tử

**Files:**
- Create: `server/dashboard/stockoutCheck/stockoutEventLoader.js`
- Create: `server/dashboard/stockoutCheck/stockoutEventLoader.test.js`

**Interfaces:**
- Consumes: các accumulator và Sheet builder từ Task 1.
- Produces: `loadStockoutEvents({ client, sheetsClient, validCodeSet, fromDate, toDate, onProgress }) -> { eventMapByCode, sources, warnings }`.

- [ ] **Step 1: Viết test thất bại cho API thành công, API rỗng, fallback từng nguồn và lỗi giữa phân trang**

```js
test('lỗi trang sau của invoices bỏ dữ liệu API tạm và chỉ dùng Sheet', async () => {
  const result = await loadStockoutEvents(makeDeps({ invoiceFailureAfterPage: 1 }));
  assert.equal(result.sources.invoices, 'google-sheets-fallback');
  const events = result.eventMapByCode.get('SP01') || [];
  assert.equal(events.some(event => event.delta === -99), false);
  assert.equal(events.filter(event => event.delta === -2).length, 1);
});

test('returns lỗi làm job lỗi vì không có fallback đủ chi tiết', async () => {
  await assert.rejects(loadStockoutEvents(makeDeps({ returnsError: true })), /Khách trả hàng/);
});
```

- [ ] **Step 2: Chạy test và xác nhận RED**

Run: `cd server && node --test dashboard/stockoutCheck/stockoutEventLoader.test.js`

- [ ] **Step 3: Cài loader tuần tự và validate cấu trúc trước khi merge**

```js
async function loadApiSource({ endpoint, query, validate, accumulate }) {
  const temporary = new Map();
  await client.fetchAllPages(endpoint, query, (items, meta) => {
    validate(items);
    accumulate(temporary, items, validCodeSet, fromDate, toDate);
    onProgress({ source: endpoint, meta });
  });
  return temporary;
}
```

Hóa đơn và Nhập hàng `catch` lỗi để đọc đúng Sheet dự phòng; Returns không `catch` sang Sheet. Trả NCC được đọc riêng và merge đúng một lần.

- [ ] **Step 4: Chạy test và xác nhận GREEN**

Run: `cd server && node --test dashboard/stockoutCheck/stockoutEventLoader.test.js`

### Task 3: Tích hợp loader vào cả ba service

**Files:**
- Modify: `server/dashboard/stockoutCheck/stockoutCheckService.js`
- Modify: `server/dashboard/stockoutCheck/recentStockoutScanService.js`
- Modify: `server/dashboard/stockoutCheck/stockout30dScanService.js`
- Modify: ba file test service tương ứng.

**Interfaces:**
- Consumes: `loadStockoutEvents` từ Task 2.
- Produces: kết quả hiện tại cộng `sources` và `warnings`.

- [ ] **Step 1: Sửa test service để mong đợi ba endpoint API và metadata nguồn**

```js
assert.deepEqual(calls.map(call => call.endpoint), ['invoices', 'purchaseorders', 'returns']);
assert.equal(result.sources.supplierReturns, 'google-sheets');
assert.deepEqual(result.warnings, []);
```

- [ ] **Step 2: Chạy test và xác nhận RED**

Run: `cd server && node --test dashboard/stockoutCheck/*Service.test.js`

- [ ] **Step 3: Thay `buildEventMapFromSheets` và lời gọi Returns riêng bằng loader chung**

```js
const { eventMapByCode, sources, warnings } = await loadStockoutEvents({
  client, sheetsClient, validCodeSet,
  fromDate: calculationFromDate,
  toDate: todayKey,
  onProgress: progress => jobStore.updateProgress(jobId, { progress })
});
```

Gắn `sources` và `warnings` vào cả kết quả rỗng lẫn kết quả có dòng.

- [ ] **Step 4: Chạy test và xác nhận GREEN**

Run: `cd server && node --test dashboard/stockoutCheck/*Service.test.js`

### Task 4: Hiển thị nguồn fallback và bảo vệ cache giao diện

**Files:**
- Modify: `server/dashboard/stockoutCheck/stockoutCheckRoutes.js`
- Modify: `server/public/index.html`
- Modify: `server/test/frontend/stockout-periods-column.test.js`

**Interfaces:**
- Consumes: `sources`, `warnings` trong kết quả job.
- Produces: thông báo nguồn dự phòng dễ hiểu cho người dùng và cache schema mới.

- [ ] **Step 1: Viết test thất bại cho thông báo fallback và cache schema tăng phiên bản**

```js
assert.match(html, /formatStockoutSourceWarnings/);
assert.match(html, /STOCKOUT_RESULT_SCHEMA_VERSION = 3/);
assert.match(html, /Google Sheets dự phòng/);
```

- [ ] **Step 2: Chạy test và xác nhận RED**

Run: `cd server && node --test test/frontend/stockout-periods-column.test.js dashboard/stockoutCheck/stockoutCheckRoutes.test.js`

- [ ] **Step 3: Render warning cho cả ba bảng và cập nhật mô tả tiến độ**

```js
function formatStockoutSourceWarnings(result) {
  return Array.isArray(result && result.warnings) ? result.warnings.join(' ') : '';
}
```

Tăng cache schema lên `3` để kết quả cũ không có metadata nguồn không được phục hồi.

- [ ] **Step 4: Chạy test và xác nhận GREEN**

Run: `cd server && node --test test/frontend/stockout-periods-column.test.js dashboard/stockoutCheck/stockoutCheckRoutes.test.js`

### Task 5: Xác minh toàn bộ và khởi động lại dịch vụ

**Files:**
- Verify only: toàn bộ file stockout và export/frontend liên quan.

- [ ] **Step 1: Chạy nhóm kiểm thử mục tiêu**

Run: `cd server && node --test dashboard/stockoutCheck/*.test.js dashboard/exportService.test.js test/frontend/stockout-periods-column.test.js`

- [ ] **Step 2: Chạy toàn bộ server test**

Run: `cd server && npm test`

Ghi rõ các lỗi môi trường hoặc lỗi có sẵn không liên quan nếu PostgreSQL/Google APIs không khả dụng.

- [ ] **Step 3: Kiểm tra diff và chỉ stage file thuộc phạm vi**

Run: `git diff --check && git status --short`

- [ ] **Step 4: Khởi động lại đúng tiến trình dashboard cổng 3000 và kiểm tra health**

Run: xác định PID đang LISTEN cổng 3000, dừng đúng PID, chạy `node --max-old-space-size=512 index.js` ẩn trong `server`, rồi xác nhận HTTP 200.
