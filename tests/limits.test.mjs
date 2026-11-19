// What the app does with the limits the database now holds (94, 95): a
// refusal is said in words, a long import line is trimmed rather than
// refusing the whole file, and live prices are asked for in batches the
// route accepts. Each test runs the REAL code sliced out of app/app.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { APP, read, slice, evaluate } from "./source.mjs";

const { limitRefusal, dbMessage } = evaluate(
  slice(APP, "function limitRefusal(error) {", "function moneyRefusal(error) {"), {}, ["limitRefusal", "dbMessage"]);

test("every limit the database can refuse with is said in words", () => {
  for (const message of ["symbol_limit", "row_limit", "history_limit"]) {
    const said = limitRefusal({ code: "P0001", message });
    assert.ok(said && !said.includes("_"), `${message} reached the screen as a code`);
  }
  const long = limitRefusal({ code: "23514", message: 'new row for relation "expenses" violates check constraint "expenses_description_length"' });
  assert.match(long, /longer than the app keeps/);
  const shape = limitRefusal({ code: "23514", message: 'new row for relation "watchlist_symbols" violates check constraint "watchlist_symbols_symbol_shape"' });
  assert.match(shape, /letters, numbers, dots and dashes/);
  // Anything else is left to the caller, and dbMessage falls back to the
  // database's own words.
  assert.equal(limitRefusal({ code: "23514", message: "expenses_amount_check" }), null);
  assert.equal(dbMessage({ code: "42501", message: "permission denied" }), "permission denied");
  assert.equal(limitRefusal(null), null);
});

test("no refused write shows the database's raw words where a limit could be the reason", () => {
  assert.doesNotMatch(APP, /toast\(error\.message/, "a write toasts error.message directly, so a limit would show as a code");
  const money = slice(APP, "function moneyRefusal(error) {", "\n}\n");
  assert.match(money, /const limit = limitRefusal\(error\);\s+if \(limit\) return limit;/);
});

test("live prices are asked for in batches the route accepts, and one failed batch keeps the rest", async () => {
  const worker = read("worker.js");
  const routeMax = Number(worker.match(/const MAX_SYMBOLS_PER_REQUEST = (\d+);/)[1]);
  const asked = [];
  const fakeFetch = async (url) => {
    const symbols = decodeURIComponent(new URL(url, "https://app.example").searchParams.get("symbols")).split(",");
    asked.push(symbols.length);
    if (symbols.includes("FAILME")) return { ok: false };
    return { ok: true, json: async () => ({ quotes: Object.fromEntries(symbols.map((s) => [s, { price: 1 }])) }) };
  };
  const sb = { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } };
  const { fetchLiveQuotes, QUOTE_BATCH } = evaluate(
    slice(APP, "const QUOTE_BATCH = 40;", "// Two rows per symbol, not one."), { sb, fetch: fakeFetch }, ["fetchLiveQuotes", "QUOTE_BATCH"]);
  assert.ok(QUOTE_BATCH <= routeMax, "a batch is bigger than the route accepts");

  const symbols = Array.from({ length: 74 }, (_, i) => `ZS${i}`);
  const quotes = await fetchLiveQuotes(symbols);
  assert.deepEqual(asked, [40, 34]);
  assert.equal(Object.keys(quotes).length, 74);

  asked.length = 0;
  const mixed = await fetchLiveQuotes([...symbols.slice(0, 39), "FAILME", ...symbols.slice(39)]);
  assert.equal(Object.keys(mixed).length, 35, "the batch that worked was thrown away with the one that failed");
  assert.equal(await fetchLiveQuotes(["FAILME"]), null);
});

test("an imported line longer than the database keeps is trimmed, not refused", async () => {
  const { normalizeRow } = await import("../app/csvImport.js");
  const row = normalizeRow(["2026-11-08", "x".repeat(900), "12.50", "c".repeat(300)], { dateCol: 0, descCol: 1, amountCol: 2, categoryCol: 3 }, { rowKind: "auto" });
  assert.equal(row.description.length, 500);
  assert.equal(row.category.length, 100);
  const sql = read("supabase/95_storage_limits.sql");
  assert.match(sql, /expenses_description_length check \(length\(description\) <= 500\)/);
  assert.match(sql, /expenses_category_length check \(length\(category\) <= 100\)/);
});

test("every text input that saves to the database carries the database's limit or less", () => {
  const html = read("app/index.html");
  const sql = read("supabase/95_storage_limits.sql");
  const limitOf = (table, column) => Number((sql.match(new RegExp(`${table}_${column}_length check \\(length\\(${column}\\) <= (\\d+)\\)`)) || [])[1]);
  const pairs = { fDesc: ["expenses", "description"], eDesc: ["expenses", "description"], eNote: ["expenses", "note"], quick: ["expenses", "raw_input"],
    sName: ["subscriptions", "name"], sNotes: ["subscriptions", "notes"], assetName: ["assets", "name"], debtName: ["liabilities", "name"],
    incSource: ["income", "source"], incNotes: ["income", "notes"], fundName: ["sinking_funds", "name"], fundNotes: ["sinking_funds", "notes"],
    pName: ["profiles", "display_name"], pNotes: ["profiles", "notes"], pGoals: ["profiles", "financial_goals"], acctBank: ["accounts", "bank_name"],
    watchlistNewName: ["watchlist_symbols", "company_name"], moneyInDesc: ["account_activity", "description"] };
  for (const [id, [table, column]] of Object.entries(pairs)) {
    const tag = html.match(new RegExp(`<(?:input|textarea)\\b[^>]*\\bid="${id}"[^>]*>`));
    assert.ok(tag, `${id} is gone from the page`);
    const max = Number((tag[0].match(/maxlength="(\d+)"/) || [])[1]);
    const limit = limitOf(table, column);
    assert.ok(limit > 0, `no database limit found for ${table}.${column}`);
    assert.ok(max > 0 && max <= limit, `${id} allows ${max || "any length"}, the database keeps ${limit}`);
  }
});
