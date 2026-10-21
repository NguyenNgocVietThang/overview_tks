# CONT TKS1 và cột Nguồn — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đồng bộ thêm CONT TKS1 vào nguồn CONT chung và hiển thị Nguồn đầu bảng dự kiến, đồng nhất Excel/HTML.

**Architecture:** Mở rộng `SHEET_NAMES` của parser dùng chung. DB và API đã lưu/trả `sheetName`; frontend và export dùng lại trường này, không migration.

**Tech Stack:** Node.js 22, Express/CommonJS, PostgreSQL, vanilla HTML/JS, node:test, PGlite, JSDOM, ExcelJS.

**Spec:** [Thiết kế](../specs/2026-10-21-container-tks1-source-design.md).

## Global Constraints

- Nguồn thứ bảy là `CONT TKS1`, đứng sau `KHÁC`; không đổi thứ tự sáu nguồn cũ.
- Giữ lịch 10 phút mặc định, đồng bộ nguyên khối, bảo vệ snapshot, ghi khác biệt và quyền hiện có.
- Tổng lượng lấy O; tên sản phẩm tra `product_report`; không viết Google Sheets hoặc DB production để kiểm thử.
- Không thêm endpoint, migration, dependency, bộ lọc nguồn hoặc thay đổi tìm kiếm.
- Chạy tuần tự trong phiên hiện tại; không cần chia subagent cho thay đổi nhỏ này.

## Task 1: Đọc nguồn thứ bảy và giữ tính nhất quán

**Files:** `server/productContainers/parser.js`, `sync.js`, `parser.test.js`, `repository.test.js`, `expectedRefresh.test.js` trong cùng thư mục.

**Interfaces:** Giữ `parseContainerSheet(sheetName, values, formattedValues) -> {rows,warnings}`; mở rộng hằng `SHEET_NAMES`. `refreshContainers()` và các repository không đổi chữ ký.

- [ ] Thêm test parser cho sheet mới: tiêu đề toàn sheet ở dòng 1; các khối cùng tên trạng thái 1–4; dữ liệu trực tiếp dưới CONT; O khác M × N; mã lặp; END rồi một dòng cần bỏ. Ví dụ dữ liệu nhỏ:

```js
const input = [
  ['Mã SP', 'Tên SP'],
  ['CONT TKS1', '1.Chưa có lịch'],
  row('QT', 184, {12:12, 13:15.3}),
  ['CONT TKS1', '3.Đã bốc'], row('QT', 23),
  ['END'], row('AFTER', 999)
];
const result = parseContainerSheet('CONT TKS1', input);
assert.deepEqual(result.rows.map(r => [r.sheetName, r.sourceRow, r.status, r.quantity]),
  [['CONT TKS1', 3, 1, 184], ['CONT TKS1', 5, 3, 23]]);
assert.deepEqual(result.warnings, []);
```

- [ ] Trong fixture sync của `repository.test.js`, khẳng định danh sách nguồn đúng bảy tên; ghi nhận các lần gọi `getValues` cho nguồn mới với hai render option và A:X. Thêm dữ liệu trạng thái 1/2/3/4; assert snapshot có `sheet_name='CONT TKS1'`, `sheet_order=6`, summary cộng 1+2 vào unloaded và 3 vào loaded; chi tiết cùng tên CONT tách theo `containerRow`. Thử thiếu title và reject `getValues` của nguồn mới: status lỗi và snapshot cũ giữ nguyên.
- [ ] Chạy test để xác nhận phần thêm nguồn thất bại trước sửa mã:

```powershell
node --test productContainers/parser.test.js productContainers/repository.test.js
```

- [ ] Nối nguồn mới và sửa thông báo hardcode trong `sync.js`:

```js
const SHEET_NAMES = Object.freeze(['YIWU', 'VK-DUNG', 'HÀ BẮC', 'SD', 'GDONG', 'KHÁC', 'CONT TKS1']);
// Trong sync.js:
const SAFE_ERROR = `Không đọc hoặc lưu được đủ ${SHEET_NAMES.length} sheet CONT. Giữ nguyên bản thành công gần nhất.`;
```

- [ ] Mở rộng fixture `expectedRefresh.test.js` bằng dòng TKS1 và xác nhận `sheetName` tồn tại qua DB/API, tên SP vẫn từ báo cáo, chạy lần hai không có thay đổi thì không ghi lại. Không đổi SQL nếu test đã đạt.
- [ ] Chạy cả ba file test và kiểm tra diff trước lưu mốc commit Task 1; chỉ commit file thuộc thay đổi.

## Task 2: Cột Nguồn trên bảng và file xuất

**Files:** `server/public/index.html`, `server/productContainers/expectedExport.js`, `server/test/frontend/expected-arrivals.test.js`, `server/productContainers/expectedRoutes.test.js`.

**Interfaces:** Dùng `row.sheetName` hiện có. Thêm khóa xuất `sheetName` vào whitelist `/api/expected-arrivals/export/fields` và `/export?columns=...`; không đổi JSON của API đọc.

- [ ] Cập nhật test giao diện thành 11 cột, Nguồn ở vị trí 0, fixture có YIWU/CONT TKS1; thêm assert escape tên nguồn, giữ phân trang, lọc và quyền. Dịch các assert chỉ số ô phía sau thêm một vị trí. Kiểm tra tải/rỗng/lỗi có colspan 11.
- [ ] Thêm test export metadata có trường đầu tiên `{key:'sheetName',label:'Nguồn',type:'text',selected:true}`; xuất xlsx mặc định đọc bằng ExcelJS và HTML phải có nguồn đúng, chọn riêng `sheetName,quantity` đúng hai cột. Giữ test các lựa chọn cột cũ.
- [ ] Chạy hai file test trên để kiểm tra yêu cầu mới thất bại trước sửa mã.
- [ ] Thêm header đầu bảng và cell đầu mỗi dòng; dùng helper hiện tại:

```html
<th style="width:120px" data-column-key="nguon">Nguồn</th>
```

```js
// Trong expectedArrivalsRowHtml, trước ô scheduleLabel:
expectedArrivalsTextCell(r.sheetName) +
// Đầu COLUMNS trong expectedExport.js:
{ key: 'sheetName', label: 'Nguồn', type: 'text' },
```

- [ ] Sửa toàn bộ colspan/count 10 của riêng bảng expected thành 11, gồm callback render/pagination/error. Giữ `data-table-key` và tất cả `data-column-key` cũ; không thay các bảng khác. `table-controls.js` giữ cấu hình cột trong Map của phiên theo khóa cột, không lưu localStorage; sau tải lại trang dùng mặc định, nên không cần migration cấu hình hoặc sửa shared control. Kiểm tra cột mới hiện và thao tác độ rộng/ẩn các cột cũ không bị lệch.
- [ ] Chạy lại test frontend/export và kiểm tra diff trước lưu mốc commit Task 2.

## Task 3: Kiểm chứng, tài liệu và bàn giao

- [ ] Tại thư mục `server`, chạy nhóm test:

```powershell
node --test productContainers/parser.test.js productContainers/repository.test.js productContainers/expectedRefresh.test.js productContainers/expectedRoutes.test.js test/frontend/expected-arrivals.test.js test/frontend/table-controls.test.js test/frontend/table-controls-integration.test.js
npm test
```

- [ ] Kiểm tra trình duyệt bằng dữ liệu fixture với bảy nguồn: Nguồn ở đầu, sắp xếp/ẩn/hiện/độ rộng; cấu hình giữ trong phiên và trở về mặc định sau tải lại; phân trang; trạng thái rỗng/lỗi; xuất chọn cột; desktop/mobile 375px; sáng/tối. Dùng server thử có API fixture, không chạy job thật.
- [ ] Cập nhật danh sách nguồn tại `server/README.md`; bổ sung hành vi cột Nguồn và trạng thái triển khai trong README/CURRENT, BRD/SRS và implementation_plan theo skill update-file. Không mô tả schema thay đổi vì không migration; chỉ sửa tài liệu bị tác động.
- [ ] Chạy `git diff --check`, đọc lại tài liệu, kiểm tra chỉ các file liên quan thay đổi. Chạy `graphify update .` nếu công cụ có sẵn; nếu không có thì ghi rõ hạn chế.
- [ ] Báo kết quả test thực tế, giới hạn kiểm tra trình duyệt và trạng thái chưa deploy. Không chạy đồng bộ production, push hoặc deploy trong phạm vi kế hoạch này.

## Chấp nhận và vận hành

Đạt khi test xác nhận nguồn thứ bảy được lưu, tổng/chi tiết sử dụng cùng snapshot, bảng/file xuất có Nguồn đầu tiên, không mất dòng mã trùng và lỗi nguồn mới giữ nguyên bản cũ. Sau triển khai được ủy quyền riêng, quan sát lượt job đến hạn và log số dòng CONT TKS1; không ép chạy hoặc đổi metadata DB để vượt lịch.
