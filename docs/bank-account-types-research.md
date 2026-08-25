# Bank Account Types: Research Reference

*Status: reference document, not a proposal. This is background research on
how real-world bank and financial accounts are classified, and the factual
basis for this app's `accounts` / `assets` / `liabilities` type enums.
See "Mapping to this app's data model" (section 10) for how the research
connects back to what actually exists in `supabase/*.sql` and `app/app.js`
today.*

*Most of what this document catalogs is now implemented (55 selectable
account types as of 2026-08-12). Section **9b** is the part to read when
the question is "what does the app actually do with this number" rather
than "what is this product" - it covers how a balance moves, how net worth
counts it, when credit interest is genuinely charged, and how per-ticker
holdings roll up without being double-counted.*

## 1. Purpose and scope

This document catalogs the account types that exist across US retail
banking, credit unions, brokerages, and adjacent financial products, and
describes the attributes of each one that matter for building account
logic in software: whether it is a store of value or a debt, whether it
is federally insured, how liquid it is, and whether it behaves as a single
lump sum or an amortizing/revolving balance.

The app's current data model already draws a hard line between three
concepts, documented in `CLAUDE.md`:

| Table | Question it answers | Counted in net worth? |
|---|---|---|
| `accounts` | How did I pay for this? (a payment method tag) | No |
| `assets` | What do I own? | Yes |
| `liabilities` | What do I owe? (tracked debts) | Yes |

Everything below is organized to make it easy to slot a real-world account
type into one of those three buckets, or to flag it as something the
current model has no place for yet.

## 2. Deposit accounts (accounts you put money into)

These are accounts held at a bank or credit union where the institution
owes you the balance on demand or after a fixed term. They are assets to
the account holder and liabilities to the institution, which is the
opposite framing from a credit card or loan.

### 2.1 Checking accounts (demand deposit accounts)

A checking account, formally a "demand deposit account," is designed for
frequent transactions: debit card purchases, checks, electronic
transfers, and bill pay. Key characteristics:

- Usually pays little or no interest, since its purpose is transactional
  liquidity rather than saving.
- No federal limit on the number of withdrawals or transfers per month.
- Often has a linked debit card and a routing/account number pair used
  for ACH transfers and direct deposit.
- May charge a monthly maintenance fee, commonly waived by maintaining a
  minimum balance, setting up direct deposit, or being a student.
- Can go negative through an overdraft if the bank allows it, at which
  point it functions briefly like an unsecured short-term loan (see
  overdraft lines of credit in section 3.4).

### 2.2 Savings accounts

A savings account is also a demand deposit account, but is marketed and
priced for money you intend to keep rather than actively spend.

- Pays interest, typically higher than a checking account (a "high-yield
  savings account," or HYSA, at an online-only bank can pay meaningfully
  more than a brick-and-mortar bank's default rate).
- Historically capped at six "convenient" withdrawals or transfers per
  statement cycle under the Federal Reserve's Regulation D. The Fed
  removed this federal requirement in 2020, but many banks still enforce
  their own version of the limit and may charge a fee or convert the
  account to checking if it is exceeded repeatedly. Some online banks
  (Ally, Marcus, Capital One 360, SoFi, American Express National Bank)
  have dropped the limit entirely.
- Interest is variable and can change at the bank's discretion; the rate
  is quoted as an Annual Percentage Yield (APY).

### 2.3 Money market deposit accounts (MMDAs)

A money market account at a bank is a hybrid of checking and savings: it
usually pays a higher interest rate than a plain savings account (often
tiered by balance) while sometimes allowing limited check-writing or
debit card access.

- It is a deposit account, not an investment. This is the detail most
  often confused: a money market *deposit account* (a bank product) is a
  completely different thing from a money market *mutual fund* (an
  investment product sold through a brokerage). The deposit version is
  FDIC/NCUA insured; the mutual fund version is not, and its share price
  can (rarely) drop below $1.00 ("breaking the buck").
- Subject to the same historical six-withdrawal guidance as savings
  accounts, and the same variation in whether a given bank still enforces
  it.
- Usually requires a higher minimum balance than a savings account to
  open or to avoid a fee.

### 2.4 Certificates of deposit (CDs) / share certificates

A CD is a time deposit: you commit a lump sum for a fixed term (common
terms range from 3 months to 5 years) in exchange for a fixed interest
rate that is usually higher than a savings account's variable rate. A
credit union's equivalent product is usually called a "share
certificate," functionally identical and covered by NCUA instead of FDIC.

- The rate is locked for the whole term, which is a trade-off: it
  protects you if rates fall, but you miss out if rates rise.
- Withdrawing before maturity ("early withdrawal") normally triggers a
  penalty, commonly denominated in months of forfeited interest (for
  example, "3 months of interest" for a short-term CD or "6 to 12 months
  of interest" for a longer one). Federal rules set a minimum penalty of
  at least 7 days of interest for withdrawals within the first six days
  of deposit. In the worst case a penalty can eat into principal, not
  just interest earned.
- "No-penalty CDs" exist as a specific product that trades a slightly
  lower rate for the ability to withdraw early without a fee.
- A CD has a maturity date and typically auto-renews into a new CD of the
  same term at the bank's current rate unless the holder acts during a
  short grace window after maturity.

### 2.5 Cash management accounts

Offered by brokerages and some fintechs (for example Fidelity's cash
management account, or the core wallet of most robo-advisors), these
behave like a checking account (debit card, bill pay, ACH) but are
actually a brokerage account whose cash balance is automatically "swept"
into partner banks. The sweep structure is what lets some of these
products offer FDIC coverage well above the normal $250,000 single-bank
limit, since the cash is spread across multiple partner banks behind the
scenes.

## 3. Revolving credit accounts (accounts you borrow against, repeatedly)

These are liabilities: the institution has lent you money, and you owe it
back. "Revolving" means you can borrow, repay, and borrow again up to a
credit limit, as opposed to a one-time lump sum.

### 3.1 Credit cards

The most common revolving credit product for consumers.

- Has a credit limit, a statement/billing cycle, and a minimum payment.
- Interest (APR) applies only to the portion of the balance carried past
  the due date; paying the statement balance in full each cycle avoids
  interest entirely (the "grace period").
- Balances accrue the moment a purchase posts, regardless of when the
  card is actually paid off, since the card issuer has already fronted
  the money to the merchant.
- Many cards distinguish purchase APR, cash advance APR (usually higher,
  often with no grace period), and balance transfer APR.
- This app's existing `credit_card` liability type and `applyLiabilityDelta`
  logic (`app/app.js`) model this correctly already: a charge increases
  the balance owed the moment it happens, independent of payoff timing.

### 3.2 Personal lines of credit

An unsecured revolving credit line from a bank, similar in spirit to a
credit card but usually accessed by transfer rather than a physical card,
and often with a lower interest rate than an unsecured credit card
because underwriting can be stricter.

### 3.3 Home equity lines of credit (HELOC)

A HELOC is revolving credit secured by the equity in a home. It has two
phases:

- **Draw period** (commonly 10 years): the borrower can draw funds up to
  the credit limit and typically only owes interest on the amount drawn.
- **Repayment period** (commonly 10 to 20 years): no further draws are
  allowed, and the balance is repaid in installments covering principal
  and interest.

A HELOC is distinct from a home equity loan, which is an installment loan
(see 4.4): a home equity loan is a one-time lump-sum disbursement repaid
on a fixed schedule from day one, usually at a fixed rate, while a HELOC
is drawn as needed and usually carries a variable rate.

### 3.4 Overdraft lines of credit

Some banks offer an explicit, disclosed line of credit that automatically
covers a checking account overdraft instead of charging a flat overdraft
fee per transaction. Functionally a very small, cheap revolving line
tied to a checking account.

### 3.5 Charge cards

A charge card looks like a credit card but is a genuinely different
product, not just a variant. The defining traits:

- No preset spending limit in the way a credit card has a credit line
  (the limit instead flexes based on spending history and ability to
  pay).
- No revolving option: the full statement balance is due every month,
  with no ability to carry a balance and pay interest on it the way a
  credit card allows. Classic examples are the traditional (non-Skymiles/
  non-cashback-revolving) American Express charge cards.
- Because there is no revolving balance, a charge card typically has no
  purchase APR at all; missing a payment leads to late fees and account
  closure rather than accruing interest.

### 3.6 Secured credit cards

A secured credit card requires a cash deposit up front, usually equal to
the credit limit, which the issuer holds as collateral. It reports to the
credit bureaus exactly like an unsecured card, which is what makes it
useful for building or rebuilding credit history. Behaviorally, once
opened, it works exactly like an unsecured credit card (revolving
balance, statement cycle, APR on carried balances); the only structural
difference is the refundable security deposit sitting behind it.

### 3.7 Store and retail charge cards

A card usable only at one retailer or a small family of related brands
("closed-loop" credit), as opposed to a general-purpose card usable
anywhere ("open-loop"). Despite the name overlap with 3.5, most store
cards today are actually revolving credit cards with unusually high APRs,
not true charge cards; a genuine store charge card that must be paid in
full is now uncommon.

### 3.8 Buy Now, Pay Later (BNPL)

A short-term installment plan offered at the point of sale by services
like Affirm, Klarna, and Afterpay, usually splitting a purchase into
several equal, often interest-free, payments over a few weeks. It behaves
more like a series of tiny installment loans tied to a single purchase
than like a traditional revolving line, but it is grouped here because it
functions, from the consumer's point of view, as another way to buy now
and owe money after. Key differences from a credit card:

- Approval is per-purchase, not a standing credit line, though some BNPL
  providers now also offer a reusable virtual card.
- Credit bureau reporting is inconsistent across providers and has been
  changing fast as the industry matures: as of 2026, Affirm reports all
  of its plans (including its short "Pay in 4" product) to Experian and
  TransUnion, Klarna reports only its longer pay-over-time plans and not
  Pay in 4, and Afterpay does not report to the bureaus at all. Even when
  reported, this data is generally tagged separately and kept out of the
  score a lender actually pulls, so it should not be assumed to build
  credit the way an on-time credit card payment does.
- Missing a payment usually triggers a flat late fee rather than interest,
  though some longer-term BNPL plans do carry interest.

### 3.9 Medical and deferred-interest cards

Cards like CareCredit, and many furniture/jewelry store financing offers,
are revolving credit accounts issued by a bank (Synchrony, in CareCredit's
case) but marketed through a provider (a dentist, vet, or retailer) for a
specific purchase.

Their defining feature is **deferred interest**, which behaves very
differently from a normal card's 0% promotional APR and is a common source
of unexpected debt:

- The offer is typically "no interest if paid in full within N months."
- Interest still *accrues* in the background during the promotional
  period at the regular APR (often 25-30%).
- If the full balance is not cleared by the deadline, all of that accrued
  interest is charged retroactively, back to the original purchase date,
  not just on the remaining balance.
- A true 0% promotional APR, by contrast, charges nothing for the promo
  period and then applies interest going forward only on what is left.

So a $2,000 dental bill paid down to $50 by the deadline can still trigger
several hundred dollars of retroactive interest on the entire original
$2,000.

## 4. Installment loan accounts (borrow once, repay on a fixed schedule)

Unlike revolving credit, an installment loan disburses a fixed amount up
front and is repaid in scheduled payments (usually equal, "amortizing"
payments) until the balance reaches zero. There is no way to re-borrow
against the same loan once it is paid down, the way there is with a
credit card or HELOC.

### 4.1 Personal loans

Unsecured (or occasionally secured) lump-sum loans, typically used to
consolidate other debt, cover a large one-time expense, or finance a
purchase not tied to a specific asset. Fixed rate and fixed term are the
norm.

### 4.2 Auto loans

Secured by the vehicle being financed; the lender holds a lien on the
title until the loan is paid off. Terms commonly range from 36 to 84
months. Defaulting risks repossession, since the loan is secured.

### 4.3 Mortgages

A long-term (commonly 15 or 30 years in the US) loan secured by real
property. A mortgage payment is usually more than just principal and
interest: it frequently bundles property tax and homeowners insurance
into an escrow sub-account managed by the servicer, which is worth
knowing about even though it is not something this app currently models
at that level of detail.

### 4.4 Home equity loans

As noted in 3.3, this is the installment counterpart to a HELOC: a single
lump sum secured by home equity, repaid on a fixed schedule at a (usually)
fixed rate.

### 4.5 Student loans

Installment loans for education, split into two very different
regulatory worlds:

- **Federal student loans**: originated or guaranteed by the US
  Department of Education, with standardized repayment plans (including
  income-driven repayment options), deferment/forbearance rights, and
  potential forgiveness programs that private loans do not offer.
- **Private student loans**: originated by a bank or private lender,
  underwritten like any other consumer loan, generally without the
  federal protections above.

### 4.6 Payday and title loans

Short-term, high-cost lending products aimed at borrowers who need cash
before their next paycheck or who cannot qualify for traditional credit.

- **Payday loans**: a small, short-term loan (commonly due on the
  borrower's next payday, typically within two to four weeks), usually
  secured only by a post-dated check or ACH authorization rather than any
  collateral. Fees translate to very high effective annual percentage
  rates compared to any product discussed above.
- **Title loans**: a short-term loan secured by the borrower's vehicle
  title, carrying repossession risk similar to an auto loan but with
  much shorter terms and higher costs than a traditional auto loan.

Both are installment-style in that they disburse a lump sum and expect
repayment on a fixed (often very short) schedule, though they are
sometimes rolled over into a new loan if not repaid on time, which can
functionally extend them indefinitely. They are included here for
completeness as real, common individual liabilities, not as a
recommendation to use them.

### 4.7 Credit-builder loans

Offered mainly by credit unions and fintechs (Self, Credit Strong) to
people with thin or damaged credit files. The mechanics run backwards
compared to a normal loan: the "borrowed" amount is deposited into a
locked savings account the borrower cannot touch, the borrower makes
monthly payments against it, and the money is released only once the loan
is fully repaid. The lender reports those payments to the credit bureaus
throughout.

Modelling note: this is genuinely both a liability (the loan balance) and
a restricted asset (the locked deposit) at the same time, and the two
offset each other almost exactly. Treating only the liability side would
overstate what the borrower actually owes on net.

### 4.8 Retirement plan loans (401(k)/403(b) loans)

Many employer plans let a participant borrow from their own vested
balance, typically up to the lesser of $50,000 or 50% of the vested
balance, repaid by payroll deduction over up to five years (longer for a
primary-residence loan).

What makes this unlike any other loan in this document: the borrower is
both the lender and the debtor. Interest is paid back into the
participant's own account rather than to a bank. The real cost is
opportunity cost, since the borrowed portion is out of the market and
stops compounding for the life of the loan.

The consequential risk is separation from the employer: if the borrower
leaves or is let go, the outstanding balance generally becomes due by the
following year's tax filing deadline, and anything unpaid is treated as a
distribution, triggering income tax plus (under age 59½) a 10% early
withdrawal penalty.

## 5. Retirement and investment accounts

These are asset accounts whose defining feature is a tax treatment set by
the tax code rather than by the bank, and whose value fluctuates with the
market rather than being a fixed dollar balance the way a savings account
is.

### 5.1 Employer-sponsored retirement plans

401(k) (private-sector), 403(b) (nonprofit/education), and 457(b)
(government) plans are employer-sponsored, tax-advantaged retirement
accounts, usually funded by payroll deduction and often matched in part
by the employer. Funds are invested in a menu of mutual funds or similar
vehicles chosen by the plan, not held as cash.

### 5.2 Individual Retirement Accounts (IRAs)

- **Traditional IRA**: contributions may be tax-deductible; withdrawals
  in retirement are taxed as ordinary income.
- **Roth IRA**: contributions are made with after-tax money; qualified
  withdrawals in retirement are entirely tax-free, including all
  investment growth.
- **SEP IRA** and **SIMPLE IRA**: employer-sponsored variants aimed at
  small businesses and the self-employed, with different contribution
  rules than a standard IRA.

### 5.3 Brokerage (taxable investment) accounts

A standard, non-tax-advantaged account for buying and holding stocks,
bonds, ETFs, and mutual funds. No contribution limits and no early
withdrawal penalty, but investment gains are taxable in the year they are
realized (and some distributions, like dividends, are taxable even if
never withdrawn).

### 5.4 529 education savings plans

A tax-advantaged account earmarked for education expenses. Contributions
are not federally tax-deductible, but growth and qualified withdrawals
(tuition, and now some K-12 and student loan repayment uses) are tax-free
at the federal level, and many states offer a state tax deduction for
contributions.

### 5.5 Thrift Savings Plan (TSP)

The federal government and military equivalent of a 401(k), available to
federal employees and uniformed service members. Functions much like a
401(k) (payroll contributions, an employer/agency match for many
participants, a menu of index-fund-style investment options) but is its
own distinct plan type governed by different rules than a private-sector
401(k).

### 5.6 Solo 401(k)

A 401(k) variant for a self-employed person with no full-time employees
other than a spouse. It allows contributing both as the "employer" and
the "employee" side of the plan, which can allow higher total
contributions than a SEP or SIMPLE IRA at the same income level.

### 5.7 Rollover and inherited IRAs

Not separate tax categories from a Traditional or Roth IRA, but distinct
enough in how they are funded and governed to be worth naming separately:

- **Rollover IRA**: a Traditional (or Roth) IRA funded specifically by
  moving money out of an old employer's 401(k) or similar plan, usually
  when leaving a job. Some custodians track it separately from a
  "regular" IRA even though the tax treatment is the same, since keeping
  rollover funds segregated preserves the option to roll them into a new
  employer's plan later.
- **Inherited IRA**: an IRA (of any underlying type) opened by a
  beneficiary after the original owner's death. It carries its own
  required-withdrawal rules, which differ significantly depending on the
  beneficiary's relationship to the original owner and have changed
  materially under recent federal law, so it should not be assumed to
  follow the same withdrawal rules as an IRA the holder opened for
  themselves.

### 5.8 Annuities

An insurance-company contract, not a bank or brokerage account, that
converts a lump sum or a stream of payments into either future growth or
a guaranteed future income stream, often used as a retirement-income
tool. Broad categories:

- **Fixed annuity**: guarantees a set rate of return, similar in spirit
  to a CD but issued by an insurer rather than a bank. It is backed by
  the insurer's own claims-paying ability and by state guaranty
  associations, not by FDIC, NCUA, or any federal deposit insurance
  program.
- **Variable annuity**: the value fluctuates with an underlying
  investment portfolio, similar in spirit to a brokerage account, and
  carries market risk the fixed version does not.
- Annuities are also notable for often carrying significant surrender
  charges for withdrawing money within the first several years of the
  contract, conceptually similar to (but often steeper than) a CD's early
  withdrawal penalty.

### 5.9 Employee Stock Purchase Plans (ESPP)

A payroll-deduction plan letting employees buy their employer's stock,
usually at a 5-15% discount off the market price. Many plans add a
"lookback," pricing the purchase off the lower of the price at the start
or the end of the offering period, which can make the effective discount
considerably larger than the headline figure.

Two attributes matter for tracking:

- **Concentration risk.** The holding is the employer's own stock, so the
  employee's salary and a chunk of their savings depend on the same
  company. This is a real risk worth being able to see, which is an
  argument for tracking ESPP shares under their own ticker rather than as
  an undifferentiated lump.
- **Cost basis is not the market price.** The discount is treated as
  compensation income, and cost basis reporting on ESPP shares is a
  well-known source of double-taxation errors on tax returns.

### 5.10 Pensions (defined benefit plans)

A traditional pension promises a monthly income in retirement, calculated
from salary and years of service, rather than accumulating an account
balance the participant owns.

This makes it the odd one out in this section, and the hardest thing here
to represent honestly as a net-worth line: there is no account balance.
What exists is a future income stream. Assigning it a present value
requires assumptions about discount rate, life expectancy, and whether
benefits are inflation-adjusted, all of which the holder would have to
supply and none of which the app can reasonably guess.

Pensions are also usually backed by the Pension Benefit Guaranty
Corporation (PBGC) rather than FDIC/NCUA/SIPC, up to statutory limits.

### 5.11 Custodial investment accounts (UTMA/UGMA)

Covered in section 7 as a *titling* structure, but they are worth noting
here as an account type too, because a custodial brokerage account behaves
like a taxable brokerage account with three differences: the assets
legally belong to the minor, control transfers irrevocably to them at the
age of majority, and investment income above a threshold is taxed under
the "kiddie tax" rules at the parent's marginal rate.

The irrevocability is the part with real consequences: money put into an
UTMA cannot be taken back out for the parent's own use, and the balance
counts heavily against the child in college financial aid formulas, far
more so than a 529 owned by the parent.

## 6. Specialty and purpose-built accounts

### 6.1 Health Savings Accounts (HSA)

Available only to people enrolled in a qualifying high-deductible health
plan. An HSA is unusually favorable from a tax perspective: contributions
are pre-tax (or deductible), growth is tax-free, and withdrawals for
qualified medical expenses are also tax-free, a "triple tax advantage"
no other common account type offers. Unlike an FSA, unused HSA funds
roll over indefinitely and the account is owned by the individual, not
tied to a specific employer.

### 6.2 Flexible Spending Accounts (FSA)

An employer-sponsored account for setting aside pre-tax money for medical
(or, separately, dependent care) expenses. The defining constraint is
"use it or lose it": unused funds are generally forfeited at year end,
though an employer may optionally offer either a small carryover amount
or a short grace period, never both. An FSA is tied to current
employment and is generally forfeited if you leave the job before
spending the balance.

### 6.3 Prepaid debit cards

A card loaded with a fixed amount of money that is not linked to a
traditional bank account or line of credit. Often used for budgeting,
gift-giving, or by people without access to a traditional checking
account. Some are reloadable, some are not. Consumer protections and
FDIC-passthrough insurance vary by issuer and program.

### 6.4 Digital wallets and neobank balances

Balances held in apps like PayPal, Venmo, Cash App, or Apple Cash sit in
a gray area: they can feel like a bank account but are legally structured
differently, and their treatment matters for insurance purposes.

- Many of these products now pass through FDIC insurance to a partner
  bank for the underlying balance, but the details (whether it applies
  automatically, whether it requires a specific "savings" feature to be
  enabled) vary by provider and have changed over time, so this is worth
  re-verifying per-provider rather than assuming.
- Neobanks (Chime, Varo, Current, and similar) are technology companies
  that are not themselves banks; they partner with a chartered bank
  behind the scenes to actually hold FDIC-insured deposits and issue
  cards. Functionally, from the user's point of view, the checking and
  savings account types described in section 2 cover these products
  adequately.

### 6.5 Business accounts

Business checking, business savings, and merchant services accounts
exist in parallel to their personal equivalents, generally with higher
fees, higher transaction limits, and different insurance treatment for
sole proprietorships versus incorporated entities. This app is scoped to
personal finance for a small number of individual users (see
`CLAUDE.md`), so business accounts are noted here for completeness but
are explicitly out of scope for the account-type modeling this research
is meant to support.

### 6.6 Coverdell Education Savings Accounts (ESA)

An older, more restrictive alternative to a 529 plan (section 5.4).
Contributions are capped at $2,000 per beneficiary per year across all
Coverdell accounts combined, far lower than a 529's typical six-figure
lifetime cap, and contributions generally stop once the beneficiary
turns 18. Remaining funds must generally be distributed by the time the
beneficiary turns 30 (unused earnings become taxable plus a 10% penalty
if not rolled to another family member's account first), with an
exception for special-needs beneficiaries. A 529 has no such age limit
at all. Tax treatment (tax-free growth and qualified withdrawals) is
otherwise similar to a 529.

### 6.7 ABLE accounts

A tax-advantaged savings account for an individual whose disability
began before a set age, created so that person can save money without
jeopardizing eligibility for means-tested benefits like Medicaid or
Supplemental Security Income, which normally cap how much a recipient
can have in savings. The age threshold has moved over time and is worth
double-checking against current law before relying on it: it was
originally age 26, and was raised to age 46 effective January 1, 2026
under the ABLE Age Adjustment Act. Growth and qualified
disability-expense withdrawals are tax-free, similar in spirit to an HSA
or 529, and a beneficiary can typically hold up to $100,000 in the
account without it counting against most means-tested benefit limits.

### 6.8 Health Reimbursement Arrangements (HRA)

An employer-funded account (unlike an HSA or FSA, an employee cannot
contribute their own money to it) that reimburses an employee for
qualified medical expenses, up to an amount the employer decides.
Ownership and portability rules are set entirely by the employer's plan
design, so whether unused funds roll over, and what happens to the
account if the employee leaves, varies far more than it does for an HSA
or FSA.

### 6.9 Dependent Care FSA

A separate FSA type from the medical FSA covered in 6.2, set aside
pre-tax specifically for dependent care expenses (daycare, before/after
school care, adult dependent care) rather than medical costs. It has its
own separate contribution limit and is subject to the same general
use-it-or-lose-it timing as a medical FSA.

### 6.10 Treasury Direct accounts

An account held directly with the US government (through the
TreasuryDirect.gov platform), used to buy and hold Treasury securities,
including Series I savings bonds ("I bonds"), Series EE bonds, Treasury
bills, notes, and bonds, without going through a bank or brokerage.
Because the holding is a direct claim on the US government rather than a
deposit at a bank or credit union, it is not FDIC or NCUA insured in the
way a savings account is, but it is instead backed by the same full
faith and credit of the US government that backs FDIC and NCUA
themselves.

### 6.11 Cryptocurrency exchange and wallet balances

A balance held at a cryptocurrency exchange (Coinbase, Kraken, and
similar) or in a self-custodied wallet. This is not a bank account in any
legal sense, and critically:

- Crypto balances are not FDIC, NCUA, or SIPC insured under any
  circumstance, regardless of what the exchange's marketing may imply
  about a portion of *cash* balances (as opposed to crypto holdings)
  sometimes being FDIC-passthrough insured at a partner bank.
- Value is market-priced and can be highly volatile compared to any
  other account type in this document.
- Included here because many individuals now track it as part of their
  net worth even though it behaves nothing like a deposit account.

### 6.12 Multi-currency and foreign currency accounts

An account (increasingly offered by fintechs like Wise, and by some
traditional banks for customers with international needs) that holds
balances in more than one currency, or a foreign currency directly,
rather than converting everything to US dollars. Relevant mainly for
individuals who travel frequently, work remotely for a foreign employer,
or send money internationally.

### 6.13 Life insurance cash value

Certain permanent life insurance policies (whole life, universal life)
build a "cash value" component alongside the death benefit, which the
policyholder can borrow against or withdraw from while alive. It is not
a bank account and is not FDIC, NCUA, or SIPC insured; it is backed by
the issuing insurer, similar to an annuity (5.8). Growth is generally
tax-deferred, and policy loans are generally not taxable as long as the
policy stays in force, though this area has enough nuance that it should
not be assumed to work exactly like a normal account.

### 6.14 Payroll cards

A prepaid card (see 6.3) issued by an employer as a way to pay wages to
an employee who does not have a traditional bank account, loaded each
pay period instead of a direct deposit. Distinct from a general prepaid
card mainly in how it is funded (employer payroll, on a recurring basis)
rather than in its underlying mechanics.

### 6.15 Second-chance checking accounts

A checking account product specifically designed for someone who cannot
qualify for a standard checking account, typically because of a negative
history in ChexSystems (a consumer reporting agency for bank account
history, distinct from the three major credit bureaus). Usually carries
more restrictions (no overdraft, a monthly fee) than a standard checking
account, but exists as a path back to a normal banking relationship.

### 6.16 Escrow accounts

Briefly mentioned under mortgages (4.3), but worth calling out as its own
concept: an escrow account is money held by a third party (often a
mortgage servicer, but also used in real estate transactions generally)
on behalf of two parties until a specific condition is met, such as a
tax and insurance bill coming due, or the closing conditions of a home
sale being satisfied. It is not really a personal account the holder
controls day to day; it is better thought of as a holding mechanism
layered on top of another transaction.

## 7. Ownership structures (apply across most account types above)

How an account is titled changes both its legal ownership and its
deposit insurance treatment, independent of which product type (checking,
savings, CD, and so on) it is.

- **Individual account**: one owner.
- **Joint account**: two or more owners, each usually with equal and
  independent access. Joint accounts get their own separate FDIC/NCUA
  insurance category from an individual account held by the same person
  at the same bank (see section 8).
- **Trust accounts**: held in the name of a revocable or irrevocable
  trust; insurance rules for these were simplified by the FDIC in recent
  years but remain their own distinct category, separate from an
  individual account owned by the same person.
- **Custodial accounts (UTMA/UGMA)**: opened by an adult custodian on
  behalf of a minor; the minor is the legal owner of the assets, and
  control transfers to them at the age of majority set by state law.
- **Payable-on-death (POD) / beneficiary designations**: not a separate
  account type, but a designation that determines who receives the funds
  on the owner's death without going through probate. Retirement accounts
  use the similar concept of a named beneficiary.

## 8. Deposit insurance and investor protection

| Program | Covers | Standard limit | Backed by |
|---|---|---|---|
| FDIC | Deposits at FDIC-member banks (checking, savings, MMDA, CDs) | $250,000 per depositor, per bank, per ownership category | Full faith and credit of the US government |
| NCUA (Share Insurance Fund) | "Shares" at federally insured credit unions (share draft/checking, share savings, share certificates) | $250,000 per member, per credit union, per ownership category; IRA/KEOGH shares insured separately up to $250,000 | Full faith and credit of the US government |
| SIPC | Cash and securities held at a failed brokerage (not investment losses) | Up to $500,000 total, of which at most $250,000 can be cash | SIPC member assessments, not a government guarantee |
| State guaranty associations | Annuities and life insurance cash value at a failed insurer | Commonly around $250,000 per owner per insurer, but varies by state and by product, so it should be checked per state rather than assumed | State-level industry guaranty funds, not a federal guarantee and not backed by taxpayer money |
| None | Cryptocurrency exchange/wallet balances, BNPL and payday loan liabilities, Treasury Direct holdings | Not applicable | Treasury Direct holdings are instead backed directly by the full faith and credit of the US government, exactly like FDIC/NCUA; crypto and BNPL/payday balances have no comparable backstop at all |

Important nuances:

- FDIC and NCUA coverage is automatic the moment an account is opened at
  a member institution; there is nothing to sign up for.
- Coverage multiplies across ownership categories, not just across
  banks: the same person can have $250,000 covered in an individual
  account, another $250,000 in a joint account, and another $250,000 in
  an IRA, all at the same bank, and all fully insured.
- Neither FDIC nor NCUA insures investment products (stocks, bonds,
  mutual funds, money market *funds*, annuities) even if sold at a bank
  or credit union branch. That is what SIPC is for instead, and SIPC
  itself does not protect against the investments simply losing value,
  only against the brokerage failing while holding the customer's assets.
- Annuities and life insurance cash value are not FDIC, NCUA, or SIPC
  covered at all; their protection comes from state guaranty
  associations, which work more like a patchwork safety net than a
  single federal guarantee.
- Cryptocurrency balances have no equivalent protection of any kind, and
  should not be assumed safe just because they are held at a large,
  well-known exchange.

## 9. Cross-cutting attributes worth modeling

Rather than thinking product-by-product, it helps to reduce every account
type above to a small set of yes/no or enum attributes, since that is
closer to how a schema actually needs to represent them.

| Attribute | Why it matters |
|---|---|
| Direction (asset vs liability) | Determines whether it should live in `assets`, in `liabilities`, or neither, per this app's existing three-way split. |
| Revolving vs installment vs lump-sum-static | A credit card's balance moves with every purchase; an installment loan's balance only moves on a fixed amortization schedule; a savings account's balance only moves through explicit user action or interest posting. |
| Liquidity | Checking and savings are available on demand; a CD is locked until maturity (or penalized); a 401(k)/IRA has tax penalties for early access before a set age; a HELOC's draw period eventually ends. |
| Interest-bearing | Whether the balance grows (savings, CD, money market) or the balance is what you owe growing against you (credit card, loan). |
| Insured / not insured | FDIC, NCUA, SIPC, or none (a digital wallet balance not passed through to a partner bank, or an investment held directly). |
| Tax treatment | Ordinary taxable, tax-deferred (traditional 401(k)/IRA), tax-free growth (Roth, HSA, 529), or use-it-or-lose-it (FSA). |
| Requires a linked external product to make sense | A HELOC or mortgage escrow only makes sense relative to a specific home; a 529 or custodial account is tied to a specific beneficiary. |
| Value source | A dollar balance the user (or the bank) sets directly, versus a market-priced value that has to be fetched or estimated (brokerage, retirement, and technically a vehicle via depreciation, per `docs/asset-depreciation-proposal.md`). |
| Cost profile | Whether the product is cheap/free to hold (checking, savings, most credit cards paid in full) versus structurally expensive (payday loans, title loans, most carried credit card balances), which matters if this app ever wants to flag or warn about a liability rather than just track its balance neutrally. |

## 9b. How money is counted in each account type

Sections 2 through 8 describe what each product *is*. This section
describes what the app actually *does* with the number, which is the part
that has to be right for a balance or a net-worth figure to mean anything.

### 9b.1 The three ways a balance can move

Every account type in this app moves its balance through exactly one of
these mechanisms. Which one applies is decided by whether the account has
a `linked_asset_id` or a `linked_liability_id`, never by comparing its type
against a string (see `CLAUDE.md`'s data model section).

| Mechanism | What moves the number | Types |
|---|---|---|
| **Spend-down** | A dated expense against the account reduces the linked asset (`applyAssetDelta`). | Checking, savings, money market, cash management, cash, prepaid/payroll cards, digital wallet, HSA/FSA/HRA, multi-currency |
| **Borrow-up** | A dated expense against the account *increases* the linked liability (`applyLiabilityDelta`); a payment reduces it and reduces a funding asset at the same time. | Credit card, charge card, secured card, store card, medical card, HELOC, personal line of credit, overdraft line, BNPL |
| **Mark-to-value** | No expense ever touches it. The balance changes when the user records a new value, or when a live price is found for a ticker held inside it. | Every retirement and investment type, CD, crypto, annuity, life insurance cash value, treasury direct, property, vehicle |

A type being "mark-to-value" is exactly why it is excluded from the
expense payment pickers (`NON_SPENDABLE_ACCOUNT_TYPES`): you cannot swipe
a Roth IRA at a shop, so offering it as a payment method could only ever
produce a wrong balance.

### 9b.2 Net worth counts face value, deliberately

Net worth is `assets - liabilities`, both at face value. Two consequences
worth being explicit about, because both are judgement calls rather than
oversights:

- **No tax haircut on pre-tax balances.** A $50,000 traditional 401(k) is
  worth meaningfully less than a $50,000 Roth 401(k), because every dollar
  withdrawn from the traditional one owes income tax at a rate nobody can
  know in advance. Applying an estimated haircut would require guessing
  the user's future marginal rate, so the app records the account type
  (which is why Traditional and Roth are separate types now) and reports
  the real balance, rather than inventing a number.
- **No present value for pensions.** A defined-benefit pension has no
  balance to report at all (5.10). Whatever figure the user enters is
  their own estimate, and the app treats it as an ordinary asset value.

### 9b.3 Credit accounts: when interest is actually charged

The rule the app encodes (`app/creditCycle.js`), and the single most
commonly misunderstood one:

> Interest is governed by the **grace period**, not by lateness. Paying the
> **statement balance in full** by the due date means no interest at all.
> Carrying any part of it accrues interest on the remainder, *even if every
> payment was on time*. **Paying only the minimum does not hold off
> interest** - it only avoids a late fee.

The three end-of-cycle outcomes:

| Paid by the due date | Interest | Late fee |
|---|---|---|
| Statement balance in full | No | No |
| At least the minimum, less than full | **Yes**, on the remainder | No |
| Less than the minimum | **Yes** | **Yes**, plus possible penalty APR |

Interest is estimated as `remaining balance x (APR / 12)`. A real issuer
computes it on an average daily balance across the cycle, so the app's
figure is labelled an estimate everywhere it appears and is never applied
automatically - the user confirms each charge, and it lands in the history
as an undoable row.

Two types are deliberately excluded from this math
(`GRACE_PERIOD_LIABILITY_TYPES`): a HELOC, personal line of credit, or
overdraft line accrues interest from the day it is drawn and has no grace
period to lose, so telling the user "pay in full to avoid interest" would
be false. Deferred-interest medical/store cards (3.9) are included, but
note their retroactive-interest trap is *not* modelled - the app cannot
see the promotional deadline.

### 9b.4 Investment accounts: holdings roll up, and are counted once

An investment account may contain per-ticker holdings (an `assets` row
with `parent_asset_id` pointing at the account's own asset, see
`supabase/40_asset_holdings.sql`).

The counting rule:

- A holding's value is **never** counted on its own.
- The parent account's `value` is maintained as the sum of its holdings.
- An account with no holdings recorded keeps its own blended value, which
  is the only figure it has (a plain 401(k) reporting one number).

So an account is worth what its positions are worth, counted exactly once.
Both the net-worth total and the Assets card go through `topLevelAssets()`,
and every portfolio total goes through `countableInvestmentAssets()`, which
drops any parent whose holdings are being counted individually. Bypassing
either would silently double every invested dollar.

A holding's own value comes from `shares x latest found price` once
`tools/price-agent.js` has found one, falling back to the manually entered
value until then. Gain/loss compares that against `purchase_price`, which
for an investment means **total cost basis**, not price per share (the same
column means a vehicle's purchase price for depreciation, which is why the
two are separate form fields that never both apply).

### 9b.5 Special cases worth remembering

| Type | Counting quirk |
|---|---|
| Credit-builder loan (4.7) | Genuinely a liability *and* a restricted asset at once; they nearly cancel. Recording only the loan overstates what is owed on net. |
| Retirement plan loan (4.8) | The user borrowed from themselves. The liability is real, but the interest is paid back into their own account, so it is not a cost in the way other loan interest is. |
| ESPP (5.9) | Cost basis is not the discounted purchase price, and getting it wrong is a common tax error. |
| UTMA/UGMA (5.11) | Legally the child's money, irrevocably. Counting it in the parent's net worth overstates what the parent actually controls. |
| FSA | Use-it-or-lose-it. A year-end balance may be about to vanish, unlike every other asset here. |
| CD | Locked until maturity, so its value is real but not spendable, which is why it is excluded from payment pickers. |
| Imported CSV expenses | Never re-applied to a balance. They are history that already happened, so the account's current balance already reflects them (`CLAUDE.md`, `app/csvImport.js`). |

### 9b.6 Per-type investment logic: tax treatment, tickers, contribution limits

*Added 2026-08-12, alongside ticker verification and required-fields work
on the Investments tab. This is the reference this app's code (`app.js`'s
`TICKER_ELIGIBLE_ASSET_TYPES` and `CONTRIBUTION_LIMIT_GROUPS`) is built
from - if a number or a yes/no here changes, update both, not just one.*

**Contribution-limit figures below are 2026 base limits only** - no
catch-up contributions (age 50+, or the special age-60-63 catch-up under
SECURE 2.0), no income phase-outs, no filing-status adjustments. Confirmed
live against IRS Notice 2025-67 on 2026-08-25 (see 9b.6's own verification
note below for what that pass found and corrected) - this table is no
longer unverified training knowledge, but it is also not a live feed: these
four figures are COLA-adjusted and need a manual refresh every January,
same recurring-staleness category as `BANK_NAMES`/`tickers.js` needing a
periodic refresh, or `MARKET_INDEXES` needing hand-sync. **Before relying
on this for a real contribution decision, confirm the year has not turned
over since this was last checked** - this app is a calculator showing your
own numbers back to you, not tax advice, and a stale or wrong limit would
be worse than showing none at all.

| Type | Tax treatment | Tickers apply? | Contribution limit (2026 base, own reference only) |
|---|---|---|---|
| Traditional 401(k)/403(b)/TSP/Solo 401(k) employee portion | Pre-tax now, ordinary income tax on withdrawal | Yes | $24,500/yr, **shared** across this whole group per person (not per account) |
| Roth 401(k) | Post-tax now, tax-free qualified withdrawal | Yes | Same $24,500/yr group as above - Roth and Traditional 401(k) contributions share one combined limit, they do not stack |
| 457(b) | Pre-tax (or Roth 457(b), post-tax) now, taxed/tax-free on withdrawal to match | Yes | $24,500/yr, its **own separate** bucket by law - not shared with the 401(k)/403(b)/TSP group even though the dollar figure happens to match for 2026 |
| Traditional IRA | Pre-tax (if deductible) now, ordinary income tax on withdrawal | Yes | $7,500/yr, **shared** with Roth IRA |
| Roth IRA | Post-tax now, tax-free qualified withdrawal; income limits can reduce or eliminate eligibility entirely (not tracked here - filing status is unknown) | Yes | Same $7,500/yr group as Traditional IRA |
| SEP IRA | Pre-tax now, ordinary income tax on withdrawal | Yes | Greater of 25% of compensation or $70,000 - **not tracked**, this app has no income field, and for most people the 25%-of-compensation test is the actual binding constraint, not the flat dollar cap, so showing just the cap would overstate what is really allowed |
| SIMPLE IRA | Pre-tax now, ordinary income tax on withdrawal | Yes | $17,000/yr, its own bucket |
| Brokerage | Ordinary taxable account - capital gains/dividends taxed as earned/realized | Yes | No limit - not tracked |
| 529 plan | After-tax in, tax-free growth for qualified education expenses | Yes | No single federal limit - governed by the annual gift-tax exclusion (~$19,000/beneficiary for 2025, doubled if a couple splits the gift) plus a per-state aggregate lifetime cap that varies enormously (some states $235,000+, others $500,000+) - **not tracked**, no clean single number exists to check against |
| TSP | Same as 401(k) - pre-tax (Traditional) or post-tax (Roth TSP) | Yes | Part of the $24,500/yr elective-deferral group above |
| Solo 401(k) | Same as 401(k) for the employee-deferral portion; the *employer*/profit-sharing portion depends on net self-employment income | Yes | Employee-deferral portion only tracked, in the $24,500/yr group above - the employer/profit-sharing component is **not tracked** (needs self-employment income data this app doesn't have) |
| Rollover / inherited IRA | Matches whatever the money's original tax treatment was (pre-tax stays pre-tax, Roth stays Roth) | Yes | **Not tracked** - a rollover is a transfer of existing money, not a new contribution, and an inherited IRA generally cannot receive new contributions at all |
| Annuity | Tax-deferred growth; ordinary income tax on the earnings portion of a withdrawal | **Conditional** - a *variable* annuity has named sub-account funds with real tickers/symbols; a *fixed* annuity does not. No separate fixed/variable type exists in this app's data model, so `annuity` stays ticker-eligible rather than blocking the real (variable) case to guard against the other | No standard IRS annual limit like a retirement account - **not tracked** |
| ESPP | Ordinary income tax on the discount at purchase, capital gains tax on any further gain at sale | Yes | $25,000/yr (fair market value at grant, for a qualified Section 423 plan), its own bucket - a flat statutory cap under IRC 423(b)(8), unchanged since the 1960s and NOT COLA-adjusted the way the four groups above are |
| Pension | Employer-funded defined-benefit promise, not an account balance - see §5.10 | **No** - a pension is an income promise, not a tradable security; `TICKER_ELIGIBLE_ASSET_TYPES` (`app.js`) excludes it specifically | Not applicable - a participant generally does not make discretionary contributions to a pension the way they do to a 401(k) |
| Custodial UTMA/UGMA | Taxed to the minor (subject to "kiddie tax" rules above a threshold), not the custodian | Yes | Same gift-tax-exclusion shape as a 529 (§5.4) - **not tracked**, no clean account-level limit |
| Crypto | Capital gains/loss on disposal, same general shape as a brokerage account | Yes, against a **separate** symbol list (`CRYPTO_SYMBOLS`, `tickers.js`) - a crypto "ticker" (BTC, ETH) is not a market-issued security symbol the way a stock/ETF/fund ticker is | No IRS contribution limit concept - not tracked |

> **Verification note (2026-08-25).** All four COLA-adjusted figures
> below were confirmed live against IRS Notice 2025-67 (the 2026 figures)
> after a prior version of this table, and the matching
> `CONTRIBUTION_LIMIT_GROUPS` in `app.js`, had been quietly running the
> whole 2026 tax year on 2025 numbers - `contributionLimitUsage()` derives
> the comparison YEAR from the real clock but the limit itself was a
> hardcoded constant, so it understated everyone's real 2026 ceiling by
> $500-$1,000 depending on the group. **These four numbers need a manual
> refresh every January** when the IRS announces the next year's COLA
> adjustment (typically early November for the year ahead) - same
> recurring-staleness category as `MARKET_INDEXES` needing hand-sync or a
> rotating `GEMINI_MODEL` alias. ESPP's $25,000 is the one figure in this
> table that never needs this: it is a flat statutory cap, not COLA-indexed.

**Which types share a contribution-limit "bucket" together, summarized**
(this is the part most likely to be gotten wrong by intuition - a 401(k)
and a 457(b) look similar but do **not** share a limit, while a Traditional
and a Roth 401(k) look different but **do**):

- **Elective deferral group**: `traditional_401k`, `roth_401k`, `plan_403b`,
  `tsp`, `solo_401k` (employee portion only) - one shared $24,500/yr limit
  across every account of these types combined, per person.
- **457(b) group**: `plan_457b` alone - its own separate $24,500/yr limit,
  not combined with the group above.
- **IRA group**: `traditional_ira`, `roth_ira` - one shared $7,500/yr limit.
- **SIMPLE IRA group**: `simple_ira` alone - its own $17,000/yr limit.
- **ESPP group**: `espp` alone - its own $25,000/yr limit, a flat
  statutory figure that does not change year to year (see its table row
  above).
- **Not tracked at all**: `sep_ira`, `plan_529`, `rollover_inherited_ira`,
  `annuity`, `custodial_utma`, `brokerage`, `crypto`, `pension`, and the
  legacy `ira`/`retirement_employer` buckets - each for the specific reason
  given in its own table row above, not by omission.

## 9c. Age and income requirements per type

Added 2026-08-25. This is the reference behind `ACCOUNT_AGE_RULES`
(`app/app.js`); the table below is generated from that map, so the two
cannot drift. Every row is a real-world requirement for **opening** the
account, not a rule this app enforces.

> **Verification note (2026-08-25).** The first version of this section
> was written from general knowledge and not checked against a live source.
> That was a real gap in a repo whose own standing rule (see the Repository
> Constraints section) is to confirm a claim live rather than assume it -
> this section had not actually followed that rule until challenged on it.
> A follow-up pass checked every load-bearing legal claim below against a
> live search and corrected what it found wrong; sources are in the
> reference list at the end of this document. Two corrections changed real
> app behavior, not just wording:
> - **401(k)/Roth 401(k)**: age 21 is the legal CEILING a plan is allowed to
>   impose (ERISA), not a typical minimum - most modern plans allow earlier
>   or immediate eligibility. The app previously warned a genuinely eligible
>   19-year-old opening one; `minAge` is now `null` for both.
> - **403(b)**: understated the real rule. The IRS's universal availability
>   rule generally requires an employer to let every employee join
>   immediately if it lets any employee join at all, not merely "the plan
>   decides" as originally written.
>
> Two things this app genuinely cannot verify going forward: state law
> changes (a table like this goes stale the moment a legislature acts, the
> same limitation `bankNames.js`/`tickers.js` already carry), and individual
> plan/issuer policy, which is always more restrictive-or-lenient than the
> legal floor/ceiling this section describes. Treat every row as "the legal
> framework as of this date," not as a guarantee about any specific bank,
> brokerage, or employer plan.

### 9c.1 The app warns, it never blocks

This distinction is the whole design, and it should not be "tightened"
later without re-reading this section.

This app **records accounts you already have; it does not open them.** A
hard block would be wrong in at least four ordinary cases: a parent
tracking a custodial account, a joint account held with an adult, an
account opened years before the profile was filled in, and a non-US
account whose rules differ entirely. On top of that, `profiles.birth_year`
holds a year and not a date, so a computed age is only accurate to within
a year - which is not a sound basis for refusing an action outright.

So a failed check is a confirm-to-override, the same shape `isKnownBank()`
and `isKnownTicker()` already use, and the requirement is also shown
plainly under the type picker before saving. **A profile with no birth
year never warns at all** - an unanswered field is not evidence of
anything, and this app has a standing rule against stating a number it
does not actually know.

### 9c.2 Three rules that are commonly assumed wrong

- **IRAs have no minimum age.** Not 18, not 21. What a Traditional or Roth
  IRA actually requires is **earned income** - you cannot contribute more
  than you earned that year. A minor with a job can hold a custodial IRA.
  Storing 18 here would be a plain factual error.
- **Custodial accounts invert the rule.** For `custodial_utma` and
  `coverdell_esa`, the age limit applies to the **beneficiary**, who must
  be a minor. An adult opening one is correct, not a problem, so these
  never warn on the adult's own age.
- **A 401(k)'s "age 21" is a ceiling, not a typical minimum.** ERISA
  (verified against the Department of Labor's own FAQ) only limits how much
  a plan is allowed to REQUIRE - at most age 21 and one year of service.
  Nothing stops a plan requiring less, and many modern plans allow
  immediate eligibility. The same applies to a Roth 401(k). Naming 21 as
  "typical" would overstate how common that specific threshold actually is,
  so both are marked with no minimum age and a note explaining the ceiling.
- **A 403(b) usually cannot have an age minimum at all.** This is stronger
  than "the plan decides": the IRS's universal availability rule (verified
  against irs.gov) generally requires an employer that lets any employee
  defer salary into a 403(b) to let every employee do so, immediately, with
  only narrow carve-outs (nonresident aliens, certain students, and
  employees who normally work under 20 hours/week).
- **A SEP IRA's age 21 is a real, different kind of ceiling.** Unlike the
  401(k)'s ERISA rule above, the IRS lets a SEP-sponsoring employer require
  UP TO age 21 plus 3 of the last 5 years worked there plus a small minimum
  compensation - three real requirements an employer can relax but never
  tighten. TSP and SIMPLE IRA carry no age minimum in law either way.

### 9c.3 Where income is genuinely load-bearing

Income informs most of this table but decides only two things:

1. **The CARD Act's under-21 rule.** For any credit-card-shaped type,
   someone aged 18 to 20 must show independent income or have a cosigner.
   This is the one place income changes whether the app warns.
2. **The earned-income cap on IRA contributions**, flagged as
   `earnedIncome` above.

Deliberately **not** modeled: Roth IRA and Coverdell **income
phase-outs**. Those need filing status (single, married filing jointly,
and so on), which this app does not collect, and `CONTRIBUTION_LIMIT_GROUPS`
already documents excluding phase-outs as a deliberate decision. Adding a
phase-out that silently assumed a filing status would produce a confidently
wrong number, which is worse than not showing one.

**The CARD Act check reads `hasAnyIncome()`, a different question from the
Income tile's `annualIncome()`** (both `app/income.js`, added/split
2026-08-25). `annualIncome()` answers "what is the rate" - a real question
for the Log page's tile, income-vs-expense, and the cash-flow forecast,
all of which need an actual annualized number and correctly exclude a
`one_time` source (a single past deposit is not a yearly rate).
`hasAnyIncome()` answers a narrower, boolean question - "is there any
income on record at all" - because that is genuinely what the law asks.
Verified live against the CFPB's own Regulation Z commentary: a card
issuer evaluates "current or reasonably expected income," a self-reported
figure that explicitly includes tips, seasonal work, and self-employment,
with no minimum dollar amount set by the statute itself. A derived annual
rate was never the right shape for this specific check - `hasAnyIncome()`
is a closer match to the real test, not just a looser one.

**This keeps eligibility fully automatic - the user is never asked to type
an income figure anywhere.** It simply reflects whatever is already logged
on the Income sources form, recurring or one-time alike, the moment it's
added. A one-time source counts here even though it is excluded from the
annualized rate above.

**One real interaction worth remembering if either function is touched
again**: `autoLogDueIncome()` deactivates a `one_time` source the instant
it is paid out, specifically to stop it logging twice - so `is_active:
false` means "this income stopped" for a recurring source, but "this
one-time payment already arrived" for a `one_time` one. `hasAnyIncome()`
skips the `is_active` check specifically for `one_time` rows for exactly
this reason; naively applying the same filter to both would have made a
real, already-received payment stop counting as income at the exact
moment it actually arrived.

### 9c.4 Other restrictions considered, and why most are not modeled

Age and income are not the only real-world gates on opening an account.
Researching this section surfaced several more, checked live rather than
assumed, and each is either genuinely universal enough to state as fact or
deliberately left out for the same reason this app omits a number it
cannot verify elsewhere (the credit-utilization line, the emergency-fund
guideline, and others already hold this line).

**Not modeled, on purpose:**

- **SSN or ITIN.** Widely assumed to be a hard requirement everywhere. It
  is not: several banks open an account on an ITIN alone, and a few
  (verified live) open one with neither, using other identification
  instead. This varies by individual bank policy, not by law or account
  type, so encoding it as a per-type rule would state something false for
  a real institution.
- **Credit check / ChexSystems screening.** A checking account can be
  denied over a ChexSystems record; a credit card obviously involves a
  credit assessment; a secured card exists specifically to route around
  one. All of this is issuer-specific underwriting, not a legal minimum
  this app could state as a fact about the account TYPE.
- **Minimum opening deposit or minimum balance.** Ranges from $0 to
  several thousand dollars depending on the individual bank and product -
  not generalizable per type at all.
- **US residency / citizenship.** Several major banks explicitly serve
  non-residents (verified live), so this is not a blanket rule either -
  again, issuer policy rather than a fact about the account type.

**Documented as fact, not as an eligibility gate** (these don't stop you
opening an account, so they don't belong in `ACCOUNT_AGE_RULES`, but they
are real restrictions worth stating plainly):

- **FDIC/NCUA/SIPC insurance caps.** $250,000 per depositor, per insured
  institution, per ownership category (FDIC and NCUA); SIPC covers up to
  $500,000 in securities including $250,000 in cash. Already captured as
  the "Insured / not insured" cross-cutting attribute in section 9 above -
  this is a fact about what happens to a balance already held, not a
  barrier to opening the account.
- **HSA's dependent restriction.** Beyond the HDHP requirement already
  noted in section 6.1, you cannot open or contribute to an HSA while
  anyone else claims you as a tax dependent - a real, separate gate from
  age, worth calling out since it applies regardless of how old you are.

### 9c.5 The generated table

**Deposit accounts**

| Type | Typical minimum age | Also gated by | What the rule actually is |
|---|---|---|---|
| `debit` (Checking) | 18 | - | Banks generally require you to be 18 to open a checking account in your own name. Under 18, it is normally a joint account with an adult. |
| `savings` (Savings) | 18 | - | Generally 18 to open in your own name. Many banks offer minor savings accounts held jointly with an adult. |
| `money_market` (Money Market) | 18 | - | Generally 18 to open in your own name. |
| `cash_management` (Cash Management) | 18 | - | These are brokerage-issued, so the same 18 minimum as a brokerage account applies. |
| `cd` (Certificate of Deposit) | 18 | - | Generally 18 to open in your own name, or jointly with an adult under 18. |

**Credit accounts**

| Type | Typical minimum age | Also gated by | What the rule actually is |
|---|---|---|---|
| `credit` (Credit Card) | 18 | under-21 income rule | 18 to hold a card in your own name. Under 21, US law also requires you to show independent income or have a cosigner. |
| `charge_card` (Charge Card) | 18 | under-21 income rule | 18 to open, and under 21 the same independent-income or cosigner rule applies as for a credit card. |
| `secured_credit_card` (Secured Credit Card) | 18 | under-21 income rule | 18 to open. The security deposit does not remove the under-21 income or cosigner requirement. |
| `store_card` (Store / Retail Card) | 18 | under-21 income rule | 18 to open, with the same under-21 income or cosigner rule as any other credit card. |
| `personal_line_of_credit` (Personal Line of Credit) | 18 | - | 18 to enter a credit agreement in your own name. |
| `heloc` (HELOC) | 18 | - | 18 to enter a credit agreement, and you must own the home it is secured against. |
| `overdraft_line` (Overdraft Line of Credit) | 18 | - | 18, since it is a credit line attached to a checking account. |
| `bnpl` (Buy Now, Pay Later) | 18 | - | Most pay-in-4 providers require you to be 18. |
| `medical_credit_card` (Medical / Deferred-Interest Card) | 18 | under-21 income rule | 18 to open, with the same under-21 income or cosigner rule as any other credit card. |

**Loans**

| Type | Typical minimum age | Also gated by | What the rule actually is |
|---|---|---|---|
| `personal_loan` (Personal Loan) | 18 | - | 18 to sign a loan agreement. |
| `auto_loan` (Auto Loan) | 18 | - | 18 to sign a loan agreement. Under 21 a lender often still wants a cosigner. |
| `mortgage` (Mortgage) | 18 | - | 18 to sign a mortgage. |
| `home_equity_loan` (Home Equity Loan) | 18 | - | 18 to sign, and you must own the home. |
| `student_loan` (Student Loan) | 18 | - | 18 to sign. Younger borrowers normally need a cosigner. |
| `payday_loan` (Payday Loan) | 18 | - | 18 to borrow. |
| `title_loan` (Title Loan) | 18 | - | 18 to borrow, and you must own the vehicle outright. |
| `credit_builder_loan` (Credit-Builder Loan) | 18 | - | 18 to sign a loan agreement. |
| `retirement_plan_loan` (Retirement Plan Loan) | None | - | No age rule of its own. It depends entirely on being in a retirement plan that allows loans. |

**Retirement & investment**

| Type | Typical minimum age | Also gated by | What the rule actually is |
|---|---|---|---|
| `traditional_401k` (401(k) (Traditional)) | None | plan-set | No legal minimum age. Federal law only caps how much a plan can REQUIRE - at most 21 and one year of service - many employers set a lower bar or none at all. |
| `roth_401k` (401(k) (Roth)) | None | plan-set | Same rule as a traditional 401(k): no legal minimum age. The law only caps what a plan can require, at most 21 and one year of service. |
| `plan_403b` (403(b)) | None | plan-set | No age minimum - and it usually cannot have one. The IRS's universal availability rule requires most employers to let every employee join immediately, with only narrow exceptions (nonresident aliens, certain students, under 20 hours/week). |
| `plan_457b` (457(b)) | None | plan-set | No legal age minimum. Your employer's plan sets who can join. |
| `traditional_ira` (Traditional IRA) | None | earned income | There is no minimum age for an IRA. What it actually requires is earned income - you cannot contribute more than you earned that year. A minor with a job can hold one as a custodial IRA. |
| `roth_ira` (Roth IRA) | None | earned income | There is no minimum age for a Roth IRA. It requires earned income instead - you cannot contribute more than you earned that year. A minor with a job can hold one as a custodial Roth IRA. |
| `sep_ira` (SEP IRA) | 21 | earned income, plan-set | The IRS lets an employer require at most age 21, 3 of the last 5 years worked there, and a small minimum compensation - an employer can be more generous than all three, never stricter. |
| `simple_ira` (SIMPLE IRA) | None | earned income, plan-set | No age minimum in law. It is an employer plan, so eligibility follows the employer's rules and your earnings there. |
| `brokerage` (Brokerage) | 18 | - | 18 in most states to open one in your own name - 19 in Alabama and Nebraska, 21 in Mississippi, since it follows each state's legal age of majority. Under that age, the equivalent is a custodial account an adult controls. |
| `espp` (Employee Stock Purchase Plan) | None | plan-set | No age rule. It depends on being employed somewhere that offers the plan. |
| `pension` (Pension (Defined Benefit)) | None | plan-set | No age rule of its own. Eligibility comes from your employment and the plan's own vesting rules. |
| `custodial_utma` (UTMA / UGMA Custodial) | None | beneficiary must be a minor | This one works the other way around: an adult opens and controls it, and the beneficiary must be a minor. Control transfers permanently at an age set by state law - 21 in most UTMA states, though it can be as low as 18 or as high as 25 (30 in Wyoming) depending on the state and what the custodian chose when opening it. |
| `plan_529` (529 Plan) | 18 | - | 18 to open one as the account owner. There is no age limit on the beneficiary. |
| `tsp` (Thrift Savings Plan (TSP)) | None | plan-set | No age minimum. It requires federal employment or uniformed service. |
| `solo_401k` (Solo 401(k)) | 18 | earned income | 18 to establish it, and it requires self-employment income with no employees other than a spouse. |
| `rollover_inherited_ira` (Rollover / Inherited IRA) | None | - | No age minimum. An inherited IRA can be held by a beneficiary of any age. |
| `annuity` (Annuity) | 18 | - | 18 to sign an annuity contract. |
| `retirement_employer` (401(k) / 403(b) / 457) | None | plan-set | Eligibility is set by whichever employer plan this represents. |
| `ira` (IRA (unspecified)) | None | earned income | No age minimum. Like any IRA, what it requires is earned income. |

**Specialty**

| Type | Typical minimum age | Also gated by | What the rule actually is |
|---|---|---|---|
| `hsa` (HSA) | 18 | - | 18 to open one yourself, and it also requires a high-deductible health plan and that nobody claims you as a dependent. |
| `fsa` (FSA) | None | plan-set | No age rule. It requires an employer that offers one. |
| `hra` (HRA) | None | plan-set | No age rule. It is funded and offered entirely by an employer. |
| `dependent_care_fsa` (Dependent Care FSA) | None | plan-set | No age rule. It requires an employer plan and a qualifying dependent. |
| `coverdell_esa` (Coverdell ESA) | None | beneficiary must be a minor | Contributions can normally only be made while the beneficiary is under 18, and the money generally has to be used by the time they turn 30 - both limits are waived entirely for a beneficiary with special needs. |
| `able_account` (ABLE Account) | 18 | - | 18 to open one in your own name. Eligibility depends on a disability that began before age 46, not on your age today. |
| `prepaid_card` (Prepaid Card) | 18 | - | Generally 18, though some teen cards are available earlier with an adult attached. |
| `payroll_card` (Payroll Card) | None | plan-set | No age rule of its own. It comes from an employer as a way to pay you. |
| `second_chance_checking` (Second-Chance Checking) | 18 | - | 18, the same as any checking account in your own name. |
| `digital_wallet` (Digital Wallet) | 18 | - | Generally 18 for a full account. Some offer teen accounts from 13 with an adult attached. |
| `treasury_direct` (Treasury Direct) | 18 | - | 18 to open an account and buy Treasury securities directly. |
| `crypto` (Cryptocurrency) | 18 | - | Exchanges generally require you to be 18. |
| `multi_currency` (Multi-Currency Account) | 18 | - | Generally 18, the same as any deposit account in your own name. |
| `life_insurance_cash_value` (Life Insurance Cash Value) | 18 | - | 18 to be the owner of the policy. A policy can insure a minor, but an adult owns it. |
| `trust_account` (Trust Account) | None | - | No age rule of its own. It depends on the trust document and who the trustee is. |

## 10. Mapping to this app's data model

### 10.1 What exists today

*Rewritten 2026-08-12. This section previously described the pre-expansion
schema (six account types) and had been stale since
`17_expand_account_types.sql` landed.*

The catalog below is no longer aspirational: `app/app.js`'s
`ACCOUNT_TYPES` object is the single source of truth and now carries **55
selectable types** across the same five categories this document uses, with
`supabase/17_expand_account_types.sql` and
`supabase/37_more_account_types.sql` holding the matching check
constraints. `AUTO_ASSET_TYPE`, `AUTO_LIABILITY_TYPE`,
`ACCOUNT_TYPE_NAME`, `LIABILITY_ACCOUNT_TYPES`, `DEBT_TYPE_LABEL` and
`ASSET_TYPE_LABEL` are all derived from it, so adding a type means adding
one entry there plus one migration, not touching every function that
mentions account types.

Sections 2 through 6 are therefore essentially fully implemented. The
notable per-type decisions that do *not* follow category lines, each
recorded as its own explicit set in `app.js`:

- `BANK_VALIDATED_TYPES` - which types must match a real FDIC bank name.
  Not per-category: BNPL sits under Credit accounts but Affirm and Klarna
  are not banks, and no Retirement/Specialty institution is one.
- `NON_SPENDABLE_ACCOUNT_TYPES` - which types are excluded from the "how
  did you pay for this" pickers. Grounded in whether the real product has
  a card or check access, so Specialty is a deliberate mix (HSA/FSA/ABLE
  do; Coverdell/Treasury Direct/crypto/life insurance cash value/a trust
  account do not - a trust may have checkbook access via its trustee, but
  that is not this app's own user's personal payment method).
- `GRACE_PERIOD_LIABILITY_TYPES` - which liabilities the credit-cycle
  interest math applies to (see 9b.3).
- `INVESTMENT_ASSET_TYPES` - which assets appear on the Investments tab.
- `LEGACY_ACCOUNT_TYPES` - `ira` and `retirement_employer`, the coarse
  buckets that predate the Traditional/Roth and 401(k)/403(b)/457 splits.
  Still valid in the database so existing rows keep a readable label, but
  hidden from the pickers so nothing new is created against them.

Two types from this document remain deliberately unimplemented: **business
accounts** (out of scope per `CLAUDE.md`'s personal-finance framing) and
**escrow accounts** (6.16 - a sub-ledger belonging to a mortgage servicer,
not something an individual opens or pays from).

Matched against sections 2 through 6 above, the coverage is now
essentially complete. A representative sample:

| Real-world type | Covered by |
|---|---|
| Checking account | `accounts.type = 'debit'` -> `assets.type = 'bank'` |
| Savings / money market / cash management | `savings`, `money_market`, `cash_management` |
| Cash on hand | `accounts.type = 'cash'` -> `assets.type = 'cash'` (auto-managed, singleton per user) |
| Certificate of deposit | `cd`, with a maturity date (`23_asset_maturity_date.sql`) |
| Credit card and its variants | `credit`, `charge_card`, `secured_credit_card`, `store_card`, `medical_credit_card` |
| HELOC | `heloc`, with draw-vs-repayment phase derived from `draw_period_end` (`28_heloc_draw_period.sql`) |
| Installment loans | `personal_loan`, `auto_loan`, `mortgage`, `home_equity_loan`, `student_loan`, `payday_loan`, `title_loan`, `credit_builder_loan`, `retirement_plan_loan` |
| Employer retirement plans | `traditional_401k`, `roth_401k`, `plan_403b`, `plan_457b`, `solo_401k`, `tsp` |
| IRAs | `traditional_ira`, `roth_ira`, `sep_ira`, `simple_ira`, `rollover_inherited_ira` |
| Other investment | `brokerage`, `espp`, `pension`, `custodial_utma`, `plan_529`, `annuity`, `crypto` |
| Health and care accounts | `hsa`, `fsa`, `hra`, `dependent_care_fsa` |
| Other specialty | `coverdell_esa`, `able_account`, `prepaid_card`, `payroll_card`, `second_chance_checking`, `digital_wallet`, `treasury_direct`, `multi_currency`, `life_insurance_cash_value`, `trust_account` |
| Property / vehicle | `assets.type` `property` / `vehicle`, the latter with depreciation (`24_vehicle_depreciation.sql`) |

### 10.2 What is still not modeled

The original version of this section was a long table of missing types.
Nearly all of them have since been built, so what remains is the shorter
list of things deliberately left alone:

| Concept | Why it is still absent |
|---|---|
| Multi-currency amounts | `multi_currency` exists as an account *type*, but the schema still has no real currency concept beyond a hardcoded `'USD'` default on `expenses.currency`. Handling this properly means rethinking every stored amount, not adding a type. |
| Escrow accounts | A sub-ledger held by a mortgage servicer, not an account an individual opens or pays from (6.16). |
| Business accounts | Out of scope per `CLAUDE.md`'s personal-finance framing. |
| Deferred-interest deadlines | Medical/store card retroactive interest (3.9) is documented but not tracked - the app has no visibility of the promotional deadline. |
| Overdraft lines as true negative balances | `overdraft_line` exists as a liability-linked type, but no account is ever allowed to go negative; that guard (`assetDeltaError`) is intentional and unchanged. |
| Beneficiary tracking | 529, Coverdell, ABLE and UTMA accounts all have a beneficiary in real life; none is recorded, since nothing in the app would currently use it. |
| Tax-treatment-aware net worth | Traditional vs Roth is now recorded as separate types, but net worth still counts both at face value. See 9b.2 for why. |


## 11. Suggested prioritization for future work

> **Historical, as of 2026-08-12.** Everything this section proposes has
> since been built (see 10.1). It is kept because the *reasoning* about
> sequencing and structural cost is still a useful record of why the types
> were added in the order they were, but do not read it as a to-do list.

This section is a starting recommendation, not a decision. Any of it
should be discussed and confirmed before being built, the same way the
Savings account type and `bank_name` concept were discussed before
shipping.

**Likely highest value, lowest structural change:**

1. **Certificate of deposit** as a new `assets.type` value (or a new
   `liabilities`-adjacent concept if it's ever modeled as a locked
   account rather than a static value), since it is common, purely a
   static value with a maturity date, and fits the existing pattern of
   "manually valued asset" already used for `investment`/`property`/
   `vehicle`.
2. **Splitting `liabilities.type = 'loan'`** into more specific values
   (`auto_loan`, `student_loan`, `heloc`, `home_equity_loan`, `personal_loan`)
   so the Liabilities card and any future interest-rate-aware reporting
   can distinguish them, without changing the underlying manual-owed-
   editing behavior standalone liabilities already have.

**Likely worthwhile but more involved:**

3. **Retirement and brokerage accounts** as a new `assets.type` value
   distinct from `investment`, since their tax treatment is genuinely
   different information a user would want tracked, even before tackling
   the harder problem of fetching a live market value automatically. This
   would naturally also cover TSP, Solo 401(k), and rollover/inherited
   IRAs (section 5), since they are all the same underlying gap.
4. **BNPL as its own `liabilities.type`** if it turns out to be something
   either user actually carries, since a fixed multi-payment plan tied to
   one purchase is genuinely different bookkeeping from an open-ended
   `loan` or `credit_card` balance.

**Likely lowest priority for a two-user personal app:**

5. HSA/FSA/HRA, money market as its own distinct type, HELOC draw/
   repayment period modeling, Coverdell ESA/ABLE accounts, Treasury
   Direct holdings, and business accounts. All are real account types
   worth knowing about, but none map to a common, recurring need for this
   app's actual users today.
6. Annuities, life insurance cash value, cryptocurrency, and
   multi-currency accounts specifically, since each would require real
   structural additions (a new insurance/backing concept, a volatile
   value source, or a currency concept respectively) rather than just a
   new `type` value on an existing table, for a need that has not come up
   yet.
7. Charge cards, secured credit cards, store charge cards, payroll cards,
   and second-chance checking accounts need no work at all: as noted in
   the gaps table above, they already behave identically to account
   types this app already supports.

## 12. Open questions to resolve before implementing anything from this

1. Does splitting `liabilities.type = 'loan'` into more specific values
   need a data migration for existing rows, or is it acceptable to leave
   existing `loan` rows as-is and only offer the new, more specific
   values going forward?
2. For a CD, should maturity trigger anything automatically (a toast, an
   auto-conversion back to a regular savings asset), or should it just be
   a date the user sees and acts on manually, consistent with how this
   app generally prefers explicit user action over automatic mutation of
   financial data?
3. If retirement/brokerage accounts are added, should their value still
   be entered manually (consistent with every other asset today), or is
   this the point where a live pricing integration becomes worth the
   added complexity? Lean toward manual first, matching how vehicle
   depreciation was scoped in `docs/asset-depreciation-proposal.md`
   (formula/manual before automation).
4. Is there any actual near-term need for HELOC or overdraft-line
   modeling, or is `liabilities.type = 'other'` good enough indefinitely
   given this app's two-user scope?
5. Do either of this app's two actual users hold cryptocurrency, BNPL
   plans, or annuities in practice? If not, those stay purely reference
   material here rather than something worth scoping further, the same
   way business accounts are noted but explicitly out of scope.
6. If cryptocurrency is ever tracked, should it live under `assets.type`
   at all, given how differently it behaves from every other asset here
   (no insurance, high volatility, and a value that needs a live price
   feed rather than a manually entered number), or does it deserve to be
   treated as its own concept entirely?

## Sources

- [Deposit Insurance FAQs, FDIC.gov](https://www.fdic.gov/resources/deposit-insurance/faq)
- [FDIC Insurance Limits in 2026, American Deposits](https://americandeposits.com/insights/fdic-insurance-limits-2026/)
- [Share Insurance Coverage, NCUA](https://ncua.gov/consumers/share-insurance-coverage)
- [Frequently Asked Questions About Share Insurance, NCUA](https://ncua.gov/consumers/share-insurance-coverage/frequently-asked-questions-about-share-insurance)
- [Money Market Account vs. Money Market Fund, Britannica Money](https://www.britannica.com/money/money-market-account-vs-money-market-fund)
- [Money market vs. savings account, Fidelity](https://www.fidelity.com/learning-center/investment-products/money-market-vs-savings-account)
- [Regulation D Banking: Rules, Limits, and What Changed, LegalClarity](https://legalclarity.org/what-is-regulation-d-and-the-six-transaction-limit/)
- [Savings Account Withdrawal Limit, Fees, and Frequency, SoFi](https://www.sofi.com/learn/content/savings-account-withdrawal-limit/)
- [What is SIPC insurance? Coverage, limits, and how it protects you, M1](https://m1.com/knowledge-bank/what-is-sipc/)
- [What is SIPC coverage and how does it work?, Fidelity](https://www.fidelity.com/learning-center/smart-money/sipc)
- [HELOC vs Home Equity Loan: Key Features and Differences, Apple FCU](https://www.applefcu.org/articles/heloc-vs-home-equity)
- [HELOC vs. home equity loan: What's the difference?, Rocket Mortgage](https://www.rocketmortgage.com/learn/heloc-vs-home-equity-loan)
- [HSA contribution limits and eligibility rules for 2026 and 2027, Fidelity](https://www.fidelity.com/learning-center/smart-money/hsa-contribution-limits)
- [FSA VS. HSA: Which One is Better For You in 2026?, Wealth Enhancement](https://www.wealthenhancement.com/blog/fsa-vs-hsa-which-one-is-better)
- [What to Know about CD Early Withdrawal Penalties, Citi](https://www.citi.com/banking/personal-banking-guide/basic-finance/cd-early-withdrawal-penalty)
- [CD Early Withdrawal Penalty Explained, Chase](https://www.chase.com/personal/banking/education/basics/cdearly-withdrawal-penalty)
- [Charge Card vs. Credit Card: Key Differences, Capital One](https://www.capitalone.com/learn-grow/money-management/charge-cards-credit-cards/)
- [What Does No Preset Spending Limit Mean for a Credit Card?, Experian](https://www.experian.com/blogs/ask-experian/what-does-no-preset-spending-limit-mean-for-credit-card/)
- [Affirm, other BNPL players ratchet up credit bureau reporting, Payments Dive](https://www.paymentsdive.com/news/affirm-other-bnpl-players-ratchet-up-credit-bureau-reporting/743287/)
- [Does Klarna Affect Your Credit Score? The 2026 Answer, CreditBooster.ai](https://creditbooster.ai/learn/does-klarna-affect-your-credit-score/)
- [ABLE savings accounts and other tax benefits for persons with disabilities, IRS.gov](https://www.irs.gov/newsroom/able-savings-accounts-and-other-tax-benefits-for-persons-with-disabilities)
- [The ABLE Age Adjustment Act Fact Sheet, ABLE National Resource Center](https://www.ablenrc.org/the-able-age-adjustment-act-fact-sheet/)
- [Coverdell ESA vs. 529 Plans: Complete Comparison, College Finance](https://collegefinance.com/saving-for-college/coverdell-esa-vs-529-plans-complete-comparison)
- [Coverdell Education Savings Account (ESA) vs. 529 Plan: Which Is Best?, SavingForCollege.com](https://www.savingforcollege.com/article/coverdell-esa-versus-529-plan)
- [Are Annuities FDIC Insured? What Actually Protects Them, LegalClarity](https://legalclarity.org/are-annuities-fdic-insured-what-protects-your-money/)
- [State Guaranty Associations and Annuity Protection Limits, Annuity.org](https://www.annuity.org/annuities/regulations/state-guaranty-associations/)
- [How is Coinbase insured?, Coinbase Help](https://help.coinbase.com/en/coinbase/other-topics/legal-policies/how-is-coinbase-insured)
- [Comment for 1026.51 Ability To Pay (CARD Act, under-21 income rule), Consumer Financial Protection Bureau](https://consumerfinance.gov/rules-policy/regulations/1026/Interp-51)
- [FAQs about Retirement Plans and ERISA (401(k) age/service ceiling), U.S. Department of Labor](https://www.dol.gov/agencies/ebsa/about-ebsa/our-activities/resource-center/faqs/retirement-plans-and-erisa)
- [Issue Snapshot - 403(b) plan - The universal availability requirement, IRS.gov](https://www.irs.gov/retirement-plans/issue-snapshot-403b-plan-the-universal-availability-requirement)
- [SEP-IRA eligibility requirements, Wikipedia/IRS-sourced summary](https://en.wikipedia.org/wiki/SEP-IRA)
- [ABLE Account Eligibility Expands in 2026, MEFA](https://www.mefa.org/article/able-account-eligibility-expands-in-2026-what-you-need-to-know/)
- [UGMA/UTMA Age of Majority by State, Capital Group](https://www.capitalgroup.com/advisor/account-resource-center/ugma-utma/age-of-majority.html)
- [Age of Majority by State, Policygenius](https://www.policygenius.com/estate-planning/age-of-majority-by-state/)
- [Minimum Age to Open a Brokerage Account Requirements, CGAA](https://www.cgaa.org/article/minimum-age-to-open-a-brokerage-account)
- [Terminating ESAs at Age 30 (Coverdell special-needs exception), Ascensus](https://thelink.ascensus.com/articles/2025/2/19/terminating-esas-at-age-30)
- [Custodial IRAs for kids, Vanguard](https://investor.vanguard.com/accounts-plans/iras/custodial-ira)
- [How to open a US bank account for non-citizens without an SSN, Wise](https://wise.com/us/blog/bank-account-without-ssn)
- [401(k) limit increases to $24,500 for 2026, IRA limit increases to $7,500, IRS.gov](https://www.irs.gov/newsroom/401k-limit-increases-to-24500-for-2026-ira-limit-increases-to-7500)
- [Preparing for 2026: IRS Announces Updated Retirement Plan Limits Under Notice 2025-67, Schechter Benefits Law Group](https://www.sblgllp.com/preparing-for-2026-irs-announces-updated-retirement-plan-limits-under-notice-2025-67)
- [How Do You Calculate the ESPP $25,000 Limit? (statutory, not COLA-adjusted), NASPP](https://www.naspp.com/blog/ESPP-25000-Limit)
- [Do Credit Cards Check Your Income? (self-reported, rarely verified), WalletHub](https://wallethub.com/answers/cc/do-credit-cards-check-your-income-2140773508/)
- [Do You Need Proof of Income for a Credit Card? (2026), The Pay Stubs](https://www.thepaystubs.com/blog/proof-of-income/do-you-need-proof-of-income-for-a-credit-card)
