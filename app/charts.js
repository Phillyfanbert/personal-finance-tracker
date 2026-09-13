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
const SERIES_COUNT = 8;
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
  destroy(canvas.id);
  _charts[canvas.id] = { chart: new Chart(canvas, build()), canvas, build };
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
    mount(canvas, build);
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

const money = (n) => "$" + Number(n ?? 0).toFixed(2);

/**
 * Horizontal bar chart for any label/value breakdown (category, account,
 * account type, ...). Dollar amounts are baked into each row's label so
 * they're visible at a glance - no hover needed, and length-of-bar is far
 * easier to compare by eye than pie/doughnut wedge area.
 * `canvas` must have a unique `id` (used as the internal chart registry key
 * so multiple bar charts on one page don't clobber each other on redraw).
 */
export function renderBreakdownBar(canvas, data) {
  const labels = data.map((d) => `${d.label} - $${d.value.toFixed(2)}`);
  const total = data.reduce((s, d) => s + d.value, 0);
  describeChart(canvas,
    data.length ? `Breakdown of ${money(total)} across ${data.length} ${data.length === 1 ? "group" : "groups"}` : "No data yet",
    data.map((d) => [d.label, money(d.value)]), ["Group", "Amount"]);
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
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: t.text }, grid: { display: false } },
          y: { ticks: { color: t.text, callback: (v) => "$" + v }, grid: { color: t.grid } },
        },
      },
    };
  });
}

/**
 * Line chart for a day-by-day balance series (the project notes, Accounts #1).
 * `canvas.id` is the registry key, same as renderBreakdownBar - lets this
 * coexist with the bar charts without clobbering them on redraw.
 */
export function renderLineChart(canvas, labels, values) {
  const nums = values.filter((v) => Number.isFinite(v));
  describeChart(canvas,
    nums.length
      ? `${labels.length} ${labels.length === 1 ? "point" : "points"}, from ${money(nums[0])} on ${labels[0]} to ${money(nums[nums.length - 1])} on ${labels[labels.length - 1]}. Lowest ${money(Math.min(...nums))}, highest ${money(Math.max(...nums))}.`
      : "No data yet",
    labels.map((l, i) => [l, money(values[i])]), ["Date", "Value"]);
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
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: t.text }, grid: { display: false } },
        y: { ticks: { color: t.text, callback: (v) => "$" + v }, grid: { color: t.grid } },
      },
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
export function renderTrendBar(canvas, months, totals, secondDataset = null) {
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
    secondDataset ? ["Month", secondDataset.label, "Money out"] : ["Month", "Total"]);
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
      label: secondDataset ? "Expense" : undefined,
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
        plugins: { legend: { display: !!secondDataset, labels: { color: t.text } } },
        scales: {
          x: { ticks: { color: t.text }, grid: { display: false } },
          y: { ticks: { color: t.text, callback: (v) => "$" + v }, grid: { color: t.grid } },
        },
      },
    };
  });
}