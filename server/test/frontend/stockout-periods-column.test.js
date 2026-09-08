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
  assert.match(html, /localStorage\.removeItem\('stockout90d:lastState'\)/);
});

test('giao diện hiển thị cảnh báo khi một nguồn dùng Google Sheets dự phòng', () => {
  assert.match(html, /function formatStockoutSourceWarnings/);
  assert.match(html, /Google Sheets dự phòng/);
  assert.match(html, /result\.warnings/);
});

test('kết quả mới từ backend cũ thiếu periods bị báo lỗi thay vì render ô trống', () => {
  assert.match(html, /Kết quả máy chủ chưa có dữ liệu các đợt đứt hàng/);
  assert.match(html, /hasCurrentStockoutResultShape\(payload\.result\)/g);
});
