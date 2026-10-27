#!/usr/bin/env node
/**
 * One-command live validation.
 *
 * Run this the moment the event credential arrives:
 *   QLOO_API_KEY=... npm run check:qloo
 *
 * It proves, against the real API rather than fixtures:
 *   1. the harness runs in this container
 *   2. the credential is accepted on the hackathon host
 *   3. place insights return venues, and whether they carry `affinity` and `tags`
 *   4. the full agent loop completes and produces a verdict
 *
 * Prints no secret. Exit code 1 means the submission is not ready.
 */

import { HACKATHON_BASE_URL, harnessEnv, isLiveConfigured, resolveHarness } from "../server/qloo.mjs";
import { createDataSource } from "../server/dataSource.mjs";
import { createCache } from "../server/cache.mjs";
import { parsePlanInput, runPlan } from "../server/agent.mjs";
import { PRESETS } from "../server/presets.mjs";

const presetId = process.argv[2] || "crate-digger";

function line(label, value) {
  console.log(`${label.padEnd(22)}${value}`);
}

async function main() {
  const environment = harnessEnv();
  line("Harness entry", resolveHarness().label);
  line("Node", process.version);
  line("Base URL", environment.QLOO_BASE_URL || HACKATHON_BASE_URL);
  line("Preset", presetId);
  console.log();

  if (!isLiveConfigured()) {
    console.error("QLOO_API_KEY is not set — nothing else can be checked.");
    console.error("Set it in the shell only (never in a file that reaches git):");
    console.error("  QLOO_API_KEY=your_key npm run check:qloo");
    process.exitCode = 1;
    return;
  }

  const preset = PRESETS.find((entry) => entry.id === presetId);
  if (!preset) {
    console.error(`Unknown preset "${presetId}". Available: ${PRESETS.map((entry) => entry.id).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const data = createDataSource(process.env);
  line("Mode", data.mode === "live" ? `live -> ${data.baseUrl}` : `fixture (${data.mode})`);
  if (data.mode !== "live") {
    console.error("\nFixture mode is forced. Unset DUET_MODE to validate live Qloo.");
    process.exitCode = 1;
    return;
  }
  console.log(`\nRunning the full agent loop for "${preset.title}" in ${preset.city} ...\n`);

  const input = parsePlanInput({
    city: preset.city,
    maxPriceLevel: preset.maxPriceLevel,
    people: preset.people.map((person) => ({ label: person.label, signals: person.signals })),
  });

  const cache = createCache();
  const result = await runPlan({ input, data, cache });

  const withAffinity = result.venues.filter((venue) => venue.affinitySource === "qloo").length;
  const withTags = result.venues.filter((venue) => (venue.tags ?? []).length > 0).length;

  console.log("RESULT");
  line("Verdict", result.narration.headline);
  line("Places seen", result.summary.total);
  line("Shared by everyone", result.summary.everyoneCount);
  line("Overlap", `${Math.round(result.summary.overlap * 100)}%`);
  line("Places with affinity", `${withAffinity}/${result.venues.length}`);
  line("Places with tags", `${withTags}/${result.venues.length}`);
  line("Qloo calls", result.provenance.calls.length);
  line("Cached calls", result.provenance.calls.filter((call) => call.cached).length);
  line("Negotiation", result.negotiation.decisions.map((decision) => `${decision.id} (${decision.by})`).join(", ") || "none needed");

  console.log("\nVERDICT TEXT");
  console.log(`  ${result.narration.detail}`);
  console.log(`  ${result.narration.advice}`);
  if (result.narration.negotiated) console.log(`  ${result.narration.negotiated}`);

  if (result.groups.everyone.length > 0) {
    console.log("\nTOP SHARED PLACES");
    for (const venue of result.groups.everyone.slice(0, 3)) {
      const scores = result.people.map((person, index) => `${person.label} ${venue.scores[index]}`).join(" · ");
      console.log(`  ${venue.name}  [${scores}]`);
    }
  }

  console.log("\nCALLS MADE");
  for (const call of result.provenance.calls) {
    const args = Object.entries(call.args)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => `${key}=${value}`)
      .join(" ");
    console.log(`  ${call.tool}  ${args}${call.cached ? "  (cached)" : ""}`);
  }

  // ---- go / no-go -------------------------------------------------------
  const problems = [];
  if (result.summary.total === 0) problems.push("Qloo returned no places at all for this city and these signals.");
  if (result.venues.length > 0 && withAffinity === 0) {
    problems.push("No place carried an `affinity` value; scoring falls back to rank position.");
  }
  if (result.venues.length > 0 && withTags === 0) {
    problems.push("No place carried tags; the shared-taste panel will be empty.");
  }

  console.log(`\n${"=".repeat(60)}`);
  if (problems.length === 0) {
    console.log("GO — live responses carry what the product needs.");
  } else {
    console.log("GO WITH CAVEATS — the loop runs, but:");
    for (const problem of problems) console.log(`  - ${problem}`);
    console.log("\nRecord these caveats in the submission description.");
  }
  console.log("=".repeat(60));
}

main().catch((error) => {
  console.error(`\nLive check failed: ${error.message}`);
  if (error.code) console.error(`code: ${error.code}`);
  process.exitCode = 1;
});
