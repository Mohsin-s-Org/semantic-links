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
    quantization: "test",
    dimensions: 3,
    tokenizerVersion: "test",
    runtimeVersion: "test"
  };
  readonly batches: string[][] = [];

  async embed(
    inputs: readonly EmbeddingInput[],
    signal: AbortSignal
  ): Promise<EmbeddingOutput[]> {
    assert.equal(signal.aborted, false);
    this.batches.push(inputs.map((input) => input.id));
    return inputs.map((input, index) => ({
      id: input.id,
      vector: new Float32Array([index + 1, input.text.length, 1])
    }));
  }

  dispose(): void {}
}

test("embeds inputs in bounded batches and preserves ids", async () => {
  const client = new RecordingClient();
  const progress: number[] = [];
  const result = await new EmbeddingBatcher(client, 2).embed(
    [
      { id: "a", text: "first" },
      { id: "b", text: "second" },
      { id: "c", text: "third" },
      { id: "d", text: "fourth" },
      { id: "e", text: "fifth" }
    ],
    new AbortController().signal,
    (completed) => progress.push(completed)
  );

  assert.deepEqual(client.batches, [["a", "b"], ["c", "d"], ["e"]]);
  assert.deepEqual(progress, [2, 4, 5]);
  assert.equal(result.dimensions, 3);
  assert.deepEqual([...result.vectorsById.keys()], ["a", "b", "c", "d", "e"]);
});

test("rejects malformed vectors before they enter storage", async () => {
  const client = new RecordingClient();
  client.embed = async (inputs) => inputs.map((input) => ({
    id: input.id,
    vector: new Float32Array([1, 2])
  }));

  await assert.rejects(
    new EmbeddingBatcher(client).embed(
      [{ id: "bad", text: "invalid" }],
      new AbortController().signal
    ),
    /expected 3/u
  );
});
