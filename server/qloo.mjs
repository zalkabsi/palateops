/**
 * Defensive wrapper around the official Qloo Harness CLI.
 *
 * The hackathon kit restricts live calls to the `qloo` surfaces (`qloo api`,
 * `qloo exec`, `qloo mcp`). This module shells out to `qloo api` and normalises
 * its JSON so the rest of the app never touches raw provider shapes.
 *
 * Design rules:
 *  - Never log or return the credential.
 *  - Never invent numbers: a missing affinity stays `null`.
 *  - Every provider failure becomes a typed QlooError with a safe message.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const HARNESS_MIN_VERSION = "0.1.26";
export const DEFAULT_SEARCH_LIMIT = 8;
export const DEFAULT_VENUE_LIMIT = 30;

/**
 * Hackathon keys only work against this host. Using the production or staging
 * host with an event key returns 401 even when the key is valid - the single
 * most common integration mistake in the event guide.
 */
export const HACKATHON_BASE_URL = "https://hackathon.api.qloo.com";

const DEFAULT_TIMEOUT_MS = 25_000;
// The guide states field filtering is not supported, so insights responses are
// verbose. Allow generous headroom rather than truncating a valid payload.
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

/** Taste domains offered in the profile builder. Alias maps to a Qloo entity URN. */
export const TASTE_TYPES = Object.freeze([
  { alias: "music", label: "Music", noun: "artist" },
  { alias: "movie", label: "Film", noun: "film" },
  { alias: "tv", label: "TV", noun: "show" },
  { alias: "book", label: "Books", noun: "book" },
  { alias: "brand", label: "Brands", noun: "brand" },
  { alias: "videogame", label: "Games", noun: "game" },
  { alias: "podcast", label: "Podcasts", noun: "podcast" },
]);

const TASTE_ALIASES = new Set(TASTE_TYPES.map((entry) => entry.alias));

export class QlooError extends Error {
  constructor(message, { code = "QLOO_ERROR", status = 502, retryable = false } = {}) {
    super(message);
    this.name = "QlooError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

/** True when a Qloo credential is present in the environment. */
export function isLiveConfigured(env = process.env) {
  const key = typeof env.QLOO_API_KEY === "string" ? env.QLOO_API_KEY.trim() : "";
  return key.length >= 8;
}

/**
 * Locate the harness entry point.
 * Preference order: explicit override, project dependency, global binary.
 */
export function resolveHarness(env = process.env) {
  const explicit = typeof env.QLOO_HARNESS_ENTRY === "string" ? env.QLOO_HARNESS_ENTRY.trim() : "";
  if (explicit && existsSync(explicit)) {
    return { command: process.execPath, prefixArgs: [explicit], label: "QLOO_HARNESS_ENTRY" };
  }
  const local = join(ROOT, "node_modules", "@qloo", "qloo-harness", "dist", "bin.js");
  if (existsSync(local)) {
    return { command: process.execPath, prefixArgs: [local], label: "@qloo/qloo-harness" };
  }
  return { command: "qloo", prefixArgs: [], label: "qloo (PATH)" };
}

/**
 * Resolve the environment the harness should run with.
 *
 * The harness refuses a non-official base URL unless it is explicitly trusted,
 * so a hackathon base URL must be paired with QLOO_TRUSTED_BASE_URL. Doing that
 * here means a deployment cannot half-configure itself into a confusing 401.
 */
export function harnessEnv(env = process.env) {
  const baseUrl = (typeof env.QLOO_BASE_URL === "string" && env.QLOO_BASE_URL.trim()) || "";
  const trusted = (typeof env.QLOO_TRUSTED_BASE_URL === "string" && env.QLOO_TRUSTED_BASE_URL.trim()) || baseUrl;
  return {
    ...env,
    NO_COLOR: "1",
    QLOO_NO_UPDATE_CHECK: "1",
    ...(baseUrl ? { QLOO_BASE_URL: baseUrl, QLOO_TRUSTED_BASE_URL: trusted } : {}),
  };
}

/**
 * Run the harness and capture stdout. Rejects with QlooError on transport failure.
 */
export function runHarness(args, { env = process.env, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const harness = resolveHarness(env);
  return new Promise((resolvePromise, reject) => {
    execFile(
      harness.command,
      [...harness.prefixArgs, ...args],
      {
        timeout: timeoutMs,
        maxBuffer: MAX_OUTPUT_BYTES,
        windowsHide: true,
        env: harnessEnv(env),
      },
      (error, stdout, stderr) => {
        // The harness reports provider failures as JSON on stdout with exit 0 or
        // a non-zero code, so always give the payload a chance to explain itself.
        const fromPayload = safeParseHarnessJson(stdout);
        if (fromPayload && fromPayload.error === true) {
          reject(toQlooError(fromPayload));
          return;
        }
        if (error) {
          if (error.killed || error.signal === "SIGTERM") {
            reject(new QlooError("The Qloo request timed out. Try a narrower search.", { code: "TIMEOUT", status: 504, retryable: true }));
            return;
          }
          if (error.code === "ENOENT") {
            reject(new QlooError("The Qloo Harness is not installed in this container.", { code: "HARNESS_MISSING", status: 503 }));
            return;
          }
          const detail = summarise(stderr) || summarise(stdout) || error.message;
          reject(new QlooError(`The Qloo Harness failed: ${detail}`, { code: "HARNESS_FAILED", status: 502, retryable: true }));
          return;
        }
        if (fromPayload) {
          resolvePromise(fromPayload);
          return;
        }
        resolvePromise(stdout);
      },
    );
  });
}

/**
 * Parse harness stdout. The CLI prints a first-run banner before its JSON when
 * the credential is missing, so locate the first JSON line instead of assuming
 * stdout is pure JSON.
 */
export function parseHarnessJson(stdout) {
  const payload = safeParseHarnessJson(stdout);
  if (payload === null) {
    const text = String(stdout ?? "").trim();
    if (/set your api key|qloo setup/i.test(text)) {
      throw new QlooError("No Qloo credential is configured for this deployment.", { code: "NOT_CONFIGURED", status: 503 });
    }
    throw new QlooError(
      text ? `The Qloo Harness returned an unexpected response: ${summarise(text)}` : "The Qloo Harness returned no output.",
      { code: "BAD_OUTPUT", status: 502, retryable: true },
    );
  }
  if (payload.error === true) throw toQlooError(payload);
  return payload;
}

function safeParseHarnessJson(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) return null;
  const match = text.match(/^[[{]/m);
  if (!match) return null;
  const candidate = text.slice(match.index).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function toQlooError(payload) {
  const message = summarise(payload.message) || "The Qloo request failed.";
  const code = typeof payload.code === "string" ? payload.code : "QLOO_ERROR";
  const authProblem = /40[13]|unauthori[sz]ed|forbidden|invalid api key|api key|credential/i.test(message);
  const quotaProblem = /429|rate.?limit|quota|too many/i.test(message);
  if (quotaProblem) {
    return new QlooError("The Qloo quota for this event is exhausted or rate limited. Try again shortly.", { code, status: 429, retryable: true });
  }
  if (authProblem) {
    return new QlooError("Qloo rejected the credential for this deployment. Check QLOO_API_KEY.", { code, status: 503 });
  }
  if (/404|not found/i.test(message)) {
    return new QlooError("Qloo found no match for that request.", { code, status: 404 });
  }
  return new QlooError(message, { code, status: 502, retryable: true });
}

function summarise(value) {
  const text = typeof value === "string" ? value : value == null ? "" : String(value);
  return text.replace(/\s+/g, " ").trim().slice(0, 280);
}

/**
 * Reduce one raw Qloo entity to the fields this app actually uses.
 * Unknown shapes degrade to `null` rather than throwing.
 */
export function normalizeEntity(raw, { includeTags = true } = {}) {
  if (!raw || typeof raw !== "object") return null;
  const id = text(raw.entity_id ?? raw.id ?? raw.tag_id);
  const name = text(raw.name ?? raw.resolved);
  if (!id || !name) return null;

  const tags = includeTags && Array.isArray(raw.tags)
    ? raw.tags
      .map((tag) => ({ id: text(tag?.id ?? tag?.tag_id), name: text(tag?.name), type: text(tag?.type) }))
      .filter((tag) => tag.name)
    : [];

  return {
    id,
    name,
    subtype: text(raw.subtype) || "urn:entity:place",
    popularity: numeric(raw.popularity),
    affinity: pickAffinity(raw),
    priceLevel: integer(raw.properties?.price_level ?? raw.price_level),
    address: text(raw.address?.formatted) || text(raw.properties?.address?.formatted) || text(raw.address),
    tags,
  };
}

function pickAffinity(raw) {
  const candidates = [raw.affinity, raw.score, raw.query?.affinity, raw.query?.measurements?.affinity];
  for (const candidate of candidates) {
    const value = numeric(candidate);
    if (value !== null && value >= 0 && value <= 1) return value;
  }
  return null;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function numeric(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Extract an entity list from either a bare array or a `{results:{entities}}` envelope. */
export function extractEntities(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.results?.entities)) return payload.results.entities;
  if (payload && Array.isArray(payload.entities)) return payload.entities;
  return [];
}

/** Search Qloo for candidate taste signals. */
export async function searchEntities({ query, type, take = DEFAULT_SEARCH_LIMIT }, options = {}) {
  const safeQuery = text(query).slice(0, 120);
  if (!safeQuery) throw new QlooError("Type something to search Qloo.", { code: "EMPTY_QUERY", status: 400 });
  const safeType = TASTE_ALIASES.has(type) ? type : "";
  // Field filtering is not supported by the event API, so ask for the default
  // payload and reduce it locally.
  const args = ["api", "search", "--query", safeQuery, "--take", String(clampInt(take, 1, 12, DEFAULT_SEARCH_LIMIT)), "--json"];
  if (safeType) args.splice(2, 0, "--type", safeType);
  const payload = await runHarness(args, options);
  return extractEntities(payload)
    .map((entity) => normalizeEntity(entity, { includeTags: false }))
    .filter(Boolean);
}

/**
 * Ask Qloo which venues in `city` best match one person's taste signals.
 * Accepts either resolved signal objects or bare entity IDs.
 */
export async function recommendPlaces({ signals, city, take = DEFAULT_VENUE_LIMIT, maxPriceLevel = null }, options = {}) {
  const ids = (Array.isArray(signals) ? signals : [])
    .map((signal) => (typeof signal === "string" ? signal : signal?.id))
    .map(text)
    .filter(Boolean)
    .slice(0, 8);
  if (ids.length === 0) throw new QlooError("Add at least one taste signal first.", { code: "EMPTY_SIGNALS", status: 400 });
  const safeCity = text(city).slice(0, 80);
  const args = [
    "api", "insights",
    "--type", "restaurant",
    "--signal-entities", ids.join(","),
    "--take", String(clampInt(take, 5, 50, DEFAULT_VENUE_LIMIT)),
    "--json",
  ];
  if (safeCity) args.push("--filter-location", safeCity);
  // The CLI has no price flag, but `--params` merges raw documented parameters.
  if (Number.isInteger(maxPriceLevel) && maxPriceLevel >= 1 && maxPriceLevel <= 4) {
    args.push("--params", JSON.stringify({ "filter.price_level.max": maxPriceLevel }));
  }
  const payload = await runHarness(args, options);
  return extractEntities(payload)
    .map((entity) => normalizeEntity(entity))
    .filter(Boolean);
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

/** Version probe used by `/api/health` and the deploy check. */
export async function harnessVersion(options = {}) {
  try {
    const output = await runHarness(["--version"], { ...options, timeoutMs: 8_000 });
    return String(output ?? "").trim().split("\n").pop() || "unknown";
  } catch {
    return "unavailable";
  }
}

function integer(value) {
  return Number.isInteger(value) ? value : null;
}
