import {
  BACKGROUND_BATCH_IDLE_MS,
  BACKGROUND_BATCH_SLICE_BUDGET_MS,
  DEFAULT_BACKGROUND_BATCH_SIZE,
  MAX_BACKGROUND_BATCH_SIZE
} from "../constants.ts";
import { semanticDiagnostics } from "../diagnostics/performance.ts";
import { isRecord } from "../utils/validation.ts";

export interface AdaptiveBatchSignals {
  queryPending: boolean;
  memoryPressure: boolean;
  now?: number;
}

export interface AdaptiveBatchSuccess {
  requestedSize: number;
  actualSize: number;
  durationMs: number;
  signals: AdaptiveBatchSignals;
}

export interface AdaptiveBatchPolicy {
  minimumSize: number;
  maximumSize: number;
  idleMs: number;
  sliceBudgetMs: number;
  fastSlicesToGrow: number;
  growthStep: number;
}

export interface AdaptiveBatchSnapshot {
  currentSize: number;
  learnedLimit: number;
  consecutiveFastSlices: number;
  idleForMs: number;
}

export interface AdaptiveEmbeddingBatchControllerOptions {
  learnedLimit?: number;
  policy?: Partial<AdaptiveBatchPolicy>;
  now?: () => number;
  onLearnedLimit?: (limit: number) => void;
}

const DEFAULT_POLICY: Readonly<AdaptiveBatchPolicy> = Object.freeze({
  minimumSize: DEFAULT_BACKGROUND_BATCH_SIZE,
  maximumSize: MAX_BACKGROUND_BATCH_SIZE,
  idleMs: BACKGROUND_BATCH_IDLE_MS,
  sliceBudgetMs: BACKGROUND_BATCH_SLICE_BUDGET_MS,
  fastSlicesToGrow: 2,
  growthStep: 2
});

export class AdaptiveEmbeddingBatchController {
  private readonly policy: AdaptiveBatchPolicy;
  private readonly now: () => number;
  private onLearnedLimit: ((limit: number) => void) | undefined;
  private currentSizeValue: number;
  private learnedLimitValue: number;
  private consecutiveFastSlicesValue = 0;
  private lastActivityAt: number;

  constructor(options: AdaptiveEmbeddingBatchControllerOptions = {}) {
    this.policy = resolvePolicy(options.policy);
    this.now = options.now ?? monotonicNow;
    this.onLearnedLimit = options.onLearnedLimit;
    this.learnedLimitValue = clampBatchSize(
      options.learnedLimit ?? this.policy.minimumSize,
      this.policy
    );
    this.currentSizeValue = this.policy.minimumSize;
    this.lastActivityAt = this.now();
  }

  get learnedLimit(): number {
    return this.learnedLimitValue;
  }

  markActivity(at = this.now()): void {
    if (!Number.isFinite(at)) {
      return;
    }
    this.lastActivityAt = at;
    this.returnToMinimum();
    semanticDiagnostics.increment("indexing.background_activity");
  }

  configurePersistence(
    learnedLimit: number,
    onLearnedLimit?: (limit: number) => void
  ): void {
    this.learnedLimitValue = clampBatchSize(learnedLimit, this.policy);
    this.onLearnedLimit = onLearnedLimit;
    this.returnToMinimum();
    this.lastActivityAt = this.now();
  }

  nextBatchSize(
    signals: AdaptiveBatchSignals,
    hardMaximum = this.policy.maximumSize
  ): number {
    const maximum = clampHardMaximum(hardMaximum, this.policy);
    const context = this.resolveSignals(signals);
    if (isConstrained(context, this.policy, this.lastActivityAt)) {
      this.returnToMinimum();
      return Math.min(this.policy.minimumSize, maximum);
    }

    if (this.currentSizeValue < this.learnedLimitValue) {
      this.currentSizeValue = Math.min(
        this.policy.maximumSize,
        this.learnedLimitValue,
        this.currentSizeValue + this.policy.growthStep * 2
      );
    }
    const selected = Math.min(maximum, this.currentSizeValue);
    semanticDiagnostics.setGauge("indexing.background_batch_selected", selected);
    semanticDiagnostics.setGauge(
      "indexing.background_batch_learned_limit",
      this.learnedLimitValue
    );
    return selected;
  }

  recordSuccess(outcome: AdaptiveBatchSuccess): void {
    validateOutcome(outcome);
    const context = this.resolveSignals(outcome.signals);
    semanticDiagnostics.record(
      "indexing.background_slice_duration_ms",
      outcome.durationMs
    );
    if (isConstrained(context, this.policy, this.lastActivityAt)) {
      this.returnToMinimum();
      semanticDiagnostics.increment("indexing.background_batch_constrained");
      return;
    }
    if (outcome.durationMs > this.policy.sliceBudgetMs) {
      this.reduceAfterSlowSlice(outcome.requestedSize);
      this.setLearnedLimit(this.currentSizeValue);
      semanticDiagnostics.increment("indexing.background_batch_reduced");
      return;
    }

    if (outcome.actualSize < outcome.requestedSize) {
      this.consecutiveFastSlicesValue = 0;
      return;
    }
    if (outcome.requestedSize > this.learnedLimitValue) {
      this.setLearnedLimit(outcome.requestedSize);
    }
    if (outcome.durationMs <= this.policy.sliceBudgetMs * 0.75) {
      this.consecutiveFastSlicesValue += 1;
      if (this.consecutiveFastSlicesValue >= this.policy.fastSlicesToGrow) {
        this.currentSizeValue = Math.min(
          this.policy.maximumSize,
          Math.max(this.currentSizeValue, outcome.requestedSize)
            + this.policy.growthStep
        );
        this.consecutiveFastSlicesValue = 0;
        semanticDiagnostics.increment("indexing.background_batch_grown");
      }
    } else {
      this.consecutiveFastSlicesValue = 0;
    }
  }

  recordFailure(): void {
    this.returnToMinimum();
    this.setLearnedLimit(this.policy.minimumSize);
    semanticDiagnostics.increment("indexing.background_batch_failure_reset");
  }

  resetTuning(): void {
    this.returnToMinimum();
    this.setLearnedLimit(this.policy.minimumSize);
    this.lastActivityAt = this.now();
    semanticDiagnostics.increment("indexing.background_tuning_reset");
  }

  snapshot(now = this.now()): AdaptiveBatchSnapshot {
    return {
      currentSize: this.currentSizeValue,
      learnedLimit: this.learnedLimitValue,
      consecutiveFastSlices: this.consecutiveFastSlicesValue,
      idleForMs: Math.max(0, now - this.lastActivityAt)
    };
  }

  private resolveSignals(signals: AdaptiveBatchSignals): Required<AdaptiveBatchSignals> {
    return {
      queryPending: signals.queryPending,
      memoryPressure: signals.memoryPressure,
      now: signals.now ?? this.now()
    };
  }

  private reduceAfterSlowSlice(requestedSize: number): void {
    this.currentSizeValue = Math.max(
      this.policy.minimumSize,
      Math.floor(Math.min(this.currentSizeValue, requestedSize) / 2)
    );
    this.consecutiveFastSlicesValue = 0;
  }

  private returnToMinimum(): void {
    this.currentSizeValue = this.policy.minimumSize;
    this.consecutiveFastSlicesValue = 0;
  }

  private setLearnedLimit(value: number): void {
    const limit = clampBatchSize(value, this.policy);
    if (limit === this.learnedLimitValue) {
      return;
    }
    this.learnedLimitValue = limit;
    this.onLearnedLimit?.(limit);
  }
}

export const backgroundEmbeddingBatches = new AdaptiveEmbeddingBatchController();

export function detectEmbeddingMemoryPressure(): boolean {
  const performanceValue = globalThis.performance;
  if (performanceValue === undefined) {
    return false;
  }
  const memory: unknown = Reflect.get(performanceValue, "memory");
  if (!isRecord(memory)) {
    return false;
  }
  const used = memory["usedJSHeapSize"];
  const limit = memory["jsHeapSizeLimit"];
  return typeof used === "number"
    && Number.isFinite(used)
    && typeof limit === "number"
    && Number.isFinite(limit)
    && limit > 0
    && used / limit >= 0.85;
}

function isConstrained(
  signals: Required<AdaptiveBatchSignals>,
  policy: AdaptiveBatchPolicy,
  lastActivityAt: number
): boolean {
  return signals.queryPending
    || signals.memoryPressure
    || Math.max(0, signals.now - lastActivityAt) < policy.idleMs;
}

function resolvePolicy(
  input: Partial<AdaptiveBatchPolicy> | undefined
): AdaptiveBatchPolicy {
  const policy = { ...DEFAULT_POLICY, ...input };
  if (
    !Number.isInteger(policy.minimumSize)
    || !Number.isInteger(policy.maximumSize)
    || policy.minimumSize < 1
    || policy.maximumSize < policy.minimumSize
    || !Number.isFinite(policy.idleMs)
    || policy.idleMs < 0
    || !Number.isFinite(policy.sliceBudgetMs)
    || policy.sliceBudgetMs <= 0
    || !Number.isInteger(policy.fastSlicesToGrow)
    || policy.fastSlicesToGrow < 1
    || !Number.isInteger(policy.growthStep)
    || policy.growthStep < 1
  ) {
    throw new Error("Adaptive embedding batch policy is invalid.");
  }
  return policy;
}

function clampBatchSize(value: number, policy: AdaptiveBatchPolicy): number {
  if (!Number.isFinite(value)) {
    return policy.minimumSize;
  }
  return Math.max(
    policy.minimumSize,
    Math.min(policy.maximumSize, Math.round(value))
  );
}

function clampHardMaximum(value: number, policy: AdaptiveBatchPolicy): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("Embedding hard maximum batch size must be a positive integer.");
  }
  return Math.min(policy.maximumSize, value);
}

function validateOutcome(outcome: AdaptiveBatchSuccess): void {
  if (
    !Number.isInteger(outcome.requestedSize)
    || outcome.requestedSize < 1
    || !Number.isInteger(outcome.actualSize)
    || outcome.actualSize < 1
    || outcome.actualSize > outcome.requestedSize
    || !Number.isFinite(outcome.durationMs)
    || outcome.durationMs < 0
  ) {
    throw new Error("Adaptive embedding batch outcome is invalid.");
  }
}

function monotonicNow(): number {
  return typeof globalThis.performance?.now === "function"
    ? globalThis.performance.now()
    : Date.now();
}
