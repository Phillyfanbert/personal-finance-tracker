// Every date the app stores is the LOCAL calendar day. Reading the UTC date
// instead was a daily bug: from 8pm in New York the app thought it was already
// tomorrow, dated expenses a day ahead and logged bills and pay a day early.
//
// A test run in UTC cannot see this class of bug at all, so each case runs in
// a child process with its own time zone.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const dates = fileURLToPath(new URL("../app/dates.js", import.meta.url));

function inZone(tz, isoInstant) {
  const code = `import { localDateISO, localMonthKey } from ${JSON.stringify(dates)};
    const d = new Date(${JSON.stringify(isoInstant)});
    console.log(JSON.stringify({ day: localDateISO(d), month: localMonthKey(d), utc: d.toISOString().slice(0, 10) }));`;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", code], { env: { ...process.env, TZ: tz } }).toString());
}

test("9pm in New York is still today, though it is tomorrow in UTC", () => {
  const r = inZone("America/New_York", "2026-11-19T02:00:00Z");
  assert.equal(r.utc, "2026-11-19");
  assert.equal(r.day, "2026-11-18");
});

test("the last evening of a month is still that month", () => {
  const r = inZone("America/Los_Angeles", "2026-12-01T05:30:00Z");
  assert.equal(r.month, "2026-11");
});

test("east of UTC, the morning is already today", () => {
  const r = inZone("Asia/Tokyo", "2026-11-18T20:00:00Z");
  assert.equal(r.day, "2026-11-19");
});

test("a leap day and a year end keep their real dates", () => {
  assert.equal(inZone("Australia/Sydney", "2028-02-28T14:00:00Z").day, "2028-02-29");
  assert.equal(inZone("America/New_York", "2027-01-01T04:59:00Z").day, "2026-12-31");
});
