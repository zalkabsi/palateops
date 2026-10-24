import { verifyPlan } from "./planner.js";

export async function requestAgentPlan(input, fetcher = fetch) {
  const response = await fetcher("/api/agent/plan", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(input), signal: AbortSignal.timeout(75_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "The AI planner could not complete the request.");
  if (result.engine !== "openai-responses" || !["feasible", "infeasible"].includes(result.status) ||
      typeof result.summary !== "string" || !result.summary.trim() || result.summary.length > 800 || !Array.isArray(result.trace) || result.trace.length > 20 ||
      result.trace.some((row) => !row || ["title", "detail", "icon"].some((key) => typeof row[key] !== "string" || row[key].length > 4000)) ||
      !result.signal || result.signal.provenance?.mode !== input.mode || !Array.isArray(result.signal.cuisineSignals) || !Array.isArray(result.signal.tags)) {
    throw new Error("The AI planner returned an invalid result.");
  }
  if (result.status === "feasible") {
    const baseline = verifyPlan(result.baseline, input.scenario);
    const taste = verifyPlan(result.tastePlan, input.scenario);
    if (!baseline.valid || !taste.valid) throw new Error("The AI plan failed the browser's independent constraint check. No menu was displayed.");
  } else if (!Array.isArray(result.errors) || !result.errors.length) {
    throw new Error("The AI planner did not explain why the scenario was infeasible.");
  }
  return result;
}
