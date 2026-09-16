// Every way money can reach or leave a user, and the code path that records it.
//
// The point of this file is that "the app covers every way money moves" stops
// being a claim somebody made once and becomes something a run can disagree
// with. It parses app/ rather than holding its own copy of the answer, so a
// path that gets renamed or deleted fails here instead of quietly rotting the
// way a hand-written coverage table would.
//
// Each entry names a real-world event, the mechanism that records it, and a
// marker that must still be present in the source. A DEFERRED entry is a way
// money really can move that this app deliberately does not model; it carries
// the reason, and it is listed rather than omitted so the gap stays visible.

import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const app = read("app/app.js");
const html = read("app/index.html");
const sql = read("supabase/01_schema.sql");

let passed = 0, failed = 0;
const ok = (cond, msg) => { if (cond) passed++; else { failed++; console.log(`  FAIL: ${msg}`); } };
const section = (t) => console.log(`\n--- ${t} ---`);

// direction: in = the user ends up with more money, out = less.
// A marker is a string that must appear in app.js (or html, when the path is
// markup-driven) for the path to still exist.
const PATHS = [
  // ---- money in ----------------------------------------------------------
  { dir: "in",  event: "Regular pay, logged when due",     via: "income table + autoLogDueIncome", marker: "async function autoLogDueIncome" },
  { dir: "in",  event: "A one-off payment, gift or sale",  via: "Money received",                  marker: '$("moneyInConfirmBtn")' },
  { dir: "in",  event: "Interest on a deposit account",    via: "autoLogSavingsInterest",          marker: "async function autoLogSavingsInterest" },
  { dir: "in",  event: "A dividend from a holding",        via: "dividend modal",                  marker: '$("dividendConfirmBtn")' },
  { dir: "in",  event: "Selling an investment",            via: "holding_sale",                    marker: '"holding_sale"' },
  { dir: "in",  event: "Money back on a purchase",         via: "negative expense",                marker: '$("refundConfirmBtn")' },
  { dir: "in",  event: "Imported pay from a bank file",    via: "CSV import, income rows",         marker: 'kind: "income"' },
  { dir: "in",  event: "Correcting a balance upward",      via: "asset_adjust",                    marker: '$("adjustAddBtn")' },
  { dir: "in",  event: "Moving money between own accounts", via: "transfer",                       marker: '"transfer",' },

  // ---- money out ---------------------------------------------------------
  { dir: "out", event: "Everyday spending",                via: "expenses / Quick Add",            marker: '$("saveBtn")' },
  { dir: "out", event: "A bill or subscription falling due", via: "autoLogDueSubscriptions",       marker: "async function autoLogDueSubscriptions" },
  { dir: "out", event: "Paying down a debt",               via: "liability_payment",               marker: '"liability_payment"' },
  { dir: "out", event: "Buying an investment",             via: "holding funding account",         marker: "costBasisDelta" },
  { dir: "out", event: "Putting new money into an investment", via: "contribution",                marker: '"contribution",' },
  { dir: "out", event: "Interest charged on a card",       via: "log interest charge",             marker: "data-log-interest" },
  { dir: "out", event: "A charge added to what is owed",   via: "owed_adjust",                     marker: '"owed_adjust"' },
  { dir: "out", event: "Correcting a balance downward",    via: "asset_adjust",                    marker: '$("adjustSubtractBtn")' },
  { dir: "out", event: "Imported spending from a bank file", via: "CSV import, expense rows",      marker: 'source: "import"' },
  { dir: "out", event: "Going overdrawn",                  via: "overdraft allowance",             marker: "overdraftAllowance" },
  { dir: "out", event: "An asset losing value over time",  via: "depreciation",                    marker: "depreciat" },

  // ---- neither: a plan for money already held ----------------------------
  { dir: "plan", event: "Setting money aside for a known cost", via: "sinking funds",              marker: "sinkingFundStatus" },
];

// Ways money really moves that this app does NOT record, each with the reason.
// Listed so the omission is a decision on the record rather than an oversight.
const DEFERRED = [
  { event: "Borrowing (a loan paying out cash)",
    why: "Recorded as two real events that already exist: raise the account balance (asset_adjust) and raise what is owed (owed_adjust). Net worth is correctly unchanged. IMPORTANT: Money received is the WRONG tool here, because borrowed money is not income and booking it that way would inflate both income and the savings rate - the same mistake booking a refund as income would make. A single combined action is the clearest candidate if this turns out to be common; it would also have to handle a loan that never touches a tracked account at all, such as a mortgage paid straight to a seller." },
  { event: "An overdraft or late fee",
    why: "A real fee is the bank's own per-item decision and is frequently waived, so there is no rule to compute it from. Recorded as an ordinary expense." },
  { event: "Dividends reinvested automatically",
    why: "No money leaves the investment, so there is nothing to credit. Recorded by adding to the holding." },
  { event: "Unrealised gain or loss on a holding",
    why: "Already shown live on the Investments tab from real prices. It is not a money movement until the holding is sold, which holding_sale covers." },
];

section("A. Every recorded way money moves");
for (const p of PATHS) {
  const found = app.includes(p.marker) || html.includes(p.marker);
  ok(found, `${p.dir.toUpperCase()} "${p.event}" should be recorded by ${p.via}, but its marker ${JSON.stringify(p.marker)} is gone`);
  if (found) console.log(`  ${p.dir.padEnd(4)} ${p.event.padEnd(44)} ${p.via}`);
}

section("B. Both directions are covered");
const ins = PATHS.filter((p) => p.dir === "in").length;
const outs = PATHS.filter((p) => p.dir === "out").length;
ok(ins >= 8, `only ${ins} ways money can come IN are recorded`);
ok(outs >= 9, `only ${outs} ways money can go OUT are recorded`);
console.log(`  ${ins} ways in, ${outs} ways out, ${PATHS.filter((p) => p.dir === "plan").length} that move no real money`);

section("C. Money in and money out stay distinguishable");
// A refund must NOT be stored as income: booking it that way would move both
// sides of the savings rate for one event and leave the category budget
// showing the full spend.
const refund = app.match(/\$\("refundConfirmBtn"\)\.onclick[\s\S]*?\n\};/);
ok(refund, "the refund handler has moved or gone");
if (refund) {
  ok(/amount: -amount/.test(refund[0]), "a refund must be stored as a NEGATIVE expense, not as income");
  ok(!/"income"/.test(refund[0]), "a refund must never be logged as income");
  ok(/applyLiabilityDelta/.test(refund[0]), "a refund onto a credit account must come off what is owed");
  console.log("  a refund reduces spending; it is never booked as income");
}
// A dividend is genuinely income and must be attributable to its holding.
const div = app.match(/\$\("dividendConfirmBtn"\)\.onclick[\s\S]*?\n\};/);
ok(div, "the dividend handler has moved or gone");
if (div) {
  ok(/"income"/.test(div[0]), "a dividend is money in and must be logged as income");
  ok(/dividendAsset\.id/.test(div[0]), "a dividend must carry asset_id so it is attributable to the holding");
  console.log("  a dividend is income, filed against the holding that paid it");
}

section("D. Every money event is reversible");
// Anything that moves money must be undoable, or a mistake is permanent.
const undo = app.match(/async function undoActivity\(row\)[\s\S]*?\n\}/)[0];
for (const kind of ["asset_adjust", "owed_adjust", "liability_payment", "contribution", "transfer", "income", "holding_sale"]) {
  ok(undo.includes(`"${kind}"`), `undoActivity has no branch for ${kind}, so it cannot be reversed`);
}
ok(/async function undoExpense/.test(app), "an expense must be undoable");
console.log("  every activity kind has an undo branch, and expenses have their own");

section("E. Deliberately not modelled");
for (const d of DEFERRED) console.log(`  ${d.event}`);
ok(DEFERRED.every((d) => d.why && d.why.length > 40), "every deferred path must carry a real reason");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
