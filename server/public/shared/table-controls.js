/* Shared by the dashboard and standalone HTML reports. All choices live only
   in this document; stable table/field keys survive DOM replacements. */
(function () {
  'use strict';
  if (window.TKSTables) return;
  var sessions = new Map(), controllers = new WeakMap(), buttonControllers = new WeakMap();
  var wiredHandles = new WeakSet();
  var picker = null, active = null, opener = null, drag = null, queued = false;
  var MIN_WIDTH = 64;
  var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"></rect><line x1="9" y1="4" x2="9" y2="20"></line><line x1="15" y1="4" x2="15" y2="20"></line></svg>';

  function screenMode() { return window.innerWidth <= 600 ? 'mobile' : 'desktop'; }
  function labelOf(cell) {
    var copy = cell.cloneNode(true);
    copy.querySelectorAll('.tks-column-resizer,.sort-indicator,.sort-ind,.sort,.locations-sort-icon').forEach(function (node) { node.remove(); });
    return copy.textContent.replace(/[↕▲▼↑↓]+$/g, '').replace(/\s+/g, ' ').trim();
  }
  function defaultWidth(key, label) {
    var text = (key + ' ' + label).toLowerCase();
    if (/note|ghi chú|nội dung|lý do|reason/.test(text)) return 280;
    if (/name|tên|khách hàng|customer|employee|nhân viên|sale|mặt hàng|hàng hóa/.test(text) && !/mã|code|id|tiền|doanh|số lượng/.test(text)) return 240;
    if (/quantity|qty|số lượng|(^|\s)sl(\s|$)|tồn kho|khách đặt/.test(text)) return 112;
    return 160;
  }
  // Remember the authored spans because visibility changes the DOM colSpan.
  // Build the logical grid independently for each header/body/footer group.
  function grid(section) {
    var occupied = [], entries = [], count = 0;
    if (!section) return { entries: entries, count: count };
    Array.from(section.rows).forEach(function (row, rowIndex) {
      var cursor = 0;
      Array.from(row.cells).forEach(function (cell) {
        if (!cell.dataset.tksColspan) cell.dataset.tksColspan = String(cell.colSpan);
        var span = Number(cell.dataset.tksColspan) || 1;
        while (occupied[cursor] > rowIndex) cursor++;
        var rowSpan = cell.rowSpan || (section.rows.length - rowIndex);
        entries.push({ cell: cell, start: cursor, span: span, row: row });
        for (var i = cursor; i < cursor + span; i++) occupied[i] = rowIndex + rowSpan;
        cursor += span; count = Math.max(count, cursor);
      });
    });
    return { entries: entries, count: count };
  }
  function headers(table) {
    var head = grid(table.tHead), leaves = [];
    for (var i = 0; i < head.count; i++) {
      var candidates = head.entries.filter(function (entry) { return entry.start <= i && entry.start + entry.span > i; });
      leaves.push(candidates.reverse().find(function (entry) { return entry.span === 1; }) || candidates[0]);
    }
    return { grid: head, leaves: leaves };
  }
  function tableKey(table) {
    if (table.dataset.tableKey) return table.dataset.tableKey;
    if (table.id) return table.id;
    var body = table.tBodies[0];
    if (body && body.id) return body.id;
    // Explicit keys on dynamic report tables avoid dependence on row data.
    var host = table.closest('[id]');
    var scope = host || document;
    return (host ? host.id : location.pathname) + ':table:' + Array.from(scope.querySelectorAll('table')).indexOf(table);
  }
  function pxWidth(value) {
    return /^\d+(\.\d+)?(px)?$/.test(String(value || '')) ? Number.parseFloat(value) : 0;
  }
  function changeStyle(node, property, value) {
    if (node.style.getPropertyValue(property) !== value || node.style.getPropertyPriority(property) !== 'important') node.style.setProperty(property, value, 'important');
  }
  function hasLayout(table) {
    return table.isConnected && table.getClientRects().length > 0;
  }
  function fitOnce(ctrl) {
    if (ctrl.session.fitted || !hasLayout(ctrl.table)) return;
    var wrapper = ctrl.table.parentElement;
    var width = wrapper.clientWidth;
    var visible = ctrl.columns.filter(function (column) { return !column.hidden && !column.suppressed; });
    var total = visible.reduce(function (sum, column) { return sum + column.width; }, 0);
    if (width > total && total) visible.forEach(function (column) { column.width *= width / total; });
    ctrl.session.fitted = true;
  }
  function attachHandle(ctrl, cell, column) {
    if (window.getComputedStyle(cell).position === 'static') cell.style.position = 'relative';
    var handle = cell.querySelector(':scope > .tks-column-resizer');
    if (!handle) {
      handle = document.createElement('span');
      handle.className = 'tks-column-resizer'; handle.tabIndex = 0;
      handle.setAttribute('role', 'separator'); handle.setAttribute('aria-orientation', 'vertical');
      cell.appendChild(handle);
    }
    if (!wiredHandles.has(handle)) {
      wiredHandles.add(handle);
      handle.addEventListener('click', function (event) { event.preventDefault(); event.stopPropagation(); });
      handle.addEventListener('dblclick', function (event) { event.preventDefault(); event.stopPropagation(); });
      handle.addEventListener('keydown', function (event) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault(); event.stopPropagation();
        var current = controllers.get(ctrl.table), col = current.columns.find(function (item) { return item.key === handle.dataset.columnKey; });
        resize(current, col, col.width + (event.key === 'ArrowRight' ? 10 : -10));
      });
      handle.addEventListener('pointerdown', function (event) {
        if (event.button !== 0) return;
        event.preventDefault(); event.stopPropagation();
        finishDrag();
        var current = controllers.get(ctrl.table), col = current.columns.find(function (item) { return item.key === handle.dataset.columnKey; });
        drag = { ctrl: current, column: col, handle: handle, id: event.pointerId, x: event.clientX, width: col.width };
        current.session.fitted = true;
        document.body.classList.add('tks-table-resizing');
        if (handle.setPointerCapture) { try { handle.setPointerCapture(event.pointerId); } catch (_) { /* detached pointer */ } }
      });
      handle.addEventListener('lostpointercapture', finishDrag);
    }
    handle.dataset.columnKey = column.key;
    handle.setAttribute('aria-label', 'Độ rộng cột ' + column.label);
    handle.setAttribute('aria-valuemin', String(MIN_WIDTH));
    handle.setAttribute('aria-valuenow', String(Math.round(column.width)));
  }
  function preserveTextLines(table) {
    var walker = document.createTreeWalker(table, window.NodeFilter.SHOW_TEXT), multiline = [], node;
    while ((node = walker.nextNode())) {
      if (!/[\r\n]/.test(node.data) || !/\S/.test(node.data)) continue;
      if (!node.parentElement.closest('th,td') || node.parentElement.closest('.tks-cell-text,textarea,select,option,script,style,svg')) continue;
      multiline.push(node);
    }
    multiline.forEach(function (text) {
      var span = document.createElement('span'); span.className = 'tks-cell-text';
      text.parentNode.insertBefore(span, text); span.appendChild(text);
    });
  }
  function apply(ctrl) {
    var table = ctrl.table;
    preserveTextLines(table);
    var sections = [table.tHead].concat(Array.from(table.tBodies), [table.tFoot]).filter(Boolean);
    // Remove our visibility before reading application-specific hidden columns.
    ctrl.columns.forEach(function (column, index) {
      var cell = ctrl.head.leaves[index].cell;
      cell.classList.remove('tks-column-hidden');
      column.suppressed = cell.hidden || cell.style.display === 'none' || window.getComputedStyle(cell).display === 'none';
    });
    fitOnce(ctrl);
    var visible = ctrl.columns.map(function (col) { return !col.hidden && !col.suppressed; });
    sections.forEach(function (section) {
      var logical = grid(section), rowsVisible = new Map();
      logical.entries.forEach(function (entry) {
        var span = 0;
        for (var i = entry.start; i < entry.start + entry.span; i++) if (visible[i]) span++;
        entry.cell.classList.toggle('tks-column-hidden', span === 0);
        if (entry.cell.colSpan !== Math.max(1, span)) entry.cell.colSpan = Math.max(1, span);
        if (span) rowsVisible.set(entry.row, true);
      });
      Array.from(section.rows).forEach(function (row) { row.classList.toggle('tks-row-hidden', !rowsVisible.has(row)); });
    });
    var group = table.querySelector(':scope > colgroup');
    if (!group) { group = document.createElement('colgroup'); table.insertBefore(group, table.tHead || table.tBodies[0]); }
    // The browser sees only visible columns; logical indices remain in cells.
    var shown = ctrl.columns.filter(function (_, index) { return visible[index]; });
    var signature = shown.map(function (column) { return column.key; }).join('\u001f');
    if (group.dataset.tksColumns !== signature) {
      group.replaceChildren();
      shown.forEach(function (column) { var col = document.createElement('col'); col.dataset.columnKey = column.key; group.appendChild(col); });
      group.dataset.tksColumns = signature;
    }
    shown.forEach(function (column, index) { changeStyle(group.children[index], 'width', column.width + 'px'); });
    var total = shown.reduce(function (sum, column) { return sum + column.width; }, 0);
    ['width', 'min-width', 'max-width'].forEach(function (property) { changeStyle(table, property, Math.max(MIN_WIDTH, total) + 'px'); });
    ctrl.columns.forEach(function (column, index) {
      if (ctrl.head.leaves[index].span === 1) attachHandle(ctrl, ctrl.head.leaves[index].cell, column);
    });
    table.querySelectorAll('textarea.marketing-edit').forEach(function (editor) {
      editor.style.height = 'auto';
      editor.style.height = Math.max(30, editor.scrollHeight) + 'px';
    });
  }
  function resize(ctrl, column, value) {
    if (!column) return;
    column.width = Math.max(MIN_WIDTH, value); ctrl.session.fitted = true; apply(ctrl);
  }
  function finishDrag() {
    if (!drag) return;
    var current = drag; drag = null;
    document.body.classList.remove('tks-table-resizing');
    if (current.handle.releasePointerCapture) { try { current.handle.releasePointerCapture(current.id); } catch (_) { /* capture already released */ } }
  }
  document.addEventListener('pointermove', function (event) {
    if (!drag || event.pointerId !== drag.id) return;
    event.preventDefault(); resize(drag.ctrl, drag.column, drag.width + event.clientX - drag.x);
  }, { passive: false });
  document.addEventListener('pointerup', function (event) { if (drag && event.pointerId === drag.id) finishDrag(); });
  document.addEventListener('pointercancel', function (event) { if (drag && event.pointerId === drag.id) finishDrag(); });
  window.addEventListener('blur', finishDrag);

  function closePicker() {
    if (!picker || picker.hidden) return;
    picker.hidden = true; picker.parentElement.hidden = true;
    if (opener) { opener.setAttribute('aria-expanded', 'false'); if (opener.isConnected) opener.focus(); }
    active = null;
  }
  function setHidden(ctrl, hidden) {
    var next = new Set(hidden);
    ctrl.columns.forEach(function (col) { if (col.locked) next.delete(col.key); });
    if (ctrl.columns.every(function (col) { return next.has(col.key) || col.suppressed; })) {
      var first = ctrl.columns.find(function (col) { return !col.suppressed; });
      if (first) next.delete(first.key);
    }
    ctrl.columns.forEach(function (col) { col.hidden = next.has(col.key); });
    apply(ctrl);
    if (ctrl.options.onVisibilityChange) ctrl.options.onVisibilityChange(ctrl.columns.filter(function (col) { return col.hidden; }).map(function (col) { return col.key; }));
    if (active === ctrl) renderPicker();
  }
  function makePicker() {
    var overlay = document.createElement('div'); overlay.className = 'tks-columns-overlay'; overlay.hidden = true;
    picker = document.createElement('div'); picker.className = 'tks-columns-picker'; picker.hidden = true;
    picker.setAttribute('role', 'dialog'); picker.setAttribute('aria-modal', 'true'); picker.setAttribute('aria-labelledby', 'tksColumnsTitle');
    picker.innerHTML = '<div class="tks-columns-heading"><h3 id="tksColumnsTitle">Cột hiển thị</h3><button type="button" data-action="close" aria-label="Đóng">✕</button></div><p>Chọn cột để hiện, bỏ chọn để ẩn. Lựa chọn giữ trong lần xem này.</p><div class="tks-columns-actions"><button type="button" data-action="show-all">Chọn tất cả</button><button type="button" data-action="hide-all">Bỏ chọn</button></div><div class="tks-columns-list"></div>';
    overlay.appendChild(picker); document.body.appendChild(overlay);
    overlay.addEventListener('click', function (event) { if (event.target === overlay || event.target.closest('[data-action="close"]')) closePicker(); });
    picker.addEventListener('click', function (event) {
      var button = event.target.closest('[data-action]'); if (!button || !active) return;
      if (button.dataset.action === 'show-all') setHidden(active, []);
      if (button.dataset.action === 'hide-all') setHidden(active, active.columns.map(function (col) { return col.key; }));
    });
    picker.addEventListener('change', function (event) {
      if (!active || !event.target.matches('input[data-column-key]')) return;
      var hidden = active.columns.filter(function (col) { return col.hidden; }).map(function (col) { return col.key; });
      var key = event.target.dataset.columnKey;
      setHidden(active, event.target.checked ? hidden.filter(function (item) { return item !== key; }) : hidden.concat(key));
    });
    picker.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePicker(); return; }
      if (event.key !== 'Tab') return;
      var focusables = Array.from(picker.querySelectorAll('button,input:not(:disabled)'));
      var first = focusables[0], last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
  }
  function renderPicker() {
    var list = picker.querySelector('.tks-columns-list');
    var signature = active.columns.map(function (column) { return column.key + ':' + column.label; }).join('\u001f');
    if (list.dataset.columns !== signature) {
      list.replaceChildren();
      active.columns.forEach(function (column) {
        var label = document.createElement('label'), input = document.createElement('input'), text = document.createElement('span');
        input.type = 'checkbox'; input.dataset.columnKey = column.key; text.textContent = column.label;
        label.append(input, text); list.appendChild(label);
      });
      list.dataset.columns = signature;
    }
    var count = active.columns.filter(function (column) { return !column.hidden && !column.suppressed; }).length;
    list.querySelectorAll('input').forEach(function (input, index) {
      var col = active.columns[index]; input.checked = !col.hidden;
      input.disabled = col.locked || col.suppressed || (count === 1 && !col.hidden);
      input.closest('label').title = col.locked ? 'Cột bắt buộc hiển thị' : '';
    });
  }
  function openPicker(ctrl, button) {
    if (!picker) makePicker();
    var parent = ctrl.table.closest('dialog[open]') || document.body;
    if (picker.parentElement.parentElement !== parent) parent.appendChild(picker.parentElement);
    if (opener) opener.setAttribute('aria-expanded', 'false');
    active = ctrl; opener = button; renderPicker();
    picker.hidden = false; picker.parentElement.hidden = false; button.setAttribute('aria-expanded', 'true');
    picker.querySelector('[data-action="close"]').focus();
  }
  function installButton(ctrl) {
    var table = ctrl.table, button = ctrl.options.button || (table.dataset.columnsButton && document.getElementById(table.dataset.columnsButton));
    if (!button) {
      var wrapper = table.parentElement;
      if (!wrapper.classList.contains('tks-table-scroll') && !/scroll|table-wrap/.test(wrapper.className)) {
        var scroll = document.createElement('div'); scroll.className = 'tks-table-scroll';
        wrapper.insertBefore(scroll, table); scroll.appendChild(table); wrapper = scroll;
      }
      var panel = table.closest('.panel,.card');
      var header = panel && panel.querySelectorAll('table').length === 1 && panel.querySelector(':scope > .panel-head,:scope > .card-head');
      var toolbar = header && header.querySelector(':scope > .panel-head-actions,:scope > .card-head-actions');
      if (header && !toolbar) {
        toolbar = document.createElement('div'); toolbar.className = 'panel-head-actions';
        var search = header.querySelector(':scope > .table-search-tools');
        header.insertBefore(toolbar, search);
      }
      if (toolbar) header.querySelectorAll(':scope > button.export-button:not([data-not-export])').forEach(function (exportButton) { toolbar.appendChild(exportButton); });
      var previous = wrapper.previousElementSibling;
      var tools = toolbar || (previous && previous.classList.contains('tks-table-tools') ? previous : null);
      if (!tools) {
        tools = document.createElement('div'); tools.className = 'tks-table-tools';
        wrapper.parentElement.insertBefore(tools, wrapper);
      }
      button = tools.querySelector('.tks-columns-button');
      if (!button) { button = document.createElement('button'); tools.insertBefore(button, tools.querySelector('button.export-button') || tools.firstChild); }
    }
    if (ctrl.button && ctrl.button !== button && ctrl.button.dataset.tksGenerated === 'true') {
      var oldTools = ctrl.button.parentElement; ctrl.button.remove(); if (oldTools.classList.contains('tks-table-tools') && !oldTools.childElementCount) oldTools.remove();
    }
    if (!button.classList.contains('tks-columns-button')) {
      button.classList.add('tks-columns-button'); button.type = 'button'; button.innerHTML = ICON + 'Cột hiển thị';
      button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-expanded', 'false');
      button.title = 'Chọn cột hiển thị trong bảng';
      if (!ctrl.options.button && !table.dataset.columnsButton) button.dataset.tksGenerated = 'true';
      button.addEventListener('click', function (event) { event.preventDefault(); openPicker(buttonControllers.get(button), button); });
    }
    buttonControllers.set(button, ctrl);
    ctrl.button = button;
  }
  function enhance(table, options) {
    if (!table || !table.tHead || table.dataset.tableControls === 'off') return;
    var head = headers(table); if (!head.leaves.length || head.leaves.some(function (entry) { return !entry; })) return;
    var ctrl = controllers.get(table);
    if (!ctrl) { ctrl = { table: table, options: {} }; controllers.set(table, ctrl); }
    if (options) Object.assign(ctrl.options, options);
    var key = ctrl.options.key || tableKey(table), mode = screenMode(), sessionKey = key + '\u001e' + mode;
    var session = sessions.get(sessionKey);
    if (!session) { session = { columns: new Map(), fitted: false }; sessions.set(sessionKey, session); }
    ctrl.key = key; ctrl.mode = mode; ctrl.session = session; ctrl.head = head;
    var used = new Set();
    ctrl.columns = head.leaves.map(function (entry, index) {
      var cell = entry.cell, metadata = ctrl.options.columns && ctrl.options.columns[index] || {};
      var label = metadata.label || labelOf(cell);
      var colKey = metadata.key || cell.dataset.columnKey || cell.dataset.field || cell.dataset.col || cell.dataset.sort || label;
      // Repeated headings remain distinct; explicit field keys take priority.
      if (used.has(colKey)) colKey += ':' + index; used.add(colKey);
      var column = session.columns.get(colKey);
      if (!column) {
        column = { key: colKey, width: Math.max(MIN_WIDTH, pxWidth(metadata.width) || pxWidth(cell.dataset.defaultWidth) || pxWidth(cell.style.width) || defaultWidth(colKey, label)), hidden: !!metadata.hidden, locked: !!metadata.locked };
        session.columns.set(colKey, column);
      }
      column.label = label; column.locked = !!metadata.locked || cell.dataset.columnLocked === 'true';
      if (column.locked) column.hidden = false;
      return column;
    });
    if (ctrl.columns.every(function (column) { return column.hidden; })) ctrl.columns[0].hidden = false;
    table.classList.add('tks-controlled-table'); installButton(ctrl); apply(ctrl);
    if (active === ctrl && picker && !picker.hidden) renderPicker();
    return ctrl;
  }
  function refresh(table) { return enhance(table); }
  function refreshAll() {
    if (!window.document || !document.body) return;
    document.querySelectorAll('table').forEach(function (table) { enhance(table); });
    if (drag && !drag.handle.isConnected) finishDrag();
    if (active && !active.table.isConnected) closePicker();
  }
  function schedule() {
    if (!window.document || !document.body) return;
    if (queued) return; queued = true;
    (window.requestAnimationFrame || window.setTimeout)(function () { queued = false; refreshAll(); });
  }
  function getState(table) {
    var ctrl = controllers.get(table); if (!ctrl) return null;
    return { key: ctrl.key, screenMode: ctrl.mode, columns: ctrl.columns.map(function (col) { return { key: col.key, label: col.label, width: col.width, hidden: col.hidden, locked: col.locked }; }) };
  }
  window.TKSTables = { enhance: enhance, refresh: refresh, refreshAll: refreshAll, getState: getState };
  function start() {
    if (!window.document || !document.body) return;
    refreshAll();
    new MutationObserver(function (records) {
      if (records.some(function (record) {
        var target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
        if (!target || target.closest('.tks-columns-overlay,.tks-table-tools,colgroup,.tks-column-resizer')) return false;
        if (record.type === 'attributes') return !target.closest('table.tks-controlled-table');
        return true;
      })) schedule();
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'class', 'style', 'open'] });
    window.addEventListener('resize', schedule);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
