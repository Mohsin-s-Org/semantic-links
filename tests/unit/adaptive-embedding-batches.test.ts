import assert from "node:assert/strict";
import test from "node:test";
import {
  AdaptiveEmbeddingBatchController,
  type AdaptiveBatchSignals
} from "../../src/indexing/adaptive-embedding-batches.ts";

const IDLE: AdaptiveBatchSignals = {
  queryPending: false,
  memoryPressure: false,
  now: 200
};

const POLICY = {
  minimumSize: 2,
  maximumSize: 8,
  idleMs: 100,
  sliceBudgetMs: 100,
  fastSlicesToGrow: 2,
  growthStep: 2
} as const;

test("uses the conservative size during recent activity", () => {
  let now = 0;
  const controller = createController(() => now, 8);

  now = 50;
  assert.equal(controller.nextBatchSize(signals(now)), 2);
  controller.markActivity(now);
  now = 120;
  assert.equal(controller.nextBatchSize(signals(now)), 2);
  assert.equal(controller.snapshot(now).idleForMs, 70);
});

test("uses a proven idle limit gradually", () => {
  const controller = createController(() => 200, 8);

  assert.equal(controller.nextBatchSize(IDLE), 6);
  assert.equal(controller.nextBatchSize(IDLE), 8);
  assert.equal(controller.nextBatchSize(IDLE, 7), 7);
});

test("returns immediately to minimum for queries or memory pressure", () => {
  const controller = createController(() => 200, 8);
  assert.equal(controller.nextBatchSize(IDLE), 6);

  assert.equal(controller.nextBatchSize({ ...IDLE, queryPending: true }), 2);
  assert.equal(controller.snapshot(200).currentSize, 2);
  assert.equal(controller.nextBatchSize({ ...IDLE, memoryPressure: true }), 2);
  assert.equal(controller.learnedLimit, 8);
});

test("grows after consecutive fast full slices and persists proven sizes", () => {
  const persisted: number[] = [];
  const controller = createController(() => 200, 2, (limit) => persisted.push(limit));

  assert.equal(controller.nextBatchSize(IDLE), 2);
  controller.recordSuccess(outcome(2, 2, 50));
  controller.recordSuccess(outcome(2, 2, 50));
  assert.equal(controller.nextBatchSize(IDLE), 4);
  controller.recordSuccess(outcome(4, 4, 50));

  assert.equal(controller.learnedLimit, 4);
  assert.deepEqual(persisted, [4]);
});

test("does not train growth from a partial final bucket", () => {
  const controller = createController(() => 200, 2);

  controller.recordSuccess(outcome(2, 2, 40));
  controller.recordSuccess(outcome(2, 1, 40));

  assert.equal(controller.snapshot(200).consecutiveFastSlices, 0);
  assert.equal(controller.nextBatchSize(IDLE), 2);
});

test("slow slices reduce and persist the safe limit", () => {
  const persisted: number[] = [];
  const controller = createController(() => 200, 8, (limit) => persisted.push(limit));
  const requested = controller.nextBatchSize(IDLE);
  assert.equal(requested, 6);

  controller.recordSuccess(outcome(requested, requested, 120));

  assert.equal(controller.snapshot(200).currentSize, 3);
  assert.equal(controller.learnedLimit, 3);
  assert.deepEqual(persisted, [3]);
  assert.equal(controller.nextBatchSize(IDLE), 3);
});

test("activity appearing during a slice constrains the next batch", () => {
  const controller = createController(() => 200, 8);
  const requested = controller.nextBatchSize(IDLE);

  controller.recordSuccess(outcome(requested, requested, 40, {
    ...IDLE,
    queryPending: true
  }));

  assert.equal(controller.snapshot(200).currentSize, 2);
  assert.equal(controller.learnedLimit, 8);
});

test("failures and manual reset return persisted tuning to minimum", () => {
  const persisted: number[] = [];
  const controller = createController(() => 200, 8, (limit) => persisted.push(limit));

  controller.recordFailure();
  assert.equal(controller.learnedLimit, 2);
  assert.equal(controller.snapshot(200).currentSize, 2);

  controller.configurePersistence(8, (limit) => persisted.push(limit));
  controller.resetTuning();
  assert.equal(controller.learnedLimit, 2);
  assert.deepEqual(persisted, [2, 2]);
});

test("respects hard maximums below the conservative size", () => {
  const controller = createController(() => 200, 8);

  assert.equal(controller.nextBatchSize(IDLE, 1), 1);
  assert.throws(() => controller.nextBatchSize(IDLE, 0));
});

test("validates policies and slice outcomes", () => {
  assert.throws(() => new AdaptiveEmbeddingBatchController({
    policy: { minimumSize: 0 }
  }));
  const controller = createController(() => 200, 2);
  assert.throws(() => controller.recordSuccess({
    requestedSize: 2,
    actualSize: 3,
    durationMs: 1,
    signals: IDLE
  }));
});

function createController(
  now: () => number,
  learnedLimit: number,
  onLearnedLimit?: (limit: number) => void
): AdaptiveEmbeddingBatchController {
  return new AdaptiveEmbeddingBatchController({
    learnedLimit,
    now,
    onLearnedLimit,
    policy: POLICY
  });
}

function outcome(
  requestedSize: number,
  actualSize: number,
  durationMs: number,
  signalsValue: AdaptiveBatchSignals = IDLE
) {
  return {
    requestedSize,
    actualSize,
    durationMs,
    signals: signalsValue
  };
}

function signals(now: number): AdaptiveBatchSignals {
  return {
    queryPending: false,
    memoryPressure: false,
    now
  };
}
