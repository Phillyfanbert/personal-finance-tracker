# Subscription & Bill Types: Research Reference

*Status: reference document, not a proposal. This is background research on
the kinds of recurring personal bills and subscriptions that exist in the
real world, meant to be the factual basis for any future work on this
app's Subscriptions/Bills feature (the `subscriptions` table and
`app/subscriptions.js`). It does not itself change any code or schema. See
"Mapping to this app's data model" near the end for how the research
connects back to what actually exists in `supabase/01_schema.sql` and
`app/app.js` today.*

## 1. Purpose and scope

Per `CLAUDE.md`, the Subscriptions/Bills feature tracks recurring cash
outflows - not a balance owed. That is a hard boundary already drawn
elsewhere in this app's data model:

| Concept | Where it lives | What it answers |
|---|---|---|
| A recurring commitment to pay | `subscriptions` table | "What do I keep paying for, on what cycle?" |
| A balance owed | `liabilities` table | "What do I owe right now?" (counted in net worth) |
| A single dated transaction | `expenses` table | "What did I spend, once, on this date?" |

A mortgage or auto loan payment is a liability-linked expense
(`docs/bank-account-types-research.md` covers that territory in depth);
this document is about the *other* kind of recurring obligation - a
subscription or bill with no principal balance behind it, just a
recurring charge that shows up on a cycle. Where a real-world item could
plausibly be either (a car lease, a BNPL plan), it is noted below with a
cross-reference rather than duplicated.

This document catalogs those recurring-charge types, and the attributes
of each that matter for tracking them in software: billing cadence,
whether the amount is fixed or usage-dependent, whether it is essential
or discretionary, and how hard it is to walk away from.

## 2. Utilities

Recurring, usage-metered or flat-rate charges for keeping a home running.
Nearly always monthly, and usually treated as non-negotiable in a
household budget.

- **Electricity** - typically usage-based (metered), so the amount varies
  month to month even though the bill is monthly.
- **Natural gas / heating oil / propane** - usage-based like electricity;
  heating oil and propane are often billed per-delivery rather than on a
  strict monthly cycle, which behaves more like a variable/irregular bill
  than a fixed subscription.
- **Water and sewer** - often billed together by a municipal utility;
  usage-based, sometimes billed quarterly rather than monthly depending
  on the municipality.
- **Trash and recycling** - sometimes bundled into water/sewer, sometimes
  a separate flat-rate bill from a private hauler.
- **Internet service** - flat-rate, monthly, and one of the most commonly
  cited "fixed recurring expense" categories in household budgeting
  guidance.
- **Home phone (landline)** - increasingly rare but still a real flat-rate
  monthly bill for some households.
- **Cell phone / mobile plan** - flat-rate for most modern plans (some
  carriers still charge overage fees), monthly, and frequently contract-
  locked for a device-financing term even when the service itself is
  cancel-anytime.
- **Cable / satellite TV** - flat-rate monthly; functionally adjacent to
  the streaming subscriptions in section 4, but delivered and billed by a
  utility-style provider rather than a pure digital service.

## 3. Housing-adjacent recurring bills

Recurring charges tied to where someone lives, distinct from the
mortgage/rent principal itself.

- **Rent** - a recurring flat monthly payment with no balance/liability
  behind it (unlike a mortgage), which makes it a genuine fit for a
  "subscription-shaped" recurring-bill tracker rather than the
  liabilities model.
- **HOA / condo association fees** - flat monthly, quarterly, or annual
  fee for shared-property upkeep; often has irregular special
  assessments layered on top that do not fit a fixed recurring amount.
- **Property tax (when paid directly, not escrowed)** - a mortgage
  servicer frequently escrows this into the monthly mortgage payment
  (`docs/bank-account-types-research.md` §4.3), but a homeowner who pays
  it directly to the county treats it as its own recurring (often
  semi-annual or annual) bill.
- **Storage unit rental** - flat monthly fee, structurally identical to
  rent but for a smaller space.
- **Lawn care / pest control / pool service contracts** - flat recurring
  fee (commonly monthly during a season, or a flat annual contract),
  often billed by a local service provider rather than a utility.

## 4. Insurance premiums

Insurance is its own large category of recurring bill, distinguished from
the categories above by (a) protecting against risk rather than paying
for a consumed service, and (b) genuinely varied billing cadence - unlike
most software subscriptions, insurers commonly offer monthly, quarterly,
semi-annual, *and* annual billing for the same policy, with a real
pay-in-full discount for the less-frequent options and an installment fee
on the monthly option. Common personal insurance types:

- **Auto insurance**
- **Homeowners or renters insurance**
- **Health insurance** (when not employer-deducted from payroll, e.g. a
  marketplace or COBRA plan)
- **Dental insurance** - commonly sold separately from health insurance
  rather than bundled
- **Vision insurance**
- **Life insurance** (term or permanent - see
  `docs/bank-account-types-research.md` §6.13 for the "cash value" side
  of permanent life insurance, which is a separate asset-like concept
  from the recurring premium itself)
- **Disability insurance**
- **Umbrella insurance** - extra liability coverage layered on top of an
  existing auto/homeowners policy
- **Pet insurance**

## 5. Streaming and digital media subscriptions

The category most people mean by "subscriptions" colloquially, and the
one this app's `expenses.category = 'Subscriptions'` value and
`categorize.js` default keyword map (`netflix`, `spotify`, `hulu`,
`disney`, `hbo`, `youtube`, `patreon`) are already tuned toward.

- **Video streaming** (Netflix, Hulu, Disney+, HBO/Max, and similar)
- **Music streaming** (Spotify, Apple Music, and similar)
- **Cloud/console gaming subscriptions** (Xbox Game Pass, PlayStation
  Plus, and similar) and **in-game recurring passes** (a "season pass" or
  "battle pass" billed on a recurring cycle rather than a one-time
  purchase)
- **E-book and audiobook subscriptions** (Kindle Unlimited, Audible)
- **News, magazine, and newsletter subscriptions** - increasingly
  includes individual-creator paid newsletters (Substack and similar), a
  more recent addition to this category than traditional print/digital
  news subscriptions

## 6. Software and cloud services

Overlaps with section 5 in billing mechanics but is functional/
productivity software rather than media consumption - the "SaaS" and
"digital services" split that shows up consistently in how subscription
businesses classify themselves.

- **Productivity / SaaS tools** (Notion, Microsoft 365, Google Workspace,
  and similar) - `categorize.js` already default-maps `notion` and
  `adobe` here
- **Cloud storage** (iCloud, Google One, Dropbox) - `categorize.js`
  already default-maps `icloud`
- **VPN, antivirus, and password-manager subscriptions**
- **AI tool subscriptions** (a newer but now common line item - chat/
  coding assistants sold as a monthly seat)
- **Domain names and web hosting**
- **App-store-billed subscriptions generally** - worth naming separately
  because these are billed through Apple/Google's platform rather than
  the merchant directly, which changes how they show up on a statement
  (often as "APPLE.COM/BILL" rather than the actual service name) and
  how they get canceled (through the platform's subscription management,
  not the merchant's own site)

## 7. Memberships and dues

Access-based recurring charges tied to an ongoing relationship with an
organization, rather than to consuming a specific piece of content.

- **Gym / fitness studio memberships** - `categorize.js` already default-
  maps `gym` to `Subscriptions`; notable for being one of the most
  commonly contract-locked recurring bills (see section 10)
- **Wholesale club memberships** (Costco, Sam's Club, BJ's) - almost
  always exactly annual, a cadence this category leans into more than
  most others
- **Shopping/loyalty memberships** (Amazon Prime and similar) - blurs the
  line between "membership" and "subscription," since the primary
  benefit (free shipping) is access-based but often bundles in streaming
  content too
- **Professional / trade association dues**
- **Co-working space memberships**
- **Social or civic club memberships** (country club, fraternal
  organization) - often has both a recurring dues charge and an
  irregular one-time initiation fee, similar in shape to an HOA's special
  assessment (section 3)

## 8. Subscription commerce (replenishment and curation boxes)

Recurring shipments of physical goods rather than access to a digital
service - a meaningfully different fulfillment model from every category
above, even though the billing mechanics (recurring charge, cancel-
anytime in most cases) are similar.

- **Replenishment subscriptions** - automatic reorder of a consumable the
  subscriber already knows they want (razors, contact lenses, coffee,
  pet food/supplies, vitamins)
- **Curation subscriptions** - a themed surprise selection chosen by the
  service rather than the subscriber (beauty boxes, clothing/styling
  boxes, hobby boxes)
- **Meal kit and grocery-delivery subscriptions**
- **Wine, coffee, and specialty-food clubs**

## 9. Financial and account-fee recurring charges

Recurring charges from a financial institution or financial-adjacent
service, distinct from any of the account *types* already covered in
`docs/bank-account-types-research.md` (this is about a fee layered on top
of an account, not the account itself).

- **Bank monthly maintenance fees** - often waivable (minimum balance,
  direct deposit), but a real recurring charge when not waived
- **Credit monitoring / identity-theft-protection subscriptions**
- **Robo-advisor or subscription-based investment-management fees**
  (a flat monthly/annual fee rather than the more traditional
  percentage-of-assets advisory fee)
- **Safe deposit box rental**
- **Tax-preparation software subscriptions** (some now bill annually as a
  recurring plan rather than a one-time purchase each filing season)

## 10. Health and wellness recurring charges

Recurring charges for ongoing care or wellness services, distinct from
health *insurance* (section 4) and from a one-off medical expense.

- **Therapy / counseling retainers** or subscription-based mental-health
  apps
- **Meal-planning or fitness-coaching app subscriptions**
- **Prescription auto-ship / mail-order pharmacy recurring charges**
- **Telehealth membership or direct primary care** (a flat recurring fee
  for a level of access to a provider, structured more like a membership
  than a per-visit insurance claim)

## 11. Family, childcare, and education

- **Daycare / preschool tuition**
- **K-12 or college tuition payment plans** - a fixed number of
  installments per semester/year rather than an open-ended subscription,
  structurally closer to the BNPL concept in section 13 than to a
  streaming subscription
- **Extracurricular lesson fees** (music lessons, sports leagues,
  tutoring subscriptions)

## 12. Transportation-adjacent recurring charges

Distinct from an auto loan or lease payment itself, which is a liability
(`docs/bank-account-types-research.md` §4.2) - this section is the
recurring *service* charges layered around getting around, not the
vehicle-financing balance.

- **Public transit passes**
- **Parking permits / reserved parking**
- **Toll transponder auto-reload plans** (E-ZPass and similar) - usually
  usage-based rather than a fixed recurring amount, closer in shape to a
  utility bill (section 2) than a flat subscription
- **Car wash memberships**
- **EV home-charging or public-charging network subscriptions**

## 13. Charitable giving and civic dues

- **Recurring donations to a charity or nonprofit**
- **Tithing / house-of-worship giving**
- **Civic or advocacy organization dues**

Household-budgeting guidance consistently calls out recurring charitable
giving as a fixed-expense category alongside subscriptions and
insurance, since it shares the same "same amount, same cadence, easy to
set-and-forget" shape.

## 14. Government and periodic renewals

Technically annual (or multi-year) rather than monthly, but functionally
recurring and easy to forget in the same way a subscription is - these
are frequently cited as the most commonly *forgotten* budget category
precisely because the cadence is long enough to lose track of between
charges.

- **Vehicle registration renewal**
- **Professional license renewal** (a recurring cost of doing a job, for
  a license-requiring profession)
- **Passport / permit renewals** - long-cycle enough (10 years for a US
  passport) that most budgeting guidance treats these as "irregular
  expenses to sink-fund for" rather than a true recurring bill, but they
  share the same forget-and-get-surprised failure mode.

## 15. Buy Now, Pay Later (BNPL) and short-term installment plans

Already covered in depth in `docs/bank-account-types-research.md` §3.8 as
a liability type, but worth cross-referencing here because it sits right
at the boundary of this document's scope: a BNPL plan (Affirm, Klarna,
Afterpay) *looks* like a recurring bill - a fixed amount charged on a
regular cadence - but is structurally different from every other category
in this document because it is finite and self-terminating (a fixed
number of installments tied to one purchase, not an open-ended
subscription that continues until canceled). A tuition payment plan
(section 11) and some insurance installment plans (section 4) share this
same finite-and-self-terminating shape, as opposed to the indefinite
subscriptions in sections 5-9.

## 16. Cross-cutting attributes worth modeling

- **Billing cadence.** Weekly (some subscription boxes), monthly (the
  overwhelming majority of software/streaming/utility bills), quarterly
  and semi-annual (common for insurance premiums specifically, less
  common elsewhere), and annual (wholesale club memberships, many
  insurance policies at their steepest discount, domain renewals, vehicle
  registration). This app's `subscriptions.billing_cycle` currently only
  distinguishes `monthly` / `annual` / `other` (see §17 below) - quarterly
  and semi-annual are real, common cadences with no dedicated value
  today.
- **Fixed vs. usage-based amount.** Most software/media/membership
  subscriptions charge the same amount every cycle; utilities (section 2)
  and toll/EV-charging plans (section 12) vary with usage, which changes
  how "next charge amount" should be predicted or displayed.
  `advanceRenewal()` (`app/subscriptions.js`) already assumes a fixed
  amount when projecting the next renewal date - it does not (and
  probably should not) try to predict a variable dollar amount.
- **Essential vs. discretionary.** Utilities, insurance, and housing-
  adjacent bills are close to non-negotiable; streaming, gaming, and
  subscription-box charges are the ones a budgeting conversation ("what
  could I cut?") is actually about. Nothing in the current schema
  distinguishes the two.
- **Contract lock-in / cancellation friction.** Most SaaS, streaming, and
  subscription-box services are cancel-anytime; gym memberships, cell
  phone plans (via device financing), and insurance policies (mid-term
  cancellation fees) commonly are not. Regulatory attention to this
  exact gap is active and ongoing: the FTC's "Click-to-Cancel" rule
  (amending the long-standing Negative Option Rule to require
  cancellation to be at least as easy as signup) was vacated by a federal
  appeals court in 2025 but the FTC reopened rulemaking on it via an
  ANPRM in March 2026, and continues separately pursuing individual
  subscription-cancellation cases under general FTC Act unfair-practices
  authority in the meantime.
- **Auto-renewal and price-creep risk.** Deloitte's Consumer Tracker puts
  the average US household at roughly 11 active subscriptions, and
  multiple 2026 surveys estimate 30-42% of subscription spending goes to
  underused or fully forgotten services (on the order of $200+/year per
  person) - the entire reason a "Subscriptions/Bills" tracking feature
  has value in the first place, and a strong argument for the app's
  existing renewal-reminder surface (`upcomingRenewals()`) mattering more
  than it might first appear to.
- **Linked payment method.** Already modeled - `subscriptions.account_id`
  covers this the same way `expenses.account_id` does.
- **Shared / split-cost plans.** A family or group plan (streaming,
  wholesale club, phone family plan) where the tracked user only pays or
  is only responsible for a fraction of the sticker price has no
  representation in the current schema, which assumes the full `amount`
  is the tracked user's own cost.

## 17. Mapping to this app's data model

### 17.1 What exists today

From `supabase/01_schema.sql`, the `subscriptions` table has: `name`,
`amount`, `billing_cycle` (`monthly` / `annual` / `other`, default
`monthly`), `account_id` (optional link to a payment-method account),
`next_renewal`, `is_active`, and `notes`. There is no `category` or
`type` column at all - every row in the Subscriptions/Bills list is
flat, regardless of whether it represents a streaming service, a gym
membership, or a homeowners insurance premium. `app/subscriptions.js`'s
`monthlyAmount()` and `advanceRenewal()` operate purely on `amount` and
`billing_cycle`, with no awareness of what kind of bill a row represents.

Separately, `expenses.category` (`categorize.js`'s `CATEGORIES`) already
has `Subscriptions` and `Utilities` values usable when logging a single
expense - but that enum lives on the `expenses` table, not on
`subscriptions`, so it has no bearing on how a recurring row in the
Subscriptions/Bills list itself is classified.

### 17.2 Gaps: real-world attributes with no current home

| Real-world concept | Nearest existing fit | Gap |
|---|---|---|
| Bill type/category (utility, insurance, streaming, membership, etc. - sections 2-14) | Nothing on `subscriptions` | No way to filter or total the Subscriptions/Bills list by type; every row looks the same regardless of whether it's Netflix or homeowners insurance |
| Quarterly / semi-annual billing cadence (common for insurance, section 4) | `billing_cycle = 'other'` | `'other'` has no defined interval - `advanceRenewal()` explicitly leaves a `'other'`-cycle row's `next_renewal` unchanged rather than guessing, per its own doc comment, so a quarterly bill gets no auto-projected next date at all today |
| Essential vs. discretionary flag | Nothing | No way for Reports/Q&A (`wiki.js`) to reason about "what's cuttable" versus "what's fixed," a distinction real budgeting guidance treats as the primary axis for this whole category |
| Contract lock-in / cancel-by date | Nothing | No way to warn about a gym or insurance policy's minimum term or cancellation-fee window |
| Shared / split-cost plans | Nothing | `amount` is assumed to be the tracked user's full cost; no concept of "I pay a fraction of a family plan" |
| BNPL / tuition-plan-style finite installment schedules (section 15) | `is_active` + manual deactivation once paid off | No concept of "N payments remaining," so a self-terminating plan looks identical in the schema to an indefinite subscription until the user manually notices it ended and flips `is_active` off |

## 18. Suggested prioritization for future work

This section is a starting recommendation, not a decision - the same
framing `docs/bank-account-types-research.md` §11 uses for its own
prioritization list.

**Likely highest value, lowest structural change:**

1. **A `category` field on `subscriptions`**, mirroring how
   `ACCOUNT_TYPES` in `app/app.js` already drives account-type behavior
   from one config object rather than scattered per-type code. A
   reasonable starting value set, drawn directly from sections 2-14
   above: `Utilities`, `Housing`, `Insurance`, `Streaming & Media`,
   `Software & Cloud`, `Memberships & Dues`, `Subscription Commerce`,
   `Financial & Fees`, `Health & Wellness`, `Family & Education`,
   `Transportation`, `Charitable & Dues`, `Other`. This alone would let
   the Subscriptions/Bills list be filtered and totaled by type, the way
   `expenses.category` already lets the Log/Reports pages do for
   one-off spending.
2. **`quarterly` and `semiannual` values added to `billing_cycle`**,
   since `advanceRenewal()`'s date-math approach (clamp to the target
   month's actual last day) already generalizes cleanly to any N-month
   interval - it is not a monthly/annual-specific algorithm today by
   accident so much as by scope, and insurance premiums (section 4) are
   common enough real-world cases to justify closing this gap.

**Likely worthwhile but more involved:**

3. **An essential/discretionary flag**, mainly valuable once paired with
   the Reports Q&A feature (`wiki.js`) being able to reason about
   "what's fixed vs. what could be cut" - low value in isolation, higher
   value as an input to a feature that doesn't exist yet.
4. **Shared/split-cost plans**, if it turns out either of this app's two
   actual users has a family-plan-style subscription split with someone
   outside the household - otherwise purely reference material.

**Likely lowest priority for a two-user personal app:**

5. Contract-lock-in/cancel-by tracking and finite-installment-count
   tracking (BNPL/tuition-plan style) - real gaps, but narrow enough in
   this app's actual usage that they are speculative until a concrete
   need shows up, the same bar `docs/bank-account-types-research.md`
   §11 applied to annuities and multi-currency accounts.

## 19. Open questions to resolve before implementing anything from this

1. Does a new `category` field need seed/migration values for existing
   `subscriptions` rows, or is leaving them `null`/`Other` until the user
   re-categorizes acceptable - consistent with how this app has
   generally preferred explicit user action over inferred backfills for
   live financial data (see `CLAUDE.md`'s account-type audit and
   `account_activity` sign-fix precedent)?
2. Should `category` reuse the exact same value set as
   `expenses.category`, or is a Subscriptions/Bills-specific set (as
   drafted in §18.1) more useful given the two lists answer different
   questions (recurring commitment vs. one-off spend)?
3. Is an essential/discretionary flag worth adding *before* there is a
   concrete Reports/Q&A feature that consumes it, or should it wait
   until that need is concrete - mirroring the "groundwork with no live
   effect yet" caution already noted for the profile-expansion
   eligibility fields in `docs/SESSION-NOTES.md`?
4. Do either of this app's two actual users currently hold a BNPL plan,
   a tuition payment plan, or a shared/split-cost family subscription in
   practice? If not, sections 15 and the shared-plan gap in §17.2 stay
   reference material rather than something worth scoping further.

## Sources

- [23 Budget Categories You Need in Your Budget, Monarch](https://www.monarch.com/blog/the-23-budget-categories-you-need-in-your-budget)
- [The Ultimate List of Household Expenses for 2026: 10 Categories to Track, Econumo](https://econumo.com/posts/list-of-household-expenses/)
- [Budget Categories: A Complete List of 100+ Expenses to Include in 2026, The Penny Hoarder](https://www.thepennyhoarder.com/budgeting/budget-categories/)
- [Monthly Expenses To Include In Your Budget, Bankrate](https://www.bankrate.com/banking/monthly-expenses-examples/)
- [7 Subscription Business Model Examples to Inspire You, Hubifi](https://www.hubifi.com/blog/subscription-examples-industries)
- [Exploring the Model Where Customers Subscribe, Hubifi](https://www.hubifi.com/blog/types-of-subscriptions-models)
- [What Are Subscriptions? Types, Meaning & Popular Examples, DriftCharge](https://driftcharge.com/glossary/subscriptions/)
- [Sales Tax on Subscriptions: Complete State-by-State Guide for Digital Services, Hands Off Sales Tax](https://handsoffsalestax.com/sales-tax-on-subscriptions/)
- [5 Types of Insurance Policies and Coverage, Experian](https://www.experian.com/blogs/ask-experian/types-of-insurance-policies-and-coverage/)
- [Umbrella insurance, Wikipedia](https://en.wikipedia.org/wiki/Umbrella_insurance)
- [Understanding the Different Types of Insurance Policies and Coverage You Need, Experior Financial](https://usa.experiorfinancial.com/understanding-the-different-types-of-insurance-policies-and-coverage-you-need/)
- [Mode of Premium Payment definition, Answer Financial](https://www.answerfinancial.com/insurance-center/insurance-terms/mode-of-premium-payment-definition/)
- [How Often Do You Pay Car Insurance: Monthly vs. Annual, LegalClarity](https://legalclarity.org/how-often-do-you-pay-car-insurance-payment-schedules-explained/)
- [Annual vs Semi-Annual Insurance Payments, A-MAX](https://www.amaxinsurance.com/knowledge-center/annual-vs-semi-annual-insurance-payments)
- [Negative Option Rule, Federal Trade Commission](https://www.ftc.gov/legal-library/browse/rules/negative-option-rule)
- [FTC Revives Click-to-Cancel Rule: New Risks for Subscription Businesses, Jones Day](https://www.jonesday.com/en/insights/2026/05/ftc-revives-clicktocancel-rule-new-risks-for-subscription-businesses)
- [FTC Restarts Subscription Rulemaking, Kirkland & Ellis](https://www.kirkland.com/publications/kirkland-alert/2026/03/ftc-restarts-subscription-rulemaking)
- [Cost of Unused Paid Subscriptions 2026, Self Financial](https://www.self.inc/info/cost-of-unused-paid-subscriptions/)
- [Subscription Statistics 2026: What Americans Actually Spend, LowerMySubs](https://www.lowermysubs.com/blog/subscription-statistics)
- [Forgotten Subscriptions Cost You $204/Year on Average, Resubs](https://resubs.app/resources/hidden-cost-of-forgotten-subscriptions)
