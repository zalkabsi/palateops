# Architecture

PalateOps is a small, single-project application. The browser handles the scenario form and renders results; a Cloudflare Worker serves same-origin assets and proxies optional live requests to a separate Node.js Qloo Harness backend.

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
      -> HTTPS Node.js 22.19+ container with Qloo Harness
      -> Qloo search and Insights endpoints through `qloo api`
      -> Exact-match place IDs, recommended entities, nested tags and timestamp
      -> Deterministic planner

## Data flow

1. The UI validates the service brief and stores form preferences in the visitor's browser.
2. Sample mode loads a labeled synthetic profile without contacting Qloo. Live mode posts up to three voluntary restaurant names to the same-origin Worker route.
3. The Worker validates the request and proxies it to the Node backend with a shared bearer token. The backend resolves exact restaurant names through `qloo api search`; missing or ambiguous matches return suggestions without requesting Insights.
4. The browser displays the resolved matches for user confirmation. After confirmation, the backend calls `qloo api insights` and aggregates tags nested on recommended restaurant entities. The response includes place IDs, recommendations, tags, endpoint and timestamp.
5. The planner enumerates vegetarian-plus-flexible recipe pairs for each weekday. It totals portions and ingredient costs, filters hard exclusions, and greedily selects a varied five-day plan under the daily cap.
6. A second run uses the same scenario and catalog plus returned cuisine tag mappings. The baseline runs without those mappings.
7. A final verifier checks attendance, daily spend, the vegetarian option, allergen tags and repeated recipes. Procurement totals required quantities and nets stock on hand.

The container runs on Node.js 22.19 or newer as required by the current Qloo Hackathon Kit. `QLOO_API_KEY` stays in the container secret manager; `QLOO_BACKEND_TOKEN` is shared with the Site runtime. There is no browser-to-Qloo request and no serverless Qloo Harness execution.

## Persistence and execution traces

The demo saves editable configuration in browser localStorage. Plans and traces live for the current page session. There is no user account, database, individual diner record or server-side plan history.

The visible trace is produced from actual deterministic application steps. It does not imply that an LLM was called. The optimization weights and planning assumptions are documented in OPTIMIZATION.md.
