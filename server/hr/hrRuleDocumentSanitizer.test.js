'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeRuleDocumentHtml } = require('./hrRuleDocumentSanitizer');

test('giu lai cac the dinh dang co ban (dam/nghieng/gach chan/gach ngang/danh sach/tieu de)', () => {
  const html = '<h1>Tieu de</h1><p><b>dam</b> <i>nghieng</i> <u>gach chan</u> <s>gach ngang</s></p><ul><li>a</li></ul><ol><li>b</li></ol>';
  assert.equal(sanitizeRuleDocumentHtml(html), html);
});

test('giu can le va mau hop le (hex/rgb) qua style whitelist', () => {
  const html = '<p style="text-align:center">giua</p><span style="color:#ff0000;background-color:rgb(0, 128, 0)">chu</span>';
  const out = sanitizeRuleDocumentHtml(html);
  assert.match(out, /text-align:\s*center/);
  assert.match(out, /color:\s*#ff0000/);
  assert.match(out, /background-color:\s*rgb\(0,\s*128,\s*0\)/);
});

test('giu CSS do contenteditable styleWithCSS tao ra cho dam/nghieng/gach chan/gach ngang', () => {
  const input = '<p style="text-align:center"><span style="font-weight:bold;font-style:italic;text-decoration:underline line-through;color:rgb(1, 2, 3)">Chu</span></p>';
  const output = sanitizeRuleDocumentHtml(input);
  assert.match(output, /text-align:center/);
  assert.match(output, /font-weight:bold/);
  assert.match(output, /font-style:italic/);
  assert.match(output, /text-decoration:underline line-through/);
  assert.match(output, /color:rgb\(1, 2, 3\)/);
});

test('giu h3/h4 (tieu de phu, dung nhieu trong tai lieu dung san chuyen doi) va hr (gach ngang)', () => {
  const html = '<h3>Muc 1</h3><h4>Muc con</h4><p>Noi dung</p><hr>';
  assert.equal(sanitizeRuleDocumentHtml(html), '<h3>Muc 1</h3><h4>Muc con</h4><p>Noi dung</p><hr />'); // sanitize-html tu dong khep <hr/>
});

test('giu bang (table/tr/td) va colspan/rowspan', () => {
  const html = '<table><tbody><tr><td colspan="2">o</td></tr></tbody></table>';
  assert.equal(sanitizeRuleDocumentHtml(html), html);
});

test('CHAN script tag va bo luon noi dung ben trong (khong lo thanh van ban)', () => {
  const out = sanitizeRuleDocumentHtml('<p>truoc</p><script>alert(document.cookie)</script><p>sau</p>');
  assert.doesNotMatch(out, /script/i);
  assert.doesNotMatch(out, /alert/);
  assert.doesNotMatch(out, /document\.cookie/);
  assert.match(out, /truoc/);
  assert.match(out, /sau/);
});

test('CHAN onerror/onclick va moi thuoc tinh on* tren the duoc phep', () => {
  const out = sanitizeRuleDocumentHtml('<p onclick="alert(1)">x</p><img src="/api/hr/rules/documents/1/images/2" onerror="alert(2)">');
  assert.doesNotMatch(out, /onclick/i);
  assert.doesNotMatch(out, /onerror/i);
});

test('CHAN javascript: va data: trong href cua the a', () => {
  const out1 = sanitizeRuleDocumentHtml('<a href="javascript:alert(1)">bam</a>');
  assert.doesNotMatch(out1, /javascript:/i);
  const out2 = sanitizeRuleDocumentHtml('<a href="data:text/html,<script>alert(1)</script>">bam</a>');
  assert.doesNotMatch(out2, /data:/i);
});

test('the a: luon ep target=_blank va rel=noopener noreferrer, href http/https thi giu', () => {
  const out = sanitizeRuleDocumentHtml('<a href="https://tokosi.vn">link</a>');
  assert.match(out, /target="_blank"/);
  assert.match(out, /rel="noopener noreferrer"/);
  assert.match(out, /href="https:\/\/tokosi\.vn"/);
});

test('CHAN iframe/object/embed/svg/form va noi dung ben trong (co the mang script)', () => {
  const out = sanitizeRuleDocumentHtml('<iframe src="javascript:alert(1)">victim text</iframe><svg onload="alert(1)"><script>alert(2)</script></svg>');
  assert.doesNotMatch(out, /iframe/i);
  assert.doesNotMatch(out, /svg/i);
  assert.doesNotMatch(out, /alert/);
});

test('div do contenteditable tao ra duoc giu nhung class khong hop le bi go', () => {
  const out = sanitizeRuleDocumentHtml('<div class="x">noi dung con</div>');
  assert.match(out, /<div>noi dung con<\/div>/i);
  assert.doesNotMatch(out, /class=/i);
  assert.match(out, /noi dung con/);
});

test('style bi CSS injection (url/expression/import) khong duoc giu', () => {
  const out1 = sanitizeRuleDocumentHtml('<span style="color:url(javascript:alert(1))">x</span>');
  assert.doesNotMatch(out1, /url\(/i);
  const out2 = sanitizeRuleDocumentHtml('<p style="text-align:expression(alert(1))">x</p>');
  assert.doesNotMatch(out2, /expression/i);
});

test('anh chi giu src dung dung dang API noi bo, src ngoai bi go (chong leak IP qua anh ngoai)', () => {
  const ok = sanitizeRuleDocumentHtml('<img src="/api/hr/rules/documents/5/images/9" alt="a">');
  assert.match(ok, /src="\/api\/hr\/rules\/documents\/5\/images\/9"/);

  const external = sanitizeRuleDocumentHtml('<img src="https://evil.example/track.png" alt="a">');
  assert.doesNotMatch(external, /src=/);

  const dataUri = sanitizeRuleDocumentHtml('<img src="data:image/png;base64,AAAA" alt="a">');
  assert.doesNotMatch(dataUri, /src=/);
});

test('style/class tren the khong duoc whitelist cho thuoc tinh do bi go het', () => {
  const out = sanitizeRuleDocumentHtml('<h1 style="color:red" class="evil">Tieu de</h1>');
  assert.doesNotMatch(out, /style=/);
  assert.doesNotMatch(out, /class=/);
  assert.match(out, /<h1>Tieu de<\/h1>/);
});

test('chuoi rong / null / undefined tra ve chuoi rong, khong nem loi', () => {
  assert.equal(sanitizeRuleDocumentHtml(''), '');
  assert.equal(sanitizeRuleDocumentHtml(null), '');
  assert.equal(sanitizeRuleDocumentHtml(undefined), '');
});

test('loai bo nhan Cot hien thi do table-controls chen nham vao trinh soan thao', () => {
  const contaminated = '<div class="tks-table-tools"><button><svg><path></path></svg>Cột hiển thị</button></div><table><tr><td>Nội dung thật</td></tr></table>';
  assert.equal(
    sanitizeRuleDocumentHtml(contaminated),
    '<table><tr><td>Nội dung thật</td></tr></table>'
  );
});

test('giu phong chu, co chu px va gian dong do trinh soan sinh ra', () => {
  const input = '<p style="line-height:1.5;text-align:justify"><span style="font-family:Arial;font-size:18px">A</span><span style="font-family:&quot;Times New Roman&quot;">B</span></p><ul><li style="line-height:2">x</li></ul>';
  const output = sanitizeRuleDocumentHtml(input);
  assert.match(output, /line-height:1\.5/);
  assert.match(output, /text-align:justify/);
  assert.match(output, /font-family:Arial/);
  assert.match(output, /font-size:18px/);
  assert.match(output, /font-family:&quot;Times New Roman&quot;/);
  assert.match(output, /<li style="line-height:2">/);
});

test('CHAN font-family/font-size/line-height chua url(), expression hoac don vi la', () => {
  const input = '<p style="line-height:expression(alert(1))"><span style="font-family:url(javascript:alert(1));font-size:999px">x</span><span style="font-size:12em">y</span></p>';
  const output = sanitizeRuleDocumentHtml(input);
  assert.doesNotMatch(output, /expression|url\(|999px|12em/);
});

test('bang: giu data-border, data-border-width, --tb-color hex va width o hop le', () => {
  const html = '<table data-border="outer" data-border-width="2" style="--tb-color:#aabbcc"><tbody><tr><td width="120" colspan="2">a</td><th width="40">b</th></tr></tbody></table>';
  assert.equal(sanitizeRuleDocumentHtml(html), html);
  const short = sanitizeRuleDocumentHtml('<table data-border="none" data-border-width="3" style="--tb-color:#abc"><tr><td width="800">a</td></tr></table>');
  assert.match(short, /data-border="none"/);
  assert.match(short, /data-border-width="3"/);
  assert.match(short, /style="--tb-color:#abc"/);
  assert.match(short, /width="800"/);
  assert.match(sanitizeRuleDocumentHtml('<table data-border="all"><tr><td>a</td></tr></table>'), /data-border="all"/);
});

test('bang: loai data-border / data-border-width co gia tri la', () => {
  const out = sanitizeRuleDocumentHtml('<table data-border="dashed" data-border-width="9"><tr><td>a</td></tr></table>');
  assert.equal(out, '<table><tr><td>a</td></tr></table>');
  const out2 = sanitizeRuleDocumentHtml('<table data-border="all" onclick="x" data-border-width="1 2"><tr><td>a</td></tr></table>');
  assert.doesNotMatch(out2, /onclick|data-border-width/);
  assert.match(out2, /data-border="all"/);
});

test('bang: --tb-color chi nhan hex, loai CSS injection va thuoc tinh style khac', () => {
  const bad = [
    'red',
    'red; background:url(x)',
    'expression(alert(1))',
    'url(javascript:alert(1))',
    'rgb(1,2,3)',
    '#12345',
    '#ggg'
  ];
  for (const v of bad) {
    const out = sanitizeRuleDocumentHtml(`<table style="--tb-color:${v}"><tr><td>a</td></tr></table>`);
    assert.equal(out, '<table><tr><td>a</td></tr></table>', v);
  }
  const mixed = sanitizeRuleDocumentHtml('<table style="--tb-color:#fff;background:url(x);color:red;width:9999px"><tr><td>a</td></tr></table>');
  assert.equal(mixed, '<table style="--tb-color:#fff"><tr><td>a</td></tr></table>');
});

test('o bang: width ngoai 40-800, khong phai so nguyen, hoac co don vi thi bi loai', () => {
  for (const v of ['39', '801', '0', '-5', '100.5', '100px', '1e2', 'abc', '', '99999', '50%']) {
    const out = sanitizeRuleDocumentHtml(`<table><tr><td width="${v}">a</td><th width="${v}">b</th></tr></table>`);
    assert.equal(out, '<table><tr><td>a</td><th>b</th></tr></table>', `width=${JSON.stringify(v)}`);
  }
  assert.match(sanitizeRuleDocumentHtml('<table><tr><td width="40">a</td></tr></table>'), /<td width="40">/);
});

test('bang: width khong lam mat colspan/rowspan va khong mo width cho the khac', () => {
  const out = sanitizeRuleDocumentHtml('<table><tr><td width="100" colspan="2" rowspan="3" style="color:red">a</td></tr></table><p width="100">x</p>');
  assert.match(out, /<td width="100" colspan="2" rowspan="3">a<\/td>/);
  assert.match(out, /<p>x<\/p>/);
});
