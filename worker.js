// Cloudflare Worker entry point. Everything except /api/* falls through to
// the static app/ assets, same as before this file existed.
//
// SUPABASE_URL/SUPABASE_ANON_KEY are hardcoded (not Runtime env vars) -
// neither is secret. The anon key is already shipped client-side in
// app/config.js; Row Level Security is what actually protects data, not
// keeping this string hidden. FINNHUB_API_KEY below is the one real
// secret, and must be set as a Worker Runtime secret in the Cloudflare
// dashboard (Settings -> Runtime -> Variables and secrets) - a different
// panel from the Build-time secrets tools/generate-config.js reads.
const SUPABASE_URL = "https://ixosipgbikygqilbgvjx.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_5-glVkeUx8LsOOe12x3OPQ_F8x-sa8w";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Measured live before adding this: http:// returned 200 with real
    // content, no redirect and no HSTS. The Supabase calls are hardcoded to
    // https so the data itself was never in the clear, but the PAGE over
    // http is injectable in transit, and an injected page can read the
    // sign-in token straight out of localStorage. For an app holding
    // balances that is worth closing.
    //
    // cf-visitor carries the scheme the BROWSER used, which is what matters:
    // Cloudflare can terminate TLS and hand the Worker an https-looking URL
    // even when the original request was plaintext, so checking url.protocol
    // alone would silently never fire.
    const visitorScheme = (() => {
      try { return JSON.parse(request.headers.get("cf-visitor") || "{}").scheme; }
      catch { return null; }
    })();
    if (url.protocol === "http:" || visitorScheme === "http") {
      url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname === "/api/price" || url.pathname === "/api/quotes") {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      if (!spend(counters.ip, ip, PER_ADDRESS)) return json({ error: "rate limited" }, 429);
      return url.pathname === "/api/price"
        ? handlePriceRequest(url, request, env)
        : handleQuotesRequest(url, request, env);
    }
    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },
};

// Applied to the served page, not to the JSON routes: those are same-origin
// fetches the app makes of itself, never navigated to or framed.
//
// HSTS has no preload directive on purpose. Preload is a one-way submission
// to a browser-vendor list that is slow and awkward to reverse, and this
// hostname is a workers.dev subdomain rather than a domain that is owned -
// committing it permanently is not ours to do. max-age alone gets the real
// benefit for anyone who has visited once.
//
// DENY rather than SAMEORIGIN for framing: nothing in this app embeds itself,
// so the stricter value costs nothing and closes clickjacking on a UI whose
// buttons move real money.
function withSecurityHeaders(res) {
  const headers = new Headers(res.headers);
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

const SYMBOL_RE = /^[A-Z.\-]{1,10}$/;

// One Investments-page refresh asks for the 20-symbol movers watchlist, the
// 4 index ETF proxies, and whatever tickers the user actually owns. The cap
// also keeps this route inside the free plan's 50-subrequests-per-request
// limit: worst case is 40 uncached quote lookups plus the one Supabase auth
// check below.
const MAX_SYMBOLS_PER_REQUEST = 40;

// Finnhub's free tier allows 60 calls/minute. A Worker isolate is reused
// across requests, so caching here means every viewer shares one upstream
// call per PUBLIC symbol per TTL instead of each paying for their own - the
// starter companies and index funds are the same for every user, so this
// keeps the route's cost close to flat as viewers are added. Each account's
// other symbols are cached for that account alone (cacheKey, below).
//
// Deliberately NOT the Cache API: wrangler.jsonc declares no route or
// custom domain, so this Worker is served from a workers.dev hostname,
// where Cloudflare's edge cache is bypassed and caches.default would
// silently no-op. A module-scope Map has no such caveat. An isolate being
// evicted just means the next request re-fetches - correct, only slower.
const QUOTE_TTL_MS = 60000;
const quoteCache = new Map();

// The 20 starter companies and the four index funds. Their quotes are the
// same for everyone, so one cached copy serves every account. Anything else
// is cached PER ACCOUNT (94): a shared cache answers faster when somebody
// else asked for the same symbol a moment ago, and that difference is enough
// to tell that somebody follows it. Must match public_symbols() in
// supabase/94; tests/security.test.mjs compares them.
const PUBLIC_SYMBOLS = new Set([
  "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "JPM", "V", "UNH",
  "XOM", "JNJ", "WMT", "PG", "MA", "HD", "DIS", "NFLX", "AMD", "KO",
  "SPY", "DIA", "QQQ", "IWM",
]);

// Anyone may make an account, so the free Finnhub key (60 calls a minute,
// shared with the server's price job) and the Worker's free 100,000 daily
// requests need limits a script cannot walk past:
//   - per address, every /api request, before anything is spent on it;
//   - per account, the Finnhub calls its requests cause (a cached answer
//     costs nothing). The app asks for at most ~75 symbols every 5 minutes;
//   - per Worker instance, Finnhub calls overall, so no mix of accounts
//     takes the whole key.
// A refused lookup is simply left out, and the app falls back to the prices
// it already has. Counted per instance: Cloudflare runs several, so these
// bound each one rather than the whole service, which is enough to keep one
// person from emptying the key.
const PER_ADDRESS = { max: 30, windowMs: 60_000 };
const PER_ACCOUNT = { max: 120, windowMs: 5 * 60_000 };
const UPSTREAM = { max: 40, windowMs: 60_000 };
const counters = { ip: new Map(), account: new Map(), upstream: new Map() };

// A fixed window: up to `limit.max` in each `limit.windowMs`.
function spend(map, key, limit, now = Date.now()) {
  let c = map.get(key);
  if (!c || now - c.start >= limit.windowMs) {
    c = { start: now, n: 0 };
    map.set(key, c);
  }
  if (c.n >= limit.max) return false;
  c.n++;
  if (map.size > 5000) {
    for (const [k, v] of map) if (now - v.start >= limit.windowMs) map.delete(k);
  }
  return true;
}
function refund(map, key) {
  const c = map.get(key);
  if (c && c.n > 0) c.n--;
}

const cacheKey = (symbol, account) => (PUBLIC_SYMBOLS.has(symbol) ? symbol : `${account}|${symbol}`);

// undefined means "not asked: over a limit", null "couldn't ask" (upstream
// error), { price: null } "asked, and this symbol isn't real".
async function cachedQuote(symbol, account, env) {
  const key = cacheKey(symbol, account);
  const hit = quoteCache.get(key);
  if (hit && Date.now() - hit.at < QUOTE_TTL_MS) return hit.quote;
  if (MUTUAL_FUND_SYMBOL.test(symbol)) return { price: null };
  if (!spend(counters.account, account, PER_ACCOUNT)) return undefined;
  if (!spend(counters.upstream, "all", UPSTREAM)) {
    refund(counters.account, account);
    return undefined;
  }
  const quote = await fetchQuote(symbol, env);
  // A transient upstream failure is deliberately not cached - pinning a
  // null onto this symbol for the rest of the TTL would turn one bad
  // moment into a minute of missing prices. An unknown symbol IS cached,
  // since that's a real, stable answer rather than a failure.
  if (quote !== null) quoteCache.set(key, { at: Date.now(), quote });
  if (quoteCache.size > 5000) {
    const now = Date.now();
    for (const [k, v] of quoteCache) if (now - v.at >= QUOTE_TTL_MS) quoteCache.delete(k);
  }
  return quote;
}

// null means "couldn't ask" (upstream error); { price: null } means
// "asked, and this symbol isn't real."
// Finnhub's /quote serves exchange-traded instruments only; a mutual fund
// has an end-of-day NAV and is not covered. Measured live: the symbols come
// back as an HTTP error, not a c:0 quote, so without this the route spends a
// call and returns a 502 that reads as "something is broken" rather than
// "this kind of symbol has no live price". Same five-character-ending-in-X
// shape rule tools/price-agent.js uses - Nasdaq's own convention for mutual
// funds, checked against the app's real ticker lists where it matches 62 of
// 62 funds and none of the 284 stocks, ETFs or crypto symbols.
//
// Returns the { price: null } shape rather than an error on purpose: that is
// already "asked, and there is no price for this", which is exactly true
// here, and the Holdings form already degrades to manual entry on it.
const MUTUAL_FUND_SYMBOL = /^[A-Z]{4}X$/;

async function fetchQuote(symbol, env) {
  const res = await fetch(
    `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${env.FINNHUB_API_KEY}`
  );
  if (!res.ok) return null;
  const quote = await res.json();
  // Finnhub returns c: 0 (not an HTTP error) for an unknown symbol - the
  // same signal tools/price-agent.js's validateFinnhubQuote() handles
  // server-side.
  if (!Number.isFinite(quote.c) || quote.c <= 0) return { price: null };
  return {
    price: quote.c,
    // d/dp/pc ride along on the same quote call at no extra cost. They're
    // a real previous close rather than the day-over-day comparison the
    // client otherwise derives by diffing two stored findings rows.
    change: Number.isFinite(quote.d) ? quote.d : null,
    changePct: Number.isFinite(quote.dp) ? quote.dp : null,
    previousClose: Number.isFinite(quote.pc) && quote.pc > 0 ? quote.pc : null,
  };
}

// The signed-in account making the request, or null. Confirmed with
// Supabase before a Finnhub call is spent, and remembered for a minute so
// the app's polling does not cost a sign-in check every time. The limits
// above are kept per account, so this has to return WHO, not just yes.
const SESSION_TTL_MS = 60_000;
const sessions = new Map();
async function signedInAccount(request) {
  const authHeader = request.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const now = Date.now();
  const hit = sessions.get(authHeader);
  if (hit && now - hit.at < SESSION_TTL_MS) return hit.id;
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: SUPABASE_ANON_KEY },
  });
  if (!userRes.ok) return null;
  const user = await userRes.json().catch(() => null);
  if (!user || typeof user.id !== "string" || !user.id) return null;
  sessions.set(authHeader, { id: user.id, at: now });
  if (sessions.size > 5000) {
    for (const [k, v] of sessions) if (now - v.at >= SESSION_TTL_MS) sessions.delete(k);
  }
  return user.id;
}

// Single-symbol lookup for the Holdings form's "Buying now" mode. Response
// shape ({ price }) is unchanged from before /api/quotes existed - app.js's
// fetchLivePriceOnDemand() reads exactly that.
async function handlePriceRequest(url, request, env) {
  const symbol = (url.searchParams.get("symbol") || "").trim().toUpperCase();
  if (!symbol || !SYMBOL_RE.test(symbol)) return json({ error: "invalid symbol" }, 400);
  const account = await signedInAccount(request);
  if (!account) return json({ error: "unauthorized" }, 401);

  const quote = await cachedQuote(symbol, account, env);
  if (quote === undefined) return json({ error: "rate limited" }, 429);
  if (quote === null) return json({ error: "upstream error" }, 502);
  return json({ price: quote.price });
}

// Batch lookup for the Investments page's live overlay. A symbol that
// couldn't be reached is simply absent from `quotes` rather than present
// with a null - the client falls back to its stored finding for that
// symbol, so "no answer" and "answered null" need to stay tellable apart.
async function handleQuotesRequest(url, request, env) {
  const raw = (url.searchParams.get("symbols") || "").trim().toUpperCase();
  const symbols = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
  if (!symbols.length) return json({ error: "no symbols" }, 400);
  if (symbols.length > MAX_SYMBOLS_PER_REQUEST) return json({ error: "too many symbols" }, 400);
  if (!symbols.every((s) => SYMBOL_RE.test(s))) return json({ error: "invalid symbol" }, 400);
  const account = await signedInAccount(request);
  if (!account) return json({ error: "unauthorized" }, 401);

  const results = await Promise.all(
    symbols.map(async (symbol) => [symbol, await cachedQuote(symbol, account, env)])
  );
  const quotes = {};
  for (const [symbol, quote] of results) {
    if (quote && quote.price != null) quotes[symbol] = quote;
  }
  return json({ quotes });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
