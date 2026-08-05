# Auto-Updating Asset Values (Depreciation) — Proposal for a Later Session

*Status: not implemented. This is a record of the plan we agreed on, so a
future session can pick it up directly instead of re-deriving it.*

## The problem

Assets like vehicles (and eventually property/investments) currently need
their `value` manually updated over time — there's no way for them to
reflect real-world change automatically.

## Decision: Option A — depreciation formula (not a search agent)

Two approaches were discussed:

- **Option A (chosen for v1):** store a purchase price + purchase date +
  depreciation rate on the asset, and compute the current estimated value
  live with a pure function. $0, no new infrastructure, deterministic,
  testable — same style as `app/networth.js`/`app/subscriptions.js`.
- **Option B (later upgrade path, not now):** reuse the SearXNG + Gemma
  pipeline from `tools/deal-agent.js` to periodically search real resale
  values and write them back via a server-side script (same shape as
  `tools/monthly-report.js`). More accurate, more moving parts. Worth
  revisiting if Option A's formula estimates prove too rough in practice.

## Sketch of Option A

**Schema** — add nullable columns to `assets` (migration `11_...sql`):
```sql
alter table assets add column if not exists purchase_price numeric(12,2);
alter table assets add column if not exists purchase_date date;
alter table assets add column if not exists depreciation_rate numeric(5,4); -- e.g. 0.15 = 15%/year
```
All nullable — an asset with no purchase info just keeps behaving as it
does today (a static, manually-set `value`).

**Formula** (new pure module, `app/depreciation.js`):
```js
export function estimateValue(purchasePrice, purchaseDate, annualRate, asOf = new Date()) {
  const years = (asOf - new Date(purchaseDate)) / (365.25 * 86400000);
  return Math.round(purchasePrice * Math.pow(1 - annualRate, years) * 100) / 100;
}
```

**UI** — when adding/editing a `vehicle`-type asset (and only vehicle,
initially — no reason to force this on bank/investment/property/other),
offer purchase price + purchase date + depreciation rate inputs. Default
rate needs a sensible starting guess (~15%/year is a common rule of thumb
for a car, but worth a quick check against real depreciation curves before
shipping a default).

## Open questions to resolve when this is picked up

1. **Does net worth use the live-computed estimate, or the stored `value`
   with a manual "sync now" action?** Live-computed is simpler and always
   current; stored+sync gives the user a chance to review before it
   changes what net worth shows. Leaning live-computed for simplicity, but
   worth a quick gut-check with the user before building.
2. **Should this generalize beyond vehicles later?** Property appreciates
   (not depreciates) and doesn't really follow a clean formula the way
   cars do — probably stays manual, or becomes an Option-B candidate
   instead of extending Option A.
3. **What's the right default depreciation rate**, and should it vary by
   vehicle age (steeper in year 1-2, flattening later) rather than a flat
   annual %?
