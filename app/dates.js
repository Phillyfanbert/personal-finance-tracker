// ============================================================================
// Local-calendar date helpers.
//
// **Every date this app stores or compares is a LOCAL calendar date, never a
// UTC one.** `new Date().toISOString().slice(0, 10)` looks like the obvious
// way to get "today" and is wrong for any user west of UTC: at 20:00 in New
// York it is already tomorrow in UTC, so the app believed the date had
// rolled over roughly four hours early every single evening.
//
// That was a real, daily, user-visible bug across 23 call sites - an expense
// logged at 9pm was dated tomorrow, net worth snapshotted under tomorrow's
// date, subscriptions and income auto-logged a day early, and worst of all
// monthKey() rolled over too, so on the last evening of a month "Spent this
// month" reset to $0 and every budget silently started over a day early.
//
// These are deliberately shared rather than re-implemented per module. The
// near-duplicate date steppers elsewhere in this repo (advanceRenewal,
// advanceIncomeDate, addMonthsISO) are kept separate because their parameter
// shapes genuinely differ; these do not differ at all, and eight private
// copies of the same formatter are exactly how all eight came to be wrong in
// the same way.
// ============================================================================

const pad = (n) => String(n).padStart(2, "0");

/**
 * YYYY-MM-DD for a Date, in the viewer's own timezone.
 * @param {Date} [d]
 */
export function localDateISO(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * YYYY-MM for a Date, in the viewer's own timezone. The month-boundary half
 * of the same bug: this is what decides which month the app considers
 * "current" for totals, budgets and the budget warning.
 * @param {Date} [d]
 */
export function localMonthKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
