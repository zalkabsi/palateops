/**
 * Data source selector.
 *
 * The rest of the app talks to one interface. If a Qloo credential exists the
 * calls go to the harness; otherwise they resolve to labeled fixtures. There is
 * no silent fallback: `mode` is part of every response and shown in the UI.
 */

import { isLiveConfigured, recommendPlaces, searchEntities, harnessVersion } from "./qloo.mjs";
import { fixtureRecommendPlaces, fixtureSearch } from "./fixtures.mjs";

export function createDataSource(env = process.env) {
  const forcedFixture = String(env.DUET_MODE ?? "").toLowerCase() === "fixture";
  const live = isLiveConfigured(env) && !forcedFixture;

  return {
    mode: live ? "live" : "fixture",
    live,
    async search({ query, type, take }) {
      return live ? searchEntities({ query, type, take }, { env }) : fixtureSearch({ query, type, take });
    },
    async recommend({ signals, city, take }) {
      return live ? recommendPlaces({ signals, city, take }, { env }) : fixtureRecommendPlaces({ signals, city, take });
    },
    async version() {
      return live ? harnessVersion({ env }) : "fixture";
    },
  };
}
