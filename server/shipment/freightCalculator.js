'use strict';

// ==========================================
// FREIGHT CALCULATOR — gia cuoc nha xe cho 1 don theo tong the tich (m3) va can nang (kg).
// HAM THUAN, khong doc Sheet/DB. Cong thuc chot voi nguoi dung 2026-10-15 theo sheet "Hoa":
//   Duc Manh : 550.000 d/m3, toi thieu 350.000 d, khong phu thu.
//              m3 x 550.000 <= 350.000 -> 350.000; nguoc lai max(kg x 1.330, m3 x 550.000).
//   Viet Linh: m3 > 0,6 -> m3 x 465.000; nguoc lai 500.000. Phu thu 200.000 khi m3 < 2.
//   J&T      : (chot 2026-10-15) tinh THEO TUNG DONG HANG, khong theo tong don:
//              cuoc 1 thung = max(40.000, 4.000 x dai x rong x cao(cm) / 6000, kg thung x 4.000);
//              cuoc dong = cuoc 1 thung x so thung; tong cuoc = tong cac dong. Khong phu thu.
// (Khong ap dung "giao ra chanh 490k + ve chanh 70k" va nha xe Lien Viet — chi la ghi chu trong sheet.)
// Doi gia chi sua hang so o day.
// ==========================================

const RATES = Object.freeze({
  DM: Object.freeze({ perM3: 550000, minimum: 350000, perKg: 1330 }),
  VL: Object.freeze({ perM3: 465000, smallOrderM3: 0.6, smallOrderFee: 500000, surchargeBelowM3: 2, surcharge: 200000 }),
  JT: Object.freeze({ minimumPerCarton: 40000, perUnit: 4000, volumetricDivisor: 6000 })
});

const CARRIER_NOTES = Object.freeze({
  DM: 'Cước nhà xe Đức Mạnh 550k/m³, cước tối thiểu 350k.',
  VL: 'Cước nhà xe Việt Linh 465k/m³, đơn từ 0,6 m³ trở xuống tính 500k, phụ thu 200k khi dưới 2 m³.',
  JT: 'Cước J&T tính theo từng mã hàng: mỗi thùng lấy lớn nhất của 40k, 4k × dài × rộng × cao / 6000 (cm) và cân nặng × 4k; nhân số thùng rồi cộng các mã.'
});

const CARRIER_LABELS = Object.freeze({ DM: 'Đức Mạnh', VL: 'Việt Linh', JT: 'J&T' });

const M3_TEXT = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const KG_TEXT = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function step(label, amount) {
  return { label, amount: Math.round(amount) };
}

function calculateDucManh(m3, kg) {
  const byVolume = m3 * RATES.DM.perM3;
  const steps = [step(`Theo thể tích: ${M3_TEXT.format(m3)} m³ × ${RATES.DM.perM3.toLocaleString('vi-VN')}`, byVolume)];
  let freight;
  if (byVolume <= RATES.DM.minimum) {
    freight = RATES.DM.minimum;
    steps.push(step('Cước tối thiểu', freight));
  } else {
    const byWeight = kg * RATES.DM.perKg;
    steps.push(step(`Theo cân nặng: ${KG_TEXT.format(kg)} kg × ${RATES.DM.perKg.toLocaleString('vi-VN')}`, byWeight));
    freight = Math.max(byVolume, byWeight);
  }
  return { freight: Math.round(freight), surcharge: 0, steps };
}

function calculateVietLinh(m3) {
  const steps = [];
  let freight;
  if (m3 > RATES.VL.smallOrderM3) {
    freight = m3 * RATES.VL.perM3;
    steps.push(step(`${M3_TEXT.format(m3)} m³ × ${RATES.VL.perM3.toLocaleString('vi-VN')}`, freight));
  } else {
    freight = RATES.VL.smallOrderFee;
    steps.push(step(`Đơn từ 0,6 m³ trở xuống`, freight));
  }
  const surcharge = m3 < RATES.VL.surchargeBelowM3 ? RATES.VL.surcharge : 0;
  if (surcharge) steps.push(step(`Phụ thu đơn dưới ${RATES.VL.surchargeBelowM3} m³`, surcharge));
  return { freight: Math.round(freight), surcharge, steps };
}

/**
 * J&T: cuoc theo tung dong. @param items [{ productCode, cartons, m3PerCarton, kgPerCarton }]
 */
function calculateJT(items) {
  const { minimumPerCarton, perUnit, volumetricDivisor } = RATES.JT;
  const steps = [];
  let freight = 0;
  for (const item of items) {
    const volumetricKg = (item.m3PerCarton * 1e6) / volumetricDivisor;
    const perCarton = Math.max(minimumPerCarton, perUnit * volumetricKg, perUnit * item.kgPerCarton);
    const amount = perCarton * item.cartons;
    freight += amount;
    steps.push(step(`${item.productCode}: ${item.cartons} thùng × ${Math.round(perCarton).toLocaleString('vi-VN')}`, amount));
  }
  const rounded = Math.round(freight);
  return { carrier: 'JT', label: CARRIER_LABELS.JT, note: CARRIER_NOTES.JT, freight: rounded, surcharge: 0, total: rounded, steps };
}

/**
 * @param {{ m3: number, kg: number }} totals
 * @returns {{ DM: object|null, VL: object|null }} moi nha xe: { carrier, label, note, freight, surcharge, total, steps };
 *   null khi thieu the tich (m3 <= 0 hoac khong hop le) — khi do khong tinh cuoc.
 */
function calculateFreight({ m3, kg }) {
  const volume = Number(m3);
  const weight = Number(kg) || 0;
  if (!Number.isFinite(volume) || volume <= 0) return { DM: null, VL: null };
  const wrap = (carrier, result) => ({
    carrier, label: CARRIER_LABELS[carrier], note: CARRIER_NOTES[carrier],
    ...result, total: result.freight + result.surcharge
  });
  return {
    DM: wrap('DM', calculateDucManh(volume, weight)),
    VL: wrap('VL', calculateVietLinh(volume))
  };
}

module.exports = { calculateFreight, calculateJT, RATES, CARRIER_LABELS, CARRIER_NOTES };

/**
 * HAM THUAN. Gop the tich/can nang cua cac dong hang don + gia cuoc 2 nha xe.
 * @param lines [{ productCode, quantity, isService }]
 * @param measures Map<codeKey, { perCarton, m3PerUnit, kgPerUnit } | { missing: true }> (tu measureSheet.lookup)
 * @returns { lineMeasures, freight } — lineMeasures song song voi `lines`: { status: 'ok'|'missing'|'service', m3, kg, cartons }.
 *   Con ma thieu -> carriers = null (KHONG tinh cuoc, quyet dinh 2026-10-15), chi bao missingCodes.
 */
// calculateFreight tra DM/VL = null khi thieu the tich; khi do J&T cung khong co gi de tinh.
function withJT(carriers, jtItems) {
  return { ...carriers, JT: jtItems.length && carriers.DM ? calculateJT(jtItems) : null };
}

function buildOrderFreight(lines, measures) {
  const totals = { m3: 0, kg: 0, cartons: 0 };
  const missingCodes = [];
  const jtItems = [];
  const lineMeasures = lines.map(line => {
    if (line.isService) return { status: 'service', m3: null, kg: null, cartons: null };
    const quantity = Number(line.quantity) || 0;
    const entry = measures.get(String(line.productCode ?? '').trim().toLowerCase());
    if (!entry || entry.missing) {
      const code = String(line.productCode ?? '').trim();
      if (code && !missingCodes.includes(code)) missingCodes.push(code);
      return { status: 'missing', m3: null, kg: null, cartons: null };
    }
    const m3 = quantity * entry.m3PerUnit;
    const kg = quantity * (entry.kgPerUnit || 0);
    const cartons = Math.round(quantity / entry.perCarton);
    // Dong co SL > 0 ma lam tron ra 0 thung van phai tra it nhat 1 thung cuoc.
    if (quantity > 0) {
      jtItems.push({
        productCode: String(line.productCode ?? '').trim(),
        cartons: Math.max(1, cartons),
        m3PerCarton: entry.m3PerUnit * entry.perCarton,
        kgPerCarton: (entry.kgPerUnit || 0) * entry.perCarton
      });
    }
    totals.m3 += m3; totals.kg += kg; totals.cartons += cartons;
    return { status: 'ok', m3, kg, cartons };
  });
  const complete = missingCodes.length === 0;
  return {
    lineMeasures,
    freight: {
      unavailable: false,
      totals,
      missingCodes,
      carriers: complete ? withJT(calculateFreight(totals), jtItems) : null
    }
  };
}

module.exports.buildOrderFreight = buildOrderFreight;
