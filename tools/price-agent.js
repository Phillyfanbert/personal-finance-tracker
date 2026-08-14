#!/usr/bin/env node
// ============================================================================
// Live asset price agent (docs/ROADMAP.md Assets #4). Same architecture as
// tools/deal-agent.js (F6), reused rather than duplicated conceptually -
// runs on the SERVER MACHINE ONLY, needs the Supabase SERVICE_ROLE key -
// keep that out of the repo (env var only).
//
// Uses Tavily for live web search and the Gemini API (plain generateContent,
// no grounding tool) for extraction - not local Ollama, deliberately, and
// not as a fallback alongside it. This script only ever handles public
// market data (a ticker symbol's price, a market index level) - never a
// specific user's personal financial data - so it doesn't need to stay on
// the home-hosted model the way app/gemma.js's real expense/Q&A paths must.
// See CLAUDE.md's data model section for the durable version of this
// privacy boundary - which scripts may use a cloud LLM and which must
// never.
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
// own general knowledge. This is the same two-step shape the original
// SearXNG+local-Gemma pipeline always had, just with different providers
// for each half, and it happens to also solve the original motivation for
// moving off the home Mac at all: extraction now runs in Google's cloud
// instead of competing with the home Ollama instance's generation model
// for RAM.
//
// What it does, per distinct assets.price_symbol in use across all users
// (a symbol's price is a public fact, not user-specific - same reasoning
// deal_findings already uses for service prices):
//   1. For each of a few query angles, search Tavily for real, current web
//      results.
//   2. Filter those results down to ones on TRUSTED_PRICE_DOMAINS BEFORE
//      Gemini ever sees them - the same "never trust an unverified source"
//      posture docs/F6-live-deals-proposal.md's Option C established,
//      applied as a pre-filter here (Tavily returns real result URLs
//      directly, unlike a grounding tool's internal search).
//   3. Ask Gemini to extract strict JSON price data ONLY from the real,
//      trusted-domain content just fetched - explicitly instructed not to
//      draw on anything else.
//   4. If a price was found, one more best-effort step: ask for a short
//      neutral explanation of why the price moved today
//      (TRUSTED_NEWS_DOMAINS, a superset of the price allowlist). One
//      attempt per symbol per run, not per price-finding row. Failure here
//      never blocks the price write itself; explanation just stays null.
//   5. Write validated findings to asset_price_findings via the REST API
//      using the service_role key (bypasses RLS by design).
//
// Also runs the exact same pipeline against a small FIXED list of major
// market indexes (MARKET_INDEXES below) and a curated large-cap watchlist
// (MARKET_MOVERS_WATCHLIST), writing to market_index_findings instead
// (Investments tab).
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
// Scheduling: tools/setup-server-machine.sh installs this as a WEEKLY
// launchd job (com.price-agent.weekly), same cadence as deal-agent.js -
// deliberately not daily, despite an earlier version of this comment
// musing that a price probably wants a tighter interval. Verified real
// math instead of going with that guess: at current watchlist sizes (1
// user-owned asset symbol + 4 fixed indexes + 20 fixed movers, 2 price
// queries each + up to 1 explanation query each = up to 75 Tavily calls,
// plus 1 more fixed call/run for the daily market news digest below = up
// to 76 Tavily calls worst case per run) plus deal-agent.js's own usage,
// combined monthly Tavily usage on the weekly schedule comes out around
// 200-370 credits/month even in the worst case - comfortably under
// Tavily's free 1,000/month, with real margin for
// MARKET_MOVERS_WATCHLIST or a user's own asset list growing later.
// MAX_TAVILY_CALLS_PER_RUN below is a hard safety cap for that
// future-growth case specifically, not because today's sizes are
// actually close to the limit. If this ever moves to a
// tighter interval, redo this math first - don't just switch the plist.
// ============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = !!process.env.DRY_RUN;

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
// header), but because nothing today stops MARKET_MOVERS_WATCHLIST or a
// user's own asset watchlist from growing later. 100 calls/run x 2
// scripts x ~4.33 weekly runs/month = ~866/month worst case even if both
// scripts hit their cap every run - still under budget with margin. Once
// hit, the run stops starting new symbols and writes whatever findings it
// already has rather than continuing to burn quota.
const MAX_TAVILY_CALLS_PER_RUN = 100;
let tavilyCallCount = 0;

function requireEnv() {
  const missing = ["SUPABASE_URL"].filter((k) => !process.env[k]);
  if (!DRY_RUN) missing.push(...(!SERVICE_ROLE_KEY ? ["SUPABASE_SERVICE_ROLE_KEY"] : []));
  if (!TAVILY_API_KEY) missing.push("TAVILY_API_KEY");
  if (!GEMINI_API_KEY) missing.push("GEMINI_API_KEY");
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

// Best-effort - a failure to write run status must never crash the run or
// mask whatever real findings were already written. See queryAttempts/
// queryFailures above (tracked inside searchAndExtract()) for what this
// is based on; "no trusted-domain result" doesn't count as a failure
// here, only a real thrown API/network error does.
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
    detail = `${queryFailures} of ${queryAttempts} live searches failed this run (rate limits or timeouts) - some data may be stale or incomplete.`;
  } else {
    status = "failed";
    detail = `All ${queryAttempts} live searches failed this run - data may be significantly stale.`;
  }
  try {
    await sbUpsert("agent_run_status", {
      agent: "price-agent",
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

function buildQueries(symbol) {
  return [`${symbol} price today`, `${symbol} current price USD`];
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

async function searchAndExtract(query, domains, instructionsPrompt) {
  queryAttempts++;
  try {
    const results = await tavilySearch(query);
    const trusted = results.filter((r) => hostAllowed(r.url, domains));
    if (!trusted.length) {
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
    const text = await extractWithGemini(prompt);
    return { text, citations: trusted.map((r) => r.url) };
  } catch (err) {
    queryFailures++;
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

function buildExtractionPrompt(symbol) {
  return [
    `You are extracting a current market price for the symbol "${symbol}"`,
    "from the real search results provided below.",
    "Respond with ONLY a JSON object, no prose, no code fences. Use this exact shape:",
    '{ "price": number|null, "currency": string|null, "confidence": number }',
    "confidence is 0..1, how sure you are this is the current price of this exact",
    "symbol (not a different, similarly-named one).",
    "If you cannot find a clear current price in the results, set price to null.",
  ].join("\n");
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
function buildExplanationPrompt(symbol) {
  return [
    `You explain why a stock or crypto price moved, based only on the real`,
    "search results provided below.",
    'Respond with ONLY a JSON object, no prose, no code fences. Use this',
    'exact shape: { "explanation": string|null, "confidence": number }',
    `The symbol is "${symbol}". explanation should be a short, neutral,`,
    "1-2 sentence summary of why the price moved today, only if the results",
    "give an actual reason (earnings, news, a market-wide move, etc).",
    "confidence is 0..1, how sure you are this reason is real and specific",
    "to this exact symbol. If there's no clear reason in the results, set",
    "explanation to null rather than guessing.",
  ].join("\n");
}

function validateExplanation(raw) {
  if (!raw || typeof raw !== "object") return null;
  const explanation = typeof raw.explanation === "string" && raw.explanation.trim() ? raw.explanation.trim() : null;
  if (!explanation) return null;
  const confidence = Number.isFinite(Number(raw.confidence))
    ? Math.max(0, Math.min(1, Number(raw.confidence)))
    : 0.5;
  return { explanation, confidence };
}

// One attempt per symbol per run (not per price-finding row - see the
// header comment). Every failure mode here is caught and logged, never
// thrown - this must never take down a run that otherwise found a valid
// price.
async function findExplanation(symbol) {
  let result;
  try {
    result = await searchAndExtract(`${symbol} stock price today news`, TRUSTED_NEWS_DOMAINS, buildExplanationPrompt(symbol));
  } catch (err) {
    console.warn(`[${symbol}] explanation search failed: ${err.message}`);
    return null;
  }
  await sleep(REQUEST_DELAY_MS);

  if (!result.text) {
    console.warn(`[${symbol}] no trusted-domain result for explanation - discarding`);
    return null;
  }
  const extracted = validateExplanation(parseJsonLoose(result.text));
  return extracted ? extracted.explanation : null;
}

// ---- Daily market news digest + sentiment (Investments tab, best-effort) --
// Genuinely NOT tied to any user or symbol - general market news, not a
// per-stock explanation. One query, one extraction call covers both the
// headlines and the overall sentiment read, since sentiment here IS the
// overall tone of that same day's headline coverage - splitting this into
// two calls would double the cost for no real benefit.
function buildNewsDigestPrompt() {
  return [
    "You are summarizing today's general stock market news and overall",
    "sentiment, based only on the real search results provided below.",
    'Respond with ONLY a JSON object, no prose, no code fences. Use this',
    'exact shape: { "headlines": [{ "title": string, "url": string,',
    '"source": string|null }], "sentiment": "bullish"|"neutral"|"bearish",',
    '"sentiment_reason": string }',
    "headlines: up to 5 real headlines actually present in the results",
    "below, about the broad market (not a single company). sentiment: your",
    "read of the OVERALL tone of the results below, not a prediction.",
    "sentiment_reason: one short, neutral sentence citing what in the",
    "results supports that read. If the results don't give a clear enough",
    "picture to pick a sentiment, use \"neutral\". This is a summary of",
    "existing news coverage, never a recommendation to buy or sell.",
  ].join("\n");
}

const NEWS_SENTIMENTS = new Set(["bullish", "neutral", "bearish"]);
const MAX_NEWS_HEADLINES = 5;

function validateNewsDigest(raw, sourceQuery) {
  if (!raw || typeof raw !== "object") return null;
  const headlines = Array.isArray(raw.headlines)
    ? raw.headlines
        .filter((h) => h && typeof h.title === "string" && h.title.trim() && typeof h.url === "string" && h.url.trim())
        .map((h) => ({
          title: h.title.trim(),
          url: h.url.trim(),
          source: typeof h.source === "string" && h.source.trim() ? h.source.trim() : null,
        }))
        .slice(0, MAX_NEWS_HEADLINES)
    : [];
  const sentiment = NEWS_SENTIMENTS.has(raw.sentiment) ? raw.sentiment : null;
  const sentiment_reason = typeof raw.sentiment_reason === "string" && raw.sentiment_reason.trim() ? raw.sentiment_reason.trim() : null;
  if (!headlines.length || !sentiment || !sentiment_reason) return null;
  return { headlines, sentiment, sentiment_reason, source_query: sourceQuery, extracted_by: "gemini" };
}

async function findNewsDigest() {
  const query = "stock market news and sentiment today";
  let result;
  try {
    result = await searchAndExtract(query, TRUSTED_NEWS_DOMAINS, buildNewsDigestPrompt());
  } catch (err) {
    console.warn(`News digest search failed: ${err.message}`);
    return null;
  }
  await sleep(REQUEST_DELAY_MS);
  if (!result.text) {
    console.warn("No trusted-domain result for news digest - discarding");
    return null;
  }
  return validateNewsDigest(parseJsonLoose(result.text), query);
}

// ---- Per-symbol pipeline ----------------------------------------------
async function processSymbol(symbol) {
  const findings = [];
  for (const query of buildQueries(symbol)) {
    let result;
    try {
      result = await searchAndExtract(query, TRUSTED_PRICE_DOMAINS, buildExtractionPrompt(symbol));
    } catch (err) {
      console.warn(`[${symbol}] search+extract failed for "${query}": ${err.message}`);
      continue;
    }
    await sleep(REQUEST_DELAY_MS);

    if (!result.text) {
      console.warn(`[${symbol}] no trusted-domain result for "${query}" - discarding`);
      continue;
    }

    const extracted = validateFinding(parseJsonLoose(result.text));
    if (!extracted) continue;

    findings.push({
      symbol,
      price: extracted.price,
      currency: extracted.currency,
      url: result.citations[0],
      source_query: query,
      raw_snippet: null,
      confidence: extracted.confidence,
      extracted_by: "gemini",
      explanation: null,
    });
  }

  if (findings.length) {
    const explanation = await findExplanation(symbol);
    if (explanation) {
      for (const f of findings) f.explanation = explanation;
    }
  }
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

// ---- Market movers watchlist (Investments tab, "Today's top movers") -----
// A fixed, curated list of well-known large-cap stocks - NOT each user's
// own holdings (that's the per-user watchlist above) - so the UI can rank
// "today's biggest movers" even for a user who holds nothing. Same category
// as MARKET_INDEXES immediately above (public market data, tied to no
// user), so it's searched the same way and written to the SAME
// market_index_findings table rather than a new one. Must match app.js's
// own MARKET_MOVERS_WATCHLIST constant, kept in sync by hand.
const MARKET_MOVERS_WATCHLIST = [
  "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "JPM", "V", "UNH",
  "XOM", "JNJ", "WMT", "PG", "MA", "HD", "DIS", "NFLX", "AMD", "KO",
];

// ---- Main ----------------------------------------------------------------
async function main() {
  requireEnv();

  const watchlist = await loadWatchlist();
  console.log(`Watchlist (${watchlist.length}): ${watchlist.join(", ")}`);
  console.log(`Market indexes (${MARKET_INDEXES.length}): ${MARKET_INDEXES.join(", ")}`);
  console.log(`Market movers watchlist (${MARKET_MOVERS_WATCHLIST.length}): ${MARKET_MOVERS_WATCHLIST.join(", ")}`);

  if (!watchlist.length && !MARKET_INDEXES.length && !MARKET_MOVERS_WATCHLIST.length) {
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

  const allFindings = [];
  for (const symbol of watchlist) {
    if (checkBudget()) break;
    console.log(`Searching: ${symbol}`);
    const findings = await processSymbol(symbol);
    console.log(`  -> ${findings.length} finding(s)`);
    allFindings.push(...findings);
  }
  if (allFindings.length) {
    await sbInsert("asset_price_findings", allFindings);
    console.log(`${DRY_RUN ? "Would have written" : "Wrote"} ${allFindings.length} finding(s) to asset_price_findings.`);
  } else {
    console.log("No asset findings this run.");
  }

  const allIndexFindings = [];
  for (const label of MARKET_INDEXES) {
    if (checkBudget()) break;
    console.log(`Searching index: ${label}`);
    const findings = await processSymbol(label);
    console.log(`  -> ${findings.length} finding(s)`);
    allIndexFindings.push(...findings);
  }
  for (const symbol of MARKET_MOVERS_WATCHLIST) {
    if (checkBudget()) break;
    console.log(`Searching mover: ${symbol}`);
    const findings = await processSymbol(symbol);
    console.log(`  -> ${findings.length} finding(s)`);
    allIndexFindings.push(...findings);
  }
  if (allIndexFindings.length) {
    await sbInsert("market_index_findings", allIndexFindings);
    console.log(`${DRY_RUN ? "Would have written" : "Wrote"} ${allIndexFindings.length} finding(s) to market_index_findings (indexes + movers watchlist).`);
  } else {
    console.log("No market index or movers findings this run.");
  }

  if (!checkBudget()) {
    console.log("Searching: market news digest");
    const digest = await findNewsDigest();
    if (digest) {
      await sbInsert("market_news_findings", [digest]);
      console.log(`${DRY_RUN ? "Would have written" : "Wrote"} market news digest.`);
    } else {
      console.log("No market news digest this run.");
    }
  }

  await writeRunStatus();
}

main().catch(async (err) => {
  console.error("Agent run failed:", err);
  await writeRunStatus(err);
  process.exit(1);
});
