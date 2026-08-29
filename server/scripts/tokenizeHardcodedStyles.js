#!/usr/bin/env node
/**
 * Phase A — thay thế các giá trị cố định (hardcoded) của box-shadow / border-radius / mã màu
 * bên trong khối <style> của file HTML bằng biến CSS tùy chỉnh (custom properties),
 * mà không làm thay đổi bất kỳ giá trị tính toán (resolved value) nào.
 *
 * Chỉ tác động đến văn bản giữa cặp <style> ... </style> ĐẦU TIÊN. Mọi phép thay thế
 * bên dưới đều là thay thế chuỗi con chính xác để không ảnh hưởng đến nội dung ngoài ý muốn.
 * Chạy server/scripts/styleBaselineSnapshot.js trước/sau và dùng `compare` hai snapshot
 * để chứng minh CSS sau khi resolve không bị thay đổi.
 *
 * Cách dùng: node tokenizeHardcodedStyles.js <file.html>
 */
'use strict';

const fs = require('fs');

// [chuỗiCầnTìm, chuỗiThayThế, sốLầnKỳVọng|null]
// sốLầnKỳVọng === null nghĩa là "thay thế tất cả các lần xuất hiện, không kiểm tra số lượng"
// (chỉ dùng cho các bí danh kênh RGB an toàn bên dưới).
const REPLACEMENTS = [
  // --- Thang đo border-radius ---
  ['border-radius: 2px;', 'border-radius: var(--radius-2);', 1],
  ['border-radius: 4px;', 'border-radius: var(--radius-4);', 3],
  ['border-radius: 5px;', 'border-radius: var(--radius-5);', 1],
  ['border-radius: 6px;', 'border-radius: var(--radius-6);', 4],
  ['border-radius: 7px;', 'border-radius: var(--radius-7);', 11],
  ['border-radius: 8px;', 'border-radius: var(--radius-8);', 11],
  ['border-radius: 9px;', 'border-radius: var(--radius-9);', 3],
  ['border-radius: 10px;', 'border-radius: var(--radius-10);', 6],
  ['border-radius: 12px;', 'border-radius: var(--radius-12);', 5],
  ['border-radius: 14px;', 'border-radius: var(--radius-14);', 2],
  ['border-radius: 50%;', 'border-radius: var(--radius-circle);', 3],
  ['border-radius: 999px;', 'border-radius: var(--radius-pill);', 3],
  ['border-radius: 9999px;', 'border-radius: var(--radius-pill-lg);', 2],
  ['border-radius: 0 0 7px 0;', 'border-radius: 0 0 var(--radius-7) 0;', 2],
  ['border-radius: 0 0 0 7px;', 'border-radius: 0 0 0 var(--radius-7);', 2],

  // --- Các mã màu hex đơn lẻ dùng bên ngoài khối token :root ---
  // (trường hợp `border: 1px solid #E2E8F0;` duy nhất đã được chuẩn hóa
  // thủ công thành var(--border) — xem ghi chú Phase A — nên không lặp lại ở đây)
  ['#fff', 'var(--white)', 3],

  // --- Bí danh kênh RGB (giá trị cố định — xem giải thích phía trên
  //     định nghĩa token trong :root về lý do tại sao không đổi theo theme) ---
  ['rgba(0, 0, 0, ', 'rgba(var(--shadow-rgb), ', null],
  ['rgba(255, 255, 255, ', 'rgba(var(--overlay-rgb), ', null],
  ['rgba(59, 130, 246, ', 'rgba(var(--primary-rgb-d), ', null],
  ['rgba(37, 99, 235, ', 'rgba(var(--primary-rgb-l), ', null],
  ['rgba(16, 185, 129, ', 'rgba(var(--glow-green-rgb), ', null],
  ['rgba(239, 68, 68, ', 'rgba(var(--glow-red-rgb), ', null],
];

function countOccurrences(haystack, needle) {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node tokenizeHardcodedStyles.js <file.html>');
    process.exit(1);
  }

  const html = fs.readFileSync(file, 'utf8');
  const openTag = '<style>';
  const closeTag = '</style>';
  const openIdx = html.indexOf(openTag);
  const closeIdx = html.indexOf(closeTag, openIdx);
  if (openIdx === -1 || closeIdx === -1) {
    console.error('Could not locate a <style>...</style> block');
    process.exit(1);
  }

  const before = html.slice(0, openIdx + openTag.length);
  let style = html.slice(openIdx + openTag.length, closeIdx);
  const after = html.slice(closeIdx);

  const report = [];
  for (const [find, replace, expected] of REPLACEMENTS) {
    const actual = countOccurrences(style, find);
    if (expected !== null && actual !== expected) {
      console.error(`ABORT: expected ${expected} occurrence(s) of ${JSON.stringify(find)}, found ${actual}. No changes written.`);
      process.exit(1);
    }
    style = style.split(find).join(replace);
    report.push({ find, replace, count: actual });
  }

  fs.writeFileSync(file, before + style + after);
  for (const r of report) {
    console.log(`${String(r.count).padStart(3)}x  ${r.find}  ->  ${r.replace}`);
  }
  console.log(`\nDone. ${report.length} replacement rules applied to ${file}.`);
}

main();
