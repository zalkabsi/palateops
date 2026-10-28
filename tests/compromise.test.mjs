import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EVERYONE_THRESHOLD,
  displayTags,
  isInformativeTag,
  ubiquitousTags,
  compareTaste,
  joinCandidates,
  mixMany,
  scoreEntity,
  summarize,
  tagProfile,
  verdictFor,
} from "../server/compromise.mjs";

const place = (id, name, tags, affinity = null) => ({
  id,
  name,
  address: "",
  popularity: 0.5,
  affinity,
  tags: (tags ?? []).map((tag) => ({ id: `t-${tag}`, name: tag, type: "urn:tag" })),
});

const lists = (...entries) => entries.map(([label, entities]) => ({ label, entities }));

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

describe("mixMany", () => {
  it("rewards a place everybody likes over one a single person loves", () => {
    assert.ok(mixMany([0.7, 0.7]) > mixMany([0.95, 0.2]));
  });

  it("returns zero as soon as one person is uninterested", () => {
    assert.equal(mixMany([0.9, 0, 0.9]), 0);
  });

  it("handles groups larger than two", () => {
    assert.equal(mixMany([0.6, 0.6, 0.6]), 0.6);
    assert.ok(mixMany([0.6, 0.6, 0.6]) > mixMany([0.9, 0.9, 0.1]));
  });

  it("is symmetric", () => {
    assert.equal(mixMany([0.62, 0.44, 0.8]), mixMany([0.8, 0.62, 0.44]));
  });

  it("returns zero for an empty group", () => {
    assert.equal(mixMany([]), 0);
  });
});

describe("joinCandidates", () => {
  it("marks a place every person ranks as a shared answer", () => {
    const { venues } = joinCandidates(lists(["A", [place("1", "Almanac", [], 0.8)]], ["B", [place("1", "Almanac", [], 0.75)]]));
    assert.equal(venues.length, 1);
    assert.equal(venues[0].bucket, "everyone");
    assert.ok(venues[0].joint >= EVERYONE_THRESHOLD);
  });

  it("keeps a one-sided place out of the shared bucket", () => {
    const { venues } = joinCandidates(lists(["A", [place("1", "Jazz", [], 0.9)]], ["B", [place("2", "Pasta", [], 0.9)]]));
    assert.equal(venues.filter((venue) => venue.bucket === "everyone").length, 0);
    assert.ok(venues.some((venue) => venue.bucket === "trade"));
  });

  it("records absence as zero rather than dropping the place", () => {
    const { venues } = joinCandidates(lists(["A", [place("1", "A", [], 0.9)]], ["B", [place("2", "B", [], 0.9)]]));
    const first = venues.find((venue) => venue.id === "1");
    assert.deepEqual(first.scores, [0.9, 0]);
    assert.equal(first.present, 1);
  });

  it("keeps scores aligned to the people, not to arrival order", () => {
    const { venues, people } = joinCandidates(
      lists(["Ann", [place("x", "Same", [], 0.4)]], ["Bo", [place("x", "Same", [], 0.9)]], ["Cy", [place("x", "Same", [], 0.6)]]),
    );
    assert.deepEqual(people, ["Ann", "Bo", "Cy"]);
    assert.deepEqual(venues[0].scores, [0.4, 0.9, 0.6]);
  });

  it("records Qloo affinity provenance", () => {
    const withAffinity = joinCandidates(lists(["A", [place("1", "A", [], 0.8)]], ["B", [place("1", "A", [], 0.8)]]));
    assert.equal(withAffinity.venues[0].affinitySource, "qloo");
    const fromRank = joinCandidates(lists(["A", [place("1", "A", [], null)]], ["B", [place("1", "A", [], null)]]));
    assert.equal(fromRank.venues[0].affinitySource, "rank");
  });

  it("sorts by group score, not by any single preference", () => {
    const { venues } = joinCandidates(
      lists(["A", [place("1", "Loud", [], 0.99), place("2", "Shared", [], 0.7)]], ["B", [place("1", "Loud", [], 0.2), place("2", "Shared", [], 0.7)]]),
    );
    assert.equal(venues[0].id, "2");
  });
});

describe("taste comparison", () => {
  it("separates shared taste from one person's obsession", () => {
    const profiles = [
      { label: "A", vocab: tagProfile([{ ...place("1", "x", ["natural wine", "jazz"]), score: 0.9 }]) },
      { label: "B", vocab: tagProfile([{ ...place("2", "y", ["natural wine"]), score: 0.9 }]) },
    ];
    const taste = compareTaste(profiles);
    assert.ok(taste.shared.some((entry) => entry.tag === "natural wine"));
    assert.ok(taste.individual[0].tags.some((entry) => entry.tag === "jazz"));
  });

  it("requires every person to rank a tag highly for it to be shared", () => {
    const profiles = [
      { label: "A", vocab: new Map([["jazz", 1]]) },
      { label: "B", vocab: new Map([["jazz", 1]]) },
      { label: "C", vocab: new Map([["jazz", 0.1]]) },
    ];
    assert.equal(compareTaste(profiles).shared.length, 0);
  });

  it("ignores tags that describe what a place is rather than how it feels", () => {
    assert.equal(tagProfile([{ ...place("1", "x", ["Restaurant", "jazz"]), score: 1 }]).has("restaurant"), false);
  });

  it("returns empty groups when there is nothing to compare", () => {
    assert.deepEqual(compareTaste([]), { shared: [], individual: [] });
  });
});

describe("summary", () => {
  it("computes overlap as a share of every place seen", () => {
    const { venues } = joinCandidates(
      lists(["A", [place("1", "A", [], 0.9), place("2", "B", [], 0.9)]], ["B", [place("1", "A", [], 0.9), place("3", "C", [], 0.9)]]),
    );
    const summary = summarize(venues, 2);
    assert.equal(summary.total, 3);
    assert.equal(summary.everyoneCount, 1);
    assert.equal(summary.overlap, 0.333);
  });

  it("is honest when nothing overlaps", () => {
    assert.equal(verdictFor({ overlap: 0, everyoneCount: 0, total: 4 }).tone, "hard");
    assert.equal(verdictFor({ overlap: 0, everyoneCount: 0, total: 0 }).headline, "No shared ground found");
  });
});

describe("tag vocabulary hygiene", () => {
  it("keeps taste and drops logistics", () => {
    for (const tag of ["jazz", "natural wine", "dance floor", "artisanal", "picturesque"]) {
      assert.equal(isInformativeTag(tag), true, `${tag} should survive`);
    }
    for (const tag of ["dine in", "takeout", "wheelchair accessible seating", "nfc mobile payments", "onsite services"]) {
      assert.equal(isInformativeTag(tag), false, `${tag} should be dropped`);
    }
  });

  it("drops age brackets and audiences", () => {
    for (const tag of ["25 29", "30 34", "18-24", "55 and older", "locals", "tourists", "young adults"]) {
      assert.equal(isInformativeTag(tag), false, `${tag} should be dropped`);
    }
  });

  it("drops bare containers", () => {
    for (const tag of ["place", "destination", "venue", "point of interest"]) {
      assert.equal(isInformativeTag(tag), false);
    }
  });

  it("cuts tags that appear on most venues", () => {
    const venues = [
      { tags: [{ name: "wine" }, { name: "jazz" }] },
      { tags: [{ name: "wine" }, { name: "vinyl" }] },
      { tags: [{ name: "wine" }, { name: "wood-fired" }] },
      { tags: [{ name: "wine" }, { name: "garden" }] },
    ];
    const common = ubiquitousTags(venues, { floor: 0.5 });
    assert.equal(common.has("wine"), true);
    assert.equal(common.has("jazz"), false);
  });

  it("never shows logistics on a venue card", () => {
    const shown = displayTags([{ name: "takeout" }, { name: "Neapolitan" }, { name: "Iced chocolate" }, { name: "Afternoon" }], 3);
    assert.deepEqual(shown.map((tag) => tag.name), ["Neapolitan", "Iced chocolate", "Afternoon"]);
  });
});
