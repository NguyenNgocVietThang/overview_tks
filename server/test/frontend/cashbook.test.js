"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const file = path.join(__dirname, "../../public/cashbook/index.html");
const html = fs.existsSync(file)
  ? fs.readFileSync(file, "utf8")
  : "<html></html>";
const tick = () => new Promise((resolve) => setImmediate(resolve));
const summary = {
  balances: [
    {
      fund: "-1",
      accountId: "-1",
      name: "Bank cũ",
      accountNo: "001",
      description: "",
      balance: -1234.5,
      checkpointAt: "2026-10-01T00:00:00Z",
    },
    {
      fund: "cash",
      accountId: null,
      name: "Tiền mặt",
      accountNo: "",
      description: "",
      balance: null,
      checkpointAt: null,
    },
  ],
  totalBalance: -1234.5,
  unclosedCount: 1,
  kpis: {
    openingBalance: null,
    totalReceipts: 10,
    totalPayments: 20,
    closingBalance: null,
  },
  syncedAt: "2026-10-05T18:30:00Z",
};
const entries = {
  entries: [
    {
      id: "1",
      branch: "hanoi",
      code: "<img src=x>",
      transDate: "2026-10-05T18:30:00Z",
      docType: "payment",
      group: "Khác",
      partnerName: "Alice",
      partnerPhone: "123",
      fund: "-1",
      fundName: "Bank cũ",
      creatorName: "Lan",
      staffName: "Lan",
      amount: -10,
      runningBalance: -1234.5,
      status: "paid",
      note: "",
    },
  ],
  total: 201,
  page: 1,
  pageSize: 100,
  totalPages: 3,
  runningBalanceAvailable: false,
  runningBalanceReason: "Chọn một quỹ đã chốt và không thu hẹp bộ lọc.",
};
const options = {
  funds: summary.balances.map(({ balance, checkpointAt, ...fund }) => fund),
  groups: [{ key: "name:Chi%20kh%C3%A1c", label: "Chi khác" }],
  creators: [{ id: "9", label: "Lan" }],
  staff: [{ id: "9", label: "Lan" }],
  supportedFilters: {
    debt: false,
    partnerType: false,
    partnerCode: false,
    partnerName: true,
    partnerId: true,
    partnerPhone: true,
  },
};
async function setup(t, { hash = "", manage = false, fetcher } = {}) {
  const dom = new JSDOM(html, {
    url: "https://tokosi.test/cashbook/" + hash,
    runScripts: "outside-only",
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.TKSNav = {
    authGuard: async () => ({
      permissions: ["cashbook.view", ...(manage ? ["cashbook.manage"] : [])],
    }),
    can: (key) =>
      key === "cashbook.view" || (manage && key === "cashbook.manage"),
  };
  w.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
    this.dispatchEvent(new w.Event("close"));
  };
  const calls = [];
  w.fetch = async (url, init = {}) => {
    const parsed = new URL(url, w.location.href);
    calls.push({ url: parsed, init });
    if (fetcher) {
      const answer = await fetcher(parsed, init);
      if (answer) return answer;
    }
    const data = parsed.pathname.endsWith("filter-options")
      ? options
      : parsed.pathname.endsWith("summary")
        ? summary
        : parsed.pathname.endsWith("entries")
          ? { ...entries, page: +(parsed.searchParams.get("page") || 1) }
          : {
              checkpoints: [],
              total: 0,
              page: 1,
              pageSize: 100,
              totalPages: 0,
            };
    return { ok: true, json: async () => data };
  };
  const script = w.document.getElementById("cashbook-script");
  if (script) w.eval(script.textContent);
  assert.ok(
    w.TKSCashbook,
    "Trang phải cung cấp logic Sổ quỹ để kiểm thử từ HTML",
  );
  return {
    w,
    doc: w.document,
    api: w.TKSCashbook,
    calls,
    init: () => w.TKSCashbook.init(),
  };
}

test("tiền null khác số 0, dấu âm và chuỗi thập phân giữ chính xác", async (t) => {
  const { api } = await setup(t);
  assert.equal(api.money(null), "Chưa chốt");
  assert.equal(api.money(0), "0");
  assert.equal(api.money(-1234567.5), "-1.234.567,5");
  assert.equal(api.money(1e-21), "0,000000000000000000001");
  assert.equal(
    api.money("9007199254740990.123456789"),
    "9.007.199.254.740.990,123456789",
  );
});
test("query giữ danh sách rỗng và quỹ -1, mã nhóm không bị decode hai lần", async (t) => {
  const { api, w } = await setup(t);
  const p = new w.URLSearchParams(
    api.query({
      fund: "-1",
      preset: "thisMonth",
      docTypes: [],
      groups: ["name:Chi%20kh%C3%A1c"],
      staff: [],
      partnerQ: "Lan & #9",
    }),
  );
  assert.equal(p.get("fund"), "-1");
  assert.equal(p.get("docTypes"), "");
  assert.equal(p.get("staff"), "");
  assert.equal(p.get("groups"), "name:Chi%20kh%C3%A1c");
  assert.equal(p.get("partnerQ"), "Lan & #9");
  assert.equal(p.has("creators"), false);
});
test("query ngày tùy chỉnh loại bỏ preset và không gửi khóa không hỗ trợ", async (t) => {
  const { api, w } = await setup(t);
  const p = new w.URLSearchParams(
    api.query({
      preset: "custom",
      from: "2026-10-01",
      to: "2026-10-06",
      debt: "all",
      partnerType: "customer",
      partnerCode: "K1",
    }),
  );
  assert.equal(p.get("from"), "2026-10-01");
  assert.equal(p.get("to"), "2026-10-06");
  for (const k of ["preset", "debt", "partnerType", "partnerCode"])
    assert.equal(p.has(k), false);
});
test("hash roundtrip phân biệt empty và default khi F5", async (t) => {
  const { api } = await setup(t);
  const f = api.readHash(
    "#fund=&docTypes=&statuses=&staff=&partnerQ=Lan%20%26%20Hoa",
  );
  assert.equal(f.fund, "");
  assert.equal(f.docTypes.length, 0);
  assert.equal(f.staff.length, 0);
  const round = api.readHash(api.writeHash(f));
  assert.equal(round.statuses.length, 0);
  assert.equal(round.partnerQ, "Lan & Hoa");
  assert.equal(api.readHash("").fund, "all");
  assert.equal(api.readHash("").preset, "thisYear");
  assert.equal(Object.hasOwn(api.readHash(""), "staff"), false);
});
test("ngày VN và datetime-local độc lập múi giờ máy khách", async (t) => {
  const { api } = await setup(t);
  assert.equal(api.vnLocal("2026-10-05T18:30:15.123Z"), "2026-10-06T01:30:15");
  assert.equal(
    api.checkpointIso("2026-10-06T01:30:15", new Date("2026-10-06T04:00:00Z")),
    "2026-10-05T18:30:15.000Z",
  );
  assert.match(api.dateText("2026-10-05T18:30:15Z"), /06\/10\/2026/);
  assert.throws(
    () =>
      api.checkpointIso(
        "2026-10-06T11:00:01",
        new Date("2026-10-06T04:00:00Z"),
      ),
    /tương lai/,
  );
});
test("ô nhập nhóm hàng nghìn dùng comma và không làm tròn chuỗi số đã nhập", async (t) => {
  const { api } = await setup(t);
  assert.equal(api.groupAmount("-1234567.0123456789"), "-1,234,567.0123456789");
  assert.equal(api.amountText("-1,234,567.0123456789"), "-1234567.0123456789");
  assert.throws(() => api.amountText("abc"), /số/);
});
test("lũy kế chỉ hiện khi server cho phép, một quỹ và đủ hai chứng từ", async (t) => {
  const { api } = await setup(t);
  const row = { runningBalance: 10 };
  assert.equal(
    api.runningText(row, { runningBalanceAvailable: true }, { fund: "-1" }),
    "10",
  );
  for (const f of [
    { fund: "all" },
    { fund: "bank" },
    { fund: "-1,7" },
    { fund: "-1", docTypes: [] },
    { fund: "-1", groups: [] },
    { fund: "-1", partnerQ: "Lan" },
  ])
    assert.equal(
      api.runningText(row, { runningBalanceAvailable: true }, f),
      "",
    );
  assert.equal(
    api.runningText(row, { runningBalanceAvailable: false }, { fund: "-1" }),
    "",
  );
  assert.equal(
    api.runningText(
      { runningBalance: null },
      { runningBalanceAvailable: true },
      { fund: "-1" },
    ),
    "",
  );
});
test("khởi tạo render API thật, số chưa chốt, negative đỏ và text không thành HTML", async (t) => {
  const { init, doc } = await setup(t);
  await init();
  assert.match(doc.getElementById("balancesBody").textContent, /Chưa chốt/);
  assert.equal(
    doc.querySelector('#balancesBody [data-field="balance"]').textContent,
    "-1.234,5",
  );
  assert.ok(
    doc
      .querySelector('#balancesBody [data-field="balance"]')
      .classList.contains("negative"),
  );
  assert.match(
    doc.getElementById("balanceTotal").textContent,
    /1 quỹ chưa chốt/,
  );
  assert.equal(doc.querySelector("#entriesBody img"), null);
  assert.match(doc.getElementById("entriesBody").textContent, /<img src=x>/);
  assert.equal(
    doc.querySelector('#entriesBody [data-field="runningBalance"]').textContent,
    "",
  );
  assert.equal(doc.querySelector("[data-checkpoint]"), null);
});
test("click tài khoản lịch sử lọc đúng quỹ và giữ partner/hash; pager gọi server", async (t) => {
  const { init, doc, w, calls } = await setup(t, { hash: "#partnerQ=Lan" });
  await init();
  doc.querySelector('[data-select-fund="-1"]').click();
  await tick();
  assert.match(w.location.hash, /fund=-1/);
  assert.match(w.location.hash, /partnerQ=Lan/);
  doc.getElementById("entriesNext").click();
  await tick();
  const last = calls
    .filter((c) => c.url.pathname.endsWith("entries"))
    .at(-1).url;
  assert.equal(last.searchParams.get("page"), "2");
  assert.equal(last.searchParams.get("fund"), "-1");
});
test("bỏ tick hết gửi danh sách rỗng, reset khôi phục all mà không bóp ngân hàng -1", async (t) => {
  const { init, doc, w, calls } = await setup(t);
  await init();
  for (const input of doc.querySelectorAll('[name="docTypes"]')) {
    input.checked = false;
    input.dispatchEvent(new w.Event("change", { bubbles: true }));
  }
  await tick();
  assert.equal(
    calls
      .filter((c) => c.url.pathname.endsWith("entries"))
      .at(-1)
      .url.searchParams.get("docTypes"),
    "",
  );
  doc.getElementById("resetFilters").click();
  await tick();
  assert.equal(
    calls
      .filter((c) => c.url.pathname.endsWith("entries"))
      .at(-1)
      .url.searchParams.has("docTypes"),
    false,
  );
});
test("ô text debounce 300ms và hash ghi giá trị mới", async (t) => {
  const { init, doc, w, calls } = await setup(t);
  await init();
  const scheduled = new Map();
  let id = 0;
  w.setTimeout = (fn, ms) => {
    scheduled.set(++id, { fn, ms });
    return id;
  };
  w.clearTimeout = (value) => scheduled.delete(value);
  doc.querySelector('[data-search-mode="partner"]').click();
  const before = calls.length,
    input = doc.getElementById("entriesSearch");
  input.value = "L";
  input.dispatchEvent(new w.Event("input", { bubbles: true }));
  input.value = "Lan";
  input.dispatchEvent(new w.Event("input", { bubbles: true }));
  assert.equal(calls.length, before);
  assert.equal(scheduled.size, 1);
  const job = [...scheduled.values()][0];
  assert.equal(job.ms, 300);
  job.fn();
  await tick();
  assert.match(w.location.hash, /partnerQ=Lan/);
});
test("response bộ lọc cũ không ghi đè khi response mới đã hiện", async (t) => {
  let release;
  const { init, doc, w } = await setup(t, {
    fetcher: async (url) => {
      if (
        url.pathname.endsWith("summary") &&
        url.searchParams.get("fund") === "-1"
      )
        return new Promise((resolve) => {
          release = resolve;
        });
      if (
        url.pathname.endsWith("summary") &&
        url.searchParams.get("fund") === "cash"
      )
        return {
          ok: true,
          json: async () => ({ ...summary, balances: [summary.balances[1]] }),
        };
    },
  });
  await init();
  doc.querySelector('[data-select-fund="-1"]').click();
  await tick();
  const cash = doc.querySelector('[name="fundMode"][value="cash"]');
  cash.checked = true;
  cash.dispatchEvent(new w.Event("change", { bubbles: true }));
  await tick();
  release({ ok: true, json: async () => summary });
  await tick();
  assert.doesNotMatch(
    doc.getElementById("balancesBody").textContent,
    /Bank cũ/,
  );
});
test("lỗi API hiển thị tiếng Việt và giữ bộ lọc để thử lại", async (t) => {
  const { init, doc, w } = await setup(t, {
    hash: "#fund=-1&partnerPhone=123",
    fetcher: async (url) =>
      url.pathname.endsWith("entries")
        ? {
            ok: false,
            status: 500,
            json: async () => ({
              error: "Lỗi hệ thống, vui lòng thử lại sau.",
            }),
          }
        : null,
  });
  await init();
  assert.match(doc.getElementById("pageStatus").textContent, /Lỗi hệ thống/);
  assert.match(w.location.hash, /partnerPhone=123/);
  assert.equal(doc.getElementById("entriesSearch").value, "123");
  assert.equal(
    doc.querySelector('[data-search-mode="phone"]').getAttribute("aria-pressed"),
    "true",
  );
});
test("lỗi sau khi đổi bộ lọc không để số dư cũ dưới bộ lọc mới", async (t) => {
  const { init, doc, w } = await setup(t);
  await init();
  w.fetch = async () => ({
    ok: false,
    status: 500,
    json: async () => ({ error: "Lỗi hệ thống, vui lòng thử lại sau." }),
  });
  const cash = doc.querySelector('[name="fundMode"][value="cash"]');
  cash.checked = true;
  cash.dispatchEvent(new w.Event("change", { bubbles: true }));
  await tick();
  assert.doesNotMatch(
    doc.getElementById("balancesBody").textContent,
    /Bank cũ/,
  );
  assert.equal(doc.getElementById("totalReceipts").textContent, "—");
  assert.match(w.location.hash, /fund=cash/);
});
test("drawer và dialog đóng trả focus, Escape đóng drawer", async (t) => {
  const { init, doc, w } = await setup(t);
  await init();
  doc.getElementById("filterToggle").click();
  assert.equal(
    doc.getElementById("filterToggle").getAttribute("aria-expanded"),
    "true",
  );
  doc.dispatchEvent(
    new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  assert.equal(
    doc.getElementById("filterToggle").getAttribute("aria-expanded"),
    "false",
  );
  assert.equal(doc.activeElement.id, "filterToggle");
  const btn = doc.querySelector('[data-export="entries"]');
  btn.click();
  doc.getElementById("exportDialog").close();
  assert.equal(doc.activeElement, btn);
});
test("checkpoint preview dùng timestamp giây theo VN, first null giải thích số dư ban đầu", async (t) => {
  const { init, doc, w, calls } = await setup(t, { manage: true });
  await init();
  doc.querySelector('[data-checkpoint="cash"]').click();
  await tick();
  const input = doc.getElementById("checkpointAt");
  input.value = "2026-10-01T09:15:20";
  input.dispatchEvent(new w.Event("change", { bubbles: true }));
  await tick();
  const last = calls
    .filter(
      (c) => c.url.pathname.endsWith("summary") && c.url.searchParams.has("at"),
    )
    .at(-1).url;
  assert.equal(last.searchParams.get("at"), "2026-10-01T02:15:20.000Z");
  assert.equal(last.searchParams.get("fund"), "cash");
  assert.match(
    doc.getElementById("checkpointPreview").textContent,
    /số dư ban đầu/,
  );
  assert.doesNotMatch(
    doc.getElementById("checkpointPreview").textContent,
    /chênh lệch: 0/,
  );
});
test("lưu checkpoint giữ chuỗi thập phân, không gửi trước preview mới, chặn tương lai", async (t) => {
  const { init, doc, w, calls } = await setup(t, {
    manage: true,
    fetcher: async (url, request) =>
      request.method === "POST"
        ? { ok: true, json: async () => ({ checkpoint: { id: "1" } }) }
        : null,
  });
  await init();
  doc.querySelector('[data-checkpoint="-1"]').click();
  await tick();
  doc.getElementById("checkpointAt").value = "2026-10-01T09:15:20";
  doc
    .getElementById("checkpointAt")
    .dispatchEvent(new w.Event("change", { bubbles: true }));
  await tick();
  doc.getElementById("checkpointBalance").value = "1,234.0123456789";
  doc
    .getElementById("checkpointBalance")
    .dispatchEvent(new w.Event("input", { bubbles: true }));
  doc
    .getElementById("checkpointForm")
    .dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
  await tick();
  const post = calls.find((c) => c.init.method === "POST");
  assert.ok(post);
  assert.deepEqual(JSON.parse(post.init.body), {
    fund: "-1",
    checkpointAt: "2026-10-01T02:15:20.000Z",
    balance: "1234.0123456789",
    note: "",
  });
});
test("export tất cả cột mặc định, empty chặn, lựa chọn nhớ riêng từng bảng và loại file", async (t) => {
  const { init, doc, api } = await setup(t);
  await init();
  doc.querySelector('[data-export="balances"]').click();
  assert.equal(doc.querySelectorAll("#exportColumns input:checked").length, 4);
  for (const box of doc.querySelectorAll("#exportColumns input"))
    box.checked = false;
  doc
    .getElementById("exportColumns")
    .dispatchEvent(new doc.defaultView.Event("change", { bubbles: true }));
  assert.equal(doc.getElementById("exportDownload").disabled, true);
  doc.querySelector('#exportColumns input[value="name"]').checked = true;
  doc
    .getElementById("exportColumns")
    .dispatchEvent(new doc.defaultView.Event("change", { bubbles: true }));
  doc.getElementById("exportDialog").close();
  doc.querySelector('[data-export="entries"]').click();
  assert.equal(doc.querySelectorAll("#exportColumns input:checked").length, 14);
  doc.getElementById("exportDialog").close();
  doc.querySelector('[data-export="balances"]').click();
  assert.equal(doc.querySelectorAll("#exportColumns input:checked").length, 1);
  const url = new URL(
    api.exportUrl("balances", "html", ["name"], { fund: "-1", staff: [] }),
    "https://tokosi.test",
  );
  assert.equal(url.searchParams.get("format"), "html");
  assert.equal(url.searchParams.get("columns"), "name");
  assert.equal(url.searchParams.get("staff"), "");
  assert.equal(url.searchParams.has("page"), false);
});
test("datetime-local chuẩn hóa phần mili giây vẫn preview đúng thời điểm", async (t) => {
  const { api } = await setup(t);
  assert.equal(
    api.checkpointIso("2026-10-01T09:15:20.000"),
    "2026-10-01T02:15:20.000Z",
  );
  assert.equal(
    api.checkpointIso("2026-10-01T09:15:20.123"),
    "2026-10-01T02:15:20.123Z",
  );
});
test("preset radio và ngày tùy chỉnh phát query VN không kèm preset", async (t) => {
  const { init, doc, w, calls } = await setup(t);
  await init();
  const custom = doc.querySelector('[name="preset"][value="custom"]');
  assert.ok(custom && custom.type === "radio");
  custom.checked = true;
  custom.dispatchEvent(new w.Event("change", { bubbles: true }));
  await tick();
  doc.getElementById("from").value = "2026-10-01";
  doc
    .getElementById("from")
    .dispatchEvent(new w.Event("change", { bubbles: true }));
  await tick();
  const last = calls
    .filter((c) => c.url.pathname.endsWith("entries"))
    .at(-1).url;
  assert.equal(last.searchParams.has("preset"), false);
  assert.equal(last.searchParams.get("from"), "2026-10-01");
});
test("ngân hàng dùng ba radio chuẩn, chọn tài khoản và bỏ hết giữ bank mode rỗng", async (t) => {
  const { init, doc, w, calls } = await setup(t);
  await init();
  assert.deepEqual(
    [...doc.querySelectorAll('[name="fundMode"]')].map((input) => input.value),
    ["all", "cash", "bank"],
  );
  const bank = doc.querySelector('[name="fundMode"][value="bank"]');
  bank.checked = true;
  bank.dispatchEvent(new w.Event("change", { bubbles: true }));
  await tick();
  const historical = doc.querySelector('[name="fundAccounts"][value="-1"]');
  assert.equal(historical.checked, true);
  historical.checked = false;
  historical.dispatchEvent(new w.Event("change", { bubbles: true }));
  await tick();
  assert.equal(bank.checked, true);
  assert.equal(
    calls
      .filter((c) => c.url.pathname.endsWith("summary"))
      .at(-1)
      .url.searchParams.get("fund"),
    "",
  );
});
test("preview cũ không thay số mới; đang chờ hoặc thời điểm tương lai không gửi POST", async (t) => {
  let release;
  const { init, doc, w, calls } = await setup(t, {
    manage: true,
    fetcher: async (url) => {
      if (
        url.pathname.endsWith("summary") &&
        url.searchParams.get("at") === "2026-10-01T02:15:20.000Z"
      )
        return new Promise((resolve) => {
          release = resolve;
        });
    },
  });
  await init();
  doc.querySelector('[data-checkpoint="-1"]').click();
  await tick();
  const time = doc.getElementById("checkpointAt");
  time.value = "2026-10-01T09:15:20";
  time.dispatchEvent(new w.Event("change", { bubbles: true }));
  await tick();
  doc.getElementById("checkpointBalance").value = "100";
  doc
    .getElementById("checkpointForm")
    .dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
  await tick();
  assert.equal(
    calls.some((c) => c.init.method === "POST"),
    false,
  );
  assert.equal(doc.getElementById("checkpointSave").disabled, true);
  time.value = "2026-10-02T09:15:20";
  time.dispatchEvent(new w.Event("change", { bubbles: true }));
  await tick();
  release({
    ok: true,
    json: async () => ({
      ...summary,
      balances: [{ ...summary.balances[0], balance: 999999 }],
    }),
  });
  await tick();
  assert.doesNotMatch(
    doc.getElementById("checkpointPreview").textContent,
    /999\.999/,
  );
  time.value = "2099-10-01T09:15:20";
  time.dispatchEvent(new w.Event("change", { bubbles: true }));
  await tick();
  assert.match(doc.getElementById("checkpointError").textContent, /tương lai/);
  assert.equal(doc.getElementById("checkpointSave").disabled, true);
});
test("chênh lệch preview chuỗi thập phân chính xác và lịch sử lệch dương cũng đỏ", async (t) => {
  const { init, doc, w } = await setup(t, {
    manage: true,
    fetcher: async (url) => {
      if (url.pathname.endsWith("summary") && url.searchParams.has("at"))
        return {
          ok: true,
          json: async () => ({
            ...summary,
            balances: [{ ...summary.balances[0], balance: "0.1" }],
          }),
        };
      if (url.pathname.endsWith("checkpoints"))
        return {
          ok: true,
          json: async () => ({
            checkpoints: [
              {
                checkpointAt: "2026-10-01T02:00:00Z",
                fundName: "Bank cũ",
                createdBy: "Lan",
                systemBalance: 10,
                balance: 12,
                diff: 2,
                note: "<b>note</b>",
              },
            ],
            total: 1,
            page: 1,
            pageSize: 100,
            totalPages: 1,
          }),
        };
    },
  });
  await init();
  assert.ok(
    doc
      .querySelector('#checkpointsBody [data-field="diff"]')
      .classList.contains("difference"),
  );
  assert.equal(doc.querySelector("#checkpointsBody b"), null);
  doc.querySelector('[data-checkpoint="-1"]').click();
  await tick();
  doc.getElementById("checkpointBalance").value = "0.3";
  doc
    .getElementById("checkpointBalance")
    .dispatchEvent(new w.Event("input", { bubbles: true }));
  assert.match(
    doc.getElementById("checkpointPreview").textContent,
    /chênh lệch: 0,2$/,
  );
});

test("preview với số hệ thống dạng exponent giữ chênh lệch và POST chuỗi nhập chính xác", async (t) => {
  const { init, doc, w, calls } = await setup(t, {
    manage: true,
    fetcher: async (url, request) => {
      if (url.pathname.endsWith("summary") && url.searchParams.has("at"))
        return {
          ok: true,
          json: async () => ({
            ...summary,
            balances: [{ ...summary.balances[0], balance: 1e-7 }],
          }),
        };
      if (request.method === "POST")
        return { ok: true, json: async () => ({ checkpoint: { id: "1" } }) };
    },
  });
  await init();
  doc.querySelector('[data-checkpoint="-1"]').click();
  await tick();
  doc.getElementById("checkpointBalance").value = "1,234.0123456789";
  doc
    .getElementById("checkpointBalance")
    .dispatchEvent(new w.Event("input", { bubbles: true }));
  assert.match(
    doc.getElementById("checkpointPreview").textContent,
    /chênh lệch: 1\.234,0123455789$/,
  );
  doc
    .getElementById("checkpointForm")
    .dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
  await tick();
  const post = calls.find((call) => call.init.method === "POST");
  assert.ok(post);
  assert.equal(JSON.parse(post.init.body).balance, "1234.0123456789");
});

for (const outcome of ["success", "failure"]) {
  test(`checkpoint ${outcome} cũ không đổi dialog quỹ mới`, async (t) => {
    let finishPost;
    const { init, doc, w, calls } = await setup(t, {
      manage: true,
      fetcher: async (_url, request) => {
        if (request.method === "POST")
          return new Promise((resolve) => {
            finishPost = resolve;
          });
      },
    });
    await init();
    doc.querySelector('[data-checkpoint="-1"]').click();
    await tick();
    doc.getElementById("checkpointBalance").value = "100";
    doc
      .getElementById("checkpointBalance")
      .dispatchEvent(new w.Event("input", { bubbles: true }));
    doc
      .getElementById("checkpointForm")
      .dispatchEvent(
        new w.Event("submit", { bubbles: true, cancelable: true }),
      );
    await tick();
    assert.equal(typeof finishPost, "function");
    doc.getElementById("checkpointDialog").close();
    doc.querySelector('[data-checkpoint="cash"]').click();
    await tick();
    doc.getElementById("checkpointBalance").value = "250";
    doc
      .getElementById("checkpointBalance")
      .dispatchEvent(new w.Event("input", { bubbles: true }));
    assert.equal(doc.getElementById("checkpointFund").value, "cash");
    assert.match(
      doc.getElementById("checkpointPreview").textContent,
      /số dư ban đầu/,
    );
    assert.equal(doc.getElementById("checkpointSave").disabled, false);
    finishPost(
      outcome === "success"
        ? { ok: true, json: async () => ({ checkpoint: { id: "1" } }) }
        : {
            ok: false,
            status: 500,
            json: async () => ({ error: "Lỗi chốt quỹ cũ." }),
          },
    );
    await tick();
    assert.equal(doc.getElementById("checkpointDialog").open, true);
    assert.equal(doc.getElementById("checkpointFund").value, "cash");
    assert.equal(doc.getElementById("checkpointBalance").value, "250");
    assert.match(
      doc.getElementById("checkpointPreview").textContent,
      /số dư ban đầu/,
    );
    assert.equal(doc.getElementById("checkpointError").textContent, "");
    assert.equal(doc.getElementById("checkpointSave").disabled, false);
    assert.equal(calls.filter((call) => call.init.method === "POST").length, 1);
  });

  test(`export ${outcome} cũ không đổi dialog bảng mới`, async (t) => {
    let finishExport;
    const { init, doc, w } = await setup(t, {
      fetcher: async (url) => {
        if (url.pathname.endsWith("export"))
          return new Promise((resolve) => {
            finishExport = resolve;
          });
      },
    });
    await init();
    const downloaded = [];
    w.URL.createObjectURL = () => "blob:synthetic";
    w.URL.revokeObjectURL = () => {};
    w.HTMLAnchorElement.prototype.click = function () {
      downloaded.push(this.download);
    };
    doc.querySelector('[data-export="balances"]').click();
    doc.getElementById("exportDownload").click();
    await tick();
    assert.equal(typeof finishExport, "function");
    doc.getElementById("exportDialog").close();
    doc.querySelector('[data-export="entries"]').click();
    doc.querySelector('#exportColumns input[value="code"]').checked = false;
    doc
      .getElementById("exportColumns")
      .dispatchEvent(new w.Event("change", { bubbles: true }));
    assert.equal(doc.getElementById("exportDownload").disabled, false);
    finishExport(
      outcome === "success"
        ? { ok: true, blob: async () => new w.Blob(["old file"]) }
        : {
            ok: false,
            status: 500,
            json: async () => ({ error: "Lỗi xuất số dư cũ." }),
          },
    );
    await tick();
    assert.equal(doc.getElementById("exportDialog").open, true);
    assert.equal(doc.querySelectorAll("#exportColumns input").length, 14);
    assert.equal(
      doc.querySelector('#exportColumns input[value="code"]').checked,
      false,
    );
    assert.equal(doc.getElementById("exportError").textContent, "");
    assert.equal(doc.getElementById("exportDownload").disabled, false);
    assert.equal(doc.getElementById("exportHtml").disabled, false);
    assert.deepEqual(downloaded, []);
  });
}

test("checkpoint cũ hoàn thành khi quỹ mới đang lưu không bật lại nút lưu", async (t) => {
  const pending = [];
  const { init, doc, w } = await setup(t, {
    manage: true,
    fetcher: async (_url, request) => {
      if (request.method === "POST")
        return new Promise((resolve) => pending.push(resolve));
    },
  });
  await init();
  for (const fund of ["-1", "cash"]) {
    doc.querySelector(`[data-checkpoint="${fund}"]`).click();
    await tick();
    doc.getElementById("checkpointBalance").value = "100";
    doc
      .getElementById("checkpointBalance")
      .dispatchEvent(new w.Event("input", { bubbles: true }));
    doc
      .getElementById("checkpointForm")
      .dispatchEvent(
        new w.Event("submit", { bubbles: true, cancelable: true }),
      );
    await tick();
    if (fund === "-1") doc.getElementById("checkpointDialog").close();
  }
  assert.equal(pending.length, 2);
  assert.equal(doc.getElementById("checkpointSave").disabled, true);
  pending[0]({ ok: true, json: async () => ({ checkpoint: { id: "1" } }) });
  await tick();
  assert.equal(doc.getElementById("checkpointDialog").open, true);
  assert.equal(doc.getElementById("checkpointFund").value, "cash");
  assert.equal(doc.getElementById("checkpointSave").disabled, true);
  pending[1]({ ok: true, json: async () => ({ checkpoint: { id: "2" } }) });
  await tick();
  assert.equal(doc.getElementById("checkpointDialog").open, false);
});

test("export cũ hoàn thành khi bảng mới đang tải không bật lại nút tải", async (t) => {
  const pending = [];
  const { init, doc, w } = await setup(t, {
    fetcher: async (url) => {
      if (url.pathname.endsWith("export"))
        return new Promise((resolve) => pending.push(resolve));
    },
  });
  await init();
  w.URL.createObjectURL = () => "blob:synthetic";
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = () => {};
  doc.querySelector('[data-export="balances"]').click();
  doc.getElementById("exportDownload").click();
  await tick();
  doc.getElementById("exportDialog").close();
  doc.querySelector('[data-export="entries"]').click();
  doc.getElementById("exportDownload").click();
  await tick();
  assert.equal(pending.length, 2);
  assert.equal(doc.getElementById("exportDownload").disabled, true);
  pending[0]({ ok: true, blob: async () => new w.Blob(["old file"]) });
  await tick();
  assert.equal(doc.getElementById("exportDialog").open, true);
  assert.equal(doc.getElementById("exportDownload").disabled, true);
  pending[1]({ ok: true, blob: async () => new w.Blob(["new file"]) });
  await tick();
  assert.equal(doc.getElementById("exportDialog").open, false);
});

test("export xlsx/html tải file qua blob; lỗi giới hạn hiện trong dialog", async (t) => {
  const { init, doc, w, calls } = await setup(t, {
    fetcher: async (url) =>
      url.pathname.endsWith("export")
        ? { ok: true, blob: async () => new w.Blob(["file"]) }
        : null,
  });
  await init();
  const downloaded = [];
  w.URL.createObjectURL = () => "blob:synthetic";
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () {
    downloaded.push(this.download);
  };
  for (const format of ["xlsx", "html"]) {
    doc.querySelector('[data-export="entries"]').click();
    doc.getElementById(format === "html" ? "exportHtml" : "exportDownload").click();
    await tick();
  }
  assert.deepEqual(downloaded, [
    "TKS_So_quy_entries.xlsx",
    "TKS_So_quy_entries.html",
  ]);
  assert.equal(
    calls
      .filter((c) => c.url.pathname.endsWith("export"))
      .every((c) => !c.url.searchParams.has("page")),
    true,
  );
  w.fetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: "Vượt giới hạn 20.000 dòng." }),
  });
  doc.querySelector('[data-export="entries"]').click();
  doc.getElementById("exportDownload").click();
  await tick();
  assert.match(doc.getElementById("exportError").textContent, /20\.000/);
  assert.equal(doc.getElementById("exportDialog").open, true);
});

test("ô tìm sổ chi tiết theo chế độ ghi đúng tham số máy chủ, đổi chế độ chuyển từ khóa", async (t) => {
  const { init, doc, w, calls } = await setup(t);
  await init();
  const input = doc.getElementById("entriesSearch");
  input.value = "PT12";
  input.dispatchEvent(new w.Event("input", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 320));
  await tick();
  let last = calls.filter((c) => c.url.pathname.endsWith("entries")).at(-1).url;
  assert.equal(last.searchParams.get("code"), "PT12");
  doc.querySelector('[data-search-mode="note"]').click();
  await tick();
  last = calls.filter((c) => c.url.pathname.endsWith("entries")).at(-1).url;
  assert.equal(last.searchParams.get("note"), "PT12");
  assert.equal(last.searchParams.has("code"), false);
  assert.match(w.location.hash, /note=PT12/);
  doc.querySelector('[data-search-clear="entriesSearch"]').click();
  await tick();
  last = calls.filter((c) => c.url.pathname.endsWith("entries")).at(-1).url;
  assert.equal(last.searchParams.has("note"), false);
});
test("ô tìm số dư lọc tại máy khách không gọi lại API", async (t) => {
  const { init, doc, w, calls } = await setup(t);
  await init();
  const before = calls.length,
    input = doc.getElementById("balancesSearch");
  input.value = "tien mat";
  input.dispatchEvent(new w.Event("input", { bubbles: true }));
  assert.equal(calls.length, before);
  const rows = doc.querySelectorAll("#balancesBody tr[data-fund]");
  assert.deepEqual([...rows].map((row) => row.dataset.fund), ["cash"]);
  input.value = "khong co";
  input.dispatchEvent(new w.Event("input", { bubbles: true }));
  assert.match(doc.getElementById("balancesBody").textContent, /Không có tài khoản khớp/);
});
test("dropdown bộ lọc hiện tóm tắt lựa chọn, Esc đóng và trả focus", async (t) => {
  const { init, doc, w } = await setup(t);
  await init();
  const dd = doc.querySelector('[data-dd="docTypes"]'),
    button = dd.querySelector(".dd-button");
  assert.equal(dd.querySelector("[data-summary]").textContent, "Tất cả");
  button.click();
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.equal(doc.getElementById("docTypesPanel").hidden, false);
  const payment = doc.querySelector('[name="docTypes"][value="payment"]');
  payment.checked = false;
  payment.dispatchEvent(new w.Event("change", { bubbles: true }));
  await tick();
  assert.equal(dd.querySelector("[data-summary]").textContent, "Phiếu thu");
  assert.ok(dd.classList.contains("is-filtered"));
  doc.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(doc.getElementById("docTypesPanel").hidden, true);
  assert.equal(doc.activeElement, button);
  doc.querySelector('[data-select-fund="-1"]').click();
  await tick();
  assert.equal(
    doc.querySelector('[data-dd="fund"] [data-summary]').textContent,
    "Bank cũ",
  );
});
test("phân trang có nút trang đầu/cuối gọi đúng trang máy chủ", async (t) => {
  const { init, doc, calls } = await setup(t);
  await init();
  assert.equal(doc.getElementById("entriesFirst").disabled, true);
  doc.getElementById("entriesLast").click();
  await tick();
  const last = calls.filter((c) => c.url.pathname.endsWith("entries")).at(-1).url;
  assert.equal(last.searchParams.get("page"), "3");
});
