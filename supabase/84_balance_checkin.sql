-- The monthly balance check-in needs to remember when it was last done.
--
-- Measured before building it: across four accounts the app held 2 logged
-- expenses and 6 manual balance corrections. People here keep the BALANCES
-- true and do not log the purchases, so the check-in makes that the guided,
-- once-a-month path instead of five separate taps into five panels.
--
-- On profiles rather than per device, because the question is "has this
-- person checked", not "has this phone". An installed home-screen icon and
-- Safari are separate storage containers on iOS, so a per-device flag would
-- ask again in whichever one it was not done in.
--
-- A date, not a timestamp: the app treats a check-in as something that
-- happened on a local calendar day, the same convention every other date it
-- stores follows (app/dates.js).
--
-- Null means never. Saving the check-in with nothing changed still sets it,
-- which is the whole reason this column exists rather than reading the
-- newest updated_at off the balances themselves: "I looked and it is all
-- still right" touches no balance and would otherwise leave no trace.
--
-- No new grant and no new policy. profiles already grants update to
-- authenticated under `auth.uid() = id`.

alter table public.profiles add column if not exists balances_checked_at date;

comment on column public.profiles.balances_checked_at is
  'The day this person last went through the monthly balance check-in. Null means never. Set by the app when the check-in is saved, including when nothing needed changing.';
