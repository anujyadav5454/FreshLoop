const assert = require("assert");
const FL = require("./core.js");

const MIN = 60000;
const now = Date.UTC(2026, 9, 28, 12, 0, 0);
let state = FL.newState();

function good(over) {
  return Object.assign({
    shopName: "Sharma Bakery", item: "Veg puffs", category: "Bakery", qty: 10,
    originalPrice: 20, price: 8, pickupBy: now + 120 * MIN, useBy: now + 180 * MIN,
    pickupNote: "Ask at the counter for FreshLoop", safetyConfirmed: true
  }, over || {});
}

// --- validation
assert.ok(FL.createListing(state, good(), now).ok, "valid listing accepted");
const bad = (over, msg) => {
  const r = FL.createListing(state, good(over), now);
  assert.ok(!r.ok, msg);
  return r.errors.join(" | ");
};
bad({ qty: 0 }, "qty 0 rejected");
bad({ qty: 2.5 }, "fractional qty rejected");
bad({ price: 20 }, "price == original rejected");
bad({ price: 25 }, "price > original rejected");
bad({ price: -1 }, "negative price rejected");
bad({ pickupBy: now - MIN }, "past deadline rejected");
bad({ pickupBy: now + 200 * MIN }, "pickup after use-by rejected");
bad({ safetyConfirmed: false }, "safety confirmation required");
bad({ pickupNote: "  " }, "pickup note required");
bad({ category: "Weapons" }, "bad category rejected");
assert.strictEqual(state.listings.length, 1, "invalid listings not stored");

// --- reservations
const L = state.listings[0];
assert.strictEqual(FL.status(L, now), "active");
let r1 = FL.reserve(state, L.id, 3, "Anuj", now);
assert.ok(r1.ok); assert.strictEqual(L.qtyLeft, 7);
assert.match(r1.reservation.code, /^[A-HJ-NP-Z2-9]{4}$/);
assert.ok(!FL.reserve(state, L.id, 6, "Vipin", now).ok, "max per order enforced");
assert.ok(!FL.reserve(state, L.id, 8, "X", now).ok || FL.MAX_PER_RESERVATION >= 8);
assert.ok(!FL.reserve(state, L.id, 1, " ", now).ok, "name required");
let r2 = FL.reserve(state, L.id, 5, "Vipin", now);
assert.ok(r2.ok); assert.strictEqual(L.qtyLeft, 2);
let over = FL.reserve(state, L.id, 3, "Late", now);
assert.ok(!over.ok && /Only 2 left/.test(over.error), "cannot oversell");
assert.ok(FL.reserve(state, L.id, 2, "Rita", now).ok);
assert.strictEqual(FL.status(L, now), "soldout");
assert.ok(!FL.reserve(state, L.id, 1, "Z", now).ok, "sold out blocked");

// --- cancel returns stock
assert.ok(FL.cancelReservation(state, r2.reservation.id, now).ok);
assert.strictEqual(L.qtyLeft, 5);
assert.strictEqual(FL.status(L, now), "active");
assert.ok(!FL.cancelReservation(state, r2.reservation.id, now).ok, "double cancel blocked");
// cancel too close to deadline
const L2 = FL.createListing(state, good({ item: "Rolls", pickupBy: now + 10 * MIN, useBy: now + 60 * MIN }), now).listing;
const r3 = FL.reserve(state, L2.id, 1, "Tia", now).reservation;
assert.ok(!FL.cancelReservation(state, r3.id, now).ok, "late cancel blocked");

// --- collect by code
assert.ok(!FL.collect(state, L.id, "WRONG", now).ok);
assert.ok(FL.collect(state, L.id, r1.reservation.code.toLowerCase(), now).ok, "code is case-insensitive");
assert.ok(!FL.collect(state, L.id, r1.reservation.code, now).ok, "cannot collect twice");

// --- expiry
const later = now + 125 * MIN;
assert.strictEqual(FL.status(L, later), "expired");
assert.ok(!FL.reserve(state, L.id, 1, "Late", later).ok, "no reserving after deadline");
const missedBefore = state.reservations.filter(r => r.state === "reserved").length;
assert.strictEqual(FL.sweepMissed(state, later), 1, "only the 'Rolls' order (deadline +10m) is past its grace window; L is still inside it");
const swept = FL.sweepMissed(state, now + 130 * MIN);
assert.strictEqual(swept, 1, "Rita's uncollected order on L is now missed");
assert.ok(state.reservations.filter(r => r.listingId === L.id).every(r => r.state !== "reserved"));

// --- countdown + urgency
assert.strictEqual(FL.formatCountdown(65 * MIN + 5000), "1:05:05");
assert.strictEqual(FL.formatCountdown(9 * MIN + 3000), "09:03");
assert.strictEqual(FL.urgency({ pickupBy: now + 20 * MIN }, now), "critical");
assert.strictEqual(FL.urgency({ pickupBy: now + 60 * MIN }, now), "soon");
assert.strictEqual(FL.urgency({ pickupBy: now + 200 * MIN }, now), "ok");
assert.strictEqual(FL.urgency({ pickupBy: now - 1 }, now), "over");
assert.strictEqual(FL.discountPercent({ price: 8, originalPrice: 20 }), 60);

// --- withdraw guard
const L3 = FL.createListing(state, good({ item: "Bread" }), now).listing;
const r4 = FL.reserve(state, L3.id, 1, "A", now).reservation;
assert.ok(!FL.withdraw(state, L3.id).ok, "cannot withdraw with open reservation");
FL.collect(state, L3.id, r4.code, now);
assert.ok(FL.withdraw(state, L3.id).ok);
assert.strictEqual(FL.status(L3, now), "withdrawn");

// --- stats
const s = FL.stats(state);
assert.strictEqual(s.mealsRescued, 4); // 3 (r1) + 1 (r4)
assert.strictEqual(s.moneySaved, 4 * 12);

console.log("All FreshLoop core tests passed");
