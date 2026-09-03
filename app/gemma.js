// ============================================================================
// Gemma natural-language parsing client (README §3.6, Phase 3).
// Best-effort enrichment: the app stays fully usable with keyword parsing when
// the home machine (Ollama + Cloudflare Tunnel) is asleep or unreachable.
//
// Contract: we POST to an Ollama-compatible /api/generate endpoint with
// `format: "json"`, which returns { response: "<json string>" }. We also
// tolerate an endpoint that returns the parsed object directly.
// ============================================================================
import { CATEGORIES } from "./categorize.js";
import { localDateISO } from "./dates.js";

const PAYMENTS = ["credit", "debit", "cash"];
// Ollama's per-request override for how long a model stays loaded after
// this call - deliberately NOT the home machine's own OLLAMA_KEEP_ALIVE
// env var, which is global and would also affect any other model sharing
// that machine (e.g. a coding-assistant model). Set here instead so only
// this app's own usage gets a longer keep-alive, without touching the
// machine's own tuning for its other uses. Doesn't help a genuinely cold
// first request (that one still has to wait out the load), just makes a
// second call shortly after the first skip the reload.
const GEMMA_KEEP_ALIVE = "10m";

/** Build the strict-JSON extraction prompt sent to Gemma. */
export function buildPrompt(text, today) {
  return [
    "You extract a single expense from casual text. Respond with ONLY a JSON object,",
    "no prose, no code fences. Use this exact shape:",
    '{ "amount": number, "merchant": string, "category": string,',
    '  "payment_type": "credit"|"debit"|"cash"|null, "occurred_at": "YYYY-MM-DD" }',
    `Choose category from: ${CATEGORIES.join(", ")}.`,
    `If a field is unknown use null (for occurred_at default to "${today}").`,
    `Today is ${today}.`,
    `Text: ${JSON.stringify(text)}`,
  ].join("\n");
}

/** Validate & coerce a raw parsed object into our normalized expense shape, or null. */
export function validateParsed(raw, today) {
  if (!raw || typeof raw !== "object") return null;

  const amount = Number(raw.amount);
  const out = {
    amount: Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : null,
    merchant: typeof raw.merchant === "string" && raw.merchant.trim() ? raw.merchant.trim() : null,
    category: null,
    payment_type: null,
    occurred_at: today,
  };

  if (typeof raw.category === "string") {
    // Case-insensitive match to a known category; otherwise keep the label as-is.
    const hit = CATEGORIES.find((c) => c.toLowerCase() === raw.category.toLowerCase());
    out.category = hit || raw.category.trim() || null;
  }
  if (typeof raw.payment_type === "string" && PAYMENTS.includes(raw.payment_type.toLowerCase())) {
    out.payment_type = raw.payment_type.toLowerCase();
  }
  if (typeof raw.occurred_at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.occurred_at)) {
    out.occurred_at = raw.occurred_at;
  }

  // Must extract at least an amount to be useful.
  return out.amount !== null ? out : null;
}

/** Pull a JSON object out of an Ollama response (which nests it as a string). */
function extractPayload(data) {
  if (data && typeof data === "object" && "response" in data) {
    try { return JSON.parse(data.response); } catch { return null; }
  }
  return data; // endpoint returned the object directly
}

/**
 * Parse free text via Gemma. Resolves to a normalized expense object, or throws
 * (caller falls back to keyword parsing). Times out so it never blocks the UI.
 * @param {string} text
 * @param {{endpoint:string, model?:string, key?:string, timeoutMs?:number, today?:string}} opts
 */
export async function parseWithGemma(text, opts = {}) {
  // Measured live against the real tunnel+model 2026-09-02: a WARM request
  // takes 2.9-3.6s, so the old 4000ms default was already failing on
  // ordinary variance, not just a cold model - this is what made Quick Add
  // show "Gemma unavailable" far more often than the endpoint was actually
  // unreachable. Still deliberately short of the real cold-load time
  // (measured ~31s, see warmUpGemma below) - Quick Add is an inline typing
  // flow and blocking it for 30s on a cold model would be worse than
  // falling back to the local keyword parser, which is the existing,
  // correct behavior on any timeout here.
  const { endpoint, model = "gemma", key, timeoutMs = 8000 } = opts;
  const today = opts.today || localDateISO();
  if (!endpoint) throw new Error("Gemma endpoint not configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(key ? { "X-Gemma-Key": key } : {}) },
      body: JSON.stringify({ model, prompt: buildPrompt(text, today), stream: false, format: "json", keep_alive: GEMMA_KEEP_ALIVE }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Gemma HTTP ${res.status}`);
    const payload = extractPayload(await res.json());
    const parsed = validateParsed(payload, today);
    if (!parsed) throw new Error("Gemma returned an unusable shape");
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fire a minimal "ping" prompt to load the model into memory ahead of a
 * real request - same warm-up shape tools/price-agent.js already uses
 * server-side. Called from init() (before the user has done anything) and
 * again when the Reports page opens, so a genuinely cold model has two
 * chances to finish loading in the background before it counts against a
 * real click. Fire-and-forget by design: any failure here (unreachable
 * endpoint, timeout) just means the next real call pays the cold-start
 * cost instead, exactly like today - never surface an error to the user
 * for a warm-up they didn't ask for.
 *
 * Measured live against the real tunnel+model 2026-09-02: a genuinely cold
 * load took 30.9s, not the ~11-16s this comment previously stated - the
 * old 20000ms abort was shorter than that, so this warm-up was silently
 * giving up before the model had even finished loading on every cold run,
 * defeating its entire purpose. Raised well past the measured figure.
 */
export async function warmUpGemma(opts = {}) {
  const { endpoint, model = "gemma", key, timeoutMs = 45000 } = opts;
  if (!endpoint) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(key ? { "X-Gemma-Key": key } : {}) },
      body: JSON.stringify({ model, prompt: "ping", stream: false, keep_alive: GEMMA_KEEP_ALIVE }),
      signal: controller.signal,
    });
  } catch {
    // best-effort only - silently ignored, see comment above
  } finally {
    clearTimeout(timer);
  }
}

// ---- Interactive spending Q&A ----------------------------------------------
// Separate contract from parseWithGemma above: the answer is free text, not
// strict JSON, so no format:"json" here - Ollama returns { response: "..." }
// with a plain-text answer instead of a JSON string to parse.

/** Build the free-text Q&A prompt sent to Gemma. */
export function buildQaPrompt(question, context) {
  return [
    "You are a personal finance assistant. Answer the question using ONLY",
    "the JSON data below, which is the user's own spending data plus",
    "optional profile context (employment, housing, household size,",
    "dependents, financial goals) if they've filled it in. The data may",
    "also include relevant_history - older transactions found via search",
    "specifically because they relate to this question, separate from the",
    "regular recent-months transactions list. If the data doesn't contain",
    "enough to answer, say so plainly instead of guessing.",
    "Be concise - a few sentences or a short list. Use $ for dollar amounts.",
    "",
    // Never legitimate here: buildQaContext never includes a stock, fund,
    // or ticker, so any recommendation or prediction language in an answer
    // can only be the model inventing something this app does not give
    // anywhere. Left permissive on ordinary debt-vs-savings reasoning,
    // which is a real, documented use case for this feature - see
    // validateQaAnswer()'s own comment for the boundary this draws.
    "The data below never includes a stock, fund, or ticker - only this",
    "person's own expenses, subscriptions, income and profile. Never",
    "recommend buying, selling, or investing in any security, and never",
    "predict what any price, account balance, or net worth will be in the",
    "future - you have no real basis for either, since nothing here is",
    "market data and nothing here is a forecast. You may still compare",
    "numbers already in the data (one debt's interest rate against another,",
    "or spending against income) to help answer something like whether to",
    "pay down debt or save - but stop at describing what the numbers show,",
    "never turn that into a recommendation to take a specific action. If",
    "asked for investment advice or a prediction, say plainly that this app",
    "doesn't give that, rather than answering anyway.",
    "",
    `Data: ${JSON.stringify(context)}`,
    "",
    `Question: ${question}`,
  ].join("\n");
}

// Thrown specifically when a Gemma answer is discarded for straying into
// investment advice or a prediction - distinct from a connectivity/HTTP
// error so the UI can show an accurate message rather than "is Gemma
// reachable?" for an answer that arrived just fine and was simply rejected.
export class QaAdviceRejectedError extends Error {}

// Never legitimate in this feature's context: buildQaContext (insights.js)
// hands Gemma only the user's own expenses/subscriptions/income/profile -
// no market or ticker data at all - so any of these phrases can only be the
// model inventing investment advice this app does not give anywhere (the
// same boundary compareDebtStrategies() and the credit-utilization line
// already hold, extended here to the one place a free-text model could
// cross it). Deliberately narrower than tools/price-agent.js's recap list:
// this feature is explicitly allowed to reason about the user's own
// debt-vs-savings tradeoffs (a real, documented use case), so ordinary
// phrasing like "you should pay down..." is not banned - only phrasing
// that could only be about a security or a price/balance prediction is.
export const QA_ADVICE_PHRASES = [
  "should buy", "should sell", "should invest", "you should invest",
  "buy the dip", "worth buying", "worth selling", "price target",
  "buying opportunity", "opportunity to buy", "good time to buy",
  "good time to sell", "undervalued", "overvalued", "safe bet",
  "can't go wrong", "cannot go wrong", "no-brainer", "too cheap",
  "looks cheap", "looks expensive", "guaranteed return", "guaranteed profit",
  "invest in", "put your money into", "buy shares", "sell shares",
  "buy stock", "sell stock",
  "will rise to", "will fall to", "will be worth", "will double",
  "will likely rise", "will likely fall", "poised to",
];

/**
 * Rejects an answer that strays into investment advice or a price/balance
 * prediction - something this feature has no basis to give, since its
 * context never includes market or ticker data. Mirrors
 * tools/price-agent.js's validateRecapSummary() shape ({answer} or
 * {reason}) so the same pattern is checkable in both places, even though
 * the two live in separate runtimes (a Node script and a browser module)
 * with no shared import between them.
 * @param {string} raw
 * @returns {{answer:string}|{reason:string}}
 */
export function validateQaAnswer(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { reason: "empty" };
  const lower = text.toLowerCase();
  const violation = QA_ADVICE_PHRASES.find((phrase) => lower.includes(phrase));
  if (violation) return { reason: violation };
  return { answer: text };
}

/**
 * Ask Gemma a free-text question about the given context. Resolves to the
 * plain-text answer, or throws - a connectivity/HTTP failure throws a plain
 * Error (caller shows a friendly "is Gemma reachable?" message); an answer
 * that fails validateQaAnswer() throws QaAdviceRejectedError instead, so
 * the caller can tell the two apart and never display the rejected text.
 */
export async function askGemma(question, context, opts = {}) {
  // Matches warmUpGemma's own timeout and its comment on the real measured
  // cold-load time (30.9s, 2026-09-02) - this used to be 20000ms, shorter
  // than a genuine cold load, so a first-of-the-session question could
  // abort before Gemma ever finished thinking rather than actually failing.
  const { endpoint, model = "gemma", key, timeoutMs = 45000 } = opts;
  if (!endpoint) throw new Error("Gemma endpoint not configured");
  if (!question || !question.trim()) throw new Error("Ask a question first");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(key ? { "X-Gemma-Key": key } : {}) },
      body: JSON.stringify({ model, prompt: buildQaPrompt(question, context), stream: false, keep_alive: GEMMA_KEEP_ALIVE }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Gemma HTTP ${res.status}`);
    const data = await res.json();
    const text = typeof data.response === "string" ? data.response.trim() : "";
    if (!text) throw new Error("Gemma returned an empty answer");
    const validated = validateQaAnswer(text);
    if (!validated.answer) {
      throw new QaAdviceRejectedError(
        "That answer strayed into investment advice or a prediction, which this app doesn't give. Try asking about your own spending, accounts, or budgets instead."
      );
    }
    return validated.answer;
  } finally {
    clearTimeout(timer);
  }
}

// ---- RAG retrieval for the Q&A above ---------------------------------------
// Separate contract again: POSTs to an Ollama-compatible /api/embeddings
// endpoint (not /api/generate) with { model, prompt }, which returns
// { embedding: [...] } - a plain float array, not the { response } shape
// the two functions above expect. Used by app.js to embed the user's
// question before a vector search against expense_embeddings
// (supabase/45_expense_embeddings.sql) - see that migration's header for
// why retrieval augments buildQaContext's existing recent-window data
// rather than replacing it.

/**
 * Embed a piece of text via Gemma. Resolves to a float vector, or throws
 * (caller treats retrieval as best-effort and falls back to no relevant
 * history, same posture as every other Gemma call in this file).
 */
export async function embedText(text, opts = {}) {
  // A separate model from GEMMA_MODEL (nomic-embed-text vs. gemma4:e4b),
  // loaded independently by Ollama - warmUpGemma warming the generation
  // model does nothing for this one. Given some margin over the generation
  // model's own measured cold-load (30.9s) since an embedding model is
  // usually smaller and faster to load, but not assumed instant either.
  // Best-effort like every other call here: retrieveRelevantHistory()
  // (app.js) already degrades to no relevant history on any failure.
  const { endpoint, model = "gemma", key, timeoutMs = 20000 } = opts;
  if (!endpoint) throw new Error("Gemma embeddings endpoint not configured");
  if (!text || !text.trim()) throw new Error("Nothing to embed");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(key ? { "X-Gemma-Key": key } : {}) },
      body: JSON.stringify({ model, prompt: text }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Gemma HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.embedding)) throw new Error("Gemma returned no embedding");
    return data.embedding;
  } finally {
    clearTimeout(timer);
  }
}
