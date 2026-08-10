import type { EmbeddingInput } from "./types.ts";

export type EmbeddingTokenEstimator = (text: string) => number;

export interface PlannedEmbeddingInput {
  input: EmbeddingInput;
  originalIndex: number;
  estimatedTokens: number;
  bucket: number;
}

export interface PlannedEmbeddingBatch {
  items: PlannedEmbeddingInput[];
  estimatedTokens: number;
  maxEstimatedTokens: number;
  paddedTokens: number;
}

export interface EmbeddingBatchQueueOptions {
  bucketWidth?: number;
  estimateTokens?: EmbeddingTokenEstimator;
}

export interface EmbeddingBatchQueueStats {
  inputCount: number;
  estimatedTokens: number;
  bucketCount: number;
  usedLengthBuckets: boolean;
}

const DEFAULT_BUCKET_WIDTH = 32;
const textEncoder = new TextEncoder();

/**
 * Deterministic queue shared by fixed and adaptive background batching.
 * Batches never cross a length bucket, so a long passage cannot force short
 * passages in another bucket to pad to its sequence length.
 */
export class EmbeddingBatchQueue {
  private readonly buckets: PlannedEmbeddingInput[][];
  private bucketIndex = 0;
  private remainingValue: number;
  readonly stats: EmbeddingBatchQueueStats;

  constructor(
    inputs: readonly EmbeddingInput[],
    options: EmbeddingBatchQueueOptions = {}
  ) {
    const bucketWidth = options.bucketWidth ?? DEFAULT_BUCKET_WIDTH;
    if (!Number.isInteger(bucketWidth) || bucketWidth < 1) {
      throw new Error("Embedding length bucket width must be a positive integer.");
    }

    const estimate = options.estimateTokens ?? estimateMultilingualTokenLength;
    const planned = planInputs(inputs, bucketWidth, estimate);
    this.buckets = planned.buckets;
    this.remainingValue = inputs.length;
    this.stats = {
      inputCount: inputs.length,
      estimatedTokens: planned.estimatedTokens,
      bucketCount: planned.buckets.length,
      usedLengthBuckets: planned.usedLengthBuckets
    };
  }

  get remaining(): number {
    return this.remainingValue;
  }

  take(maxBatchSize: number): PlannedEmbeddingBatch | null {
    if (!Number.isInteger(maxBatchSize) || maxBatchSize < 1) {
      throw new Error("Embedding batch size must be a positive integer.");
    }
    while (this.bucketIndex < this.buckets.length) {
      const bucket = this.buckets[this.bucketIndex];
      if (bucket === undefined || bucket.length === 0) {
        this.bucketIndex += 1;
        continue;
      }
      const items = bucket.splice(0, maxBatchSize);
      this.remainingValue -= items.length;
      if (bucket.length === 0) {
        this.bucketIndex += 1;
      }
      return summarizeBatch(items);
    }
    return null;
  }
}

export function estimateMultilingualTokenLength(text: string): number {
  if (text.length === 0) {
    return 1;
  }
  const bytes = textEncoder.encode(text).byteLength;
  const wordLike = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  const symbols = text.match(/[\p{P}\p{S}]/gu)?.length ?? 0;
  const wordPieces = wordLike.reduce((total, value) => {
    return total + Math.max(1, Math.ceil(textEncoder.encode(value).byteLength / 4));
  }, 0);
  return Math.max(1, wordPieces + symbols + Math.ceil(bytes / 32));
}

export function fixedOrderPaddedTokens(
  inputs: readonly EmbeddingInput[],
  batchSize: number,
  estimateTokens: EmbeddingTokenEstimator = estimateMultilingualTokenLength
): number {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error("Embedding batch size must be a positive integer.");
  }
  let paddedTokens = 0;
  for (let start = 0; start < inputs.length; start += batchSize) {
    const estimates = inputs
      .slice(start, start + batchSize)
      .map((input) => normalizeEstimate(estimateTokens(input.text)));
    const longest = Math.max(0, ...estimates);
    paddedTokens += longest * estimates.length;
  }
  return paddedTokens;
}

function planInputs(
  inputs: readonly EmbeddingInput[],
  bucketWidth: number,
  estimate: EmbeddingTokenEstimator
): {
  buckets: PlannedEmbeddingInput[][];
  estimatedTokens: number;
  usedLengthBuckets: boolean;
} {
  const items: PlannedEmbeddingInput[] = [];
  let estimatedTokens = 0;
  try {
    inputs.forEach((input, originalIndex) => {
      const estimateValue = estimate(input.text);
      if (!Number.isFinite(estimateValue) || estimateValue < 1) {
        throw new Error("Embedding token length is unavailable.");
      }
      const tokens = Math.ceil(estimateValue);
      estimatedTokens += tokens;
      items.push({
        input,
        originalIndex,
        estimatedTokens: tokens,
        bucket: Math.floor((tokens - 1) / bucketWidth)
      });
    });
  } catch {
    return {
      buckets: inputs.length === 0
        ? []
        : [inputs.map((input, originalIndex) => ({
            input,
            originalIndex,
            estimatedTokens: 1,
            bucket: 0
          }))],
      estimatedTokens: inputs.length,
      usedLengthBuckets: false
    };
  }

  const grouped = new Map<number, PlannedEmbeddingInput[]>();
  for (const item of items) {
    const bucket = grouped.get(item.bucket) ?? [];
    bucket.push(item);
    grouped.set(item.bucket, bucket);
  }
  const buckets = [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, bucket]) => bucket.sort((left, right) => {
      return left.estimatedTokens - right.estimatedTokens
        || left.originalIndex - right.originalIndex;
    }));
  return { buckets, estimatedTokens, usedLengthBuckets: true };
}

function summarizeBatch(items: PlannedEmbeddingInput[]): PlannedEmbeddingBatch {
  const estimatedTokens = items.reduce(
    (total, item) => total + item.estimatedTokens,
    0
  );
  const maxEstimatedTokens = items.reduce(
    (maximum, item) => Math.max(maximum, item.estimatedTokens),
    0
  );
  return {
    items,
    estimatedTokens,
    maxEstimatedTokens,
    paddedTokens: maxEstimatedTokens * items.length
  };
}

function normalizeEstimate(value: number): number {
  return Number.isFinite(value) && value >= 1 ? Math.ceil(value) : 1;
}
