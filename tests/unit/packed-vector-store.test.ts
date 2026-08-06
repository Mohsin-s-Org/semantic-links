import assert from "node:assert/strict";
import test from "node:test";
import { PackedVectorStore } from "../../src/indexing/packed-vector-store.ts";

test("stores vectors in one geometrically grown matrix", () => {
  const store = new PackedVectorStore();
  store.set("a", vector(1, 2));
  store.set("b", vector(3, 4));

  assert.equal(store.size, 2);
  assert.equal(store.dimensions, 2);
  assert.equal(store.capacity, 16);
  assert.equal(store.stats.liveBytes, 16);
  assert.equal(store.stats.allocatedBytes, 16 * 2 * Float32Array.BYTES_PER_ELEMENT);
  assert.deepEqual([...store.get("a") ?? []], [1, 2]);
  assert.deepEqual([...store.get("b") ?? []], [3, 4]);
});

test("replaces a row without increasing size", () => {
  const store = new PackedVectorStore();
  store.set("a", vector(1, 2));
  const capacity = store.capacity;

  store.set("a", vector(5, 6));

  assert.equal(store.size, 1);
  assert.equal(store.capacity, capacity);
  assert.deepEqual([...store.get("a") ?? []], [5, 6]);
});

test("reuses deleted rows without overwriting live vectors", () => {
  const store = new PackedVectorStore();
  store.set("a", vector(1, 2));
  store.set("b", vector(3, 4));
  assert.equal(store.delete("a"), true);

  store.set("c", vector(7, 8));

  assert.equal(store.size, 2);
  assert.deepEqual([...store.get("b") ?? []], [3, 4]);
  assert.deepEqual([...store.get("c") ?? []], [7, 8]);
  assert.equal(store.has("a"), false);
});

test("grows capacity without changing existing vectors", () => {
  const store = new PackedVectorStore();
  for (let index = 0; index < 17; index += 1) {
    store.set(String(index), vector(index, index + 1));
  }

  assert.equal(store.capacity, 32);
  assert.deepEqual([...store.get("0") ?? []], [0, 1]);
  assert.deepEqual([...store.get("16") ?? []], [16, 17]);
});

test("compacts deterministically and releases unused rows", () => {
  const store = new PackedVectorStore();
  store.set("z", vector(9, 10));
  store.set("a", vector(1, 2));
  store.set("m", vector(5, 6));
  store.delete("m");

  store.compact();

  assert.equal(store.capacity, 16);
  assert.deepEqual([...store].map(([id]) => id), ["a", "z"]);
  assert.deepEqual([...store.get("a") ?? []], [1, 2]);
  assert.deepEqual([...store.get("z") ?? []], [9, 10]);
  assert.equal(store.stats.freeRows, 14);
});

test("copies input bytes and can return a bounded copy", () => {
  const store = new PackedVectorStore();
  const input = vector(1, 2);
  store.set("a", input);
  input[0] = 99;
  const copy = store.getCopy("a");
  assert.ok(copy !== undefined);
  copy[0] = 77;

  assert.deepEqual([...store.get("a") ?? []], [1, 2]);
});

test("validates dimensions, values and compaction order", () => {
  const store = new PackedVectorStore();
  assert.throws(() => store.set("", vector(1, 2)));
  assert.throws(() => store.set("bad", new Float32Array()));
  store.set("a", vector(1, 2));
  assert.throws(() => store.set("b", new Float32Array([1])));
  assert.throws(() => store.set("bad", new Float32Array([Number.NaN, 1])));
  assert.throws(() => store.compact([]));
});

function vector(...values: number[]): Float32Array {
  return new Float32Array(values);
}
