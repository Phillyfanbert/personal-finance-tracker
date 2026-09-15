-- Needs / wants / savings tagging for budgets, which is what the
-- percentage-of-income frameworks in docs/budgeting-methodologies.md (50/30/20
-- and its 60/30/10 and 70/20/10 variants, the 60% Solution) all actually
-- require. It was deliberately deferred until a feature actually needed the
-- split rather than built speculatively, and the shape was settled first: a
-- flag the user sets once per category, never inferred from the category name.
--
-- Three values rather than a boolean, because a boolean cannot express the
-- third bucket every one of those frameworks has.
-- `subscriptions.is_essential` is still the precedent for the SHAPE: a tag the
-- user sets, never one the app infers.
--
-- NULLABLE on purpose, and untagged is a real state rather than a missing one.
-- "Shopping" and "Other" are genuinely either depending on what was bought, so
-- an untagged budget is counted into no bucket and is reported separately -
-- the same omit-rather-than-assert rule the rest of this app holds. Defaulting
-- it to 'need' would silently put every existing budget in a bucket its owner
-- never chose, and the split would then be a number about this app's guesses
-- rather than about the user's own money.
--
-- Per BUDGET rather than per expense: budgets are already unique per category,
-- so this is one tag per category, which is where the frameworks put it.
-- Tagging individual expenses would be a different, much heavier feature and
-- section 2.4 explicitly left it optional.
alter table budgets
  add column if not exists classification text
  check (classification is null or classification in ('need', 'want', 'savings'));

comment on column budgets.classification is
  'need | want | savings, set by the user. NULL means untagged, which is a real answer and is counted into no bucket.';
