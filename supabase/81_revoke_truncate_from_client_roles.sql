-- TRUNCATE is not filtered by Row Level Security. Every per-user policy in
-- this schema is `auth.uid() = user_id`, and none of them apply to a
-- TRUNCATE: the statement empties the whole table regardless. Both client
-- roles held it on all 34 public tables, so `authenticated` - the role every
-- signed-in user runs as - carried a privilege that would wipe all four
-- users' expenses, accounts, assets and liabilities in one statement.
--
-- Not reachable through PostgREST today, which exposes no TRUNCATE verb, so
-- this is an over-grant rather than a live hole. It is worth closing anyway:
-- it would become reachable the moment any SECURITY DEFINER function or
-- dynamic-SQL RPC is added, and a destructive privilege that RLS cannot see
-- is the wrong thing to leave lying around in a schema whose whole guarantee
-- is per-user isolation.
--
-- TRIGGER goes with it for the same reason: it lets a role attach code to a
-- table, which is not something a browser client ever needs.
--
-- REFERENCES and MAINTAIN are deliberately LEFT. Neither reads or destroys
-- row data, and keeping the change to the two privileges with real teeth
-- means this cannot surprise anything.
revoke truncate, trigger on all tables in schema public from anon, authenticated;

-- The grant came from a default ACL, not from any migration in this repo -
-- `postgres` grants Dxtm (TRUNCATE, REFERENCES, TRIGGER, MAINTAIN) on every
-- new table in public to anon, authenticated and service_role. Without this
-- second statement the next `create table` silently re-acquires it, which is
-- exactly how all 34 came to have it.
--
-- supabase_admin's own default ACL is left untouched on purpose: it is a
-- platform-managed object this repo does not own, and a table created under
-- it still lands with RLS enabled by Supabase's rls_auto_enable event
-- trigger and no policy, so nothing is readable through it regardless.
alter default privileges for role postgres in schema public
  revoke truncate, trigger on tables from anon, authenticated;
