import assert from "node:assert/strict";
import test from "node:test";
import { EmbeddingBatcher } from "../../src/indexing/embedding-batcher.ts";
import type {
  EmbeddingClient,
  EmbeddingInput,
  EmbeddingOutput
} from "../../src/indexing/types.ts";

class RecordingClient implements EmbeddingClient {
  readonly descriptor = {
    id: "test/model",
    revision: "fixed",
    quantization: "q8",
    dimensions: 2,
    tokenizerVersion: "test",
    runtimeVersion: "test"
  };
  readonly batches: string[][] = [];

  estimateTokenLength(text: string): number {
    return text.length;
  }

  embed(
    inputs: readonly EmbeddingInput[],
    _signal: AbortSignal
  ): Promise<EmbeddingOutput[]> {
    this.batches.push(inputs.map(({ id }) => id));
    return Promise.resolve(inputs.map((input) => ({
      id: input.id,
      vector: new Float32Array([input.text.length, 1])
    })));
  }

  dispose(): void {}
}

test("executes similar lengths together and preserves every output id", async () => {
  const client = new RecordingClient();
  const inputs = [
    { id: "long", text: "x".repeat(90) },
    { id: "short-a", text: "x".repeat(4) },
    { id: "medium", text: "x".repeat(40) },
    { id: "short-b", text: "x".repeat(6) }
  ];
  const progress: number[] = [];

  const result = await new EmbeddingBatcher(client, 2, 16).embed(
    inputs,
    new AbortController().signal,
    (completed) => progress.push(completed)
  );

  assert.deepEqual(client.batches, [
    ["short-a", "short-b"],
    ["medium", "long"]
  ]);
  assert.deepEqual(progress, [2, 4]);
  assert.deepEqual([...result.vectorsById.keys()].sort(), [
    "long",
    "medium",
    "short-a",
    "short-b"
  ]);
  assert.deepEqual([...result.vectorsById.get("long") ?? []], [90, 1]);
});
