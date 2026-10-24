import test from "node:test";
import assert from "node:assert/strict";
import { resolveProfiles, collectConfirmedProfiles } from "../scripts/validate-live.mjs";

const profiles = ["Italian", "Japanese", "Mexican"].map((label, index) => ({ label, venues: ["Fixture place " + index] }));
const config = { origin: "https://backend.test", token: "fixture-backend-token-with-at-least-32-characters", now: () => new Date("2026-10-24T12:00:00Z") };

function resolved(index) {
  return { mode: "resolved", entities: [{ id: "place-" + index, name: profiles[index].venues[0], requestedName: profiles[index].venues[0] }] };
}

test("live validation resolves all profiles without requesting insights", async () => {
  let requests = 0;
  const record = await resolveProfiles(profiles, { ...config, fetcher: async (url, options) => {
    assert.equal(url, config.origin + "/api/qloo/resolve");
    assert.equal(options.redirect, "error");
    return new Response(JSON.stringify(resolved(requests++)));
  } });
  assert.equal(record.stage, "awaiting-confirmation");
  assert.equal(requests, 3);
  assert.equal(JSON.stringify(record).includes(config.token), false);
});

test("ambiguous matches produce a correction record that cannot request insights", async () => {
  const record = await resolveProfiles(profiles, { ...config, fetcher: async () => new Response(JSON.stringify({ unresolved: [{ requestedName: "Fixture", candidates: [{ name: "Fixture north" }] }] }), { status: 422 }) });
  assert.equal(record.stage, "needs-correction");
  assert.equal(record.profiles[0].suggestions[0].candidates[0], "Fixture north");
  await assert.rejects(collectConfirmedProfiles(record, { ...config, fetcher: () => assert.fail("must not request insights") }), /review its exact matches/);
});

test("confirmed live experiment records observed labels, mappings and menus", async () => {
  let index = 0;
  const record = await resolveProfiles(profiles, { ...config, fetcher: async () => new Response(JSON.stringify(resolved(index++))) });
  index = 0;
  const evidence = await collectConfirmedProfiles(record, { ...config, fetcher: async (url, options) => {
    assert.equal(url, config.origin + "/api/qloo/signals");
    const entity = JSON.parse(options.body).entities[0];
    const cuisine = profiles[index++].label;
    return new Response(JSON.stringify({
      mode: "live", retrievedAt: "2026-10-24T12:00:00Z", resolvedEntities: [entity], recommendations: [{ id: "rec-" + index, name: "Fixture recommendation", rank: 1 }], tags: [{ id: cuisine.toLowerCase(), name: cuisine }],
    }));
  } });
  assert.equal(evidence.status, "complete");
  assert.equal(evidence.observation.distinctCuisineMappings, 3);
  assert.equal(evidence.observation.allProfilesMapped, true);
  assert.equal(evidence.profiles[0].plan.menus.length, 5);
  assert.equal(JSON.stringify(evidence).includes(config.token), false);
});

test("live experiment records failures instead of accepting sample or wrong entity provenance", async () => {
  let index = 0;
  const record = await resolveProfiles(profiles, { ...config, fetcher: async () => new Response(JSON.stringify(resolved(index++))) });
  const evidence = await collectConfirmedProfiles(record, { ...config, fetcher: async () => new Response(JSON.stringify({ mode: "sample", tags: [], recommendations: [], resolvedEntities: [{ id: "wrong-place", name: "Fixture" }] })) });
  assert.equal(evidence.status, "failed");
  assert.equal(evidence.observation.successfulProfiles, 0);
  assert.ok(evidence.profiles.every((item) => item.error && !item.signal));
});

test("validation rejects insecure origins, weak tokens and incomplete profiles before network use", async () => {
  const fetcher = () => assert.fail("must not issue a network request");
  await assert.rejects(resolveProfiles(profiles, { ...config, origin: "http://remote.test", fetcher }), /HTTPS origin/);
  await assert.rejects(resolveProfiles(profiles, { ...config, token: "short", fetcher }), /TOKEN/);
  await assert.rejects(resolveProfiles(profiles.slice(0, 2), { ...config, fetcher }), /exactly three/);
});
