## Inspiration

Every restaurant app answers a question about one person. But the decision people actually make is social: five
people, one table, and a group chat where nobody will say what they want. The industry's answer to this is "group
mode", which averages everyone's preferences together.

Averaging is the wrong operation. It lets one enthusiast outvote four people who are indifferent, which is exactly
how you end up at the loud place nobody wanted.

So I started from the opposite rule: **a place has to win for everybody, or it isn't an answer.**

The hackathon brief put it well — agents are culturally blind. A model can generate a plausible restaurant name and
a convincing paragraph about it. It has no idea what these five specific people love, which of those places exist
in Brooklyn, or whether anyone actually likes them. That gap is the product.

## What it does

PalateOps takes each person's taste — an artist, a film, a brand, a book — and asks Qloo to rank the **same real
restaurants** separately for every person at the table. Never once for the group, because collapsing five people
into one profile is the failure it exists to fix.

Then it negotiates. If no place clears everyone, the agent doesn't shrug. It surrenders a constraint, re-asks Qloo,
and reports exactly what it gave up: *"No place cleared everyone inside the price ceiling, so the agent removed it
and found two shared places."*

The result screen names three outcomes honestly: the places everybody wants, the ones nobody objects to, and the
ones that are a straight trade. Every card carries a score per person, so you can see who is being asked to concede.

## How I built it

A single Node 22 service. No web framework, no database, no accounts, one dependency — the official
`@qloo/qloo-harness`.

**The Qloo surface is deliberately small.** Two commands:

```bash
qloo api search   --query "<name>" --type <domain> --take 1 --json
qloo api insights --type restaurant --signal-entities <ids> --filter-location "<city>" --take 30 --json
```

`search` turns a human input into an entity, which is what lets the product accept taste from *any* domain and not
just restaurants. `insights` answers the only question that matters: given this person's signals, which places in
this city rank highest. Running it once per person is the whole mechanism.

**The scoring rule is a pure function.** Each place gets a score $s_i \in [0,1]$ for person $i$ — Qloo's `affinity`
when it returns one, otherwise the rank position. The group score is a harmonic mean:

$$\text{joint}(v) = \frac{N}{\displaystyle\sum_{i=1}^{N} \frac{1}{s_i(v)}}$$

and it is zero if anybody's score is zero. The harmonic mean is dominated by the smallest input, which is the point:

| Place | Ann | Bo | Cy | Arithmetic mean | Harmonic mean |
| --- | --- | --- | --- | --- | --- |
| Only Ann wants it | 0.95 | 0.20 | 0.20 | **0.450** | 0.316 |
| Everyone likes it | 0.70 | 0.70 | 0.70 | 0.700 | **0.700** |

The arithmetic mean ranks Ann's bar above the place everybody likes. Inverting that ordering *is* the product.

**The agent loop is plan → act → observe → revise.** It resolves signals, ranks per person, tests the group score,
and when the answer is nothing it decides what to surrender. When a model is configured, the model makes that
choice; otherwise a fixed ladder does. Either way the decision, its author and its reason are recorded and shown in
the run log. The model never computes a number — it receives computed evidence and can only return prose or pick
from an allowed list of concessions.

**Everything is testable without a network.** 76 tests cover the scoring, the negotiation, response parsing, the
HTTP layer and the cache. The app runs against labelled sample data when no credential is present, and says so in a
permanent banner — it never silently pretends to be live.

## Challenges I ran into

**Absence is not dislike.** A place missing from one person's list isn't evidence they'd hate it; it's evidence Qloo
didn't put it in their top 30. I score it zero and let it appear only as a trade. Imputing a plausible score would
have manufactured agreement the data doesn't contain — the easy thing to do, and the wrong one.

**The base URL trap.** Event keys only work against `hackathon.api.qloo.com`; any other host returns 401 with a
perfectly valid key. The harness defaults to production, so a naive deploy fails on every call. The app now defaults
to the hackathon host and pairs it with the trust flag the harness requires.

**Making the agent cheap enough to be honest.** Asking Qloo for a deeper list is the obvious second move when
nothing overlaps — but if Qloo already returned fewer places than requested, no list was truncated and the extra
call cannot change the answer. The agent now checks that before spending a request. Caching by signal set, city and
filters keeps a repeated demo at zero calls.

**Resisting the flattering answer.** The first version always produced a recommendation, because it ranked the
average. A compromise engine has to be willing to say "this group is opposites" — which is a worse demo and a better
product. That decision shaped the UI: the headline overlap figure can legitimately be zero.

## Accomplishments that I'm proud of

- A recommender whose headline number is allowed to be zero.
- Both scores on every card, so the concession is visible instead of implied.
- A taste vocabulary derived from Qloo's own tags without spending an extra request.
- A run log that shows every call, including the cached ones, with the arguments used.
- Sample mode that cannot be mistaken for live Qloo output, in the UI or in the API.

## What I learned

The interesting question isn't "what should I do", it's "what should *we* do", and it cannot be answered by blending
two people into one average. A group is not a bigger individual. Once you accept that, the engineering follows: you
need N rankings, a rule that punishes indifference, and an agent willing to report failure.

I also learned that the hard part of using a taste graph isn't the API call. It's deciding which of the many things
it could tell you is load-bearing for the decision in front of the user.

## What's next

Three people and up is handled; the next step is real venue facts — hours, closures, capacity — so an answer is
bookable rather than merely defensible. After that: entity types beyond restaurants, and letting the model choose
relaxations from a free-text brief instead of the current structured constraints.

Built with the Qloo Harness on Node 22. MIT licensed.
