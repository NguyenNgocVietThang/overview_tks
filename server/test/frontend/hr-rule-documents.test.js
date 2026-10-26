'use strict';

// Tab "Quy dinh cong ty" cua trang Quan ly nhan su: danh sach tai lieu (dung san + PDF)
// tu /api/hr/rules/documents, xem PDF bang blob, Quan ly tai len / go / khoi phuc.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { defaultsForRole } = require('../../auth/featureRegistry');

const htmlPath = path.join(__dirname, '..', '..', 'public', 'humanresources', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

test('giu noi dung builtin lam fallback khi code deploy truoc migration 0065', () => {
  assert.match(html, /data-rule-doc="gio-giac"/);
  assert.match(html, /data-rule-doc="nghi-phep"/);
  assert.match(html, /data-rule-doc="phuc-loi"/);
  assert.match(html, /data-rule-doc="treo-hang"/);
  assert.match(html, /Giờ làm việc chính thức/);
});

test('bang quy dinh luon co vien day du o che do xem va sua', () => {
  assert.match(html, /\.doc-page \.doc-section table > :is\(thead,tbody,tfoot\) > tr > :is\(th,td\)\{ border:1px solid #d8d5cb !important; \}/);
  assert.match(html, /\.rte-editor table > :is\(thead,tbody,tfoot\) > tr > :is\(th,td\)\{ border:1px solid #d8d5cb !important; \}/);
});

test('bang trong quy dinh khong to mau khi hover hang hoac o', () => {
  assert.match(html, /\.doc-page \.doc-section table > tbody > tr:hover > :is\(th,td\),[\s\S]*?background-color:transparent !important;/);
  assert.match(html, /\.doc-page \.doc-section table > tbody > tr > :is\(th,td\):hover[\s\S]*?outline:none !important;/);
  assert.match(html, /\.rte-editor table > tbody > tr:hover\{ background:transparent !important; \}/);
  assert.match(html, /\.rte-editor table > tbody > tr:hover > :is\(th,td\),[\s\S]*?background-color:transparent !important;/);
  assert.match(html, /\.rte-editor table > tbody > tr > :is\(th,td\):hover[\s\S]*?outline:none !important;/);
});

test('bang trong noi dung quy dinh khong bi gan nut Cot hien thi hoac sap xep', async () => {
  const { window, document } = await openPage();
  const tables = [...document.querySelectorAll('#ruleDocTextBody table')];
  assert.ok(tables.length > 0, 'tai lieu mau phai co bang');
  for (const table of tables) {
    assert.equal(table.dataset.tableControls, 'off');
    assert.equal(table.dataset.tableSort, 'off');
  }
  window.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'shared', 'table-controls.js'), 'utf8'));
  await settle();
  assert.equal(document.querySelectorAll('#ruleDocTextView .tks-columns-button').length, 0);
  assert.doesNotMatch(document.getElementById('ruleDocTextView').textContent, /Cột hiển thị/);
  const editor = document.getElementById('ruleTextEditor');
  editor.innerHTML = '<table><thead><tr><th>Cột A</th></tr></thead><tbody><tr><td>Nội dung</td></tr></tbody></table>';
  await settle();
  assert.ok(document.querySelectorAll('#ruleTextEditor table').length > 0);
  assert.equal(document.querySelectorAll('#ruleTextEditor .tks-columns-button').length, 0);
  assert.doesNotMatch(document.getElementById('ruleTextEditor').textContent, /Cột hiển thị/);
  window.close();
});

function fakeCan(vaiTro) {
  const permissions = defaultsForRole(vaiTro);
  return (...keys) => keys.some(key => (Array.isArray(key) ? key : [key]).some(k => permissions.includes(k)));
}

const BUILTINS = [
  { id: 1, kind: 'builtin', slug: 'gio-giac', builtinKey: 'gio-giac', title: 'Giờ giấc làm việc' },
  { id: 2, kind: 'builtin', slug: 'nghi-phep', builtinKey: 'nghi-phep', title: 'Quy định nghỉ phép' },
  { id: 3, kind: 'builtin', slug: 'phuc-loi', builtinKey: 'phuc-loi', title: 'Chi tiêu & Phúc lợi' },
  { id: 4, kind: 'builtin', slug: 'treo-hang', builtinKey: 'treo-hang', title: 'Quy định treo hàng' }
];
// Tu migration 0065: 4 tai lieu dung san tren chuyen sang kind='text' (Quan ly tu sua qua
// web) — day la trang thai THAT trong production sau khi migration da chay. Noi dung cua
// 'Gio giac' va 'Nghi phep' la ban sao chinh xac tu HTML da sanitize that (kiem bang
// script rieng doi chieu so luong the truoc/sau loc, khong mat the nao). 'Phuc loi'/'Treo
// hang' dung noi dung rut gon vi khong co test nao kiem sau noi dung 2 tai lieu nay.
const CONVERTED_DOCS = [
  { id: 1, kind: 'text', slug: 'text-1', title: 'Giờ giấc làm việc', iconKey: 'clock', body: "<p>Để đảm bảo kỷ luật và công bằng trong công việc, công ty yêu cầu toàn thể nhân viên tuân thủ nghiêm túc các quy định sau.</p>\n\n                <div>\n                  <h4>Giờ làm việc chính thức</h4>\n                  <table>\n                    <thead><tr><th>Khối</th><th>Buổi sáng</th><th>Buổi chiều</th></tr></thead>\n                    <tbody>\n                      <tr><td>Kho vận</td><td>Ca 1: 08h00 – 11h30<br />Ca 2: 08h00 – 12h30</td><td>Ca 1: 12h30 – 17h00<br />Ca 2: 13h30 – 17h00</td></tr>\n                      <tr><td>Văn phòng HN</td><td>07h45 – 11h30</td><td>12h30 – 16h45</td></tr>\n                      <tr><td>Văn phòng SG</td><td>08h00 – 12h00</td><td>13h00 – 17h00</td></tr>\n                    </tbody>\n                  </table>\n                  <p>☞ Nhân viên phải có mặt đúng giờ, không được tự ý nghỉ sớm.</p>\n                </div>\n\n                <div>\n                  <h4>Quy định đi muộn, về sớm, quên chấm công</h4>\n                  <ul>\n                    <li>Mỗi tháng, nhân viên được phép đi muộn, về sớm hoặc quên chấm công tối đa <strong>03 lần</strong>.\n                      <ul>\n                        <li>Từ lần 1 – lần 3: Không bị phạt.</li>\n                        <li>Từ lần 4 – lần 8 sẽ bị phạt <strong>50.000đ/lần</strong>.</li>\n                        <li>Từ lần 9 trở đi sẽ bị phạt <strong>100.000đ/lần</strong>.</li>\n                      </ul>\n                    </li>\n                    <li>Quên chấm vào hoặc chấm ra: chỉ được kiểm tra camera trong khoảng <strong>±5 phút</strong> so với giờ vào/ra để xác nhận (sáng: 7h45 – 7h50; chiều: 16h45 – 16h50). Không thấy sẽ mặc định nghỉ buổi sáng hoặc chiều tương ứng.</li>\n                    <li>Quên chấm cả 2 lần (vào và ra): không được tính công ngày đó.</li>\n                  </ul>\n                </div>\n\n                <div>\n                  <h4>Cách tính ngày công khi đi muộn/về sớm</h4>\n                  <ul>\n                    <li>Đi muộn hoặc về sớm sẽ bị tính vào <strong>03 lần</strong> được trừ trong tháng.</li>\n                    <li>Đi muộn hoặc về sớm <strong>≤ 30 phút</strong>: không bị trừ công.</li>\n                    <li>Đi muộn hoặc về sớm <strong>&gt; 30 phút</strong>: tính đi muộn và ngày công được tính theo công thức <strong>Ngày công = Số giờ làm việc thực tế trong ngày ÷ 8</strong>.</li>\n                    <li>Ví dụ: nhân viên đi muộn 45 phút → thời gian làm việc còn lại 7h15 → số công = 7h15 ÷ 8 ≈ 0.90625 công và bị tính 1 lỗi đi muộn.</li>\n                  </ul>\n                  <p>Lưu ý: Việc đi muộn, về sớm nhiều lần sẽ ảnh hưởng trực tiếp đến lương, thưởng và xét tăng lương. Ban quản trị sẽ giám sát và xử lý nghiêm minh, không có ngoại lệ.</p>\n                </div>", uploadedBy: 'Hệ thống (chuyển từ tài liệu dựng sẵn)', createdAt: '2026-10-17T03:00:00.000Z' },
  { id: 2, kind: 'text', slug: 'text-2', title: 'Quy định nghỉ phép', iconKey: 'calendar', body: "<p>Nhân viên cần xin phép và được quản lý đồng ý trước khi nghỉ. Thời hạn gửi yêu cầu phụ thuộc vào số ngày nghỉ.</p>\n\n                <div>\n                  <h4>Cách xin nghỉ phép</h4>\n                  <ul>\n                    <li>Nhắn tin xin nghỉ cho bot Telegram: <strong>@nghipheptks_bot</strong> hoặc tạo đơn trên web.</li>\n                    <li>Chỉ được tính là đã xin phép khi yêu cầu được gửi qua bot đúng thời hạn quy định bên dưới.</li>\n                    <li>Đơn xin nghỉ phải ghi đủ: ngày nghỉ, lý do nghỉ và <strong>bàn giao công việc</strong> (người nhận bàn giao, nội dung bàn giao).</li>\n                  </ul>\n                </div>\n\n                <div>\n                  <h4>Thời hạn đăng ký nghỉ phép</h4>\n                  <ul>\n                    <li><strong>Tổng buổi nghỉ thực tế ≤ 2:</strong> hạn đăng ký là <strong>hết 23:59:59 của 02 ngày trước ngày nghỉ đầu tiên</strong>.\n                      <ul>\n                        <li>Ví dụ: nghỉ từ thứ Ba → hạn là hết 23:59:59 Chủ nhật. Hai buổi trên hai ngày khác nhau vẫn áp dụng hạn 02 ngày.</li>\n                      </ul>\n                    </li>\n                    <li><strong>Tổng buổi nghỉ thực tế &gt; 2:</strong> hạn đăng ký là <strong>hết 23:59:59 của 03 ngày trước ngày nghỉ đầu tiên</strong>.\n                      <ul>\n                        <li>Ví dụ: nghỉ đủ bốn buổi thứ Năm và thứ Sáu → hạn là hết 23:59:59 thứ Hai.</li>\n                      </ul>\n                    </li>\n                    <li>Tính theo ngày lịch và giờ Việt Nam, gồm cuối tuần và ngày lễ. Toàn bộ phút 23:59 nằm trong hạn; từ 00:00 ngày kế tiếp là quá hạn.</li>\n                    <li>Gửi trước hạn: <strong>Đúng hạn</strong>. Gửi sau hạn nhưng trước giờ bắt đầu buổi nghỉ đầu tiên theo lịch nhân sự: <strong>Xin muộn</strong>. Gửi từ đúng giờ bắt đầu buổi đầu tiên trở đi: <strong>Vi phạm</strong>. Nếu chưa có lịch làm việc, cần nhờ quản lý cấu hình trước khi gửi.</li>\n                    <li>Nhãn thời hạn được lưu khi gửi và tách khỏi trạng thái duyệt. Quản lý có thể duyệt mọi nhãn; chờ duyệt không tự đổi nhãn. Sửa lịch và gửi lại sẽ tính lại nhãn theo thời gian gửi mới, cần duyệt lại và giữ lịch sử cũ.</li>\n                  </ul>\n                </div>\n\n                <div>\n                  <h4>Bàn giao công việc</h4>\n                  <ul>\n                    <li>Đơn không có thông tin bàn giao chưa được tính là đã xin phép, quản lý có thể từ chối.</li>\n                    <li>Nghỉ gấp: bàn giao cho quản lý và người thay thế qua tin nhắn riêng ngay khi có thể.</li>\n                    <li>Người nhận bàn giao chịu trách nhiệm xử lý các việc được giao trong thời gian đồng nghiệp nghỉ.</li>\n                  </ul>\n                </div>\n\n                <div>\n                  <h4>Xử lý vi phạm</h4>\n                  <ul>\n                    <li>Gửi yêu cầu xin nghỉ trễ hạn: phạt <strong>50.000đ/lần</strong>.</li>\n                    <li>Tự ý nghỉ không xin phép, hoặc quản lý đã từ chối nhưng vẫn nghỉ: phạt <strong>500.000đ/lần</strong>.</li>\n                    <li>Tất cả các khoản phạt này sẽ trừ vào lương cuối tháng đó.</li>\n                  </ul>\n                  <p>Lưu ý: Ban quản lý sẽ giám sát và xử lý nghiêm minh, không có ngoại lệ.</p>\n                </div>", uploadedBy: 'Hệ thống (chuyển từ tài liệu dựng sẵn)', createdAt: '2026-10-17T03:00:00.000Z' },
  { id: 3, kind: 'text', slug: 'text-3', title: 'Chi tiêu & Phúc lợi', iconKey: 'gift', body: '<p>Đơn vị tính: đồng.</p>', uploadedBy: 'Hệ thống (chuyển từ tài liệu dựng sẵn)', createdAt: '2026-10-17T03:00:00.000Z' },
  { id: 4, kind: 'text', slug: 'text-4', title: 'Quy định treo hàng', iconKey: 'box', body: '<p>Quy định về đơn treo chờ hàng.</p>', uploadedBy: 'Hệ thống (chuyển từ tài liệu dựng sẵn)', createdAt: '2026-10-17T03:00:00.000Z' }
];
const PDF = { id: 7, kind: 'pdf', slug: 'pdf-7', title: 'Nội quy kho', fileName: 'noi-quy-kho.pdf', sizeBytes: 2048, uploadedBy: 'Quản lý A', createdAt: '2026-09-30T03:00:00.000Z' };
const TEXT = { id: 8, kind: 'text', slug: 'text-8', title: 'Hướng dẫn Bot', body: '<h2>Quy tắc</h2><p><strong>Không</strong> gửi mật khẩu.</p><table><tbody><tr><td>Lỗi</td><td>Cách xử lý</td></tr></tbody></table>', uploadedBy: 'Quản lý A', createdAt: '2026-10-17T03:00:00.000Z' };

function jsonResponse(payload, status = 200) {
  return {
    ok: status < 400, status, statusText: '',
    headers: { get: () => 'application/json' },
    json: async () => payload,
    text: async () => JSON.stringify(payload)
  };
}

/** Dung trang HR that trong JSDOM voi fetch gia; server gia giu danh sach tai lieu trong `server.docs`. */
async function openPage({ vaiTro = 'Quản lý', hash = '#quydinh', docs = [...CONVERTED_DOCS, PDF], listPayload } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: `https://tokosi.example/humanresources/${hash}` });
  const { window } = dom;
  const server = { docs: [...docs], missingDefaults: [], requests: [], confirmed: true };

  window.TKSNav = {
    authGuard: async () => ({ username: 'u', vaiTro }),
    can: fakeCan(vaiTro),
    renderTopSidebar() {}
  };
  window.confirm = () => server.confirmed;
  window.URL.createObjectURL = () => `blob:test/${server.requests.length}`;
  window.URL.revokeObjectURL = () => {};
  window.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    server.requests.push({ url: u, method, body: opts.body });
    if (u === '/api/hr/rules/documents' && method === 'GET') {
      return jsonResponse(listPayload || { documents: server.docs, missingDefaults: server.missingDefaults, degraded: false });
    }
    if (u === '/api/hr/rules/documents' && method === 'POST') {
      const created = { ...PDF, id: 9, slug: 'pdf-9', title: 'Bảng lương' };
      server.docs.push(created);
      return jsonResponse({ document: created }, 201);
    }
    if (u === '/api/hr/rules/documents/text' && method === 'POST') {
      const payload = JSON.parse(opts.body);
      const created = { ...TEXT, id: 10, slug: 'text-10', title: payload.title, body: payload.body, iconKey: payload.icon || null };
      server.docs.push(created);
      return jsonResponse({ document: created }, 201);
    }
    const updateText = /^\/api\/hr\/rules\/documents\/(\d+)\/text$/.exec(u);
    if (updateText && method === 'PUT') {
      const payload = JSON.parse(opts.body);
      const index = server.docs.findIndex(d => String(d.id) === updateText[1]);
      server.docs[index] = { ...server.docs[index], title: payload.title, body: payload.body, iconKey: payload.icon || null, updatedBy: 'Quản lý A' };
      return jsonResponse({ document: server.docs[index] });
    }
    const file = /^\/api\/hr\/rules\/documents\/(\d+)\/file$/.exec(u);
    if (file) {
      return { ok: true, status: 200, headers: { get: () => 'application/pdf' }, arrayBuffer: async () => new Uint8Array([37, 80, 68, 70]).buffer };
    }
    const del = /^\/api\/hr\/rules\/documents\/(\d+)$/.exec(u);
    if (del && method === 'DELETE') {
      server.docs = server.docs.filter(d => String(d.id) !== del[1]);
      return jsonResponse({ ok: true });
    }
    if (u === '/api/hr/rules/documents/restore-defaults' && method === 'POST') {
      server.docs = [...BUILTINS, ...server.docs.filter(d => d.kind === 'pdf')];
      server.missingDefaults = [];
      return jsonResponse({ restored: 1, documents: server.docs });
    }
    return jsonResponse({ requests: [] });
  };

  [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1]).filter(script => script.trim())
    .forEach(script => window.eval(script));
  window.dispatchEvent(new window.Event('DOMContentLoaded'));
  await settle();
  return { dom, window, document: window.document, server };
}

async function settle() {
  for (let i = 0; i < 6; i++) await new Promise(resolve => setTimeout(resolve, 0));
}

const tabSlugs = document => [...document.querySelectorAll('.rule-doc-tab')].map(t => t.dataset.ruleDocTab);
const activeTab = document => (document.querySelector('.rule-doc-tab.active') || {}).dataset;
const visibleViews = document => [...document.querySelectorAll('.rule-doc-view')].filter(v => !v.hidden).map(v => v.dataset.ruleDoc || v.id);

test('dựng tab từ API: 4 tài liệu rich text (chuyển từ dựng sẵn, migration 0065) + PDF, mặc định tài liệu đầu', async () => {
  const { window, document, server } = await openPage();

  assert.deepEqual(tabSlugs(document), ['text-1', 'text-2', 'text-3', 'text-4', 'pdf-7']);
  assert.equal(activeTab(document).ruleDocTab, 'text-1');
  assert.deepEqual(visibleViews(document), ['ruleDocTextView']);
  assert.equal(document.getElementById('ruleDocTitle').textContent, 'Giờ giấc làm việc');
  window.close();
});

test('nội dung "Quy định nghỉ phép" (kind=text, chuyển từ dựng sẵn): đủ thời hạn xin nghỉ, bàn giao công việc, mức phạt và bot Telegram — render bằng innerHTML đã lọc', async () => {
  const { window, document } = await openPage();
  document.querySelector('[data-rule-doc-tab="text-2"]').click();
  await settle();
  const leaveDoc = document.getElementById('ruleDocTextBody').textContent;
  assert.match(leaveDoc, /@nghipheptks_bot/);
  assert.match(leaveDoc, /Tổng buổi nghỉ thực tế ≤ 2/);
  assert.match(leaveDoc, /hết 23:59:59 của 02 ngày trước/);
  assert.match(leaveDoc, /Tổng buổi nghỉ thực tế > 2/);
  assert.match(leaveDoc, /hết 23:59:59 của 03 ngày trước/);
  assert.match(leaveDoc, /Bàn giao công việc/);
  assert.match(leaveDoc, /người nhận bàn giao/);
  assert.match(leaveDoc, /tạo đơn trên web/);
  assert.match(leaveDoc, /50\.000đ\/lần/);
  assert.match(leaveDoc, /500\.000đ\/lần/);
  assert.doesNotMatch(leaveDoc, /lienket|Tạm duyệt/);
  // Dam bao bo loc giu h4 (tieu de phu) va strong (nhan manh), khong bi go ve van ban tho.
  assert.match(document.getElementById('ruleDocTextBody').innerHTML, /<h4>Cách xin nghỉ phép<\/h4>/);
  assert.match(document.getElementById('ruleDocTextBody').innerHTML, /<strong>@nghipheptks_bot<\/strong>/);
  document.querySelector('[data-rule-doc-tab="text-1"]').click();
  await settle();
  const hoursDoc = document.getElementById('ruleDocTextBody').textContent;
  assert.match(hoursDoc, /Giờ làm việc chính thức/);
  assert.doesNotMatch(hoursDoc, /Quy tắc xin nghỉ phép/);
  window.close();
});

test('chọn tab PDF: tải blob về, iframe dùng blob URL, hash ghi #quydinh/pdf-7', async () => {
  const { window, document, server } = await openPage();
  document.querySelector('[data-rule-doc-tab="pdf-7"]').click();
  await settle();

  assert.ok(server.requests.some(r => r.url === '/api/hr/rules/documents/7/file'));
  const frame = document.getElementById('ruleDocFrame');
  assert.match(frame.getAttribute('src'), /^blob:/);
  assert.equal(frame.hidden, false);
  assert.deepEqual(visibleViews(document), ['ruleDocPdfView']);
  assert.match(document.getElementById('ruleDocMeta').textContent, /Tải lên bởi Quản lý A/);
  assert.equal(window.location.hash, '#quydinh/pdf-7');
  window.close();
});

test('mở thẳng #quydinh/pdf-7: đúng tài liệu; slug lạ rơi về tài liệu đầu (sau khi tải lại 1 lần)', async () => {
  const direct = await openPage({ hash: '#quydinh/pdf-7' });
  assert.equal(activeTab(direct.document).ruleDocTab, 'pdf-7');
  direct.window.close();

  const unknown = await openPage({ hash: '#quydinh/pdf-999' });
  assert.equal(activeTab(unknown.document).ruleDocTab, 'text-1');
  const listCalls = unknown.server.requests.filter(r => r.url === '/api/hr/rules/documents' && r.method === 'GET').length;
  assert.ok(listCalls <= 3, 'không được lặp vô hạn khi slug không tồn tại');
  unknown.window.close();
});

test('Quản lý thấy nút tải lên / gỡ; tài khoản thường thì không', async () => {
  const manager = await openPage();
  assert.equal(manager.document.getElementById('ruleDocManage').hidden, false);
  assert.equal(manager.document.getElementById('ruleDocDeleteBtn').hidden, false);
  manager.window.close();

  const staff = await openPage({ vaiTro: 'Nhân viên kho' });
  assert.equal(staff.document.getElementById('ruleDocManage').hidden, true);
  assert.equal(staff.document.getElementById('ruleDocDeleteBtn').hidden, true);
  staff.document.querySelector('[data-rule-doc-tab="pdf-7"]').click();
  await settle();
  assert.equal(staff.document.getElementById('ruleDocDownloadBtn').hidden, false, 'ai cũng có nút Tải về PDF ở tab PDF');
  staff.window.close();
});

test('nút Khôi phục chỉ hiện khi thiếu tài liệu mặc định; bấm ⇒ POST restore-defaults', async () => {
  const { window, document, server } = await openPage({ docs: [BUILTINS[0], PDF] });
  server.missingDefaults = ['phuc-loi'];
  await window.loadRuleDocuments(true);
  const restoreBtn = document.getElementById('ruleDocRestoreBtn');
  assert.equal(restoreBtn.hidden, false);

  await window.restoreRuleDefaults(); // inline onclick khong chay trong JSDOM outside-only
  await settle();
  assert.ok(server.requests.some(r => r.url === '/api/hr/rules/documents/restore-defaults' && r.method === 'POST'));
  assert.deepEqual(tabSlugs(document), ['gio-giac', 'nghi-phep', 'phuc-loi', 'treo-hang', 'pdf-7']);
  assert.equal(restoreBtn.hidden, true);
  window.close();
});

test('gỡ tài liệu: xác nhận → DELETE → tab biến mất, rơi về tài liệu đầu', async () => {
  const { window, document, server } = await openPage({ hash: '#quydinh/pdf-7' });
  assert.equal(activeTab(document).ruleDocTab, 'pdf-7');

  await window.deleteActiveRuleDoc();
  await settle();

  assert.ok(server.requests.some(r => r.method === 'DELETE' && r.url === '/api/hr/rules/documents/7'));
  assert.deepEqual(tabSlugs(document), ['text-1', 'text-2', 'text-3', 'text-4']);
  assert.equal(activeTab(document).ruleDocTab, 'text-1');
  window.close();
});

test('hủy hộp xác nhận ⇒ không gọi DELETE', async () => {
  const { window, document, server } = await openPage({ hash: '#quydinh/pdf-7' });
  server.confirmed = false;
  await window.deleteActiveRuleDoc();
  await settle();
  assert.equal(server.requests.some(r => r.method === 'DELETE'), false);
  assert.equal(tabSlugs(document).length, 5);
  window.close();
});

test('tải lên: gửi FormData (file + title) rồi chọn tài liệu mới; sai đuôi/quá lớn bị chặn phía client', async () => {
  const { window, document, server } = await openPage();
  window.openRuleUploadModal();
  assert.equal(document.getElementById('ruleUploadModal').hidden, false);

  const fileInput = document.getElementById('ruleUploadFile');
  const setFile = file => Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });

  setFile(new window.File(['x'], 'anh.png', { type: 'image/png' }));
  await window.submitRuleUpload();
  assert.match(document.getElementById('ruleUploadError').textContent, /\.pdf/);
  assert.equal(server.requests.some(r => r.method === 'POST' && r.url === '/api/hr/rules/documents'), false);

  const good = new window.File(['%PDF-1.4'], 'Bảng lương.pdf', { type: 'application/pdf' });
  setFile(good);
  window.onRuleUploadFileChange();
  assert.equal(document.getElementById('ruleUploadName').value, 'Bảng lương');
  await window.submitRuleUpload();
  await settle();

  const post = server.requests.find(r => r.method === 'POST' && r.url === '/api/hr/rules/documents');
  assert.ok(post, 'phải POST tài liệu');
  assert.equal(post.body.get('title'), 'Bảng lương');
  assert.equal(post.body.get('file').name, 'Bảng lương.pdf');
  assert.equal(document.getElementById('ruleUploadModal').hidden, true);
  assert.deepEqual(tabSlugs(document), ['text-1', 'text-2', 'text-3', 'text-4', 'pdf-7', 'pdf-9']);
  assert.equal(activeTab(document).ruleDocTab, 'pdf-9');
  window.close();
});

test('tài liệu rich-text hiển thị heading/đậm/bảng bằng HTML đã lọc từ server, vẫn giữ logo TOKOSI', async () => {
  const { window, document } = await openPage({ docs: [...BUILTINS, TEXT], hash: '#quydinh/text-8' });
  assert.equal(activeTab(document).ruleDocTab, 'text-8');
  const body = document.getElementById('ruleDocTextBody');
  assert.equal(body.querySelector('h2').textContent, 'Quy tắc');
  assert.equal(body.querySelector('strong').textContent, 'Không');
  assert.equal(body.querySelectorAll('table td').length, 2);
  assert.equal(document.querySelector('#ruleDocTextView .doc-page-header img').getAttribute('src'), '/Logo.jpg');
  window.close();
});

test('trình soạn thảo rich-text có đủ nhóm Word: định dạng, heading, căn lề, màu, bảng, ảnh', async () => {
  const { window, document } = await openPage({ docs: [...BUILTINS, TEXT] });
  window.openRuleTextModal(TEXT);
  assert.equal(document.getElementById('ruleTextEditor').innerHTML, TEXT.body);
  for (const cmd of ['bold','italic','underline','strikeThrough','insertUnorderedList','insertOrderedList','justifyLeft','justifyCenter','justifyRight']) {
    assert.ok(document.querySelector(`#rteToolbar [data-cmd="${cmd}"]`), `thiếu nút ${cmd}`);
  }
  assert.ok(document.getElementById('rteHeadingSelect'));
  assert.ok(document.getElementById('rteForeColor'));
  assert.ok(document.getElementById('rteBackColor'));
  assert.ok(document.getElementById('rteInsertTableBtn'));
  assert.ok(document.getElementById('rteInsertImageBtn'));
  window.close();
});

test('trình soạn thảo có đổi phông, cỡ chữ, giãn dòng, căn đều, liên kết, xem trước và mục lục', async () => {
  const { window, document } = await openPage({ docs: [...BUILTINS, TEXT] });
  window.openRuleTextModal(TEXT);
  const fonts = [...document.querySelectorAll('#rteFontFamily option')].map(o => o.value);
  assert.ok(fonts.includes('Arial') && fonts.includes('Times New Roman'));
  assert.ok([...document.querySelectorAll('#rteFontSize option')].some(o => o.value === '14'));
  assert.ok([...document.querySelectorAll('#rteLineHeight option')].some(o => o.value === '1.5'));
  assert.ok(document.querySelector('#rteToolbar [data-cmd="justifyFull"]'));
  assert.ok(document.getElementById('rteInsertLinkBtn'));

  // mục lục lấy từ tiêu đề trong nội dung
  document.getElementById('ruleTextEditor').innerHTML = '<h2>Mục một</h2><p>a</p><h3>Mục hai</h3>';
  window.rebuildRuleOutline();
  assert.deepEqual([...document.querySelectorAll('#rteOutline li span')].map(s => s.textContent), ['Mục một', 'Mục hai']);

  // xem trước: lọc script/on*, hiện tên tài liệu, ẩn thanh công cụ
  document.getElementById('ruleTextEditor').innerHTML = '<p onclick="x()">Chào<script>1</script> <a href="javascript:alert(1)">l</a></p>';
  window.setRuleTextTab('preview');
  const body = document.getElementById('rtePreviewBody');
  assert.equal(document.getElementById('rtePreview').hidden, false);
  assert.equal(document.getElementById('rteToolbar').hidden, true);
  assert.equal(body.querySelector('script'), null);
  assert.equal(body.querySelector('p').getAttribute('onclick'), null);
  assert.equal(body.querySelector('a').getAttribute('href'), null);
  window.setRuleTextTab('edit');
  assert.equal(document.getElementById('rtePreview').hidden, true);

  // thay đổi nội dung đánh dấu chưa lưu; mở lại hộp thì reset
  window.markRuleTextDirty();
  assert.match(document.getElementById('rteStatusText').textContent, /chưa lưu/);
  window.openRuleTextModal(TEXT);
  assert.match(document.getElementById('rteStatusText').textContent, /Chưa có thay đổi/);
  window.close();
});

test('tạo rich-text gửi innerHTML (không phải textContent) và chọn tab mới', async () => {
  const { window, document, server } = await openPage();
  window.openRuleTextModal(null);
  document.getElementById('ruleTextName').value = 'Quy định mới';
  document.getElementById('ruleTextEditor').innerHTML = '<h1>Tiêu đề</h1><p><strong>Nội dung</strong></p>';
  await window.submitRuleText();
  await settle();
  const post = server.requests.find(r => r.url === '/api/hr/rules/documents/text' && r.method === 'POST');
  assert.deepEqual(JSON.parse(post.body), { title: 'Quy định mới', body: '<h1>Tiêu đề</h1><p><strong>Nội dung</strong></p>', icon: '' });
  assert.equal(activeTab(document).ruleDocTab, 'text-10');
  window.close();
});

test('icon tài liệu: picker hiện đủ "không có" + 8 icon cố định, bấm chọn gửi đúng khóa trong payload', async () => {
  const { window, document, server } = await openPage();
  window.openRuleTextModal(null);

  const options = [...document.querySelectorAll('#rteIconPicker .rte-icon-option')];
  assert.equal(options.length, 9); // 1 "không có" + 8 icon (clock/calendar/gift/box/info/warning/document/users)
  assert.equal(document.getElementById('ruleTextIcon').value, '');

  options[2].click(); // icon thu 2 sau "khong co" — tuong ung khoa 'calendar' (thu tu Object.keys ICON_DEFS)
  assert.equal(document.getElementById('ruleTextIcon').value, 'calendar');
  assert.ok(options[2].classList.contains('active'));
  assert.ok(!options[0].classList.contains('active'));

  document.getElementById('ruleTextName').value = 'Tài liệu có icon';
  document.getElementById('ruleTextEditor').innerHTML = '<p>Nội dung</p>';
  await window.submitRuleText();
  await settle();
  const post = server.requests.find(r => r.url === '/api/hr/rules/documents/text' && r.method === 'POST');
  assert.equal(JSON.parse(post.body).icon, 'calendar');
  window.close();
});

test('icon tài liệu: tài liệu có iconKey hiện SVG cạnh tiêu đề, tài liệu không có icon thì ẩn', async () => {
  const withIcon = { ...TEXT, iconKey: 'box' };
  const { window, document } = await openPage({ docs: [...BUILTINS, PDF, withIcon] });
  document.querySelector('[data-rule-doc-tab="text-8"]').click();
  await settle();

  const iconEl = document.getElementById('ruleDocTextIcon');
  assert.equal(iconEl.hidden, false);
  assert.match(iconEl.innerHTML, /<svg/);
  window.close();
});

test('icon tài liệu: mở form Sửa điền sẵn đúng icon đã chọn trước đó', async () => {
  const withIcon = { ...TEXT, iconKey: 'gift' };
  const { window, document } = await openPage({ docs: [...BUILTINS, PDF, withIcon] });
  document.querySelector('[data-rule-doc-tab="text-8"]').click();
  await settle();
  window.openRuleTextModal(withIcon);

  assert.equal(document.getElementById('ruleTextIcon').value, 'gift');
  const active = document.querySelector('#rteIconPicker .rte-icon-option.active');
  assert.ok(active, 'phai co 1 icon dang active');
  window.close();
});

test('payload lạ / lỗi API: hiện trạng thái lỗi trong panel, không throw', async () => {
  const { window, document } = await openPage({ listPayload: { requests: [] } });
  const status = document.getElementById('ruleDocStatus');
  assert.equal(status.hidden, false);
  assert.match(status.textContent, /Không tải được danh sách tài liệu/);
  assert.equal(document.querySelectorAll('.rule-doc-tab').length, 0);
  window.close();
});

// 2 test cu kiem tra khoi HTML tinh "#ruleDoc-phuc-loi"/"#ruleDoc-treo-hang" va
// RULE_DOC_BUILTINS da bi xoa (migration 0065 chuyen ca 4 tai lieu dung san sang
// kind='text') — thay bang test duoi, khoa hanh vi an toan khi gap dong kind='builtin'
// sot lai (vd server chua chay 0063 nhung code moi da deploy).

test('kind="builtin" con lai truoc migration 0065 van hien noi dung cu', async () => {
  const { window, document } = await openPage({ docs: [...BUILTINS, PDF] });
  assert.deepEqual(tabSlugs(document), ['gio-giac', 'nghi-phep', 'phuc-loi', 'treo-hang', 'pdf-7']);
  assert.equal(activeTab(document).ruleDocTab, 'gio-giac');
  assert.deepEqual(visibleViews(document), ['gio-giac']);
  assert.match(document.querySelector('[data-rule-doc="gio-giac"]').textContent, /Giờ làm việc chính thức/);
  window.close();
});

test('sửa bảng trong trình soạn: thanh nổi hiện khi con trỏ trong ô, thêm dòng/cột, gộp ô, viền, xóa bảng', async () => {
  const { window, document } = await openPage({ docs: [...BUILTINS, TEXT] });
  window.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'shared', 'rte-table.js'), 'utf8'));
  window.openRuleTextModal(TEXT);
  const editor = document.getElementById('ruleTextEditor');
  editor.innerHTML = '<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody></table>';
  const cell = () => editor.querySelector('td');
  const place = (node) => { const r = document.createRange(); r.selectNodeContents(node); r.collapse(true); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); window.document.dispatchEvent(new window.Event('selectionchange')); };

  const actions = [...document.querySelectorAll('#rteTableBar button[data-table-action]')].map(b => b.dataset.tableAction);
  assert.deepEqual(actions, ['merge', 'split', 'border']);
  assert.equal(document.querySelectorAll('#rteTableBar [aria-haspopup="menu"]').length, 2);
  assert.equal(document.querySelectorAll('#rteTableMenu button').length, 10);

  place(cell());
  assert.equal(document.getElementById('rteTableBar').hidden, false);
  assert.equal(document.querySelector('#rteTableBar [data-table-action="merge"]').disabled, true);
  assert.equal(document.querySelector('#rteTableBar [data-table-action="split"]').disabled, true);
  assert.equal(editor.querySelector('#rteTableSelection'), null, 'selection overlay must not enter saved content');
  const insert = document.querySelector('#rteTableBar [data-table-menu="insert"]');
  insert.click();
  assert.equal(insert.getAttribute('aria-expanded'), 'true');
  assert.equal(document.querySelectorAll('#rteTableMenu button').length, 4);
  document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(document.getElementById('rteTableMenu').hidden, true);
  assert.equal(insert.getAttribute('aria-expanded'), 'false');
  const click = id => {
    const direct = document.querySelector(`#rteTableBar [data-table-action="${id}"]`);
    if(direct) return direct.click();
    document.querySelector(`#rteTableBar [data-table-menu="${id.startsWith('del') ? 'delete' : 'insert'}"]`).click();
    assert.equal(document.getElementById('rteTableMenu').hidden, false);
    document.querySelector(`#rteTableMenu [data-table-action="${id}"]`).click();
  };

  click('rowBelow');
  assert.equal(editor.querySelectorAll('tr').length, 3);
  place(cell());
  click('colRight');
  assert.equal(editor.querySelectorAll('tr')[0].children.length, 3);
  place(cell());
  click('delCol');
  assert.equal(editor.querySelectorAll('tr')[0].children.length, 2);

  place(cell());
  click('border');
  const style = document.getElementById('rteBorderStyle');
  style.value = 'outer';
  style.dispatchEvent(new window.Event('change'));
  assert.equal(editor.querySelector('table').dataset.border, 'outer');

  cell().dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  assert.equal(document.querySelectorAll('#rteTableMenu button').length, 10, 'right-click retains all commands');

  place(cell());
  click('delTable');
  assert.equal(editor.querySelectorAll('table').length, 0);
  window.close();
});

test('script rte-table.js được nạp trong trang HR', () => {
  assert.match(html, /<script src="\/shared\/rte-table\.js\?v=[^"]+"><\/script>/);
});
