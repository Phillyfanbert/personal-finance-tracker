// The balance check (reconcile_balances in 89, run daily by
// tools/reconcile-balances.mjs), from the two sides a Node test can reach.
//
// The SQL itself is tested in the database by supabase/tests/money_test.sql.
// What is tested here is what would let it quietly stop being right: a kind
// of history row it was never taught, a rule in the database that no longer
// matches the app's, and the daily job reporting the wrong thing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { APP, read, slice } from "./source.mjs";

const migrations = readdirSync(new URL("../supabase/", import.meta.url))
  .filter((f) => /^\d+_.*\.sql$/.test(f)).sort((a, b) => parseInt(a) - parseInt(b))
  .map((f) => ({ name: f, sql: read(`supabase/${f}`) }));

// The latest migration that contains `marker`, so a later redefinition wins.
const latest = (marker) => {
  const hit = [...migrations].reverse().find((m) => m.sql.includes(marker));
  if (!hit) throw new Error(`no migration contains ${marker}`);
  return hit.sql;
};

const quoted = (text) => new Set([...text.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));

test("every kind of history row that moves money is taught to the balance check", () => {
  const kindCheck = latest("account_activity_kind_check");
  const kinds = quoted(kindCheck.slice(kindCheck.lastIndexOf("account_activity_kind_check")).split(";")[0]);
  assert.ok(kinds.has("transfer") && kinds.size >= 8, `read ${[...kinds]} as the kinds`);
  const effects = latest("function public.money_effects");
  const body = effects.slice(effects.indexOf("function public.money_effects"), effects.indexOf("$$;", effects.indexOf("function public.money_effects")));
  for (const kind of kinds) {
    if (kind === "account_created") continue;
    assert.ok(body.includes(`'${kind}'`), `money_effects() has no rule for "${kind}", so the balance check would call every one of them unexplained`);
  }
});

test("every kind the app can undo is one the balance check knows", () => {
  const undo = slice(APP, "async function undoActivity(row)", "// The one refusal an undo meets");
  const undoKinds = new Set([...undo.matchAll(/row\.kind === "([a-z_]+)"/g)].map((m) => m[1]));
  const effects = latest("function public.money_effects");
  for (const kind of undoKinds) assert.ok(effects.includes(`'${kind}'`), `undoActivity reverses "${kind}" but money_effects() does not know it`);
});

test("the database's overdraft rule names the same account types as the app", () => {
  const app = slice(APP, "const OVERDRAFT_ELIGIBLE_ASSET_TYPES = new Set([", "]);");
  const appTypes = new Set([...app.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
  const floor = latest("assets_value_floor");
  const rule = floor.slice(floor.indexOf("assets_value_floor"), floor.indexOf("drop constraint", floor.indexOf("assets_value_floor")));
  assert.deepEqual([...quoted(rule)].sort(), [...appTypes].sort());
});

// ---- the daily job, against a stand-in server ------------------------------

function fakeServer({ rows, rpcStatus = 200, ranAt = null }) {
  const seen = { rpc: 0, reports: [] };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const send = (status, obj) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
      if (req.url.startsWith("/rest/v1/rpc/reconcile_balances")) {
        seen.rpc++;
        seen.since = JSON.parse(body).since;
        return rpcStatus === 200 ? send(200, rows) : send(rpcStatus, { message: "stand-in failure" });
      }
      if (req.method === "GET" && req.url.startsWith("/rest/v1/agent_run_status")) return send(200, ranAt ? [{ ran_at: ranAt }] : []);
      if (req.method === "POST" && req.url.startsWith("/rest/v1/agent_run_status")) {
        seen.reports.push(JSON.parse(body)[0]);
        return send(201, {});
      }
      send(404, {});
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}` })));
}

function runTool(url, args = []) {
  const tool = fileURLToPath(new URL("../tools/reconcile-balances.mjs", import.meta.url));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [tool, ...args], {
      env: { ...process.env, SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: "test-key" },
    });
    let out = "";
    child.stdout.on("data", (c) => { out += c; });
    child.stderr.on("data", (c) => { out += c; });
    child.on("close", (code) => resolve({ code, out }));
  });
}

const row = (id, difference) => ({
  balance_table: "assets", balance_id: id, owner: "0123456789ab", checked_from: "2026-11-19T02:17:48+00:00",
  opening: 100, recorded: -20, expected: 80, actual: 80 + difference, difference,
});

test("when every balance matches, it says so and reports ok", async () => {
  const { server, seen, url } = await fakeServer({ rows: [row("aaaa", 0), row("bbbb", 0.001)] });
  const { code } = await runTool(url);
  server.close();
  assert.equal(code, 0);
  assert.equal(seen.reports.at(-1).status, "ok");
  assert.match(seen.reports.at(-1).detail, /^2 balances checked since \d{4}-\d{2}-\d{2}, all match their records$/);
});

test("a mismatch is reported as a count, with the details only in the log", async () => {
  const id = "11111111-2222-3333-4444-555555555555";
  const { server, seen, url } = await fakeServer({ rows: [row(id, 50), row("bbbb", 0)] });
  const { code, out } = await runTool(url);
  server.close();
  assert.equal(code, 0);
  const report = seen.reports.at(-1);
  assert.equal(report.status, "degraded");
  assert.match(report.detail, /^1 of 2 balances does not match its records since /);
  // Every signed-in user can read that table, so no id and no amount go in it.
  assert.doesNotMatch(report.detail, new RegExp(id));
  assert.doesNotMatch(report.detail, /\$/);
  assert.match(out, new RegExp(`${id}.*\\$50\\.00 unexplained`));
});

test("a failed check reports failed, not ok", async () => {
  const { server, seen, url } = await fakeServer({ rows: [], rpcStatus: 500 });
  const { code } = await runTool(url);
  server.close();
  assert.equal(code, 1);
  assert.equal(seen.reports.at(-1).status, "failed");
});

test("once a day: a run already made today is not repeated", async () => {
  const { server, seen, url } = await fakeServer({ rows: [row("aaaa", 0)], ranAt: new Date().toISOString() });
  await runTool(url, ["--if-due"]);
  server.close();
  assert.equal(seen.rpc, 0);
  assert.equal(seen.reports.length, 0);
});

test("by hand, it can look further back and print without reporting", async () => {
  const { server, seen, url } = await fakeServer({ rows: [row("aaaa", 3)] });
  const { code, out } = await runTool(url, ["--since", "2026-11-19", "--no-report"]);
  server.close();
  assert.equal(code, 3);
  assert.equal(seen.reports.length, 0);
  assert.equal(new Date(seen.since).getDate(), 19);
  assert.match(out, /\$3\.00 unexplained/);
});
