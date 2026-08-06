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

  embed(
    inputs: readonly EmbeddingInput[],
    signal: AbortSignal
  ): Promise<EmbeddingOutput[]> {
    assert.equal(signal.aborted, false);
    this.batches.push(inputs.map((input) => input.id));
    return Promise.resolve(inputs.map((input) => ({
      id: input.id,
      vector: new Float32Array([
        input.text.length,
        input.id.codePointAt(0) ?? 0,
        1
      ])
    })));
  }

  dispose(): void {}
}

test("embeds equal-length inputs in bounded stable batches", async () => {
  const client = new RecordingClient();
  const progress: number[] = [];
  const result = await new EmbeddingBatcher(client, 2).embed(
    [
      { id: "a", text: "same" },
      { id: "b", text: "size" },
      { id: "c", text: "text" },
      { id: "d", text: "here" },
      { id: "e", text: "last" }
    ],
    new AbortController().signal,
    (completed) => progress.push(completed)
  );

  assert.deepEqual(client.batches, [["a", "b"], ["c", "d"], ["e"]]);
  assert.deepEqual(progress, [2, 4, 5]);
  assert.equal(result.dimensions, 3);
  assert.deepEqual([...result.vectorsById.keys()], ["a", "b", "c", "d", "e"]);
});

test("executes similar lengths together but returns original id order", async () => {
  const client = new RecordingClient();
  const inputs = [
    { id: "l", text: "x".repeat(90) },
    { id: "a", text: "x".repeat(4) },
    { id: "m", text: "x".repeat(40) },
    { id: "b", text: "x".repeat(6) }
  ];

  const result = await new EmbeddingBatcher(client, {
    maxBatchSize: 2,
    bucketWidth: 16,
    estimateTokens: (text) => text.length
  }).embed(inputs, new AbortController().signal);

  assert.deepEqual(client.batches, [["a", "b"], ["m"], ["l"]]);
  assert.deepEqual([...result.vectorsById.keys()], ["l", "a", "m", "b"]);
  assert.deepEqual([...result.vectorsById.get("l") ?? []], [90, 108, 1]);
});

test("falls back to current order when token estimates fail", async () => {
  const client = new RecordingClient();
  await new EmbeddingBatcher(client, {
    maxBatchSize: 2,
    estimateTokens: (text) => {
      if (text === "fail") {
        throw new Error("No tokenizer");
      }
      return text.length;
    }
  }).embed([
    { id: "a", text: "first" },
    { id: "b", text: "fail" },
    { id: "c", text: "last" }
  ], new AbortController().signal);

  assert.deepEqual(client.batches, [["a", "b"], ["c"]]);
});

test("rejects duplicate input ids before inference", async () => {
  const client = new RecordingClient();

  await assert.rejects(
    new EmbeddingBatcher(client).embed([
      { id: "same", text: "first" },
      { id: "same", text: "second" }
    ], new AbortController().signal),
    /duplicated/u
  );
  assert.deepEqual(client.batches, []);
});

test("rejects malformed vectors before they enter storage", async () => {
  const client = new RecordingClient();
  client.embed = (inputs) => Promise.resolve(inputs.map((input) => ({
    id: input.id,
    vector: new Float32Array([1, 2])
  })));

  await assert.rejects(
    new EmbeddingBatcher(client).embed(
      [{ id: "bad", text: "invalid" }],
      new AbortController().signal
    ),
    /expected 3/u
  );
});
