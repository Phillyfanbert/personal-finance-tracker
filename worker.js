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
    if (url.pathname === "/api/price") return handlePriceRequest(url, request, env);
    return env.ASSETS.fetch(request);
  },
};

async function handlePriceRequest(url, request, env) {
  const symbol = (url.searchParams.get("symbol") || "").trim().toUpperCase();
  if (!symbol || !/^[A-Z.\-]{1,10}$/.test(symbol)) {
    return json({ error: "invalid symbol" }, 400);
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);

  // Confirm the caller is a real signed-in user of this app before
  // spending a Finnhub call on their behalf.
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: SUPABASE_ANON_KEY },
  });
  if (!userRes.ok) return json({ error: "unauthorized" }, 401);

  const finnhubRes = await fetch(
    `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${env.FINNHUB_API_KEY}`
  );
  if (!finnhubRes.ok) return json({ error: "upstream error" }, 502);

  const quote = await finnhubRes.json();
  // Finnhub returns c: 0 (not an HTTP error) for an unknown symbol -
  // same behavior tools/price-agent.js's validateFinnhubQuote() already
  // handles server-side.
  const price = Number.isFinite(quote.c) && quote.c > 0 ? quote.c : null;
  return json({ price });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
