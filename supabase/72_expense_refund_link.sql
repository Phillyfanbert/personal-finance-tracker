-- Links a refund row to the purchase it reverses.
--
-- Without it the refund cap could only ever be per-attempt: each attempt
-- recomputed the ceiling from the original purchase and nothing recorded that
-- a refund had already happened, so one $42 purchase could be refunded twice
-- for $84 and the difference was money invented out of nothing. With the link
-- the cap is exact (sum what has already come back, allow only the remainder)
-- and a refund row is identifiable, so it cannot itself be refunded.
--
-- ON DELETE SET NULL rather than CASCADE: deleting the original purchase must
-- not silently take the refund's own money movement with it. The refund row
-- survives as an ordinary negative expense, which is what it always was.
--
-- No new grants or policy: expenses already carries both, and adding a column
-- to an existing table inherits them.
alter table expenses
  add column if not exists refund_of uuid references expenses(id) on delete set null;

create index if not exists expenses_refund_of_idx on expenses(refund_of) where refund_of is not null;

comment on column expenses.refund_of is
  'The purchase this row gives money back on. Null for ordinary spending.';
