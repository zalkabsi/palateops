const ASSETS = __ASSETS__;
const RATE_BUCKETS = new Map();
const MAX_BODY_BYTES = 4096;
const BACKEND_TIMEOUT_MS = 25_000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ status: "ok", demoMode: "sample", qlooBackendConfigured: Boolean(env.QLOO_BACKEND_URL && isStrongBackendToken(env.QLOO_BACKEND_TOKEN)) }, 200, request);
    }
    if (url.pathname === "/api/qloo/resolve" || url.pathname === "/api/qloo/signals") {
      if (request.method !== "POST") return json({ error: "Use POST for a live Qloo taste request." }, 405, request);
      return handleQloo(request, env, url.pathname);
    }
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    const assetPath = url.pathname === "/" ? "/index.html" : url.pathname;
    const asset = ASSETS[assetPath];
    if (!asset) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
    return new Response(request.method === "HEAD" ? null : asset.content, {
      status: 200,
      headers: {
        "content-type": asset.type,
        "cache-control": assetPath.endsWith(".js") || assetPath.endsWith(".css") ? "public, max-age=300" : "no-cache",
        "x-content-type-options": "nosniff",
        "referrer-policy": "strict-origin-when-cross-origin",
        "permissions-policy": "camera=(), microphone=(), geolocation=()",
        "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      },
    });
  },
};

async function handleQloo(request, env, path) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return json({ error: "The taste profile request must use application/json." }, 415, request);
  }
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY_BYTES) return json({ error: "The taste profile request is too large." }, 413, request);
  let body;
  try {
    const rawBody = await readBodyWithLimit(request, MAX_BODY_BYTES);
    if (rawBody === null) return json({ error: "The taste profile request is too large." }, 413, request);
    body = JSON.parse(rawBody);
  } catch { return json({ error: "The taste profile request must be valid JSON." }, 400, request); }
  if (!env.QLOO_BACKEND_URL || !isStrongBackendToken(env.QLOO_BACKEND_TOKEN)) {
    return json({ error: "Live Qloo mode is not configured. Set the authorized Node backend URL and shared token, or switch to Sample profile." }, 503, request);
  }
  const backendUrl = buildBackendUrl(env.QLOO_BACKEND_URL, path);
  if (!backendUrl) return json({ error: "The live Qloo backend URL is invalid or must use HTTPS." }, 503, request);
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (!allowRequest(ip)) return json({ error: "Too many live taste requests. Wait a minute and try again." }, 429, request);
  try {
    if (path.endsWith("/resolve")) {
      const venues = normalizeVenues(body?.venues);
      if (venues.error) return json({ error: venues.error }, 400, request);
      body = { venues: venues.values };
    } else {
      const entities = normalizeResolvedEntities(body?.entities);
      if (entities.error) return json({ error: entities.error }, 400, request);
      body = { entities: entities.values };
    }
    const response = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + env.QLOO_BACKEND_TOKEN,
        "x-palateops-client-ip": ip,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    });
    let payload;
    try { payload = await response.json(); } catch { return json({ error: "The live Qloo backend returned an unreadable response." }, 502, request); }
    return json(payload, response.status, request);
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      return json({ error: "The live Qloo backend took too long to respond. No sample data was substituted." }, 504, request);
    }
    return json({ error: "The live Qloo backend is unavailable. No sample data was substituted." }, 502, request);
  }
}

async function readBodyWithLimit(request, maxBytes) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        try { await reader.cancel(); } catch {}
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function normalizeVenues(value) {
  if (!Array.isArray(value)) return { error: "Enter one to three restaurant names." };
  const names = [];
  for (const raw of value) {
    if (typeof raw !== "string") return { error: "Restaurant names must be text." };
    const name = raw.trim().replace(/\s+/g, " ");
    if (!name) continue;
    if (name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) return { error: "Each restaurant name must be 120 characters or fewer and contain no control characters." };
    if (!names.some((item) => item.toLowerCase() === name.toLowerCase())) names.push(name);
  }
  if (names.length < 1 || names.length > 3) return { error: "Enter one to three restaurant names." };
  return { values: names };
}

function normalizeResolvedEntities(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) return { error: "Confirm one to three resolved restaurant matches." };
  const entities = [];
  for (const raw of value) {
    const id = typeof raw?.id === "string" ? raw.id.trim() : "";
    const name = typeof raw?.name === "string" ? raw.name.trim() : "";
    const requestedName = typeof raw?.requestedName === "string" ? raw.requestedName.trim().slice(0, 120) : name;
    if (!id || id.length > 180 || !/^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(id) || !name || name.length > 100) {
      return { error: "A resolved restaurant match was invalid. Resolve the names again." };
    }
    entities.push({ id, name, requestedName, type: String(raw?.type || "urn:entity:place").slice(0, 100) });
  }
  return { values: entities };
}

function buildBackendUrl(base, path) {
  try {
    const origin = new URL(base);
    if (origin.pathname !== "/" || origin.search || origin.hash) return null;
    const url = new URL(path, origin);
    const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !localHttp) || url.username || url.password || url.hash) return null;
    return url.toString();
  } catch { return null; }
}

function isStrongBackendToken(value) {
  return typeof value === "string" && value.length >= 32;
}

function allowRequest(ip) {
  const now = Date.now();
  const recent = (RATE_BUCKETS.get(ip) || []).filter((time) => now - time < 60_000);
  if (recent.length >= 10) return false;
  recent.push(now);
  RATE_BUCKETS.set(ip, recent);
  if (RATE_BUCKETS.size > 500) {
    for (const [key, times] of RATE_BUCKETS) if (!times.some((time) => now - time < 60_000)) RATE_BUCKETS.delete(key);
  }
  return true;
}

function json(body, status = 200, request) {
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
  if (request) headers["vary"] = "origin";
  return new Response(JSON.stringify(body), { status, headers });
}
