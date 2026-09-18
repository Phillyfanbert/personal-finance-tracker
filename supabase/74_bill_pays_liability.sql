-- A recurring bill that pays down a debt (a mortgage or loan payment set up as
-- a Bill), instead of being booked as spending.
--
-- Until now a bill could only ever reduce the account it was paid from. A
-- mortgage entered as a monthly Bill therefore lowered Checking every month
-- while what was owed never moved, and now that loans accrue interest that
-- meant the debt grew without limit. pays_liability_id says which debt the
-- payment goes to; when it is set the auto-log writes a liability_payment (the
-- same event the Pay button records) rather than a row in expenses.
--
-- Nullable, and null means an ordinary bill, so every existing row behaves
-- exactly as before. on delete set null: deleting the debt turns the bill back
-- into an ordinary one rather than orphaning it or blocking the delete.
--
-- No new grants or policy: subscriptions already carries both, and a new column
-- on an existing table inherits them.
alter table subscriptions
  add column if not exists pays_liability_id uuid references liabilities(id) on delete set null;

comment on column subscriptions.pays_liability_id is
  'When set, this bill pays down that debt (a liability_payment) instead of counting as spending.';
