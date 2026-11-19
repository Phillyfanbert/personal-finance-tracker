// Two lines that tell a person whether the safety nets are working: on the
// check-in sheet, whether each balance adds up with its history
// (reconcile_balances), and on the privacy sheet, when the last daily backup
// was made. Each must never say "all fine" for something it could not see.

import { test } from "node:test";
import assert from "node:assert/strict";
import { APP, slice, evaluate } from "./source.mjs";

const books = slice(APP, "function checkinBooksHtml(rows) {", "$(\"checkinOpenBtn\").onclick");
const backup = slice(APP, "const BACKUP_LATE_MS =", "function renderBackupLine() {")
  + slice(APP, "function timeAgo(dateStr) {", "// Shared by renderDealFindings()");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (n) => "$" + Number(n).toFixed(2);

function loadBooks() {
  return evaluate(books, {
    assets: [{ id: "chk", name: "Chase <b>Checking</b>" }],
    debts: [{ id: "visa", name: "Visa" }],
    esc, fmt,
  }, ["checkinBooksHtml"]).checkinBooksHtml;
}

const row = (balance_table, balance_id, difference) => ({ balance_table, balance_id, difference });

test("when every balance adds up it says so, and with nothing checked it says nothing", () => {
  const html = loadBooks();
  assert.match(html([row("assets", "chk", 0), row("liabilities", "visa", 0.001)]), /checks out/);
  assert.equal(html([]), "");
});

test("a balance that does not add up is named, with which way and by how much", () => {
  const html = loadBooks();
  const out = html([row("assets", "chk", 50), row("liabilities", "visa", -12.5), row("assets", "gone", 1)]);
  assert.match(out, /3 balances do not match their history/);
  assert.match(out, /Chase &lt;b&gt;Checking&lt;\/b&gt; holds \$50\.00 more/);
  assert.match(out, /Visa owes \$12\.50 less/);
  assert.match(out, /A balance holds \$1\.00 more/);
  // Correcting the figure records a correction, which does not explain the
  // earlier change, so the line must not suggest it will.
  assert.match(out, /will not clear this/);
  assert.doesNotMatch(out, /[–—]| - /);
});

test("the backup line says when the last copy was made, and never that a failed one worked", () => {
  const { backupLineText } = evaluate(backup, {}, ["backupLineText"]);
  const now = Date.parse("2026-11-19T12:00:00Z");
  const at = (hoursAgo) => new Date(now - hoursAgo * 3600e3).toISOString();
  const realNow = Date.now;
  Date.now = () => now;
  try {
    assert.equal(backupLineText({ status: "ok", ran_at: at(3) }, now), "The latest copy was saved 3 hours ago.");
    assert.match(backupLineText({ status: "failed", ran_at: at(3) }, now), /did not finish/);
    assert.match(backupLineText({ status: "ok", ran_at: at(50) }, now), /seems to have stopped/);
    assert.match(backupLineText({ status: "degraded", ran_at: at(2) }, now), /may have missed/);
    assert.equal(backupLineText(undefined, now), "");
  } finally {
    Date.now = realNow;
  }
});
