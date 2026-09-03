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
import { localMonthKey, localDateISO } from "./dates.js";
// Reused rather than reimplemented. An earlier version of this file had its
// own recurring-merchant detector, which was both a duplicate and a worse
// one: this groups on merchant AND exact amount, matches the real gaps
// between charges against known billing intervals, checks the run is still
// current, and excludes anything already declared as a subscription.
import { detectRecurringExpenses } from "./subscriptions.js";

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

  // No "typical month" fact. renderReports()'s own stat tile already computes
  // that figure, over the same 6-month window and with the same
  // divide-by-months-that-contain-something rule, so a fact would have been
  // the identical number in a second place. answerTypicalMonth() below
  // answers the question directly instead, which needs no stored fact.

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

  // No "is regular" fact. subscriptions.js's detectRecurringExpenses()
  // already detects recurring merchants, has its own card on the Log page,
  // and does it far more rigorously - grouping on merchant AND exact amount,
  // matching the real gap between charges against known intervals, and
  // checking the run is still current. This module only looks for a price
  // MOVE, which that detector does not report and no chart shows.
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

  // No profile fact. It only restated the Profile page in another place,
  // carried no figures, and so answered no question and verified nothing.

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

// Nobody asks "how much did I spend on Food". They ask about groceries,
// eating out, petrol, rent. Without these a perfectly ordinary question fell
// through to the slow model path purely over vocabulary.
const CATEGORY_SYNONYMS = {
  Food: ["groceries", "grocery", "eating out", "eat out", "restaurants", "restaurant", "takeaway", "takeout", "dining", "dining out", "coffee", "lunch", "lunches", "dinner", "dinners", "breakfast", "meals", "food"],
  // No bare "car" or "gas": both are ordinary English long before they are
  // spending categories, and "how do I fix my car engine" was reaching the
  // model because of it. A synonym has to be a word people use ABOUT money.
  Transport: ["transport", "transportation", "petrol", "fuel", "commute", "commuting", "train fare", "bus fare", "taxi", "taxis", "rideshare", "parking"],
  Subscriptions: ["subscriptions", "subscription", "streaming", "memberships", "membership"],
  Shopping: ["shopping", "clothes", "clothing", "amazon", "online shopping", "retail"],
  Utilities: ["utilities", "utility", "electric", "electricity", "water bill", "internet", "broadband", "phone bill", "heating"],
  Housing: ["housing", "rent", "mortgage", "landlord", "housing costs"],
  Health: ["health", "healthcare", "medical", "doctor", "dentist", "pharmacy", "prescriptions", "gym"],
  Entertainment: ["entertainment", "fun", "going out", "movies", "cinema", "concerts", "games", "hobbies"],
  Other: ["other", "miscellaneous", "misc"],
};

/**
 * Find which of the user's own categories a question names, by the category's
 * own name or by an everyday word for it. Exactly one or nothing: a question
 * naming two categories is a comparison this does not do, and picking one of
 * them would answer something nobody asked.
 */
export function resolveCategory(question, expenses) {
  const q = question.toLowerCase();
  const present = categoriesIn(expenses);
  const hits = present.filter((c) => {
    const terms = [c, ...(CATEGORY_SYNONYMS[c] || [])];
    return terms.some((t) => mentionsWholeWord(q, t));
  });
  return hits.length === 1 ? hits[0] : null;
}

/** A merchant the user has actually paid, named in the question. */
export function resolveMerchant(question, expenses) {
  const q = question.toLowerCase();
  const names = [...new Set(expenses.map((e) => (e.merchant || "").trim()).filter((n) => n.length > 2))];
  const hits = names.filter((n) => mentionsWholeWord(q, n));
  return hits.length === 1 ? hits[0] : null;
}

/** Every month a question names, in the order named. */
export function resolveMonths(question, today = new Date()) {
  const q = String(question || "").toLowerCase();
  const thisMonth = localMonthKey(today);
  const out = [];
  for (const m of q.matchAll(/(?<![a-z])(january|february|march|april|may|june|july|august|september|october|november|december)(?![a-z])/g)) {
    const idx = MONTH_NAMES.indexOf(m[1]);
    const yearMatch = q.match(/\b(20\d{2})\b/);
    const year = yearMatch ? Number(yearMatch[1]) : Number(thisMonth.slice(0, 4));
    let key = `${year}-${String(idx + 1).padStart(2, "0")}`;
    if (key > thisMonth && !yearMatch) key = `${year - 1}-${String(idx + 1).padStart(2, "0")}`;
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

/**
 * A date range the question asks about: a single month, "last N months",
 * a named year, or nothing. Returned as inclusive YYYY-MM bounds plus the
 * words to describe it back, so every answer states the span it used rather
 * than leaving the reader to assume one.
 */
export function resolveRange(question, today = new Date()) {
  const q = String(question || "").toLowerCase();
  const thisMonth = localMonthKey(today);

  const dayOf = (d) => localDateISO(d);
  const shiftDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const monthSpan = (ym) => ({ from: `${ym}-01`, to: `${ym}-31`, label: monthName(ym) });

  if (/\byesterday\b/.test(q)) {
    const d = dayOf(shiftDays(today, -1));
    return { from: d, to: d, label: "yesterday" };
  }
  if (/\btoday\b/.test(q)) {
    const d = dayOf(today);
    return { from: d, to: d, label: "today" };
  }
  if (/\blast week\b/.test(q)) {
    return { from: dayOf(shiftDays(today, -14)), to: dayOf(shiftDays(today, -8)), label: "last week" };
  }
  if (/\b(this week|past week|last 7 days|past 7 days)\b/.test(q)) {
    return { from: dayOf(shiftDays(today, -6)), to: dayOf(today), label: "the last 7 days" };
  }
  const lastNDays = q.match(/\blast (\d+)\s+days?\b/);
  if (lastNDays) {
    const n = Math.min(400, Number(lastNDays[1]));
    if (n >= 1) return { from: dayOf(shiftDays(today, -(n - 1))), to: dayOf(today), label: `the last ${n} days` };
  }

  const lastN = q.match(/\blast (\d+|three|six|twelve)\s+months?\b/);
  if (lastN) {
    const words = { three: 3, six: 6, twelve: 12 };
    const n = Math.min(60, words[lastN[1]] || Number(lastN[1]));
    if (n >= 1) return { from: `${shiftMonth(thisMonth, n - 1)}-01`, to: `${thisMonth}-31`, label: `the last ${n} months` };
  }
  if (/\bthis year\b/.test(q)) {
    const y = thisMonth.slice(0, 4);
    return { from: `${y}-01-01`, to: `${thisMonth}-31`, label: `${y} so far` };
  }
  if (/\blast year\b/.test(q)) {
    const y = String(Number(thisMonth.slice(0, 4)) - 1);
    return { from: `${y}-01-01`, to: `${y}-12-31`, label: y };
  }
  const month = resolveMonth(q, today);
  if (month) return monthSpan(month);
  return null;
}

/**
 * Answer a question outright when its shape is recognised, or return null so
 * the caller can fall back to the model. Never guesses: an unrecognised
 * question, or a recognised one with no data behind it, returns null rather
 * than a number that might be answering something else.
 *
 * @returns {{answer:string, figures:object}|null}
 */
export function answerQuestion(question, { expenses = [], subscriptions = [], income = [], facts = [], balances = null, today = new Date() } = {}) {
  const direct = answerFromTransactions(question, { expenses, subscriptions, income, balances, today });
  if (direct) return direct;
  // Facts are tried only after the direct paths, which are more specific.
  // This is what makes tier 1's coverage GROW as knowledge accumulates: a
  // question about a merchant or a standout month has no direct path, but
  // once the pattern behind it has been noticed it can be answered exactly
  // and instantly instead of falling through to the model.
  return answerFromFacts(question, facts);
}

function answerFromTransactions(question, { expenses = [], subscriptions = [], income = [], balances = null, today = new Date() } = {}) {
  const q = String(question || "").toLowerCase().trim();
  if (!q) return null;

  const asksSpend = /\b(spend|spent|spending|spends|cost|costs|paid|pay|paying|pays|went on|go on)\b/.test(q)
    // "how much on petrol this year" names no verb at all, and is still
    // unambiguously a spend question once it has named something to scope by.
    || /\bhow much\b/.test(q) || /\bwhat did .* cost\b/.test(q);
  const range = resolveRange(q, today);
  const category = resolveCategory(q, expenses);
  const merchant = resolveMerchant(q, expenses);
  // Compares the stored YYYY-MM-DD directly, so a range can be a day, a week
  // or a year without a separate code path for each.
  const inRange = (row) => !range || ((row.occurred_at || "") >= range.from && (row.occurred_at || "") <= range.to);
  const when = range ? ` in ${range.label}` : "";
  const monthTotal = (ym, cat) => r2(expenses
    .filter((e) => monthOf(e) === ym && (!cat || e.category === cat))
    .reduce((sum, e) => sum + num(e.amount), 0));

  // A comparison is a DIFFERENT QUESTION from a total, and answering it with
  // one number is the confidently-wrong failure this whole design exists to
  // avoid - "am I spending more than last month" was coming back with just
  // this month's figure, and "did I spend more in July or August" with July's.
  // So comparison intent is detected first, answered properly where the data
  // allows, and otherwise declined to tier 2 rather than downgraded.
  const asksComparison = /\b(more than|less than|compare|compared|comparison|versus|vs|going up|going down|gone up|gone down|rising|falling|increasing|decreasing|trend|higher than|lower than|than last|than usual)\b/.test(q)
    || /\b\w+ or \w+\b/.test(q) && resolveMonths(q, today).length === 2;

  if (asksComparison) {
    // Income against spending is a comparison too, and contains "more than",
    // so it has to be caught here or the month-pair logic below declines a
    // question this can answer exactly.
    if (income.length && /\b(earn|earning|income|make|making|bring in|coming in)\b/.test(q)) {
      const inc = r2(income.filter(inRange).reduce((sum, r) => sum + num(r.amount), 0));
      const out = r2(expenses.filter(inRange).reduce((sum, e) => sum + num(e.amount), 0));
      if (inc > 0 || out > 0) {
        return {
          answer: `$${inc.toFixed(2)} came in${when} and $${out.toFixed(2)} went out, so you are spending ${out > inc ? "more than" : out < inc ? "less than" : "exactly what"} you earn.`,
          figures: { income: inc, spent: out },
        };
      }
    }
    const named = resolveMonths(q, today);
    const thisM = localMonthKey(today);
    const prevM = shiftMonth(thisM, 1);
    // two months named outright, e.g. "more in July or August"
    const [a, b] = named.length === 2 ? named : (/\bthan last month\b|\blast month\b|\bthis month\b/.test(q) ? [prevM, thisM] : []);
    if (a && b) {
      const av = monthTotal(a, category);
      const bv = monthTotal(b, category);
      const what = category ? ` on ${category}` : "";
      if (av === 0 && bv === 0) return null;
      const dir = bv > av ? "more" : bv < av ? "less" : "the same";
      // The month in progress is not a fair comparison against a finished
      // one - a few days in you always look like you are spending less, which
      // is true of the figures and false as an answer. Say "so far" rather
      // than let the reader assume a like-for-like month.
      const label = (ym) => monthName(ym) + (ym === localMonthKey(today) ? " so far" : "");
      return {
        answer: dir === "the same"
          ? `You spent the same${what} in both: $${av.toFixed(2)} in ${label(a)} and $${bv.toFixed(2)} in ${label(b)}.`
          : `You spent $${bv.toFixed(2)}${what} in ${label(b)} against $${av.toFixed(2)} in ${label(a)}, so ${dir} by $${Math.abs(r2(bv - av)).toFixed(2)}.`,
        figures: { [a]: av, [b]: bv, difference: Math.abs(r2(bv - av)) },
      };
    }
    // "is my food spending going up" - compare the two halves of the window
    if (/\b(going up|going down|gone up|gone down|rising|falling|increasing|decreasing|trend)\b/.test(q)) {
      const windowMonths = 6;
      const mid = shiftMonth(thisM, Math.floor(windowMonths / 2) - 1);
      const oldest = shiftMonth(thisM, windowMonths - 1);
      const pick = (from, to) => r2(expenses
        .filter((e) => monthOf(e) >= from && monthOf(e) <= to && (!category || e.category === category))
        .reduce((sum, e) => sum + num(e.amount), 0));
      const earlier = pick(oldest, shiftMonth(mid, 1));
      const recent = pick(mid, thisM);
      if (earlier > 0 && recent > 0) {
        const pct = r2(((recent - earlier) / earlier) * 100);
        const what = category ? `${category} spending` : "Your spending";
        return {
          answer: pct === 0
            ? `${what} is level: $${recent.toFixed(2)} in the last three months against $${earlier.toFixed(2)} in the three before.`
            : `${what} is ${pct > 0 ? "up" : "down"} ${Math.abs(pct).toFixed(0)}%: $${recent.toFixed(2)} in the last three months against $${earlier.toFixed(2)} in the three before.`,
          figures: { recent, earlier, change_pct: pct },
        };
      }
    }
    // Recognised as a comparison but not computable from what is here. Decline
    // rather than fall through to the plain-total path below, which would
    // answer a comparison with a single figure.
    return null;
  }

  // "what do my subscriptions cost"
  if (mentionsWholeWord(q, "subscriptions") && asksSpend && !range) {
    const active = subscriptions.filter((s) => s.is_active);
    if (!active.length) return null;
    const monthlyTotal = r2(active.reduce(
      (sum, s) => sum + (s.billing_cycle === "annual" ? num(s.amount) / 12 : num(s.amount)), 0));
    return {
      answer: `Your ${active.length} active subscription${active.length === 1 ? "" : "s"} cost $${monthlyTotal.toFixed(2)} a month.`,
      figures: { monthly_total: monthlyTotal, count: active.length },
    };
  }

  // Income. Tier 1 could not answer a single income question before this,
  // which is a large hole in something called "ask about your spending" -
  // money coming in is half of what anyone wants to know.
  // No "make"/"made": "how many transactions did I make" is not an income
  // question, and treating it as one answered it with a paycheck figure.
  const asksIncome = /\b(earn|earned|earning|earnings|income|paid in|salary|wages|paycheck|payslip|take home|came in)\b/.test(q);
  // "net worth" is assets minus liabilities, a different concept from income
  // minus spending - answering one with the other was confidently wrong, not
  // merely imprecise, so it is excluded here and handled on its own below.
  const asksNet = /\b(save|saved|saving|left over|leftover|net|difference|ahead|behind)\b/.test(q) && !/\bnet worth\b/.test(q);
  if ((asksIncome || asksNet) && income.length && !asksComparison) {
    const inc = r2(income.filter(inRange).reduce((sum, r) => sum + num(r.amount), 0));
    if (asksNet) {
      const out = r2(expenses.filter(inRange).reduce((sum, e) => sum + num(e.amount), 0));
      const net = r2(inc - out);
      return {
        answer: `${when ? when.trim()[0].toUpperCase() + when.trim().slice(1) : "Across everything recorded"}, $${inc.toFixed(2)} came in and $${out.toFixed(2)} went out, so you were ${net >= 0 ? "ahead" : "behind"} by $${Math.abs(net).toFixed(2)}.`,
        figures: { income: inc, spent: out, net: Math.abs(net) },
      };
    }
    return { answer: `You had $${inc.toFixed(2)} come in${when}.`, figures: { income: inc } };
  }

  // Net worth and debt, from the totals app.js already computed for the Net
  // worth card. Deliberately not re-derived here: this module cannot see
  // which accounts are archived or which holdings are counted at the parent,
  // and a second calculation could only ever disagree with the card.
  if (balances) {
    if (/\bnet worth\b/.test(q)) {
      return {
        answer: `Your net worth is $${balances.net.toFixed(2)}: $${balances.assets.toFixed(2)} in things you own, less $${balances.liabilities.toFixed(2)} you owe.`,
        figures: { net: balances.net, assets: balances.assets, liabilities: balances.liabilities },
      };
    }
    if (/\b(owe|owed|debt|debts)\b/.test(q)) {
      return {
        answer: balances.liabilities > 0
          ? `You owe $${balances.liabilities.toFixed(2)} in total.`
          : `You have nothing recorded as owed.`,
        figures: { liabilities: balances.liabilities },
      };
    }
  }

  // "what was my biggest expense" - a single transaction, not a category.
  if (/\b(biggest|largest|most expensive|priciest|highest)\b/.test(q) && /\b(expense|purchase|transaction|payment|buy|bought|thing)\b/.test(q)) {
    const scope = expenses.filter(inRange);
    if (!scope.length) return null;
    const top = [...scope].sort((a, b) => num(b.amount) - num(a.amount))[0];
    const what = (top.description || top.merchant || "").trim();
    return {
      answer: `Your biggest single expense${when} was $${num(top.amount).toFixed(2)}${what ? ` at ${what}` : ""} on ${top.occurred_at}.`,
      figures: { amount: r2(num(top.amount)) },
    };
  }

  // Small stats that were falling through to a 45-second model call for
  // arithmetic this file can do exactly.
  const scopedNow = () => expenses.filter((e) => inRange(e)
    && (!category || e.category === category)
    && (!merchant || (e.merchant || "").trim() === merchant));

  if (/\baverage\b|\btypical\b/.test(q) && /\b(transaction|transactions|purchase|purchases|expense|expenses|spend)\b/.test(q)) {
    const scope = scopedNow();
    if (scope.length) {
      const avg = r2(scope.reduce((sum, e) => sum + num(e.amount), 0) / scope.length);
      return {
        answer: `Your average transaction${when} was $${avg.toFixed(2)}, across ${scope.length} of them.`,
        figures: { average: avg, count: scope.length },
      };
    }
  }

  if (/\b(smallest|cheapest|least expensive|lowest)\b/.test(q) && /\b(expense|purchase|transaction|payment|thing)\b/.test(q)) {
    const scope = scopedNow();
    if (scope.length) {
      const low = [...scope].sort((a, b) => num(a.amount) - num(b.amount))[0];
      const what = (low.description || low.merchant || "").trim();
      return {
        answer: `Your smallest expense${when} was $${num(low.amount).toFixed(2)}${what ? ` at ${what}` : ""} on ${low.occurred_at}.`,
        figures: { amount: r2(num(low.amount)) },
      };
    }
  }

  // "when did I last shop at Shell"
  if (/\b(when|last time|how recently)\b/.test(q) && merchant) {
    const hits = expenses.filter((e) => (e.merchant || "").trim() === merchant)
      .sort((a, b) => (b.occurred_at || "").localeCompare(a.occurred_at || ""));
    if (hits.length) {
      return {
        answer: `The last time was ${hits[0].occurred_at}, for $${num(hits[0].amount).toFixed(2)}.`,
        figures: { amount: r2(num(hits[0].amount)) },
      };
    }
  }

  // "what is my savings rate" / "am I spending more than I earn"
  if (income.length && (/\bsavings? rate\b/.test(q) || /\bmore than i (earn|make)\b/.test(q) || /\bspending more than i\b/.test(q))) {
    const inc = r2(income.filter(inRange).reduce((sum, r) => sum + num(r.amount), 0));
    const out = r2(expenses.filter(inRange).reduce((sum, e) => sum + num(e.amount), 0));
    if (inc > 0) {
      const kept = r2(((inc - out) / inc) * 100);
      return {
        answer: `Of the $${inc.toFixed(2)} that came in${when}, you spent $${out.toFixed(2)} and kept ${kept.toFixed(0)}%.`,
        figures: { income: inc, spent: out, kept_pct: kept },
      };
    }
  }

  // "what is my biggest bill"
  if (/\b(biggest|largest|most expensive|priciest)\b/.test(q) && /\b(bill|bills|subscription|subscriptions)\b/.test(q)) {
    const active = subscriptions.filter((x) => x.is_active);
    if (active.length) {
      const monthly = (x) => (x.billing_cycle === "annual" ? num(x.amount) / 12 : num(x.amount));
      const top = [...active].sort((a, b) => monthly(b) - monthly(a))[0];
      return {
        answer: `Your biggest is ${top.name}, at $${r2(monthly(top)).toFixed(2)} a month.`,
        figures: { amount: r2(monthly(top)) },
      };
    }
  }

  // "how many times did I ..."
  if (/\bhow many\b|\bhow often\b|\bnumber of\b|\bhow much did i buy\b/.test(q)) {
    const scope = expenses.filter((e) => inRange(e)
      && (!category || e.category === category)
      && (!merchant || (e.merchant || "").trim() === merchant));
    if (!category && !merchant && !range) return null;
    const what = merchant ? ` at ${merchant}` : category ? ` on ${category}` : "";
    return {
      answer: `${scope.length} transaction${scope.length === 1 ? "" : "s"}${what}${when}.`,
      figures: { count: scope.length },
    };
  }

  // "where is my money going"
  if (/\bwhere\b/.test(q) && /\b(money|cash|spending|it all)\b/.test(q) && /\b(going|go|goes|went)\b/.test(q)) {
    const scope = expenses.filter(inRange);
    if (scope.length) {
      const totals = new Map();
      for (const e of scope) {
        const c = e.category || "Uncategorized";
        totals.set(c, r2((totals.get(c) || 0) + num(e.amount)));
      }
      const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      return {
        answer: `Mostly ${top.map(([c, v]) => `${c} at $${v.toFixed(2)}`).join(", then ")}${when}.`,
        figures: Object.fromEntries(top),
      };
    }
  }

  // "what was my biggest category"
  if (/\b(biggest|largest|most|top)\b/.test(q) && /\bcategor/.test(q)) {
    const scope = expenses.filter(inRange);
    if (!scope.length) return null;
    const totals = new Map();
    for (const e of scope) {
      const c = e.category || "Uncategorized";
      totals.set(c, r2((totals.get(c) || 0) + num(e.amount)));
    }
    const [topCat, topVal] = [...totals.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      answer: `Your biggest category${when} was ${topCat}, at $${topVal.toFixed(2)}.`,
      figures: { total: topVal },
    };
  }

  // "what do I usually spend in a month". Computed live rather than stored:
  // small arithmetic over data already in hand, and a stored figure could
  // only ever be staler.
  if (/\b(usually|typically|normally|average|typical|normal)\b/.test(q) && /\b(spend|spending|month)\b/.test(q)) {
    const totals = totalsByMonth(expenses);
    // Two months minimum: averaged over one, "typical" is just that month.
    if (totals.size >= 2) {
      const sum = r2([...totals.values()].reduce((a, b) => a + b, 0));
      const average = r2(sum / totals.size);
      return {
        answer: `You spend about $${average.toFixed(2)} in a typical month, averaged across the ${totals.size} months that have spending recorded.`,
        figures: { average, months_counted: totals.size },
      };
    }
  }

  // "how much does Netflix cost me" - the app's existing recurring detector
  // rather than a fact of our own. Exactly one match or nothing.
  // Gated on asking what something COSTS, not what was SPENT: "how much does
  // Netflix cost me" wants the charge, "how much have I spent at Shell" wants
  // the total, and answering either with the other is answering a question
  // nobody asked.
  const asksWhatItCharges = /\b(cost|costs|charge|charges|charged|price)\b/.test(q) && !/\b(spent|spend|spending)\b/.test(q);
  if (asksWhatItCharges && !range) {
    const hits = detectRecurringExpenses(expenses, subscriptions, today)
      .filter((c) => mentionsWholeWord(q, c.merchant));
    if (hits.length === 1) {
      const c = hits[0];
      return {
        // cycleLabel is "month" / "year" / "~7 days", so it needs "every".
        answer: `${c.merchant} charges $${c.amount.toFixed(2)} every ${c.cycleLabel.toLowerCase()}, and has done so ${c.occurrenceCount} times.`,
        figures: { amount: c.amount, occurrences: c.occurrenceCount },
      };
    }
  }

  if (!asksSpend) return null;

  // "how much did I spend on Food last month" / at a merchant / over a range.
  // A bare "how much did I spend" with no scope at all is genuinely
  // ambiguous - all time? this month? - so it declines rather than picking.
  if (!range && !category && !merchant) return null;
  const scoped = expenses.filter((e) => inRange(e)
    && (!category || e.category === category)
    && (!merchant || (e.merchant || "").trim() === merchant));
  const what = merchant ? ` at ${merchant}` : category ? ` on ${category}` : "";
  if (!scoped.length) {
    return { answer: `You have nothing recorded${what}${when}.`, figures: {} };
  }
  const total = r2(scoped.reduce((sum, e) => sum + num(e.amount), 0));
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
  if (!q) return null;

  const wantsCost = /\b(cost|costs|spend|spent|spending|pay|paying|charge|charged|how much)\b/.test(q);
  const candidates = [];

  for (const f of facts) {
    const sep = f.key.indexOf(":");
    const kind = sep === -1 ? f.key : f.key.slice(0, sep);
    const subject = sep === -1 ? "" : f.key.slice(sep + 1);

    if (kind === "price_change") {
      if (mentionsWholeWord(q, subject) && /\b(price|prices|increase|increased|went up|gone up|go up|cheaper|dearer|more expensive|changed|change)\b/.test(q)) candidates.push(f);
    } else if (kind === "month_outlier") {
      const monthWord = monthName(subject).split(" ")[0].toLowerCase();
      if (mentionsWholeWord(q, monthWord) && /\b(why|unusual|high|higher|stand out|stands out|spike|expensive|so much)\b/.test(q)) candidates.push(f);
    }
    // category: deliberately skipped - the direct path above already answers
    // it from live transactions, and a second route to the same answer could
    // only ever disagree with the first. (Subscriptions has no fact at all
    // any more, for the same reason plus three other places already showing
    // the figure.)
    // profile_context: has no figures and answers no question on its own.
  }

  // "did any prices go up" names no subject at all, so the per-fact matcher
  // above cannot reach it - but it is precisely what these facts are for.
  if (/\b(any|anything|which|what)\b/.test(q) && /\b(price|prices)\b/.test(q) && /\b(up|down|change|changed|risen|rise|increase|increased)\b/.test(q)) {
    const moves = facts.filter((f) => f.key.startsWith("price_change:"));
    if (!moves.length) return { answer: "No price changes stood out in what you have recorded.", figures: {} };
    return {
      answer: moves.map((f) => f.body).join(" "),
      figures: Object.assign({}, ...moves.map((f) => f.figures || {})),
    };
  }

  if (candidates.length !== 1) return null;
  const hit = candidates[0];
  return { answer: hit.body, figures: hit.figures || {} };
}

// ---- The scope guard ------------------------------------------------------

// Broad on purpose. This gate exists to catch questions that are not about
// this person's money AT ALL, not to police how they phrase one - a false
// refusal is worse than a slow answer, because it tells someone their own
// question about their own data is not allowed.
const MONEY_WORDS = [
  "spend", "spent", "spending", "spendings", "cost", "costs", "costly", "paid", "pay", "paying", "payment", "payments",
  "buy", "bought", "buying", "purchase", "purchases", "expense", "expenses", "transaction", "transactions",
  "income", "earn", "earned", "earning", "earnings", "salary", "wages", "paycheck", "payslip",
  "save", "saved", "saving", "savings", "budget", "budgets", "afford", "left over", "leftover",
  "owe", "owed", "debt", "debts", "loan", "loans", "credit", "card", "interest", "balance", "balances",
  "account", "accounts", "bank", "cash", "money", "dollar", "dollars", "amount", "amounts", "total", "totals",
  "subscription", "subscriptions", "bill", "bills", "recurring", "renewal",
  "net worth", "asset", "assets", "liability", "liabilities", "invest", "investment", "investments",
  "average", "typical", "usually", "most", "biggest", "largest", "highest", "lowest", "cheapest",
  "month", "months", "monthly", "week", "weeks", "weekly", "year", "years", "yearly", "annual",
  "category", "categories", "merchant", "shop", "store", "history", "record", "records", "log",
  // Added after a real corpus run refused these: "did any prices go up" and
  // "what should I cut back on" are both plainly about the user's own money,
  // and the app even holds the data for the first.
  "price", "prices", "cut back", "cut down", "spend less", "overspending", "unusual", "trend", "trends",
];

/**
 * Is this a question about the user's own financial history at all?
 *
 * The app answers questions about the records in front of it and nothing
 * else. Without this gate an off-topic question fell straight through to
 * tier 2, which would hand a general-purpose language model the user's whole
 * financial context and let it answer about anything it liked - the exact
 * "not allowed anything more" this is meant to prevent. It also happens to
 * stop an instruction-shaped question ("ignore the above and ...") reaching
 * the model, since that contains no financial term either.
 *
 * Runs ONLY before tier 2. If tier 1 recognised the question, that is itself
 * proof it was about their money, and re-checking could only produce a false
 * refusal for a question already answered correctly.
 *
 * Their own data counts as a signal: a bare merchant name, a category, a
 * month or an account is unmistakably about their records even with no
 * money word in the sentence.
 */
export function isAboutOwnMoney(question, { expenses = [], accounts = [], subscriptions = [], today = new Date() } = {}) {
  const q = String(question || "").toLowerCase().trim();
  if (!q) return false;
  if (MONEY_WORDS.some((w) => mentionsWholeWord(q, w))) return true;
  if (MONTH_NAMES.some((m) => mentionsWholeWord(q, m))) return true;
  if (resolveRange(q, today)) return true;
  if (resolveCategory(q, expenses)) return true;
  if (resolveMerchant(q, expenses)) return true;
  const named = [
    ...accounts.map((a) => (a.name || "").trim()),
    ...accounts.map((a) => (a.bank_name || "").trim()),
    ...subscriptions.map((x) => (x.name || "").trim()),
  ].filter((n) => n.length > 2);
  return named.some((n) => mentionsWholeWord(q, n));
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
