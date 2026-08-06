import { semanticDiagnostics } from "../diagnostics/performance.ts";
import {
  EmbeddingBatchQueue,
  estimateMultilingualTokenLength,
  fixedOrderPaddedTokens,
  type EmbeddingTokenEstimator
} from "./embedding-batch-planner.ts";
import type {
  EmbeddingClient,
  EmbeddingInput,
  EmbeddingOutput
} from "./types.ts";

export interface EmbeddingBatchResult {
  vectorsById: Map<string, Float32Array>;
  dimensions: number;
}

export interface EmbeddingBatcherOptions {
  maxBatchSize?: number;
  bucketWidth?: number;
  estimateTokens?: EmbeddingTokenEstimator;
}

const DEFAULT_BATCH_SIZE = 4;
const DEFAULT_BUCKET_WIDTH = 32;

export class EmbeddingBatcher {
  private readonly client: EmbeddingClient;
  private readonly maxBatchSize: number;
  private readonly bucketWidth: number;
  private readonly estimateTokens: EmbeddingTokenEstimator;

  constructor(
    client: EmbeddingClient,
    options: number | EmbeddingBatcherOptions = DEFAULT_BATCH_SIZE
  ) {
    const resolved = typeof options === "number"
      ? { maxBatchSize: options }
      : options;
    const maxBatchSize = resolved.maxBatchSize ?? DEFAULT_BATCH_SIZE;
    const bucketWidth = resolved.bucketWidth ?? DEFAULT_BUCKET_WIDTH;
    if (!Number.isInteger(maxBatchSize) || maxBatchSize < 1) {
      throw new Error("Embedding batch size must be a positive integer.");
    }
    if (!Number.isInteger(bucketWidth) || bucketWidth < 1) {
      throw new Error("Embedding length bucket width must be a positive integer.");
    }
    this.client = client;
    this.maxBatchSize = maxBatchSize;
    this.bucketWidth = bucketWidth;
    this.estimateTokens = resolved.estimateTokens ?? estimateMultilingualTokenLength;
  }

  async embed(
    inputs: readonly EmbeddingInput[],
    signal: AbortSignal,
    onProgress?: (completed: number, total: number) => void
  ): Promise<EmbeddingBatchResult> {
    const finishTotal = semanticDiagnostics.startSpan("indexing.embedding_total_ms");
    const unorderedVectors = new Map<string, Float32Array>();
    const dimensions = this.client.descriptor.dimensions;
    validateInputIds(inputs);
    const queue = new EmbeddingBatchQueue(inputs, {
      bucketWidth: this.bucketWidth,
      estimateTokens: this.estimateTokens
    });
    const fixedPadding = safeFixedOrderPadding(
      inputs,
      this.maxBatchSize,
      this.estimateTokens
    );
    let completed = 0;
    let plannedPadding = 0;

    semanticDiagnostics.setGauge("indexing.embedding_input_count", inputs.length);
    semanticDiagnostics.setGauge("indexing.embedding_batch_limit", this.maxBatchSize);
    semanticDiagnostics.setGauge(
      "indexing.embedding_estimated_tokens",
      queue.stats.estimatedTokens
    );
    semanticDiagnostics.setGauge("indexing.embedding_bucket_count", queue.stats.bucketCount);
    semanticDiagnostics.setGauge(
      "indexing.embedding_length_buckets_used",
      queue.stats.usedLengthBuckets ? 1 : 0
    );
    semanticDiagnostics.setGauge("indexing.embedding_fixed_padded_tokens", fixedPadding);
    if (!Number.isInteger(dimensions) || dimensions < 1) {
      finishTotal();
      throw new Error("Embedding client dimensions are invalid.");
    }

    try {
      for (
        let planned = queue.take(this.maxBatchSize);
        planned !== null;
        planned = queue.take(this.maxBatchSize)
      ) {
        throwIfAborted(signal);
        const batch = planned.items.map(({ input }) => input);
        const characters = batch.reduce((total, input) => total + input.text.length, 0);
        plannedPadding += planned.paddedTokens;
        semanticDiagnostics.setGauge("indexing.embedding_batch_size", batch.length);
        semanticDiagnostics.setGauge("indexing.embedding_batch_characters", characters);
        semanticDiagnostics.setGauge(
          "indexing.embedding_batch_estimated_tokens",
          planned.estimatedTokens
        );
        semanticDiagnostics.setGauge(
          "indexing.embedding_batch_max_tokens",
          planned.maxEstimatedTokens
        );
        semanticDiagnostics.setGauge(
          "indexing.embedding_batch_padded_tokens",
          planned.paddedTokens
        );
        const outputs = await semanticDiagnostics.measure("indexing.embedding_batch_ms", () => {
          return this.client.embed(batch, signal);
        });
        semanticDiagnostics.measureSync("indexing.embedding_validation_ms", () => {
          validateBatch(batch, outputs, dimensions, unorderedVectors);
        });
        completed += batch.length;
        onProgress?.(completed, inputs.length);
        await semanticDiagnostics.measure("indexing.event_loop_yield_ms", yieldToEventLoop);
      }

      const vectorsById = orderVectors(inputs, unorderedVectors);
      semanticDiagnostics.setGauge(
        "indexing.embedding_bucketed_padded_tokens",
        plannedPadding
      );
      semanticDiagnostics.setGauge(
        "indexing.embedding_estimated_padding_saved",
        Math.max(0, fixedPadding - plannedPadding)
      );
      return { vectorsById, dimensions };
    } finally {
      semanticDiagnostics.setGauge(
        "indexing.embedding_vector_count",
        unorderedVectors.size
      );
      semanticDiagnostics.setGauge(
        "indexing.embedding_vector_bytes",
        unorderedVectors.size * dimensions * Float32Array.BYTES_PER_ELEMENT
      );
      finishTotal();
    }
  }
}

function validateInputIds(inputs: readonly EmbeddingInput[]): void {
  const ids = new Set<string>();
  for (const input of inputs) {
    if (input.id.length === 0 || ids.has(input.id)) {
      throw new Error(`Embedding input id is empty or duplicated: ${input.id}`);
    }
    ids.add(input.id);
  }
}

function validateBatch(
  inputs: readonly EmbeddingInput[],
  outputs: readonly EmbeddingOutput[],
  dimensions: number,
  destination: Map<string, Float32Array>
): void {
  if (outputs.length !== inputs.length) {
    throw new Error("Embedding client returned an unexpected number of vectors.");
  }
  const expectedIds = new Set(inputs.map((input) => input.id));
  for (const output of outputs) {
    if (!expectedIds.delete(output.id) || destination.has(output.id)) {
      throw new Error(`Embedding client returned an unexpected id: ${output.id}`);
    }
    if (output.vector.length !== dimensions) {
      throw new Error(`Embedding ${output.id} has ${output.vector.length} dimensions; expected ${dimensions}.`);
    }
    for (const value of output.vector) {
      if (!Number.isFinite(value)) {
        throw new Error(`Embedding ${output.id} contains a non-finite value.`);
      }
    }
    destination.set(output.id, new Float32Array(output.vector));
  }
  if (expectedIds.size > 0) {
    throw new Error("Embedding client omitted one or more requested ids.");
  }
}

function orderVectors(
  inputs: readonly EmbeddingInput[],
  vectors: ReadonlyMap<string, Float32Array>
): Map<string, Float32Array> {
  const ordered = new Map<string, Float32Array>();
  for (const input of inputs) {
    const vector = vectors.get(input.id);
    if (vector === undefined) {
      throw new Error(`Embedding client omitted the requested id: ${input.id}`);
    }
    ordered.set(input.id, vector);
  }
  return ordered;
}

function safeFixedOrderPadding(
  inputs: readonly EmbeddingInput[],
  batchSize: number,
  estimateTokens: EmbeddingTokenEstimator
): number {
  try {
    return fixedOrderPaddedTokens(inputs, batchSize, estimateTokens);
  } catch {
    return inputs.length;
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("The embedding request was aborted.", "AbortError");
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });
}
