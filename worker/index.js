const ASSETS = __ASSETS__;
const RATE_BUCKETS = new Map();
const QLOO_ORIGIN = "https://api.qloo.com";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ status: "ok", demoMode: "sample", qlooConfigured: Boolean(env.QLOO_API_KEY) }, 200, request);
    }
    if (url.pathname === "/api/qloo") {
      if (request.method !== "POST") return json({ error: "Use POST for a live Qloo taste request." }, 405, request);
      return handleQloo(request, env);
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

async function handleQloo(request, env) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return json({ error: "The taste profile request must use application/json." }, 415, request);
  }
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 4096) return json({ error: "The taste profile request is too large." }, 413, request);
  let body;
  try {
    const rawBody = await readBodyWithLimit(request, 4096);
    if (rawBody === null) return json({ error: "The taste profile request is too large." }, 413, request);
    body = JSON.parse(rawBody);
  } catch { return json({ error: "The taste profile request must be valid JSON." }, 400, request); }
  const venues = normalizeVenues(body?.venues);
  if (venues.length < 1 || venues.length > 3) {
    return json({ error: "Enter one to three restaurant names. Only dining interests are accepted." }, 400, request);
  }
  if (!env.QLOO_API_KEY) {
    return json({ error: "Live Qloo mode is not configured. Add an authorized event key to the Site runtime, or switch to Sample profile." }, 503, request);
  }
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  if (!allowRequest(ip)) return json({ error: "Too many live taste requests. Wait a minute and try again." }, 429, request);

  try {
    const resolvedEntities = await Promise.all(venues.map((name) => searchPlace(name, env.QLOO_API_KEY)));
    const ids = resolvedEntities.map((entity) => entity.id);
    const insightsUrl = new URL("/v2/insights", QLOO_ORIGIN);
    insightsUrl.searchParams.set("filter.type", "urn:tag");
    insightsUrl.searchParams.set("filter.parents.types", "urn:entity:place");
    insightsUrl.searchParams.set("signal.interests.entities", ids.join(","));
    insightsUrl.searchParams.set("take", "50");
    const response = await qlooFetch(insightsUrl, env.QLOO_API_KEY);
    const data = await parseQlooJson(response);
    if (!response.ok) return qlooError(response.status);
    const returnedTags = Array.isArray(data?.results?.tags) ? data.results.tags : [];
    const tags = returnedTags.slice(0, 100).map((tag) => ({
      id: String(tag.tag_id || tag.tag_value || "").slice(0, 180),
      name: String(tag.name || tag.tag_value || "").slice(0, 100),
      type: String(tag.subtype || tag.type || "").slice(0, 100),
    })).filter((tag) => tag.name);
    return json({
      mode: "live",
      resolvedEntities,
      tags,
      endpoint: "https://api.qloo.com/v2/insights",
      retrievedAt: new Date().toISOString(),
      source: "Qloo Insights API",
      resultCount: returnedTags.length,
    }, 200, request);
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      return json({ error: "Qloo took too long to respond. No sample data was substituted." }, 504, request);
    }
    const status = error?.status === 422 ? 422 : error?.status === 429 ? 429 : 502;
    return json({ error: safeError(error) }, status, request);
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

async function searchPlace(name, apiKey) {
  const url = new URL("/search", QLOO_ORIGIN);
  url.searchParams.set("query", name);
  url.searchParams.set("types", "urn:entity:place");
  url.searchParams.set("take", "5");
  const response = await qlooFetch(url, apiKey);
  const data = await parseQlooJson(response);
  if (!response.ok) {
    const error = new Error("Entity search did not succeed.");
    error.status = response.status;
    throw error;
  }
  const entities = Array.isArray(data?.results?.entities) ? data.results.entities : [];
  const exact = entities.find((entity) => String(entity.name || "").trim().toLowerCase() === name.toLowerCase());
  const match = exact || entities[0];
  const id = match?.entity_id || match?.id;
  if (!match || !id || !match.name) {
    const error = new Error("Qloo could not resolve one of the supplied dining names. Check spelling or use a supported restaurant entity.");
    error.status = 422;
    throw error;
  }
  return { id: String(id).slice(0, 180), name: String(match.name).slice(0, 100), requestedName: name };
}

async function qlooFetch(url, apiKey) {
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { "accept": "application/json", "X-Api-Key": apiKey },
    signal: AbortSignal.timeout(9000),
  });
  return response;
}

async function parseQlooJson(response) {
  try { return await response.json(); } catch {
    const error = new Error("Qloo returned an unreadable response.");
    error.status = response.status;
    throw error;
  }
}

function qlooError(status) {
  if (status === 401 || status === 403) return json({ error: "Qloo rejected the configured credential. Check the event-issued key and account access." }, 502);
  if (status === 429) return json({ error: "Qloo rate limit reached. Wait before trying again; no retry was made." }, 429);
  return json({ error: "Qloo returned an error (HTTP " + status + "). No sample data was substituted." }, 502);
}

function normalizeVenues(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((name) => String(name || "").trim().replace(/\s+/g, " ").slice(0, 120)).filter(Boolean))].slice(0, 3);
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

function safeError(error) {
  if (error?.status === 422) return error.message;
  if (error?.status === 429) return "Qloo rate limit reached. Wait before trying again; no retry was made.";
  if (error?.status === 401 || error?.status === 403) return "Qloo rejected the configured credential. Check the event-issued key and account access.";
  return error?.message === "Qloo returned an unreadable response."
    ? error.message
    : "The live Qloo request failed. No sample data was substituted.";
}

function json(body, status = 200, request) {
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
  if (request) headers["vary"] = "origin";
  return new Response(JSON.stringify(body), { status, headers });
}
