-- record_history is append-only, and 87 granted service_role only SELECT and
-- DELETE (reading it for backups, deleting from it for a deletion request).
-- The table still picked up TRUNCATE, TRIGGER and REFERENCES for service_role
-- from the platform's default privileges, the same default ACL 81 records for
-- the client roles. TRUNCATE in particular would empty the whole history in one
-- statement with no row-level record of having done so, so it goes.
revoke truncate, trigger, references on public.record_history from service_role;
