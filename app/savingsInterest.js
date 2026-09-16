// Monthly interest on a deposit account.
//
// Why credit it at all, when this repo's standing rule is that interest is
// never applied automatically: that rule was written for the CREDIT side,
// where the alternative to charging is charging nothing, and charging nothing
// is the safe direction. Here the directions are reversed. A savings balance
// that is never credited drifts downward against the real bank balance every
// month, guaranteed and always the same way. An estimate is wrong by a smaller
// amount and in either direction, so crediting it lands closer to the truth
// than leaving it alone does.
//
// It is still an ESTIMATE, and every surface that shows it says so. A bank
// pays on the average daily balance across the period and compounds on its own
// schedule, while this only knows the balance as recorded right now. Right
// order of magnitude and right direction, not a figure to reconcile a
// statement against - the same claim cycleStatus()'s interestEstimate already
// makes on the credit side.

const r2 = (n) => Math.round(n * 100) / 100;

// Decided per TYPE, never per category, the same rule BANK_VALIDATED_TYPES and
// OVERDRAFT_ELIGIBLE_ASSET_TYPES follow.
//
// Every retirement and investment type is excluded deliberately and must stay
// excluded. Their value is a market return rather than a stated rate, and
// syncParentAssetValue() already owns those balances, so crediting a "rate"
// into one would both fabricate investment growth and be silently overwritten
// on the next load.
//
// `cd` is excluded for a different reason: a certificate's interest is fixed
// by its term and the app already models maturity separately, so a monthly
// accrual would describe a different product from the one actually held.
export const INTEREST_BEARING_ASSET_TYPES = new Set([
  "bank", "savings", "money_market", "cash_management",
  "second_chance_checking", "hsa",
]);

// Same 36-cycle ceiling autoLogDueSubscriptions and autoLogDueIncome use, and
// for the same reason: an app opened after a long gap should catch up, not run
// unbounded. Deliberately NOT exported - nothing outside this module has a
// reason to compare against it, and `capped` on the result already tells a
// caller the ceiling was reached.
const MAX_INTEREST_CATCHUP_MONTHS = 36;

// Two decimals, because assets.interest_rate is numeric(5,2): anything finer
// is silently rounded by the database, so a rate that rounds to 0.00 would be
// stored as a real-looking value that interestEligible() then rejects forever.
// The save handler refuses those rather than storing a number that does
// nothing, which is the same rule a zero credit limit and a zero overdraft
// already follow.
export const RATE_DECIMALS = 2;
export const roundRate = (n) => Math.round(Number(n) * 100) / 100;

/** A rate is only usable if the type earns interest AND a real rate is set. */
export function interestEligible(asset) {
  if (!asset || !INTEREST_BEARING_ASSET_TYPES.has(asset.type)) return false;
  const rate = Number(asset.interest_rate);
  return Number.isFinite(rate) && rate > 0;
}

/** One month of interest on `balance` at annual `ratePct`. Never negative. */
export function monthlyInterest(balance, ratePct) {
  const b = Number(balance);
  const r = Number(ratePct);
  if (!Number.isFinite(b) || !Number.isFinite(r) || b <= 0 || r <= 0) return 0;
  return r2(b * (r / 100 / 12));
}

// One month on, keeping the ORIGINAL day of month as the anchor rather than
// carrying a clamped day forward.
//
// Stepping from the previous result is what made a payment day ratchet
// earlier and never recover: from the 31st, a naive step gives Feb 28, then
// Mar 28, then Apr 28 forever. Anchored, it gives Feb 28, Mar 31, Apr 30,
// which is how a real monthly schedule behaves. Deliberately local rather
// than income.js's advanceIncomeDate, which clamps from the previous value
// for a cadence whose parameters genuinely differ - the same
// each-module-self-contained reasoning income.js itself records for not
// importing payoff.js's addMonthsISO.
function addMonthAnchored(iso, anchorDay) {
  const [y, m] = iso.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return null;
  let targetYear = y;
  let targetMonth = m + 1;
  if (targetMonth > 12) { targetMonth = 1; targetYear++; }
  const lastDay = new Date(targetYear, targetMonth, 0).getDate();
  const day = Math.min(anchorDay, lastDay);
  return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Every interest payment owed between the asset's `interest_last_paid` and
 * `today`, oldest first, plus the date the marker should move to and the total
 * to credit.
 *
 * `total` exists so the caller applies ONE balance write. applyAssetDelta
 * reads asset.value from the cached `assets` array and never writes back, so
 * calling it once per payment makes every call after the first read a stale
 * value and clobber its predecessor - the trap this repo already documents for
 * bulk expense delete, where netAmountByAccount() solves the same problem.
 *
 * Compounds across the catch-up, because a real account does: each month is
 * computed on the balance including what was credited the month before.
 *
 * A month where the balance is zero or overdrawn produces NO payment but still
 * advances the marker - an overdrawn account earns nothing, and leaving the
 * marker behind would make the app try that month again forever.
 *
 * `interest_last_paid` of null returns no payments and no new marker: the
 * caller seeds it instead. Back-paying would invent interest on balances this
 * app never knew, since it holds no history of what the balance was.
 *
 * @returns {{payments: {date: string, amount: number}[], lastPaid: string|null, total: number, capped: boolean}}
 */
export function interestPayments(asset, today) {
  const none = { payments: [], lastPaid: null, total: 0, capped: false };
  if (!interestEligible(asset) || !today) return none;
  const from = asset.interest_last_paid;
  if (!from) return none;

  const anchorDay = Number(from.split("-")[2]);
  if (!Number.isFinite(anchorDay)) return none;

  const rate = Number(asset.interest_rate);
  let balance = Number(asset.value);
  if (!Number.isFinite(balance)) return none;

  const payments = [];
  let marker = from;
  let total = 0;
  let cycles = 0;
  let capped = false;

  for (;;) {
    const next = addMonthAnchored(marker, anchorDay);
    if (!next || next <= marker) break;
    if (next > today) break;
    if (cycles >= MAX_INTEREST_CATCHUP_MONTHS) { capped = true; break; }

    const amount = monthlyInterest(balance, rate);
    if (amount > 0) {
      balance = r2(balance + amount);
      total = r2(total + amount);
      payments.push({ date: next, amount });
    }
    marker = next;
    cycles++;
  }

  return { payments, lastPaid: marker === from ? null : marker, total, capped };
}

/** What the next payment would be worth today, for showing on the card. */
export function nextInterestEstimate(asset) {
  if (!interestEligible(asset)) return null;
  const amount = monthlyInterest(asset.value, asset.interest_rate);
  return amount > 0 ? amount : null;
}
