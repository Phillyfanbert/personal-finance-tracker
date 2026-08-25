// ============================================================================
// Recurring income date-stepping. Pure, unit-testable - same style as
// subscriptions.js/payoff.js. Deliberately its own small clamped-month-add
// implementation rather than importing payoff.js's addMonthsISO or
// subscriptions.js's advanceRenewal - those two already coexist as
// separate near-duplicates for the same reason (each module stays
// self-contained rather than cross-importing across unrelated domains),
// and income cadences (weekly/biweekly's fixed day-count shape,
// semimonthly's two-fixed-calendar-day shape) don't map cleanly onto
// either existing function's parameters anyway.
// ============================================================================

/** Last real day of the given year/1-indexed-month, for clamping. */
function lastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/**
 * Steps `isoDate` forward one income cadence.
 *  - weekly/biweekly: a plain fixed day-count addition (+7/+14) - no
 *    month-length ambiguity, unlike every other cadence here.
 *  - monthly/annual: clamps the day-of-month to the target month's real
 *    length, the same overflow-safe logic payoff.js's addMonthsISO/
 *    subscriptions.js's advanceRenewal both already use (Jan 31 + 1 month
 *    lands on Feb 28, not Mar 3).
 *  - semimonthly: genuinely different in kind, not just degree - real
 *    semimonthly pay is two FIXED calendar days per month (e.g. the 1st
 *    and 15th), not a ~15-day interval, which would slowly drift off the
 *    real payday over calendar months of different lengths. Steps to
 *    whichever of the two anchors comes next after isoDate, wrapping to
 *    next month's earlier anchor once isoDate is at or past both of this
 *    month's (clamped) anchors. Returns isoDate unchanged if either
 *    anchor is missing - not fully configured yet.
 *  - one_time: never advances (no defined next occurrence) - returned
 *    unchanged, same as advanceRenewal's 'other' handling.
 */
export function advanceIncomeDate(isoDate, cadence, semimonthlyDay1 = null, semimonthlyDay2 = null) {
  if (!isoDate) return isoDate;
  const [y, m, day] = isoDate.split("-").map(Number);

  if (cadence === "weekly" || cadence === "biweekly") {
    const days = cadence === "weekly" ? 7 : 14;
    const d = new Date(y, m - 1, day);
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  if (cadence === "semimonthly") {
    if (!semimonthlyDay1 || !semimonthlyDay2) return isoDate;
    const anchors = [semimonthlyDay1, semimonthlyDay2].sort((a, b) => a - b);
    for (const anchor of anchors) {
      const clamped = Math.min(anchor, lastDayOfMonth(y, m));
      if (clamped > day) return `${y}-${String(m).padStart(2, "0")}-${String(clamped).padStart(2, "0")}`;
    }
    // Past both of this month's anchors - wrap to next month's earlier one.
    let targetMonth = m + 1;
    const targetYear = y + Math.floor((targetMonth - 1) / 12);
    targetMonth = ((targetMonth - 1) % 12) + 1;
    const clamped = Math.min(anchors[0], lastDayOfMonth(targetYear, targetMonth));
    return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(clamped).padStart(2, "0")}`;
  }

  const monthsToAdd = { monthly: 1, annual: 12 }[cadence];
  if (!monthsToAdd) return isoDate; // one_time - never advances
  let targetMonth = m + monthsToAdd;
  const targetYear = y + Math.floor((targetMonth - 1) / 12);
  targetMonth = ((targetMonth - 1) % 12) + 1;
  const clampedDay = Math.min(day, lastDayOfMonth(targetYear, targetMonth));
  return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
}

// Annualized total of active recurring income, for the Log page's Income
// tile and for the account-eligibility checks that genuinely depend on
// income (the CARD Act's under-21 rule, and the earned-income cap on IRA
// contributions).
//
// Returns 0 rather than null when nothing is logged. That is deliberate and
// differs from this project's usual omit-rather-than-fake-a-number rule:
// "no income recorded" really is zero income as far as every rule here is
// concerned, and the user explicitly asked the figure to read 0 when
// nothing has been entered. The UI still says "none recorded yet" alongside
// it so a real zero and an empty state stay tellable apart.
//
// one_time is excluded on purpose: a single past deposit is not an annual
// rate, and counting it as one would overstate recurring income for a year
// afterwards. Inactive sources are excluded for the same reason.
const CADENCE_PER_YEAR = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
  annual: 1,
};

export function annualIncome(sources) {
  if (!Array.isArray(sources)) return 0;
  return sources.reduce((sum, s) => {
    if (!s || s.is_active === false) return sum;
    const perYear = CADENCE_PER_YEAR[s.cadence];
    if (!perYear) return sum;
    const amount = Number(s.amount);
    if (!Number.isFinite(amount) || amount <= 0) return sum;
    return sum + amount * perYear;
  }, 0);
}

// A different question from annualIncome() above, deliberately kept
// separate rather than folded into it: this asks "is there ANY income on
// record at all," not "what is the annualized rate." Powers the CARD Act
// under-21 eligibility check (accountEligibilityWarning, app.js) - real
// card issuers evaluate "current or reasonably expected income," a self-
// reported figure that explicitly includes tips, seasonal work, and
// self-employment (verified live against the CFPB's own Regulation Z
// commentary, 2026-08-25), not a derived annualized rate the way this
// app's own recurring-source tracking is. The law itself sets no minimum
// dollar amount either, so a boolean read is a more honest mapping of the
// real test than inventing a dollar floor ever was.
//
// one_time IS counted here, unlike annualIncome() - a single freelance
// payment or a one-off gig genuinely is real income for this narrower
// question, even though it is correctly excluded from an annualized rate.
// This keeps the eligibility check fully automatic: the user never types
// an income figure anywhere, it simply reflects whatever they've already
// logged on the Income sources form, one-time or recurring alike.
//
// A one_time source is skipped from the is_active check specifically -
// autoLogDueIncome() deactivates it the INSTANT it's paid out, to stop it
// logging twice, so is_active:false there means "already received," not
// "this income stopped" the way it does for a recurring source. Filtering
// it out here would make a real, already-paid deposit stop counting as
// evidence of income at the exact moment it actually arrived. A recurring
// source turned inactive (a lost job) correctly still excludes.
export function hasAnyIncome(sources) {
  if (!Array.isArray(sources)) return false;
  return sources.some((s) => {
    if (!s) return false;
    const amount = Number(s.amount);
    if (!Number.isFinite(amount) || amount <= 0) return false;
    return s.cadence === "one_time" || s.is_active !== false;
  });
}
