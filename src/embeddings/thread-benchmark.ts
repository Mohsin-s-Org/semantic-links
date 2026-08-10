import { semanticDiagnostics } from "../diagnostics/performance.ts";
import type { EmbeddingInput, EmbeddingOutput } from "../indexing/types.ts";
import {
  approvedThreadCandidates,
  selectThreadTuning,
  type ThreadCandidateSamples,
  type ThreadTuningDecision,
  type WasmThreadCount
} from "./thread-tuning.ts";

export interface ThreadBenchmarkClient {
  embedQuery(text: string, signal: AbortSignal): Promise<Float32Array>;
  embed(
    inputs: readonly EmbeddingInput[],
    signal: AbortSignal
  ): Promise<EmbeddingOutput[]>;
  dispose(): void;
}

export type ThreadBenchmarkClientFactory = (
  threads: WasmThreadCount,
  signal: AbortSignal
) => Promise<ThreadBenchmarkClient>;

export interface ThreadBenchmarkProgress {
  candidateIndex: number;
  candidateCount: number;
  threads: WasmThreadCount;
  sample: number;
  sampleCount: number;
}

export interface ThreadBenchmarkOptions {
  sampleCount?: number;
  onProgress?: (progress: ThreadBenchmarkProgress) => void;
}

export interface ThreadBenchmarkResult {
  decision: ThreadTuningDecision;
  candidates: WasmThreadCount[];
}

const QUERY_TEXT = "local semantic link query benchmark";
const BATCH_INPUTS: readonly EmbeddingInput[] = Object.freeze([
  { id: "thread-benchmark-1", text: "passage: water conservation planning and household usage" },
  { id: "thread-benchmark-2", text: "passage: project milestones, dependencies and delivery risks" },
  { id: "thread-benchmark-3", text: "passage: ترشيد استهلاك المياه وخطة المتابعة" },
  { id: "thread-benchmark-4", text: "passage: meeting notes, decisions and follow-up actions" }
]);

export async function runThreadBenchmark(
  createClient: ThreadBenchmarkClientFactory,
  hardwareConcurrency: number | undefined,
  signal: AbortSignal,
  options: ThreadBenchmarkOptions = {}
): Promise<ThreadBenchmarkResult> {
  const sampleCount = options.sampleCount ?? 3;
  if (!Number.isInteger(sampleCount) || sampleCount < 3 || sampleCount > 7) {
    throw new Error("Thread tuning sample count must be from 3 to 7.");
  }
  const candidates = approvedThreadCandidates(hardwareConcurrency);
  const samples: ThreadCandidateSamples[] = [];

  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const threads = candidates[candidateIndex];
    if (threads === undefined) {
      continue;
    }
    throwIfAborted(signal);
    const candidate: ThreadCandidateSamples = {
      threads,
      queryMs: [],
      batchMs: []
    };
    samples.push(candidate);
    let client: ThreadBenchmarkClient | null = null;
    try {
      const activeClient = await createClient(threads, signal);
      client = activeClient;
      throwIfAborted(signal);
      await activeClient.embedQuery(QUERY_TEXT, signal);
      throwIfAborted(signal);
      await activeClient.embed(BATCH_INPUTS, signal);
      for (let sample = 0; sample < sampleCount; sample += 1) {
        throwIfAborted(signal);
        options.onProgress?.({
          candidateIndex,
          candidateCount: candidates.length,
          threads,
          sample: sample + 1,
          sampleCount
        });
        const queryMs = await measure(() => activeClient.embedQuery(QUERY_TEXT, signal));
        throwIfAborted(signal);
        const batchMs = await measure(() => activeClient.embed(BATCH_INPUTS, signal));
        candidate.queryMs.push(queryMs);
        candidate.batchMs.push(batchMs);
        semanticDiagnostics.record(`thread_tuning.query_${threads}_ms`, queryMs);
        semanticDiagnostics.record(`thread_tuning.batch_${threads}_ms`, batchMs);
        await yieldToEventLoop();
      }
    } catch {
      if (signal.aborted) {
        throw abortError(signal);
      }
      semanticDiagnostics.increment(`thread_tuning.candidate_${threads}_failure`);
    } finally {
      client?.dispose();
    }
  }

  throwIfAborted(signal);
  return {
    decision: selectThreadTuning(samples),
    candidates
  };
}

async function measure(operation: () => Promise<unknown>): Promise<number> {
  const started = monotonicNow();
  await operation();
  return Math.max(Number.EPSILON, monotonicNow() - started);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw abortError(signal);
  }
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Thread tuning was cancelled.", "AbortError");
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

function monotonicNow(): number {
  return typeof globalThis.performance?.now === "function"
    ? globalThis.performance.now()
    : Date.now();
}
