#!/usr/bin/env node
// A daily copy of the whole database, kept on the home server.
//
// Why it exists: the Supabase project is on the free plan, and the only copy of
// anyone's books outside Supabase was whatever a person happened to download
// from Profile. A reliability audit on 2026-11-18 listed that as a
// high-priority gap. This writes one compressed file a day and keeps two
// months of them, so a mistake, a bad deploy or the project itself going away
// is recoverable from a copy this household controls.
//
// What is in a file: every table in the public schema, every row, read with the
// service-role key (which sees every person's rows; row-level security does not
// apply to it). Left out, because each is rebuilt from the rest or is a short
// stream that is thrown away within two days anyway: asset_price_findings,
// market_index_findings, market_news_findings, expense_embeddings, qa_cache.
// Sign-in accounts live in Supabase Auth, not here, so a restore needs those to
// exist (or be recreated with the same ids) before rows can be put back.
//
// It contains every person's financial records in readable form, so the folder
// is created readable by its owner only (700) and every file 600, the same as
// the env file holding the key that reads it.
//
// Run by the sync job (sync-server.sh), which already runs every 15 minutes on
// the server with this key: `--if-due` makes it do nothing when today's file
// already exists, so it runs once a day without a launchd job of its own.
// Reports to agent_run_status as "backup", so whether it is working is a query
// rather than an SSH session.
//
//   node backup-database.mjs             write today's backup now
//   node backup-database.mjs --if-due    only if today's does not exist yet
//
// Settings: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.deal-agent
// (beside this file) or the environment; BACKUP_DIR (default
// ~/personal-finance-backups); BACKUP_KEEP (default 60 files).
//
// Restoring is deliberately by hand: it means writing into a live database
// that holds real money, which should never be one command. Each file is
// { format, created_at, source, tables: { name: { primary_key, count, rows } } }
// and every row is exactly as PostgREST returned it.

import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync, readdirSync, unlinkSync, chmodSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { homedir } from "node:os";
import { join } from "node:path";

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
const BACKUP_DIR = process.env.BACKUP_DIR || join(homedir(), "personal-finance-backups");
const KEEP = Math.max(1, Number(process.env.BACKUP_KEEP || 60));
const IF_DUE = process.argv.includes("--if-due");
const PAGE = 1000;
const SKIP = new Set(["asset_price_findings", "market_index_findings", "market_news_findings", "expense_embeddings", "qa_cache"]);
const NAME = /^finance-backup-(\d{4}-\d{2}-\d{2})\.json\.gz$/;

// Used only if the server will not describe its own tables. Every table as of
// 88_record_history_service_role_grants.sql, with its primary key, so a page
// boundary can never repeat or skip a row. A table added later and missing
// here is caught by the description, which is the normal path.
const KNOWN_TABLES = {
  account_activity: ["id"], accounts: ["id"], agent_run_status: ["agent"], assets: ["id"],
  budget_periods: ["id"], budgets: ["id"], category_rules: ["id"], daily_prices: ["symbol", "trade_date"],
  daily_recaps: ["trade_date"], deal_findings: ["id"], expenses: ["id"], feedback_tickets: ["id"],
  holding_sales: ["id"], income: ["id"], investment_targets: ["id"], liabilities: ["id"],
  market_mover_summaries: ["trade_date"], market_movers: ["trade_date", "category", "symbol"],
  net_worth_snapshots: ["id"], portfolio_recaps: ["id"], portfolio_snapshots: ["id"], profiles: ["id"],
  record_history: ["id"], service_domains: ["service"], sinking_funds: ["id"], spending_insights: ["id"],
  subscription_catalog: ["id"], subscriptions: ["id"], symbol_fundamentals: ["symbol"], watchlist_symbols: ["id"],
};

const say = (msg) => console.log(`${new Date().toISOString()} backup: ${msg}`);
const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

async function rest(path, headers = {}) {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), 30000);
  try {
    return await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      signal: stop.signal,
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, ...headers },
    });
  } finally {
    clearTimeout(timer);
  }
}

// Best effort: a failure to report must never fail the backup, or the other
// way round.
async function report(status, detail) {
  try {
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), 15000);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/agent_run_status?on_conflict=agent`, {
      method: "POST",
      signal: stop.signal,
      headers: {
        apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify([{ agent: "backup", status, detail, queries_attempted: 1, queries_failed: status === "ok" ? 0 : 1, ran_at: new Date().toISOString() }]),
    });
    clearTimeout(timer);
    if (!res.ok) say(`status write HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  } catch (err) {
    say(`status write failed: ${err.message}`);
  }
}

// The server describes its own tables, primary keys included, in its OpenAPI
// document. That is what makes a table added next month part of the backup
// without anyone remembering to list it here.
async function listTables() {
  try {
    const res = await rest("", { Accept: "application/openapi+json" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const spec = await res.json();
    const tables = Object.entries(spec.definitions || {}).map(([name, def]) => ({
      name,
      pk: Object.entries(def.properties || {})
        .filter(([, prop]) => /<pk\/>/.test(prop.description || ""))
        .map(([col]) => col),
    })).filter((t) => !SKIP.has(t.name));
    if (!tables.length) throw new Error("it listed no tables");
    return { tables, described: true };
  } catch (err) {
    say(`could not read the table list (${err.message}), using the built-in one`);
    return {
      tables: Object.entries(KNOWN_TABLES).map(([name, pk]) => ({ name, pk })).filter((t) => !SKIP.has(t.name)),
      described: false,
    };
  }
}

// Every row of one table, in pages ordered on its primary key, checked against
// the count the server reports so a short read fails instead of passing.
async function readTable({ name, pk }) {
  const order = (pk.length ? pk : ["id"]).map((c) => `${c}.asc`).join(",");
  const rows = [];
  let total = null;
  for (let from = 0; ; from += PAGE) {
    const res = await rest(`${encodeURIComponent(name)}?select=*&order=${order}`, {
      "Range-Unit": "items", Range: `${from}-${from + PAGE - 1}`, Prefer: "count=exact",
    });
    if (!res.ok && res.status !== 206) throw new Error(`${name}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const range = res.headers.get("content-range") || "";
    const m = range.match(/\/(\d+)$/);
    if (m) total = Number(m[1]);
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  if (total != null && rows.length !== total) throw new Error(`${name}: read ${rows.length} rows, the server holds ${total}`);
  return { primary_key: pk, count: rows.length, rows };
}

async function main() {
  if (!SUPABASE_URL || !KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }
  const today = localDate();
  const target = join(BACKUP_DIR, `finance-backup-${today}.json.gz`);
  if (IF_DUE && existsSync(target)) return;

  mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
  chmodSync(BACKUP_DIR, 0o700);

  const { tables, described } = await listTables();
  const out = { format: 1, created_at: new Date().toISOString(), source: new URL(SUPABASE_URL).host, tables: {} };
  for (const t of tables) out.tables[t.name] = await readTable(t);

  // Written beside the target and renamed into place, so a run that dies half
  // way leaves no file that looks like a finished backup.
  const tmp = `${target}.tmp-${process.pid}`;
  const body = gzipSync(Buffer.from(JSON.stringify(out)));
  writeFileSync(tmp, body, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, target);

  // Read back and parsed, so a file that cannot be opened is a failure now,
  // not a discovery on the day it is needed.
  const check = JSON.parse(gunzipSync(readFileSync(target)).toString("utf8"));
  for (const [name, t] of Object.entries(out.tables)) {
    if (check.tables?.[name]?.rows?.length !== t.count) throw new Error(`the saved file reads back short on ${name}`);
  }

  // Older ones are only removed once today's is safely written.
  const files = readdirSync(BACKUP_DIR).filter((f) => NAME.test(f)).sort();
  for (const old of files.slice(0, Math.max(0, files.length - KEEP))) unlinkSync(join(BACKUP_DIR, old));

  const rowCount = Object.values(out.tables).reduce((n, t) => n + t.count, 0);
  const kb = Math.round(body.length / 1024);
  const kept = Math.min(files.length, KEEP);
  const detail = `${tables.length} tables, ${rowCount} rows, ${kb} KB, ${kept} kept${described ? "" : ", table list was the built-in one"}`;
  say(`wrote ${target}: ${detail}`);
  await report(described ? "ok" : "degraded", detail);
}

main().catch(async (err) => {
  say(`FAILED: ${err.message}`);
  if (SUPABASE_URL && KEY) await report("failed", `No backup today: ${err.message}`.slice(0, 500));
  process.exit(1);
});
