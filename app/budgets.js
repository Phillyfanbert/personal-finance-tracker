// ============================================================================
// Per-category budgets (the project notes, Reports & Net Worth #2). Pure,
// unit-testable - same style as networth.js/depreciation.js.
// ============================================================================

import { localDateISO } from "./dates.js";
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
 * **Overspend counts against this total, and is reported separately so it
 * can be named on screen.** An earlier version floored each category at $0
 * on the reasoning that an overspend has already left the real account, so
 * subtracting it again would double-count. That is true of a per-category
 * reading but wrong for an AGGREGATE one: if $300 is budgeted across two
 * categories and $290 is spent, $10 is left, not $60. Flooring overstates
 * what is safe to spend, which is exactly backwards for a number whose job
 * is to stop you overcommitting. `overspent` is returned alongside so the
 * caller can say so in words rather than letting a quietly smaller total be
 * the only signal.
 *
 * `fundsMonthly` (from sinkingFundMonthlyTotal below) is netted off for the
 * same reason as `upcoming`: money you have committed to setting aside this
 * month is not free to spend, and it is disjoint from both other sources -
 * contributing to a sinking fund writes no expense, so it has never reduced
 * any category's `spent`.
 *
 * Returns null when there are no budgeted categories at all - there is
 * nothing honest to compute yet, and a $0 or negative figure derived from
 * zero budgets would look like a real answer when it is not one.
 *
 * @param {ReturnType<typeof budgetStatus>} statuses
 * @param {object[]} subscriptions rows from the `subscriptions` table
 * @param {number} [fundsMonthly] from sinkingFundMonthlyTotal()
 * @param {Date} [today]
 * @returns {{budgetedRoom:number, overspent:number, upcoming:number, funds:number, available:number}|null}
 */
export function safeToSpend(statuses, subscriptions, fundsMonthly = 0, today = new Date()) {
  if (!statuses.length) return null;

  // Signed, not floored: total limits minus total spent.
  const budgetedRoom = statuses.reduce((sum, s) => sum + (s.limit - s.spent), 0);
  // How much of that shortfall is real overspend, for naming it on screen.
  const overspent = statuses.reduce((sum, s) => sum + Math.max(0, s.spent - s.limit), 0);

  const todayStr = localDateISO(today);
  // Last real day of the current month, whatever its length - not a fixed 30.
  const monthEndStr = localDateISO(new Date(today.getFullYear(), today.getMonth() + 1, 0));

  const upcoming = subscriptions
    .filter((s) => s.is_active && s.next_renewal && AUTO_LOG_CYCLES.has(s.billing_cycle))
    .filter((s) => s.next_renewal > todayStr && s.next_renewal <= monthEndStr)
    .reduce((sum, s) => sum + Number(s.amount || 0), 0);

  const funds = r2(Math.max(0, Number(fundsMonthly) || 0));

  return {
    budgetedRoom: r2(budgetedRoom),
    overspent: r2(overspent),
    upcoming: r2(upcoming),
    funds,
    available: r2(budgetedRoom - upcoming - funds),
  };
}

/**
 * Progress toward a dated savings goal, per the project notes
 * section 3: a sinking fund is money set aside for a known, irregular cost
 * (car registration, an annual insurance premium), not a monthly spending
 * ceiling. Deliberately its own concept rather than a rollover flag on a
 * budget category - see that doc for the comparison against how EveryDollar,
 * YNAB, Goodbudget, Copilot and Monarch each implement this.
 *
 * `monthlyNeeded` is the headline: total still needed divided by whole
 * months remaining until the target date, which is the number that makes a
 * large irregular bill plannable. It is null when there is no target date,
 * because without one there is no deadline to divide by and inventing one
 * would state something the app does not know.
 *
 * A fund already at or past its target reports `monthlyNeeded: 0`, not a
 * negative - there is genuinely nothing more to set aside. A target date
 * already in the past with money still owed reports the full remaining
 * amount as due now (`monthsLeft: 0`), rather than dividing by zero or
 * quietly showing a stale monthly figure.
 *
 * @param {object[]} funds rows from the `sinking_funds` table
 * @param {Date} [today]
 */
export function sinkingFundStatus(funds, today = new Date()) {
  return funds.map((f) => {
    const target = Number(f.target_amount) || 0;
    const saved = Number(f.saved) || 0;
    const remaining = r2(Math.max(0, target - saved));
    const pct = target > 0 ? Math.round((saved / target) * 100) : 0;

    let monthsLeft = null;
    let monthlyNeeded = null;
    if (f.target_date) {
      const [y, m] = String(f.target_date).split("-").map(Number);
      // Whole months between now and the target month, floored at 0. Counted
      // in calendar months rather than days because a contribution is a
      // monthly act; a target 40 days out is two more paydays, not 1.3.
      monthsLeft = Math.max(0, (y - today.getFullYear()) * 12 + (m - 1 - today.getMonth()));
      monthlyNeeded = remaining === 0 ? 0 : r2(monthsLeft > 0 ? remaining / monthsLeft : remaining);
    }

    return {
      id: f.id,
      name: f.name,
      target: r2(target),
      saved: r2(saved),
      remaining,
      pct,
      complete: remaining === 0 && target > 0,
      targetDate: f.target_date || null,
      monthsLeft,
      monthlyNeeded,
      // Past its date with money still owed. Worth flagging separately from
      // "complete" so the UI can say the deadline passed rather than only
      // showing a large monthlyNeeded with no explanation.
      overdue: !!f.target_date && monthsLeft === 0 && remaining > 0,
    };
  });
}

/**
 * What every fund still needs THIS month, combined. This is the figure that
 * belongs alongside safe-to-spend: money you have committed to setting aside
 * is not money that is free to spend.
 *
 * Only funds with a target date contribute - without a deadline there is no
 * per-month obligation to compute, so counting them would invent a
 * commitment the user never made.
 */
export function sinkingFundMonthlyTotal(statuses) {
  return r2(statuses.reduce((sum, s) => sum + (s.monthlyNeeded || 0), 0));
}
