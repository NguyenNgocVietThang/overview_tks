/* Tự căn phải các cột số liệu trong mọi bảng.
   Bảng được dựng bằng JS (innerHTML) nên không gắn class sẵn được: quét từng
   bảng, cột nào mọi ô có dữ liệu đều là số / tiền / % thì gắn .col-num cho
   th + td (CSS trong shared.css). Chạy lại khi DOM đổi (lọc, sắp xếp, phân trang). */
(function () {
  'use strict';

  // 1.234.567 · -12,5 · 45% · 1.200đ · 3 ngày. Không khớp ngày (12/09), mã (SP001).
  var NUMERIC = /^[+\-−–]?\s*\d[\d.,\s]*\s*(%|đ|₫|vnđ|vnd|ngày|lần|kg|g)?$/i;
  // Số điện thoại / mã vạch: chuỗi số dài không có dấu phân cách → không phải số liệu.
  var ID_LIKE = /^(0\d{8,}|\d{11,})$/;
  var EMPTY = /^[\s\-–—]*$/;

  // Tiêu đề thuộc nhóm số lượng / tiền / tỷ lệ → luôn căn phải, kể cả khi có ô chữ lẫn vào.
  var NUM_HEADER = /số lượng|(^|\s)sl(\s|$)|doanh thu|doanh số|^ds(\s|$)|giá|tiền|tồn|tỷ lệ|tỉ lệ|%|số ngày|số lần|(^|\s)nợ(\s|$)|thuế|chiết khấu|giảm giá|^đặt$|khách đặt|^t\./i;

  function isNumericText(t) {
    if (!NUMERIC.test(t)) return false;
    return !ID_LIKE.test(t.replace(/\s/g, ''));
  }

  function alignTable(table) {
    var head = table.tHead && table.tHead.rows[table.tHead.rows.length - 1];
    if (!head || table.tHead.querySelector('[colspan],[rowspan]')) return;

    var cols = head.cells.length;
    var seen = new Array(cols);
    var ok = new Array(cols);
    for (var i = 0; i < cols; i++) { seen[i] = 0; ok[i] = true; }

    var rows = [];
    Array.prototype.forEach.call(table.tBodies, function (b) { rows.push.apply(rows, b.rows); });
    if (table.tFoot) rows.push.apply(rows, table.tFoot.rows);

    rows.forEach(function (tr) {
      if (tr.querySelector('[colspan]') || tr.cells.length !== cols) return;
      for (var c = 0; c < cols; c++) {
        var t = tr.cells[c].textContent.trim();
        if (EMPTY.test(t)) continue;
        seen[c]++;
        if (!isNumericText(t)) ok[c] = false;
      }
    });

    for (var c = 0; c < cols; c++) {
      var isNum = NUM_HEADER.test(head.cells[c].textContent.trim()) || (seen[c] > 0 && ok[c]);
      head.cells[c].classList.toggle('col-num', isNum);
      rows.forEach(function (tr) {
        if (tr.cells.length === cols && !tr.querySelector('[colspan]')) {
          tr.cells[c].classList.toggle('col-num', isNum);
        }
      });
    }
  }

  function run() {
    Array.prototype.forEach.call(document.querySelectorAll('table'), alignTable);
  }

  var queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; run(); });
  }

  function start() {
    run();
    // Chỉ theo dõi childList (không attributes) nên việc gắn class không tự kích hoạt lại.
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
