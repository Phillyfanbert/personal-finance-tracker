-- Interest on loans, so what is owed grows the way it really does instead of
-- staying flat while payments shrink it by their full amount.
--
-- interest_rate already exists on liabilities (07). What was missing is any
-- record of how far interest has been ADDED, so a monthly accrual could never
-- know which months it had already covered.
--
-- interest_last_accrued is the date interest was last added to the balance. It
-- is seeded to the day a rate is first seen, never left null and back-filled:
-- this app holds no record of what was owed in past months, so paying
-- backwards would invent interest on balances it never knew. Null therefore
-- means "no accrual has started", and the first run seeds it instead of
-- charging anything.
--
-- Cards are excluded in code rather than here: a card issuer computes interest
-- on an average daily balance through a grace period the app can only guess at,
-- so those stay a user-confirmed charge.
--
-- No new grants or policy: liabilities already carries both, and a new column
-- on an existing table inherits them.
alter table liabilities
  add column if not exists interest_last_accrued date;

comment on column liabilities.interest_last_accrued is
  'Date interest was last added to the balance. Seeded when accrual starts, so interest is never back-charged.';
