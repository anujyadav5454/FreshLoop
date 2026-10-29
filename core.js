/* FreshLoop core logic: framework-free so it runs in the browser and in Node tests. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FreshLoop = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var CATEGORIES = ["Bakery", "Meals", "Groceries", "Snacks & Drinks"];

  function newState() {
    return { listings: [], reservations: [], seq: 1 };
  }

  /** active = can be reserved, soldout = qty 0 left, expired = pickup window closed */
  function status(listing, now) {
    if (listing.withdrawn) return "withdrawn";
    if (now >= listing.pickupBy) return "expired";
    if (listing.qtyLeft <= 0) return "soldout";
    return "active";
  }

  function timeLeftMs(listing, now) {
    return Math.max(0, listing.pickupBy - now);
  }

  /** Urgency bucket drives the countdown colour in the UI. */
  function urgency(listing, now) {
    var m = timeLeftMs(listing, now) / 60000;
    if (m <= 0) return "over";
    if (m <= 30) return "critical";
    if (m <= 90) return "soon";
    return "ok";
  }

  function formatCountdown(ms) {
    var s = Math.floor(ms / 1000);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    function p(n) { return n < 10 ? "0" + n : "" + n; }
    return h > 0 ? h + ":" + p(m) + ":" + p(sec) : p(m) + ":" + p(sec);
  }

  function discountPercent(l) {
    return Math.round((1 - l.price / l.originalPrice) * 100);
  }

  /** Returns {ok:true, listing} or {ok:false, errors:[...]} */
  function createListing(state, d, now) {
    var errors = [];
    var name = (d.shopName || "").trim();
    var item = (d.item || "").trim();
    var qty = Number(d.qty);
    var orig = Number(d.originalPrice);
    var price = Number(d.price);
    if (!name) errors.push("Shop name is required.");
    if (!item) errors.push("Item name is required.");
    if (CATEGORIES.indexOf(d.category) < 0) errors.push("Pick a category.");
    if (!Number.isInteger(qty) || qty < 1 || qty > 200) errors.push("Quantity must be a whole number from 1 to 200.");
    if (!(orig > 0)) errors.push("Original price must be more than 0.");
    if (!(price >= 0)) errors.push("Discounted price cannot be negative.");
    if (orig > 0 && price >= orig) errors.push("Discounted price must be lower than the original price.");
    if (!(d.pickupBy > now)) errors.push("Pickup deadline must be in the future.");
    if (!(d.useBy > now)) errors.push("Use-by time must be in the future.");
    if (d.pickupBy > d.useBy) errors.push("Pickup deadline cannot be after the food's use-by time.");
    if (!(d.pickupNote || "").trim()) errors.push("Add a pickup note (where and who to ask for).");
    if (!d.safetyConfirmed) errors.push("Confirm the food is in-date and safe to eat.");
    if (errors.length) return { ok: false, errors: errors };

    var listing = {
      id: "L" + state.seq++,
      shopName: name,
      item: item,
      category: d.category,
      qtyTotal: qty,
      qtyLeft: qty,
      originalPrice: orig,
      price: price,
      pickupBy: d.pickupBy,
      useBy: d.useBy,
      pickupNote: d.pickupNote.trim(),
      createdAt: now,
      withdrawn: false
    };
    state.listings.push(listing);
    return { ok: true, listing: listing };
  }

  function findListing(state, id) {
    for (var i = 0; i < state.listings.length; i++) if (state.listings[i].id === id) return state.listings[i];
    return null;
  }

  function makeCode(state) {
    // Readable 4-char code without look-alike characters (no 0/O/1/I).
    var alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    var code, tries = 0;
    do {
      code = "";
      for (var i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
      tries++;
    } while (state.reservations.some(function (r) { return r.code === code; }) && tries < 50);
    return code;
  }

  var MAX_PER_RESERVATION = 5;

  function reserve(state, listingId, qty, customerName, now) {
    var l = findListing(state, listingId);
    var name = (customerName || "").trim();
    qty = Number(qty);
    if (!l) return { ok: false, error: "Listing not found." };
    if (!name) return { ok: false, error: "Enter your name for the pickup." };
    if (!Number.isInteger(qty) || qty < 1) return { ok: false, error: "Choose at least 1 item." };
    if (qty > MAX_PER_RESERVATION) return { ok: false, error: "You can reserve at most " + MAX_PER_RESERVATION + " per order." };
    var st = status(l, now);
    if (st === "expired") return { ok: false, error: "The pickup window has closed." };
    if (st === "withdrawn") return { ok: false, error: "The shop withdrew this listing." };
    if (st === "soldout") return { ok: false, error: "Sold out." };
    if (qty > l.qtyLeft) return { ok: false, error: "Only " + l.qtyLeft + " left." };
    l.qtyLeft -= qty;
    var r = {
      id: "R" + state.seq++,
      listingId: l.id,
      customerName: name,
      qty: qty,
      code: makeCode(state),
      createdAt: now,
      state: "reserved" // reserved | collected | cancelled | missed
    };
    state.reservations.push(r);
    return { ok: true, reservation: r };
  }

  /** Customers can cancel until 15 minutes before the pickup deadline; stock is returned. */
  var CANCEL_CUTOFF_MS = 15 * 60000;

  function cancelReservation(state, resId, now) {
    var r = state.reservations.filter(function (x) { return x.id === resId; })[0];
    if (!r) return { ok: false, error: "Reservation not found." };
    if (r.state !== "reserved") return { ok: false, error: "This order is already " + r.state + "." };
    var l = findListing(state, r.listingId);
    if (l && l.pickupBy - now < CANCEL_CUTOFF_MS) return { ok: false, error: "Too close to the pickup deadline to cancel." };
    r.state = "cancelled";
    if (l) l.qtyLeft += r.qty;
    return { ok: true };
  }

  /** Shop confirms handover by matching the customer's code. */
  function collect(state, listingId, code, now) {
    var c = (code || "").trim().toUpperCase();
    var r = state.reservations.filter(function (x) {
      return x.listingId === listingId && x.code === c;
    })[0];
    if (!r) return { ok: false, error: "No order with that code for this listing." };
    if (r.state === "collected") return { ok: false, error: "Already collected." };
    if (r.state !== "reserved") return { ok: false, error: "This order is " + r.state + "." };
    var l = findListing(state, listingId);
    if (l && now > l.pickupBy + 5 * 60000) return { ok: false, error: "Pickup window has closed." };
    r.state = "collected";
    return { ok: true, reservation: r };
  }

  function withdraw(state, listingId) {
    var l = findListing(state, listingId);
    if (!l) return { ok: false, error: "Listing not found." };
    var open = state.reservations.some(function (r) { return r.listingId === listingId && r.state === "reserved"; });
    if (open) return { ok: false, error: "Customers have open reservations. Hand them over first." };
    l.withdrawn = true;
    return { ok: true };
  }

  /** Mark reservations that nobody collected once the window has closed. */
  function sweepMissed(state, now) {
    var n = 0;
    state.reservations.forEach(function (r) {
      if (r.state !== "reserved") return;
      var l = findListing(state, r.listingId);
      if (l && now > l.pickupBy + 5 * 60000) { r.state = "missed"; n++; }
    });
    return n;
  }

  function stats(state) {
    var meals = 0, saved = 0;
    state.reservations.forEach(function (r) {
      if (r.state !== "collected") return;
      var l = findListing(state, r.listingId);
      if (!l) return;
      meals += r.qty;
      saved += r.qty * (l.originalPrice - l.price);
    });
    return { mealsRescued: meals, moneySaved: Math.round(saved * 100) / 100 };
  }

  return {
    CATEGORIES: CATEGORIES,
    MAX_PER_RESERVATION: MAX_PER_RESERVATION,
    newState: newState,
    status: status,
    timeLeftMs: timeLeftMs,
    urgency: urgency,
    formatCountdown: formatCountdown,
    discountPercent: discountPercent,
    createListing: createListing,
    findListing: findListing,
    reserve: reserve,
    cancelReservation: cancelReservation,
    collect: collect,
    withdraw: withdraw,
    sweepMissed: sweepMissed,
    stats: stats
  };
});
