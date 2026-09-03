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

// Hidden reasoning is OFF on every call below. gemma4:e4b advertises a
// "thinking" capability (confirmed via /api/show) and uses it by default,
// which makes this app's Q&A structurally unable to finish: measured live
// 2026-09-03, one real question spent over TWO MINUTES emitting reasoning
// tokens without ever reaching an answer, and capping output at 300 tokens
// returned an empty string - 300 tokens of pure thinking, done_reason
// "length". So this is not a tuning preference, it is what makes the feature
// work at all. Safe to send unconditionally: verified live that a model with
// no thinking capability (qwen2.5-coder:7b) accepts and ignores the flag
// rather than rejecting the request.
const GEMMA_THINK = false;

// The model ships with temperature 1 / top_k 64 / top_p 0.95 (confirmed via
// /api/show), which is wrong for both jobs this app asks of it - structured
// extraction and arithmetic over the user's real money. docs/SESSION-NOTES.md
// already records Gemma silently dividing an amount by three once, which is
// exactly what sampling at temperature 1 produces on a task that has one
// correct answer. Costs nothing: measured identical latency at temperature 0.
const DETERMINISTIC = { temperature: 0 };

// num_predict here is a runaway BACKSTOP, not a target. Deliberately generous
// because this model cannot be prompted into brevity - measured live, caps of
// 300/400/600 tokens all ended with done_reason "length", truncating the
// answer mid-sentence, and three escalating "answer in 2-3 sentences, no
// tables" instructions all produced the same table-driven ~600-token reply. A
// truncated answer about someone's money is worse than a slow one, so the cap
// only exists to stop a genuine runaway, and askGemma's timeout is sized to
// match rather than to fight it.
const EXTRACT_OPTIONS = { ...DETERMINISTIC, num_predict: 200 };
const QA_OPTIONS = { ...DETERMINISTIC, num_predict: 800 };

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
  // Measured live end to end against the real tunnel+model 2026-09-03: this
  // whole call is 4.4s wall (3.4s server, of which 2.2s is generating ~50
  // tokens of JSON, plus ~1.5s of Cloudflare quick-tunnel round trip). The
  // original 4000ms default sat just BELOW that, which is what made Quick Add
  // report "Gemma unavailable" far more often than the endpoint was ever
  // actually unreachable. 8000ms gives roughly 2x headroom over the measured
  // figure while still failing fast enough that an inline typing flow never
  // stalls - a timeout here silently keeps the local keyword parse, which is
  // the correct and already-shipped fallback.
  const { endpoint, model = "gemma", key, timeoutMs = 8000 } = opts;
  const today = opts.today || localDateISO();
  if (!endpoint) throw new Error("Gemma endpoint not configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(key ? { "X-Gemma-Key": key } : {}) },
      body: JSON.stringify({ model, prompt: buildPrompt(text, today), stream: false, format: "json", think: GEMMA_THINK, keep_alive: GEMMA_KEEP_ALIVE, options: EXTRACT_OPTIONS }),
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
 * Measured live 2026-09-03, decomposed with Ollama's own load_duration /
 * eval_duration fields rather than a stopwatch: a genuinely COLD load is
 * only 3.8s (6.4s wall including the tunnel). An earlier 30.9s reading was
 * this function's own fault, not the machine's - "ping" with no output cap
 * had the model write a 300-token essay about the ping utility, roughly 14s
 * of generation nobody ever reads, on top of the load. num_predict:1 makes
 * this what it always should have been: a pure load, one token, done.
 */
export async function warmUpGemma(opts = {}) {
  // A cold load measured 6.4s once and 10.8s on a second run - real variance,
  // since page-cache state and memory pressure on a 16GB machine both move
  // it. 25000ms is comfortably past the worse reading, and costs nothing to
  // over-provision: this call is fire-and-forget, so a longer ceiling never
  // makes a user wait. It does NOT need to cover a real answer's generation,
  // which is askGemma's problem - this one stops after a single token.
  const { endpoint, model = "gemma", key, timeoutMs = 25000 } = opts;
  if (!endpoint) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(key ? { "X-Gemma-Key": key } : {}) },
      body: JSON.stringify({ model, prompt: "ping", stream: false, think: GEMMA_THINK, keep_alive: GEMMA_KEEP_ALIVE, options: { num_predict: 1 } }),
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
    "Never use an em dash or en dash. Use a comma instead.",
    "",
    // The hard accuracy rule this feature is built to. Every figure in the
    // data was computed by the app; the model's job is to phrase them, not
    // to do arithmetic. Enforced afterwards by verifyAnswerFigures() (see
    // app/wiki.js) - an answer stating a figure that is not in the data is
    // discarded rather than shown, so a model that ignores this produces no
    // answer at all rather than a wrong one.
    "NEVER calculate a new number. Do not add, subtract, average or total",
    "anything yourself. Every dollar amount and every percentage you write",
    "must appear verbatim in the data below - quote them, do not derive",
    "them. Rounding a figure you were given is fine ('about $580' for",
    "$580.12). If answering properly would need a number that is not in the",
    "data, say plainly that you cannot answer that one exactly, and say what",
    "you would need - do not estimate it.",
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

/**
 * Strip em and en dashes out of model output.
 *
 * This repo's long-standing no-em-dash rule governs what WE write - code,
 * comments, docs, UI strings - and said nothing about what a model writes
 * back, so generated text was the one place they kept appearing (a real
 * monthly report shipped "discretionary spending - like groceries or dining
 * out - to better pinpoint" with two of them). Enforced at the boundary and
 * not only in the prompt, for the same reason validateQaAnswer() exists:
 * telling a model not to do something is not the same as it obeying.
 *
 * A dash between two digits becomes a plain hyphen so a range still reads as
 * a range ("10-20"); anywhere else it becomes a spaced hyphen, which is the
 * form this project already uses in prose. The minus sign U+2212 is left
 * alone deliberately - it is arithmetic, not punctuation.
 */
export function plainDashes(text) {
  if (typeof text !== "string") return "";
  return text
    // A range stays a range.
    .replace(/(\d)\s*[\u2013\u2014\u2015]\s*(\d)/g, "$1-$2")
    // Opening a line, it is a list marker rather than punctuation.
    .replace(/(^|\n)[ \t]*[\u2013\u2014\u2015][ \t]*/g, "$1- ")
    // Everywhere else it is doing a comma's job, so use a comma. A spaced
    // hyphen was the first substitution and it read as machine output:
    // "spending - like groceries or dining out - to better pinpoint" is not
    // a sentence anyone writes.
    .replace(/\s*[\u2013\u2014\u2015]\s*/g, ", ")
    // The dash may already have sat next to a comma; never leave two.
    .replace(/,[\s,]*,/g, ",")
    .replace(/\s+,/g, ",");
}

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

function countWords(text) {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/**
 * Read an Ollama NDJSON stream, accumulating the answer and reporting only
 * how MUCH has arrived, never what it says.
 *
 * That split is the whole point of streaming here. The obvious way to make a
 * ~45s answer feel fast is to paint tokens on screen as they arrive, but
 * validateQaAnswer() has to see the COMPLETE answer before any of it is
 * shown - a sentence that turns into investment advice by its second clause
 * cannot be un-read once displayed. So this buffers the text privately and
 * hands the caller counts alone: app.js literally cannot render unvalidated
 * model output, even by mistake, because it is never given it.
 *
 * Falls back to a plain single-object read when the endpoint doesn't stream -
 * tools/mock-gemma-server.js ignores `stream` and answers with one JSON
 * object, and a leftover-buffer parse covers the same case mid-stream.
 */
async function readStreamedAnswer(res, { onActivity, onProgress }) {
  if (!res.body || typeof res.body.getReader !== "function") {
    const data = await res.json();
    if (data && data.error) throw new Error(`Gemma error: ${data.error}`);
    return typeof data.response === "string" ? data.response : "";
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let answer = "";

  const consumeLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let data;
    // A partial line is normal - a chunk boundary can land mid-object, and
    // the remainder arrives next read. Skipping an unparseable fragment is
    // correct; the completed line is parsed on a later pass.
    try { data = JSON.parse(trimmed); } catch { return; }
    if (data.error) throw new Error(`Gemma error: ${data.error}`);
    if (typeof data.response === "string") answer += data.response;
  };

  const report = () => { if (onProgress) onProgress({ chars: answer.length, words: countWords(answer) }); };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onActivity();
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) consumeLine(line);
    report();
  }
  pending += decoder.decode();
  consumeLine(pending);
  report();
  return answer;
}

/**
 * Ask Gemma a free-text question about the given context. Resolves to the
 * plain-text answer, or throws - a connectivity/HTTP failure throws a plain
 * Error (caller shows a friendly "is Gemma reachable?" message); an answer
 * that fails validateQaAnswer() throws QaAdviceRejectedError instead, so
 * the caller can tell the two apart and never display the rejected text.
 */
export async function askGemma(question, context, opts = {}) {
  // timeoutMs is now an INACTIVITY budget, not a total duration - the gap
  // allowed between streamed chunks (and so also the wait for the first one,
  // which covers a cold load plus ~8s of reading the context in). Streaming
  // is what makes this possible, and it is strictly better than the fixed
  // ceiling it replaces: a healthy answer that simply takes 60s of writing is
  // no longer killed mid-sentence, while a genuinely dead connection is
  // noticed in 45s instead of 90. maxTotalMs stays as a hard backstop so a
  // model dribbling one token per 40s cannot hang the UI forever.
  const { endpoint, model = "gemma", key, timeoutMs = 45000, maxTotalMs = 180000, onProgress } = opts;
  if (!endpoint) throw new Error("Gemma endpoint not configured");
  if (!question || !question.trim()) throw new Error("Ask a question first");

  const controller = new AbortController();
  let idleTimer;
  const armIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), timeoutMs);
  };
  const hardTimer = setTimeout(() => controller.abort(), maxTotalMs);
  armIdle();
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(key ? { "X-Gemma-Key": key } : {}) },
      body: JSON.stringify({ model, prompt: buildQaPrompt(question, context), stream: true, think: GEMMA_THINK, keep_alive: GEMMA_KEEP_ALIVE, options: QA_OPTIONS }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Gemma HTTP ${res.status}`);
    const text = (await readStreamedAnswer(res, { onActivity: armIdle, onProgress })).trim();
    if (!text) throw new Error("Gemma returned an empty answer");
    const validated = validateQaAnswer(text);
    if (!validated.answer) {
      throw new QaAdviceRejectedError(
        "That answer strayed into investment advice or a prediction, which this app doesn't give. Try asking about your own spending, accounts, or budgets instead."
      );
    }
    return plainDashes(validated.answer);
  } finally {
    clearTimeout(idleTimer);
    clearTimeout(hardTimer);
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
  // model does nothing for this one. It is far smaller (0.27GB against
  // 9.61GB, confirmed via /api/tags), so its own cold load is well inside
  // this budget, but it is not assumed instant either.
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
