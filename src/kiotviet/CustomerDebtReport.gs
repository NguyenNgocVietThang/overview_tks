// ==============================================================
// BAO VE CAC TAB HN1/HN3/HN7 DO KIOTVIET QUAN LY
// ==============================================================

const LEGACY_CUSTOMER_DEBT_REPORT_TRIGGER_HANDLER = 'syncCustomerDebtReports';

/**
 * HN1/HN3/HN7 duoc tao/xuat truc tiep tu KiotViet va phai giu nguyen cau truc.
 *
 * Ham nay duoc giu lai nhu mot compatibility guard cho cac trigger/cuoc goi cu.
 * No chi go trigger bao cao cong no cu, khong doc, tao, xoa, ghi, dinh dang hay
 * thay doi bat ky thuoc tinh nao cua ba tab tren.
 */
function syncCustomerDebtReports() {
  const removedTriggerCount = disableLegacyCustomerDebtReportSync_();
  Logger.log(
    'Bo qua dong bo HN1/HN3/HN7 de giu nguyen cau truc KiotViet; da go %s trigger cu.',
    removedTriggerCount
  );
  return {
    skipped: true,
    reason: 'HN1/HN3/HN7 are managed by KiotViet and must remain unchanged.',
    removedTriggerCount: removedTriggerCount
  };
}

/** Compatibility guard: khong tao trigger moi va khong ghi vao HN1/HN3/HN7. */
function setupCustomerDebtReports() {
  return syncCustomerDebtReports();
}

/** Compatibility guard: ten ham cu chi con dung de go trigger legacy. */
function setupCustomerDebtReportDailyTrigger() {
  return disableLegacyCustomerDebtReportSync_();
}

function removeCustomerDebtReportDailyTrigger() {
  const count = disableLegacyCustomerDebtReportSync_();
  Logger.log('Da go %s trigger cong no legacy; HN1/HN3/HN7 khong bi thay doi.', count);
  return count;
}

function disableLegacyCustomerDebtReportSync_() {
  let count = 0;
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() !== LEGACY_CUSTOMER_DEBT_REPORT_TRIGGER_HANDLER) return;
    ScriptApp.deleteTrigger(trigger);
    count++;
  });
  return count;
}
