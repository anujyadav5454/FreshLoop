# FreshLoop

Reduce food waste before closing time. Shops list in-date surplus food with a quantity, a discounted price and a pickup deadline. Customers reserve exact quantities and collect before the clock runs out.

Built by **Team ScoutRegiment** (Anuj Yadav, Vipin Sahani), Galgotias College of Engineering and Technology, for Build with Bharat 5.0.

## Run it

No install or build step. Open `index.html` in any modern browser.

To run the logic tests (needs Node.js 18+):

```bash
node test.js
```

## How to try it

1. **Find food** tab: six demo listings are preloaded. Pick a quantity, enter your name and press **Reserve**. You get a 4-character pickup code.
2. **Shop dashboard** tab: publish a new listing, or enter a customer's code under **Confirm handover** to complete a pickup.
3. Use **Reset demo data** in the footer to start over.

## Features

- Live expiry countdown on every offer (green, amber, red), sorted by soonest expiry
- Quantity reservation: stock drops immediately, so a listing cannot be oversold (max 5 units per order)
- Pickup codes confirm each handover; pay at the shop
- Customers can cancel until 15 minutes before the pickup deadline, and the stock returns
- Listings close at the pickup deadline; uncollected orders are marked missed after a 5-minute grace period
- Food-safety guardrails: shops must confirm the food is in-date and safe, and the pickup deadline cannot be later than the use-by time
- Impact counter: meals rescued and money saved

## Project structure

| File | Purpose |
|---|---|
| `index.html` | Page structure |
| `style.css` | Styling |
| `app.js` | User interface and browser storage |
| `core.js` | Framework-free logic: listings, reservations, expiry, codes |
| `test.js` | Automated tests for `core.js` |

## Limitations

This is a prototype. Data is stored in the browser's localStorage, so it is not shared between devices, and there is no login or real payment. Planned next: a realtime backend (such as Supabase or Firebase), phone OTP sign-in, UPI payments, maps and expiry alerts.
