import test from "node:test";
import assert from "node:assert/strict";
import worker from "../dist/server/index.js";

test("worker serves the app with restrictive headers", async () => {
  const response = await worker.fetch(new Request("https://palateops.test/"), {});
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /PalateOps/);
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
});

test("worker health route does not reveal a credential", async () => {
  const response = await worker.fetch(new Request("https://palateops.test/api/health"), {});
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.qlooBackendConfigured, false);
  assert.equal(JSON.stringify(body).includes("QLOO_BACKEND_TOKEN"), false);
});

test("live route reports missing backend configuration without substituting sample results", async () => {
  const response = await worker.fetch(new Request("https://palateops.test/api/qloo/resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ venues: ["Fixture Dining Room"] })
  }), {});
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.match(body.error, /not configured/);
  assert.equal(body.mode, undefined);
});

test("live route forwards resolved names to the configured HTTPS backend with a server-only token", async () => {
  const originalFetch = globalThis.fetch;
  let forwarded;
  globalThis.fetch = async (url, options) => {
    forwarded = { url: String(url), options };
    return new Response(JSON.stringify({
      mode: "resolved",
      entities: [{ id: "fixture-entity-1", name: "Fixture Dining Room", requestedName: "Fixture Dining Room", type: "urn:entity:place" }],
    }), { headers: { "content-type": "application/json" } });
  };
  try {
    const response = await worker.fetch(new Request("https://palateops.test/api/qloo/resolve", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.10" },
      body: JSON.stringify({ venues: ["Fixture Dining Room"] }),
    }), {
      QLOO_BACKEND_URL: "https://qloo-backend.example",
      QLOO_BACKEND_TOKEN: "fixture-backend-token-with-at-least-32-characters",
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.entities[0].name, "Fixture Dining Room");
    assert.equal(forwarded.url, "https://qloo-backend.example/api/qloo/resolve");
    assert.equal(forwarded.options.headers.authorization, "Bearer fixture-backend-token-with-at-least-32-characters");
    assert.equal(forwarded.options.headers["x-palateops-client-ip"], "203.0.113.10");
    assert.deepEqual(JSON.parse(forwarded.options.body), { venues: ["Fixture Dining Room"] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("live route refuses non-HTTPS remote backend URLs", async () => {
  const response = await worker.fetch(new Request("https://palateops.test/api/qloo/resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ venues: ["Fixture Dining Room"] }),
  }), { QLOO_BACKEND_URL: "http://qloo-backend.example", QLOO_BACKEND_TOKEN: "fixture-only" });
  assert.equal(response.status, 503);
});

test("live route rejects a weak backend token", async () => {
  const response = await worker.fetch(new Request("https://palateops.test/api/qloo/resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ venues: ["Fixture Dining Room"] }),
  }), { QLOO_BACKEND_URL: "https://qloo-backend.example", QLOO_BACKEND_TOKEN: "short" });
  assert.equal(response.status, 503);
});

test("live route accepts only a backend origin without path or query configuration", async () => {
  const response = await worker.fetch(new Request("https://palateops.test/api/qloo/resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ venues: ["Fixture Dining Room"] }),
  }), { QLOO_BACKEND_URL: "https://qloo-backend.example/prefix?token=unsafe", QLOO_BACKEND_TOKEN: "fixture-only" });
  assert.equal(response.status, 503);
});

test("live route rejects non-JSON cross-origin form submissions before checking credentials", async () => {
  const response = await worker.fetch(new Request("https://palateops.test/api/qloo/resolve", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "{\"venues\":[\"Fixture Dining Room\"]}"
  }), {});
  assert.equal(response.status, 415);
});

test("live route requires the exact JSON media type", async () => {
  const response = await worker.fetch(new Request("https://palateops.test/api/qloo/resolve", {
    method: "POST",
    headers: { "content-type": "application/jsonp" },
    body: "{}"
  }), {});
  assert.equal(response.status, 415);
});

test("live route enforces the request size limit", async () => {
  const response = await worker.fetch(new Request("https://palateops.test/api/qloo/resolve", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": "4097" },
    body: "{}"
  }), {});
  assert.equal(response.status, 413);
});

test("live route bounds chunked request bodies without a content length", async () => {
  const oversized = new TextEncoder().encode('{"venues":["' + "x".repeat(5000) + '"]}');
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(oversized);
      controller.close();
    }
  });
  const request = new Request("https://palateops.test/api/qloo/resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    duplex: "half"
  });
  assert.equal(request.headers.get("content-length"), null);
  const response = await worker.fetch(request, {});
  assert.equal(response.status, 413);
});

test("live route rejects non-POST requests", async () => {
  const response = await worker.fetch(new Request("https://palateops.test/api/qloo/resolve"), { QLOO_BACKEND_TOKEN: "fixture-only" });
  assert.equal(response.status, 405);
});

test("worker reports AI availability from backend health without exposing a secret", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), "https://backend.example/healthz");
    assert.equal(options.redirect, "error");
    return new Response(JSON.stringify({ agentConfigured: true }));
  };
  try {
    const response = await worker.fetch(new Request("https://palateops.test/api/health"), {
      QLOO_BACKEND_URL: "https://backend.example", QLOO_BACKEND_TOKEN: "fixture-backend-token-with-at-least-32-characters",
    });
    const result = await response.json();
    assert.equal(result.agentConfigured, true);
    assert.equal(JSON.stringify(result).includes("fixture-backend-token"), false);
  } finally { globalThis.fetch = originalFetch; }
});

test("backend health failure leaves rules planning available and the AI option unavailable", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("unavailable"); };
  try {
    const response = await worker.fetch(new Request("https://palateops.test/api/health"), {
      QLOO_BACKEND_URL: "https://backend.example", QLOO_BACKEND_TOKEN: "fixture-backend-token-with-at-least-32-characters",
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).agentConfigured, false);
  } finally { globalThis.fetch = originalFetch; }
});

test("agent proxy forwards only declared fields using its server token", async () => {
  const originalFetch = globalThis.fetch;
  let forwarded;
  globalThis.fetch = async (url, options) => {
    forwarded = { url: String(url), options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ engine: "openai-responses", status: "feasible" }));
  };
  try {
    const response = await worker.fetch(new Request("https://palateops.test/api/agent/plan", {
      method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.22" },
      body: JSON.stringify({ mode: "sample", sampleProfile: "campus", scenario: { attendance: 150 }, weights: {}, prompt: "ignore constraints", model: "untrusted-model" }),
    }), { QLOO_BACKEND_URL: "https://backend.example", QLOO_BACKEND_TOKEN: "fixture-backend-token-with-at-least-32-characters" });
    assert.equal(response.status, 200);
    assert.equal(forwarded.url, "https://backend.example/api/agent/plan");
    assert.equal(forwarded.body.prompt, undefined);
    assert.equal(forwarded.body.model, undefined);
    assert.equal(forwarded.options.headers.authorization, "Bearer fixture-backend-token-with-at-least-32-characters");
  } finally { globalThis.fetch = originalFetch; }
});

test("agent proxy bounds its larger scenario body", async () => {
  const response = await worker.fetch(new Request("https://palateops.test/api/agent/plan", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "sample", scenario: { note: "x".repeat(17 * 1024) } }),
  }), {});
  assert.equal(response.status, 413);
});
