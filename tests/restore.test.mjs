// Restoring from a backup (tools/restore-backup.mjs), against a stand-in
// server. A restore writes into a database holding real money, so what is
// pinned here is what it must never do: write without being asked, write into
// the real database without --production, change a row that is already there,
// lose a column's contents, or put a refund back before its purchase.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync, symlinkSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tableOrder, rowsInOrder, checkBackup } from "../tools/restore-backup.mjs";

const TOOL = fileURLToPath(new URL("../tools/restore-backup.mjs", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "restore-test-"));
const U = "11111111-1111-4111-8111-111111111111";

function backupFile(tables, source = "source.example.supabase.co") {
  const path = join(dir, `b-${Math.random().toString(36).slice(2)}.json.gz`);
  const body = { format: 1, created_at: "2026-11-18T03:00:00Z", source, tables: {} };
  for (const [name, rows] of Object.entries(tables)) body.tables[name] = { primary_key: ["id"], count: rows.length, rows };
  writeFileSync(path, gzipSync(Buffer.from(JSON.stringify(body))));
  return path;
}

const sample = () => ({
  assets: [
    { id: "holding", user_id: U, name: "AAPL", value: 1500, parent_asset_id: "brokerage" },
    { id: "brokerage", user_id: U, name: "Brokerage", value: 1500, parent_asset_id: null },
    { id: "chk", user_id: U, name: "Checking", value: 2500, parent_asset_id: null },
  ],
  accounts: [{ id: "a-chk", user_id: U, name: "Checking", type: "debit", linked_asset_id: "chk" }],
  expenses: [
    { id: "refund", user_id: U, amount: -30, account_id: "a-chk", refund_of: "coat" },
    { id: "coat", user_id: U, amount: 42, account_id: "a-chk", refund_of: null },
  ],
  record_history: [{ id: 1, user_id: U, table_name: "expenses", action: "delete", old_row: {} }],
});

// Columns per table as a PostgREST description would list them, foreign keys
// marked the way it marks them.
function describe(tables) {
  const fk = { "accounts.linked_asset_id": "assets", "assets.parent_asset_id": "assets", "expenses.account_id": "accounts", "expenses.refund_of": "expenses" };
  const defs = {};
  for (const [t, cols] of Object.entries(tables)) {
    defs[t] = { properties: Object.fromEntries(cols.map((c) => [c, fk[`${t}.${c}`] ? { description: `<fk table='${fk[`${t}.${c}`]}' column='id'/>` } : {}])) };
  }
  return defs;
}
const fullSchema = () => describe({
  assets: ["id", "user_id", "name", "value", "parent_asset_id"],
  accounts: ["id", "user_id", "name", "type", "linked_asset_id"],
  expenses: ["id", "user_id", "amount", "account_id", "refund_of"],
  record_history: ["id", "user_id", "table_name", "action", "old_row"],
});

// A stand-in PostgREST that keeps rows per table, inserts only what is not
// there (ON CONFLICT DO NOTHING), and can be told to refuse certain rows.
function fakeServer({ defs = fullSchema(), existing = {}, refuse = () => null } = {}) {
  const db = Object.fromEntries(Object.entries(existing).map(([t, rows]) => [t, rows.map((r) => ({ ...r }))]));
  const posts = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const send = (status, obj) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
      const url = new URL(req.url, "http://x");
      const table = url.pathname.replace("/rest/v1/", "");
      if (req.method === "GET" && table === "") return send(200, { definitions: defs });
      if (req.method === "POST") {
        const rows = JSON.parse(body);
        posts.push({ table, ids: rows.map((r) => r.id), prefer: req.headers.prefer, onConflict: url.searchParams.get("on_conflict") });
        for (const r of rows) {
          const why = refuse(table, r);
          if (why) return send(409, { code: "23505", message: why });
        }
        const have = (db[table] ||= []);
        const added = rows.filter((r) => !have.some((h) => h.id === r.id));
        have.push(...added);
        return send(201, added.map((r) => ({ id: r.id })));
      }
      send(404, {});
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, db, posts, url: `http://127.0.0.1:${server.address().port}` })));
}

function run(args, env = {}, tool = TOOL) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [tool, ...args], {
      env: { ...process.env, SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "", RESTORE_SERVICE_ROLE_KEY: "test-key", ...env },
    });
    let out = "";
    child.stdout.on("data", (c) => { out += c; });
    child.stderr.on("data", (c) => { out += c; });
    child.on("close", (code) => resolve({ code, out }));
  });
}

test("tables go after the tables they point at; a table pointing at itself is not a loop", () => {
  const fks = { accounts: { linked_asset_id: "assets" }, expenses: { account_id: "accounts", refund_of: "expenses" }, assets: { parent_asset_id: "assets" } };
  const order = tableOrder(["expenses", "accounts", "profiles", "assets"], fks);
  assert.ok(order.indexOf("assets") < order.indexOf("accounts"));
  assert.ok(order.indexOf("accounts") < order.indexOf("expenses"));
  assert.equal(order.length, 4);
});

test("a holding's account and a refund's purchase go in before them", () => {
  const levels = rowsInOrder(sample().expenses, ["refund_of"]);
  assert.deepEqual(levels.map((l) => l.map((r) => r.id)), [["coat"], ["refund"]]);
  // A parent not being restored (already there, or gone) does not hold a row back.
  assert.deepEqual(rowsInOrder([{ id: "r", refund_of: "elsewhere" }], ["refund_of"]).map((l) => l.length), [1]);
});

test("checking only reads the file: it writes nothing and needs no database", async () => {
  const { code, out } = await run([backupFile(sample())]);
  assert.equal(code, 0);
  assert.match(out, /3 rows|expenses\s+2/);
  assert.match(out, /Nothing was written/);
});

test("run through a link to it, it still runs rather than exiting quietly", async () => {
  // On macOS /tmp is itself a link, and the first version did nothing there.
  const link = join(dir, "restore-link.mjs");
  symlinkSync(TOOL, link);
  const { code, out } = await run([backupFile(sample())], {}, link);
  assert.equal(code, 0);
  assert.match(out, /Nothing was written/);
});

test("a file that does not add up restores nothing", async () => {
  const tables = sample();
  tables.expenses.push({ ...tables.expenses[1] });
  const { code, out } = await run([backupFile(tables), "--into", "http://127.0.0.1:9"]);
  assert.equal(code, 1);
  assert.match(out, /expenses: 1 rows repeat/);
  assert.deepEqual(checkBackup({ tables: { x: { primary_key: ["id"], count: 2, rows: [{ id: 1 }] } } }).problems, ["x: says 2 rows, holds 1"]);
});

test("the database the backup came from needs --production, and nothing is sent without it", async () => {
  const fake = await fakeServer();
  const host = new URL(fake.url).host;
  const { code, out } = await run([backupFile(sample(), host), "--into", fake.url]);
  fake.server.close();
  assert.equal(code, 2);
  assert.match(out, /real database/);
  assert.equal(fake.posts.length, 0);
});

test("a restore puts back only what is missing, in order, and leaves the rest alone", async () => {
  const fake = await fakeServer({ existing: { assets: [{ id: "chk", user_id: U, name: "Checking", value: 999 }] } });
  const { code, out } = await run([backupFile(sample()), "--into", fake.url]);
  fake.server.close();
  assert.equal(code, 0, out);
  // Never written: its id is the database's and only its trigger writes it.
  assert.ok(!fake.posts.some((p) => p.table === "record_history"));
  assert.match(out, /record_history\s+skipped/);
  // Rows already there are not changed: checking keeps the figure it has now.
  assert.equal(fake.db.assets.find((a) => a.id === "chk").value, 999);
  assert.match(out, /assets\s+2 put back, 1 already there/);
  for (const p of fake.posts) {
    assert.match(p.prefer, /resolution=ignore-duplicates/);
    assert.equal(p.onConflict, "id");
  }
  const seq = fake.posts.flatMap((p) => p.ids);
  assert.ok(seq.indexOf("brokerage") < seq.indexOf("holding"), "a holding went in before its account");
  assert.ok(seq.indexOf("a-chk") < seq.indexOf("coat"), "an expense went in before its account");
  assert.ok(seq.indexOf("coat") < seq.indexOf("refund"), "a refund went in before its purchase");
});

test("one person only", async () => {
  const tables = sample();
  tables.expenses.push({ id: "theirs", user_id: "someone-else", amount: 5, account_id: null, refund_of: null });
  const fake = await fakeServer();
  const { code } = await run([backupFile(tables), "--into", fake.url, "--user", U, "--table", "expenses"]);
  fake.server.close();
  assert.equal(code, 0);
  assert.deepEqual(fake.db.expenses.map((e) => e.id).sort(), ["coat", "refund"]);
  assert.equal(fake.db.assets, undefined);
});

test("a column the target does not have stops it before anything is written", async () => {
  const defs = fullSchema();
  delete defs.expenses.properties.refund_of;
  const fake = await fakeServer({ defs });
  const { code, out } = await run([backupFile(sample()), "--into", fake.url]);
  fake.server.close();
  assert.equal(code, 1);
  assert.match(out, /no column for: expenses: refund_of/);
  assert.equal(fake.posts.length, 0);
});

test("a refused row is named, and the rest of its batch still goes in", async () => {
  const fake = await fakeServer({ refuse: (table, row) => (table === "accounts" && row.id === "a-chk" ? "duplicate key value violates unique constraint \"accounts_one_cash_per_user\"" : null) });
  const tables = sample();
  tables.accounts.push({ id: "a-sav", user_id: U, name: "Savings", type: "savings", linked_asset_id: null });
  const { code, out } = await run([backupFile(tables), "--into", fake.url]);
  fake.server.close();
  assert.equal(code, 3);
  assert.match(out, /refused accounts a-chk: 23505 duplicate key/);
  assert.match(out, /accounts\s+1 put back, 0 already there, 1 refused/);
  assert.ok(fake.db.accounts.some((a) => a.id === "a-sav"));
});
