import test from "node:test";
import assert from "node:assert/strict";
import { fetchLiveTasteSignals, normalizeLiveResponse, resolveLiveTasteEntities, sampleSignal } from "../src/qloo.js";
import { alignableCuisineSignals } from "../src/planner.js";

const SCHEMA_FIXTURE = {
  mode: "live",
  source: "Qloo Hackathon Harness (qloo api)",
  endpoint: "https://api.qloo.com/v2/insights",
  retrievedAt: "2026-10-15T00:00:00.000Z",
  resolvedEntities: [{ id: "fixture-restaurant-1", name: "Fixture Dining Room" }],
  recommendations: [{ id: "fixture-recommendation-1", name: "Fixture Neighbor", rank: 1 }],
  tags: [
    { id: "urn:tag:genre:food:japanese", name: "Japanese", type: "urn:tag:genre:food" },
    { id: "urn:tag:genre:food:ramen", name: "Ramen", type: "urn:tag:genre:food" }
  ]
};

test("sample profiles are explicitly labeled as synthetic, with no API provenance", () => {
  const result = sampleSignal("campus");
  assert.equal(result.provenance.mode, "sample");
  assert.match(result.provenance.explanation, /No Qloo request/);
  assert.deepEqual(result.provenance.entityIds, []);
});

test("live fixture normalizes API tags and retains entity and timestamp provenance", () => {
  const result = normalizeLiveResponse(SCHEMA_FIXTURE);
  assert.equal(result.source, "qloo-harness-live");
  assert.deepEqual(result.cuisineSignals, ["Japanese"]);
  assert.deepEqual(result.provenance.entityIds, ["fixture-restaurant-1"]);
  assert.equal(result.provenance.retrievedAt, SCHEMA_FIXTURE.retrievedAt);
  assert.equal(result.provenance.tagCount, 2);
  assert.equal(result.provenance.recommendationCount, 1);
  assert.equal(result.recommendations[0].name, "Fixture Neighbor");
});

test("unsupported live response schemas fail closed", () => {
  assert.throws(() => normalizeLiveResponse({ mode: "sample", tags: [], resolvedEntities: [] }), /schema/);
  assert.throws(() => normalizeLiveResponse({ mode: "live", tags: {}, resolvedEntities: [] }), /schema/);
  assert.throws(() => normalizeLiveResponse({ mode: "live", tags: [], resolvedEntities: [], recommendations: "invalid" }), /schema/);
  assert.throws(() => normalizeLiveResponse({ mode: "live", tags: [], resolvedEntities: [{ id: "", name: "" }], recommendations: [] }), /incomplete resolved/);
});

test("cuisine matching only maps recognized returned labels", () => {
  assert.deepEqual(alignableCuisineSignals([{ name: "Japanese" }, { name: "high popularity" }]), ["Japanese"]);
  assert.deepEqual(alignableCuisineSignals([{ name: "high popularity" }]), []);
});

test("live entity resolution uses the review endpoint and retains the canonical match", async () => {
  let request;
  const entities = await resolveLiveTasteEntities(["Fixture Dining Room"], async (path, options) => {
    request = { path, options };
    return new Response(JSON.stringify({
      mode: "resolved",
      entities: [{ id: "fixture-restaurant-1", name: "Fixture Dining Room", requestedName: "Fixture Dining Room", type: "urn:entity:place" }],
    }));
  });
  assert.equal(request.path, "/api/qloo/resolve");
  assert.deepEqual(JSON.parse(request.options.body), { venues: ["Fixture Dining Room"] });
  assert.equal(entities[0].id, "fixture-restaurant-1");
});

test("live entity resolution rejects more than three names instead of silently dropping extras", async () => {
  let called = false;
  await assert.rejects(
    resolveLiveTasteEntities(["One", "Two", "Three", "Four"], async () => { called = true; }),
    /one to three restaurant names/,
  );
  assert.equal(called, false);
});

test("live entity resolution rejects incomplete backend matches before confirmation", async () => {
  await assert.rejects(
    resolveLiveTasteEntities(["Fixture Dining Room"], async () => new Response(JSON.stringify({
      mode: "resolved",
      entities: [{ id: "fixture-restaurant-1", name: "", requestedName: "Fixture Dining Room" }],
    }))),
    /incomplete restaurant match/,
  );
});

test("live entity resolution normalizes duplicate names like the Worker", async () => {
  let request;
  await resolveLiveTasteEntities([" Sakura   Table ", "sakura table"], async (path, options) => {
    request = JSON.parse(options.body);
    return new Response(JSON.stringify({
      mode: "resolved",
      entities: [{ id: "fixture-restaurant-1", name: "Sakura Table", requestedName: "Sakura Table" }],
    }));
  });
  assert.deepEqual(request.venues, ["Sakura Table"]);
});

test("live taste retrieval uses confirmed entities and normalizes Harness output", async () => {
  let request;
  const signal = await fetchLiveTasteSignals([{ id: "fixture-restaurant-1", name: "Fixture Dining Room", requestedName: "Fixture Dining Room" }], async (path, options) => {
    request = { path, options };
    return new Response(JSON.stringify(SCHEMA_FIXTURE));
  });
  assert.equal(request.path, "/api/qloo/signals");
  assert.equal(JSON.parse(request.options.body).entities[0].id, "fixture-restaurant-1");
  assert.equal(signal.source, "qloo-harness-live");
  assert.deepEqual(signal.cuisineSignals, ["Japanese"]);
});
