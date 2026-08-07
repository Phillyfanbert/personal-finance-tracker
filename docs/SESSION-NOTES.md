# Session Notes — Handoff for the Next Session

*Last updated: 2026-08-05, end of a long working session. This file exists so
a new session can pick up context fast instead of re-deriving it. Update or
replace it at the start/end of future sessions rather than letting it drift
stale — treat it as a living doc, not a permanent record.*

## Where things stand right now

The app started as a plain expense tracker and became a broader financial
tracker/planner this session: Log page now shows **Net worth = Assets −
Liabilities**, on top of the original quick-add expense logging. Everything
below is live on Supabase and pushed to `main` (commit `fa667ec` as of this
writing) unless explicitly marked otherwise.

## The data model, as it actually works today

Three related-but-distinct concepts — this distinction was a recurring
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
  overdraft) — that's intentional, only Cash got the explicit floor request.
- Credit expense on a linked account → **adds** to the linked liability's
  running balance. This is the mirror-image sign convention of the asset
  case (spending increases what you owe, decreases what you have) — see
  the comment block above `applyLiabilityDelta` if extending this.
- Editing/deleting an expense reverses the old effect and applies the new
  one (both functions take a `sign` param for this).

**Net worth math** (`app/networth.js`): `computeNetWorth()` deliberately
excludes "Expenses (this month)" from `liabilitiesTotal` — including it
used to double-count debit/cash expenses (once via the asset deduction,
again via the liabilities sum). The Credit/Debit/Cash breakdown shown in
the UI is informational only now, not part of the net worth calculation.
Credit's real liability is the tracked running balance, not a monthly
transaction sum — this correctly handles irregular payoff timing.

**Paying down a liability** is a manual transfer (Pay modal on each
liability row): reduces a chosen asset's value and the liability's balance
together, blocked if the asset doesn't have enough value to cover it.
Never logged as an expense (would double-count the same money). A separate
"+" button lets you directly add to a liability's balance (a correction,
or a charge you don't want to log as a full expense) — no asset touched.

**Guardrails added this session, worth knowing about:**
- Logging a credit expense is blocked if no credit account exists yet
  (`hasCreditAccount()` check) — otherwise the liability has nowhere to go.
- Assets/liabilities lists show category-above-name (e.g. "Bank" above
  "Bank of America"), not the reverse — a deliberate UI decision, not a bug
  if it looks unusual at first glance.

## F6 — live deal discovery (subscription savings)

Phases A–C are built (see `docs/F6-live-deals-proposal.md` for the full
design, kept up to date with a status header). Recap:
- `deal_findings` + `service_domains` tables live in Supabase.
- `tools/deal-agent.js` — searches SearXNG for cheaper plans on the user's
  *actual* subscribed services (not the whole catalog, to cut wasted
  queries), extracts via Gemma, writes findings. Includes a Gemma warm-up
  + longer timeout to handle Ollama's dynamic model unloading.
- `tools/searxng/` + `tools/run-deal-agent.sh` — brings SearXNG up only for
  the duration of a run, tears it down after (not a background service).
- **Not done yet:** the actual server-machine setup (bootstrapping SearXNG's
  config, filling in `tools/.env.deal-agent` with real
  `SUPABASE_SERVICE_ROLE_KEY` / exact `GEMMA_MODEL` tag). The user said
  "I will do the server machine setup later" — this is the main loose end
  on the F6 side. Phase D (cron scheduling) and Phase E (review/promote UI
  for candidate findings) are also still open, lower priority.
- Runs on the **server machine only**, talking to Gemma over `localhost`
  deliberately — not Tailscale, not a public tunnel — for privacy and to
  avoid adding devices to any network. This was a real back-and-forth in
  the session; don't re-litigate it without a reason.

## Interactive Q&A + monthly reports

- `app/insights.js` (context builder) + `app/gemma.js`'s new `askGemma()` /
  `buildQaPrompt()` — a free-text Q&A contract, separate from the existing
  strict-JSON extraction contract. Live in the Reports tab, degrades
  gracefully (same pattern as Phase 3) when `GEMMA_ENDPOINT` is unset.
- `tools/monthly-report.js` — same shape as `deal-agent.js`, generates a
  natural-language monthly report per user, writes to `spending_insights`
  (per-user RLS, unlike F6's shared tables — this is real personal data).
- **Not done yet:** neither of these has been tested against a real Gemma
  endpoint in this session (no tunnel/localhost setup was live during
  testing) — logic was verified via console simulation only.

## Deployment

- Cloudflare Workers (not classic Pages) — `wrangler.jsonc` +
  `tools/generate-config.js` (writes `app/config.js` from env vars at build
  time, since it's gitignored). GitHub-connected, auto-deploys on push to
  `main`. Live at `https://personal-finance-tracker.philbert453.workers.dev`.
- Supabase project `ixosipgbikygqilbgvjx`. All migrations through `11_*.sql`
  applied live (also saved in `supabase/` for reproducibility — the numbered
  files are the source of truth for schema history, always keep them in
  sync with what's actually applied).

## Loose ends / natural next steps

Roughly in the order they came up, not necessarily priority:

1. **Server-machine setup** for F6 + monthly reports (see above) — the
   single biggest "not actually working yet" item, since nothing that
   depends on Gemma or SearXNG has been tested live.
2. **Vehicle depreciation** (`docs/asset-depreciation-proposal.md`) —
   designed (Option A: depreciation formula, no new infra) but not built.
   Explicitly deferred to a later session by the user.
3. **F6 Phase D** (weekly cron/systemd for `deal-agent.js`) and **Phase E**
   (review/promote a `deal_findings` candidate into the trusted catalog).
4. Leaked-password-protection advisor warning: confirmed **not applicable**
   (Pro-plan-only feature, and the app uses magic-link auth exclusively —
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

- Don't re-add em dashes — the whole repo was swept clean of them
  (186 occurrences, 29 files) per explicit user preference against them, in
  code comments, docs, and UI strings alike.
- Don't reintroduce a `service_role` key anywhere in `app/` — it's confined
  to `tools/` scripts (env var only, gitignored), by design, checked
  multiple times this session.
- Don't merge Accounts and Assets back into one concept — the separation
  was deliberate and revisited/reinforced several times (see the data model
  section above).
