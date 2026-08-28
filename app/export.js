// ============================================================================
// CSV export for a month's report (docs/ROADMAP.md Reports & Net Worth #3).
// Pure, unit-testable - same style as networth.js/budgets.js. PDF export
// (window.print() against an isolated print view, not a library) lives in
// app.js instead, since it's inherently DOM/window work, not pure logic.
// ============================================================================

// RFC 4180: a field containing a comma, quote, or newline must be quoted,
// with any internal quotes doubled.
function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * @param {object[]} rows expense rows (occurred_at, description/merchant,
 *   category, payment_type, account_id, amount)
 * @param {(id:string)=>string} [accountName] resolves account_id to a
 *   display name - passed in rather than imported, same reasoning sumBy()
 *   (charts.js) already takes one, so this stays decoupled from app.js's
 *   `accounts` global.
 */
export function buildExpensesCsv(rows, accountName = () => "") {
  const header = ["Date", "Description", "Category", "Payment Type", "Account", "Amount"];
  const lines = [header.map(csvEscape).join(",")];
  for (const r of rows) {
    lines.push([
      r.occurred_at,
      r.description || r.merchant || "",
      r.category || "",
      r.payment_type || "",
      accountName(r.account_id) || "",
      Number(r.amount).toFixed(2),
    ].map(csvEscape).join(","));
  }
  return lines.join("\r\n");
}

// ---------------------------------------------------------------------------
// Per-page exports. One CSV per page, built from data the page has already
// computed, so a figure in a file can never disagree with the same figure on
// screen. Still pure: callers pass the numbers in.
//
// Multi-table pages are written as SECTIONS - a titled block, its own header
// row, then its rows, separated by a blank line. Spreadsheets open that fine,
// and the alternative (a file per table) means four downloads for one page.
// ---------------------------------------------------------------------------

const money = (n) => (n == null || !Number.isFinite(Number(n)) ? "" : Number(n).toFixed(2));

/** @param {{title:string, header:string[], rows:Array<Array<any>>}[]} sections */
export function buildSectionedCsv(sections) {
  const out = [];
  for (const s of sections) {
    if (!s || !s.rows) continue;
    if (out.length) out.push("");
    out.push(csvEscape(s.title));
    if (s.header) out.push(s.header.map(csvEscape).join(","));
    if (!s.rows.length) out.push(csvEscape("(nothing recorded)"));
    else for (const r of s.rows) out.push(r.map(csvEscape).join(","));
  }
  return out.join("\r\n");
}

/** Log: what you spent, what charges you on a schedule, and what you hold. */
export function buildLogCsv({ expenses = [], activity = [], subscriptions = [], accounts = [], assets = [], debts = [], income = [] }, accountName = () => "") {
  const kind = { asset_adjust: "Balance change", liability_payment: "Payment", transfer: "Transfer", income: "Income", contribution: "Contribution", owed_adjust: "Amount owed changed", holding_sale: "Investment sold" };
  return buildSectionedCsv([
    { title: "Spending", header: ["Date", "Description", "Category", "Payment Type", "Account", "Amount"],
      rows: expenses.map((r) => [r.occurred_at, r.description || r.merchant || "", r.category || "", r.payment_type || "", accountName(r.account_id) || "", money(r.amount)]) },
    { title: "Other money movements", header: ["Date", "What happened", "Type", "Account", "Amount"],
      rows: activity.map((r) => [r.occurred_at, r.description || "", kind[r.kind] || r.kind || "", accountName(r.account_id) || "", money(r.amount)]) },
    { title: "Subscriptions and bills", header: ["Name", "Category", "Amount", "Billing cycle", "Next renewal", "Account", "Active"],
      rows: subscriptions.map((s) => [s.name || "", s.category || "", money(s.amount), s.billing_cycle || "", s.next_renewal || "", accountName(s.account_id) || "", s.is_active ? "yes" : "no"]) },
    { title: "Income sources", header: ["Source", "Amount", "How often", "Next expected", "Account", "Active"],
      rows: income.map((i) => [i.source || "", money(i.amount), i.cadence || "", i.next_expected || "", accountName(i.account_id) || "", i.is_active ? "yes" : "no"]) },
    { title: "Accounts", header: ["Bank", "Account", "Type"],
      rows: accounts.map((a) => [a.bank_name || "", a.name || "", a.type || ""]) },
    { title: "Things you have", header: ["Name", "Type", "Value"],
      rows: assets.map((a) => [a.name || "", a.type || "", money(a.value)]) },
    { title: "Things you owe", header: ["Name", "Type", "Balance", "Interest rate", "Minimum payment"],
      rows: debts.map((d) => [d.name || "", d.type || "", money(d.balance), d.interest_rate ?? "", money(d.minimum_payment)]) },
  ]);
}

/** Plan: the limits you set, the payoff comparison, the projected balance. */
export function buildPlanCsv({ budgets = [], payoff = null, forecast = [], forecastAccount = "" }) {
  const strategy = (label, r) => !r ? null
    : r.neverPaysOff ? [label, "never at this payment", ""]
    : [label, `${r.months} months`, money(r.totalInterest)];
  const payoffRows = payoff ? [strategy("Highest interest rate first (avalanche)", payoff.avalanche), strategy("Smallest amount first (snowball)", payoff.snowball)].filter(Boolean) : [];
  return buildSectionedCsv([
    { title: "Budgets (this month)", header: ["Category", "Limit", "Spent", "Percent used", "Status"],
      rows: budgets.map((b) => [b.category, money(b.limit), money(b.spent), `${b.pct}%`, b.over ? "over" : b.warn ? "close to the limit" : "ok"]) },
    { title: "Paying off what you owe", header: ["Approach", "Time to clear", "Total interest"], rows: payoffRows },
    { title: `Cash flow forecast${forecastAccount ? " - " + forecastAccount : ""}`, header: ["Date", "Projected balance"],
      rows: forecast.map((p) => [p.date, money(p.balance)]) },
  ]);
}

/** Investments: holdings, limits and targets, never a recommendation. */
export function buildInvestmentsCsv({ totals = null, holdings = [], realized = [], limits = [], targets = [] }) {
  return buildSectionedCsv([
    { title: "Totals", header: ["Measure", "Value"],
      rows: totals ? [["Total value", money(totals.totalValue)], ["Total cost basis", money(totals.totalCostBasis)],
                      ["Gain or loss", money(totals.totalGainLoss)],
                      ["Gain or loss percent", totals.totalGainLossPct != null ? `${totals.totalGainLossPct}%` : ""]] : [] },
    { title: "Holdings", header: ["Account", "Symbol", "Shares", "Cost basis", "Latest price", "Current value", "Gain or loss"],
      rows: holdings.map((h) => [h.asset?.name || "", h.symbol || "", h.quantity ?? "", money(h.costBasis), money(h.latestPrice), money(h.currentValue), money(h.gainLoss)]) },
    { title: "Realized gain and loss", header: ["Date", "Symbol", "Shares sold", "Proceeds", "Realized gain"],
      rows: realized.map((r) => [r.sold_on || r.sold_at || "", r.symbol || "", r.quantity ?? "", money(r.proceeds), money(r.realized_gain)]) },
    { title: "Contribution limits (this year)", header: ["Group", "Contributed", "Limit", "Left", "Status"],
      rows: limits.map((l) => [l.label || "", money(l.contributed), money(l.limit), money(l.remaining), l.overLimit ? "over the limit" : ""]) },
    { title: "Target allocation", header: ["Type", "Current percent", "Target percent", "Dollars from target"],
      rows: targets.map((t) => [t.bucket || "", t.currentPct != null ? `${t.currentPct}%` : "", t.targetPercent != null ? `${t.targetPercent}%` : "", money(t.gapDollars)]) },
  ]);
}

/** Reports: the analysis of a month, not the raw rows (those are on Log). */
export function buildReportsCsv({ monthLabel = "", totals = [], byCategory = [], byAccount = [], byPaymentType = [], incomeVsExpense = [] }) {
  const pct = (v) => (v == null ? "" : `${Math.round(v * 1000) / 10}%`);
  return buildSectionedCsv([
    { title: `Summary - ${monthLabel}`, header: ["Measure", "Value"], rows: totals },
    { title: "Where your money went - by category", header: ["Category", "Amount"], rows: byCategory.map((d) => [d.label, money(d.value)]) },
    { title: "Where your money went - by account", header: ["Account", "Amount"], rows: byAccount.map((d) => [d.label, money(d.value)]) },
    { title: "Where your money went - by how you paid", header: ["Payment type", "Amount"], rows: byPaymentType.map((d) => [d.label, money(d.value)]) },
    { title: "Money in and out (last 6 months)", header: ["Month", "Money in", "Money out", "Left over", "Share kept"],
      rows: incomeVsExpense.map((r) => [r.month, money(r.income), money(r.expense), money(r.income - r.expense), pct(r.savingsRate)]) },
  ]);
}
