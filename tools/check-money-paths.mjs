// Every way money can reach or leave a user, and the code path that records it.
//
// The point of this file is that "the app covers every way money moves" stops
// being a claim somebody made once and becomes something a run can disagree
// with. It parses app/ rather than holding its own copy of the answer, so a
// path that gets renamed or deleted fails here instead of quietly rotting the
// way a hand-written coverage table would.
//
// Each entry names a real-world event, the mechanism that records it, and a
// marker that must still be present in the source.
//
// A marker must name something only the LIVE CODE can satisfy: an import
// specifier, a handler assignment, a call together with its arguments. The
// first version used bare substrings like "depreciat", which any passing
// comment kept green long after the implementation could have been deleted,
// which is exactly the checker-agrees-with-a-drifting-app failure this file
// exists to prevent. Section A strips comments before matching, so a marker
// that survives only in prose now fails. A DEFERRED entry is a way
// money really can move that this app deliberately does not model; it carries
// the reason, and it is listed rather than omitted so the gap stays visible.

import { readFileSync, readdirSync } from "node:fs";

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
  { dir: "in",  event: "Selling an investment",            via: "holding_sale",                    marker: 'activityStep("holding_sale"' },
  { dir: "in",  event: "Money back on a purchase",         via: "negative expense",                marker: '$("refundConfirmBtn")' },
  { dir: "in",  event: "Imported pay from a bank file",    via: "CSV import, income rows",         marker: "csvLastImportedActivityIds" },
  { dir: "in",  event: "Correcting a balance upward",      via: "asset_adjust",                    marker: '$("adjustAddBtn")' },
  // The monthly check-in moves balances in either direction, through the same
  // two setters the account and debt panels use, so it is listed once per
  // side and each marker names a call only the live sheet makes.
  { dir: "in",  event: "Monthly balance check-in",         via: "setAssetBalance / setOwedBalance", marker: "await setAssetBalance(c.target, c.value)" },
  { dir: "in",  event: "Moving money between own accounts", via: "transfer",                       marker: '"transfer", `Transferred' },

  // ---- money out ---------------------------------------------------------
  { dir: "out", event: "Everyday spending",                via: "expenses / Quick Add",            marker: '$("saveBtn")' },
  { dir: "out", event: "A bill or subscription falling due", via: "autoLogDueSubscriptions",       marker: "async function autoLogDueSubscriptions" },
  { dir: "out", event: "Paying down a debt",               via: "liability_payment",               marker: '"liability_payment", `Paid' },
  { dir: "out", event: "A bill that pays down a debt",     via: "payBillTowardDebt",               marker: "function payBillTowardDebt(sub, occurredAt)" },
  { dir: "out", event: "Buying an investment",             via: "holding funding account",         marker: "const costBasisDelta" },
  { dir: "out", event: "Putting new money into an investment", via: "contribution",                marker: '"contribution", `Contributed' },
  { dir: "out", event: "Interest charged on a card",       via: "autoAccrueCardInterest",         marker: "async function autoAccrueCardInterest" },
  { dir: "out", event: "Interest charged on a loan",       via: "autoAccrueLoanInterest",          marker: "async function autoAccrueLoanInterest" },
  { dir: "out", event: "A charge added to what is owed",   via: "owed_adjust",                     marker: '"owed_adjust", reason' },
  { dir: "out", event: "Correcting a balance downward",    via: "asset_adjust",                    marker: '$("adjustSubtractBtn")' },
  { dir: "out", event: "Monthly balance check-in",         via: "setAssetBalance / setOwedBalance", marker: "await setOwedBalance(c.target, c.value)" },
  { dir: "out", event: "Imported spending from a bank file", via: "CSV import, expense rows",      marker: "csvLastImportedIds" },
  { dir: "out", event: "Going overdrawn",                  via: "overdraft allowance",             marker: "function overdraftAllowance" },
  { dir: "out", event: "An asset losing value over time",  via: "depreciation",                    marker: 'from "./depreciation.js"' },

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
// Comments are prose, not implementation: a path counts as present only if
// its marker survives their removal.
const stripComments = (src) => src
  .split("\n")
  .filter((l) => !l.trim().startsWith("//"))
  .join("\n")
  .replace(/<!--[\s\S]*?-->/g, "");
const appCode = stripComments(app);
const htmlCode = stripComments(html);

for (const p of PATHS) {
  const found = appCode.includes(p.marker) || htmlCode.includes(p.marker);
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
  ok(/chargeSteps\(original\.account_id, amount, -1\)/.test(refund[0]), "a refund onto a credit account must come off what is owed");
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
// Split into the real branches, so each can be checked for WORK rather than
// only for its own name appearing somewhere in the function. The first version
// asserted `undo.includes('"holding_sale"')`, which an empty
// `} else if (row.kind === "holding_sale") {}` would have satisfied just as
// well as a real reversal - and an absent branch was the only failure it could
// actually catch.
const branches = undo.split(/(?:\} else )?if \(row\.kind === /).slice(1);
const branchFor = (kind) => branches.find((b) => b.startsWith(`"${kind}"`));
for (const kind of ["asset_adjust", "owed_adjust", "liability_payment", "contribution", "transfer", "income", "holding_sale"]) {
  const b = branchFor(kind);
  ok(b, `undoActivity has no branch for ${kind}, so it cannot be reversed`);
  // A reversal has to WRITE something back. Every branch here restores a
  // balance, a quantity or an owed amount (as a step in the transaction that
  // also removes the row), so one of these must appear.
  if (b) ok(/assetMove\(|debtMove\(|op: "update"|op: "delete"/.test(b), `undoActivity's ${kind} branch writes nothing, so it deletes the history row without reversing anything`);
}
ok(/async function undoExpense/.test(app), "an expense must be undoable");
console.log(`  ${branches.length} undo branches, each writing a reversal, plus undoExpense`);

section("E. Every balance change is one transaction");
// 86_apply_money.sql exists because balances were written as finished figures
// from a device's own copy, in requests nobody checked. Anything that moves a
// balance must go through moneyTx(); a direct write would bring both failures
// back without anything else noticing.
const code = app.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
ok(!/\bapplyAssetDelta\(|\bapplyLiabilityDelta\(/.test(code), "applyAssetDelta/applyLiabilityDelta are back; balances must move through moneyTx()");
ok(/sb\.rpc\("apply_money"/.test(code), "moneyTx() no longer calls apply_money");
const direct = [...code.matchAll(/from\("(assets|liabilities)"\)\.update\(\{ ?(value|balance)\b/g)];
// The two price syncs are the only writers allowed to set a value outright:
// a holdings total follows live prices, it is not a movement of money.
ok(direct.length === 2, `${direct.length} direct balance writes outside moneyTx() (expected only the two price syncs)`);
// The LATEST definition is the one the database runs, so a later migration
// that quietly brought the $0 floor back would be caught here.
// A sale shrinks the holding's own stored value with its shares, and undoing
// it puts the value back. That value is what counts for a holding with no
// live price, so leaving it whole counted sold shares as still owned.
ok(/set: \{ quantity: remainingQty, purchase_price: remainingBasis, value: remainingValue \}/.test(code),
  "a sale no longer scales the holding's stored value with its shares");
ok(/set: \{ quantity: restoredQty, purchase_price: restoredBasis, value: restoredValue \}/.test(code),
  "undoing a sale no longer restores the holding's stored value");
// An import is all or nothing. It was separate batches of 500, so a dropped
// connection left part of a file in and a retry added that part twice. It
// moves no balance either way: the bank's figure already includes it.
const csvImport = code.match(/\$\("csvImportConfirm"\)\.onclick[\s\S]*?\n\};/);
ok(csvImport && /await moneyTx\(steps/.test(csvImport[0]) && !/sb\.from\(/.test(csvImport[0]),
  "the CSV import no longer saves as one transaction through moneyTx()");
ok(csvImport && !/op: "(asset|liability)"|chargeSteps\(/.test(csvImport[0]), "the CSV import moves a balance, which counts imported history twice");
const moneyFn = readdirSync(new URL("../supabase/", import.meta.url))
  .filter((f) => /^\d+_.*\.sql$/.test(f)).sort((a, b) => parseInt(a) - parseInt(b))
  .map((f) => read(`supabase/${f}`)).filter((sql) => sql.includes("function public.apply_money")).at(-1) || "";
ok(/raise exception using errcode = 'P0001', message = 'money_floor'/.test(moneyFn), "apply_money no longer refuses a spend below the floor");
// Flooring what is owed at $0 is how money vanished: an overpayment, then a
// charge taken back after the card was paid off. Refused, never floored (90).
ok(!/nxt := 0;/.test(moneyFn), "apply_money floors what is owed at $0 again instead of refusing");
const debtMoveFn = code.match(/function debtMove\([\s\S]*?\n\}/);
ok(debtMoveFn && /if \(d < 0\) step\.strict = true/.test(debtMoveFn[0]), "debtMove() no longer marks every lowering of a debt strict");
console.log(`  balances move only through apply_money(), plus ${direct.length} price syncs`);

section("F. Deliberately not modelled");
for (const d of DEFERRED) console.log(`  ${d.event}`);
ok(DEFERRED.every((d) => d.why && d.why.length > 40), "every deferred path must carry a real reason");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
