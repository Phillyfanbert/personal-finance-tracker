// Loaded with --import before tools/price-agent.js runs, by
// tests/price-agent.test.mjs. Replaces the network with a made-up database
// and made-up Finnhub, records every request, and freezes the clock at a
// moment inside market hours so the run is the same every time. Waits are
// made instant. Every symbol and figure is invented.
//
// FAKE_NET_SCENARIO names a JSON file: { assets, watchlist, findings, daily }.
// FAKE_NET_LOG names the file the requests are written to on exit.

import { readFileSync, writeFileSync } from "node:fs";

const scenario = JSON.parse(readFileSync(process.env.FAKE_NET_SCENARIO, "utf8"));
const log = [];

const RealDate = Date;
const frozenStart = RealDate.parse(scenario.now || "2026-11-18T15:05:00.000Z");
const realStart = RealDate.now();
const fakeNow = () => frozenStart + (RealDate.now() - realStart);
class FakeDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : [fakeNow()])); }
  static now() { return fakeNow(); }
}
globalThis.Date = FakeDate;

const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, _ms, ...rest) => realSetTimeout(fn, 0, ...rest);

const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

// The handful of PostgREST filters the agent uses.
function filterRows(rows, params) {
  return rows.filter((row) => {
    for (const [key, value] of params) {
      if (["select", "order", "limit", "offset"].includes(key)) continue;
      const [op, ...rest] = value.split(".");
      const want = rest.join(".");
      const have = row[key];
      if (op === "eq" && String(have) !== want) return false;
      if (op === "neq" && String(have) === want) return false;
      if (op === "is" && want === "null" && have != null) return false;
      if (op === "not" && want === "is.null" && have == null) return false;
      if (op === "gte" && !(String(have) >= want)) return false;
      if (op === "in") {
        const list = want.replace(/^\(|\)$/g, "").split(",");
        if (!list.includes(String(have))) return false;
      }
    }
    return true;
  });
}

globalThis.fetch = async (input, opts = {}) => {
  const url = new URL(String(input));
  const method = (opts.method || "GET").toUpperCase();
  const body = opts.body ? JSON.parse(opts.body) : null;
  const entry = { method, host: url.host, path: url.pathname, query: url.search, body };
  log.push(entry);

  if (url.host === "finnhub.io") {
    const symbol = url.searchParams.get("symbol");
    if (url.pathname.endsWith("/quote")) {
      const h = hash(symbol);
      const c = 50 + (h % 400);
      return json({ c, d: 1, dp: (h % 11) - 5, h: c + 1, l: c - 1, o: c - 0.5, pc: c - 1, t: Math.floor(frozenStart / 1000) });
    }
    if (url.pathname.endsWith("/company-news")) {
      return json([{ headline: `${symbol} reports a quarter`, url: `https://news.example/${symbol}`, source: "news.example", datetime: 1, summary: `What ${symbol} said about the quarter in a full sentence.` }]);
    }
    if (url.pathname.endsWith("/stock/profile2")) return json({ name: `${symbol} Holdings`, marketCapitalization: 1000, finnhubIndustry: "Made-up" });
    if (url.pathname.endsWith("/stock/metric")) return json({ metric: { peTTM: 12 } });
    return json({}, 404);
  }
  if (url.host === "api.tavily.com") return json({ results: [] });
  if (url.host.includes("googleapis.com")) return json({ error: { message: "not in this test" } }, 400);

  if (url.pathname.startsWith("/rest/v1/")) {
    const table = url.pathname.slice("/rest/v1/".length);
    if (method === "GET") {
      const source = { assets: scenario.assets, watchlist_symbols: scenario.watchlist,
        asset_price_findings: scenario.findings?.asset_price_findings, market_index_findings: scenario.findings?.market_index_findings,
        daily_prices: scenario.daily, symbol_fundamentals: scenario.fundamentals }[table] || [];
      if (Number(url.searchParams.get("offset") || 0) > 0) return json([]);
      const rows = filterRows(source, url.searchParams);
      const [col, dir] = (url.searchParams.get("order") || "").split(",")[0].split(".");
      if (col) rows.sort((x, y) => (String(x[col]) < String(y[col]) ? -1 : String(x[col]) > String(y[col]) ? 1 : 0) * (dir === "desc" ? -1 : 1));
      return json(rows);
    }
    if (method === "DELETE") return new Response(null, { status: 204, headers: { "content-range": "*/0" } });
    return new Response(null, { status: method === "POST" ? 201 : 204 });
  }
  return json({ error: `no fake for ${url}` }, 500);
};

process.on("exit", () => writeFileSync(process.env.FAKE_NET_LOG, JSON.stringify(log)));
