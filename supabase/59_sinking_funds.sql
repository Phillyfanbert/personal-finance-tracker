-- SINKING FUNDS: saving toward a known, irregular cost -----------------------
--
-- The first budgeting concept in this app that is NOT a monthly ceiling.
-- `budgets.monthly_limit` answers "how much may I spend on this each month";
-- a sinking fund answers "how much have I set aside toward this one dated
-- cost so far" - a car registration, an annual insurance premium, a holiday
-- season. Those are different shapes of data, which is why this is its own
-- table rather than a flag on `budgets`. Full reasoning, including the
-- comparison against how EveryDollar, YNAB, Goodbudget, Copilot and Monarch
-- each implement this, is in docs/budgeting-feature-design.md section 3.
--
-- **This table never moves real money, and that is deliberate.** Contributing
-- to a fund raises `saved` and nothing else: no asset is debited, no
-- account_activity row is written. A sinking fund is a plan for money you
-- already hold, not a transfer of it, so applying a balance delta here would
-- invent a movement that never happened - the same class of mistake as
-- reversing a balance for a CSV-imported expense that never applied one.
-- If a fund's money is genuinely moved into a separate savings account, that
-- is a real Transfer between accounts and is recorded there instead.
--
-- `target_date` is nullable on purpose. Without one there is no deadline to
-- divide by, so sinkingFundStatus() reports monthlyNeeded as null rather
-- than inventing a schedule - same omit-rather-than-fake-a-number rule the
-- rest of this app holds.
create table if not exists sinking_funds (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name          text not null,
  target_amount numeric(12,2) not null check (target_amount > 0),
  -- Nullable: a fund with no deadline is a valid thing to track.
  target_date   date,
  -- Never negative. Allowed to exceed target_amount: someone can genuinely
  -- over-save, and refusing to record that would make a true balance
  -- impossible to enter (same reasoning as the credit-limit ceiling
  -- deliberately not capping interest charges or manual corrections).
  saved         numeric(12,2) not null default 0 check (saved >= 0),
  notes         text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

alter table sinking_funds enable row level security;
drop policy if exists "own sinking funds" on sinking_funds;
create policy "own sinking funds" on sinking_funds
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Both roles, explicitly. RLS alone is not sufficient: every table in this
-- schema needs base privileges granted to authenticated AND service_role,
-- which two earlier migrations existed solely to repair after the fact
-- (44_fix_missing_grants.sql, 47_fix_missing_service_role_grants.sql).
grant select, insert, update, delete on sinking_funds to authenticated;
grant select, insert, update, delete on sinking_funds to service_role;

drop trigger if exists sinking_funds_touch_updated_at on sinking_funds;
create trigger sinking_funds_touch_updated_at
  before update on sinking_funds
  for each row execute function touch_updated_at();
