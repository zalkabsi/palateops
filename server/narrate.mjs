/**
 * Deterministic verdict writer.
 *
 * The default voice of the agent. It only restates computed evidence, so the
 * app never depends on a model being available - and when a model is
 * configured, this is the shape its output must match.
 */

import { EVERYONE_THRESHOLD } from "./compromise.mjs";

export function narrate({ summary, taste, venues, people, city, decisions = [], constraints = {} }) {
  const everyone = venues.filter((venue) => venue.bucket === "everyone");
  const trade = venues.filter((venue) => venue.bucket === "trade");
  const shared = taste.shared.slice(0, 3).map((entry) => entry.tag);
  const names = people.filter(Boolean);
  const group = names.length > 2 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names.join(" and ");

  const detailParts = [summary.verdict.detail];
  if (shared.length > 0) {
    detailParts.push(`${group} all respond to ${list(shared)}.`);
  } else if (summary.total > 0) {
    detailParts.push("Their tastes share no vocabulary, which is exactly why this is hard.");
  }

  const advice = [];
  if (everyone.length > 0) {
    const first = everyone[0];
    const split = names.map((name, index) => `${percent(first.scores[index])} for ${name}`).join(", ");
    advice.push(`Book ${first.name} — ${split}.`);
    if (everyone.length > 1) {
      const more = everyone.length - 1;
      advice.push(`${more} more ${more === 1 ? "place clears" : "places clear"} the same bar.`);
    }
  } else if (trade.length > 0) {
    const owner = trade[0].scores.indexOf(Math.max(...trade[0].scores));
    advice.push(`No place wins for everyone. ${trade[0].name} is ${names[owner]}'s, and the rest are yielding.`);
  } else {
    advice.push(`Qloo found no shared place in ${city} for these tastes. Widen the city or swap a signal.`);
  }

  return {
    headline: summary.verdict.headline,
    detail: detailParts.join(" ").trim(),
    advice: advice.join(" ").trim(),
    negotiated: negotiatedLine({ decisions, summary, constraints }),
    threshold: EVERYONE_THRESHOLD,
  };
}

/** Explain any constraint the agent gave up, or return null. */
function negotiatedLine({ decisions, summary, constraints }) {
  if (!decisions || decisions.length === 0) return null;
  const labels = list(decisions.map((decision) => decision.label.toLowerCase()));
  if (summary.everyoneCount === 0) {
    return `No place cleared everyone, even after the agent ${labels}. What follows is the best available concession, not a compromise.`;
  }
  const clause = constraints && constraints.maxPriceLevel ? "inside the price ceiling" : "under the original brief";
  return `No place cleared everyone ${clause}, so the agent ${labels} and found ${summary.everyoneCount} shared ${
    summary.everyoneCount === 1 ? "place" : "places"
  }.`;
}

function percent(value) {
  return `${Math.round((Number.isFinite(value) ? value : 0) * 100)}%`;
}

function list(items) {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}
