// ============================================================================
// Reports and chart data preparation.
// Pure aggregation helpers (unit-testable) + Chart.js renderers.
// Chart.js is loaded from CDN in index.html as global `Chart`.
// ============================================================================

import { localMonthKey } from "./dates.js";
/** YYYY-MM string for a Date. */
export function monthKey(d = new Date()) {
  return localMonthKey(d);
}

/**
 * Human label for a YYYY-MM key, e.g. "2026-07" -> "July 2026".
 *
 * The FULL month name, everywhere, deliberately. This used to be the short
 * form while the Q&A wrote "July 2026", so the same month was spelled two
 * ways on one page. One format, one function, so they cannot drift again -
 * wiki.js's monthName() now delegates here rather than keeping its own copy.
 */
export function monthLabel(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
}

/**
 * The "typical month" figure, defined ONCE because two places show it: the
 * Reports stat tile and the Q&A's answer to "what do I usually spend in a
 * month". They disagreed - measured at $600 against $400 on the same data,
 * because one averaged the last 6 months and the other averaged everything.
 * Two answers to one question on one page is the failure this whole app
 * works hardest to avoid, so there is now one calculation and two readers.
 *
 * Averages over months that actually CONTAIN something, never over the
 * window length: dividing by the full window is the specific bug behind the
 * old savings-runway tile, where one month of data out of three understated
 * real spending threefold.
 *
 * Reports net rather than spending once any income is recorded, because
 * "what is left over" is the better question when both sides are known - but
 * with no income it would be a subtraction with an empty side, stating
 * confidently and wrongly that money is being lost.
 */
export function averageMonth(expenses, incomeActivity, months) {
  const rows = incomeVsExpense(incomeActivity, expenses, months);
  const hasIncome = rows.some((r) => r.income > 0);
  const active = rows.filter((r) => (hasIncome ? r.income > 0 || r.expense > 0 : r.expense > 0));
  if (!active.length) return { hasIncome, monthsCounted: 0, spend: null, net: null };
  const mean = (pick) => Math.round((active.reduce((s, r) => s + pick(r), 0) / active.length) * 100) / 100;
  return {
    hasIncome,
    monthsCounted: active.length,
    spend: mean((r) => r.expense),
    net: hasIncome ? mean((r) => r.income - r.expense) : null,
  };
}

/** The last `n` YYYY-MM keys ending at `endYm` (inclusive), oldest first. */
export function lastMonths(n, endYm = monthKey()) {
  const [y, m] = endYm.split("-").map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    out.push(monthKey(d));
  }
  return out;
}

/** Sum expenses in a given YYYY-MM, grouped by a field ('category'|'account'). */
export function sumBy(expenses, field, ym, accountName = () => "") {
  const totals = {};
  for (const e of expenses) {
    if (!(e.occurred_at || "").startsWith(ym)) continue;
    let key;
    if (field === "category") key = e.category || "Uncategorized";
    else if (field === "account") key = accountName(e.account_id) || "Unassigned";
    else key = e[field] || "Unspecified";
    totals[key] = (totals[key] || 0) + Number(e.amount || 0);
  }
  // Return sorted desc by amount.
  return Object.entries(totals)
    .map(([label, value]) => ({ label, value: Math.round(value * 100) / 100 }))
    .sort((a, b) => b.value - a.value);
}

/** Total per month across a set of month keys. */
export function monthlyTotals(expenses, months) {
  const map = Object.fromEntries(months.map((m) => [m, 0]));
  for (const e of expenses) {
    const ym = (e.occurred_at || "").slice(0, 7);
    if (ym in map) map[ym] += Number(e.amount || 0);
  }
  return months.map((m) => Math.round(map[m] * 100) / 100);
}

/**
 * Per-month income vs. expense totals plus a savings rate, for the
 * Reports page's "Income vs. expense" card. `incomeActivity` is
 * `account_activity` rows already filtered to `kind === "income"` (the
 * caller's job, same as `monthlyTotals` above expects already-filtered
 * `expenses`, not raw `account_activity`). Expense totals reuse
 * `monthlyTotals` directly rather than re-summing - one source of truth
 * for "how is a month's expense total computed" between this card and
 * every other Reports chart.
 * @returns [{month, income, expense, savingsRate}] - savingsRate is
 *   `(income - expense) / income`, or null when income is 0 (nothing to
 *   divide by, not a real 0% or negative rate worth stating).
 */
export function incomeVsExpense(incomeActivity, expenses, months) {
  const incomeMap = Object.fromEntries(months.map((m) => [m, 0]));
  for (const a of incomeActivity) {
    const ym = (a.occurred_at || "").slice(0, 7);
    if (ym in incomeMap) incomeMap[ym] += Number(a.amount || 0);
  }
  const expenseTotals = monthlyTotals(expenses, months);
  return months.map((m, i) => {
    const income = Math.round(incomeMap[m] * 100) / 100;
    const expense = expenseTotals[i];
    return {
      month: m,
      income,
      expense,
      savingsRate: income > 0 ? Math.round(((income - expense) / income) * 1000) / 1000 : null,
    };
  });
}

// ---- Chart.js rendering ----------------------------------------------------
// A <canvas> cannot resolve a CSS variable: handing Chart.js "var(--accent)"
// paints nothing at all, silently. So every colour has to arrive already
// resolved, and the only question is where it resolves. It resolves here,
// read from the same :root tokens the rest of the app uses, rather than from a
// second copy of the palette kept in this file - a second copy is exactly what
// made this module blind to the theme, and what let the chart palette drift
// until it held two ambers 5.1 apart under normal vision.
//
// This module already reaches the DOM for `new Chart(canvas, ...)` and for
// describeChart(), and for the same stated reason: the canvas is the one
// element it owns. Its pure half (monthKey, lastMonths, sumBy, monthlyTotals,
// incomeVsExpense, averageMonth) stays node-importable, which is what
// "pure-ish logic module" actually protects.
// Exported because the account circles wrap on it too. It was a literal 8
// there, which put the palette size in three places (here, that literal, and
// the tokens themselves) after a change whose whole point was to stop the
// circles and the charts keeping separate lists.
export const SERIES_COUNT = 8;
// Read per render rather than cached. A cache would need invalidating from the
// theme toggle, which is one more thing to keep in step for a read of about
// ten custom properties.
function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  // getPropertyValue keeps the token's leading whitespace, and an unknown
  // token returns "". Chart.js would take "" and paint black on black, so a
  // misspelling fails loudly here instead of looking like a rendering bug.
  const v = (name) => {
    const raw = cs.getPropertyValue(name).trim();
    if (!raw) throw new Error(`Missing CSS token ${name}`);
    return raw;
  };
  return {
    grid: v("--border"),
    text: v("--muted"),
    line: v("--accent-2"),
    lineFill: v("--chart-line-fill"),
    series: Array.from({ length: SERIES_COUNT }, (_, i) => v(`--series-${i + 1}`)),
  };
}

let _charts = {};

// Stores the BUILDER, not just the instance, so a theme change can rebuild
// every live chart without any render function knowing that a theme exists.
// Re-invoking build() re-runs themeColors(), which is the whole trick.
function mount(canvas, build) {
  // Build BEFORE destroying. themeColors() throws on purpose for a missing
  // token, and with destroy() first that throw left the canvas blank, the
  // registry entry gone, and the exception still escaping into the caller's
  // render - a destructive failure, which is the opposite of the loud-but-safe
  // one the throw exists to give. Building first means a bad token leaves the
  // previous chart standing.
  const config = build();
  destroy(canvas.id);
  _charts[canvas.id] = { chart: new Chart(canvas, config), canvas, build };
}

/**
 * Repaint every live chart against the current theme tokens.
 *
 * Needed because a chart only re-reads its colours when its own data path runs
 * again, so without this a theme toggle leaves every canvas on screen painted
 * in the old palette until the user navigates away and back.
 */
export function repaintCharts() {
  for (const id of Object.keys(_charts)) {
    const { canvas, build } = _charts[id];
    // Several renderers rewrite innerHTML wholesale, which detaches the canvas
    // without going through destroy(). Rebuilding into a detached node would
    // paint nothing and leak the Chart.js instance.
    if (!canvas.isConnected) { destroy(id); continue; }
    try {
      mount(canvas, build);
    } catch (err) {
      // One chart must not strand the others. An uncaught throw here exited
      // the loop, so the charts already repainted showed the new theme and the
      // rest kept the old one, with nothing on screen saying why. mount()
      // builds before it destroys, so this chart simply keeps its old paint.
      console.error(`Could not repaint chart ${id}`, err);
    }
  }
}

function destroy(id) { if (_charts[id]) { _charts[id].chart.destroy(); delete _charts[id]; } }

/**
 * Gives a canvas an accessible name and a text equivalent of its data.
 *
 * A <canvas> is an opaque bitmap: Chart.js paints the numbers into pixels, so
 * none of it reaches assistive tech. For three of this app's charts (net worth
 * trend, cash flow forecast, price history) the chart is the ONLY place those
 * numbers appear anywhere, so without this they are simply unavailable.
 *
 * This module is otherwise pure logic, and it touches the DOM here for the
 * same reason it already calls `new Chart(canvas, ...)`: the canvas is the one
 * element it owns. The alternative was threading a summary back through ten
 * call sites in app.js, which would drift.
 *
 * The table is visually hidden rather than rendered, because the chart already
 * communicates this to sighted users. `rows` is [[rowLabel, value], ...].
 */
function describeChart(canvas, summary, rows, columns = ["", ""]) {
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", summary);
  const id = canvas.id + "-data";
  let table = document.getElementById(id);
  if (!rows.length) { if (table) table.remove(); return; }
  if (!table) {
    table = document.createElement("table");
    table.id = id;
    table.className = "sr-only";
    canvas.insertAdjacentElement("afterend", table);
  }
  const cell = (v) => `<td>${escapeCell(v)}</td>`;
  table.innerHTML = `<caption>${escapeCell(summary)}</caption>`
    + `<thead><tr>${columns.map((h) => `<th scope="col">${escapeCell(h)}</th>`).join("")}</tr></thead>`
    + `<tbody>${rows.map((r) => `<tr><th scope="row">${escapeCell(r[0])}</th>${r.slice(1).map(cell).join("")}</tr>`).join("")}</tbody>`;
}

// Local rather than imported: this module deliberately has no app.js import,
// and the values here are user-typed category and account names.
function escapeCell(s) {
  return String(s ?? "").replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

// Every figure this module draws is money, and the app holds US dollars only
// (no multi-currency, by decision). A bare "$" is also the sign for the
// Canadian, Australian, Hong Kong and a dozen other dollars, so the axis that
// carries the money names its currency rather than leaving the symbol to
// imply it. Named once here so no chart can forget to say it.
export const CURRENCY_CODE = "USD";
const usd = (digits) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: CURRENCY_CODE,
  minimumFractionDigits: digits, maximumFractionDigits: digits,
});
const USD_CENTS = usd(2);
const USD_WHOLE = usd(0);
// Intl puts the sign outside the symbol ("-$40.00"), which the old
// `"$" + n` did not ("$-40.00"), and adds thousands separators. A net worth
// below zero and an overdrawn balance are both real, so the minus case is not
// an edge.
const money = (n) => USD_CENTS.format(Number(n ?? 0));

// Whole dollars when every tick on the axis is whole, cents otherwise. Decided
// for the axis as a set, not tick by tick, or one axis would read "$0",
// "$0.50", "$1".
function moneyTick(value, _index, ticks) {
  const whole = ticks.every((t) => Number.isInteger(t.value));
  return (whole ? USD_WHOLE : USD_CENTS).format(value);
}

const moneyAxisTitle = (labels) => `${labels.y} (${CURRENCY_CODE})`;

// Both axes are titled on every chart: what runs along the bottom, and what
// the height measures plus its currency. `labels` is { x, y } in plain words;
// the currency is added here, so a caller cannot leave it off.
//
// `flatDates` lays a date axis's labels flat and lets Chart.js skip some.
// Diagonal labels took about 50px of a 150px chart, which left the health
// check's plot shorter than its own y-axis title and clipped it. Only for a
// line of dates: every date is still in the hover readout and the hidden
// table, while a bar chart's labels name categories, and skipping one would
// leave a bar with no name.
function axisScales(t, labels, { flatDates = false } = {}) {
  const title = (text) => ({ display: true, text, color: t.text, font: { size: 12, weight: "600" } });
  const xTicks = flatDates
    ? { color: t.text, maxRotation: 0, autoSkip: true, autoSkipPadding: 12 }
    : { color: t.text };
  return {
    x: { ticks: xTicks, grid: { display: false }, title: title(labels.x) },
    y: { ticks: { color: t.text, callback: moneyTick }, grid: { color: t.grid }, title: title(moneyAxisTitle(labels)) },
  };
}

// The hover readout states the currency too. Chart.js prints the raw number by
// default ("1234.5"), which was the one place on a chart a figure appeared
// with no unit at all.
function moneyTooltip() {
  return {
    callbacks: {
      label: (ctx) => `${ctx.dataset.label ? ctx.dataset.label + ": " : ""}${money(ctx.parsed.y)} ${CURRENCY_CODE}`,
    },
  };
}

/**
 * Horizontal bar chart for any label/value breakdown (category, account,
 * account type, ...). Dollar amounts are baked into each row's label so
 * they're visible at a glance - no hover needed, and length-of-bar is far
 * easier to compare by eye than pie/doughnut wedge area.
 * `canvas` must have a unique `id` (used as the internal chart registry key
 * so multiple bar charts on one page don't clobber each other on redraw).
 */
export function renderBreakdownBar(canvas, data, axes = { x: "Group", y: "Amount" }) {
  const labels = data.map((d) => `${d.label}, ${money(d.value)}`);
  const total = data.reduce((s, d) => s + d.value, 0);
  describeChart(canvas,
    data.length ? `${axes.y} by ${axes.x.toLowerCase()}: ${money(total)} ${CURRENCY_CODE} across ${data.length} ${data.length === 1 ? "group" : "groups"}` : "No data yet",
    data.map((d) => [d.label, money(d.value)]), [axes.x, moneyAxisTitle(axes)]);
  mount(canvas, () => {
    const t = themeColors();
    return {
      type: "bar",
      data: {
        labels,
        datasets: [{
          data: data.map((d) => d.value),
          backgroundColor: data.map((_, i) => t.series[i % t.series.length]),
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: moneyTooltip() },
        scales: axisScales(t, axes),
      },
    };
  });
}

/**
 * Line chart for a day-by-day balance series (the project notes, Accounts #1).
 * `canvas.id` is the registry key, same as renderBreakdownBar - lets this
 * coexist with the bar charts without clobbering them on redraw.
 */
export function renderLineChart(canvas, labels, values, axes = { x: "Date", y: "Value" }) {
  const nums = values.filter((v) => Number.isFinite(v));
  describeChart(canvas,
    nums.length
      ? `${moneyAxisTitle(axes)}, ${labels.length} ${labels.length === 1 ? "point" : "points"}, from ${money(nums[0])} on ${labels[0]} to ${money(nums[nums.length - 1])} on ${labels[labels.length - 1]}. Lowest ${money(Math.min(...nums))}, highest ${money(Math.max(...nums))}.`
      : "No data yet",
    labels.map((l, i) => [l, money(values[i])]), [axes.x, moneyAxisTitle(axes)]);
  mount(canvas, () => {
    const t = themeColors();
    return {
      type: "line",
      data: {
        labels,
        datasets: [{
          data: values,
          borderColor: t.line,
          backgroundColor: t.lineFill,
          fill: true,
          tension: 0.2,
          pointRadius: 2,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: moneyTooltip() },
        scales: axisScales(t, axes, { flatDates: true }),
      },
    };
  });
}

/**
 * Single-series month-over-month bar chart (the original, unchanged
 * shape - "Last 6 months" on Reports). `secondDataset`, when given
 * (`{label, data}`), adds a second bar per month for a paired
 * comparison (income vs. expense) - the only case that needs a legend at
 * all, since a single series is unambiguous without one. Registry key
 * switched from a hardcoded "trend" to `canvas.id` so a second chart
 * using this same function (a different canvas) doesn't clobber the
 * first one's Chart.js instance on redraw - purely internal, no caller
 * ever referenced the old literal key.
 */
export function renderTrendBar(canvas, months, totals, secondDataset = null, axes = { x: "Month", y: "Amount" }) {
  const labelFor = (m) => monthLabel(m);
  describeChart(canvas,
    months.length
      ? (secondDataset
          ? `${secondDataset.label} against money out, over ${months.length} ${months.length === 1 ? "month" : "months"}`
          : `Totals over ${months.length} ${months.length === 1 ? "month" : "months"}`)
      : "No data yet",
    months.map((m, i) => secondDataset
      ? [labelFor(m), money(secondDataset.data[i]), money(totals[i])]
      : [labelFor(m), money(totals[i])]),
    secondDataset
      ? [axes.x, `${secondDataset.label} (${CURRENCY_CODE})`, `Money out (${CURRENCY_CODE})`]
      : [axes.x, moneyAxisTitle(axes)]);
  mount(canvas, () => {
    const t = themeColors();
    // Built inside the builder, not outside it: a repaint re-invokes this, and
    // datasets assembled once at call time would keep the old theme's colours.
    //
    // The two series are separated by LIGHTNESS, not hue. This is the only
    // chart in the app where colour has to be decoded back to a meaning (every
    // other one bakes its label into the bar), so series 1 and 2 are chosen as
    // the furthest-apart pair in the palette under simulated colour vision
    // deficiency rather than for looking like "money in" and "money out".
    const datasets = [{
      label: secondDataset ? "Money out" : undefined,
      data: totals, backgroundColor: t.series[0], borderRadius: 6,
    }];
    if (secondDataset) {
      datasets.push({
        label: secondDataset.label, data: secondDataset.data,
        backgroundColor: t.series[1], borderRadius: 6,
      });
    }
    return {
      type: "bar",
      data: { labels: months.map(monthLabel), datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: !!secondDataset, labels: { color: t.text } }, tooltip: moneyTooltip() },
        scales: axisScales(t, axes),
      },
    };
  });
}