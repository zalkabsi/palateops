/**
 * PalateOps agent.
 *
 * Job: produce one place a group of 2-5 people can actually agree on, and be
 * honest when that place does not exist under the current constraints.
 *
 * The loop is plan -> act -> observe -> revise. Qloo is asked to rank places
 * once per person, never once for the group, because averaging people away is
 * the exact failure this product exists to fix. If no place clears everybody,
 * the agent does not shrug: it relaxes one constraint, re-asks Qloo, and says
 * what it gave up.
 *
 * Tools are injected, so the whole loop is testable without a network, and a
 * model policy can later choose the relaxations instead of the fixed policy.
 */

import { compareTaste, joinCandidates, summarize, tagProfile } from "./compromise.mjs";
import { cacheKey } from "./cache.mjs";
import { narrate } from "./narrate.mjs";
import { requestNarration, requestRelaxation } from "./model.mjs";

export const MAX_PEOPLE = 5;
export const MIN_PEOPLE = 2;
export const MAX_SIGNALS_PER_PERSON = 6;
export const VENUE_LIMIT = 30;

/** Constraints the agent is allowed to loosen, in the order it loosens them. */
export const RELAXATIONS = Object.freeze([
  {
    id: "price",
    label: "Removed the price ceiling",
    reason: "No place cleared everyone inside the budget, so the ceiling was dropped.",
    apply: (constraints) => (constraints.maxPriceLevel == null ? null : { ...constraints, maxPriceLevel: null }),
  },
  {
    id: "depth",
    label: "Looked deeper into each ranking",
    reason: "Still no shared place, so the agent asked Qloo for a deeper list per person.",
    apply: (constraints) => (constraints.take >= 50 ? null : { ...constraints, take: 50 }),
  },
]);

export class PlanInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "PlanInputError";
    this.status = 400;
  }
}

/** Validate and normalise the request body. */
export function parsePlanInput(body) {
  if (!body || typeof body !== "object") throw new PlanInputError("Send a JSON body.");
  const city = typeof body.city === "string" ? body.city.trim().slice(0, 80) : "";
  if (city.length < 2) throw new PlanInputError("Choose a city so Qloo can rank real places.");

  const rawPeople = Array.isArray(body.people) ? body.people : [];
  if (rawPeople.length < MIN_PEOPLE) throw new PlanInputError(`Add at least ${MIN_PEOPLE} people — a compromise needs two sides.`);
  if (rawPeople.length > MAX_PEOPLE) throw new PlanInputError(`This works with up to ${MAX_PEOPLE} people.`);

  const people = rawPeople.map((person, index) => parsePerson(person, index));
  const maxPriceLevel = Number.isInteger(body.maxPriceLevel) && body.maxPriceLevel >= 1 && body.maxPriceLevel <= 4
    ? body.maxPriceLevel
    : null;

  return { city, people, constraints: { maxPriceLevel, take: VENUE_LIMIT } };
}

function parsePerson(person, index) {
  if (!person || typeof person !== "object") throw new PlanInputError(`Person ${index + 1} is missing a taste profile.`);
  const label = (typeof person.label === "string" ? person.label.trim() : "").slice(0, 24) || `Person ${index + 1}`;
  const rawSignals = Array.isArray(person.signals) ? person.signals : [];
  const signals = [];
  for (const signal of rawSignals) {
    const name = typeof signal?.name === "string" ? signal.name.trim().slice(0, 120) : "";
    const type = typeof signal?.type === "string" ? signal.type.trim().toLowerCase() : "music";
    const id = typeof signal?.id === "string" ? signal.id.trim().slice(0, 180) : "";
    if (!name) continue;
    if (signals.some((entry) => entry.name.toLowerCase() === name.toLowerCase() && entry.type === type)) continue;
    signals.push({ name, type, id });
    if (signals.length >= MAX_SIGNALS_PER_PERSON) break;
  }
  if (signals.length === 0) throw new PlanInputError(`Add at least one taste signal for ${label}.`);
  return { label, signals };
}

/**
 * Run one plan.
 *
 * @param {object} options
 * @param {{city:string, people:object[], constraints:object}} options.input
 * @param {ReturnType<import("./dataSource.mjs").createDataSource>} options.data
 * @param {ReturnType<import("./cache.mjs").createCache>} options.cache
 * @param {object|null} options.model
 */
export async function runPlan({ input, data, cache, model = null }) {
  const trace = [];
  const calls = [];
  const decisions = [];

  const step = async (tool, label, run) => {
    const startedAt = Date.now();
    const entry = { tool, label, at: new Date().toISOString() };
    try {
      const result = await run();
      entry.ok = true;
      entry.ms = Date.now() - startedAt;
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

  // ---- 1. resolve every person's taste into Qloo entities ------------------
  const resolvedPeople = [];
  for (const person of input.people) {
    const resolved = [];
    for (const signal of person.signals) {
      if (signal.id) { resolved.push({ ...signal }); continue; }
      const key = cacheKey("resolve", signal.type, signal.name);
      const found = await step("search", `Resolve "${signal.name}" for ${person.label}`, async () => {
        const { value, hit } = await cache.wrap(key, async () => data.search({ query: signal.name, type: signal.type, take: 1 }));
        calls.push({ tool: "qloo api search", args: { query: signal.name, type: signal.type, take: 1 }, cached: hit });
        return value;
      });
      const entity = Array.isArray(found) ? found[0] : null;
      if (!entity?.id) {
        trace.push({ tool: "search", label: `No Qloo match for "${signal.name}"`, ok: false, ms: 0, detail: "skipped" });
        continue;
      }
      resolved.push({ name: entity.name, type: signal.type, id: entity.id, resolvedFrom: signal.name });
    }
    if (resolved.length === 0) {
      throw new PlanInputError(`None of ${person.label}'s signals could be matched to a Qloo entity. Try different names.`);
    }
    resolvedPeople.push({ label: person.label, signals: resolved });
  }

  // ---- 2. plan / act / observe, relaxing until somebody can win -----------
  const initialConstraints = { ...input.constraints };
  let constraints = { ...initialConstraints };
  const attempts = [];

  const rankEveryone = async (active) => {
    const lists = [];
    for (const person of resolvedPeople) {
      const ids = person.signals.map((signal) => signal.id).sort();
      const key = cacheKey("places", ids, input.city, active.take, active.maxPriceLevel ?? "any");
      const places = await step(
        "rank_places",
        `Rank places in ${input.city} for ${person.label}${active.maxPriceLevel ? ` (≤ level ${active.maxPriceLevel})` : ""}`,
        async () => {
          const { value, hit } = await cache.wrap(key, async () => data.recommend({
            signals: person.signals,
            city: input.city,
            take: active.take,
            maxPriceLevel: active.maxPriceLevel,
          }));
          calls.push({
            tool: "qloo api insights",
            args: { type: "restaurant", signals: ids.length, city: input.city, take: active.take, maxPriceLevel: active.maxPriceLevel },
            cached: hit,
          });
          return value;
        },
      );
      lists.push({ label: person.label, entities: places });
    }
    return joinCandidates(lists);
  };

  let joined = await rankEveryone(constraints);
  let summary = summarize(joined.venues, resolvedPeople.length);
  attempts.push({ constraints: { ...constraints }, everyoneCount: summary.everyoneCount, total: summary.total });

  // Observe, then decide what - if anything - to surrender. A configured model
  // makes that choice; otherwise the fixed ladder does. Neither can loop forever.
  const surrendered = new Set();
  while (summary.everyoneCount === 0) {
    const remaining = RELAXATIONS.filter((entry) => !surrendered.has(entry.id) && entry.apply(constraints) !== null);
    if (remaining.length === 0) break;

    let chosen = null;
    if (model?.configured) {
      const startedAt = Date.now();
      chosen = await requestRelaxation({
        model,
        options: remaining.map((entry) => ({ id: entry.id, label: entry.label, effect: entry.reason })),
        evidence: {
          city: input.city,
          constraints,
          people: resolvedPeople.map((person) => person.label),
          places_seen: summary.total,
          shared_so_far: summary.everyoneCount,
          best_available: joined.venues.slice(0, 3).map((venue) => ({ name: venue.name, scores: venue.scores })),
        },
      });
      trace.push({
        tool: "decide_relaxation",
        label: chosen ? `Model chose to relax: ${chosen}` : "Model deferred to the default order",
        ok: true,
        ms: Date.now() - startedAt,
      });
    }

    const relaxation = remaining.find((entry) => entry.id === chosen) ?? remaining[0];
    const next = relaxation.apply(constraints);
    if (!next) break;
    surrendered.add(relaxation.id);
    constraints = next;
    decisions.push({
      kind: "relax",
      id: relaxation.id,
      label: relaxation.label,
      reason: relaxation.reason,
      by: chosen === relaxation.id ? "model" : "rules",
    });
    trace.push({
      tool: "revise_plan",
      label: `Revise: ${relaxation.label.toLowerCase()}`,
      ok: true,
      ms: 0,
      detail: chosen === relaxation.id ? "chosen by the model" : "default order",
    });
    joined = await rankEveryone(constraints);
    summary = summarize(joined.venues, resolvedPeople.length);
    attempts.push({ constraints: { ...constraints }, everyoneCount: summary.everyoneCount, total: summary.total });
  }

  // ---- 3. read the group's taste vocabulary -------------------------------
  const profiles = resolvedPeople.map((person, index) => ({
    label: person.label,
    vocab: tagProfile(
      joined.venues
        .map((venue) => ({ ...venue, score: venue.scores[index] }))
        .filter((venue) => venue.score > 0)
        .sort((a, b) => b.score - a.score),
    ),
  }));
  const taste = compareTaste(profiles);

  const deterministic = narrate({
    summary,
    taste,
    venues: joined.venues,
    people: resolvedPeople.map((person) => person.label),
    city: input.city,
    attempts,
    decisions,
    constraints: initialConstraints,
  });

  let narration = deterministic;
  let narrationSource = "rules";
  if (model?.configured) {
    const generated = await step("write_verdict", "Write the verdict", () =>
      requestNarration({
        model,
        evidence: {
          city: input.city,
          people: resolvedPeople.map((person) => ({ label: person.label, signals: person.signals })),
          summary,
          taste,
          decisions,
          venues: joined.venues.slice(0, 8),
        },
      }));
    if (generated) {
      narration = generated;
      narrationSource = model.provider ?? "model";
    }
  }

  return {
    mode: data.mode,
    city: input.city,
    generatedAt: new Date().toISOString(),
    people: resolvedPeople.map((person) => ({ label: person.label, signals: person.signals })),
    constraints,
    venues: joined.venues,
    groups: {
      everyone: joined.venues.filter((venue) => venue.bucket === "everyone").slice(0, 6),
      most: joined.venues.filter((venue) => venue.bucket === "most").slice(0, 6),
      trade: joined.venues.filter((venue) => venue.bucket === "trade").slice(0, 6),
    },
    taste,
    summary,
    negotiation: { attempts, decisions, settledAfter: attempts.length },
    narration,
    narrationSource,
    trace,
    provenance: {
      mode: data.mode,
      calls: calls.map((call, index) => ({ ...call, index: index + 1 })),
      venueCount: joined.venues.length,
      rule: "Each person's places are scored from Qloo's affinity when returned, otherwise from rank position. The group score is a harmonic mean over everyone: one indifferent person drags it to zero.",
    },
  };
}
