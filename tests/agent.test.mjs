import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DuetInputError, parseDuetInput, runDuet } from "../server/agent.mjs";
import { createCache } from "../server/cache.mjs";

const SIGNAL = (name, type = "music") => ({ name, type });

function stubData({ searchCalls, recommendCalls, failSearch = false } = {}) {
  return {
    mode: "fixture",
    async search({ query, type }) {
      searchCalls?.push(`${type}:${query}`);
      if (failSearch) return [];
      return [{ id: `id-${query}`, name: query, tags: [] }];
    },
    async recommend({ signals, city }) {
      recommendCalls?.push({ names: signals.map((signal) => signal.name).sort().join("+"), city });
      const name = signals[0]?.name ?? "unknown";
      return [
        {
          id: `place-${name}`,
          name: `Place for ${name}`,
          address: city,
          popularity: 0.5,
          affinity: 0.8,
          tags: [{ id: "t", name: "shared", type: "urn:tag" }],
        },
      ];
    },
  };
}

const INPUT = {
  city: "Brooklyn, NY",
  a: { label: "Sam", signals: [SIGNAL("Fela Kuti")] },
  b: { label: "Jules", signals: [SIGNAL("Aesop", "brand")] },
};

describe("parseDuetInput", () => {
  it("rejects a missing city", () => {
    assert.throws(() => parseDuetInput({ a: INPUT.a, b: INPUT.b }), DuetInputError);
  });

  it("rejects a person with no signals", () => {
    assert.throws(() => parseDuetInput({ city: "Austin, TX", a: { label: "A", signals: [] }, b: INPUT.b }), DuetInputError);
  });

  it("de-duplicates signals and caps the list at six", () => {
    const signals = Array.from({ length: 9 }, (_, index) => SIGNAL(`Artist ${index}`));
    const parsed = parseDuetInput({ city: "Austin, TX", a: { signals: [...signals, signals[0]] }, b: INPUT.b });
    assert.equal(parsed.a.signals.length, 6);
  });

  it("keeps a supplied entity id and defaults an unknown type", () => {
    const parsed = parseDuetInput({ city: "Austin, TX", a: { signals: [{ name: "Aesop", id: "abc" }] }, b: INPUT.b });
    assert.equal(parsed.a.signals[0].id, "abc");
    assert.equal(parsed.a.signals[0].type, "music");
  });
});

describe("runDuet", () => {
  it("resolves both people and records the calls", async () => {
    const searchCalls = [];
    const recommendCalls = [];
    const result = await runDuet({
      input: parseDuetInput(INPUT),
      data: stubData({ searchCalls, recommendCalls }),
      cache: createCache(),
    });

    assert.equal(searchCalls.length, 2);
    assert.deepEqual(recommendCalls.map((call) => call.names).sort(), ["Aesop", "Fela Kuti"]);
    assert.equal(result.people.a.label, "Sam");
    assert.equal(result.people.a.signals[0].id, "id-Fela Kuti");
    assert.equal(result.provenance.calls.length, 4);
    assert.ok(result.trace.length >= 4);
    assert.equal(result.narrationSource, "rules");
  });

  it("does not re-spend quota on an identical second run", async () => {
    const searchCalls = [];
    const recommendCalls = [];
    const cache = createCache();
    const data = stubData({ searchCalls, recommendCalls });

    await runDuet({ input: parseDuetInput(INPUT), data, cache });
    const second = await runDuet({ input: parseDuetInput(INPUT), data, cache });

    assert.equal(searchCalls.length, 2, "second run must reuse resolved entities");
    assert.equal(recommendCalls.length, 2, "second run must reuse venue rankings");
    assert.ok(second.provenance.calls.every((call) => call.cached === true));
  });

  it("skips a signal Qloo cannot resolve but keeps the rest", async () => {
    const data = {
      mode: "fixture",
      async search({ query }) {
        return query === "Nobody" ? [] : [{ id: `id-${query}`, name: query, tags: [] }];
      },
      async recommend({ signals }) {
        return [{ id: "p1", name: "Place", affinity: 0.8, tags: [], address: "" }];
      },
    };
    const input = parseDuetInput({
      city: "Austin, TX",
      a: { label: "A", signals: [SIGNAL("Nobody"), SIGNAL("Somebody")] },
      b: INPUT.b,
    });
    const result = await runDuet({ input, data, cache: createCache() });
    assert.equal(result.people.a.signals.length, 1);
    assert.ok(result.trace.some((step) => step.ok === false));
  });

  it("fails clearly when nothing resolves", async () => {
    await assert.rejects(
      () => runDuet({ input: parseDuetInput(INPUT), data: stubData({ failSearch: true }), cache: createCache() }),
      (error) => error instanceof DuetInputError && /could be matched/.test(error.message),
    );
  });

  it("labels fixture output as fixture", async () => {
    const result = await runDuet({ input: parseDuetInput(INPUT), data: stubData(), cache: createCache() });
    assert.equal(result.mode, "fixture");
    assert.equal(result.provenance.mode, "fixture");
  });

  it("keeps the deterministic verdict when the model fails", async () => {
    const result = await runDuet({
      input: parseDuetInput(INPUT),
      data: stubData(),
      cache: createCache(),
      model: { configured: true, provider: "test", baseUrl: "http://127.0.0.1:1", apiKey: "x", model: "m" },
    });
    assert.equal(result.narrationSource, "rules");
    assert.ok(result.narration.headline.length > 0);
  });
});
