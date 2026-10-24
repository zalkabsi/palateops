# AI planning agent

**Status:** implemented and tested with an offline Responses protocol fixture. No live model call or model-plus-Qloo experiment has been completed. The public v4 deployment does not contain this feature yet.

The optional agent runs in the Node backend and calls the OpenAI Responses API. The model chooses tools and their order. All recipes, constraints, portions, prices and procurement remain owned by deterministic application code. The default rules planner works without a backend or model account.

## Tools and completion contract

| Tool | Input | Work performed |
| --- | --- | --- |
| `get_taste_signals` | None | Loads the selected synthetic sample or requests Qloo Insights for restaurant IDs already confirmed in the browser. |
| `optimize_menu` | `target`: `baseline` or `taste` | Runs the catalog optimizer with the immutable kitchen scenario and user weights. The taste plan requires signals first. |
| `verify_plan` | `target`: `baseline` or `taste` | Independently checks the stored plan against catalog metadata, exclusions, equipment, capacity, portions, distinct menus and costs. |
| `build_procurement` | None | Requires both plans to be verified, then totals catalog ingredients and nets stock on hand. |

Only declared tools and exact argument schemas are accepted. The model cannot submit replacement recipes, relax a constraint, edit the budget or supply its own arithmetic. A feasible result is returned only after both plans pass verification and procurement is calculated. The browser independently verifies both plans again before displaying either. Premature completion, invalid output and provider failures produce an explicit error. The app does not silently switch methods after a failed AI request.

The agent can report an infeasible scenario using actual optimizer errors. Its short note is generated prose; numeric menu, comparison, chart and export values come from deterministic tools.

## Configuration

Configure these values in the Node backend host, alongside `QLOO_BACKEND_TOKEN`:

- `PALATEOPS_AGENT_ENABLED=true`: explicit enablement for model requests.
- `OPENAI_API_KEY`: server secret with access to the chosen model.
- `OPENAI_MODEL`: model ID supporting Responses function calls and structured JSON output. There is no assumed default model.
- `QLOO_API_KEY`: additionally required when using Live Qloo; Sample mode with the agent needs no Qloo key.

The Site runtime still needs only `QLOO_BACKEND_URL` and the matching `QLOO_BACKEND_TOKEN`. It proxies `/api/agent/plan` to the same Node service. The health route returns a boolean capability; the browser enables the AI choice only when that capability is available. Secrets never enter the browser or build output.

The API target is fixed to `https://api.openai.com/v1/responses`, redirects are refused, and Responses storage is disabled. Server configuration selects the model; the browser cannot override the provider, model, prompt or tools.

## Data and limits

The provider receives operational constraints, weights, cuisine cues and tool outputs. The cafeteria name is excluded from the provider context. Use public restaurant names and non-personal kitchen data. The backend does not write prompts or responses to disk. Browser settings remain local, while selected AI requests send the operational brief to the model service.

Each run permits at most 10 model rounds and 12 tool calls. Each model request has a 20-second timeout and an 800-token output cap; the run has a 65-second deadline. Model responses are limited to 512 KB, and the agent request body to 16 KB. The backend permits two simultaneous agent runs and 30 starts per hour per process, in addition to its per-client request throttle. Configure provider quotas for deployments with multiple backend instances.

For a supply shock, the AI method runs the tool loop again. In Live mode it refreshes Qloo Insights for the previously confirmed IDs. Each comparison uses the same current constraints; earlier plans and their signals remain available in session history.

## Evidence

`npm test` covers tool execution, invalid argument recovery, premature completion, infeasibility, provider errors, loop limits, concurrency limits, hourly limits, provenance and browser verification. `npm run test:e2e` exercises AI planning, shock replanning, history restore and rejection of a tampered plan using a clearly labeled offline model fixture.

These checks establish application behavior with fixtures. A real provider call, a live Qloo response and the three-profile experiment are separate release requirements. Record their actual outputs before describing the submission as live validated.
