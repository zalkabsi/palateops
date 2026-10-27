# The scoring rule

This is the whole product, so it is written down precisely.

## The rule

For a place `v` and people `A` and `B`:

```
score(v, P) = affinity(v, P)        when Qloo supplies an affinity in [0, 1]
            = 1 - (rank(v,P) / n)   otherwise, where n is that person's list length

joint(v)    = 2 * score(v,A) * score(v,B) / (score(v,A) + score(v,B))
            = 0 when either score is 0
```

`joint` is the harmonic mean. It is the only real design decision in the project, and it is chosen because the
alternative — the arithmetic mean — is already what every group-recommendation feature does, and it is wrong.

## Why the harmonic mean

Two places, one real-world pair of preferences:

| Place | Person A | Person B | Arithmetic mean | Harmonic mean |
| --- | --- | --- | --- | --- |
| The jazz bar only A wants | 0.95 | 0.20 | **0.575** | 0.330 |
| The place both like | 0.70 | 0.70 | 0.700 | **0.700** |

The arithmetic mean ranks the jazz bar above the place both people like. That is the bug in every "average the
group" recommender: one person's enthusiasm can outvote the other person's indifference.

The harmonic mean is dominated by the *smaller* of the two numbers, so it ranks the shared place above the
one-sided one (0.700 > 0.330). It is also bounded, symmetric, and zero when either person is uninterested — all
properties a compromise score should have.

## Buckets

| Bucket | Condition | What it means in the UI |
| --- | --- | --- |
| `both` | present for both, `joint >= 0.55` | "Both of you" — these are the answers |
| `middle` | present for both, `joint < 0.55` | "The middle" — neither loves it, neither objects |
| `trade` | present for one only, with a score `>= 0.60` | "Worth a trade" — someone is conceding |
| `weak` | everything else | not shown |

Thresholds live as named exports in `server/compromise.mjs` (`BOTH_THRESHOLD`, `TRADE_THRESHOLD`) and are covered
by tests. They were chosen so that a "shared" place requires genuine enthusiasm from both people, not survival.

## Absence is not dislike

A place missing from one person's list is not evidence that they hate it — it is evidence that Qloo did not place
it in their top 30. The engine scores it `0`, which means it can qualify as a `trade` but never as a `both`.

This is conservative on purpose. The alternative — imputing a plausible score for an unreturned place — would
manufacture agreement that the data does not contain. The UI keeps the distinction visible: the run log shows which
person's list a place came from.

## Overlap percentage

```
overlap = (number of places in the `both` bucket) / (number of distinct places returned by either person)
```

A strict ratio, not an average of scores. If three places out of twenty clear the shared threshold, the UI says
15%, even if those three places are excellent. An inflated number would make the headline meaningless.

## Taste vocabulary

Each person's vocabulary is built from the tags on **their own** top-ranked places:

```
weight(tag, P) = sum of score(v, P) for the top 12 places of P that carry that tag
vocab(tag, P)  = weight(tag, P) / max weight in P
```

- `shared`: `min(vocabA, vocabB) >= 0.42`
- `only A` / `only B`: difference `>= 0.30` in one direction

Generic tags (`restaurant`, `bar`, `food`, `point of interest`, …) are filtered out first, because they describe
what a place *is* rather than how it *feels*.

This is **derived evidence**, not a Qloo tag-insights call. It keeps a duet at two `insights` requests instead of
three, and it stays explainable: every tag shown comes from a place the user can see on screen.

## Worked example

Real output from the sample-data run in `docs/screenshots/duet-result.png` (fixture mode):

```
Sam   → Fela Kuti, Alice Coltrane, Burial, 99% Invisible
Jules → Aesop, Le Labo, Severance, The Secret History
City  → Brooklyn, NY

27 distinct places · 5 in `both` · 4 in `middle` · 6 in `trade` → overlap 19%
"The Almanac"     A 0.737  B 0.659  joint 0.696
"Meridian & Ash"  A 0.651  B 0.610  joint 0.630
"Lamp Room"       A 0.843  B 0.463  joint 0.598
shared vocabulary: natural wine, minimalist, candlelit
only Sam: coffee, bakery, omakase, sake
only Jules: vinyl, jazz, martini, late night
```

Note how "Lamp Room" — a place Sam loves — is dragged down by Jules's 0.463, while "The Almanac" wins the ranking
with a lower best score. That inversion is the product.

## Failure behaviour

- No places returned for either person → `total = 0`, verdict "No shared ground found", no fabricated rows.
- Signals that Qloo cannot resolve are dropped and recorded as a failed step in the run log.
- If every signal fails to resolve, the request fails with a `400` and an actionable message.
- A Qloo error is mapped to a typed status (401/403 → 503 "check QLOO_API_KEY", 429 → 429). The app never falls
  back from live to sample data silently.
