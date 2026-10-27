import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BOTH_THRESHOLD,
  compareTaste,
  joinCandidates,
  mix,
  scoreEntity,
  summarize,
  tagProfile,
  verdictFor,
} from "../server/compromise.mjs";

const venue = (id, name, tags, affinity = null) => ({
  id,
  name,
  address: "",
  popularity: 0.5,
  affinity,
  tags: (tags ?? []).map((tag) => ({ id: `t-${tag}`, name: tag, type: "urn:tag" })),
});

describe("scoreEntity", () => {
  it("trusts a Qloo affinity when one is present", () => {
    assert.equal(scoreEntity({ affinity: 0.812 }, 9, 30), 0.812);
  });

  it("falls back to rank position when affinity is missing", () => {
    assert.equal(scoreEntity({ affinity: null }, 0, 10), 1);
    assert.equal(scoreEntity({ affinity: null }, 9, 10), 0.1);
  });

  it("rejects affinity values outside the unit interval", () => {
    assert.equal(scoreEntity({ affinity: 7 }, 0, 4), 1);
  });
});

describe("mix", () => {
  it("rewards a venue both people like over one that only one loves", () => {
    assert.ok(mix(0.7, 0.7) > mix(0.95, 0.2));
  });

  it("returns zero when either person does not want it", () => {
    assert.equal(mix(0.9, 0), 0);
  });

  it("is symmetric", () => {
    assert.equal(mix(0.62, 0.44), mix(0.44, 0.62));
  });
});

describe("joinCandidates", () => {
  it("marks a venue both people rank as a shared choice", () => {
    const venues = joinCandidates([venue("1", "Almanac", [], 0.8)], [venue("1", "Almanac", [], 0.75)]);
    assert.equal(venues.length, 1);
    assert.equal(venues[0].bucket, "both");
    assert.ok(venues[0].compromise >= BOTH_THRESHOLD);
  });

  it("keeps a one-sided venue out of the shared bucket", () => {
    const venues = joinCandidates(
      [venue("1", "Jazz Bar", [], 0.9)],
      [venue("2", "Pasta Place", [], 0.9)],
    );
    assert.equal(venues.filter((entry) => entry.bucket === "both").length, 0);
    assert.ok(venues.some((entry) => entry.bucket === "trade"));
  });

  it("records absence as a zero rather than dropping the venue", () => {
    const venues = joinCandidates([venue("1", "A", [], 0.9)], [venue("2", "B", [], 0.9)]);
    const first = venues.find((entry) => entry.id === "1");
    assert.equal(first.affinityB, 0);
    assert.equal(first.rankB, null);
  });

  it("records Qloo affinity provenance", () => {
    const fromAffinity = joinCandidates([venue("1", "A", [], 0.8)], [venue("1", "A", [], 0.8)]);
    assert.equal(fromAffinity[0].affinitySource, "qloo");
    const fromRank = joinCandidates([venue("1", "A", [], null)], [venue("1", "A", [], null)]);
    assert.equal(fromRank[0].affinitySource, "rank");
  });

  it("sorts by joint score, not by either person's preference", () => {
    const venues = joinCandidates(
      [venue("1", "A", [], 0.99), venue("2", "B", [], 0.7)],
      [venue("1", "A", [], 0.2), venue("2", "B", [], 0.7)],
    );
    assert.equal(venues[0].id, "2");
  });
});

describe("tagProfile and compareTaste", () => {
  it("separates shared taste from a one-sided obsession", () => {
    const left = tagProfile([
      { ...venue("1", "x", ["natural wine", "jazz"]), score: 0.9 },
      { ...venue("2", "y", ["natural wine"]), score: 0.8 },
    ]);
    const right = tagProfile([
      { ...venue("3", "z", ["natural wine", "rooftop"]), score: 0.9 },
      { ...venue("4", "w", ["natural wine"]), score: 0.7 },
    ]);
    const taste = compareTaste(left, right);
    assert.ok(taste.shared.some((entry) => entry.tag === "natural wine"));
    assert.equal(taste.shared.some((entry) => entry.tag === "jazz"), false);
  });

  it("ignores tags that describe what a place is rather than how it feels", () => {
    assert.equal(tagProfile([{ ...venue("1", "x", ["Restaurant", "jazz"]), score: 1 }]).has("restaurant"), false);
  });

  it("returns empty groups when a profile has no tags", () => {
    assert.deepEqual(compareTaste(new Map(), new Map()), { shared: [], onlyA: [], onlyB: [] });
  });
});

describe("summarize", () => {
  it("computes overlap as a share of every venue seen", () => {
    const venues = joinCandidates(
      [venue("1", "A", [], 0.9), venue("2", "B", [], 0.9)],
      [venue("1", "A", [], 0.9), venue("3", "C", [], 0.9)],
    );
    const summary = summarize(venues);
    assert.equal(summary.total, 3);
    assert.equal(summary.bothCount, 1);
    assert.equal(summary.overlap, 0.333);
  });

  it("is honest when nothing overlaps", () => {
    assert.equal(verdictFor({ overlap: 0, bothCount: 0, total: 4 }).tone, "hard");
    assert.equal(verdictFor({ overlap: 0, bothCount: 0, total: 0 }).headline, "No shared ground found");
  });
});
