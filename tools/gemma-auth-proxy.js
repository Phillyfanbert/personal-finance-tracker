#!/usr/bin/env node
// ============================================================================
// Auth-gated reverse proxy in front of Ollama. Ollama has no built-in request
// auth, and the Cloudflare Tunnel exposing it is a "quick tunnel" (no owned
// domain, so no Cloudflare Access policy is possible either - see the project notes'
// $0 constraint) - without this, anyone who finds the tunnel URL (it's baked
// into this app's own public app/config.js, or discoverable by scanning
// *.trycloudflare.com) could send arbitrary requests to the home GPU for free.
//
// Run on the SAME machine as Ollama, listening on GEMMA_PROXY_PORT (default
// 11435) and forwarding to OLLAMA_URL (default http://localhost:11434). Point
// the Cloudflare Tunnel at this port instead of Ollama's port directly.
//
// Requires header "X-Gemma-Key: <GEMMA_PROXY_SECRET>" on every request, else
// 401. app/gemma.js sends this from APP_CONFIG.GEMMA_AUTH_KEY - which means
// the key still ships inside this app's public client-side config.js, same as
// GEMMA_ENDPOINT itself (the browser calls Gemma directly, no server-side
// proxy of ours sits between it and here). This raises the bar from "anyone
// who finds the bare tunnel URL" (zero auth at all) to "anyone who reads this
// app's own public source" - it does not hide the key from someone who
// deliberately inspects the app's own code, the same "safe to expose, not a
// secret" honesty caveat the project notes already state for the Supabase anon key.
//
// Because the key is public, the key alone protects nothing, and two more
// limits are what actually keep this machine safe:
//
// ONLY THE TWO REQUESTS THE APP MAKES ARE FORWARDED (POST /api/generate and
// POST /api/embeddings). Ollama's API also deletes installed models
// (DELETE /api/delete), downloads new ones of any size (POST /api/pull) and
// builds new ones (POST /api/create), and this used to forward every path and
// method, so anyone holding the public key could empty the model list or fill
// this machine's disk. The background jobs here (embed-expenses, the monthly
// report, the recap fallback) talk to Ollama directly on its own port and
// never come through this proxy, so they need nothing listed.
//
// IT LISTENS ON LOOPBACK ONLY. The Cloudflare Tunnel connects from this same
// machine, so nothing else ever needed this port, and listening on every
// interface also offered it to anyone on the home network. Both loopback
// addresses, because "localhost" in the tunnel's settings may resolve to
// either one.
//
// Run:   GEMMA_PROXY_SECRET=<random> node tools/gemma-auth-proxy.js
// ============================================================================
const http = require("http");
const crypto = require("crypto");

const PORT = Number(process.env.GEMMA_PROXY_PORT || 11435);
const OLLAMA_URL = new URL(process.env.OLLAMA_URL || "http://localhost:11434");
const SECRET = process.env.GEMMA_PROXY_SECRET;
const ALLOWED_PATHS = new Set(["/api/generate", "/api/embeddings"]);
const HOSTS = (process.env.GEMMA_PROXY_HOSTS || "127.0.0.1,::1").split(",").map((h) => h.trim()).filter(Boolean);

if (!SECRET) {
  console.error("Missing GEMMA_PROXY_SECRET - refusing to start unauthenticated.");
  process.exit(1);
}

// Constant time, so the answer to a wrong guess does not arrive sooner the
// earlier it differs.
function keyMatches(given) {
  if (typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(SECRET);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// The normalised path, so "/api/generate/../delete" is judged (and
// forwarded) as the "/api/delete" it really is. Any query string is dropped:
// Ollama reads none.
function requestPath(rawUrl) {
  try {
    return new URL(rawUrl, "http://proxy.invalid").pathname;
  } catch {
    return null;
  }
}

// A refused request is read to the end BEFORE the answer goes back. Replying
// while its body is still arriving made Node close the connection under it,
// so a browser reusing that connection got a reset instead of the refusal.
// The body is discarded as it arrives, and one larger than any real request
// is cut off rather than read forever.
const MAX_REFUSED_BODY = 64 * 1024;
function refuse(req, res, status, error) {
  let size = 0;
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_REFUSED_BODY) req.destroy();
  });
  req.on("error", () => {});
  req.on("end", () => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error }));
  });
  req.resume();
}

function handle(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Gemma-Key");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") {
    req.resume();
    res.writeHead(204);
    return res.end();
  }

  // The key is checked before the path, so someone without it cannot learn
  // which paths exist.
  if (!keyMatches(req.headers["x-gemma-key"])) return refuse(req, res, 401, "unauthorized");

  const path = requestPath(req.url);
  if (req.method !== "POST" || !ALLOWED_PATHS.has(path)) {
    return refuse(req, res, 404, "not available through this proxy");
  }

  const upstream = http.request(
    {
      hostname: OLLAMA_URL.hostname,
      port: OLLAMA_URL.port,
      path,
      method: "POST",
      headers: { ...req.headers, host: OLLAMA_URL.host },
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
      upstreamRes.pipe(res);
    }
  );
  upstream.on("error", (err) => {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "upstream unreachable", detail: err.message }));
  });
  req.pipe(upstream);
}

// One server per loopback address. A machine with IPv6 switched off has no
// ::1, which is fine as long as one of them is listening; only when none is
// does the process exit, so launchd's KeepAlive tries again.
let failures = 0;
for (const host of HOSTS) {
  const server = http.createServer(handle);
  server.on("error", (err) => {
    console.error(`Could not listen on ${host} port ${PORT}: ${err.code || err.message}`);
    if (++failures === HOSTS.length) process.exit(1);
  });
  server.listen(PORT, host, () => {
    console.log(`Gemma auth proxy listening on ${host} port ${PORT}, forwarding to ${OLLAMA_URL.origin}`);
  });
}
