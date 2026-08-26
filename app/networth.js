// ============================================================================
// Net worth overview (Log page). Pure, unit-testable.
// "Liabilities" here means tracked debt (the `liabilities` table) only -
// what you actually owe right now. Subscriptions (a recurring cost, not
// debt) and general expense totals (debit/cash spending already reduces
// an asset directly via applyAssetDelta in app.js, so it's never a
// liability) don't belong in this module - they're display concerns
// handled in app.js's renderNetWorth, not part of the net-worth balance
// itself.
// ============================================================================
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
 */
export function computeNetWorth(assets, debts) {
  const assetsTotal = totalAssets(assets);
  const debtsTotal = totalDebts(debts);
  const liabilitiesTotal = debtsTotal;

  return {
    assetsTotal,
    debtsTotal,
    liabilitiesTotal,
    netWorth: r2(assetsTotal - liabilitiesTotal),
  };
}

// emergencyFundCoverage() was REMOVED here on 2026-08-26, along with the
// Reports tile that used it. Recorded so it is not simply rebuilt:
//
// It divided liquid assets by average logged spending, and dividing
// AMPLIFIES thin data. In production one $14 expense became "75 years" - a
// figure so far from reality it told the reader nothing and hid its own
// cause. Worse, it could not fix itself with time: this app only knows what
// gets typed in, so anyone who logs a subset of their spending has a
// permanently understated denominator and a permanently overstated runway.
//
// The tile now shows average monthly spending directly. The same thin data
// then reads "$14 a month" - still incomplete, but wrong by an amount the
// reader can see and act on, instead of exploding into a meaningless span.
// If a runway figure is ever wanted again, it needs a denominator the user
// states outright (a monthly-essentials field) rather than one inferred
// from partial logging.
