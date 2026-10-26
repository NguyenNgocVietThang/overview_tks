/* Sổ vị trí hàng hóa theo cơ sở (tab Vị trí HN / Vị trí SG): Tổng SL kèm Đang nhặt / Nhặt được, sửa ghi chú tại chỗ,
   bôi đỏ dòng cảnh báo, bộ lọc Cảnh báo và Lịch sử chỉnh sửa. Mọi con số lấy từ PickingInventory; cảnh báo lấy từ
   PickingCarton.warnings (một nơi duy nhất) nên bôi đỏ, bộ lọc và số đếm luôn khớp nhau và tính lại ngay sau mỗi lần sửa. */
(function(){
  'use strict';
  const $ = id => document.getElementById(id);
  const C = window.PickingCarton, I = window.PickingInventory;
  if (!C || !I || !$('pickingLocationsDialog')) return;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = v => Number(v || 0).toLocaleString('vi-VN', { maximumFractionDigits:3 });
  const BRANCH_LABEL = { HN:'Vị trí HN', SG:'Vị trí SG' };
  const ROW_LIMIT = 1000;
  let branch = 'HN', onlyWarnings = false, query = '';
  // Dòng đang mở lịch sử riêng của hàng hóa (bấm dòng để mở, bấm lại hoặc Esc để đóng) và bộ lọc "Chỉ khu này".
  let detailId = null, onlyHere = false;
  const SOURCE_LABEL = { 'Xác nhận nhặt':'Tự trừ', 'Hủy/hoàn tác nhặt':'Tự cộng lại', 'Chỉ định lại':'Tự cộng lại' };
  const sourceText = h => (SOURCE_LABEL[h.source] || h.source) + (h.orderCode ? ' · đơn ' + h.orderCode : '');
  // dd/mm HH:mm giờ Việt Nam.
  const shortTime = iso => { const v = new Date(Date.parse(iso) + 7 * 3600e3).toISOString(); return v.slice(8, 10) + '/' + v.slice(5, 7) + ' ' + v.slice(11, 16); };
  const changeCells = h => `<td>${esc(h.notesBefore || '—')} → <span class="${h.warnings.length ? 'loc-warning-text' : ''}">${esc(h.notesAfter || '—')}</span>${h.warnings.length ? ` <span class="loc-badge" title="${esc(warningText(h.warnings))}">${esc(warningText(h.warnings))}</span>` : ''}</td>
      <td class="num">${h.qtyBefore === null ? '—' : fmt(h.qtyBefore)} → ${h.qtyAfter === null ? '—' : fmt(h.qtyAfter)}</td>
      <td>${esc(h.source)}${h.orderCode ? ' · ' + esc(h.orderCode) : ''}</td><td>${esc(h.user)}</td>`;
  const sameLocation = (h, row) => String(h.location).trim().toUpperCase() === String(row.location).trim().toUpperCase();

  const warningText = reasons => reasons.map(r => C.WARNING_LABEL[r]).join(', ');
  const warned = row => row.warnings.length > 0;
  const time = iso => new Date(iso).toLocaleString('vi-VN', { timeZone:'Asia/Ho_Chi_Minh' });

  function counts(){
    const result = {};
    for (const key of Object.keys(BRANCH_LABEL)) result[key] = I.rows(key).filter(warned).length;
    return result;
  }

  function render(){
    const warnCounts = counts();
    document.querySelectorAll('[data-loc-branch]').forEach(tab => {
      const active = tab.dataset.locBranch === branch;
      tab.setAttribute('aria-selected', String(active));tab.classList.toggle('active', active);
    });
    const chip = $('locWarnFilter');
    chip.textContent = 'Cảnh báo (' + warnCounts[branch] + ')';
    chip.setAttribute('aria-pressed', String(onlyWarnings));chip.classList.toggle('active', onlyWarnings);
    $('pickingLocationsTitle').textContent = BRANCH_LABEL[branch];
    const needle = query.trim().toLowerCase();
    let rows = I.rows(branch);
    if (onlyWarnings) rows = rows.filter(warned);
    if (needle) rows = rows.filter(r => (r.code + ' ' + r.name + ' ' + r.location + ' ' + r.notes).toLowerCase().includes(needle));
    const shown = rows.slice(0, ROW_LIMIT), lastChange = I.lastChanges(branch);
    $('locBody').innerHTML = shown.map(row => {
      const bad = warned(row), multi = row.warnings.includes('multi');
      const last = lastChange.get(I.lastChangeKey(row)), open = row.id === detailId;
      return `<tr class="loc-row${bad ? ' loc-warning' : ''}${multi ? ' loc-multi-spec' : ''}${open ? ' loc-open' : ''}" data-loc-id="${esc(row.id)}" tabindex="0" aria-expanded="${open}"${bad ? ` data-warning="${esc(row.warnings.join(' '))}"` : ''}>
        <td>${esc(row.code)}</td><td>${esc(row.name || '—')}</td>
        <td class="num"><strong>${row.quantity === null ? '0' : fmt(row.quantity)}</strong>
          ${row.held ? `<small class="loc-picking">Đang nhặt ${fmt(row.held)}</small>` : ''}
          <small class="loc-pickable">Nhặt được ${row.pickable === null ? '0' : fmt(row.pickable)}</small></td>
        <td><input class="loc-notes" data-loc-notes="${esc(row.id)}" value="${esc(row.notes)}" aria-label="Ghi chú hàng hóa ${esc(row.code)} ${esc(row.location)}" placeholder="vd 5T x 100">
          ${bad ? `<span class="loc-badge" title="${esc(warningText(row.warnings))}">${esc(warningText(row.warnings))}</span>` : ''}</td>
        <td>${esc(row.arrivalDate || '—')}</td><td>${esc(row.location || '—')}</td>
        <td class="loc-updated"${last ? ` data-updated="${esc(last.at)}" title="${esc(time(last.at) + ' · ' + sourceText(last))}"` : ''}>${last ? `${esc(shortTime(last.at))}<small>${esc(sourceText(last))}</small>` : ''}</td></tr>${open ? detailHtml(row) : ''}`;
    }).join('') || '<tr><td colspan="7" class="loc-empty">' + (onlyWarnings ? 'Không có dòng cảnh báo.' : 'Chưa có vị trí.') + '</td></tr>';
    renderEntry();
    $('locNote').textContent = rows.length > ROW_LIMIT ? 'Chỉ hiện ' + ROW_LIMIT + ' dòng đầu, dùng ô tìm để thu hẹp.' : '';
  }

  /* Dòng nhập tay: người dùng gõ Mã hàng, Ghi chú, Vị trí; Tên hàng và SL tự nhảy. Cùng parser và cùng hàm cảnh báo với import
     nên ghi chú gõ dở cho SL/cảnh báo tức thì; dòng cảnh báo vẫn lưu được (hiện đỏ, không chỉ định nhặt được). */
  const entryValues = () => ({ code:$('locEntryCode').value, notes:$('locEntryNotes').value, location:$('locEntryLocation').value });
  function renderEntry(){
    $('locEntryTitle').textContent = 'Thêm dòng · ' + BRANCH_LABEL[branch];
    const preview = I.previewLocation(branch, entryValues());
    $('locEntryName').textContent = 'Tên hàng: ' + (preview.name || '—');
    $('locEntryQty').textContent = 'SL: ' + (preview.quantity === null ? '0' : fmt(preview.quantity));
    const reasons = preview.warnings.filter(w => w !== 'unknowncode' || $('locEntryCode').value.trim());
    const warn = $('locEntryWarn');
    warn.hidden = !reasons.length && !preview.duplicate;
    warn.textContent = preview.duplicate ? 'Đã có dòng này, Lưu để nhảy tới dòng đó' : warningText(reasons);
    $('locEntry').classList.toggle('loc-warning', reasons.length > 0);
  }
  function jumpTo(row){
    onlyWarnings = false; query = ''; $('locSearch').value = ''; render();
    const tr = [...document.querySelectorAll('#locBody tr')].find(el => el.dataset.locId === row.id);
    if (!tr) return;
    tr.classList.add('loc-focus');tr.scrollIntoView?.({ block:'center' });tr.querySelector('.loc-notes')?.focus();
  }
  function saveEntry(event){
    event.preventDefault();
    $('locError').textContent = '';
    try {
      const row = I.addLocation(branch, entryValues(), 'Sửa tay');
      $('locEntry').reset();render();
      $('locError').textContent = 'Đã thêm ' + row.code + ' tại ' + row.location + ' vào ' + BRANCH_LABEL[branch] + '.';
      $('locEntryCode').focus();
      window.PickingPopup?.attach?.();
    } catch (err) {
      $('locError').textContent = err.message;
      if (err.duplicate) jumpTo(err.duplicate);
    }
  }
  $('locEntry').onsubmit = saveEntry;
  ['locEntryCode', 'locEntryNotes', 'locEntryLocation'].forEach(id => { $(id).oninput = renderEntry; });

  /* Lịch sử riêng của một mã hàng ở đúng cơ sở của tab: các bản ghi của khu vừa bấm xếp lên đầu và được làm nổi bật,
     chip "Chỉ khu này" lọc còn khu đó. Cùng nguồn dữ liệu với hộp Lịch sử chỉnh sửa chung (PickingInventory.historyFor). */
  function detailHtml(row){
    const all = I.historyFor(branch, row.code), here = all.filter(h => sameLocation(h, row));
    const list = onlyHere ? here : [...here, ...all.filter(h => !sameLocation(h, row))];
    return `<tr class="loc-detail" data-detail-for="${esc(row.id)}"><td colspan="7"><div class="loc-detail-box">
      <div class="loc-detail-head"><strong>Lịch sử chỉnh sửa · ${esc(row.code)}${row.name ? ' · ' + esc(row.name) : ''} · ${esc(BRANCH_LABEL[branch])}</strong>
        <button type="button" class="loc-chip${onlyHere ? ' active' : ''}" data-detail-here aria-pressed="${onlyHere}">Chỉ khu này (${esc(row.location)})</button>
        <button type="button" data-detail-close aria-label="Đóng lịch sử của hàng hóa">Đóng</button></div>
      <table class="dp-table loc-table loc-detail-table" data-table-controls="off" data-table-sort="off"><thead><tr><th>Thời gian</th><th>Khu / vị trí</th><th>Ghi chú trước → sau</th><th>SL trước → sau</th><th>Nguồn</th><th>Người thực hiện</th></tr></thead><tbody>
      ${list.map(h => `<tr class="${sameLocation(h, row) ? 'loc-hist-here' : ''}"><td>${esc(time(h.at))}</td><td>${esc(h.location)}</td>${changeCells(h)}</tr>`).join('') || '<tr><td colspan="6" class="loc-empty">Chưa có chỉnh sửa nào của mã này ở ' + esc(BRANCH_LABEL[branch]) + (onlyHere ? ' tại khu này.' : '.') + '</td></tr>'}
      </tbody></table></div></td></tr>`;
  }
  function toggleDetail(id){ detailId = detailId === id ? null : id; if (!detailId) onlyHere = false; render(); }
  $('locBody').onclick = event => {
    if (event.target.closest('[data-detail-here]')) { onlyHere = !onlyHere; render(); return; }
    if (event.target.closest('[data-detail-close]')) { detailId = null; onlyHere = false; render(); return; }
    // Ô đang sửa (ghi chú, nút) và vùng chi tiết không mở/đóng panel để khỏi xung đột với sửa tại chỗ.
    if (event.target.closest('input,button,a,select,textarea,.loc-detail')) return;
    const tr = event.target.closest('tr.loc-row');if (tr) toggleDetail(tr.dataset.locId);
  };
  $('locBody').onkeydown = event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('tr.loc-row')) { event.preventDefault(); toggleDetail(event.target.dataset.locId); }
  };

  function renderHistory(){
    const list = I.history(branch);
    $('pickingHistoryTitle').textContent = 'Lịch sử chỉnh sửa · ' + BRANCH_LABEL[branch];
    $('historyBody').innerHTML = list.map(h => `<tr><td>${esc(time(h.at))}</td><td>${esc(h.code)}</td><td>${esc(h.location)}</td>${changeCells(h)}</tr>`).join('')
      || '<tr><td colspan="7" class="loc-empty">Chưa có chỉnh sửa nào ở ' + esc(BRANCH_LABEL[branch]) + '.</td></tr>';
  }

  $('pickingLocationsBtn').onclick = () => { render(); $('pickingLocationsDialog').showModal(); };
  $('pickingLocationsClose').onclick = () => $('pickingLocationsDialog').close();
  document.querySelectorAll('[data-loc-branch]').forEach(tab => { tab.onclick = () => { branch = tab.dataset.locBranch; detailId = null; onlyHere = false; render(); }; });
  $('locWarnFilter').onclick = () => { onlyWarnings = !onlyWarnings; render(); };
  $('locSearch').oninput = event => { query = event.target.value; render(); };
  $('locHistoryBtn').onclick = () => { renderHistory(); $('pickingHistoryDialog').showModal(); };
  $('pickingHistoryClose').onclick = () => $('pickingHistoryDialog').close();
  $('locBody').onchange = event => {
    const input = event.target.closest('[data-loc-notes]');if (!input) return;
    $('locError').textContent = '';
    try {
      const row = window.PickingData.get().locations.find(r => r.id === input.dataset.locNotes);
      I.setSpec(row, input.value, 'Sửa tay', { allowInvalid:true });
    } catch (err) { $('locError').textContent = err.message; }
    render();
    window.PickingPopup?.attach?.();
    if ($('pickingDialog')?.open) window.PickingPopup?.refresh?.();
  };
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && ['pickingHistoryDialog', 'pickingLocationsDialog'].some(id => $(id).open)) {
      event.stopImmediatePropagation();
      // Esc đóng lớp trên cùng trước: hộp lịch sử chung, rồi panel lịch sử của hàng hóa, rồi mới đến sổ vị trí.
      if (!$('pickingHistoryDialog').open && detailId) { detailId = null; onlyHere = false; event.preventDefault(); render(); return; }
      const top = $('pickingHistoryDialog').open ? 'pickingHistoryDialog' : 'pickingLocationsDialog';
      $(top).close();
    }
  }, true);
  window.PickingLocations = { render, renderHistory, setBranch(value){ branch = value; onlyWarnings = false; query = ''; } };
})();
