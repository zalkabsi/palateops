# Architecture

PalateOps is a small, single-project application. The browser handles the scenario form and renders results; a Cloudflare Worker serves the same-origin assets and owns the optional server-side Qloo request.

The data flow is:

    Kitchen manager
      -> Browser UI
      -> Deterministic planner
      -> 32-recipe catalog
      -> Hard-constraint verifier
      -> Ingredient and shopping calculations
      -> Browser UI
      -> Browser localStorage for scenario settings

For live Qloo:

    Browser UI
      -> Same-origin Site Worker
      -> Qloo entity search and Insights API
      -> Normalized tags, entity IDs and timestamp
      -> Deterministic planner

## Data flow

1. The UI validates the service brief and stores form preferences in the visitor's browser.
2. Sample mode loads a labeled synthetic profile without contacting Qloo. Live mode posts up to three dining names to the same-origin Worker route.
3. The Worker resolves each dining name, requests tag insights, and returns a small normalized result with entity IDs, tags, endpoint and timestamp.
4. The planner enumerates vegetarian-plus-flexible recipe pairs for each weekday. It totals portions and ingredient costs, filters hard exclusions, and greedily selects a varied five-day plan under the daily cap.
5. A second run uses the same scenario and catalog plus the returned cuisine tag mappings. The baseline runs without those mappings.
6. A final verifier checks attendance, daily spend, the vegetarian option, allergen tags and repeated recipes. Procurement totals required quantities and nets stock on hand.

## Persistence and execution traces

The demo saves editable configuration in browser localStorage. Plans and traces live for the current page session. There is no user account, database, individual diner record or server-side plan history.

The visible trace is produced from actual deterministic application steps. It does not imply that an LLM was called. The optimization weights and planning assumptions are documented in OPTIMIZATION.md.
