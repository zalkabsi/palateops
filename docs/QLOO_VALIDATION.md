# Qloo validation log

**Last updated:** 2026-10-16
**Status:** Harness command shape dry-run checked; live service behavior not validated
**Conclusion:** The integration is not ready for live use until the backend is hosted, the event credential and shared token are configured, and the three-profile experiment is completed.

## Official contract reviewed

- [Qloo API overview](https://github.com/qloo/docs-public/blob/main/reference/api-overview.md)
- [Qloo API onboarding and authentication](https://github.com/qloo/docs-public/blob/main/reference/api-onboarding.md)
- [Qloo recommendation insights](https://github.com/qloo/docs-public/blob/main/reference/basic-insights-use-case.md)
- [Qloo entity search](https://github.com/qloo/docs-public/blob/main/reference/get-search.md)
- [Qloo Hackathon Kit API access](https://github.com/qloo/qloo-hackathon-kit/blob/main/docs/API_ACCESS.md)
- [Qloo Hackathon Kit safe use](https://github.com/qloo/qloo-hackathon-kit/blob/main/docs/SAFE_USE.md)
- [Qloo Harness CLI workflow](https://github.com/qloo/qloo-hackathon-kit/tree/main/starter/cli-workflow)
- [Qloo Harness MCP client](https://github.com/qloo/qloo-hackathon-kit/tree/main/starter/mcp-client)

The current hackathon kit identifies `qloo api` as a supported integration surface, requires an event-issued individually attributable credential, and says to keep keys out of browser code and source control. It requires the Harness to run in a Node.js 22.19+ VM or container; serverless functions are not a supported deployment. The kit's MCP example is a local stdio process, not a hosted HTTP service.

The official Insights example returns recommended entities in `results.entities`, with tags nested on each entity. PalateOps aggregates those returned tags and keeps the recommendation names and ranks for provenance. It does not assume a top-level `results.tags` field.

## Implemented live flow

1. The browser submits one to three voluntary restaurant names to the same-origin Site Worker.
2. The Worker validates the request and forwards it to the separately hosted Node backend using a shared bearer token.
3. The backend runs `qloo api search` for each name and accepts only a single exact name match. If a match is missing or ambiguous, it returns suggestions and does not request Insights.
4. The browser shows the exact resolved names and asks the user to confirm.
5. After confirmation, the backend runs `qloo api insights` with those place IDs. It extracts tags nested on recommended restaurants and returns a normalized result.
6. The planner maps only returned labels that match its cuisine catalog. No live failure falls back to synthetic data.

The Site Worker stores only `QLOO_BACKEND_URL` and `QLOO_BACKEND_TOKEN`. The Node container stores `QLOO_API_KEY` and the same backend token. See [the backend setup](../qloo-backend/README.md).

## Harness command contract checked

On 2026-10-16, `@qloo/qloo-harness@0.1.26` was installed in a temporary workspace and its command builder was inspected with `--dry-run`. No live Qloo request was made.

| PalateOps operation | Harness command | Dry-run route and parameter mapping |
| --- | --- | --- |
| Resolve restaurant | `qloo api search --query "Sakura Table" --type restaurant --take 5 --fields name,entity_id,subtype --json` | `/search`; query, take, fields, and `types=urn:entity:place` |
| Retrieve recommendations | `qloo api insights --type restaurant --signal-entities place-id-1 --take 10 --fields name,entity_id,subtype,tags --json` | `/v2/insights`; `filter.type=urn:entity:place`, take, and `signal.interests.entities` |

The CLI dry-run confirms argument construction and endpoint selection only. Unit fixtures exercise the expected JSON normalization but are synthetic and do not prove the live response shape.

## Three-profile experiment

After deployment and authorized key setup, run these non-personal profiles with three public restaurant names each:

1. Italian dining
2. Japanese dining
3. Mexican dining

For each profile, save the exact names the user confirmed, resolved Qloo place IDs, returned recommendations and nested tags, any recipe-catalog mapping, and empty/error behavior. Compare only observed labels. Do not describe aggregate tags as individual diner preferences or satisfaction predictions.

## Current findings

- The prior direct Worker-to-Qloo REST implementation did not follow the current hackathon deployment guidance and assumed an unsupported top-level Insights tag collection. It has been replaced by the Node Harness backend path.
- Command construction was dry-run checked against Harness version `0.1.26` on 2026-10-16.
- No event-issued Qloo key or container host is available in this workspace. No live Qloo request has been made.
- The public Site has no `QLOO_BACKEND_URL` or `QLOO_BACKEND_TOKEN` configured. Live mode currently returns a setup error and Sample mode remains available.
- The supported public hostname could not be externally checked from this runner because of its network DNS/CONNECT restriction.

## Pending live validation record

| Field | Result |
| --- | --- |
| Backend host and Node version | Pending |
| Credential source and quota | Pending event-issued key |
| Test date | Pending |
| Profiles and confirmed input entities | Pending |
| Resolved Qloo entity IDs | Pending |
| Recommended entities and nested tags | Pending |
| Cuisine distinctions across profiles | Pending |
| Recipe catalog mappings | Pending |
| Empty, timeout, and rate-limit behavior | Unit checks only |
| Go/no-go | Pending live experiment |

## Data-use limits

Qloo signals describe aggregate cultural affinities. PalateOps does not infer identity, sensitive traits, health conditions, or individual dietary requirements. Use synthetic profile names and public place entities; do not submit diner names, emails, device IDs, or other personal data. Hard operational and dietary rules remain authoritative.
