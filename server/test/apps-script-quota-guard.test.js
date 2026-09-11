'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');

function loadAppsScript(files, globals = {}) {
  const context = vm.createContext({
    console,
    Logger: { log() {} },
    ...globals
  });

  for (const file of files) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    vm.runInContext(source, context, { filename: file });
  }
  return context;
}

function createPropertiesStore(initial = {}) {
  const properties = Object.assign({}, initial);
  return {
    properties,
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(name) {
            return Object.prototype.hasOwnProperty.call(properties, name) ? properties[name] : null;
          },
          setProperty(name, value) { properties[name] = String(value); },
          deleteProperty(name) { delete properties[name]; }
        };
      }
    }
  };
}

function loadQuotaGuard(initialProperties) {
  const store = createPropertiesStore(initialProperties);
  const context = loadAppsScript(
    ['src-dashboard/kiotviet/QuotaGuard.gs'],
    {
      PropertiesService: store.PropertiesService,
      Utilities: {
        formatDate(date, timezone, format) {
          // Chi can nhat quan trong test: khoa theo ngay UTC yyyyMMdd.
          const year = date.getUTCFullYear();
          const month = String(date.getUTCMonth() + 1).padStart(2, '0');
          const day = String(date.getUTCDate()).padStart(2, '0');
          return `${year}${month}${day}`;
        }
      }
    }
  );
  return { context, properties: store.properties };
}

describe('QuotaGuard: bo dem UrlFetch va ngan sach uoc luong', () => {
  it('chua tung ghi nhan request nao thi ngan sach chua vuot', () => {
    const { context } = loadQuotaGuard();
    assert.equal(context.getKiotVietQuotaUsageToday_(new Date('2026-09-11T02:00:00Z')), 0);
    assert.equal(context.isKiotVietQuotaBudgetExceeded_(new Date('2026-09-11T02:00:00Z')), false);
  });

  it('cong don so luong request khi hydrate theo lo (fetchAll) tang nhieu hon 1', () => {
    const { context } = loadQuotaGuard();
    const now = new Date('2026-09-11T02:00:00Z');
    context.recordKiotVietQuotaUsage_(5, now);
    context.recordKiotVietQuotaUsage_(3, now);
    assert.equal(context.getKiotVietQuotaUsageToday_(now), 8);
  });

  it('bao vuot ngan sach ngay khi so dem cham nguong KIOTVIET_URLFETCH_DAILY_BUDGET', () => {
    const { context } = loadQuotaGuard({ KIOTVIET_URLFETCH_DAILY_BUDGET: '10' });
    const now = new Date('2026-09-11T02:00:00Z');
    context.recordKiotVietQuotaUsage_(10, now);
    assert.equal(context.isKiotVietQuotaBudgetExceeded_(now), true);
  });

  it('sang ngay moi thi bo dem request tu dong ve 0 (khoa theo ngay)', () => {
    const { context } = loadQuotaGuard();
    context.recordKiotVietQuotaUsage_(500, new Date('2026-09-11T20:00:00Z'));
    assert.equal(context.getKiotVietQuotaUsageToday_(new Date('2026-09-11T20:00:00Z')), 500);
    assert.equal(context.getKiotVietQuotaUsageToday_(new Date('2026-09-12T01:00:00Z')), 0);
  });
});

describe('QuotaGuard: nhan dien loi quota that su', () => {
  it('nhan dien dung thong diep loi urlfetch qua ngay cua Apps Script', () => {
    const { context } = loadQuotaGuard();
    const realError = new Error(
      'Service invoked too many times for one day: urlfetch. Try again after some time.'
    );
    assert.equal(context.isKiotVietQuotaExceededError_(realError), true);
  });

  it('khong nham loi HTTP 4xx/5xx thong thuong voi loi quota', () => {
    const { context } = loadQuotaGuard();
    const httpError = new Error('HTTP 500 tu KiotViet API (products): Internal Server Error');
    assert.equal(context.isKiotVietQuotaExceededError_(httpError), false);
    assert.equal(context.isKiotVietQuotaExceededError_(new Error('HTTP 429 tu KiotViet API')), false);
  });

  it('nhan dien loi tu chinh QuotaGuard tao ra, ke ca khi bi boc trong mot loi khac', () => {
    const { context } = loadQuotaGuard();
    const wrapped = new Error(
      'Loi lay chi tiet products: Error: KIOTVIET_QUOTA_PAUSED: dang tam dung goi KiotViet API do het quota UrlFetch.'
    );
    assert.equal(context.isKiotVietQuotaPausedSelfError_(wrapped), true);
    assert.equal(context.isKiotVietQuotaRelatedError_(wrapped), true);
    assert.equal(context.isKiotVietQuotaExceededError_(wrapped), false);
  });
});

describe('QuotaGuard: cau dao tam dung va backoff leo thang', () => {
  it('chua tung trip thi khong bi tam dung', () => {
    const { context } = loadQuotaGuard();
    assert.equal(context.isKiotVietQuotaPaused_(new Date('2026-09-11T02:00:00Z')), false);
  });

  it('sau khi trip lan dau, tam dung dung 1 gio roi tu dong het han', () => {
    const { context } = loadQuotaGuard();
    const tripAt = new Date('2026-09-11T02:00:00Z');
    context.tripKiotVietQuotaBreaker_('test', tripAt);

    assert.equal(context.isKiotVietQuotaPaused_(new Date('2026-09-11T02:59:59Z')), true);
    assert.equal(context.isKiotVietQuotaPaused_(new Date('2026-09-11T03:00:01Z')), false);
  });

  it('leo thang backoff 1h -> 2h -> 3h cho cac lan trip lien tiep trong cung mot ngay', () => {
    const { context } = loadQuotaGuard();
    const base = new Date('2026-09-11T02:00:00Z');

    const first = context.tripKiotVietQuotaBreaker_('lan 1', base);
    assert.equal(first.pauseUntil.getTime() - base.getTime(), 60 * 60 * 1000);

    const second = context.tripKiotVietQuotaBreaker_('lan 2', base);
    assert.equal(second.pauseUntil.getTime() - base.getTime(), 2 * 60 * 60 * 1000);

    const third = context.tripKiotVietQuotaBreaker_('lan 3', base);
    assert.equal(third.pauseUntil.getTime() - base.getTime(), 3 * 60 * 60 * 1000);

    const fourth = context.tripKiotVietQuotaBreaker_('lan 4', base);
    assert.equal(fourth.pauseUntil.getTime() - base.getTime(), 3 * 60 * 60 * 1000);
  });

  it('sang ngay moi thi so lan trip reset, lan trip dau tien cua ngay moi lai la 1 gio', () => {
    const { context } = loadQuotaGuard();
    const day1 = new Date('2026-09-11T23:00:00Z');
    context.tripKiotVietQuotaBreaker_('lan 1 ngay 1', day1);
    context.tripKiotVietQuotaBreaker_('lan 2 ngay 1', day1);

    const day2 = new Date('2026-09-12T01:00:00Z');
    const firstOfNewDay = context.tripKiotVietQuotaBreaker_('lan 1 ngay 2', day2);
    assert.equal(firstOfNewDay.pauseUntil.getTime() - day2.getTime(), 60 * 60 * 1000);
  });

  it('resetKiotVietQuotaBreaker_ mo lai ngay lap tuc du dang trong thoi gian backoff', () => {
    const { context } = loadQuotaGuard();
    const now = new Date('2026-09-11T02:00:00Z');
    context.tripKiotVietQuotaBreaker_('test', now);
    assert.equal(context.isKiotVietQuotaPaused_(now), true);

    context.resetKiotVietQuotaBreaker_();
    assert.equal(context.isKiotVietQuotaPaused_(now), false);
  });
});

describe('QuotaGuard: ensureKiotVietQuotaAvailable_ chan chu dong truoc khi goi UrlFetch', () => {
  it('khong nem loi khi chua tam dung va chua vuot ngan sach', () => {
    const { context } = loadQuotaGuard();
    assert.doesNotThrow(() => context.ensureKiotVietQuotaAvailable_(new Date('2026-09-11T02:00:00Z')));
  });

  it('nem loi nhan dien duoc khi dang trong thoi gian tam dung', () => {
    const { context } = loadQuotaGuard();
    const now = new Date('2026-09-11T02:00:00Z');
    context.tripKiotVietQuotaBreaker_('test', now);

    assert.throws(
      () => context.ensureKiotVietQuotaAvailable_(now),
      error => context.isKiotVietQuotaPausedSelfError_(error)
    );
  });

  it('tu trip cau dao va nem loi khi bo dem da cham ngan sach uoc luong, du chua tam dung truoc do', () => {
    const { context, properties } = loadQuotaGuard({ KIOTVIET_URLFETCH_DAILY_BUDGET: '5' });
    const now = new Date('2026-09-11T02:00:00Z');
    context.recordKiotVietQuotaUsage_(5, now);

    assert.equal(context.isKiotVietQuotaPaused_(now), false);
    assert.throws(
      () => context.ensureKiotVietQuotaAvailable_(now),
      error => context.isKiotVietQuotaPausedSelfError_(error)
    );
    assert.equal(context.isKiotVietQuotaPaused_(now), true);
    assert.ok(properties.KIOTVIET_QUOTA_PAUSE_UNTIL);
  });
});

function createUtilitiesMock() {
  return {
    sleep() {},
    formatDate(date, timezone, format) {
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const day = String(date.getUTCDate()).padStart(2, '0');
      return `${year}${month}${day}`;
    }
  };
}

describe('QuotaGuard: fetchKiotVietJsonWithRetry_ (SheetSchemas.gs) tuan thu cau dao', () => {
  function load(initialProperties, urlFetchApp) {
    const store = createPropertiesStore(Object.assign({ KIOTVIET_RETAILER: 'CHhanoi' }, initialProperties));
    return loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/QuotaGuard.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs'
    ], {
      PropertiesService: store.PropertiesService,
      Utilities: createUtilitiesMock(),
      UrlFetchApp: urlFetchApp
    });
  }

  it('dang tam dung thi nem loi ngay, khong goi UrlFetchApp.fetch lan nao', () => {
    let fetchCalls = 0;
    const context = load(
      { KIOTVIET_QUOTA_PAUSE_UNTIL: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
      { fetch() { fetchCalls++; return { getResponseCode: () => 200, getContentText: () => '{}' }; } }
    );

    assert.throws(
      () => context.fetchKiotVietJsonWithRetry_('https://public.kiotapi.com/products', 'token', 'products'),
      error => context.isKiotVietQuotaPausedSelfError_(error)
    );
    assert.equal(fetchCalls, 0);
  });

  it('khi UrlFetchApp nem dung loi quota that su, bat cau dao va dung ngay khong thu lai 5 lan', () => {
    let fetchCalls = 0;
    const context = load({}, {
      fetch() {
        fetchCalls++;
        throw new Error('Service invoked too many times for one day: urlfetch.');
      }
    });

    assert.throws(() => context.fetchKiotVietJsonWithRetry_(
      'https://public.kiotapi.com/products', 'token', 'products'
    ));
    assert.equal(fetchCalls, 1, 'khong duoc thu lai sau khi da xac nhan la loi quota that su');
    assert.equal(context.isKiotVietQuotaPaused_(new Date()), true);
  });

  it('loi HTTP 500 thong thuong van thu lai nhu cu, khong bat cau dao', () => {
    let fetchCalls = 0;
    const context = load({}, {
      fetch() {
        fetchCalls++;
        return { getResponseCode: () => 500, getContentText: () => 'Internal Server Error' };
      }
    });

    assert.throws(() => context.fetchKiotVietJsonWithRetry_(
      'https://public.kiotapi.com/products', 'token', 'products'
    ));
    assert.equal(fetchCalls, 5, 'loi 5xx van giu nguyen toi da 5 lan thu nhu truoc');
    assert.equal(context.isKiotVietQuotaPaused_(new Date()), false);
  });

  it('goi thanh cong van ghi nhan dung 1 request vao bo dem quota', () => {
    const store = createPropertiesStore({ KIOTVIET_RETAILER: 'CHhanoi' });
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/QuotaGuard.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs'
    ], {
      PropertiesService: store.PropertiesService,
      Utilities: createUtilitiesMock(),
      UrlFetchApp: {
        fetch() {
          return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ total: 0, data: [] }) };
        }
      }
    });

    context.fetchKiotVietJsonWithRetry_('https://public.kiotapi.com/products', 'token', 'products');
    assert.equal(context.getKiotVietQuotaUsageToday_(new Date()), 1);
  });
});

describe('QuotaGuard: getKiotVietToken (Auth.gs) tuan thu cau dao', () => {
  function load(initialProperties, urlFetchApp, cacheGet) {
    const store = createPropertiesStore(Object.assign({
      KIOTVIET_CLIENT_ID: 'id',
      KIOTVIET_CLIENT_SECRET: 'secret'
    }, initialProperties));
    return loadAppsScript([
      'src-dashboard/kiotviet/QuotaGuard.gs',
      'src-dashboard/kiotviet/Auth.gs'
    ], {
      PropertiesService: store.PropertiesService,
      Utilities: createUtilitiesMock(),
      UrlFetchApp: urlFetchApp,
      CacheService: {
        getScriptCache() {
          return {
            get: cacheGet || (() => null),
            put() {}
          };
        }
      }
    });
  }

  it('dang tam dung thi nem loi ngay, khong goi UrlFetchApp.fetch lan nao', () => {
    let fetchCalls = 0;
    const context = load(
      { KIOTVIET_QUOTA_PAUSE_UNTIL: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
      { fetch() { fetchCalls++; return { getResponseCode: () => 200, getContentText: () => '{}' }; } }
    );

    assert.throws(
      () => context.getKiotVietToken(),
      error => context.isKiotVietQuotaPausedSelfError_(error)
    );
    assert.equal(fetchCalls, 0);
  });

  it('token da co trong cache thi khong bi cau dao chan (khong goi UrlFetch)', () => {
    let fetchCalls = 0;
    const context = load(
      { KIOTVIET_QUOTA_PAUSE_UNTIL: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
      { fetch() { fetchCalls++; return { getResponseCode: () => 200, getContentText: () => '{}' }; } },
      () => 'cached-token'
    );

    assert.equal(context.getKiotVietToken(), 'cached-token');
    assert.equal(fetchCalls, 0);
  });

  it('khi UrlFetchApp nem dung loi quota that su, bat cau dao va dung ngay', () => {
    let fetchCalls = 0;
    const context = load({}, {
      fetch() {
        fetchCalls++;
        throw new Error('Service invoked too many times for one day: urlfetch.');
      }
    });

    assert.equal(context.getKiotVietToken(), null);
    assert.equal(fetchCalls, 1);
    assert.equal(context.isKiotVietQuotaPaused_(new Date()), true);
  });
});

describe('QuotaGuard: fetchCustomerReportJsonWithRetry_ (CustomerReport.gs) tuan thu cau dao', () => {
  function load(initialProperties, urlFetchApp) {
    const store = createPropertiesStore(Object.assign({ KIOTVIET_RETAILER: 'CHhanoi' }, initialProperties));
    return loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/kiotviet/QuotaGuard.gs',
      'src-dashboard/kiotviet/CustomerReport.gs'
    ], {
      PropertiesService: store.PropertiesService,
      Utilities: createUtilitiesMock(),
      UrlFetchApp: urlFetchApp
    });
  }

  it('dang tam dung thi nem loi ngay, khong goi UrlFetchApp.fetch lan nao', () => {
    let fetchCalls = 0;
    const context = load(
      { KIOTVIET_QUOTA_PAUSE_UNTIL: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
      { fetch() { fetchCalls++; return { getResponseCode: () => 200, getContentText: () => '{"data":[]}' }; } }
    );

    assert.throws(
      () => context.fetchCustomerReportJsonWithRetry_('https://public.kiotapi.com/customers', 'token', 'customers'),
      error => context.isKiotVietQuotaPausedSelfError_(error)
    );
    assert.equal(fetchCalls, 0);
  });

  it('khi UrlFetchApp nem dung loi quota that su, bat cau dao va dung ngay khong thu lai 5 lan', () => {
    let fetchCalls = 0;
    const context = load({}, {
      fetch() {
        fetchCalls++;
        throw new Error('Service invoked too many times for one day: urlfetch.');
      }
    });

    assert.throws(() => context.fetchCustomerReportJsonWithRetry_(
      'https://public.kiotapi.com/customers', 'token', 'customers'
    ));
    assert.equal(fetchCalls, 1);
    assert.equal(context.isKiotVietQuotaPaused_(new Date()), true);
  });
});

describe('QuotaGuard: hydrateKiotVietItems_ (UpdateHandlers.gs) tuan thu cau dao', () => {
  function load(initialProperties, urlFetchApp) {
    const store = createPropertiesStore(Object.assign({ KIOTVIET_RETAILER: 'CHhanoi' }, initialProperties));
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/QuotaGuard.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs',
      'src-dashboard/sync/UpdateHandlers.gs'
    ], {
      PropertiesService: store.PropertiesService,
      Utilities: createUtilitiesMock(),
      UrlFetchApp: urlFetchApp,
      LockService: {
        getDocumentLock() { return null; },
        getScriptLock() { return {}; }
      }
    });
    context.getKiotVietToken = () => 'fake-token';
    return context;
  }

  function productsSchema(context) {
    // KIOTVIET_SHEET_SCHEMAS la khai bao top-level bang const trong Apps
    // Script goc, nen vm.createContext khong dua no thanh thuoc tinh cua
    // context object - phai doc lai bang vm.runInContext.
    return vm.runInContext('KIOTVIET_SHEET_SCHEMAS.products', context);
  }

  it('dang tam dung thi nem loi ngay, khong goi UrlFetchApp.fetchAll lan nao', () => {
    let fetchAllCalls = 0;
    const context = load(
      { KIOTVIET_QUOTA_PAUSE_UNTIL: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
      { fetchAll(requests) { fetchAllCalls++; return requests.map(() => ({ getResponseCode: () => 200, getContentText: () => '{}' })); } }
    );

    assert.throws(
      () => context.hydrateKiotVietItems_([{ Id: 1 }], productsSchema(context)),
      error => context.isKiotVietQuotaPausedSelfError_(error)
    );
    assert.equal(fetchAllCalls, 0);
  });

  it('khi UrlFetchApp.fetchAll nem dung loi quota that su, bat cau dao', () => {
    const context = load({}, {
      fetchAll() {
        throw new Error('Service invoked too many times for one day: urlfetch.');
      }
    });

    assert.throws(
      () => context.hydrateKiotVietItems_([{ Id: 1 }], productsSchema(context)),
      error => context.isKiotVietQuotaRelatedError_(error)
    );
    assert.equal(context.isKiotVietQuotaPaused_(new Date()), true);
  });

  it('goi fetchAll thanh cong ghi nhan dung so luong request bang so item can hydrate', () => {
    const context = load({}, {
      fetchAll(requests) {
        return requests.map(() => ({
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify({ data: { Id: 1, Code: 'SP1' } })
        }));
      }
    });

    context.hydrateKiotVietItems_(
      [{ Id: 1, Code: 'SP1' }, { Id: 2, Code: 'SP2' }, { Id: 3, Code: 'SP3' }],
      productsSchema(context)
    );

    assert.equal(context.getKiotVietQuotaUsageToday_(new Date()), 3);
  });
});
