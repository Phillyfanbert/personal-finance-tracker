-- Feedback and bug reports, sent from inside the app and triaged one by one.
--
-- Before this there was no route at all from a user to whoever maintains the
-- app: a bug found on a phone had to be remembered and mentioned in person.
-- This is that route, and it is deliberately the smallest thing that works -
-- a row the user writes and can read back, a status and a reply only the
-- maintainer can set.
--
-- THE POLICIES ARE SPLIT RATHER THAN THE USUAL "for all", and that is the
-- whole security design of this table. Everywhere else in this schema the
-- policy is `for all using (auth.uid() = user_id)`, because the row belongs
-- to the user in every sense. Here it does not: `status` and `response` are
-- the MAINTAINER's side of the conversation, and a `for all` policy would let
-- anyone mark their own ticket done or write themselves a reply, which makes
-- the triage queue meaningless. So:
--
--   select  - own rows only, so you can read your own history and any reply
--   insert  - own rows only
--   update  - NO POLICY AND NO GRANT. Nobody using the app can change a row.
--   delete  - NO POLICY AND NO GRANT, for the same reason: a ticket already
--             being worked on must not vanish mid-triage. The form says so
--             rather than offering an undo it cannot honour.
--
-- Both are reachable by service_role, which bypasses RLS - that is how the
-- maintainer answers. RLS alone is never sufficient here either; the base
-- grants below are what 44_ and 47_ exist to remind us of.
--
-- NOTHING FINANCIAL IS ATTACHED, and that is a rule rather than an oversight.
-- The only context stored beside the message is which page the user was on
-- and their browser string, both of which the form states plainly before it
-- sends. Balances, accounts and transactions never leave the user's own rows,
-- so a ticket is safe to read and quote without seeing anyone's money. If a
-- figure matters to the report, the user types it in themselves.
create table if not exists feedback_tickets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('problem', 'idea', 'question', 'other')),
  message     text not null check (length(btrim(message)) between 1 and 2000),
  page        text,
  user_agent  text,
  status      text not null default 'new'
                check (status in ('new', 'planned', 'in_progress', 'done', 'declined')),
  response    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- The triage queue reads oldest-first within the open statuses, so the index
-- matches how it is actually queried rather than how it is displayed.
create index if not exists feedback_tickets_status_idx
  on feedback_tickets (status, created_at);
create index if not exists feedback_tickets_user_idx
  on feedback_tickets (user_id, created_at desc);

alter table feedback_tickets enable row level security;

drop policy if exists "read own feedback_tickets" on feedback_tickets;
create policy "read own feedback_tickets" on feedback_tickets
  for select using (auth.uid() = user_id);

drop policy if exists "send own feedback_tickets" on feedback_tickets;
create policy "send own feedback_tickets" on feedback_tickets
  for insert with check (auth.uid() = user_id);

grant select, insert on feedback_tickets to authenticated;
grant select, insert, update, delete on feedback_tickets to service_role;

comment on table feedback_tickets is
  'Feedback and bug reports sent from inside the app. Users insert and read their own; only service_role can set status or write a response. Triage with: select created_at, kind, page, status, message from feedback_tickets where status in (''new'', ''planned'', ''in_progress'') order by created_at;';
comment on column feedback_tickets.status is
  'Maintainer-set. new -> planned | in_progress -> done | declined. Users cannot change it: there is no update policy and no update grant to authenticated.';
comment on column feedback_tickets.response is
  'The maintainer''s reply, shown back to the user beside their own message. Null until one is written.';
comment on column feedback_tickets.user_agent is
  'The reporting browser, so a problem that only happens on one device is traceable. The form states that this is attached before it sends.';
