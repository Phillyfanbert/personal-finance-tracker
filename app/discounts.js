// ============================================================================
// Discount discovery (README §3.7 / F6, v1 scope).
// Matches the user's ACTIVE subscriptions + profile against the curated
// subscription_catalog and surfaces cheaper, eligible plans.
// Pure & unit-testable; UI wiring lives in app.js.
// ============================================================================
import { monthlyAmount } from "./subscriptions.js";

/** Catalog price normalized to a monthly-equivalent (annual plans / 12). null if no price. */
export function catalogMonthly(entry) {
  if (entry.price === null || entry.price === undefined || entry.price === "") return null;
  const p = Number(entry.price);
  if (!Number.isFinite(p)) return null;
  return entry.plan_type === "annual" ? p / 12 : p;
}

// Approximate - real "senior discount" ages vary a lot by provider (50 for
// AARP-linked ones, 55-65 elsewhere). No catalog data uses this plan_type
// yet; tune this if/when real seeded entries need a specific threshold.
const SENIOR_AGE = 62;

function age(profile) {
  return profile?.birth_year ? new Date().getFullYear() - profile.birth_year : null;
}

/** Is the user eligible for a catalog plan given their profile? */
export function isEligible(entry, profile) {
  const status = profile?.status;
  switch (entry.plan_type) {
    case "student":
      return status === "student";      // needs verified student status
    case "military":
      return !!profile?.is_military;
    case "first_responder":
    case "healthcare":
      return !!profile?.is_first_responder_healthcare;
    case "senior": {
      const a = age(profile);
      return a !== null && a >= SENIOR_AGE;
    }
    case "individual":
    case "annual":
    case "family":
    default:
      return true;                       // available to anyone (family = household caveat)
  }
}

/** Loose service-name match, case-insensitive, tolerant of suffixes ("Spotify Premium"). */
export function matchService(subName, service) {
  const a = (subName || "").toLowerCase().trim();
  const b = (service || "").toLowerCase().trim();
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

const r2 = (n) => Math.round(n * 100) / 100;

/**
 * For each active subscription, find the cheapest ELIGIBLE catalog plan that
 * beats what the user currently pays (monthly-normalized).
 * @returns deals sorted by yearly savings, desc.
 */
export function findDeals(subscriptions, catalog, profile) {
  const deals = [];
  for (const sub of subscriptions) {
    if (!sub.is_active) continue;
    const current = monthlyAmount(sub);
    let best = null;
    for (const e of catalog) {
      if (!matchService(sub.name, e.service)) continue;
      if (!isEligible(e, profile)) continue;
      const m = catalogMonthly(e);
      if (m === null) continue;
      if (m < current - 0.01 && (!best || m < best.monthly)) best = { entry: e, monthly: m };
    }
    if (best) {
      const rawMonthly = current - best.monthly;
      const monthlySavings = r2(rawMonthly);
      deals.push({
        service: sub.name,
        currentMonthly: r2(current),
        planType: best.entry.plan_type,
        planMonthly: r2(best.monthly),
        planPrice: Number(best.entry.price),
        planCycle: best.entry.plan_type === "annual" ? "annual" : "monthly",
        eligibility: best.entry.eligibility || null,
        url: best.entry.url || null,
        notes: best.entry.notes || null,
        monthlySavings,
        yearlySavings: r2(rawMonthly * 12),
      });
    }
  }
  return deals.sort((a, b) => b.yearlySavings - a.yearlySavings);
}

/**
 * If the user is NOT marked as a student, find student-only plans they'd unlock
 * by setting that status - a gentle upsell (README §1.2 profile → F6).
 * @returns list of { service, studentMonthly, currentMonthly, potentialYearly }
 */
export function studentUpsell(subscriptions, catalog, profile) {
  if (profile?.status === "student") return [];
  const already = new Set(findDeals(subscriptions, catalog, profile).map((d) => d.service));
  const out = [];
  for (const sub of subscriptions) {
    if (!sub.is_active) continue;
    if (already.has(sub.name)) continue; // already have a non-student deal shown
    const current = monthlyAmount(sub);
    let best = null;
    for (const e of catalog) {
      if (e.plan_type !== "student") continue;
      if (!matchService(sub.name, e.service)) continue;
      const m = catalogMonthly(e);
      if (m === null) continue;
      if (m < current - 0.01 && (!best || m < best)) best = m;
    }
    if (best !== null) {
      out.push({
        service: sub.name,
        currentMonthly: r2(current),
        studentMonthly: r2(best),
        potentialYearly: r2((current - best) * 12),
      });
    }
  }
  return out.sort((a, b) => b.potentialYearly - a.potentialYearly);
}

// Generalizes studentUpsell() above for the profile-expansion eligibility
// fields (docs/ROADMAP.md Profile & Discount Discovery #2) - military,
// first_responder/healthcare, senior. Reuses isEligible() rather than
// re-deriving each profile-field check, so this and findDeals/isEligible
// can never silently disagree about what "eligible" means for a given
// plan_type. Currently has no catalog data to match against (seeding real
// researched prices was explicitly deferred - see ROADMAP.md), so this
// returns [] in practice today; the mechanism is complete and tested, it's
// just waiting on data, same shape studentUpsell() itself was in before
// any student catalog rows existed.
const UPSELLABLE_PLAN_TYPES = ["military", "first_responder", "healthcare", "senior"];

export function eligibilityUpsells(subscriptions, catalog, profile) {
  const already = new Set(findDeals(subscriptions, catalog, profile).map((d) => d.service));
  const out = [];
  for (const sub of subscriptions) {
    if (!sub.is_active) continue;
    if (already.has(sub.name)) continue;
    const current = monthlyAmount(sub);
    for (const planType of UPSELLABLE_PLAN_TYPES) {
      if (isEligible({ plan_type: planType }, profile)) continue; // already eligible - findDeals would've matched it
      let best = null;
      for (const e of catalog) {
        if (e.plan_type !== planType) continue;
        if (!matchService(sub.name, e.service)) continue;
        const m = catalogMonthly(e);
        if (m === null) continue;
        if (m < current - 0.01 && (!best || m < best)) best = m;
      }
      if (best !== null) {
        out.push({
          service: sub.name, planType,
          currentMonthly: r2(current), upsellMonthly: r2(best),
          potentialYearly: r2((current - best) * 12),
        });
        break; // one nudge per subscription - don't stack multiple plan-type nudges for the same sub
      }
    }
  }
  return out.sort((a, b) => b.potentialYearly - a.potentialYearly);
}

// ---- Live findings (deal_findings) ------------------------------------------
// The agent-discovered equivalent of findDeals() above, and deliberately held
// to the same bar: at most ONE result per subscription, the cheapest, and only
// when it actually beats what the user already pays.
//
// The card used to list every matching row instead, which in production meant
// eight rows for one Spotify subscription - four of them the same $21.99 from
// the same URL, and $21.99 is what the user already pays, so most of the card
// was noise that recommended nothing.

// A free trial changes what a price MEANS ("3 months free, then $6.99"), so a
// finding whose source text advertises one has to say so rather than showing
// the post-trial figure as if it were the price today. Read straight from the
// snippet the agent already stored, so the claim stays attached to the page it
// came from - never inferred from the number alone.
const TRIAL_PATTERNS = [
  /(\d+)\s*(day|week|month)s?\s+(?:free|on us|at no cost)/i,
  /free\s+for\s+(\d+)\s*(day|week|month)s?/i,
  /try\s+[^.]*?\bfor\s+(\d+)\s*(day|week|month)s?\s+(?:free|on us)/i,
];

/**
 * The trial offer named in a finding's own source text, or null.
 * @returns {{months:number|null, label:string}|null} `label` is phrased for
 *   display; `months` is null for a day/week trial, which is not meaningfully
 *   a monthly figure.
 */
export function trialFromSnippet(snippet) {
  const text = (snippet || "").replace(/\s+/g, " ");
  if (!text) return null;
  for (const re of TRIAL_PATTERNS) {
    const m = text.match(re);
    if (!m) continue;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n <= 0) continue;
    const unit = m[2].toLowerCase();
    const plural = n === 1 ? unit : unit + "s";
    return { months: unit === "month" ? n : null, label: `${n} ${plural} free first` };
  }
  return null;
}

/**
 * At most one live finding per active subscription: the cheapest that genuinely
 * beats what they pay now.
 *
 * Mirrors findDeals()' rule rather than inventing a second one - same
 * monthly-normalized comparison, same "must actually be cheaper" bar. A
 * finding with no price is dropped: it cannot be compared, so it cannot be
 * shown as a saving.
 *
 * @param {Array} subscriptions active-or-not; inactive are skipped
 * @param {Array} findings rows from deal_findings
 * @param {(subName: string, service: string) => boolean} matches service matcher
 * @returns {Array} one entry per subscription that has a genuine saving
 */
export function bestFindingPerSubscription(subscriptions, findings, matches = matchService) {
  const out = [];
  for (const sub of subscriptions || []) {
    if (!sub.is_active) continue;
    const current = monthlyAmount(sub);
    let best = null;
    for (const f of findings || []) {
      if (!f || f.status === "rejected") continue;
      if (!matches(sub.name, f.service)) continue;
      const price = Number(f.price);
      if (!Number.isFinite(price) || price <= 0) continue;
      // Findings are advertised monthly rates; an annual figure would need a
      // billing cycle the agent does not record, so nothing is divided here.
      if (price >= current - 0.01) continue;
      // Ties go to the row with real provenance, so the surviving finding is
      // the one a person can most easily check.
      const better = !best
        || price < best.monthly - 0.001
        || (Math.abs(price - best.monthly) <= 0.001 && !best.finding.url && f.url);
      if (better) best = { finding: f, monthly: price };
    }
    if (!best) continue;
    const saving = r2(current - best.monthly);
    out.push({
      subscriptionName: sub.name,
      currentMonthly: r2(current),
      finding: best.finding,
      monthly: r2(best.monthly),
      monthlySavings: saving,
      yearlySavings: r2(saving * 12),
      trial: trialFromSnippet(best.finding.raw_snippet),
    });
  }
  return out.sort((a, b) => b.yearlySavings - a.yearlySavings);
}
