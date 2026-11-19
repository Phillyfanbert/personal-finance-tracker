// The protections added by the 2026-11-19 security review, pinned so a later
// edit cannot quietly undo one. Each test reads the REAL source.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { APP, read, slice, evaluate } from "./source.mjs";
import { csvEscape } from "../app/export.js";
import { normalizeRow } from "../app/csvImport.js";

const HTML = read("app/index.html");
const csp = (() => {
  const m = HTML.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
  assert.ok(m, "index.html has no Content-Security-Policy");
  return Object.fromEntries(m[1].split(";").map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
})();

test("the policy comes before any script, and allows no eval and no unhashed inline script", () => {
  assert.ok(HTML.indexOf("Content-Security-Policy") < HTML.indexOf("<script"), "a script runs before the policy is read");
  for (const bad of ["'unsafe-eval'", "'unsafe-inline'", "*", "data:", "http:", "https:"]) {
    assert.ok(!csp["script-src"].includes(bad), `script-src allows ${bad}`);
  }
  assert.deepEqual(csp["object-src"], ["'none'"]);
  assert.deepEqual(csp["base-uri"], ["'none'"]);
});

test("every inline script is allowed by its exact hash, so editing one cannot pass unnoticed", () => {
  const inline = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(inline.length >= 1);
  for (const body of inline) {
    const hash = `'sha256-${createHash("sha256").update(body).digest("base64")}'`;
    assert.ok(csp["script-src"].includes(hash), `an inline script's hash ${hash} is not in script-src; recompute it`);
  }
  const hashes = csp["script-src"].filter((s) => s.startsWith("'sha256-"));
  assert.equal(hashes.length, inline.length, "script-src allows a hash no inline script has");
});

test("every library the page loads comes from an allowed origin, with an integrity hash", () => {
  const tags = [...HTML.matchAll(/<script src="(https:[^"]+)"([^>]*)>/g)];
  const loader = [...APP.matchAll(/s\.src = "(https:[^"]+)";\s*\n\s*s\.integrity = "(sha384-[^"]+)"/g)];
  assert.ok(loader.length === 1, "the spreadsheet loader has moved or lost its integrity hash");
  for (const [, url, attrs] of tags) {
    assert.ok(csp["script-src"].includes(new URL(url).origin), `${url} is not allowed by script-src`);
    assert.match(attrs, /integrity="sha384-/, `${url} has no integrity hash`);
    assert.match(attrs, /crossorigin="anonymous"/, `${url} is not loaded anonymously, so its hash is not checked`);
  }
  assert.ok(csp["script-src"].includes(new URL(loader[0][1]).origin));
  assert.doesNotMatch(loader[0][1], /xlsx@0\.18\./, "SheetJS 0.18 has published file-parsing flaws");
});

test("every link to outside the app goes through safeHref, which only allows web addresses", () => {
  const raw = [...APP.matchAll(/<a href="\$\{/g)].length;
  assert.equal(raw, 1, "a link is built from data without extLink(); a javascript: address would run when tapped");
  const { safeHref, extLink } = evaluate(slice(APP, "function safeHref(url) {", "// `severity` is"),
    { esc: (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`) }, ["safeHref", "extLink"]);
  assert.equal(safeHref("https://www.cnbc.com/a.html"), "https://www.cnbc.com/a.html");
  assert.equal(safeHref("http://example.com"), "http://example.com/");
  for (const bad of ["javascript:alert(1)", "javascript://cnbc.com/%0Aalert(1)", " JavaScript:alert(1)", "data:text/html,x", "vbscript:x", "/relative", "", null, undefined]) {
    assert.equal(safeHref(bad), null, `${bad} was allowed`);
  }
  assert.equal(extLink("javascript:alert(1)", "Title"), "<span>Title</span>");
  assert.match(extLink("https://x.com/a", "T", "color:red"), /^<a href="https:\/\/x\.com\/a" target="_blank" rel="noopener noreferrer" style="color:red">T<\/a>$/);
});

test("the server jobs store only web addresses", () => {
  for (const file of ["tools/price-agent.js", "tools/deal-agent.js"]) {
    const src = read(file);
    assert.match(src, /function hostAllowed\(urlStr, domains\) \{\n  if \(!isWebUrl\(urlStr\)\) return false;/, `${file} accepts a non-web address from search`);
  }
  assert.match(read("tools/price-agent.js"), /typeof a\.url === "string" && isWebUrl\(a\.url\.trim\(\)\)/, "news headlines are stored without checking the address");
});

test("a spreadsheet export never runs text as a formula, and the app still reads its own export", () => {
  assert.equal(csvEscape("=HYPERLINK(\"http://x\",\"y\")"), `"'=HYPERLINK(""http://x"",""y"")"`);
  for (const s of ["+1 555", "-10% off", "@SUM(A1)", "\t=1"]) assert.ok(csvEscape(s).replace(/^"/, "").startsWith("'"), s);
  for (const s of ["-30.00", "1,234.56", "-12.5%", "Groceries"]) assert.equal(csvEscape(s), s.includes(",") ? `"${s}"` : s);
  const back = normalizeRow(["2026-11-08", "'=SUM(A1)", "12.50"], { dateCol: 0, descCol: 1, amountCol: 2 }, { rowKind: "auto" });
  assert.equal(back.description, "=SUM(A1)");
  assert.equal(normalizeRow(["2026-11-08", "'twas the night", "1"], { dateCol: 0, descCol: 1, amountCol: 2 }, {}).description, "'twas the night");
});

test("every link between tables is held to one owner, the same list the restore orders by", () => {
  const sql = read("supabase/92_invite_only_and_same_owner.sql");
  const owned = {};
  for (const m of sql.matchAll(/on public\.(\w+)\s*\n\s*for each row execute function public\.check_same_owner\(([^)]*)\)/g)) {
    owned[m[1]] = Object.fromEntries([...m[2].matchAll(/'(\w+):(\w+)'/g)].map((x) => [x[1], x[2]]));
  }
  const restore = read("tools/restore-backup.mjs");
  const known = eval(`(${restore.slice(restore.indexOf("const KNOWN_FKS = ") + 18, restore.indexOf("};", restore.indexOf("const KNOWN_FKS = ")) + 1)})`);
  assert.deepEqual(owned, known);
});

test("anyone may sign up: the invitation gate from 92 is removed by 93", () => {
  const sql = read("supabase/93_open_signup_private_market_data.sql");
  assert.match(sql, /drop trigger if exists aa_signup_by_invite on auth\.users;/);
  assert.match(sql, /drop table if exists public\.allowed_signups;/);
  assert.doesNotMatch(APP, /has not been invited/, "the sign-in screen still talks about invitations");
});

// Anyone may make an account, so the shared market data must not show one
// person's choices to another. 93 limited each per-symbol table to symbols on
// the reader's own list, and a probe showed that was not enough: rows were
// shared, so listing every ticker revealed which ones had rows. Since 94 a
// symbol outside the public list exists only as each follower's own copy.
test("a symbol outside the public list is readable only as the reader's own copy", () => {
  const sql = read("supabase/94_own_copies_of_private_market_data.sql");
  for (const table of ["asset_price_findings", "market_index_findings", "daily_prices", "symbol_fundamentals"]) {
    const policy = sql.match(new RegExp(`create policy "[^"]+" on public\\.${table} for select\\s+using \\(([\\s\\S]*?)\\);`));
    assert.ok(policy, `${table} has no select policy in 94`);
    assert.match(policy[1], /owner = \(select auth\.uid\(\)\)/, `${table} does not show the reader its own copies`);
    assert.match(policy[1], /owner = '00000000-0000-0000-0000-000000000000'::uuid\s+and upper\(btrim\(symbol\)\) in \(select public\.public_symbols\(\)\)/,
      `${table} shows shared rows outside the public list`);
    assert.doesNotMatch(policy[1], /my_symbols/, `${table} still decides by the reader's list, which is what leaked`);
  }
  assert.match(read("supabase/93_open_signup_private_market_data.sql"),
    /lower\(btrim\(service\)\) in \(\s*select lower\(btrim\(name\)\) from public\.subscriptions where user_id = auth\.uid\(\)\)/,
    "deal findings are not limited to the reader's own subscription names");
});

test("the public list is the same in the database, the price job, the app and the live-price route", () => {
  const words = (text) => [...text.matchAll(/"([A-Z]+)"|'([A-Z]+)'/g)].map((m) => m[1] || m[2]).sort();
  const sql = read("supabase/94_own_copies_of_private_market_data.sql");
  const fromSql = words(sql.match(/select unnest\(array\[([^\]]+)\]\)/)[1]);
  const agent = read("tools/price-agent.js");
  const proxies = (src) => src.slice(src.indexOf("const MARKET_INDEX_ETF_PROXIES = {"), src.indexOf("};", src.indexOf("const MARKET_INDEX_ETF_PROXIES = {")));
  const valuesOf = (block) => [...block.matchAll(/:\s*"([A-Z]+)"/g)].map((m) => m[1]);
  const agentList = [...words(agent.slice(agent.indexOf("const DEFAULT_MOVERS_WATCHLIST = ["), agent.indexOf("];", agent.indexOf("const DEFAULT_MOVERS_WATCHLIST = [")))),
    ...valuesOf(proxies(agent))].sort();
  const appSeed = APP.slice(APP.indexOf("const DEFAULT_WATCHLIST = {"), APP.indexOf("};", APP.indexOf("const DEFAULT_WATCHLIST = {")));
  const appList = [...[...appSeed.matchAll(/\b([A-Z]+):/g)].map((m) => m[1]), ...valuesOf(proxies(APP))].sort();
  const worker = read("worker.js");
  const workerList = words(worker.slice(worker.indexOf("const PUBLIC_SYMBOLS = new Set(["), worker.indexOf("]);", worker.indexOf("const PUBLIC_SYMBOLS = new Set(["))));
  assert.equal(fromSql.length, 24);
  assert.deepEqual(agentList, fromSql);
  assert.deepEqual(appList, fromSql);
  assert.deepEqual(workerList, fromSql);
});

test("the deal job searches every service it knows, not the ones people subscribe to", () => {
  const deal = read("tools/deal-agent.js");
  assert.doesNotMatch(deal, /subscriptions\?select/, "the deal job reads people's subscriptions again, so a finding says someone pays for it");
  assert.match(deal, /sbGet\("service_domains\?select=service,domains&order=service"\)/);
});

test("the shared recap and news digest are built from the public list, never everyone's", () => {
  const agent = read("tools/price-agent.js");
  const body = (name) => agent.slice(agent.indexOf(`async function ${name}(`), agent.indexOf("\n}\n", agent.indexOf(`async function ${name}(`)));
  for (const name of ["buildDailyRecap", "fetchTrackedStockNews"]) {
    assert.match(body(name), /publicMoversList\(\)/, `${name} no longer uses the public list`);
    assert.doesNotMatch(body(name), /loadMoversWatchlist\(\)/, `${name} reads everyone's tracked list into a row every account can read`);
  }
  // The public list is the one in this public repository.
  assert.match(agent, /function publicMoversList\(\) \{\n  return \{ symbols: \[\.\.\.DEFAULT_MOVERS_WATCHLIST\], names: \{ \.\.\.DEFAULT_MOVER_COMPANY_NAMES \} \};/);
});
