'use strict';

// Port 1:1 src/name_matching.py: diem khop TEN KE TOAN (0-100), khong dung AI.
// App cu chay RapidFuzz 3.14.5 token_sort_ratio; o day tu viet LCS (chuoi ngan,
// khong can them thu vien) va da doi chieu dung tung chu so voi RapidFuzz.

const { pySplitWs, pyMin2, pyMax2, pyStr } = require('./pyCompat');
const { normalizeNameForMatching, stripPriceAndVatSuffix } = require('./normalization');

// Cache thuan (ket qua khong doi): cung mot TEN KE TOAN duoc chuan hoa lai cho moi dong
// hoa don — chuan hoa Unicode/regex la phan ton CPU nhat. Gioi han kich thuoc de khong phinh.
const CACHE_LIMIT = 50000;
function memo(fn) {
  const cache = new Map();
  return key => {
    let value = cache.get(key);
    if (value === undefined) {
      if (cache.size >= CACHE_LIMIT) cache.clear();
      value = fn(key);
      cache.set(key, value);
    }
    return value;
  };
}
const normalizeCached = memo(normalizeNameForMatching);
const normalizeName = value => (value === null || value === undefined ? normalizeNameForMatching(value) : normalizeCached(pyStr(value)));
const sortTokens = memo(text => pySplitWs(text).sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)).join(' '));

function lcsLength(a, b) {
  if (!a.length || !b.length) return 0;
  let prev = new Int32Array(b.length + 1);
  let curr = new Int32Array(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** RapidFuzz fuzz.ratio: Indel normalized similarity * 100 (theo code point). */
function indelRatio(s1, s2) {
  const a = Array.from(s1);
  const b = Array.from(s2);
  const lensum = a.length + b.length;
  if (!lensum) return 100;
  const dist = lensum - 2 * lcsLength(a, b);
  // Thu tu phep tinh giong RapidFuzz: (1 - dist/lensum) * 100 (200*lcs/lensum lech chu so cuoi).
  return (1.0 - dist / lensum) * 100;
}

/** RapidFuzz fuzz.token_sort_ratio (khong processor): sap token theo code point roi ratio. */
function tokenSortRatio(s1, s2) {
  return indelRatio(sortTokens(s1), sortTokens(s2));
}

function stringScore(cleanedA, cleanedB) {
  if (!cleanedA || !cleanedB) return 0;
  return tokenSortRatio(cleanedA, cleanedB);
}

function numberTokenBonusPenalty(a, b, weights) {
  if (!a.numberTokens.length && !b.numberTokens.length) return 0;
  const setA = new Set(a.numberTokens);
  const setB = new Set(b.numberTokens);
  if (setA.size && setB.size) {
    for (const token of setA) {
      if (setB.has(token)) return weights.numberTokenBonus;
    }
    // ca hai deu co token so nhung khong trung -> mau thuan
    return -weights.numberConflictPenalty;
  }
  return 0;
}

/**
 * calculate_accounting_name_score: trong so 0.45 (Ten SP hoa don) / 0.25 (Ten SP Khop ma)
 * / 0.20 (TEN VAT KIOT) / 0.10 (Ten truoc VAT da lam sach), +/- token so, kep 0-100.
 */
function calculateAccountingNameScore({ tenKeToan, userTenSp, khopMaTenSp, tenVatKiot, tenTruocVatRaw, weights }) {
  const nTenKeToan = normalizeName(tenKeToan);
  const nUserTenSp = normalizeName(userTenSp);
  const nKhopMaTenSp = normalizeName(khopMaTenSp);
  const nTenVatKiot = normalizeName(tenVatKiot);
  const nTenTruocVat = normalizeName(stripPriceAndVatSuffix(tenTruocVatRaw));

  const sUser = stringScore(nTenKeToan.cleanedText, nUserTenSp.cleanedText);
  const sKhopMa = stringScore(nTenKeToan.cleanedText, nKhopMaTenSp.cleanedText);
  const sVatKiot = stringScore(nTenKeToan.cleanedText, nTenVatKiot.cleanedText);
  const sTruocVat = stringScore(nTenKeToan.cleanedText, nTenTruocVat.cleanedText);

  let baseScore = weights.weightUserTenSp * sUser
    + weights.weightKhopmaTenSp * sKhopMa
    + weights.weightTenVatKiot * sVatKiot
    + weights.weightTenTruocVat * sTruocVat;

  // Thuong/phat token so — so voi Ten SP hoa don neu co token so, khong thi Ten SP Khop ma.
  const reference = nUserTenSp.numberTokens.length ? nUserTenSp : nKhopMaTenSp;
  baseScore += numberTokenBonusPenalty(nTenKeToan, reference, weights);

  return { score: pyMax2(0.0, pyMin2(100.0, baseScore)) };
}

module.exports = { indelRatio, tokenSortRatio, calculateAccountingNameScore };
