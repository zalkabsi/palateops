# Menu optimizer

## Planning assumptions

- The planning period is five weekdays.
- The demo has 150 expected covers by default.
- The demo capacity is 200 covers per day; attendance above the stated capacity is rejected before optimization.
- The demo allocates 35% of covers to the vegetarian option and 65% to the flexible option. This is an editable assumption, not measured demand.
- All catalog recipe costs are illustrative US-dollar ingredient estimates. Supplier prices, taxes, labor, waste, nutrition and equipment throughput are not modeled.
- Entered inventory reduces the shopping list. Recipe cost remains conservative and counts the full ingredient value against the daily cap.
- Allergen tags are based on catalog ingredients and are not a guarantee against cross-contact.

## Feasibility rules

The engine removes recipes that conflict with an excluded allergen, excluded ingredient or unavailable equipment. It forms daily menus containing a vegetarian dish and allocates the planned servings. A candidate is discarded when its ingredient cost exceeds the daily budget. The planner requires five distinct daily menu combinations. The weekly plan must pass a final verifier for capacity, attendance, budget, vegetarian coverage, exclusions and duplicate recipes.

No hard rule is relaxed. If no candidate remains, the planner returns an explicit infeasible result.

## Objective

Candidate pairs are ranked by this transparent weighted utility. The manager can adjust each weight in the interface; the app normalizes the selected weights to 100% for ranking:

- 40%: match between recipe cuisine and returned or labeled sample cuisine cues
- 28%: explicit cuisine focus selected by the manager
- 20%: lower ingredient cost per serving
- 12%: shorter preparation time

Small deterministic bonuses prefer cuisines not yet used in the week and avoid repeating recipes. This is a greedy heuristic suitable for the 32-recipe demo catalog, not a proof of global optimality or an integer-programming solver. It is reproducible for identical inputs.

The Qloo contribution is categorical: a recipe cuisine can match when its label appears in returned tags. PalateOps does not manufacture affinity values. The side-by-side signal coverage count is the number of selected recipe options whose cuisine maps to a returned tag, not a Qloo score or outcome prediction.

## Supply shock

The demo shock raises expected attendance by 25%, increases the demo chicken ingredient price by 20%, preserves all other constraints and reruns both baselines. It does not infer demand or alter the budget automatically.
