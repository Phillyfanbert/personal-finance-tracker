# Personal budgeting methodologies

A reference on how individuals actually budget, researched before building or
changing any budgeting feature in this app. It exists to answer one question
honestly: what are the real, named frameworks people use to control spending,
where does each one work well, and where does it fall apart.

This is a research document, not a recommendation to the reader. It describes
frameworks and cites where each claim comes from; it does not tell anyone
which one to use. That distinction matters for this app specifically, and
section 9 spells out why.

---

## 1. What every framework is actually trying to solve

Read enough of these and a pattern shows up: nearly every named framework is a
different answer to the same three questions.

1. **How much is safe to spend, in total, before saving anything?**
2. **How is that total split among categories?**
3. **When does money get assigned: before you spend it, or after?**

The frameworks below differ mainly in how rigid the split is (a fixed
percentage vs. a value you choose), and whether assignment happens up front
(zero-based, envelope, pay-yourself-first) or is discovered by tracking what
already happened (kakeibo, values-based). Almost none of them disagree about
the more basic things underneath: irregular income needs its own handling
(section 6), an emergency fund is close to universally recommended (section
7), and simply seeing your spending, in nearly any format, changes behavior
more than the specific split does (section 8).

---

## 2. Percentage-of-income frameworks

These fix the split as a rule and let categories float. They are the easiest
frameworks to start with because there is no per-category setup, and the
easiest to abandon because a rigid split does not fit every income level.

### 2.1 The 50/30/20 rule

**Origin.** Coined by Elizabeth Warren and her daughter Amelia Warren Tyagi in
their 2005 book *All Your Worth: The Ultimate Lifetime Money Plan*, where
Warren (a bankruptcy law scholar before she entered politics) called it the
"Balanced Money Formula." ([First United Bank](https://www.firstunitedbank.com/spendlifewisely/50-30-20-rule-budgeting), [Wealthtender](https://wealthtender.com/insights/money-management/avoid-using-elizabeth-warrens-proposed-personal-budget-plan/))

**The split**, applied to after-tax income:
- **50% needs** - rent or mortgage, utilities, minimum debt payments,
  groceries, insurance: the bills that exist whether or not you spend on
  anything else.
- **30% wants** - dining out, entertainment, subscriptions, upgrades: the
  spending that is discretionary even if it does not feel that way.
- **20% savings and extra debt payments** - retirement, an emergency fund, or
  anything above the minimum on a debt.

**Where it works.** It needs almost no setup: three buckets, not fifteen. For
someone who has never tracked spending before, three categories is a
realistic first step in a way that twenty categories is not.

**Where it breaks.** The rule assumes needs can fit in half of take-home pay,
which is a real assumption, not a law of arithmetic. It has drawn direct
criticism for being difficult to apply at lower or more modest incomes, where
housing alone can exceed 50% before anything else is counted.
([First United Bank](https://www.firstunitedbank.com/spendlifewisely/50-30-20-rule-budgeting))

### 2.2 60/30/10 and 70/20/10: the same idea, different assumption about fixed costs

Two variants exist specifically because 50/30/20's 50% ceiling on needs does
not hold in every cost-of-living environment, and both were seeing renewed
attention as inflation pushed fixed costs up.

**60/30/10** keeps the same three categories, needs/wants/savings, but shifts
10 points from savings into needs: 60% needs, 30% wants, 10% savings. It is
explicitly a concession, not an upgrade. Analysis cited by Kiplinger put
essential costs at 55-60% of income for many households by 2026, which is
what pushed the 50% ceiling out of reach in the first place; the tradeoff is
that 10% saved is widely flagged by the same sources as too thin a margin to
rely on long-term.
([Kiplinger](https://www.kiplinger.com/personal-finance/the-new-603010-budgeting-method), [Ramsey](https://www.ramseysolutions.com/budgeting/60-30-10-budget-rule))

**70/20/10** splits the third bucket differently: 70% living expenses (needs
and wants combined, not separated), 20% savings, 10% extra debt payments or
charitable giving. Because it does not separate needs from wants inside the
70%, it is a coarser tool: good for someone who wants one number to stay under
overall, poor for someone trying to see where discretionary spending is
actually going. ([Chase](https://www.chase.com/personal/banking/education/budgeting-saving/70-20-10-budget-rule), [WalletHub](https://wallethub.com/edu/b/70-20-10-rule/144081))

**The honest takeaway across all three:** the percentages are not the
finding. The finding is that fixed costs, by definition, are the part of a
budget an individual controls the least in the short term, and every one of
these variants is really an argument about how large the fixed-cost bucket is
allowed to be before the rest of the plan becomes unrealistic. A framework
that assumes your real fixed costs are lower than they are will read as
failure every single month, for a reason that has nothing to do with
discipline.

### 2.3 The 60% Solution

**Origin.** Devised by Richard Jenkins, a former editor-in-chief of MSN
Money, after concluding that two decades of detailed expense tracking gave
him too little payoff for the effort it took. ([The Digerati Life](http://www.thedigeratilife.com/blog/personal-budgeting/), [Buxfer](https://blog.buxfer.com/2023/12/04/what-is-the-60-solution-budget/))

**The split**, applied to gross income (a deliberate difference from the
50/30/20 family, which uses after-tax income):
- **60% committed expenses** - housing, utilities, food, transportation,
  insurance, plus anything already committed to (subscriptions,
  memberships). Jenkins calls this "the four walls" plus obligations.
- **10% retirement savings**
- **10% long-term savings or debt reduction**
- **10% short-term savings** for irregular expenses (car repairs, gifts,
  annual bills)
- **10% "fun money,"** unaccounted for and spent freely

**The philosophy, not just the math.** Jenkins' argument is specifically
about the 60% number: keep committed expenses (the costs you cannot walk
away from without a real life change) under 60% of gross income, and the
remaining 40% is flexible enough to absorb a bad month without a crisis. The
claim is that financial stress correlates more with the size of your
committed-expense bucket than with how carefully the other 40% is tracked.
([The Digerati Life](http://www.thedigeratilife.com/blog/personal-budgeting/))

This is one of the few frameworks that explicitly names a target for one
number (60% max) rather than assigning a fixed split to everything, which
makes it closer to a health check than a full plan; it does not, on its own,
tell you how to spend the other 40% day to day.

---

## 3. Zero-based budgeting

**The idea, in one line:** every dollar of income is assigned a job before
the month starts, so income minus (spending + savings + debt payments) equals
zero. Not "spend nothing," "leave nothing unassigned."

**Origin and current form.** The term predates personal finance software (it
was originally a corporate budgeting technique that starts every department's
budget at $0 each cycle rather than rolling last year's forward), but its
current best-known form is **YNAB (You Need a Budget)**, built by Jesse
Mecham starting from a personal spreadsheet in 2004 and launched as a web app
in 2015. YNAB's own summary of its method is "give every dollar a job," which
is functionally the digital version of the envelope system in section 4:
categories replace envelopes, but the constraint (money must be assigned
before it's spent) is identical. ([YNAB](https://www.ynab.com/blog/what-is-a-zero-based-budget), [CNBC Select](https://www.cnbc.com/select/how-zero-based-budget-method-works/))

**A worked example**, on $4,000 monthly take-home pay:

| Category | Assigned |
|---|---|
| Rent | $1,400 |
| Groceries | $500 |
| Utilities | $200 |
| Debt minimum payments | $300 |
| Transportation | $250 |
| Emergency fund | $400 |
| Retirement | $300 |
| Subscriptions | $60 |
| Dining out | $250 |
| Extra debt payment | $340 |
| **Total assigned** | **$4,000** |

Nothing is left over, and nothing is missing. If a real expense comes in
above what a category holds, the rule is to move money *from another
category*, not to spend past zero, which is the discipline the method is
actually training.

**Where it works.** It is the most precise of any framework here, because
every dollar has a name. It also surfaces conflicts immediately: if rent,
debt minimums, and groceries alone exceed income, zero-based budgeting makes
that visible in the planning stage rather than as an overdraft three weeks
later.

**Where it breaks.** It is also the most time-consuming to start and to
maintain category by category, and it assumes fairly predictable income; an
irregular paycheck means re-planning the whole assignment every pay period
(see section 6). Both YNAB and its lower-cost competitor EveryDollar are
built entirely around this one mechanic, and market research on either
product credits the mechanic itself, not the app, for the effect. ([Ramsey](https://www.ramseysolutions.com/budgeting/ynab-vs-everydollar))

---

## 4. The envelope system and cash stuffing

**The idea.** Physical cash is divided into labeled envelopes at the start of
the pay period, one envelope per spending category. When an envelope is
empty, spending in that category stops until the next pay period, full stop,
with no card to fall back on.

**History.** The technique itself predates modern personal finance media by
a wide margin, commonly cited as over a century old, and was a standard way
to manage a household budget before digital banking existed at all.
([Thrivent](https://www.thrivent.com/insights/budgeting-saving/envelope-budget-system-what-it-is-how-to-start-cash-stuffing), [Fidelity](https://www.fidelity.com/learning-center/smart-money/cash-stuffing-envelope-budget)) It saw a specific, well-documented
revival under the name "cash stuffing" through TikTok, where the hashtag has
accumulated billions of views; Dave Ramsey is widely credited with
popularizing the envelope system's more recent resurgence before that viral
moment. ([NerdWallet](https://www.nerdwallet.com/finance/learn/envelope-system), [Patriot FCU](https://www.patriotfcu.org/blog/cash-stuffing-the-envelope-budgeting-method/))

**Why the constraint is the whole point.** The mechanism that makes this
different from every digital method on this list is that it is
*physically impossible* to overspend a category once the cash is gone. A
digital tool can warn you a category is over budget; a cash envelope cannot
be argued with. This is also its real limitation: it works only for spending
that can be paid in cash, which increasingly excludes rent, most bills, and
anything online.

**Digital equivalents.** Every zero-based budgeting tool (section 3) and
several banking apps offer "digital envelopes," sub-accounts or virtual
categories that mimic the constraint without physical cash. They recover
online-payment compatibility but lose the literal, tactile impossibility of
overspending that makes the original version work for people who specifically
struggle with card spending.

---

## 5. Income-first frameworks

### 5.1 Pay yourself first (reverse budgeting)

**The idea, inverted from every framework above.** Instead of budgeting
expenses and saving whatever is left, a fixed amount or percentage is moved
to savings or investments **the moment income arrives**, automatically, and
the rest is what's available to live on. It is called "reverse" budgeting
specifically because it reverses the usual order: savings is not the last
line of the plan, it is the first. ([Prudential](https://www.prudential.com/financial-education/how-to-reverse-budget), [NewsNation](https://www.newsnationnow.com/business/your-money/pay-yourself-first-budgeting-what-is-it/))

**Why it works when it works.** It removes the point of failure that sinks
most "save what's left" plans: there is usually nothing left, because
spending expands to fill whatever is available before saving is considered.
Automating the transfer means the saving happens before that expansion has a
chance to occur, and the source material on this method is consistent that
if a shortfall happens, it shows up in discretionary spending, not in the
amount saved. ([The Penny Hoarder](https://www.thepennyhoarder.com/budgeting/pay-yourself-first/))

**Where it does not fit.** It assumes the automated amount is genuinely
affordable every single period. On a fluctuating or paycheck-to-paycheck
income, an automated transfer sized for a good month can trigger an
overdraft in a lean one; multiple sources are explicit that this method
suits people who comfortably cover expenses already, not people establishing
whether they can. ([NerdWallet](https://www.nerdwallet.com/au/personal-finance/pay-yourself-first-reverse-budgeting))

Pay-yourself-first is not a full budgeting system on its own; it decides one
thing (savings happens first, automatically) and is commonly layered on top
of one of the category-based frameworks above for everything else.

### 5.2 Values-based (priority-based) budgeting

**The idea.** Instead of starting from categories or percentages, this
approach starts by naming a small number of personal values (family,
freedom, security, experience) and then builds spending priorities that
serve those values directly. Categories are still used, but they are derived
from the values rather than from a generic template. ([SoFi](https://www.sofi.com/learn/content/values-based-budgeting-explained/), [M1](https://m1.com/knowledge-bank/creating-a-value-based-budget-aligning-your-spending-with-personal-priorities/))

**What it changes, mechanically.** A values-based budget still has a
category for dining out, but the amount in it is set by asking whether
dining out serves a stated value ("connection," say) rather than by a
percentage rule. The stated benefit across sources is less about the
arithmetic and more about reducing the specific pattern where a rigid
percentage budget gets abandoned because it feels arbitrary: spending that
is deliberately tied to a stated value is reported as easier to sustain and
associated with less regret from impulse spending. ([Yahoo Finance](https://finance.yahoo.com/personal-finance/banking/article/values-based-budgeting-130014322.html))

**Where it is weak.** It has no built-in check on whether the numbers add up
to less than income; it is a *prioritization* method, not an *arithmetic*
method, and works best paired with one of the frameworks above (most often
zero-based or a percentage split) to supply the actual math.

### 5.3 Kakeibo

**Origin.** Invented in 1904 by Hani Motoko, often described as Japan's
first female journalist, specifically as an accessible entry point for
people who found other budgeting approaches too complicated. The word
translates to "household financial ledger." ([SoFi](https://www.sofi.com/learn/content/kakeibo-budgeting-method/), [Wikipedia](https://en.wikipedia.org/wiki/Kakeibo))

**The method.** At the start of each month, before spending, the practitioner
answers four questions on paper:

1. How much money do I have?
2. How much do I want to save?
3. How much am I spending?
4. How can I improve?

Expenses are then logged by hand through the month into four categories:
**Essentials** (food, housing, utilities), **Non-essential wants** (dining
out, hobbies), **Culture** (books, museums, subscriptions to the arts and
media), and **Non-anticipated** (unplanned, one-off costs like a repair or a
medical visit). At month's end, the fourth question is answered again by
comparing what was planned against what happened. ([Chase UK](https://www.chase.co.uk/gb/en/hub/kakeibo-saving/), [PocketGuard](https://pocketguard.com/blog/kakeibo-method/))

**What makes it different from every framework above.** Kakeibo has no fixed
percentages and no software requirement by design; it is closer to a
reflective journaling habit than a spreadsheet. Its entire mechanism is the
monthly reflection question, "how can I improve," which none of the
percentage or zero-based methods ask explicitly. Its weakness is the mirror
image of its strength: it provides no numeric target to hit, so someone who
needs a hard constraint (an envelope's empty pocket, a zero-based category
limit) will not get one from kakeibo alone.

---

## 6. Irregular and variable income

None of the frameworks above were designed with irregular income as the
starting assumption, and applying one unmodified to a variable paycheck is a
common, well-documented failure mode. The adaptations that come up
consistently across independent sources are the same regardless of which
framework is layered on top:

1. **Budget off a real average, not the best or most recent month.** A 6 to
   12 month trailing average income is the number cited most consistently as
   the baseline to plan against, specifically to avoid over-committing based
   on one good month. ([Beancount](https://beancount.io/blog/2026/04/03/budgeting-on-variable-income-freelancer-guide), [Discover](https://www.discover.com/online-banking/banking-topics/4-tricks-for-budgeting-on-a-fluctuating-income/))
2. **Pay yourself a fixed "salary" out of a buffer.** Income lands in a
   holding account first; a consistent, smaller amount is transferred to the
   spending account on a fixed schedule, turning irregular income into a
   predictable cash flow before any category-level budgeting happens.
   ([Upwork](https://www.upwork.com/resources/irregular-income), [Beancount](https://beancount.io/blog/2026/04/03/budgeting-on-variable-income-freelancer-guide))
3. **Use percentages, not fixed dollar amounts, for the categories that
   should scale with income** - so a high month automatically increases
   savings rather than just increasing discretionary spending, and a low
   month automatically reduces the discretionary category rather than
   missing a fixed obligation. ([Smart Money Trek](https://smartmoneytrek.com/how-to-budget-with-irregular-income))
4. **Size the emergency fund larger.** Multiple sources on freelance and
   self-employed budgeting put the target at 6 to 12 months of essential
   expenses, roughly double the standard recommendation in section 7,
   specifically because there is no unemployment insurance safety net
   underneath a self-employed income. ([Beancount](https://beancount.io/blog/2026/04/03/budgeting-on-variable-income-freelancer-guide))
5. **Set aside tax money immediately, per payment, not at year-end.** Cited
   consistently at 20-30% of each payment for anyone whose income has no
   employer withholding. ([Scale.jobs](https://scale.jobs/blog/10-budgeting-tips-for-freelancers-with-irregular-income))

This is not a separate framework; it is a modification layer that applies on
top of zero-based, percentage-split, or any other method above, and it is
worth treating as its own checklist rather than assuming any single
framework already accounts for it.

---

## 7. The emergency fund: the one number almost every source agrees on

Every framework above eventually points at the same target, worded
differently depending on which one is being described (a "savings" bucket, a
"short-term savings" envelope, an "essentials" category), so it is worth
stating on its own.

The Consumer Financial Protection Bureau's standing guidance is **3 to 6
months of essential living expenses** as a general target, rising to **9 to
12 months for self-employed income**, for the reason given in section 6:
volatile income has no unemployment-insurance floor under it.
([Oreate AI summary of CFPB guidance](https://www.oreateai.com/blog/cfpb-emergency-fund-how-much-3-to-6-months-recommendation/fb5bedb51643671046e49563e5e412bd)) A 2026 Bankrate
survey found 63% of Americans say they would personally need at least six
months saved to feel secure, which is directionally consistent with the
CFPB figure even though it is a stated preference rather than a
recommendation. ([via Yahoo](https://www.yahoo.com/news/emergency-savings-crucial-recession-heres-164501422.html))

Every framework in this document that includes a savings category is, in
effect, encoding some version of this target; none of them treat the
emergency fund as optional.

---

## 8. Debt payoff order: a related but genuinely separate decision

Once a budget is producing money to put toward debt (the "extra debt
payment" line in section 3's worked example, or the 10-20% in several of
the percentage splits), a second, independent decision appears: **which
debt gets the extra money first?** This is not a budgeting framework, it is
an ordering decision layered on top of one, and it has its own,
well-researched answer that is worth stating precisely because the two
sides of it disagree for different reasons.

- **Avalanche** (highest interest rate first) is mathematically optimal. It
  minimizes total interest paid, full stop; on a typical debt load the
  savings versus other orderings are estimated at $500-$2,000.
- **Snowball** (smallest balance first) is not mathematically optimal, but
  a 2016 study in the *Journal of Consumer Research* found it produced
  **higher overall debt payoff rates** among real participants, attributed
  to the psychological effect of an early, visible win rather than to any
  interest-math advantage. A separate 2012 study (Gal and McShane,
  *Journal of Marketing Research*) found that people who closed out
  individual debt accounts faster were significantly more likely to
  eliminate all their debt, regardless of the interest-rate math involved.
  ([summary via DolphinsTalk](https://dolphinstalk.com/2026/08/debt-avalanche-vs-snowball-which-works-better/))

**The honest summary:** avalanche saves more money; snowball keeps more
people finishing the plan. Neither claim is wrong, they are answers to two
different questions (least interest paid, vs. highest odds of actually
finishing), and which one matters more is a personal call about whether a
person is motivated more by the math or by visible progress. No credible
source claims one is simply better than the other in every case.

---

## 9. What the research says about whether budgeting works at all

Worth stating plainly, because it cuts against the framing of every product
in this space: **the evidence that budgeting itself improves financial
outcomes is real but genuinely mixed**, not a settled fact.

- Financial education in general has been found in some studies to have a
  limited effect on actual financial behavior, while other studies find real
  positive effects on both knowledge and behavior; the honest state of the
  literature is that it depends heavily on how the education or tool is
  designed and used, not whether it exists at all. ([Frontiers in Psychology](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2022.1090024/full))
- At least one field study found that adding a budgeting feature to an app
  increased engagement with the app itself, but produced **no measurable
  positive or negative financial impact**, a genuinely counterintuitive
  finding worth taking seriously rather than dismissing.
  ([Irrational Labs](https://irrationallabs.com/case-studies/budgeting/))
- Separately, behavioral research has found that giving people visibility
  into a spending limit can, in some conditions, **increase** spending,
  particularly toward the end of a budget period, because people treat the
  limit itself as a target to spend up to rather than a ceiling to stay
  under. ([BehavioralEconomics.com](https://www.behavioraleconomics.com/the-budgeting-app-trap-when-spending-information-backfires/))
- Research on "mental budgeting" (the informal habit of mentally
  categorizing money, which most people do even without a formal system)
  has found it is associated with better financial behavior and self-control
  on its own, separate from whether a person uses any named framework at
  all. ([ResearchGate summary](https://www.researchgate.net/publication/380868717_The_Interplay_of_Mental_Budgeting_Self-Control_and_Financial_Behavior_Implications_for_Individual_Financial_Well-Being))

The synthesis worth carrying forward: **the specific framework matters less
than whether someone actually keeps looking at their numbers, and a limit
framed as a target can backfire into being spent up to rather than stayed
under.** That second point is a genuine design hazard, not just a user
behavior quirk, and is directly relevant to how any budget-tracking feature
should present a limit.

---

## 10. Comparison

| Framework | Setup effort | Ongoing effort | Needs predictable income? | Best suited to |
|---|---|---|---|---|
| 50/30/20 | Very low | Low | Moderately | A first budget, or anyone who wants three buckets, not fifteen |
| 60/30/10 / 70/20/10 | Very low | Low | Moderately | Higher fixed-cost areas where 50/30/20's 50% ceiling does not fit |
| 60% Solution | Low | Low | Moderately | Someone who wants one number (committed expenses) to watch, not a full plan |
| Zero-based | High | High | Yes, or needs section 6's adaptation | Anyone who wants precision and is willing to maintain categories |
| Envelope / cash stuffing | Moderate | Moderate | Somewhat | Someone who specifically overspends on cards and needs a physical stop |
| Pay yourself first | Low | Very low (once automated) | Yes | Someone whose income reliably covers expenses already |
| Values-based | Moderate | Low | No dependency, but no built-in arithmetic check | Someone who has abandoned rigid percentage budgets before |
| Kakeibo | Low | Moderate (manual, reflective) | No dependency | Someone who wants a reflective habit, not a hard numeric constraint |

None of these are mutually exclusive. In practice, most sources describe
people combining an income-first rule (pay yourself first) with a
category-based one (zero-based or a percentage split) for what remains, and
layering irregular-income handling (section 6) on top when it applies.

---

## 11. Common failure patterns across every framework

Independent of which framework is chosen, the same handful of things break a
budget, and they are worth naming once rather than repeating per framework:

1. **Underestimating irregular, non-monthly expenses** (car registration,
   annual subscriptions, gifts, insurance premiums paid twice a year) so
   they land as a surprise instead of a planned category, regardless of
   which framework is nominally in use.
2. **Treating the budget as a one-time setup rather than a recurring
   review.** Every framework above that has a track record longer than a
   few years (kakeibo, envelope, zero-based) includes an explicit,
   recurring review step; the ones most commonly abandoned are the ones
   used as a one-time plan and never revisited.
3. **A limit framed as a target rather than a ceiling**, per section 9's
   behavioral-economics finding: shown a number, people spend toward it.
4. **No separation between what's "yours" (linked to accounts you actually
   control) and what's aspirational.** A budget category with no real
   funding source behind it is not a constraint, it is a wish.
5. **Applying a percentage-based framework at a fixed-cost level the
   percentages simply cannot fit**, which reads as personal failure every
   month when it is actually a mismatch between the framework's assumption
   and the real numbers (see section 2's discussion of why 60/30/10 exists
   at all).

---

## 12. Where this research goes next

This document is reference material: what the frameworks are, where each
came from, and what independent research says about them. Turning that into
an actual feature, including a dashboard design, category and rollover
decisions grounded in this app's real schema, and draft "getting started"
copy for a first-time user, is written up separately in this project's
internal design notes. Read those before building or changing anything in
the Budgets card.
