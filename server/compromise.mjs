/**
 * The compromise engine.
 *
 * Qloo ranks venues for ONE taste profile. The product question here is
 * different: which venues survive BOTH profiles? That requires a scoring rule
 * that is defensible, explainable and honest about what it does not know.
 *
 * Rule: each venue gets a score in [0,1] per person, then the pair is combined
 * with the harmonic mean. The harmonic mean punishes one-sided winners, so a
 * 0.95/0.20 venue scores below a 0.70/0.70 venue. That is the entire thesis of
 * the product, so the maths lives in one small testable module.
 */

const EPSILON = 1e-9;

/** Venues below this joint score are never presented as a shared choice. */
export const BOTH_THRESHOLD = 0.55;
/** Above this single-profile score a venue is offered as a deliberate trade. */
export const TRADE_THRESHOLD = 0.6;

/** Tags that describe what a place is, not what it feels like. Excluded from taste reading. */
const GENERIC_TAGS = new Set([
  "restaurant", "food", "bar", "cafe", "establishment", "point of interest", "dining",
  "food and drink", "eat and drink", "lounge", "pub", "nightlife", "service",
]);

/**
 * Convert Qloo's ranking into a normalised score.
 * When Qloo returns an affinity we trust it; otherwise position is the evidence.
 */
export function scoreEntity(entity, index, total) {
  const affinity = entity?.affinity;
  if (typeof affinity === "number" && Number.isFinite(affinity) && affinity >= 0 && affinity <= 1) {
    return round(affinity);
  }
  if (!Number.isFinite(total) || total <= 1) return 1;
  const boundedIndex = Math.min(Math.max(index, 0), total - 1);
  return round(1 - boundedIndex / total);
}

/** Harmonic mean of two scores. Returns 0 when either person is uninterested. */
export function mix(a, b) {
  const left = clamp01(a);
  const right = clamp01(b);
  if (left <= EPSILON || right <= EPSILON) return 0;
  return round((2 * left * right) / (left + right));
}

/**
 * Join two independently ranked venue lists into one compromise table.
 *
 * A venue absent from a person's list is not evidence of dislike - it is
 * evidence of "not in their top N". It scores 0 and lands in `trade` at best,
 * which keeps the distinction visible in the UI.
 */
export function joinCandidates(listA, listB) {
  const scoredA = annotate(listA);
  const scoredB = annotate(listB);
  const byId = new Map();

  for (const entry of scoredA) {
    byId.set(entry.entity.id, { ...entry.entity, scoreA: entry.score, scoreB: 0, rankA: entry.rank, rankB: null, sourceA: entry.source, sourceB: "absent" });
  }
  for (const entry of scoredB) {
    const existing = byId.get(entry.entity.id);
    if (existing) {
      existing.scoreB = entry.score;
      existing.rankB = entry.rank;
      existing.sourceB = entry.source;
      continue;
    }
    byId.set(entry.entity.id, { ...entry.entity, scoreA: 0, scoreB: entry.score, rankA: null, rankB: entry.rank, sourceA: "absent", sourceB: entry.source });
  }

  const venues = [...byId.values()].map((venue) => {
    const compromise = mix(venue.scoreA, venue.scoreB);
    return {
      id: venue.id,
      name: venue.name,
      address: venue.address,
      popularity: venue.popularity,
      affinityA: round(venue.scoreA),
      affinityB: round(venue.scoreB),
      affinitySource: venue.sourceA === "qloo" && venue.sourceB === "qloo" ? "qloo" : "rank",
      compromise,
      rankA: venue.rankA,
      rankB: venue.rankB,
      tags: venue.tags,
      bucket: bucketFor(venue.scoreA, venue.scoreB, compromise),
    };
  });

  venues.sort((left, right) => right.compromise - left.compromise || left.name.localeCompare(right.name));
  return venues;
}

function annotate(list) {
  const entities = Array.isArray(list) ? list.filter(Boolean) : [];
  return entities.map((entity, index) => ({
    entity,
    index,
    rank: index + 1,
    score: scoreEntity(entity, index, entities.length),
    source: typeof entity.affinity === "number" && Number.isFinite(entity.affinity) ? "qloo" : "rank",
  }));
}

function bucketFor(scoreA, scoreB, compromise) {
  const bothPresent = scoreA > EPSILON && scoreB > EPSILON;
  if (bothPresent && compromise >= BOTH_THRESHOLD) return "both";
  if (bothPresent) return "middle";
  if (Math.max(scoreA, scoreB) >= TRADE_THRESHOLD) return "trade";
  return "weak";
}

/**
 * Build a tag vocabulary for one profile from the venues that person's taste
 * ranks highest. This is derived evidence, not a Qloo tag API call: it keeps
 * the request count at two per session and stays explainable.
 */
export function tagProfile(venues, { topN = 12 } = {}) {
  const weights = new Map();
  for (const venue of venues.slice(0, topN)) {
    const weight = typeof venue.score === "number" ? venue.score : venue.affinity;
    if (!Number.isFinite(weight) || weight <= 0) continue;
    for (const tag of venue.tags ?? []) {
      const key = normalizeTag(tag?.name);
      if (!key || GENERIC_TAGS.has(key)) continue;
      weights.set(key, (weights.get(key) ?? 0) + weight);
    }
  }
  const peak = Math.max(0, ...weights.values());
  if (peak <= 0) return new Map();
  const normalized = new Map();
  for (const [key, value] of weights) normalized.set(key, value / peak);
  return normalized;
}

function normalizeTag(name) {
  return typeof name === "string" ? name.trim().toLowerCase() : "";
}

/**
 * Compare both vocabularies and return what they share, where they diverge.
 * "Shared" means both people rank it strongly, not merely that it appears twice.
 */
export function compareTaste(vocabA, vocabB, { sharedFloor = 0.42, divergenceFloor = 0.3 } = {}) {
  const keys = new Set([...vocabA.keys(), ...vocabB.keys()]);
  const shared = [];
  const onlyA = [];
  const onlyB = [];

  for (const key of keys) {
    const a = vocabA.get(key) ?? 0;
    const b = vocabB.get(key) ?? 0;
    const both = Math.min(a, b);
    const spread = a - b;
    if (both >= sharedFloor) shared.push({ tag: key, a: round(a), b: round(b), strength: round(both) });
    else if (spread >= divergenceFloor) onlyA.push({ tag: key, a: round(a), b: round(b), strength: round(spread) });
    else if (-spread >= divergenceFloor) onlyB.push({ tag: key, a: round(a), b: round(b), strength: round(-spread) });
  }

  const byStrength = (left, right) => right.strength - left.strength || left.tag.localeCompare(right.tag);
  return {
    shared: shared.sort(byStrength).slice(0, 8),
    onlyA: onlyA.sort(byStrength).slice(0, 5),
    onlyB: onlyB.sort(byStrength).slice(0, 5),
  };
}

/**
 * Headline numbers for the result screen.
 * `overlap` is the share of all seen venues that clear the shared threshold -
 * deliberately strict, because an inflated number would make the app useless.
 */
export function summarize(venues) {
  const total = venues.length;
  const both = venues.filter((venue) => venue.bucket === "both");
  const middle = venues.filter((venue) => venue.bucket === "middle");
  const trade = venues.filter((venue) => venue.bucket === "trade");
  const overlap = total === 0 ? 0 : round(both.length / total);
  const bestJoint = both.length > 0 ? both[0].compromise : 0;
  return {
    total,
    bothCount: both.length,
    middleCount: middle.length,
    tradeCount: trade.length,
    overlap,
    bestJoint,
    verdict: verdictFor({ overlap, bothCount: both.length, tradeCount: trade.length, total }),
  };
}

export function verdictFor({ overlap, bothCount, total }) {
  if (total === 0) {
    return { headline: "No shared ground found", tone: "unknown", detail: "Qloo returned no venues for this city and these signals." };
  }
  if (bothCount >= 3 && overlap >= 0.18) {
    return { headline: "You agree more than you think", tone: "good", detail: "Several places sit in both rankings, not just one lucky overlap." };
  }
  if (bothCount >= 1) {
    return { headline: "There is a real middle", tone: "ok", detail: "The overlap is narrow, so the compromise has to be chosen deliberately." };
  }
  return { headline: "You are opposites here", tone: "hard", detail: "No venue clears both rankings. This is a trade, not a compromise." };
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round(value) {
  return Math.round(clamp01(value) * 1000) / 1000;
}
