'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');

test('cả 2 bảng kết quả có cột Các đợt đứt hàng', () => {
  assert.equal((html.match(/<th>Các đợt đứt hàng<\/th>/g) || []).length, 2);
});

test('giao diện định dạng mỗi đợt dd/mm/yyyy -> dd/mm/yyyy và nối bằng xuống dòng', () => {
  assert.match(html, /function formatStockoutPeriods/);
  assert.match(html, /join\('<br>'\)/);
  assert.match(html, /formatStockoutDate\(p\.fromDate\).* -&gt; .*formatStockoutDate\(p\.toDate\)/s);
});

test('mô tả tính năng hàng đứt gần đây dùng ngưỡng 5 ngày', () => {
  assert.doesNotMatch(html, /liên tục \(tính đến hôm nay\) ≥ 7 ngày/);
  assert.match(html, /liên tục \(tính đến hôm nay\) ≥ 5 ngày/);
});

test('cache kết quả stockout có version và không phục hồi payload cũ thiếu periods', () => {
  assert.match(html, /const STOCKOUT_RESULT_SCHEMA_VERSION = 3/);
  assert.match(html, /schemaVersion: STOCKOUT_RESULT_SCHEMA_VERSION/g);
  assert.match(html, /function hasCurrentStockoutResultShape/);
  assert.match(html, /saved\.schemaVersion !== STOCKOUT_RESULT_SCHEMA_VERSION/g);
  assert.match(html, /sessionStorage\.removeItem\('stockout90d:lastState'\)/);
});

test('ket qua dut hang dung sessionStorage (khong dung localStorage) de tranh lo du lieu giua cac tai khoan', () => {
  assert.doesNotMatch(html, /localStorage\.(setItem|getItem|removeItem)\('recentStockout:lastState'\)/);
  assert.doesNotMatch(html, /localStorage\.(setItem|getItem|removeItem)\('stockout90d:lastState'\)/);
  assert.match(html, /sessionStorage\.setItem\('recentStockout:lastState'/);
  assert.match(html, /sessionStorage\.setItem\('stockout90d:lastState'/);
});

test('moi bang ket qua dut hang co nut xoa danh sach', () => {
  assert.match(html, /function clearRecentStockoutResult/);
  assert.match(html, /function clearStockout90dResult/);
  assert.match(html, /onclick="clearRecentStockoutResult\(\)"/);
  assert.match(html, /onclick="clearStockout90dResult\(\)"/);
});

test('giao diện hiển thị cảnh báo từ result.warnings (vd thiếu dữ liệu Trả NCC)', () => {
  // Khong con fallback Sheets cho Hoa don/Nhap hang (chi API KiotViet, tru
  // rieng Tra NCC) nen khong con canh bao dang "Google Sheets dự phòng" —
  // co che hien thi canh bao chung (result.warnings) van con, vi Tra NCC van
  // co canh bao do phu du lieu.
  assert.match(html, /function formatStockoutSourceWarnings/);
  assert.match(html, /result\.warnings/);
});

test('kết quả mới từ backend cũ thiếu periods bị báo lỗi thay vì render ô trống', () => {
  assert.match(html, /Kết quả máy chủ chưa có dữ liệu các đợt đứt hàng/);
  assert.match(html, /hasCurrentStockoutResultShape\(payload\.result\)/g);
});
