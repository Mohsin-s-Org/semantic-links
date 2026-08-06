import type { EmbeddingInput } from "./types.ts";

export interface PlannedEmbeddingInput {
  input: EmbeddingInput;
  originalIndex: number;
  estimatedTokens: number;
  bucket: number;
}

export interface EmbeddingBatchPlan {
  batches: PlannedEmbeddingInput[][];
  estimatedTokens: number;
  paddedTokens: number;
}

export interface EmbeddingBatchPlanningOptions {
  batchSize: number;
  bucketWidth: number;
  estimateTokens?: (text: string) => number;
}

export function planEmbeddingBatches(
  inputs: readonly EmbeddingInput[],
  options: EmbeddingBatchPlanningOptions
): EmbeddingBatchPlan {
  validateOptions(options);
  const estimate = options.estimateTokens ?? estimateMultilingualTokenLength;
  const planned = inputs.map((input, originalIndex) => {
    const estimatedTokens = normalizeEstimate(estimate(input.text));
    return {
      input,
      originalIndex,
      estimatedTokens,
      bucket: Math.floor((estimatedTokens - 1) / options.bucketWidth)
    };
  }).sort((left, right) => {
    return left.bucket - right.bucket
      || left.estimatedTokens - right.estimatedTokens
      || left.originalIndex - right.originalIndex;
  });

  const batches: PlannedEmbeddingInput[][] = [];
  let estimatedTokens = 0;
  let paddedTokens = 0;
  for (let start = 0; start < planned.length; start += options.batchSize) {
    const batch = planned.slice(start, start + options.batchSize);
    batches.push(batch);
    const longest = batch.reduce(
      (maximum, item) => Math.max(maximum, item.estimatedTokens),
      0
    );
    for (const item of batch) {
      estimatedTokens += item.estimatedTokens;
      paddedTokens += longest;
    }
  }
  return { batches, estimatedTokens, paddedTokens };
}

/**
 * Cheap multilingual estimate used only for padding-aware ordering.
 * Exact model limits and chunking remain the responsibility of tokenizer-aware
 * issue #19. UTF-8 bytes correlate better with multilingual subword work than
 * JavaScript character or whitespace counts and require no second tokenisation.
 */
export function estimateMultilingualTokenLength(text: string): number {
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes === 0) {
    return 1;
  }
  const punctuation = text.match(/[\p{P}\p{S}]/gu)?.length ?? 0;
  return Math.max(1, Math.ceil(bytes / 4) + Math.ceil(punctuation / 4));
}

function validateOptions(options: EmbeddingBatchPlanningOptions): void {
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1) {
    throw new Error("Embedding batch size must be a positive integer.");
  }
  if (!Number.isInteger(options.bucketWidth) || options.bucketWidth < 1) {
    throw new Error("Embedding length bucket width must be a positive integer.");
  }
}

function normalizeEstimate(value: number): number {
  if (!Number.isFinite(value) || value < 1) {
    return 1;
  }
  return Math.max(1, Math.ceil(value));
}
