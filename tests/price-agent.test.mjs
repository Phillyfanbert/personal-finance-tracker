// The price job, run for real against a made-up database and made-up Finnhub
// (tests/agent-net.mjs). What it must guarantee since 94: a symbol outside
// the public list is stored only as each following account's own copy, and
// what one account gets never depends on what another follows. Every symbol,
// id and figure here is invented.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { read, slice, evaluate } from "./source.mjs";

const AGENT = read("tools/price-agent.js");
const SHARED = "00000000-0000-0000-0000-000000000000";
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const PUBLIC = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "JPM", "V", "UNH",
  "XOM", "JNJ", "WMT", "PG", "MA", "HD", "DIS", "NFLX", "AMD", "KO", "SPY", "DIA", "QQQ", "IWM"];

const { planShares } = evaluate(
  slice(AGENT, "function planShares(accounts, budget, runIndex) {", "// Changes every 15 minutes"),
  {}, ["planShares"]);

function run(scenario, env) {
  const dir = mkdtempSync(join(tmpdir(), "price-agent-"));
  const scenarioPath = join(dir, "scenario.json");
  const logPath = join(dir, "log.json");
  writeFileSync(scenarioPath, JSON.stringify(scenario));
  const out = spawnSync(process.execPath, ["--import", new URL("./agent-net.mjs", import.meta.url).pathname, "tools/price-agent.js"], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH, TZ: "UTC",
      SUPABASE_URL: "https://fake.supabase.test", SUPABASE_SERVICE_ROLE_KEY: "fake",
      TAVILY_API_KEY: "fake", GEMINI_API_KEY: "fake", FINNHUB_API_KEY: "fake",
      FAKE_NET_SCENARIO: scenarioPath, FAKE_NET_LOG: logPath, ...env,
    },
  });
  assert.equal(out.status, 0, `the agent failed:\n${out.stdout}\n${out.stderr}`);
  return JSON.parse(readFileSync(logPath, "utf8"));
}

const writes = (log, table) => log.filter((e) => e.path === `/rest/v1/${table}` && e.method === "POST");
const rowsOf = (log, table) => writes(log, table).flatMap((e) => (Array.isArray(e.body) ? e.body : [e.body]));
const quotes = (log) => log.filter((e) => e.host === "finnhub.io" && e.path.endsWith("/quote")).map((e) => new URLSearchParams(e.query).get("symbol"));
const view = (rows, owner) => rows.filter((r) => r.owner === owner)
  .map((r) => `${r.symbol}:${r.headlines ? "news" : "-"}`).sort();

function baseScenario(extraAccounts = 0) {
  const assets = [
    { id: "a1", user_id: A, price_symbol: "ZZA" },
    { id: "a2", user_id: A, price_symbol: "AAPL" },
  ];
  const watchlist = [
    { id: "w1", user_id: A, symbol: "ZZA", company_name: "zza holdings" },
    { id: "w2", user_id: A, symbol: "ZZS", company_name: null },
    { id: "w3", user_id: A, symbol: "AAPL", company_name: "apple" },
    { id: "w4", user_id: B, symbol: "ZZS", company_name: null },
    { id: "w5", user_id: B, symbol: "ZZB", company_name: null },
  ];
  for (let k = 0; k < extraAccounts; k++) {
    const id = `cccccccc-0000-4000-8000-00000000000${k}`;
    for (let i = 1; i <= 50; i++) watchlist.push({ id: `x${k}-${i}`, user_id: id, symbol: `ZX${k}${String(i).padStart(2, "0")}`, company_name: null });
    // Every extra account also follows the symbol A and B share, which must
    // change nothing for A or B.
    watchlist.push({ id: `x${k}-s`, user_id: id, symbol: "ZZS", company_name: null });
  }
  return { now: "2026-11-18T15:05:00.000Z", assets, watchlist, findings: {}, daily: [], fundamentals: [] };
}

test("the public list is shared and every other symbol is stored only as its followers' own copies", () => {
  const log = run(baseScenario(), { FAST_ONLY: "1" });
  const market = rowsOf(log, "market_index_findings");
  const asset = rowsOf(log, "asset_price_findings");

  assert.deepEqual(market.filter((r) => r.owner === SHARED).map((r) => r.symbol).sort(), [...PUBLIC].sort());
  assert.deepEqual(asset.filter((r) => r.owner === SHARED).map((r) => r.symbol).sort(), [...PUBLIC].sort(),
    "a shared holding-price row is written for every public symbol, so one never says somebody owns it");
  for (const r of [...market, ...asset]) {
    if (r.owner === SHARED) assert.ok(PUBLIC.includes(r.symbol), `${r.symbol} was stored as a shared row`);
  }

  assert.deepEqual(view(asset, A), ["ZZA:news"], "A's holding copy is only what A owns outside the public list");
  assert.deepEqual(view(market, A), ["ZZA:news", "ZZS:news"]);
  assert.deepEqual(view(asset, B), [], "B owns nothing");
  assert.deepEqual(view(market, B), ["ZZB:news", "ZZS:news"]);

  const candles = log.filter((e) => e.path === "/rest/v1/daily_prices" && e.method === "POST");
  assert.ok(candles.every((e) => e.query.includes("on_conflict=symbol,trade_date,owner")));
  const keys = candles.flatMap((e) => e.body).map((c) => `${c.owner === SHARED ? "shared" : c.owner === A ? "A" : "B"}:${c.symbol}`);
  assert.deepEqual(keys.filter((k) => !k.startsWith("shared")).sort(), ["A:ZZA", "A:ZZS", "B:ZZB", "B:ZZS"]);

  const q = quotes(log);
  assert.equal(q.filter((s) => s === "ZZS").length, 1, "a symbol two accounts follow is fetched once and copied");
  assert.ok(q.length <= 150);
});

test("what an account gets is the same whether or not other accounts follow anything", () => {
  const alone = run(baseScenario(0), { FAST_ONLY: "1" });
  const crowded = run(baseScenario(3), { FAST_ONLY: "1" });
  for (const table of ["market_index_findings", "asset_price_findings"]) {
    for (const who of [A, B]) {
      assert.deepEqual(view(rowsOf(crowded, table), who), view(rowsOf(alone, table), who), `${table} for ${who} changed`);
    }
  }
  // Three accounts of 51 is more than the budget left, so each was cut to a
  // share, and the job still stayed within its budget.
  const extra = rowsOf(crowded, "market_index_findings").filter((r) => r.owner.startsWith("cccccccc"));
  assert.ok(extra.length > 0 && extra.length < 153);
  assert.ok(quotes(crowded).length <= 150);
});

test("each copy's headline comes from that account's own copies, never another's", () => {
  const scenario = baseScenario();
  const day = "2026-11-18";
  scenario.now = "2026-11-18T22:10:00.000Z";
  scenario.daily = [
    { symbol: "AAPL", trade_date: "2026-11-17", close: 100, owner: SHARED },
    { symbol: "AAPL", trade_date: day, close: 101, previous_close: 100, owner: SHARED },
    { symbol: "ZZS", trade_date: day, close: 20, owner: A },
    { symbol: "ZZS", trade_date: day, close: 20, owner: B },
  ];
  scenario.findings = {
    market_index_findings: [
      { symbol: "ZZS", owner: A, found_at: "2026-11-18T19:00:00.000Z",
        headlines: [{ title: "ZZS wins a contract", url: "https://news.example/zzs", source: "news.example" }] },
    ],
    asset_price_findings: [],
  };
  const log = run(scenario, { RECAP_ONLY: "1" });
  const stored = log.filter((e) => e.path === "/rest/v1/daily_prices" && e.method === "POST").flatMap((e) => e.body).filter((r) => r.headline);
  assert.deepEqual(stored.map((r) => [r.owner === A ? "A" : r.owner === B ? "B" : "shared", r.symbol]), [["A", "ZZS"]]);

  const funds = rowsOf(log, "symbol_fundamentals");
  assert.ok(funds.filter((r) => r.owner === SHARED).every((r) => PUBLIC.includes(r.symbol)));
  assert.deepEqual(funds.filter((r) => r.owner !== SHARED).map((r) => `${r.owner === A ? "A" : "B"}:${r.symbol}`).sort(),
    ["A:ZZA", "A:ZZS", "B:ZZB", "B:ZZS"]);
  const named = log.filter((e) => e.method === "PATCH" && e.path === "/rest/v1/watchlist_symbols" && /ZZ[ASB]/.test(e.query));
  assert.ok(named.length && named.every((e) => e.query.includes("user_id=eq.")), "an account's company name was filled into another account's row");
});

test("planShares gives every account an even share and depends on nobody else's symbols", () => {
  const acct = (id, n, p = "S") => ({ id, symbols: Array.from({ length: n }, (_, i) => `${p}${id}${i}`) });
  const all = (plan) => [...plan.values()].reduce((n, s) => n + s.size, 0);

  const roomy = planShares([acct("a", 3), acct("b", 5)], 100, 0);
  assert.equal(roomy.get("a").size, 3);
  assert.equal(roomy.get("b").size, 5);

  const tight = planShares([acct("a", 3), acct("b", 50), acct("c", 50)], 20, 7);
  assert.equal(tight.get("a").size, 3, "a small account is served in full before anyone gets extra");
  assert.ok(Math.abs(tight.get("b").size - tight.get("c").size) <= 1);
  assert.equal(all(tight), 20);

  // Only counts matter: swapping which symbols c follows (here, the same as
  // b's) changes nothing for a or b.
  const b = acct("b", 50);
  const shared = planShares([acct("a", 3), b, { id: "c", symbols: [...b.symbols] }], 20, 7);
  assert.deepEqual([...shared.get("a")], [...tight.get("a")]);
  assert.deepEqual([...shared.get("b")], [...tight.get("b")]);

  // Fewer calls than accounts: the turn moves, so nobody is left out for good.
  const many = Array.from({ length: 5 }, (_, i) => acct(`k${i}`, 4));
  const servedOver = new Set();
  for (let run = 0; run < 5; run++) {
    const plan = planShares(many, 2, run);
    assert.equal(all(plan), 2);
    for (const [id, set] of plan) if (set.size) servedOver.add(id);
  }
  assert.equal(servedOver.size, 5);

  // A window over a long list moves each run and covers the whole list.
  const seen = new Set();
  for (let run = 0; run < 10; run++) for (const s of planShares([acct("z", 10)], 3, run).get("z")) seen.add(s);
  assert.equal(seen.size, 10);
  assert.equal(planShares([], 10, 0).size, 0);
});
