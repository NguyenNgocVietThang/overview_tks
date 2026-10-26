/* Tồn đầu từ file kiểm kê: khóa mã hàng + vị trí, có thời điểm chốt theo khu.
   Không đọc số lượng của module Vị trí hàng làm tồn hiện tại. */
(function(root){
  'use strict';

  const strip = value => String(value ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g,'')
    .replace(/đ/g,'d').replace(/Đ/g,'D');
  const header = value => strip(value).trim().toLowerCase().replace(/\s+/g,' ');
  // Rule 3: a location name is the identity of the location, so it is normalised once here.
  const locationKey = value => String(value ?? '').trim().toUpperCase().replace(/\s+/g,' ');
  const codeKey = value => String(value ?? '').trim().toLowerCase();
  const stockKey = (branch, code, location) => branch + '|' + codeKey(code) + '|' + locationKey(location);

  // "Ghi chú hàng hóa" must be tested before "Ghi chú"; longest match wins.
  const COLUMNS = [
    { field:'spec',     names:['ghi chu hang hoa','quy cach'] },
    { field:'zone',     names:['ten khach hang','nhom kiem ke','khu'] },
    { field:'code',     names:['ma hang','ma hang hoa','ma'] },
    { field:'name',     names:['ten hang','ten hang hoa','ten san pham'] },
    { field:'location', names:['ghi chu','vi tri'] },
    { field:'quantity', names:['so luong','sl'] }
  ];

  function detectColumns(headerRow){
    const normalised = headerRow.map(header);
    const map = {};
    for (const column of COLUMNS) {
      for (const name of column.names) {
        const index = normalised.indexOf(name);
        if (index !== -1 && !Object.values(map).includes(index)) { map[column.field] = index; break; }
      }
    }
    return map;
  }

  /* Số lượng trong file kiểm kê theo định dạng Việt: dấu . là nghìn, dấu , là thập phân.
     Không đoán bừa: chuỗi không khớp định dạng nào trả null để báo lỗi dòng, không coi là 0. */
  function parseQuantity(value){
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
    const text = String(value ?? '').trim().replace(/\s/g,'');
    if (!text) return null;
    let normalised;
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) normalised = text.replace(/\./g,'').replace(',','.');
    else if (/^\d+,\d+$/.test(text)) normalised = text.replace(',','.');
    else if (/^\d+(\.\d{1,2})?$/.test(text)) normalised = text;
    else return null;
    const number = Number(normalised);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  /* Gộp ghi chú của hai dòng cùng mã + vị trí: cùng SL/thùng thì cộng thùng, khác SL/thùng thì thành nhiều số hạng. */
  function mergeSpec(a, b){
    if (!String(a ?? '').trim()) return b;
    if (!String(b ?? '').trim()) return a;
    const C = root.PickingCarton, left = C?.parseSpec(a), right = C?.parseSpec(b);
    if (!left || !right) return a && b && a !== b ? a + ' + ' + b : (a || b);
    const terms = left.terms.map(t => ({ ...t }));
    for (const term of right.terms) {
      const same = terms.find(t => t.perCarton === term.perCarton);
      if (same) same.cartons += term.cartons; else terms.push({ ...term });
    }
    return C.formatSpec({ terms, loose:left.loose + right.loose });
  }

  function parseTable(text){
    const body = String(text ?? '').replace(/^﻿/,'');
    if (!body.trim()) return [];
    const first = body.split(/\r?\n/,1)[0];
    const delimiter = ['\t',';',','].reduce((best,candidate) =>
      (first.split(candidate).length > first.split(best).length ? candidate : best), ',');
    const rows = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < body.length; i++) {
      const char = body[i];
      if (quoted) {
        if (char !== '"') { field += char; continue; }
        if (body[i+1] === '"') { field += '"'; i++; continue; }
        quoted = false; continue;
      }
      if (char === '"') { quoted = true; continue; }
      if (char === delimiter) { row.push(field); field = ''; continue; }
      if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
      if (char === '\r') continue;
      field += char;
    }
    row.push(field); rows.push(row);
    return rows.filter(cells => cells.some(cell => String(cell).trim() !== ''));
  }

  /* Gộp file kiểm kê thành tồn đầu theo mã hàng + vị trí.
     Dòng trùng mã và vị trí được cộng lại (quy tắc 2). */
  function build(text, options = {}){
    const branch = options.branch;
    const rows = Array.isArray(text) ? text : parseTable(text);
    if (!rows.length) return { branch, lines:[], zones:[], errors:['File kiểm kê rỗng.'], skipped:[] };
    const columns = detectColumns(rows[0]);
    // SL lấy từ ghi chú quy cách nên cột Số lượng chỉ bắt buộc khi file không có cột Ghi chú hàng hóa.
    const missing = ['code','location','quantity'].filter(field => columns[field] === undefined && !(field === 'quantity' && columns.spec !== undefined));
    if (missing.length) return { branch, lines:[], zones:[], skipped:[],
      errors:['Thiếu cột bắt buộc: ' + missing.map(f => ({code:'Mã hàng',location:'Ghi chú (vị trí)',quantity:'Số lượng'})[f]).join(', ') + '.'] };

    const cell = (cells, field) => columns[field] === undefined ? '' : String(cells[columns[field]] ?? '').trim();
    const lines = new Map(), zones = new Map(), errors = [], skipped = [];

    rows.slice(1).forEach((cells, index) => {
      const sourceRow = index + 2;
      const code = cell(cells,'code'), location = cell(cells,'location');
      /* Ghi chú đọc được (5T x 100) là nguồn SL chính; cột Số lượng của file chỉ là dự phòng cho dòng chưa có quy cách. */
      const specCell = cell(cells,'spec'), parsedSpec = specCell ? root.PickingCarton?.parseSpec(specCell) : null;
      const quantity = parsedSpec ? parsedSpec.quantity : parseQuantity(cell(cells,'quantity'));
      const zone = cell(cells,'zone') || 'Chưa đặt tên khu';
      if (!code || !location || quantity === null) {
        skipped.push({ sourceRow, code, location, zone, reason:
          !code ? 'Thiếu mã hàng' : !location ? 'Thiếu vị trí ở cột Ghi chú' : 'Số lượng không đọc được: ' + cell(cells,'quantity') });
        return;
      }
      const key = stockKey(branch, code, location);
      const existing = lines.get(key);
      if (existing) {
        existing.quantity += quantity;
        // Hai dòng cùng vị trí là hai quy cách của cùng một chỗ chứa: nối bằng dấu + (sẽ bị cảnh báo nhiều quy cách).
        existing.spec = mergeSpec(existing.spec, cell(cells,'spec'));
        existing.sourceRows.push(sourceRow);
        if (existing.zone !== zone) existing.zoneConflicts.add(zone);
      } else {
        lines.set(key, { key, branch, code, codeKey:codeKey(code), location:locationKey(location), rawLocation:location,
          name:cell(cells,'name'), spec:cell(cells,'spec'), zone, quantity, sourceRows:[sourceRow], zoneConflicts:new Set() });
      }
      const zoneEntry = zones.get(zone) || { zone, locations:new Set(), codes:new Set(), quantity:0, cutoffAt:null };
      zoneEntry.locations.add(locationKey(location));
      zoneEntry.codes.add(codeKey(code));
      zoneEntry.quantity += quantity;
      zones.set(zone, zoneEntry);
    });

    /* Quy tắc 3: một vị trí chỉ thuộc một khu. Vị trí nằm ở hai khu nghĩa là hai giờ chốt
       khác nhau cho cùng chỗ chứa, không thể tính tồn đúng — phải sửa file trước. */
    const owners = new Map();
    for (const line of lines.values()) {
      const zoneSet = owners.get(line.location) || new Set();
      zoneSet.add(line.zone);
      for (const zone of line.zoneConflicts) zoneSet.add(zone);
      owners.set(line.location, zoneSet);
    }
    for (const [location, zoneSet] of owners) {
      if (zoneSet.size > 1) errors.push('Vị trí ' + location + ' xuất hiện ở nhiều khu: ' + [...zoneSet].join(' / ') + '. Vị trí phải là duy nhất.');
    }

    return {
      branch,
      lines: [...lines.values()].map(({ zoneConflicts, ...line }) => line),
      zones: [...zones.values()].map(z => ({ zone:z.zone, locationCount:z.locations.size, codeCount:z.codes.size, quantity:z.quantity, cutoffAt:null })),
      errors, skipped
    };
  }

  /* NGÀY VỀ của tab Vị trí hàng là ngày, không có giờ. Trả về mốc 00:00 giờ Việt Nam. */
  function parseSheetDate(value){
    const text = String(value ?? '').trim();
    let match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
    if (match) return Date.parse(match[3] + '-' + match[2].padStart(2,'0') + '-' + match[1].padStart(2,'0') + 'T00:00:00+07:00');
    match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    if (match) return Date.parse(match[1] + '-' + match[2] + '-' + match[3] + 'T00:00:00+07:00');
    return null;
  }
  const vnDate = ms => new Date(ms + 7 * 3600e3).toISOString().slice(0, 10);

  /* Sổ tồn vị trí dùng chung.
     tồn vị trí = tồn kiểm kê tại giờ chốt + nhập sau giờ chốt − thực nhặt sau giờ chốt ± điều chỉnh */
  function createLedger(){
    const openings = new Map();   // stockKey -> {quantity, zone, location, code, branch, confirmedAt}
    const zoneCutoffs = new Map(); // branch|zone -> ISO string
    const counting = new Map();   // branch|zone -> {zone, startedAt, locations:Set} — khu đang đếm, đóng băng
    const movements = [];
    let version = 0;

    const zoneKey = (branch, zone) => branch + '|' + String(zone ?? '').trim().toLowerCase();
    const time = value => { const t = Date.parse(value); return Number.isFinite(t) ? t : null; };

    const api = {
      get version(){ return version; },
      /* Nạp một snapshot kiểm kê. Mỗi khu phải có giờ chốt, nếu không thì khu đó không được dùng
         làm tồn đầu (không thể biết biến động nào đã nằm trong số đếm). */
      load(snapshot, cutoffs = {}){
        if (snapshot.errors?.length) throw Error(snapshot.errors[0]);
        const loaded = [], pending = [];
        for (const zone of snapshot.zones) {
          const cutoff = cutoffs[zone.zone] ?? zone.cutoffAt;
          if (!cutoff || time(cutoff) === null) { pending.push(zone.zone); continue; }
          zoneCutoffs.set(zoneKey(snapshot.branch, zone.zone), new Date(time(cutoff)).toISOString());
          // Chốt kỳ kiểm kê là mốc mở lại khu: hết đóng băng, từ đây mới cộng biến động.
          counting.delete(zoneKey(snapshot.branch, zone.zone));
          loaded.push(zone.zone);
        }
        const accepted = new Set(loaded);
        let lineCount = 0;
        for (const line of snapshot.lines) {
          if (!accepted.has(line.zone)) continue;
          openings.set(line.key, { branch:line.branch, code:line.code, codeKey:line.codeKey, location:line.location,
            zone:line.zone, spec:line.spec, name:line.name, quantity:line.quantity, sourceRows:line.sourceRows.slice() });
          lineCount++;
        }
        version++;
        return { loadedZones:loaded, pendingZones:pending, lineCount };
      },
      /* Khu đang kiểm kê bị đóng băng: không chỉ định, không nhặt ở khu đó trong ngày đếm.
         Nhờ vậy một giờ chốt cho cả khu là đủ — không có biến động nào xảy ra giữa lúc đếm. */
      startCount(branch, zone, options = {}){
        if (api.cutoff(branch, zone) && !options.recount) throw Error('Khu ' + zone + ' đã có kỳ kiểm kê chốt lúc ' + api.cutoff(branch, zone) + '. Dùng recount để đếm lại.');
        const previous = [...openings.values()].filter(o => o.branch === branch && o.zone === zone).map(o => o.location);
        const locations = new Set((options.locations || previous).map(locationKey));
        if (!locations.size) throw Error('Cần danh sách vị trí của khu ' + zone + ' để đóng băng khu khi đếm.');
        counting.set(zoneKey(branch, zone), { zone, branch, startedAt:options.startedAt || new Date().toISOString(), locations });
        version++;
        return { zone, locationCount:locations.size };
      },
      // Khu đang đếm; trả null nếu khu đã chốt hoặc chưa bắt đầu đếm.
      countingZone(branch, zone){ return counting.get(zoneKey(branch, zone)) || null; },
      /* Vị trí có đang bị đóng băng vì khu của nó đang đếm hay không.
         Dùng cho cả vị trí chưa từng có tồn kiểm kê (kỳ đếm đầu tiên của khu). */
      frozen(branch, location){
        const key = locationKey(location);
        for (const entry of counting.values()) if (entry.branch === branch && entry.locations.has(key)) return entry;
        return null;
      },
      countingZones(branch){
        return [...counting.values()].filter(entry => !branch || entry.branch === branch)
          .map(entry => ({ branch:entry.branch, zone:entry.zone, startedAt:entry.startedAt, locationCount:entry.locations.size }));
      },
      setCutoff(branch, zone, cutoffAt){
        if (time(cutoffAt) === null) throw Error('Thời điểm chốt kiểm kê không hợp lệ.');
        zoneCutoffs.set(zoneKey(branch, zone), new Date(time(cutoffAt)).toISOString());
        version++;
      },
      cutoff(branch, zone){ return zoneCutoffs.get(zoneKey(branch, zone)) || null; },
      opening(branch, code, location){ return openings.get(stockKey(branch, code, location)) || null; },
      /* Biến động trước hoặc đúng giờ chốt đã nằm trong số kiểm kê — ghi nhận nhưng không cộng lại. */
      record(movement){
        const freeze = api.frozen(movement.branch, movement.location);
        if (freeze) throw Error('Khu ' + freeze.zone + ' đang kiểm kê từ ' + freeze.startedAt + '. Không ra đơn hoặc nhặt ở khu này đến khi chốt kỳ kiểm kê.');
        const opening = api.opening(movement.branch, movement.code, movement.location);
        if (!opening) throw Error('Chưa có tồn kiểm kê cho ' + movement.code + ' tại ' + movement.location + '.');
        if (!['receipt','pick','adjust'].includes(movement.type)) throw Error('Loại biến động phải là receipt, pick hoặc adjust.');
        /* Một chứng từ gốc chỉ ghi một lần: đồng bộ lại hoặc bấm lại không cộng thêm.
           Cùng ref mà khác số thì là chứng từ đã bị sửa — phải xử lý bằng điều chỉnh có lý do,
           không ghi đè lịch sử. */
        if (movement.ref) {
          const existing = movements.find(m => m.ref === movement.ref);
          if (existing) {
            const repeat = parseQuantity(String(movement.quantity ?? '').trim().replace(/^-/,''));
            if (Math.abs(Math.abs(existing.quantity) - (repeat ?? NaN)) > 1e-6)
              throw Error('Chứng từ ' + movement.ref + ' đã ghi ' + existing.quantity + ', nay nhận ' + movement.quantity
                + '. Chứng từ đã bị sửa: ghi điều chỉnh chênh lệch có lý do, không ghi đè.');
            return { ...existing, duplicate:true };
          }
        }
        // Chỉ điều chỉnh được mang dấu âm; nhập và thực nhặt luôn là số không âm.
        const text = String(movement.quantity ?? '').trim();
        const negative = movement.type === 'adjust' && text.startsWith('-');
        const magnitude = parseQuantity(negative ? text.slice(1) : movement.quantity);
        if (magnitude === null) throw Error('Số lượng biến động không hợp lệ.');
        const signed = negative ? -magnitude : magnitude;
        const at = movement.at || new Date().toISOString();
        const cutoff = api.cutoff(movement.branch, opening.zone);
        const counted = cutoff !== null && time(at) !== null && time(at) <= time(cutoff);
        const entry = { ...movement, quantity:signed, at, zone:opening.zone, counted,
          key:stockKey(movement.branch, movement.code, movement.location) };
        movements.push(entry);
        version++;
        return entry;
      },
      movements(filter = {}){
        return movements.filter(m => (!filter.key || m.key === filter.key) && (!filter.branch || m.branch === filter.branch));
      },

      /* Ghép phiếu nhập Kiot với vị trí của tab Vị trí hàng.
         Kiot cho số lượng + ngày nhưng không cho vị trí; tab Vị trí hàng cho vị trí + NGÀY VỀ
         nhưng TỔNG SL không phải tồn còn. Ghép theo mã hàng + ngày lấy được cả hai.
         receipts: [{branch, productCode, purchaseDate, quantity, documentId, documentCode, lineNo}]
         — purchase_details.product_id phải được đổi sang mã hàng qua bảng products trước khi gọi. */
      matchReceipts(branch, sheetRows, receipts){
        const plan = [];
        for (const receipt of receipts || []) {
          if (receipt.branch && receipt.branch !== branch) continue;
          const quantity = parseQuantity(receipt.quantity);
          const day = parseSheetDate(receipt.purchaseDate);
          const base = { branch, productCode:receipt.productCode, purchaseDate:receipt.purchaseDate,
            quantity, documentId:receipt.documentId, documentCode:receipt.documentCode, lineNo:receipt.lineNo ?? 0 };
          if (quantity === null || !receipt.productCode) { plan.push({ ...base, status:'invalid',
            reason:'Phiếu nhập thiếu mã hàng hoặc số lượng không đọc được.' }); continue; }
          if (day === null) { plan.push({ ...base, status:'invalid',
            reason:'Ngày phiếu nhập không đọc được: ' + (receipt.purchaseDate ?? '(trống)') }); continue; }
          const receiptDay = vnDate(day);

          // Vị trí ứng viên: cùng mã, cùng NGÀY VỀ, thuộc khu đã chốt kỳ kiểm kê.
          const candidates = [];
          let countedAlready = false;
          for (const row of sheetRows || []) {
            if ((row.branch && row.branch !== branch) || codeKey(row.code) !== codeKey(receipt.productCode)) continue;
            const arrival = parseSheetDate(row.arrivalDate);
            if (arrival === null || vnDate(arrival) !== receiptDay) continue;
            const zone = api.zoneOfLocation(branch, row.location);
            const cutoff = zone && api.cutoff(branch, zone);
            if (!cutoff) continue;
            if (receiptDay <= vnDate(time(cutoff))) { countedAlready = true; continue; }
            candidates.push({ location:locationKey(row.location), zone, cutoffAt:cutoff });
          }
          const unique = [...new Map(candidates.map(c => [c.location, c])).values()];

          if (unique.length === 1) plan.push({ ...base, status:'matched', location:unique[0].location, zone:unique[0].zone,
            candidates:unique, reason:'Một vị trí duy nhất cùng mã và cùng NGÀY VỀ. Cộng được tự động.' });
          else if (unique.length > 1) plan.push({ ...base, status:'ambiguous', candidates:unique,
            reason:'Cùng mã về cùng ngày ở ' + unique.length + ' vị trí: ' + unique.map(c => c.location).join(', ')
              + '. Máy không chia được, cần người phân số lượng.' });
          else if (countedAlready) plan.push({ ...base, status:'counted', candidates:[],
            reason:'Về trước hoặc đúng ngày chốt kiểm kê, đã nằm trong số đếm.' });
          else plan.push({ ...base, status:'no-location', candidates:[],
            reason:'Kiot có phiếu nhập nhưng tab Vị trí hàng chưa có dòng cùng mã và cùng NGÀY VỀ ở khu đã kiểm kê.' });
        }
        return plan;
      },

      /* Ghi một dòng kế hoạch vào sổ. allocation = {vị trí: số lượng} cho trường hợp nhiều vị trí;
         bỏ trống thì dùng vị trí duy nhất đã ghép. Mỗi chứng từ–dòng–vị trí chỉ ghi một lần. */
      applyMatch(entry, allocation){
        if (!['matched','ambiguous'].includes(entry.status)) throw Error('Chỉ ghi được dòng đã ghép được vị trí.');
        const split = allocation || (entry.location ? { [entry.location]:entry.quantity } : null);
        if (!split) throw Error('Cần phân số lượng theo vị trí.');
        const total = Object.values(split).reduce((sum, q) => sum + Number(q || 0), 0);
        if (Math.abs(total - entry.quantity) > 1e-6)
          throw Error('Tổng phân bổ ' + total + ' không bằng số nhập ' + entry.quantity + '.');
        const allowed = new Set(entry.candidates.map(c => c.location));
        const written = [];
        for (const [location, quantity] of Object.entries(split)) {
          if (!Number(quantity)) continue;
          if (!allowed.has(locationKey(location))) throw Error('Vị trí ' + location + ' không phải ứng viên của phiếu nhập này.');
          if (!openings.has(stockKey(entry.branch, entry.productCode, location))) api.openZero(entry.branch, entry.productCode, location);
          written.push(api.record({ branch:entry.branch, code:entry.productCode, location, type:'receipt', quantity:Number(quantity),
            ref:'KIOT:' + entry.documentId + ':' + entry.lineNo + '@' + locationKey(location),
            document:entry.documentCode, at:new Date(parseSheetDate(entry.purchaseDate) + 12 * 3600e3).toISOString() }));
        }
        return written;
      },
      /* null = chưa có tồn xác nhận cho vị trí này; không suy ra từ số nhập đầu của Sheet. */
      onHand(branch, code, location){
        const key = stockKey(branch, code, location);
        const opening = openings.get(key);
        if (!opening) return null;
        let total = opening.quantity;
        for (const movement of movements) {
          if (movement.key !== key || movement.counted) continue;
          if (movement.type === 'receipt') total += movement.quantity;
          else if (movement.type === 'pick') total -= movement.quantity;
          else if (movement.type === 'adjust') total += movement.quantity;
        }
        return Math.round(total * 1e6) / 1e6;
      },
      /* Tổng đã xác minh: chỉ gồm vị trí có tồn kiểm kê. Không gọi là tổng đầy đủ. */
      verifiedTotal(branch, code){
        const rows = [...openings.values()].filter(o => o.branch === branch && o.codeKey === codeKey(code));
        return { locationCount:rows.length,
          quantity: rows.reduce((sum, row) => sum + api.onHand(row.branch, row.code, row.location), 0) };
      },
      zones(branch){
        const seen = new Map();
        for (const opening of openings.values()) {
          if (branch && opening.branch !== branch) continue;
          const entry = seen.get(opening.zone) || { zone:opening.zone, branch:opening.branch, locationCount:0, cutoffAt:api.cutoff(opening.branch, opening.zone) };
          entry.locationCount++;
          seen.set(opening.zone, entry);
        }
        return [...seen.values()];
      },
      has(branch){ for (const opening of openings.values()) if (!branch || opening.branch === branch) return true; return false; },
      // Khu của một vị trí, suy từ các dòng đã kiểm kê. Vị trí là duy nhất nên chỉ thuộc một khu.
      zoneOfLocation(branch, location){
        const key = locationKey(location);
        for (const opening of openings.values()) if (opening.branch === branch && opening.location === key) return opening.zone;
        for (const entry of counting.values()) if (entry.branch === branch && entry.locations.has(key)) return entry.zone;
        return null;
      },
      /* Mã mới tại một vị trí đã kiểm kê: người đếm không thấy mã này ở đó lúc chốt, nên tồn đầu
         là 0 — một dữ kiện có thật, không phải phỏng đoán. Phải có để ghi được lô nhập sau đó. */
      openZero(branch, code, location){
        const zone = api.zoneOfLocation(branch, location);
        if (!zone) throw Error('Vị trí ' + location + ' chưa thuộc khu nào đã kiểm kê.');
        if (!api.cutoff(branch, zone)) throw Error('Khu ' + zone + ' chưa chốt kỳ kiểm kê.');
        const key = stockKey(branch, code, location);
        if (openings.has(key)) return openings.get(key);
        const entry = { branch, code, codeKey:codeKey(code), location:locationKey(location), zone,
          spec:'', name:'', quantity:0, sourceRows:[] };
        openings.set(key, entry);
        version++;
        return entry;
      },
      /* Hàng về sau giờ chốt: tab Vị trí hàng cho biết mã + vị trí + NGÀY VỀ, nhưng TỔNG SL
         của tab đó không phải tồn còn (quy tắc 1). Vì vậy chỉ lập danh sách việc cần nhập số
         lượng từ nguồn đáng tin, không tự cộng số nào vào sổ. */
      pendingReceipts(branch, rows){
        const result = [];
        for (const row of rows || []) {
          if (row.branch && row.branch !== branch) continue;
          if (!row.code || !row.location) continue;
          const zone = api.zoneOfLocation(branch, row.location);
          if (!zone) continue;                                   // vị trí chưa thuộc khu nào đã kiểm kê
          const cutoff = api.cutoff(branch, zone);
          if (!cutoff) continue;                                 // khu chưa chốt, chưa so được
          const arrival = parseSheetDate(row.arrivalDate);
          const key = stockKey(branch, row.code, row.location);
          const base = { branch, code:row.code, location:locationKey(row.location), zone, cutoffAt:cutoff,
            arrivalDate:row.arrivalDate, hasOpening:openings.has(key), key };
          if (arrival === null) { result.push({ ...base, status:'unknown-date',
            reason:'NGÀY VỀ không đọc được: ' + (row.arrivalDate ?? '(trống)') }); continue; }
          const arrivalDay = vnDate(arrival), cutoffDay = vnDate(time(cutoff));
          if (arrivalDay > cutoffDay) result.push({ ...base, status:'after',
            reason: base.hasOpening ? 'Lô về sau giờ chốt, cần số lượng nhập.' : 'Mã mới tại vị trí đã kiểm kê, cần số lượng nhập.' });
          else if (arrivalDay === cutoffDay) result.push({ ...base, status:'same-day',
            reason:'Về đúng ngày chốt. Cần xác nhận người đếm đã tính lô này chưa.' });
          else if (!base.hasOpening) result.push({ ...base, status:'missing',
            reason:'Về trước giờ chốt nhưng không có trong file kiểm kê. Có thể đếm sót.' });
        }
        return result;
      },
      reset(){ openings.clear(); zoneCutoffs.clear(); counting.clear(); movements.length = 0; version++; }
    };
    return api;
  }

  const api = { version:'stocktake-opening-v2', parseTable, parseQuantity, parseSheetDate, detectColumns, build, createLedger, locationKey, codeKey, stockKey };
  if (typeof module !== 'undefined') module.exports = api;
  else { root.PickingStocktake = api; root.PickingLedger = createLedger(); }
})(typeof window !== 'undefined' ? window : globalThis);
