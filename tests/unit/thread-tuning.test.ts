import assert from "node:assert/strict";
import test from "node:test";
import {
  approvedThreadCandidates,
  classifyThreadDevice,
  isThreadTuningCompatible,
  selectThreadTuning,
  type ThreadCandidateSamples
} from "../../src/embeddings/thread-tuning.ts";

test("caps approved candidates by hardware concurrency", () => {
  assert.deepEqual(approvedThreadCandidates(undefined), [0, 1]);
  assert.deepEqual(approvedThreadCandidates(1), [0, 1]);
  assert.deepEqual(approvedThreadCandidates(2), [0, 1, 2]);
  assert.deepEqual(approvedThreadCandidates(4), [0, 1, 2, 4]);
  assert.deepEqual(approvedThreadCandidates(32), [0, 1, 2, 4]);
});

test("uses coarse device classes without hardware identifiers", () => {
  assert.equal(classifyThreadDevice(undefined), "unknown");
  assert.equal(classifyThreadDevice(2), "1-2");
  assert.equal(classifyThreadDevice(4), "3-4");
  assert.equal(classifyThreadDevice(8), "5-8");
  assert.equal(classifyThreadDevice(12), "9+");
});

test("requires exact model runtime and device-class compatibility", () => {
  const current = {
    modelRevision: "model-a",
    runtimeVersion: "runtime-a",
    deviceClass: "5-8" as const
  };

  assert.equal(isThreadTuningCompatible(current, current), true);
  assert.equal(isThreadTuningCompatible(null, current), false);
  assert.equal(isThreadTuningCompatible({ ...current, modelRevision: "model-b" }, current), false);
  assert.equal(isThreadTuningCompatible({ ...current, runtimeVersion: "runtime-b" }, current), false);
  assert.equal(isThreadTuningCompatible({ ...current, deviceClass: "3-4" }, current), false);
});

test("selects a stable material improvement", () => {
  const decision = selectThreadTuning([
    candidate(0, [100, 102, 98, 101, 99], [200, 204, 198, 202, 201]),
    candidate(1, [96, 97, 95, 96, 98], [198, 200, 197, 199, 198]),
    candidate(2, [82, 84, 81, 83, 82], [175, 178, 174, 176, 175]),
    candidate(4, [90, 92, 89, 91, 90], [160, 164, 159, 162, 161])
  ]);

  assert.equal(decision.threads, 2);
  assert.equal(decision.reason, "improved");
});

test("keeps automatic when differences are within noise", () => {
  const decision = selectThreadTuning([
    candidate(0, [100, 101, 99], [200, 202, 198]),
    candidate(1, [99, 100, 98], [199, 201, 198]),
    candidate(2, [98, 99, 97], [198, 200, 197])
  ]);

  assert.equal(decision.threads, 0);
  assert.equal(decision.reason, "automatic-within-noise");
});

test("rejects a query improvement that materially worsens batches", () => {
  const decision = selectThreadTuning([
    candidate(0, [100, 101, 99], [200, 202, 198]),
    candidate(2, [75, 76, 74], [250, 252, 248])
  ]);

  assert.equal(decision.threads, 0);
  assert.equal(decision.reason, "inconclusive");
});

test("falls back to automatic for missing or unstable baseline samples", () => {
  const missing = selectThreadTuning([
    candidate(1, [80, 81, 79], [160, 161, 159])
  ]);
  const unstable = selectThreadTuning([
    candidate(0, [10, 11, 100], [20, 21, 200]),
    candidate(1, [8, 9, 8], [18, 19, 18])
  ]);

  assert.equal(missing.reason, "inconclusive");
  assert.equal(missing.threads, 0);
  assert.equal(unstable.reason, "inconclusive");
  assert.equal(unstable.threads, 0);
});

test("rejects unsupported thread candidates", () => {
  assert.throws(() => selectThreadTuning([{
    threads: 3 as never,
    queryMs: [1, 1, 1],
    batchMs: [1, 1, 1]
  }]));
});

function candidate(
  threads: 0 | 1 | 2 | 4,
  queryMs: number[],
  batchMs: number[]
): ThreadCandidateSamples {
  return { threads, queryMs, batchMs };
}
