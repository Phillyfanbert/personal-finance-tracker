-- EVERY EDIT AND DELETE KEEPS WHAT THE RECORD SAID BEFORE.
--
-- Until this, editing an expense overwrote it and deleting one was permanent
-- once its undo had passed: nothing anywhere recorded what a record said
-- before it changed, which bookkeeping software is expected to keep. A
-- reliability audit on 2026-11-18 listed it as a high-priority gap.
--
-- record_history holds one row per UPDATE or DELETE on the tables that make up
-- the books, carrying the whole old row (and, for an update, the new one). It
-- is written by a trigger, so no path in the app, the server's jobs or a direct
-- request can change a record without it; the app has no code for it at all.
--
-- APPEND-ONLY FROM THE APP'S SIDE. A signed-in user can read their own rows and
-- nothing else: no insert, update or delete grant, so a history row cannot be
-- forged, edited or removed through the API. The trigger function is SECURITY
-- DEFINER for exactly that reason, it is the only writer, and it runs with a
-- pinned search_path.
--
-- NOT RECORDED, deliberately: a price sync. The app rewrites an investment
-- account's value every few minutes while the market is open, following live
-- prices; those are not changes anyone made to the books, and logging them
-- would bury the real ones. An update to assets that touches only value and
-- updated_at, on a priced asset or an account holding positions, is skipped.
--
-- user_id is the OWNER of the changed row and has no foreign key on purpose:
-- deleting a person cascades to their records, and a foreign key to the person
-- being deleted would make the whole deletion fail. Deleting someone must
-- still remove everything about them, so two things together do it, neither
-- depending on the order the database runs them in (which is not the order
-- their names suggest: a cascade's own triggers run after the triggers on the
-- row that started it, measured in a rolled-back probe):
--   - nothing is written for a row whose owner no longer exists, which is
--     every cascaded delete and every ON DELETE SET NULL it causes;
--   - record_history_forget() removes the history written while they existed.

create table public.record_history (
  id bigint generated always as identity primary key,
  user_id uuid,
  table_name text not null,
  row_id uuid,
  action text not null check (action in ('update', 'delete')),
  old_row jsonb not null,
  new_row jsonb,
  changed_at timestamptz not null default now(),
  changed_by uuid default auth.uid()
);

create index record_history_owner_idx on public.record_history (user_id, table_name, row_id, changed_at desc);

alter table public.record_history enable row level security;

create policy "read own history" on public.record_history
  for select using (auth.uid() = user_id);

revoke all on public.record_history from public, anon, authenticated;
grant select on public.record_history to authenticated;
-- service_role reads it for the server's backups and deletes from it for a
-- deletion request; it is never written by hand.
grant select, delete on public.record_history to service_role;

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
begin
  -- The owner is gone: this is a cascade from deleting that person, and
  -- recording it would keep their data after they asked for it to be removed.
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

-- A trigger function is never meant to be called directly. EXECUTE is checked
-- when a trigger is created, not each time it fires (recorded in 65-67), so
-- revoking it changes nothing about the triggers below.
revoke all on function public.record_history_write() from public, anon, authenticated;

create trigger record_history after update or delete on public.expenses
  for each row execute function public.record_history_write();
create trigger record_history after update or delete on public.account_activity
  for each row execute function public.record_history_write();
create trigger record_history after update or delete on public.assets
  for each row execute function public.record_history_write();
create trigger record_history after update or delete on public.liabilities
  for each row execute function public.record_history_write();
create trigger record_history after update or delete on public.accounts
  for each row execute function public.record_history_write();
create trigger record_history after update or delete on public.subscriptions
  for each row execute function public.record_history_write();
create trigger record_history after update or delete on public.income
  for each row execute function public.record_history_write();
create trigger record_history after update or delete on public.holding_sales
  for each row execute function public.record_history_write();
create trigger record_history after update or delete on public.sinking_funds
  for each row execute function public.record_history_write();
create trigger record_history after update or delete on public.budgets
  for each row execute function public.record_history_write();

-- Deleting a person removes the history written while they existed. What the
-- cascade itself deletes is never written (see record_history_write), so the
-- order these run in does not matter.
create or replace function public.record_history_forget()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.record_history where user_id = old.id;
  return old;
end;
$$;

revoke all on function public.record_history_forget() from public, anon, authenticated;

create trigger zz_record_history_forget after delete on auth.users
  for each row execute function public.record_history_forget();

-- The server's daily backup reports here like every other server job.
alter table public.agent_run_status drop constraint agent_run_status_agent_check;
alter table public.agent_run_status add constraint agent_run_status_agent_check
  check (agent = any (array['deal-agent', 'price-agent', 'price-agent-fast', 'daily-recap', 'server-sync', 'backup']));
