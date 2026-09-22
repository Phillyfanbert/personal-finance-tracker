-- One end-of-day recap of THIS user's own investments, per trading day.
--
-- Deliberately a separate table from daily_recaps, not a user_id column on
-- it. daily_recaps holds one row per trading day for EVERY user because the
-- market's behaviour is a public fact with no owner; this holds what one
-- person's own money did, which is the opposite. Merging them would put a
-- per-user RLS policy on a table whose whole point is being shared.
--
-- WRITTEN BY THE CLIENT, not by tools/price-agent.js, and that is forced by
-- two constraints rather than chosen for convenience:
--
--   1. The privacy boundary. Holdings, quantities and gains are real personal
--      financial data, so the narrative can only come from the self-hosted
--      Gemma the browser already talks to - never Gemini or any other cloud
--      model. tools/monthly-report.js is the precedent and its header says
--      the same thing.
--   2. Share the function, not the formula. Every figure here is composed
--      from app/investments.js's existing exports (portfolioTotals,
--      investmentHoldings, allocationVsTarget, contributionLimitUsage,
--      realizedGainSummary, priceRangeStats) - the same functions the
--      Investments tab renders from, so the two cannot disagree. A Node
--      re-implementation would be a second definition of what the portfolio
--      is worth, which is exactly the failure that forced averageMonth() and
--      netWorthAssets() to be unified.
--
-- The honest gap that follows: a recap only exists for a day the app was
-- opened after the close. portfolio_snapshots has had that same property
-- since 35_portfolio_snapshots.sql and it is real rather than theoretical -
-- both snapshot tables can sit days behind. A missing day is stated as
-- missing; it is never back-filled from today's prices, which would date
-- today's figures to a day they did not belong to.
--
-- figures is jsonb by the same test market_news_findings.headlines passed:
-- always read and written as one cohesive set belonging to a single day,
-- with no per-figure filtering, status or expiry. It doubles as the
-- allow-list a figure check runs against, so it does real work beyond
-- display - every number in `summary` has to trace back to something here.
--
-- summary is nullable and null is a fully supported state, exactly as it is
-- on daily_recaps: the figures are complete and worth showing on their own,
-- and the model is an optional layer on top. summary_skipped_reason records
-- why when it is absent, so a silent gap is answerable with a query instead
-- of a guess - the lesson 61_recap_summary_skip_reason.sql records after the
-- market recap's summary turned out to be missing on 8 of 9 days with every
-- health signal reporting ok.
create table if not exists portfolio_recaps (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users(id) on delete cascade,
  trade_date             date not null,
  figures                jsonb not null,
  summary                text,
  generated_by           text not null default 'rollup',
  summary_skipped_reason text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (user_id, trade_date)
);

create index if not exists portfolio_recaps_user_date_idx
  on portfolio_recaps (user_id, trade_date desc);

alter table portfolio_recaps enable row level security;
drop policy if exists "own portfolio_recaps" on portfolio_recaps;
create policy "own portfolio_recaps" on portfolio_recaps
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- RLS is not sufficient on its own; base privileges are not automatic and
-- their absence has caused two separate production bugs in this project.
-- service_role is granted even though nothing server-side writes this today,
-- so a future job is not blocked by the same missing-grant failure that took
-- 47_fix_missing_service_role_grants.sql to find.
grant select, insert, update, delete on portfolio_recaps to authenticated;
grant select, insert, update, delete on portfolio_recaps to service_role;

comment on table portfolio_recaps is
  'One end-of-day recap of a single user''s own investments. Written client-side after the close; narrative comes from the self-hosted Gemma only, never a cloud model.';
comment on column portfolio_recaps.figures is
  'Every number the recap states, computed in app/investments.js. The model writes prose around these and never does arithmetic of its own.';
comment on column portfolio_recaps.generated_by is
  '''rollup'' for the computed figures alone, ''rollup+gemma'' once a usable narrative exists. Only ever says gemma when one was actually produced.';
comment on column portfolio_recaps.summary_skipped_reason is
  'Why the narrative is absent, for diagnosis only. Never shown in the UI.';
