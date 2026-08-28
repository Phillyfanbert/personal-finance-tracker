// ============================================================================
// Per-category budgets (docs/ROADMAP.md Reports & Net Worth #2). Pure,
// unit-testable - same style as networth.js/depreciation.js.
// ============================================================================

const r2 = (n) => Math.round(n * 100) / 100;

// A category counts as "approaching" its budget at 90% spent, not just
// once actually over - gives a real heads-up while there's still room to
// adjust, rather than only flagging it after the fact.
export const WARN_THRESHOLD_PCT = 90;

/**
 * Combines each budget with the selected month's actual spend for that
 * category (from charts.js's sumBy(expenses, "category", ym), passed in
 * rather than recomputed here so this stays pure/decoupled from the
 * expenses array). Sorted by percent-used descending, so the closest-to-
 * (or most-over-)budget category surfaces first.
 * @param {object[]} budgets rows from the `budgets` table
 * @param {{label:string, value:number}[]} spendByCategory from sumBy()
 */
export function budgetStatus(budgets, spendByCategory) {
  const spendMap = new Map(spendByCategory.map((s) => [s.label, s.value]));
  return budgets
    .map((b) => {
      const spent = r2(spendMap.get(b.category) || 0);
      const limit = Number(b.monthly_limit);
      const pct = limit > 0 ? Math.round((spent / limit) * 100) : 0;
      const over = spent > limit;
      return { category: b.category, limit, spent, pct, over, warn: over || pct >= WARN_THRESHOLD_PCT };
    })
    .sort((a, b) => b.pct - a.pct);
}

// Auto-log-eligible cycles only (mirrors app.js's autoLogDueSubscriptions
// filter exactly) - a billing_cycle of "other" never posts itself, so it has
// no reliable "not yet posted" date to net against here.
const AUTO_LOG_CYCLES = new Set(["monthly", "quarterly", "semiannual", "annual"]);

/**
 * "How much can I still spend, right now, without breaking anything I've
 * already committed to" - scoped to what this app can actually answer
 * honestly.
 *
 * This app is not zero-based: it does not require every dollar assigned to
 * a category, so there is no "unassigned money" pool to draw a true
 * whole-paycheck figure from. This is deliberately narrower: remaining room
 * across categories that actually have a budget, minus subscription
 * renewals due before this calendar month ends that have not posted as an
 * expense yet. A category with no budget is not part of this number, the
 * same way it is not part of budgetStatus() above.
 *
 * The netting is not a double-count. budgetStatus()'s `spent` only reflects
 * expenses already logged; a subscription that has not renewed yet has not
 * reduced any category's `spent`, so it has not reduced that category's
 * `remaining` either - the two sources are disjoint by definition. This
 * relies on autoLogDueSubscriptions() having already run for the current
 * session (it runs unconditionally in init(), before any render), so a
 * `next_renewal <= today` is guaranteed to already be posted rather than
 * merely due - that is why the boundary below is strictly "> today", not
 * "today or later".
 *
 * A category already over its own limit contributes $0, never a negative,
 * to the total - its overspend already happened and already shows up in the
 * real account balance; letting it eat into other categories' room here
 * would hide the overspend rather than surface it.
 *
 * Returns null when there are no budgeted categories at all - there is
 * nothing honest to compute yet, and a $0 or negative figure derived from
 * zero budgets would look like a real answer when it is not one.
 *
 * @param {ReturnType<typeof budgetStatus>} statuses
 * @param {object[]} subscriptions rows from the `subscriptions` table
 * @param {Date} [today]
 * @returns {{budgetedRoom:number, upcoming:number, available:number}|null}
 */
export function safeToSpend(statuses, subscriptions, today = new Date()) {
  if (!statuses.length) return null;

  const budgetedRoom = statuses.reduce((sum, s) => sum + Math.max(0, s.limit - s.spent), 0);

  const todayStr = today.toISOString().slice(0, 10);
  // Last real day of the current month, whatever its length - not a fixed 30.
  const monthEndStr = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);

  const upcoming = subscriptions
    .filter((s) => s.is_active && s.next_renewal && AUTO_LOG_CYCLES.has(s.billing_cycle))
    .filter((s) => s.next_renewal > todayStr && s.next_renewal <= monthEndStr)
    .reduce((sum, s) => sum + Number(s.amount || 0), 0);

  return { budgetedRoom: r2(budgetedRoom), upcoming: r2(upcoming), available: r2(budgetedRoom - upcoming) };
}
