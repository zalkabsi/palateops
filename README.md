# PalateOps

**An agent for the hardest table to book: the one a whole group actually agrees on.**

PalateOps takes what each person in a group genuinely loves — an artist, a film, a brand, a book — and asks Qloo to
rank the *same real restaurants* separately for every one of them. Then it negotiates: it looks for a place that
clears everybody, and when none exists it loosens a constraint, asks again, and says exactly what it gave up.

> **Status:** the agent, the scoring engine, the negotiation loop and the full request→result path are built and
> tested (76 tests). The live Qloo leg is wired and verified up to the credential. **No event key has been available
> yet**, so every screenshot and demo currently shows labeled sample data. See [What is not proven](#what-is-not-proven).

---

## Why this needs Qloo

Remove Qloo and the product does not degrade — it stops existing:

| What PalateOps needs | Where it comes from |
| --- | --- |
| Resolve "Fela Kuti", "Aesop", "Piranesi" into entities | `qloo api search` |
| Rank restaurants in a city against one person's taste | `qloo api insights` |
| A per-place affinity number per person | `affinity` on each returned entity |
| The tags that explain *why* a place fits | nested `tags` on each returned entity |

An LLM alone can produce a plausible restaurant name. It cannot rank real venues in a named city by each of five
specific people's cross-domain taste and report a measured number for every person. That gap — a brand preference
and a record collection predicting a restaurant — is what the taste graph does and what this agent is built on.

## What makes it an agent, not a form

The loop is plan → act → observe → revise:

1. **Resolve.** Every taste signal becomes a Qloo entity. Unmatched names are dropped and shown as a failed step.
2. **Rank once per person.** Never once for the group — averaging people together is the failure this exists to fix.
3. **Test the group score.** A place must clear everybody. Any single indifferent person drags the score to zero.
4. **Revise if the answer is nothing.** No shared place → the agent surrenders one constraint, re-asks Qloo, and
   repeats. With a model configured, **the model chooses which constraint to give up**; without one, a fixed ladder
   does it. Either way the decision, its author and its reason are recorded and shown.
5. **Show the receipts.** Every call, every score, every concession, including cached calls.

The negotiation is the part that makes it an agent rather than a lookup: it has a goal, it can fail, and it decides
what to give up to reach it.

## The scoring rule

Each place gets a score in `[0,1]` per person — Qloo's `affinity` when returned, otherwise its rank position. The
group score is a **harmonic mean over everyone**:

```
group = N / Σ(1 / sᵢ)        (0 if any sᵢ = 0)
```

This is dominated by the *smallest* input, so it inverts the usual group-recommendation mistake:

| Place | Ann | Bo | Cy | Arithmetic mean | Harmonic mean |
| --- | --- | --- | --- | --- | --- |
| Only Ann wants it | 0.95 | 0.20 | 0.20 | **0.450** | 0.316 |
| Everyone likes it | 0.70 | 0.70 | 0.70 | 0.700 | **0.700** |

An average lets one enthusiast outvote the rest. The harmonic mean does not. Details and edge cases:
[docs/SCORING.md](docs/SCORING.md).

## Run it locally

Requires **Node.js 22.19+** (a Qloo Harness requirement).

```bash
npm install
npm test          # 76 tests, no network
npm start         # http://localhost:8080
```

Without a credential the server starts in **sample mode** and says so in a permanent banner and in `/api/health`.

To supply one locally, copy the template and fill it in. `npm start` reads `.env` automatically:

```bash
cp .env.example .env    # then put QLOO_API_KEY in it
npm start
```

`.env` is gitignored. Never paste a key into a command that lands in shell history on a shared machine.

With a key:

```bash
QLOO_API_KEY=... npm start
QLOO_API_KEY=... npm run check:qloo    # runs the whole agent loop live and prints a go/no-go
```

### Getting a key

Submit the [API key request form](https://forms.gle/zz12orkLHTAneLGz6) and check spam. Keys are provisioned
manually and typically take a few business days — request one before you need it.

**Event keys only work on `https://hackathon.api.qloo.com`.** Using any other host returns `401` even with a valid
key. PalateOps defaults to the hackathon host, so a deploy that sets only `QLOO_API_KEY` is correct.

## Deploy

The Qloo kit states serverless function runtimes are **not** supported: the harness needs a Node 22.19+ container.
A `Dockerfile` and a `render.yaml` blueprint are included.

1. Push this repository.
2. Render → **New → Blueprint** → pick the repo. It reads `render.yaml`. The image builds with
   `npm ci --omit=dev`; that exact command is verified to work from a clean checkout.
3. Set `QLOO_API_KEY` in the dashboard. Never in the repo.
4. `/api/health` reports `mode: "live"` plus the base URL in use.

The free plan sleeps when idle. Use a paid instance for a recorded demo.

## Qloo surface used

Only kit-supported surfaces (`qloo api`) and only two commands:

```bash
qloo api search   --query "<name>" --type <domain> --take 1 --json
qloo api insights --type restaurant --signal-entities <ids> --filter-location "<city>" --take 30 --json
```

A three-person plan costs **3 search + 3 insights**, or fewer when the cache is warm. Search results are cached by
`(type, name)` and rankings by `(signals, city, take, price)` for 30 minutes, because the event quota is finite and
a repeated demo should cost nothing. Field filtering is not supported by the event API, so payloads are reduced
locally.

## Provenance and responsible data

- The credential lives only in the server process; it is never sent to the browser or logged.
- Every result carries `mode`, `generatedAt`, the exact calls, the negotiation decisions and the scoring rule.
- Only public entity names, a city and a price band are transmitted. No names, emails or device IDs.
- Qloo returns **aggregate cultural affinities**. The UI never presents them as a prediction about an individual.
- Sample mode is explicit and permanent. Fixture venues are invented; synthetic rankings are never shown as Qloo
  output.
- Cached Qloo responses are server-side only, never committed to the repository.

## What is not proven

| Item | Status |
| --- | --- |
| Scoring, negotiation, cache, HTTP API | Tested (76 tests) |
| Harness invocation and response parsing | Verified against harness `0.1.26`; auth failure path verified with a rejected key |
| A successful live Qloo response | **Not yet run** — needs the event credential |
| Whether `affinity` is populated for place insights | **Unknown until `npm run check:qloo` runs** |
| Whether tags separate shared from individual taste on real data | **Unknown until live data exists** |
| Model-chosen concessions and verdict | Implemented and tested against a stubbed provider; falls back to the fixed ladder and the deterministic writer |
| Venue quality or whether venues still exist | Not evaluated |

Until the live check passes, every number in the UI is sample data.

## Known limitations

- Restaurants only; the entity type is a constant.
- The harmonic mean assumes per-person affinity scales are comparable. Stated, not hidden.
- A place just outside one person's top 30 counts as a miss. The run log distinguishes "absent" from "disliked";
  the score does not.
- The agent's relaxation ladder is fixed (price, then depth). A model policy could choose better relaxations.
- City is a free-text Qloo location query; a typo returns empty or distant results.
- No accounts or persistence beyond the TTL cache.

## Repository layout

```
server/
  index.mjs       HTTP server: 4 JSON endpoints + static assets
  agent.mjs       resolve → rank per person → join → negotiate → narrate
  qloo.mjs        harness wrapper, response normalisation, typed errors
  compromise.mjs  scoring, buckets, taste comparison (pure functions)
  narrate.mjs     deterministic verdict writer
  model.mjs       optional OpenAI-compatible verdict writer
  fixtures.mjs    labeled sample data, used only without a credential
  cache.mjs       TTL + LRU
public/           the app: one page, no framework
tests/            76 tests
scripts/          check-qloo.mjs
docs/             scoring rules and the submission draft
```

## License

MIT — see [LICENSE](LICENSE).
