'use strict';

// ==========================================
// BAO CAO HTML TU CHUA — renderer thu hai cua luong xuat (ben canh Excel)
//
// Nhan dataset da tong hop tu exportService.getExportDataset() va tao MOT file
// .html mo duoc qua file:// ma khong can mang:
//   - KPI render san phia server;
//   - Chart.js (ban vendor trong public/vendor) nhung inline, du lieu nhung JSON;
//   - bang + tim kiem/loc/sap xep/phan trang chay bang JS thuan tren du lieu nhung.
// Logic tinh KPI/bieu do nam trong createReportKit() — ham TU CHUA duoc goi o
// server de render san va duoc nhung nguyen van (toString) vao file de tinh lai
// khi nguoi xem loc, nen chi co mot noi dinh nghia cach tong hop.
// File khong chua token/cookie/URL noi bo; CSP chan moi ket noi mang.
// ==========================================

const fs = require('fs');
const path = require('path');

const CHART_JS_PATH = path.join(__dirname, '..', 'public', 'vendor', 'chart.umd.min.js');
let chartJsSource = null;

function getChartJsSource() {
  if (chartJsSource === null) {
    // Chen trong <script>: khong de chuoi "</script" dong the som.
    chartJsSource = fs.readFileSync(CHART_JS_PATH, 'utf8').replace(/<\/script/gi, '<\\/script');
  }
  return chartJsSource;
}

/**
 * Bo ham tong hop/dinh dang dung chung server + trinh duyet. PHAI tu chua (khong
 * tham chieu bien ngoai) vi duoc nhung bang Function.prototype.toString().
 */
function createReportKit() {
  var numberFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });
  var shortFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });

  function isEmpty(value) {
    return value === undefined || value === null || value === '' || value === '—';
  }

  function toNumber(value) {
    if (isEmpty(value)) return NaN;
    return typeof value === 'number' ? value : Number(value);
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  // Ngay luu dang ISO (server chuan hoa) hoac dd/mm/yyyy [hh:mm[:ss]] nhu KiotViet.
  function parseDate(value) {
    if (isEmpty(value)) return null;
    var text = String(value).trim();
    var match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2}))?/);
    if (match) return { y: +match[1], m: +match[2], d: +match[3], hh: match[4] === undefined ? null : +match[4], mi: match[5] === undefined ? null : +match[5] };
    match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (match) return { y: +match[3], m: +match[2], d: +match[1], hh: match[4] === undefined ? null : +match[4], mi: match[5] === undefined ? null : +match[5] };
    return null;
  }

  function formatCell(value, column) {
    if (isEmpty(value)) return '';
    var type = column && column.type;
    if (type === 'number') {
      var number = toNumber(value);
      return isFinite(number) ? numberFormat.format(number) : String(value);
    }
    if (type === 'percent') {
      var ratio = toNumber(value);
      return isFinite(ratio) ? numberFormat.format(Math.round(ratio * 10000) / 100) + '%' : String(value);
    }
    if (type === 'date') {
      var date = parseDate(value);
      if (!date) return String(value);
      var day = pad(date.d) + '/' + pad(date.m) + '/' + date.y;
      return date.hh === null || (date.hh === 0 && date.mi === 0) ? day : day + ' ' + pad(date.hh) + ':' + pad(date.mi);
    }
    return String(value);
  }

  function sortValue(value, column) {
    if (isEmpty(value)) return null;
    var type = column && column.type;
    if (type === 'number' || type === 'percent') {
      var number = toNumber(value);
      return isFinite(number) ? number : null;
    }
    if (type === 'date') {
      var date = parseDate(value);
      return date ? date.y * 1e8 + date.m * 1e6 + date.d * 1e4 + (date.hh || 0) * 100 + (date.mi || 0) : null;
    }
    return String(value);
  }

  function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Rut gon theo don vi tieng Viet (Intl compact cua vi-VN ra "T" de nham tram nghin/ty).
  function formatShort(value) {
    if (!isFinite(value)) return '—';
    var abs = Math.abs(value);
    if (abs >= 1e9) return shortFormat.format(value / 1e9) + ' tỷ';
    if (abs >= 1e6) return shortFormat.format(value / 1e6) + ' triệu';
    if (abs >= 1e4) return shortFormat.format(value / 1e3) + ' nghìn';
    return numberFormat.format(value);
  }

  function formatMetric(value) {
    if (!isFinite(value)) return '—';
    return Math.abs(value) >= 1e7 ? formatShort(value) : numberFormat.format(value);
  }

  function totalLabel(label) {
    return /^tổng/i.test(label) ? label : 'Tổng ' + label.toLocaleLowerCase('vi-VN');
  }

  // Cot so co the cong don (loai don gia/ty le/trung binh — cong lai vo nghia).
  var NON_ADDITIVE = /(^|\s)(giá bán|giá vốn|đơn giá|giá nhập|giá)(\s|$)|tỷ|trung bình|điểm|trọng lượng|mã/i;
  var METRIC_PRIORITY = [/doanh thu|doanh số/i, /tiền|giá trị|nợ|phải trả|cần trả|thanh toán/i, /số lượng|\bsl\b/i, /tồn/i, /số ngày|số lần/i];
  var LABEL_PRIORITY = [/^tên|tên hàng|tên sản phẩm/i, /khách hàng|nhà cung cấp|ncc/i, /nhóm/i];
  var CATEGORY_PRIORITY = /cơ sở|chi nhánh|trạng thái|nhóm|loại|sale|nhân viên|kênh|thương hiệu|lịch/i;
  var CODE_LIKE = /(^|\s)(mã|id|sđt|điện thoại|email|địa chỉ|ghi chú)/i;

  function rank(label, patterns) {
    for (var i = 0; i < patterns.length; i += 1) if (patterns[i].test(label)) return i;
    return patterns.length;
  }

  function metricColumns(columns) {
    return columns
      .map(function (column, index) { return { column: column, index: index }; })
      .filter(function (entry) { return entry.column.type === 'number' && !NON_ADDITIVE.test(entry.column.label); })
      .sort(function (a, b) { return rank(a.column.label, METRIC_PRIORITY) - rank(b.column.label, METRIC_PRIORITY) || a.index - b.index; })
      .map(function (entry) { return entry.index; });
  }

  function isTextual(column) {
    return column.type === 'text' || column.type === 'general' || !column.type;
  }

  function labelColumn(columns) {
    var candidates = columns
      .map(function (column, index) { return { column: column, index: index }; })
      .filter(function (entry) { return isTextual(entry.column) && !/(^|\s)(mã|id)(\s|$)/i.test(entry.column.label); })
      .sort(function (a, b) { return rank(a.column.label, LABEL_PRIORITY) - rank(b.column.label, LABEL_PRIORITY) || a.index - b.index; });
    if (candidates.length) return candidates[0].index;
    var any = columns.findIndex(isTextual);
    return any;
  }

  // Cot phan loai: 2..12 gia tri khac nhau, phu >= 60% so dong.
  function categoryColumn(columns, rows, exclude) {
    var best = -1;
    var bestScore = -1;
    columns.forEach(function (column, index) {
      if (index === exclude || !isTextual(column) || CODE_LIKE.test(column.label)) return;
      var seen = {};
      var distinct = 0;
      var filled = 0;
      for (var r = 0; r < rows.length; r += 1) {
        var value = rows[r][index];
        if (isEmpty(value)) continue;
        filled += 1;
        if (!Object.prototype.hasOwnProperty.call(seen, value)) {
          seen[value] = true;
          distinct += 1;
          if (distinct > 12) return;
        }
      }
      if (distinct < 2 || filled < rows.length * 0.6) return;
      var score = (CATEGORY_PRIORITY.test(column.label) ? 100 : 0) + (12 - distinct);
      if (score > bestScore) { bestScore = score; best = index; }
    });
    return best;
  }

  function dateColumn(columns) {
    return columns.findIndex(function (column) { return column.type === 'date'; });
  }

  function sumColumn(rows, index) {
    var total = 0;
    for (var r = 0; r < rows.length; r += 1) {
      var number = toNumber(rows[r][index]);
      if (isFinite(number)) total += number;
    }
    return total;
  }

  function groupBy(rows, keyOf, metricIndex) {
    var groups = {};
    var order = [];
    rows.forEach(function (row) {
      var key = keyOf(row);
      if (key === null || key === undefined || key === '') return;
      if (!Object.prototype.hasOwnProperty.call(groups, key)) { groups[key] = 0; order.push(key); }
      if (metricIndex < 0) groups[key] += 1;
      else {
        var number = toNumber(row[metricIndex]);
        if (isFinite(number)) groups[key] += number;
      }
    });
    return order.map(function (key) { return { key: key, value: groups[key] }; });
  }

  function trendChart(columns, rows, dateIndex, metricIndex) {
    var dates = [];
    rows.forEach(function (row) { var date = parseDate(row[dateIndex]); if (date) dates.push(date); });
    if (dates.length < 2) return null;
    var keys = dates.map(function (date) { return date.y * 10000 + date.m * 100 + date.d; });
    var min = Math.min.apply(null, keys);
    var max = Math.max.apply(null, keys);
    if (min === max) return null;
    var span = (Math.floor(max / 10000) - Math.floor(min / 10000)) * 12 + (Math.floor(max / 100) % 100) - (Math.floor(min / 100) % 100);
    var byMonth = span >= 2;
    var groups = groupBy(rows, function (row) {
      var date = parseDate(row[dateIndex]);
      if (!date) return null;
      return byMonth ? date.y + '-' + pad(date.m) : date.y + '-' + pad(date.m) + '-' + pad(date.d);
    }, metricIndex).sort(function (a, b) { return a.key < b.key ? -1 : 1; });
    var metricLabel = metricIndex >= 0 ? columns[metricIndex].label : 'Số dòng';
    return {
      id: 'trend',
      type: 'line',
      title: metricLabel + ' theo ' + (byMonth ? 'tháng' : 'ngày'),
      subtitle: 'Theo cột “' + columns[dateIndex].label + '”',
      labels: groups.map(function (group) {
        var parts = group.key.split('-');
        return byMonth ? parts[1] + '/' + parts[0] : parts[2] + '/' + parts[1];
      }),
      values: groups.map(function (group) { return group.value; }),
      valueLabel: metricLabel
    };
  }

  function topChart(columns, rows, labelIndex, metricIndex, id) {
    var groups = groupBy(rows, function (row) { return isEmpty(row[labelIndex]) ? null : String(row[labelIndex]); }, metricIndex)
      .filter(function (group) { return group.value !== 0; })
      .sort(function (a, b) { return b.value - a.value; })
      .slice(0, 10);
    if (groups.length === 0) return null;
    return {
      id: id,
      type: 'bar',
      title: 'Top ' + groups.length + ' ' + columns[labelIndex].label.toLocaleLowerCase('vi-VN') + ' theo ' + columns[metricIndex].label.toLocaleLowerCase('vi-VN'),
      subtitle: 'Cộng dồn trên các dòng đang hiển thị',
      labels: groups.map(function (group) { return group.key.length > 38 ? group.key.slice(0, 36) + '…' : group.key; }),
      values: groups.map(function (group) { return group.value; }),
      valueLabel: columns[metricIndex].label
    };
  }

  function shareChart(columns, rows, categoryIndex, metricIndex) {
    var groups = groupBy(rows, function (row) { return isEmpty(row[categoryIndex]) ? '(Trống)' : String(row[categoryIndex]); }, metricIndex)
      .filter(function (group) { return group.value > 0; })
      .sort(function (a, b) { return b.value - a.value; });
    if (groups.length < 2) return null;
    var metricLabel = metricIndex >= 0 ? columns[metricIndex].label : 'Số dòng';
    return {
      id: 'share',
      type: 'doughnut',
      title: 'Cơ cấu theo ' + columns[categoryIndex].label.toLocaleLowerCase('vi-VN'),
      subtitle: 'Tỷ trọng ' + metricLabel.toLocaleLowerCase('vi-VN'),
      labels: groups.map(function (group) { return group.key; }),
      values: groups.map(function (group) { return group.value; }),
      valueLabel: metricLabel
    };
  }

  /**
   * Tong hop 1 worksheet: rows la mang gia tri theo thu tu columns.
   * `plan` (tuy chon) co dinh cot duoc chon tu toan bo du lieu de khi loc
   * KPI/bieu do khong nhay sang cot khac.
   */
  function planFor(columns, rows) {
    var metrics = metricColumns(columns);
    var label = labelColumn(columns);
    return {
      metrics: metrics.slice(0, 3),
      label: label,
      category: categoryColumn(columns, rows, label),
      date: dateColumn(columns)
    };
  }

  function buildSummary(columns, rows, plan) {
    var p = plan || planFor(columns, rows);
    var kpis = [{ label: 'Số dòng dữ liệu', value: rows.length, formatted: numberFormat.format(rows.length), hint: columns.length + ' cột' }];
    p.metrics.forEach(function (index) {
      var total = sumColumn(rows, index);
      var formatted = formatMetric(total);
      var exact = numberFormat.format(total);
      kpis.push({ label: totalLabel(columns[index].label), value: total, formatted: formatted, hint: formatted === exact ? 'Cộng dồn ' + numberFormat.format(rows.length) + ' dòng' : exact });
    });
    if (kpis.length < 4 && p.label >= 0) {
      var distinct = {};
      var count = 0;
      rows.forEach(function (row) { var value = row[p.label]; if (!isEmpty(value) && !distinct[value]) { distinct[value] = true; count += 1; } });
      kpis.push({ label: columns[p.label].label + ' (khác nhau)', value: count, formatted: numberFormat.format(count), hint: 'Đếm giá trị không trùng' });
    }
    var primary = p.metrics.length ? p.metrics[0] : -1;
    var charts = [];
    if (p.date >= 0) charts.push(trendChart(columns, rows, p.date, primary));
    if (primary >= 0 && p.label >= 0) charts.push(topChart(columns, rows, p.label, primary, 'top'));
    if (p.category >= 0) charts.push(shareChart(columns, rows, p.category, primary));
    if (charts.filter(Boolean).length < 2 && p.metrics.length > 1 && p.label >= 0) charts.push(topChart(columns, rows, p.label, p.metrics[1], 'top2'));
    return { plan: p, kpis: kpis.slice(0, 4), charts: charts.filter(Boolean).slice(0, 3) };
  }

  function kpiCardsHtml(kpis) {
    return kpis.map(function (kpi, index) {
      return '<article class="kpi' + (index === 0 ? ' kpi--lead' : '') + '">' +
        '<p class="kpi-label">' + escapeHtml(kpi.label) + '</p>' +
        '<p class="kpi-value" title="' + escapeHtml(kpi.hint) + '">' + escapeHtml(kpi.formatted) + '</p>' +
        '<p class="kpi-hint">' + escapeHtml(kpi.hint) + '</p></article>';
    }).join('');
  }

  return {
    isEmpty: isEmpty,
    formatCell: formatCell,
    sortValue: sortValue,
    escapeHtml: escapeHtml,
    planFor: planFor,
    buildSummary: buildSummary,
    kpiCardsHtml: kpiCardsHtml,
    formatShort: formatShort
  };
}

const kit = createReportKit();

// ---------- Chuan hoa dataset -> du lieu nhung ----------

function isoDate(value) {
  const pad = number => String(number).padStart(2, '0');
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}T${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`;
}

function embedValue(value, column) {
  if (kit.isEmpty(value)) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : isoDate(value);
  if (column.type === 'number' || column.type === 'percent') {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? number : String(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
}

function embedWorksheet(worksheet) {
  const columns = worksheet.columns.map(column => ({ key: column.key, label: column.label, type: column.type || 'general' }));
  const rows = worksheet.rows.map(row => columns.map(column => embedValue(row[column.key], column)));
  return { key: worksheet.key, name: worksheet.name, columns, rows };
}

/** JSON an toan trong <script>: khong the dong the hay tao comment HTML. */
function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .split(String.fromCharCode(0x2028)).join('\\u2028')
    .split(String.fromCharCode(0x2029)).join('\\u2029');
}

function formatGeneratedAt(date) {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(date);
}

// ---------- Giao dien ----------

const REPORT_CSS = `
:root{--bg:#f3f5f8;--surface:#fff;--surface-2:#f8fafc;--ink:#0f1c2e;--ink-2:#334155;--muted:#64748b;--line:#e2e8f0;--line-2:#cbd5e1;
--accent:#1e3a8a;--accent-2:#2563eb;--accent-soft:#e8eefc;--pos:#047857;--neg:#b91c1c;--shadow:0 1px 2px rgba(15,28,46,.05),0 4px 16px rgba(15,28,46,.05);
--chart-1:#1e40af;--chart-2:#0f766e;--chart-3:#b45309;--chart-4:#7c3aed;--chart-5:#be123c;--chart-6:#0369a1;--chart-7:#4d7c0f;--chart-8:#64748b;--grid:#e9eef5}
@media (prefers-color-scheme:dark){:root{--bg:#0b1220;--surface:#111a2b;--surface-2:#0f1727;--ink:#e6edf7;--ink-2:#c3cedd;--muted:#8c9bb1;--line:#1f2b40;--line-2:#2c3a52;
--accent:#93b4ff;--accent-2:#6d9bff;--accent-soft:#17264a;--shadow:0 1px 2px rgba(0,0,0,.3);--chart-1:#6d9bff;--chart-2:#2dd4bf;--chart-3:#fbbf24;--chart-4:#a78bfa;--chart-5:#fb7185;--chart-6:#38bdf8;--chart-7:#a3e635;--chart-8:#94a3b8;--grid:#1c2740}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 "Segoe UI",system-ui,-apple-system,Roboto,"Helvetica Neue",Arial,sans-serif;font-variant-numeric:tabular-nums}
.page{max-width:1480px;margin:0 auto;padding:28px 28px 40px}
.masthead{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px;padding-bottom:20px;border-bottom:1px solid var(--line);margin-bottom:22px}
.eyebrow{margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}
h1{margin:0;font-size:26px;line-height:1.2;font-weight:650;letter-spacing:-.01em}
.meta{display:flex;flex-wrap:wrap;gap:8px;margin:0;padding:0;list-style:none}
.meta li{display:flex;gap:6px;align-items:center;padding:5px 10px;border:1px solid var(--line);border-radius:999px;background:var(--surface);font-size:12.5px;color:var(--ink-2)}
.meta b{font-weight:600;color:var(--ink)}
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:16px}
.kpi{margin:0;padding:16px 18px;background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);min-width:0}
.kpi--lead{border-top:3px solid var(--accent)}
.kpi p{margin:0}
.kpi-label{font-size:12.5px;color:var(--muted);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kpi-value{margin-top:6px!important;font-size:28px;font-weight:650;letter-spacing:-.02em;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kpi-hint{margin-top:4px!important;font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.toolbar{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:12px;margin:0 -12px 18px;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:saturate(1.2) blur(6px)}
.tabs{display:flex;gap:4px;padding:3px;border:1px solid var(--line);border-radius:10px;background:var(--surface)}
.tabs button{border:0;background:none;color:var(--ink-2);font:inherit;font-size:13px;font-weight:500;padding:6px 12px;border-radius:7px;cursor:pointer}
.tabs button[aria-selected="true"]{background:var(--accent);color:#fff}
@media (prefers-color-scheme:dark){.tabs button[aria-selected="true"]{color:#0b1220}}
.search{position:relative;flex:1 1 320px;min-width:220px}
.search svg{position:absolute;left:12px;top:50%;transform:translateY(-50%);width:16px;height:16px;color:var(--muted);pointer-events:none}
input[type=search],select{width:100%;height:38px;border:1px solid var(--line-2);border-radius:9px;background:var(--surface);color:var(--ink);font:inherit;font-size:13.5px;padding:0 12px}
input[type=search]{padding-left:36px}
input[type=search]:focus,select:focus,button:focus-visible{outline:2px solid var(--accent-2);outline-offset:1px}
.filter{flex:0 1 240px;min-width:180px}
.btn{height:38px;padding:0 14px;border:1px solid var(--line-2);border-radius:9px;background:var(--surface);color:var(--ink-2);font:inherit;font-size:13px;font-weight:500;cursor:pointer}
.btn:hover:not(:disabled){border-color:var(--accent-2);color:var(--accent)}
.btn:disabled{opacity:.45;cursor:default}
.count{margin-left:auto;font-size:12.5px;color:var(--muted);white-space:nowrap}
.count b{color:var(--ink);font-weight:600}
.content{display:grid;grid-template-columns:minmax(300px,5fr) minmax(0,8fr);gap:16px;align-items:start}
.charts{display:grid;gap:16px;min-width:0}
.charts>.card{overflow:hidden}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);min-width:0}
.card-head{padding:14px 18px 0}
.card-head h2{margin:0;font-size:14.5px;font-weight:600}
.card-head p{margin:2px 0 0;font-size:12px;color:var(--muted)}
.chart-box{position:relative;height:260px;padding:10px 14px 14px;min-width:0}
.chart-box canvas{display:block;max-width:100%}
.chart-empty{padding:28px 18px;color:var(--muted);font-size:13px;text-align:center}
.table-card{display:flex;flex-direction:column;overflow:hidden}
.table-card .card-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding-bottom:12px;border-bottom:1px solid var(--line)}
.table-wrap{overflow:auto;max-height:calc(100vh - 150px);min-height:240px}
table{width:100%;border-collapse:separate;border-spacing:0;font-size:13px}
thead th{position:sticky;top:0;z-index:1;background:var(--surface-2);color:var(--ink-2);font-weight:600;text-align:left;padding:0;border-bottom:1px solid var(--line-2);white-space:nowrap}
thead th button{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:6px;width:100%;padding:10px 12px;cursor:pointer}
thead th.num button{justify-content:flex-end}
thead th button:focus-visible{outline:2px solid var(--accent-2);outline-offset:-2px}
.sort{font-size:10px;color:var(--muted);opacity:.5}
th[aria-sort] .sort{opacity:1;color:var(--accent)}
tbody td{padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top;max-width:360px;white-space:pre-line;overflow-wrap:anywhere}
tbody tr:nth-child(even) td{background:color-mix(in srgb,var(--surface-2) 70%,transparent)}
tbody tr:hover td{background:var(--accent-soft)}
td.num{text-align:right;white-space:nowrap}
td.date{white-space:nowrap}
td.neg{color:var(--neg)}
td.empty{color:var(--muted)}
.no-rows{padding:40px 18px;text-align:center;color:var(--muted)}
.pager{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;border-top:1px solid var(--line);font-size:12.5px;color:var(--muted)}
.pager div{display:flex;gap:6px;align-items:center}
.pager .btn{height:32px;padding:0 10px}
mark{background:#fde68a;color:inherit;border-radius:2px;padding:0 1px}
@media (prefers-color-scheme:dark){mark{background:#854d0e}}
.foot{margin-top:24px;font-size:12px;color:var(--muted);text-align:center}
@media (max-width:1100px){.content{grid-template-columns:1fr}.charts{grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:640px){.toolbar{position:static}.charts{grid-template-columns:1fr}.page{padding:18px 16px 28px}h1{font-size:21px}.kpi-value{font-size:23px}.count{margin-left:0;width:100%}.filter{flex:1 1 100%}}
@media print{.toolbar,.pager{display:none}.page{max-width:none;padding:0}.table-wrap{max-height:none;overflow:visible}.card,.kpi{box-shadow:none;break-inside:avoid}body{background:#fff}}
`;

// Script phia trinh duyet: chi dung du lieu nhung, khong fetch/XHR (CSP cung chan).
const REPORT_SCRIPT = `
(function () {
  'use strict';
  var kit = (${createReportKit.toString()})();
  var DATA = JSON.parse(document.getElementById('report-data').textContent);
  var PAGE_SIZE = 50;
  var charts = [];
  var state = { sheet: 0, query: '', category: '', sort: null, page: 0 };
  var $ = function (id) { return document.getElementById(id); };

  function fold(text) {
    return String(text).normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
  }

  // Chuoi tim kiem moi dong tinh 1 lan (gom ca gia tri da dinh dang de go "1.500.000" van khop).
  var prepared = DATA.worksheets.map(function (sheet) {
    var plan = kit.planFor(sheet.columns, sheet.rows);
    return {
      plan: plan,
      haystack: sheet.rows.map(function (row) {
        return fold(row.map(function (value, index) {
          return value === null ? '' : value + ' ' + kit.formatCell(value, sheet.columns[index]);
        }).join(' | '));
      })
    };
  });

  function sheet() { return DATA.worksheets[state.sheet]; }

  function filteredRows() {
    var ws = sheet();
    var prep = prepared[state.sheet];
    var terms = fold(state.query).split(/\\s+/).filter(Boolean);
    var catIndex = prep.plan.category;
    var rows = [];
    for (var i = 0; i < ws.rows.length; i += 1) {
      var row = ws.rows[i];
      if (state.category && catIndex >= 0 && String(row[catIndex] === null ? '(Trống)' : row[catIndex]) !== state.category) continue;
      var hay = prep.haystack[i];
      var ok = true;
      for (var t = 0; t < terms.length; t += 1) if (hay.indexOf(terms[t]) < 0) { ok = false; break; }
      if (ok) rows.push(row);
    }
    if (state.sort) {
      var col = ws.columns[state.sort.index];
      var dir = state.sort.dir === 'asc' ? 1 : -1;
      rows = rows.map(function (row, i) { return { row: row, i: i, v: kit.sortValue(row[state.sort.index], col) }; })
        .sort(function (a, b) {
          if (a.v === null || b.v === null) return a.v === b.v ? a.i - b.i : (a.v === null ? 1 : -1);
          var c = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : String(a.v).localeCompare(String(b.v), 'vi', { numeric: true, sensitivity: 'base' });
          return c === 0 ? a.i - b.i : c * dir;
        }).map(function (entry) { return entry.row; });
    }
    return rows;
  }

  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  // To sang khong phan biet dau: moi chu cai cua tu khoa (da bo dau) khop moi bien the co dau.
  var ACCENTS = { a: 'aàáạảãâầấậẩẫăằắặẳẵ', e: 'eèéẹẻẽêềếệểễ', i: 'iìíịỉĩ', o: 'oòóọỏõôồốộổỗơờớợởỡ', u: 'uùúụủũưừứựửữ', y: 'yỳýỵỷỹ', d: 'dđ' };
  function termPattern(term) {
    return fold(term).split('').map(function (ch) {
      if (ACCENTS[ch]) return '[' + ACCENTS[ch] + ']';
      return ch.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
    }).join('');
  }

  function highlight(text) {
    var terms = state.query.trim().split(/\\s+/).filter(function (term) { return term.length > 1; });
    if (!terms.length) return kit.escapeHtml(text);
    var regex;
    try { regex = new RegExp(terms.map(termPattern).join('|'), 'gi'); } catch (e) { return kit.escapeHtml(text); }
    // Tim tren chuoi GOC roi moi escape tung doan -> khong bao gio chen <mark> vao giua thuc the HTML.
    var source = String(text);
    var out = '';
    var last = 0;
    source.replace(regex, function (match, offset) {
      out += kit.escapeHtml(source.slice(last, offset)) + '<mark>' + kit.escapeHtml(match) + '</mark>';
      last = offset + match.length;
      return match;
    });
    return out + kit.escapeHtml(source.slice(last));
  }

  function renderHead() {
    var ws = sheet();
    $('thead').innerHTML = '<tr>' + ws.columns.map(function (column, index) {
      var numeric = column.type === 'number' || column.type === 'percent';
      var sorted = state.sort && state.sort.index === index;
      var aria = sorted ? ' aria-sort="' + (state.sort.dir === 'asc' ? 'ascending' : 'descending') + '"' : '';
      var icon = sorted ? (state.sort.dir === 'asc' ? '▲' : '▼') : '↕';
      return '<th scope="col"' + aria + (numeric ? ' class="num"' : '') + '><button type="button" data-col="' + index + '">' +
        kit.escapeHtml(column.label) + '<span class="sort" aria-hidden="true">' + icon + '</span></button></th>';
    }).join('') + '</tr>';
  }

  function renderBody(rows) {
    var ws = sheet();
    var pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (state.page >= pages) state.page = pages - 1;
    var start = state.page * PAGE_SIZE;
    var slice = rows.slice(start, start + PAGE_SIZE);
    if (!slice.length) {
      $('tbody').innerHTML = '<tr><td class="no-rows" colspan="' + ws.columns.length + '">Không có dòng nào khớp bộ lọc.</td></tr>';
    } else {
      $('tbody').innerHTML = slice.map(function (row) {
        return '<tr>' + row.map(function (value, index) {
          var column = ws.columns[index];
          var numeric = column.type === 'number' || column.type === 'percent';
          var cls = [];
          if (numeric) cls.push('num');
          if (column.type === 'date') cls.push('date');
          if (numeric && typeof value === 'number' && value < 0) cls.push('neg');
          if (value === null) cls.push('empty');
          var text = value === null ? '—' : kit.formatCell(value, column);
          return '<td' + (cls.length ? ' class="' + cls.join(' ') + '"' : '') + '>' + (value === null ? text : highlight(text)) + '</td>';
        }).join('') + '</tr>';
      }).join('');
    }
    var fmt = new Intl.NumberFormat('vi-VN');
    $('pageInfo').textContent = rows.length ? 'Dòng ' + fmt.format(start + 1) + '–' + fmt.format(start + slice.length) + ' / ' + fmt.format(rows.length) : '0 dòng';
    $('pageLabel').textContent = 'Trang ' + (state.page + 1) + ' / ' + pages;
    $('prevPage').disabled = state.page === 0;
    $('nextPage').disabled = state.page >= pages - 1;
    $('count').innerHTML = 'Hiển thị <b>' + fmt.format(rows.length) + '</b> / ' + fmt.format(ws.rows.length) + ' dòng';
  }

  function palette() {
    return ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6', '--chart-7', '--chart-8'].map(cssVar);
  }

  function renderCharts(summary) {
    charts.forEach(function (chart) { chart.destroy(); });
    charts = [];
    var host = $('charts');
    if (!summary.charts.length) {
      host.innerHTML = '<section class="card"><div class="chart-empty">Bảng này không có cột số phù hợp để vẽ biểu đồ.</div></section>';
      return;
    }
    host.innerHTML = summary.charts.map(function (spec, index) {
      return '<section class="card"><header class="card-head"><h2>' + kit.escapeHtml(spec.title) + '</h2><p>' + kit.escapeHtml(spec.subtitle) +
        '</p></header><div class="chart-box"><canvas id="chart' + index + '" role="img" aria-label="' + kit.escapeHtml(spec.title) + '"></canvas></div></section>';
    }).join('');
    if (typeof Chart === 'undefined') return;
    var colors = palette();
    var ink = cssVar('--muted');
    var grid = cssVar('--grid');
    var fmt = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.color = ink;
    summary.charts.forEach(function (spec, index) {
      var horizontal = spec.type === 'bar';
      var dataset = {
        label: spec.valueLabel,
        data: spec.values,
        backgroundColor: spec.type === 'doughnut' ? spec.values.map(function (v, i) { return colors[i % colors.length]; }) : colors[0],
        borderColor: spec.type === 'doughnut' ? cssVar('--surface') : colors[0],
        borderWidth: spec.type === 'line' ? 2 : (spec.type === 'doughnut' ? 2 : 0),
        borderRadius: spec.type === 'bar' ? 4 : 0,
        maxBarThickness: 18,
        tension: 0.3,
        fill: spec.type === 'line' ? { target: 'origin', above: colors[0] + '22' } : false,
        pointRadius: spec.values.length > 40 ? 0 : 2.5
      };
      var tooltip = { callbacks: { label: function (ctx) {
        var value = ctx.parsed && typeof ctx.parsed === 'object' ? (horizontal ? ctx.parsed.x : ctx.parsed.y) : ctx.parsed;
        var label = spec.type === 'doughnut' ? ctx.label : spec.valueLabel;
        if (spec.type === 'doughnut') {
          var total = spec.values.reduce(function (s, v) { return s + v; }, 0);
          return ' ' + label + ': ' + fmt.format(value) + ' (' + fmt.format(total ? value / total * 100 : 0) + '%)';
        }
        return ' ' + label + ': ' + fmt.format(value);
      } } };
      var axisNum = { grid: { color: grid }, border: { display: false }, ticks: { callback: function (v) { return kit.formatShort(v); } } };
      var axisCat = { grid: { display: false }, border: { color: grid }, ticks: { autoSkip: true, maxRotation: 0 } };
      charts.push(new Chart($('chart' + index), {
        type: spec.type,
        data: { labels: spec.labels, datasets: [dataset] },
        options: {
          responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
          indexAxis: horizontal ? 'y' : 'x',
          cutout: spec.type === 'doughnut' ? '62%' : undefined,
          plugins: {
            legend: { display: spec.type === 'doughnut', position: 'right', labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true } },
            tooltip: tooltip
          },
          scales: spec.type === 'doughnut' ? {} : (horizontal ? { x: axisNum, y: axisCat } : { x: axisCat, y: axisNum })
        }
      }));
    });
  }

  function renderSummary(rows) {
    var summary = kit.buildSummary(sheet().columns, rows, prepared[state.sheet].plan);
    $('kpis').innerHTML = kit.kpiCardsHtml(summary.kpis);
    renderCharts(summary);
  }

  function renderFilter() {
    var ws = sheet();
    var catIndex = prepared[state.sheet].plan.category;
    var select = $('category');
    if (catIndex < 0) { select.hidden = true; select.innerHTML = ''; return; }
    var values = {};
    ws.rows.forEach(function (row) { values[row[catIndex] === null ? '(Trống)' : String(row[catIndex])] = true; });
    var label = ws.columns[catIndex].label;
    select.hidden = false;
    select.setAttribute('aria-label', 'Lọc theo ' + label);
    select.innerHTML = '<option value="">' + kit.escapeHtml(label) + ': Tất cả</option>' + Object.keys(values).sort(function (a, b) {
      return a.localeCompare(b, 'vi');
    }).map(function (value) {
      return '<option value="' + kit.escapeHtml(value) + '"' + (value === state.category ? ' selected' : '') + '>' + kit.escapeHtml(value) + '</option>';
    }).join('');
  }

  var summaryTimer = null;
  function refresh(withSummary) {
    var rows = filteredRows();
    renderHead();
    renderBody(rows);
    $('reset').disabled = !state.query && !state.category && !state.sort;
    if (!withSummary) return;
    clearTimeout(summaryTimer);
    summaryTimer = setTimeout(function () { renderSummary(rows); }, 120);
  }

  function selectSheet(index) {
    state = { sheet: index, query: $('q').value, category: '', sort: null, page: 0 };
    document.querySelectorAll('#tabs button').forEach(function (button, i) { button.setAttribute('aria-selected', i === index ? 'true' : 'false'); });
    $('tableTitle').textContent = sheet().name;
    renderFilter();
    refresh(true);
  }

  $('q').addEventListener('input', function (event) { state.query = event.target.value; state.page = 0; refresh(true); });
  $('category').addEventListener('change', function (event) { state.category = event.target.value; state.page = 0; refresh(true); });
  $('reset').addEventListener('click', function () {
    $('q').value = ''; state.query = ''; state.category = ''; state.sort = null; state.page = 0;
    renderFilter(); refresh(true);
  });
  $('thead').addEventListener('click', function (event) {
    var button = event.target.closest('button[data-col]');
    if (!button) return;
    var index = Number(button.getAttribute('data-col'));
    if (!state.sort || state.sort.index !== index) state.sort = { index: index, dir: 'desc' };
    else if (state.sort.dir === 'desc') state.sort.dir = 'asc';
    else state.sort = null;
    state.page = 0;
    refresh(false);
  });
  $('prevPage').addEventListener('click', function () { state.page -= 1; refresh(false); $('tableWrap').scrollTop = 0; });
  $('nextPage').addEventListener('click', function () { state.page += 1; refresh(false); $('tableWrap').scrollTop = 0; });
  var tabs = $('tabs');
  if (tabs) tabs.addEventListener('click', function (event) {
    var button = event.target.closest('button[data-sheet]');
    if (button) selectSheet(Number(button.getAttribute('data-sheet')));
  });

  // KPI da render san tu server; chi ve bieu do + bang.
  renderFilter();
  refresh(false);
  renderCharts(kit.buildSummary(sheet().columns, sheet().rows, prepared[0].plan));
})();
`;

const SEARCH_ICON = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="9" cy="9" r="6"/><path d="m14 14 4 4" stroke-linecap="round"/></svg>';

/**
 * Render dataset { meta, worksheets } thanh file HTML tu chua.
 * @returns {{ buffer: Buffer, mimeType: string, fileName: string }}
 */
function renderHtmlReport(dataset) {
  const escape = kit.escapeHtml;
  const meta = dataset.meta;
  const worksheets = dataset.worksheets.map(embedWorksheet);
  const first = worksheets[0];
  const summary = kit.buildSummary(first.columns, first.rows);
  const totalRows = worksheets.reduce((sum, worksheet) => sum + worksheet.rows.length, 0);
  const generatedAt = formatGeneratedAt(meta.generatedAt || new Date());
  const tabs = worksheets.length > 1
    ? `<div class="tabs" id="tabs" role="tablist" aria-label="Nguồn dữ liệu">${worksheets.map((worksheet, index) =>
      `<button type="button" role="tab" data-sheet="${index}" aria-selected="${index === 0}">${escape(worksheet.name)}</button>`).join('')}</div>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:">
<meta name="generator" content="TOKOSI Dashboard">
<title>${escape(meta.title)} · TOKOSI</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<div class="page">
  <header class="masthead">
    <div>
      <p class="eyebrow">TOKOSI · Báo cáo</p>
      <h1>${escape(meta.title)}</h1>
    </div>
    <ul class="meta">
      <li>Cơ sở <b>${escape(meta.branch || 'Tất cả')}</b></li>
      <li>Xuất lúc <b>${escape(generatedAt)}</b></li>
      <li><b>${escape(totalRows.toLocaleString('vi-VN'))}</b> dòng</li>
    </ul>
  </header>

  <section class="kpis" id="kpis" aria-label="Số liệu tổng quan">${kit.kpiCardsHtml(summary.kpis)}</section>

  <div class="toolbar" role="search">
    ${tabs}
    <label class="search">${SEARCH_ICON}<input id="q" type="search" placeholder="Tìm trong báo cáo… (không dấu cũng được)" aria-label="Tìm trong báo cáo" autocomplete="off"></label>
    <select class="filter" id="category" hidden></select>
    <button class="btn" id="reset" type="button" disabled>Đặt lại</button>
    <span class="count" id="count" aria-live="polite"></span>
  </div>

  <main class="content">
    <aside class="charts" id="charts" aria-label="Biểu đồ"></aside>
    <section class="card table-card" aria-labelledby="tableTitle">
      <header class="card-head"><h2 id="tableTitle">${escape(first.name)}</h2><p>Bấm tiêu đề cột để sắp xếp</p></header>
      <div class="table-wrap" id="tableWrap"><table><thead id="thead"></thead><tbody id="tbody"></tbody></table></div>
      <footer class="pager"><span id="pageInfo"></span><div><button class="btn" id="prevPage" type="button">‹ Trước</button><span id="pageLabel"></span><button class="btn" id="nextPage" type="button">Sau ›</button></div></footer>
    </section>
  </main>

  <p class="foot">Báo cáo tĩnh — số liệu chụp tại thời điểm xuất, không tự cập nhật. Dùng file Excel khi cần xử lý số liệu chi tiết.</p>
</div>
<script type="application/json" id="report-data">${safeJson({ worksheets })}</script>
<script>${getChartJsSource()}</script>
<script>${REPORT_SCRIPT}</script>
</body>
</html>
`;
  return {
    buffer: Buffer.from(html, 'utf8'),
    mimeType: 'text/html; charset=utf-8',
    fileName: `${meta.fileBase}.html`
  };
}

module.exports = {
  renderHtmlReport,
  __test__: { createReportKit, safeJson, embedWorksheet }
};
