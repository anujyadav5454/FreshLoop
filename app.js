(function () {
  "use strict";
  var FL = window.FreshLoop;
  var KEY = "freshloop.v1";
  var MIN = 60000;

  var state = load();
  var ui = { tab: "customer", category: "All", picks: {}, name: localStorage.getItem("freshloop.name") || "" };
  var lastSig = "";

  /* ---------- storage ---------- */
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (s && Array.isArray(s.listings) && Array.isArray(s.reservations)) return s;
      }
    } catch (e) { /* fall through to seed */ }
    return seed();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage full or blocked: keep working in memory */ }
  }
  function seed() {
    var s = FL.newState(), now = Date.now();
    var demo = [
      ["Sharma Bakery", "Veg puffs (box of 4)", "Bakery", 12, 60, 25, 45, 150, "Counter 2, ask for FreshLoop"],
      ["Green Leaf Café", "Paneer wrap + chai combo", "Meals", 6, 180, 80, 100, 200, "Pickup shelf by the door"],
      ["Daily Fresh Mart", "Mixed fruit pack (500 g)", "Groceries", 8, 70, 30, 200, 480, "Billing desk, show your code"],
      ["Sharma Bakery", "Assorted pastries (2 pcs)", "Bakery", 5, 90, 35, 25, 120, "Counter 2, ask for FreshLoop"],
      ["Punjabi Rasoi", "Dal makhani + 2 rotis", "Meals", 4, 150, 60, 70, 140, "Side window, say FreshLoop"],
      ["Chai Point", "Samosa + juice combo", "Snacks & Drinks", 9, 80, 30, 130, 260, "Counter, mention your code"]
    ];
    demo.forEach(function (d) {
      FL.createListing(s, {
        shopName: d[0], item: d[1], category: d[2], qty: d[3], originalPrice: d[4], price: d[5],
        pickupBy: now + d[6] * MIN, useBy: now + d[7] * MIN, pickupNote: d[8], safetyConfirmed: true
      }, now);
    });
    return s;
  }

  /* ---------- tiny DOM helper (text is always set via textContent, so user input can't inject HTML) ---------- */
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === false || v == null) return;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) { if (c) el.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return el;
  }
  var $ = function (id) { return document.getElementById(id); };
  function rupee(n) { return "₹" + (Math.round(n * 100) / 100).toString(); }
  function clock(ms) { return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }

  var toastTimer;
  function toast(msg, bad) {
    var t = $("toast");
    t.textContent = msg;
    t.className = "toast show" + (bad ? " bad" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = "toast"; }, 3200);
  }

  /* ---------- customer view ---------- */
  function renderStats() {
    var s = FL.stats(state);
    var box = $("stats");
    box.textContent = "";
    box.appendChild(h("div", { class: "stat" }, [h("b", { text: String(s.mealsRescued) }), h("small", { text: "meals rescued" })]));
    box.appendChild(h("div", { class: "stat" }, [h("b", { text: rupee(s.moneySaved) }), h("small", { text: "saved by customers" })]));
  }

  function renderFilters() {
    var box = $("filters");
    box.textContent = "";
    ["All"].concat(FL.CATEGORIES).forEach(function (c) {
      box.appendChild(h("button", {
        class: "chip", type: "button", "aria-pressed": ui.category === c ? "true" : "false", text: c,
        onclick: function () { ui.category = c; renderCustomer(); }
      }));
    });
  }

  function offerCard(l, now) {
    var left = l.qtyLeft;
    var pick = Math.min(Math.max(ui.picks[l.id] || 1, 1), Math.min(left, FL.MAX_PER_RESERVATION));
    ui.picks[l.id] = pick;
    var out = h("output", { text: String(pick) });
    var maxPick = Math.min(left, FL.MAX_PER_RESERVATION);
    var minus = h("button", { type: "button", "aria-label": "One fewer", text: "−", disabled: pick <= 1 });
    var plus = h("button", { type: "button", "aria-label": "One more", text: "+", disabled: pick >= maxPick });
    function setPick(n) {
      ui.picks[l.id] = n; out.textContent = String(n);
      minus.disabled = n <= 1; plus.disabled = n >= maxPick;
    }
    minus.addEventListener("click", function () { setPick(ui.picks[l.id] - 1); });
    plus.addEventListener("click", function () { setPick(ui.picks[l.id] + 1); });

    var nameInput = h("input", {
      class: "name", type: "text", placeholder: "Your name", "aria-label": "Your name", maxlength: "30",
      value: ui.name, autocomplete: "name"
    });
    nameInput.addEventListener("input", function () { ui.name = nameInput.value; });

    var btn = h("button", {
      class: "primary", type: "button", text: "Reserve",
      onclick: function () {
        var r = FL.reserve(state, l.id, ui.picks[l.id], ui.name, Date.now());
        if (!r.ok) { toast(r.error, true); return; }
        localStorage.setItem("freshloop.name", ui.name.trim());
        save(); ui.picks[l.id] = 1;
        toast("Reserved! Show code " + r.reservation.code + " at pickup.");
        renderCustomer();
      }
    });

    var pct = Math.round((left / l.qtyTotal) * 100);
    var cd = h("div", { class: "countdown u-" + FL.urgency(l, now), "data-cd": l.id }, [
      h("small", { text: "Collect within" }),
      h("span", { "data-cd-text": l.id, text: FL.formatCountdown(FL.timeLeftMs(l, now)) })
    ]);

    return h("article", { class: "card" }, [
      h("span", { class: "cat", text: l.category }),
      h("h3", { text: l.item }),
      h("div", { class: "shop", text: l.shopName }),
      h("div", { class: "price-row" }, [
        h("span", { class: "price", text: rupee(l.price) }),
        h("span", { class: "was", text: rupee(l.originalPrice) }),
        h("span", { class: "off", text: FL.discountPercent(l) + "% off" })
      ]),
      cd,
      h("div", { class: "meta", text: "Pickup by " + clock(l.pickupBy) + " · Use by " + clock(l.useBy) }),
      h("div", { class: "meta", text: "Where: " + l.pickupNote }),
      h("div", { class: "qty-bar", role: "img", "aria-label": left + " of " + l.qtyTotal + " left" }, [h("i", { style: "width:" + pct + "%" })]),
      h("div", { class: "meta", text: left + " of " + l.qtyTotal + " left" }),
      h("div", { class: "reserve" }, [h("div", { class: "stepper" }, [minus, out, plus]), nameInput, btn])
    ]);
  }

  function orderCard(r, now) {
    var l = FL.findListing(state, r.listingId);
    var kids = [
      h("span", { class: "tag " + r.state, text: r.state.toUpperCase() }),
      h("strong", { text: r.qty + " × " + (l ? l.item : "Item") }),
      h("span", { class: "meta", text: l ? l.shopName + " · " + l.pickupNote : "" })
    ];
    if (r.state === "reserved") {
      kids.push(h("div", { class: "code", "aria-label": "Pickup code " + r.code.split("").join(" "), text: r.code }));
      if (l) kids.push(h("span", { class: "meta", text: "Collect by " + clock(l.pickupBy) + ". Pay " + rupee(l.price * r.qty) + " at the shop." }));
      kids.push(h("div", {}, [h("button", {
        class: "danger", type: "button", text: "Cancel order",
        onclick: function () {
          var res = FL.cancelReservation(state, r.id, Date.now());
          if (!res.ok) { toast(res.error, true); return; }
          save(); toast("Order cancelled. The items are available again."); renderAll();
        }
      })]));
    }
    return h("div", { class: "order" }, kids);
  }

  function renderCustomer() {
    var now = Date.now();
    renderStats(); renderFilters();
    var box = $("offers"); box.textContent = "";
    var list = state.listings.filter(function (l) {
      return FL.status(l, now) === "active" && (ui.category === "All" || l.category === ui.category);
    }).sort(function (a, b) { return a.pickupBy - b.pickupBy; }); // soonest expiry first
    list.forEach(function (l) { box.appendChild(offerCard(l, now)); });
    $("offers-empty").hidden = list.length > 0;

    var obox = $("orders"); obox.textContent = "";
    // Single-browser prototype: every reservation made here is shown, newest first.
    var mine = state.reservations.slice().reverse();
    mine.forEach(function (r) { obox.appendChild(orderCard(r, now)); });
    $("orders-empty").hidden = mine.length > 0;
  }

  /* ---------- shop view ---------- */
  function listingRow(l, now) {
    var st = FL.status(l, now);
    var open = state.reservations.filter(function (r) { return r.listingId === l.id && r.state === "reserved"; });
    var done = state.reservations.filter(function (r) { return r.listingId === l.id && r.state === "collected"; });

    var codeInput = h("input", { type: "text", maxlength: "4", placeholder: "Code", "aria-label": "Customer pickup code" });
    var kids = [
      h("div", { class: "mine-head" }, [
        h("div", {}, [h("h3", { text: l.item }), h("div", { class: "meta", text: l.shopName + " · " + l.category })]),
        h("span", { class: "state " + st, text: st.toUpperCase() })
      ]),
      h("div", { class: "meta", text: rupee(l.price) + " (was " + rupee(l.originalPrice) + ") · " + l.qtyLeft + "/" + l.qtyTotal + " left · " + open.length + " awaiting pickup · " + done.length + " collected" })
    ];
    if (st === "active" || st === "soldout") {
      kids.push(h("div", { class: "countdown u-" + FL.urgency(l, now) }, [
        h("small", { text: "Closes in" }), h("span", { "data-cd-text": l.id, text: FL.formatCountdown(FL.timeLeftMs(l, now)) })
      ]));
    }
    if (open.length && st !== "withdrawn") {
      kids.push(h("div", { class: "collect" }, [
        codeInput,
        h("button", {
          class: "primary", type: "button", text: "Confirm handover",
          onclick: function () {
            var r = FL.collect(state, l.id, codeInput.value, Date.now());
            if (!r.ok) { toast(r.error, true); return; }
            save(); toast("Handed over " + r.reservation.qty + " × " + l.item + " to " + r.reservation.customerName + "."); renderAll();
          }
        })
      ]));
    }
    if (st !== "withdrawn" && st !== "expired") {
      kids.push(h("div", {}, [h("button", {
        class: "secondary", type: "button", text: "Withdraw listing",
        onclick: function () {
          var r = FL.withdraw(state, l.id);
          if (!r.ok) { toast(r.error, true); return; }
          save(); renderAll();
        }
      })]));
    }
    return h("div", { class: "mine" }, kids);
  }

  function renderShop() {
    var now = Date.now();
    var box = $("my-listings"); box.textContent = "";
    var list = state.listings.slice().reverse();
    list.forEach(function (l) { box.appendChild(listingRow(l, now)); });
    $("my-listings-empty").hidden = list.length > 0;
  }

  /* ---------- form ---------- */
  function localInput(ms) {
    var d = new Date(ms - new Date(ms).getTimezoneOffset() * MIN);
    return d.toISOString().slice(0, 16);
  }
  function resetFormDefaults() {
    var f = $("listing-form"), now = Date.now();
    f.pickupBy.value = localInput(now + 120 * MIN);
    f.useBy.value = localInput(now + 180 * MIN);
  }
  function initForm() {
    var f = $("listing-form");
    FL.CATEGORIES.forEach(function (c) { f.category.appendChild(h("option", { value: c, text: c })); });
    resetFormDefaults();
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var data = {
        shopName: f.shopName.value, item: f.item.value, category: f.category.value, qty: f.qty.value,
        originalPrice: f.originalPrice.value, price: f.price.value,
        pickupBy: f.pickupBy.value ? new Date(f.pickupBy.value).getTime() : NaN,
        useBy: f.useBy.value ? new Date(f.useBy.value).getTime() : NaN,
        pickupNote: f.pickupNote.value, safetyConfirmed: f.safetyConfirmed.checked
      };
      var r = FL.createListing(state, data, Date.now());
      var ul = $("form-errors"); ul.textContent = "";
      if (!r.ok) { r.errors.forEach(function (m) { ul.appendChild(h("li", { text: m })); }); return; }
      save();
      var keepShop = f.shopName.value;
      f.reset(); f.shopName.value = keepShop; resetFormDefaults();
      toast("Listing published. Customers can reserve it now.");
      renderAll();
    });
  }

  /* ---------- tabs, ticking, boot ---------- */
  function setTab(t) {
    ui.tab = t;
    $("view-customer").hidden = t !== "customer";
    $("view-shop").hidden = t !== "shop";
    $("tab-customer").setAttribute("aria-selected", t === "customer");
    $("tab-shop").setAttribute("aria-selected", t === "shop");
    renderAll();
  }
  function renderAll() {
    FL.sweepMissed(state, Date.now());
    if (ui.tab === "customer") renderCustomer(); else renderShop();
    lastSig = signature();
  }
  function signature() {
    var now = Date.now();
    return state.listings.map(function (l) { return FL.status(l, now) + FL.urgency(l, now) + l.qtyLeft; }).join("|") +
      "#" + state.reservations.map(function (r) { return r.state; }).join(",");
  }
  function tick() {
    var now = Date.now();
    if (signature() !== lastSig) { FL.sweepMissed(state, now); save(); renderAll(); return; }
    var spans = document.querySelectorAll("[data-cd-text]");
    for (var i = 0; i < spans.length; i++) {
      var l = FL.findListing(state, spans[i].getAttribute("data-cd-text"));
      if (l) spans[i].textContent = FL.formatCountdown(FL.timeLeftMs(l, now));
    }
  }

  $("tab-customer").addEventListener("click", function () { setTab("customer"); });
  $("tab-shop").addEventListener("click", function () { setTab("shop"); });
  $("reset").addEventListener("click", function () {
    if (!confirm("Reset all demo data in this browser?")) return;
    state = seed(); ui.picks = {}; save(); renderAll(); toast("Demo data reset.");
  });
  window.addEventListener("storage", function (e) {
    if (e.key === KEY && e.newValue) { try { state = JSON.parse(e.newValue); renderAll(); } catch (err) { /* ignore */ } }
  });

  initForm();
  save();
  renderAll();
  setInterval(tick, 1000);
})();
