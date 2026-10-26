(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RteTable = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Thao tac bang cho trinh soan van ban (DOM thuan, khong dung window/document toan cuc).
  // Moi thao tac dua tren luoi o ao (buildGrid) de xu ly dung colspan/rowspan.

  var MIN_WIDTH = 40;
  var MAX_WIDTH = 800;
  var BORDER_STYLES = ['all', 'outer', 'none'];
  var BORDER_WIDTHS = [1, 2, 3];
  var HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

  function spanOf(cell, attr) {
    var n = parseInt(cell.getAttribute(attr), 10);
    if (!(n >= 1)) return 1;
    return Math.min(n, 1000);
  }

  function setSpan(cell, attr, n) {
    if (n > 1) cell.setAttribute(attr, String(n));
    else cell.removeAttribute(attr);
  }

  function tableOf(cell) {
    return cell && cell.closest ? cell.closest('table') : null;
  }

  function buildGrid(table) {
    var rows = table.rows;
    var grid = [];
    var r;
    for (r = 0; r < rows.length; r++) grid[r] = [];
    for (r = 0; r < rows.length; r++) {
      var c = 0;
      var cells = rows[r].cells;
      for (var k = 0; k < cells.length; k++) {
        var cell = cells[k];
        while (grid[r][c]) c++;
        var rs = Math.min(spanOf(cell, 'rowspan'), rows.length - r);
        var cs = spanOf(cell, 'colspan');
        for (var i = 0; i < rs; i++) {
          for (var j = 0; j < cs; j++) grid[r + i][c + j] = cell;
        }
        c += cs;
      }
    }
    return grid;
  }

  function gridCols(grid) {
    var n = 0;
    for (var r = 0; r < grid.length; r++) n = Math.max(n, grid[r].length);
    return n;
  }

  // o -> cot bat dau (lan xuat hien dau tien theo thu tu hang)
  function startCols(grid) {
    var map = new Map();
    for (var r = 0; r < grid.length; r++) {
      for (var c = 0; c < grid[r].length; c++) {
        var cell = grid[r][c];
        if (cell && !map.has(cell)) map.set(cell, c);
      }
    }
    return map;
  }

  function findPos(grid, cell) {
    for (var r = 0; r < grid.length; r++) {
      for (var c = 0; c < grid[r].length; c++) {
        if (grid[r][c] === cell) return { row: r, col: c };
      }
    }
    return null;
  }

  function cellPosition(cell) {
    var table = tableOf(cell);
    if (!table) return null;
    return findPos(buildGrid(table), cell);
  }

  function newCell(doc, tag) {
    var el = doc.createElement(tag);
    el.appendChild(doc.createElement('br'));
    return el;
  }

  function allTh(row) {
    if (!row || !row.cells.length) return false;
    for (var i = 0; i < row.cells.length; i++) {
      if (row.cells[i].tagName !== 'TH') return false;
    }
    return true;
  }

  // Chen cell vao row dung vi tri cot: truoc o dau tien co cot bat dau >= col
  function placeInRow(row, cell, col, colOf) {
    var cells = row.cells;
    for (var i = 0; i < cells.length; i++) {
      var sc = colOf.get(cells[i]);
      if (sc !== undefined && sc >= col) {
        row.insertBefore(cell, cells[i]);
        return;
      }
    }
    row.appendChild(cell);
  }

  function removeTable(table) {
    var parent = table.parentNode;
    if (!parent) return null;
    if (!table.nextElementSibling) {
      var doc = table.ownerDocument;
      var p = doc.createElement('p');
      p.appendChild(doc.createElement('br'));
      parent.replaceChild(p, table);
      return p;
    }
    parent.removeChild(table);
    return null;
  }

  function insertRow(cell, before) {
    var table = tableOf(cell);
    if (!table) return null;
    var grid = buildGrid(table);
    var pos = findPos(grid, cell);
    if (!pos) return null;
    var rows = table.rows;
    var doc = table.ownerDocument;
    var rs = Math.min(spanOf(cell, 'rowspan'), grid.length - pos.row);
    var idx = before ? pos.row : pos.row + rs;
    var cols = gridCols(grid);
    var tag = before && allTh(rows[pos.row]) ? 'th' : 'td';
    var tr = doc.createElement('tr');
    var seen = new Set();
    for (var c = 0; c < cols; c++) {
      var above = idx > 0 && idx < grid.length ? grid[idx - 1][c] : null;
      var below = idx > 0 && idx < grid.length ? grid[idx][c] : null;
      if (above && above === below) {
        if (!seen.has(above)) {
          seen.add(above);
          setSpan(above, 'rowspan', spanOf(above, 'rowspan') + 1);
        }
        continue;
      }
      tr.appendChild(newCell(doc, tag));
    }
    if (before) {
      var refRow = rows[pos.row];
      refRow.parentNode.insertBefore(tr, refRow);
    } else {
      var lastRow = rows[pos.row + rs - 1];
      var section = lastRow.parentNode;
      if (section.nodeName === 'THEAD') {
        // dong moi sau dong tieu de nam o tbody
        var body = section.nextElementSibling;
        while (body && body.nodeName !== 'TBODY') body = body.nextElementSibling;
        if (!body) {
          body = doc.createElement('tbody');
          section.parentNode.insertBefore(body, section.nextSibling);
        }
        body.insertBefore(tr, body.firstChild);
      } else {
        section.insertBefore(tr, lastRow.nextSibling);
      }
    }
    return tr;
  }

  function insertColumn(cell, before) {
    var table = tableOf(cell);
    if (!table) return false;
    var grid = buildGrid(table);
    var pos = findPos(grid, cell);
    if (!pos) return false;
    var rows = table.rows;
    var doc = table.ownerDocument;
    var cols = gridCols(grid);
    var cs = Math.min(spanOf(cell, 'colspan'), cols - pos.col);
    var c = before ? pos.col : pos.col + cs;
    var refCol = before ? pos.col : pos.col + cs - 1;
    var colOf = startCols(grid);
    var seen = new Set();
    var created = [];
    for (var r = 0; r < grid.length; r++) {
      var left = c > 0 && c < cols ? grid[r][c - 1] : null;
      var right = c > 0 && c < cols ? grid[r][c] : null;
      if (left && left === right) {
        if (!seen.has(left)) {
          seen.add(left);
          setSpan(left, 'colspan', spanOf(left, 'colspan') + 1);
        }
        continue;
      }
      var ref = grid[r][refCol];
      var tag = ref ? ref.tagName.toLowerCase() : 'td';
      var nc = newCell(doc, tag === 'th' ? 'th' : 'td');
      placeInRow(rows[r], nc, c, colOf);
      created.push(nc);
    }
    return created.length > 0 || seen.size > 0;
  }

  function deleteRow(cell) {
    var table = tableOf(cell);
    if (!table) return false;
    var grid = buildGrid(table);
    var pos = findPos(grid, cell);
    if (!pos) return false;
    if (grid.length <= 1) {
      removeTable(table);
      return { removedTable: true };
    }
    var rows = table.rows;
    var R = pos.row;
    var row = rows[R];
    var colOf = startCols(grid);
    var seen = new Set();
    var moved = [];
    var c;
    for (c = 0; c < grid[R].length; c++) {
      var x = grid[R][c];
      if (!x || seen.has(x)) continue;
      seen.add(x);
      var rsx = spanOf(x, 'rowspan');
      if (x.parentNode === row) {
        if (rsx > 1 && R + 1 < rows.length) moved.push(x);
      } else {
        setSpan(x, 'rowspan', rsx - 1);
      }
    }
    var next = rows[R + 1];
    moved.sort(function (a, b) { return colOf.get(a) - colOf.get(b); });
    moved.forEach(function (x) {
      setSpan(x, 'rowspan', spanOf(x, 'rowspan') - 1);
      placeInRow(next, x, colOf.get(x), colOf);
    });
    var section = row.parentNode;
    section.removeChild(row);
    if (!section.rows.length && section.parentNode && section !== table) section.parentNode.removeChild(section);
    return { removedTable: false };
  }

  function deleteColumn(cell) {
    var table = tableOf(cell);
    if (!table) return false;
    var grid = buildGrid(table);
    var pos = findPos(grid, cell);
    if (!pos) return false;
    if (gridCols(grid) <= 1) {
      removeTable(table);
      return { removedTable: true };
    }
    var C = pos.col;
    var seen = new Set();
    for (var r = 0; r < grid.length; r++) {
      var x = grid[r][C];
      if (!x || seen.has(x)) continue;
      seen.add(x);
      var csx = spanOf(x, 'colspan');
      if (csx > 1) setSpan(x, 'colspan', csx - 1);
      else x.parentNode.removeChild(x);
    }
    return { removedTable: false };
  }

  function isEmptyCell(cell) {
    if (cell.textContent.replace(/[\s ]+/g, '') !== '') return false;
    return !cell.querySelector('img,table,hr,video,iframe');
  }

  function mergeCells(cellA, cellB) {
    if (!cellA || !cellB) return false;
    var table = tableOf(cellA);
    if (!table || tableOf(cellB) !== table) return false;
    var grid = buildGrid(table);
    var pa = findPos(grid, cellA);
    var pb = findPos(grid, cellB);
    if (!pa || !pb) return false;
    var r1 = Math.min(pa.row, pb.row);
    var c1 = Math.min(pa.col, pb.col);
    var r2 = Math.max(pa.row + Math.min(spanOf(cellA, 'rowspan'), grid.length - pa.row),
      pb.row + Math.min(spanOf(cellB, 'rowspan'), grid.length - pb.row)) - 1;
    var cols = gridCols(grid);
    var c2 = Math.max(pa.col + Math.min(spanOf(cellA, 'colspan'), cols - pa.col),
      pb.col + Math.min(spanOf(cellB, 'colspan'), cols - pb.col)) - 1;

    var inRect = new Set();
    var r, c;
    for (r = r1; r <= r2; r++) {
      for (c = c1; c <= c2; c++) {
        var x = grid[r][c];
        if (!x) return false;
        inRect.add(x);
      }
    }
    if (inRect.size < 2) return false;
    // moi o trong vung phai nam tron trong vung (khong cat o gop khac)
    var ok = true;
    inRect.forEach(function (x) {
      var p = findPos(grid, x);
      var xr2 = p.row + Math.min(spanOf(x, 'rowspan'), grid.length - p.row) - 1;
      var xc2 = p.col + Math.min(spanOf(x, 'colspan'), cols - p.col) - 1;
      if (p.row < r1 || p.col < c1 || xr2 > r2 || xc2 > c2) ok = false;
    });
    if (!ok) return false;

    var target = grid[r1][c1];
    var ordered = [];
    var seen = new Set();
    for (r = r1; r <= r2; r++) {
      for (c = c1; c <= c2; c++) {
        var y = grid[r][c];
        if (!seen.has(y)) { seen.add(y); ordered.push(y); }
      }
    }
    var doc = table.ownerDocument;
    if (isEmptyCell(target)) {
      while (target.firstChild) target.removeChild(target.firstChild);
    }
    ordered.forEach(function (o) {
      if (o === target) return;
      if (!isEmptyCell(o)) {
        if (target.firstChild) target.appendChild(doc.createElement('br'));
        while (o.firstChild) target.appendChild(o.firstChild);
      }
      o.parentNode.removeChild(o);
    });
    if (!target.firstChild) target.appendChild(doc.createElement('br'));
    setSpan(target, 'colspan', c2 - c1 + 1);
    setSpan(target, 'rowspan', r2 - r1 + 1);
    return true;
  }

  function splitCell(cell) {
    var table = tableOf(cell);
    if (!table) return false;
    var grid = buildGrid(table);
    var pos = findPos(grid, cell);
    if (!pos) return false;
    var cols = gridCols(grid);
    var cs = Math.min(spanOf(cell, 'colspan'), cols - pos.col);
    var rs = Math.min(spanOf(cell, 'rowspan'), grid.length - pos.row);
    if (cs <= 1 && rs <= 1) {
      cell.removeAttribute('colspan');
      cell.removeAttribute('rowspan');
      return false;
    }
    var rows = table.rows;
    var doc = table.ownerDocument;
    var colOf = startCols(grid);
    cell.removeAttribute('colspan');
    cell.removeAttribute('rowspan');
    for (var r = pos.row; r < pos.row + rs; r++) {
      for (var c = pos.col; c < pos.col + cs; c++) {
        if (r === pos.row && c === pos.col) continue;
        var nc = newCell(doc, 'td');
        placeInRow(rows[r], nc, c, colOf);
        colOf.set(nc, c);
      }
    }
    return true;
  }

  function getStyleVars(table) {
    return (table.getAttribute('style') || '')
      .split(';')
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s && !/^--tb-color\s*:/i.test(s); });
  }

  function setBorder(table, opts) {
    if (!table || !opts) return;
    if ('style' in opts) {
      var st = opts.style;
      if (st === '' || st === null) table.removeAttribute('data-border');
      else if (BORDER_STYLES.indexOf(st) !== -1) table.setAttribute('data-border', st);
    }
    if ('width' in opts) {
      var w = opts.width;
      if (w === '' || w === null) {
        table.removeAttribute('data-border-width');
      } else {
        var wn = typeof w === 'number' ? w : (typeof w === 'string' && /^\d$/.test(w) ? Number(w) : NaN);
        if (BORDER_WIDTHS.indexOf(wn) !== -1) table.setAttribute('data-border-width', String(wn));
      }
    }
    if ('color' in opts) {
      var col = opts.color;
      var rest = getStyleVars(table);
      var changed = false;
      if (col === '' || col === null) {
        changed = true;
      } else if (typeof col === 'string' && HEX_RE.test(col.trim())) {
        rest.push('--tb-color:' + col.trim().toLowerCase());
        changed = true;
      }
      if (changed) {
        if (rest.length) table.setAttribute('style', rest.join(';'));
        else table.removeAttribute('style');
      }
    }
  }

  function cellsAtColumn(table, colIndex) {
    var grid = buildGrid(table);
    var out = [];
    var seen = new Set();
    for (var r = 0; r < grid.length; r++) {
      var x = grid[r][colIndex];
      if (!x || seen.has(x)) continue;
      seen.add(x);
      if (spanOf(x, 'colspan') === 1 && findPos(grid, x).col === colIndex) out.push(x);
    }
    return out;
  }

  function setColumnWidth(table, colIndex, px) {
    var n = Math.round(Number(px));
    if (!isFinite(n) || colIndex < 0) return null;
    n = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, n));
    cellsAtColumn(table, colIndex).forEach(function (cell) {
      cell.setAttribute('width', String(n));
    });
    return n;
  }

  function getColumnWidth(table, colIndex) {
    var cells = cellsAtColumn(table, colIndex);
    for (var i = 0; i < cells.length; i++) {
      var w = parseInt(cells[i].getAttribute('width'), 10);
      if (w > 0) return w;
    }
    return null;
  }

  return {
    MIN_WIDTH: MIN_WIDTH,
    MAX_WIDTH: MAX_WIDTH,
    buildGrid: buildGrid,
    cellPosition: cellPosition,
    insertRow: insertRow,
    insertColumn: insertColumn,
    deleteRow: deleteRow,
    deleteColumn: deleteColumn,
    mergeCells: mergeCells,
    splitCell: splitCell,
    setBorder: setBorder,
    setColumnWidth: setColumnWidth,
    getColumnWidth: getColumnWidth,
    removeTable: removeTable
  };
});
