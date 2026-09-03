// ============================================================================
// The per-user wiki, and the answer path built to a hard accuracy rule:
// EVERY NUMBER SHOWN TO THE USER IS COMPUTED HERE, never by a model.
//
// That rule came from a measurement (2026-09-03). Asked the same question two
// ways over the same data, the model handed 150 raw transactions answered
// "$807.11" when the true total was $3,362.37 - a confident, specific,
// four-times-wrong figure from a normal completion, not a truncation. Handed
// the total already computed, it answered $3,362.37 exactly, in 4.1s instead
// of 62.1s. Correctness and speed both come from doing the arithmetic here.
//
// Three exported concerns, in the order the Q&A uses them:
//
//   answerQuestion()    tier 1 - recognises a question shape and answers it
//                       outright, with no model involved at all. Exact and
//                       instant, and returns null rather than guessing.
//   collectAllowedFigures() / verifyAnswerFigures()
//                       tier 2 - the model may only PHRASE facts it was
//                       handed, so every dollar amount and percentage in its
//                       prose must trace back to a computed figure. One that
//                       does not cannot have come from this user's data, so
//                       the answer is rejected rather than shown.
//   deriveWikiFacts()   the durable knowledge itself: things only visible
//                       across months, which a single snapshot cannot
//                       re-derive.
//
// Pure by contract, like every other logic module here - no DOM, no
// sb.from(), no fetch. app.js owns all of that.
// ============================================================================
import { localMonthKey } from "./dates.js";

const r2 = (n) => Math.round(n * 100) / 100;
const num = (v) => Number(v || 0);
const monthOf = (row) => (row.occurred_at || "").slice(0, 7);

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/** "2026-08" -> "August 2026". Kept local so this module stays self-contained. */
export function monthName(ym) {
  const [y, m] = String(ym || "").split("-");
  const idx = Number(m) - 1;
  if (!y || !MONTH_NAMES[idx]) return String(ym || "");
  return MONTH_NAMES[idx][0].toUpperCase() + MONTH_NAMES[idx].slice(1) + " " + y;
}

/** Step a "YYYY-MM" key back n months. */
export function shiftMonth(ym, n) {
  const [y, m] = String(ym).split("-").map(Number);
  const d = new Date(y, m - 1 - n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : r2((s[mid - 1] + s[mid]) / 2);
}

/** Totals per month key, only for months that actually contain spending. */
function totalsByMonth(expenses) {
  const map = new Map();
  for (const e of expenses) {
    const ym = monthOf(e);
    if (!ym) continue;
    map.set(ym, r2((map.get(ym) || 0) + num(e.amount)));
  }
  return map;
}

function totalFor(expenses, predicate) {
  return r2(expenses.filter(predicate).reduce((sum, e) => sum + num(e.amount), 0));
}

function categoriesIn(expenses) {
  return [...new Set(expenses.map((e) => e.category).filter(Boolean))];
}

// ---- Fact derivation --------------------------------------------------------
// Every fact carries `figures`: the named numbers behind its sentence. They
// are what the page displays, what a recompute refreshes, and the allow-list
// the model is checked against - so a fact with no figures is not a fact.

/**
 * Derive the durable, cross-time facts for one user.
 * @returns {{key:string,title:string,body:string,figures:object,as_of:string}[]}
 */
export function deriveWikiFacts({ expenses = [], subscriptions = [], profile = null, today = new Date(), windowMonths = 6 } = {}) {
  const facts = [];
  const asOf = localMonthKey(today);
  const thisMonth = asOf;
  const oldest = shiftMonth(thisMonth, windowMonths - 1);
  const inWindow = expenses.filter((e) => monthOf(e) >= oldest && monthOf(e) <= thisMonth);
  const monthTotals = totalsByMonth(inWindow);

  // Averaged over months that CONTAIN spending, never over the window length.
  // Dividing by the window is the specific bug that killed the old
  // savings-runway tile: one month of data out of six understated real
  // spending sixfold before anything else compounded the error.
  const monthsWithData = [...monthTotals.keys()].sort();
  // Two months minimum. Averaged over ONE month this is just that month's
  // total, which the Reports stat tile already shows, and calling a single
  // month "typical" is not something the data supports.
  if (monthsWithData.length >= 2) {
    const total = r2([...monthTotals.values()].reduce((a, b) => a + b, 0));
    const average = r2(total / monthsWithData.length);
    facts.push({
      key: "spend_average",
      title: "Typical month",
      body: `You spend about $${average.toFixed(2)} in a typical month, averaged across the ${monthsWithData.length} months that have spending recorded.`,
      figures: { average, months_counted: monthsWithData.length, window_total: total },
      as_of: asOf,
    });
  }

  // Per-category average and direction. Only for categories with real spend.
  for (const cat of categoriesIn(inWindow)) {
    const rows = inWindow.filter((e) => e.category === cat);
    const catMonths = totalsByMonth(rows);
    const total = r2([...catMonths.values()].reduce((a, b) => a + b, 0));
    if (total <= 0) continue;
    const average = r2(total / catMonths.size);

    // A category fact is only worth stating when it can say something the
    // Reports bar chart cannot, which means a comparison ACROSS time. With a
    // single month there is no comparison to make and the "fact" is just the
    // chart bar restated in a sentence - the redundancy this whole card is
    // supposed to avoid. Both halves must contain spending: comparing
    // against an empty earlier half would report a change in LOGGING as if
    // it were a change in spending.
    const mid = shiftMonth(thisMonth, Math.floor(windowMonths / 2) - 1);
    const recent = totalFor(rows, (e) => monthOf(e) >= mid);
    const earlier = totalFor(rows, (e) => monthOf(e) < mid);
    if (!(recent > 0 && earlier > 0)) continue;

    const changePct = r2(((recent - earlier) / earlier) * 100);
    const figures = { total, average, months_counted: catMonths.size, recent_half: recent, earlier_half: earlier, change_pct: changePct };
    const body = changePct === 0
      ? `${cat} runs about $${average.toFixed(2)} a month, level with where it was earlier in the year.`
      : `${cat} runs about $${average.toFixed(2)} a month, ${changePct > 0 ? "up" : "down"} ${Math.abs(changePct).toFixed(0)}% on the first half of the last ${windowMonths} months.`;
    facts.push({ key: `category:${cat}`, title: cat, body, figures, as_of: asOf });
  }

  // A month well clear of the median, plus the user's own explanation if one
  // exists. The note is the only part of this file that is not derived, and
  // it is also the only part that can say WHY.
  const totalsList = [...monthTotals.values()];
  const med = median(totalsList);
  if (med != null && totalsList.length >= 3) {
    for (const [ym, total] of monthTotals) {
      if (total <= med * 1.5 || total - med < 1) continue;
      const abovePct = r2(((total - med) / med) * 100);
      const notes = inWindow
        .filter((e) => monthOf(e) === ym && (e.note || "").trim())
        .map((e) => e.note.trim());
      let body = `${monthName(ym)} came to $${total.toFixed(2)}, ${abovePct.toFixed(0)}% above your median month of $${med.toFixed(2)}.`;
      if (notes.length) body += ` You explained it: ${notes.join("; ")}.`;
      facts.push({
        key: `month_outlier:${ym}`,
        title: `${monthName(ym)} stands out`,
        body,
        figures: { total, median: med, above_pct: abovePct },
        as_of: asOf,
      });
    }
  }

  // A merchant charged in three or more distinct months is a pattern worth
  // stating; anything less is a coincidence.
  const byMerchant = new Map();
  for (const e of inWindow) {
    const name = (e.merchant || "").trim();
    if (!name) continue;
    if (!byMerchant.has(name)) byMerchant.set(name, []);
    byMerchant.get(name).push(e);
  }
  for (const [name, rows] of byMerchant) {
    const months = new Set(rows.map(monthOf));
    if (months.size < 3) continue;
    const total = r2(rows.reduce((sum, e) => sum + num(e.amount), 0));
    const perMonth = r2(total / months.size);
    facts.push({
      key: `recurring:${name}`,
      title: `${name} is regular`,
      body: `${name} appears in ${months.size} of the last ${monthsWithData.length} months with spending, about $${perMonth.toFixed(2)} a month.`,
      figures: { months_seen: months.size, total, per_month: perMonth },
      as_of: asOf,
    });

    // A merchant whose amount genuinely moved, which is only visible across
    // time and is exactly what a single snapshot cannot tell you.
    const sorted = [...rows].sort((a, b) => (a.occurred_at || "").localeCompare(b.occurred_at || ""));
    const first = num(sorted[0].amount);
    const last = num(sorted[sorted.length - 1].amount);
    if (first > 0 && Math.abs(last - first) / first >= 0.1) {
      const changePct = r2(((last - first) / first) * 100);
      facts.push({
        key: `price_change:${name}`,
        title: `${name} changed price`,
        body: `${name} went from $${first.toFixed(2)} to $${last.toFixed(2)}, ${changePct > 0 ? "up" : "down"} ${Math.abs(changePct).toFixed(0)}%.`,
        figures: { from: first, to: last, change_pct: changePct },
        as_of: asOf,
      });
    }
  }

  // No subscriptions fact. The figure is already on the Subscriptions page,
  // in the monthly report's own tile, and answerable directly by tier 1 - a
  // fourth copy on this card would be the same number in four places and
  // nothing learned. buildVerifiedContext() still passes the total to the
  // model as a computed aggregate, so nothing downstream loses it.

  // Stable context the user typed themselves. No figures, so it never enters
  // the verification allow-list - it is not a number and cannot be misquoted
  // as one.
  if (profile && (profile.housing_status || profile.household_size || profile.financial_goals)) {
    const bits = [];
    if (profile.housing_status) bits.push(`housing: ${profile.housing_status}`);
    if (profile.household_size) bits.push(`household of ${profile.household_size}`);
    if (profile.financial_goals) bits.push(`goal: ${profile.financial_goals}`);
    facts.push({
      key: "profile_context",
      title: "About you",
      body: bits.join(", ") + ".",
      figures: {},
      as_of: asOf,
    });
  }

  return facts;
}

// ---- Tier 1: answers computed outright, with no model ----------------------

/** Resolve a month reference in a question to a "YYYY-MM" key, or null. */
export function resolveMonth(question, today = new Date()) {
  const q = question.toLowerCase();
  const thisMonth = localMonthKey(today);
  if (/\blast month\b/.test(q)) return shiftMonth(thisMonth, 1);
  if (/\b(this|current) month\b/.test(q)) return thisMonth;
  for (let i = 0; i < MONTH_NAMES.length; i++) {
    if (!new RegExp(`(?<![a-z])${MONTH_NAMES[i]}(?![a-z])`).test(q)) continue;
    const yearMatch = q.match(/\b(20\d{2})\b/);
    const year = yearMatch ? Number(yearMatch[1]) : Number(thisMonth.slice(0, 4));
    const key = `${year}-${String(i + 1).padStart(2, "0")}`;
    // A bare month name with no year means the most recent one that has
    // already happened, not a month in the future.
    return key > thisMonth && !yearMatch ? `${year - 1}-${String(i + 1).padStart(2, "0")}` : key;
  }
  return null;
}

/** Find which of the user's own categories a question names, or null. */
export function resolveCategory(question, expenses) {
  const q = question.toLowerCase();
  const hit = categoriesIn(expenses).find((c) =>
    new RegExp(`(?<![a-z0-9])${c.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`).test(q));
  return hit || null;
}

/**
 * Answer a question outright when its shape is recognised, or return null so
 * the caller can fall back to the model. Never guesses: an unrecognised
 * question, or a recognised one with no data behind it, returns null rather
 * than a number that might be answering something else.
 *
 * @returns {{answer:string, figures:object}|null}
 */
export function answerQuestion(question, { expenses = [], subscriptions = [], facts = [], today = new Date() } = {}) {
  const direct = answerFromTransactions(question, { expenses, subscriptions, today });
  if (direct) return direct;
  // Facts are tried only after the direct paths, which are more specific.
  // This is what makes tier 1's coverage GROW as knowledge accumulates: a
  // question about a merchant or a standout month has no direct path, but
  // once the pattern behind it has been noticed it can be answered exactly
  // and instantly instead of falling through to the model.
  return answerFromFacts(question, facts);
}

function answerFromTransactions(question, { expenses = [], subscriptions = [], today = new Date() } = {}) {
  const q = String(question || "").toLowerCase().trim();
  if (!q) return null;

  const asksSpend = /\b(spend|spent|spending|cost|costs|paid|pay)\b/.test(q);
  const month = resolveMonth(q, today);
  const category = resolveCategory(q, expenses);

  // "what do my subscriptions cost"
  if (/\bsubscription|subscriptions\b/.test(q) && asksSpend) {
    const active = subscriptions.filter((s) => s.is_active);
    if (!active.length) return null;
    const monthlyTotal = r2(active.reduce(
      (sum, s) => sum + (s.billing_cycle === "annual" ? num(s.amount) / 12 : num(s.amount)), 0));
    return {
      answer: `Your ${active.length} active subscription${active.length === 1 ? "" : "s"} cost $${monthlyTotal.toFixed(2)} a month.`,
      figures: { monthly_total: monthlyTotal, count: active.length },
    };
  }

  // "what was my biggest category [last month]"
  if (/\b(biggest|largest|most|top)\b/.test(q) && /\bcategor/.test(q)) {
    const scope = month ? expenses.filter((e) => monthOf(e) === month) : expenses;
    if (!scope.length) return null;
    const totals = new Map();
    for (const e of scope) {
      const c = e.category || "Uncategorized";
      totals.set(c, r2((totals.get(c) || 0) + num(e.amount)));
    }
    const [topCat, topVal] = [...totals.entries()].sort((a, b) => b[1] - a[1])[0];
    const where = month ? ` in ${monthName(month)}` : "";
    return {
      answer: `Your biggest category${where} was ${topCat}, at $${topVal.toFixed(2)}.`,
      figures: { total: topVal },
    };
  }

  if (!asksSpend) return null;

  // "how much did I spend on Food last month" / "...on Food" / "...last month"
  const scoped = expenses.filter((e) =>
    (!month || monthOf(e) === month) && (!category || e.category === category));
  if (!month && !category) {
    // Bare "how much did I spend" with no scope at all is genuinely
    // ambiguous - all time? this month? Decline rather than pick one.
    return null;
  }
  const total = totalFor(scoped, () => true);
  if (!scoped.length) {
    const what = category ? `on ${category}` : "";
    const when = month ? ` in ${monthName(month)}` : "";
    return {
      answer: `You have nothing recorded ${what}${when}.`.replace(/\s+/g, " ").trim(),
      figures: {},
    };
  }
  const what = category ? ` on ${category}` : "";
  const when = month ? ` in ${monthName(month)}` : "";
  return {
    answer: `You spent $${total.toFixed(2)}${what}${when}, across ${scoped.length} transaction${scoped.length === 1 ? "" : "s"}.`,
    figures: { total, count: scoped.length },
  };
}

/** Whole-word match, the same lookaround idiom categorize.js uses. */
function mentionsWholeWord(text, term) {
  const t = String(term || "").trim();
  if (!t) return false;
  const escaped = t.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(text);
}

/**
 * Answer from an accumulated fact, when the question is unmistakably about
 * that one fact. This is what makes the app get better at answering as it
 * learns more, rather than staying at whatever tier 1 could do on day one.
 *
 * **Exactly one candidate, or nothing.** Two facts matching means the
 * question was ambiguous, and answering the wrong one precisely is worse
 * than declining - the same rule `selectAccountFromText()` (app.js) already
 * applies when more than one account matches a typed description.
 *
 * Both a SUBJECT and an INTENT must match, never just a topic word. A
 * question merely containing "Netflix" is not necessarily asking what
 * Netflix costs, and returning a real figure for a question nobody asked is
 * the same class of confidently-wrong answer this whole design exists to
 * prevent.
 */
function answerFromFacts(question, facts = []) {
  const q = String(question || "").toLowerCase().trim();
  if (!q || !facts.length) return null;

  const wantsCost = /\b(cost|costs|spend|spent|spending|pay|paying|charge|charged|how much)\b/.test(q);
  const candidates = [];

  for (const f of facts) {
    const sep = f.key.indexOf(":");
    const kind = sep === -1 ? f.key : f.key.slice(0, sep);
    const subject = sep === -1 ? "" : f.key.slice(sep + 1);

    if (kind === "recurring") {
      if (mentionsWholeWord(q, subject) && (wantsCost || /\b(regular|regularly|often|every month|monthly|subscription)\b/.test(q))) candidates.push(f);
    } else if (kind === "price_change") {
      if (mentionsWholeWord(q, subject) && /\b(price|prices|increase|increased|went up|gone up|go up|cheaper|dearer|more expensive|changed|change)\b/.test(q)) candidates.push(f);
    } else if (kind === "month_outlier") {
      const monthWord = monthName(subject).split(" ")[0].toLowerCase();
      if (mentionsWholeWord(q, monthWord) && /\b(why|unusual|high|higher|stand out|stands out|spike|expensive|so much)\b/.test(q)) candidates.push(f);
    } else if (kind === "spend_average") {
      if (/\b(usually|typically|normally|average|typical|normal)\b/.test(q) && /\b(spend|spending|month)\b/.test(q)) candidates.push(f);
    }
    // category: deliberately skipped - the direct path above already answers
    // it from live transactions, and a second route to the same answer could
    // only ever disagree with the first. (Subscriptions has no fact at all
    // any more, for the same reason plus three other places already showing
    // the figure.)
    // profile_context: has no figures and answers no question on its own.
  }

  if (candidates.length !== 1) return null;
  const hit = candidates[0];
  return { answer: hit.body, figures: hit.figures || {} };
}

// ---- Tier 2: the context a model is allowed to see -------------------------

/**
 * Build what tier 2 hands the model, and the allow-list its prose is checked
 * against. Deliberately a different shape from insights.js's buildQaContext():
 * that one exists to give the model as much raw material as possible, and
 * this one exists to give it as little arithmetic to do as possible.
 *
 * Transactions ARE included, because detail questions ("what did I buy at
 * Chipotle") need them - but every individual amount goes into `allowed` too,
 * so quoting a real row verifies while a total the model added up itself does
 * not. Pre-computed aggregates are included for the same reason: the more
 * that is computed here, the fewer honest questions end up declined.
 *
 * @returns {{context:object, allowed:number[]}}
 */
export function buildVerifiedContext({ expenses = [], subscriptions = [], facts = [], today = new Date(), windowMonths = 6, maxTransactions = 150 } = {}) {
  const thisMonth = localMonthKey(today);
  const oldest = shiftMonth(thisMonth, windowMonths - 1);
  const inWindow = expenses.filter((e) => monthOf(e) >= oldest && monthOf(e) <= thisMonth);

  const monthly_totals = {};
  for (const [ym, total] of totalsByMonth(inWindow)) monthly_totals[ym] = total;

  const category_totals = {};
  for (const cat of categoriesIn(inWindow)) {
    category_totals[cat] = totalFor(inWindow, (e) => e.category === cat);
  }

  const transactions = inWindow
    .slice(0, maxTransactions)
    .map((e) => ({
      date: e.occurred_at,
      amount: r2(num(e.amount)),
      category: e.category || null,
      description: e.description || e.merchant || null,
      note: (e.note || "").trim() || null,
    }));

  const activeSubs = subscriptions.filter((s) => s.is_active);
  const subscriptions_monthly_total = r2(activeSubs.reduce(
    (sum, s) => sum + (s.billing_cycle === "annual" ? num(s.amount) / 12 : num(s.amount)), 0));

  const window_total = r2(Object.values(monthly_totals).reduce((a, b) => a + b, 0));

  const live = facts.filter((f) => !f.dismissed_at);
  const context = {
    months_covered: Object.keys(monthly_totals).sort(),
    monthly_totals,
    category_totals,
    window_total,
    subscriptions_monthly_total,
    known_facts: live.map((f) => ({ about: f.title, says: f.body })),
    transactions,
    transactions_truncated: inWindow.length > maxTransactions,
  };

  const allowed = collectAllowedFigures(live, [
    ...Object.values(monthly_totals),
    ...Object.values(category_totals),
    ...transactions.map((t) => t.amount),
    subscriptions_monthly_total,
    window_total,
  ]);

  return { context, allowed };
}

// ---- Tier 2: verifying a model's prose against computed figures ------------

/** Every number the model is allowed to state, gathered from what it was given. */
export function collectAllowedFigures(facts = [], extra = []) {
  const out = new Set();
  const add = (v) => { const n = Number(v); if (Number.isFinite(n)) out.add(r2(n)); };
  for (const f of facts) for (const v of Object.values(f.figures || {})) add(v);
  for (const v of extra) add(v);
  return [...out];
}

/** Parse the dollar amounts and percentages a piece of prose asserts. */
export function statedFigures(text) {
  const out = [];
  const s = String(text || "");
  // \d+ FIRST, then optional comma groups. Written the other way round
  // (comma-form as the leading alternative) the regex matches a PREFIX of an
  // unpunctuated amount - "$3362.37" parsed as 336 - which would have let a
  // wrong figure through verification by silently mis-reading a right one.
  // Caught by fixture, not by reading it.
  for (const m of s.matchAll(/\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)/g)) {
    out.push({ raw: m[0], value: Number(m[1].replace(/,/g, "")), kind: "money" });
  }
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s*%/g)) {
    out.push({ raw: m[0], value: Number(m[1]), kind: "percent" });
  }
  return out;
}

/**
 * True when a stated value is a faithful restatement of a computed one.
 * Deliberately tolerant of ROUNDING, which is something the prompt actively
 * asks for ("about $580"), and intolerant of anything else: the failure this
 * exists to catch was $807.11 against a real $3,362.37, which no rounding
 * rule reaches.
 */
function matchesAllowed(value, allowed) {
  return allowed.some((a) => {
    if (Math.abs(value - a) <= 0.011) return true;
    if (Math.abs(value - a) <= Math.abs(a) * 0.005) return true;
    for (const step of [1, 10, 100, 1000]) {
      if (Math.round(a / step) * step === value) return true;
    }
    return false;
  });
}

/**
 * Check every figure in a model-written answer against the computed values it
 * was handed. A figure that matches none of them did not come from this
 * user's data, so the answer is rejected rather than displayed.
 *
 * Scoped to money and percentages on purpose. Those are what the measured
 * failure produced and what a reader acts on; years and counts appear
 * constantly in ordinary prose ("the last 6 months", "August 2026") and
 * policing them would reject correct answers without preventing a wrong
 * figure.
 *
 * @returns {{ok:true}|{ok:false, offending:string[]}}
 */
export function verifyAnswerFigures(answer, allowed) {
  const stated = statedFigures(answer);
  const offending = stated.filter((f) => !matchesAllowed(f.value, allowed)).map((f) => f.raw);
  return offending.length ? { ok: false, offending } : { ok: true };
}
