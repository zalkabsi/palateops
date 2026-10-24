# Devpost submission draft — PalateOps

## Tagline

Food planning powered by cultural intelligence.

## Inspiration

Cafeteria teams balance diners' voluntary dining preferences with ingredient budgets, dietary requirements and kitchen capacity. A generic meal planner can produce a menu, but it cannot ground that plan in cultural taste signals. PalateOps tests whether aggregate Qloo dining tags can add useful context while operational rules remain in charge.

## What it does

PalateOps turns a cafeteria brief into five distinct daily menus with portion assumptions, ingredient-cost estimates and a consolidated shopping list. It checks attendance against stated kitchen capacity, budget, vegetarian coverage, equipment and ingredient exclusions before presenting a plan. A side-by-side run shows what changes when taste cues are added. The demo can apply an attendance and ingredient-price shock, replan, restore an earlier plan, or undo the shock.

## How we built it

The application uses a deterministic JavaScript planning engine, an original 32-recipe catalog and a same-origin Cloudflare Worker that proxies to a separate Node.js 22.19+ service running the Qloo Harness. An optional OpenAI Responses agent selects tools for signals, optimization, independent verification and procurement; it cannot edit kitchen constraints or recipes. Both plans are checked again in the browser. The agent has been tested with an offline protocol fixture; it has not made a live provider call. Sample mode uses visibly labeled synthetic cues. The live Qloo path also remains unconfigured and unvalidated: it requires an event-issued key, a hosted backend and Site runtime secrets. When enabled, it resolves voluntary public restaurant names, asks the user to confirm exact matches, then requests aggregate insights. Recipe quantity and cost calculations are deterministic.

## Challenges

Qloo returns cultural signals, not recipes or a cafeteria demand forecast. PalateOps therefore maps only tags returned on recommended places that match its small recipe catalog and reports when no mapping is available. The demo has no live credential or backend host yet, so live profile distinctions remain unvalidated.

## Accomplishments

- Constraint-checked weekly menu generation with explicit infeasibility results.
- Reproducible baseline-versus-signal comparison.
- Data-derived dashboard charts for daily cost, cuisine serving mix and purchase-cost drivers.
- Shopping-list quantities net of entered stock.
- Capacity-checked planning, bounded in-session plan history, and supply-shock undo.
- Supply-shock replanning and a CSV pack with menu, cost summary and procurement lines.
- Clear sample-versus-live provenance.
- Optional model-selected planning tools with bounded execution and independent result checks; live provider validation remains pending.

## What we learned

Taste signals can be useful only when they connect to a concrete choice and remain subordinate to safety and operating constraints. A comparison must be honest when extra signals do not change the result.

## What's next

Configure the model service and event-issued Qloo key, record a real agent run and the three-profile live experiment, validate recipe mapping, publish the current source, and replace illustrative prices with a verified regional price source before operational use.

## Demo and repository

- Demo: https://palateops-qloo.zeynkbsi.chatgpt.site (Sites reports public production version 4. This draft also describes newer local changes that have not been published. Live Qloo and the model service are not configured. External HTTP reachability was not verified from this runner.)
- Source: https://github.com/zalkabsi/palateops-qloo (the repository remains private. The tested source updates are prepared as a separate submission branch and must be merged and made public before final submission.)
