-- WHY THE RECAP SUMMARY IS MISSING --------------------------------------------
--
-- findRecapSummary() returns null on quota exhaustion, a timeout, a bad
-- HTTP status, unparseable JSON, an empty string, an over-length summary
-- AND a validator rejection - all completely indistinguishable from each
-- other, and it deliberately does not touch queryAttempts/queryFailures so
-- the daily-recap agent keeps reporting status 'ok'.
--
-- That combination is why nobody noticed the summary was absent on 8 of 9
-- production days: the feature was failing almost every day and every
-- signal available said it was healthy. The design intent was right (an
-- optional extra must not turn the card amber); the cost was that the cause
-- was unknowable without SSH access to the server machine's log file.
--
-- This records the reason and nothing else. The status stays 'ok', the card
-- never displays this, and an absent summary remains a fully supported
-- state - the recap is complete without one. It exists so the next person
-- asking "why is there no summary" can answer it with a query instead of a
-- guess.
alter table daily_recaps add column if not exists summary_skipped_reason text;

comment on column daily_recaps.summary_skipped_reason is
  'Why the optional AI summary is absent for this day: quota, timeout, http_error, invalid_json, empty, too_long, rejected:<phrase>, or dry_run. Null when a summary was produced. Diagnostic only - the card never shows this and its status stays ok, since an absent summary is a supported state.';
