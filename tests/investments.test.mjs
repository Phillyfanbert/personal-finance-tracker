// What a holding is worth when the 15-minute price feed has nothing for the
// day. Production showed the portfolio at exactly its cost basis on two
// Sunday evenings running, because the feed's rows had expired and the
// holding fell back to the value it was bought at.

import { test } from "node:test";
import assert from "node:assert/strict";
import { withDailyCloses, investmentHoldings, latestFinnhubRefresh, topMarketMovers } from "../app/investments.js";

const voo = { id: "voo", price_symbol: "VOO", quantity: 10, value: 7040.7, purchase_price: 7040.7 };
const closes = [
  { symbol: "VOO", trade_date: "2026-11-12", close: 668.0 },
  { symbol: "VOO", trade_date: "2026-11-13", close: 671.31 },
  { symbol: "VOO", trade_date: "2026-11-11", close: 660.0 },
  { symbol: "SECRET", trade_date: "2026-11-13", close: 5 },
];

test("on a weekend with no price at all, a holding is worth its last close, not what was paid", () => {
  const findings = withDailyCloses([], closes, ["VOO"]);
  const [h] = investmentHoldings([voo], findings);
  assert.equal(h.latestPrice, 671.31);
  assert.equal(h.currentValue, 6713.1);
  // The day change is the last session's, Friday against Thursday.
  assert.equal(h.dayChange, 33.1);
  assert.equal(h.gainLoss, -327.6);
  // Without the fill-in it fell back to cost, which is the production bug.
  assert.equal(investmentHoldings([voo], [])[0].currentValue, 7040.7);
});

test("on Monday the day change is against Friday's close, not 'no change yet'", () => {
  const monday = [{ symbol: "VOO", price: 675, found_at: "2026-11-16T15:00:00.000Z", extracted_by: "finnhub" }];
  const filled = withDailyCloses(monday, closes, ["VOO"]);
  const [h] = investmentHoldings([voo], filled);
  assert.equal(h.latestPrice, 675);
  assert.equal(h.priorPrice, 671.31);
  assert.equal(h.dayChange, 36.9);
  assert.equal(investmentHoldings([voo], monday)[0].dayChange, null, "without the fill-in Monday has no prior day");
});

test("a day that has a price keeps it, and only the symbols asked for are filled", () => {
  const friday = [{ symbol: "VOO", price: 672.5, found_at: "2026-11-13T20:45:00.000Z", extracted_by: "finnhub" }];
  const filled = withDailyCloses(friday, closes, ["voo"]);
  assert.equal(filled.filter((f) => f.extracted_by === "daily_close").length, 1, "only Thursday, which had no price, is filled");
  assert.equal(investmentHoldings([voo], filled)[0].latestPrice, 672.5);
  assert.ok(!filled.some((f) => f.symbol === "SECRET"), "a symbol nobody asked for was listed");
  assert.equal(withDailyCloses(friday, [], ["VOO"]), friday);
});

test("a filled-in close dates the prices line and feeds the market cards", () => {
  const filled = withDailyCloses([], closes, ["VOO"]);
  assert.equal(latestFinnhubRefresh(filled), "2026-11-13T21:00:00.000Z");
  const movers = topMarketMovers(["VOO"], filled, 3);
  assert.equal(movers.length, 1);
  assert.equal(movers[0].price, 671.31);
});
