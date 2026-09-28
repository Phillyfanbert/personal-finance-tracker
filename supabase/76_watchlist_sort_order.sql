-- User-chosen display order for the tracked-companies list.
--
-- watchlist_symbols was read with .order("symbol"), so the list in "Choose
-- tracked companies" was alphabetical and nothing could change that. Someone
-- tracking 20 symbols has a handful they actually care about and they were
-- stuck wherever the alphabet put them.
--
-- NULLABLE ON PURPOSE, and null sorts LAST (Postgres's own default for an
-- ascending sort). A row inserted by any path that does not set this - the
-- holdings sync, a future script, a hand-written insert - lands at the end of
-- the list rather than jumping to the top, which is the safe direction for a
-- column whose whole job is "where the user put it". A default of 0 would do
-- the opposite.
--
-- The backfill reproduces the EXACT order the list showed before this
-- migration (alphabetical, per user), so the first render after deploying is
-- identical to the last one before it. Reordering is then a real, visible
-- choice rather than something that happened on its own.
--
-- Deliberately NOT unique per user. Two rows briefly sharing a position is
-- harmless (the symbol tiebreak below resolves it) and a unique constraint
-- would make reordering impossible without a temporary shuffle, since the
-- client rewrites positions one row at a time.
alter table watchlist_symbols add column if not exists sort_order integer;

with ranked as (
  select id, row_number() over (partition by user_id order by symbol) as n
  from watchlist_symbols
)
update watchlist_symbols w
   set sort_order = ranked.n
  from ranked
 where ranked.id = w.id
   and w.sort_order is null;

create index if not exists watchlist_symbols_user_order_idx
  on watchlist_symbols (user_id, sort_order);

comment on column watchlist_symbols.sort_order is
  'Where the user dragged this symbol in the tracked-companies list, 1-based. Null means "not placed yet" and sorts last; the reader tiebreaks on symbol so the order is always deterministic.';
