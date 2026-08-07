// ============================================================================
// Net worth overview (Log page). Pure, unit-testable.
// "Liabilities" here is the broader, practical sense the user asked for:
// subscriptions (monthly-equivalent) + this month's expenses + tracked debts
// (the `liabilities` table) - not just textbook debt.
// ============================================================================
import { totalMonthly } from "./subscriptions.js";

const r2 = (n) => Math.round(n * 100) / 100;

/** Sum of all asset values. */
export function totalAssets(assets) {
  return r2(assets.reduce((s, a) => s + Number(a.value || 0), 0));
}

/** Sum of tracked-debt balances (the `liabilities` table specifically). */
export function totalDebts(debts) {
  return r2(debts.reduce((s, d) => s + Number(d.balance || 0), 0));
}

/**
 * Full net-worth breakdown for the Log page.
 *
 * liabilitiesTotal ("Total liabilities") is debtsTotal alone - a balance,
 * what you actually owe right now. It used to also fold in subsTotal
 * (subscriptions' monthly-equivalent cost), but summing a balance with a
 * recurring rate produced a number that was arithmetically correct yet
 * conceptually confusing (two different kinds of quantity added together).
 * subsTotal is now surfaced separately as "Monthly liabilities" - it's
 * informational (what recurs every month), not a balance, so it's never
 * subtracted from net worth.
 *
 * "Expenses (this month)" is deliberately NOT part of liabilitiesTotal
 * either: debit/cash expenses already reduce their linked asset's value
 * (see applyAssetDelta in app.js), so counting them again here would
 * double them against net worth. Credit expenses accumulate onto a linked
 * liability's running balance instead (applyLiabilityDelta) - that
 * balance, in debtsTotal, is the real "what you owe" figure, correct
 * regardless of how irregularly a card gets paid off. expensesTotal is
 * still returned for the informational Credit/Debit/Cash breakdown
 * display, it just doesn't feed net worth.
 * @param {object[]} assets
 * @param {object[]} debts - rows from the `liabilities` table
 * @param {object[]} subscriptions
 * @param {number} monthExpenseTotal - current month's expense total (display only)
 */
export function computeNetWorth(assets, debts, subscriptions, monthExpenseTotal) {
  const assetsTotal = totalAssets(assets);
  const subsTotal = totalMonthly(subscriptions);
  const debtsTotal = totalDebts(debts);
  const expensesTotal = r2(Number(monthExpenseTotal || 0));
  const liabilitiesTotal = debtsTotal;

  return {
    assetsTotal,
    subsTotal,
    expensesTotal,
    debtsTotal,
    liabilitiesTotal,
    netWorth: r2(assetsTotal - liabilitiesTotal),
  };
}
