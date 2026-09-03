-- A PER-USER WIKI, AND AN ANSWER PATH THAT CANNOT BE WRONG ------------------
--
-- Built to a hard requirement: **every number shown to the user must have
-- been computed in code.** Not "usually right", not "validated afterwards" -
-- no figure reaches the screen unless this app calculated it.
--
-- That requirement came out of a measurement, not a worry. Asked the same
-- question two ways against the same data (2026-09-03): handed 150 raw
-- transactions, the model answered "$807.11" when the true total was
-- $3,362.37 - a confident, specific, four-times-wrong figure, produced by a
-- normal completion rather than a truncation. Handed the total already
-- computed, it answered $3,362.37 exactly, and did it in 4.1s instead of
-- 62.1s. Both halves of that result shape this schema: correctness AND
-- speed come from doing the arithmetic here rather than in the model.
--
-- Three tables' worth of change, one feature:
--
--   wiki_facts    durable, cross-time knowledge about one user
--   qa_cache      short-lived reuse of an identical repeated question
--   expenses.note the user's own explanation of a transaction
--
-- WHY wiki_facts IS NOT spending_insights (06). That table holds one
-- AI-written narrative per calendar month - prose about a finished period.
-- This holds structured facts that only exist ACROSS periods (a
-- subscription's price changing, a month that sits well above the median, a
-- recurring payment) and that would be expensive or impossible to re-derive
-- from a single snapshot. Different lifetime, different shape, different
-- author: these are written by code, never by a model.
--
-- WHY `key` IS UNIQUE PER USER. Derived facts are UPSERTED on recompute, so
-- a nightly refresh replaces "Food averages $X" rather than appending a
-- second copy of it. Without this the wiki would grow a new row every run
-- and quietly become a log instead of a set of current facts.
--
-- HOW "RECOMPUTED" AND "EDITABLE" COEXIST, which sounds contradictory and is
-- the reason for two flags. Recompute owns `figures` and `as_of` always.
-- `body_overridden` means the user rewrote the sentence, so refresh updates
-- the numbers underneath but leaves their wording alone. `dismissed_at`
-- means they removed the fact, and recompute must respect that permanently -
-- without it, deleting a derived fact would be futile, since the next run
-- would put it straight back and the delete button would look broken.
--
-- WHY `figures` IS jsonb, given 49_market_news_findings.sql explicitly said
-- its own jsonb column was "not precedent for using jsonb elsewhere". The
-- test that column set is the right one to apply: figures are always read
-- and written as one cohesive set belonging to a single fact, with no
-- per-figure filtering, status or expiry. A fact's numbers are meaningless
-- apart from the fact. Same reasoning, so the same fit - not a habit.
--
-- `figures` also does real work beyond display: it is the allow-list the
-- Q&A verifies a model's prose against. Any figure in an answer that is not
-- in the facts the model was handed did not come from this user's data, so
-- the answer is rejected rather than shown. That is what makes the accuracy
-- requirement enforceable instead of aspirational.
create table if not exists wiki_facts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- Stable identity for a derived fact, e.g. 'category_avg:Food'. A
  -- user-authored fact gets a generated key so it can never collide with a
  -- derived one and be overwritten by a recompute.
  key             text not null,
  -- 'computed' is refreshed on a schedule; 'user' is never touched by it.
  source          text not null default 'computed' check (source in ('computed', 'user')),
  title           text not null,
  body            text not null,
  figures         jsonb,
  -- The date the underlying numbers describe, shown as "as of" so a fact can
  -- never silently imply it is current when it is not.
  as_of           date,
  body_overridden boolean not null default false,
  dismissed_at    timestamptz,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create unique index if not exists wiki_facts_user_key_idx on wiki_facts (user_id, key);
create index if not exists wiki_facts_user_live_idx on wiki_facts (user_id) where dismissed_at is null;

alter table wiki_facts enable row level security;
drop policy if exists "own wiki facts" on wiki_facts;
create policy "own wiki facts" on wiki_facts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Both roles, explicitly. RLS alone is not sufficient: every table in this
-- schema needs base privileges granted to authenticated AND service_role,
-- and forgetting either has caused two real production outages already
-- (44_fix_missing_grants.sql, 47_fix_missing_service_role_grants.sql).
grant select, insert, update, delete on wiki_facts to authenticated;
grant select, insert, update, delete on wiki_facts to service_role;

comment on table wiki_facts is
  'Durable, per-user knowledge that only exists across time: price changes, recurring patterns, outlier months, and the user''s own explanations. Every figure is computed in code and stored in `figures`; a model never authors a number here. Derived rows are upserted on `key` by a scheduled recompute, which honours `dismissed_at` and leaves `body` alone when `body_overridden` is set.';


-- SHORT-LIVED REUSE OF AN IDENTICAL QUESTION ---------------------------------
--
-- Deliberately the most conservative cache available, chosen over a
-- fingerprint scheme that would have reused an answer until the underlying
-- rows changed. Exact question text, short window, nothing clever.
--
-- The honest expectation, recorded so nobody later mistakes a low hit rate
-- for a bug: this will rarely fire. Someone re-asking a character-identical
-- question within the hour is mostly a retry after a failure. It is kept
-- because it is nearly free and because a retry is exactly when a fast
-- answer matters, not because it will meaningfully change day-to-day speed.
--
-- `question` is stored trimmed and lowercased so a stray capital or trailing
-- space still counts as the same question. That is the only liberty taken
-- with "exact"; the wording itself must match.
--
-- A computed (tier 1) answer is cached alongside a model-written one, but
-- the two are told apart by `answer_kind` so the UI can keep labelling them
-- honestly on a cache hit - a reused answer must never lose the label that
-- says how it was produced.
create table if not exists qa_cache (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  question    text not null,
  answer      text not null,
  answer_kind text not null check (answer_kind in ('computed', 'model')),
  created_at  timestamptz default now(),
  expires_at  timestamptz not null
);

create unique index if not exists qa_cache_user_question_idx on qa_cache (user_id, question);
create index if not exists qa_cache_expiry_idx on qa_cache (expires_at);

alter table qa_cache enable row level security;
drop policy if exists "own qa cache" on qa_cache;
create policy "own qa cache" on qa_cache
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on qa_cache to authenticated;
grant select, insert, update, delete on qa_cache to service_role;

comment on table qa_cache is
  'Reuse of an identical, recently-asked question. Deliberately conservative: exact match on trimmed lowercase text within a short TTL, rather than reusing an answer until the underlying data changes. Expected to hit rarely - kept because it is nearly free and helps most on a retry after a failure.';


-- THE USER'S OWN EXPLANATION -------------------------------------------------
--
-- The one fact in the wiki that is never inferred. This app can detect THAT
-- August was unusual; it cannot know the $2,400 was a car repair rather than
-- a new habit, and guessing would be exactly the confident-but-wrong
-- behaviour the accuracy requirement exists to prevent.
--
-- Nullable and never required. A transaction with no note behaves exactly as
-- it does today, and nothing in the app blocks on one being written.
alter table expenses add column if not exists note text;

comment on column expenses.note is
  'The user''s own explanation of a transaction ("car repair, one-off"), typed by them and never inferred. Feeds wiki_facts so an outlier month can say why it was unusual instead of only that it was.';
