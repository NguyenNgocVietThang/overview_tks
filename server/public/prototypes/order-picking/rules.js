(function(root){
  'use strict';
  const key = value => String(value ?? '').trim().toLowerCase();
  function quantity(value) {
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
    const text = String(value ?? '').trim();
    if (!/^\d+(\.\d+)?$/.test(text)) return null;
    // Sheet-formatted numbers such as 1.000 are ambiguous; require manual confirmation.
    if (/^\d{1,3}(\.\d{3})+$/.test(text)) return null;
    return Number(text);
  }
  function suggest(need, candidates) {
    let remaining = need;
    const available = candidates.map(c => ({ ...c, available: quantity(c.available) }));
    const picks = [];
    while (remaining > 0.000001) {
      const eligible = available.filter(c => c.available > 0);
      if (!eligible.length) break;
      eligible.sort((a,b) => Number(b.available >= remaining) - Number(a.available >= remaining)
        || (a.available >= remaining ? a.available - b.available : b.available - a.available)
        || a.id.localeCompare(b.id));
      const chosen = eligible[0];
      const take = Math.min(remaining, chosen.available);
      picks.push({ id: chosen.id, quantity: take });
      remaining = Math.max(0, Math.round((remaining - take) * 1e6) / 1e6);
      chosen.available = 0;
    }
    return { picks, shortage: remaining };
  }
  function validate(lines, locations, allocations) {
    const used = new Map();
    const errors = [];
    lines.forEach((line, index) => {
      let total = 0;
      for (const pick of allocations[index] || []) {
        const row = locations.find(c => c.id === pick.id && key(c.code) === key(line.productCode));
        if (!row || !row.location || quantity(row.available) === null || !Number.isFinite(pick.quantity) || pick.quantity < 0) { errors.push('Chỉ định không hợp lệ: ' + line.productCode); continue; }
        total += pick.quantity;
        used.set(row.id, (used.get(row.id) || 0) + pick.quantity);
      }
      if (Math.abs(total - line.quantity) > 0.000001) errors.push(line.productCode + ': đã chỉ định ' + total + '/' + line.quantity);
    });
    locations.forEach(row => {
      if (quantity(row.available) !== null && (used.get(row.id) || 0) > quantity(row.available) + 0.000001)
        errors.push(row.code + ' tại ' + row.location + ': vượt số lượng khả dụng');
    });
    return errors;
  }
  const api = { version:'best-fit-v3', key, quantity, suggest, validate };
  if (typeof module !== 'undefined') module.exports = api;
  else root.PickingRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
