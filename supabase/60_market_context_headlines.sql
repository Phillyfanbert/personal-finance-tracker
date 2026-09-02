-- MARKET-WIDE CONTEXT HEADLINES -----------------------------------------------
--
-- Answers the one question the Investments tab could not: **why did the
-- market as a whole move today?**
--
-- Until this column, every headline in the app came from Finnhub's
-- /company-news?symbol=X - one tracked company at a time. That is a good
-- source for "why did WMT fall 9%", and structurally incapable of
-- explaining a market-wide move: no macro story (a rate decision, an
-- inflation print, a jobs report) is ever *about* a tracked company, so
-- nothing in the pipeline could surface one. The daily recap's first
-- paragraph could therefore only ever restate the numbers it already had.
--
-- Stored on daily_recaps rather than in a table of its own, deliberately:
-- this is exactly one set of headlines per trading day, the recap row is
-- already keyed and upserted on trade_date, and the recap card already
-- reads that row - so this costs no new table, no new client fetch, and
-- cannot drift out of sync with the day it describes.
--
-- NULL is a fully supported state and the card must render without it,
-- the same rule daily_recaps.summary already follows. The headlines are
-- fetched best-effort by ONE Tavily search per weekday run; a failure,
-- an empty result, or every result being rejected by the relevance gate
-- all leave this null and change nothing else about the recap.
--
-- **Presented as the day's COVERAGE, never as the cause of the move** -
-- same boundary the per-mover headlines already hold. The app does not get
-- to assert causation it cannot establish.
alter table daily_recaps add column if not exists context_headlines jsonb;

comment on column daily_recaps.context_headlines is
  'Market-wide news headlines for this trading day: [{title, url, source}]. Null means none were found, which is a normal state - the recap and every other part of this row must render fully without it.';
