/**
 * The duet agent.
 *
 * Runs a fixed, observable tool sequence:
 *   1. resolve each person's signals to Qloo entity IDs
 *   2. ask Qloo for that person's best venues in the city
 *   3. join both rankings with the compromise rule
 *   4. read the shared and divergent taste vocabulary
 *   5. write the verdict (model-assisted when a model is configured)
 *
 * Every step is timed and recorded so the UI can show what actually happened.
 * A model never invents numbers: it only receives computed evidence and returns
 * prose. The deterministic path produces the same structure without a model.
 */

import { compareTaste, joinCandidates, summarize, tagProfile } from "./compromise.mjs";
import { cacheKey } from "./cache.mjs";
import { narrate } from "./narrate.mjs";
import { requestNarration } from "./model.mjs";

export const MAX_SIGNALS_PER_PERSON = 6;
export const VENUE_LIMIT = 30;

export class DuetInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "DuetInputError";
    this.status = 400;
  }
}

/** Validate and normalise the request body. */
export function parseDuetInput(body) {
  if (!body || typeof body !== "object") throw new DuetInputError("Send a JSON body.");
  const city = typeof body.city === "string" ? body.city.trim().slice(0, 80) : "";
  if (city.length < 2) throw new DuetInputError("Choose a city so Qloo can rank real places.");
  const a = parseSide(body.a, "first person");
  const b = parseSide(body.b, "second person");
  return { city, a, b };
}

function parseSide(side, position) {
  if (!side || typeof side !== "object") throw new DuetInputError(`Add a taste profile for the ${position}.`);
  const label = (typeof side.label === "string" ? side.label.trim() : "").slice(0, 24) || "Someone";
  const rawSignals = Array.isArray(side.signals) ? side.signals : [];
  const signals = [];
  for (const signal of rawSignals) {
    const name = typeof signal?.name === "string" ? signal.name.trim().slice(0, 120) : "";
    const type = typeof signal?.type === "string" ? signal.type.trim().toLowerCase() : "";
    const id = typeof signal?.id === "string" ? signal.id.trim().slice(0, 180) : "";
    if (!name) continue;
    const duplicate = signals.some((entry) => entry.name.toLowerCase() === name.toLowerCase() && entry.type === type);
    if (duplicate) continue;
    signals.push({ name, type: type || "music", id });
    if (signals.length >= MAX_SIGNALS_PER_PERSON) break;
  }
  if (signals.length === 0) throw new DuetInputError(`Add at least one taste signal for the ${position}.`);
  return { label, signals };
}

/**
 * Run one duet.
 *
 * @param {object} options
 * @param {{city:string,a:object,b:object}} options.input
 * @param {ReturnType<import("./dataSource.mjs").createDataSource>} options.data
 * @param {ReturnType<import("./cache.mjs").createCache>} options.cache
 * @param {object|null} options.model configured model provider, or null
 */
export async function runDuet({ input, data, cache, model = null }) {
  const trace = [];
  const calls = [];

  const step = async (tool, label, run) => {
    const startedAt = Date.now();
    const entry = { tool, label, startedAt: new Date().toISOString() };
    try {
      const result = await run();
      entry.ok = true;
      entry.ms = Date.now() - startedAt;
      entry.detail = describe(result);
      trace.push(entry);
      return result;
    } catch (error) {
      entry.ok = false;
      entry.ms = Date.now() - startedAt;
      entry.detail = error?.message ?? "failed";
      trace.push(entry);
      throw error;
    }
  };

  step.record = () => trace;
  step.calls = () => calls;

  const resolveSide = async (side, key) => {
    const resolved = [];
    for (const signal of side.signals) {
      if (signal.id) {
        resolved.push({ ...signal });
        continue;
      }
      const cacheId = cacheKey("resolve", signal.type, signal.name);
      const value = await step("search", `Resolve "${signal.name}" to a Qloo entity`, async () => {
        const hit = await cache.wrap(cacheId, async () => data.search({ query: signal.name, type: signal.type, take: 1 }));
        calls.push({ tool: "qloo api search", args: { query: signal.name, type: signal.type, take: 1 }, cached: hit.hit });
        return hit.value;
      });
      const entity = Array.isArray(value) ? value[0] : null;
      if (!entity?.id) {
        trace.push({ tool: "search", label: `No Qloo match for "${signal.name}"`, ok: false, ms: 0, detail: "skipped" });
        continue;
      }
      resolved.push({ name: entity.name, type: signal.type, id: entity.id, resolvedFrom: signal.name });
    }
    if (resolved.length === 0) {
      throw new DuetInputError(`None of ${side.label}'s signals could be matched to a Qloo entity. Try different names.`);
    }
    return resolved;
  };

  const resolvedA = await resolveSide(input.a, "a");
  const resolvedB = await resolveSide(input.b, "b");

  const fetchVenues = async (side, resolved) => step("score_places", `Rank places in ${input.city} for ${side.label}`, async () => {
    const ids = resolved.map((signal) => signal.id).sort();
    const key = cacheKey("places", ids, input.city, VENUE_LIMIT);
    const { value, hit } = await cache.wrap(key, async () => data.recommend({ signals: resolved, city: input.city, take: VENUE_LIMIT }));
    calls.push({ tool: "qloo api insights", args: { type: "restaurant", signals: ids.length, city: input.city, take: VENUE_LIMIT }, cached: hit });
    return value;
  });

  const placesA = await fetchVenues(input.a, resolvedA);
  const placesB = await fetchVenues(input.b, resolvedB);

  const venues = joinCandidates(placesA, placesB);
  const summary = summarize(venues);
  const taste = compareTaste(tagProfile(byPerson(venues, "affinityA")), tagProfile(byPerson(venues, "affinityB")));
  const deterministic = narrate({ summary, taste, venues, a: input.a, b: input.b, city: input.city });

  let narration = deterministic;
  let narrationSource = "rules";
  if (model?.configured) {
    const generated = await step("write_verdict", "Write the verdict", () =>
      requestNarration({ model, evidence: { city: input.city, a: input.a, b: input.b, summary, taste, venues: venues.slice(0, 6) } }));
    if (generated) {
      narration = generated;
      narrationSource = model.provider ?? "model";
    }
  }

  return {
    mode: data.mode,
    city: input.city,
    generatedAt: new Date().toISOString(),
    people: {
      a: { label: input.a.label, signals: resolvedA, pool: placesA.length },
      b: { label: input.b.label, signals: resolvedB, pool: placesB.length },
    },
    venues,
    groups: {
      both: venues.filter((venue) => venue.bucket === "both").slice(0, 6),
      middle: venues.filter((venue) => venue.bucket === "middle").slice(0, 6),
      trade: venues.filter((venue) => venue.bucket === "trade").slice(0, 6),
    },
    taste,
    summary,
    narration,
    narrationSource,
    trace,
    provenance: {
      mode: data.mode,
      calls: calls.map((call, index) => ({ ...call, index: index + 1 })),
      venueCount: venues.length,
      rule: "Scores are Qloo affinities when provided, otherwise Qloo rank position. The pair is combined with a harmonic mean.",
    },
  };
}

function byPerson(venues, key) {
  return venues
    .map((venue) => ({ ...venue, score: venue[key] }))
    .filter((venue) => venue.score > 0)
    .sort((left, right) => right.score - left.score);
}

function describe(result) {
  if (Array.isArray(result)) return `${result.length} result${result.length === 1 ? "" : "s"}`;
  return "done";
}

export { tagProfile };
