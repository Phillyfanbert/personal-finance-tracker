#!/usr/bin/env node
// Review the subscription deals the agent found. Maintainer tool.
//
//   node tools/deal-review.mjs                 list what is waiting
//   node tools/deal-review.mjs --promote <id>  add it to the trusted catalog
//   node tools/deal-review.mjs --reject <id>   hide it from everyone
//
// WHY THIS IS NOT IN THE APP ANY MORE. Promote and Reject used to be two
// buttons on the Savings found card, backed by policies that read
// `auth.role() = 'authenticated'`. deal_findings has no user_id - it holds
// public subscription pricing that belongs to nobody - so that was the only
// check available, and it means "any signed-in user". deal_findings' SELECT
// policy filters `status <> 'rejected'`, so one person pressing Reject
// removed a finding from everybody else's card, and any user could insert
// into the trusted catalog that every user's deal matching reads.
//
// Per-user review state was the alternative and is worse: a finding is
// genuinely shared, so it would mean four people each re-reviewing the same
// Spotify price. Reviewing is a maintainer job.
// 82_deal_review_is_maintainer_only.sql revoked the two grants, so the old
// client writes now fail with 42501 rather than silently touching no rows.
//
// Setup: the same gitignored tools/.env.deal-agent every other script here
// reads (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY). service_role is required
// rather than incidental - it is the only thing that can still write these
// two tables, which is the entire point of the change above.
//
// Deliberately NOT scheduled, same as tools/feedback-report.mjs: this is read
// and acted on when you sit down to it, not unattended.
import { readFileSync, existsSync } from "node:fs";

const ENV_FILE = new URL("./.env.deal-agent", import.meta.url);

// Same shape as the other tools: a plain KEY=value list the run-*.sh wrappers
// normally source. Read directly so this works run by hand, which is the only
// way it is ever run.
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, "$2");
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  console.error(`Expected them in ${ENV_FILE.pathname} or the environment.`);
  process.exit(1);
}

const HEADERS = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` };

async function sb(method, path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      ...HEADERS,
      ...(body ? { "Content-Type": "application/json" } : {}),
      Prefer: "return=representation",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`Supabase ${method} ${path} -> HTTP ${res.status}: ${await res.text()}`);
  return res.status === 204 ? [] : res.json();
}

const money = (n, currency) =>
  n == null ? "no price" : `${currency && currency !== "USD" ? currency + " " : "$"}${Number(n).toFixed(2)}`;

// One line of the page the price was read off. Only regex-extracted findings
// carry a raw_snippet; a Gemini-extracted one stores null, so an absent quote
// means "no quote was captured", never "the page said nothing".
const snippet = (text) => {
  const clean = String(text ?? "").replace(/[#*]+/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > 160 ? clean.slice(0, 160).replace(/\s+\S*$/, "") + "..." : clean;
};

async function list() {
  // Unexpired candidates only: that is exactly the set the app is showing
  // people right now, so it is the set worth deciding about. Oldest first,
  // because that is the order to work through them.
  const now = new Date().toISOString();
  const rows = await sb("GET",
    `deal_findings?status=eq.candidate&expires_at=gt.${now}` +
    `&select=id,service,plan_type,price,currency,eligibility,url,extracted_by,confidence,raw_snippet,found_at` +
    `&order=found_at.asc`);
  if (!rows.length) {
    console.log("Nothing waiting. No unexpired findings with status 'candidate'.");
    return;
  }
  console.log(`${rows.length} finding${rows.length === 1 ? "" : "s"} waiting:\n`);
  for (const r of rows) {
    console.log(`${r.service}${r.plan_type ? ", " + r.plan_type : ""}  ${money(r.price, r.currency)}`);
    console.log(`  id         ${r.id}`);
    console.log(`  found      ${String(r.found_at).slice(0, 10)} by ${r.extracted_by || "unknown"}` +
                `${r.confidence != null ? `, confidence ${r.confidence}` : ""}`);
    if (r.eligibility) console.log(`  who for    ${r.eligibility}`);
    if (r.url) console.log(`  source     ${r.url}`);
    const quote = snippet(r.raw_snippet);
    // The quote is the only grounding there is for an unverified number, so
    // it is worth seeing before promoting one into the trusted catalog.
    if (quote) console.log(`  page said  "${quote}"`);
    console.log("");
  }
  console.log("Promote one with:  node tools/deal-review.mjs --promote <id>");
  console.log("Reject one with:   node tools/deal-review.mjs --reject <id>");
}

async function promote(id) {
  const [finding] = await sb("GET", `deal_findings?id=eq.${id}&select=*`);
  if (!finding) throw new Error(`No finding with id ${id}.`);
  if (finding.status !== "candidate") {
    throw new Error(`That finding is already '${finding.status}', so there is nothing to promote.`);
  }

  const [added] = await sb("POST", "subscription_catalog", {
    service: finding.service,
    plan_type: finding.plan_type,
    price: finding.price,
    eligibility: finding.eligibility,
    url: finding.url,
    notes: "Promoted from a live finding",
  });

  // Two tables, so a partial failure is possible and the direction it errs in
  // matters: a catalog row with the finding still 'candidate' would be
  // offered for promotion again and added twice. The client version this
  // replaces just reported the error and left the orphan behind; put it back
  // instead, the same compensating write payBillTowardDebt() does.
  try {
    await sb("PATCH", `deal_findings?id=eq.${id}`, { status: "verified" });
  } catch (err) {
    if (added?.id) {
      await sb("DELETE", `subscription_catalog?id=eq.${added.id}`).catch(() => {});
      throw new Error(`Could not mark the finding verified, so the catalog row was removed again. Nothing changed. ${err.message}`);
    }
    throw err;
  }
  console.log(`Promoted ${finding.service}${finding.plan_type ? ", " + finding.plan_type : ""} at ${money(finding.price, finding.currency)}.`);
  console.log("It is a normal catalog deal now, so every user sees it as trusted.");
}

async function reject(id) {
  const [finding] = await sb("GET", `deal_findings?id=eq.${id}&select=id,service,status`);
  if (!finding) throw new Error(`No finding with id ${id}.`);
  if (finding.status === "rejected") {
    console.log(`${finding.service} was already rejected. Nothing to do.`);
    return;
  }
  await sb("PATCH", `deal_findings?id=eq.${id}`, { status: "rejected" });
  console.log(`Rejected ${finding.service}. It stops appearing for everyone, since the read policy filters rejected rows.`);
}

const args = process.argv.slice(2);
const flagValue = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};

try {
  const toPromote = flagValue("--promote");
  const toReject = flagValue("--reject");
  if (toPromote && toReject) throw new Error("Pass one of --promote or --reject, not both.");
  if (args.includes("--promote") && !toPromote) throw new Error("--promote needs a finding id.");
  if (args.includes("--reject") && !toReject) throw new Error("--reject needs a finding id.");
  if (toPromote) await promote(toPromote);
  else if (toReject) await reject(toReject);
  else await list();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
