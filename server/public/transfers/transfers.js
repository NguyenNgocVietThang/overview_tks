/* Trang Yêu cầu chuyển tiền — API: /api/transfers (xem server/transfers/transferRoutes.js).
   Máy chủ là ranh giới bảo mật: mọi nút ở đây chỉ hiện theo `allowed` máy chủ trả về. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var STATUS_LABEL = { CHO_DUYET: "Chờ duyệt", DA_DUYET: "Đã duyệt", DA_CHUYEN: "Đã chuyển", DA_HUY: "Đã hủy" };
  var EVENT_LABEL = {
    CREATED: "Sale tạo yêu cầu", IMPORTED: "Chuyển từ Google Sheet", EDITED: "Kế toán sửa",
    APPROVED: "Kế toán duyệt", UNAPPROVED: "Bỏ duyệt", CANCELED: "Hủy yêu cầu",
    PAID: "Đánh dấu Đã chuyển", PAID_REVERTED: "Thu hồi Đã chuyển"
  };
  var SOURCE_LABEL = { image_ai: "Đọc từ ảnh — kiểm tra kỹ", qr: "Từ mã QR" };
  var state = { status: null, q: "", from: "", to: "", page: 1, pageSize: 100, permissions: {}, total: 0 };
  var detail = null; // { request, events, allowed, dirty, canceledLive }
  var banks = null;
  var reloadTimer = null;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function money(n) { return n == null ? "" : Number(n).toLocaleString("vi-VN") + " đ"; }
  function when(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
    });
  }
  function bankText(r) { return r.bankShortName || (r.bankNameRaw ? r.bankNameRaw + " (chưa xác định)" : "(chưa xác định)"); }
  function badge(status) { return '<span class="tr-badge ' + esc(status) + '">' + esc(STATUS_LABEL[status] || status) + "</span>"; }

  async function api(path, options) {
    var res = await fetch(path, Object.assign({ credentials: "same-origin", headers: { "Content-Type": "application/json" } }, options || {}));
    var body = {};
    try { body = await res.json(); } catch (error) { /* phản hồi rỗng */ }
    if (!res.ok) {
      var error = new Error(body.error || "Lỗi " + res.status);
      error.status = res.status; error.code = body.code; error.body = body;
      throw error;
    }
    return body;
  }
  function post(path, data) { return api(path, { method: "POST", body: JSON.stringify(data || {}) }); }

  // ------------------------------------------------------------------ danh sách
  function readHash() {
    var params = new URLSearchParams(location.hash.slice(1));
    return { open: params.get("open"), status: params.get("status") };
  }

  async function loadList() {
    var params = new URLSearchParams();
    if (state.status) params.set("status", state.status);
    if (state.q) params.set("q", state.q);
    if (state.from) params.set("from", state.from);
    if (state.to) params.set("to", state.to);
    params.set("page", state.page);
    params.set("pageSize", state.pageSize);
    try {
      var data = await api("/api/transfers?" + params.toString());
      state.permissions = data.permissions || {};
      state.total = data.total;
      $("unlinkedNote").hidden = data.linked !== false;
      renderCounts(data.counts || {});
      renderRows(data.requests || []);
      var pages = Math.max(1, Math.ceil(data.total / data.pageSize));
      $("pageInfo").textContent = "Trang " + data.page + "/" + pages + " · " + data.total + " yêu cầu";
      $("prevPage").disabled = data.page <= 1;
      $("nextPage").disabled = data.page >= pages;
    } catch (error) {
      $("rows").innerHTML = '<tr><td colspan="13" class="empty">' + esc(error.message) + "</td></tr>";
    }
  }

  function renderCounts(counts) {
    var all = 0;
    Object.keys(STATUS_LABEL).forEach(function (s) { all += counts[s] || 0; });
    document.querySelectorAll("[data-count]").forEach(function (el) {
      var n = el.dataset.count === "ALL" ? all : counts[el.dataset.count] || 0;
      el.textContent = n ? String(n) : "";
    });
    document.querySelectorAll(".tr-tab").forEach(function (tab) {
      tab.setAttribute("aria-pressed", String((tab.dataset.status || null) === state.status));
    });
  }

  function renderRows(rows) {
    if (!rows.length) {
      $("rows").innerHTML = '<tr><td colspan="13" class="empty">Không có yêu cầu nào.</td></tr>';
      return;
    }
    $("rows").innerHTML = rows.map(function (r) {
      var attrs = r.canOpen
        ? ' class="is-open" tabindex="0" data-id="' + r.id + '" title="Mở chi tiết"'
        : ' class="is-locked" title="Chỉ mở được khi kế toán đã duyệt"';
      var bank = r.bankBin ? esc(bankText(r)) : '<span class="tr-warn">' + esc(bankText(r)) + "</span>";
      return "<tr" + attrs + ">" +
        '<td class="mono">' + esc(r.requestCode) + "</td>" +
        '<td class="mono">' + esc(when(r.createdAt)) + "</td>" +
        "<td>" + esc(r.saleName) + "</td>" +
        "<td>" + esc(r.customerName) + "</td>" +
        '<td class="num">' + esc(money(r.amountVnd)) + "</td>" +
        "<td>" + bank + "</td>" +
        '<td class="mono">' + esc(r.bankAccount) + "</td>" +
        "<td>" + esc(r.accountHolder) + "</td>" +
        "<td>" + badge(r.status) + "</td>" +
        "<td>" + esc(r.approvedByName || "") + "</td>" +
        "<td>" + esc(r.paidByName || "") + "</td>" +
        '<td class="mono">' + esc(when(r.paidAt)) + "</td>" +
        "<td>" + esc(r.note) + "</td>" +
        "</tr>";
    }).join("");
  }

  function scheduleReload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(loadList, 400);
  }

  // ------------------------------------------------------------------ chi tiết
  async function openDetail(id) {
    try {
      var data = await api("/api/transfers/" + encodeURIComponent(id));
      detail = { request: data.request, events: data.events, allowed: data.allowed, dirty: false, canceledLive: false };
      if (data.allowed.edit && !banks) banks = (await api("/api/transfers/banks")).banks;
      renderDetail();
      $("detailOverlay").hidden = false;
      history.replaceState(null, "", "#open=" + id);
      $("dtClose").focus();
      if (data.allowed.viewQr) loadQr();
    } catch (error) {
      alert(error.message);
    }
  }

  function closeDetail() {
    if (detail && detail.dirty && !confirm("Bỏ các thay đổi chưa lưu?")) return;
    detail = null;
    $("detailOverlay").hidden = true;
    $("dtBody").innerHTML = "";
    history.replaceState(null, "", location.pathname);
  }

  function fieldSourceNote(field) {
    var src = detail.request.fieldSources && detail.request.fieldSources[field];
    return src && SOURCE_LABEL[src] ? '<span class="tr-source">' + esc(SOURCE_LABEL[src]) + "</span>" : "";
  }

  function renderDetail() {
    var r = detail.request, a = detail.allowed;
    $("dtTitle").innerHTML = esc(r.requestCode) + " " + badge(r.status);
    $("dtSubtitle").textContent = "Sale " + r.saleName + " · gửi lúc " + when(r.createdAt) +
      (r.inputKind === "qr_image" ? " · từ ảnh mã QR" : "") + (r.source === "cutover" ? " · chuyển từ Google Sheet" : "");
    var html = '<div id="dtAlert"></div>';
    if (detail.canceledLive) html += '<p class="tr-alert is-red">Sale vừa hủy yêu cầu này — DỪNG chuyển khoản.</p>';
    if (r.status === "DA_HUY") {
      html += '<p class="tr-alert is-red">Đã hủy bởi ' + esc(r.canceledByType === "SALE" ? "sale " : "kế toán ") +
        esc(r.canceledByName || "") + " lúc " + esc(when(r.canceledAt)) + (r.cancelReason ? " · Lý do: " + esc(r.cancelReason) : "") + "</p>";
    }
    if (r.status === "DA_CHUYEN") {
      html += '<p class="tr-alert is-blue">Đã chuyển bởi <b>' + esc(r.paidByName) + "</b> lúc " + esc(when(r.paidAt)) + "</p>";
    }
    if (!r.bankBin && r.status === "CHO_DUYET") {
      html += '<p class="tr-alert is-amber">Ngân hàng chưa xác định (sale ghi: “' + esc(r.bankNameRaw || "—") + '”). Chọn ngân hàng đúng trước khi duyệt.</p>';
    }
    if (a.viewQr) html += '<section class="dp-section" id="dtQr"><p class="dp-section-note">Đang tạo mã QR…</p></section>';
    html += a.edit ? editForm(r) : readOnly(r, a);
    html += '<div id="dtConfirm"></div>';
    html += '<div class="tr-actions" id="dtActions">' + actionButtons(a) + "</div>";
    html += '<section class="dp-section"><div class="dp-section-head"><h4 class="dp-section-title">Lịch sử</h4></div>' + historyHtml(detail.events) + "</section>";
    $("dtBody").innerHTML = html;
    if (a.edit) wireForm();
    if (detail.canceledLive) disableActions();
  }

  function readOnly(r, a) {
    var rows = [
      ["Tên khách", esc(r.customerName) + fieldSourceNote("customerName")],
      ["Số tiền", "<b>" + esc(money(r.amountVnd)) + "</b>" + fieldSourceNote("amountVnd")],
      ["Ngân hàng", esc(bankText(r)) + fieldSourceNote("bankBin")],
      ["Số tài khoản", '<span class="mono">' + esc(r.bankAccount) + "</span>" + (r.accountType === "CARD" ? " (số thẻ)" : "") + fieldSourceNote("bankAccount")],
      ["Chủ tài khoản", esc(r.accountHolder) + fieldSourceNote("accountHolder")],
      ["Người duyệt", r.approvedByName ? esc(r.approvedByName) + " · " + esc(when(r.approvedAt)) : '<span class="muted">—</span>'],
      ["Ghi chú sale", esc(r.note) || '<span class="muted">—</span>', true]
    ];
    var note = a.editAccountantNote
      ? '<label class="is-wide">Ghi chú kế toán<textarea id="fAccountantNote" maxlength="500">' + esc(r.accountantNote) + "</textarea></label>"
      : "";
    if (!a.editAccountantNote && r.accountantNote) rows.push(["Ghi chú kế toán", esc(r.accountantNote), true]);
    return '<section class="dp-section"><dl class="dp-meta">' + rows.map(function (row) {
      return "<div" + (row[2] ? ' class="is-wide"' : "") + "><dt>" + row[0] + "</dt><dd>" + row[1] + "</dd></div>";
    }).join("") + "</dl>" + (note ? '<div class="tr-form" style="margin-top:12px">' + note + "</div>" : "") + "</section>";
  }

  function editForm(r) {
    var options = '<option value="">— Chọn ngân hàng —</option>' + (banks || []).map(function (b) {
      return '<option value="' + esc(b.bin) + '"' + (b.bin === r.bankBin ? " selected" : "") + ">" + esc(b.shortName + " — " + b.name) + "</option>";
    }).join("");
    var hint = function (field) { var s = fieldSourceNote(field); return s ? '<span class="tr-hint">' + s.replace(/<[^>]+>/g, "") + "</span>" : ""; };
    return '<section class="dp-section"><form class="tr-form" id="editForm" autocomplete="off">' +
      '<label>Tên khách (nội dung chuyển khoản)<input id="fCustomerName" maxlength="150" value="' + esc(r.customerName) + '" />' + hint("customerName") + "</label>" +
      '<label>Số tiền (VND)<input id="fAmountVnd" inputmode="numeric" value="' + esc(Number(r.amountVnd).toLocaleString("vi-VN")) + '" />' + hint("amountVnd") + "</label>" +
      '<label>Ngân hàng<select id="fBankBin">' + options + "</select>" + hint("bankBin") + "</label>" +
      '<label>Số tài khoản / số thẻ<input id="fBankAccount" maxlength="50" value="' + esc(r.bankAccount) + '" />' + hint("bankAccount") + "</label>" +
      '<label>Loại<select id="fAccountType"><option value="ACCOUNT"' + (r.accountType === "ACCOUNT" ? " selected" : "") + '>Số tài khoản</option><option value="CARD"' + (r.accountType === "CARD" ? " selected" : "") + ">Số thẻ</option></select></label>" +
      '<label>Chủ tài khoản<input id="fAccountHolder" maxlength="150" value="' + esc(r.accountHolder) + '" />' + hint("accountHolder") + "</label>" +
      '<label class="is-wide">Ghi chú sale<textarea id="fNote" maxlength="500">' + esc(r.note) + "</textarea></label>" +
      '<label class="is-wide">Ghi chú kế toán<textarea id="fAccountantNote" maxlength="500">' + esc(r.accountantNote) + "</textarea></label>" +
      "</form></section>";
  }

  function wireForm() {
    $("editForm").addEventListener("input", function () {
      detail.dirty = true;
      var save = $("btnSave");
      if (save) save.disabled = false;
      var approve = $("btnApprove");
      if (approve) { approve.disabled = true; approve.title = "Lưu thay đổi trước khi duyệt"; }
    });
  }

  function actionButtons(a) {
    var b = [];
    if (a.edit) b.push('<button type="button" class="tr-btn" id="btnSave" disabled>Lưu thay đổi</button>');
    else if (a.editAccountantNote) b.push('<button type="button" class="tr-btn" id="btnSaveNote">Lưu ghi chú</button>');
    if (a.cancel) b.push('<button type="button" class="tr-btn is-red" id="btnCancel">Hủy yêu cầu</button>');
    if (a.unapprove) b.push('<button type="button" class="tr-btn" id="btnUnapprove">Bỏ duyệt</button>');
    if (a.approve) b.push('<button type="button" class="tr-btn is-primary" id="btnApprove"' + (detail.request.bankBin ? "" : ' disabled title="Chọn ngân hàng trước"') + ">Duyệt</button>");
    if (a.revertPaid) b.push('<button type="button" class="tr-btn is-red" id="btnRevert">Thu hồi Đã chuyển</button>');
    if (a.markPaid) b.push('<button type="button" class="tr-btn is-green" id="btnPaid">Đã chuyển</button>');
    return b.join("");
  }

  function disableActions() {
    document.querySelectorAll("#dtActions button").forEach(function (btn) { btn.disabled = true; });
    $("dtConfirm").innerHTML = "";
    // Không để mã QR của yêu cầu đã hủy nằm trên màn hình (tránh quét nhầm).
    if ($("dtQr")) $("dtQr").hidden = true;
  }

  function historyHtml(events) {
    if (!events || !events.length) return '<p class="dp-section-note">Chưa có lịch sử.</p>';
    return '<ol class="tr-history">' + events.slice().reverse().map(function (e) {
      var changes = (e.changes || []).map(function (c) {
        var fmt = function (v) { return c.field === "amountVnd" && v != null ? money(v) : v; };
        return "<li>" + esc(c.label) + ": " + esc(fmt(c.before)) + " → <b>" + esc(fmt(c.after)) + "</b></li>";
      }).join("");
      return "<li><div><b>" + esc(EVENT_LABEL[e.type] || e.type) + "</b>" + (e.actorName ? " · " + esc(e.actorName) : "") +
        ' <span class="when">' + esc(when(e.at)) + "</span></div>" +
        (e.reason ? "<div>Lý do / ghi chú: " + esc(e.reason) + "</div>" : "") +
        (changes ? "<ul>" + changes + "</ul>" : "") + "</li>";
    }).join("") + "</ol>";
  }

  async function loadQr() {
    var id = detail.request.id;
    try {
      var qr = await api("/api/transfers/" + id + "/vietqr");
      if (!detail || detail.request.id !== id) return;
      var r = detail.request;
      $("dtQr").innerHTML =
        '<div class="dp-section-head"><h4 class="dp-section-title">Quét để chuyển khoản</h4><span class="dp-section-note">Kiểm tra lại tên chủ tài khoản trên app ngân hàng trước khi xác nhận</span></div>' +
        '<div class="tr-qr"><div class="tr-qr-code" aria-label="Mã VietQR">' + qr.svg + "</div>" +
        '<ul class="dp-stats">' +
        '<li class="dp-stat is-green"><div class="dp-stat-label">Số tiền</div><div class="dp-stat-value">' + esc(money(qr.amountVnd)) + "</div></li>" +
        '<li class="dp-stat"><div class="dp-stat-label">Chủ tài khoản</div><div class="dp-stat-value is-text">' + esc(r.accountHolder) + '</div><div class="dp-stat-sub">' + esc(bankText(r)) + " · " + esc(r.bankAccount) + "</div></li>" +
        '<li class="dp-stat"><div class="dp-stat-label">Nội dung chuyển khoản</div><div class="dp-stat-value is-text">' + esc(qr.addInfo || "—") + "</div></li>" +
        "</ul></div>";
    } catch (error) {
      if ($("dtQr")) $("dtQr").innerHTML = '<p class="tr-alert is-amber">' + esc(error.message) + "</p>";
    }
  }

  function askConfirm(message, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var box = $("dtConfirm");
      box.innerHTML = '<div class="tr-confirm"><p>' + esc(message) + "</p>" +
        (opts.reason ? '<textarea id="cReason" maxlength="300" placeholder="' + esc(opts.required ? "Lý do (bắt buộc)" : "Lý do (không bắt buộc)") + '"></textarea>' : "") +
        '<div class="tr-actions"><button type="button" class="tr-btn" id="cNo">Thôi</button><button type="button" class="tr-btn ' + (opts.danger ? "is-red" : "is-primary") + '" id="cYes">' + esc(opts.yes || "Xác nhận") + "</button></div></div>";
      var done = function (value) { box.innerHTML = ""; resolve(value); };
      $("cNo").onclick = function () { done(null); };
      $("cYes").onclick = function () {
        var reason = opts.reason ? $("cReason").value.trim() : "";
        if (opts.required && !reason) { $("cReason").focus(); return; }
        done({ reason: reason });
      };
      ($("cReason") || $("cYes")).focus();
    });
  }

  function formPatch() {
    var r = detail.request, patch = {};
    var set = function (key, value) { if (value !== r[key]) patch[key] = value; };
    if ($("editForm")) {
      set("customerName", $("fCustomerName").value.trim());
      var amount = Number($("fAmountVnd").value.replace(/[^\d]/g, ""));
      if (amount !== r.amountVnd) patch.amountVnd = amount;
      set("bankBin", $("fBankBin").value || null);
      set("bankAccount", $("fBankAccount").value.replace(/[\s.\-]/g, ""));
      set("accountType", $("fAccountType").value);
      set("accountHolder", $("fAccountHolder").value.trim());
      set("note", $("fNote").value.trim());
    }
    if ($("fAccountantNote")) set("accountantNote", $("fAccountantNote").value.trim());
    return patch;
  }

  async function run(action) {
    var r = detail.request;
    var path = "/api/transfers/" + r.id;
    var body = { expectedVersion: r.version };
    try {
      if (action === "save") {
        var patch = formPatch();
        if (!Object.keys(patch).length) { detail.dirty = false; return; }
        var saved = await api(path, { method: "PATCH", body: JSON.stringify(Object.assign(body, patch)) });
        detail.dirty = false;
        return reloadDetail(saved.request.id);
      }
      if (action === "approve") {
        var ok = await askConfirm("Duyệt chuyển " + money(r.amountVnd) + " cho " + r.accountHolder + " (" + bankText(r) + " " + r.bankAccount + ")?", { yes: "Duyệt" });
        if (!ok) return;
        await post(path + "/approve", body);
      } else if (action === "unapprove") {
        var un = await askConfirm("Đưa yêu cầu về Chờ duyệt để sửa?", { reason: true, yes: "Bỏ duyệt" });
        if (!un) return;
        await post(path + "/unapprove", Object.assign(body, { reason: un.reason }));
      } else if (action === "cancel") {
        var c = await askConfirm("Hủy yêu cầu " + r.requestCode + "? Sale sẽ được báo qua Telegram.", { reason: true, required: true, danger: true, yes: "Hủy yêu cầu" });
        if (!c) return;
        await post(path + "/cancel", Object.assign(body, { reason: c.reason }));
      } else if (action === "paid") {
        var p = await askConfirm("Xác nhận ĐÃ CHUYỂN " + money(r.amountVnd) + " cho " + r.accountHolder + "? Chỉ bấm sau khi app ngân hàng báo thành công.", { yes: "Đã chuyển" });
        if (!p) return;
        await post(path + "/mark-paid", body);
      } else if (action === "revert") {
        var rv = await askConfirm("Thu hồi trạng thái Đã chuyển (đưa về Đã duyệt)?", { reason: true, required: true, danger: true, yes: "Thu hồi" });
        if (!rv) return;
        await post(path + "/revert-paid", Object.assign(body, { reason: rv.reason }));
      }
      await reloadDetail(r.id);
    } catch (error) {
      showAlert(error);
      if (error.code === "TRANSFER_CANCELED") { detail.canceledLive = true; disableActions(); }
      if (error.code === "STALE" || error.code === "INVALID_STATE") {
        $("dtAlert").innerHTML += ' <button type="button" class="tr-btn" id="btnReload">Tải lại</button>';
        $("btnReload").onclick = function () { reloadDetail(r.id); };
      }
    }
  }

  function showAlert(error) {
    var cls = error.code === "TRANSFER_CANCELED" ? "is-red" : "is-amber";
    $("dtAlert").innerHTML = '<p class="tr-alert ' + cls + '">' + esc(error.message) + "</p>";
  }

  async function reloadDetail(id) {
    var keepCanceled = detail && detail.canceledLive;
    detail = null;
    await openDetail(id);
    if (detail && keepCanceled && detail.request.status === "DA_HUY") detail.canceledLive = false;
    scheduleReload();
  }

  // ------------------------------------------------------------------ realtime
  function connectStream() {
    var source = new EventSource("/api/transfers/stream");
    source.onopen = function () { $("liveStatus").textContent = "Tự động cập nhật"; };
    source.onerror = function () { $("liveStatus").textContent = "Mất kết nối — đang thử lại…"; };
    source.onmessage = function (message) {
      var event;
      try { event = JSON.parse(message.data); } catch (error) { return; }
      scheduleReload();
      if (!detail || event.id !== detail.request.id || event.version <= detail.request.version) return;
      if (event.type === "CANCELED") {
        detail.canceledLive = true;
        var alertBox = document.createElement("p");
        alertBox.className = "tr-alert is-red";
        alertBox.textContent = "Sale vừa hủy yêu cầu này — DỪNG chuyển khoản.";
        $("dtAlert").replaceChildren(alertBox);
        disableActions();
      } else if (detail.dirty) {
        $("dtAlert").innerHTML = '<p class="tr-alert is-amber">Yêu cầu vừa được người khác cập nhật. <button type="button" class="tr-btn" id="btnReload">Tải lại</button></p>';
        $("btnReload").onclick = function () { detail.dirty = false; reloadDetail(detail.request.id); };
      } else {
        reloadDetail(detail.request.id);
      }
    };
  }

  // ------------------------------------------------------------------ khởi động
  async function init() {
    var theme = function () {
      var light = document.documentElement.dataset.theme === "light";
      $("themeLabel").textContent = light ? "Dark mode" : "Light mode";
    };
    theme();
    $("themeToggle").addEventListener("click", function () {
      var next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem("tks-dashboard-theme", next); } catch (error) { /* không bắt buộc */ }
      theme();
    });
    var toggleSidebar = function () {
      var open = $("sidebar").classList.toggle("open");
      $("backdrop").classList.toggle("show", open);
      $("menuBtn").setAttribute("aria-expanded", String(open));
    };
    $("menuBtn").addEventListener("click", toggleSidebar);
    $("backdrop").addEventListener("click", toggleSidebar);
    await window.TKSNav.authGuard();

    var hash = readHash();
    // Mặc định: Kế toán xem Chờ duyệt, người chuyển tiền xem Đã duyệt, sale xem tất cả.
    if (hash.status && STATUS_LABEL[hash.status]) state.status = hash.status;
    else if (window.TKSNav.can("transfers.review")) state.status = "CHO_DUYET";
    else if (window.TKSNav.can("transfers.markPaid")) state.status = "DA_DUYET";

    $("statusTabs").addEventListener("click", function (event) {
      var tab = event.target.closest(".tr-tab");
      if (!tab) return;
      state.status = tab.dataset.status || null;
      state.page = 1;
      loadList();
    });
    var searchTimer;
    $("q").addEventListener("input", function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { state.q = $("q").value.trim(); state.page = 1; loadList(); }, 300);
    });
    $("filters").addEventListener("submit", function (event) { event.preventDefault(); });
    ["from", "to"].forEach(function (key) {
      $(key).addEventListener("change", function () { state[key] = $(key).value; state.page = 1; loadList(); });
    });
    $("prevPage").addEventListener("click", function () { state.page -= 1; loadList(); });
    $("nextPage").addEventListener("click", function () { state.page += 1; loadList(); });
    $("rows").addEventListener("click", function (event) {
      var row = event.target.closest("tr.is-open");
      if (row) openDetail(row.dataset.id);
    });
    $("rows").addEventListener("keydown", function (event) {
      var row = event.target.closest("tr.is-open");
      if (row && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); openDetail(row.dataset.id); }
    });
    $("dtClose").addEventListener("click", closeDetail);
    $("detailOverlay").addEventListener("click", function (event) { if (event.target === $("detailOverlay")) closeDetail(); });
    document.addEventListener("keydown", function (event) { if (event.key === "Escape" && detail) closeDetail(); });
    $("dtBody").addEventListener("click", function (event) {
      var button = event.target.closest("button");
      if (!button || button.disabled) return;
      var actions = { btnSave: "save", btnSaveNote: "save", btnApprove: "approve", btnUnapprove: "unapprove", btnCancel: "cancel", btnPaid: "paid", btnRevert: "revert" };
      if (actions[button.id]) run(actions[button.id]);
    });

    await loadList();
    connectStream();
    if (hash.open) openDetail(hash.open);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
