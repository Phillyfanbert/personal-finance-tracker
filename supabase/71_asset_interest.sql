-- Interest on deposit accounts, so a savings balance grows the way it really
-- does instead of drifting quietly downward against the real bank balance.
--
-- interest_rate is the annual rate the BANK states, as a percentage: 4.25
-- means 4.25%. Nullable, and null means "not stated" rather than zero - the
-- app never guesses a rate, the same way a null credit_limit means the limit
-- is unknown rather than $0. A rate of 0 is refused at save for that same
-- reason: it would store a number that does nothing.
--
-- interest_last_paid is the date interest was last credited. It is SEEDED to
-- the day a rate is first set, never left null and back-filled: this app has
-- no record of what the balance was in past months, so paying backwards would
-- invent interest on balances it never knew. Null therefore means "no rate has
-- ever been set here", and the first run seeds it rather than paying anything.
--
-- No new grants or policy: assets already carries both, and adding a column to
-- an existing table inherits them.
alter table assets
  add column if not exists interest_rate numeric(5,2)
    check (interest_rate is null or (interest_rate >= 0 and interest_rate <= 100)),
  add column if not exists interest_last_paid date;

comment on column assets.interest_rate is
  'Annual rate the bank states, as a percent. Null means not stated; the app never guesses one.';
comment on column assets.interest_last_paid is
  'Date interest was last credited. Seeded when a rate is first set, so interest is never back-paid.';
