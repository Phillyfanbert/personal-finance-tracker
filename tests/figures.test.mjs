// The figures the app works out from records: what is safe to spend, what an
// account held on a past day, a card's interest, and amounts read from text.
// Each answers a question someone acts on, so a wrong one is a wrong decision.

import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetStatus, budgetSplit, safeToSpend } from "../app/budgets.js";
import { buildBalanceHistory } from "../app/accountHistory.js";
import { cardInterestCharges } from "../app/cardInterest.js";
import { parseAmount, detectNumberConvention } from "../app/csvImport.js";
import { quickParse } from "../app/categorize.js";

test("overspending one budget counts against what is safe to spend", () => {
  const statuses = budgetStatus(
    [{ category: "Food", monthly_limit: 200 }, { category: "Fun", monthly_limit: 100 }],
    [{ label: "Food", value: 250 }, { label: "Fun", value: 40 }]);
  const s = safeToSpend(statuses, [], 0, new Date(2026, 10, 10));
  // $300 budgeted, $290 spent: $10 left, not the $60 that ignoring the
  // overspend would claim.
  assert.equal(s.available, 10);
  assert.equal(s.overspent, 50);
});

test("bills still to come this month are set aside; one that pays a debt is not", () => {
  const statuses = budgetStatus([{ category: "Food", monthly_limit: 500 }], []);
  const subs = [
    { is_active: true, amount: 15, billing_cycle: "monthly", next_renewal: "2026-11-25" },
    { is_active: true, amount: 900, billing_cycle: "monthly", next_renewal: "2026-11-28", pays_liability_id: "mortgage" },
    { is_active: true, amount: 40, billing_cycle: "monthly", next_renewal: "2026-12-02" },
  ];
  const s = safeToSpend(statuses, subs, 25, new Date(2026, 10, 19));
  assert.equal(s.upcoming, 15);
  assert.equal(s.available, 460);
  assert.equal(safeToSpend([], subs), null);
});

test("the needs, wants and savings shares always add up to 100", () => {
  const split = budgetSplit(budgetStatus([
    { category: "A", monthly_limit: 100, classification: "need" },
    { category: "B", monthly_limit: 100, classification: "want" },
    { category: "C", monthly_limit: 100, classification: "savings" },
  ], []));
  assert.equal(split.need.pct + split.want.pct + split.savings.pct, 100);
});

test("a transfer shows on both accounts' history, and the totals agree", () => {
  const from = { id: "f", linked_asset_id: "fa" };
  const to = { id: "t", linked_asset_id: "ta" };
  const activity = [{ kind: "transfer", amount: 200, account_id: "f", related_account_id: "t", occurred_at: "2026-11-10" }];
  const today = new Date(2026, 10, 19);
  const a = buildBalanceHistory(from, 800, [], activity, today);
  const b = buildBalanceHistory(to, 1200, [], activity, today);
  // Opens the day before, so a single movement does not draw a flat line.
  assert.deepEqual(a.map((p) => p.balance), [1000, 800, 800]);
  assert.deepEqual(b.map((p) => p.balance), [1000, 1200, 1200]);
  assert.equal(a[0].balance + b[0].balance, a.at(-1).balance + b.at(-1).balance);
});

test("an owed correction is part of a card's history", () => {
  const card = { id: "c", linked_liability_id: "l" };
  const points = buildBalanceHistory(card, 150, [{ account_id: "c", amount: 100, occurred_at: "2026-11-05" }],
    [{ kind: "owed_adjust", amount: 50, account_id: "c", occurred_at: "2026-11-08" }], new Date(2026, 10, 19));
  assert.deepEqual(points.map((p) => p.balance), [0, 100, 150, 150]);
});

const cardTypes = new Set(["credit_card"]);
const card = {
  id: "l", type: "credit_card", balance: 500, interest_rate: 24,
  statement_day: 1, due_day: 25, interest_last_accrued: "2026-09-25",
};
const account = { id: "c", linked_liability_id: "l" };

test("paying the statement in full by the due date costs no interest", () => {
  const expenses = [{ account_id: "c", amount: 500, occurred_at: "2026-10-15" }];
  const activity = [{ kind: "liability_payment", liability_id: "l", amount: 500, occurred_at: "2026-11-20", related_account_id: "c" }];
  const r = cardInterestCharges({ debt: { ...card, balance: 0 }, account, expenses, activity, cardTypes, today: new Date(2026, 10, 26) });
  assert.equal(r.charges.length, 0);
  assert.equal(r.lastAccrued, "2026-11-25");
});

test("carrying part of the statement costs interest on what was left", () => {
  const expenses = [{ account_id: "c", amount: 500, occurred_at: "2026-10-15" }];
  const activity = [{ kind: "liability_payment", liability_id: "l", amount: 200, occurred_at: "2026-11-20", related_account_id: "c" }];
  const r = cardInterestCharges({ debt: { ...card, balance: 300 }, account, expenses, activity, cardTypes, today: new Date(2026, 10, 26) });
  assert.deepEqual(r.charges.map((c) => [c.remaining, c.amount]), [[300, 6]]);
});

test("amounts read from a bank file, in either convention", () => {
  assert.equal(parseAmount("1,234.56"), 1234.56);
  assert.equal(parseAmount("1.234,56"), 1234.56);
  assert.equal(parseAmount("(45.00)"), -45);
  // A trailing minus once turned a 50.00 debit into 5000.
  assert.equal(parseAmount("50,00-"), -50);
  assert.equal(detectNumberConvention(["1.234,56", "12,00"]), "eu");
  assert.equal(detectNumberConvention(["100"]), null);
});

test("Quick Add reads thousands separators (1,234.56 was once logged as $1)", () => {
  assert.equal(quickParse("1,234.56 rent").amount, 1234.56);
  assert.equal(quickParse("1,234.56 rent").rest, "rent");
  assert.equal(quickParse("$14 lunch chipotle debit").payment_type, "debit");
});
