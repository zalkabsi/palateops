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
  assert.equal(body.qlooConfigured, false);
  assert.equal(JSON.stringify(body).includes("QLOO_API_KEY"), false);
});

test("live route reports missing credentials without substituting sample results", async () => {
  const response = await worker.fetch(new Request("https://palateops.test/api/qloo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ venues: ["Fixture Dining Room"] })
  }), {});
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.match(body.error, /not configured/);
  assert.equal(body.mode, undefined);
});

test("live route rejects non-JSON cross-origin form submissions before checking credentials", async () => {
  const response = await worker.fetch(new Request("https://palateops.test/api/qloo", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "{\"venues\":[\"Fixture Dining Room\"]}"
  }), {});
  assert.equal(response.status, 415);
});

test("live route requires the exact JSON media type", async () => {
  const response = await worker.fetch(new Request("https://palateops.test/api/qloo", {
    method: "POST",
    headers: { "content-type": "application/jsonp" },
    body: "{}"
  }), {});
  assert.equal(response.status, 415);
});

test("live route enforces the request size limit", async () => {
  const response = await worker.fetch(new Request("https://palateops.test/api/qloo", {
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
  const request = new Request("https://palateops.test/api/qloo", {
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
  const response = await worker.fetch(new Request("https://palateops.test/api/qloo"), { QLOO_API_KEY: "fixture-only" });
  assert.equal(response.status, 405);
});
