import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLiveResponse, sampleSignal } from "../src/qloo.js";
import { alignableCuisineSignals } from "../src/planner.js";

const SCHEMA_FIXTURE = {
  mode: "live",
  source: "Qloo Insights API",
  endpoint: "https://api.qloo.com/v2/insights",
  retrievedAt: "2026-10-15T00:00:00.000Z",
  resolvedEntities: [{ id: "fixture-restaurant-1", name: "Fixture Dining Room" }],
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
  assert.equal(result.source, "qloo-live");
  assert.deepEqual(result.cuisineSignals, ["Japanese"]);
  assert.deepEqual(result.provenance.entityIds, ["fixture-restaurant-1"]);
  assert.equal(result.provenance.retrievedAt, SCHEMA_FIXTURE.retrievedAt);
  assert.equal(result.provenance.tagCount, 2);
});

test("unsupported live response schemas fail closed", () => {
  assert.throws(() => normalizeLiveResponse({ mode: "sample", tags: [], resolvedEntities: [] }), /schema/);
  assert.throws(() => normalizeLiveResponse({ mode: "live", tags: {}, resolvedEntities: [] }), /schema/);
});

test("cuisine matching only maps recognized returned labels", () => {
  assert.deepEqual(alignableCuisineSignals([{ name: "Japanese" }, { name: "high popularity" }]), ["Japanese"]);
  assert.deepEqual(alignableCuisineSignals([{ name: "high popularity" }]), []);
});
