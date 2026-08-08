# Bank Account Types: Research Reference

*Status: reference document, not a proposal. This is background research on
how real-world bank and financial accounts are classified, meant to be the
factual basis for any future work on this app's `accounts` / `assets` /
`liabilities` type enums. It does not itself change any code or schema.
See the "Mapping to this app's data model" section near the end for how
the research connects back to what actually exists in `supabase/*.sql` and
`app/app.js` today.*

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

## 10. Mapping to this app's data model

### 10.1 What exists today

From `supabase/01_schema.sql` and `supabase/15_add_savings_type.sql`, the
live check constraints are:

- `accounts.type`: `checking`, `credit`, `debit`, `cash`, `other`,
  `savings` (in practice, per `app/app.js`'s `ACCOUNT_TYPE_NAME`, the app
  only ever writes `debit`, `savings`, `credit`, or `cash`; `checking`
  and `other` exist at the database level but are not reachable through
  the current UI).
- `assets.type`: `cash`, `bank`, `investment`, `property`, `vehicle`,
  `other`, `savings`.
- `liabilities.type`: `credit_card`, `loan`, `mortgage`, `other`.

Matched against sections 2 through 6 above, that already covers:

| Real-world type | Covered by |
|---|---|
| Checking account | `accounts.type = 'debit'` -> `assets.type = 'bank'` |
| Savings account | `accounts.type = 'savings'` -> `assets.type = 'savings'` |
| Cash on hand | `accounts.type = 'cash'` -> `assets.type = 'cash'` (auto-managed, singleton per user) |
| Credit card | `accounts.type = 'credit'` -> `liabilities.type = 'credit_card'` |
| Mortgage | `liabilities.type = 'mortgage'` (standalone only, no account link modeled) |
| Generic loan | `liabilities.type = 'loan'` (standalone only) |
| Brokerage / property / vehicle as a static value | `assets.type` already has `investment`, `property`, `vehicle` as manually-valued, standalone assets with no linked account |

### 10.2 Gaps: real-world types with no current home

| Real-world type | Nearest existing fit | Gap |
|---|---|---|
| Money market deposit account | `assets.type = 'bank'` or `'savings'` could stand in loosely | No dedicated type; also no way to flag the informal 6-withdrawal soft limit, though that is arguably not worth modeling |
| Certificate of deposit | Nothing | No maturity date field, no early-withdrawal-penalty concept, no auto-renew behavior |
| HELOC | `liabilities.type = 'other'` | No distinction between the draw period (interest-only, revolving) and repayment period (amortizing); no linked-account concept for a HELOC the way `credit` accounts link to `credit_card` liabilities |
| Home equity loan / auto loan / student loan / personal loan | `liabilities.type = 'loan'` or `'other'` | All installment loans currently collapse into one generic `loan` type with no distinction; no interest-rate-type (fixed/variable) field |
| Overdraft line of credit | Nothing | No concept of a credit line attached to a checking account; today an app-level guard (`assetDeltaError`) explicitly blocks any account from going negative, which is the opposite behavior |
| Retirement accounts (401(k), IRA) | `assets.type = 'investment'` could stand in | No distinction from a taxable brokerage account; no tax-treatment field; value still has to be entered manually (see `docs/asset-depreciation-proposal.md` for the same live-value problem already identified for vehicles) |
| 529 plan | `assets.type = 'investment'` or `'other'` | No beneficiary concept |
| HSA / FSA / HRA / Dependent Care FSA | Nothing | No concept of a healthcare- or dependent-care-earmarked balance, and the use-it-or-lose-it timing FSA/HRA can have has no analog anywhere in the schema |
| BNPL plan | `liabilities.type = 'other'` could stand in | No concept of a short, fixed-installment plan tied to a single purchase rather than a standing balance |
| Payday / title loan | `liabilities.type = 'loan'` or `'other'` | Same granularity gap as other installment loans (row above); also no way to flag an unusually high cost/rate if that is ever wanted |
| TSP / Solo 401(k) / rollover / inherited IRA | `assets.type = 'investment'` could stand in | Same gap as the retirement accounts row above; these are all sub-varieties of the same underlying problem (no retirement-specific type, no tax-treatment field) |
| Annuity / life insurance cash value | Nothing | No fit at all today; also the only two product types in this whole document not backed by FDIC, NCUA, or SIPC, only by state guaranty associations, which arguably deserves its own note if ever modeled |
| Coverdell ESA / ABLE account | `assets.type = 'investment'` or `'other'` | Same gap as the 529 row above; no beneficiary concept |
| Treasury Direct holdings (I bonds, T-bills, and similar) | `assets.type = 'investment'` could stand in | No dedicated type; unlike a brokerage holding, value is not really "market-priced" for something held to maturity, which does not cleanly fit `investment`'s existing framing |
| Cryptocurrency exchange / wallet balance | `assets.type = 'investment'` or `'other'` | No dedicated type; also the most volatile, least-insured value source in this entire document, which is a meaningfully different risk profile from every existing asset type |
| Multi-currency / foreign currency account | Nothing | The schema has no currency concept at all beyond a hardcoded `'USD'` default on `expenses.currency`; a real multi-currency account would need that rethought from the ground up, not just a new `type` value |
| Charge card / secured credit card / store charge card | `accounts.type = 'credit'` -> `liabilities.type = 'credit_card'` | Not actually a gap: this app never tracks APR or revolving-vs-full-payoff behavior in the first place, only balance owed, so all three already behave identically to a normal credit card in the current model |
| Payroll card | `accounts.type = 'cash'` or a `debit`-like account could stand in | Minor gap at most; functionally just a prepaid balance, which the app has no dedicated type for either, but also has little reason to distinguish from cash for a personal-finance use case |
| Second-chance checking account | `accounts.type = 'debit'` -> `assets.type = 'bank'` | Not a gap; behaves identically to a normal checking account from a balance-tracking point of view |
| Escrow account | Nothing | No concept of a third-party-held balance tied to another liability (a mortgage); today a mortgage's `liabilities` row has no relationship to anything escrow-like |
| Business accounts | N/A | Explicitly out of scope per `CLAUDE.md`'s personal-finance framing |

## 11. Suggested prioritization for future work

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
