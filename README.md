# PalateOps

**Food planning powered by cultural intelligence.**

**Try the public demo:** [palateops-qloo.zeynkbsi.chatgpt.site](https://palateops-qloo.zeynkbsi.chatgpt.site). It opens in Sample mode with labeled synthetic taste cues; Live Qloo mode needs an authorized event key.

PalateOps helps cafeteria teams turn attendance, budget, dietary rules and voluntary dining interests into a five-day operational menu. It compares an operational baseline with a taste-signal plan, checks hard constraints, totals estimated ingredient costs and prepares a shopping list.

> The default public demo uses synthetic taste cues. They are labeled and are not Qloo responses. Live Qloo requests require an authorized event credential installed as a server-side Site secret. No live validation has been completed yet.

## What you can try

- Generate a five-day, two-option cafeteria menu for Campus Commons.
- Change daily covers, budget, vegetarian share, exclusions, equipment and stock on hand.
- Compare the same scenario with and without a taste signal.
- See portions, recipe cost estimates, constraints and the tool trace.
- Apply a 25% attendance increase and 20% chicken-price increase, then replan.
- Export the consolidated shopping list to CSV.
- Switch to Live Qloo mode to use one to three dining names after an authorized key is configured.

## Product screenshots

![PalateOps weekly planner showing the sample menu, comparison, shopping list and activity trace](docs/screenshots/palateops-demo.png)

The screenshot shows labeled synthetic sample data, not a live Qloo response.

## How the taste signal works

Sample mode uses deterministic, synthetic profiles and makes no Qloo API call. Live mode sends up to three voluntary dining names to the Worker. The Worker resolves place entities and requests Qloo tag insights with its server-side credential. The planner maps only returned tag labels it can match to recipe cuisines. It does not fabricate Qloo scores or predict diner satisfaction. If no tags map to the catalog, the plan remains operational and the app reports that result.

See [the Qloo validation log](docs/QLOO_VALIDATION.md) for official references, the adapter contract and the live-test status.

## Planning model

The catalog contains 32 original demo recipes with illustrative ingredient quantities, estimated US-dollar prices, dietary tags and equipment needs. The planner generates feasible vegetarian-plus-flexible pairs, checks the daily budget and attendance, and returns an explicit infeasible result when it cannot satisfy the rules. It uses a deterministic greedy scoring heuristic; it is not an integer-programming proof of optimality.

Recipe prices are demonstrations, not supplier quotes. Nutrition figures are omitted because they have not been verified. Allergen metadata is a screening aid and does not guarantee safe preparation or prevent cross-contact.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the data flow and [docs/OPTIMIZATION.md](docs/OPTIMIZATION.md) for assumptions and scoring.

![PalateOps request, planning and procurement flow](docs/architecture.svg)

## Technology

- Vanilla JavaScript, HTML and CSS
- Cloudflare Worker-compatible Site runtime
- Node.js built-in test runner
- No browser-side Qloo key and no required user account

## Run locally

Requires Node.js 20 or later.

1. Run npm install.
2. Run npm test to build the Worker artifact and run unit, adapter and Worker route tests.
3. Install a Chromium browser for Playwright if one is not already available, then run npm run test:e2e for browser smoke coverage.
4. Run npm run preview and open the printed local URL for the sample interface.

The local static preview serves the Sample mode UI. The live Qloo route is available on the deployed Worker, where QLOO_API_KEY must be configured as a secret.

## Environment

| Name | Required | Purpose |
| --- | --- | --- |
| QLOO_API_KEY | No for Sample mode; required for live mode | Event-issued Qloo credential stored in the Site runtime secret manager |

The adapter uses the documented Qloo search and v2 Insights routes. Review event credential restrictions before enabling direct REST requests; the event's public kit documents its supported harness surfaces.

## Deploy

The Site source manifest is .openai/hosting.json. Build output is written to dist/server/index.js and dist/.openai/hosting.json for the Worker hosting workflow. Configure QLOO_API_KEY in the Site runtime secret store, run npm test, build and publish the saved source version, then verify the public URL and access mode.

Do not set a credential in a browser bundle, localStorage, repository, screenshot, or public demo instructions.

## Tests

Run npm test for recipe metadata, invalid inputs, serving and cost calculations, feasibility, allergen preservation, procurement stock netting, sample and live response normalization, and Worker routes with no credential. Run npm run test:e2e for browser coverage of plan generation, supply-shock replanning, CSV export and mobile overflow. The Qloo response fixture is synthetic; live API behavior is not tested without an event-issued credential.

## Hackathon references

- [Qloo Agentic Hackathon rules](https://qloo.devpost.com/rules)
- [Qloo public API docs](https://github.com/qloo/docs-public)
- [Qloo Hackathon Kit](https://github.com/qloo/qloo-hackathon-kit)
- [USDA FoodData Central API](https://fdc.nal.usda.gov/api-guide/)

## Known limitations

- No event key was available when this version was built; live Qloo calls and the three-profile experiment remain pending.
- Qloo cuisine-to-recipe mapping may be empty or ambiguous.
- Ingredient prices and quantity needs are illustrative. Labor, yield loss, nutrition, equipment throughput and local currency conversion are not modeled.
- The 35% vegetarian share is a planning assumption, not measured attendance.
- Scenario persistence is browser-local; there is no account, database or server-side plan history.
- The heuristic is deterministic but not globally optimal.

## License

MIT. See [LICENSE](LICENSE).
