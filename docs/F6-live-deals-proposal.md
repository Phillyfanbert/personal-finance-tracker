# F6 Stretch Goal — Live Deal Discovery: Feasibility & Design Proposal

*Status: exploration / design only. No app changes are made by this document —
it proposes a schema and architecture for a future phase.*

## 1. The question

F6 v1 (already shipped) matches a user's subscriptions and profile against a
**curated** `subscription_catalog` and surfaces savings. The stretch goal is a
**live web-search agent** that hunts real, current deals on the open web instead
of relying on hand-entered catalog data. The README explicitly warns this is the
hard part: "live discount data is scattered and unreliable, and doing it robustly
at scale can require paid APIs." That last clause collides head-on with the
project's two hard constraints — **$0 total cost** and **no credit card anywhere**
— so the first job of this exploration is to establish what is even possible
under those constraints before designing anything.

## 2. Feasibility verdict

**It is feasible at $0 with no card — but only via a self-hosted search engine on
the home machine, not a managed search API.** The managed APIs that would be the
obvious choice have, as of 2026, moved behind a credit card or closed to new
signups. The path that survives the constraints is running **SearXNG** (a free,
open-source metasearch engine) on the same machine that already hosts Gemma, and
letting Gemma extract structured deals from the pages it finds. This also happens
to be the most privacy-preserving option, which matters for a finance app.

## 3. Options considered (ranked)

| Approach | $0? | No card? | Reliability | Verdict |
|---|---|---|---|---|
| **SearXNG (self-hosted metasearch)** | Yes — runs on your hardware | Yes | Medium (depends on upstream engines; you control it) | **Recommended.** No key, no quota, JSON API, private. |
| DuckDuckGo unofficial HTML endpoint | Yes | Yes | Low — unofficial, ~10 results, CAPTCHAs / blocks under automation, page-structure fragile | Fallback only. |
| Curated catalog + manual updates (F6 v1, today) | Yes | Yes | High (you verify it) | Keep as the trusted baseline. |
| Google Programmable Search / Custom Search JSON API | Free 100/day, no billing needed | Historically yes | High | **Unavailable** — closed to new customers; existing users must migrate by Jan 1 2027. |
| Brave Search API | No longer free | **No — card now required** | High | **Rejected** — violates the no-card rule. |
| Other metered APIs (Serp/Firecrawl/Tavily/etc.) | Small free tiers, then metered | Usually card-gated | High | Rejected — cost/card risk. |

The takeaway from the current landscape: **every managed option is now either
card-gated or being retired**, and the only "free-forever, no-key" options are
DuckDuckGo's fragile unofficial endpoint and self-hosted SearXNG. SearXNG wins
because it has a real JSON API, no rate limits you don't impose yourself, and it
runs beside the infrastructure you already stood up for Phase 3.

## 4. Why SearXNG fits this project specifically

You already run a home machine with **Ollama + Gemma** exposed through a
**Cloudflare Tunnel** (Phase 3). Adding SearXNG is one more container on that same
box — no new hosting bill, no new account, no card. It exposes
`/search?q=...&format=json` returning `{title, url, content, engine}` per result
once the JSON format is enabled in `settings.yaml`. Because the search runs on
your own machine, **no query about the user's subscriptions is ever sent to a
third-party API tied to their identity** — consistent with the privacy posture of
the rest of the app.

## 5. Architecture

```
┌──────────────────────────── Home machine (already yours) ─────────────────────────────┐
│                                                                                        │
│   ┌──────────┐   generic service queries    ┌──────────┐   page text    ┌──────────┐  │
│   │  Agent   │ ───────────────────────────▶ │ SearXNG  │ ─────────────▶ │  fetch   │  │
│   │ (cron)   │   "Spotify student price"     │  :8080   │   top N urls   │  pages   │  │
│   │          │ ◀─── JSON results ─────────── │          │                └────┬─────┘  │
│   │          │                                                                 │ text  │
│   │          │            strict-JSON extract (reuse Phase 3 prompt)          ▼        │
│   │          │ ──────────────────────────────────────────────────────▶ ┌──────────┐  │
│   │          │ ◀── {plan_type,price,eligibility,url,confidence} ──────── │  Gemma   │  │
│   └────┬─────┘                                                           └──────────┘  │
│        │ write via SERVICE_ROLE key (server-side only)                                 │
└────────┼───────────────────────────────────────────────────────────────────────────── ┘
         ▼
   ┌───────────────────────────┐        read (anon key, RLS)        ┌──────────────────┐
   │ Supabase: deal_findings   │ ◀──────────────────────────────── │  PWA (Savings)   │
   │ (machine-found, low trust)│                                    │  clearly labeled │
   └───────────────────────────┘                                    └──────────────────┘
```

The agent loops over a **watchlist of service names** (drawn from
`subscription_catalog`, which is generic reference data — not user rows — so the
agent never needs to read anyone's personal subscriptions). For each service it
queries SearXNG, fetches a small number of likely-official result pages, and asks
Gemma to extract a structured deal as strict JSON (the exact pattern already built
and tested in `app/gemma.js`). Validated results are written to a new
`deal_findings` table using the **`service_role`** key, which is confined to the
home machine and never ships in the PWA. The app reads `deal_findings` with the
anon key under RLS and shows them in a **separate, clearly-labeled** part of the
Savings card — never mixed into the trusted curated results.

## 6. Data model — `deal_findings` (separate trust tier)

Per the decision to keep `subscription_catalog` hand-verified, machine-found deals
go in their own table. This preserves a clean trust boundary: curated = trusted;
findings = candidate until a human promotes them.

```sql
-- Proposed migration 04_deal_findings.sql (NOT yet applied)
create table deal_findings (
  id            uuid primary key default gen_random_uuid(),
  service       text not null,                 -- 'Spotify'
  plan_type     text,                          -- 'student'|'annual'|'family'|'individual'
  price         numeric(12,2),
  currency      text default 'USD',
  eligibility   text,                          -- 'verified student', ...
  url           text,                          -- source page (provenance)
  source_query  text,                          -- the search query used
  raw_snippet   text,                          -- text the price came from (for human review)
  confidence    numeric(3,2),                  -- 0..1 from the extractor
  extracted_by  text default 'gemma',
  status        text check (status in ('candidate','verified','rejected')) default 'candidate',
  found_at      timestamptz default now(),
  expires_at    timestamptz default (now() + interval '14 days')  -- findings age out
);
create index on deal_findings (service, status);

-- Shared reference data written ONLY by the home agent (service_role bypasses RLS).
alter table deal_findings enable row level security;
create policy "read deal_findings" on deal_findings
  for select using (auth.role() = 'authenticated' and status <> 'rejected');
-- No insert/update/delete policy → the anon/PWA client can never write.
```

Notes on the design choices:

- **No `user_id`.** A deal ("Spotify student = $5.99") is a public fact, not
  personal data, so the table is shared reference like `subscription_catalog`.
  Matching to a user still happens client-side against their own subscriptions,
  so nothing personal leaves the device to obtain a finding.
- **`expires_at`** enforces staleness — prices drift, so findings self-expire and
  the agent refreshes them on a schedule. A cleanup query (or a `where expires_at
  > now()` filter in the app) hides stale rows.
- **`status`** gives a promotion path: a human can review a `candidate`, mark it
  `verified`, and optionally copy it into `subscription_catalog` as trusted data.
- **`raw_snippet` + `url`** keep provenance so a suggestion can always be traced
  back and manually checked — essential given the "unreliable data" warning.

## 7. How the app would surface findings

The existing `discounts.js` matcher stays the source of trusted savings. Live
findings appear in a visually distinct block under the Savings card — e.g.
"🌐 Found online (unverified — tap to check source)" — each linking to its source
URL and showing the snippet. They are **never** auto-applied or blended into the
curated numbers. A future review screen lets the user promote a good finding into
the curated catalog, at which point it becomes a normal trusted deal.

## 8. Robustness & risk mitigations

The README's core worry is reliability; these are the levers that make it tolerable:

- **Official-domain allowlist per service** (e.g. only trust `spotify.com`,
  `adobe.com` for their own pricing) to cut noise and spoofed "deal" spam.
- **Confidence threshold + human-in-the-loop**: low-confidence extractions stay
  hidden or clearly flagged; nothing is trusted without the snippet + link.
- **Strict-JSON extraction reuse**: the validated Gemma contract from Phase 3
  (`validateParsed`) already rejects malformed or amount-less output.
- **Politeness / legality**: run weekly (not continuously), fetch a small number
  of pages, respect `robots.txt`, and prefer official pricing pages for personal
  use. Avoid heavy scraping and anything a site's ToS forbids.
- **Off by default, opt-in**: the whole feature is dormant unless the home agent
  is configured — mirroring how Phase 3 Gemma is optional and non-blocking.

## 9. Phased plan

| Phase | Work | Depends on |
|---|---|---|
| **A** | Add `04_deal_findings.sql` migration + RLS; app reads and renders an (empty) "found online" section behind a flag | none (pure app/db) |
| **B** | Stand up SearXNG on the home machine (one Docker container beside Ollama + cloudflared); enable JSON format | home machine |
| **C** | Build the agent: SearXNG query → fetch allowlisted pages → Gemma extract → validate → write via `service_role`. Run manually | A + B + Phase 3 Gemma |
| **D** | Schedule weekly (systemd timer / cron) + expiry cleanup | C |
| **E** | Review/promote UI: user verifies a finding → copy into `subscription_catalog` | A–D |

## 10. Cost & no-card check (stretch goal)

| Component | Free tier | Credit card? |
|---|---|---|
| SearXNG (self-hosted metasearch) | Yes — your hardware | No |
| Gemma via Ollama (extraction) | Yes — your hardware | No |
| Cloudflare Tunnel (already up) | Yes | No |
| Supabase `deal_findings` | Yes (within existing project) | No |
| Managed search APIs (Brave/Google/etc.) | — | **Would require a card / unavailable — deliberately NOT used** |

**Conclusion:** the stretch goal is achievable within the project's hard
constraints *only* by self-hosting search on the home machine. It should remain a
later, opt-in phase layered on top of the solid curated-catalog F6 that already
ships — exactly the sequencing the README recommends.

---

## Sources

- [Brave Search API — free tier removed, card now required (implicator.ai)](https://www.implicator.ai/brave-drops-free-search-api-tier-puts-all-developers-on-metered-billing/)
- [Brave Search API official](https://brave.com/search/api/)
- [Google Custom Search JSON API overview — 100 queries/day free, not available for new customers](https://developers.google.com/custom-search/v1/overview)
- [SearXNG Search API documentation (JSON format)](https://docs.searxng.org/dev/search_api.html)
- [SearXNG project (GitHub) — free, no API key, self-hosted](https://github.com/searxng/searxng)
- [How to use SearXNG as a private search API](https://nolowiz.com/how-to-use-searxng-as-a-private-search-api-step-by-step-guide/)
