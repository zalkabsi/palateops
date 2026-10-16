# PalateOps

**Food planning powered by cultural intelligence.**

**Try the public demo:** [palateops-qloo.zeynkbsi.chatgpt.site](https://palateops-qloo.zeynkbsi.chatgpt.site). It opens in Sample mode with labeled synthetic taste cues; Live Qloo mode needs an authorized event key.

PalateOps helps cafeteria teams turn attendance, budget, dietary rules and voluntary dining interests into a five-day operational menu. It compares an operational baseline with a taste-signal plan, checks hard constraints, totals estimated ingredient costs and prepares a shopping list.

> The default public demo uses synthetic taste cues. They are labeled and are not Qloo responses. Live Qloo requests require the event-issued credential and a separately hosted Node.js 22.19+ backend running the Qloo Harness. No live validation has been completed yet.

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

Sample mode uses deterministic, synthetic profiles and makes no Qloo API call. Live mode sends up to three voluntary restaurant names to the same-origin Worker. The Worker forwards them to a separate Node.js 22.19+ service running the official Qloo Harness. The browser displays exact place matches for confirmation before the service requests restaurant recommendations and their nested tags. The planner maps only returned tag labels it can match to recipe cuisines. It does not fabricate Qloo scores or predict diner satisfaction. If no tags map to the catalog, the plan remains operational and the app reports that result.

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

The local static preview serves Sample mode only. Live Qloo runs through the deployed Site Worker after its backend URL and shared token are configured. Local live testing requires a Worker-compatible runtime configured to proxy to the Node backend.

## Environment

| Name | Required | Purpose |
| --- | --- | --- |
| QLOO_API_KEY | No for Sample mode; required for live mode | Event-issued credential stored only in the Qloo backend container's secret manager |
| QLOO_BACKEND_TOKEN | No for Sample mode; required for live mode | Random shared bearer token stored in the container and Site runtime secret managers |
| QLOO_BACKEND_URL | No for Sample mode; required for live mode | HTTPS origin of the separately hosted Node backend, stored in the Site runtime |

The integration uses the hackathon kit's `qloo api search` and `qloo api insights` Harness commands. The Node backend owns the Qloo key; the Site Worker only forwards bounded requests using the shared backend token. See [the Qloo validation log](docs/QLOO_VALIDATION.md) for the dry-run contract and outstanding live checks.

## Deploy

The Site source manifest is .openai/hosting.json. Build output is written to dist/server/index.js and dist/.openai/hosting.json for the Worker hosting workflow. Deploy `qloo-backend/` as a Node.js 22.19+ container, set `QLOO_API_KEY` and `QLOO_BACKEND_TOKEN` there, then configure `QLOO_BACKEND_URL` and the same `QLOO_BACKEND_TOKEN` in the Site runtime. Run `npm test`, build and publish the Site source, then verify the public URL and access mode. Live mode remains unavailable until all three runtime values are set.

Do not set a credential in a browser bundle, localStorage, repository, screenshot, or public demo instructions.

## Tests

Run npm test for recipe metadata, invalid inputs, serving and cost calculations, feasibility, allergen preservation, procurement stock netting, sample and live response normalization, and Worker routes with no credential. Run npm run test:e2e for browser coverage of plan generation, supply-shock replanning, CSV export and mobile overflow. The Qloo response fixture is synthetic; live API behavior is not tested without an event-issued credential.

## Hackathon references

- [Qloo Agentic Hackathon rules](https://qloo.devpost.com/rules)
- [Qloo public API docs](https://github.com/qloo/docs-public)
- [Qloo Hackathon Kit](https://github.com/qloo/qloo-hackathon-kit)
- [USDA FoodData Central API](https://fdc.nal.usda.gov/api-guide/)

## Known limitations

- No event key or container host was available when this version was built; live Qloo calls and the three-profile experiment remain pending.
- Qloo cuisine-to-recipe mapping may be empty or ambiguous.
- Ingredient prices and quantity needs are illustrative. Labor, yield loss, nutrition, equipment throughput and local currency conversion are not modeled.
- The 35% vegetarian share is a planning assumption, not measured attendance.
- Scenario persistence is browser-local; there is no account, database or server-side plan history.
- The heuristic is deterministic but not globally optimal.

## License

MIT. See [LICENSE](LICENSE).
