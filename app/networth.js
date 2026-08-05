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
 * @param {object[]} assets
 * @param {object[]} debts - rows from the `liabilities` table
 * @param {object[]} subscriptions
 * @param {number} monthExpenseTotal - current month's expense total
 */
export function computeNetWorth(assets, debts, subscriptions, monthExpenseTotal) {
  const assetsTotal = totalAssets(assets);
  const subsTotal = totalMonthly(subscriptions);
  const debtsTotal = totalDebts(debts);
  const expensesTotal = r2(Number(monthExpenseTotal || 0));
  const liabilitiesTotal = r2(subsTotal + expensesTotal + debtsTotal);

  return {
    assetsTotal,
    subsTotal,
    expensesTotal,
    debtsTotal,
    liabilitiesTotal,
    netWorth: r2(assetsTotal - liabilitiesTotal),
  };
}
