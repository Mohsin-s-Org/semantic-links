import assert from "node:assert/strict";
import test from "node:test";
import { dotProduct, topDotProducts } from "../../src/retrieval/exact-search.ts";

test("keeps only the highest dot products", () => {
  const query = new Float32Array([1, 0]);
  const result = topDotProducts(query, [
    { value: "low", vector: new Float32Array([0.1, 0.9]) },
    { value: "best", vector: new Float32Array([0.9, 0.1]) },
    { value: "middle", vector: new Float32Array([0.5, 0.5]) }
  ], 2);

  assert.deepEqual(result.map(({ value }) => value), ["best", "middle"]);
});

test("rejects mismatched dimensions", () => {
  assert.equal(
    dotProduct(new Float32Array([1, 2]), new Float32Array([1])),
    Number.NEGATIVE_INFINITY
  );
});
