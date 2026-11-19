-- TWO GAPS FROM THE 2026-11-19 SECURITY REVIEW.
--
-- 1. ANYONE COULD CREATE AN ACCOUNT. Public sign-up is on in the project's
-- Auth settings, and the app's "email me a link" button created an account
-- for any address it was given. A stranger could not read anyone's records
-- (row-level security holds), but could read the shared tables, which name
-- every stock the household tracks or owns, spend the shared stock-price
-- allowance through /api/quotes, and write feedback. Auth settings live in
-- the dashboard, out of reach of any migration, so the database refuses a new
-- sign-in account itself unless its email has been invited:
--
--     insert into public.allowed_signups (email) values ('someone@example.com');
--
-- Run that in the SQL editor BEFORE inviting someone or asking them to sign
-- up; the dashboard's own Invite user and Add user are refused without it too.
-- Existing accounts are untouched: this fires only when a new one is created.
-- The emails are deliberately not seeded here, because this file is public.
--
-- 2. A ROW COULD POINT AT SOMEONE ELSE'S ROW. Row-level security decides which
-- rows a person can read and write, but a foreign key is checked without it,
-- so a person could save their own row pointing at another person's account,
-- asset, debt or expense if they knew its id. Most such links do nothing to
-- the other person, but a refund pointing at their purchase stopped them
-- deleting it, with no way for them to see why, and the nightly balance check
-- (which reads everyone's rows) would have counted a stranger's expense
-- against their account. Every id is a random UUID nobody else ever sees, so
-- this was hard to reach; it is closed anyway. Verified before applying that no
-- existing row links across people.

-- ---- 1. Invitation-only sign-up -------------------------------------------

create table if not exists public.allowed_signups (
  email text primary key check (email = lower(btrim(email)) and email like '%@%'),
  note text,
  added_at timestamptz not null default now()
);
alter table public.allowed_signups enable row level security;
-- No policy and no grant for the app's roles: nobody signed in or out can read
-- or change who is invited. The service role reads it for the backup.
revoke all on public.allowed_signups from public, anon, authenticated;
grant select, insert, delete on public.allowed_signups to service_role;

create or replace function public.enforce_signup_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is null
     or not exists (select 1 from public.allowed_signups where email = lower(btrim(new.email))) then
    raise exception using errcode = 'P0001', message = 'signup_not_invited',
      hint = 'Add the email to public.allowed_signups first.';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_signup_invite() from public, anon, authenticated;
grant execute on function public.enforce_signup_invite() to supabase_auth_admin;

drop trigger if exists aa_signup_by_invite on auth.users;
create trigger aa_signup_by_invite before insert on auth.users
  for each row execute function public.enforce_signup_invite();

-- ---- 2. Every link stays within one person's records ------------------------

-- Called with pairs "column:table" for the row's links. A link to a row that
-- does not exist is left to the foreign key, which also lets a refund arrive
-- before its purchase inside one transaction (the deferred key in 89). A link
-- to a row that exists and belongs to someone else is refused.
--
-- SECURITY DEFINER so it can see the row it points at whoever is writing:
-- under row-level security another person's row is simply invisible, which
-- cannot be told apart from one that does not exist yet.
create or replace function public.check_same_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pair text;
  col text;
  tbl text;
  ref uuid;
  owner uuid;
  doc jsonb := to_jsonb(new);
begin
  foreach pair in array tg_argv loop
    col := split_part(pair, ':', 1);
    tbl := split_part(pair, ':', 2);
    ref := (doc ->> col)::uuid;
    if ref is null then
      continue;
    end if;
    execute format('select user_id from public.%I where id = $1', tbl) into owner using ref;
    if owner is not null and owner is distinct from new.user_id then
      raise exception using errcode = '42501', message = 'money_not_yours',
        detail = jsonb_build_object('table', tg_table_name, 'column', col)::text;
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.check_same_owner() from public, anon, authenticated;

create trigger same_owner before insert or update of account_id, refund_of on public.expenses
  for each row execute function public.check_same_owner('account_id:accounts', 'refund_of:expenses');
create trigger same_owner before insert or update of account_id, related_account_id, liability_id, asset_id on public.account_activity
  for each row execute function public.check_same_owner('account_id:accounts', 'related_account_id:accounts', 'liability_id:liabilities', 'asset_id:assets');
create trigger same_owner before insert or update of linked_asset_id, linked_liability_id on public.accounts
  for each row execute function public.check_same_owner('linked_asset_id:assets', 'linked_liability_id:liabilities');
create trigger same_owner before insert or update of parent_asset_id on public.assets
  for each row execute function public.check_same_owner('parent_asset_id:assets');
create trigger same_owner before insert or update of account_id, pays_liability_id on public.subscriptions
  for each row execute function public.check_same_owner('account_id:accounts', 'pays_liability_id:liabilities');
create trigger same_owner before insert or update of account_id on public.income
  for each row execute function public.check_same_owner('account_id:accounts');
create trigger same_owner before insert or update of asset_id, account_id on public.holding_sales
  for each row execute function public.check_same_owner('asset_id:assets', 'account_id:accounts');
