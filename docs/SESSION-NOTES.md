# Session Notes - Handoff for the Next Session

*Last updated: 2026-08-08, end of a long working session. This file exists so
a new session can pick up context fast instead of re-deriving it. Update or
replace it at the start/end of future sessions rather than letting it drift
stale - treat it as a living doc, not a permanent record.*

**Start here:** the sections below (`## Where things stand right now` through
`## Things NOT to redo`) are from the 2026-08-05 session and are now
partially superseded - see `## Session update - 2026-08-08` at the end of
this file for what changed since, including several reversals of things
described below (the Owed/Paying tab split, "Total liabilities" formula).
Read both; the later section wins on anything they disagree about. General
setup/architecture/convention info that doesn't change session-to-session
now lives in `CLAUDE.md` at the repo root, not here.

## Where things stand right now

The app started as a plain expense tracker and became a broader financial
tracker/planner this session: Log page now shows **Net worth = Assets -
Liabilities**, on top of the original quick-add expense logging. Everything
below is live on Supabase and pushed to `main` (commit `fa667ec` as of this
writing) unless explicitly marked otherwise.

## The data model, as it actually works today

Three related-but-distinct concepts - this distinction was a recurring
source of confusion during the session, worth internalizing before touching
this code:

| Table | Question it answers | Counted in net worth? |
|---|---|---|
| `accounts` | "How did I pay for this?" (payment method tag) | No |
| `assets` | "What do I own?" | Yes |
| `liabilities` | "What do I owe?" (tracked debts) | Yes |

`accounts` optionally links to *one* of `assets` (`linked_asset_id`) or
`liabilities` (`linked_liability_id`), never both. What auto-links on
account creation:
- `checking` / `debit` → auto-creates + links a `bank`-type asset ($0, edit after).
- `credit` → auto-creates + links a `liabilities` row (`credit_card`, $0 balance).
- `cash` → **not creatable manually at all.** Exactly one `Cash` account +
  linked `Cash` asset exists per user, auto-created on app load
  (`ensureCashAccount()` in `app.js`), enforced by a partial unique index
  (`accounts_one_cash_per_user`, and `assets_one_cash_per_user` blocks a
  second manually-added Cash asset too).
- `other` → no auto-link; manual picker only.

**Expense → asset/liability side effects** (`applyAssetDelta` /
`applyLiabilityDelta` in `app.js`):
- Non-credit expense on a linked account → deducts from the linked asset.
  Cash floors at $0 (never negative); other assets can go negative (e.g.
  overdraft) - that's intentional, only Cash got the explicit floor request.
- Credit expense on a linked account → **adds** to the linked liability's
  running balance. This is the mirror-image sign convention of the asset
  case (spending increases what you owe, decreases what you have) - see
  the comment block above `applyLiabilityDelta` if extending this.
- Editing/deleting an expense reverses the old effect and applies the new
  one (both functions take a `sign` param for this).

**Net worth math** (`app/networth.js`): `computeNetWorth()` deliberately
excludes "Expenses (this month)" from `liabilitiesTotal` - including it
used to double-count debit/cash expenses (once via the asset deduction,
again via the liabilities sum). The Credit/Debit/Cash breakdown shown in
the UI is informational only now, not part of the net worth calculation.
Credit's real liability is the tracked running balance, not a monthly
transaction sum - this correctly handles irregular payoff timing.

**Paying down a liability** is a manual transfer (Pay modal on each
liability row): reduces a chosen asset's value and the liability's balance
together, blocked if the asset doesn't have enough value to cover it.
Never logged as an expense (would double-count the same money). A separate
"+" button lets you directly add to a liability's balance (a correction,
or a charge you don't want to log as a full expense) - no asset touched.

**Guardrails added this session, worth knowing about:**
- Logging a credit expense is blocked if no credit account exists yet
  (`hasCreditAccount()` check) - otherwise the liability has nowhere to go.
- Assets/liabilities lists show category-above-name (e.g. "Bank" above
  "Bank of America"), not the reverse - a deliberate UI decision, not a bug
  if it looks unusual at first glance.

## F6 - live deal discovery (subscription savings)

Phases A–C are built (see `docs/F6-live-deals-proposal.md` for the full
design, kept up to date with a status header). Recap:
- `deal_findings` + `service_domains` tables live in Supabase.
- `tools/deal-agent.js` - searches SearXNG for cheaper plans on the user's
  *actual* subscribed services (not the whole catalog, to cut wasted
  queries), extracts via Gemma, writes findings. Includes a Gemma warm-up
  + longer timeout to handle Ollama's dynamic model unloading.
- `tools/searxng/` + `tools/run-deal-agent.sh` - brings SearXNG up only for
  the duration of a run, tears it down after (not a background service).
- **Not done yet:** the actual server-machine setup (bootstrapping SearXNG's
  config, filling in `tools/.env.deal-agent` with real
  `SUPABASE_SERVICE_ROLE_KEY` / exact `GEMMA_MODEL` tag). The user said
  "I will do the server machine setup later" - this is the main loose end
  on the F6 side. Phase D (cron scheduling) and Phase E (review/promote UI
  for candidate findings) are also still open, lower priority.
- Runs on the **server machine only**, talking to Gemma over `localhost`
  deliberately - not Tailscale, not a public tunnel - for privacy and to
  avoid adding devices to any network. This was a real back-and-forth in
  the session; don't re-litigate it without a reason.

## Interactive Q&A + monthly reports

- `app/insights.js` (context builder) + `app/gemma.js`'s new `askGemma()` /
  `buildQaPrompt()` - a free-text Q&A contract, separate from the existing
  strict-JSON extraction contract. Live in the Reports tab, degrades
  gracefully (same pattern as Phase 3) when `GEMMA_ENDPOINT` is unset.
- `tools/monthly-report.js` - same shape as `deal-agent.js`, generates a
  natural-language monthly report per user, writes to `spending_insights`
  (per-user RLS, unlike F6's shared tables - this is real personal data).
- **Not done yet:** neither of these has been tested against a real Gemma
  endpoint in this session (no tunnel/localhost setup was live during
  testing) - logic was verified via console simulation only.

## Deployment

- Cloudflare Workers (not classic Pages) - `wrangler.jsonc` +
  `tools/generate-config.js` (writes `app/config.js` from env vars at build
  time, since it's gitignored). GitHub-connected, auto-deploys on push to
  `main`. Live at `https://personal-finance-tracker.philbert453.workers.dev`.
- Supabase project `ixosipgbikygqilbgvjx`. All migrations through `11_*.sql`
  applied live (also saved in `supabase/` for reproducibility - the numbered
  files are the source of truth for schema history, always keep them in
  sync with what's actually applied).

## Loose ends / natural next steps

Roughly in the order they came up, not necessarily priority:

1. **Server-machine setup** for F6 + monthly reports (see above) - the
   single biggest "not actually working yet" item, since nothing that
   depends on Gemma or SearXNG has been tested live.
2. **Vehicle depreciation** (`docs/asset-depreciation-proposal.md`) -
   designed (Option A: depreciation formula, no new infra) but not built.
   Explicitly deferred to a later session by the user.
3. **F6 Phase D** (weekly cron/systemd for `deal-agent.js`) and **Phase E**
   (review/promote a `deal_findings` candidate into the trusted catalog).
4. Leaked-password-protection advisor warning: confirmed **not applicable**
   (Pro-plan-only feature, and the app uses magic-link auth exclusively -
   no password field exists to protect). Don't re-investigate this unless
   auth methods change.

## Known bugs - fixed this session

Reported right after the credit-liability work shipped. All three were
reproduced live (not just read statically) via a throwaway Playwright +
mocked-Supabase harness in scratch space, then fixed in `app.js`/`sw.js`/
`index.html`:

1. **Clicking a credit account's icon didn't open anything - fixed.**
   `loadAccounts()` (`app.js`) only ever set `data-adjust-acct` (keyed off
   `linked_asset_id`), so credit accounts - which link to a *liability* -
   never got a click handler. Now accounts without a linked asset but with
   a `linked_liability_id` get `data-adjust-liability` instead, wired to
   `openPayForm()`. Tapping a credit account's circle now opens the Pay
   modal directly, same as tapping a bank/cash circle opens asset-adjust.
2. **"Pay always zeroes out the liability balance" - root-caused, but not
   where expected.** The `payConfirmBtn` math itself (`balance - amount`,
   floored at 0) was already correct and reproduced correctly in isolation
   (paying $50 on a $380 balance left $330, verified live). The real bug:
   `sw.js`'s `install` handler called `self.skipWaiting()`
   unconditionally, and combined with `clients.claim()` in `activate`,
   that fires `controllerchange` (which `index.html` responded to with an
   unconditional `location.reload()`) within roughly 150-300ms of *every*
   page load - reproduced live, no user interaction needed. This also
   fires again on any later deploy while a tab is open. A reload landing
   mid-interaction (e.g. between the two sequential `await`s in
   `payConfirmBtn`, or just wiping the typed amount before submit) would
   produce exactly this symptom, and the timing (reported right after
   several back-to-back pushes/auto-deploys) fits. Fixed by removing the
   unconditional `skipWaiting()` and only reloading after the user
   actually taps the existing "Update available" toast (`index.html`) -
   matches what that code's own comments already said the intent was
   ("ask, don't force"). If this *specific* symptom somehow still
   reproduces after this fix, treat it as a new bug, not this one - the
   math and click-handling were independently verified correct.
3. **Credit-expense blocking was too loose - fixed.** `hasCreditAccount()`
   checked whether *any* credit account existed anywhere; replaced with
   `isCreditAccount(accountId)`, which validates the *selected* account
   itself is credit-type. Applied in both quick-add save and edit-modal
   save. Verified live: a Checking-account credit expense is now blocked
   with "Select a credit account...", while a Discover-account credit
   expense still goes through and correctly adds to its liability balance.

## Things NOT to redo

- Don't re-add em dashes - the whole repo was swept clean of them
  (186 occurrences, 29 files) per explicit user preference against them, in
  code comments, docs, and UI strings alike.
- Don't reintroduce a `service_role` key anywhere in `app/` - it's confined
  to `tools/` scripts (env var only, gitignored), by design, checked
  multiple times this session.
- Don't merge Accounts and Assets back into one concept - the separation
  was deliberate and revisited/reinforced several times (see the data model
  section above).

## Session update - 2026-08-08

Long follow-on session, 36 commits (`fa667ec..cec71bc`). The account/asset/
liability model changed enough that several statements in the sections above
are now outdated - this section is the current state; see `CLAUDE.md` for
the durable version of the rules that came out of it (data model table,
style, constraints). Grouped by theme, not chronological:

**Account model reworked around a new `bank_name` concept.** An account now
has `name` (Checking/Savings/Credit - derived from the selected type, no
longer free-typed) and `bank_name` (which institution - Chase, Discover;
required for every type except Cash) as two separate fields, so multiple
accounts (a Checking and a Savings) can share a bank and still sort/group
together in the Accounts card. `bank_name` is validated on save against a
bundled list of ~3,750 real FDIC-insured bank names (`app/bankNames.js`,
pulled from the FDIC BankFind API) plus a few well-known credit
unions/brands FDIC doesn't cover, with a `<datalist>` search-as-you-type
picker - not free text, and not a live web search (deliberately avoided the
cost/latency of a backend lookup for this). **Savings** joined Checking and
Credit as a selectable account type. The account-type selector is three
always-visible toggle buttons, not a `<select>` - a real bug shipped because
a dropdown's current value was easy to glance past (a "Credit"-named account
saved as Checking because the default was never changed); toggle buttons
make the active one unmissable.

**A credit account's owed balance is now locked to real expenses.** Removed
every manual owed-editing path (direct-set, add-a-charge) for a
credit-account-linked liability - it can only change through an actual
logged credit expense from here on. A *standalone* liability (Loan/Mortgage/
Other, no linked account) is the deliberate exception and keeps manual
owed-editing, since it has no purchase trail to reconcile against - don't
remove that one too. Deleting an account now cascades to delete its linked
asset or liability via a DB trigger (`12_delete_liability_with_account.sql`,
`13_delete_asset_with_account.sql`), not app-code cleanup, so this holds
regardless of which client makes the change.

**No balance can go negative through any manual path, anywhere.** Extended
from just Cash (2026-08-05) to every account: the asset-adjust panel, the
liability Pay form, and expense logging itself (`assetDeltaError` runs
before any expense insert/update and blocks with a toast rather than
silently flooring at $0). Also fixed a real bug where the error *was* firing
correctly but rendering invisibly behind a modal's dark overlay - `.toast`
had a lower `z-index` than `.modal`.

**"Total liabilities" and "Monthly liabilities" got redefined, more than
once, before landing.** Current state: Total is tracked credit-debt balance
only (unchanged from 2026-08-05); Monthly is *just this month's credit
charges* - a slice of Total, not a separate pool. Subscriptions and general
expense totals were tried in Monthly at two different points this session
and both were reverted - neither is actually debt (a subscription is a
recurring cost; debit/cash spending already reduces an asset directly) - see
`app/networth.js`'s comment before changing this again. The Liabilities card
itself now splits into "Credit liabilities" (account-linked, Pay only) and
"Other liabilities" (standalone, Pay/+/delete) instead of one blended list.

**Subscriptions can now log themselves as real expenses**, not just a
forecast. "Mark as paid" (manual) and automatic logging on app load (any
active, monthly/annual, account-linked subscription whose `next_renewal` has
passed) both run through the same expense-insert + asset/liability-delta
path as any other expense, and catch up on multiple missed cycles (capped at
36) without ever overdrawing an account - stops and leaves `next_renewal` at
the first uncovered cycle if a catch-up would go negative. `other`-cycle or
not-yet-linked subscriptions still need the manual button; they can't be
auto-processed.

**Log/Reports pages got expense logs.** Quick-add dropped its separate
"Payment" field entirely - payment type is now derived from whichever
account is selected (`account.type` and `payment_type` share the same
values), and picking an account is required, on both quick-add and edit.
Both the Log page's list (renamed "Recent Expenses") and a new "Monthly
Expense Log" on the Reports page are capped with `.scroll-list` (max-height
+ scroll) so a busy month doesn't push everything else down the page; both
share one `renderExpenseList()` helper.

**Renamed the app** "Personal Finance Tracker" throughout (browser tab,
signed-out screen, Log page header) - it outgrew "Expense Tracker" a while
back. The PWA install name in `manifest.json` was deliberately left
unchanged (not asked for).

**Added `CLAUDE.md`** at the repo root - setup/commands/architecture/
convention reference for future agent sessions, split out from this file so
this one can stay a short-lived handoff doc instead of accumulating
permanent rules indefinitely.

**Not touched this session:** F6 live-deal-discovery and the Gemma-backed
monthly report/Q&A features - their status (built, server-machine setup
still pending, untested against a real Gemma endpoint) is unchanged from
2026-08-05, see the sections above.

## Session update - 2026-08-08 (part 2) - Recent Transactions

The Log page's "Recent Expenses" list only ever showed rows from
`expenses` - paying down a liability (Pay modal) or manually adjusting an
asset's balance (+/-/set panel) moved real money but left no trace there,
which read as incomplete once the list was renamed conceptually to
"transactions." Fixed by adding a new `account_activity` table
(`supabase/16_account_activity.sql`, applied live) that logs those two
action families (`kind`: `asset_adjust` from `adjustAddBtn`/
`adjustSubtractBtn`/`adjustSetBtn`, `liability_payment` from
`payConfirmBtn`) with a human-readable description and a positive `amount`
(no signed-amount convention to get wrong on merge/display). The Log
page's list (`app.js`'s `recentTransactions()` + `renderRecentTransactions()`)
merges `expenses` and `account_activity` client-side, sorted by
`occurred_at` then `created_at` desc, capped at 50. `renderExpenseList` now
branches on a `kind` field (only `account_activity` rows have one -
`expenses` has no such column) to render activity rows as non-clickable
(no edit modal - there's nothing there to edit) with an `ACTIVITY_LABEL`
in place of a category.

**Deliberately NOT logged as activity:** standalone-liability manual
"owed" edits (direct-set / add-a-charge, `debtOwedSetConfirm`/
`debtOwedConfirm`) - those correct or add to debt, they don't move money
through an account, which is a different thing from what "Recent
Transactions" is for here. Don't add them without deciding that's actually
wanted.

**Reports' "Monthly Expense Log" (`rptExpList`) is unchanged, on purpose** -
per the user's explicit ask, it still reads `allExpenses` directly with no
`account_activity` merge. `renderExpenseList` is shared by both lists;
what differs is only what each caller passes in.

## Session update - 2026-08-08 (part 3) - in-app confirm modal

Added a generic `confirmModal(message, { title, confirmLabel })` in
`app.js` (returns a Promise<boolean>, same call shape as `window.confirm()`
- `if (!(await confirmModal(...))) return;`) backed by a new `#confirmModal`
sheet in `index.html`, styled like every other modal in the app instead of
the browser's native dialog. Wired it into account deletion only (the ask
was specifically about that flow) - other destructive actions (asset/
liability/subscription/expense delete) still use `window.confirm()` and
were deliberately left alone rather than churning unrelated code; swapping
them to `confirmModal()` later is a one-line change each if wanted.

## Session update - 2026-08-08 (part 4) - every account type from the research doc

Big one. The user explicitly chose (via clarifying question, not assumed)
to implement literally every account type cataloged in
`docs/bank-account-types-research.md` as a selectable type in the Accounts
card, not just the payment-method subset - so things like a Roth IRA, HSA,
or cryptocurrency exchange are now addable there too, even though you'd
never select them to pay for a burger. `supabase/17_expand_account_types.sql`
(applied live) expanded `accounts.type`, `assets.type`, `liabilities.type`,
and `expenses.payment_type` to ~42 values. Deliberately excluded: business
accounts (out of scope per `CLAUDE.md`'s personal-finance framing) and
escrow accounts (a sub-ledger belonging to a mortgage servicer, not
something an individual opens or selects).

**Everything now keys off one config, not per-type special-casing.**
`ACCOUNT_TYPES` in `app.js` is the single source of truth: `{ label,
category, kind: 'asset'|'liability', linkType }` per type. `AUTO_ASSET_TYPE`
/ `AUTO_LIABILITY_TYPE` / `ACCOUNT_TYPE_NAME` / `LIABILITY_ACCOUNT_TYPES` /
`DEBT_TYPE_LABEL` / `ASSET_TYPE_LABEL` are all *derived* from it now, not
hand-maintained maps - adding a 43rd type later means adding one line to
`ACCOUNT_TYPES`, not touching five functions. This is also why
`assetDeltaError`/`applyAssetDelta`/`applyLiabilityDelta` no longer
special-case the literal string `'credit'` - they now gate purely on
whether the account has a `linked_asset_id` vs `linked_liability_id`,
which is what actually makes a HELOC or a 401(k) work correctly here
without bespoke code, the same way a credit card always has.

**The 3-button account-type toggle became a categorized `<select>`.**
Three always-visible buttons (the original design, chosen specifically
so a selection couldn't be glanced past) don't fit 42 options. The
regression that toggle design was solving for is mitigated instead with a
bold, always-updating "Adding: <type>" summary line next to the dropdown
- see `populateAcctTypeSelect`/`setAcctType` (app.js). If this still feels
too easy to fat-finger in practice, revisit before adding more types on
top of it.

**Bank-name validation (`isKnownBank`, the ~3,750-name FDIC list) is now
per-type, not per-category.** Original plan was "Deposit/Credit/Loans get
strict validation, Retirement/Specialty don't," but that broke on BNPL
specifically (Affirm, Klarna aren't FDIC banks, but BNPL was filed under
"Credit accounts") - caught by actually testing "Affirm" against the form
before shipping, not just reading the code. Fixed by making
`BANK_VALIDATED_TYPES` an explicit set of the ~11 types that are
realistically always bank/credit-union issued (Checking, Savings, Money
Market, Cash Management, CD, Credit Card, Charge Card, Secured Credit
Card, Personal Line of Credit, HELOC, Overdraft Line), with every loan
type, BNPL, and all Retirement/Specialty types getting a plain non-empty
"Institution name" field instead. If you add a new type later, decide
which bucket it goes in explicitly - don't assume category membership
implies bank-issued-ness, that was the exact bug here.

**Every liability payment now requires an actual linked account**, per
explicit user confirmation on this specific question. The Pay-a-liability
form's "From account" dropdown (`payFromAsset`, renamed from "From asset")
now only lists assets with a `linked_asset_id` pointing at them
(`loadAssets()`) - a standalone Investment/Property/retirement asset with
no account behind it can no longer be selected there. Expense logging
already required an account before this (quick-add and edit both) and is
unchanged. Standalone liability "Owed" corrections
(`debtOwedSetConfirm`/`debtOwedConfirm`) are deliberately NOT required to
link an account - unchanged from before, since that's a debt correction,
not a transaction moving money through an account (same reasoning as the
account_activity work above).

**The edit modal's separate "Payment" field is gone.** It was a second,
independently-editable field that could disagree with the selected
Account (guarded by the now-deleted `isCreditAccount()` check) - with 42
types instead of 3, that mismatch surface only got worse. `payment_type`
is now derived from the selected account directly in the edit modal too,
exactly like quick-add already did. This removes a whole class of
possible bugs, not just the credit-specific one it used to guard against.

**Standalone Assets/Liabilities dropdowns also grew**, independent of the
Accounts card: `assetType` gained Retirement & investment and most of
Specialty (populateAssetTypeSelect), `debtType` gained the specific loan
types (populateDebtTypeSelect) - both because these are more realistically
tracked as a plain value with no spendable "account" behind them (you
don't tag a Starbucks purchase as "paid via my 401(k)"). Prepaid/payroll
cards, digital wallet, and second-chance checking were deliberately left
out of the standalone Assets list - they're just Checking variants, only
useful as a spendable account.

**Not done / explicitly out of scope this pass:** HELOC draw-vs-repayment
period modeling, CD maturity dates, any live-priced value source (crypto,
brokerage, retirement) - all of docs/bank-account-types-research.md's
"open questions" section 12 is still open. This pass is the type
taxonomy and the linking/delta plumbing, not the deeper behavior of any
one exotic type.
