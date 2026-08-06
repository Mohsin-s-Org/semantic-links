import assert from "node:assert/strict";
import test from "node:test";
import {
  EmbeddingBatchQueue,
  estimateMultilingualTokenLength,
  fixedOrderPaddedTokens
} from "../../src/indexing/embedding-batch-planner.ts";

test("returns no batches for an empty input set", () => {
  const queue = new EmbeddingBatchQueue([]);

  assert.equal(queue.remaining, 0);
  assert.equal(queue.stats.inputCount, 0);
  assert.equal(queue.stats.bucketCount, 0);
  assert.equal(queue.take(4), null);
});

test("keeps batches inside deterministic length buckets", () => {
  const queue = new EmbeddingBatchQueue([
    { id: "long", text: "x".repeat(100) },
    { id: "short-a", text: "x".repeat(4) },
    { id: "medium", text: "x".repeat(90) },
    { id: "short-b", text: "x".repeat(6) }
  ], {
    bucketWidth: 16,
    estimateTokens: (text) => text.length
  });

  const batches = drain(queue, 2);

  assert.deepEqual(batchIds(batches), [
    ["short-a", "short-b"],
    ["medium"],
    ["long"]
  ]);
  assert.equal(batches[0]?.estimatedTokens, 10);
  assert.equal(batches[0]?.paddedTokens, 12);
  assert.equal(queue.stats.estimatedTokens, 200);
  assert.equal(queue.remaining, 0);
});

test("preserves original order for equal estimated lengths", () => {
  const queue = new EmbeddingBatchQueue([
    { id: "first", text: "a" },
    { id: "second", text: "b" },
    { id: "third", text: "c" }
  ], {
    bucketWidth: 8,
    estimateTokens: () => 4
  });

  assert.deepEqual(batchIds(drain(queue, 2)), [
    ["first", "second"],
    ["third"]
  ]);
});

test("reduces estimated padding for a mixed-length workload", () => {
  const inputs = [
    { id: "long-a", text: "x".repeat(100) },
    { id: "short-a", text: "x".repeat(4) },
    { id: "long-b", text: "x".repeat(90) },
    { id: "short-b", text: "x".repeat(6) }
  ];
  const estimate = (text: string): number => text.length;
  const fixed = fixedOrderPaddedTokens(inputs, 2, estimate);
  const bucketed = drain(new EmbeddingBatchQueue(inputs, {
    bucketWidth: 16,
    estimateTokens: estimate
  }), 2).reduce((total, batch) => total + batch.paddedTokens, 0);

  assert.equal(fixed, 380);
  assert.equal(bucketed, 202);
  assert.ok(bucketed < fixed);
});

test("falls back to original order when length data is unavailable", () => {
  const queue = new EmbeddingBatchQueue([
    { id: "a", text: "first" },
    { id: "b", text: "second" },
    { id: "c", text: "third" }
  ], {
    estimateTokens: (text) => {
      if (text === "second") {
        throw new Error("Tokenizer unavailable");
      }
      return text.length;
    }
  });

  assert.equal(queue.stats.usedLengthBuckets, false);
  assert.deepEqual(batchIds(drain(queue, 2)), [["a", "b"], ["c"]]);
});

test("estimates English, Arabic and mixed passages deterministically", () => {
  const english = estimateMultilingualTokenLength("water conservation planning");
  const arabic = estimateMultilingualTokenLength("ترشيد استهلاك المياه");
  const mixed = estimateMultilingualTokenLength("water والمياه planning");

  assert.equal(estimateMultilingualTokenLength(""), 1);
  assert.ok(english > 1);
  assert.ok(arabic > 1);
  assert.ok(mixed > 1);
  assert.equal(
    estimateMultilingualTokenLength("ترشيد استهلاك المياه"),
    arabic
  );
});

test("validates queue and batch limits", () => {
  assert.throws(() => new EmbeddingBatchQueue([], { bucketWidth: 0 }));
  const queue = new EmbeddingBatchQueue([{ id: "a", text: "text" }]);
  assert.throws(() => queue.take(0));
  assert.throws(() => fixedOrderPaddedTokens([], 0));
});

function drain(
  queue: EmbeddingBatchQueue,
  batchSize: number
): NonNullable<ReturnType<EmbeddingBatchQueue["take"]>>[] {
  const batches: NonNullable<ReturnType<EmbeddingBatchQueue["take"]>>[] = [];
  for (let batch = queue.take(batchSize); batch !== null; batch = queue.take(batchSize)) {
    batches.push(batch);
  }
  return batches;
}

function batchIds(
  batches: readonly NonNullable<ReturnType<EmbeddingBatchQueue["take"]>>[]
): string[][] {
  return batches.map((batch) => batch.items.map(({ input }) => input.id));
}
