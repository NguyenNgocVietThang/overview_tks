/* Màn hình nhập tồn đầu từ file kiểm kê. Chỉ ghi vào sổ mô phỏng trong phiên, không ghi DB/Sheet/Kiot. */
(function(){
  'use strict';
  const $ = id => document.getElementById(id);
  const S = window.PickingStocktake, ledger = window.PickingLedger;
  if (!S || !ledger || !$('pickingStocktakeDialog')) return;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = v => Number(v || 0).toLocaleString('vi-VN', { maximumFractionDigits:3 });
  let snapshot = null, kiotReceipts = [];

  // Phiếu nhập Kiot xuất ra CSV/TSV. purchase_details.product_id phải đổi sang mã hàng trước.
  const KIOT_COLUMNS = [
    { field:'documentCode', names:['ma phieu','ma phieu nhap','code','ma chung tu'] },
    { field:'productCode',  names:['ma hang','ma san pham','ma hang hoa'] },
    { field:'purchaseDate', names:['ngay','ngay nhap','ngay phieu','purchase date'] },
    { field:'quantity',     names:['so luong','sl','quantity'] }
  ];
  const norm = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/đ/g,'d').trim().toLowerCase().replace(/\s+/g,' ');

  function parseKiotFile(text){
    const rows = S.parseTable(text);
    if (!rows.length) throw Error('File phiếu nhập rỗng.');
    const header = rows[0].map(norm), index = {};
    for (const column of KIOT_COLUMNS)
      for (const name of column.names) { const at = header.indexOf(name); if (at !== -1) { index[column.field] = at; break; } }
    const missing = ['productCode','purchaseDate','quantity'].filter(f => index[f] === undefined);
    if (missing.length) throw Error('File phiếu nhập thiếu cột: ' + missing.join(', ') + '.');
    return rows.slice(1).map((cells, i) => ({
      branch: $('pickingStocktakeBranch').value,
      productCode: String(cells[index.productCode] ?? '').trim(),
      purchaseDate: String(cells[index.purchaseDate] ?? '').trim(),
      quantity: String(cells[index.quantity] ?? '').trim(),
      documentCode: index.documentCode === undefined ? '' : String(cells[index.documentCode] ?? '').trim(),
      documentId: (index.documentCode === undefined ? 'ROW' : String(cells[index.documentCode] ?? '').trim()) || 'ROW',
      lineNo: i + 1
    }));
  }

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

  // Dòng tab Vị trí hàng của mọi cơ sở; cột NGÀY VỀ cho biết lô nào về sau giờ chốt.
  const sheetRows = () => (window.PickingData?.get().locations || [])
    .map(row => ({ branch:row.branch, code:row.code, location:row.location, arrivalDate:row.arrivalDate }));

  const RECEIPT_LABEL = { 'after':'Về sau giờ chốt', 'same-day':'Về đúng ngày chốt', 'missing':'Không có trong file kiểm kê', 'unknown-date':'NGÀY VỀ không đọc được' };

  function renderLedger(){
    const zones = ledger.zones(), countingZones = ledger.countingZones();
    const branch = $('pickingStocktakeBranch').value;
    const pending = ledger.has(branch) ? ledger.pendingReceipts(branch, sheetRows()) : [];
    pendingRows = pending;
    $('pickingStocktakeLedger').innerHTML = `<h3>Sổ tồn đầu đang hoạt động</h3>${zones.length ? `
      <div style="overflow:auto"><table class="dp-table" data-table-controls="off" data-table-sort="off"><thead><tr><th>Cơ sở</th><th>Khu</th><th>Số vị trí đã xác minh</th><th>Giờ chốt</th><th>Kiểm kê lại</th></tr></thead><tbody>
      ${zones.map(zone => `<tr><td>${esc(zone.branch)}</td><td>${esc(zone.zone)}</td><td class="num">${fmt(zone.locationCount)}</td><td>${esc(show(zone.cutoffAt))}</td>
        <td>${ledger.countingZone(zone.branch, zone.zone) ? '🔒 Đang đếm, khu bị đóng băng' : `<button data-recount="${esc(zone.zone)}" data-branch="${esc(zone.branch)}">Bắt đầu đếm lại</button>`}</td></tr>`).join('')}
      </tbody></table></div>
      <p>Tổng đã xác minh chỉ gồm vị trí có tồn kiểm kê, không phải tổng đầy đủ của kho. Biến động sau giờ chốt được cộng/trừ; biến động trước giờ chốt coi như đã nằm trong số đếm.</p>`
      : '<p>Chưa nạp khu nào. Khi chưa có tồn kiểm kê, sổ tồn dùng số khả dụng đã xác nhận của dữ liệu mô phỏng.</p>'}
      ${countingZones.length ? `<p style="color:var(--amber)">Khu đang kiểm kê (đóng băng, không ra đơn): ${countingZones.map(z => esc(z.branch + ' · ' + z.zone + ' từ ' + show(z.startedAt))).join(' · ')}. Nạp file kiểm kê của khu đó để chốt và mở lại khu.</p>` : ''}
      ${renderConflicts(branch)}
      ${renderReceipts(pending, branch)}
      ${renderKiotPlan(branch)}`;
  }

  /* Giữ chỗ vượt tồn sổ. available() trả 0 vì không cấp được âm, nhưng 0 đó không có nghĩa
     là ổn — phải hiện chênh lệch và các đơn đang giữ để kế toán xử lý từng đơn. */
  function renderConflicts(branch){
    const conflicts = window.PickingInventory?.conflicts?.(branch) || [];
    if (!conflicts.length) return '';
    return `<h3 style="color:var(--amber)">⚠ Giữ chỗ vượt tồn sổ (${fmt(conflicts.length)} vị trí)</h3>
      <p>Xảy ra khi kỳ kiểm kê mới có số thấp hơn lượng đã giữ cho các đơn đang xử lý, hoặc sau điều chỉnh giảm tồn. Không tự hủy giữ chỗ của đơn đang nhặt — kế toán xử lý từng đơn.</p>
      <div style="overflow:auto"><table class="dp-table" data-table-controls="off" data-table-sort="off"><thead><tr><th>Mã / vị trí</th><th>Tồn sổ</th><th>Đang giữ</th><th>Vượt</th><th>Đơn đang giữ</th></tr></thead><tbody>
      ${conflicts.map(c => `<tr><td>${esc(c.code)} · ${esc(c.location)}</td>
        <td class="num">${fmt(c.onHand)}${c.negative ? ' <strong style="color:var(--amber)">(âm)</strong>' : ''}</td>
        <td class="num">${fmt(c.held)}</td><td class="num"><strong>${fmt(c.excess)}</strong></td>
        <td>${(window.PickingInventory.orders(c.id) || []).map(o => esc(o.orderCode) + ' (' + fmt(o.reserved) + ')').join(', ') || '—'}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  /* Ghép phiếu nhập Kiot: Kiot cho số lượng + ngày, tab Vị trí hàng cho vị trí + NGÀY VỀ. */
  const KIOT_LABEL = { matched:'Ghép được một vị trí', ambiguous:'Nhiều vị trí, cần phân', counted:'Đã nằm trong số đếm', 'no-location':'Chưa có vị trí', invalid:'Dữ liệu phiếu không hợp lệ' };
  let kiotPlan = [];

  function renderKiotPlan(branch){
    if (!kiotReceipts.length) return `<h3>Ghép phiếu nhập Kiot</h3>
      <p>Chọn file phiếu nhập xuất từ Kiot (CSV/TSV, các cột <code>Mã hàng</code>, <code>Ngày</code>, <code>Số lượng</code>, <code>Mã phiếu</code>) để cộng số nhập vào đúng vị trí.
      Số lượng lấy từ phiếu nhập Kiot, vị trí lấy từ NGÀY VỀ của tab Vị trí hàng. Mỗi chứng từ chỉ ghi một lần.</p>
      <p><label class="picking-import">Chọn file phiếu nhập Kiot <input id="pickingKiotFile" type="file" accept=".csv,.tsv,.txt,text/csv,text/plain"></label></p>`;
    kiotPlan = ledger.matchReceipts(branch, sheetRows(), kiotReceipts);
    const counts = kiotPlan.reduce((acc, row) => ({ ...acc, [row.status]:(acc[row.status] || 0) + 1 }), {});
    return `<h3>Ghép phiếu nhập Kiot · cơ sở ${esc(branch)}</h3>
      <p>${Object.entries(counts).map(([status, n]) => esc((KIOT_LABEL[status] || status) + ': ' + n)).join(' · ')}
      <label class="picking-import">Chọn file khác <input id="pickingKiotFile" type="file" accept=".csv,.tsv,.txt,text/csv,text/plain"></label></p>
      ${counts.matched ? `<p><button id="pickingKiotApplyAll" class="btn-primary">Ghi tất cả ${fmt(counts.matched)} dòng ghép được</button></p>` : ''}
      <div style="overflow:auto;max-height:320px"><table class="dp-table" data-table-controls="off" data-table-sort="off"><thead><tr><th>Mã hàng</th><th>Ngày</th><th>SL nhập</th><th>Phiếu</th><th>Kết quả ghép</th><th>Ghi vào sổ</th></tr></thead><tbody>
      ${kiotPlan.map((row, i) => `<tr><td>${esc(row.productCode || '—')}</td><td>${esc(row.purchaseDate || '—')}</td>
        <td class="num">${row.quantity === null ? '—' : fmt(row.quantity)}</td><td>${esc(row.documentCode || row.documentId || '—')}</td>
        <td>${esc(KIOT_LABEL[row.status] || row.status)}<br><small>${esc(row.reason)}</small></td>
        <td>${row.status === 'matched' ? `<button data-kiot="${i}">Ghi ${fmt(row.quantity)} vào ${esc(row.location)}</button>`
          : row.status === 'ambiguous' ? row.candidates.map(c => `<label><small>${esc(c.location)}</small> <input type="number" min="0" step="any" id="split-${i}-${esc(c.location)}" style="width:90px" aria-label="Phân ${esc(c.location)}"></label>`).join(' ')
            + `<button data-kiot="${i}">Ghi theo phân bổ</button>` : '—'}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  /* Hàng về sau giờ chốt: tab Vị trí hàng cho vị trí và NGÀY VỀ, TỔNG SL của tab đó không phải
     tồn còn nên số lượng nhập phải lấy từ nguồn đáng tin và do người nhập xác nhận. */
  function renderReceipts(pending, branch){
    if (!pending.length) return '';
    return `<h3>Hàng về sau giờ chốt · cơ sở ${esc(branch)} (${fmt(pending.length)} dòng)</h3>
      <p>Lấy từ cột NGÀY VỀ của tab Vị trí hàng so với giờ chốt từng khu. Số lượng <strong>không</strong> lấy từ TỔNG SL của tab đó — nhập số nhập thực tế theo phiếu nhập rồi bấm ghi.</p>
      <div style="overflow:auto;max-height:300px"><table class="dp-table" data-table-controls="off" data-table-sort="off"><thead><tr><th>Mã / vị trí</th><th>Khu</th><th>NGÀY VỀ</th><th>Tình trạng</th><th>Tồn sổ hiện tại</th><th>Ghi số nhập</th></tr></thead><tbody>
      ${pending.map((row, i) => `<tr><td>${esc(row.code)} · ${esc(row.location)}</td><td>${esc(row.zone)}</td><td>${esc(row.arrivalDate || '—')}</td>
        <td>${esc(RECEIPT_LABEL[row.status] || row.status)}<br><small>${esc(row.reason)}</small></td>
        <td class="num">${row.hasOpening ? fmt(ledger.onHand(branch, row.code, row.location)) : 'Chưa có tồn đầu'}</td>
        <td>${row.status === 'after'
          ? `<input type="number" min="0" step="any" id="receipt-qty-${i}" placeholder="SL nhập" style="width:100px" aria-label="Số nhập ${esc(row.code)} ${esc(row.location)}"><button data-receipt="${i}">Ghi nhập</button>`
          : 'Cần xác minh trước khi ghi'}</td></tr>`).join('')}
      </tbody></table></div>`;
  }
  let pendingRows = [];

  $('pickingStocktakeBtn').onclick = () => { renderLedger(); $('pickingStocktakeDialog').showModal(); };
  $('pickingStocktakeClose').onclick = () => $('pickingStocktakeDialog').close();
  $('pickingStocktakeBranch').onchange = () => renderLedger();

  $('pickingStocktakeLedger').onclick = event => {
    const button = event.target.closest('button');
    if (!button) return;
    $('pickingStocktakeError').textContent = '';
    try {
      if (button.dataset.recount !== undefined) {
        const result = ledger.startCount(button.dataset.branch, button.dataset.recount, { recount:true });
        $('pickingStocktakeError').textContent = 'Khu ' + result.zone + ' đang kiểm kê: ' + fmt(result.locationCount)
          + ' vị trí bị đóng băng, không chỉ định hoặc nhặt đến khi nạp file kiểm kê mới của khu này.';
      } else if (button.dataset.receipt !== undefined) {
        const row = pendingRows[Number(button.dataset.receipt)];
        const input = $('receipt-qty-' + button.dataset.receipt).value;
        if (input === '') throw Error('Nhập số lượng nhập thực tế theo phiếu nhập.');
        // Mã chưa từng có ở vị trí này: lập tồn đầu 0 trước khi ghi lô nhập.
        if (!row.hasOpening) ledger.openZero(row.branch, row.code, row.location);
        ledger.record({ branch:row.branch, code:row.code, location:row.location, type:'receipt', quantity:Number(input) });
        $('pickingStocktakeError').textContent = 'Đã ghi nhập ' + fmt(Number(input)) + ' vào ' + row.location
          + ' · tồn sổ hiện tại ' + fmt(ledger.onHand(row.branch, row.code, row.location));
      } else if (button.id === 'pickingKiotApplyAll') {
        let applied = 0, duplicate = 0, failed = [];
        for (const entry of kiotPlan.filter(row => row.status === 'matched')) {
          try { const written = ledger.applyMatch(entry); written.forEach(m => m.duplicate ? duplicate++ : applied++); }
          catch (err) { failed.push((entry.documentCode || entry.documentId) + ': ' + err.message); }
        }
        $('pickingStocktakeError').textContent = 'Đã ghi ' + fmt(applied) + ' dòng nhập'
          + (duplicate ? ' · ' + fmt(duplicate) + ' dòng đã ghi trước đó, không cộng lại' : '')
          + (failed.length ? ' · Lỗi: ' + failed.join(' | ') : '');
      } else if (button.dataset.kiot !== undefined) {
        const entry = kiotPlan[Number(button.dataset.kiot)];
        let allocation;
        if (entry.status === 'ambiguous') {
          allocation = {};
          for (const candidate of entry.candidates) {
            const value = $('split-' + button.dataset.kiot + '-' + candidate.location)?.value;
            if (value !== '' && value !== undefined) allocation[candidate.location] = Number(value);
          }
          if (!Object.keys(allocation).length) throw Error('Nhập số lượng phân bổ cho ít nhất một vị trí.');
        }
        const written = ledger.applyMatch(entry, allocation);
        $('pickingStocktakeError').textContent = written.every(m => m.duplicate)
          ? 'Chứng từ này đã được ghi trước đó, không cộng lại.'
          : 'Đã ghi ' + written.map(m => fmt(m.quantity) + ' vào ' + m.location).join(', ') + '.';
      } else return;
      renderLedger();
      window.PickingPopup?.attach();
      if ($('pickingDialog')?.open) window.PickingPopup?.refresh?.();
    } catch (err) { $('pickingStocktakeError').textContent = err.message; }
  };

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

  $('pickingStocktakeLedger').onchange = async event => {
    if (event.target.id !== 'pickingKiotFile') return;
    $('pickingStocktakeError').textContent = '';
    try {
      const file = event.target.files[0];
      if (!file) return;
      if (file.size > 20e6) throw Error('File phiếu nhập tối đa 20 MB.');
      kiotReceipts = parseKiotFile(await file.text());
      if (!kiotReceipts.length) throw Error('Không đọc được dòng phiếu nhập nào.');
      renderLedger();
    } catch (err) {
      kiotReceipts = [];
      renderLedger();
      $('pickingStocktakeError').textContent = err.message;
    } finally { event.target.value = ''; }
  };

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && $('pickingStocktakeDialog').open) event.stopImmediatePropagation();
  }, true);
})();
