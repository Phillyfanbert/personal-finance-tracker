// Everything the app does to money on its own: bills, pay, and interest.
//
// Each of these runs unprompted when the app opens, so a mistake repeats on
// every load. Two of the worst bugs this app has shipped lived here: a pay
// source whose date could not move was logged 36 times on every open, and a
// three-month catch-up credited one month of interest while logging three.

import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceIncomeDate } from "../app/income.js";
import { advanceRenewal } from "../app/subscriptions.js";
import { accrueMonthly, interestPayments } from "../app/savingsInterest.js";
import { loanInterestAccruals } from "../app/loanInterest.js";
import { billAutoLogBlocker, incomeAutoLogBlocker, billCatchUp, incomeCatchUp } from "../app/setup.js";

const accounts = [
  { id: "chk", linked_asset_id: "a1" },
  { id: "card", linked_liability_id: "l1" },
  { id: "old", linked_asset_id: "a2", archived_at: "2026-10-01" },
];

test("a bill's next date lands on a real day in short months", () => {
  assert.equal(advanceRenewal("2026-01-31", "monthly"), "2026-02-28");
  assert.equal(advanceRenewal("2024-02-29", "annual"), "2025-02-28");
  assert.equal(advanceRenewal("2026-11-30", "quarterly"), "2027-02-28");
  // A cycle with no set gap does not move, and the loop must not try to log it.
  assert.equal(advanceRenewal("2026-11-01", "other"), "2026-11-01");
});

test("pay days step by their cadence", () => {
  assert.equal(advanceIncomeDate("2026-11-28", "weekly"), "2026-12-05");
  assert.equal(advanceIncomeDate("2026-12-25", "biweekly"), "2027-01-08");
  assert.equal(advanceIncomeDate("2026-11-01", "semimonthly", 1, 15), "2026-11-15");
  assert.equal(advanceIncomeDate("2026-11-15", "semimonthly", 1, 15), "2026-12-01");
  assert.equal(advanceIncomeDate("2026-01-31", "semimonthly", 15, 31), "2026-02-15");
  assert.equal(advanceIncomeDate("2026-02-15", "semimonthly", 15, 31), "2026-02-28");
});

test("a pay source that cannot move is never auto-logged (it was logged 36 times on every open)", () => {
  // advanceIncomeDate hands the same date back for these, which is what made
  // the catch-up loop log one deposit over and over.
  assert.equal(advanceIncomeDate("2026-11-01", "semimonthly", 1, null), "2026-11-01");
  assert.equal(advanceIncomeDate("2026-11-01", "fortnightly"), "2026-11-01");
  const base = { is_active: true, account_id: "chk", next_expected: "2026-11-01" };
  assert.equal(incomeAutoLogBlocker({ ...base, cadence: "semimonthly", semimonthly_day_1: 1 }, accounts), "no_pay_days");
  assert.equal(incomeAutoLogBlocker({ ...base, cadence: "fortnightly" }, accounts), "cadence");
  assert.equal(incomeAutoLogBlocker({ ...base, cadence: "monthly" }, accounts), null);
});

test("pay is only logged into an account that can hold money", () => {
  const base = { is_active: true, cadence: "monthly", next_expected: "2026-11-01" };
  assert.equal(incomeAutoLogBlocker({ ...base }, accounts), "no_account");
  assert.equal(incomeAutoLogBlocker({ ...base, account_id: "card" }, accounts), "account_gone");
  assert.equal(incomeAutoLogBlocker({ ...base, account_id: "old" }, accounts), "account_gone");
  assert.equal(incomeAutoLogBlocker({ ...base, account_id: "chk", is_active: false }, accounts), "inactive");
});

test("a bill is only logged when it has an account, a date and a real cycle", () => {
  const base = { is_active: true, billing_cycle: "monthly", next_renewal: "2026-11-01" };
  assert.equal(billAutoLogBlocker({ ...base }, accounts), "no_account");
  assert.equal(billAutoLogBlocker({ ...base, account_id: "chk", next_renewal: null }, accounts), "no_date");
  assert.equal(billAutoLogBlocker({ ...base, account_id: "chk", billing_cycle: "other" }, accounts), "cycle");
  assert.equal(billAutoLogBlocker({ ...base, account_id: "old" }, accounts), "account_gone");
  assert.equal(billAutoLogBlocker({ ...base, account_id: "chk" }, accounts), null);
});

test("the catch-up preview counts every missed cycle, the number the form warns about", () => {
  const bill = billCatchUp({ next_renewal: "2026-08-28", billing_cycle: "monthly" }, "2026-11-19");
  assert.equal(bill.count, 3);
  assert.equal(bill.next, "2026-11-28");
  const pay = incomeCatchUp({ next_expected: "2026-11-05", cadence: "weekly" }, "2026-11-19");
  assert.equal(pay.count, 3);
});

test("deposit interest compounds, keeps its day of the month, and is never back-paid", () => {
  const r = accrueMonthly(3000, 6, "2026-08-31", "2026-11-30");
  assert.deepEqual(r.payments.map((p) => p.date), ["2026-09-30", "2026-10-31", "2026-11-30"]);
  assert.deepEqual(r.payments.map((p) => p.amount), [15, 15.08, 15.15]);
  assert.equal(r.total, 45.23);
  assert.equal(r.lastPaid, "2026-11-30");
  // No marker yet: nothing is owed for months the app never saw.
  assert.equal(interestPayments({ type: "savings", value: 3000, interest_rate: 6, interest_last_paid: null }, "2026-11-30").payments.length, 0);
});

test("an overdrawn account earns nothing but still moves its marker on", () => {
  const r = accrueMonthly(-50, 6, "2026-10-15", "2026-11-20");
  assert.equal(r.payments.length, 0);
  assert.equal(r.lastPaid, "2026-11-15");
});

test("loan interest is added monthly on what is owed, never on a card", () => {
  const cards = new Set(["credit_card"]);
  const loan = { type: "personal_loan", balance: 12000, interest_rate: 12, interest_last_accrued: "2026-09-10" };
  const r = loanInterestAccruals(loan, "2026-11-19", cards);
  assert.deepEqual(r.payments.map((p) => p.amount), [120, 121.2]);
  assert.equal(loanInterestAccruals({ ...loan, type: "credit_card" }, "2026-11-19", cards).payments.length, 0);
});
