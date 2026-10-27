# Devpost submission — Duet

Draft copy for the Qloo Agentic Hackathon. It follows the six items the kit's `docs/SUBMISSION.md` asks for, then
gives paste-ready answers for the Devpost form.

**Everything marked ⚠️ is a placeholder that must be replaced with a real value before submitting.**

---

## 0. The six required items

| Kit requirement | Where it is answered |
| --- | --- |
| 1. Short product problem statement | [Problem](#1-problem) |
| 2. Qloo workflow or MCP tools used, and why they fit | [Qloo usage](#2-qloo-usage) |
| 3. Redacted request→result explanation, including entity/tag choices | [Evidence](#3-requestresult-explanation) |
| 4. Short demo or screenshots with no credential or personal data | [Demo](#4-demo) |
| 5. Setup steps from a clean environment | [Setup](#5-setup-from-a-clean-environment) |
| 6. Known limitations, including what the result does not establish | [Limitations](#6-known-limitations) |

---

## 1. Problem

Two people want to go out, and they want different things. Every recommender answers for one person; every "group
mode" averages the group. Averaging is the wrong operation, because it lets a place one person merely tolerates
outrank a place both people like.

Duet makes the opposite bet: **a place has to win twice.** Qloo ranks the same real restaurants separately for each
person, from each person's own cross-domain taste, and Duet keeps only the places that survive both rankings — plus
an explicit, labeled list of the places that are a straight trade.

## 2. Qloo usage

Only kit-supported surfaces (`qloo api`), and only two commands:

```
qloo api search   --query "<name>" --type <domain> --take 1 --json
qloo api insights --type restaurant --signal-entities <ids> --filter-location "<city>" --take 30 --json
```

Why these fit the problem:

- **`search`** turns a human input ("Fela Kuti", "Aesop", "Severance") into an entity ID. That resolution step is
  what lets the product accept taste from *any* domain, not just restaurants. Cross-domain input is the reason this
  product needs Qloo at all.
- **`insights` with `filter.type = urn:entity:place`** answers exactly the product question: given this person's
  signals, which restaurants in this city rank highest. Running it twice, once per person, is the core mechanism.
  The alternative — one call with combined signals — collapses two people into one, which is what we are trying to
  stop doing.
- **`filter.location.query`** keeps both rankings scoped to the same city, so the two lists are comparable.
- **`fields`/`affinity`/`tags`** supply both the number and the explanation. The app shows the affinity when Qloo
  returns one, and says so in the run log when it falls back to rank position.

Deliberately **not** used: demographics and audience signals (the product must not infer identity), `qloo exec` and
`qloo mcp` (two deterministic `api` calls are sufficient and easier to attribute), and any bulk retrieval.

A duet costs **2 search + 2 insights**. Search is cached by `(type, name)` and rankings by `(signals, city, take)`
for 30 minutes, so repeat demos cost nothing against the event quota.

## 3. Request→result explanation

```bash
# Step 1 — resolve each taste signal (2 calls per duet, cached)
qloo api search --query "Fela Kuti" --type music --take 1 --json
  → entity_id: <redacted id>, name: "Fela Kuti"

# Step 2 — rank restaurants twice, same city (2 calls per duet)
qloo api insights --type restaurant \
  --signal-entities <id-a1>,<id-a2>,<id-a3> \
  --filter-location "Brooklyn, NY" --take 30 --json
  → 30 places, each with name, entity_id, popularity, tags[]
    and affinity where the response provides it

# Step 3 — local, no Qloo call
join both lists by entity_id
score each place per person, combine with a harmonic mean, bucket the result
build each person's tag vocabulary from the tags on their own top places
```

Entity/tag choices:

- Signals are chosen by the user from Qloo's own search results, so no entity ID is ever hand-written or hardcoded.
- Tags are never requested separately. They arrive nested on the returned places and are used only to describe the
  taste vocabulary that the returned places already imply. No tag is assigned by the app.
- Nothing about a real person is sent. Signals are public entities; the only other input is a city string.

⚠️ **To fill in after the live run:** the date, the real returned entity IDs, the number of places that carried an
`affinity` value, and the actual top-3 results for one named profile pair.

## 4. Demo

- ⚠️ Live URL: `https://<service>.onrender.com/?preset=crate-digger&run=1`
- ⚠️ Video: `<2-minute walkthrough>`
- Screenshots in-repo: [`docs/screenshots/duet-setup.png`](screenshots/duet-setup.png),
  [`docs/screenshots/duet-result.png`](screenshots/duet-result.png)

Both screenshots were captured in **sample mode** and carry a visible "Sample data" badge. They must stay labeled
that way unless they are re-captured against live Qloo.

Suggested 90-second recording:

1. `0:00` The claim: "every app answers for one person; this one answers for two."
2. `0:10` Pick the starter duo, hit **Find the overlap**.
3. `0:20` The verdict and the overlap number, with the honest sentence underneath.
4. `0:35` Scroll the "Both of you" group. Point at the two bars on one card — who is conceding.
5. `0:55` The taste vocabulary: what they share vs. what only each one likes.
6. `1:10` Open **Qloo calls** — the receipts: two searches, two insights, nothing hidden.
7. `1:25` Switch the city, run again, show the answer changing.

## 5. Setup from a clean environment

```bash
git clone https://github.com/zalkabsi/palateops && cd palateops
node --version          # must be >= 22.19.0 (Qloo Harness requirement)
npm install
npm test                # 53 tests, no network required
npm start               # http://localhost:8080 (sample mode)
```

Live mode:

```bash
QLOO_API_KEY=<event credential> npm run check:qloo   # proves key + harness + response shape
QLOO_API_KEY=<event credential> npm start            # UI loses the "Sample data" badge
```

Docker / Render: `docker build -t duet . && docker run -p 8080:8080 -e QLOO_API_KEY=... duet`, or push and use the
included `render.yaml` blueprint.

No build step, no database, no accounts, one dependency.

## 6. Known limitations

- **What the result does not establish.** Qloo affinities are aggregate cultural signals. A high joint score is not
  a prediction that either person will enjoy the evening, and it is not evidence about anyone's identity.
- **Two people only.** Three-way compromise is a genuinely different problem and is not attempted.
- **Restaurants only.** The entity type is a constant, not a setting.
- **Comparability assumption.** The harmonic mean treats each person's affinity scale as comparable. If Qloo
  normalises affinity per request, this assumption needs re-examination — flagged, not hidden.
- **Top-30 truncation.** A place just outside one person's top 30 is scored as a miss. The UI distinguishes "absent"
  from "disliked" in the run log, but the joint score does not.
- **Venue sanity is not checked.** The app shows what Qloo returns; it does not verify hours, price, closure, or
  whether the place still exists.
- **City is free text.** A misspelling produces empty or distant results with no fuzzy correction.
- **Sample mode exists.** Without a credential the app runs on invented venues and says so in a permanent banner. It
  is impossible to mistake sample output for Qloo output, which is deliberate.

---

# Devpost form answers

**Tagline**
> Two people. One honest answer.

**Inspiration**
> Every recommender answers "what do you want". Nobody has built the thing people actually do every week: two
> people who want different things, trying to agree. Group recommenders average the group, and averaging lets a
> place one person barely tolerates beat a place you both like.

**What it does**
> Duet takes what two people genuinely love — an artist, a film, a brand, a book — and asks Qloo to rank the same
> real restaurants separately for each of them. It keeps only the places that rank highly for both, shows the
> places that are a straight trade, and names the taste vocabulary they share and don't. Every result shows both
> scores, the tags behind them, and the exact Qloo calls that produced it.

**How we built it**
> A Node 22 service that calls the official Qloo Harness (`qloo api search` and `qloo api insights`) through a
> defensive wrapper, with a pure scoring module that joins the two rankings using a harmonic mean. The front end is
> one page of vanilla JavaScript. The verdict is written deterministically and optionally sharpened by an
> OpenAI-compatible model that receives computed evidence only — it never sees the Qloo key and never computes a
> score. Qloo's credential stays in the server process; the browser never sees it. Requests are cached for 30
> minutes so a repeated demo spends no event quota.

**Challenges**
> Qloo ranks for one profile, so "which place works for both" had to be built rather than called. The obvious
> approach — combine both people's signals into one request — is exactly what we were trying to avoid, because it
> averages away the conflict that makes the problem interesting. Joining two independent rankings means confronting
> incomparable scales, missing places, and the temptation to manufacture agreement. We chose a rule that can say
> "you are opposites here" and let the product lose that argument.

**Accomplishments**
> A recommender whose headline number can be zero. Side-by-side scores on every result, so the concession is
> visible. A taste-vocabulary comparison derived from Qloo's own tags without spending a third request. A run log
> that shows every call, including the cached ones. And an honest sample mode: it is impossible to mistake demo
> data for a Qloo response.

**What we learned**
> The interesting question is not "what should I do" but "what should *we* do", and it cannot be answered by
> blending two people into one average. A compromise engine has to be willing to report that there is barely any
> overlap, which is a worse demo and a better product.

**What's next**
> Three people. Non-restaurant entity types. Verified venue data. And the live validation run that turns the sample
> banner off.

---

# Pre-submission checklist

- [ ] `npm run check:qloo` passes with the event credential
- [ ] Screenshots re-captured in live mode, or kept with the sample badge
- [ ] Live URL deployed and reachable; `mode: "live"` in `/api/health`
- [ ] Repository is **public** and shows the MIT license
- [ ] ⚠️ Confirm the public repo URL (`zalkabsi/palateops` vs the older `palateops-qloo`)
- [ ] 90-second video recorded and uploaded
- [ ] Devpost form fields pasted from the section above
- [ ] Contact details and team size completed
- [ ] Deadline: **30 October 2026, 11:45pm ET**
