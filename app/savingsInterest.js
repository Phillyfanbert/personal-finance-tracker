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

import { advanceIncomeDate } from "./income.js";

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
// for the same reason: an app opened after a long gap should catch up, not
// run unbounded.
export const MAX_INTEREST_CATCHUP_MONTHS = 36;

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

/**
 * Every interest payment owed between the asset's `interest_last_paid` and
 * `today`, oldest first, plus the date the marker should move to.
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
 * @returns {{payments: {date: string, amount: number, balanceAfter: number}[], lastPaid: string|null, capped: boolean}}
 */
export function interestPayments(asset, today, startingBalance = null) {
  const none = { payments: [], lastPaid: null, capped: false };
  if (!interestEligible(asset) || !today) return none;
  const from = asset.interest_last_paid;
  if (!from) return none;

  const rate = Number(asset.interest_rate);
  let balance = Number(startingBalance ?? asset.value);
  if (!Number.isFinite(balance)) return none;

  const payments = [];
  let marker = from;
  let cycles = 0;
  let capped = false;

  for (;;) {
    const next = advanceIncomeDate(marker, "monthly");
    // A cadence that cannot advance would loop forever against the cap while
    // writing the same month over and over - the exact bug autoLogDueIncome
    // was fixed for. Stop rather than log.
    if (!next || next === marker) break;
    if (next > today) break;
    if (cycles >= MAX_INTEREST_CATCHUP_MONTHS) { capped = true; break; }

    const amount = monthlyInterest(balance, rate);
    if (amount > 0) {
      balance = r2(balance + amount);
      payments.push({ date: next, amount, balanceAfter: balance });
    }
    marker = next;
    cycles++;
  }

  return { payments, lastPaid: marker === from ? null : marker, capped };
}

/** What the next payment would be worth today, for showing on the card. */
export function nextInterestEstimate(asset) {
  if (!interestEligible(asset)) return null;
  const amount = monthlyInterest(asset.value, asset.interest_rate);
  return amount > 0 ? amount : null;
}
