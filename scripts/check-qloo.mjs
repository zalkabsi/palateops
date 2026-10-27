#!/usr/bin/env node
/**
 * One-command live check.
 *
 * Run this the moment the Qloo credential arrives:
 *   QLOO_API_KEY=... npm run check:qloo
 *
 * It proves three things the submission depends on:
 *   1. the harness runs in this container
 *   2. the credential is accepted
 *   3. Qloo actually returns venues AND affinity values for our request shape
 */

import { harnessVersion, isLiveConfigured, recommendPlaces, resolveHarness, searchEntities } from "../server/qloo.mjs";

const CITY = process.argv[2] || "Brooklyn, NY";
const SIGNAL = process.argv[3] || "Fela Kuti";

async function main() {
  const harness = resolveHarness();
  console.log(`Harness entry : ${harness.label}`);
  console.log(`Harness version: ${await harnessVersion()}`);
  console.log(`Node          : ${process.version}`);
  console.log(`City          : ${CITY}`);
  console.log(`Signal        : ${SIGNAL}\n`);

  if (!isLiveConfigured()) {
    console.error("QLOO_API_KEY is not set. Nothing else can be checked.");
    console.error("Set it in the shell (never in a file that reaches git):");
    console.error("  QLOO_API_KEY=your_key npm run check:qloo");
    process.exitCode = 1;
    return;
  }

  console.log("1/2 searching Qloo ...");
  const entities = await searchEntities({ query: SIGNAL, type: "music", take: 3 });
  if (entities.length === 0) {
    console.error(`Qloo returned no match for "${SIGNAL}".`);
    process.exitCode = 1;
    return;
  }
  const signal = entities[0];
  console.log(`    resolved to ${signal.name} (${signal.id})\n`);

  console.log(`2/2 ranking places in ${CITY} ...`);
  const venues = await recommendPlaces({ signals: [signal], city: CITY, take: 10 });
  console.log(`    ${venues.length} venues returned`);

  const withAffinity = venues.filter((venue) => typeof venue.affinity === "number");
  const withTags = venues.filter((venue) => venue.tags.length > 0);
  console.log(`    ${withAffinity.length}/${venues.length} carried an affinity value`);
  console.log(`    ${withTags.length}/${venues.length} carried tags`);

  console.log("\nTop results:");
  for (const venue of venues.slice(0, 5)) {
    const affinity = typeof venue.affinity === "number" ? venue.affinity.toFixed(3) : "  -  ";
    const tags = venue.tags.slice(0, 3).map((tag) => tag.name).join(", ");
    console.log(`  ${affinity}  ${venue.name}  ${tags ? `[${tags}]` : ""}`);
  }

  if (withAffinity.length === 0) {
    console.log("\nNo affinity field came back. PalateOps will fall back to Qloo rank position,");
    console.log("which is supported but less precise. Record this in the submission notes.");
  }
  if (withTags.length === 0) {
    console.log("\nNo tags came back. Shared-taste analysis will be empty. Request more fields.");
  }
  console.log("\nLive check complete.");
}

main().catch((error) => {
  console.error(`\nLive check failed: ${error.message}`);
  if (error.code) console.error(`code: ${error.code}`);
  process.exitCode = 1;
});
