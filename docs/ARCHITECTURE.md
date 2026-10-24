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
5. The planner enumerates eligible daily menus, rejects combinations over the daily cap, serving capacity or hard exclusions, and selects five distinct menus using the configured deterministic scoring weights.
6. A second run uses the same scenario and catalog plus returned cuisine tag mappings. The baseline runs without those mappings.
7. A final verifier checks capacity, attendance, daily spend, vegetarian portions, catalog metadata, exclusions and distinct daily menus. Procurement totals canonical recipe quantities and nets stock on hand.
8. Dashboard charts and the CSV planning pack read those calculated menu and procurement results; they do not use unrelated sample chart values.

The container runs on Node.js 22.19 or newer as required by the current Qloo Hackathon Kit. `QLOO_API_KEY` stays in the container secret manager; `QLOO_BACKEND_TOKEN` is shared with the Site runtime. There is no browser-to-Qloo request and no serverless Qloo Harness execution.

## Persistence and execution traces

The demo saves editable configuration in browser localStorage. The current page session keeps up to six generated plans and their traces so the manager can restore a prior run or undo a supply shock. History clears when the page reloads or the demo is reset. There is no user account, database, individual diner record or server-side plan history.

The rules trace is produced from actual deterministic application steps. The optional AI method runs in the Node backend: OpenAI Responses selects `get_taste_signals`, `optimize_menu`, `verify_plan` and `build_procurement` tools over server-owned state. The backend requires independent verification of both plans, and the browser verifies them again before rendering. AI tool calls produce their own trace and a labeled generated note. See [AGENT.md](AGENT.md) for the complete contract and current fixture-only validation status.

AI requests send operational constraints and tool results to the model provider; the cafeteria name is excluded. Model credentials remain in the Node host and are excluded from the Qloo child environment. The Worker publishes only a boolean AI capability from backend health. The optimization weights and planning assumptions are documented in OPTIMIZATION.md.
