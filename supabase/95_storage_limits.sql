-- ONE ACCOUNT CANNOT FILL THE DATABASE FOR EVERYONE.
--
-- Anyone may sign up, and the free database holds 500 MB (about 20 MB used on
-- 2026-11-19). When it fills, Supabase makes the project read-only and nobody
-- can save anything. Before this an account could insert as many rows, with
-- as much text, as it liked, and every edit or delete also keeps the old row
-- in record_history, so editing one row over and over grew the database with
-- no new rows at all.
--
-- Three limits, each far above any real use (the busiest account had 23
-- tracked companies, 8 assets and 2 expenses when this was written):
--
--   1. Text length on every field the app writes. Generous: 200 for a name,
--      500 for a description, 2,000 for a note. The app's inputs carry the
--      same maxlength, and the CSV import trims descriptions to fit, so
--      ordinary use never meets these; they stop a script.
--   2. Rows per account per table (row_cap), checked once per statement so a
--      5,000-row import costs one count, not 5,000.
--   3. Saved earlier versions per account: 15,000 a day and 50,000 in all
--      (history_usage). A full CSV import undone twice in a day is 10,000.
--      Past either, the edit or delete is refused rather than history being
--      thrown away, because reconcile_balances() reads it. Raise the numbers
--      here if a real account ever needs more.
--
-- Each refusal raises a plain code ('row_limit', 'history_limit') or a named
-- check ('..._length'), and the app says which in words. A determined person
-- with many accounts can still fill the database; the daily backup job reports
-- the database size (database_size_bytes() below) so that shows up long
-- before it is full, and sign-up protection lives in the Supabase dashboard.

-- ---- 1. Text length ----------------------------------------------------------

alter table public.account_activity
  add constraint account_activity_description_length check (length(description) <= 500),
  add constraint account_activity_kind_length check (length(kind) <= 40),
  add constraint account_activity_source_length check (length(source) <= 40);
alter table public.accounts
  add constraint accounts_name_length check (length(name) <= 200),
  add constraint accounts_type_length check (length(type) <= 60),
  add constraint accounts_last_four_length check (length(last_four) <= 20),
  add constraint accounts_bank_name_length check (length(bank_name) <= 200),
  add constraint accounts_card_product_length check (length(card_product) <= 200);
alter table public.assets
  add constraint assets_name_length check (length(name) <= 200),
  add constraint assets_notes_length check (length(notes) <= 2000),
  add constraint assets_investment_bucket_length check (length(investment_bucket) <= 100);
alter table public.budget_periods
  add constraint budget_periods_period_length check (length(period) <= 20),
  add constraint budget_periods_category_length check (length(category) <= 100),
  add constraint budget_periods_classification_length check (length(classification) <= 40);
alter table public.budgets
  add constraint budgets_category_length check (length(category) <= 100),
  add constraint budgets_classification_length check (length(classification) <= 40);
alter table public.category_rules
  add constraint category_rules_keyword_length check (length(keyword) <= 200),
  add constraint category_rules_category_length check (length(category) <= 100);
alter table public.expenses
  add constraint expenses_currency_length check (length(currency) <= 10),
  add constraint expenses_description_length check (length(description) <= 500),
  add constraint expenses_merchant_length check (length(merchant) <= 200),
  add constraint expenses_category_length check (length(category) <= 100),
  add constraint expenses_raw_input_length check (length(raw_input) <= 1000),
  add constraint expenses_source_length check (length(source) <= 40),
  add constraint expenses_note_length check (length(note) <= 2000);
alter table public.feedback_tickets
  add constraint feedback_tickets_page_length check (length(page) <= 200),
  add constraint feedback_tickets_user_agent_length check (length(user_agent) <= 1000);
alter table public.holding_sales
  add constraint holding_sales_symbol_length check (length(symbol) <= 20);
alter table public.income
  add constraint income_source_length check (length(source) <= 200),
  add constraint income_cadence_length check (length(cadence) <= 40),
  add constraint income_notes_length check (length(notes) <= 2000);
alter table public.investment_targets
  add constraint investment_targets_bucket_length check (length(bucket) <= 100);
alter table public.liabilities
  add constraint liabilities_name_length check (length(name) <= 200),
  add constraint liabilities_type_length check (length(type) <= 60),
  add constraint liabilities_notes_length check (length(notes) <= 2000);
alter table public.portfolio_recaps
  add constraint portfolio_recaps_summary_length check (length(summary) <= 10000),
  add constraint portfolio_recaps_generated_by_length check (length(generated_by) <= 60),
  add constraint portfolio_recaps_skipped_length check (length(summary_skipped_reason) <= 200),
  add constraint portfolio_recaps_figures_length check (length(figures::text) <= 100000);
alter table public.profiles
  add constraint profiles_display_name_length check (length(display_name) <= 200),
  add constraint profiles_status_length check (length(status) <= 40),
  add constraint profiles_school_length check (length(school) <= 200),
  add constraint profiles_notes_length check (length(notes) <= 2000),
  add constraint profiles_employer_length check (length(employer) <= 200),
  add constraint profiles_occupation_length check (length(occupation) <= 200),
  add constraint profiles_housing_status_length check (length(housing_status) <= 40),
  add constraint profiles_employment_status_length check (length(employment_status) <= 40),
  add constraint profiles_financial_goals_length check (length(financial_goals) <= 2000),
  add constraint profiles_risk_label_length check (length(risk_label) <= 60);
alter table public.qa_cache
  add constraint qa_cache_question_length check (length(question) <= 2000),
  add constraint qa_cache_answer_length check (length(answer) <= 20000),
  add constraint qa_cache_answer_kind_length check (length(answer_kind) <= 40);
alter table public.sinking_funds
  add constraint sinking_funds_name_length check (length(name) <= 200),
  add constraint sinking_funds_notes_length check (length(notes) <= 2000);
alter table public.subscriptions
  add constraint subscriptions_name_length check (length(name) <= 200),
  add constraint subscriptions_notes_length check (length(notes) <= 2000),
  add constraint subscriptions_category_length check (length(category) <= 100);
alter table public.watchlist_symbols
  add constraint watchlist_symbols_company_name_length check (length(company_name) <= 200);

-- ---- 2. Rows per account -----------------------------------------------------

-- One count per account in the statement, against the table the trigger is
-- on. Runs as the caller, so row-level security limits the count to their own
-- rows, which is the count wanted. The limit is the trigger's argument.
create or replace function public.enforce_row_cap()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  cap int := tg_argv[0]::int;
  over uuid;
begin
  execute format(
    'select a.user_id from (select distinct user_id from added) a
      where (select count(*) from public.%I t where t.user_id = a.user_id) > $1 limit 1',
    tg_table_name)
  into over using cap;
  if over is not null then
    raise exception 'row_limit' using detail = format('%s:%s', tg_table_name, cap);
  end if;
  return null;
end;
$$;
revoke all on function public.enforce_row_cap() from public, anon;

create trigger row_cap after insert on public.expenses referencing new table as added for each statement execute function public.enforce_row_cap('20000');
create trigger row_cap after insert on public.account_activity referencing new table as added for each statement execute function public.enforce_row_cap('20000');
create trigger row_cap after insert on public.accounts referencing new table as added for each statement execute function public.enforce_row_cap('200');
create trigger row_cap after insert on public.assets referencing new table as added for each statement execute function public.enforce_row_cap('1000');
create trigger row_cap after insert on public.liabilities referencing new table as added for each statement execute function public.enforce_row_cap('200');
create trigger row_cap after insert on public.subscriptions referencing new table as added for each statement execute function public.enforce_row_cap('500');
create trigger row_cap after insert on public.income referencing new table as added for each statement execute function public.enforce_row_cap('200');
create trigger row_cap after insert on public.holding_sales referencing new table as added for each statement execute function public.enforce_row_cap('5000');
create trigger row_cap after insert on public.sinking_funds referencing new table as added for each statement execute function public.enforce_row_cap('200');
create trigger row_cap after insert on public.budgets referencing new table as added for each statement execute function public.enforce_row_cap('200');
create trigger row_cap after insert on public.budget_periods referencing new table as added for each statement execute function public.enforce_row_cap('5000');
create trigger row_cap after insert on public.category_rules referencing new table as added for each statement execute function public.enforce_row_cap('2000');
create trigger row_cap after insert on public.investment_targets referencing new table as added for each statement execute function public.enforce_row_cap('100');
create trigger row_cap after insert on public.watchlist_symbols referencing new table as added for each statement execute function public.enforce_row_cap('100');
create trigger row_cap after insert on public.feedback_tickets referencing new table as added for each statement execute function public.enforce_row_cap('300');
create trigger row_cap after insert on public.net_worth_snapshots referencing new table as added for each statement execute function public.enforce_row_cap('20000');
create trigger row_cap after insert on public.portfolio_snapshots referencing new table as added for each statement execute function public.enforce_row_cap('20000');
create trigger row_cap after insert on public.portfolio_recaps referencing new table as added for each statement execute function public.enforce_row_cap('20000');
create trigger row_cap after insert on public.qa_cache referencing new table as added for each statement execute function public.enforce_row_cap('2000');

-- ---- 3. Saved earlier versions per account --------------------------------

-- Written only by record_history_write (security definer); nobody else may
-- read or change it.
create table public.history_usage (
  user_id uuid primary key,
  day date not null,
  today integer not null default 0,
  total bigint not null default 0
);
alter table public.history_usage enable row level security;
revoke all on public.history_usage from anon, authenticated;
grant select, delete on public.history_usage to service_role;

create or replace function public.record_history_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_doc jsonb := to_jsonb(old);
  new_doc jsonb;
  changed text[];
  owner uuid := (to_jsonb(old) ->> 'user_id')::uuid;
  used_today int;
  used_total bigint;
begin
  if owner is not null and not exists (select 1 from auth.users u where u.id = owner) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'UPDATE' then
    new_doc := to_jsonb(new);
    if new_doc = old_doc then
      return new;
    end if;
    if tg_table_name = 'assets' then
      select array_agg(n.key) into changed
      from jsonb_each(new_doc) n
      where n.value is distinct from old_doc -> n.key;
      if changed <@ array['value', 'updated_at']
         and ((new_doc ->> 'price_symbol') is not null
              or exists (select 1 from public.assets c where c.parent_asset_id = (new_doc ->> 'id')::uuid)) then
        return new;
      end if;
    end if;
  end if;

  if owner is not null then
    insert into public.history_usage as u (user_id, day, today, total)
    values (owner, current_date, 1, 1)
    on conflict (user_id) do update
      set today = case when u.day = current_date then u.today + 1 else 1 end,
          day = current_date,
          total = u.total + 1
    returning u.today, u.total into used_today, used_total;
    if used_today > 15000 or used_total > 50000 then
      raise exception 'history_limit' using detail = format('%s today, %s in all', used_today, used_total);
    end if;
  end if;

  if tg_op = 'UPDATE' then
    insert into public.record_history (user_id, table_name, row_id, action, old_row, new_row)
    values (coalesce((new_doc ->> 'user_id')::uuid, (old_doc ->> 'user_id')::uuid),
            tg_table_name, (old_doc ->> 'id')::uuid, 'update', old_doc, new_doc);
    return new;
  end if;

  insert into public.record_history (user_id, table_name, row_id, action, old_row, new_row)
  values ((old_doc ->> 'user_id')::uuid, tg_table_name, (old_doc ->> 'id')::uuid, 'delete', old_doc, null);
  return old;
end;
$$;
revoke all on function public.record_history_write() from public, anon, authenticated;

create or replace function public.record_history_forget()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.record_history where user_id = old.id;
  delete from public.history_usage where user_id = old.id;
  delete from public.asset_price_findings where owner = old.id;
  delete from public.market_index_findings where owner = old.id;
  delete from public.daily_prices where owner = old.id;
  delete from public.symbol_fundamentals where owner = old.id;
  return old;
end;
$$;
revoke all on function public.record_history_forget() from public, anon, authenticated;

-- ---- How full the database is --------------------------------------------------

-- Read by the daily backup job, which reports it with its status. A size is
-- not anyone's information, so the status row stays safe for every account to
-- read.
create or replace function public.database_size_bytes()
returns bigint
language sql
stable
set search_path = public
as $$
  select pg_database_size(current_database())
$$;
revoke all on function public.database_size_bytes() from public, anon, authenticated;
grant execute on function public.database_size_bytes() to service_role;
