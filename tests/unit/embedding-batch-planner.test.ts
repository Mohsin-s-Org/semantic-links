import assert from "node:assert/strict";
import test from "node:test";
import {
  estimateMultilingualTokenLength,
  planEmbeddingBatches
} from "../../src/indexing/embedding-batch-planner.ts";

test("groups similar estimated lengths while preserving stable ties", () => {
  const plan = planEmbeddingBatches([
    { id: "long", text: "x".repeat(160) },
    { id: "short-a", text: "tiny" },
    { id: "medium", text: "x".repeat(80) },
    { id: "short-b", text: "small" }
  ], {
    batchSize: 2,
    bucketWidth: 16,
    estimateTokens: (text) => text.length / 4
  });

  assert.deepEqual(
    plan.batches.map((batch) => batch.map(({ input }) => input.id)),
    [["short-a", "short-b"], ["medium", "long"]]
  );
  assert.equal(plan.estimatedTokens, 63);
  assert.equal(plan.paddedTokens, 82);
});

test("reduces padding compared with fixed input order", () => {
  const inputs = [
    { id: "long-a", text: "x".repeat(400) },
    { id: "short-a", text: "x".repeat(20) },
    { id: "long-b", text: "x".repeat(360) },
    { id: "short-b", text: "x".repeat(16) }
  ];
  const plan = planEmbeddingBatches(inputs, {
    batchSize: 2,
    bucketWidth: 16,
    estimateTokens: (text) => text.length / 4
  });
  const fixedOrderPadding = (100 * 2) + (90 * 2);

  assert.ok(plan.paddedTokens < fixedOrderPadding);
  assert.equal(plan.estimatedTokens, 199);
});

test("handles multilingual and empty text deterministically", () => {
  const english = estimateMultilingualTokenLength("water conservation");
  const arabic = estimateMultilingualTokenLength("ترشيد استهلاك المياه");
  const mixed = estimateMultilingualTokenLength("water والمياه");

  assert.equal(estimateMultilingualTokenLength(""), 1);
  assert.ok(english > 0);
  assert.ok(arabic > 0);
  assert.ok(mixed > 0);
  assert.equal(
    estimateMultilingualTokenLength("ترشيد استهلاك المياه"),
    arabic
  );
});

test("normalises invalid custom estimates", () => {
  const plan = planEmbeddingBatches([
    { id: "negative", text: "a" },
    { id: "nan", text: "b" }
  ], {
    batchSize: 2,
    bucketWidth: 8,
    estimateTokens: (text) => text === "a" ? -1 : Number.NaN
  });

  assert.deepEqual(
    plan.batches[0]?.map(({ estimatedTokens }) => estimatedTokens),
    [1, 1]
  );
});

test("validates planning options", () => {
  assert.throws(() => planEmbeddingBatches([], { batchSize: 0, bucketWidth: 1 }));
  assert.throws(() => planEmbeddingBatches([], { batchSize: 1, bucketWidth: 0 }));
});
