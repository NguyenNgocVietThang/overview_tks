// ==========================================
// QUOTA GUARD — Uoc luong UrlFetch va cau dao tam dung khi het quota
// ==========================================
//
// HN va SG dung chung mot tai khoan Google -> chung mot pool 20.000
// UrlFetch/ngay cua Apps Script, du la hai script ID rieng biet. Moi project
// chi dem duoc request cua chinh no (Script Properties khong chia se giua
// hai script ID), nen ngan sach mac dinh o day PHAI bao thu (khong phai toan
// bo 20.000) de luon con phan cho project kia. Chinh qua Script Property
// KIOTVIET_URLFETCH_DAILY_BUDGET neu can, khong can sua code.
//
// Khi vuot quota UrlFetch trong ngay, Apps Script NEM EXCEPTION ngay tai lenh
// goi UrlFetchApp.fetch()/fetchAll() (khong phai mot HTTP status code), nen
// muteHttpExceptions khong che duoc loi nay - moi noi goi UrlFetch deu phai
// bat loi va nhan dien qua chuoi thong diep.

const KIOTVIET_QUOTA_TIME_ZONE_ = 'Asia/Ho_Chi_Minh';
const KIOTVIET_URLFETCH_COUNT_PREFIX_ = 'KIOTVIET_URLFETCH_COUNT_';
const KIOTVIET_QUOTA_TRIP_COUNT_PREFIX_ = 'KIOTVIET_QUOTA_TRIP_COUNT_';
const KIOTVIET_URLFETCH_DAILY_BUDGET_PROPERTY_ = 'KIOTVIET_URLFETCH_DAILY_BUDGET';
const KIOTVIET_URLFETCH_DEFAULT_DAILY_BUDGET_ = 8000;
const KIOTVIET_QUOTA_PAUSE_UNTIL_PROPERTY_ = 'KIOTVIET_QUOTA_PAUSE_UNTIL';
// Leo thang trong cung mot ngay: lan trip 1 -> 1 gio, lan 2 -> 2 gio,
// lan 3 tro di -> giu nguyen 3 gio (khong leo vo han).
const KIOTVIET_QUOTA_BACKOFF_TIERS_MS_ = Object.freeze([
  60 * 60 * 1000,
  2 * 60 * 60 * 1000,
  3 * 60 * 60 * 1000
]);
const KIOTVIET_QUOTA_PAUSED_ERROR_PREFIX_ = 'KIOTVIET_QUOTA_PAUSED:';

function kiotVietQuotaDayKey_(now) {
  return Utilities.formatDate(now || new Date(), KIOTVIET_QUOTA_TIME_ZONE_, 'yyyyMMdd');
}

/** Tang bo dem UrlFetch uoc luong trong ngay. Goi truoc/khi thuc hien lenh goi thuc te. */
function recordKiotVietQuotaUsage_(count, now) {
  const amount = Number(count) > 0 ? Math.floor(Number(count)) : 1;
  const props = PropertiesService.getScriptProperties();
  const key = KIOTVIET_URLFETCH_COUNT_PREFIX_ + kiotVietQuotaDayKey_(now);
  const current = (Number(props.getProperty(key)) || 0) + amount;
  props.setProperty(key, String(current));
  return current;
}

function getKiotVietQuotaUsageToday_(now) {
  const props = PropertiesService.getScriptProperties();
  const key = KIOTVIET_URLFETCH_COUNT_PREFIX_ + kiotVietQuotaDayKey_(now);
  return Number(props.getProperty(key)) || 0;
}

function getKiotVietQuotaDailyBudget_() {
  const configured = Number(
    PropertiesService.getScriptProperties().getProperty(KIOTVIET_URLFETCH_DAILY_BUDGET_PROPERTY_)
  );
  return configured > 0 ? configured : KIOTVIET_URLFETCH_DEFAULT_DAILY_BUDGET_;
}

function isKiotVietQuotaBudgetExceeded_(now) {
  return getKiotVietQuotaUsageToday_(now) >= getKiotVietQuotaDailyBudget_();
}

/** Nhan dien dung loi quota that su cua Apps Script/Google, khong phai loi HTTP 4xx/5xx thong thuong. */
function isKiotVietQuotaExceededError_(error) {
  if (!error) return false;
  const message = String((error && (error.message || error.toString())) || '').toLowerCase();
  return message.indexOf('too many times for one day') !== -1 && message.indexOf('urlfetch') !== -1;
}

/** Nhan dien loi do chinh ensureKiotVietQuotaAvailable_ chu dong tao ra (chan truoc khi goi UrlFetch). */
function isKiotVietQuotaPausedSelfError_(error) {
  if (!error) return false;
  const message = String((error && (error.message || error.toString())) || '');
  return message.indexOf(KIOTVIET_QUOTA_PAUSED_ERROR_PREFIX_) !== -1;
}

/** Gop ca hai loai loi lien quan quota - dung o noi can quyet dinh "hoan lai, khong tinh vao so lan thu". */
function isKiotVietQuotaRelatedError_(error) {
  return isKiotVietQuotaExceededError_(error) || isKiotVietQuotaPausedSelfError_(error);
}

/** Bat cau dao: ghi moc thoi gian tam dung, leo thang backoff theo so lan trip trong ngay. */
function tripKiotVietQuotaBreaker_(reason, now) {
  now = now || new Date();
  const props = PropertiesService.getScriptProperties();
  const tripCountKey = KIOTVIET_QUOTA_TRIP_COUNT_PREFIX_ + kiotVietQuotaDayKey_(now);
  const tripCount = (Number(props.getProperty(tripCountKey)) || 0) + 1;
  props.setProperty(tripCountKey, String(tripCount));

  const tierIndex = Math.min(tripCount, KIOTVIET_QUOTA_BACKOFF_TIERS_MS_.length) - 1;
  const backoffMs = KIOTVIET_QUOTA_BACKOFF_TIERS_MS_[tierIndex];
  const pauseUntil = new Date(now.getTime() + backoffMs);
  props.setProperty(KIOTVIET_QUOTA_PAUSE_UNTIL_PROPERTY_, pauseUntil.toISOString());

  Logger.log(
    'KIOTVIET QUOTA BREAKER: tam dung goi API toi ' + pauseUntil.toISOString() +
    ' (lan trip thu ' + tripCount + ' trong ngay, backoff ' +
    Math.round(backoffMs / 60000) + ' phut). Ly do: ' + reason
  );
  return { tripCount: tripCount, pauseUntil: pauseUntil };
}

function isKiotVietQuotaPaused_(now) {
  now = now || new Date();
  const pauseUntilRaw = PropertiesService.getScriptProperties()
    .getProperty(KIOTVIET_QUOTA_PAUSE_UNTIL_PROPERTY_);
  if (!pauseUntilRaw) return false;
  const pauseUntil = new Date(pauseUntilRaw);
  if (isNaN(pauseUntil.getTime())) return false;
  return now.getTime() < pauseUntil.getTime();
}

/**
 * Goi truoc moi lenh UrlFetchApp.fetch/fetchAll thuc te. Neu dang tam dung
 * hoac da cham ngan sach uoc luong trong ngay, nem loi ngay - khong tieu them
 * mot request thuc te nao (chinh request do co the la giot lam tran quota).
 */
function ensureKiotVietQuotaAvailable_(now) {
  now = now || new Date();
  if (isKiotVietQuotaPaused_(now)) {
    throw new Error(
      KIOTVIET_QUOTA_PAUSED_ERROR_PREFIX_ +
      ' dang tam dung goi KiotViet API do het quota UrlFetch, se tu dong thu lai sau khi het backoff.'
    );
  }
  if (isKiotVietQuotaBudgetExceeded_(now)) {
    tripKiotVietQuotaBreaker_(
      'Da dung uoc luong ngan sach UrlFetch trong ngay cua project (KIOTVIET_URLFETCH_DAILY_BUDGET).',
      now
    );
    throw new Error(
      KIOTVIET_QUOTA_PAUSED_ERROR_PREFIX_ +
      ' da cham nguong ngan sach UrlFetch uoc luong trong ngay, tam dung de danh phan cho webhook.'
    );
  }
}

/** Mo lai cau dao thu cong (dung trong test, hoac khi van hanh da xac nhan quota da hoi phuc som hon backoff). */
function resetKiotVietQuotaBreaker_() {
  PropertiesService.getScriptProperties().deleteProperty(KIOTVIET_QUOTA_PAUSE_UNTIL_PROPERTY_);
  Logger.log('Da xoa trang thai tam dung cua Quota Guard.');
}
