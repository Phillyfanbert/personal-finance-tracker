// ============================================================================
// Subscriptions logic (README §3.7, Phase 2 / F5).
// Pure, unit-testable helpers. UI wiring lives in app.js.
// ============================================================================

/** Normalize a subscription's charge to a monthly-equivalent dollar amount. */
export function monthlyAmount(sub) {
  const amt = Number(sub.amount || 0);
  switch (sub.billing_cycle) {
    case "annual": return amt / 12;
    case "monthly": return amt;
    default: return amt; // 'other' - treat the stored amount as monthly
  }
}

/** Total monthly-equivalent spend across active subscriptions. */
export function totalMonthly(subs) {
  return Math.round(
    subs.filter((s) => s.is_active).reduce((sum, s) => sum + monthlyAmount(s), 0) * 100
  ) / 100;
}

/** Whole days from `today` until an ISO date string (negative = past due). */
export function daysUntil(isoDate, today = new Date()) {
  if (!isoDate) return null;
  const d = new Date(isoDate + "T00:00:00");
  const t = new Date(today.toISOString().slice(0, 10) + "T00:00:00");
  return Math.round((d - t) / 86400000);
}

/**
 * Active subscriptions renewing within `withinDays` (incl. overdue),
 * sorted soonest-first. Each item gets a `days` field.
 */
export function upcomingRenewals(subs, withinDays = 30, today = new Date()) {
  return subs
    .filter((s) => s.is_active && s.next_renewal)
    .map((s) => ({ ...s, days: daysUntil(s.next_renewal, today) }))
    .filter((s) => s.days !== null && s.days <= withinDays)
    .sort((a, b) => a.days - b.days);
}

/** Friendly renewal label from a day delta. */
export function renewalLabel(days) {
  if (days === null || days === undefined) return "";
  if (days < 0) return `overdue ${-days}d`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days}d`;
}

/**
 * Next renewal date after paying, one billing cycle forward from the
 * subscription's own next_renewal (not from today - paying late shouldn't
 * shift the schedule). 'other' has no defined interval, so it's left
 * unchanged rather than guessed; the user updates it manually.
 *
 * Built from the y/m/d parts directly rather than Date#setMonth, which
 * overflows into the following month for day-of-month values that don't
 * exist in the target month (Jan 31 + 1 month lands on Mar 3, not Feb 28).
 * Clamping the day to the target month's actual length avoids that -
 * also needed for annual on leap-day subscriptions (Feb 29 -> Feb 28).
 */
export function advanceRenewal(isoDate, billingCycle) {
  if (!isoDate) return isoDate;
  if (billingCycle !== "annual" && billingCycle !== "monthly") return isoDate;
  const [y, m, day] = isoDate.split("-").map(Number);
  let targetYear = y, targetMonth = m; // targetMonth stays 1-indexed throughout
  if (billingCycle === "annual") targetYear += 1;
  else { targetMonth += 1; if (targetMonth > 12) { targetMonth = 1; targetYear += 1; } }
  // New Date(y, m, 0) is day 0 of 1-indexed month m, i.e. the last day of
  // the *previous* 0-indexed month - which, since targetMonth is already
  // 1-indexed, is exactly the last day of targetMonth itself.
  const lastDayOfTargetMonth = new Date(targetYear, targetMonth, 0).getDate();
  const clampedDay = Math.min(day, lastDayOfTargetMonth);
  return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
}
