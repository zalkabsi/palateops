import test from "node:test";
import assert from "node:assert/strict";
import { createQlooBackendHandler } from "../qloo-backend/server.mjs";

const ENV = { QLOO_API_KEY: "fixture-key", QLOO_BACKEND_TOKEN: "fixture-backend-token-with-at-least-32-characters" };

function request(path, body, token = ENV.QLOO_BACKEND_TOKEN) {
  return new Request("https://backend.test" + path, {
    method: "POST",
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json",
      "x-palateops-client-ip": "203.0.113.15",
    },
    body: JSON.stringify(body),
  });
}

test("backend health reports configuration without returning secrets", async () => {
  const handler = createQlooBackendHandler({ env: ENV });
  const response = await handler(new Request("https://backend.test/healthz"));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.qlooConfigured, true);
  assert.equal(body.harnessVersion, "0.1.26");
  assert.equal(JSON.stringify(body).includes(ENV.QLOO_API_KEY), false);
  assert.equal(JSON.stringify(body).includes(ENV.QLOO_BACKEND_TOKEN), false);
});

test("backend requires its shared bearer token before running the harness", async () => {
  let called = false;
  const handler = createQlooBackendHandler({ env: ENV, runHarness: async () => { called = true; } });
  const response = await handler(request("/api/qloo/resolve", { venues: ["Sakura Table"] }, "wrong-token"));
  assert.equal(response.status, 401);
  assert.equal(called, false);
});

test("backend rejects a weak shared token before running the harness", async () => {
  let called = false;
  const handler = createQlooBackendHandler({ env: { ...ENV, QLOO_BACKEND_TOKEN: "short" }, runHarness: async () => { called = true; } });
  const response = await handler(request("/api/qloo/resolve", { venues: ["Sakura Table"] }, "short"));
  assert.equal(response.status, 503);
  assert.equal(called, false);
});

test("resolution returns only an exact place match before any Insights request", async () => {
  const calls = [];
  const handler = createQlooBackendHandler({
    env: ENV,
    runHarness: async (args) => {
      calls.push(args);
      assert.equal(args[0], "api");
      assert.equal(args[1], "search");
      assert.equal(args[args.indexOf("--type") + 1], "restaurant");
      assert.equal(args.includes(ENV.QLOO_API_KEY), false);
      return { exitCode: 0, stdout: JSON.stringify([
        { entity_id: "place-id-1", name: "Sakura Table", subtype: "urn:entity:place" },
        { entity_id: "place-id-2", name: "Sakura Table Express", subtype: "urn:entity:place" },
      ]) };
    },
  });
  const response = await handler(request("/api/qloo/resolve", { venues: ["Sakura Table"] }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.mode, "resolved");
  assert.deepEqual(body.entities.map((entity) => entity.id), ["place-id-1"]);
  assert.equal(calls.length, 1);
});

test("ambiguous restaurant matches return suggestions without requesting Insights", async () => {
  let calls = 0;
  const handler = createQlooBackendHandler({
    env: ENV,
    runHarness: async () => {
      calls += 1;
      return { exitCode: 0, stdout: JSON.stringify([
        { entity_id: "place-id-1", name: "Sakura Table Downtown", subtype: "urn:entity:place" },
        { entity_id: "place-id-2", name: "Sakura Table North", subtype: "urn:entity:place" },
      ]) };
    },
  });
  const response = await handler(request("/api/qloo/resolve", { venues: ["Sakura Table"] }));
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.match(body.error, /No taste insights were requested/);
  assert.equal(body.unresolved[0].candidates.length, 2);
  assert.equal(calls, 1);
});

test("insights use confirmed place IDs through qloo api and map tags from recommended places", async () => {
  let argsSeen;
  const handler = createQlooBackendHandler({
    env: ENV,
    runHarness: async (args, options) => {
      argsSeen = args;
      assert.equal(options.env.QLOO_API_KEY, ENV.QLOO_API_KEY);
      assert.ok(options.timeoutMs > 0);
      return { exitCode: 0, stdout: JSON.stringify([
        {
          entity_id: "recommended-place-1",
          name: "Kyoto Noodle House",
          tags: [
            { id: "urn:tag:genre:food:japanese", name: "Japanese", type: "urn:tag:genre:food" },
            { id: "urn:tag:genre:food:ramen", name: "Ramen", type: "urn:tag:genre:food" },
          ],
        },
        {
          entity_id: "recommended-place-2",
          name: "Ramen Garden",
          tags: [{ id: "urn:tag:genre:food:japanese", name: "Japanese", type: "urn:tag:genre:food" }],
        },
      ]) };
    },
    now: () => new Date("2026-10-16T12:00:00.000Z"),
  });
  const response = await handler(request("/api/qloo/signals", {
    entities: [{ id: "place-id-1", name: "Sakura Table", requestedName: "Sakura Table", type: "urn:entity:place" }],
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(argsSeen[0], "api");
  assert.equal(argsSeen[1], "insights");
  assert.equal(argsSeen[argsSeen.indexOf("--type") + 1], "restaurant");
  assert.equal(argsSeen[argsSeen.indexOf("--signal-entities") + 1], "place-id-1");
  assert.equal(body.source, "Qloo Hackathon Harness (qloo api)");
  assert.equal(body.endpoint, "https://api.qloo.com/v2/insights");
  assert.equal(body.retrievedAt, "2026-10-16T12:00:00.000Z");
  assert.deepEqual(body.tags.map((tag) => tag.name), ["Japanese", "Ramen"]);
  assert.deepEqual(body.tags[0].sourceEntityIds, ["recommended-place-1", "recommended-place-2"]);
  assert.equal(body.recommendations.length, 2);
});

test("invalid confirmed IDs fail validation without invoking the Harness", async () => {
  let called = false;
  const handler = createQlooBackendHandler({ env: ENV, runHarness: async () => { called = true; } });
  const response = await handler(request("/api/qloo/signals", {
    entities: [{ id: "place-id-1,other-id", name: "Sakura Table" }],
  }));
  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test("missing event credentials return setup guidance without invoking the Harness", async () => {
  let called = false;
  const handler = createQlooBackendHandler({ env: { QLOO_BACKEND_TOKEN: ENV.QLOO_BACKEND_TOKEN }, runHarness: async () => { called = true; } });
  const response = await handler(request("/api/qloo/resolve", { venues: ["Sakura Table"] }));
  assert.equal(response.status, 503);
  assert.equal(called, false);
});

test("Harness timeout returns a bounded timeout response without exposing process errors", async () => {
  const handler = createQlooBackendHandler({
    env: ENV,
    runHarness: async () => {
      const error = new Error("private command output");
      error.code = "ETIMEDOUT";
      throw error;
    },
  });
  const response = await handler(request("/api/qloo/resolve", { venues: ["Sakura Table"] }));
  const body = await response.json();
  assert.equal(response.status, 504);
  assert.match(body.error, /too long to respond/);
  assert.doesNotMatch(JSON.stringify(body), /private command output/);
});
