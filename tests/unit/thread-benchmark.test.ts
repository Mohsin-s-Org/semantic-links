import assert from "node:assert/strict";
import test from "node:test";
import type { EmbeddingInput, EmbeddingOutput } from "../../src/indexing/types.ts";
import {
  runThreadBenchmark,
  type ThreadBenchmarkClient
} from "../../src/embeddings/thread-benchmark.ts";

test("benchmarks only approved candidates and disposes every client", async () => {
  const created: number[] = [];
  const disposed: number[] = [];
  const progress: string[] = [];

  const result = await runThreadBenchmark((threads) => {
    created.push(threads);
    return Promise.resolve(new FakeClient(() => disposed.push(threads)));
  }, 2, new AbortController().signal, {
    sampleCount: 3,
    onProgress: ({ threads, sample }) => progress.push(`${threads}:${sample}`)
  });

  assert.deepEqual(result.candidates, [0, 1, 2]);
  assert.deepEqual(created, [0, 1, 2]);
  assert.deepEqual(disposed, [0, 1, 2]);
  assert.equal(progress.length, 9);
  assert.ok(result.candidates.includes(result.decision.threads));
});

test("continues after one candidate fails", async () => {
  const created: number[] = [];
  const result = await runThreadBenchmark((threads) => {
    created.push(threads);
    if (threads === 1) {
      return Promise.reject(new Error("candidate failed"));
    }
    return Promise.resolve(new FakeClient());
  }, 4, new AbortController().signal);

  assert.deepEqual(created, [0, 1, 2, 4]);
  assert.equal(result.decision.threads, 0);
  assert.equal(
    result.decision.summaries.find((summary) => summary.threads === 1)?.stable,
    false
  );
});

test("cancels promptly and disposes the active candidate", async () => {
  const controller = new AbortController();
  let disposed = false;
  let queries = 0;

  await assert.rejects(
    runThreadBenchmark(() => Promise.resolve(new FakeClient(
      () => { disposed = true; },
      () => {
        queries += 1;
        controller.abort(new DOMException("cancelled", "AbortError"));
      }
    )), 4, controller.signal),
    /cancelled/u
  );

  assert.equal(queries, 1);
  assert.equal(disposed, true);
});

test("validates the repeated sample count", async () => {
  await assert.rejects(
    runThreadBenchmark(() => Promise.resolve(new FakeClient()), 2, new AbortController().signal, {
      sampleCount: 2
    }),
    /3 to 7/u
  );
});

class FakeClient implements ThreadBenchmarkClient {
  private readonly onDispose: () => void;
  private readonly onQuery: () => void;

  constructor(
    onDispose: () => void = () => undefined,
    onQuery: () => void = () => undefined
  ) {
    this.onDispose = onDispose;
    this.onQuery = onQuery;
  }

  embedQuery(): Promise<Float32Array> {
    this.onQuery();
    return Promise.resolve(new Float32Array([1, 0]));
  }

  embed(inputs: readonly EmbeddingInput[]): Promise<EmbeddingOutput[]> {
    return Promise.resolve(inputs.map((input) => ({
      id: input.id,
      vector: new Float32Array([1, 0])
    })));
  }

  dispose(): void {
    this.onDispose();
  }
}
