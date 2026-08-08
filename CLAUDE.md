# CLAUDE.md

Guidance for Claude Code (or any agent) working in this repository. Keep this
file limited to setup, commands, and durable rules - session-by-session
history belongs in `docs/SESSION-NOTES.md`, not here.

## Project Overview & Tech Stack

A private, personal finance tracker (expenses, accounts, assets, tracked
liabilities, subscriptions, net worth) for a small number of users (≈2).
Full spec/design rationale lives in `README.md` - read that for *why*, this
file is for *how to work in the repo*.

- **Frontend**: plain HTML/CSS/JS, ES modules, **no build step, no
  framework, no bundler**. `app/index.html` loads `app/app.js` as
  `type="module"`; every other `app/*.js` file is imported directly by path.
  Supabase JS and Chart.js are loaded from CDN `<script>` tags in
  `index.html`, not npm packages - **there is no `package.json` and none
  should be added** unless the no-build-step approach is being deliberately
  abandoned (it isn't, by design - see README §1.4/§2.2 for the $0/no-card
  constraint this supports).
- **Backend**: Supabase (Postgres + Auth + Row-Level Security). Every table
  is per-user isolated via RLS - this is a hard product requirement, not
  incidental.
- **Auth**: Supabase magic-link email only. No password field exists
  anywhere in the app; don't add one, and don't enable phone/SMS auth
  (costs money).
- **Hosting**: Cloudflare Workers (`wrangler.jsonc`, static assets from
  `./app`), GitHub-connected, auto-deploys on push to `main`.
- **Optional enrichment services** (both dormant unless configured, app
  works fully without them):
  - `app/gemma.js` - natural-language expense parsing + Q&A, talks to a
    Gemma model over `GEMMA_ENDPOINT` (unset by default).
  - `tools/deal-agent.js` + `tools/searxng/` - F6 live subscription-deal
    discovery, runs on a separate "server machine," writes to
    `deal_findings` (see `docs/F6-live-deals-proposal.md`).
  - `tools/monthly-report.js` - generates natural-language monthly reports
    server-side, writes to `spending_insights`.

## Build, Run, Test & Lint Commands

There is no build step, no package manager, no linter, and no automated
test suite in this repo. Do not introduce one speculatively.

- **Run locally**:
  ```bash
  cd app && python3 -m http.server 8000
  ```
  Open `http://localhost:8000`. Requires `app/config.js` to exist (copy
  from `app/config.example.js` and fill in your own Supabase project's URL
  + publishable key - `app/config.js` is gitignored, never commit it).
- **Syntax-check a JS file** (no compiler/bundler to catch errors otherwise):
  ```bash
  node --check app/app.js
  ```
  If `node` isn't on PATH in the working environment, verify via dynamic
  `import()` in the browser instead (see "Verifying changes" below).
- **Mock the Gemma endpoint** for local testing without a real model:
  ```bash
  node tools/mock-gemma-server.js   # listens on http://localhost:11434
  ```
- **Deploy**: push to `main`. Cloudflare Workers auto-builds and deploys.
  There is no separate manual deploy command in normal use.
- **Database migrations**: apply via the Supabase MCP tools
  (`apply_migration` against the live project), then **always** write the
  same SQL to a new sequentially-numbered file in `supabase/` (`16_*.sql`,
  `17_*.sql`, ...). The numbered files are the source of truth for schema
  history and must stay in sync with what's actually applied live - never
  let them drift.

### Verifying changes (since there's no test suite)

- **Syntax**: `node --check`, or dynamically `import()` the module in the
  browser console and confirm it resolves without throwing.
- **Logic**: for anything with real edge cases (date math, matching
  heuristics, multi-step financial calculations), port the function into an
  isolated script/browser snippet and test it directly against constructed
  inputs *before* wiring it into the UI - this has caught real bugs in this
  repo (a date-overflow bug in subscription renewal math, an overly-loose
  bank-name-matching bug) that reading the code alone did not surface.
- **UI**: exercise the actual page in a browser and take a screenshot/read
  the accessibility tree to confirm the DOM matches intent. Auth is
  magic-link email, so an agent typically cannot complete a real sign-in -
  work around this by force-unhiding the relevant view
  (`document.getElementById(...).classList.remove('hidden')`) and injecting
  representative mock data via `javascript_exec`, rather than skipping
  verification.
- **Data-shape questions** (e.g. "does this SQL migration actually work",
  "is this account's data in the state I think it's in"): query the live
  Supabase project directly via the MCP `execute_sql` tool rather than
  guessing from code alone.

## Architecture & Code Style Guidelines

### The core data model - internalize this before touching account/asset/liability code

Three related-but-distinct concepts, a recurring source of confusion:

| Table | Question it answers | Counted in net worth? |
|---|---|---|
| `accounts` | "How did I pay for this?" (payment method tag) | No |
| `assets` | "What do I own?" | Yes |
| `liabilities` | "What do I owe?" (tracked debts) | Yes |

- An `account` optionally links to *one* of `assets.linked_asset_id` or
  `liabilities.linked_liability_id`, never both.
- `account.bank_name` is a separate concept from `account.name`: `bank_name`
  is which institution (Chase, Discover) - purely a display/grouping label.
  `name` is what you call the account (Checking, Savings, Credit) - derived
  from the selected account type, not free-typed. Neither is the thing that
  tracks a dollar value; that's the linked asset/liability.
- `checking`/`debit`/`savings` account types auto-create + link a `bank`- or
  `savings`-type asset ($0, edited after). `credit` auto-creates + links a
  `credit_card` liability. `cash` is **not creatable manually at all** -
  exactly one `Cash` account + linked `Cash` asset exists per user,
  auto-created on app load (`ensureCashAccount()`), enforced by a partial
  unique index.
- A credit account's owed balance **only** moves through real, dated credit
  expenses (`applyLiabilityDelta` in `app.js`) - never a manually-typed
  number. This is deliberate, confirmed by the user, and applies to every
  credit-account-linked liability now and in the future. A *standalone*
  liability (Loan/Mortgage/Other, added directly in the Liabilities card,
  no linked account) is the exception - it has no purchase trail to
  reconcile against, so it keeps manual "Owed" editing (direct set + add-a-
  charge). Don't reintroduce manual owed-editing for a credit-linked
  liability without it being an explicit, confirmed decision.
- Net worth (`app/networth.js`) is `assetsTotal - liabilitiesTotal`, where
  `liabilitiesTotal` is tracked-debt balance *only*. Subscriptions (a
  recurring cost) and general expense totals (debit/cash spending already
  reduces an asset directly via `applyAssetDelta`) are not liabilities and
  must not be folded into that number - this was tried, reverted, and
  re-argued more than once; don't re-litigate it without a reason.
- No account, asset, or liability balance may ever go negative through any
  manual UI path - block with an error toast (`assetDeltaError` /
  equivalent checks), never silently floor at $0 and never allow it through.

### JS style

- Vanilla ES modules, no transpilation. `app/app.js` is the single
  event-wiring/DOM entry point; the other `app/*.js` files are pure(ish)
  logic modules imported by it (`categorize.js`, `charts.js`,
  `subscriptions.js`, `networth.js`, `discounts.js`, `gemma.js`,
  `insights.js`) - keep that separation; don't put DOM/`sb.from(...)` calls
  into the logic modules.
- `const $ = (id) => document.getElementById(id)` is the only DOM helper;
  follow that pattern rather than introducing a different one.
- Default to **no comments**. Only comment the non-obvious *why* (a hidden
  constraint, a past bug, a deliberate decision that looks like it could be
  "simplified" but shouldn't be) - never restate *what* the code does.
- No em dashes anywhere in code, comments, docs, or UI strings (swept clean
  once, ~186 occurrences across 29 files, per explicit user preference) -
  use a hyphen or restructure the sentence instead.
- Prefer editing/extending existing helpers over adding new abstractions.
  Several features in this repo (Savings account type, the negative-balance
  guard) required zero new code paths because earlier work was written
  generically off data (`AUTO_ASSET_TYPE[type]`) rather than hardcoded to
  one case - keep extending in that style.

### SQL style (`supabase/*.sql`)

- One numbered file per migration, applied in order, never edited after the
  fact once applied live - add a new numbered file instead.
- RLS policy on every user-owned table: `using (auth.uid() = user_id) with
  check (auth.uid() = user_id)` (or `= id` for `profiles`). Any new table
  holding user data needs this from the start, not bolted on later.
- Prefer a DB trigger over app-code cleanup for cascade behavior that must
  hold regardless of which client makes the change (see
  `12_delete_liability_with_account.sql`, `13_delete_asset_with_account.sql`
  - deleting an account deletes its linked asset/liability, enforced in the
  database, not just in `app.js`).
- Pin `search_path` on any new `plpgsql` function
  (`language plpgsql set search_path = public`) - a bare function without
  it trips the Supabase linter's `function_search_path_mutable` warning.

## Repository Constraints & Workflow Rules

- **Never put a Supabase `service_role`/secret key in `app/`.** It bypasses
  RLS entirely. It belongs only in `tools/` scripts, read from a gitignored
  env file (`tools/.env.deal-agent`, not committed) - checked repeatedly,
  keep it that way.
- **`app/config.js` is gitignored and must never be committed.** It holds
  the (safe-to-expose) Supabase publishable key for local dev; production
  gets its own copy generated from env vars at deploy time
  (`tools/generate-config.js`).
- **The service worker (`app/sw.js`) must not force-reload the page.** A
  past bug had `skipWaiting()` + `clients.claim()` silently reloading the
  page ~150-300ms after every load and after every later deploy, which
  looked like unrelated feature bugs (a payment appearing to "not go
  through") and was hard to root-cause. Reloads must stay gated behind the
  user tapping the existing "Update available" toast.
- **PWA/service-worker caching means a deployed fix may not be visible
  immediately** in an already-open tab - don't assume "I pushed it" equals
  "the user can see it right now" without a hard refresh or the update
  toast.
- **This is real personal financial data for a live user**, not a sandbox.
  Prefer additive, reversible changes; when a data correction is genuinely
  needed (fixing a bad row after a bug), do it via a direct, verified
  `execute_sql` query and say plainly what was changed - don't silently
  mutate data as a side effect of a code fix.
- **Don't reintroduce em dashes, a `package.json`/bundler, a manual
  owed-balance editor for credit-linked liabilities, or a merge of
  Accounts/Assets/Liabilities into one concept** - all were deliberate,
  revisited decisions (see above).
- **Commit only when explicitly asked**, using the repo's existing style:
  a descriptive subject line, then a body explaining *why* (root cause,
  what was verified, what tradeoff was made) rather than a bullet list of
  *what* changed - look at recent `git log` output for the tone to match.
- **`docs/SESSION-NOTES.md` is a living handoff doc, not an archive.**
  Update or replace it at the start/end of a session rather than letting it
  drift stale; it is explicitly not meant to accumulate forever.
