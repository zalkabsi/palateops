# How PalateOps decides

This is the whole product, so it is written down precisely. All of it lives in
[`server/compromise.mjs`](../server/compromise.mjs) as pure functions and is covered by tests.

## 1. Per-person score

```
score(v, P) = affinity(v, P)          when Qloo returns an affinity in [0,1]
            = 1 - rank(v,P) / n       otherwise, n = that person's list length
```

A returned affinity is the strongest evidence Qloo gives. When it is absent the rank position is used, and the UI
records which was used per place (`affinitySource`) so nobody mistakes one for the other.

## 2. Group score: harmonic mean over everyone

```
group(v) = N / Σ(1 / score(v,Pᵢ))     for i = 1..N
         = 0                          if any score is 0
```

Properties, and why each matters:

- **Dominated by the smallest input.** A place must be wanted by everybody. One indifferent person kills it.
- **Bounded by the mean.** The result can never exceed the arithmetic mean, so scores stay comparable.
- **Symmetric.** Order of people does not matter.
- **Zero-preserving.** If Qloo did not rank the place for someone, the group score is 0. No imputation.

### Why not the arithmetic mean

Three people, two candidate places:

| Place | Ann | Bo | Cy | Arithmetic | Harmonic |
| --- | --- | --- | --- | --- | --- |
| The bar only Ann wants | 0.95 | 0.20 | 0.20 | **0.450** | 0.316 |
| The place everyone likes | 0.70 | 0.70 | 0.70 | 0.700 | **0.700** |

The arithmetic mean ranks Ann's bar above the place everybody likes. That is the bug in every "average the group"
recommender, and inverting it is the entire product thesis.

## 3. Buckets

| Bucket | Condition | UI group |
| --- | --- | --- |
| `everyone` | present for all N, `group >= 0.55` | "Everyone" — these are the answers |
| `most` | present for all N, below threshold | "Most of you" — nobody objects, nobody is excited |
| `trade` | present for some, best single score `>= 0.60` | "One person's pick" — somebody is conceding |
| `weak` | everything else | not shown |

`EVERYONE_THRESHOLD` and `TRADE_THRESHOLD` are named exports in `server/compromise.mjs` and are asserted by tests.

## 4. The negotiation loop

```
attempt 1: rank everyone under the user's constraints
          if anyone shares a place → stop
attempt 2: drop the price ceiling, rank everyone again
          if anyone shares a place → stop
attempt 3: ask Qloo for deeper rankings (take 30 → 50)
          stop either way
```

Each decision is recorded `{id, label, reason}` and rendered above the verdict, so a relaxed constraint is never
silent. The relaxation ladder is ordered from least to most damaging to the brief, and a failed negotiation still
returns the best available concessions rather than an error.

## 5. Absence is not dislike

A place missing from one person's list is not evidence that they dislike it — it is evidence that Qloo did not put
it in that person's top 30. It scores 0, which means it can appear as a `trade` but never as `everyone`.

This is conservative on purpose. Imputing a plausible score for an unreturned place would manufacture agreement.
The UI keeps the distinction visible in the run log; the score deliberately does not.

## 6. Overlap percentage

```
overlap = (places in the `everyone` bucket) / (distinct places returned by anyone)
```

A strict ratio, not an average of scores. If two places out of twenty clear the bar, the headline says 10% even if
those two are excellent. An inflated number would make the headline worthless.

## 7. Taste vocabulary

Each person's vocabulary comes from the tags on the places **their own** ranking puts highest:

```
weight(tag, P) = Σ score(v,P) over the top 12 of P's places carrying that tag
vocab(tag, P)  = weight(tag, P) / max weight in P
```

- `shared`: `min` across all people `>= 0.42`
- `individual`: a spread of `>= 0.30` against the lowest person, attributed to the highest

Generic tags (`restaurant`, `bar`, `food`, `point of interest`, …) are filtered out first: they describe what a
place *is*, not how it *feels*.

This is **derived evidence**, not a second Qloo call. It keeps a plan at N `insights` requests instead of 2N, and
every tag shown can be traced to a place on screen.

## 8. Worked example

Real output from a five-person fixture run:

```
Marcus → Patagonia, Heat, Khruangbin
Helen  → The Grand Budapest Hotel, Le Labo, Khruangbin
Priya  → Fela Kuti, Chef's Table, Khruangbin
Owen   → Radiohead, Parasite, Le Labo
Dee    → Solange, Atlanta, Le Labo
City   → Chicago, IL   Price ceiling → $$$

30 places seen · 2 clear everybody → overlap 11%
"The Quiet Hour"  [0.75, 0.89, 0.47, 0.46, 0.57]  group 0.587
"Paper Radio"     [0.80, 0.89, 0.32, 0.66, 0.60]  group 0.577
```

Note how quietly the harmonic mean works: "Paper Radio" has the highest single score (0.89) of any place here, and
still loses to a place with a lower best score but a more even spread. That inversion is the product.

## 9. Failure behaviour

- Nothing returned for anyone → `total = 0`, verdict "No shared ground found", no fabricated rows.
- Signals Qloo cannot resolve are dropped and recorded as a failed step in the run log.
- Every signal for a person failing → `400` with an actionable message naming that person.
- Qloo errors map to typed statuses: auth → `503` "check QLOO_API_KEY", quota → `429`. The agent never silently
  falls back from live to sample data.
