-- Where the user dragged a holding in their own list.
--
-- Holdings rendered in `created_at` order, which is the order they happened to
-- be typed in and means nothing afterwards. The tracked-companies list already
-- solved this (76) and this is the same want against a different table: the
-- positions someone actually watches should be able to sit at the top.
--
-- On `assets` rather than a holdings-only table because a holding IS an assets
-- row with parent_asset_id set (40_asset_holdings.sql) - there is nowhere else
-- to put it. It is nullable and nothing but the holdings list reads it today,
-- so every other asset keeps a null and is completely unaffected.
--
-- NULL SORTS LAST and the reader tiebreaks on created_at, the same contract 76
-- established: a row written by any path that does not set a position lands at
-- the end rather than jumping to the top, and the tiebreak is what keeps the
-- order deterministic rather than shuffling between loads.
--
-- The backfill reproduces the EXACT order the list showed before this, per
-- parent account, so the first render after deploying is identical to the last
-- one before it. Reordering is then a visible choice rather than something
-- that happened on its own.
alter table assets add column if not exists sort_order integer;

with ranked as (
  select id, row_number() over (partition by parent_asset_id order by created_at) as n
  from assets
  where parent_asset_id is not null
)
update assets a
   set sort_order = ranked.n
  from ranked
 where ranked.id = a.id
   and a.sort_order is null;

create index if not exists assets_parent_order_idx
  on assets (parent_asset_id, sort_order);

comment on column assets.sort_order is
  'Where the user dragged this holding within its account, 1-based. Null means "not placed yet" and sorts last; the reader tiebreaks on created_at. Only the Investments holdings list reads it - every other asset carries null.';
