-- ANYONE MAY SIGN UP; NOBODY MAY SEE ANYONE ELSE'S CHOICES.
--
-- The app is for a small number of users because it runs entirely on free
-- tiers, not because it is for one household. A stranger making an account
-- is fine, as long as no account can see another's information. 92 had closed
-- sign-up to invited emails, because the shared tables DID show other users'
-- information to any signed-in account:
--
--   - asset_price_findings, market_index_findings, daily_prices and
--     symbol_fundamentals held a row per symbol for the UNION of everyone's
--     holdings and tracked companies, so listing them listed what other
--     people own and follow.
--   - daily_recaps and market_news_findings were built over that union, so
--     their movers, written summaries and headlines named other people's
--     companies.
--   - deal_findings is keyed by subscription names taken from everyone's
--     subscriptions, so it listed services other people pay for.
--
-- Names only, never amounts, but other people's all the same. This makes each
-- of those private and then opens sign-up again:
--
--   1. A per-symbol row is readable only for a symbol the reader owns or
--      tracks, or one of the four index funds every Market tab shows
--      (my_symbols()). The prices themselves are public facts; WHICH symbols
--      someone has is not.
--   2. A deal finding is readable only for a service the reader has a
--      subscription of that exact name to. Exact rather than the app's loose
--      contains-match on purpose: a one-letter subscription name would
--      otherwise match nearly every service. The deal search runs on every
--      user's exact names, so each still gets their own.
--   3. The shared recap and news digest are built from now on over the
--      PUBLIC list only: the 20 large companies every new account starts
--      with, which are in this public repository (tools/price-agent.js). Each
--      person's own movers are worked out in the app from their own prices,
--      and the headline chosen for each stock is stored on that stock's own
--      daily_prices row (headline, below), where rule 1 protects it.
--   4. What is already stored is cleaned to match, worked out from the data
--      at the time this runs, so this file never names a private symbol:
--      past recaps keep only public-list movers, a written summary that names
--      a company outside it is withdrawn, the stored all-users breadth is
--      dropped, and a news digest that includes one is deleted.
--
-- Not private, on purpose: the four index funds, the whole-market movers
-- (market_movers, from Alpha Vantage, about the market rather than anyone),
-- the curated subscription catalog, and agent_run_status, which holds only
-- counts and statuses.

-- ---- Sign-up open again ----------------------------------------------------

drop trigger if exists aa_signup_by_invite on auth.users;
drop function if exists public.enforce_signup_invite();
drop table if exists public.allowed_signups;

-- ---- 1. Per-symbol rows: only your own symbols ----------------------------

-- Every symbol this person owns or tracks, plus the four index funds. Runs as
-- the caller (security invoker), so the watchlist and assets it reads are
-- already limited to their own rows by those tables' own policies; the
-- user_id test below says so explicitly as well. The four funds must match
-- MARKET_INDEX_ETF_PROXIES in app/app.js and tools/price-agent.js;
-- tests/security.test.mjs compares them.
create or replace function public.my_symbols()
returns setof text
language sql
stable
security invoker
set search_path = public
as $$
  select upper(btrim(symbol)) from public.watchlist_symbols where user_id = auth.uid()
  union
  select upper(btrim(price_symbol)) from public.assets where user_id = auth.uid() and price_symbol is not null
  union
  select unnest(array['SPY', 'DIA', 'QQQ', 'IWM'])
$$;
revoke all on function public.my_symbols() from public, anon;
grant execute on function public.my_symbols() to authenticated, service_role;

drop policy if exists "read asset_price_findings" on public.asset_price_findings;
create policy "read own symbols asset_price_findings" on public.asset_price_findings for select
  using ((select auth.role()) = 'authenticated' and status <> 'rejected'
         and upper(btrim(symbol)) in (select public.my_symbols()));

drop policy if exists "read market_index_findings" on public.market_index_findings;
create policy "read own symbols market_index_findings" on public.market_index_findings for select
  using ((select auth.role()) = 'authenticated' and status <> 'rejected'
         and upper(btrim(symbol)) in (select public.my_symbols()));

drop policy if exists "read daily_prices" on public.daily_prices;
create policy "read own symbols daily_prices" on public.daily_prices for select
  using ((select auth.role()) = 'authenticated'
         and upper(btrim(symbol)) in (select public.my_symbols()));

drop policy if exists "read symbol_fundamentals" on public.symbol_fundamentals;
create policy "read own symbols symbol_fundamentals" on public.symbol_fundamentals for select
  using ((select auth.role()) = 'authenticated'
         and upper(btrim(symbol)) in (select public.my_symbols()));

-- ---- 2. Deal findings: only your own services -----------------------------

drop policy if exists "read deal_findings" on public.deal_findings;
create policy "read own services deal_findings" on public.deal_findings for select
  using ((select auth.role()) = 'authenticated' and status <> 'rejected'
         and lower(btrim(service)) in (
           select lower(btrim(name)) from public.subscriptions where user_id = auth.uid()));

-- ---- 3. The headline chosen for each stock, on its own row ----------------

-- Written by the daily recap job for every owned or tracked stock: the first
-- stored headline that names the company, the same check the shared recap
-- uses. It lives here rather than in daily_recaps so that rule 1 decides who
-- can read it. Never purged, like the rest of daily_prices, so a past day's
-- coverage stays that day's.
alter table public.daily_prices add column if not exists headline jsonb;

-- ---- 4. Clean what is already stored --------------------------------------

do $$
declare
  public_list text[] := array['AAPL','MSFT','GOOGL','AMZN','NVDA','META','TSLA','JPM','V','UNH',
                              'XOM','JNJ','WMT','PG','MA','HD','DIS','NFLX','AMD','KO',
                              'SPY','DIA','QQQ','IWM'];
  terms text[];
begin
  -- Every symbol someone owns or tracks that is NOT on the public list, and
  -- each one's company name as stored, read from the data rather than
  -- written here.
  select coalesce(array_agg(distinct t), '{}') into terms from (
    select upper(btrim(symbol)) as t from public.watchlist_symbols where upper(btrim(symbol)) <> all (public_list)
    union select upper(btrim(price_symbol)) from public.assets
      where price_symbol is not null and upper(btrim(price_symbol)) <> all (public_list)
    union select btrim(w.company_name) from public.watchlist_symbols w
      where upper(btrim(w.symbol)) <> all (public_list) and coalesce(btrim(w.company_name), '') <> ''
    union select btrim(f.company_name) from public.symbol_fundamentals f
      where upper(btrim(f.symbol)) <> all (public_list) and coalesce(btrim(f.company_name), '') <> ''
  ) x where coalesce(t, '') <> '';

  -- A written summary that names one of them is withdrawn. Matched as a whole
  -- word, the same lookaround the agents use, so "V" cannot match "Visa".
  update public.daily_recaps r
     set summary = null, summary_skipped_reason = 'withdrawn_private', generated_by = 'rollup'
   where r.summary is not null
     and exists (select 1 from unnest(terms) t
                 where r.summary ~* ('(^|[^a-z0-9])' || regexp_replace(t, '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || '([^a-z0-9]|$)'));

  -- Only public-list movers stay, in their original order. The stored
  -- breadth counted everyone's companies together and is dropped; the app
  -- has never shown it.
  update public.daily_recaps r
     set movers = coalesce((
           select jsonb_agg(m.value order by m.ord)
             from jsonb_array_elements(r.movers) with ordinality as m(value, ord)
            where upper(m.value ->> 'symbol') = any (public_list)), '[]'::jsonb),
         breadth = null;

  -- A news digest that includes a private company is deleted rather than
  -- trimmed: its sentiment line was written about the whole set. A new one is
  -- written every weekday.
  delete from public.market_news_findings n
   where exists (select 1 from jsonb_array_elements(n.headlines) h
                 where upper(coalesce(h ->> 'symbol', '')) <> all (public_list));
end $$;
