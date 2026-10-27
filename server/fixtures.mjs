/**
 * Fixture provider.
 *
 * Used ONLY when no Qloo credential is configured. Every response carries
 * `mode: "fixture"` and the UI renders a permanent banner, because presenting
 * synthetic rankings as Qloo output would be a false claim.
 *
 * Venues here are invented. The signals a person picks are real public
 * entities, but the rankings and tags are generated locally so the product
 * can be developed, tested and reviewed without spending event quota.
 */

const TAGS = [
  "natural wine", "vinyl", "jazz", "izakaya", "handmade pasta", "mezcal", "candlelit",
  "rooftop", "late night", "coffee", "bakery", "seafood", "korean bbq", "sake", "afrobeat",
  "dim sum", "tiki", "house music", "garden", "minimalist", "thai", "tapas", "omakase",
  "wood-fired", "vegetarian", "martini", "brutalist", "bookshop", "cinema", "soul food",
];

/** Invented venues. Names are fictional on purpose. */
const VENUES = [
  ["Meridian & Ash", ["natural wine", "candlelit", "minimalist"], 0.71],
  ["The Brass Doorknob", ["vinyl", "jazz", "late night"], 0.64],
  ["Kori", ["izakaya", "sake", "omakase"], 0.83],
  ["Saltpig", ["seafood", "natural wine", "wood-fired"], 0.77],
  ["Lamp Room", ["candlelit", "handmade pasta", "natural wine"], 0.69],
  ["Father Midnight", ["house music", "late night", "martini"], 0.58],
  ["Nine of Cups", ["tiki", "soul food", "late night"], 0.52],
  ["Postal No. 4", ["brutalist", "coffee", "bakery"], 0.74],
  ["Grove & Groan", ["garden", "vegetarian", "natural wine"], 0.61],
  ["The Long View", ["rooftop", "martini", "minimalist"], 0.72],
  ["Ember Line", ["wood-fired", "tapas", "natural wine"], 0.68],
  ["Onyx Bakery", ["bakery", "coffee", "minimalist"], 0.79],
  ["Third Rail", ["jazz", "martini", "vinyl"], 0.55],
  ["Palm & Pith", ["thai", "garden", "candlelit"], 0.66],
  ["Sixty Below", ["omakase", "sake", "minimalist"], 0.81],
  ["The Quiet Hour", ["bookshop", "coffee", "candlelit"], 0.63],
  ["Copper Kettle", ["soul food", "wood-fired", "vegetarian"], 0.6],
  ["Neon Canteen", ["dim sum", "late night", "house music"], 0.57],
  ["Rowan House", ["handmade pasta", "wood-fired", "natural wine"], 0.75],
  ["Moth & Lantern", ["afrobeat", "jazz", "garden"], 0.56],
  ["Low Tide", ["seafood", "tapas", "martini"], 0.7],
  ["Basement Nine", ["vinyl", "house music", "late night"], 0.51],
  ["Marrow", ["korean bbq", "wood-fired", "sake"], 0.73],
  ["Paper Radio", ["coffee", "bookshop", "vinyl"], 0.65],
  ["The Almanac", ["natural wine", "tapas", "candlelit"], 0.67],
  ["Hotel Meridian Bar", ["martini", "jazz", "minimalist"], 0.62],
  ["Green Room 7", ["cinema", "martini", "brutalist"], 0.54],
  ["Tandem", ["bakery", "coffee", "garden"], 0.76],
  ["Hollow Bones", ["tiki", "seafood", "late night"], 0.53],
  ["Celadon", ["thai", "minimalist", "candlelit"], 0.68],
];

/** Curated search results for fixture mode: real public names, local ranking. */
const SEARCH_CATALOG = {
  music: ["Alice Coltrane", "Fela Kuti", "Radiohead", "Solange", "Khruangbin", "Nina Simone", "Burial", "Sault"],
  movie: ["In the Mood for Love", "Blade Runner", "Parasite", "The Grand Budapest Hotel", "Moonlight", "Heat"],
  tv: ["The Bear", "Severance", "Atlanta", "Chef's Table", "Twin Peaks", "Succession"],
  book: ["The Secret History", "Piranesi", "Kitchen Confidential", "Normal People", "The Overstory"],
  brand: ["Aesop", "Muji", "Le Labo", "Patagonia", "Braun", "Vitsoe"],
  videogame: ["Disco Elysium", "Hades", "Journey", "Outer Wilds", "Stardew Valley"],
  podcast: ["The Memory Palace", "Criminal", "99% Invisible", "Ologies", "Song Exploder"],
};

export const FIXTURE_MODE = "fixture";

/** Deterministic 32-bit string hash (FNV-1a). */
function hash(text) {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value >>> 0;
}

/** mulberry32 - small deterministic PRNG so fixture output is stable. */
function prng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function flavorFor(signals) {
  const flavor = new Map();
  for (const signal of signals) {
    const random = prng(hash(`${signal.type}:${signal.name}`));
    const picks = 4;
    for (let index = 0; index < picks; index += 1) {
      const tag = TAGS[Math.floor(random() * TAGS.length)];
      const weight = 0.45 + random() * 0.55;
      flavor.set(tag, (flavor.get(tag) ?? 0) + weight);
    }
  }
  return flavor;
}

export function fixtureSearch({ query, type, take = 8 }) {
  const domain = SEARCH_CATALOG[type] ?? SEARCH_CATALOG.music;
  const needle = String(query ?? "").trim().toLowerCase();
  const matches = domain.filter((name) => name.toLowerCase().includes(needle));
  const pool = needle && matches.length > 0 ? matches : domain;
  return pool.slice(0, take).map((name) => ({
    id: `fixture-${type}-${hash(name).toString(16)}`,
    name,
    subtype: `urn:entity:${type}`,
    popularity: 0.5,
    affinity: null,
    address: "",
    tags: [],
  }));
}

/** Deterministic price band so constraint relaxation is observable in fixtures. */
function priceLevelFor(tags) {
  const premium = ["omakase", "seafood", "sake", "korean bbq", "martini"];
  const mid = ["handmade pasta", "wood-fired", "tapas", "natural wine", "rooftop"];
  if (tags.some((tag) => premium.includes(tag))) return 4;
  if (tags.some((tag) => mid.includes(tag))) return 3;
  return 2;
}

export function fixtureRecommendPlaces({ signals, city, take = 30, maxPriceLevel = null }) {
  const profile = (Array.isArray(signals) ? signals : []).map((signal) =>
    typeof signal === "string"
      ? { name: signal, type: "music" }
      : { name: String(signal?.name ?? signal?.id ?? ""), type: String(signal?.type ?? "music") },
  );
  const flavor = flavorFor(profile);
  const cityJitter = hash(String(city ?? "").toLowerCase());

  /** How much of this venue's tag vocabulary the profile actually responds to. */
  const rawScores = VENUES.map(([name, tags]) => {
    let matched = 0;
    for (const tag of tags) matched += flavor.get(tag) ?? 0;
    return { name, tags, matched: matched / Math.max(1, tags.length), priceLevel: priceLevelFor(tags) };
  });
  const peak = Math.max(0.001, ...rawScores.map((entry) => entry.matched));

  const scored = rawScores
    .filter((entry) => !Number.isInteger(maxPriceLevel) || entry.priceLevel <= maxPriceLevel)
    .map(({ name, tags, matched, priceLevel }) => {
      const popularity = VENUES.find(([venueName]) => venueName === name)?.[2] ?? 0.6;
      const random = prng(hash(name) ^ cityJitter ^ hash(profile.map((signal) => signal.name).join("|")));
      const jitter = (random() - 0.5) * 0.1;
      const value = 0.12 + (matched / peak) * 0.74 + (popularity - 0.6) * 0.16 + jitter;
      return {
        id: `fixture-place-${hash(name).toString(16)}`,
        name,
        subtype: "urn:entity:place",
        popularity,
        priceLevel,
        affinity: Math.min(0.97, Math.max(0.02, value)),
        address: city || "",
        tags: tags.map((tag) => ({
          id: `urn:tag:keyword:place:${hash(tag).toString(16)}`,
          name: tag,
          type: "urn:tag:keyword:place",
        })),
      };
    });

  scored.sort((left, right) => right.affinity - left.affinity || left.name.localeCompare(right.name));
  // Each person sees a different slice, exactly as independent Qloo rankings
  // would: overlap is the exception, not the default.
  return scored.slice(0, Math.min(take, 18));
}
