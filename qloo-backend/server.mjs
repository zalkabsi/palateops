import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";

const MAX_BODY_BYTES = 4096;
const MAX_COMMAND_OUTPUT_BYTES = 512 * 1024;
const COMMAND_TIMEOUT_MS = 12_000;
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;
const HARNESS_VERSION = "0.1.26";

export function createQlooBackendHandler({
  env = process.env,
  runHarness = runHarnessCommand,
  now = () => new Date(),
  clock = () => Date.now(),
} = {}) {
  const rateBuckets = new Map();

  return async function handle(request) {
    const url = new URL(request.url);
    if (url.pathname === "/healthz" && request.method === "GET") {
      return json({ status: "ok", qlooConfigured: Boolean(env.QLOO_API_KEY && isStrongBackendToken(env.QLOO_BACKEND_TOKEN)), harnessVersion: HARNESS_VERSION });
    }
    if (url.pathname !== "/api/qloo/resolve" && url.pathname !== "/api/qloo/signals") {
      return json({ error: "Not found." }, 404);
    }
    if (request.method !== "POST") return json({ error: "Use POST for Qloo requests." }, 405);
    if (!isStrongBackendToken(env.QLOO_BACKEND_TOKEN) || !env.QLOO_API_KEY) {
      return json({ error: "The Qloo Harness backend is not configured." }, 503);
    }
    if (!isAuthorized(request.headers.get("authorization"), env.QLOO_BACKEND_TOKEN)) {
      return json({ error: "Unauthorized." }, 401);
    }
    const clientIp = request.headers.get("x-palateops-client-ip") || "unknown";
    if (!allowRequest(rateBuckets, clientIp, clock())) {
      return json({ error: "Too many live taste requests. Wait a minute and try again." }, 429);
    }

    const parsed = await readJsonRequest(request);
    if (parsed.error) return json({ error: parsed.error }, parsed.status);

    try {
      if (url.pathname === "/api/qloo/resolve") {
        const names = normalizeVenueNames(parsed.value?.venues);
        if (names.error) return json({ error: names.error }, 400);
        const entities = await resolveEntities(names.values, runHarness, env);
        if (entities.unresolved.length) {
          return json({
            error: "Review the Qloo search suggestions and enter an exact restaurant name. No taste insights were requested.",
            unresolved: entities.unresolved,
          }, 422);
        }
        return json({ mode: "resolved", entities: entities.resolved });
      }

      const entities = normalizeResolvedEntities(parsed.value?.entities);
      if (entities.error) return json({ error: entities.error }, 400);
      const result = await fetchTasteSignals(entities.values, runHarness, env, now);
      return json(result);
    } catch (error) {
      const status = error instanceof HarnessRequestError ? error.status : 502;
      const message = error instanceof HarnessRequestError
        ? error.message
        : "The Qloo Harness request failed. No sample data was substituted.";
      return json({ error: message }, status);
    }
  };
}

async function resolveEntities(names, runHarness, env) {
  const searchResults = await Promise.all(names.map((name) => runHarnessJson([
    "api", "search", "--query", name, "--type", "restaurant", "--take", "5",
    "--fields", "name,entity_id,subtype", "--json",
  ], runHarness, env)));
  const resolved = [];
  const unresolved = [];

  for (let index = 0; index < names.length; index += 1) {
    const candidates = normalizeSearchResults(searchResults[index]);
    const exact = candidates.filter((candidate) => comparable(candidate.name) === comparable(names[index]));
    if (exact.length !== 1) {
      unresolved.push({ requestedName: names[index], candidates });
      continue;
    }
    resolved.push({ ...exact[0], requestedName: names[index] });
  }
  return { resolved, unresolved };
}

async function fetchTasteSignals(entities, runHarness, env, now) {
  const ids = entities.map((entity) => entity.id).join(",");
  const rows = await runHarnessJson([
    "api", "insights", "--type", "restaurant", "--signal-entities", ids,
    "--take", "10", "--fields", "name,entity_id,subtype,tags", "--json",
  ], runHarness, env);
  const recommendations = normalizeInsightResults(rows);
  const tags = collectTags(recommendations);
  return {
    mode: "live",
    source: "Qloo Hackathon Harness (qloo api)",
    endpoint: "https://api.qloo.com/v2/insights",
    retrievedAt: now().toISOString(),
    resolvedEntities: entities,
    recommendations,
    tags,
    resultCount: recommendations.length,
  };
}

async function runHarnessJson(args, runHarness, env) {
  let result;
  try {
    result = await runHarness(args, {
      env,
      timeoutMs: COMMAND_TIMEOUT_MS,
      maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES,
    });
  } catch (error) {
    if (error?.code === "ETIMEDOUT" || error?.name === "TimeoutError") {
      throw new HarnessRequestError(504, "The Qloo Harness took too long to respond. No sample data was substituted.");
    }
    throw new HarnessRequestError(502, "The Qloo Harness could not complete the request.");
  }

  let payload;
  try {
    payload = JSON.parse(String(result.stdout || "").trim());
  } catch {
    throw new HarnessRequestError(502, "The Qloo Harness returned an unreadable result.");
  }
  if (result.exitCode !== 0) {
    const code = String(payload?.code || payload?.error?.code || "").toUpperCase();
    if (code.includes("AUTH")) throw new HarnessRequestError(503, "Qloo rejected the event-issued credential. Check the authorized key and access window.");
    if (code.includes("RATE")) throw new HarnessRequestError(429, "Qloo rate limit reached. Wait before trying again; no retry was made.");
    if (code.includes("NOT_FOUND")) throw new HarnessRequestError(422, "Qloo could not resolve that restaurant. Check the spelling or enter a supported place.");
    throw new HarnessRequestError(502, "The Qloo Harness request failed. No sample data was substituted.");
  }
  return payload;
}

function normalizeSearchResults(payload) {
  const rows = Array.isArray(payload) ? payload : payload?.results?.entities || payload?.results || [];
  if (!Array.isArray(rows)) throw new HarnessRequestError(502, "Qloo search returned an unexpected result shape.");
  return rows.slice(0, 5).map((row) => ({
    id: String(row?.entity_id || row?.id || "").slice(0, 180),
    name: String(row?.name || "").trim().slice(0, 100),
    type: String(row?.subtype || row?.type || "urn:entity:place").slice(0, 100),
  })).filter((row) => row.id && row.name);
}

function normalizeInsightResults(payload) {
  const rows = Array.isArray(payload) ? payload : payload?.results?.entities || payload?.results || [];
  if (!Array.isArray(rows)) throw new HarnessRequestError(502, "Qloo Insights returned an unexpected result shape.");
  return rows.slice(0, 10).map((row, index) => ({
    id: String(row?.entity_id || row?.id || "").slice(0, 180),
    name: String(row?.name || "").trim().slice(0, 100),
    rank: index + 1,
    tags: Array.isArray(row?.tags) ? row.tags.slice(0, 100) : [],
  })).filter((row) => row.id && row.name);
}

function collectTags(recommendations) {
  const found = new Map();
  for (const recommendation of recommendations) {
    for (const raw of recommendation.tags) {
      const tag = {
        id: String(raw?.id || raw?.tag_id || raw?.tag_value || "").slice(0, 180),
        name: String(raw?.name || raw?.tag_value || "").trim().slice(0, 100),
        type: String(raw?.type || raw?.subtype || "").slice(0, 100),
      };
      if (!tag.name) continue;
      const key = tag.id || tag.name.toLocaleLowerCase("en-US");
      const prior = found.get(key);
      if (prior) prior.sourceEntityIds.push(recommendation.id);
      else found.set(key, { ...tag, sourceEntityIds: [recommendation.id] });
    }
  }
  return [...found.values()].slice(0, 100);
}

function normalizeVenueNames(value) {
  if (!Array.isArray(value)) return { error: "Enter one to three restaurant names." };
  const names = [];
  for (const raw of value) {
    if (typeof raw !== "string") return { error: "Restaurant names must be text." };
    const name = raw.trim().replace(/\s+/g, " ");
    if (!name) continue;
    if (name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) return { error: "Each restaurant name must be 120 characters or fewer and contain no control characters." };
    if (!names.some((existing) => comparable(existing) === comparable(name))) names.push(name);
  }
  if (names.length < 1 || names.length > 3) return { error: "Enter one to three restaurant names." };
  return { values: names };
}

function normalizeResolvedEntities(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
    return { error: "Confirm one to three resolved restaurant matches before requesting insights." };
  }
  const entities = [];
  for (const raw of value) {
    const id = typeof raw?.id === "string" ? raw.id.trim() : "";
    const name = typeof raw?.name === "string" ? raw.name.trim().replace(/\s+/g, " ") : "";
    const requestedName = typeof raw?.requestedName === "string" ? raw.requestedName.trim().slice(0, 120) : name;
    if (!id || id.length > 180 || !/^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(id) || !name || name.length > 100) {
      return { error: "A resolved restaurant match was invalid. Resolve the names again before requesting insights." };
    }
    entities.push({ id, name, requestedName, type: String(raw?.type || "urn:entity:place").slice(0, 100) });
  }
  return { values: entities };
}

async function readJsonRequest(request) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") return { status: 415, error: "The Qloo request must use application/json." };
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) return { status: 413, error: "The Qloo request is too large." };
  try {
    const text = await readBodyWithLimit(request, MAX_BODY_BYTES);
    if (text === null) return { status: 413, error: "The Qloo request is too large." };
    return { value: JSON.parse(text) };
  } catch {
    return { status: 400, error: "The Qloo request must be valid JSON." };
  }
}

async function readBodyWithLimit(request, maxBytes) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch {}
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function isAuthorized(header, expectedToken) {
  if (!isStrongBackendToken(expectedToken) || typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice(7));
  const expected = Buffer.from(expectedToken);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function isStrongBackendToken(value) {
  return typeof value === "string" && value.length >= 32;
}

function allowRequest(buckets, ip, nowMs) {
  const recent = (buckets.get(ip) || []).filter((time) => nowMs - time < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) return false;
  recent.push(nowMs);
  buckets.set(ip, recent);
  if (buckets.size > 500) {
    for (const [key, times] of buckets) if (!times.some((time) => nowMs - time < RATE_WINDOW_MS)) buckets.delete(key);
  }
  return true;
}

function comparable(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

class HarnessRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export function runHarnessCommand(args, { env = process.env, timeoutMs = COMMAND_TIMEOUT_MS, maxOutputBytes = MAX_COMMAND_OUTPUT_BYTES } = {}) {
  const command = env.QLOO_CLI_BIN || "qloo";
  const childEnv = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "TEMP", "NO_COLOR", "CI", "QLOO_API_KEY", "QLOO_HOME"]) {
    if (env[key] !== undefined) childEnv[key] = env[key];
  }
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: childEnv, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let outputBytes = 0;
    let overflow = false;
    let timedOut = false;
    let stderrBytes = 0;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    timer.unref?.();
    child.stdout.on("data", (chunk) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > maxOutputBytes) {
        overflow = true;
        child.kill("SIGKILL");
        return;
      }
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => { stderrBytes += chunk.byteLength; });
    child.once("error", (error) => {
      clearTimeout(timer);
      const failure = new Error("Could not start the Qloo Harness process.");
      failure.code = error.code;
      reject(failure);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        const error = new Error("Qloo Harness command timed out.");
        error.code = "ETIMEDOUT";
        reject(error);
      } else if (overflow) {
        reject(new Error("Qloo Harness output exceeded the response limit."));
      } else {
        resolve({ exitCode: code, stdout, stderrBytes });
      }
    });
  });
}

async function serve() {
  const handler = createQlooBackendHandler();
  const port = Number(process.env.PORT || 8788);
  const server = createServer(async (incoming, outgoing) => {
    try {
      const method = incoming.method || "GET";
      const body = method === "GET" || method === "HEAD" ? undefined : Readable.toWeb(incoming);
      const request = new Request(new URL(incoming.url || "/", "http://localhost"), {
        method,
        headers: incoming.headers,
        ...(body ? { body, duplex: "half" } : {}),
      });
      const response = await handler(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      outgoing.end(await response.text());
    } catch {
      outgoing.writeHead(500, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      outgoing.end(JSON.stringify({ error: "The Qloo backend could not process the request." }));
    }
  });
  server.listen(port, "0.0.0.0", () => process.stdout.write("PalateOps Qloo backend listening on port " + port + "\n"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  serve();
}
