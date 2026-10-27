import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extractEntities, normalizeEntity, parseHarnessJson } from "../server/qloo.mjs";

describe("parseHarnessJson", () => {
  it("reads a bare JSON array printed by `--json`", () => {
    const payload = parseHarnessJson('[{"name":"Kori"}]');
    assert.deepEqual(payload, [{ name: "Kori" }]);
  });

  it("skips the first-run banner the CLI prints before its output", () => {
    const stdout = 'Welcome to Qloo CLI! It looks like this is your first run.\n[{"name":"Kori"}]\n';
    assert.deepEqual(parseHarnessJson(stdout), [{ name: "Kori" }]);
  });

  it("surfaces a provider error payload as a QlooError", () => {
    assert.throws(
      () => parseHarnessJson('{"error":true,"code":"API_ERROR","message":"API request failed: 401 Unauthorized"}'),
      (error) => {
        assert.equal(error.name, "QlooError");
        assert.equal(error.status, 503);
        assert.match(error.message, /credential/i);
        return true;
      },
    );
  });

  it("maps rate limiting to 429", () => {
    assert.throws(
      () => parseHarnessJson('{"error":true,"message":"429 Too Many Requests"}'),
      (error) => error.status === 429,
    );
  });

  it("explains a missing credential instead of leaking the banner to the user", () => {
    assert.throws(
      () => parseHarnessJson("To get started, set your API key:\n  qloo config set api-key YOUR_KEY\n"),
      (error) => error.code === "NOT_CONFIGURED",
    );
  });

  it("rejects output that is not JSON", () => {
    assert.throws(() => parseHarnessJson("Segmentation fault"), (error) => error.code === "BAD_OUTPUT");
  });
});

describe("normalizeEntity", () => {
  it("reads affinity from the root of the entity", () => {
    const entity = normalizeEntity({ entity_id: "abc", name: "Kori", affinity: 0.8 });
    assert.equal(entity.affinity, 0.8);
    assert.equal(entity.id, "abc");
  });

  it("reads affinity nested under query", () => {
    assert.equal(normalizeEntity({ entity_id: "a", name: "Kori", query: { affinity: 0.42 } }).affinity, 0.42);
  });

  it("leaves affinity null when Qloo did not return one", () => {
    assert.equal(normalizeEntity({ entity_id: "a", name: "Kori" }).affinity, null);
  });

  it("drops entities without an identity", () => {
    assert.equal(normalizeEntity({ name: "Nameless" }), null);
    assert.equal(normalizeEntity({ entity_id: "x" }), null);
    assert.equal(normalizeEntity(null), null);
  });

  it("keeps named tags and discards the rest", () => {
    const entity = normalizeEntity({
      entity_id: "a",
      name: "Kori",
      tags: [{ id: "t1", name: "izakaya", type: "urn:tag" }, { id: "t2" }, null],
    });
    assert.deepEqual(entity.tags.map((tag) => tag.name), ["izakaya"]);
  });
});

describe("extractEntities", () => {
  it("accepts the harness' bare array", () => {
    assert.equal(extractEntities([{ a: 1 }]).length, 1);
  });

  it("accepts a raw insights envelope", () => {
    assert.equal(extractEntities({ success: true, results: { entities: [{ a: 1 }, { b: 2 }] } }).length, 2);
  });

  it("returns an empty list for an unexpected shape", () => {
    assert.deepEqual(extractEntities({ results: {} }), []);
  });
});
