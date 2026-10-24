# Implementation log

**Updated:** 2026-10-24

## Completed

- Responsive single-page cafeteria planning interface.
- Original recipe fixtures, hard-constraint filtering and deterministic five-day menu heuristic.
- Baseline and taste-signal comparison, sample profiles, plan verifier, procurement calculations and CSV export.
- Supply-shock replan for attendance and chicken prices.
- Separate Node.js 22.19+ Qloo Harness backend with bounded input, command timeout/output, request throttle and sanitized errors.
- Site Worker proxy using an HTTPS backend URL and a shared bearer token; no Qloo API key in the Worker or browser.
- Site Worker build artifact and browser-local scenario persistence.
- README, MIT license, architecture, optimizer, demo, security, submission and Qloo validation documents.
- Unit and Worker route tests with synthetic fixtures.
- Correctness review fixes: vegetarian serving rounding, stale plan invalidation on settings or mode changes, dynamic comparison counts, recipe count provenance, repeatable supply-shock pricing, byte-bounded streamed request bodies, and independent verification of recipe metadata, exclusions, equipment, portions, costs and procurement inputs.
- Qloo integration review: replaced unsupported direct Worker REST calls with the kit-supported `qloo api` Harness path; reads tags nested on recommended entities; requires browser confirmation of exact entity matches before Insights.
- Added bounded in-session plan history with scenario restore and one-step supply-shock undo; history is not sent to a server or kept across reloads.
- Added daily kitchen serving capacity as an editable, verified hard constraint.
- Added serving-history checks so the optimizer and verifier reject identical daily menus.
- Added data-derived charts for daily cost, cuisine servings and largest procurement costs; expanded CSV export to include menu, cost summary and purchase lines.
- Added an optional OpenAI Responses agent with model-selected signal, optimization, verification and procurement tools. Constraints remain immutable, and both plans are verified again in the browser. AI planning and supply-shock replanning use the existing history and undo flow.
- Added backend capability discovery, explicit model enablement, bounded model/tool execution, concurrency and hourly limits, and separate model/Qloo credential handling.
- Added a two-step live-validation runner that saves exact restaurant matches for review before collecting three-profile Qloo evidence. Its automated checks use fixtures only.
- Fixed the missing `spawn` import in the real Harness process adapter, preserved proxy and CA settings in child processes, corrected the duplicated currency symbol in the trace, and fixed empty allergen exclusions and the selected planning method being lost on reload.
- Updated the container build to include the shared planning modules and optional session CA support; model credentials are not passed to the Qloo process.

## Validation status

- `npm test`: passed (76 test cases across planner, Qloo adapter, Harness backend, agent, live-validation runner and Worker routes; includes production asset build).
- `npm run test:e2e`: passed (5 days, 10 menu options, charts, replanning and undo, history, CSV, one-option vegetarian planning, mobile layout, AI tool flow with three offline fixture requests, rejection of a tampered plan, and persistence across reloads).
- Final verification on 2026-10-24 used local network permission for actual subprocess execution and the browser loopback preview. The tests made no external model or Qloo API requests.
- Docker image build passed with Node 22.19.0 and Harness 0.1.26. A container with external networking disabled returned healthy status, rejected unconfigured live requests with 503, executed the six planning tools using an offline model fixture, and launched a real Node subprocess. The owned QA container was stopped after the check.
- Node HTTP smoke check: `/healthz` returned 200 without returning the dummy API key; unauthenticated live request returned 401. No Qloo request was made.
- Harness command construction: dry-run checked against version 0.1.26; no live API request was made.
- Live Qloo request: pending an event-issued credential and Node backend host.
- Submission PR [#1](https://github.com/zalkabsi/palateops-qloo/pull/1) was merged on 2026-10-24 as commit `63ea850`. Its tested source was committed on `codex/palateops-agent-submission-20261024`; all 44 source files were compared byte for byte with the verified workspace before committing. The initial GitHub base `6a1ba72` has the same tree as Site v4 commit `1f9a517`. The repository remains private: the connected GitHub tools do not expose visibility settings, and the authenticated CLI cannot reach `api.github.com` under the enforced network policy. A prior privileged Actions workaround was rejected during review; change visibility through supported repository owner settings.
- Public hosted deployment: the Site is public; its version history is the source of truth for published builds. External HTTP reachability is not verified because this runner cannot resolve the published hostname.

## Remaining work

- Configure and deploy the separate Qloo backend, then run the three-profile live validation with an authorized credential.
- Configure the implemented model agent in a public backend and record a real provider run. The current agent evidence uses an offline protocol fixture, not a live LLM call.
- Nutrition totals remain intentionally omitted until per-ingredient nutrient values and recipe-unit conversions can be verified against a trusted source.
- Switch the GitHub repository to public in its owner settings, then verify source and license visibility.
- Check the published URL from a public network that can resolve the Sites hostname.
- Publish the verifier hardening in the Site source branch; the supported Sites source workflow helper is unavailable in this execution workspace, so the live version remains version 4 (commit `1f9a517`).
- Publish the plan-history and kitchen-capacity updates with the verifier hardening after the supported source workflow is available.
- Publish the agent and validation-runner updates with the same source release. On 2026-10-24, Sites still reports public version 4 and environment revision 0 with no entries. Its source credential uses `http_extra_header`, so the documented ordinary-Git exception for `work_proxy` does not apply. No Sites helper or executor skill bundle is present in the runtime.
