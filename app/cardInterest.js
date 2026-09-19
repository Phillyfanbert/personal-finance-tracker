// Interest on credit cards, added to what is owed once each billing cycle
// closes out. Pure and unit-testable, same style as creditCycle.js.
//
// This used to be a user-confirmed charge, on the reasoning that a card issuer
// works interest out from an average daily balance through a grace period the
// app can only estimate, so an automatic charge could contradict the
// statement. That is still true of the FIGURE, but it stopped being a reason to
// charge nothing: a card carrying a balance accrues interest every single
// month, so leaving it out is wrong in one guaranteed direction, and net worth
// runs high until someone remembers to log it. An estimate lands closer to the
// truth than zero does, which is the argument that already made deposit and
// loan interest automatic. It is still labelled an estimate everywhere.
//
// WHAT IT CHARGES, in the grace-period terms creditCycle.js already encodes:
//   the statement balance paid IN FULL by the due date -> nothing at all
//   anything left unpaid at the due date               -> that remainder times
//                                                         APR / 12
// Judged once per completed cycle, on the due date. Payments made AFTER the due
// date do not restore the grace period for that cycle, so only payments up to
// and including the due date count.
//
// WHERE THE STATEMENT BALANCE COMES FROM. If the user typed one for that exact
// statement date it is authoritative (it is the real number off a real
// statement). Otherwise it is DERIVED: what was owed at the close, recovered by
// walking this card's own logged charges, payments and corrections backward
// from the current balance - the same reconstruction the account history chart
// uses, so there is one definition of "what was owed on that day". That makes
// the feature work without anyone typing a statement, at the cost that it can
// only be as right as the records: a payment made but never logged leaves the
// balance itself too high already, and this inherits that rather than hiding it.
//
// Never back-charged: a card with no marker only gets one seeded, so cycles
// that closed before the rate and cycle days were entered are never judged.
// Not modelled, deliberately: late fees, penalty APRs, interest on new
// purchases while a balance is being carried, and daily compounding.

import { cycleDates } from "./creditCycle.js";
import { buildBalanceHistory } from "./accountHistory.js";
import { localDateISO } from "./dates.js";

const r2 = (n) => Math.round(n * 100) / 100;

// Six catch-up cycles, not the 36 deposit and loan interest allow. A derived
// statement balance needs the card's history back to that statement, and the
// app only holds a bounded window of it, so reaching further back would judge
// old cycles against a history that is not there.
const MAX_CARD_CYCLES = 6;

const dayBefore = (iso) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() - 1);
  return d;
};

/** A card accrues when it is a card type with a real APR and both cycle days set. */
export function cardInterestEligible(debt, cardTypes) {
  if (!debt || !cardTypes.has(debt.type)) return false;
  const apr = Number(debt.interest_rate);
  return Number.isFinite(apr) && apr > 0 && !!debt.statement_day && !!debt.due_day;
}

// Cycles newest first, starting from the one in progress, going back `count`.
function recentCycles(debt, today, count) {
  const out = [];
  let ref = today;
  for (let i = 0; i < count; i++) {
    const c = cycleDates(debt.statement_day, debt.due_day, ref);
    if (!c) break;
    out.push(c);
    ref = dayBefore(c.statementDate);
  }
  return out;
}

/**
 * The marker to start from when a card has none: the due date of the most
 * recent cycle already past due, so everything up to now is treated as before
 * the clock started. A cycle still awaiting its due date is NOT skipped - it
 * is judged when the date arrives.
 */
export function seedCardMarker(debt, today = new Date()) {
  const todayStr = localDateISO(today);
  const past = recentCycles(debt, today, 3).find((c) => c.dueDate < todayStr);
  return past ? past.dueDate : todayStr;
}

/**
 * Every completed cycle's interest since `interest_last_accrued`, oldest first.
 * A null marker returns nothing: the caller seeds it rather than back-charging.
 *
 * @param {object} args
 * @param {object} args.debt liabilities row
 * @param {object|null} args.account the card's account (for deriving a statement balance)
 * @param {object[]} args.expenses cached expenses
 * @param {object[]} args.activity cached account_activity
 * @param {Set<string>} args.cardTypes GRACE_PERIOD_LIABILITY_TYPES, passed in, not copied
 * @returns {{charges: {date: string, amount: number, statementDate: string,
 *   statementBalance: number, remaining: number, source: string}[],
 *   lastAccrued: string|null, capped: boolean}}
 */
export function cardInterestCharges({ debt, account, expenses, activity, cardTypes, today = new Date() }) {
  const none = { charges: [], lastAccrued: null, capped: false };
  if (!cardInterestEligible(debt, cardTypes) || !debt.interest_last_accrued) return none;

  const marker = debt.interest_last_accrued;
  const todayStr = localDateISO(today);

  // Completed cycles (strictly past due) that the marker has not covered yet.
  const pending = recentCycles(debt, today, MAX_CARD_CYCLES + 2)
    .filter((c) => c.dueDate < todayStr && c.dueDate > marker)
    .reverse();
  if (!pending.length) return none;
  const capped = pending.length > MAX_CARD_CYCLES;
  const cycles = pending.slice(0, MAX_CARD_CYCLES);

  const apr = Number(debt.interest_rate);
  let owedNow = Number(debt.balance);
  if (!Number.isFinite(owedNow)) return none;
  const decided = []; // charges already made in THIS run, so a later cycle's statement includes them
  const charges = [];
  let lastAccrued = null;

  for (const c of cycles) {
    let statementBalance = null;
    let source = "derived";
    if (debt.last_statement_balance != null && debt.last_statement_date === c.statementDate) {
      statementBalance = Number(debt.last_statement_balance);
      source = "typed";
    } else if (account) {
      const series = buildBalanceHistory(account, owedNow, expenses, [...activity, ...decided], today);
      // The balance at the END of the statement date: the last point on or before it.
      let at = null;
      for (const p of series) { if (p.date <= c.statementDate) at = p.balance; }
      statementBalance = at;
    }
    // Nothing to judge it against (no typed statement and no account history):
    // advance past it without charging rather than guess.
    if (statementBalance == null || !Number.isFinite(statementBalance)) { lastAccrued = c.dueDate; continue; }

    const paidByDue = r2(
      activity
        .filter((a) => a.kind === "liability_payment" && a.liability_id === debt.id)
        .filter((a) => a.occurred_at > c.statementDate && a.occurred_at <= c.dueDate)
        .reduce((sum, a) => sum + Math.abs(Number(a.amount || 0)), 0)
    );
    const remaining = r2(Math.max(0, statementBalance - paidByDue));
    const amount = remaining > 0 ? r2(remaining * (apr / 100 / 12)) : 0;
    if (amount > 0) {
      charges.push({ date: c.dueDate, amount, statementDate: c.statementDate, statementBalance: r2(statementBalance), remaining, source });
      owedNow = r2(owedNow + amount);
      decided.push({ kind: "owed_adjust", account_id: account?.id ?? null, liability_id: debt.id, occurred_at: c.dueDate, amount });
    }
    lastAccrued = c.dueDate;
  }
  return { charges, lastAccrued, capped };
}
