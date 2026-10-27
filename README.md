# Duet

**Two people. One honest answer.**

Duet takes what two people genuinely love — an artist, a film, a brand, a book — asks Qloo to rank the *same real
places* twice, and then shows exactly where their taste actually meets. Not a blended average. Two independent
rankings, one joint decision, and the evidence for both.

> **Status:** the product, the scoring engine and the full request→result path are built and tested. The live Qloo
> leg is wired and verified up to the credential — no event key has been available yet, so every screenshot and
> demo currently shows **labeled sample data**. See [What is not yet proven](#what-is-not-yet-proven).

---

## The problem

Every recommender answers "what do *you* want". Nobody has built the thing people actually do every week: two
people who want different things, trying to agree. Group recommendations average the group, which is exactly the
wrong operation — an average lets a place one person barely tolerates beat a place you both like.

Duet is built on one rule: **a place has to win twice.**

## Why Qloo is the engine, not a garnish

Remove Qloo and this product cannot exist:

| What Duet needs | Where it comes from |
| --- | --- |
| Resolve "Fela Kuti" or "Aesop" into an entity with a real ID | `qloo api search` |
| Rank restaurants in a city against one person's taste | `qloo api insights` (`--type restaurant`, `--filter-location`) |
| A per-place affinity number | the `affinity` field on each returned entity |
| The tags that explain *why* a place fits | nested `tags` on each returned entity |

The cross-domain part is the point. A brand preference and a record collection are not restaurant reviews, but
Qloo's graph connects them to places. Nothing else in the stack can do that, so the app is an honest use of the
API rather than a wrapper with a taste label on it.

## How the decision is made

1. **Resolve.** Each taste signal becomes a Qloo entity. Unmatched names are dropped and visible in the run log.
2. **Rank twice.** `qloo api insights` runs once per person, same city, same `take`. Two independent lists.
3. **Score.** Each place gets a score in `[0,1]` per person: Qloo's `affinity` when present, otherwise its rank
   position. The pair is combined with a **harmonic mean**, which punishes one-sided matches:

   ```
   joint = 2ab / (a + b)
   ```

   `0.70 / 0.70` (joint 0.70) beats `0.95 / 0.20` (joint 0.33). That inversion is the product.
4. **Read the vocabulary.** Tags on each person's top-ranked places become a taste vocabulary. Shared tags are
   those both people rank strongly; divergent tags are shown side by side.
5. **Present three answers.** Places both rank highly, places in the tolerable middle, and places that are a
   straight trade. The app never claims agreement that the numbers do not support.

A worked example of the scoring is in [docs/SCORING.md](docs/SCORING.md).

## What the demo shows

- Two taste profiles built from real public entities, or four one-click starter duos.
- A verdict, not a list: *"You agree more than you think"* / *"There is a real middle"* / *"You are opposites here"*.
- Per-place dual bars, so you can see who is being asked to concede.
- Shared and divergent taste vocabulary derived from Qloo's own tags.
- A run log and a **Qloo calls** table: every request, how many signals, whether it was served from cache.
- "Copy the verdict" for the group chat.

Deep link for a repeatable demo: `/?preset=crate-digger&run=1`

## Run it locally

Requires **Node.js 22.19+** (a Qloo Harness requirement, not a preference).

```bash
npm install
npm test          # 53 tests, no network
npm start         # http://localhost:8080
```

Without a credential the server starts in **sample mode** and says so in the UI banner and in `/api/health`.

To run against real Qloo:

```bash
QLOO_API_KEY=... npm start
npm run check:qloo      # proves the credential, the harness and the response shape in one command
```

`check:qloo` reports whether Qloo actually returned `affinity` and `tags` for our request shape. If it did not,
the app falls back to rank position and the submission notes must say so.

## Deploy

The Qloo kit states serverless function runtimes are **not** supported: the harness needs a Node 22.19+ container.
Duet ships a `Dockerfile` and a `render.yaml`.

1. Push this repository.
2. In Render: **New → Blueprint**, point it at the repo. It reads `render.yaml`.
3. Set `QLOO_API_KEY` (and optionally `LLM_API_KEY` / `LLM_MODEL`) in the dashboard. Never in the repo.
4. Health check is `/api/health`; the app reports `mode: "live"` only when a credential is present.

The free Render plan sleeps when idle, so the first request after a quiet period is slow. Use a paid instance for a
recorded demo if cold starts matter.

## Qloo surface used

Only the surfaces the hackathon kit supports, and only two commands:

```bash
qloo api search   --query "Fela Kuti" --type music --take 1 --json
qloo api insights --type restaurant --signal-entities <ids> --filter-location "Brooklyn, NY" --take 30 --json
```

A duet costs **2 search calls + 2 insights calls**, or fewer when the cache is warm. Search results are cached by
`(type, name)` and rankings by `(signal ids, city, take)` for 30 minutes, because the event quota is finite and a
repeated demo should cost nothing.

## Provenance and responsible data

- The credential lives only in the server process. It is never sent to the browser, logged, or embedded in a page.
- Each result carries `mode`, `generatedAt`, the exact calls, and the scoring rule used.
- Only public entity names and a city are transmitted. No names, emails, device IDs or demographic signals.
- Qloo returns **aggregate cultural affinities**. The UI does not present them as a prediction of any individual,
  and it never labels a taste as an identity.
- Sample mode is explicit and permanent in the UI. Fixture venues are invented; synthetic rankings are never
  presented as Qloo output.

## What is not yet proven

Being precise about this matters more than looking finished:

| Item | Status |
| --- | --- |
| Scoring engine, merge, buckets, cache, HTTP API | Tested (53 tests) |
| Harness invocation and response parsing | Verified against harness `0.1.26`; auth failure path verified with a rejected key |
| A successful live Qloo response | **Not yet run** — needs the event credential |
| Whether `affinity` is populated for place insights | **Unknown until `npm run check:qloo` runs** |
| Whether tags are sufficient to separate shared from divergent taste | **Unknown until live data exists** |
| Model-written verdict | Implemented and fixture-tested; falls back to the deterministic writer |
| Venue quality in a given city | Not evaluated |

Until the live check passes, treat every number in the UI as sample data.

## Known limitations

- Two people only. Three-way compromise is a different problem and is not attempted.
- Fixed to restaurants. The entity type is a constant, not a setting.
- City is a free-text Qloo location query; a typo returns empty or distant results.
- The harmonic mean assumes the two affinity scales are comparable. That is a real assumption, stated here rather
  than hidden.
- A place missing from one person's top 30 is scored 0. It might be rank 31. The UI shows the difference between
  "absent" and "disliked" in the run log but the joint score treats both as a miss.
- No accounts, no persistence. Nothing is stored server-side beyond the TTL cache.

## Repository layout

```
server/
  index.mjs       HTTP server: 4 JSON endpoints + static assets
  agent.mjs       the run: resolve → rank twice → join → read taste → write verdict
  qloo.mjs        harness wrapper, response normalisation, typed errors
  compromise.mjs  scoring rule, buckets, tag comparison (pure functions)
  narrate.mjs     deterministic verdict writer
  model.mjs       optional OpenAI-compatible verdict writer
  fixtures.mjs    labeled sample data used only when no credential exists
  cache.mjs       TTL + LRU
public/           the app: one page, no framework
tests/            53 tests across scoring, parsing, agent and HTTP
scripts/          check-qloo.mjs
```

## License

MIT — see [LICENSE](LICENSE).
