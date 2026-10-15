# Qloo validation log

**Last updated:** 2026-10-15
**Status:** Schema-level adapter checks complete; live validation pending
**Conclusion:** No-go for claims that the live Qloo path works until an event-issued credential is configured and the three-profile experiment is run against actual responses.

## Official contract reviewed

- [Qloo API overview](https://github.com/qloo/docs-public/blob/main/reference/api-overview.md)
- [Qloo API onboarding and authentication](https://github.com/qloo/docs-public/blob/main/reference/api-onboarding.md)
- [Qloo recommendation insights](https://github.com/qloo/docs-public/blob/main/reference/basic-insights-use-case.md)
- [Qloo entity search](https://github.com/qloo/docs-public/blob/main/reference/get-search.md)
- [Qloo taste analysis](https://github.com/qloo/docs-public/blob/main/reference/taste-analysis.md)
- [Qloo Hackathon Kit](https://github.com/qloo/qloo-hackathon-kit)
- [Hackathon API access and limits](https://github.com/qloo/qloo-hackathon-kit/blob/main/docs/API_ACCESS.md)
- [Hackathon safe use and data handling](https://github.com/qloo/qloo-hackathon-kit/blob/main/docs/SAFE_USE.md)

The public API guide documents an X-Api-Key header, entity search at the Qloo search endpoint, and tag insights through the v2 Insights endpoint. The current Hackathon Kit says to use its supported harness surfaces (qloo explore, qloo exec, qloo api or qloo mcp), use an event-issued individually attributable credential, and keep that credential out of browser apps and source control. PalateOps keeps the key in the Site runtime and uses the documented REST request shape. Confirm with the event whether a direct REST client is accepted for this entry before enabling a live key; if the event requires the harness CLI, the adapter must be changed to use an approved server-side harness bridge.

## Experiment design

Three hypothetical, non-personal profiles are required:

1. Italian dining: three public restaurant or cuisine entities.
2. Japanese dining: three public restaurant or cuisine entities.
3. Mexican dining: three public restaurant or cuisine entities.

For each profile, resolve the entered place names, record returned entity IDs, request tag insights, and compare only returned tag labels that map to the recipe catalog. A cuisine match is a product-side tag mapping; it is not a Qloo affinity score, diner-level preference, or satisfaction prediction.

## Request and response structure

The adapter makes up to three place searches using the documented query and types parameters. It then requests tag insights with filter.type=urn:tag, filter.parents.types=urn:entity:place, signal.interests.entities=<resolved IDs>, and take=50. The credential is sent only as the X-Api-Key request header from the Worker runtime.

The adapter expects entity search results under results.entities, with each entity containing a display name and entity ID. It expects tag insights under results.tags, with tag ID/value, name and subtype. The normalizer rejects malformed responses and preserves the resolved IDs, endpoint and response timestamp. It does not convert a missing result into sample data.

## Findings to date

- Reviewed the current official API docs and the current public hackathon kit on 2026-10-15.
- The browser never receives a Qloo credential. The Worker has a fixed Qloo origin, bounded request count, a nine-second timeout, a small input limit and an in-memory request throttle.
- Unit fixtures are synthetic schema examples, not captured Qloo responses.
- No event-issued API key was present in the workspace or runtime when this log was written.
- No live request was made. No response schema, cuisine distinction or recipe mapping has been confirmed against the live service.

## Pending live validation record

Complete after an authorized event key is installed:

| Field | Result |
| --- | --- |
| Test date | Pending |
| Credential source and quota | Pending |
| Profiles and exact input entities | Pending |
| Resolved Qloo entity IDs | Pending |
| Returned tag names and IDs | Pending |
| Cuisine distinctions across profiles | Pending |
| Recipe catalog mappings | Pending |
| Empty, timeout and rate-limit behavior | Adapter checks only |
| Go/no-go | Pending |

## Limitations

Qloo data describes aggregate cultural affinities. PalateOps does not infer sensitive traits or individual dietary needs. The app treats tags as optional cuisine context and lets hard operational rules determine feasibility. If the returned tags do not map cleanly to the catalog, the taste signal contributes nothing to recipe selection and the UI says so.
