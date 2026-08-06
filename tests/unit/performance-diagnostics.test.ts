import assert from "node:assert/strict";
import test from "node:test";
import {
  SemanticDiagnostics,
  summarizeDistribution
} from "../../src/diagnostics/performance.ts";

test("summarizes deterministic percentiles", () => {
  assert.deepEqual(summarizeDistribution([1, 2, 3, 4, 100]), {
    count: 5,
    min: 1,
    max: 100,
    mean: 22,
    p50: 3,
    p95: 100,
    p99: 100
  });
});

test("records fixed-name numeric diagnostics only while enabled", () => {
  const diagnostics = new SemanticDiagnostics();
  diagnostics.record("query.inference_ms", 10);
  diagnostics.start();
  diagnostics.record("query.inference_ms", 10);
  diagnostics.record("query.inference_ms", 20);
  diagnostics.increment("query.cache_hit");
  diagnostics.setGauge("index.vector_count", 42);
  const report = diagnostics.stop();

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.samples["query.inference_ms"]?.count, 2);
  assert.equal(report.samples["query.inference_ms"]?.p50, 10);
  assert.equal(report.counters["query.cache_hit"], 1);
  assert.equal(report.gauges["index.vector_count"], 42);
  assert.equal(JSON.stringify(report).includes("note text"), false);
});

test("rejects metric names that could contain content", () => {
  const diagnostics = new SemanticDiagnostics();
  diagnostics.start();
  assert.throws(() => diagnostics.record("query user text", 1));
  diagnostics.stop();
});
