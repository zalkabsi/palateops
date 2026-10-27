# Devpost submission — PalateOps

Draft copy for the Qloo Agentic Hackathon, written against the five eligibility requirements and the judging
statement ("if your submission would work the same without Qloo, you're building the wrong thing").

Anything marked ⚠️ must be replaced with a real value before submitting.

---

## The five eligibility requirements

| # | Requirement | Where it is satisfied |
| --- | --- | --- |
| 1 | Link to a functional demo app | https://palateops.onrender.com/?preset=the-table&run=1 — deployed and verified, currently labeled sample mode |
| 2 | URL to a public code repository | https://github.com/zalkabsi/palateops — public |
| 3 | Text description of what the project does | [Description](#description) below |
| 4 | Externally hosted / fully published | https://palateops.onrender.com — Render Docker service, `render.yaml` in repo |
| 5 | Open-source license visible in the repo About section | `LICENSE` (MIT) at the repo root — GitHub surfaces it in About |

No demo video is required by the rules. The app itself is the deliverable, so the demo URL must be the strongest
thing submitted.

---

## Description

**PalateOps is an agent for the hardest table to book: the one a whole group actually agrees on.**

Every restaurant app answers for one person. Group features average the group, which is the wrong operation — an
average lets a place one person barely tolerates outrank a place everybody likes.

PalateOps takes what each person genuinely loves — an artist, a film, a brand, a book — and asks Qloo to rank the
*same real restaurants* separately for every person in the group. A place must clear everybody before it is called
an answer. The group score is a harmonic mean, so any single indifferent person drags it to zero.

Then it negotiates. If no place clears everyone, the agent does not shrug: it drops the price ceiling, asks Qloo
again, and if that still fails, requests deeper rankings. It tells you exactly what it gave up, and it can say the
uncomfortable thing — *this group is opposites*. The result screen shows both the shared answer and the places that
are a straight trade, with a per-person score on every card, so you can see who is being asked to concede.

### What the agent does

1. Resolves every taste signal into a Qloo entity, dropping and reporting anything it cannot match.
2. Ranks places once per person, in the same city, with the same filters — never once for the group.
3. Computes the group score and buckets every place into *everyone / most / one person's pick*.
4. Revises when the answer is nothing, one constraint at a time, and records the decision and its reason.
5. Shows its receipts: every call, its arguments, its latency and whether it was served from cache.

### What makes it Qloo-powered

| Capability | Dependency |
| --- | --- |
| Turning "Fela Kuti" or "Aesop" into a usable signal | `qloo api search` |
| Ranking a city's restaurants against one person's taste | `qloo api insights` |
| A measured per-place number, per person | `affinity` on each returned entity |
| Explaining *why* a place fits | nested `tags` on each returned entity |

An LLM can invent a plausible restaurant. It cannot rank real venues in a named city by five specific people's
cross-domain taste and report a measured affinity for each. Remove Qloo and there is no product: there is no way to
know what any of these people like, beyond the model's guess.

### Why this is a business, not a demo

Group dining is the highest-value segment of reservations — a table of five is worth several covers, and the
decision is socially costly, so people fall back to the same three places. The agent converts a group chat argument
into a ranked answer with evidence, and the natural product is a booking surface for exactly the party size that
restaurants most want to fill.

---

## Setup from a clean environment

```bash
git clone https://github.com/zalkabsi/palateops && cd palateops
node --version        # must be >= 22.19.0 (Qloo Harness requirement)
npm install
npm test              # 70 tests, no network required
npm start             # http://localhost:8080 (sample mode)
```

Live mode:

```bash
QLOO_API_KEY=<event credential> npm run check:qloo
QLOO_API_KEY=<event credential> npm start
```

**The event key only works on `https://hackathon.api.qloo.com`.** Any other host returns 401. The app defaults to
the hackathon host, so setting the key alone is enough.

---

## Evidence to paste after the live run

Run this once the key arrives and paste the output (it prints no secret):

```
npm run check:qloo
```

It reports:

| Field | Expected | Actual |
| --- | --- | --- |
| Harness version | `>= 0.1.26` | ⚠️ |
| Credential accepted on hackathon host | yes | ⚠️ |
| Venues returned for a named signal + city | `> 0` | ⚠️ |
| Places carrying an `affinity` value | ideally all | ⚠️ |
| Places carrying `tags` | ideally all | ⚠️ |

If `affinity` is missing, the app falls back to rank position. That still works, but the submission description
must say so — it is a different claim.

⚠️ Then capture one live run per starter group and link the demo URL with `?preset=<id>&run=1`.

---

## Pre-submission checklist

- [ ] API key requested via the form — **provisioning takes a few business days, request it first**
- [ ] `npm run check:qloo` passes; output pasted above
- [x] Live URL deployed — https://palateops.onrender.com (health, assets, full plan verified; base URL already the hackathon host)
- [ ] `/api/health` reports `mode: "live"` once `QLOO_API_KEY` is set
- [ ] Demo URL uses a deep link so a judge lands on a completed run
- [ ] Repository public, MIT license visible in the About section
- [ ] Description pasted into Devpost
- [ ] Screenshots replaced or kept with the visible "Sample data" badge
- [ ] Deadline: **30 October 2026, 11:45pm ET**
- [ ] If shortlisted: availability to appear on air with Jason Calacanis, Cedric the Entertainer and Alex Elias on
      **5 November**

---

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Key arrives after the deadline | No live demo → ineligible | Request immediately; ask in Discord `#api-help` for expedited provisioning |
| `affinity` absent on place insights | Scores fall back to rank; claim weakens | `check:qloo` reveals it early; description is written to survive it |
| Render free tier cold start | Judge sees a slow first load | Paid instance for the judging window |
| Qloo data thin in a chosen city | Empty or distant results | Every preset uses a major city; the UI reports empty explicitly |
