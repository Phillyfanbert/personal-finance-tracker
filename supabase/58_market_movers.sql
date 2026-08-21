-- Market-wide top movers, discovered daily rather than looked up from a
-- fixed list.
--
-- This closes a real honesty gap. "Today's top movers" previously meant
-- "the biggest movers among the ~20 symbols already being tracked" - if a
-- stock outside that list moved 40% today, the app could not see it at
-- all, because Finnhub's free tier answers "what is the price of X" and
-- never "what moved most today". Alpha Vantage's TOP_GAINERS_LOSERS does
-- answer that question, on a free key with no card (verified live against
-- their own demo key before this table was written).
--
-- Deliberately a SEPARATE table from watchlist_symbols, never merged into
-- it. watchlist_symbols is the user's own curated list plus their
-- holdings; this is an ephemeral, market-wide fact refreshed daily. A
-- discovery job must never silently rewrite something the user curated by
-- hand, which is exactly what merging them would allow.
--
-- Not user-scoped: what moved most in the US market today is a public
-- fact with no owner, same reasoning as daily_prices/daily_recaps.
create table if not exists market_movers (
  trade_date    date not null,
  -- 'active' is allowed but not currently fetched - most-actively-traded
  -- is a pro-desk metric, and this app's audience is explicitly beginners.
  -- Listed here so adding it later needs no migration.
  category      text not null check (category in ('gainer', 'loser', 'active')),
  symbol        text not null,
  rank          int not null,
  price         numeric(14,4),
  change_amount numeric(14,4),
  change_pct    numeric(10,4),
  volume        bigint,
  -- Alpha Vantage returns ONLY numbers - ticker, price, change, volume, no
  -- explanation of any kind (confirmed against a live response). The name
  -- and headline below are filled in afterwards from Finnhub, which is the
  -- whole reason two providers are involved: one answers "what moved", the
  -- other "what was being reported about it".
  company_name  text,
  headline      jsonb,
  fetched_at    timestamptz default now(),
  primary key (trade_date, category, symbol)
);

create index if not exists market_movers_date_idx on market_movers (trade_date desc, category, rank);

alter table market_movers enable row level security;
drop policy if exists "read market_movers" on market_movers;
create policy "read market_movers" on market_movers
  for select using (auth.role() = 'authenticated');

grant select on market_movers to authenticated;
grant select, insert, update, delete on market_movers to service_role;

-- One beginner-friendly summary per day covering the movers above, kept
-- separate from daily_recaps because that card is about the user's OWN
-- tracked companies and this one is about the market at large. Same
-- two-stage shape: the numbers and headlines stand alone, the summary is
-- one optional Gemini call layered on top and null whenever it fails.
create table if not exists market_mover_summaries (
  trade_date   date primary key,
  summary      text,
  generated_by text not null default 'rollup',
  updated_at   timestamptz default now()
);

alter table market_mover_summaries enable row level security;
drop policy if exists "read market_mover_summaries" on market_mover_summaries;
create policy "read market_mover_summaries" on market_mover_summaries
  for select using (auth.role() = 'authenticated');

grant select on market_mover_summaries to authenticated;
grant select, insert, update, delete on market_mover_summaries to service_role;
