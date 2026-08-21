-- Realized gain/loss - the first time this app can tell a SALE apart from a
-- correction.
--
-- Until now a reduced holding quantity was deliberately treated as a typo
-- fix and did nothing (see app.js's saveHoldingBtn: the funding-account
-- logic only ever charges a POSITIVE cost-basis delta), because there was
-- no way to know which one the user meant. That made unrealized gain the
-- only gain this app could show. A row here is the explicit "I sold this"
-- signal that was missing.
--
-- **Average-cost method, and the UI says so.** assets.purchase_price stores
-- one TOTAL cost basis for the whole position, with no per-lot history, so
-- a sale removes a proportional slice of it. Real per-lot tracking (FIFO or
-- specific-identification, which is what US brokerages actually report for
-- stocks) would need a lots table and a purchase history this app has never
-- recorded. Average cost is a genuine, IRS-recognized method for mutual
-- funds but is NOT what a broker reports for individual shares, so this is
-- labeled "average cost" everywhere it appears and must never be presented
-- as a tax basis. Same never-overstate-what-we-know line the recap's
-- coverage-not-cause wording and the credit-utilization line already hold.
--
-- Insert-only history: a sale is an event that happened. Correcting one
-- means undoing it from Recent History (which reverses every effect below),
-- not editing this row.
create table if not exists holding_sales (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- Kept on delete set null rather than cascade: deleting the holding must
  -- not erase the realized gain it produced, which is real financial
  -- history and feeds a year-to-date total.
  asset_id           uuid references assets(id) on delete set null,
  symbol             text not null,
  quantity           numeric(20,6) not null check (quantity > 0),
  proceeds           numeric(14,2) not null check (proceeds >= 0),
  cost_basis_removed numeric(14,2) not null,
  -- Stored rather than derived so the number can never drift if the
  -- parent holding's remaining basis is later edited.
  realized_gain      numeric(14,2) not null,
  sold_on            date not null,
  -- Where the proceeds landed. Nullable for a sale whose cash isn't tracked
  -- here (left in a brokerage's own settlement cash, say), mirroring how the
  -- Holdings form's "Paid from" is genuinely optional.
  account_id         uuid references accounts(id) on delete set null,
  created_at         timestamptz default now()
);

create index if not exists holding_sales_user_date_idx on holding_sales (user_id, sold_on desc);

alter table holding_sales enable row level security;
drop policy if exists "own holding_sales" on holding_sales;
create policy "own holding_sales" on holding_sales
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on holding_sales to authenticated;
grant select, insert, update, delete on holding_sales to service_role;

-- A sale credits a real account, so it needs its own account_activity kind -
-- without this the CHECK rejects the write and the proceeds silently never
-- reach the balance. Same reason 'contribution', 'transfer' and 'income'
-- were each added rather than overloading 'asset_adjust': telling real
-- money movements apart is what makes them individually undoable and
-- correctly attributed in Recent History.
alter table account_activity drop constraint if exists account_activity_kind_check;
alter table account_activity add constraint account_activity_kind_check
  check (kind in ('asset_adjust', 'liability_payment', 'owed_adjust', 'account_created',
                  'contribution', 'transfer', 'income', 'holding_sale'));
