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

export async function resolveLiveTasteEntities(venueNames, fetcher = fetch) {
  if (!Array.isArray(venueNames)) throw new Error("Add one to three restaurant names to build a live Qloo profile.");
  const names = [];
  for (const raw of venueNames) {
    const name = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
    if (name && !names.some((existing) => existing.toLocaleLowerCase("en-US") === name.toLocaleLowerCase("en-US"))) names.push(name);
  }
  if (names.length === 0 || names.length > 3) throw new Error("Add one to three restaurant names to build a live Qloo profile.");
  const payload = await postQloo("/api/qloo/resolve", { venues: names }, fetcher);
  if (payload.mode !== "resolved" || !Array.isArray(payload.entities) || payload.entities.length !== names.length) {
    throw new Error("Qloo returned a response that did not match the expected entity-resolution schema.");
  }
  const entities = payload.entities.map((entity) => ({
    id: typeof entity?.id === "string" ? entity.id.trim().slice(0, 180) : "",
    name: typeof entity?.name === "string" ? entity.name.trim().slice(0, 100) : "",
    requestedName: typeof entity?.requestedName === "string" ? entity.requestedName.trim().slice(0, 120) : "",
    type: typeof entity?.type === "string" ? entity.type.trim().slice(0, 100) : "",
  }));
  if (entities.some((entity) => !entity.id || !entity.name || !entity.requestedName)) {
    throw new Error("Qloo returned an incomplete restaurant match. Resolve the names again.");
  }
  return entities;
}

export async function fetchLiveTasteSignals(entities, fetcher = fetch) {
  if (!Array.isArray(entities) || entities.length < 1 || entities.length > 3) {
    throw new Error("Confirm one to three resolved restaurant matches before requesting Qloo insights.");
  }
  const payload = await postQloo("/api/qloo/signals", { entities }, fetcher);
  return normalizeLiveResponse(payload);
}

async function postQloo(path, body, fetcher) {
  const response = await fetcher(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    let message = payload.error || "The live Qloo request did not complete.";
    if (Array.isArray(payload.unresolved)) {
      const suggestions = payload.unresolved.map((item) => {
        const names = Array.isArray(item.candidates) ? item.candidates.map((candidate) => candidate.name).filter(Boolean) : [];
        return item.requestedName + (names.length ? " — suggestions: " + names.join(", ") : " — no match found");
      });
      message += " " + suggestions.join("; ");
    }
    throw new Error(message);
  }
  return payload;
}

export function normalizeLiveResponse(payload) {
  if (!payload || payload.mode !== "live" || !Array.isArray(payload.tags) || !Array.isArray(payload.resolvedEntities) || payload.resolvedEntities.length < 1 || payload.resolvedEntities.length > 3 || !Array.isArray(payload.recommendations)) {
    throw new Error("Qloo returned a response that did not match the expected schema.");
  }
  const resolvedEntities = payload.resolvedEntities.map((entity) => ({
    id: typeof entity?.id === "string" ? entity.id.trim().slice(0, 180) : "",
    name: typeof entity?.name === "string" ? entity.name.trim().slice(0, 100) : "",
  }));
  if (resolvedEntities.some((entity) => !entity.id || !entity.name)) {
    throw new Error("Qloo returned an incomplete resolved restaurant list.");
  }
  const tags = payload.tags.filter((tag) => tag && typeof tag === "object").map((tag) => ({
    name: String(tag.name || tag.tag_value || tag.id || "").slice(0, 100),
    id: String(tag.id || tag.tag_value || "").slice(0, 180),
    type: String(tag.type || tag.subtype || "").slice(0, 100),
  })).filter((tag) => tag.name);
  const recommendations = payload.recommendations.filter((entity) => entity && typeof entity === "object").map((entity) => ({
    id: String(entity.id || "").slice(0, 180),
    name: String(entity.name || "").slice(0, 100),
    rank: Number.isInteger(entity.rank) ? entity.rank : null,
  })).filter((entity) => entity.id && entity.name);
  return {
    source: "qloo-harness-live",
    sourceLabel: "Qloo Harness",
    cuisineSignals: alignableCuisineSignals(tags),
    tags,
    venueNames: resolvedEntities.map((entity) => entity.name),
    recommendations,
    provenance: {
      mode: "live",
      explanation: "Cuisine cues are mapped from tags on Qloo-recommended restaurants; they are aggregate signals, not individual predictions.",
      retrievedAt: String(payload.retrievedAt || ""),
      entityIds: resolvedEntities.map((entity) => entity.id),
      endpoint: String(payload.endpoint || ""),
      tagCount: tags.length,
      recommendationCount: recommendations.length,
      transport: String(payload.source || "Qloo Harness"),
    },
  };
}
