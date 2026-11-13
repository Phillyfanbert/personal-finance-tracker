// ============================================================================
// What is set up but cannot run yet, and how long since balances were checked.
//
// Pure logic only, no DOM and no sb.from(...), the same separation every other
// logic module here keeps. app.js owns the strip on the Log page, the check-in
// sheet and every write; this file owns the questions those are built from.
//
// Why it exists. Measured across all four accounts on 2026-11-12: 2 logged
// expenses, 6 manual balance corrections, and on the most active account two
// bills that had been "due" since August plus an income source, none of them
// attached to an account. Everything the app does on its own was configured
// and switched off, and nothing on screen said so.
// ============================================================================

import { advanceRenewal } from "./subscriptions.js";
import { advanceIncomeDate } from "./income.js";

// The cycles the catch-up loops know how to step. Named once and exported so
// autoLogDueSubscriptions() and autoLogDueIncome() read the same lists the
// strip does. They were inline literals in each loop, and a strip holding its
// own copy would be free to call a bill "fine" that the loop then skipped.
export const AUTO_LOG_BILLING_CYCLES = ["monthly", "quarterly", "semiannual", "annual"];
export const AUTO_LOG_INCOME_CADENCES = ["weekly", "biweekly", "semimonthly", "monthly", "annual"];

// Why a bill will never be logged on its own, or null when it will be.
//
// This IS the skip test at the top of autoLogDueSubscriptions(), moved here so
// there is one of it. Share the function, not the formula: the loop calls
// this, and the strip calls this, so they cannot disagree about a bill.
export function billAutoLogBlocker(sub, accounts) {
  if (!sub || !sub.is_active) return "inactive";
  if (!sub.account_id) return "no_account";
  if (!sub.next_renewal) return "no_date";
  if (!AUTO_LOG_BILLING_CYCLES.includes(sub.billing_cycle)) return "cycle";
  const account = (accounts || []).find((a) => a.id === sub.account_id);
  // A deleted account nulls the link and fails the check above; an archived
  // one has to stop the loop the same way, or a bill would keep charging an
  // account that is meant to act deleted.
  if (!account || account.archived_at) return "account_gone";
  return null;
}

// The same for an income source. `one_time` is deliberately not held to the
// cadence list: it never repeats, and autoLogDueIncome() handles it as its
// own single deposit.
export function incomeAutoLogBlocker(src, accounts) {
  if (!src || !src.is_active) return "inactive";
  if (!src.account_id) return "no_account";
  if (!src.next_expected) return "no_date";
  const account = (accounts || []).find((a) => a.id === src.account_id);
  // linked_asset_id too: money can only be added to an account that has a
  // balance of its own. A card has none, so the add would be a silent no-op.
  if (!account || account.archived_at || !account.linked_asset_id) return "account_gone";
  if (src.cadence === "one_time") return null;
  if (!AUTO_LOG_INCOME_CADENCES.includes(src.cadence)) return "cadence";
  if (src.cadence === "semimonthly" && (!src.semimonthly_day_1 || !src.semimonthly_day_2)) return "no_pay_days";
  return null;
}

// EVERY fixable thing a bill is missing, not only the first the blocker
// trips on. The blocker answers "will the loop skip this", and stops at the
// first reason because one is enough to skip. The strip has to tell a person
// what to fill in, and naming only the first would send them back to the same
// form a second time for the date it never mentioned.
export function billMissing(sub, accounts) {
  const out = [];
  const account = (accounts || []).find((a) => a.id === sub.account_id);
  if (!sub.account_id) out.push("no_account");
  else if (!account || account.archived_at) out.push("account_gone");
  if (!sub.next_renewal) out.push("no_date");
  return out;
}
export function incomeMissing(src, accounts) {
  const out = [];
  const account = (accounts || []).find((a) => a.id === src.account_id);
  if (!src.account_id) out.push("no_account");
  else if (!account || account.archived_at || !account.linked_asset_id) out.push("account_gone");
  if (!src.next_expected) out.push("no_date");
  if (src.cadence === "semimonthly" && (!src.semimonthly_day_1 || !src.semimonthly_day_2)) out.push("no_pay_days");
  return out;
}

// The blockers a person can actually clear from the form. `cycle` and
// `cadence` are not among them on purpose: "Other" is a real billing cycle
// with no interval to step by, so telling someone to fix it would be telling
// them their bill is wrong.
export const FIXABLE_BLOCKERS = new Set(["no_account", "no_date", "account_gone", "no_pay_days"]);

// What a catch-up loop would do from `startISO` if it ran today: how many
// times it would act, and the first date it would leave alone.
//
// This is the hazard the "finish setting up" strip walks people straight into.
// A bill last due in August, given an account in November, is not a bill that
// starts being logged from now: the next time the app opens it logs August,
// September, October and November, and takes all four out of a balance that
// was corrected by hand weeks ago and already reflects them. The loop is right
// to catch up (that is what makes a week away from the app harmless); the form
// just has to say what it is about to do before it does it.
//
// `step` is the real date stepper for the thing being previewed, so this
// counts exactly what the loop will, including its 36-cycle ceiling.
export function catchUpPreview(startISO, step, today, cap = 36) {
  if (!startISO || startISO > today) return { count: 0, first: null, last: null, next: startISO || null };
  let date = startISO;
  let count = 0;
  let last = null;
  while (date <= today && count < cap) {
    const next = step(date);
    // A stepper that cannot advance would loop forever in the caller too,
    // which is why both loops stop here rather than log the same date twice.
    if (!next || next === date) break;
    last = date;
    count++;
    date = next;
  }
  return { count, first: count ? startISO : null, last, next: date > today ? date : null };
}

export function billCatchUp({ next_renewal, billing_cycle }, today) {
  return catchUpPreview(next_renewal, (d) => advanceRenewal(d, billing_cycle), today);
}

export function incomeCatchUp({ next_expected, cadence, semimonthly_day_1, semimonthly_day_2 }, today) {
  // A one-off never steps, so the generic preview would count it as nothing.
  // autoLogDueIncome() adds it exactly once when its date has arrived, and
  // then switches it off.
  if (cadence === "one_time") {
    const due = !!next_expected && next_expected <= today;
    return { count: due ? 1 : 0, first: due ? next_expected : null, last: due ? next_expected : null, next: null };
  }
  return catchUpPreview(
    next_expected,
    (d) => advanceIncomeDate(d, cadence, semimonthly_day_1, semimonthly_day_2),
    today
  );
}

// Whole days between two local calendar dates. Both are parsed at local
// midnight and the difference is rounded, so a daylight-saving day that is 23
// or 25 hours long still counts as one.
export function daysBetweenISO(fromISO, toISO) {
  const from = new Date(`${fromISO}T00:00:00`);
  const to = new Date(`${toISO}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return Math.round((to - from) / 86400000);
}

// "9 weeks", "3 days", "4 months". No "about" and no decimals: this is said in
// a sentence, and a count of weeks is as exact as that sentence needs.
export function sinceWords(days) {
  if (days == null || days < 0) return "";
  if (days === 1) return "1 day";
  if (days < 14) return `${days} days`;
  if (days < 60) return `${Math.floor(days / 7)} weeks`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"}`;
}

export const CHECKIN_EVERY_DAYS = 30;

// Whether the monthly balance check-in is due, and how long it has been.
// Null when it is not, which is also the answer for someone with nothing to
// check: a brand-new account holds one Cash balance of $0, and asking that
// person to confirm zero is still zero is noise.
//
// rows: [{ current, changedOn }], one per balance a person types in by hand.
// lastChecked: profiles.balances_checked_at, or null for never.
export function checkinDue({ rows = [], lastChecked = null, today }) {
  const worthChecking = rows.filter((r) => Number(r.current) !== 0);
  if (!worthChecking.length) return null;
  if (lastChecked) {
    const days = daysBetweenISO(lastChecked, today);
    return days != null && days >= CHECKIN_EVERY_DAYS ? { days, never: false } : null;
  }
  // Never done. Raised only once a balance has sat untouched for a month:
  // someone who entered everything yesterday does not need telling to check
  // it, and the age of the oldest balance is the honest measure of how long
  // it has been since anyone looked.
  const ages = worthChecking
    .map((r) => (r.changedOn ? daysBetweenISO(r.changedOn, today) : null))
    .filter((d) => d != null);
  if (!ages.length) return null;
  const oldest = Math.max(...ages);
  return oldest >= CHECKIN_EVERY_DAYS ? { days: oldest, never: true } : null;
}

// Whether a newly typed balance looks like a slip of the finger rather than a
// real change: ten times the old figure or a tenth of it, which is what one
// extra or one missing digit does. A fat-finger guard and never a limit, the
// same confirm-to-override shape confirmLargeAmount() has. It asks once and
// takes yes for an answer.
//
// Zero on either side never trips it. From zero, any figure is simply the
// first one; to zero is paying something off, which is ordinary and is not
// what a typo looks like. Small balances are exempt too: $8 becoming $95 is a
// tenfold jump and also just a week.
export const JUMP_FACTOR = 10;
export const JUMP_MIN_DIFFERENCE = 500;
export function balanceJumpLooksWrong(current, next) {
  const from = Math.abs(Number(current));
  const to = Math.abs(Number(next));
  if (!Number.isFinite(from) || !Number.isFinite(to) || !from || !to) return false;
  if (Math.abs(to - from) < JUMP_MIN_DIFFERENCE) return false;
  return to >= from * JUMP_FACTOR || to * JUMP_FACTOR <= from;
}
