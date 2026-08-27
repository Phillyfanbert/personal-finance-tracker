// ============================================================================
// Reports & charts (README §3.8, Phase 1).
// Pure aggregation helpers (unit-testable) + Chart.js renderers.
// Chart.js is loaded from CDN in index.html as global `Chart`.
// ============================================================================

/** YYYY-MM string for a Date. */
export function monthKey(d = new Date()) {
  return d.toISOString().slice(0, 7);
}

/** Human label for a YYYY-MM key, e.g. "2026-07" -> "Jul 2026". */
export function monthLabel(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: "short", year: "numeric" });
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
const PALETTE = [
  "#38bdf8", "#34d399", "#fbbf24", "#f87171", "#a78bfa",
  "#f472b6", "#22d3ee", "#facc15", "#fb923c", "#4ade80",
];
const GRID = "#334155";
const TEXT = "#94a3b8";
let _charts = {};

function destroy(id) { if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; } }

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
  destroy(canvas.id);
  const labels = data.map((d) => `${d.label} - $${d.value.toFixed(2)}`);
  const total = data.reduce((s, d) => s + d.value, 0);
  describeChart(canvas,
    data.length ? `Breakdown of ${money(total)} across ${data.length} ${data.length === 1 ? "group" : "groups"}` : "No data yet",
    data.map((d) => [d.label, money(d.value)]), ["Group", "Amount"]);
  _charts[canvas.id] = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        data: data.map((d) => d.value),
        backgroundColor: data.map((_, i) => PALETTE[i % PALETTE.length]),
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: TEXT }, grid: { display: false } },
        y: { ticks: { color: TEXT, callback: (v) => "$" + v }, grid: { color: GRID } },
      },
    },
  });
}

/**
 * Line chart for a day-by-day balance series (docs/ROADMAP.md Accounts #1).
 * `canvas.id` is the registry key, same as renderBreakdownBar - lets this
 * coexist with the bar charts without clobbering them on redraw.
 */
export function renderLineChart(canvas, labels, values) {
  destroy(canvas.id);
  const nums = values.filter((v) => Number.isFinite(v));
  describeChart(canvas,
    nums.length
      ? `${labels.length} ${labels.length === 1 ? "point" : "points"}, from ${money(nums[0])} on ${labels[0]} to ${money(nums[nums.length - 1])} on ${labels[labels.length - 1]}. Lowest ${money(Math.min(...nums))}, highest ${money(Math.max(...nums))}.`
      : "No data yet",
    labels.map((l, i) => [l, money(values[i])]), ["Date", "Value"]);
  _charts[canvas.id] = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [{
        data: values,
        borderColor: "#0ea5e9",
        backgroundColor: "rgba(14,165,233,0.15)",
        fill: true,
        tension: 0.2,
        pointRadius: 2,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: TEXT }, grid: { display: false } },
        y: { ticks: { color: TEXT, callback: (v) => "$" + v }, grid: { color: GRID } },
      },
    },
  });
}

/**
 * Single-series month-over-month bar chart (the original, unchanged
 * shape - "Last 6 months" on Reports). `secondDataset`, when given
 * (`{label, data, color}`), adds a second bar per month for a paired
 * comparison (income vs. expense) - the only case that needs a legend at
 * all, since a single series is unambiguous without one. Registry key
 * switched from a hardcoded "trend" to `canvas.id` so a second chart
 * using this same function (a different canvas) doesn't clobber the
 * first one's Chart.js instance on redraw - purely internal, no caller
 * ever referenced the old literal key.
 */
export function renderTrendBar(canvas, months, totals, secondDataset = null) {
  destroy(canvas.id);
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
  const datasets = [{
    label: secondDataset ? "Expense" : undefined,
    data: totals, backgroundColor: "#0ea5e9", borderRadius: 6,
  }];
  if (secondDataset) {
    datasets.push({
      label: secondDataset.label, data: secondDataset.data,
      backgroundColor: secondDataset.color || "#34d399", borderRadius: 6,
    });
  }
  _charts[canvas.id] = new Chart(canvas, {
    type: "bar",
    data: { labels: months.map(monthLabel), datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: !!secondDataset, labels: { color: TEXT } } },
      scales: {
        x: { ticks: { color: TEXT }, grid: { display: false } },
        y: { ticks: { color: TEXT, callback: (v) => "$" + v }, grid: { color: GRID } },
      },
    },
  });
}