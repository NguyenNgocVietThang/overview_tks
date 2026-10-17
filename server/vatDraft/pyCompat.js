'use strict';

// ==========================================
// PY COMPAT — mo phong dung hanh vi Python ma thuat toan Nhap VAT (port tu
// vat-draft-app, Python 3.12) dua vao, de ket qua JS khop TUNG CHU SO voi app cu.
// Dich thang sang JS se lech o: round() (banker's tren gia tri nhi phan that),
// sum() (tong bu Neumaier tu 3.12), str.strip()/\s (tap khoang trang khac JS),
// casefold() (khac toLowerCase), float() (cu phap khac Number()), min()/max()
// voi NaN, so sanh tuple, urllib.parse.quote.
// ==========================================

// Tap ky tu str.isspace() / re \s cua Python (khac JS \s: JS co \uFEFF, thieu \x1c-\x1f, \x85).
const PY_WS_CLASS = '\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const PY_WS = `[${PY_WS_CLASS}]`;
const STRIP_RE = new RegExp(`^${PY_WS}+|${PY_WS}+$`, 'g');
const WS_RUN_RE = new RegExp(`${PY_WS}+`, 'g');

/** str.strip() khong tham so. */
function pyStrip(text) {
  return String(text).replace(STRIP_RE, '');
}

/** re.sub(r"\s+", repl, text) voi \s cua Python. */
function pyCollapseWs(text, repl = ' ') {
  return String(text).replace(WS_RUN_RE, repl);
}

/** str.split() khong tham so: tach theo cum khoang trang, bo chuoi rong. */
function pySplitWs(text) {
  const trimmed = pyStrip(text);
  return trimmed ? trimmed.split(WS_RUN_RE) : [];
}

// casefold() khac toLowerCase() o 125 ky tu ngoai Cherokee (sinh tu Python 3.14 /
// Unicode 16): ß→ss, ς→σ, ſ→s, µ→μ, chu ghep ﬀ/ﬁ..., Hy Lap co iota duoi...
const CASEFOLD_FIXUPS = new Map(
  ('b5:3bc df:73.73 149:2bc.6e 17f:73 1f0:6a.30c 345:3b9 390:3b9.308.301 3b0:3c5.308.301 3c2:3c3 3d0:3b2 ' +
  '3d1:3b8 3d5:3c6 3d6:3c0 3f0:3ba 3f1:3c1 3f5:3b5 587:565.582 1c80:432 1c81:434 1c82:43e 1c83:441 1c84:442 ' +
  '1c85:442 1c86:44a 1c87:463 1c88:a64b 1e96:68.331 1e97:74.308 1e98:77.30a 1e99:79.30a 1e9a:61.2be 1e9b:1e61 ' +
  '1e9e:73.73 1f50:3c5.313 1f52:3c5.313.300 1f54:3c5.313.301 1f56:3c5.313.342 1f80:1f00.3b9 1f81:1f01.3b9 ' +
  '1f82:1f02.3b9 1f83:1f03.3b9 1f84:1f04.3b9 1f85:1f05.3b9 1f86:1f06.3b9 1f87:1f07.3b9 1f88:1f00.3b9 ' +
  '1f89:1f01.3b9 1f8a:1f02.3b9 1f8b:1f03.3b9 1f8c:1f04.3b9 1f8d:1f05.3b9 1f8e:1f06.3b9 1f8f:1f07.3b9 ' +
  '1f90:1f20.3b9 1f91:1f21.3b9 1f92:1f22.3b9 1f93:1f23.3b9 1f94:1f24.3b9 1f95:1f25.3b9 1f96:1f26.3b9 ' +
  '1f97:1f27.3b9 1f98:1f20.3b9 1f99:1f21.3b9 1f9a:1f22.3b9 1f9b:1f23.3b9 1f9c:1f24.3b9 1f9d:1f25.3b9 ' +
  '1f9e:1f26.3b9 1f9f:1f27.3b9 1fa0:1f60.3b9 1fa1:1f61.3b9 1fa2:1f62.3b9 1fa3:1f63.3b9 1fa4:1f64.3b9 ' +
  '1fa5:1f65.3b9 1fa6:1f66.3b9 1fa7:1f67.3b9 1fa8:1f60.3b9 1fa9:1f61.3b9 1faa:1f62.3b9 1fab:1f63.3b9 ' +
  '1fac:1f64.3b9 1fad:1f65.3b9 1fae:1f66.3b9 1faf:1f67.3b9 1fb2:1f70.3b9 1fb3:3b1.3b9 1fb4:3ac.3b9 ' +
  '1fb6:3b1.342 1fb7:3b1.342.3b9 1fbc:3b1.3b9 1fbe:3b9 1fc2:1f74.3b9 1fc3:3b7.3b9 1fc4:3ae.3b9 1fc6:3b7.342 ' +
  '1fc7:3b7.342.3b9 1fcc:3b7.3b9 1fd2:3b9.308.300 1fd3:3b9.308.301 1fd6:3b9.342 1fd7:3b9.308.342 ' +
  '1fe2:3c5.308.300 1fe3:3c5.308.301 1fe4:3c1.313 1fe6:3c5.342 1fe7:3c5.308.342 1ff2:1f7c.3b9 1ff3:3c9.3b9 ' +
  '1ff4:3ce.3b9 1ff6:3c9.342 1ff7:3c9.342.3b9 1ffc:3c9.3b9 fb00:66.66 fb01:66.69 fb02:66.6c fb03:66.66.69 ' +
  'fb04:66.66.6c fb05:73.74 fb06:73.74 fb13:574.576 fb14:574.565 fb15:574.56b fb16:57e.576 fb17:574.56d')
    .split(' ')
    .map(entry => {
      const [cp, folded] = entry.split(':');
      return [parseInt(cp, 16), String.fromCodePoint(...folded.split('.').map(hex => parseInt(hex, 16)))];
    })
);

function casefoldChar(ch) {
  const cp = ch.codePointAt(0);
  const fixed = CASEFOLD_FIXUPS.get(cp);
  if (fixed !== undefined) return fixed;
  // Cherokee: casefold ve chu HOA (nguoc toLowerCase).
  if (cp >= 0x13a0 && cp <= 0x13f5) return ch;
  if (cp >= 0x13f8 && cp <= 0x13fd) return String.fromCodePoint(cp - 8);
  if (cp >= 0xab70 && cp <= 0xabbf) return String.fromCodePoint(cp - 0xab70 + 0x13a0);
  return ch.toLowerCase();
}

/** str.casefold(). */
function pyCasefold(text) {
  const value = String(text);
  // Nhanh: chuoi ASCII / Latin thuong gap khong co ky tu dac biet.
  if (!/[µßŉſǰͅΐ-ϵևᎠ-ᏽᲀ-ᲈẖ-ẞὐ-ῼꭰ-ꮿﬀ-ﬗ]/.test(value)) {
    return value.toLowerCase();
  }
  let out = '';
  for (const ch of value) out += casefoldChar(ch);
  return out;
}

// float(): [sign] (digitpart "." digitpart | digitpart ["."] | "." digitpart) [exponent] | inf | infinity | nan
const DIGITPART = '\\d(?:_?\\d)*';
const PY_FLOAT_RE = new RegExp(`^[+-]?(?:${DIGITPART}(?:\\.(?:${DIGITPART})?)?|\\.${DIGITPART})(?:[eE][+-]?${DIGITPART})?$`);
const PY_SPECIAL_RE = /^([+-]?)(inf|infinity|nan)$/i;

/**
 * float(text) cho chuoi; tra null thay vi nem ValueError. (Khong ho tro chu so
 * Unicode ngoai ASCII — du lieu hoa don/Sheets khong co.)
 */
function pyFloat(text) {
  const value = pyStrip(text);
  const special = value.match(PY_SPECIAL_RE);
  if (special) {
    if (special[2].toLowerCase() === 'nan') return NaN;
    return special[1] === '-' ? -Infinity : Infinity;
  }
  if (!PY_FLOAT_RE.test(value)) return null;
  return Number(value.replace(/_/g, ''));
}

/**
 * round(x, nd) cua Python cho float: lam tron GIA TRI NHI PHAN THAT ve nd chu so,
 * hoa thi ve so chan. Math.round/toFixed lam tron len khi hoa va tren chuoi thap
 * phan (0.125 → 0.13 trong JS, Python ra 0.12; 133518.5 → JS 133519, Python 133518).
 */
function pyRound(x, nd = 0) {
  if (!Number.isFinite(x) || Math.abs(x) >= 1e21) return x;
  const negative = x < 0 || Object.is(x, -0);
  // toFixed(100) la khai trien thap phan CHINH XAC cua double (|x| >= 2^-48).
  const [intPart, fracPart] = Math.abs(x).toFixed(100).split('.');
  let n = BigInt(intPart + fracPart.slice(0, nd));
  const rest = fracPart.slice(nd);
  if (rest[0] > '5' || (rest[0] === '5' && (/[1-9]/.test(rest.slice(1)) || n % 2n === 1n))) n += 1n;
  const digits = n.toString().padStart(nd + 1, '0');
  const value = Number(nd ? `${digits.slice(0, -nd)}.${digits.slice(-nd)}` : digits);
  return negative ? -value : value;
}

/** sum() cua Python 3.12+ tren float: tong bu Neumaier (sum([0.1]*10) === 1.0). */
function pySum(values) {
  let total = 0;
  let compensation = 0;
  for (const x of values) {
    const t = total + x;
    compensation += Math.abs(total) >= Math.abs(x) ? (total - t) + x : (x - t) + total;
    total = t;
  }
  if (compensation !== 0 && Number.isFinite(compensation)) total += compensation;
  return total;
}

/** min(a, b) / max(a, b) cua Python: giu a tru khi b nho/lon hon han (NaN khong lan). */
function pyMin2(a, b) { return b < a ? b : a; }
function pyMax2(a, b) { return b > a ? b : a; }

/**
 * So sanh tuple Python (dung lam comparator cho Array.sort on dinh): so voi so,
 * chuoi voi chuoi theo code unit (giong Python voi BMP), boolean nhu 0/1.
 */
function cmpTuple(a, b) {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    let x = a[i];
    let y = b[i];
    if (typeof x === 'boolean') x = x ? 1 : 0;
    if (typeof y === 'boolean') y = y ? 1 : 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return a.length - b.length;
}

/** sorted(set_of_strings) cua Python: sap theo code point, khong dung localeCompare. */
function pySortedStrings(values) {
  return [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** urllib.parse.quote(text) (safe='/'): khac encodeURIComponent o !'()* va '/'. */
function pyQuote(text) {
  return encodeURIComponent(String(text))
    .replace(/[!'()*]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%2F/g, '/');
}

/** repr(float) cua Python: '1.0', '0.1', '1e+16', '1e-05', 'nan', 'inf'. */
function pyFloatRepr(x) {
  if (Number.isNaN(x)) return 'nan';
  if (x === Infinity) return 'inf';
  if (x === -Infinity) return '-inf';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const [mantissa, expText] = Math.abs(x).toExponential().split('e');
  const digits = mantissa.replace('.', '');
  const exponent = Number(expText);
  const decpt = exponent + 1;
  const sign = x < 0 ? '-' : '';
  if (decpt <= -4 || decpt > 16) {
    const frac = digits.length > 1 ? `.${digits.slice(1)}` : '';
    const expAbs = String(Math.abs(exponent)).padStart(2, '0');
    return `${sign}${digits[0]}${frac}e${exponent < 0 ? '-' : '+'}${expAbs}`;
  }
  if (decpt <= 0) return `${sign}0.${'0'.repeat(-decpt)}${digits}`;
  if (decpt >= digits.length) return `${sign}${digits}${'0'.repeat(decpt - digits.length)}.0`;
  return `${sign}${digits.slice(0, decpt)}.${digits.slice(decpt)}`;
}

/** str(value) cua Python cho cac kieu xuat hien trong du lieu (chuoi, float, null → 'None'). */
function pyStr(value) {
  if (value === null || value === undefined) return 'None';
  if (typeof value === 'number') return pyFloatRepr(value);
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  return String(value);
}

module.exports = {
  PY_WS,
  PY_WS_CLASS,
  pyStrip,
  pyCollapseWs,
  pySplitWs,
  pyCasefold,
  pyFloat,
  pyRound,
  pySum,
  pyMin2,
  pyMax2,
  cmpTuple,
  pySortedStrings,
  pyQuote,
  pyFloatRepr,
  pyStr
};
