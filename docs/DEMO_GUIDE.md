# Demo guide

The ready-to-use Campus Commons scenario opens in Sample mode. It needs no account or API key.

1. Generate a weekly menu.
2. Inspect the five days, cover allocation, daily cost bars and meal metadata.
3. Compare the operational baseline with the synthetic sample signal plan. The banner states that sample signals are not live Qloo data.
4. Review the dashboard charts for daily spending, cuisine servings and purchase-cost drivers.
5. Expand Dietary, equipment & stock, change an exclusion or the daily cap, and regenerate.
6. Export the weekly menu, cost summary and consolidated shopping list together as CSV.
7. Simulate a supply shock to add 25% expected attendance and raise chicken prices 20%, then inspect the replan summary.
8. Use Recent plans to restore an earlier run, or undo the supply shock to return to the plan that preceded it.
9. Choose Live Qloo only after the Qloo Harness backend has been deployed and its event key, backend URL and shared token have been configured. Enter one to three public restaurant names. Review the exact place matches before continuing. If live calls fail, the app shows an error and does not silently use sample data.
10. When model configuration is available, select **AI tool agent** under Planning method. Inspect the actual tool trace and generated agent note. The kitchen brief is sent to the AI service; recipe math and hard constraints are independently verified. This choice remains disabled in an unconfigured deployment. See [agent setup and validation](AGENT.md).

## Sample scenario

- 150 expected covers
- 200-cover daily kitchen capacity
- $600 daily ingredient cap
- 5 service days
- 35% vegetarian planning share
- Peanut excluded
- Oven, stovetop and rice cooker available
- Five stock quantities preloaded

The live mode can use up to three voluntary public restaurant names. Do not submit diner names, emails, device IDs or other personal data. Live Qloo and the AI service are currently unconfigured; the public demo uses Sample mode with the rules planner.
