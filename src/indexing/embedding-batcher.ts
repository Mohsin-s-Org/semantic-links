import { semanticDiagnostics } from "../diagnostics/performance.ts";
import type {
  EmbeddingClient,
  EmbeddingInput,
  EmbeddingOutput
} from "./types.ts";

export interface EmbeddingBatchResult {
  vectorsById: Map<string, Float32Array>;
  dimensions: number;
}

export class EmbeddingBatcher {
  private readonly client: EmbeddingClient;
  private readonly batchSize: number;

  constructor(client: EmbeddingClient, batchSize = 4) {
    if (!Number.isInteger(batchSize) || batchSize < 1) {
      throw new Error("Embedding batch size must be a positive integer.");
    }
    this.client = client;
    this.batchSize = batchSize;
  }

  async embed(
    inputs: readonly EmbeddingInput[],
    signal: AbortSignal,
    onProgress?: (completed: number, total: number) => void
  ): Promise<EmbeddingBatchResult> {
    const finishTotal = semanticDiagnostics.startSpan("indexing.embedding_total_ms");
    const vectorsById = new Map<string, Float32Array>();
    const dimensions = this.client.descriptor.dimensions;
    semanticDiagnostics.setGauge("indexing.embedding_input_count", inputs.length);
    semanticDiagnostics.setGauge("indexing.embedding_batch_limit", this.batchSize);
    if (!Number.isInteger(dimensions) || dimensions < 1) {
      finishTotal();
      throw new Error("Embedding client dimensions are invalid.");
    }

    try {
      for (let start = 0; start < inputs.length; start += this.batchSize) {
        throwIfAborted(signal);
        const batch = inputs.slice(start, start + this.batchSize);
        const characters = batch.reduce((total, input) => total + input.text.length, 0);
        semanticDiagnostics.setGauge("indexing.embedding_batch_size", batch.length);
        semanticDiagnostics.setGauge("indexing.embedding_batch_characters", characters);
        const outputs = await semanticDiagnostics.measure("indexing.embedding_batch_ms", () => {
          return this.client.embed(batch, signal);
        });
        semanticDiagnostics.measureSync("indexing.embedding_validation_ms", () => {
          validateBatch(batch, outputs, dimensions, vectorsById);
        });
        onProgress?.(Math.min(inputs.length, start + batch.length), inputs.length);
        await semanticDiagnostics.measure("indexing.event_loop_yield_ms", yieldToEventLoop);
      }

      return { vectorsById, dimensions };
    } finally {
      semanticDiagnostics.setGauge("indexing.embedding_vector_count", vectorsById.size);
      semanticDiagnostics.setGauge(
        "indexing.embedding_vector_bytes",
        vectorsById.size * dimensions * Float32Array.BYTES_PER_ELEMENT
      );
      finishTotal();
    }
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
