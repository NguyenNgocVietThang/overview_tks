// Chon o kieu Google Sheet cho bang Nhap VAT: bam/keo chuot chon vung o chu nhat (khong boi den chu),
// Shift+click noi vung, Ctrl+C chep TSV (khong kem tieu de) de dan sang Excel/Sheet, Esc bo chon.
(function (root) {
  'use strict';

  var SEL = 'vd-cell-sel';
  var ANCHOR = 'vd-cell-anchor';
  var active = null; // { table, anchor:{r,c}, focus:{r,c} }
  var dragging = false;

  function rowsOf(table) {
    return Array.from(table.tBodies[0] ? table.tBodies[0].rows : []).filter(function (tr) {
      return !tr.classList.contains('vd-empty') && !tr.classList.contains('tks-row-hidden') && !tr.hidden;
    });
  }

  function isHidden(cell) { return cell.classList.contains('tks-column-hidden') || cell.hidden || cell.style.display === 'none'; }

  function locate(table, target) {
    var cell = target && target.closest ? target.closest('td') : null;
    if (!cell || !table.contains(cell) || !table.tBodies[0] || !table.tBodies[0].contains(cell)) return null;
    var r = rowsOf(table).indexOf(cell.parentElement);
    return r < 0 ? null : { r: r, c: cell.cellIndex };
  }

  function clear() {
    if (!active) return;
    active.table.querySelectorAll('td.' + SEL + ', td.' + ANCHOR).forEach(function (td) { td.classList.remove(SEL, ANCHOR); });
    active.table.classList.remove('vd-cell-selecting');
    active = null;
  }

  function paint() {
    var t = active.table;
    t.querySelectorAll('td.' + SEL + ', td.' + ANCHOR).forEach(function (td) { td.classList.remove(SEL, ANCHOR); });
    var r0 = Math.min(active.anchor.r, active.focus.r), r1 = Math.max(active.anchor.r, active.focus.r);
    var c0 = Math.min(active.anchor.c, active.focus.c), c1 = Math.max(active.anchor.c, active.focus.c);
    rowsOf(t).forEach(function (tr, r) {
      if (r < r0 || r > r1) return;
      Array.from(tr.cells).forEach(function (td) { if (td.cellIndex >= c0 && td.cellIndex <= c1) td.classList.add(SEL); });
    });
    var anchorRow = rowsOf(t)[active.anchor.r];
    if (anchorRow && anchorRow.cells[active.anchor.c]) anchorRow.cells[active.anchor.c].classList.add(ANCHOR);
  }

  function cellText(td) {
    var text = (typeof td.innerText === 'string' ? td.innerText : td.textContent) || '';
    text = text.replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '');
    // Excel/Sheet hieu o nhieu dong neu boc trong ngoac kep (nhan doi ngoac kep ben trong).
    return /[\t\n"]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  /** TSV cua vung dang chon (bo cot an, khong kem tieu de); chuoi rong neu khong co vung chon. */
  function selectionText(table) {
    var lines = [];
    rowsOf(table).forEach(function (tr) {
      var cells = Array.from(tr.cells).filter(function (td) { return td.classList.contains(SEL) && !isHidden(td); });
      if (cells.length) lines.push(cells.map(cellText).join('\t'));
    });
    return lines.join('\n');
  }

  function attach(table) {
    if (!table || table.dataset.cellSelect === 'on') return;
    table.dataset.cellSelect = 'on';
    table.addEventListener('mousedown', function (event) {
      if (event.button !== 0 || event.target.closest('a,button,input,select,textarea,label')) return;
      var pos = locate(table, event.target);
      if (!pos) return;
      event.preventDefault(); // khong boi den chu
      var selection = root.getSelection && root.getSelection();
      if (selection && selection.removeAllRanges) selection.removeAllRanges();
      if (document.activeElement && document.activeElement !== document.body && document.activeElement.blur) document.activeElement.blur();
      if (event.shiftKey && active && active.table === table) { active.focus = pos; }
      else { clear(); active = { table: table, anchor: pos, focus: pos }; }
      table.classList.add('vd-cell-selecting');
      dragging = true;
      paint();
    });
    table.addEventListener('mouseover', function (event) {
      if (!dragging || !active || active.table !== table) return;
      var pos = locate(table, event.target);
      if (pos && (pos.r !== active.focus.r || pos.c !== active.focus.c)) { active.focus = pos; paint(); }
    });
    // Bang ve lai (sap xep, xu ly lai) -> vung chon cu khong con dung.
    if (table.tBodies[0] && root.MutationObserver) {
      new root.MutationObserver(function () { if (active && active.table === table && !table.querySelector('td.' + SEL)) clear(); })
        .observe(table.tBodies[0], { childList: true });
    }
  }

  function init(tables) {
    (tables || []).forEach(attach);
    if (document.documentElement.dataset.vdCellSelectInit) return;
    document.documentElement.dataset.vdCellSelectInit = '1';
    document.addEventListener('mouseup', function () { dragging = false; });
    document.addEventListener('mousedown', function (event) {
      if (active && !active.table.contains(event.target)) clear();
    });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape') clear(); });
    document.addEventListener('copy', function (event) {
      if (!active) return;
      var selection = root.getSelection && root.getSelection();
      if (selection && String(selection).length) return; // dang boi den chu o cho khac -> de trinh duyet chep
      var text = selectionText(active.table);
      if (!text || !event.clipboardData) return;
      event.clipboardData.setData('text/plain', text);
      event.preventDefault();
    });
  }

  root.TKSCellSelect = { init: init, attach: attach, clear: clear, selectionText: selectionText };
})(window);
