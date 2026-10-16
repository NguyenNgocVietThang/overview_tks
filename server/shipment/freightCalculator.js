'use strict';

const RATES = Object.freeze({
  DM: Object.freeze({ perM3: 550000, minimum: 350000, perKg: 1330 }),
  VL: Object.freeze({ perM3: 465000, smallOrderM3: 0.6, smallOrderFee: 500000, surchargeBelowM3: 2, surcharge: 200000 }),
  JT: Object.freeze({ perUnit: 4000, volumetricDivisor: 6000 })
});
const CARRIER_LABELS = Object.freeze({ DM: 'Đức Mạnh', VL: 'Việt Linh', JT: 'J&T' });
const CARRIER_NOTES = Object.freeze({
  DM: 'Cước nhà xe Đức Mạnh 550k/m³, cước tối thiểu 350k.',
  VL: 'Cước nhà xe Việt Linh 465k/m³, đơn từ 0,6 m³ trở xuống tính 500k, phụ thu 200k khi dưới 2 m³.',
  JT: 'Cước J&T tính theo từng mã hàng: lấy lớn hơn giữa thể tích (m³) × 1.000.000 / 6.000 × 4.000đ và cân nặng (kg) × 4.000đ, rồi cộng các mã.'
});
const M3_TEXT = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 });
const KG_TEXT = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const step = (label, amount) => ({ label, amount: Math.round(amount) });
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const wrap = (carrier, result) => ({ carrier, label: CARRIER_LABELS[carrier], note: CARRIER_NOTES[carrier], ...result, total: result.freight + result.surcharge });

function calculateFreight({ m3, kg }) {
  const volume = positive(m3) ? m3 : 0;
  const weight = positive(kg) ? kg : 0;
  if (!volume && !weight) return { DM: null, VL: null };
  const byVolume = volume * RATES.DM.perM3;
  const byWeight = weight * RATES.DM.perKg;
  const dmSteps = [];
  if (volume) dmSteps.push(step(`Theo thể tích: ${M3_TEXT.format(volume)} m³ × 550.000`, byVolume));
  // Preserve the existing volume threshold tariff; with only weight use its available tariff.
  const dmFreight = volume && byVolume <= RATES.DM.minimum
    ? RATES.DM.minimum : Math.max(RATES.DM.minimum, byVolume, byWeight);
  if (!volume || byVolume > RATES.DM.minimum) dmSteps.push(step(`Theo cân nặng: ${KG_TEXT.format(weight)} kg × 1.330`, byWeight));
  if (dmFreight === RATES.DM.minimum) dmSteps.push(step('Cước tối thiểu', dmFreight));
  const vlFreight = volume > RATES.VL.smallOrderM3 ? volume * RATES.VL.perM3 : RATES.VL.smallOrderFee;
  const surcharge = volume < RATES.VL.surchargeBelowM3 ? RATES.VL.surcharge : 0;
  const vlSteps = [step(volume > RATES.VL.smallOrderM3 ? `${M3_TEXT.format(volume)} m³ × 465.000` : 'Đơn từ 0,6 m³ trở xuống', vlFreight)];
  if (surcharge) vlSteps.push(step('Phụ thu đơn dưới 2 m³', surcharge));
  return {
    DM: wrap('DM', { freight: Math.round(dmFreight), surcharge: 0, steps: dmSteps }),
    VL: wrap('VL', { freight: Math.round(vlFreight), surcharge, steps: vlSteps })
  };
}

/** Items contain total ordered m3/kg per product, never rounded carton counts. */
function calculateJT(items) {
  let freight = 0;
  const steps = [];
  for (const item of items) {
    const byVolume = (item.m3 || 0) * 1e6 / RATES.JT.volumetricDivisor * RATES.JT.perUnit;
    const byWeight = (item.kg || 0) * RATES.JT.perUnit;
    const amount = Math.max(byVolume, byWeight);
    freight += amount;
    steps.push(step(`${item.productCode}: max(${Math.round(byVolume).toLocaleString('vi-VN')}, ${Math.round(byWeight).toLocaleString('vi-VN')})`, amount));
  }
  return wrap('JT', { freight: Math.round(freight), surcharge: 0, steps });
}

function buildOrderFreight(lines, measures) {
  const totals = { m3: 0, kg: 0 };
  const missingCodes = [];
  const jtByCode = new Map();
  let provisional = false;
  const lineMeasures = lines.map(line => {
    if (line.isService) return { status: 'service', m3: null, kg: null, missingVolume: false, missingWeight: false };
    const code = String(line.productCode ?? '').trim();
    const key = code.toLowerCase();
    const entry = measures.get(key);
    const quantity = Math.max(0, Number(line.quantity) || 0);
    const missingVolume = !positive(entry?.m3PerUnit);
    const missingWeight = !positive(entry?.kgPerUnit);
    const m3 = missingVolume ? null : quantity * entry.m3PerUnit;
    const kg = missingWeight ? null : quantity * entry.kgPerUnit;
    const missing = missingVolume || missingWeight;
    if (missing) {
      provisional = true;
      if (code && !missingCodes.some(existing => existing.toLowerCase() === key)) missingCodes.push(code);
    }
    totals.m3 += m3 || 0;
    totals.kg += kg || 0;
    if (quantity > 0 && (!missingVolume || !missingWeight)) {
      const item = jtByCode.get(key) || { productCode: code, m3: 0, kg: 0 };
      item.m3 += m3 || 0;
      item.kg += kg || 0;
      jtByCode.set(key, item);
    }
    return { status: missing ? 'missing' : 'ok', m3, kg, missingVolume, missingWeight };
  });
  const carriers = { ...calculateFreight(totals), JT: jtByCode.size ? calculateJT([...jtByCode.values()]) : null };
  for (const carrier of Object.values(carriers)) if (carrier) carrier.provisional = provisional;
  return { lineMeasures, freight: { unavailable: false, totals, missingCodes, provisional, carriers } };
}
module.exports = { calculateFreight, calculateJT, buildOrderFreight, RATES, CARRIER_LABELS, CARRIER_NOTES };
