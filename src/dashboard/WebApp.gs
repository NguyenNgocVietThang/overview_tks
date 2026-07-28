// ==========================================
// DASHBOARD WEB APP — Diem vao HTTP
// ==========================================

/**
 * Diem vao khi mo Web App (link .../exec).
 * Tra ve file Dashboard.html duoc render boi HtmlService.
 *
 * Luu y: clasp se push src/ui/Dashboard.html len GAS voi ten "Dashboard",
 * nen createHtmlOutputFromFile('Dashboard') hoat dong chinh xac.
 */
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Dashboard')
    .setTitle('CHbansi · Live Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
