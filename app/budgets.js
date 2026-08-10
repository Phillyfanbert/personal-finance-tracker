// ============================================================================
// Per-category budgets (docs/ROADMAP.md Reports & Net Worth #2). Pure,
// unit-testable - same style as networth.js/depreciation.js.
// ============================================================================

const r2 = (n) => Math.round(n * 100) / 100;

/**
 * Combines each budget with the selected month's actual spend for that
 * category (from charts.js's sumBy(expenses, "category", ym), passed in
 * rather than recomputed here so this stays pure/decoupled from the
 * expenses array). Sorted by percent-used descending, so the closest-to-
 * (or most-over-)budget category surfaces first.
 * @param {object[]} budgets rows from the `budgets` table
 * @param {{label:string, value:number}[]} spendByCategory from sumBy()
 */
export function budgetStatus(budgets, spendByCategory) {
  const spendMap = new Map(spendByCategory.map((s) => [s.label, s.value]));
  return budgets
    .map((b) => {
      const spent = r2(spendMap.get(b.category) || 0);
      const limit = Number(b.monthly_limit);
      const pct = limit > 0 ? Math.round((spent / limit) * 100) : 0;
      return { category: b.category, limit, spent, pct, over: spent > limit };
    })
    .sort((a, b) => b.pct - a.pct);
}
