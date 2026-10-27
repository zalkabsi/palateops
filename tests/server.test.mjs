import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, describe, it } from "node:test";

import { createApp } from "../server/index.mjs";
import { createCache } from "../server/cache.mjs";
import { narrate } from "../server/narrate.mjs";
import { joinCandidates, summarize } from "../server/compromise.mjs";

let server;
let base;

before(async () => {
  const app = createApp({ DUET_MODE: "fixture", QLOO_API_KEY: "" });
  server = createServer(app.handle);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const planBody = {
  city: "Brooklyn, NY",
  maxPriceLevel: 3,
  people: [
    { label: "Sam", signals: [{ name: "Fela Kuti", type: "music" }] },
    { label: "Jules", signals: [{ name: "Aesop", type: "brand" }] },
  ],
};

describe("server", () => {
  it("reports fixture mode honestly", async () => {
    const body = await (await fetch(`${base}/api/health`)).json();
    assert.equal(body.status, "ok");
    assert.equal(body.mode, "fixture");
    assert.equal(body.qlooConfigured, false);
  });

  it("serves the shell page with a content security policy", async () => {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /PalateOps/);
    assert.match(response.headers.get("content-security-policy"), /default-src 'self'/);
  });

  it("serves starter groups and taste domains", async () => {
    const body = await (await fetch(`${base}/api/presets`)).json();
    assert.ok(body.presets.length >= 3);
    assert.ok(body.presets.some((preset) => preset.people.length >= 3));
    assert.ok(body.tasteTypes.some((entry) => entry.alias === "music"));
  });

  it("rejects a search that is too short to be useful", async () => {
    assert.equal((await fetch(`${base}/api/search?q=a`)).status, 400);
  });

  it("runs a plan and returns evidence", async () => {
    const response = await fetch(`${base}/api/plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(planBody),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.mode, "fixture");
    assert.equal(body.people.length, 2);
    assert.ok(body.venues.length > 0);
    assert.ok(body.narration.headline.length > 0);
    assert.ok(body.provenance.calls.length >= 2);
    assert.ok(body.negotiation);
  });

  it("rejects a plan without a city", async () => {
    const response = await fetch(`${base}/api/plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...planBody, city: "" }),
    });
    assert.equal(response.status, 400);
  });

  it("rejects a group of one", async () => {
    const response = await fetch(`${base}/api/plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...planBody, people: [planBody.people[0]] }),
    });
    assert.equal(response.status, 400);
  });

  it("requires a JSON content type", async () => {
    assert.equal((await fetch(`${base}/api/plan`, { method: "POST", body: "city=Brooklyn" })).status, 415);
  });

  it("404s an unknown API route without leaking internals", async () => {
    const response = await fetch(`${base}/api/nope`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "Unknown endpoint." });
  });

  it("never serves source files", async () => {
    const response = await fetch(`${base}/../server/index.mjs`);
    assert.ok([200, 403, 404].includes(response.status));
    assert.equal((await response.text()).includes("QLOO_API_KEY"), false);
  });
});

describe("narrate", () => {
  const build = (leftAffinity, rightAffinity) =>
    joinCandidates([
      { label: "Sam", entities: [{ id: "1", name: "Almanac", affinity: leftAffinity, tags: [], address: "" }] },
      { label: "Jules", entities: [{ id: "1", name: "Almanac", affinity: rightAffinity, tags: [], address: "" }] },
    ]);

  it("names a shared winner and reports both scores", () => {
    const { venues } = build(0.8, 0.7);
    const copy = narrate({
      summary: summarize(venues, 2),
      taste: { shared: [], individual: [] },
      venues,
      people: ["Sam", "Jules"],
      city: "Brooklyn, NY",
    });
    assert.match(copy.advice, /Book Almanac/);
    assert.match(copy.advice, /80% for Sam/);
  });

  it("does not claim a shared winner when there is none", () => {
    const { venues } = joinCandidates([
      { label: "Sam", entities: [{ id: "1", name: "Jazz", affinity: 0.9, tags: [], address: "" }] },
      { label: "Jules", entities: [{ id: "2", name: "Pasta", affinity: 0.9, tags: [], address: "" }] },
    ]);
    const copy = narrate({
      summary: summarize(venues, 2),
      taste: { shared: [], individual: [] },
      venues,
      people: ["Sam", "Jules"],
      city: "Brooklyn, NY",
    });
    assert.doesNotMatch(copy.advice, /^Book/);
    assert.equal(copy.negotiated, null);
  });

  it("admits what the agent gave up", () => {
    const { venues } = build(0.8, 0.7);
    const copy = narrate({
      summary: summarize(venues, 2),
      taste: { shared: [], individual: [] },
      venues,
      people: ["Sam", "Jules"],
      city: "Brooklyn, NY",
      decisions: [{ id: "price", label: "Removed the price ceiling" }],
      constraints: { maxPriceLevel: 2 },
    });
    assert.match(copy.negotiated, /price ceiling/i);
  });
});

describe("cache", () => {
  it("expires entries once the TTL has passed", async () => {
    let clock = 0;
    const cache = createCache({ ttlMs: 1_000, now: () => clock });
    await cache.wrap("k", async () => "first");
    clock = 500;
    assert.equal((await cache.wrap("k", async () => "second")).value, "first");
    clock = 1_100;
    assert.equal((await cache.wrap("k", async () => "third")).value, "third");
  });

  it("evicts the least recently used entry past its limit", async () => {
    const cache = createCache({ maxEntries: 2 });
    await cache.wrap("a", async () => 1);
    await cache.wrap("b", async () => 2);
    await cache.wrap("a", async () => 1);
    await cache.wrap("c", async () => 3);
    assert.equal(cache.size(), 2);
    assert.equal(cache.get("b"), undefined);
  });
});
