-- A fifth agent_run_status row: the job that keeps the server machine's
-- copy of tools/ level with this repository (tools/sync-server.sh).
--
-- The server ran code from August until 2026-10-15 and nothing anywhere said
-- so. It was a hand-copied directory with no git checkout, the market-hours
-- gate and two other features that had been "shipped" for weeks were simply
-- not there, and finding out took an SSH session. agent_run_status exists
-- for exactly that class of problem - a background job whose failure is
-- invisible without shell access - so the sync reports here too.
--
-- status / detail carry what the row means:
--   ok        detail is the short commit the server is running.
--   failed    a newer commit was fetched and REFUSED (a file failed its
--             syntax check), so the server is deliberately still on the last
--             good one. detail names the commit and the file.
--   degraded  the repository could not be reached; the server keeps running
--             what it has.
-- ran_at is the last time the job ran at all, so a row that stops moving is
-- itself the signal that the job has died.
--
-- To see whether the server is behind, from anywhere with database access:
--   select status, detail, now() - ran_at as age
--   from agent_run_status where agent = 'server-sync';
-- and compare detail with `git rev-parse --short origin/main`.
--
-- Same shape as 52 and 55, which each widened this constraint for a new job.

alter table public.agent_run_status drop constraint if exists agent_run_status_agent_check;
alter table public.agent_run_status add constraint agent_run_status_agent_check
  check (agent in ('deal-agent', 'price-agent', 'price-agent-fast', 'daily-recap', 'server-sync'));
