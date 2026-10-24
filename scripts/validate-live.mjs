import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { generatePlan, normalizeScenario, summarizePlan } from "../src/planner.js";
import { normalizeLiveResponse } from "../src/qloo.js";

const WEIGHTS = { tasteSignal: 40, explicitPreference: 28, affordability: 20, preparation: 12 };
const SCENARIO = normalizeScenario({ kitchenCapacity: 200 });

function connection(options = {}) {
  let url;
  try { url = new URL(options.origin); } catch {}
  if (!url || url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))) {
    throw new Error("QLOO_BACKEND_URL must be an HTTPS origin, or a loopback HTTP origin for local development.");
  }
  if (typeof options.token !== "string" || options.token.length < 32) throw new Error("Configure QLOO_BACKEND_TOKEN in the environment before live validation.");
  return { ...options, origin: url.origin, fetcher: options.fetcher || fetch, now: options.now || (() => new Date()) };
}

function profileList(input) {
  if (!Array.isArray(input) || input.length !== 3) throw new Error("Provide exactly three non-personal dining profiles.");
  const profiles = input.map((item) => ({ label: String(item?.label || "").trim().slice(0, 80), venues: item?.venues }));
  if (new Set(profiles.map((item) => item.label.toLowerCase())).size !== 3 || profiles.some((item) => !item.label || !Array.isArray(item.venues) || item.venues.length < 1 || item.venues.length > 3 || item.venues.some((name) => typeof name !== "string" || !name.trim() || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)))) {
    throw new Error("Each profile needs a distinct label and one to three public restaurant names of at most 120 characters.");
  }
  return profiles.map((item) => ({ ...item, venues: item.venues.map((name) => name.trim()) }));
}

function resolvedEntities(value, count) {
  if (!Array.isArray(value) || value.length !== count) return null;
  const entities = value.map((item) => ({ id: item?.id, name: item?.name, requestedName: item?.requestedName, type: "urn:entity:place" }));
  return entities.every((item) => typeof item.id === "string" && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,179}$/.test(item.id) && typeof item.name === "string" && item.name.length > 0 && item.name.length <= 100 && typeof item.requestedName === "string" && item.requestedName.length > 0 && item.requestedName.length <= 120) ? entities : null;
}

async function post(path, body, options) {
  try {
    const response = await options.fetcher(options.origin + path, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { "content-type": "application/json", authorization: "Bearer " + options.token }, body: JSON.stringify(body),
    });
    const payload = await response.json();
    return { ok: response.ok, status: response.status, body: payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {} };
  } catch { return { ok: false, status: null, body: {} }; }
}

export async function resolveProfiles(input, config) {
  const profiles = profileList(input);
  const options = connection(config);
  const results = [];
  for (const profile of profiles) {
    const response = await post("/api/qloo/resolve", { venues: profile.venues }, options);
    const entities = response.ok && response.body.mode === "resolved" && resolvedEntities(response.body.entities, profile.venues.length);
    const suggestions = Array.isArray(response.body.unresolved) ? response.body.unresolved.slice(0, 3).map((item) => ({
      requestedName: String(item?.requestedName || "").slice(0, 120),
      candidates: Array.isArray(item?.candidates) ? item.candidates.slice(0, 5).map((candidate) => String(candidate?.name || "").slice(0, 100)) : [],
    })) : [];
    results.push({ label: profile.label, venues: profile.venues, ...(entities ? { entities } : { error: "Resolution failed; HTTP status " + (response.status ?? "unavailable"), suggestions }) });
  }
  return { version: 1, stage: results.every((item) => item.entities) ? "awaiting-confirmation" : "needs-correction", retrievedAt: options.now().toISOString(), profiles: results };
}

export async function collectConfirmedProfiles(record, config) {
  if (record?.version !== 1 || record.stage !== "awaiting-confirmation") throw new Error("Resolve every profile and review its exact matches before using --confirm.");
  const profiles = profileList(record.profiles);
  for (let index = 0; index < profiles.length; index += 1) {
    profiles[index].entities = resolvedEntities(record.profiles[index].entities, profiles[index].venues.length);
    if (!profiles[index].entities) throw new Error("A saved entity match is invalid; resolve the profiles again.");
  }
  const options = connection(config);
  const baseline = generatePlan(SCENARIO, { weights: WEIGHTS });
  const results = [];
  for (const profile of profiles) {
    const response = await post("/api/qloo/signals", { entities: profile.entities }, options);
    let signal;
    if (response.ok) {
      try { signal = normalizeLiveResponse(response.body); } catch {}
    }
    const ids = profile.entities.map((item) => item.id);
    if (!signal || signal.provenance.entityIds.length !== ids.length || signal.provenance.entityIds.some((id, index) => id !== ids[index])) {
      results.push({ ...profile, error: "Live insights failed or had invalid provenance; HTTP status " + (response.status ?? "unavailable") });
      continue;
    }
    const plan = generatePlan(SCENARIO, { weights: WEIGHTS, signal });
    results.push({ ...profile, signal, plan: { status: plan.status, errors: plan.errors || [], totalCost: plan.totalCost, summary: summarizePlan(plan, signal), menus: plan.days.map((day) => ({ day: day.day, recipeIds: day.items.map((item) => item.recipeId) })) } });
  }
  const valid = results.filter((item) => item.signal);
  const distinctMappings = new Set(valid.map((item) => JSON.stringify([...item.signal.cuisineSignals].sort()))).size;
  return {
    version: 1, stage: "live-evidence", status: valid.length === 3 ? "complete" : "failed", retrievedAt: options.now().toISOString(),
    scenario: SCENARIO, weights: WEIGHTS, baseline: { totalCost: baseline.totalCost, summary: summarizePlan(baseline) }, profiles: results,
    observation: { successfulProfiles: valid.length, distinctCuisineMappings: distinctMappings, allProfilesMapped: valid.length === 3 && valid.every((item) => item.signal.cuisineSignals.length > 0) },
    conclusion: "Review the observed tags, mappings and menus. Successful requests alone do not prove profile distinction or menu quality.",
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log("Resolve: npm run validate:live -- --resolve profiles.json --out resolution.json\nReview the exact matches, then confirm: npm run validate:live -- --confirm resolution.json --out evidence.json\nUses QLOO_BACKEND_URL and QLOO_BACKEND_TOKEN from the environment. Existing output files are preserved.");
    return;
  }
  if (args.length !== 4 || !["--resolve", "--confirm"].includes(args[0]) || args[2] !== "--out") throw new Error("Use --help for the two-step validation workflow.");
  const input = JSON.parse(await readFile(resolve(args[1]), "utf8"));
  const config = { origin: process.env.QLOO_BACKEND_URL, token: process.env.QLOO_BACKEND_TOKEN };
  const result = args[0] === "--resolve" ? await resolveProfiles(input, config) : await collectConfirmedProfiles(input, config);
  const outputPath = resolve(args[3]);
  await writeFile(outputPath, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ stage: result.stage, status: result.status, output: outputPath }));
  if (result.stage === "needs-correction" || result.status === "failed") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error("Live validation could not complete. Check the command, profile file, runtime configuration and output path. Use --help for instructions."); process.exitCode = 1; });
}
