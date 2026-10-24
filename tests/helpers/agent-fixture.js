export const AGENT_ENV = {
  PALATEOPS_AGENT_ENABLED: "true",
  OPENAI_API_KEY: "fixture-model-key",
  OPENAI_MODEL: "fixture-model",
  QLOO_BACKEND_TOKEN: "fixture-backend-token-with-at-least-32-characters",
};

export const AGENT_STEPS = [
  ["get_taste_signals", {}],
  ["optimize_menu", { target: "baseline" }],
  ["optimize_menu", { target: "taste" }],
  ["verify_plan", { target: "baseline" }],
  ["verify_plan", { target: "taste" }],
  ["build_procurement", {}],
];

// Protocol fixture only: this performs no model or Qloo network request.
export function scriptedModel(steps = AGENT_STEPS, requests = []) {
  let index = 0;
  return async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) });
    const step = steps[index++];
    return new Response(JSON.stringify({
      status: "completed",
      usage: { input_tokens: 20, output_tokens: 10 },
      output: step ? [{ type: "function_call", call_id: "fixture-call-" + index, name: step[0], arguments: JSON.stringify(step[1]) }]
        : [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify({ summary: "Fixture model completed the planning tools. This is an automated integration check, not a live model response." }) }] }],
    }), { headers: { "content-type": "application/json" } });
  };
}
