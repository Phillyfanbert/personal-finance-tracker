#!/usr/bin/env node
// Regenerates app/secTickers.js from SEC's own company_tickers.json.
//
//   node tools/generate-sec-tickers.mjs
//
// WHY THIS EXISTS. app/tickers.js is a hand-curated 383-name list. It covers
// household brands well and is genuinely gappy past them - DECK (Deckers) is
// absent and that is an S&P 500 constituent - so typing a real company's name
// could find nothing and imply the company did not exist. This is the bulk
// source that closes that gap: ~10,400 tickers, no key, no card, one static
// file, so the app still makes zero runtime calls for it.
//
// THE OUTPUT IS A SEARCH INDEX AND NOTHING ELSE. SEC's `title` is the EDGAR
// conformed name in inconsistent case - "NVIDIA CORP", "JPMORGAN CHASE & CO",
// "Apple Inc." - which is exactly the long legal form app/tickers.js's own
// header forbids storing, because watchlist_symbols.company_name is matched as
// a WHOLE PHRASE against real headline text by price-agent.js's
// pickRelevantHeadline(). A legal name essentially never appears in a headline,
// so writing one would silently stop that symbol ever matching news. Whatever
// picks a suggestion must store TICKER_NAMES[symbol] ?? null, never the title
// from this file.
//
// The generated file is PURE DATA on purpose - no loader, no helpers - so
// regenerating it can never clobber hand-written code. The lazy loader lives
// in app/tickers.js.
//
// SEC requires a descriptive User-Agent and returns 403 without an acceptable
// one. Tested live, and the shape matters more than the wording: "<name>
// <email>" is accepted, while a parenthesised contact
// ("... (contact via GitHub)") and a browser-like Mozilla/5.0 string are both
// REFUSED. The default below is a placeholder rather than a real inbox - set
// SEC_CONTACT to your own address if you would rather SEC could reach you,
// which is what their fair-access policy actually asks for.
import { writeFileSync } from "node:fs";

const URL_SEC = "https://www.sec.gov/files/company_tickers.json";
const OUT = new URL("../app/secTickers.js", import.meta.url);
const CONTACT = process.env.SEC_CONTACT || "personal-finance-tracker admin@example.com";

// A ticker this app could never price or validate anyway. SEC lists share
// classes with dots and dashes (BRK-B, BF.B) which are real and kept; this
// only drops genuinely unusable rows.
const USABLE = /^[A-Z][A-Z.\-]{0,9}$/;

// EDGAR appends the state of incorporation to a conformed name, so 212 titles
// read "ABM INDUSTRIES INC /DE/" and three carry a bare "/NEW" (a re-filed
// registrant record). Neither is part of the company's name and both look like
// a rendering fault in a dropdown. Stripped HERE rather than at render time so
// it costs nothing at runtime.
//
// Matched against a real state list rather than a generic /XX/ pattern,
// because the same slash carries meaning elsewhere: "Adyen N.V./ADR" and
// "Adaro Energy PT/ADR/" are American Depositary Receipts, which is a genuine
// distinction from the ordinary share and must survive.
const STATE_CODES = new Set(("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO "
  + "MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR VI GU AS MP X1 NEW")
  .split(" "));
const cleanTitle = (t) => t.replace(/[\/\\]([A-Z0-9]{2,3})[\/\\]?\s*$/i, (whole, code) =>
  STATE_CODES.has(code.toUpperCase()) ? "" : whole).trim();

const res = await fetch(URL_SEC, { headers: { "User-Agent": CONTACT, Accept: "application/json" } });
if (!res.ok) {
  console.error(`SEC returned HTTP ${res.status}. A 403 almost always means the User-Agent was rejected.`);
  process.exit(1);
}
const raw = await res.json();

// The file is an object keyed by row index, not an array:
//   { "0": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." }, ... }
const rows = Object.values(raw);
if (!rows.length) {
  console.error("SEC returned no rows - refusing to write an empty index.");
  process.exit(1);
}

const names = {};
let skipped = 0;
let collisions = 0;
for (const row of rows) {
  const symbol = String(row?.ticker || "").trim().toUpperCase();
  const title = cleanTitle(String(row?.title || ""));
  if (!symbol || !title || !USABLE.test(symbol)) { skipped++; continue; }
  // First wins. The file is ordered by CIK and a repeated ticker is a stale
  // or secondary registrant rather than a better name for the same company.
  if (names[symbol]) { collisions++; continue; }
  names[symbol] = title;
}

const symbols = Object.keys(names).sort();
const body = symbols.map((s) => `  ${/^[A-Z][A-Z0-9]*$/.test(s) ? s : JSON.stringify(s)}: ${JSON.stringify(names[s])},`).join("\n");

const file = `// GENERATED FILE - DO NOT EDIT BY HAND.
// Regenerate with:  node tools/generate-sec-tickers.mjs
//
// Every ticker SEC itself publishes, from company_tickers.json, fetched
// ${new Date().toISOString().slice(0, 10)}. ${symbols.length} symbols.
//
// THIS IS A SEARCH INDEX, NEVER A SOURCE OF STORED NAMES. These titles are
// EDGAR conformed names in inconsistent case ("NVIDIA CORP", "JPMORGAN CHASE
// & CO"), which is the long legal form app/tickers.js's header forbids
// storing: watchlist_symbols.company_name is matched as a whole phrase against
// real headline text by price-agent.js's pickRelevantHeadline(), and a legal
// name essentially never appears in a headline. On pick, store
// TICKER_NAMES[symbol] ?? null.
//
// Covers US SEC registrants only - no crypto, and most mutual funds file
// separately - so app/tickers.js's curated lists remain the answer for those.
// Loaded ON DEMAND (see loadSecTickers in app/tickers.js) and deliberately NOT
// in sw.js's SHELL: it is far too large to precache on a first visit.
export const SEC_TICKER_NAMES = {
${body}
};
`;

writeFileSync(OUT, file);
const kb = (Buffer.byteLength(file) / 1024).toFixed(1);
console.log(`Wrote app/secTickers.js`);
console.log(`  ${symbols.length} symbols (${rows.length} rows in, ${skipped} unusable, ${collisions} duplicate tickers)`);
console.log(`  ${kb} KB`);
for (const probe of ["AAPL", "NVDA", "JPM", "DECK", "COST"]) {
  console.log(`  ${probe.padEnd(6)}${names[probe] ?? "-- absent --"}`);
}
