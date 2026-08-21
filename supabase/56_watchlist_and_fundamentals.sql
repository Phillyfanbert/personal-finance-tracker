-- Two related tables that together retire three hand-synced lists.
--
-- 1. watchlist_symbols - the movers watchlist, now user-editable.
--    Previously MARKET_MOVERS_WATCHLIST was hardcoded in BOTH app/app.js and
--    tools/price-agent.js and had to be kept in sync by hand, with
--    MOVER_COMPANY_NAMES as a third parallel list that silently cost a
--    symbol its headlines if you forgot to extend it. A row here replaces
--    all three.
--
--    Seeded with the same 20 large caps the hardcoded list held, per
--    existing user, so nothing changes for anyone until they edit it.
--    app.js's ensureWatchlistSymbols() does the same for a NEW user on
--    first load, exactly the pattern ensureCashAccount() already
--    established - real seeded rows rather than a "fall back to defaults
--    when empty" scheme, since that would make removing a default symbol
--    impossible.
--
--    company_name exists for one job: deciding whether a stored headline is
--    actually ABOUT the symbol it was filed under. Finnhub's /company-news
--    returns articles that merely MENTION a ticker, dominated in practice by
--    aggregator filler. Seeded for the default 20; price-agent.js backfills
--    a null from Finnhub's company profile when that endpoint is reachable,
--    and pickRelevantHeadline() falls back to ticker-only matching when it
--    is still null, so a user-added symbol degrades rather than breaks.
create table if not exists watchlist_symbols (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  symbol       text not null,
  company_name text,
  created_at   timestamptz default now(),
  unique (user_id, symbol)
);

create index if not exists watchlist_symbols_user_idx on watchlist_symbols (user_id);

alter table watchlist_symbols enable row level security;
drop policy if exists "own watchlist_symbols" on watchlist_symbols;
create policy "own watchlist_symbols" on watchlist_symbols
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on watchlist_symbols to authenticated;
-- price-agent.js reads the union across ALL users (a symbol's price is a
-- public fact, same reasoning assets.price_symbol already uses) and writes
-- company_name back, so it needs more than select.
grant select, insert, update, delete on watchlist_symbols to service_role;

insert into watchlist_symbols (user_id, symbol, company_name)
select p.id, v.symbol, v.company
from profiles p
cross join (values
  ('AAPL','apple'), ('MSFT','microsoft'), ('GOOGL','alphabet'), ('AMZN','amazon'),
  ('NVDA','nvidia'), ('META','meta'), ('TSLA','tesla'), ('JPM','jpmorgan'),
  ('V','visa'), ('UNH','unitedhealth'), ('XOM','exxon'), ('JNJ','johnson'),
  ('WMT','walmart'), ('PG','procter'), ('MA','mastercard'), ('HD','home depot'),
  ('DIS','disney'), ('NFLX','netflix'), ('AMD','amd'), ('KO','coca-cola')
) as v(symbol, company)
on conflict (user_id, symbol) do nothing;

-- 2. symbol_fundamentals - P/E, market cap, dividend yield, industry.
--    Not user-scoped: a company's fundamentals are a public fact with no
--    owner, same reasoning as daily_prices/market_index_findings. Upserted
--    per symbol rather than append-only - unlike a price, only the current
--    value matters here and there is no day-change math reading history.
--
--    Deliberately NOT carrying a 52-week range. That is computed instead
--    from daily_prices (investments.js's priceRangeStats), which can state
--    honestly how much history it actually has rather than implying a full
--    year the app has not yet accumulated.
--
--    Whether Finnhub's free tier actually covers these endpoints is
--    UNCONFIRMED - sources conflict, and this project has already been
--    burned once assuming a tier was free. price-agent.js treats a 401/403
--    as "not available on this tier", logs it plainly, and stops asking for
--    the rest of the run; the card simply stays hidden and nothing else is
--    affected.
create table if not exists symbol_fundamentals (
  symbol         text primary key,
  company_name   text,
  market_cap     numeric(20,2),
  pe_ratio       numeric(12,4),
  dividend_yield numeric(8,4),
  industry       text,
  fetched_at     timestamptz default now()
);

alter table symbol_fundamentals enable row level security;
drop policy if exists "read symbol_fundamentals" on symbol_fundamentals;
create policy "read symbol_fundamentals" on symbol_fundamentals
  for select using (auth.role() = 'authenticated');

grant select on symbol_fundamentals to authenticated;
grant select, insert, update, delete on symbol_fundamentals to service_role;
