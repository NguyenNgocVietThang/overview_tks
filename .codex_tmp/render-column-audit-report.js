const fs = require('fs');
const path = require('path');

const dir = __dirname;
const audit = JSON.parse(fs.readFileSync(path.join(dir, 'column-audit.json'), 'utf8'));

function dependency(item) {
  if (item.sheet === 'Hàng hóa' && ['Thương hiệu', 'Đơn vị tính'].includes(item.header)) {
    return 'CustomerReport/CustomerDebtReport; đã bỏ metadata/cột đầu ra phụ thuộc';
  }
  if (item.sheet === 'Hàng hóa') {
    return 'dashboardData đọc Hàng hóa; đã chuyển từ index cố định sang tên header';
  }
  if (item.sheet === 'Khách hàng' || item.sheet === 'Nhà cung cấp' || item.sheet === 'Trả hàng') {
    return 'dashboardData đọc sheet này; đã chuyển các trường sử dụng sang tên header';
  }
  if (item.sheet === 'Hàng ngừng kinh doanh' && item.header === 'Thời gian phát hiện') {
    return 'dashboardData từng dùng làm fallback; đã dùng Ngày sửa trên KiotViet';
  }
  if (/^HN[137]$/.test(item.sheet)) {
    return 'CustomerDebtReport sinh cột; dashboard không đọc; schema báo cáo đã bỏ';
  }
  return 'Chỉ có schema/bộ dựng dòng sync; đã gỡ đồng bộ';
}

const lines = [
  '# Báo cáo kiểm kê trước khi xóa cột',
  '',
  `- Spreadsheet: ${audit.title}`,
  `- Công thức ô đã quét: ${audit.formulaCount} (không có tham chiếu công thức)`,
  `- Cột mục tiêu tìm thấy: ${audit.audit.filter(item => item.status === 'found').length}`,
  `- Cột mục tiêu thiếu: ${audit.audit.filter(item => item.status === 'missing').length}`,
  '',
  '| Sheet | Cột cũ | Tiêu đề | Dòng có dữ liệu | Tham chiếu / xử lý | Trạng thái |',
  '|---|---:|---|---:|---|---|'
];

for (const item of audit.audit) {
  if (item.status !== 'found') continue;
  lines.push(
    `| ${item.sheet} | ${item.columnLetter} | ${item.header} | ${item.nonEmptyRows} | ${dependency(item)} | An toàn sau bản vá local |`
  );
}

fs.writeFileSync(path.join(dir, 'column-removal-report.md'), lines.join('\n') + '\n');
