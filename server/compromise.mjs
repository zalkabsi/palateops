/**
 * The negotiation engine.
 *
 * Qloo ranks places for ONE taste profile. This product asks a different
 * question: which places survive the rankings of 2-5 different people at once?
 * That requires a rule that is defensible, explainable, and honest when the
 * honest answer is "nobody agrees".
 *
 * Pure functions only. Everything here is unit tested without a network.
 */

const EPSILON = 1e-9;

/** A place must clear this joint score for everyone to count as a shared answer. */
export const EVERYONE_THRESHOLD = 0.55;
/** Above this single-person score, a one-sided place is offered as a trade. */
export const TRADE_THRESHOLD = 0.6;

/**
 * Tags that describe what a place *is* or how it is *operated*, not what it
 * feels like. Live place entities carry ~100 tags each and most are service
 * metadata ("dine in", "nfc mobile payments", "takeout"). Left in, the shared
 * taste panel reads as noise and the product looks like it does not understand
 * culture at all.
 */
const GENERIC_TAGS = new Set([
  "restaurant", "food", "bar", "cafe", "establishment", "point of interest", "dining",
  "food and drink", "eat and drink", "lounge", "pub", "nightlife", "service",
  "foodies", "casual dining", "casual", "urban", "historic", "stylish", "modern",
]);

/** Service/operations tags, matched loosely because Qloo varies the wording. */
const OPERATIONAL_TAG = /^(dine in|dine-in|takeout|take out|delivery|outdoor seating|outdoor|seating|walk.?ins?|reservations?|accepts reservations|no reservations?|nfc mobile payments|mobile payments|credit cards?|debit cards?|cash only|parking|valet|wifi|free wi-?fi|wheelchair accessible|table service|counter service|online booking|booking|group friendly|good for [a-z ]+|family friendly|kids menu|pet friendly|dress code|attire|smoking|no smoking|air conditioning|heating)$/i;

/** True when a tag says something about taste rather than logistics. */
export function isInformativeTag(name) {
  const key = normalizeTag(name);
  if (!key) return false;
  if (GENERIC_TAGS.has(key)) return false;
  return !OPERATIONAL_TAG.test(key);
}

/** Tags worth showing on a venue card: informative first, capped. */
export function displayTags(tags, limit = 4) {
  const kept = (tags ?? []).filter((tag) => isInformativeTag(tag?.name));
  return kept.slice(0, limit);
}

/**
 * Convert Qloo's ranking into a normalised score in [0,1].
 * A returned affinity is the strongest evidence; otherwise position is.
 */
export function scoreEntity(entity, index, total) {
  const affinity = entity?.affinity;
  if (typeof affinity === "number" && Number.isFinite(affinity) && affinity >= 0 && affinity <= 1) {
    return round(affinity);
  }
  if (!Number.isFinite(total) || total <= 1) return 1;
  const bounded = Math.min(Math.max(index, 0), total - 1);
  return round(1 - bounded / total);
}

/**
 * Generalised harmonic mean over N people.
 *
 * The harmonic mean is dominated by the smallest input, so one person's
 * indifference drags the score down hard. That is the whole product: an
 * arithmetic mean would let one enthusiast outvote everybody else, which is
 * exactly the failure of every "average the group" recommender.
 *
 * Returns 0 when anybody is uninterested.
 */
export function mixMany(scores) {
  const values = Array.isArray(scores) ? scores.map(clamp01) : [];
  if (values.length === 0) return 0;
  if (values.some((value) => value <= EPSILON)) return 0;
  let inverseSum = 0;
  for (const value of values) inverseSum += 1 / value;
  return round(values.length / inverseSum);
}

/**
 * Join N independently ranked lists into one table.
 *
 * @param {Array<{label: string, entities: Array}>} lists one entry per person
 */
export function joinCandidates(lists) {
  const people = lists.map((entry) => entry.label);
  const byId = new Map();

  lists.forEach((list, personIndex) => {
    const entities = Array.isArray(list.entities) ? list.entities.filter(Boolean) : [];
    entities.forEach((entity, index) => {
      const score = scoreEntity(entity, index, entities.length);
      const existing = byId.get(entity.id);
      const record = existing ?? {
        ...entity,
        scores: new Array(lists.length).fill(0),
        ranks: new Array(lists.length).fill(null),
        sources: new Array(lists.length).fill("absent"),
      };
      record.scores[personIndex] = score;
      record.ranks[personIndex] = index + 1;
      record.sources[personIndex] = typeof entity.affinity === "number" ? "qloo" : "rank";
      byId.set(entity.id, record);
    });
  });

  const venues = [...byId.values()].map((venue) => {
    const joint = mixMany(venue.scores);
    const present = venue.scores.filter((score) => score > EPSILON).length;
    return {
      id: venue.id,
      name: venue.name,
      address: venue.address,
      popularity: venue.popularity,
      scores: venue.scores.map(round),
      ranks: venue.ranks,
      joint,
      present,
      of: lists.length,
      affinitySource: venue.sources.some((source) => source === "qloo") ? "qloo" : "rank",
      sources: venue.sources,
      tags: venue.tags,
      displayTags: displayTags(venue.tags),
      bucket: bucketFor(venue.scores, joint),
    };
  });

  venues.sort((left, right) => right.joint - left.joint || right.present - left.present || left.name.localeCompare(right.name));
  return { venues, people };
}

function bucketFor(scores, joint) {
  const present = scores.filter((score) => score > EPSILON).length;
  if (present === scores.length) return joint >= EVERYONE_THRESHOLD ? "everyone" : "most";
  if (Math.max(...scores) >= TRADE_THRESHOLD) return "trade";
  return "weak";
}

/**
 * Build one person's tag vocabulary from the places their own taste ranks
 * highest. Derived evidence, not a second Qloo call: it keeps a run at N
 * requests instead of 2N and stays explainable on screen.
 */
export function tagProfile(venues, { topN = 12 } = {}) {
  const weights = new Map();
  for (const venue of venues.slice(0, topN)) {
    const weight = typeof venue.score === "number" ? venue.score : venue.affinity;
    if (!Number.isFinite(weight) || weight <= 0) continue;
    for (const tag of venue.tags ?? []) {
      if (!isInformativeTag(tag?.name)) continue;
      weights.set(normalizeTag(tag.name), (weights.get(normalizeTag(tag.name)) ?? 0) + weight);
    }
  }
  const peak = Math.max(0, ...weights.values());
  if (peak <= 0) return new Map();
  const normalised = new Map();
  for (const [key, value] of weights) normalised.set(key, value / peak);
  return normalised;
}

function normalizeTag(name) {
  return typeof name === "string" ? name.trim().toLowerCase() : "";
}

/**
 * Compare N vocabularies.
 * `shared` = every person ranks the tag strongly. `individual` = tags only one
 * person responds to, attributed to them.
 */
export function compareTaste(profiles, { sharedFloor = 0.42, divergenceFloor = 0.3 } = {}) {
  if (!Array.isArray(profiles) || profiles.length === 0) return { shared: [], individual: [] };
  const keys = new Set();
  for (const profile of profiles) for (const key of profile.vocab.keys()) keys.add(key);

  const shared = [];
  const perPerson = profiles.map((profile) => ({ label: profile.label, tags: [] }));

  for (const key of keys) {
    const values = profiles.map((profile) => profile.vocab.get(key) ?? 0);
    const lowest = Math.min(...values);
    const highest = Math.max(...values);
    if (lowest >= sharedFloor) {
      shared.push({ tag: key, values: values.map(round), strength: round(lowest) });
      continue;
    }
    if (highest - lowest < divergenceFloor) continue;
    const ownerIndex = values.indexOf(highest);
    perPerson[ownerIndex].tags.push({ tag: key, value: round(highest), others: round(lowest), strength: round(highest - lowest) });
  }

  return {
    shared: shared.sort((left, right) => right.strength - left.strength || left.tag.localeCompare(right.tag)).slice(0, 10),
    individual: perPerson.map((entry) => ({
      label: entry.label,
      tags: entry.tags.sort((a, b) => b.strength - a.strength).slice(0, 6),
    })),
  };
}

/** Headline numbers for the result screen. Deliberately strict. */
export function summarize(venues, peopleCount) {
  const total = venues.length;
  const everyone = venues.filter((venue) => venue.bucket === "everyone");
  const most = venues.filter((venue) => venue.bucket === "most");
  const trade = venues.filter((venue) => venue.bucket === "trade");
  const overlap = total === 0 ? 0 : round(everyone.length / total);
  return {
    total,
    everyoneCount: everyone.length,
    mostCount: most.length,
    tradeCount: trade.length,
    peopleCount,
    overlap,
    bestJoint: everyone.length > 0 ? everyone[0].joint : 0,
    verdict: verdictFor({ total, everyoneCount: everyone.length, overlap }),
  };
}

export function verdictFor({ total, everyoneCount, overlap }) {
  if (total === 0) {
    return { headline: "No shared ground found", tone: "unknown", detail: "Qloo returned no places for this city and these tastes." };
  }
  if (everyoneCount >= 3 && overlap >= 0.18) {
    return { headline: "The group agrees more than it thinks", tone: "good", detail: "Several places clear every person's ranking, not one lucky overlap." };
  }
  if (everyoneCount >= 1) {
    return { headline: "There is a real middle", tone: "ok", detail: "The overlap is narrow, so the compromise has to be chosen deliberately." };
  }
  return { headline: "This group is opposites", tone: "hard", detail: "No place clears everybody's ranking. This is a trade, not a compromise." };
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round(value) {
  return Math.round(clamp01(value) * 1000) / 1000;
}
