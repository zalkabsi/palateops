import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MAX_PEOPLE, PlanInputError, parsePlanInput, runPlan } from "../server/agent.mjs";
import { createCache } from "../server/cache.mjs";

const signal = (name, type = "music") => ({ name, type });

function stubData({ searchCalls, recommendCalls, failSearch = false, disjointWhenPriced = false } = {}) {
  return {
    mode: "fixture",
    async search({ query }) {
      searchCalls?.push(query);
      if (failSearch) return [];
      return [{ id: `id-${query}`, name: query, tags: [] }];
    },
    async recommend({ signals, maxPriceLevel }) {
      const owner = signals[0]?.name ?? "unknown";
      recommendCalls?.push({ owner, maxPriceLevel: maxPriceLevel ?? null });
      if (disjointWhenPriced && maxPriceLevel) {
        // Nobody shares a place while the ceiling is on.
        return [{ id: `solo-${owner}`, name: `Only for ${owner}`, affinity: 0.9, tags: [], address: "" }];
      }
      return [
        { id: `place-${owner}`, name: `Place for ${owner}`, affinity: 0.8, tags: [{ id: "t", name: "shared", type: "urn:tag" }], address: "" },
        { id: "place-common", name: "Common Ground", affinity: 0.72, tags: [{ id: "t", name: "shared", type: "urn:tag" }], address: "" },
      ];
    },
  };
}

const INPUT = {
  city: "Brooklyn, NY",
  people: [
    { label: "Sam", signals: [signal("Fela Kuti")] },
    { label: "Jules", signals: [signal("Aesop", "brand")] },
  ],
};

describe("parsePlanInput", () => {
  it("rejects a missing city", () => {
    assert.throws(() => parsePlanInput({ people: INPUT.people }), PlanInputError);
  });

  it("requires at least two people", () => {
    assert.throws(() => parsePlanInput({ city: "Austin, TX", people: [INPUT.people[0]] }), PlanInputError);
  });

  it("caps the group size", () => {
    const people = Array.from({ length: MAX_PEOPLE + 1 }, (_, index) => ({ label: `P${index}`, signals: [signal("X")] }));
    assert.throws(() => parsePlanInput({ city: "Austin, TX", people }), PlanInputError);
  });

  it("rejects a person with no signals", () => {
    assert.throws(
      () => parsePlanInput({ city: "Austin, TX", people: [{ label: "A", signals: [] }, INPUT.people[1]] }),
      PlanInputError,
    );
  });

  it("de-duplicates signals and caps each list at six", () => {
    const signals = Array.from({ length: 9 }, (_, index) => signal(`Artist ${index}`));
    const parsed = parsePlanInput({ city: "Austin, TX", people: [{ label: "A", signals: [...signals, signals[0]] }, INPUT.people[1]] });
    assert.equal(parsed.people[0].signals.length, 6);
  });

  it("keeps a supplied entity id and normalises an unknown type", () => {
    const parsed = parsePlanInput({ city: "Austin, TX", people: [{ label: "A", signals: [{ name: "Aesop", id: "abc" }] }, INPUT.people[1]] });
    assert.equal(parsed.people[0].signals[0].id, "abc");
    assert.equal(parsed.people[0].signals[0].type, "music");
  });

  it("normalises an out-of-range price ceiling to none", () => {
    assert.equal(parsePlanInput({ ...INPUT, maxPriceLevel: 9 }).constraints.maxPriceLevel, null);
    assert.equal(parsePlanInput({ ...INPUT, maxPriceLevel: 2 }).constraints.maxPriceLevel, 2);
  });
});

describe("runPlan", () => {
  it("asks Qloo once per person, never once for the group", async () => {
    const recommendCalls = [];
    const result = await runPlan({ input: parsePlanInput(INPUT), data: stubData({ recommendCalls }), cache: createCache() });
    assert.equal(recommendCalls.length, 2);
    assert.deepEqual(recommendCalls.map((call) => call.owner).sort(), ["Aesop", "Fela Kuti"]);
    assert.equal(result.people.length, 2);
  });

  it("records every call with its argument shape", async () => {
    const result = await runPlan({ input: parsePlanInput(INPUT), data: stubData(), cache: createCache() });
    assert.equal(result.provenance.calls.length, 4);
    assert.ok(result.provenance.calls.some((call) => call.tool === "qloo api search"));
    assert.ok(result.provenance.calls.some((call) => call.tool === "qloo api insights"));
  });

  it("does not re-spend quota on an identical second run", async () => {
    const searchCalls = [];
    const recommendCalls = [];
    const cache = createCache();
    const data = stubData({ searchCalls, recommendCalls });
    await runPlan({ input: parsePlanInput(INPUT), data, cache });
    const second = await runPlan({ input: parsePlanInput(INPUT), data, cache });
    assert.equal(searchCalls.length, 2);
    assert.equal(recommendCalls.length, 2);
    assert.ok(second.provenance.calls.every((call) => call.cached === true));
  });

  it("relaxes a constraint and re-asks Qloo when nobody shares a place", async () => {
    const recommendCalls = [];
    const input = parsePlanInput({ ...INPUT, maxPriceLevel: 2 });
    const result = await runPlan({ input, data: stubData({ recommendCalls, disjointWhenPriced: true }), cache: createCache() });

    assert.ok(result.negotiation.decisions.length >= 1);
    assert.equal(result.negotiation.decisions[0].id, "price");
    assert.ok(result.negotiation.settledAfter >= 2, "expected a second attempt");
    // Two people, first pass priced, second pass relaxed.
    assert.ok(recommendCalls.filter((call) => call.maxPriceLevel === null).length >= 2);
    assert.ok(result.narration.negotiated.length > 0);
  });

  it("does not relax when a shared place already exists", async () => {
    const input = parsePlanInput({ ...INPUT, maxPriceLevel: 2 });
    const result = await runPlan({ input, data: stubData(), cache: createCache() });
    assert.equal(result.negotiation.settledAfter, 1);
    assert.equal(result.negotiation.decisions.length, 0);
  });

  it("skips a signal Qloo cannot resolve but keeps the rest", async () => {
    const data = {
      mode: "fixture",
      async search({ query }) {
        return query === "Nobody" ? [] : [{ id: `id-${query}`, name: query, tags: [] }];
      },
      async recommend() {
        return [{ id: "p1", name: "Place", affinity: 0.8, tags: [], address: "" }];
      },
    };
    const input = parsePlanInput({
      city: "Austin, TX",
      people: [{ label: "A", signals: [signal("Nobody"), signal("Somebody")] }, INPUT.people[1]],
    });
    const result = await runPlan({ input, data, cache: createCache() });
    assert.equal(result.people[0].signals.length, 1);
    assert.ok(result.trace.some((step) => step.ok === false));
  });

  it("fails clearly when nothing resolves", async () => {
    await assert.rejects(
      () => runPlan({ input: parsePlanInput(INPUT), data: stubData({ failSearch: true }), cache: createCache() }),
      (error) => error instanceof PlanInputError && /could be matched/.test(error.message),
    );
  });

  it("labels fixture output as fixture", async () => {
    const result = await runPlan({ input: parsePlanInput(INPUT), data: stubData(), cache: createCache() });
    assert.equal(result.mode, "fixture");
    assert.equal(result.provenance.mode, "fixture");
  });

  it("keeps the deterministic verdict when the model fails", async () => {
    const result = await runPlan({
      input: parsePlanInput(INPUT),
      data: stubData(),
      cache: createCache(),
      model: { configured: true, provider: "test", baseUrl: "http://127.0.0.1:1", apiKey: "x", model: "m" },
    });
    assert.equal(result.narrationSource, "rules");
    assert.ok(result.narration.headline.length > 0);
  });
});
