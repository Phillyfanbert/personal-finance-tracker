-- Close the INSERT-side hole in 77's split-policy design.
--
-- 77 removed the update and delete grants so a user could not mark their own
-- ticket done or write themselves a reply, and that half works: both attempts
-- fail with 42501. The insert path was left open, and an insert can set every
-- column. Found by testing rather than reading: a plain authenticated insert
-- carrying status 'declined' and a response was ACCEPTED, which lands the
-- ticket straight in the answered pile with a reply nobody wrote. That is the
-- exact outcome 77's header says the split exists to prevent, so the
-- documentation was true of updates and false of inserts.
--
-- The app never sends either column - it posts kind, message, page and
-- user_agent only, and the column defaults supply 'new' and null - so this
-- constrains nothing the app does. It only closes the direct-POST route,
-- which is reachable because the publishable key ships client-side by design.
--
-- Deliberately NOT constraining created_at. Forging it would let someone move
-- their own ticket up an oldest-first queue, which is a different and much
-- smaller thing than inventing a maintainer's reply, and pinning it would
-- break any future backfill that legitimately carries a real date.
drop policy if exists "send own feedback_tickets" on feedback_tickets;
create policy "send own feedback_tickets" on feedback_tickets
  for insert with check (
    auth.uid() = user_id
    and status = 'new'
    and response is null
  );

comment on policy "send own feedback_tickets" on feedback_tickets is
  'Own rows only, and always as a NEW ticket with no reply. status and response belong to the maintainer, who reaches them through service_role; without the status/response terms an insert could set both and skip the queue.';
