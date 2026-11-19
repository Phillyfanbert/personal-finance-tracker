// The steps every money action is built from (app.js), run from the real source.
//
// Each balance step travels to the database with the limits that should judge
// it: the account's floor on money going out, the card's limit on a real
// purchase, and "strict" on anything that lowers a debt. Getting one
// of those wrong is how this app has lost money before, so the shapes are
// pinned here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { APP, slice, evaluate } from "./source.mjs";

const helpers = slice(APP, "const OVERDRAFT_ELIGIBLE_ASSET_TYPES = new Set([", "// ---- ONE TRANSACTION PER MONEY ACTION")
  + slice(APP, "const cents = (n) =>", "// Runs one money action.")
  + slice(APP, "function netByLiability(deltas)", "function creditLimitError(deltas)");

function load({ assets = [], debts = [], accounts = [], allExpenses = [] } = {}) {
  return evaluate(helpers, {
    assets, debts, accounts, allExpenses,
    CREDIT_LIMIT_LIABILITY_TYPES: new Set(["credit_card", "charge_card", "bnpl", "heloc"]),
    creditLimitNoun: () => "credit limit",
    localDateISO: () => "2026-11-19",
    fmt: (n) => (Number(n) < 0 ? "-$" : "$") + Math.abs(Number(n)).toFixed(2),
    isImported: (row) => row.source === "import",
  }, ["assetMove", "debtMove", "chargeSteps", "editChargeSteps", "activityStep", "claimStep", "moneyRefusal",
      "refundedPurchasesIn", "spendFloor", "takeBackError", "owedFloorError", "REFUNDED_PURCHASE_MESSAGE"]);
}

const world = () => ({
  assets: [
    { id: "chk", name: "Checking", type: "bank", value: 2500, overdraft_limit: 100 },
    { id: "cash", name: "Cash", type: "cash", value: 40, overdraft_limit: 100 },
  ],
  debts: [{ id: "visa", name: "Visa", type: "credit_card", balance: 300, credit_limit: 1000 }],
  accounts: [
    { id: "a-chk", linked_asset_id: "chk" },
    { id: "a-cash", linked_asset_id: "cash" },
    { id: "a-visa", linked_liability_id: "visa" },
  ],
});

test("a purchase from checking carries the floor, overdraft included", () => {
  const m = load(world());
  assert.deepEqual(m.chargeSteps("a-chk", 14, +1).filter(Boolean),
    [{ op: "asset", id: "chk", delta: -14, floor: -100 }]);
});

test("an overdraft on a type that cannot be overdrawn is ignored", () => {
  const m = load(world());
  assert.deepEqual(m.chargeSteps("a-cash", 5, +1).filter(Boolean),
    [{ op: "asset", id: "cash", delta: -5, floor: -0 }]);
});

test("taking a purchase back puts money in with no floor", () => {
  const m = load(world());
  assert.deepEqual(m.chargeSteps("a-chk", 14, -1).filter(Boolean), [{ op: "asset", id: "chk", delta: 14 }]);
});

test("deleting money back takes it out again, so it carries the floor", () => {
  const m = load(world());
  // A refund is stored negative; taking it back is dir -1 on a negative amount.
  assert.deepEqual(m.chargeSteps("a-chk", -42, -1).filter(Boolean),
    [{ op: "asset", id: "chk", delta: -42, floor: -100 }]);
});

test("a card purchase carries the limit; taking one back does not", () => {
  const m = load(world());
  assert.deepEqual(m.chargeSteps("a-visa", 50, +1).filter(Boolean),
    [{ op: "liability", id: "visa", delta: 50, ceiling: 1000 }]);
  assert.deepEqual(m.chargeSteps("a-visa", 50, -1).filter(Boolean),
    [{ op: "liability", id: "visa", delta: -50, strict: true }]);
});

test("anything that lowers what is owed is strict, so below zero is refused, never floored", () => {
  const m = load(world());
  const { debts } = world();
  // Money back onto a card, a payment, and taking a charge back alike.
  assert.deepEqual(m.chargeSteps("a-visa", -42, +1).filter(Boolean),
    [{ op: "liability", id: "visa", delta: -42, strict: true }]);
  assert.equal(m.debtMove(debts[0], -10).strict, true);
  assert.equal(m.debtMove(debts[0], 10).strict, undefined);
});

test("an edit is one netted step per account, so a paid-down card is judged on where it ends", () => {
  const w = world();
  w.debts[0].balance = 50;
  const m = load(w);
  // $100 to $120 on a card now owing $50 ends at $70: one +20, not -100 then +120.
  assert.deepEqual(m.editChargeSteps("a-visa", 100, "a-visa", 120).filter(Boolean),
    [{ op: "liability", id: "visa", delta: 20, ceiling: 1000 }]);
  // Changing only the description moves nothing at all.
  assert.deepEqual(m.editChargeSteps("a-visa", 100, "a-visa", 100).filter(Boolean), []);
  // Moved from the card to checking: off the card, out of checking.
  assert.deepEqual(m.editChargeSteps("a-visa", 30, "a-chk", 30).filter(Boolean), [
    { op: "liability", id: "visa", delta: -30, strict: true },
    { op: "asset", id: "chk", delta: -30, floor: -100 },
  ]);
});

test("taking back a charge on a card paid down since is refused in words, never floored", () => {
  const w = world();
  w.debts[0].balance = 30;
  const m = load(w);
  // Charge $100, pay the card down to $30, delete the charge as a mistake.
  const said = m.takeBackError([{ id: "e1", account_id: "a-visa", amount: 100 }]);
  assert.match(said, /^Can't take this back\. Visa only owes \$30\.00 now, and taking off \$100\.00/);
  assert.match(said, /undo that payment first/);
  assert.doesNotMatch(said, /[–—]| - /);
  assert.equal(m.takeBackError([{ id: "e2", account_id: "a-visa", amount: 30 }]), null);
  // An imported charge never moved the card, so taking it back moves nothing.
  assert.equal(m.takeBackError([{ id: "e3", account_id: "a-visa", amount: 100, source: "import" }]), null);
  // Netted: a charge and its own refund leave nothing to take off.
  assert.equal(m.owedFloorError([
    { accountId: "a-visa", amount: 100, sign: -1 }, { accountId: "a-visa", amount: 90, sign: +1 },
  ]), null);
});

test("amounts are rounded to the cent, and a zero move is no step at all", () => {
  const m = load(world());
  const { assets } = world();
  assert.deepEqual(m.assetMove(assets[0], -10.005), { op: "asset", id: "chk", delta: -10.01 });
  assert.equal(m.assetMove(assets[0], 0.004), null);
  assert.equal(m.assetMove(null, 10), null);
});

test("a history row of $0 is dropped, except opening an account", () => {
  const m = load(world());
  assert.equal(m.activityStep("asset_adjust", "nothing", 0), null);
  assert.equal(m.activityStep("account_created", "opened", 0).row.amount, 0);
  assert.equal(m.activityStep("transfer", "moved", 12.345, "2026-11-01", "a", "b").row.amount, 12.35);
});

test("claiming a bill cycle is conditional on the date this run read", () => {
  const m = load(world());
  assert.deepEqual(m.claimStep("subscriptions", "s1", "next_renewal", "2026-11-01", "2026-12-01"), {
    op: "update", table: "subscriptions", id: "s1",
    set: { next_renewal: "2026-12-01" }, expect: { next_renewal: "2026-11-01" },
  });
});

test("no answer from the server never claims nothing was saved", () => {
  const m = load(world());
  assert.match(m.moneyRefusal({ message: "Failed to fetch" }), /not certain/);
});

test("each refusal from the database reads as words", () => {
  const m = load(world());
  const said = (code, message, details) => m.moneyRefusal({ code, message, details });
  assert.match(said("P0001", "money_floor", JSON.stringify({ id: "chk", value: 12 })), /^Checking has \$12\.00 now/);
  assert.match(said("P0001", "money_ceiling", JSON.stringify({ id: "visa", balance: 990 })), /^Visa owes \$990\.00/);
  assert.match(said("P0001", "money_stale"), /another device/);
  assert.match(said("23514", "money_refund_too_large"), /more than is left/);
  assert.match(said("23514", 'new row for relation "assets" violates check constraint "assets_value_floor"'), /below \$0/);
  assert.match(said("23514", 'new row for relation "liabilities" violates check constraint "liabilities_balance_check"'), /owed below \$0/);
  assert.match(said("23514", 'violates check constraint "something_new"'), /rules that keep the books/);
  assert.equal(said("23503", 'update or delete on table "expenses" violates foreign key constraint "expenses_refund_of_fkey"'),
    m.REFUNDED_PURCHASE_MESSAGE);
  for (const text of [said("23514", "x"), m.REFUNDED_PURCHASE_MESSAGE]) assert.doesNotMatch(text, /[–—]| - /);
});

test("a purchase with money back cannot be deleted without it", () => {
  const allExpenses = [
    { id: "p1", amount: 42 }, { id: "r1", amount: -30, refund_of: "p1" }, { id: "p2", amount: 9 },
  ];
  const m = load({ ...world(), allExpenses });
  assert.deepEqual([...m.refundedPurchasesIn([{ id: "p1" }])], ["p1"]);
  assert.equal(m.refundedPurchasesIn([{ id: "p1" }, { id: "r1" }]).size, 0);
  assert.equal(m.refundedPurchasesIn([{ id: "r1" }]).size, 0);
  assert.equal(m.refundedPurchasesIn([{ id: "p2" }]).size, 0);
});
