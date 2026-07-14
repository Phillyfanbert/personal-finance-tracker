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
    default: return amt; // 'other' — treat the stored amount as monthly
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
