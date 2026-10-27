/**
 * Duet HTTP server.
 *
 * One process, no framework: static assets plus four JSON endpoints. The Qloo
 * credential lives only here, never in the browser bundle.
 */

import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { createCache } from "./cache.mjs";
import { createDataSource } from "./dataSource.mjs";
import { resolveModel } from "./model.mjs";
import { DuetInputError, parseDuetInput, runDuet } from "./agent.mjs";
import { PRESETS } from "./presets.mjs";
import { TASTE_TYPES } from "./qloo.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = join(ROOT, "public");
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const MAX_BODY_BYTES = 16 * 1024;

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

export function createApp(env = process.env, { now = () => Date.now() } = {}) {
  const data = createDataSource(env);
  const model = resolveModel(env);
  const cache = createCache({ now });
  const limiter = createRateLimiter({ now });

  async function handle(request, response) {
    const url = new URL(request.url, "http://localhost");
    const path = url.pathname;

    try {
      if (path === "/api/health") return await health(response);
      if (path === "/api/presets") return sendJson(response, 200, { presets: PRESETS, tasteTypes: TASTE_TYPES });
      if (path === "/api/search") return await search(request, response, url);
      if (path === "/api/duet") return await duet(request, response);
      if (path.startsWith("/api/")) return sendJson(response, 404, { error: "Unknown endpoint." });
      return serveStatic(request, response, path);
    } catch (error) {
      const status = error instanceof DuetInputError ? 400 : Number(error?.status) || 500;
      const message = status >= 500
        ? (error?.name === "QlooError" ? error.message : "The duet could not be completed. Try again.")
        : error.message;
      if (status >= 500) console.error("[duet]", error?.code ?? "", error?.message ?? error);
      return sendJson(response, status, { error: message, code: error?.code ?? "ERROR" });
    }
  }

  async function health(response) {
    return sendJson(response, 200, {
      status: "ok",
      mode: data.mode,
      qlooConfigured: data.live,
      modelConfigured: model.configured,
      harnessVersion: await data.version(),
      tasteTypes: TASTE_TYPES,
    });
  }

  async function search(request, response, url) {
    if (request.method !== "GET") return sendJson(response, 405, { error: "Use GET." });
    const limit = limiter.allow(`search:${clientIp(request)}`, 40);
    if (!limit.ok) return tooMany(response, limit.retryAfter);
    const query = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
    if (query.length < 2) return sendJson(response, 400, { error: "Type at least two characters." });
    const type = (url.searchParams.get("type") ?? "music").trim().toLowerCase();
    const entityType = TASTE_TYPES.some((entry) => entry.alias === type) ? type : "music";
    const results = await data.search({ query, type: entityType, take: 6 });
    return sendJson(response, 200, { mode: data.mode, results });
  }

  async function duet(request, response) {
    if (request.method !== "POST") return sendJson(response, 405, { error: "Use POST." });
    const limit = limiter.allow(`duet:${clientIp(request)}`, 12);
    if (!limit.ok) return tooMany(response, limit.retryAfter);
    if (!String(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
      return sendJson(response, 415, { error: "Send application/json." });
    }
    const body = await readJsonBody(request);
    const input = parseDuetInput(body);
    const result = await runDuet({ input, data, cache, model });
    return sendJson(response, 200, result);
  }

  async function readJsonBody(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) throw new DuetInputError("That request is too large.");
      chunks.push(chunk);
    }
    if (size === 0) throw new DuetInputError("Send a JSON body.");
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new DuetInputError("That body is not valid JSON.");
    }
  }

  return { handle, data, model, cache };
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
  });
  response.end(body);
}

function tooMany(response, retryAfter) {
  response.setHeader("retry-after", String(retryAfter));
  return sendJson(response, 429, { error: "Slow down for a moment." });
}

function clientIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) return forwarded.split(",")[0].trim();
  return request.socket.remoteAddress ?? "unknown";
}

function serveStatic(request, response, path) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { allow: "GET, HEAD" });
    return response.end();
  }
  const requested = path === "/" ? "/index.html" : path;
  const normalised = normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(PUBLIC_DIR, normalised);
  if (!filePath.startsWith(PUBLIC_DIR + sep) && filePath !== join(PUBLIC_DIR, "index.html")) {
    return sendJson(response, 403, { error: "Forbidden." });
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    // Single-page app: unknown paths fall back to the shell.
    if (!extname(normalised)) return serveFile(request, response, join(PUBLIC_DIR, "index.html"));
    return sendJson(response, 404, { error: "Not found." });
  }
  return serveFile(request, response, filePath);
}

function serveFile(request, response, filePath) {
  const type = CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream";
  const isShell = filePath.endsWith("index.html");
  response.writeHead(200, {
    "content-type": type,
    "cache-control": isShell ? "no-cache" : "public, max-age=3600",
    "x-content-type-options": "nosniff",
    "content-security-policy":
      "default-src 'self'; style-src 'self'; img-src 'self' data:; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  });
  if (request.method === "HEAD") return response.end();
  createReadStream(filePath).pipe(response);
}

/** Fixed-window limiter; the deployment sits behind one process, so in-memory is enough. */
function createRateLimiter({ now = () => Date.now(), windowMs = 60_000 } = {}) {
  const buckets = new Map();
  return {
    allow(key, max) {
      const current = now();
      const bucket = buckets.get(key);
      if (!bucket || current >= bucket.resetAt) {
        buckets.set(key, { count: 1, resetAt: current + windowMs });
        if (buckets.size > 5_000) prune(buckets, current);
        return { ok: true };
      }
      if (bucket.count >= max) return { ok: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - current) / 1000)) };
      bucket.count += 1;
      return { ok: true };
    },
  };
}

function prune(buckets, current) {
  for (const [key, bucket] of buckets) {
    if (current >= bucket.resetAt) buckets.delete(key);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  const server = createServer(app.handle);
  server.listen(PORT, HOST, () => {
    const target = `http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`;
    console.log(`[duet] listening on ${target}`);
    console.log(`[duet] mode: ${app.data.mode}${app.data.live ? "" : " (no QLOO_API_KEY - fixture data)"}`);
    console.log(`[duet] verdict writer: ${app.model.configured ? app.model.provider : "deterministic"}`);
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
