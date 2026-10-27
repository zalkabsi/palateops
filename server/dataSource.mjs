/**
 * Data source selector.
 *
 * The rest of the app talks to one interface. If a Qloo credential exists the
 * calls go to the harness; otherwise they resolve to labeled fixtures. There is
 * no silent fallback: `mode` is part of every response and shown in the UI.
 *
 * The effective environment also pins the hackathon base URL when the operator
 * supplied only a key. Event keys are rejected by every other host, so
 * defaulting here removes the most common integration failure in the guide.
 */

import { HACKATHON_BASE_URL, harnessVersion, isLiveConfigured, recommendPlaces, searchEntities } from "./qloo.mjs";
import { fixtureRecommendPlaces, fixtureSearch } from "./fixtures.mjs";

export function createDataSource(env = process.env) {
  const forcedFixture = String(env.DUET_MODE ?? env.PALATEOPS_MODE ?? "").toLowerCase() === "fixture";
  const live = isLiveConfigured(env) && !forcedFixture;
  const baseUrl = (typeof env.QLOO_BASE_URL === "string" && env.QLOO_BASE_URL.trim()) || HACKATHON_BASE_URL;

  const effectiveEnv = live ? { ...env, QLOO_BASE_URL: baseUrl } : env;

  return {
    mode: live ? "live" : "fixture",
    live,
    baseUrl,
    async search({ query, type, take }) {
      return live ? searchEntities({ query, type, take }, { env: effectiveEnv }) : fixtureSearch({ query, type, take });
    },
    async recommend({ signals, city, take, maxPriceLevel }) {
      return live
        ? recommendPlaces({ signals, city, take, maxPriceLevel }, { env: effectiveEnv })
        : fixtureRecommendPlaces({ signals, city, take, maxPriceLevel });
    },
    async version() {
      return live ? harnessVersion({ env: effectiveEnv }) : "fixture";
    },
  };
}
