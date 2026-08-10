-- Quarterly / semiannual billing cycles (docs/ROADMAP.md Subscriptions/
-- Bills #2) - insurance premiums commonly don't fit monthly/annual/other,
-- per docs/subscription-bill-types-research.md section 16's own research
-- on real-world billing cadences.
alter table subscriptions drop constraint if exists subscriptions_billing_cycle_check;
alter table subscriptions add constraint subscriptions_billing_cycle_check
  check (billing_cycle in ('monthly','quarterly','semiannual','annual','other'));
