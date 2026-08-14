#!/usr/bin/env node
// ============================================================================
// F6 stretch - live deal-search agent (docs/F6-live-deals-proposal.md).
// Runs on the SERVER MACHINE ONLY, needs the Supabase SERVICE_ROLE key -
// keep that out of the repo (env var only).
//
// Uses Tavily for live web search and the Gemini API (plain generateContent,
// no grounding tool) for extraction - not local Ollama, deliberately, and
// not as a fallback alongside it. Confirmed by reading this whole file end
// to end: buildQueries() generates the same 5 generic angles ("pricing
// plans", "student discount", "promo code", "annual plan discount", "family
// plan price") for EVERY subscribed service, regardless of whether any
// specific user actually qualifies for any of them - this script never
// reads a profile's eligibility fields (employer/school/military status/
// etc) at all. Per-user eligibility matching happens entirely separately,
// client-side, in app/discounts.js's isEligible(), using data that never
// leaves the browser. Only a service's brand name and text found on that
// service's own public pricing page ever reach this pipeline - genuinely
// public data, same boundary price-agent.js documents. See CLAUDE.md's
// data model section for the durable version of this line - which scripts
// may use a cloud LLM and which must never (app/gemma.js's real
// expense/Q&A paths must not).
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
// for each half.
//
// What it does, per active-subscription service:
//   1. Look up the service's allowlisted domain(s) in service_domains. No
//      entry -> skip and log (see docs/F6-live-deals-proposal.md's Option C
//      decision - we never guess a domain).
//   2. For each of a few angles (pricing, student, promo, annual, family),
//      search Tavily for real, current web results.
//   3. Filter those results down to the service's own allowlisted domains
//      BEFORE Gemini ever sees them - same "never trust an unverified
//      source" posture as before, applied as a pre-filter here (Tavily
//      returns real result URLs directly, unlike a grounding tool's
//      internal search).
//   4. Ask Gemini to extract strict JSON plan data ONLY from the real,
//      allowlisted-domain content just fetched - explicitly instructed not
//      to draw on anything else.
//   5. Write validated findings to deal_findings via the REST API using
//      the service_role key (bypasses RLS by design - the PWA can only
//      read).
//
// Setup (on the server machine):
//   Preferred: copy tools/.env.deal-agent.example to tools/.env.deal-agent,
//   fill in real values, then run ./tools/run-deal-agent.sh.
//
//   This script can also be run directly with plain env vars:
//   export SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
//   export SUPABASE_SERVICE_ROLE_KEY=sb_secret_...   # Dashboard -> API Keys. NEVER commit this.
//   export TAVILY_API_KEY=tvly-...   # https://tavily.com - no card required
//   export GEMINI_API_KEY=...        # https://aistudio.google.com/apikey - no billing account attached
//   node tools/deal-agent.js            # writes findings
//   DRY_RUN=1 node tools/deal-agent.js  # prints what it would write, no DB writes
//
// Scheduling (Phase D, not yet wired up): run this weekly, not
// continuously - see the "always running" discussion in
// docs/F6-live-deals-proposal.md §8. Prices don't change fast enough to
// justify more.
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
// deliberately NOT a hardcoded version number as the default - see
// tools/price-agent.js's header for the full reasoning (identical here).
// Override via GEMINI_MODEL to pin a specific version if you want that
// instead. Key must still be created with NO billing account attached.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
function geminiUrl(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

const FETCH_TIMEOUT_MS = 8000;      // Supabase REST calls
const SEARCH_TIMEOUT_MS = 15000;    // Tavily search
const GEMINI_TIMEOUT_MS = 30000;    // extraction over already-fetched content
const REQUEST_DELAY_MS = 1200;      // spacing between calls - raised from 500ms after a live
                                     // test run hit a real Gemini 429 mid-run at that spacing
const RESULTS_PER_QUERY = 5;        // Tavily max_results per search
const MAX_429_RETRIES = 2;          // per call, exponential backoff (3s, 6s)

// Hard safety cap on Tavily calls in a single run - see the identical
// constant in tools/price-agent.js for the full reasoning (same
// combined-monthly-budget math applies to both scripts together).
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

// Retries specifically on 429 (rate-limited), not other error codes - see
// tools/price-agent.js's identical helper for the full reasoning.
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
// mask whatever real findings were already written. See
// tools/price-agent.js's identical function for the full reasoning.
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
      agent: "deal-agent",
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

// ---- Watchlist: only services the user actually subscribes to --------------
async function loadWatchlist() {
  const rows = await sbGet("subscriptions?select=name&is_active=eq.true");
  return [...new Set(rows.map((r) => r.name).filter(Boolean))];
}

async function loadDomainMap(services) {
  if (!services.length) return new Map();
  const filter = `in.(${services.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(",")})`;
  const rows = await sbGet(`service_domains?select=service,domains&service=${filter}`);
  return new Map(rows.map((r) => [r.service, r.domains]));
}

// ---- Query generation: multiple angles, not just "pricing" -----------------
function buildQueries(service) {
  return [
    `${service} pricing plans`,
    `${service} student discount`,
    `${service} promo code`,
    `${service} annual plan discount`,
    `${service} family plan price`,
  ];
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
// for the run's agent_run_status row (see main()) - see
// tools/price-agent.js's identical comment for why only a thrown error
// counts as a failure, not "no trusted-domain result."
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

// ---- Gemini extraction (strict-JSON contract) ----
const PLAN_TYPES = ["individual", "student", "family", "annual"];

function buildExtractionPrompt(service) {
  return [
    `You extract subscription pricing for "${service}" from the real search`,
    "results provided below. Respond with ONLY a JSON object, no prose, no",
    'code fences. Use this exact shape:',
    '{ "plan_type": "individual"|"student"|"family"|"annual"|null, "price": number|null,',
    '  "eligibility": string|null, "confidence": number }',
    "confidence is 0..1, how sure you are this price is current and correct",
    "for this exact service (not a different product).",
    "If you cannot find a clear price for this service in the results, set price to null.",
  ].join("\n");
}

function validateFinding(raw) {
  if (!raw || typeof raw !== "object") return null;
  const price = Number(raw.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  const plan_type = PLAN_TYPES.includes(raw.plan_type) ? raw.plan_type : null;
  const confidence = Number.isFinite(Number(raw.confidence))
    ? Math.max(0, Math.min(1, Number(raw.confidence)))
    : 0.5;
  const eligibility = typeof raw.eligibility === "string" && raw.eligibility.trim() ? raw.eligibility.trim() : null;
  return { price: Math.round(price * 100) / 100, plan_type, eligibility, confidence };
}

// ---- Per-service pipeline ----------------------------------------------
async function processService(service, domains) {
  const findings = [];
  for (const query of buildQueries(service)) {
    let result;
    try {
      result = await searchAndExtract(query, domains, buildExtractionPrompt(service));
    } catch (err) {
      console.warn(`[${service}] search+extract failed for "${query}": ${err.message}`);
      continue;
    }
    await sleep(REQUEST_DELAY_MS);

    if (!result.text) {
      console.warn(`[${service}] no result on an allowlisted domain for "${query}" - discarding`);
      continue;
    }

    const extracted = validateFinding(parseJsonLoose(result.text));
    if (!extracted) continue;

    findings.push({
      service,
      plan_type: extracted.plan_type,
      price: extracted.price,
      eligibility: extracted.eligibility,
      url: result.citations[0],
      source_query: query,
      raw_snippet: null,
      confidence: extracted.confidence,
      extracted_by: "gemini",
    });
  }
  return findings;
}

// ---- Main ----------------------------------------------------------------
async function main() {
  requireEnv();

  const watchlist = await loadWatchlist();
  if (!watchlist.length) {
    console.log("No active subscriptions - nothing to search for. Exiting.");
    return;
  }
  console.log(`Watchlist (${watchlist.length}): ${watchlist.join(", ")}`);

  const domainMap = await loadDomainMap(watchlist);
  const skipped = watchlist.filter((s) => !domainMap.has(s));
  if (skipped.length) {
    console.log(
      `Skipping (no service_domains entry - add one to search these): ${skipped.join(", ")}`
    );
  }

  const allFindings = [];
  for (const service of watchlist) {
    if (tavilyCallCount >= MAX_TAVILY_CALLS_PER_RUN) {
      console.warn(`Tavily call budget (${MAX_TAVILY_CALLS_PER_RUN}/run) reached - stopping early, writing what was already found.`);
      break;
    }
    const domains = domainMap.get(service);
    if (!domains) continue;
    console.log(`Searching: ${service} (allowed domains: ${domains.join(", ")})`);
    const findings = await processService(service, domains);
    console.log(`  -> ${findings.length} finding(s)`);
    allFindings.push(...findings);
  }

  if (!allFindings.length) {
    console.log("No findings this run.");
  } else {
    await sbInsert("deal_findings", allFindings);
    console.log(`${DRY_RUN ? "Would have written" : "Wrote"} ${allFindings.length} finding(s) to deal_findings.`);
  }

  await writeRunStatus();
}

main().catch(async (err) => {
  console.error("Agent run failed:", err);
  await writeRunStatus(err);
  process.exit(1);
});
