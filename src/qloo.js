import { SAMPLE_PROFILES } from "./recipes.js";
import { alignableCuisineSignals } from "./planner.js";

export function sampleSignal(profileId = "campus") {
  const profile = SAMPLE_PROFILES[profileId] || SAMPLE_PROFILES.campus;
  return {
    source: "curated-sample",
    sourceLabel: "Synthetic demo signal",
    cuisineSignals: [...profile.cuisineSignals],
    tags: profile.cuisineSignals.map((name) => ({ name, source: "curated-demo" })),
    venueNames: [...profile.venues],
    provenance: {
      mode: "sample",
      explanation: "Curated synthetic demo data. No Qloo request was made.",
      retrievedAt: null,
      entityIds: [],
      endpoint: null,
    },
  };
}

export async function fetchLiveTasteSignals(venueNames, fetcher = fetch) {
  const names = [...new Set((venueNames || []).map((name) => String(name).trim()).filter(Boolean))].slice(0, 3);
  if (names.length === 0) throw new Error("Add one to three restaurant names to build a live Qloo profile.");
  const response = await fetcher("/api/qloo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ venues: names }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "The live Qloo request did not complete.");
  return normalizeLiveResponse(payload);
}

export function normalizeLiveResponse(payload) {
  if (!payload || payload.mode !== "live" || !Array.isArray(payload.tags) || !Array.isArray(payload.resolvedEntities)) {
    throw new Error("Qloo returned a response that did not match the expected schema.");
  }
  const tags = payload.tags.map((tag) => ({
    name: String(tag.name || tag.tag_value || tag.id || "").slice(0, 100),
    id: String(tag.id || tag.tag_value || "").slice(0, 180),
    type: String(tag.type || tag.subtype || "").slice(0, 100),
  })).filter((tag) => tag.name);
  return {
    source: "qloo-live",
    sourceLabel: "Qloo live",
    cuisineSignals: alignableCuisineSignals(tags),
    tags,
    venueNames: payload.resolvedEntities.map((entity) => String(entity.name || "").slice(0, 100)),
    provenance: {
      mode: "live",
      explanation: "Cuisine cues are mapped from Qloo tag results; they are aggregate signals, not individual predictions.",
      retrievedAt: String(payload.retrievedAt || ""),
      entityIds: payload.resolvedEntities.map((entity) => String(entity.id || "")),
      endpoint: String(payload.endpoint || ""),
      tagCount: tags.length,
    },
  };
}
