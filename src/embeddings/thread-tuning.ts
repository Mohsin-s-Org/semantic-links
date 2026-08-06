export type WasmThreadCount = 0 | 1 | 2 | 4;
export type ThreadDeviceClass = "unknown" | "1-2" | "3-4" | "5-8" | "9+";

export interface ThreadTuningIdentity {
  modelRevision: string;
  runtimeVersion: string;
  deviceClass: ThreadDeviceClass;
}

export interface ThreadCandidateSamples {
  threads: WasmThreadCount;
  queryMs: number[];
  batchMs: number[];
}

export interface ThreadLatencySummary {
  count: number;
  p50: number;
  p95: number;
}

export interface ThreadCandidateSummary {
  threads: WasmThreadCount;
  query: ThreadLatencySummary;
  batch: ThreadLatencySummary;
  stable: boolean;
}

export interface ThreadTuningDecision {
  threads: WasmThreadCount;
  reason: "improved" | "automatic-within-noise" | "inconclusive";
  summaries: ThreadCandidateSummary[];
}

const MINIMUM_SAMPLES = 3;
const MAX_VARIABILITY_RATIO = 2.5;
const REQUIRED_WEIGHTED_IMPROVEMENT = 0.03;

export function approvedThreadCandidates(
  hardwareConcurrency: number | undefined
): WasmThreadCount[] {
  const candidates: WasmThreadCount[] = [0, 1];
  if (!Number.isFinite(hardwareConcurrency)) {
    return candidates;
  }
  const cores = Math.max(1, Math.floor(hardwareConcurrency ?? 1));
  if (cores >= 2) {
    candidates.push(2);
  }
  if (cores >= 4) {
    candidates.push(4);
  }
  return candidates;
}

export function classifyThreadDevice(
  hardwareConcurrency: number | undefined
): ThreadDeviceClass {
  if (!Number.isFinite(hardwareConcurrency)) {
    return "unknown";
  }
  const cores = Math.max(1, Math.floor(hardwareConcurrency ?? 1));
  if (cores <= 2) return "1-2";
  if (cores <= 4) return "3-4";
  if (cores <= 8) return "5-8";
  return "9+";
}

export function isThreadTuningCompatible(
  stored: ThreadTuningIdentity | null,
  current: ThreadTuningIdentity
): boolean {
  return stored !== null
    && stored.modelRevision === current.modelRevision
    && stored.runtimeVersion === current.runtimeVersion
    && stored.deviceClass === current.deviceClass;
}

export function selectThreadTuning(
  samples: readonly ThreadCandidateSamples[]
): ThreadTuningDecision {
  const summaries = samples
    .map(summarizeCandidate)
    .sort((left, right) => left.threads - right.threads);
  const baseline = summaries.find((summary) => summary.threads === 0);
  if (baseline === undefined || !baseline.stable) {
    return { threads: 0, reason: "inconclusive", summaries };
  }

  const eligible = summaries.filter((candidate) => {
    if (candidate.threads === 0 || !candidate.stable) {
      return false;
    }
    return candidate.query.p50 <= baseline.query.p50 * 1.05
      && candidate.query.p95 <= baseline.query.p95 * 1.10
      && candidate.batch.p50 <= baseline.batch.p50 * 1.10
      && candidate.batch.p95 <= baseline.batch.p95 * 1.15;
  });
  const ranked = eligible
    .map((candidate) => ({
      candidate,
      score: weightedScore(candidate, baseline)
    }))
    .sort((left, right) => left.score - right.score
      || left.candidate.threads - right.candidate.threads);
  const best = ranked[0];
  if (best === undefined) {
    return { threads: 0, reason: "inconclusive", summaries };
  }
  if (best.score > 1 - REQUIRED_WEIGHTED_IMPROVEMENT) {
    return { threads: 0, reason: "automatic-within-noise", summaries };
  }
  return {
    threads: best.candidate.threads,
    reason: "improved",
    summaries
  };
}

function summarizeCandidate(
  samples: ThreadCandidateSamples
): ThreadCandidateSummary {
  validateThreadCount(samples.threads);
  const query = summarizeLatency(samples.queryMs);
  const batch = summarizeLatency(samples.batchMs);
  return {
    threads: samples.threads,
    query,
    batch,
    stable: isStable(query) && isStable(batch)
  };
}

function summarizeLatency(values: readonly number[]): ThreadLatencySummary {
  const valid = values.filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);
  return {
    count: valid.length,
    p50: percentile(valid, 0.5),
    p95: percentile(valid, 0.95)
  };
}

function percentile(sorted: readonly number[], percentileValue: number): number {
  if (sorted.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(percentileValue * sorted.length) - 1)
  );
  return sorted[index] ?? Number.POSITIVE_INFINITY;
}

function isStable(summary: ThreadLatencySummary): boolean {
  return summary.count >= MINIMUM_SAMPLES
    && Number.isFinite(summary.p50)
    && summary.p50 > 0
    && summary.p95 / summary.p50 <= MAX_VARIABILITY_RATIO;
}

function weightedScore(
  candidate: ThreadCandidateSummary,
  baseline: ThreadCandidateSummary
): number {
  return (candidate.query.p50 / baseline.query.p50) * 0.7
    + (candidate.batch.p50 / baseline.batch.p50) * 0.3;
}

function validateThreadCount(threads: number): asserts threads is WasmThreadCount {
  if (threads !== 0 && threads !== 1 && threads !== 2 && threads !== 4) {
    throw new Error(`Unsupported ONNX WASM thread candidate: ${threads}`);
  }
}
