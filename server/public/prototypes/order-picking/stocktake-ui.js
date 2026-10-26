/* Màn hình nhập tồn đầu từ file kiểm kê. Chỉ ghi vào sổ mô phỏng trong phiên, không ghi DB/Sheet/Kiot. */
(function(){
  'use strict';
  const $ = id => document.getElementById(id);
  const S = window.PickingStocktake, ledger = window.PickingLedger;
  if (!S || !ledger || !$('pickingStocktakeDialog')) return;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = v => Number(v || 0).toLocaleString('vi-VN', { maximumFractionDigits:3 });
  let snapshot = null;

  // datetime-local trả giờ địa phương không có offset; giờ kiểm kê là giờ Việt Nam (UTC+7).
  const toISO = value => value ? new Date(value + '+07:00').toISOString() : null;
  const show = iso => iso ? new Date(iso).toLocaleString('vi-VN', { timeZone:'Asia/Ho_Chi_Minh' }) : 'Chưa chốt';

  function renderPreview(){
    const holder = $('pickingStocktakePreview');
    if (!snapshot) { holder.innerHTML = ''; return; }
    const total = snapshot.lines.reduce((sum, line) => sum + line.quantity, 0);
    const codes = new Set(snapshot.lines.map(line => line.codeKey)).size;
    holder.innerHTML = `<h3>Đã đọc file · cơ sở ${esc(snapshot.branch)}</h3>
      <p>${fmt(snapshot.lines.length)} dòng tồn đầu theo mã hàng + vị trí · ${fmt(codes)} mã hàng · tổng số lượng đã gộp ${fmt(total)}.
      ${snapshot.skipped.length ? fmt(snapshot.skipped.length) + ' dòng bị bỏ qua, xem bên dưới.' : 'Không có dòng bị bỏ qua.'}</p>
      ${snapshot.errors.length ? '<p style="color:var(--amber)">' + snapshot.errors.map(esc).join('<br>') + '</p><p>Sửa file rồi chọn lại; vị trí phải là duy nhất trong hệ thống.</p>' : ''}
      <h4>Thời điểm chốt kiểm kê theo khu</h4>
      <p>Khu nào chưa có giờ chốt thì không nạp làm tồn đầu: không biết biến động nào đã nằm trong số đếm.</p>
      <div style="overflow:auto"><table class="dp-table" data-table-controls="off" data-table-sort="off"><thead><tr><th>Khu (nhóm kiểm kê)</th><th>Số vị trí</th><th>Số mã</th><th>Tổng SL</th><th>Giờ chốt kiểm kê</th></tr></thead><tbody>
      ${snapshot.zones.map((zone, i) => `<tr><td>${esc(zone.zone)}</td><td class="num">${fmt(zone.locationCount)}</td><td class="num">${fmt(zone.codeCount)}</td><td class="num">${fmt(zone.quantity)}</td>
        <td><input type="datetime-local" id="zone-cutoff-${i}" data-zone="${esc(zone.zone)}" value="${esc(ledgerCutoffValue(zone.zone))}" aria-label="Giờ chốt khu ${esc(zone.zone)}"></td></tr>`).join('')}
      </tbody></table></div>
      <p><button id="pickingStocktakeLoad" class="btn-primary" ${snapshot.errors.length ? 'disabled' : ''}>Nạp làm tồn đầu</button></p>
      ${snapshot.skipped.length ? `<h4>Dòng bị bỏ qua (${fmt(snapshot.skipped.length)})</h4><div style="overflow:auto;max-height:220px"><table class="dp-table" data-table-controls="off" data-table-sort="off"><thead><tr><th>Dòng file</th><th>Mã hàng</th><th>Vị trí</th><th>Lý do</th></tr></thead><tbody>${snapshot.skipped.slice(0,200).map(row => `<tr><td class="num">${row.sourceRow}</td><td>${esc(row.code || '—')}</td><td>${esc(row.location || '—')}</td><td>${esc(row.reason)}</td></tr>`).join('')}</tbody></table></div>${snapshot.skipped.length > 200 ? '<p>Chỉ hiện 200 dòng đầu.</p>' : ''}` : ''}`;
  }

  function ledgerCutoffValue(zone){
    const iso = ledger.cutoff(snapshot.branch, zone);
    if (!iso) return '';
    const local = new Date(new Date(iso).getTime() + 7 * 3600e3);
    return local.toISOString().slice(0, 16);
  }

  function renderLedger(){
    const zones = ledger.zones();
    $('pickingStocktakeLedger').innerHTML = `<h3>Sổ tồn đầu đang hoạt động</h3>${zones.length ? `
      <div style="overflow:auto"><table class="dp-table" data-table-controls="off" data-table-sort="off"><thead><tr><th>Cơ sở</th><th>Khu</th><th>Số vị trí đã xác minh</th><th>Giờ chốt</th></tr></thead><tbody>
      ${zones.map(zone => `<tr><td>${esc(zone.branch)}</td><td>${esc(zone.zone)}</td><td class="num">${fmt(zone.locationCount)}</td><td>${esc(show(zone.cutoffAt))}</td></tr>`).join('')}
      </tbody></table></div>
      <p>Tổng đã xác minh chỉ gồm vị trí có tồn kiểm kê, không phải tổng đầy đủ của kho. Biến động sau giờ chốt được cộng/trừ; biến động trước giờ chốt coi như đã nằm trong số đếm.</p>`
      : '<p>Chưa nạp khu nào. Khi chưa có tồn kiểm kê, sổ tồn dùng số khả dụng đã xác nhận của dữ liệu mô phỏng.</p>'}`;
  }

  $('pickingStocktakeBtn').onclick = () => { renderLedger(); $('pickingStocktakeDialog').showModal(); };
  $('pickingStocktakeClose').onclick = () => $('pickingStocktakeDialog').close();

  $('pickingStocktakeFile').onchange = async event => {
    $('pickingStocktakeError').textContent = '';
    try {
      const file = event.target.files[0];
      if (!file) return;
      if (file.size > 20e6) throw Error('File kiểm kê tối đa 20 MB.');
      const rows = S.parseTable(await file.text());
      if (rows.length > 100000) throw Error('File vượt 100.000 dòng.');
      snapshot = S.build(rows, { branch:$('pickingStocktakeBranch').value });
      if (!snapshot.lines.length && !snapshot.errors.length) throw Error('Không đọc được dòng tồn nào. Kiểm tra các cột Mã hàng, Ghi chú và Số lượng.');
      if (!snapshot.lines.length) throw Error(snapshot.errors[0]);
      renderPreview();
    } catch (err) {
      snapshot = null; renderPreview();
      $('pickingStocktakeError').textContent = err.message;
    } finally { event.target.value = ''; }
  };

  $('pickingStocktakePreview').onclick = event => {
    if (event.target.id !== 'pickingStocktakeLoad' || !snapshot) return;
    $('pickingStocktakeError').textContent = '';
    try {
      const cutoffs = {};
      snapshot.zones.forEach((zone, i) => {
        const iso = toISO($('zone-cutoff-' + i).value);
        if (iso) cutoffs[zone.zone] = iso;
      });
      const result = ledger.load(snapshot, cutoffs);
      $('pickingStocktakeError').textContent = 'Đã nạp ' + fmt(result.lineCount) + ' dòng tồn đầu cho khu: '
        + (result.loadedZones.join(', ') || 'không có')
        + (result.pendingZones.length ? ' · Chờ giờ chốt: ' + result.pendingZones.join(', ') : '');
      renderLedger();
      window.PickingPopup?.attach();
      if ($('pickingDialog')?.open) window.PickingPopup?.refresh?.();
    } catch (err) { $('pickingStocktakeError').textContent = err.message; }
  };

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && $('pickingStocktakeDialog').open) event.stopImmediatePropagation();
  }, true);
})();
