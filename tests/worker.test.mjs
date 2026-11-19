// The live-quote route (worker.js), run for real with a made-up sign-in
// service and made-up Finnhub. Anyone may make an account, so the route must
// keep one person from emptying the shared Finnhub key, and must not let one
// account learn from its cache that another follows a symbol. Every token,
// address and symbol here is invented.

import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.js";

let clock = Date.parse("2026-11-18T15:00:00.000Z");
const realNow = Date.now;
Date.now = () => clock;
const later = (ms) => { clock += ms; };

let finnhubCalls = [];
let authCalls = 0;
globalThis.fetch = async (input, opts = {}) => {
  const url = new URL(String(input));
  if (url.pathname === "/auth/v1/user") {
    authCalls++;
    const token = (opts.headers?.Authorization || "").replace("Bearer ", "");
    if (!token.startsWith("ok-")) return new Response("{}", { status: 401 });
    return new Response(JSON.stringify({ id: `user-${token.slice(3)}` }), { status: 200 });
  }
  if (url.host === "finnhub.io") {
    finnhubCalls.push(url.searchParams.get("symbol"));
    return new Response(JSON.stringify({ c: 10, d: 0.1, dp: 1, pc: 9.9 }), { status: 200 });
  }
  throw new Error(`no fake for ${url}`);
};
const env = { FINNHUB_API_KEY: "fake", ASSETS: { fetch: async () => new Response("page") } };

let ipCounter = 0;
async function ask(token, symbols, ip = `10.0.0.${++ipCounter % 250}`) {
  const req = new Request(`https://app.example/api/quotes?symbols=${symbols.join(",")}`, {
    headers: { Authorization: `Bearer ${token}`, "CF-Connecting-IP": ip, "cf-visitor": '{"scheme":"https"}' },
  });
  const res = await worker.fetch(req, env);
  return { status: res.status, body: await res.json() };
}

test("a symbol outside the public list is cached for one account only", async () => {
  later(10 * 60_000);
  finnhubCalls = [];
  await ask("ok-u1", ["ZZP"]);
  await ask("ok-u2", ["ZZP"]);
  assert.deepEqual(finnhubCalls, ["ZZP", "ZZP"], "the second account was answered from the first account's cache");
  await ask("ok-u1", ["ZZP"]);
  assert.equal(finnhubCalls.length, 2, "an account's own repeat should come from its own cache");
});

test("a public-list symbol is fetched once for everybody", async () => {
  later(10 * 60_000);
  finnhubCalls = [];
  await ask("ok-u1", ["AAPL"]);
  const second = await ask("ok-u2", ["AAPL"]);
  assert.deepEqual(finnhubCalls, ["AAPL"]);
  assert.equal(second.body.quotes.AAPL.price, 10);
});

test("an account cannot cause more Finnhub calls than its share, and the route as a whole has a ceiling", async () => {
  later(10 * 60_000);
  finnhubCalls = [];
  const letter = (n) => String.fromCharCode(65 + n);
  const batch = (k) => Array.from({ length: 40 }, (_, i) => `ZQ${k}${letter(Math.floor(i / 26))}${letter(i % 26)}Q`);
  const first = await ask("ok-greedy", batch("A"));
  assert.equal(Object.keys(first.body.quotes).length, 40);
  const second = await ask("ok-greedy", batch("B"));
  assert.equal(Object.keys(second.body.quotes).length, 0, "over the per-minute ceiling, nothing more was fetched");
  assert.equal(finnhubCalls.length, 40);
  // Spread over minutes the ceiling resets, and the account's own share
  // (120 in five minutes) is what stops it.
  for (const k of ["C", "D"]) { later(61_000); await ask("ok-greedy", batch(k)); }
  later(61_000);
  const fourth = await ask("ok-greedy", batch("E"));
  assert.equal(Object.keys(fourth.body.quotes).length, 0, "one account went past its share");
  assert.equal(finnhubCalls.length, 120);
  // Another account is unaffected by the first one's share.
  const other = await ask("ok-patient", ["ZZOTHER"]);
  assert.equal(other.body.quotes.ZZOTHER.price, 10);
});

test("one address is limited however many requests it sends, and sign-in is required", async () => {
  later(10 * 60_000);
  const statuses = [];
  for (let i = 0; i < 31; i++) statuses.push((await ask("ok-u1", ["AAPL"], "192.0.2.9")).status);
  assert.deepEqual(statuses.slice(0, 30), Array(30).fill(200));
  assert.equal(statuses[30], 429);
  assert.equal((await ask("bad", ["AAPL"])).status, 401);
  assert.equal((await ask("", ["AAPL"])).status, 401);
});

test("the sign-in check is remembered for a minute, not repeated on every poll", async () => {
  later(10 * 60_000);
  authCalls = 0;
  await ask("ok-steady", ["AAPL"]);
  await ask("ok-steady", ["MSFT"]);
  assert.equal(authCalls, 1);
  later(61_000);
  await ask("ok-steady", ["AAPL"]);
  assert.equal(authCalls, 2);
});

test.after(() => { Date.now = realNow; });
