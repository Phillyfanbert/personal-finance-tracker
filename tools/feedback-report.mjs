#!/usr/bin/env node
// Consolidates every feedback ticket into ONE private document.
//
//   node tools/feedback-report.mjs          write docs/FEEDBACK.md
//   node tools/feedback-report.mjs --stdout print it instead of writing
//
// WHY A DOCUMENT rather than a screen. The maintainer needs somewhere to read
// what people have sent and decide what to fix next, and the three obvious
// homes were each worse for that: a triage UI inside the app would mean
// inventing an admin role this project does not have, in a repo that is
// public; the Supabase dashboard means leaving the app and reading a table;
// and a terminal command answers one question at a time rather than giving
// you the whole picture. A file reads like a list of things to do, sits in
// the working tree, and is searchable and diffable like everything else here.
//
// WHY IT IS PRIVATE, and how that is actually enforced. docs/FEEDBACK.md
// holds other people's words, so it never goes near the public repo. Three
// separate things keep it out and the first two are mechanical rather than a
// promise: .gitignore stops it being added, .notes-sync.conf's PRIVATE_FILES
// list makes the pre-push hook refuse any push where it is tracked, and the
// same list makes sync-notes.sh mirror it to the private notes repo on every
// commit. Adding a file to that one list is what does all three.
//
// Setup: the same gitignored tools/.env.deal-agent every other script here
// reads (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY). service_role is required
// rather than incidental - feedback_tickets has no policy that lets any
// signed-in user read anyone else's rows, by design, so a normal key would
// return exactly the caller's own tickets and nothing else.
//
// Deliberately NOT scheduled. Every other agent here runs unattended because
// something breaks if it does not; this one is read when you sit down to work
// out what to fix, so it runs when you ask. If it ever wants a launchd job,
// copy a run-*.sh wrapper and keep its PATH export - a bare `node` is not on
// launchd's default PATH, which cost this project days of silent failures.
import { writeFileSync, readFileSync, existsSync } from "node:fs";

const OUT = new URL("../docs/FEEDBACK.md", import.meta.url);
const ENV_FILE = new URL("./.env.deal-agent", import.meta.url);
const TO_STDOUT = process.argv.includes("--stdout");

// Same shape as the other tools: the env file is a plain KEY=value list that
// the run-*.sh wrappers normally source. Read directly so this works when run
// by hand without a wrapper, which is the only way it is ever run.
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

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase GET ${path} -> HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

// Open first, oldest first, because that is the order they should be worked
// through. Answered and declined go underneath, newest first, because those
// are looked at to remember what was said rather than to decide anything.
const OPEN = ["new", "planned", "in_progress"];
const STATUS_LABEL = {
  new: "NEW", planned: "Planned", in_progress: "In progress",
  done: "Done", declined: "Declined",
};
const KIND_LABEL = {
  problem: "Problem", idea: "Idea", question: "Question", other: "Other",
};
const PAGE_LABEL = { log: "Log", plan: "Plan", reports: "Reports", invest: "Investments" };

// A ticket is somebody's own words, so it is reproduced VERBATIM - no dash
// rewriting, no trimming to a summary. This file's whole value is being able
// to read what was actually said. Quoting line by line is what stops a stray
// "#" or list marker in a message restructuring the document around it.
const quote = (text) => String(text ?? "")
  .replace(/\r\n?/g, "\n")
  .split("\n")
  .map((line) => `> ${line}`.trimEnd())
  .join("\n");

// A browser string is four lines of version noise hiding the one part worth
// seeing. Keep the platform and the browser.
//
// ORDER MATTERS AND IS THE WHOLE FUNCTION. Every Chromium user agent ends
// with "Safari/537.36" and Chrome on iOS calls itself CriOS while still
// carrying both "Chrome" and "Safari", so matching loosely - or taking the
// last match - labels a Chrome or Android report as Safari and sends you
// debugging the wrong browser. Most specific first, first hit wins.
const AGENT_PATTERNS = [
  [/\bEdgA?\/([\d.]+)/, "Edge"],
  [/\bOPR\/([\d.]+)/, "Opera"],
  [/\bCriOS\/([\d.]+)/, "Chrome iOS"],
  [/\bFxiOS\/([\d.]+)/, "Firefox iOS"],
  [/\bFirefox\/([\d.]+)/, "Firefox"],
  [/\bChrome\/([\d.]+)/, "Chrome"],
  // Only reached once every Chromium marker above has missed, which is what
  // makes it actually mean Safari. Version/ is the real Safari release;
  // Safari/605 or /604 is a build number that says nothing.
  [/\bVersion\/([\d.]+).*\bSafari\//, "Safari"],
  [/\bSafari\/([\d.]+)/, "Safari"],
];

function shortAgent(ua) {
  if (!ua) return null;
  const platform = ((ua.match(/\(([^)]*)\)/) || [])[1] || "").split(";")[0].trim();
  let browser = "";
  for (const [re, name] of AGENT_PATTERNS) {
    const m = ua.match(re);
    if (m) { browser = `${name} ${m[1].split(".")[0]}`; break; }
  }
  const short = [platform, browser].filter(Boolean).join(" ");
  return short || ua.slice(0, 60);
}

const when = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
};

function ticketBlock(t, names) {
  const who = names.get(t.user_id) || `user ${String(t.user_id).slice(0, 8)}`;
  const bits = [when(t.created_at), who];
  if (t.page) bits.push(PAGE_LABEL[t.page] || t.page);
  const agent = shortAgent(t.user_agent);
  if (agent) bits.push(agent);

  const lines = [
    `### ${STATUS_LABEL[t.status] || t.status} - ${KIND_LABEL[t.kind] || t.kind}`,
    "",
    `*${bits.join(" | ")}*`,
    "",
    quote(t.message),
    "",
  ];
  if (t.response) {
    lines.push(`**Replied:** ${t.response}`, "");
  }
  // The id is here so reading and answering are one step rather than two.
  // Only service_role can run this: there is no update grant for a signed-in
  // user, which is what stops anyone marking their own ticket done.
  lines.push("```sql");
  lines.push("-- status: new | planned | in_progress | done | declined");
  lines.push("-- response is what they see back in the app; leave it out to say nothing.");
  lines.push(`update feedback_tickets`);
  lines.push(`   set status = 'done', response = '', updated_at = now()`);
  lines.push(` where id = '${t.id}';`);
  lines.push("```");
  return lines.join("\n");
}

async function main() {
  // Fetched before anything is written. A failed read must never produce a
  // document that says there is no feedback - that is the same
  // failure-looks-like-emptiness trap renderLoadError() exists for in the app,
  // and a file outlives the error message that would have explained it.
  const tickets = await sbGet("feedback_tickets?select=*&order=created_at.asc");
  const profiles = await sbGet("profiles?select=id,display_name");
  const names = new Map(profiles.filter((p) => p.display_name).map((p) => [p.id, p.display_name]));

  const open = tickets.filter((t) => OPEN.includes(t.status));
  const closed = tickets.filter((t) => !OPEN.includes(t.status)).reverse();
  const counts = {};
  for (const t of tickets) counts[t.status] = (counts[t.status] || 0) + 1;

  const summary = Object.keys(STATUS_LABEL)
    .filter((k) => counts[k])
    .map((k) => `${counts[k]} ${STATUS_LABEL[k].toLowerCase()}`)
    .join(", ") || "nothing yet";

  const out = [
    "# Feedback",
    "",
    "Everything people have sent from inside the app. Open tickets come first,",
    "oldest at the top, so the one that has been waiting longest is the one you",
    "read first.",
    "",
    `Generated ${when(new Date().toISOString())} by \`node tools/feedback-report.mjs\`.`,
    "Re-run it to refresh; nothing updates this on its own.",
    "",
    `**${tickets.length} total** - ${summary}.`,
    "",
    "Messages are reproduced exactly as they were typed. This file is private:",
    "it is gitignored here and mirrored only to the notes repo.",
    "",
    "---",
    "",
    "## Waiting on you",
    "",
    open.length
      ? open.map((t) => ticketBlock(t, names)).join("\n\n")
      : "Nothing open.",
    "",
    "---",
    "",
    "## Answered and closed",
    "",
    closed.length
      ? closed.map((t) => ticketBlock(t, names)).join("\n\n")
      : "Nothing closed yet.",
    "",
  ].join("\n");

  if (TO_STDOUT) { process.stdout.write(out); return; }
  writeFileSync(OUT, out);
  console.log(`Wrote docs/FEEDBACK.md - ${tickets.length} ticket(s), ${open.length} waiting on you.`);
}

main().catch((err) => {
  // Loud, and nothing written. A stale document is better than one that
  // quietly states there is no feedback because a fetch failed.
  console.error(`Could not build the feedback report: ${err.message}`);
  console.error("docs/FEEDBACK.md was left exactly as it was.");
  process.exit(1);
});
