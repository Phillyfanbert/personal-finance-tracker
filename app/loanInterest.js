// Monthly interest on a loan.
//
// Why this is automatic when card interest is not. A card issuer computes
// interest on an AVERAGE DAILY BALANCE through a grace period the app can only
// guess at, so an automatic charge would add money owed that the statement then
// contradicts, and charging nothing is the safe direction there. A loan is the
// opposite case: interest is the stated rate times what is owed, charged
// monthly, and leaving it out is wrong in one guaranteed direction. Payments
// here reduce the balance by their FULL amount, so without interest added
// separately a $2,000 payment on a 6% mortgage removed $2,000 of principal when
// about $1,500 of it was interest, and net worth climbed away from the truth
// every month.
//
// It is still an ESTIMATE and every surface says so: a lender may compound on a
// different schedule, and this uses the balance as recorded when the month
// closes. Right order of magnitude and right direction.
//
// The schedule itself is savingsInterest.js's accrueMonthly, shared on purpose
// so a loan and a savings account cannot drift apart on day-of-month anchoring,
// compounding, the catch-up ceiling or never back-charging.
import { accrueMonthly } from "./savingsInterest.js";

/**
 * A loan accrues when it has a real rate and is not a card. `cardTypes` is
 * passed in because the set of grace-period types is app.js's to own, and a
 * second copy here would be exactly the kind of list that drifts.
 */
export function loanInterestEligible(debt, cardTypes) {
  if (!debt || cardTypes.has(debt.type)) return false;
  const rate = Number(debt.interest_rate);
  return Number.isFinite(rate) && rate > 0;
}

/**
 * Every month of interest owed between `interest_last_accrued` and `today`.
 * A null marker returns nothing: the caller seeds it rather than back-charging.
 * @returns {{payments: {date: string, amount: number}[], lastPaid: string|null, total: number, capped: boolean}}
 */
export function loanInterestAccruals(debt, today, cardTypes) {
  if (!loanInterestEligible(debt, cardTypes) || !today) {
    return { payments: [], lastPaid: null, total: 0, capped: false };
  }
  return accrueMonthly(Number(debt.balance), debt.interest_rate, debt.interest_last_accrued, today);
}
