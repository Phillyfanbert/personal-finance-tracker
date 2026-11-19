#!/usr/bin/env node
// A daily check that every balance still matches the records behind it.
//
// Why it exists: a balance is a stored figure, and before this nothing ever
// compared it against the expenses and history rows that are meant to explain
// it. A balance that moved with no record (a bug, a direct write, a job that
// went wrong) went unnoticed until someone happened to compare it with their
// bank. The reliability audit of 2026-11-18 listed that as a medium-priority
// gap.
//
// The work is done by the database's reconcile_balances() (89), so there is one
// definition of what each record does to a balance and this script only asks
// and reports. It runs with the service-role key, so it sees every person's
// balances.
//
// It looks back WINDOW_DAYS (default 7) so a mismatch stays reported for a
// week, long enough to be seen, and then ages out rather than holding the
// status amber for good. --since looks further back, never earlier than when
// record history began (2026-11-19).
//
// What is reported where: agent_run_status carries COUNTS ONLY ("1 of 6
// balances does not match its records"), because every signed-in user can
// read that table. The details (which balance, by how much) are printed here,
// which is the server's own log, or the terminal when run by hand.
//
//   node reconcile-balances.mjs                 check the last 7 days and report
//   node reconcile-balances.mjs --if-due        only if it has not run today
//   node reconcile-balances.mjs --since 2026-11-19 --no-report
//                                               look further back, print only
//
// Run by the sync job (sync-server.sh) once a day, after the backup.

import { readFileSync, existsSync } from "node:fs";

const ENV_FILE = new URL("./.env.deal-agent", import.meta.url);
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, "$2");
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WINDOW_DAYS = Math.max(1, Number(process.env.RECONCILE_WINDOW_DAYS || 7));
const args = process.argv.slice(2);
const IF_DUE = args.includes("--if-due");
const NO_REPORT = args.includes("--no-report");
const sinceArg = args.includes("--since") ? args[args.indexOf("--since") + 1] : null;
const TOLERANCE = 0.005;

const say = (msg) => console.log(`${new Date().toISOString()} reconcile: ${msg}`);
const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const money = (n) => (n < 0 ? "-$" : "$") + Math.abs(Number(n)).toFixed(2);

async function rest(path, { method = "GET", body, headers = {} } = {}) {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), 30000);
  try {
    return await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method,
      signal: stop.signal,
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } finally {
    clearTimeout(timer);
  }
}

// Best effort, both ways round: a failure to report never fails the check.
async function report(status, detail) {
  if (NO_REPORT) return;
  try {
    const res = await rest("agent_run_status?on_conflict=agent", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: [{ agent: "reconcile", status, detail, queries_attempted: 1, queries_failed: status === "failed" ? 1 : 0, ran_at: new Date().toISOString() }],
    });
    if (!res.ok) say(`status write HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  } catch (err) {
    say(`status write failed: ${err.message}`);
  }
}

// Already checked today, by the server's own calendar. One small read, so the
// every-15-minutes sync job can call this freely.
async function ranToday() {
  const res = await rest("agent_run_status?agent=eq.reconcile&select=ran_at");
  if (!res.ok) return false;
  const [row] = await res.json();
  return !!row?.ran_at && localDate(new Date(row.ran_at)) === localDate();
}

async function main() {
  if (!SUPABASE_URL || !KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }
  if (IF_DUE && (await ranToday())) return;

  let since;
  if (sinceArg) {
    since = new Date(`${sinceArg}T00:00:00`);
    if (Number.isNaN(since.getTime())) {
      console.error(`--since wants a date like 2026-11-19, not "${sinceArg}".`);
      process.exit(2);
    }
  } else {
    since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  }

  const res = await rest("rpc/reconcile_balances", { method: "POST", body: { since: since.toISOString() } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error("the check returned something that is not a list");

  const off = rows.filter((r) => Math.abs(Number(r.difference)) >= TOLERANCE);
  const from = rows.reduce((min, r) => (!min || r.checked_from < min ? r.checked_from : min), null);
  const fromDay = from ? localDate(new Date(from)) : localDate(since);
  for (const r of off) {
    // Ids rather than names: this is a log, and the ids are what a query needs.
    say(`${r.balance_table} ${r.balance_id} (owner ${String(r.owner).slice(0, 8)}) does not match its records since ${r.checked_from}: `
      + `it was ${money(r.opening)}, its records add ${money(r.recorded)}, so it should be ${money(r.expected)}, `
      + `and it is ${money(r.actual)} (${money(r.difference)} unexplained)`);
  }

  const n = rows.length;
  const detail = off.length
    ? `${off.length} of ${n} balance${n === 1 ? "" : "s"} ${off.length === 1 ? "does" : "do"} not match ${off.length === 1 ? "its" : "their"} records since ${fromDay}`
    : `${n} balance${n === 1 ? "" : "s"} checked since ${fromDay}, all match their records`;
  say(detail);
  await report(off.length ? "degraded" : "ok", detail);
  if (off.length && NO_REPORT) process.exitCode = 3;
}

main().catch(async (err) => {
  say(`FAILED: ${err.message}`);
  if (SUPABASE_URL && KEY) await report("failed", `The balance check did not run: ${err.message}`.slice(0, 500));
  process.exit(1);
});
