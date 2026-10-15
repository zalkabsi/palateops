# Devpost submission draft — PalateOps

## Tagline

Food planning powered by cultural intelligence.

## Inspiration

Cafeteria teams balance diners' voluntary dining preferences with ingredient budgets, dietary requirements and kitchen capacity. A generic meal planner can produce a menu, but it cannot ground that plan in cultural taste signals. PalateOps tests whether aggregate Qloo dining tags can add useful context while operational rules remain in charge.

## What it does

PalateOps turns a cafeteria brief into a five-day menu with portion assumptions, ingredient-cost estimates and a consolidated shopping list. It checks attendance, budget, vegetarian coverage, equipment and ingredient exclusions before presenting a plan. A side-by-side run shows what changes when taste cues are added. The demo can apply an attendance and ingredient-price shock and replan.

## How we built it

The application uses a deterministic JavaScript planning engine, an original 32-recipe catalog and a same-origin Cloudflare Worker for an optional server-side Qloo integration. Sample mode uses visibly labeled synthetic cues. Live mode uses a server-only event key, resolves voluntary dining names and requests aggregate tag insights. Recipe quantity and cost calculations are deterministic and are not delegated to a language model.

## Challenges

Qloo returns cultural signals, not recipes or a cafeteria demand forecast. PalateOps therefore maps only returned tag names that match its small recipe catalog and reports when no mapping is available. The demo has no live credential yet, so live profile distinctions remain unvalidated.

## Accomplishments

- Constraint-checked weekly menu generation with explicit infeasibility results.
- Reproducible baseline-versus-signal comparison.
- Shopping-list quantities net of entered stock.
- Supply-shock replanning and CSV export.
- Clear sample-versus-live provenance.

## What we learned

Taste signals can be useful only when they connect to a concrete choice and remain subordinate to safety and operating constraints. A comparison must be honest when extra signals do not change the result.

## What's next

Configure an event-issued key, run the three-profile live experiment, validate recipe mapping, and replace illustrative prices with a verified regional price source before operational use.

## Demo and repository

- Demo: https://palateops-qloo.zeynkbsi.chatgpt.site (production deployment succeeded; the Sites access policy is public. The runner could not resolve the hostname for an external HTTP check.)
- Source: https://github.com/zalkabsi/palateops-qloo (source and MIT license are committed; the repository is still private because the connected GitHub tools do not expose the visibility setting.)
