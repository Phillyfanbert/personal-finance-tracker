#!/usr/bin/env node
// ============================================================================
// Live asset price agent (docs/ROADMAP.md Assets #4). Same architecture as
// tools/deal-agent.js (F6), reused rather than duplicated conceptually -
// runs on the SERVER MACHINE ONLY, needs the Supabase SERVICE_ROLE key -
// keep that out of the repo (env var only).
//
// Three providers, not local Ollama, deliberately and not as a fallback
// alongside it. This script only ever handles public market data (a
// ticker symbol's price, a market index level) - never a specific user's
// personal financial data - so it doesn't need to stay on the home-hosted
// model the way app/gemma.js's real expense/Q&A paths must. See CLAUDE.md's
// data model section for the durable version of this privacy boundary -
// which scripts may use a cloud service and which must never.
//
// Real stock-ticker quotes (a user's own asset watchlist,
// the movers watchlist) go straight to Finnhub - a plain GET returning
// the price directly as JSON, no search or LLM step needed at all
// (fetchFinnhubQuote()/fetchFinnhubFinding() below). MARKET_INDEXES
// stays on Tavily+Gemini instead (see the comment above the
// FINNHUB_API_KEY constant for why - Finnhub's free-tier index access is
// unconfirmed).
//
// **Gemini's free tier caps at 20 requests/DAY, confirmed live 2026-08-15
// via the account's own AI Studio rate-limit dashboard - the same 20 RPD
// ceiling across every viable free-tier text model (2.5 Flash, 3 Flash,
// 3.7 Flash all identical; 2.5 Flash Lite only raises the per-minute cap,
// not the daily one; 2.5 Pro shows 0/0, no free quota at all).** This is
// far tighter than the original design assumed - a single run wanted up to
// ~34 Gemini calls (one per symbol for "why did it move," plus 8 for
// per-index price extraction), 70% over the entire daily budget in one
// run alone, before deal-agent.js's own ~10 calls/run even touches the
// same shared key. No amount of retry/backoff fixes an exhausted DAILY
// quota - that's not a transient rate limit, so the fix had to cut call
// COUNT. Two things landed, in order, the second correcting a real
// shortcoming found live in the first:
//   1. Tried taking findExplanation() off Gemini entirely, using a Tavily
//      search result's own `content` field directly instead of asking
//      Gemini to synthesize it. This cut calls dramatically, but live
//      testing (three separate DRY_RUN passes, tuning the approach each
//      time) found the results unreliable: a generic "{symbol} stock price
//      today" search mostly surfaces a finance site's own quote-page
//      dashboard ("arrow_upward", "show_chartLine area_chartArea
//      candlestick_chartCandle") or a data comparison table, not
//      narrative - no amount of domain-narrowing or content-pattern
//      filtering reliably told those apart from genuine article content
//      the way Gemini's own judgment already did. Reverted.
//   2. Kept Gemini for findExplanation(), but stopped calling it
//      unconditionally for all 20 fixed movers-watchlist symbols every
//      run - MAX_GEMINI_EXPLANATIONS_PER_RUN caps it to the biggest
//      movers by day change (Finnhub's own `dp` field, already part of
//      the same quote call - no extra request needed to rank by it). A
//      stock that barely moved usually has no "why" story worth finding
//      anyway, so this targets Gemini's real judgment at the cases where
//      an explanation is actually likely to exist, rather than spending
//      calls uniformly across symbols regardless of whether they moved.
//      MARKET_INDEXES price extraction (processAllIndexes()) also batches
//      all 4 indexes into ONE Gemini call instead of 8 (2 query angles x
//      4 indexes) - still runs all 8 Tavily searches as before (Tavily
//      isn't the constraint, its free tier is 1,000 credits/month), just
//      consolidates the EXTRACTION step into one prompt with every
//      index's sources labeled.
// Net result: roughly 1 (batched index price) + up to 4 (index
// explanations) + 1 (the user's own watchlist, small/personal) +
// MAX_GEMINI_EXPLANATIONS_PER_RUN (movers) + 1 (news digest) Gemini
// calls/run - a real, bounded number instead of ~34, with margin left for
// deal-agent.js's own ~10/run sharing the same key. See main()'s own
// scheduling comment below for the actual worst-case total.
//
// Two providers, not one, and this is a deliberate reversal of an earlier
// version of this script that used Gemini's own Google Search grounding
// tool for both search and extraction in a single call. That was dropped
// after live testing (see docs/SESSION-NOTES.md) found grounding requires
// a billing account linked to the Google Cloud project to get ANY quota at
// all - even the portion Google's own docs describe as a free monthly
// allowance - which conflicts with this project's hard $0/no-card
// constraint. Splitting the two concerns instead: Tavily does real live
// search (confirmed free tier, no card required to sign up -
// docs.tavily.com), and Gemini's plain generateContent (confirmed live,
// this session, to work with no billing account at all) only ever reasons
// over the real search-result content Tavily already fetched - never its
// own general knowledge.
//
// What it does, per distinct assets.price_symbol in use across all users
// (a symbol's price is a public fact, not user-specific - same reasoning
// deal_findings already uses for service prices):
//   1. Fetch the current price directly from Finnhub (fetchFinnhubFinding()).
//      No search, no LLM extraction, no domain-trust filtering needed - this
//      is a direct, authoritative numeric API response, not scraped text a
//      model has to read.
//   2. One more best-effort step, still Tavily+Gemini: ask for a short
//      neutral explanation of why the price moved today (findExplanation(),
//      TRUSTED_NEWS_DOMAINS). One attempt per symbol per run, not per
//      price-finding row. Failure here never blocks the price write itself;
//      explanation just stays null. Called unconditionally for a user's own
//      watchlist symbols (small, personal - see MAX_GEMINI_EXPLANATIONS_PER_RUN's
//      own comment), and only for the biggest movers among
//      the movers watchlist below.
//   2b. Real per-symbol news headlines (fetchFinnhubCompanyNews(), added
//      2026-08-16) - Finnhub's own /company-news product, zero LLM step,
//      gated to roughly once/hour per symbol (shouldFetchNewsThisRun())
//      rather than every FAST_ONLY run, since the findings tables are
//      insert-only and headlines don't meaningfully change inside 15
//      minutes. This is what makes the Investments tab's "why is this
//      moving" context genuinely live (real links, refreshed hourly)
//      instead of only the weekly Gemini explanation above.
//   3. Write validated findings to asset_price_findings via the REST API
//      using the service_role key (bypasses RLS by design).
//
// MARKET_INDEXES follows a separate Tavily+Gemini pipeline instead
// (processAllIndexes() - see the FINNHUB_API_KEY comment above for why):
//   1. For each index, for each of a few query angles, search Tavily for
//      real, current web results.
//   2. Filter those results down to ones on TRUSTED_PRICE_DOMAINS BEFORE
//      Gemini ever sees them - the same "never trust an unverified source"
//      posture docs/F6-live-deals-proposal.md's Option C established,
//      applied as a pre-filter here (Tavily returns real result URLs
//      directly, unlike a grounding tool's internal search).
//   3. ONE Gemini call, covering every index that found at least one
//      trusted source, extracts strict JSON price data for all of them at
//      once ONLY from the real, trusted-domain content just fetched -
//      explicitly instructed not to draw on anything else, and not to mix
//      sources between indexes.
//   4. Same explanation step as above, per index (all 4, unconditionally -
//      a small, fixed list).
//   5. Write validated findings to market_index_findings via the REST API.
//
// the movers watchlist (a curated large-cap stock list, Investments
// tab's "Today's top movers") follows the Finnhub pipeline above, same as
// a user's own asset watchlist - real tickers, not index names - just
// writing to market_index_findings alongside the indexes instead of
// asset_price_findings. Unlike the user's own watchlist, this one only
// gets a Gemini explanation for its biggest movers by day change - see
// MAX_GEMINI_EXPLANATIONS_PER_RUN's own comment.
//
// One more step, also genuinely NOT tied to any user or symbol: a single
// daily search+extract for general market news, producing up to 5
// headlines plus an overall sentiment read (bullish/neutral/bearish) with
// a one-line grounded reason - written to market_news_findings. This is a
// summary of what real news coverage says that day, never a prediction or
// a recommendation to buy/sell anything - enforced in the extraction
// prompt itself, not just the UI copy (see findNewsDigest() below).
//
// Setup (on the server machine):
//   Shares tools/.env.deal-agent (same env vars, see that file's header) -
//   no separate env file needed. Run directly:
//   node tools/price-agent.js            # writes findings
//   DRY_RUN=1 node tools/price-agent.js  # prints what it would write, no DB writes
//   Or via tools/run-price-agent.sh, a thin env-loading wrapper - no
//   SearXNG/Docker step, this script doesn't need either.
//
// Scheduling: TWO separate cadences, not one, since 2026-08-16 -
// tools/setup-server-machine.sh installs both. A plain, unattended
// unattended run of this script (via run-price-agent.sh) is still the
// weekly com.price-agent.weekly job, same cadence as deal-agent.js, and
// does everything described above. Separately, FAST_ONLY=1 (set by
// run-price-agent-fast.sh, installed as com.price-agent.fast on a much
// tighter interval - 15 minutes by default) skips every Tavily/Gemini-
// backed step entirely (processAllIndexes(), every findExplanation() call,
// findNewsDigest()) and runs ONLY the two pure-Finnhub loops (a user's own
// watchlist and the movers watchlist). This split exists because the
// two halves of this script have wildly different budget headroom: the
// Finnhub legs cost nothing extra to run often (60 calls/min free, NO
// daily cap - a full FAST_ONLY run uses ~21 calls total, so even a
// 15-minute cadence is nowhere near the ceiling), while the Tavily/Gemini
// legs are genuinely constrained (Gemini's real 20 requests/DAY free
// limit, shared with deal-agent.js). There's no reason real ticker prices
// should wait a week to refresh just because market indexes and
// explanation text do. FAST_ONLY writes to agent_run_status under a
// SEPARATE agent name ("price-agent-fast", see writeRunStatus() below) so
// a fast run's own status never clobbers the full weekly run's - the
// weekly run's agent_run_status row needs to keep accurately reflecting
// Tavily/Gemini pipeline health specifically, which FAST_ONLY never
// touches at all.
//
// Tavily/Gemini call volume, weekly full run (unchanged by the split
// above - FAST_ONLY runs don't touch either budget at all): up to ~34
// Tavily calls worst case per run (4 indexes x 2 price angles + 1
// explanation call each for the 1 user-owned asset symbol, the 20 fixed
// movers, and the 4 indexes, plus 1 fixed call/run for the news digest).
// Combined monthly Tavily usage (this script + deal-agent.js's own
// ~10/run) on the weekly schedule comes out around 190/month even in the
// worst case - comfortably under Tavily's free 1,000/month, with real
// margin for the movers watchlist or a user's own asset list growing
// later. Gemini calls/run, worst case: 1 (batched index price) + 4 (index
// explanations) + 1 (user watchlist, today's size) + 5
// (MAX_GEMINI_EXPLANATIONS_PER_RUN movers) + 1 (news digest) = 12 -
// combined with deal-agent.js's own ~10/run, this is real, worst-case-both-
// maxed territory around 22, not comfortably clear of 20/day the way
// Tavily's monthly math is. That's an accepted tradeoff, not an oversight:
// both scripts already treat an individual Gemini failure as non-fatal
// (log a warning, skip that one explanation/price, keep going) - a run
// hitting the ceiling on a busy day degrades gracefully to fewer
// explanations, it doesn't break. MAX_TAVILY_CALLS_PER_RUN/
// MAX_FINNHUB_CALLS_PER_RUN/MAX_GEMINI_EXPLANATIONS_PER_RUN below are the
// levers if this ever needs tightening further - reduce
// MAX_GEMINI_EXPLANATIONS_PER_RUN first, it's the biggest single lever on
// the Gemini total. If the WEEKLY run's own interval ever needs to
// tighten (not the already-fast FAST_ONLY legs), redo this math first -
// don't just switch the plist.
//
// Finnhub call volume, FAST_ONLY run: 1 user asset + 20 movers = up to 21,
// at a 15-minute cadence (96 runs/day) that's roughly 2,000 Finnhub
// calls/day worst case - still trivially inside 60/min free with no daily
// cap, since they're a short burst every 15 minutes, not sustained
// traffic. No market-hours gating - Finnhub returns the correct last-
// known/previous-close price off-hours anyway, so an off-hours run isn't
// wasted, it just doesn't change.
// ============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = !!process.env.DRY_RUN;
// See the header comment's "Scheduling" section for the full rationale -
// top-level (not inside main()) since writeRunStatus() below also needs
// to branch on it for which agent_run_status row to write to.
const FAST_ONLY = !!process.env.FAST_ONLY;
// Sibling mode to FAST_ONLY, same reasoning for living at top level.
// RECAP_ONLY=1 is the DAILY job (weekdays after the close, own
// agent_run_status row). Three steps, in decreasing order of guarantee:
//   1. The stored daily recap (55_daily_recaps.sql) - still zero outbound
//      calls, built purely from what the other modes already wrote
//      (daily_prices + the headlines on the findings tables). This is the
//      part that can never be rate-limited, and that property is the whole
//      design; don't give it up.
//   2. The market news digest - free Finnhub headlines, plus one optional
//      Gemini sentiment call that degrades to headlines-only.
//   3. A fundamentals refresh - skipped entirely if the API tier turns out
//      not to cover it.
const RECAP_ONLY = !!process.env.RECAP_ONLY;

// Tavily - real web search, confirmed free tier (1,000 credits/month, no
// credit card to sign up) as of this writing. https://tavily.com
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const TAVILY_URL = "https://api.tavily.com/search";

// Gemini - plain generateContent, no tools. Deliberately NOT the Google
// Search grounding tool (see header comment above for why) and
// deliberately NOT a hardcoded version number as the default - a
// hardcoded "gemini-2.5-flash" default here was live-broken within days of
// being written ("no longer available to new users"), so gemini-flash-
// latest (a stable rotating alias, not an experimental/-preview tag) is
// the more robust default for an unattended job going forward. Override
// via GEMINI_MODEL to pin a specific version if you want that instead. Key
// must still be created with NO billing account attached - confirmed live
// that plain generateContent works fine on a no-billing key.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
function geminiUrl(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

// Finnhub - real-time US stock quotes, confirmed free tier (60 calls/min,
// no credit card) as of this writing. https://finnhub.io/register - a
// plain GET returning the price directly as JSON, no search step and no
// LLM extraction needed, so this replaces Tavily+Gemini for real stock-
// ticker lookups specifically (the user's own asset watchlist and
// the movers watchlist below). Deliberately NOT used for MARKET_INDEXES
// - Finnhub's index data has been reported moved behind a paid tier at
// some point, genuinely unconfirmed either way from public sources, so
// indexes stay on the already-verified Tavily+Gemini pipeline rather than
// risk the same "assumed free, actually needs billing" mistake that
// already happened once this session with Gemini's own grounding tool.
// Alpha Vantage - the ONLY provider here that answers "what moved most
// today" rather than "what is the price of X". Free key, no card
// (verified live against their own demo key). 25 requests/day on the free
// tier and this uses exactly ONE, so the limit is irrelevant.
//
// OPTIONAL: unset, the movers pipeline is skipped entirely and every other
// part of this script is unaffected - same dormant-until-configured shape
// as GEMMA_ENDPOINT. requireEnv() deliberately does not demand it.
const ALPHA_VANTAGE_API_KEY = process.env.ALPHA_VANTAGE_API_KEY;
const ALPHA_VANTAGE_URL = "https://www.alphavantage.co/query";
// Top 5 each way. The API returns 20, but this card is for a beginner
// glancing at the day, not a screener.
const MOVERS_PER_CATEGORY = 5;

// Quality floor, applied to all 20 BEFORE trimming to 5 - filtering after
// the slice would have left the card mostly empty instead of finding real
// candidates further down the list.
//
// The first live run made the need obvious: 6 of 10 movers were WARRANTS
// (RCKTW at $0.0017, RNWWW at $0.0005, ...), which are not stocks, have no
// company profile, carry no news, and trade in fractions of a cent where a
// single tick is a "+112%" move. Showing those to someone who has never
// invested is worse than showing nothing - it misrepresents what a big
// move even means.
const MIN_MOVER_PRICE = 1;
const MIN_MOVER_VOLUME = 50000;

// A 5-character US ticker ending in W, U or R is a warrant, unit or rights
// issue rather than common stock - a real, standardised suffix convention,
// not a guess at what looks junky.
const isDerivativeTicker = (symbol) => symbol.length === 5 && /[WUR]$/.test(symbol);

// Excluded for a stated reason, or null if it belongs on the card.
function moverRejectReason(m) {
  if (isDerivativeTicker(m.symbol)) return "warrant/unit/rights, not common stock";
  if (m.price == null || m.price < MIN_MOVER_PRICE) return `price under $${MIN_MOVER_PRICE}`;
  if (m.volume == null || m.volume < MIN_MOVER_VOLUME) return "too thinly traded";
  return null;
}

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const FINNHUB_URL = "https://finnhub.io/api/v1/quote";
// Real per-symbol headlines - confirmed live (2026-08-16) on Finnhub's free
// tier, real structured {headline, url, source, datetime, summary} JSON,
// zero LLM step needed. Strictly more grounded than the Gemini-authored
// explanation field below (real links, no synthesis) - see
// shouldFetchNewsThisRun()/fetchFinnhubCompanyNews() for how this feeds
// the new asset_price_findings/market_index_findings.headlines column.
const FINNHUB_NEWS_URL = "https://finnhub.io/api/v1/company-news";

// A small, deliberately conservative allowlist - reputable finance-data
// sources only, not "anything a search happens to turn up." Extend this
// list rather than removing the allowlist entirely if a legitimate source
// keeps getting filtered out.
const TRUSTED_PRICE_DOMAINS = [
  "finance.yahoo.com",
  "marketwatch.com",
  "google.com",
  "coinmarketcap.com",
  "coingecko.com",
  "morningstar.com",
  "nasdaq.com",
];

// Superset of the price domains, plus a couple of dedicated news outlets -
// a "why did this move" explanation benefits from an actual news article,
// which a pure price-quote page usually doesn't have.
const TRUSTED_NEWS_DOMAINS = [...TRUSTED_PRICE_DOMAINS, "reuters.com", "cnbc.com"];

const FETCH_TIMEOUT_MS = 8000;      // Supabase REST calls
const SEARCH_TIMEOUT_MS = 15000;    // Tavily search
const GEMINI_TIMEOUT_MS = 30000;    // extraction over already-fetched content
const REQUEST_DELAY_MS = 1200;      // spacing between calls - raised from 500ms after a live
                                     // test run hit a real Gemini 429 mid-run at that spacing
const RESULTS_PER_QUERY = 5;        // Tavily max_results per search
const MAX_429_RETRIES = 2;          // per call, exponential backoff (3s, 6s)

// Hard safety cap on Tavily calls in a single run - not because current
// watchlist sizes are actually close to the free tier's 1,000
// credits/month (they aren't: this script + deal-agent.js together run
// well under 400/month at current sizes on the weekly launchd schedule
// setup-server-machine.sh installs - see the real math in this file's
// header), but because nothing today stops the movers watchlist or a
// user's own asset watchlist from growing later. 100 calls/run x 2
// scripts x ~4.33 weekly runs/month = ~866/month worst case even if both
// scripts hit their cap every run - still under budget with margin. Once
// hit, the run stops starting new symbols and writes whatever findings it
// already has rather than continuing to burn quota.
const MAX_TAVILY_CALLS_PER_RUN = 100;
let tavilyCallCount = 0;

// Separate cap/counter from Tavily's above - two independent services
// with independent free-tier budgets, conflating their counters would
// make the cap meaningless for either one. Finnhub's 60/min free limit
// is generous relative to this project's ~25-symbol watchlist, so this
// is future-growth headroom, same reasoning as MAX_TAVILY_CALLS_PER_RUN.
const MAX_FINNHUB_CALLS_PER_RUN = 100;
let finnhubCallCount = 0;

// Separate again from both counters above - company-news is a different
// Finnhub endpoint that may have its own rate limit, not independently
// confirmed beyond a single successful live call. Gated to roughly
// once/hour per symbol anyway (shouldFetchNewsThisRun) so this cap is
// unlikely to matter in practice, but keeping its own counter means a
// tighter real limit on this endpoint specifically degrades gracefully
// without touching the (already-verified) /quote budget.
const MAX_FINNHUB_NEWS_CALLS_PER_RUN = 30;
let finnhubNewsCallCount = 0;

// FAST_ONLY runs every 900s (15 min, tools/setup-server-machine.sh) - four
// times an hour. Headlines don't meaningfully change inside 15 minutes the
// way a price does, and asset_price_findings/market_index_findings are
// insert-only with nothing ever purging old rows (expires_at is a
// client-side filter only), so fetching+writing a headlines blob on every
// run would multiply storage growth for content that mostly doesn't
// change that often. This stateless minute-of-hour check fires on
// whichever of the four ~15-minute-apart runs happens to land in the
// first quarter of the clock hour - no persisted state needed, and it
// self-corrects run to run the same way a simple modulo would, without
// depending on the job's exact historical fire times.
function shouldFetchNewsThisRun(now = new Date()) {
  return now.getMinutes() < 15;
}

function requireEnv() {
  const missing = ["SUPABASE_URL"].filter((k) => !process.env[k]);
  if (!DRY_RUN) missing.push(...(!SERVICE_ROLE_KEY ? ["SUPABASE_SERVICE_ROLE_KEY"] : []));
  if (!TAVILY_API_KEY) missing.push("TAVILY_API_KEY");
  if (!GEMINI_API_KEY) missing.push("GEMINI_API_KEY");
  if (!FINNHUB_API_KEY) missing.push("FINNHUB_API_KEY");
  if (missing.length) {
    console.error(`Missing required env var(s): ${missing.join(", ")}`);
    process.exit(1);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithTimeout(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Retries specifically on 429 (rate-limited), not other error codes - a
// 4xx like a bad request or an auth failure retrying won't fix, only a
// transient rate limit will. Confirmed live this session that a burst of
// calls at the previous 500ms spacing was enough to trip Gemini's
// free-tier RPM ceiling mid-run - this is what actually recovers a run
// from that instead of just failing every remaining query.
async function fetchWithRetry(url, opts, timeoutMs, maxRetries = MAX_429_RETRIES) {
  let res;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    res = await fetchWithTimeout(url, opts, timeoutMs);
    if (res.status !== 429) return res;
    if (attempt < maxRetries) {
      const backoffMs = 3000 * 2 ** attempt;
      console.warn(`  429 rate-limited, retrying in ${backoffMs}ms (attempt ${attempt + 1}/${maxRetries})`);
      await sleep(backoffMs);
    }
  }
  return res;
}

// ---- Supabase REST helpers (PostgREST, no SDK dependency) ------------------
async function sbGet(path) {
  const res = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase GET ${path} -> HTTP ${res.status}`);
  return res.json();
}

async function sbInsert(table, rows) {
  if (DRY_RUN) {
    console.log(`[dry-run] would insert ${rows.length} row(s) into ${table}:`);
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  const res = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Supabase INSERT ${table} -> HTTP ${res.status}: ${await res.text()}`);
}

async function sbUpsert(table, row, conflictColumn) {
  if (DRY_RUN) {
    console.log(`[dry-run] would upsert into ${table}:`);
    console.log(JSON.stringify(row, null, 2));
    return;
  }
  const res = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${conflictColumn}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`Supabase UPSERT ${table} -> HTTP ${res.status}: ${await res.text()}`);
}

// Array variant of sbUpsert above, for a composite conflict target
// ("symbol,trade_date"). Kept separate rather than overloading sbUpsert -
// that one takes a single row object and every existing caller passes one.
async function sbUpsertRows(table, rows, conflictColumns) {
  if (!rows.length) return;
  if (DRY_RUN) {
    console.log(`[dry-run] would upsert ${rows.length} row(s) into ${table} on (${conflictColumns}):`);
    console.log(JSON.stringify(rows.slice(0, 3), null, 2));
    if (rows.length > 3) console.log(`  ... and ${rows.length - 3} more`);
    return;
  }
  const res = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${conflictColumns}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Supabase UPSERT ${table} -> HTTP ${res.status}: ${await res.text()}`);
}

// The durable daily rollup (54_daily_prices.sql). Re-upserting the current
// day's row every run is what makes this correct with no aggregation of
// our own: Finnhub maintains h/l as running day extremes and keeps `o`
// fixed, so `close` simply tracks the latest price and settles on the real
// close once the session ends. Deliberately NOT in PURGEABLE_TABLES - this
// table outliving the 2-day findings window is its entire purpose.
//
// Best-effort like the purge: a rollup failure must never crash a run or
// mask the real findings already written.
async function writeDailyCandles(results) {
  const candles = results.map((r) => r.dailyCandle).filter(Boolean);
  if (!candles.length) return;
  // One symbol can appear in more than one loop (a user's own watchlist
  // symbol that's also a tracked mover), and PostgREST rejects a payload
  // containing two rows with the same conflict key - "ON CONFLICT DO
  // UPDATE command cannot affect row a second time."
  const byKey = new Map();
  for (const candle of candles) byKey.set(`${candle.symbol}|${candle.trade_date}`, candle);
  try {
    await sbUpsertRows("daily_prices", [...byKey.values()], "symbol,trade_date");
    console.log(`${DRY_RUN ? "Would have rolled up" : "Rolled up"} ${byKey.size} daily candle(s) into daily_prices.`);
  } catch (err) {
    console.warn(`Daily candle rollup failed (non-fatal): ${err.message}`);
  }
}

// ---- Market-wide context headlines (one Tavily search, zero Gemini) --------
//
// The gap this closes: every other headline in this app comes from
// /company-news?symbol=X, so nothing in the pipeline could ever surface a
// macro story (a rate decision, an inflation print, a jobs report). The
// recap could say WHAT the market did and never WHY.
//
// Costs ONE Tavily search per weekday run - about 22/month against the free
// 1,000, on top of the ~200-370 this script and deal-agent already use
// together. Deliberately NO Gemini call of its own: the headlines are real,
// linked and useful with no model involved, and they are additionally
// folded into the recap's single existing synthesis call, so the daily
// Gemini count is unchanged at 1.
const MARKET_CONTEXT_QUERY = "stock market today what moved the market";
const MAX_CONTEXT_HEADLINES = 4;

// The two previous attempts at market-wide news both failed on RELEVANCE
// (Finnhub's general feed returned Gaza funding and a cocktail-bar feature;
// its `related` tagging matched nothing) - see fetchTrackedStockNews's own
// comment. The difference here is that we choose the query and the domains,
// but a trusted finance domain still publishes plenty that is not a market
// wrap, so results are gated rather than trusted. Whole-word matching, same
// lookaround idiom as categorize.js and pickRelevantHeadline, because "sp"
// must not match inside "spending".
const MARKET_WRAP_TERMS = [
  "stock", "stocks", "market", "markets", "wall street",
  "dow", "s&p", "sp 500", "nasdaq", "investors", "shares",
];
function mentionsWholeTerm(text, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i").test(text);
}
function isMarketWideHeadline(title) {
  if (!title || typeof title !== "string") return false;
  const t = title.trim();
  // A bare section front ("Markets") carries no information; a real wrap
  // headline is a sentence.
  if (t.length < 25) return false;
  return MARKET_WRAP_TERMS.some((term) => mentionsWholeTerm(t, term));
}

// Best-effort by construction. Returns [] on anything going wrong, and the
// caller treats [] exactly like today's behaviour. Deliberately does NOT
// touch queryAttempts/queryFailures: this is an optional extra layered onto
// a card that is complete without it, so it must never flip the daily-recap
// status to degraded - the same treatment findRecapSummary already gets.
async function findMarketContext() {
  try {
    const results = await tavilySearch(MARKET_CONTEXT_QUERY);
    const seen = new Set();
    const picked = [];
    for (const r of results) {
      if (!hostAllowed(r.url, TRUSTED_NEWS_DOMAINS)) continue;
      const title = (r.title || "").trim();
      if (!isMarketWideHeadline(title) || seen.has(r.url)) continue;
      seen.add(r.url);
      picked.push({ title, url: r.url, source: hostOf(r.url) });
      if (picked.length >= MAX_CONTEXT_HEADLINES) break;
    }
    if (!picked.length) console.warn("No market-wide headline passed the relevance gate this run - recap keeps its existing shape.");
    return picked;
  } catch (err) {
    console.warn(`Market context lookup failed (non-fatal, recap unaffected): ${err.message}`);
    return [];
  }
}

const RECAP_MOVER_COUNT = 5;
// The synthesis reads far more coverage than the five movers' own
// headlines, which is what lets it write about the day's actual themes
// (a chip partnership, a data-centre buildout) rather than only listing
// which five tickers moved most. Capped so one batched prompt stays a
// sane size against a 20-request DAILY Gemini quota.
const RECAP_NEWS_POOL_MAX = 40;
const RECAP_NEWS_PER_SYMBOL_MAX = 3;
// Headlines land on roughly one run in four for ~20 symbols at a time, so
// this covers several batches - enough that every symbol resolves even
// when the most recent batch was partial.
const RECAP_HEADLINE_SCAN_LIMIT = 150;
const r2 = (n) => (Number.isFinite(Number(n)) ? Math.round(Number(n) * 100) / 100 : null);

// Newest headlines per symbol across both findings tables. Deliberately
// scans for the newest row that actually CARRIES headlines rather than
// taking each symbol's most recent row - the same distinction
// app/investments.js's latestHeadlinesForSymbol() makes, and for the same
// reason: a price-only row from five minutes ago would otherwise hide a
// perfectly good set from an hour ago.
async function latestHeadlinesBySymbol() {
  const bySymbol = new Map();
  for (const table of ["market_index_findings", "asset_price_findings"]) {
    const rows = await sbGet(
      `${table}?select=symbol,headlines,found_at&headlines=not.is.null&order=found_at.desc&limit=${RECAP_HEADLINE_SCAN_LIMIT}`
    );
    for (const row of rows) {
      if (!Array.isArray(row.headlines) || !row.headlines.length) continue;
      const key = (row.symbol || "").trim().toUpperCase();
      const existing = bySymbol.get(key);
      if (!existing || row.found_at > existing.found_at) bySymbol.set(key, row);
    }
  }
  return bySymbol;
}

// ---- Fundamentals (Finnhub company profile + basic financials) -------------
// P/E, market cap, dividend yield, industry, and a real company name.
//
// **Whether the free tier covers these two endpoints is UNCONFIRMED.**
// Sources conflict, and this project has already been burned once assuming
// a tier was free (Gemini's grounding tool, which turned out to need a
// billing account). So this is built to answer the question by running:
// a 401/403 is treated as "not on this tier", logged plainly, and latches
// OFF for the rest of the run so the remaining symbols don't each repeat a
// call that cannot work. Nothing else is affected - symbol_fundamentals
// simply stays empty and the UI card stays hidden.
const FINNHUB_PROFILE_URL = "https://finnhub.io/api/v1/stock/profile2";
const FINNHUB_METRIC_URL = "https://finnhub.io/api/v1/stock/metric";
// Refreshed at most daily: fundamentals move on quarterly filings, not by
// the minute, so re-fetching every 15 minutes would spend real request
// budget for data that is almost never different.
const FUNDAMENTALS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
let fundamentalsUnavailable = false;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

async function fetchFinnhubJson(url, label) {
  if (finnhubCallCount >= MAX_FINNHUB_CALLS_PER_RUN) return null;
  finnhubCallCount++;
  const res = await fetchWithRetry(url, {}, SEARCH_TIMEOUT_MS);
  if (res.status === 401 || res.status === 403) {
    // The whole point of the latch: one definitive "not on your tier"
    // answer settles it for every remaining symbol this run.
    fundamentalsUnavailable = true;
    console.warn(`Finnhub ${label} returned HTTP ${res.status} - not available on this API tier. Skipping fundamentals for the rest of this run.`);
    return null;
  }
  if (!res.ok) throw new Error(`Finnhub ${label} HTTP ${res.status}`);
  return res.json();
}

// Returns a symbol_fundamentals row, or null if anything was missing or the
// tier does not cover it. Every field is independently nullable - a real
// company with no P/E (unprofitable) or no dividend is normal, not an
// error, and must never be written as a fake 0.
async function fetchFundamentals(symbol) {
  if (fundamentalsUnavailable) return null;
  try {
    const profile = await fetchFinnhubJson(
      `${FINNHUB_PROFILE_URL}?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_API_KEY}`,
      "stock/profile2"
    );
    if (fundamentalsUnavailable || !profile) return null;
    await sleep(REQUEST_DELAY_MS);

    const metrics = await fetchFinnhubJson(
      `${FINNHUB_METRIC_URL}?symbol=${encodeURIComponent(symbol)}&metric=all&token=${FINNHUB_API_KEY}`,
      "stock/metric"
    );
    if (fundamentalsUnavailable) return null;
    const m = (metrics && metrics.metric) || {};

    const row = {
      symbol,
      company_name: typeof profile.name === "string" && profile.name.trim() ? profile.name.trim() : null,
      // Finnhub reports marketCapitalization in MILLIONS.
      market_cap: num(profile.marketCapitalization) != null ? num(profile.marketCapitalization) * 1e6 : null,
      pe_ratio: num(m.peTTM) ?? num(m.peBasicExclExtraTTM),
      dividend_yield: num(m.dividendYieldIndicatedAnnual) ?? num(m.currentDividendYieldTTM),
      industry: typeof profile.finnhubIndustry === "string" && profile.finnhubIndustry.trim()
        ? profile.finnhubIndustry.trim() : null,
      fetched_at: new Date().toISOString(),
    };
    // A row with nothing but a symbol is not worth storing.
    if (!row.company_name && row.market_cap == null && row.pe_ratio == null) return null;
    return row;
  } catch (err) {
    console.warn(`[${symbol}] fundamentals lookup failed (non-fatal): ${err.message}`);
    return null;
  }
}

// Only for symbols whose stored row is missing or a day old. Best-effort
// throughout: this must never crash a run or delay the real price writes,
// which are the job that actually matters.
async function refreshFundamentals(symbols) {
  if (!symbols.length) return;
  let existing = [];
  try {
    existing = await sbGet("symbol_fundamentals?select=symbol,fetched_at");
  } catch (err) {
    console.warn(`Could not read symbol_fundamentals (${err.message}) - skipping fundamentals this run.`);
    return;
  }
  const freshUntil = Date.now() - FUNDAMENTALS_MAX_AGE_MS;
  const fresh = new Set(
    existing.filter((r) => r.fetched_at && Date.parse(r.fetched_at) > freshUntil).map((r) => r.symbol)
  );
  const stale = symbols.filter((s) => !fresh.has(s));
  if (!stale.length) {
    console.log("Fundamentals are all fresh (under a day old) - nothing to fetch.");
    return;
  }

  console.log(`Refreshing fundamentals for ${stale.length} symbol(s).`);
  const rows = [];
  for (const symbol of stale) {
    if (fundamentalsUnavailable) break;
    const row = await fetchFundamentals(symbol);
    if (row) rows.push(row);
    await sleep(REQUEST_DELAY_MS);
  }
  if (!rows.length) {
    console.log("No fundamentals rows written this run.");
    return;
  }
  try {
    await sbUpsertRows("symbol_fundamentals", rows, "symbol");
    console.log(`${DRY_RUN ? "Would have written" : "Wrote"} ${rows.length} fundamentals row(s).`);
    await backfillWatchlistCompanyNames(rows);
  } catch (err) {
    console.warn(`Fundamentals write failed (non-fatal): ${err.message}`);
  }
}

// A real company name from the profile lets pickRelevantHeadline() judge
// relevance for a user-added symbol that was never in the seeded defaults.
// Only fills a NULL - never overwrites a name the user set themselves.
async function backfillWatchlistCompanyNames(rows) {
  if (DRY_RUN) return;
  for (const row of rows) {
    if (!row.company_name) continue;
    try {
      await fetchWithTimeout(
        `${SUPABASE_URL}/rest/v1/watchlist_symbols?symbol=eq.${encodeURIComponent(row.symbol)}&company_name=is.null`,
        {
          method: "PATCH",
          headers: {
            apikey: SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ company_name: row.company_name.toLowerCase() }),
        }
      );
    } catch (err) {
      console.warn(`Could not backfill company_name for ${row.symbol}: ${err.message}`);
    }
  }
}

const MAX_RECAP_SUMMARY_CHARS = 1600;

// Checked at the VALIDATION layer, not just forbidden in the prompt below.
// Asking a model not to give advice is not the same as it obeying, and
// "never picks tickers or amounts to buy or sell" is a hard product
// boundary here, not a preference - so a summary that slips into
// recommending or forecasting is discarded and the card falls back to its
// complete zero-LLM form. Rejecting an occasional good summary is the
// cheap direction to err in.
const RECAP_ADVICE_PHRASES = [
  "should buy", "should sell", "should consider", "recommend", "we advise",
  "buy the dip", "worth buying", "worth selling", "price target",
  "will likely", "poised to", "set to climb",
  "investors should", "you should", "expect further",
  // "expect the", "will rise" and "will fall" used to be here and were
  // REMOVED 2026-09-02: they are the advisory sense of common reporting
  // verbs, and as bare substrings they rejected exactly the attributed
  // sentences the prompt asks for - "analysts expect the Fed to hold rates"
  // and "the company said it will fall short of its own forecast". Measured
  // against a corpus of ten prompt-conformant summaries and eight genuinely
  // advisory ones: the old list rejected 2 of 10 good ones, this list
  // rejects 0 while still catching all 8 bad ones. That mattered because the
  // recap summary was null on 8 of 9 production days, and it matters more
  // now that macro market wraps feed this prompt - "investors expect the Fed
  // to..." is the single most ordinary sentence in a market wrap.
  // The advisory sense is kept below; a market-level forecast stays blocked
  // even when attributed, which is the deliberately stricter half.
  "we expect", "i expect", "expect the market", "expect prices",
  "will rise to", "will fall to",
  // Added alongside the beginner-friendly rewrite, and deliberately in that
  // direction: a plain-spoken summary aimed at someone with no investing
  // background is read more trustingly than a jargon-heavy one, so the
  // boundary gets STRICTER as the tone gets simpler, never looser. These are
  // valuation judgments that function as a buy/sell signal even though they
  // never use the words buy or sell. Multi-word where possible, to keep an
  // ordinary sentence from tripping them.
  "good time to", "buying opportunity", "opportunity to buy", "bargain",
  "undervalued", "overvalued", "safe bet", "can't go wrong", "cannot go wrong",
  "no-brainer", "too cheap", "looks cheap", "looks expensive",
];

// One batched call covering the whole day, not one per mover - that
// distinction is the entire reason stage 2 fits at all. Per-symbol
// explanations wanted 20+ calls against a 20-request DAILY quota shared
// with deal-agent; this asks for 1, on weekdays only, which even on
// Wednesday (price-agent's own weekly ~12) leaves real headroom.
// Plain-English gloss for the four index ETFs, so the summary can say what
// an index actually IS rather than leaving a bare ticker on the page. Fixed,
// stable, factual reference data - not a market judgment - and small enough
// to hand-maintain alongside MARKET_INDEX_ETF_PROXIES above it.
const INDEX_PLAIN_NAMES = {
  SPY: "the S&P 500, which tracks 500 of the biggest US companies",
  DIA: "the Dow Jones Industrial Average, which tracks 30 large US companies",
  QQQ: "the Nasdaq-100, which tracks 100 large US companies, mostly technology",
  IWM: "the Russell 2000, which tracks around 2,000 smaller US companies",
};

function buildRecapSummaryPrompt(tradeDate, movers, breadth, indexMoves, companyNames = {}, newsPool = [], contextHeadlines = []) {
  // Company names are passed IN rather than left to the model. The rule
  // below forbids using its own knowledge of these companies, so without
  // this it could only ever write bare tickers - and "WMT fell 9%" is
  // meaningless to someone who has never invested. This makes naming the
  // company both possible and rule-abiding.
  const moverLines = movers.map((m) => {
    const name = companyNames[m.symbol];
    const who = name ? `${name} (${m.symbol})` : m.symbol;
    const headline = m.headline
      ? `headline: "${m.headline.title}" (${m.headline.source || "unknown source"})`
      : "no headline found";
    return `- ${who}: closed ${m.close}, ${m.change_pct > 0 ? "+" : ""}${m.change_pct}% on the day; ${headline}`;
  });
  const indexLines = indexMoves.map((i) => {
    const gloss = INDEX_PLAIN_NAMES[i.symbol];
    return `- ${gloss || i.symbol}: ${i.change_pct > 0 ? "+" : ""}${i.change_pct}%`;
  });
  return [
    "You write a short, factual recap of one US trading day, based ONLY on",
    "the real data listed below. Do not use your own knowledge of these",
    "companies or of what happened on any date - if it is not listed here,",
    "you do not know it.",
    "",
    "Your reader is a COMPLETE BEGINNER who has never invested and does not",
    "follow financial news. Write for them and nobody else.",
    'Respond with ONLY a JSON object, no prose, no code fences, in this',
    'exact shape: { "summary": string|null }',
    "",
    `Trading day: ${tradeDate}`,
    breadth
      ? `Of the ${breadth.total} companies this person tracks, ${breadth.up} finished the day higher and ${breadth.down} finished lower.`
      : "",
    indexLines.length ? "How the wider market did:" : "",
    ...indexLines,
    contextHeadlines.length ? "" : "",
    contextHeadlines.length
      ? "What the financial press reported about the market as a whole today:"
      : "",
    ...contextHeadlines.map((h) => `- "${h.title}" (${h.source || "unknown source"})`),
    "",
    "Biggest movers among the companies they track:",
    ...moverLines,
    "",
    newsPool.length ? "" : "",
    newsPool.length ? "Other things reported today about companies they track:" : "",
    ...newsPool.map((h) => `- ${h.who}: "${h.title}" (${h.source || "unknown source"})`),
    "",
    "Rules for summary:",
    "- Write TWO short paragraphs, separated by one blank line.",
    contextHeadlines.length
      ? "  Paragraph 1: how the market did overall today, using the numbers"
      : "  Paragraph 1: how the market did overall today, using the numbers above.",
    contextHeadlines.length
      ? "  above, AND what the press said was going on in the market as a"
      : "",
    contextHeadlines.length
      ? "  whole, from the market-wide headlines listed above. This is the"
      : "",
    contextHeadlines.length
      ? "  part a beginner actually wants: not just that the market fell, but"
      : "",
    contextHeadlines.length
      ? "  what was being reported around it. Attribute it ('coverage pointed"
      : "",
    contextHeadlines.length
      ? "  to...'), never state it as the proven cause."
      : "",
    "  Paragraph 2: what was actually being REPORTED - the two or three",
    "  biggest themes running through the coverage listed above (for example a",
    "  partnership, a big investment in new facilities, a company planning to",
    "  sell shares to the public). Group related stories into a theme instead",
    "  of listing headlines one by one.",
    "- Everyday words only.",
    "- Never use an em dash or en dash. Use a plain hyphen instead.",
    "- Write like you are explaining the day to a friend who knows nothing",
    "  about investing. No finance-desk phrasing.",
    "- Say 'fell' or 'rose', never 'declined', 'advanced', 'posted losses',",
    "  'led the downside', 'closed in the red' or similar.",
    "- Name the company in plain words, with the ticker in brackets after it",
    "  the first time, e.g. 'Walmart (WMT) fell about 9%'.",
    "- NEVER use a term a beginner would not know without explaining it in",
    "  the same sentence. That includes: ETF, index, large-cap, small-cap,",
    "  breadth, valuation, P/E, equities, session, benchmark.",
    "- Round percentages to something readable, e.g. 'about 9%' not 9.71%.",
    "- Describe what happened and what was being REPORTED. Never assert that",
    "  a headline caused a price move - say coverage focused on it, or that",
    "  the move came alongside that reporting.",
    "- Never give advice, never recommend buying or selling, never predict",
    "  what any price will do next, never give a price target, and never",
    "  call anything cheap, expensive, undervalued or a good opportunity.",
    "- Only mention a company that appears somewhere above, in either list.",
    "  Never invent a reason for a mover listed as having no headline - it is",
    "  fine to say the move came without much news coverage.",
    "- Describe only what the headlines above actually say. If a headline",
    "  reports what a company itself expects or plans, say who said it",
    "  ('the company said it plans to...'). Never turn that into your own",
    "  prediction, and never predict anything yourself.",
    "- If the data above is too thin to say anything meaningful, set summary",
    "  to null rather than padding it out.",
  ].filter(Boolean).join("\n");
}

// Own copy of app/gemma.js's plainDashes() - a Node script and a browser
// module share no imports here, the same reason MARKET_INDEXES is duplicated
// in this file. Model output must never carry an em or en dash: the repo's
// no-em-dash rule governs what we write, and this extends it to what a model
// writes back, enforced at the boundary rather than trusting the prompt.
function plainDashes(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/(\d)\s*[\u2013\u2014\u2015]\s*(\d)/g, "$1-$2")
    .replace(/\s*[\u2013\u2014\u2015]\s*/g, " - ");
}

// Returns { summary } on success or { reason } on rejection, so the caller
// can record WHY rather than storing an indistinguishable null. The
// rejection rules themselves are unchanged.
function validateRecapSummary(raw) {
  if (!raw || typeof raw !== "object") return { reason: "invalid_json" };
  const summary = typeof raw.summary === "string" ? raw.summary.trim() : "";
  if (!summary) return { reason: "empty" };
  if (summary.length > MAX_RECAP_SUMMARY_CHARS) {
    console.warn(`Discarding recap summary - ${summary.length} chars, over the ${MAX_RECAP_SUMMARY_CHARS} cap.`);
    return { reason: "too_long" };
  }
  const lower = summary.toLowerCase();
  const violation = RECAP_ADVICE_PHRASES.find((phrase) => lower.includes(phrase));
  if (violation) {
    console.warn(`Discarding recap summary - contains advice/forecast language ("${violation}").`);
    return { reason: `rejected:${violation}` };
  }
  return { summary: plainDashes(summary) };
}

// Best-effort by contract: any failure here (quota exhausted, timeout,
// malformed JSON, a summary that broke the advice rule) returns null and
// the recap is still written in full. A missing summary is the design
// working as intended, NOT a degraded run - the same reasoning that keeps
// "no trusted-domain result" out of queryFailures, so this deliberately
// does not touch those counters and won't turn the card's status amber.
// Proper-cased company names for PROSE ("Walmart Inc"), distinct from the
// lowercase ones loadMoversWatchlist() returns - those are lowercased on
// purpose for case-insensitive headline matching and would read wrong in a
// sentence. Falls back to the watchlist's own name so a symbol with no
// fundamentals row still gets named rather than showing a bare ticker.
async function loadDisplayCompanyNames(fallbackNames) {
  const names = {};
  for (const [symbol, name] of Object.entries(fallbackNames || {})) {
    // Title-case the fallback so it is at least presentable.
    names[symbol] = String(name).replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
  }
  try {
    const rows = await sbGet("symbol_fundamentals?select=symbol,company_name");
    for (const row of rows) {
      const symbol = (row.symbol || "").trim().toUpperCase();
      if (symbol && row.company_name) names[symbol] = String(row.company_name).trim();
    }
  } catch (err) {
    console.warn(`Could not read company names for the summary (${err.message}) - using watchlist names.`);
  }
  return names;
}

async function findRecapSummary(tradeDate, movers, breadth, indexMoves, companyNames, newsPool = [], contextHeadlines = []) {
  try {
    const text = await extractWithGemini(buildRecapSummaryPrompt(tradeDate, movers, breadth, indexMoves, companyNames, newsPool, contextHeadlines));
    const result = validateRecapSummary(parseJsonLoose(text));
    if (!result.summary) console.warn(`No usable recap summary this run (${result.reason}) - keeping the zero-LLM recap.`);
    return result;
  } catch (err) {
    // Classified so a quota-exhausted day is tellable apart from a network
    // blip or a model error - the three want completely different fixes.
    const m = err.message || "";
    const reason = /\b429\b|quota|RESOURCE_EXHAUSTED/i.test(m) ? "quota"
      : /abort|timeout/i.test(m) ? "timeout"
      : /HTTP \d/.test(m) ? "http_error"
      : "error";
    console.warn(`Recap summary failed (non-fatal, keeping the zero-LLM recap): ${reason} - ${m}`);
    return { reason };
  }
}

// The first stored headline that actually names the symbol or its company
// and hasn't already been used by another mover in this recap. Returns null
// rather than falling back to an unrelated article - showing "Trump Could
// Cut Canadian Auto Tariffs" under a Tesla move would imply a connection
// that isn't there, which is worse than showing no headline at all.
// Whole-word match, NOT a substring. A plain `includes()` here was a real
// bug caught against production data: "DIS" matched "**Dis**cover which dow
// jones stocks are making waves" and "V" matched "mo**v**ing on Thursday",
// so short tickers pulled in exactly the aggregator filler this gate exists
// to reject.
//
// Uses the same lookaround idiom as categorize.js's keyword matcher rather
// than \b, and for the same documented reason: \b needs a word/non-word
// transition on each side, which silently fails for a term that itself
// starts or ends with a non-word character (a ticker like "BRK.B").
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentionsWholeWord = (text, term) =>
  new RegExp(`(?<![a-z0-9])${escapeRegex(term.toLowerCase())}(?![a-z0-9])`, "i").test(text);

// Same relevance rule as pickRelevantHeadline below, minus the used-URL
// bookkeeping: an explanation may draw on several headlines, and the same
// story legitimately informs more than one symbol's explanation.
function headlineNamesCompany(title, symbol, companyName) {
  return mentionsWholeWord(title, symbol) || (!!companyName && mentionsWholeWord(title, companyName));
}

function pickRelevantHeadline(symbol, candidates, usedUrls, companyNames) {
  if (!Array.isArray(candidates)) return null;
  // Null for a user-added symbol nobody has a company name for yet, in
  // which case this degrades to ticker-only matching rather than rejecting
  // every headline outright.
  const company = companyNames[symbol];
  return candidates.find((h) => {
    if (!h || !h.title || !h.url || usedUrls.has(h.url)) return false;
    return mentionsWholeWord(h.title, symbol) || (company && mentionsWholeWord(h.title, company));
  }) || null;
}

// ---- Market-wide movers (Alpha Vantage -> Finnhub -> Gemini) ---------------
// Three providers, each doing only what it can actually do:
//   1. Alpha Vantage says WHAT moved (ticker/price/change/volume, no
//      explanation of any kind - confirmed against a live response).
//   2. Finnhub supplies the company name and a real headline for each of
//      those tickers, reusing the exact relevance gate the recap uses.
//   3. Gemini writes one optional beginner-friendly paragraph on top.
// Every stage degrades on its own: no Alpha Vantage key skips the whole
// thing, a missing headline just leaves that mover without one, and a
// failed Gemini call still leaves real numbers and real links on the card.
function parseChangePct(raw) {
  // Alpha Vantage returns change_percentage as a string with a trailing
  // percent sign, e.g. "113.1547%".
  const text = String(raw ?? "").replace("%", "").trim();
  // The empty check is load-bearing, not defensive noise: Number("") is 0,
  // so without it a mover with a missing percentage would be stored as a
  // real-looking 0% move instead of being dropped. Same fake-zero trap
  // validateFinnhubQuote() already avoids by mapping 0 to null.
  if (!text) return null;
  const num = Number(text);
  return Number.isFinite(num) ? Math.round(num * 10000) / 10000 : null;
}

const avNum = (raw) => {
  const text = String(raw ?? "").trim();
  if (!text) return null; // Number("") is 0 - see parseChangePct above.
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
};

async function fetchTopMovers() {
  const res = await fetchWithRetry(
    `${ALPHA_VANTAGE_URL}?function=TOP_GAINERS_LOSERS&apikey=${ALPHA_VANTAGE_API_KEY}`,
    {},
    SEARCH_TIMEOUT_MS
  );
  if (!res.ok) throw new Error(`Alpha Vantage HTTP ${res.status}`);
  const data = await res.json();
  // Alpha Vantage answers a bad/exhausted key with HTTP 200 and an
  // "Information"/"Note" field rather than an error status, so a plain
  // res.ok check would happily treat a rate-limit notice as success.
  if (data && (data.Information || data.Note || data["Error Message"])) {
    throw new Error(String(data.Information || data.Note || data["Error Message"]).slice(0, 200));
  }
  const pick = (list, category) => {
    const parsed = (Array.isArray(list) ? list : [])
      .map((row) => ({
        category,
        symbol: String(row.ticker || "").trim().toUpperCase(),
        price: avNum(row.price),
        change_amount: avNum(row.change_amount),
        change_pct: parseChangePct(row.change_percentage),
        volume: avNum(row.volume),
      }))
      .filter((m) => m.symbol && m.change_pct != null);

    const kept = [];
    const dropped = [];
    for (const m of parsed) {
      const reason = moverRejectReason(m);
      if (reason) dropped.push(`${m.symbol} (${reason})`);
      else kept.push(m);
    }
    if (dropped.length) {
      console.log(`  ${category}s: skipped ${dropped.length} of ${parsed.length} - ${dropped.slice(0, 5).join(", ")}${dropped.length > 5 ? ", ..." : ""}`);
    }
    // Rank is assigned AFTER filtering, so the card's "1" is the biggest
    // move actually shown rather than a gap-riddled original position.
    return kept.slice(0, MOVERS_PER_CATEGORY).map((m, i) => ({ ...m, rank: i + 1 }));
  };
  return [...pick(data.top_gainers, "gainer"), ...pick(data.top_losers, "loser")];
}

// A discovered mover is usually a small company nobody has heard of, so
// its name matters more here than for a household-name watchlist stock.
// Reuses refreshFundamentals()' own profile lookup by way of
// symbol_fundamentals, then the SAME pickRelevantHeadline() gate the recap
// uses - without it these fill with the identical aggregator listicles.
async function attachMoverContext(movers) {
  const symbols = [...new Set(movers.map((m) => m.symbol))];
  await refreshFundamentals(symbols);

  let names = {};
  try {
    const rows = await sbGet("symbol_fundamentals?select=symbol,company_name");
    for (const row of rows) {
      const symbol = (row.symbol || "").trim().toUpperCase();
      if (symbol && row.company_name) names[symbol] = String(row.company_name).trim();
    }
  } catch (err) {
    console.warn(`Could not read mover company names (${err.message}) - headlines will match on ticker alone.`);
  }

  const usedUrls = new Set();
  for (const mover of movers) {
    mover.company_name = names[mover.symbol] || null;
    if (fundamentalsUnavailable) continue;
    try {
      const raw = await fetchFinnhubCompanyNews(mover.symbol);
      const headlines = validateFinnhubNews(raw);
      // Lowercased for the matcher, which is case-insensitive but expects
      // the same shape watchlist_symbols.company_name uses.
      const matchNames = mover.company_name
        ? { [mover.symbol]: mover.company_name.toLowerCase() } : {};
      const picked = pickRelevantHeadline(mover.symbol, headlines, usedUrls, matchNames);
      if (picked) {
        usedUrls.add(picked.url);
        mover.headline = { title: picked.title, url: picked.url, source: picked.source || null };
      }
    } catch (err) {
      console.warn(`[${mover.symbol}] mover news lookup failed (non-fatal): ${err.message}`);
    }
    await sleep(REQUEST_DELAY_MS);
  }
  return movers;
}

function buildMoverSummaryPrompt(tradeDate, movers) {
  const line = (m) => {
    const who = m.company_name ? `${m.company_name} (${m.symbol})` : m.symbol;
    const dir = m.change_pct > 0 ? "up" : "down";
    const news = m.headline ? `headline: "${m.headline.title}"` : "no news coverage found";
    return `- ${who}: ${dir} ${Math.abs(m.change_pct)}% to ${m.price}; ${news}`;
  };
  const gainers = movers.filter((m) => m.category === "gainer").map(line);
  const losers = movers.filter((m) => m.category === "loser").map(line);
  return [
    "You summarise the biggest single-day stock moves in the whole US",
    "market, based ONLY on the data listed below. Do not use your own",
    "knowledge of these companies - if it is not listed here, you do not",
    "know it.",
    "",
    "Your reader is a COMPLETE BEGINNER who has never invested and does not",
    "follow financial news. Write for them and nobody else.",
    'Respond with ONLY a JSON object, no prose, no code fences, in this',
    'exact shape: { "summary": string|null }',
    "",
    `Trading day: ${tradeDate}`,
    gainers.length ? "Biggest risers:" : "",
    ...gainers,
    losers.length ? "Biggest fallers:" : "",
    ...losers,
    "",
    "Rules for summary:",
    "- 2 to 3 short sentences. Everyday words only.",
    "- These are usually small, obscure companies, and big daily swings in",
    "  them are normal and often reverse. Say so plainly if it fits.",
    "- Say 'rose' or 'fell', never 'rallied', 'surged', 'plunged',",
    "  'cratered' or similar dramatic wording.",
    "- Round percentages, e.g. 'more than doubled' or 'about 40%'.",
    "- NEVER use a term a beginner would not know without explaining it in",
    "  the same sentence.",
    "- Never give advice, never recommend buying or selling, never predict",
    "  what any price will do next, and never call anything cheap,",
    "  expensive, undervalued or a good opportunity.",
    "- Never claim a headline CAUSED a move - say coverage focused on it.",
    "- If the data is too thin to say anything useful, set summary to null.",
  ].filter(Boolean).join("\n");
}

// One optional Gemini call. Same validation gate as every other generated
// sentence in this app, so an advice-phrased summary is discarded rather
// than shown.
async function findMoverSummary(tradeDate, movers) {
  try {
    const text = await extractWithGemini(buildMoverSummaryPrompt(tradeDate, movers));
    const summary = validateRecapSummary(parseJsonLoose(text));
    if (!summary) console.warn("No usable mover summary this run - keeping the numbers and headlines.");
    return summary;
  } catch (err) {
    console.warn(`Mover summary failed (non-fatal, keeping the numbers): ${err.message}`);
    return null;
  }
}

async function buildMarketMovers(tradeDate) {
  if (!ALPHA_VANTAGE_API_KEY) {
    console.log("ALPHA_VANTAGE_API_KEY not set - skipping market-wide movers (everything else is unaffected).");
    return;
  }
  let movers;
  try {
    movers = await fetchTopMovers();
  } catch (err) {
    console.warn(`Alpha Vantage movers lookup failed (non-fatal): ${err.message}`);
    return;
  }
  if (!movers.length) {
    console.warn("Alpha Vantage returned no usable movers this run.");
    return;
  }

  await attachMoverContext(movers);

  const rows = movers.map((m) => ({
    trade_date: tradeDate, category: m.category, symbol: m.symbol, rank: m.rank,
    price: m.price, change_amount: m.change_amount, change_pct: m.change_pct,
    volume: m.volume, company_name: m.company_name ?? null,
    headline: m.headline ?? null, fetched_at: new Date().toISOString(),
  }));
  try {
    await sbUpsertRows("market_movers", rows, "trade_date,category,symbol");
    const withNews = rows.filter((r) => r.headline).length;
    console.log(`${DRY_RUN ? "Would have written" : "Wrote"} ${rows.length} market mover(s) for ${tradeDate}, ${withNews} with a headline.`);
  } catch (err) {
    console.warn(`Market movers write failed (non-fatal): ${err.message}`);
    return;
  }

  // Same reuse guard as the recap summary: a re-run must not spend a
  // second Gemini call, and must not blank a summary already generated.
  let summary = null;
  try {
    const existing = await sbGet(`market_mover_summaries?select=summary&trade_date=eq.${tradeDate}`);
    summary = existing.length ? existing[0].summary : null;
  } catch { /* best-effort - treat as absent and try to generate */ }

  if (summary) {
    console.log("Mover summary already exists for today - reusing it, no Gemini call.");
  } else if (DRY_RUN) {
    console.log("[dry-run] skipping the mover summary so no daily quota is spent.");
  } else {
    summary = await findMoverSummary(tradeDate, movers);
  }

  try {
    await sbUpsertRows("market_mover_summaries", [{
      trade_date: tradeDate, summary,
      generated_by: summary ? "rollup+gemini" : "rollup",
      updated_at: new Date().toISOString(),
    }], "trade_date");
  } catch (err) {
    console.warn(`Mover summary write failed (non-fatal): ${err.message}`);
  }
}

// Stage 1 of the daily recap: the day's biggest movers, each with a real
// linked headline, plus breadth and the index proxies' moves. Makes ZERO
// outbound calls - every input was already fetched and stored by the
// FAST_ONLY runs. That's the whole design: nothing here can be rate
// limited, so unlike market_news_findings (0 rows, ever, because its one
// Gemini call always lost the race for a 20/day quota) this always
// produces something real.
//
// Keys off the latest trade_date actually present in daily_prices rather
// than off the calendar, so market holidays need no special-casing and no
// holiday list - the same call marketStatus() already makes. A weekend run
// simply rebuilds Friday's recap, which is idempotent.
async function buildDailyRecap(contextHeadlines = []) {
  queryAttempts++;
  const dateRows = await sbGet("daily_prices?select=trade_date&order=trade_date.desc&limit=200");
  const days = [...new Set(dateRows.map((r) => r.trade_date))];
  if (!days.length) {
    queryFailures++;
    console.warn("No daily_prices rows yet - nothing to recap. Run the FAST_ONLY agent first.");
    return;
  }
  const [tradeDate, priorDate] = days;

  const todayRows = await sbGet(`daily_prices?select=symbol,close,previous_close&trade_date=eq.${tradeDate}`);
  const priorRows = priorDate
    ? await sbGet(`daily_prices?select=symbol,close&trade_date=eq.${priorDate}`)
    : [];
  const priorClose = new Map(priorRows.map((r) => [(r.symbol || "").toUpperCase(), Number(r.close)]));

  // previous_close is null on rows backfilled from the findings stream by
  // 54_daily_prices.sql, so fall back to the prior trading day's own close.
  // Returns null rather than a fake 0% when neither is available.
  const moveFor = (row) => {
    const close = Number(row.close);
    const prev = row.previous_close != null
      ? Number(row.previous_close)
      : priorClose.get((row.symbol || "").toUpperCase());
    if (!Number.isFinite(close) || !Number.isFinite(prev) || prev <= 0) return null;
    return { close: r2(close), change: r2(close - prev), change_pct: r2(((close - prev) / prev) * 100) };
  };

  const headlines = await latestHeadlinesBySymbol();
  const etfTickers = new Set(Object.values(MARKET_INDEX_ETF_PROXIES));
  const { symbols: moverSymbols, names: companyNames } = await loadMoversWatchlist();
  const watchlist = new Set(moverSymbols);

  const scored = [];
  for (const row of todayRows) {
    const symbol = (row.symbol || "").trim().toUpperCase();
    if (!watchlist.has(symbol)) continue;
    const move = moveFor(row);
    if (!move) continue;
    scored.push({ symbol, ...move });
  }

  if (!scored.length) {
    queryFailures++;
    console.warn(`No usable price moves for ${tradeDate} - not writing an empty recap.`);
    return;
  }

  // One generic aggregator article routinely mentions several symbols, so
  // without this the same URL gets filed under two different movers - which
  // is both wrong and obviously wrong to a reader.
  const usedHeadlineUrls = new Set();
  const movers = [...scored]
    .sort((a, b) => Math.abs(b.change_pct) - Math.abs(a.change_pct))
    .slice(0, RECAP_MOVER_COUNT)
    .map((m) => {
      const found = headlines.get(m.symbol);
      const top = pickRelevantHeadline(m.symbol, found && found.headlines, usedHeadlineUrls, companyNames);
      if (top) usedHeadlineUrls.add(top.url);
      return {
        ...m,
        // A headline is a SOURCE, not a causal claim - the UI states it as
        // "the day's coverage," never as the reason the price moved.
        headline: top ? { title: top.title, url: top.url, source: top.source || null } : null,
      };
    });

  const up = scored.filter((m) => m.change_pct > 0).length;
  const down = scored.filter((m) => m.change_pct < 0).length;
  const breadth = { up, down, flat: scored.length - up - down, total: scored.length };

  const index_moves = todayRows
    .filter((r) => etfTickers.has((r.symbol || "").trim().toUpperCase()))
    .map((r) => ({ symbol: (r.symbol || "").trim().toUpperCase(), move: moveFor(r) }))
    .filter((r) => r.move)
    .map((r) => ({ symbol: r.symbol, change_pct: r.move.change_pct }));

  // Stage 2: one batched Gemini synthesis, layered on top of a recap that
  // is already complete without it. Read the existing row first for two
  // reasons - a re-run the same day must not spend a second call against a
  // 20/day quota, and the upsert below always sends `summary`, so without
  // carrying the existing value forward a re-run would blank one that had
  // already been generated.
  const existing = await sbGet(`daily_recaps?select=summary,generated_by,movers&trade_date=eq.${tradeDate}`);
  const storedSummary = existing.length ? existing[0].summary : null;
  // A stored summary describes a SPECIFIC set of movers and quotes their
  // percentages in prose. If a later run recomputes different numbers
  // (prices move until the close, and a re-run mid-session will see them),
  // carrying the old text forward would put "WMT fell 9.15%" next to a card
  // reading -9.71%. Reuse only while the numbers it describes are unchanged;
  // on the normal once-daily post-close schedule this never regenerates.
  const moverSignature = (list) =>
    (Array.isArray(list) ? list : []).map((m) => `${m.symbol}:${m.change_pct}`).join(",");
  const summaryStillMatches = !!storedSummary &&
    moverSignature(existing[0].movers) === moverSignature(movers);

  let summary = summaryStillMatches ? storedSummary : null;
  let generatedBy = summary ? (existing[0].generated_by || "rollup+gemini") : "rollup";
  // Why a summary is absent (61_recap_summary_skip_reason.sql). Diagnostic
  // only - it never reaches the card and never changes the run status.
  let skippedReason = summary ? null : "not_attempted";

  if (summary) {
    console.log(`Recap for ${tradeDate} already has a matching summary - reusing it, no Gemini call this run.`);
  } else if (storedSummary) {
    console.log("Movers changed since the stored summary was written - regenerating so the prose can't contradict the numbers.");
  }

  if (summary) {
    // nothing to do - reused above
  } else if (DRY_RUN) {
    // A dry run is for checking the zero-LLM half without side effects;
    // spending a scarce daily quota unit would be a real side effect. Do a
    // real run to exercise this path.
    console.log("[dry-run] skipping the Gemini synthesis so no daily quota is spent.");
    skippedReason = "dry_run";
  } else {
    const displayNames = await loadDisplayCompanyNames(companyNames);
    // The wider coverage pool, so the synthesis can write about what the day
    // was ABOUT rather than only which five tickers moved most. Reuses the
    // headlines already fetched above - no extra call. Skips the ETF proxies
    // (Finnhub's company-news product doesn't cover a fund meaningfully) and
    // any URL already shown against a mover, so the same story can't appear
    // as both a source link and a "meanwhile" item.
    const pooledUrls = new Set(movers.filter((m) => m.headline).map((m) => m.headline.url));
    const newsPool = [];
    for (const [symbol, found] of headlines) {
      if (etfTickers.has(symbol) || !watchlist.has(symbol)) continue;
      const name = displayNames[symbol];
      let taken = 0;
      for (const h of found.headlines || []) {
        if (newsPool.length >= RECAP_NEWS_POOL_MAX) break;
        if (taken >= RECAP_NEWS_PER_SYMBOL_MAX) break;
        if (!h || !h.title || pooledUrls.has(h.url)) continue;
        pooledUrls.add(h.url);
        newsPool.push({ who: name ? `${name} (${symbol})` : symbol, title: h.title, source: h.source || null });
        taken++;
      }
      if (newsPool.length >= RECAP_NEWS_POOL_MAX) break;
    }
    const result = await findRecapSummary(tradeDate, movers, breadth, index_moves, displayNames, newsPool, contextHeadlines);
    summary = result.summary || null;
    skippedReason = summary ? null : (result.reason || "error");
    // Only claim Gemini touched this row if it actually produced something
    // usable - generated_by has to stay an honest record of how the row
    // was made, since the whole card is built on not overstating itself.
    if (summary) generatedBy = "rollup+gemini";
  }

  await sbUpsertRows("daily_recaps", [{
    trade_date: tradeDate,
    movers,
    breadth,
    index_moves,
    summary,
    // Null rather than [] when nothing passed the gate: the client treats
    // "no macro coverage found" as absent, not as an empty list to render.
    context_headlines: contextHeadlines.length ? contextHeadlines : null,
    generated_by: generatedBy,
    summary_skipped_reason: skippedReason,
    updated_at: new Date().toISOString(),
  }], "trade_date");

  const withHeadlines = movers.filter((m) => m.headline).length;
  console.log(
    `${DRY_RUN ? "Would have written" : "Wrote"} recap for ${tradeDate}: ` +
    `${movers.length} mover(s), ${withHeadlines} with a headline, breadth ${up} up / ${down} down, ` +
    `summary ${summary ? "included" : `omitted (${skippedReason})`}.`
  );
}

async function sbDeleteExpired(table) {
  const now = new Date().toISOString();
  if (DRY_RUN) {
    console.log(`[dry-run] would delete rows from ${table} where expires_at < ${now}`);
    return null;
  }
  const res = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/${table}?expires_at=lt.${now}`, {
    method: "DELETE",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      Prefer: "return=minimal,count=exact",
    },
  });
  if (!res.ok) throw new Error(`Supabase DELETE ${table} -> HTTP ${res.status}: ${await res.text()}`);
  // PostgREST reports the affected count in Content-Range ("*/12") when
  // asked for count=exact - purely for the log line, so a missing or
  // unparseable header is not an error.
  const total = (res.headers.get("content-range") || "").split("/")[1];
  return Number.isFinite(Number(total)) ? Number(total) : null;
}

// These three tables are insert-only by design (a real historical price
// series is what the Investments tab's day-change and trend math read), but
// nothing ever removed a row once its expires_at passed - so they grew
// without bound while every reader already filters on expires_at, meaning
// the extra rows were pure dead weight. At the FAST_ONLY cadence that's
// roughly 2,300 rows/day into market_index_findings alone, against a free
// tier that has a real ceiling.
//
// Best-effort and deliberately last: a purge failure must never crash the
// run or mask findings that were already written successfully. Runs on
// every run rather than on its own schedule - a DELETE bounded by
// expires_at is cheap, and only ever touches rows no client would fetch.
const PURGEABLE_TABLES = ["asset_price_findings", "market_index_findings", "market_news_findings"];
async function purgeExpiredFindings() {
  for (const table of PURGEABLE_TABLES) {
    try {
      const deleted = await sbDeleteExpired(table);
      if (deleted === null) continue;
      console.log(`Purged ${deleted} expired row(s) from ${table}.`);
    } catch (err) {
      console.warn(`Purge of ${table} failed (non-fatal): ${err.message}`);
    }
  }
}

// Best-effort - a failure to write run status must never crash the run or
// mask whatever real findings were already written. See queryAttempts/
// queryFailures above (tracked inside searchAndExtract()) for what this
// is based on; "no trusted-domain result" doesn't count as a failure
// here, only a real thrown API/network error does.
// Names the service that actually failed. "rate limits or timeouts" was a
// guess printed for every cause alike, including a Finnhub 500 and a Gemini
// quota exhaustion, which want completely different fixes.
function failureBreakdown() {
  const parts = [];
  if (outcomes.tavilyFail) parts.push(`${outcomes.tavilyFail} search`);
  if (outcomes.geminiFail) parts.push(`${outcomes.geminiFail} AI extraction`);
  if (outcomes.finnhubFail) parts.push(`${outcomes.finnhubFail} price lookup`);
  return parts.length ? parts.join(", ") : "cause not attributed";
}

async function writeRunStatus(crashError) {
  let status, detail;
  if (crashError) {
    status = "failed";
    detail = `Run crashed: ${crashError.message}`;
  } else if (queryAttempts === 0 || queryFailures === 0) {
    status = "ok";
    detail = null;
  } else if (queryFailures < queryAttempts) {
    status = "degraded";
    detail = `${queryFailures} of ${queryAttempts} calls failed this run (${failureBreakdown()}) - some data may be stale or incomplete.`;
  } else {
    status = "failed";
    detail = `All ${queryAttempts} calls failed this run (${failureBreakdown()}) - data may be significantly stale.`;
  }
  // Always logged, even on an "ok" run: the silent outcomes are exactly the
  // ones that never show up in a status and are the reason a completely
  // unproductive run can report itself healthy.
  console.log(
    `Run outcomes: ${queryFailures}/${queryAttempts} failed ` +
    `(tavily ${outcomes.tavilyFail}, gemini ${outcomes.geminiFail}, finnhub ${outcomes.finnhubFail}); ` +
    `no trusted-domain result ${outcomes.noTrustedResult}; ` +
    `no stored headline for the company ${outcomes.noStoredHeadlines}; ` +
    `extraction found nothing usable ${outcomes.emptyExtraction}.`
  );
  try {
    await sbUpsert("agent_run_status", {
      agent: RECAP_ONLY ? "daily-recap" : FAST_ONLY ? "price-agent-fast" : "price-agent",
      status,
      detail,
      queries_attempted: queryAttempts,
      queries_failed: queryFailures,
      ran_at: new Date().toISOString(),
    }, "agent");
  } catch (err) {
    console.warn(`Failed to write run status: ${err.message}`);
  }
}

// ---- Watchlist: every symbol in use across all users -----------------------
async function loadWatchlist() {
  const rows = await sbGet("assets?select=price_symbol&price_symbol=not.is.null");
  return [...new Set(rows.map((r) => (r.price_symbol || "").trim()).filter(Boolean))];
}

// The movers watchlist, now read from watchlist_symbols (56_watchlist_and_
// fundamentals.sql) instead of a hardcoded constant that had to be kept in
// sync by hand with app/app.js. Reads the union across ALL users the same
// way loadWatchlist() above does for assets.price_symbol - a symbol's price
// is a public fact, and market_index_findings has never been user-scoped.
//
// Falls back to the built-in defaults if the table is empty or unreachable,
// so a fetch failure degrades to today's behavior rather than pricing
// nothing at all.
async function loadMoversWatchlist() {
  try {
    const rows = await sbGet("watchlist_symbols?select=symbol,company_name");
    const symbols = [...new Set(
      rows.map((r) => (r.symbol || "").trim().toUpperCase()).filter(Boolean)
    )];
    const names = {};
    for (const row of rows) {
      const symbol = (row.symbol || "").trim().toUpperCase();
      if (symbol && row.company_name) names[symbol] = String(row.company_name).toLowerCase();
    }
    if (symbols.length) return { symbols, names };
    console.warn("watchlist_symbols is empty - falling back to the built-in default watchlist.");
  } catch (err) {
    console.warn(`Could not read watchlist_symbols (${err.message}) - using the built-in default watchlist.`);
  }
  return { symbols: [...DEFAULT_MOVERS_WATCHLIST], names: { ...DEFAULT_MOVER_COMPANY_NAMES } };
}

function buildQueries(symbol) {
  return [`${symbol} price today`, `${symbol} current price USD`];
}

// The publisher name shown under a headline. Bare hostname on purpose - it
// is what the URL actually says, with no mapping table to drift.
function hostOf(urlStr) {
  try {
    return new URL(urlStr).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function hostAllowed(urlStr, domains) {
  try {
    const host = new URL(urlStr).hostname.replace(/^www\./, "");
    return domains.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

// ---- Tavily: real live web search -----------------------------------------
async function tavilySearch(query) {
  if (tavilyCallCount >= MAX_TAVILY_CALLS_PER_RUN) {
    throw new Error(`Tavily call budget (${MAX_TAVILY_CALLS_PER_RUN}/run) exceeded - skipping`);
  }
  tavilyCallCount++;
  const res = await fetchWithRetry(TAVILY_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${TAVILY_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, max_results: RESULTS_PER_QUERY, search_depth: "basic" }),
  }, SEARCH_TIMEOUT_MS);
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return (data.results || [])
    .map((r) => ({
      url: typeof r.url === "string" ? r.url : "",
      title: typeof r.title === "string" ? r.title : "",
      content: typeof r.content === "string" ? r.content : "",
    }))
    .filter((r) => r.url);
}

// ---- Gemini: extraction only, no search tool -------------------------------
async function extractWithGemini(prompt) {
  const res = await fetchWithRetry(geminiUrl(GEMINI_MODEL), {
    method: "POST",
    headers: { "x-goog-api-key": GEMINI_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  }, GEMINI_TIMEOUT_MS);
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const candidate = (data.candidates || [])[0];
  const textPart = (candidate?.content?.parts || []).find((p) => typeof p.text === "string");
  if (!textPart) throw new Error("Gemini response had no text content");
  return textPart.text;
}

function buildSourcesBlock(results) {
  return results.map((r, i) => `[Source ${i + 1}: ${r.url}]\n${r.content}`).join("\n\n");
}

// Search via Tavily, filter to an allowed domain list, then ask Gemini to
// extract structured JSON purely from the real fetched content of those
// trusted results - never from Gemini's own general knowledge (the prompt
// says so explicitly). Returns citations already filtered to the allowed
// list, so callers don't need a second trust check.
// queryAttempts/queryFailures track every real call through this function
// for the run's agent_run_status row (see main()) - only a thrown error
// (a real API/network failure) counts as a failure. "No trusted-domain
// result" is a normal, working-as-intended outcome (the domain allowlist
// doing its job), not a limit/API problem, so it's deliberately NOT
// counted here - counting it would make the freshness indicator warn
// users every time a search legitimately finds nothing trustworthy,
// which isn't what "results may be stale" should mean.
let queryAttempts = 0;
let queryFailures = 0;
// Failures broken down by which SERVICE actually failed, plus the two
// silent non-failure outcomes. queries_failed alone said "7 of 40 live
// searches failed (rate limits or timeouts)" for what could equally be a
// Finnhub 500, a Gemini quota exhaustion or a Tavily timeout - three
// problems with three different fixes - and said nothing at all about the
// far more common case of a search returning nothing usable, which is why
// this script wrote 0 explanations across 192 findings without ever
// reporting a problem.
const outcomes = {
  tavilyFail: 0,
  geminiFail: 0,
  finnhubFail: 0,
  noTrustedResult: 0,   // search worked, nothing on an allowlisted domain
  emptyExtraction: 0,   // Gemini answered, but found no usable value
  noStoredHeadlines: 0, // no stored headline names the company, so no explanation
};

async function searchAndExtract(query, domains, instructionsPrompt) {
  queryAttempts++;
  let trusted;
  try {
    const results = await tavilySearch(query);
    trusted = results.filter((r) => hostAllowed(r.url, domains));
  } catch (err) {
    queryFailures++;
    outcomes.tavilyFail++;
    throw err;
  }
  // Not a failure - the domain allowlist working as intended. But it IS the
  // single most common reason this script produces nothing, so it is counted
  // rather than being invisible: a run with 0 findings and 0 failures used to
  // look identical to a run that simply had nothing to say.
  if (!trusted.length) {
    outcomes.noTrustedResult++;
    return { text: null, citations: [] };
  }
  const prompt = [
    instructionsPrompt,
    "",
    "Base your answer ONLY on the real search results below. Do not use any",
    "other knowledge you may have. If the answer isn't in these results, say",
    "so via the null value specified above rather than guessing.",
    "",
    buildSourcesBlock(trusted),
  ].join("\n");
  try {
    const text = await extractWithGemini(prompt);
    return { text, citations: trusted.map((r) => r.url) };
  } catch (err) {
    queryFailures++;
    outcomes.geminiFail++;
    throw err;
  }
}

// Tavily-only variant of searchAndExtract() above - no Gemini call. Used
// wherever a raw search snippet is good enough on its own (findExplanation()
// below), which is most of this script's Gemini call volume - see that
// function's own comment for why. Same queryAttempts/queryFailures
// bookkeeping and domain-trust filtering as searchAndExtract, just without
// the extraction step.
async function searchOnly(query, domains) {
  queryAttempts++;
  try {
    const results = await tavilySearch(query);
    const trusted = results.filter((r) => hostAllowed(r.url, domains));
    if (!trusted.length) outcomes.noTrustedResult++;
    return trusted;
  } catch (err) {
    queryFailures++;
    outcomes.tavilyFail++;
    throw err;
  }
}

// Gemini has no confirmed equivalent to Ollama's format:"json" constrained
// decoding - ask clearly for pure JSON in the prompt, but parse
// defensively: strip a possible code fence, and treat a parse failure as
// "no finding" rather than crashing the run, same failure-tolerance every
// extraction call here already has.
function parseJsonLoose(text) {
  const stripped = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(stripped);
  } catch {
    // Occasionally adds stray prose around the JSON despite being asked
    // for pure JSON - recover by pulling out the first balanced {...}
    // substring instead of discarding the finding.
    const start = stripped.indexOf("{");
    if (start === -1) return null;
    let depth = 0;
    for (let i = start; i < stripped.length; i++) {
      if (stripped[i] === "{") depth++;
      else if (stripped[i] === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(stripped.slice(start, i + 1));
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }
}

function validateFinding(raw) {
  if (!raw || typeof raw !== "object") return null;
  const price = Number(raw.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  const currency = typeof raw.currency === "string" && raw.currency.trim() ? raw.currency.trim().toUpperCase() : "USD";
  const confidence = Number.isFinite(Number(raw.confidence))
    ? Math.max(0, Math.min(1, Number(raw.confidence)))
    : 0.5;
  return { price: Math.round(price * 10000) / 10000, currency, confidence };
}

// ---- "Why did this move" explanation (Investments tab, best-effort) -------
// A real Gemini call, not a raw search-result snippet - tried the
// Gemini-free route first (2026-08-15) after discovering Gemini's free
// tier caps at just 20 requests/DAY (confirmed via the account's own AI
// Studio rate-limit dashboard, same across every viable free-tier text
// model - switching models doesn't raise it) and this step alone wanted a
// Gemini call per symbol. A raw Tavily snippet without Gemini's judgment
// turned out unreliable in practice, though - live testing found most
// results for a generic "{symbol} stock price today" search are a
// finance site's own quote-page dashboard chrome ("arrow_upward",
// "show_chartLine area_chartArea candlestick_chartCandle") or a data
// comparison table, not narrative, regardless of domain filtering - no
// amount of pattern-matching reliably told those apart from real article
// content the way Gemini's own prompt already did ("only if the results
// give an actual reason... set explanation to null rather than
// guessing"). Kept the Gemini call, but stopped calling it for every
// symbol - see MAX_GEMINI_EXPLANATIONS_PER_RUN below for how call volume
// actually gets kept under budget instead.
// Built from the REAL company-news headlines already stored against this
// symbol, not from a web search. See findExplanation() below for why.
function buildExplanationPrompt(symbol, headlines, companyName) {
  const who = companyName ? `${companyName} (${symbol})` : symbol;
  return [
    "You explain why a company's share price moved, based ONLY on the real",
    "news headlines listed below. They were published about this company on",
    "or around the day in question.",
    'Respond with ONLY a JSON object, no prose, no code fences. Use this',
    'exact shape: { "explanation": string|null, "confidence": number }',
    "",
    `The company is ${who}.`,
    "Headlines published about it:",
    ...headlines.map((h) => `- "${h.title}"${h.source ? ` (${h.source})` : ""}`),
    "",
    "explanation is a short, neutral, 1-2 sentence summary of what was being",
    "reported, only if these headlines give an actual substantive reason",
    "(earnings, a deal, a product, a regulatory decision, guidance).",
    "Say what was REPORTED. Never assert the reporting caused the price move,",
    "and never predict what the price will do next.",
    "Do not use any knowledge of this company beyond the headlines above.",
    "confidence is 0..1, how sure you are the reason is real and specific to",
    "this exact company. If the headlines are generic market roundups, a",
    "listicle, or say nothing substantive, set explanation to null rather",
    "than padding it out.",
  ].join("\n");
}

function validateExplanation(raw) {
  if (!raw || typeof raw !== "object") return null;
  const explanation = typeof raw.explanation === "string" && raw.explanation.trim() ? raw.explanation.trim() : null;
  if (!explanation) return null;
  const confidence = Number.isFinite(Number(raw.confidence))
    ? Math.max(0, Math.min(1, Number(raw.confidence)))
    : 0.5;
  return { explanation: plainDashes(explanation), confidence };
}

// One attempt per symbol per call (see callers for which symbols actually
// get one - not every symbol anymore). Every failure mode here is caught
// and logged, never thrown - this must never take down a run that
// otherwise found a valid price.
// Why a price moved, written from the real Finnhub /company-news headlines
// this script already stores against the symbol - NOT from a web search.
//
// It used to run a Tavily search for "{symbol} stock price today news"
// restricted to TRUSTED_NEWS_DOMAINS, which is mostly quote-page hosts
// (Yahoo Finance, MarketWatch, Nasdaq, Morningstar). Those pages are price
// dashboards, not narrative, so Gemini was handed chrome and honestly
// answered "no reason here" essentially every time: **0 of 192 findings in
// production ever carried an explanation.** The identical failure is already
// recorded in this file for the reverted stock-PRICE search experiment,
// against the same domain list.
//
// The headlines are strictly better input and cost nothing extra: they are
// already fetched, already stored, and inherently about the company rather
// than merely mentioning it. This also removes one Tavily search per
// explained symbol (5-7 per weekly run) and leaves the Gemini call as the
// only spend, which matters because that 20/day quota is shared with the
// daily recap summary.
//
// Headlines are passed IN rather than read here, so one latestHeadlinesBySymbol()
// round trip serves every symbol in a run instead of one query each.
async function findExplanation(symbol, headlines, companyName) {
  // Only headlines that actually name this company. /company-news guarantees
  // a story MENTIONS the ticker, never that it is about it - the same reason
  // pickRelevantHeadline() exists for the recap, and skipping that gate here
  // is how generic "which stocks are moving today" listicles used to become
  // the basis of an explanation.
  const relevant = (headlines || []).filter(
    (h) => h && h.title && headlineNamesCompany(h.title, symbol, companyName)
  );
  if (!relevant.length) {
    outcomes.noStoredHeadlines++;
    console.warn(`[${symbol}] no stored headline names this company - no explanation this run`);
    return null;
  }

  queryAttempts++;
  let text;
  try {
    text = await extractWithGemini(
      buildExplanationPrompt(symbol, relevant.slice(0, MAX_EXPLANATION_HEADLINES), companyName)
    );
  } catch (err) {
    queryFailures++;
    outcomes.geminiFail++;
    console.warn(`[${symbol}] explanation extraction failed: ${err.message}`);
    return null;
  }
  await sleep(REQUEST_DELAY_MS);

  const extracted = validateExplanation(parseJsonLoose(text));
  if (!extracted) outcomes.emptyExtraction++;
  return extracted ? extracted.explanation : null;
}


const NEWS_SENTIMENTS = new Set(["bullish", "neutral", "bearish"]);
const MAX_NEWS_HEADLINES = 5;


// The market news digest is built from the per-symbol company-news
// headlines this agent ALREADY stores every hour, not from Finnhub's
// general news feed.
//
// Two attempts at filtering that general feed both failed against real
// data, and the failures are worth recording so nobody tries a third:
//   1. Filtering by OUTLET (Reuters/CNBC/Bloomberg/...) returned Gaza
//      funding, an Iran/Siemens security warning and a cocktail-bar
//      feature. Those outlets publish everything; the masthead says
//      nothing about the topic.
//   2. Filtering on Finnhub's own `related` ticker tagging returned
//      literally ZERO articles - that field is simply not populated on
//      the general feed - and the adaptive fallback then produced Harry
//      and Meghan and the sale of the LA Lakers.
// A keyword heuristic on headline text is the obvious third idea and is
// deliberately NOT being tried: it was already attempted for stock-price
// pages earlier in this project and reverted as unreliable.
//
// /company-news?symbol=X is inherently about a tracked company, which is
// the property the general feed could never establish. So the digest is
// now "recent news across the stocks you track" and is labeled as exactly
// that in the UI - a narrower, honest claim rather than a broad one the
// data cannot support. Costs zero additional API calls: every headline
// here was already fetched and stored.
const MARKET_NEWS_SOURCES = new Set([
  "reuters", "cnbc", "bloomberg", "marketwatch", "seekingalpha", "benzinga",
  "yahoo", "barrons", "the wall street journal", "financial times",
]);

async function fetchTrackedStockNews() {
  const [bySymbol, { names: companyNames }] = await Promise.all([
    latestHeadlinesBySymbol(), loadMoversWatchlist(),
  ]);
  const seen = new Set();
  const items = [];
  // Newest symbol-batch first, so the digest leads with the freshest news.
  const entries = [...bySymbol.entries()].sort((a, b) =>
    String(b[1].found_at || "").localeCompare(String(a[1].found_at || ""))
  );
  for (const [symbol, row] of entries) {
    // The SAME relevance gate the recap uses, and for the same reason.
    // Taking headlines[0] here produced three generic aggregator listicles
    // out of five ("Which dow jones stocks are moving on Thursday?") -
    // /company-news guarantees a story MENTIONS the ticker, never that it
    // is about that company. A symbol with nothing genuinely about it is
    // skipped so the next one can fill the slot, rather than padding the
    // digest with filler.
    const picked = pickRelevantHeadline(symbol, row.headlines, seen, companyNames);
    if (!picked) continue;
    seen.add(picked.url);
    items.push({
      title: String(picked.title).trim(),
      url: String(picked.url).trim(),
      source: picked.source ? String(picked.source).trim() : null,
      symbol,
    });
    if (items.length >= MAX_NEWS_HEADLINES) break;
  }
  return items;
}

// Stage 1 (headlines) is free and LLM-free; stage 2 (sentiment) is one
// optional Gemini call layered on top. This is the same fix that took the
// daily recap from never-rendering to working every day, applied to the
// card that is STILL at zero rows for the identical reason: its single
// Gemini call kept losing the race for a 20-request daily quota shared
// with deal-agent, and validateNewsDigest() then threw away a digest full
// of real headlines because one optional field was missing.
async function findNewsDigest() {
  let headlines = [];
  try {
    headlines = await fetchTrackedStockNews();
  } catch (err) {
    console.warn(`Tracked-stock news lookup failed: ${err.message}`);
    return null;
  }
  if (!headlines.length) {
    console.warn("No stored company-news headlines yet - the hourly news fetch has not run.");
    return null;
  }

  let sentiment = null;
  let sentiment_reason = null;
  if (!DRY_RUN) {
    try {
      const text = await extractWithGemini(buildNewsSentimentPrompt(headlines));
      const parsed = parseJsonLoose(text);
      // sentiment_reason is Gemini free text shown to the user, exactly like
      // the recap summary, so it gets the exact same advice/forecast gate.
      // It previously had none at all - only a non-empty check - which meant
      // an advice-phrased reason would have passed straight through.
      // Reusing validateRecapSummary keeps one definition of that boundary
      // rather than a second copy that could drift.
      const reason = parsed && typeof parsed.sentiment_reason === "string"
        ? validateRecapSummary({ summary: parsed.sentiment_reason })
        : null;
      if (parsed && NEWS_SENTIMENTS.has(parsed.sentiment) && reason) {
        sentiment = parsed.sentiment;
        sentiment_reason = reason;
      } else if (parsed && !reason) {
        console.warn("Sentiment reason rejected - keeping the headlines without it.");
      }
    } catch (err) {
      console.warn(`News sentiment failed (non-fatal, keeping the headlines): ${err.message}`);
    }
  }

  console.log(`News digest: ${headlines.length} headline(s), sentiment ${sentiment ? "included" : "omitted"}.`);
  return {
    headlines,
    sentiment,
    sentiment_reason,
    source_query: "finnhub:company-news (tracked stocks)",
    extracted_by: sentiment ? "finnhub+gemini" : "finnhub",
  };
}

// Reads ONLY the headlines just fetched - never the model's own knowledge
// of the market, the same restraint every other extraction prompt here
// carries.
function buildNewsSentimentPrompt(headlines) {
  return [
    "You read recent news headlines about a handful of specific companies",
    "someone tracks, and characterise the tone of THAT coverage. Use ONLY",
    "the headlines listed below - do not use your own knowledge of what",
    "these companies or the wider market did.",
    "",
    "Your reader is a COMPLETE BEGINNER who has never invested and does not",
    "follow financial news. Write for them and nobody else.",
    'Respond with ONLY a JSON object, no prose, no code fences:',
    '{ "sentiment": "bullish"|"neutral"|"bearish", "sentiment_reason": string }',
    "",
    "Headlines:",
    ...headlines.map((h) => `- ${h.title} (${h.source || "unknown source"})`),
    "",
    "sentiment_reason must be one sentence grounded in these headlines.",
    "Never use an em dash or en dash. Use a plain hyphen instead.",
    "Rules:",
    "- These are a few companies' stories, NOT the market. Never say",
    "  anything about 'the market' or overall market sentiment - you are",
    "  describing the tone of this specific coverage only.",
    "- Describe what the coverage says. Never claim a headline CAUSED a",
    "  price move, and never say a stock rose or fell - you were not given",
    "  any prices.",
    "- Never recommend buying or selling and never predict what any price",
    "  will do next, even if a headline itself is phrased that way. Never",
    "  call anything cheap, expensive, undervalued or a good opportunity.",
    "- One short sentence in everyday words. No jargon a beginner would not",
    "  know - no 'equities', 'valuation', 'bullish momentum', 'the street'.",
    "  If you must use a term like that, explain it in the same breath.",
  ].join("\n");
}

// ---- Finnhub: direct stock-ticker quotes, no search/LLM needed --------
async function fetchFinnhubQuote(symbol) {
  if (finnhubCallCount >= MAX_FINNHUB_CALLS_PER_RUN) {
    throw new Error(`Finnhub call budget (${MAX_FINNHUB_CALLS_PER_RUN}/run) exceeded - skipping`);
  }
  finnhubCallCount++;
  const url = `${FINNHUB_URL}?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_API_KEY}`;
  const res = await fetchWithRetry(url, {}, SEARCH_TIMEOUT_MS);
  if (!res.ok) throw new Error(`Finnhub HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json(); // { c, d, dp, h, l, o, pc, t }
}

// Finnhub returns c: 0 (not an error status) for an invalid/unknown
// symbol - a real, documented behavior, not a hypothetical edge case.
const r4 = (n) => {
  const num = Number(n);
  return Number.isFinite(num) && num > 0 ? Math.round(num * 10000) / 10000 : null;
};

// The TRADING day for a quote, in America/New_York, derived from Finnhub's
// own `t` (last-trade epoch seconds) rather than the server's clock. This
// is what keeps a weekend or after-hours run from inventing a candle: a
// Saturday run gets Friday's still-current quote back, and keying that to
// "today" would create a Saturday row for a day that never traded. Returns
// null rather than guessing when `t` is missing, so the caller can skip the
// rollup for that symbol instead of writing a row against a wrong date.
// en-CA formats as YYYY-MM-DD, which is already the shape Postgres wants.
function tradeDateFromQuote(raw) {
  const epochSeconds = Number(raw && raw.t);
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(epochSeconds * 1000));
}

function validateFinnhubQuote(raw) {
  const price = r4(raw && raw.c);
  if (price === null) return null;
  // o/h/l/pc ride along on the same response at no extra cost and are what
  // daily_prices (54_daily_prices.sql) is built from - this used to keep
  // only `c` and throw a complete daily candle away on every call. Each is
  // independently nullable: a thinly traded symbol can legitimately return
  // 0 for some of them, which r4() maps to null rather than a fake zero.
  return {
    price,
    open: r4(raw.o),
    high: r4(raw.h),
    low: r4(raw.l),
    previousClose: r4(raw.pc),
    tradeDate: tradeDateFromQuote(raw),
  };
}

// ---- Finnhub: real per-symbol news headlines, no LLM step needed ------
// This is Finnhub's own curated news product, not an open-web search -
// same authoritative-source tier as /quote (extracted_by: "finnhub",
// confidence: 1 already established for the price half of the same row),
// so no TRUSTED_NEWS_DOMAINS filter is needed here the way findExplanation()
// needs one for a raw Tavily search.
const MAX_COMPANY_NEWS_HEADLINES = 3; // distinct from MAX_NEWS_HEADLINES below (unrelated market-wide digest)
async function fetchFinnhubCompanyNews(symbol) {
  if (finnhubNewsCallCount >= MAX_FINNHUB_NEWS_CALLS_PER_RUN) {
    throw new Error(`Finnhub company-news call budget (${MAX_FINNHUB_NEWS_CALLS_PER_RUN}/run) exceeded - skipping`);
  }
  finnhubNewsCallCount++;
  const to = new Date();
  const from = new Date(to.getTime() - 2 * 24 * 60 * 60 * 1000); // last 2 days
  const fmt = (d) => d.toISOString().slice(0, 10);
  const url = `${FINNHUB_NEWS_URL}?symbol=${encodeURIComponent(symbol)}&from=${fmt(from)}&to=${fmt(to)}&token=${FINNHUB_API_KEY}`;
  const res = await fetchWithRetry(url, {}, SEARCH_TIMEOUT_MS);
  if (!res.ok) throw new Error(`Finnhub company-news HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json(); // [{ headline, url, source, datetime, summary, category, id }, ...]
}

function validateFinnhubNews(raw) {
  if (!Array.isArray(raw)) return null;
  const headlines = raw
    .filter((a) => a && typeof a.headline === "string" && a.headline.trim() && typeof a.url === "string" && a.url.trim())
    .sort((a, b) => Number(b.datetime || 0) - Number(a.datetime || 0))
    .slice(0, MAX_COMPANY_NEWS_HEADLINES)
    .map((a) => ({
      title: a.headline.trim(),
      url: a.url.trim(),
      source: typeof a.source === "string" && a.source.trim() ? a.source.trim() : null,
    }));
  return headlines.length ? headlines : null;
}

// Real stock tickers only (the user's own asset watchlist and
// the movers watchlist) - see the header comment for why
// MARKET_INDEXES stays on processSymbol()/Tavily+Gemini below instead.
// Price only, no explanation - split out from the original combined
// function so main() can fetch every symbol's price first, THEN decide
// which ones are worth a Gemini explanation call (see
// MAX_GEMINI_EXPLANATIONS_PER_RUN below). Returns null on any failure,
// same graceful-skip behavior as before, just without an explanation
// attached yet. absDayChangePercent (from Finnhub's own `dp` field,
// already part of the same quote response - no extra call) is what the
// ranking is based on; it's never written to the DB, only used to sort.
async function fetchFinnhubFinding(symbol, fetchNews) {
  queryAttempts++;
  let raw;
  try {
    raw = await fetchFinnhubQuote(symbol);
  } catch (err) {
    queryFailures++;
    outcomes.finnhubFail++;
    console.warn(`[${symbol}] Finnhub quote failed: ${err.message}`);
    return null;
  }
  const extracted = validateFinnhubQuote(raw);
  if (!extracted) {
    console.warn(`[${symbol}] Finnhub returned no valid price - discarding`);
    return null;
  }
  // Best-effort, same graceful-degrade posture findExplanation() already
  // has - a failed/empty news call must never block the price write.
  let headlines = null;
  if (fetchNews) {
    try {
      headlines = validateFinnhubNews(await fetchFinnhubCompanyNews(symbol));
    } catch (err) {
      console.warn(`[${symbol}] Finnhub company-news failed: ${err.message}`);
    }
  }
  return {
    finding: {
      symbol,
      price: extracted.price,
      currency: "USD",
      url: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`,
      source_query: "finnhub:quote",
      raw_snippet: null,
      confidence: 1,
      extracted_by: "finnhub",
      explanation: null,
      headlines,
    },
    absDayChangePercent: Number.isFinite(Number(raw.dp)) ? Math.abs(Number(raw.dp)) : 0,
    // Skipped entirely when the quote carried no usable timestamp - a
    // candle filed against a guessed date is worse than no candle.
    dailyCandle: extracted.tradeDate
      ? {
          symbol,
          trade_date: extracted.tradeDate,
          open: extracted.open,
          high: extracted.high,
          low: extracted.low,
          close: extracted.price,
          previous_close: extracted.previousClose,
          updated_at: new Date().toISOString(),
        }
      : null,
  };
}

async function fetchFinnhubFindings(symbols, checkBudgetFn, fetchNews) {
  const results = [];
  for (const symbol of symbols) {
    if (checkBudgetFn && checkBudgetFn()) break;
    const result = await fetchFinnhubFinding(symbol, fetchNews);
    if (result) results.push(result);
  }
  return results;
}

// Only the biggest movers get a real Gemini explanation call - a stock
// that barely moved usually has no "why" story worth finding anyway, so
// this isn't just a call-volume cut, it's spending the tiny Gemini budget
// where an explanation is actually likely to exist. Added 2026-08-15
// after the Gemini-free raw-snippet approach (see findExplanation's own
// comment) turned out unreliable in practice - restores real Gemini
// judgment, just no longer unconditionally for all 20 fixed watchlist
// symbols every run.
// Enough context for a real reason without inflating a prompt that runs
// once per explained symbol against a 20/day quota.
const MAX_EXPLANATION_HEADLINES = 6;

const MAX_GEMINI_EXPLANATIONS_PER_RUN = 5;

async function attachTopMoverExplanations(results) {
  const ranked = [...results].sort((a, b) => b.absDayChangePercent - a.absDayChangePercent);
  const slice = ranked.slice(0, MAX_GEMINI_EXPLANATIONS_PER_RUN);
  if (!slice.length) return;
  // One round trip for every symbol in the slice, not one each.
  const [bySymbol, { names }] = await Promise.all([latestHeadlinesBySymbol(), loadMoversWatchlist()]);
  for (const { finding } of slice) {
    const sym = (finding.symbol || "").toUpperCase();
    const stored = bySymbol.get(sym);
    const explanation = await findExplanation(finding.symbol, stored && stored.headlines, names[sym]);
    if (explanation) finding.explanation = explanation;
  }
}

// ---- Market indexes pipeline (MARKET_INDEXES only - see header comment) --
// One combined Gemini call for ALL indexes, not one per index x per query
// angle (8 separate calls in the original design) - this is the other half
// of the Gemini-quota fix alongside findExplanation() above going Tavily-
// only. Tavily search itself isn't the constraint (its free tier is
// 1,000 credits/month, comfortable at this project's size) - only Gemini's
// 20-requests/day ceiling is, so the searches still run one per index per
// query angle as before; only the EXTRACTION step is consolidated into a
// single prompt covering every index at once, each source clearly labeled
// with which index it's about so Gemini can keep them straight.
function buildBatchedIndexPrompt(indexes, sourcesByIndex) {
  const sections = indexes
    .map((index) => sourcesByIndex[index]
      .map((r, i) => `[${index} - Source ${i + 1}: ${r.url}]\n${r.content}`)
      .join("\n\n"))
    .join("\n\n---\n\n");
  return [
    "You are extracting current market price levels for these market indexes:",
    indexes.map((i) => `"${i}"`).join(", "),
    "from the real search results below, each one labeled with which index",
    "it's about.",
    "Respond with ONLY a JSON object, no prose, no code fences. Use this",
    "exact shape, with one entry per index name exactly as given above:",
    `{ ${indexes.map((i) => `"${i}": { "price": number|null, "currency": string|null, "confidence": number }`).join(", ")} }`,
    "confidence is 0..1, how sure you are this is today's current level of",
    "that exact index. Base each index's answer ONLY on the results labeled",
    "for that index below - do not mix sources between indexes, and do not",
    "use any other knowledge you may have. If an index has no clear current",
    "price in its labeled results, set that index's price to null rather",
    "than guessing.",
    "",
    sections,
  ].join("\n");
}

async function processAllIndexes() {
  const sourcesByIndex = {};
  for (const index of MARKET_INDEXES) {
    sourcesByIndex[index] = [];
    for (const query of buildQueries(index)) {
      let trusted;
      try {
        trusted = await searchOnly(query, TRUSTED_PRICE_DOMAINS);
      } catch (err) {
        console.warn(`[${index}] search failed for "${query}": ${err.message}`);
        continue;
      }
      await sleep(REQUEST_DELAY_MS);
      sourcesByIndex[index].push(...trusted);
    }
  }

  const indexesWithSources = MARKET_INDEXES.filter((index) => sourcesByIndex[index].length);
  if (!indexesWithSources.length) {
    console.warn("No trusted-domain results for any market index - skipping extraction.");
    return [];
  }

  queryAttempts++;
  let text;
  try {
    text = await extractWithGemini(buildBatchedIndexPrompt(indexesWithSources, sourcesByIndex));
  } catch (err) {
    queryFailures++;
    outcomes.geminiFail++;
    console.warn(`Batched index price extraction failed: ${err.message}`);
    return [];
  }
  await sleep(REQUEST_DELAY_MS);

  const raw = parseJsonLoose(text);
  const findings = [];
  for (const index of indexesWithSources) {
    const extracted = validateFinding(raw && typeof raw === "object" ? raw[index] : null);
    if (!extracted) continue;
    findings.push({
      symbol: index,
      price: extracted.price,
      currency: extracted.currency,
      url: sourcesByIndex[index][0].url,
      source_query: "batched-index-extraction",
      raw_snippet: null,
      confidence: extracted.confidence,
      extracted_by: "gemini",
      explanation: null,
      // Overrides market_index_findings' 2-day column default, which is
      // written for the FAST_ONLY ticker stream (~2,300 rows/day, where a
      // short TTL is what keeps the table bounded). These four rows are
      // written WEEKLY, so the default guaranteed they were purged about
      // two days after each run and the Market overview card then showed
      // "index level not available yet" for the remaining five - which is
      // exactly what production did: zero index-label rows had ever
      // survived, while the 15-minute ETF proxy rows beside them were
      // always fine. A weekly row needs to outlive its own cadence.
      expires_at: new Date(Date.now() + INDEX_LEVEL_TTL_MS).toISOString(),
    });
  }

  // No explanation pass here any more. Explanations are now written from
  // Finnhub /company-news, and an index label ("S&P 500") is not a company
  // Finnhub covers - there is no headline set to reason from, so calling it
  // would spend a Gemini request to produce null every time. The index
  // level itself is unaffected; the market-wide "why" now lives on the
  // daily recap's context_headlines instead.
  return findings;
}

// ---- Market indexes (docs/ROADMAP.md's Investments tab, Daily overview) --
// Fixed - unlike the per-user watchlist above, a market index isn't
// something anyone "holds," so this always runs every time regardless of
// what any user's assets.price_symbol contains. Mirror this list in
// app.js's own MARKET_INDEXES if it ever changes - this file has no
// import/export machinery to share it with app/*.js, same as
// TRUSTED_PRICE_DOMAINS already has no client-side counterpart either.
const MARKET_INDEXES = ["S&P 500", "Dow Jones Industrial Average", "NASDAQ Composite", "Russell 2000"];

// Slightly longer than the weekly cadence that writes these, so a run
// firing a little late never leaves a gap with no index level at all. Only
// four rows a week, so this costs nothing against the row-growth concern
// that justifies the 2-day default for the high-frequency ticker stream.
const INDEX_LEVEL_TTL_MS = 8 * 24 * 60 * 60 * 1000;

// ---- Market movers watchlist (Investments tab, "Today's top movers") -----
// A fixed, curated list of well-known large-cap stocks - NOT each user's
// own holdings (that's the per-user watchlist above) - so the UI can rank
// "today's biggest movers" even for a user who holds nothing. Same category
// as MARKET_INDEXES immediately above (public market data, tied to no
// user), so it's searched the same way and written to the SAME
// market_index_findings table rather than a new one. Must match app.js's
// own default watchlist constant. Both are now only a FALLBACK and a
// seed - the live list lives in watchlist_symbols and is user-editable.
const DEFAULT_MOVERS_WATCHLIST = [
  "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "JPM", "V", "UNH",
  "XOM", "JNJ", "WMT", "PG", "MA", "HD", "DIS", "NFLX", "AMD", "KO",
];

// ---- Market index ETF proxies (Investments tab, Market overview, live) ---
// Added 2026-08-16: MARKET_INDEXES above only ever gets a real price via
// the constrained weekly Tavily+Gemini pipeline, which can go stale for
// a while if that pipeline's own Gemini call gets crowded out by
// deal-agent.js sharing the same daily quota. Confirmed live that raw
// index tickers (^GSPC/^DJI/^IXIC/^RUT) require a paid Finnhub
// subscription ("Market data subscription required for CFD indices" - a
// real API response, not assumed) - but these four highly liquid ETFs
// that closely track the same four indexes work on the free tier, no
// search/LLM step needed, same as any real stock ticker. Written to
// market_index_findings under the ETF's OWN ticker as `symbol` -
// deliberately never under the index's own plain-English label (see
// app.js's MARKET_INDEX_ETF_PROXIES comment for why mixing the two would
// corrupt day-change math). Must match app.js's own copy, kept in sync
// by hand for the same reason MARKET_INDEXES already is.
// Seeds watchlist_symbols.company_name, and needed for exactly
// one job: deciding whether a stored headline is actually ABOUT the symbol
// it was filed under. Finnhub's /company-news returns articles that merely
// MENTION a ticker, which in practice is dominated by aggregator filler
// ("Discover which dow jones stocks are making waves on Thursday"). Checked
// against real production data: taking the first headline for the day's top
// 5 movers gave 0 of 5 that actually named the company, including a TSLA
// row whose headline was about Canadian aluminum tariffs and two different
// movers sharing one generic listicle. Matching on the company name as well
// as the ticker took that to 3 of 5 genuinely relevant, with the other 2
// correctly showing nothing.
// Lowercase; matched as a substring against a lowercased headline title.
const DEFAULT_MOVER_COMPANY_NAMES = {
  AAPL: "apple", MSFT: "microsoft", GOOGL: "alphabet", AMZN: "amazon", NVDA: "nvidia",
  META: "meta", TSLA: "tesla", JPM: "jpmorgan", V: "visa", UNH: "unitedhealth",
  XOM: "exxon", JNJ: "johnson", WMT: "walmart", PG: "procter", MA: "mastercard",
  HD: "home depot", DIS: "disney", NFLX: "netflix", AMD: "amd", KO: "coca-cola",
};

const MARKET_INDEX_ETF_PROXIES = { "S&P 500": "SPY", "Dow Jones Industrial Average": "DIA", "NASDAQ Composite": "QQQ", "Russell 2000": "IWM" };

// ---- Main ----------------------------------------------------------------
async function main() {
  requireEnv();
  // Returns before any watchlist loading or outbound call - the recap is
  // built purely from what previous runs already stored.
  if (RECAP_ONLY) {
    console.log("RECAP_ONLY=1: daily job - stored recap, market news digest, fundamentals refresh.");
    // The recap itself still makes ZERO outbound calls and is built purely
    // from what earlier runs stored - that property is what makes it
    // un-rate-limitable and must not be given up. The two steps after it
    // are separate cards with their own graceful degradation, not part of
    // the recap.
    // Fetched OUTSIDE buildDailyRecap on purpose. That function's zero-
    // outbound-call property is what makes the recap un-rate-limitable, and
    // it is load-bearing - so the one network call lives here and the result
    // is handed in. An empty array means buildDailyRecap behaves exactly as
    // it did before this feature existed.
    const contextHeadlines = await findMarketContext();
    await buildDailyRecap(contextHeadlines);

    // Moved here from the weekly run: a DAILY news digest on a weekly
    // cadence was never the right shape, and it only sat in the weekly job
    // because it used to need Tavily. Now that headlines come free from
    // Finnhub it belongs on the daily schedule.
    try {
      const digest = await findNewsDigest();
      if (digest) {
        await sbInsert("market_news_findings", [digest]);
        console.log(`${DRY_RUN ? "Would have written" : "Wrote"} market news digest.`);
      }
    } catch (err) {
      console.warn(`News digest failed (non-fatal): ${err.message}`);
    }

    // Market-wide movers: the one part of this app that can see a stock
    // outside the tracked list. Runs before fundamentals so the movers'
    // own symbols are included in that refresh.
    try {
      const latest = await sbGet("daily_prices?select=trade_date&order=trade_date.desc&limit=1");
      const tradeDate = latest.length ? latest[0].trade_date : new Date().toISOString().slice(0, 10);
      await buildMarketMovers(tradeDate);
    } catch (err) {
      console.warn(`Market movers step failed (non-fatal): ${err.message}`);
    }

    // Daily matches FUNDAMENTALS_MAX_AGE_MS - quarterly-filing data has no
    // business being re-fetched every 15 minutes.
    try {
      const [ownSymbols, { symbols: moverSymbols }] = await Promise.all([
        loadWatchlist(), loadMoversWatchlist(),
      ]);
      await refreshFundamentals([...new Set([...ownSymbols.map((s) => s.toUpperCase()), ...moverSymbols])]);
    } catch (err) {
      console.warn(`Fundamentals refresh failed (non-fatal): ${err.message}`);
    }

    await writeRunStatus();
    return;
  }
  if (FAST_ONLY) console.log("FAST_ONLY=1: Finnhub-only run, skipping every Tavily/Gemini step.");
  const fetchNewsThisRun = shouldFetchNewsThisRun();
  if (fetchNewsThisRun) console.log("Also fetching real per-symbol news headlines this run (Finnhub company-news, roughly hourly).");

  const watchlist = await loadWatchlist();
  const { symbols: moversWatchlist } = await loadMoversWatchlist();
  console.log(`Watchlist (${watchlist.length}): ${watchlist.join(", ")}`);
  console.log(`Market indexes (${MARKET_INDEXES.length}): ${MARKET_INDEXES.join(", ")}`);
  console.log(`Market movers watchlist (${moversWatchlist.length}): ${moversWatchlist.join(", ")}`);

  if (!watchlist.length && !MARKET_INDEXES.length && !moversWatchlist.length) {
    console.log("Nothing to search for. Exiting.");
    return;
  }

  // Shared across all three loops below - once the run-wide Tavily budget
  // is hit, stop starting new symbols anywhere and write whatever findings
  // already exist rather than letting every remaining symbol fail
  // one-by-one with the same error.
  let budgetHit = false;
  function checkBudget() {
    if (tavilyCallCount >= MAX_TAVILY_CALLS_PER_RUN) {
      if (!budgetHit) {
        console.warn(`Tavily call budget (${MAX_TAVILY_CALLS_PER_RUN}/run) reached - stopping early, writing what was already found.`);
        budgetHit = true;
      }
      return true;
    }
    return false;
  }

  // Separate from checkBudget() above (Tavily) - the watchlist/movers
  // findings below run on Finnhub as their primary resource now, a fully
  // independent budget. Tavily exhaustion is still handled gracefully
  // inside findExplanation() itself (returns null, logs a warning, doesn't
  // block the price write), so it doesn't need a second gate here too.
  let finnhubBudgetHit = false;
  function checkFinnhubBudget() {
    if (finnhubCallCount >= MAX_FINNHUB_CALLS_PER_RUN) {
      if (!finnhubBudgetHit) {
        console.warn(`Finnhub call budget (${MAX_FINNHUB_CALLS_PER_RUN}/run) reached - stopping early, writing what was already found.`);
        finnhubBudgetHit = true;
      }
      return true;
    }
    return false;
  }

  // A user's own tracked symbols get a Gemini explanation unconditionally
  // (not ranked against MAX_GEMINI_EXPLANATIONS_PER_RUN below) - this list
  // is personal and, realistically, small (today: 1 symbol across all
  // users), unlike the fixed 20-symbol movers watchlist the ranking below
  // exists for. If this ever grows large, redo this math the same way the
  // header comment already asks for future watchlist growth generally.
  const watchlistPriced = await fetchFinnhubFindings(watchlist, checkFinnhubBudget, fetchNewsThisRun);
  if (FAST_ONLY) {
    console.log("FAST_ONLY: skipping watchlist explanations (Gemini) this run.");
  } else {
    const [bySymbol, { names }] = await Promise.all([latestHeadlinesBySymbol(), loadMoversWatchlist()]);
    for (const { finding } of watchlistPriced) {
      const sym = (finding.symbol || "").toUpperCase();
      const stored = bySymbol.get(sym);
      const explanation = await findExplanation(finding.symbol, stored && stored.headlines, names[sym]);
      if (explanation) finding.explanation = explanation;
    }
  }
  const allFindings = watchlistPriced.map((r) => r.finding);
  if (allFindings.length) {
    await sbInsert("asset_price_findings", allFindings);
    console.log(`${DRY_RUN ? "Would have written" : "Wrote"} ${allFindings.length} finding(s) to asset_price_findings.`);
  } else {
    console.log("No asset findings this run.");
  }

  let allIndexFindings = [];
  if (FAST_ONLY) {
    console.log("FAST_ONLY: skipping market indexes (Tavily+Gemini) this run.");
  } else {
    console.log(`Searching indexes (batched): ${MARKET_INDEXES.join(", ")}`);
    allIndexFindings = await processAllIndexes();
    console.log(`  -> ${allIndexFindings.length} finding(s)`);
  }

  console.log(`Fetching movers (Finnhub): ${moversWatchlist.join(", ")}`);
  const moversPriced = await fetchFinnhubFindings(moversWatchlist, checkFinnhubBudget, fetchNewsThisRun);
  if (FAST_ONLY) {
    console.log(`  -> ${moversPriced.length} priced. FAST_ONLY: skipping mover explanations (Gemini) this run.`);
  } else {
    console.log(`  -> ${moversPriced.length} priced, explaining the top ${MAX_GEMINI_EXPLANATIONS_PER_RUN} movers by day change`);
    await attachTopMoverExplanations(moversPriced);
  }
  allIndexFindings.push(...moversPriced.map((r) => r.finding));

  // ETF proxies for the 4 indexes - real Finnhub quotes, no search/LLM
  // step, runs every time (FAST_ONLY and full) since it's the same cheap
  // per-symbol Finnhub cost as any real ticker. No news headlines for
  // these - out of scope for "does the market overview number update,"
  // and an ETF isn't a "company" Finnhub's company-news product covers
  // meaningfully anyway.
  const etfTickers = Object.values(MARKET_INDEX_ETF_PROXIES);
  console.log(`Fetching index ETF proxies (Finnhub): ${etfTickers.join(", ")}`);
  const etfPriced = await fetchFinnhubFindings(etfTickers, checkFinnhubBudget, false);
  console.log(`  -> ${etfPriced.length} priced`);
  allIndexFindings.push(...etfPriced.map((r) => r.finding));
  if (allIndexFindings.length) {
    await sbInsert("market_index_findings", allIndexFindings);
    console.log(`${DRY_RUN ? "Would have written" : "Wrote"} ${allIndexFindings.length} finding(s) to market_index_findings (indexes + movers watchlist).`);
  } else {
    console.log("No market index or movers findings this run.");
  }

  // The market news digest deliberately does NOT run here any more - it
  // moved to the daily RECAP_ONLY job above, where a daily digest belongs.
  // Leaving it here too would just write a duplicate row every Wednesday.

  // Every Finnhub-quoted symbol from all three loops above, rolled into
  // the durable daily series. Runs before the purge, which only ever
  // touches the short-lived findings tables - this is the data that has
  // to outlive them.
  await writeDailyCandles([...watchlistPriced, ...moversPriced, ...etfPriced]);

  await purgeExpiredFindings();
  await writeRunStatus();
}

main().catch(async (err) => {
  console.error("Agent run failed:", err);
  await writeRunStatus(err);
  process.exit(1);
});
