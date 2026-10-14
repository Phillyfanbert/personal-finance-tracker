-- Promote and Reject become maintainer actions, run through service_role,
-- the same shape feedback_tickets already has.
--
-- The problem these policies had is that neither carried an ownership test.
-- `deal_findings` has no user_id at all - it holds public subscription
-- pricing with no owner - so `auth.role() = 'authenticated'` was the only
-- check available, and it means "any signed-in user". With four real users
-- that is shared mutable state: deal_findings' SELECT policy filters
-- `status <> 'rejected'`, so one person pressing Reject removed a finding
-- from everybody else's Savings found card, and any user could insert a row
-- into the trusted catalog every other user's deal matching reads.
--
-- Scoping it per user was the alternative and is the wrong fix: a finding is
-- genuinely shared public data, so per-user review state would mean four
-- people each re-reviewing the same Spotify price. Review is a maintainer
-- job, and this project already has exactly one place that pattern lives.
drop policy if exists "review deal_findings" on public.deal_findings;
drop policy if exists "promote to catalog" on public.subscription_catalog;

-- The GRANT is what actually seals it, which is the lesson
-- 78_feedback_insert_status_guard.sql already recorded: with RLS on and no
-- matching policy an UPDATE merely affects zero rows, silently, and reads to
-- the caller like it worked. Revoked, it fails loudly with 42501 instead.
revoke update on public.deal_findings from authenticated;
revoke insert on public.subscription_catalog from authenticated;

-- Reading is unchanged on both. Every user still sees the findings (minus
-- rejected ones) and the trusted catalog, which is the whole point of the
-- Savings found card; they just cannot change what everyone else sees.
-- service_role bypasses RLS by design and keeps full access, which is how
-- tools/deal-review.mjs promotes and rejects.
