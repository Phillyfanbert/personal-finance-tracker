// What a holding is worth when the 15-minute price feed has nothing for the
// day. Production showed the portfolio at exactly its cost basis on two
// Sunday evenings running, because the feed's rows had expired and the
// holding fell back to the value it was bought at.
//
// Every symbol and figure here is made up. This repository is public, so a
// fixture must never copy anyone's real holding.

import { test } from "node:test";
import assert from "node:assert/strict";
import { withDailyCloses, investmentHoldings, latestFinnhubRefresh, topMarketMovers, recapMovers, recapBreadthDetail } from "../app/investments.js";

const fund = { id: "fund", price_symbol: "ZZFND", quantity: 4, value: 2000, purchase_price: 2000 };
const closes = [
  { symbol: "ZZFND", trade_date: "2026-11-12", close: 480 },
  { symbol: "ZZFND", trade_date: "2026-11-13", close: 490 },
  { symbol: "ZZFND", trade_date: "2026-11-11", close: 470 },
  { symbol: "ZZOTHER", trade_date: "2026-11-13", close: 5 },
];

test("on a weekend with no price at all, a holding is worth its last close, not what was paid", () => {
  const findings = withDailyCloses([], closes, ["ZZFND"]);
  const [h] = investmentHoldings([fund], findings);
  assert.equal(h.latestPrice, 490);
  assert.equal(h.currentValue, 1960);
  // The day change is the last session's, Friday against Thursday.
  assert.equal(h.dayChange, 40);
  assert.equal(h.gainLoss, -40);
  // Without the fill-in it fell back to cost, which is the production bug.
  assert.equal(investmentHoldings([fund], [])[0].currentValue, 2000);
});

test("on Monday the day change is against Friday's close, not 'no change yet'", () => {
  const monday = [{ symbol: "ZZFND", price: 495, found_at: "2026-11-16T15:00:00.000Z", extracted_by: "finnhub" }];
  const filled = withDailyCloses(monday, closes, ["ZZFND"]);
  const [h] = investmentHoldings([fund], filled);
  assert.equal(h.latestPrice, 495);
  assert.equal(h.priorPrice, 490);
  assert.equal(h.dayChange, 20);
  assert.equal(investmentHoldings([fund], monday)[0].dayChange, null, "without the fill-in Monday has no prior day");
});

test("a day that has a price keeps it, and only the symbols asked for are filled", () => {
  const friday = [{ symbol: "ZZFND", price: 491.5, found_at: "2026-11-13T20:45:00.000Z", extracted_by: "finnhub" }];
  const filled = withDailyCloses(friday, closes, ["zzfnd"]);
  assert.equal(filled.filter((f) => f.extracted_by === "daily_close").length, 1, "only Thursday, which had no price, is filled");
  assert.equal(investmentHoldings([fund], filled)[0].latestPrice, 491.5);
  assert.ok(!filled.some((f) => f.symbol === "ZZOTHER"), "a symbol nobody asked for was listed");
  assert.equal(withDailyCloses(friday, [], ["ZZFND"]), friday);
});

test("a filled-in close dates the prices line and feeds the market cards", () => {
  const filled = withDailyCloses([], closes, ["ZZFND"]);
  assert.equal(latestFinnhubRefresh(filled), "2026-11-13T21:00:00.000Z");
  const movers = topMarketMovers(["ZZFND"], filled, 3);
  assert.equal(movers.length, 1);
  assert.equal(movers[0].price, 490);
});

// The recap's movers are worked out per person from their own prices, since
// the shared recap row is built over a public list (93).
test("the recap's movers are this person's own, largest first, each headline used once", () => {
  const prices = [
    { symbol: "ZZA", trade_date: "2026-11-17", close: 100 }, { symbol: "ZZA", trade_date: "2026-11-18", close: 92 },
    { symbol: "ZZB", trade_date: "2026-11-17", close: 200 }, { symbol: "ZZB", trade_date: "2026-11-18", close: 202 },
    { symbol: "ZZC", trade_date: "2026-11-17", close: 50 }, { symbol: "ZZC", trade_date: "2026-11-18", close: 50 },
    { symbol: "ZZD", trade_date: "2026-11-17", close: 400, previous_close: 400 }, { symbol: "ZZD", trade_date: "2026-11-18", close: 412 },
  ];
  const detail = recapBreadthDetail(prices, ["ZZA", "ZZB", "ZZC", "ZZD"], "2026-11-18");
  const shared = { title: "Two firms report", url: "https://x.example/a", source: "x.example" };
  const heads = { ZZA: { title: "ZZA falls", url: "https://x.example/g" }, ZZD: shared, ZZB: shared };
  const movers = recapMovers(detail, (s) => heads[s] || null);
  assert.deepEqual(movers.map((m) => [m.symbol, m.change_pct]), [["ZZA", -8], ["ZZD", 3], ["ZZB", 1]]);
  assert.equal(movers[0].headline.title, "ZZA falls");
  assert.equal(movers[1].headline.url, "https://x.example/a");
  assert.equal(movers[2].headline, null, "one article was shown twice");
  assert.ok(!movers.some((m) => m.symbol === "ZZC"), "a flat stock was listed as a mover");
  assert.deepEqual(recapMovers(null), []);
});
