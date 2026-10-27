import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, describe, it } from "node:test";

import { createApp } from "../server/index.mjs";
import { createCache } from "../server/cache.mjs";
import { narrate } from "../server/narrate.mjs";
import { summarize, joinCandidates } from "../server/compromise.mjs";

let server;
let base;

before(async () => {
  const app = createApp({ DUET_MODE: "fixture" });
  server = createServer(app.handle);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const duetBody = {
  city: "Brooklyn, NY",
  a: { label: "Sam", signals: [{ name: "Fela Kuti", type: "music" }] },
  b: { label: "Jules", signals: [{ name: "Aesop", type: "brand" }] },
};

describe("server", () => {
  it("reports fixture mode honestly", async () => {
    const response = await fetch(`${base}/api/health`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.mode, "fixture");
    assert.equal(body.qlooConfigured, false);
  });

  it("serves the shell page", async () => {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Duet/);
    assert.match(response.headers.get("content-security-policy"), /default-src 'self'/);
  });

  it("serves starter duos and taste domains", async () => {
    const body = await (await fetch(`${base}/api/presets`)).json();
    assert.ok(body.presets.length >= 3);
    assert.ok(body.tasteTypes.some((entry) => entry.alias === "music"));
  });

  it("rejects a search that is too short to be useful", async () => {
    const response = await fetch(`${base}/api/search?q=a`);
    assert.equal(response.status, 400);
  });

  it("runs a duet and returns evidence", async () => {
    const response = await fetch(`${base}/api/duet`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(duetBody),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.mode, "fixture");
    assert.ok(body.venues.length > 0);
    assert.ok(body.narration.headline.length > 0);
    assert.ok(body.provenance.calls.length >= 2);
  });

  it("rejects a duet without a city", async () => {
    const response = await fetch(`${base}/api/duet`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...duetBody, city: "" }),
    });
    assert.equal(response.status, 400);
  });

  it("requires a JSON content type", async () => {
    const response = await fetch(`${base}/api/duet`, { method: "POST", body: "city=Brooklyn" });
    assert.equal(response.status, 415);
  });

  it("404s an unknown API route without leaking internals", async () => {
    const response = await fetch(`${base}/api/nope`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "Unknown endpoint." });
  });

  it("refuses to serve files outside the public directory", async () => {
    const response = await fetch(`${base}/../server/index.mjs`);
    assert.ok([200, 403, 404].includes(response.status));
    const body = await response.text();
    assert.equal(body.includes("QLOO_API_KEY"), false);
  });
});

describe("narrate", () => {
  it("names a shared winner when one exists", () => {
    const venues = joinCandidates(
      [{ id: "1", name: "Almanac", affinity: 0.8, tags: [], address: "" }],
      [{ id: "1", name: "Almanac", affinity: 0.7, tags: [], address: "" }],
    );
    const copy = narrate({
      summary: summarize(venues),
      taste: { shared: [], onlyA: [], onlyB: [] },
      venues,
      a: { label: "Sam" },
      b: { label: "Jules" },
      city: "Brooklyn, NY",
    });
    assert.match(copy.advice, /Book Almanac/);
    assert.match(copy.advice, /80%/);
  });

  it("does not claim a shared winner when there is none", () => {
    const venues = joinCandidates(
      [{ id: "1", name: "Jazz", affinity: 0.9, tags: [], address: "" }],
      [{ id: "2", name: "Pasta", affinity: 0.9, tags: [], address: "" }],
    );
    const copy = narrate({
      summary: summarize(venues),
      taste: { shared: [], onlyA: [], onlyB: [] },
      venues,
      a: { label: "Sam" },
      b: { label: "Jules" },
      city: "Brooklyn, NY",
    });
    assert.doesNotMatch(copy.advice, /^Book/);
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
