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

/**
 * Plain-words reasons the headline may not be as current or as complete as it
 * looks, in the order a reader most needs them. Empty when there is nothing to
 * say, so a clean net worth stays a clean number.
 *
 * Pure: the caller decides what counts as stale or unpriced and passes names in.
 * The figure itself is never adjusted - a caveat is a statement about how far
 * to trust it, not a correction of it, because guessing a "fixed" number would
 * be the same confident-but-wrong failure this exists to prevent.
 *
 * @param {{unpriced?: string[], stale?: {name: string, months: number}[],
 *          priceAge?: {label: string, stale: boolean}|null}} input
 * @returns {string[]}
 */
export function netWorthCaveats({ unpriced = [], stale = [], priceAge = null } = {}) {
  const list = (names) => names.length <= 3
    ? names.join(", ")
    : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
  const out = [];
  if (priceAge && priceAge.stale) out.push(`Stock prices may be out of date - last updated ${priceAge.label}.`);
  if (unpriced.length) {
    out.push(`${list(unpriced)} ${unpriced.length === 1 ? "has" : "have"} no price yet, so ${unpriced.length === 1 ? "it counts" : "they count"} at the last value you saved.`);
  }
  if (stale.length) {
    out.push(`Not updated in a while: ${list(stale.map((a) => `${a.name} (${a.months} months)`))}.`);
  }
  return out;
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
