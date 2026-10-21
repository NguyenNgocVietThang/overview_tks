// Bảng ORDER VAT thao tác kiểu Google Sheet (cách làm theo vat-draft/cell-select.js):
//   - Mọi người: bấm / kéo chuột chọn vùng ô chữ nhật (Shift+click, Shift+mũi tên nới vùng), Ctrl+C chép TSV
//     không kèm tiêu đề để dán sang Sheet / Excel / Zalo; Esc bỏ chọn.
//   - Người sửa được (hooks.canEdit): ở cột hooks.editable — kéo chấm vuông góc vùng chọn để nhân bản lên / xuống
//     (nhiều dòng nguồn thì lặp theo chu kỳ), Ctrl+V dán cả bảng (1 giá trị + vùng nhiều ô -> điền mọi ô),
//     Delete xóa, Enter / F2 / gõ phím mở ô sửa. Lưu do hooks.apply(edits) lo.
// Vị trí ô nhớ theo (id yêu cầu, tên cột) nên bảng vẽ lại (sau khi lưu) vẫn giữ vùng chọn — gọi refresh().
(function (root) {
  'use strict';

  const SEL = 'vr-cell-sel';
  const ANCHOR = 'vr-cell-anchor';
  const TARGET = 'vr-fill-target';
  const SKIP_FIELDS = new Set(['select', 'actions']);
  const CONTROLS = 'input,select,textarea,button,a,label';

  /** TSV (Sheet / Excel) -> mảng dòng × ô. Ô bọc ngoặc kép được chứa tab / xuống dòng; giữ ô rỗng. */
  function parseTsv(text) {
    const source = String(text ?? '').replace(/\r\n?/g, '\n').replace(/\n$/, '');
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (quoted) {
        if (ch === '"' && source[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"' && cell === '') quoted = true;
      else if (ch === '\t') { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    row.push(cell);
    rows.push(row);
    return rows;
  }

  function quoteCell(text) {
    const value = String(text ?? '').replace(/\r\n?/g, '\n');
    return /[\t\n"]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
  }

  function isHidden(td) { return td.classList.contains('tks-column-hidden') || td.hidden || td.style.display === 'none'; }

  /**
   * hooks: canEdit(), editable(field), copyText(id, field), cellValue(id, field),
   *        startEdit(td, { text }), apply(edits) với edits = [{ id, field, value }] (kéo) | [{ id, field, text }] (dán / xóa).
   */
  function attach(table, hooks) {
    let active = null; // { anchor: { id, field }, focus: { id, field } }
    let mode = null; // 'select' | 'fill'
    let fillTo = null; // id dòng chuột đang trỏ khi kéo chấm
    const handle = document.createElement('span');
    handle.className = 'vr-fill-handle';
    handle.title = 'Kéo để nhân bản lên / xuống';

    const body = () => table.tBodies[0];
    const rowEls = () => (body() ? [...body().rows].filter(tr => tr.dataset.id && !tr.hidden) : []);
    const ids = () => rowEls().map(tr => Number(tr.dataset.id));
    function fields() {
      const first = rowEls()[0];
      return first ? [...first.cells].filter(td => !isHidden(td) && td.dataset.field && !SKIP_FIELDS.has(td.dataset.field)).map(td => td.dataset.field) : [];
    }
    function cellOf(id, field) {
      const tr = body() && body().querySelector(`tr[data-id="${id}"]`);
      return tr ? tr.querySelector(`td[data-field="${field}"]`) : null;
    }
    function locate(target) {
      const td = target && target.closest ? target.closest('td[data-field]') : null;
      if (!td || !body() || !body().contains(td) || SKIP_FIELDS.has(td.dataset.field)) return null;
      const tr = td.closest('tr[data-id]');
      return tr ? { id: Number(tr.dataset.id), field: td.dataset.field } : null;
    }

    /** Vùng chọn theo chỉ số dòng / cột đang hiện; null nếu ô đã mất (lọc, đổi trang). */
    function range() {
      if (!active) return null;
      const rowIds = ids();
      const cols = fields();
      const r = [rowIds.indexOf(active.anchor.id), rowIds.indexOf(active.focus.id)];
      const c = [cols.indexOf(active.anchor.field), cols.indexOf(active.focus.field)];
      if (r.includes(-1) || c.includes(-1)) return null;
      return { r0: Math.min(...r), r1: Math.max(...r), c0: Math.min(...c), c1: Math.max(...c), rowIds, cols };
    }

    function fillable(box) {
      if (!box || !hooks.canEdit()) return false;
      return box.cols.slice(box.c0, box.c1 + 1).every(field => hooks.editable(field));
    }

    function isEditing() { return !!table.querySelector('td [data-inline]'); }

    function paint() {
      table.querySelectorAll(`td.${SEL}, td.${ANCHOR}, td.${TARGET}`).forEach(td => td.classList.remove(SEL, ANCHOR, TARGET));
      handle.remove();
      table.querySelectorAll('td.vr-has-handle').forEach(td => td.classList.remove('vr-has-handle'));
      const box = range();
      table.classList.toggle('vr-grid-active', !!box);
      if (!box) return;
      for (let r = box.r0; r <= box.r1; r++) {
        for (let c = box.c0; c <= box.c1; c++) {
          const td = cellOf(box.rowIds[r], box.cols[c]);
          if (td) td.classList.add(SEL);
        }
      }
      const anchor = cellOf(active.anchor.id, active.anchor.field);
      if (anchor) anchor.classList.add(ANCHOR);
      if (mode === 'fill' && fillTo !== null) {
        const t = box.rowIds.indexOf(fillTo);
        const [from, to] = t > box.r1 ? [box.r1 + 1, t] : t < box.r0 ? [t, box.r0 - 1] : [1, 0];
        for (let r = from; r <= to; r++) {
          for (let c = box.c0; c <= box.c1; c++) {
            const td = cellOf(box.rowIds[r], box.cols[c]);
            if (td) td.classList.add(TARGET);
          }
        }
      }
      if (fillable(box) && !isEditing()) {
        const corner = cellOf(box.rowIds[box.r1], box.cols[box.c1]);
        if (corner) { corner.classList.add('vr-has-handle'); corner.append(handle); }
      }
    }

    function select(anchor, focus) {
      active = { anchor, focus: focus || anchor };
      paint();
    }

    function clear() {
      active = null;
      mode = null;
      fillTo = null;
      paint();
    }

    /** Chép TSV vùng chọn (bỏ cột ẩn — fields() chỉ lấy cột đang hiện). */
    function selectionText() {
      const box = range();
      if (!box) return '';
      const lines = [];
      for (let r = box.r0; r <= box.r1; r++) {
        const cells = [];
        for (let c = box.c0; c <= box.c1; c++) cells.push(quoteCell(hooks.copyText(box.rowIds[r], box.cols[c])));
        lines.push(cells.join('\t'));
      }
      return lines.join('\n');
    }

    function finishFill() {
      const box = range();
      const t = box ? box.rowIds.indexOf(fillTo) : -1;
      mode = null;
      fillTo = null;
      table.classList.remove('vr-grid-filling');
      if (!box || t < 0 || (t >= box.r0 && t <= box.r1)) { paint(); return; }
      const height = box.r1 - box.r0 + 1;
      const targets = t > box.r1 ? Array.from({ length: t - box.r1 }, (_, i) => box.r1 + 1 + i) : Array.from({ length: box.r0 - t }, (_, i) => t + i);
      const edits = [];
      for (const r of targets) {
        // Như Sheet: nhiều dòng nguồn thì lặp theo chu kỳ, tính từ mép vùng nguồn.
        const offset = r > box.r1 ? (r - box.r1 - 1) % height : (box.r0 - 1 - r) % height;
        const source = r > box.r1 ? box.r0 + offset : box.r1 - offset;
        for (let c = box.c0; c <= box.c1; c++) {
          const field = box.cols[c];
          edits.push({ id: box.rowIds[r], field, value: hooks.cellValue(box.rowIds[source], field) });
        }
      }
      // Vùng chọn nới ra cả phần vừa điền (giống Sheet).
      const top = Math.min(box.r0, t);
      const bottom = Math.max(box.r1, t);
      active = { anchor: { id: box.rowIds[top], field: box.cols[box.c0] }, focus: { id: box.rowIds[bottom], field: box.cols[box.c1] } };
      paint();
      hooks.apply(edits);
    }

    function paste(text) {
      const box = range();
      if (!box) return;
      const matrix = parseTsv(text);
      const edits = [];
      let skipped = 0;
      const push = (r, c, value) => {
        const id = box.rowIds[r];
        const field = box.cols[c];
        if (id === undefined || field === undefined || !hooks.editable(field)) { skipped++; return; }
        edits.push({ id, field, text: value });
      };
      if (matrix.length === 1 && matrix[0].length === 1 && (box.r1 > box.r0 || box.c1 > box.c0)) {
        for (let r = box.r0; r <= box.r1; r++) for (let c = box.c0; c <= box.c1; c++) push(r, c, matrix[0][0]);
      } else {
        matrix.forEach((cells, i) => cells.forEach((value, j) => push(box.r0 + i, box.c0 + j, value)));
        const lastRow = Math.min(box.r0 + matrix.length - 1, box.rowIds.length - 1);
        const width = Math.max(...matrix.map(cells => cells.length));
        active = { anchor: { id: box.rowIds[box.r0], field: box.cols[box.c0] }, focus: { id: box.rowIds[lastRow], field: box.cols[Math.min(box.c0 + width - 1, box.cols.length - 1)] } };
        paint();
      }
      hooks.apply(edits, { skipped });
    }

    function clearCells() {
      const box = range();
      if (!box) return;
      const edits = [];
      for (let r = box.r0; r <= box.r1; r++) {
        for (let c = box.c0; c <= box.c1; c++) {
          if (hooks.editable(box.cols[c]) && box.cols[c] !== 'status') edits.push({ id: box.rowIds[r], field: box.cols[c], text: '' });
        }
      }
      if (edits.length) hooks.apply(edits);
    }

    function move(event) {
      const box = range();
      if (!box) return;
      const delta = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[event.key];
      const from = event.shiftKey ? active.focus : active.anchor;
      const r = Math.min(Math.max(box.rowIds.indexOf(from.id) + delta[0], 0), box.rowIds.length - 1);
      const c = Math.min(Math.max(box.cols.indexOf(from.field) + delta[1], 0), box.cols.length - 1);
      const next = { id: box.rowIds[r], field: box.cols[c] };
      if (event.shiftKey) active.focus = next; else active = { anchor: next, focus: next };
      paint();
      const td = cellOf(next.id, next.field);
      if (td && td.scrollIntoView) td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    // Phím chỉ xử lý khi đang có vùng chọn, không gõ trong ô nhập và không có hộp thoại mở.
    function ownsKeyboard() {
      if (!active || !range()) return false;
      const focused = document.activeElement;
      if (focused && focused !== document.body && focused.matches(CONTROLS + ',[contenteditable="true"]')) return false;
      return !document.querySelector('dialog[open]');
    }

    table.addEventListener('mousedown', event => {
      if (event.button !== 0) return;
      if (event.target === handle) {
        event.preventDefault();
        mode = 'fill';
        fillTo = null;
        table.classList.add('vr-grid-filling');
        return;
      }
      if (event.target.closest(CONTROLS)) return;
      const pos = locate(event.target);
      if (!pos) return;
      event.preventDefault(); // không bôi đen chữ kiểu trình duyệt
      const selection = root.getSelection && root.getSelection();
      if (selection && selection.removeAllRanges) selection.removeAllRanges();
      // Rời ô đang sửa / ô nhập khác: blur để ô sửa tự lưu hoặc đóng, và phím mũi tên về lại bảng.
      const focused = document.activeElement;
      if (focused && focused !== document.body && focused.blur) focused.blur();
      if (event.shiftKey && active) { active.focus = pos; paint(); }
      else select(pos);
      mode = 'select';
    });
    table.addEventListener('mouseover', event => {
      if (!mode || !active) return;
      const pos = locate(event.target);
      if (!pos) return;
      if (mode === 'select' && (pos.id !== active.focus.id || pos.field !== active.focus.field)) { active.focus = pos; paint(); }
      if (mode === 'fill' && pos.id !== fillTo) { fillTo = pos.id; paint(); }
    });
    document.addEventListener('mouseup', () => {
      if (mode === 'fill') finishFill();
      else mode = null;
    });
    document.addEventListener('mousedown', event => {
      if (active && !table.contains(event.target) && !event.target.closest('[data-grid-keep]')) clear();
    });
    document.addEventListener('keydown', event => {
      if (!ownsKeyboard()) return;
      const key = event.key;
      if (key === 'Escape') { clear(); return; }
      if (key.startsWith('Arrow')) { event.preventDefault(); move(event); return; }
      if (!hooks.canEdit() || !hooks.editable(active.anchor.field)) return;
      const td = cellOf(active.anchor.id, active.anchor.field);
      if (!td) return;
      if (key === 'Enter' || key === 'F2') { event.preventDefault(); hooks.startEdit(td, {}); return; }
      if (key === 'Delete' || key === 'Backspace') { event.preventDefault(); clearCells(); return; }
      if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); hooks.startEdit(td, { text: key }); }
    });
    document.addEventListener('copy', event => {
      if (!ownsKeyboard()) return;
      const selection = root.getSelection && root.getSelection();
      if (selection && String(selection).length) return; // đang bôi đen chữ ở chỗ khác -> để trình duyệt chép
      const text = selectionText();
      if (!text || !event.clipboardData) return;
      event.clipboardData.setData('text/plain', text);
      event.preventDefault();
    });
    document.addEventListener('paste', event => {
      if (!ownsKeyboard() || !hooks.canEdit() || !event.clipboardData) return;
      const box = range();
      if (!box || !hooks.editable(box.cols[box.c0])) return;
      event.preventDefault();
      paste(event.clipboardData.getData('text/plain'));
    });

    return {
      /** Gọi sau mỗi lần vẽ lại bảng: tô lại vùng chọn theo id; ô không còn thì bỏ chọn. */
      refresh() { if (active && !range()) active = null; paint(); },
      clear,
      select,
      selectionText,
      paste
    };
  }

  root.TKSVatGrid = { attach, parseTsv, quoteCell };
})(window);
