#!/usr/bin/env node
/**
 * Warm the deployed cache with the starter groups.
 *
 * A cold plan pays a subprocess start per Qloo call (~15s each on a small
 * instance). Warming it once makes every judgment-day click sub-second, and the
 * cache is server-side only, so nothing about the groups is published.
 *
 * Run this AFTER any deploy or restart, because the cache is in memory:
 *   BASE_URL=https://palateops.onrender.com npm run warm
 */

import { PRESETS } from "../server/presets.mjs";

const BASE = (process.env.BASE_URL ?? "http://localhost:8080").replace(/\/+$/, "");

const payloadFor = (preset) => ({
  city: preset.city,
  maxPriceLevel: preset.maxPriceLevel ?? undefined,
  people: preset.people.map((person) => ({ label: person.label, signals: person.signals })),
});

async function timeOne(preset) {
  const started = Date.now();
  const response = await fetch(`${BASE}/api/plan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payloadFor(preset)),
    signal: AbortSignal.timeout(280_000),
  });
  const body = await response.json().catch(() => ({}));
  const seconds = (Date.now() - started) / 1000;
  if (!response.ok) return { ok: false, seconds, error: body.error ?? `http ${response.status}` };
  return { ok: true, seconds, body };
}

const label = (text, width) => text.padEnd(width);

console.log(`warming ${BASE}\n`);

for (const pass of ["cold", "warm"]) {
  for (const preset of PRESETS) {
    try {
      const result = await timeOne(preset);
      if (!result.ok) {
        console.log(`${label(preset.id, 18)} ${pass.padEnd(5)} FAILED  ${result.error}  (${result.seconds.toFixed(1)}s)`);
        continue;
      }
      const { summary, provenance } = result.body;
      console.log(
        `${label(preset.id, 18)} ${pass.padEnd(5)} ok  ${String(summary.total).padStart(3)} places · ` +
        `${summary.everyoneCount} shared · ${provenance.calls.length} calls  (${result.seconds.toFixed(1)}s)`,
      );
    } catch (error) {
      console.log(`${label(preset.id, 18)} ${pass.padEnd(5)} ERROR   ${error.message}`);
    }
  }
  if (pass === "cold") console.log("");
}

console.log("\nIf the second pass is not sub-second, the cache did not survive - check CACHE_TTL_MS.");
