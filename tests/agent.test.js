import test from "node:test";
import assert from "node:assert/strict";
import { calculateShoppingList, normalizeScenario, verifyPlan } from "../src/planner.js";
import { requestAgentPlan } from "../src/agent.js";
import { runPlanningAgent } from "../qloo-backend/agent.mjs";
import { createQlooBackendHandler, runHarnessCommand } from "../qloo-backend/server.mjs";
import { AGENT_ENV, AGENT_STEPS, scriptedModel } from "./helpers/agent-fixture.js";

const input = () => ({
  mode: "sample", sampleProfile: "campus", scenario: normalizeScenario({ cafeteriaName: "Do not send this name to the model", kitchenCapacity: 200 }),
  weights: { tasteSignal: 40, explicitPreference: 28, affordability: 20, preparation: 12 },
});
const backendRequest = (body, ip = "203.0.113.1", token = AGENT_ENV.QLOO_BACKEND_TOKEN) => new Request("https://backend.test/api/agent/plan", {
  method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token, "x-palateops-client-ip": ip }, body: JSON.stringify(body),
});

test("agent executes real tools and returns only independently verified plans", async () => {
  const requests = [];
  const request = input();
  const result = await runPlanningAgent(request, { env: AGENT_ENV, modelFetch: scriptedModel(undefined, requests) });
  assert.equal(result.status, "feasible");
  assert.equal(verifyPlan(result.baseline, request.scenario).valid, true);
  assert.equal(verifyPlan(result.tastePlan, request.scenario).valid, true);
  assert.deepEqual(result.procurement, calculateShoppingList(result.tastePlan, request.scenario));
  assert.equal(result.signal.provenance.mode, "sample");
  assert.equal(result.usage.toolCalls, 6);
  assert.equal(result.trace.length, 6);
  assert.equal(requests.length, 7);
  for (const request of requests) {
    assert.equal(request.url, "https://api.openai.com/v1/responses");
    assert.equal(request.options.redirect, "error");
    assert.equal(request.body.store, false);
    assert.equal(JSON.stringify(request.body).includes(AGENT_ENV.OPENAI_API_KEY), false);
    assert.equal(JSON.stringify(request.body).includes(AGENT_ENV.QLOO_BACKEND_TOKEN), false);
    assert.equal(JSON.stringify(request.body).includes(input().scenario.cafeteriaName), false);
  }
});

test("agent cannot finish before optimization, verification and procurement", async () => {
  for (const steps of [[], AGENT_STEPS.slice(0, 3), AGENT_STEPS.filter(([name]) => name !== "verify_plan")]) {
    await assert.rejects(runPlanningAgent(input(), { env: AGENT_ENV, modelFetch: scriptedModel(steps) }), /before|verification/);
  }
});

test("agent rejects tool attempts to change constraints and can recover using valid tools", async () => {
  const requests = [];
  const steps = [["optimize_menu", { target: "taste", attendance: 1 }], ...AGENT_STEPS];
  const result = await runPlanningAgent(input(), { env: AGENT_ENV, modelFetch: scriptedModel(steps, requests) });
  assert.equal(result.tastePlan.totalServings, 750);
  const output = requests[1].body.input.find((item) => item.type === "function_call_output");
  assert.match(JSON.parse(output.output).error, /constraints cannot be edited/);
});

test("agent returns measured infeasibility without inventing a plan", async () => {
  const request = input();
  request.scenario.dailyBudget = 0.01;
  const result = await runPlanningAgent(request, { env: AGENT_ENV, modelFetch: scriptedModel(AGENT_STEPS.slice(0, 3)) });
  assert.equal(result.status, "infeasible");
  assert.ok(result.errors.length);
  assert.equal(result.tastePlan, undefined);
});

test("agent stops repeated tool loops within its planning bound", async () => {
  let requests = 0;
  const model = scriptedModel(Array.from({ length: 20 }, () => ["get_taste_signals", {}]));
  await assert.rejects(runPlanningAgent(input(), { env: AGENT_ENV, modelFetch: (...args) => { requests += 1; return model(...args); } }), /planning limit/);
  assert.equal(requests, 10);
});

test("agent fails closed on provider errors, refusals and malformed responses", async () => {
  const cases = [
    [() => new Response("secret provider details", { status: 401 }), 503],
    [() => new Response("secret provider details", { status: 429 }), 429],
    [() => new Response("secret provider details", { status: 500 }), 502],
    [() => new Response("invalid JSON"), 502],
    [() => new Response(JSON.stringify({ status: "incomplete", output: [] })), 502],
    [() => new Response("x".repeat(512 * 1024 + 1)), 502],
    [() => { throw new DOMException("provider detail", "TimeoutError"); }, 504],
  ];
  for (const [modelFetch, status] of cases) {
    await assert.rejects(runPlanningAgent(input(), { env: AGENT_ENV, modelFetch }), (error) => error.status === status && !error.message.includes("secret provider details"));
  }
});

test("agent validates configuration and constraints before any model request", async () => {
  let called = false;
  const modelFetch = () => { called = true; throw new Error("unexpected request"); };
  await assert.rejects(runPlanningAgent(input(), { env: { ...AGENT_ENV, PALATEOPS_AGENT_ENABLED: "false" }, modelFetch }), /not configured/);
  await assert.rejects(runPlanningAgent({ ...input(), scenario: { attendance: 300, kitchenCapacity: 200 } }, { env: AGENT_ENV, modelFetch }), /capacity/);
  assert.equal(called, false);
});

test("live agent uses confirmed entity IDs via the Harness and retains genuine provenance", async () => {
  const calls = [];
  const handler = createQlooBackendHandler({
    env: { ...AGENT_ENV, QLOO_API_KEY: "fixture-qloo-key" }, modelFetch: scriptedModel(),
    runHarness: async (args) => {
      calls.push(args);
      return { exitCode: 0, stdout: JSON.stringify({ results: { entities: [{ entity_id: "rec-1", name: "Fixture recommendation", tags: [{ id: "japanese", name: "Japanese" }] }] } }) };
    },
  });
  const response = await handler(backendRequest({ ...input(), mode: "live", entities: [{ id: "place-1", name: "Fixture restaurant", requestedName: "Fixture restaurant" }] }));
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.signal.provenance.mode, "live");
  assert.deepEqual(result.signal.provenance.entityIds, ["place-1"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], "insights");
  assert.equal(calls[0][calls[0].indexOf("--signal-entities") + 1], "place-1");
});

test("live agent never substitutes sample data when Qloo fails", async () => {
  const handler = createQlooBackendHandler({ env: { ...AGENT_ENV, QLOO_API_KEY: "fixture-qloo-key" }, modelFetch: scriptedModel(), runHarness: async () => { throw new Error("private failure"); } });
  const response = await handler(backendRequest({ ...input(), mode: "live", entities: [{ id: "place-1", name: "Fixture restaurant", requestedName: "Fixture restaurant" }] }));
  const result = await response.json();
  assert.equal(response.status, 502);
  assert.equal(result.signal, undefined);
  assert.equal(JSON.stringify(result).includes("private failure"), false);
});

test("agent endpoint authenticates before accessing the model", async () => {
  let called = false;
  const handler = createQlooBackendHandler({ env: AGENT_ENV, modelFetch: () => { called = true; } });
  const response = await handler(backendRequest(input(), undefined, "wrong-token"));
  assert.equal(response.status, 401);
  assert.equal(called, false);
});

test("agent limits concurrent model runs", async () => {
  let release;
  let started;
  const waiting = new Promise((resolve) => { release = resolve; });
  const twoStarted = new Promise((resolve) => { started = resolve; });
  let count = 0;
  const handler = createQlooBackendHandler({ env: AGENT_ENV, modelFetch: async () => {
    if (++count === 2) started();
    await waiting;
    return scriptedModel([])("fixture", { body: "{}" });
  } });
  const first = handler(backendRequest(input(), "203.0.113.2"));
  const second = handler(backendRequest(input(), "203.0.113.3"));
  await twoStarted;
  const third = await handler(backendRequest(input(), "203.0.113.4"));
  assert.equal(third.status, 429);
  release();
  await Promise.all([first, second]);
});

test("agent enforces its per-process hourly run allowance", async () => {
  let time = 0;
  const handler = createQlooBackendHandler({ env: AGENT_ENV, modelFetch: scriptedModel([]), clock: () => time });
  for (let index = 0; index < 30; index += 1) assert.equal((await handler(backendRequest(input(), "fixture-ip-" + index))).status, 502);
  assert.equal((await handler(backendRequest(input(), "fixture-ip-over-limit"))).status, 429);
  time += 3_600_001;
  assert.equal((await handler(backendRequest(input(), "fixture-ip-new-window"))).status, 502);
});

test("browser independently rejects a tampered AI plan and malformed provenance", async () => {
  const request = input();
  const result = await runPlanningAgent(request, { env: AGENT_ENV, modelFetch: scriptedModel() });
  const fetcher = async () => new Response(JSON.stringify(result));
  assert.equal((await requestAgentPlan(request, fetcher)).status, "feasible");
  result.tastePlan.days[0].items[0].ingredients = {};
  await assert.rejects(requestAgentPlan(request, fetcher), /independent constraint check/);
  result.signal.provenance.mode = "live";
  await assert.rejects(requestAgentPlan(request, fetcher), /invalid result/);
});

test("real Harness process adapter launches a child and isolates model credentials", async () => {
  const result = await runHarnessCommand(["-e", "process.stdout.write(JSON.stringify({qloo:Boolean(process.env.QLOO_API_KEY),model:Boolean(process.env.OPENAI_API_KEY)}))"], {
    env: { QLOO_CLI_BIN: process.execPath, QLOO_API_KEY: "fixture-key", OPENAI_API_KEY: "fixture-model-key" }, timeoutMs: 5000,
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout), { qloo: true, model: false });
});

test("real Harness process adapter bounds output and execution time", async () => {
  await assert.rejects(runHarnessCommand(["-e", "process.stdout.write('x'.repeat(1000))"], { env: { QLOO_CLI_BIN: process.execPath }, maxOutputBytes: 100 }), /response limit/);
  await assert.rejects(runHarnessCommand(["-e", "setTimeout(() => {}, 5000)"], { env: { QLOO_CLI_BIN: process.execPath }, timeoutMs: 50 }), (error) => error.code === "ETIMEDOUT");
});
