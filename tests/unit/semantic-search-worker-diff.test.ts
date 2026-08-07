import assert from "node:assert/strict";
import test from "node:test";
import {
  SemanticSearchWorker,
  diffWorkerSnapshot
} from "../../src/retrieval/semantic-search-worker.ts";

test("emits only a newly added row", () => {
  const diff = diffWorkerSnapshot(
    vectors([1, 0]),
    documents(0),
    vectors([1, 0], [0, 1]),
    documents(0, 1),
    2
  );

  assert.equal(diff.capacity, 2);
  assert.deepEqual([...diff.rows], [1]);
  assert.deepEqual([...diff.vectors], [0, 1]);
  assert.deepEqual([...diff.documents], [1]);
  assert.deepEqual([...diff.removals], []);
});

test("emits a replacement when vector or document changes", () => {
  const diff = diffWorkerSnapshot(
    vectors([1, 0], [0, 1]),
    documents(0, 1),
    vectors([1, 0], [0.5, 0.5]),
    documents(0, 2),
    2
  );

  assert.deepEqual([...diff.rows], [1]);
  assert.deepEqual([...diff.vectors], [0.5, 0.5]);
  assert.deepEqual([...diff.documents], [2]);
  assert.deepEqual([...diff.removals], []);
});

test("emits removals without copying unchanged vectors", () => {
  const diff = diffWorkerSnapshot(
    vectors([1, 0], [0, 1]),
    documents(0, 1),
    vectors([1, 0], [0, 0]),
    documents(0, -1),
    2
  );

  assert.deepEqual([...diff.rows], []);
  assert.deepEqual([...diff.vectors], []);
  assert.deepEqual([...diff.documents], []);
  assert.deepEqual([...diff.removals], [1]);
});

test("returns an empty patch for unchanged snapshots", () => {
  const previousVectors = vectors([1, 0], [0, 1]);
  const previousDocuments = documents(0, 1);
  const diff = diffWorkerSnapshot(
    previousVectors,
    previousDocuments,
    new Float32Array(previousVectors),
    new Int32Array(previousDocuments),
    2
  );

  assert.deepEqual([...diff.rows], []);
  assert.deepEqual([...diff.removals], []);
});

test("handles capacity growth with inactive rows", () => {
  const diff = diffWorkerSnapshot(
    vectors([1, 0]),
    documents(0),
    vectors([1, 0], [0, 0], [0, 1]),
    documents(0, -1, 3),
    2
  );

  assert.equal(diff.capacity, 3);
  assert.deepEqual([...diff.rows], [2]);
  assert.deepEqual([...diff.vectors], [0, 1]);
  assert.deepEqual([...diff.documents], [3]);
});

test("rejects malformed snapshots", () => {
  assert.throws(() => diffWorkerSnapshot(
    new Float32Array([1]),
    documents(0),
    new Float32Array([1]),
    documents(0),
    2
  ));
  assert.throws(() => diffWorkerSnapshot(
    new Float32Array(),
    new Int32Array(),
    new Float32Array(),
    new Int32Array(),
    -1
  ));
});

test("settles an in-flight search when its worker generation becomes stale", async () => {
  const workerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  let created: FakeWorker | null = null;

  class FakeWorker {
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null;

    constructor() {
      created = this;
    }

    postMessage(): void {}
    terminate(): void {}
  }

  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    writable: true,
    value: FakeWorker
  });

  try {
    const worker = new SemanticSearchWorker();
    worker.update(vectors([1, 0]), documents(0), 2);
    const pending = worker.search(
      vectors([1, 0]),
      -1,
      1,
      new AbortController().signal
    );
    const rejected = assert.rejects(pending, /index changed during the request/u);

    worker.update(vectors([0, 1]), documents(0), 2);
    assert.ok(created);
    created.onmessage?.({
      data: {
        type: "result",
        id: 1,
        generation: 1,
        rows: documents(0),
        scores: new Float32Array([1])
      }
    } as MessageEvent<unknown>);

    await rejected;
    worker.dispose();
  } finally {
    if (workerDescriptor === undefined) {
      Reflect.deleteProperty(globalThis, "Worker");
    } else {
      Object.defineProperty(globalThis, "Worker", workerDescriptor);
    }
  }
});

function vectors(...rows: number[][]): Float32Array {
  return new Float32Array(rows.flat());
}

function documents(...values: number[]): Int32Array {
  return new Int32Array(values);
}
