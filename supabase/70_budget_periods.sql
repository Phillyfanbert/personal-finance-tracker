-- What a budget actually WAS in a given month.
--
-- `budgets` holds one row per category carrying one current limit, with no
-- effective dating, so "did I keep to my budget in August" was unanswerable:
-- comparing August's spending against today's limit measures it against a
-- number that may not have existed then. This is the record that makes a past
-- month comparable to what was really planned at the time.
--
-- Deliberately a SNAPSHOT keyed by period, not an audit log of every edit.
-- The question is "what was the limit for that month", which has one answer
-- per month; a change history would answer a question nothing asks and would
-- need conflict rules for mid-month edits.
--
-- There is no server or cron for a static PWA, so this is written on app load
-- the same way net_worth_snapshots is (snapshotNetWorthIfNeeded). The current
-- month's rows are kept in step with the live budgets on every load, so a
-- mid-month change is reflected; once the month rolls over nothing touches
-- those rows again and they stand as what was in force when it ended.
--
-- A month the app was never opened in simply has no rows, and the UI must say
-- so rather than falling back to today's limits - an absent record is a real
-- answer here, the same way an untagged budget is.
create table if not exists budget_periods (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users on delete cascade,
  period         text not null check (period ~ '^[0-9]{4}-[0-9]{2}$'),
  category       text not null,
  monthly_limit  numeric(12,2) not null,
  classification text check (classification is null or classification in ('need', 'want', 'savings')),
  created_at     timestamptz default now(),
  updated_at     timestamptz default now(),
  unique (user_id, period, category)
);
create index if not exists budget_periods_user_period_idx on budget_periods (user_id, period);

alter table budget_periods enable row level security;
drop policy if exists "own budget_periods" on budget_periods;
create policy "own budget_periods" on budget_periods
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- RLS is not sufficient on its own; base privileges are not automatic and
-- their absence has caused two separate production bugs in this project.
grant select, insert, update, delete on budget_periods to authenticated;
grant select, insert, update, delete on budget_periods to service_role;

comment on table budget_periods is
  'Per-month snapshot of each category budget, so a past month can be compared against what was actually budgeted then rather than against today''s limit.';
