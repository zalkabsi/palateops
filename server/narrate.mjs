/**
 * Deterministic verdict writer.
 *
 * This is the default voice. It only restates computed evidence, so the app
 * never depends on a model being available - and when a model IS configured,
 * this output is the shape it must match.
 */

import { BOTH_THRESHOLD } from "./compromise.mjs";

export function narrate({ summary, taste, venues, a, b, city }) {
  const both = venues.filter((venue) => venue.bucket === "both");
  const trade = venues.filter((venue) => venue.bucket === "trade");
  const shared = taste.shared.slice(0, 3).map((entry) => entry.tag);
  const nameA = a?.label || "One";
  const nameB = b?.label || "The other";

  const detailParts = [summary.verdict.detail];
  if (shared.length > 0) {
    detailParts.push(`${nameA} and ${nameB} both gravitate to ${list(shared)}.`);
  } else if (summary.total > 0) {
    detailParts.push("Their tastes do not share a vocabulary, which is exactly why picking a place is hard.");
  }

  const advice = [];
  if (both.length > 0) {
    const first = both[0];
    advice.push(`Book ${first.name}: ${percent(first.affinityA)} for ${nameA}, ${percent(first.affinityB)} for ${nameB}.`);
    if (both.length > 1) {
      const more = both.length - 1;
      advice.push(`${more} more ${more === 1 ? "place clears" : "places clear"} the same bar.`);
    }
  } else if (trade.length > 0) {
    const forA = trade.find((venue) => venue.affinityA >= venue.affinityB);
    const forB = trade.find((venue) => venue.affinityB > venue.affinityA);
    if (forA && forB) advice.push(`No place wins for both. ${forA.name} is ${nameA}'s, ${forB.name} is ${nameB}'s.`);
    else advice.push("No place wins for both. This one is a straight trade.");
  } else {
    advice.push(`Qloo could not find a shared venue in ${city} for these signals. Widen the city or swap a signal.`);
  }

  return {
    headline: summary.verdict.headline,
    detail: detailParts.join(" ").trim(),
    advice: advice.join(" ").trim(),
    threshold: BOTH_THRESHOLD,
  };
}

function percent(value) {
  return `${Math.round((Number.isFinite(value) ? value : 0) * 100)}%`;
}

function list(items) {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}
