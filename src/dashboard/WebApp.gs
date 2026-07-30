// ==========================================
// DASHBOARD WEB APP — Diem vao HTTP
// ==========================================

/**
 * Diem vao khi mo Web App (link .../exec).
 * Tra ve file Dashboard.html duoc render boi HtmlService.
 *
 * Clasp giu duong dan thu muc cua file HTML tren Apps Script,
 * nen phai goi dung ten "ui/Dashboard".
 */
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('ui/Dashboard')
    .setTitle('TOKOSI · Live Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
