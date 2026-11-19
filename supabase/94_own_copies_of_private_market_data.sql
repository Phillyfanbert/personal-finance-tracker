-- WHAT YOU SEE ABOUT A COMPANY NO LONGER DEPENDS ON WHO ELSE FOLLOWS IT.
--
-- 93 let an account read a per-symbol row only for a symbol on its own list.
-- That was not enough: the rows were SHARED, written once for everyone who
-- followed the symbol, so their existence was itself the leak. Tested
-- 2026-11-19 with a throwaway account in a rolled-back transaction: it put a
-- long list of tickers on its own tracked list and could at once read every
-- symbol another account owned or tracked, with 52 days of history from
-- before it had added them. A public file lists every US ticker, so guessing
-- costs nothing. The same worked for deal findings with subscription names.
--
-- So a symbol outside the public list now has one stored copy PER ACCOUNT,
-- written only for an account that follows it, only from the time it does:
--
--   - `owner` on the four per-symbol tables. The public list (the 20 starter
--     companies and the four index funds, public_symbols() below) keeps one
--     shared row, owner = the all-zero id, and the price job now prices it
--     every run whoever follows what, so a shared row says nothing about
--     anyone. Every other symbol is stored only as copies.
--   - An account reads shared rows for the public list and its OWN copies,
--     nothing else. A copy is never shared, so what an account sees about a
--     symbol is exactly what it would see if nobody else followed it. The
--     price job decides each account's share of its call budget from that
--     account's own list alone (tools/price-agent.js, planShares), so even
--     when the budget is short nothing one account sees depends on another.
--   - Stored rows are converted: each current follower gets copies from the
--     time it started following (watchlist and holding created_at), and the
--     shared rows for private symbols are deleted. The two-day stream of
--     holding prices is deleted outright, public symbols included, because
--     those shared rows existed only while somebody OWNED that company; the
--     daily closes fill in until the next run.
--   - Deal findings: the deal job now searches every service it has a
--     domain for, whoever subscribes, so a finding no longer means someone
--     pays for it. The unreviewed findings written under the old rule are
--     deleted (all 52 were still "candidate"); the next weekly run replaces
--     them.
--
-- Also here, because the price job's budget depends on it: a symbol must
-- look like a symbol, and an account may follow at most 50 companies outside
-- the public list (owned and tracked together). Without a limit one account
-- could fill the job's whole budget.

-- ---- The public list --------------------------------------------------------

-- Must match DEFAULT_MOVERS_WATCHLIST and MARKET_INDEX_ETF_PROXIES in
-- tools/price-agent.js and app/app.js, and PUBLIC_SYMBOLS in worker.js;
-- tests/security.test.mjs compares all four.
create or replace function public.public_symbols()
returns setof text
language sql
immutable
set search_path = public
as $$
  select unnest(array['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'JPM', 'V', 'UNH',
                      'XOM', 'JNJ', 'WMT', 'PG', 'MA', 'HD', 'DIS', 'NFLX', 'AMD', 'KO',
                      'SPY', 'DIA', 'QQQ', 'IWM'])
$$;
revoke all on function public.public_symbols() from public, anon;
grant execute on function public.public_symbols() to authenticated, service_role;

-- ---- Owner on the four per-symbol tables ------------------------------------

alter table public.asset_price_findings add column if not exists owner uuid not null default '00000000-0000-0000-0000-000000000000';
alter table public.market_index_findings add column if not exists owner uuid not null default '00000000-0000-0000-0000-000000000000';
alter table public.daily_prices add column if not exists owner uuid not null default '00000000-0000-0000-0000-000000000000';
alter table public.symbol_fundamentals add column if not exists owner uuid not null default '00000000-0000-0000-0000-000000000000';

alter table public.daily_prices drop constraint daily_prices_pkey;
alter table public.daily_prices add primary key (symbol, trade_date, owner);
alter table public.symbol_fundamentals drop constraint symbol_fundamentals_pkey;
alter table public.symbol_fundamentals add primary key (symbol, owner);

create index if not exists asset_price_findings_owner_idx on public.asset_price_findings (owner, symbol, found_at desc);
create index if not exists market_index_findings_owner_idx on public.market_index_findings (owner, symbol, found_at desc);
create index if not exists daily_prices_owner_idx on public.daily_prices (owner, trade_date);

-- ---- Who may read what -------------------------------------------------------

drop policy if exists "read own symbols asset_price_findings" on public.asset_price_findings;
create policy "read shared or own asset_price_findings" on public.asset_price_findings for select
  using ((select auth.role()) = 'authenticated' and status <> 'rejected'
         and (owner = (select auth.uid())
              or (owner = '00000000-0000-0000-0000-000000000000'::uuid
                  and upper(btrim(symbol)) in (select public.public_symbols()))));

drop policy if exists "read own symbols market_index_findings" on public.market_index_findings;
create policy "read shared or own market_index_findings" on public.market_index_findings for select
  using ((select auth.role()) = 'authenticated' and status <> 'rejected'
         and (owner = (select auth.uid())
              or (owner = '00000000-0000-0000-0000-000000000000'::uuid
                  and upper(btrim(symbol)) in (select public.public_symbols()))));

drop policy if exists "read own symbols daily_prices" on public.daily_prices;
create policy "read shared or own daily_prices" on public.daily_prices for select
  using ((select auth.role()) = 'authenticated'
         and (owner = (select auth.uid())
              or (owner = '00000000-0000-0000-0000-000000000000'::uuid
                  and upper(btrim(symbol)) in (select public.public_symbols()))));

drop policy if exists "read own symbols symbol_fundamentals" on public.symbol_fundamentals;
create policy "read shared or own symbol_fundamentals" on public.symbol_fundamentals for select
  using ((select auth.role()) = 'authenticated'
         and (owner = (select auth.uid())
              or (owner = '00000000-0000-0000-0000-000000000000'::uuid
                  and upper(btrim(symbol)) in (select public.public_symbols()))));

-- ---- Convert what is stored ---------------------------------------------------

do $$
declare
  shared constant uuid := '00000000-0000-0000-0000-000000000000';
begin
  -- Each account's companies outside the public list, how it follows each,
  -- and since when. Rows written before this were not forgeable in practice
  -- (the four accounts are the people who run the app), so created_at is
  -- trusted here and nowhere else.
  create temp table zz_follows on commit drop as
    select user_id, upper(btrim(symbol)) as symbol, 'tracked'::text as how, min(created_at) as since
      from public.watchlist_symbols
     where upper(btrim(symbol)) not in (select public.public_symbols())
     group by 1, 2
    union all
    select user_id, upper(btrim(price_symbol)), 'owned', min(created_at)
      from public.assets
     where price_symbol is not null and upper(btrim(price_symbol)) not in (select public.public_symbols())
     group by 1, 2;

  insert into public.asset_price_findings
    (symbol, price, currency, url, source_query, raw_snippet, confidence, extracted_by, status,
     found_at, expires_at, explanation, headlines, owner)
  select f.symbol, f.price, f.currency, f.url, f.source_query, f.raw_snippet, f.confidence, f.extracted_by, f.status,
         f.found_at, f.expires_at, f.explanation, f.headlines, w.user_id
    from public.asset_price_findings f
    join zz_follows w on w.symbol = upper(btrim(f.symbol)) and w.how = 'owned' and f.found_at >= w.since
   where f.owner = shared;

  insert into public.market_index_findings
    (symbol, price, currency, url, source_query, raw_snippet, confidence, extracted_by, explanation, status,
     found_at, expires_at, headlines, owner)
  select f.symbol, f.price, f.currency, f.url, f.source_query, f.raw_snippet, f.confidence, f.extracted_by, f.explanation, f.status,
         f.found_at, f.expires_at, f.headlines, w.user_id
    from public.market_index_findings f
    join zz_follows w on w.symbol = upper(btrim(f.symbol)) and w.how = 'tracked' and f.found_at >= w.since
   where f.owner = shared;

  insert into public.daily_prices (symbol, trade_date, open, high, low, close, previous_close, updated_at, headline, owner)
  select d.symbol, d.trade_date, d.open, d.high, d.low, d.close, d.previous_close, d.updated_at, d.headline, w.user_id
    from public.daily_prices d
    join (select user_id, symbol, min(since) as since from zz_follows group by 1, 2) w
      on w.symbol = upper(btrim(d.symbol)) and d.trade_date >= (w.since at time zone 'America/New_York')::date
   where d.owner = shared;

  insert into public.symbol_fundamentals (symbol, company_name, market_cap, pe_ratio, dividend_yield, industry, fetched_at, owner)
  select f.symbol, f.company_name, f.market_cap, f.pe_ratio, f.dividend_yield, f.industry, f.fetched_at, w.user_id
    from public.symbol_fundamentals f
    join (select distinct user_id, symbol from zz_follows) w on w.symbol = upper(btrim(f.symbol))
   where f.owner = shared;

  delete from public.market_index_findings where owner = shared and upper(btrim(symbol)) not in (select public.public_symbols());
  delete from public.daily_prices where owner = shared and upper(btrim(symbol)) not in (select public.public_symbols());
  delete from public.symbol_fundamentals where owner = shared and upper(btrim(symbol)) not in (select public.public_symbols());
  -- Public symbols included: a shared holding-price row existed only while
  -- somebody owned that company.
  delete from public.asset_price_findings where owner = shared;

  delete from public.deal_findings where status = 'candidate';
end $$;

-- ---- A symbol looks like a symbol ------------------------------------------

alter table public.watchlist_symbols add constraint watchlist_symbols_symbol_shape
  check (symbol ~ '^[A-Za-z0-9][A-Za-z0-9.\-]{0,14}$');
alter table public.assets add constraint assets_price_symbol_shape
  check (price_symbol is null or price_symbol ~ '^[A-Za-z0-9][A-Za-z0-9.\-]{0,14}$');

-- ---- At most 50 companies outside the public list per account --------------

-- Owned and tracked counted together, each company once. Runs as the person
-- (security invoker), so it counts their own rows. The app turns
-- 'symbol_limit' into words.
create or replace function public.limit_followed_symbols()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  n int;
begin
  select count(*) into n from (
    select upper(btrim(symbol)) as s from public.watchlist_symbols where user_id = new.user_id
    union
    select upper(btrim(price_symbol)) from public.assets where user_id = new.user_id and price_symbol is not null
  ) x
  where s not in (select public.public_symbols());
  if n > 50 then
    raise exception 'symbol_limit' using detail = 'An account can follow up to 50 companies outside the starter list.';
  end if;
  return null;
end;
$$;
revoke all on function public.limit_followed_symbols() from public, anon;

create trigger limit_followed_symbols after insert or update of symbol on public.watchlist_symbols
  for each row execute function public.limit_followed_symbols();
create trigger limit_followed_symbols after insert or update of price_symbol on public.assets
  for each row when (new.price_symbol is not null) execute function public.limit_followed_symbols();

-- ---- Deleting a person removes their copies too -----------------------------

create or replace function public.record_history_forget()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.record_history where user_id = old.id;
  delete from public.asset_price_findings where owner = old.id;
  delete from public.market_index_findings where owner = old.id;
  delete from public.daily_prices where owner = old.id;
  delete from public.symbol_fundamentals where owner = old.id;
  return old;
end;
$$;
revoke all on function public.record_history_forget() from public, anon, authenticated;
